// Address-space pool for V8 data pages on Horizon (opt-in: --hz-pool).
//
// Why: switch-v8's mman backend (mman-horizon.cc) hands out arena addresses with a bump pointer and its munmap is a
// no-op, so every page V8 ever maps costs fresh address space (and RAM, slabs are committed on first use), and
// OS::Allocate's alignment trick (map size+alignment, unmap the slack) wastes ~1x the size of every 256 KB page.
// This pool takes one big PROT_NONE reservation from the backend and sub-allocates it itself, with real alignment and
// a coalescing free list, so freed pages and trimmed slack are reused.
//
// Memory model it relies on (verified by disassembling mman-horizon.o in switch-v8 15.0.243-9):
//   * mprotect(addr, len, prot != 0) on the data arena commits whole 16 MB slabs (memalign + svcMapMemory + memset 0)
//     and never decommits; prot == 0 and munmap are no-ops. So a page, once committed, stays readable/writable.
//   * Freshly committed slab memory is zero.
// V8's PageAllocator contract needs fresh and decommitted pages to read as zero, so each 4 KB page carries two bits:
//   kCommitted: we asked the backend to commit it (so it is accessible),
//   kDirty:     its content is stale (it was freed or decommitted after being committed) and it must be zeroed before
//               V8 can see it again. Zeroing happens lazily, when the page is next committed/made accessible.
// Pure C++ (no V8, no libnx): the commit hook and the lock are injected, so this compiles and is tested on a PC.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <vector>

struct HzPool {
  static constexpr size_t kPage = 4096;
  enum : uint8_t { kCommitted = 1, kDirty = 2 };
  struct Range { uintptr_t a, b; };          // [a, b)

  // commit(addr, len) must make [addr, addr+len) readable+writable (the backend's mprotect); false = out of memory.
  bool (*commit_fn)(void* addr, size_t len) = nullptr;

  uintptr_t base = 0, end = 0;
  std::vector<Range> free_;                   // sorted by address, never adjacent (always coalesced)
  std::vector<uint8_t> st_;                   // per-page state bits

  // statistics
  size_t in_use = 0, peak = 0, zeroed = 0;
  uintptr_t high = 0;                         // highest end address ever handed out
  uint64_t n_alloc = 0, n_free = 0, n_fail = 0, n_bad = 0;

  static uintptr_t RoundUp(uintptr_t v, uintptr_t a) { return (v + a - 1) & ~(a - 1); }
  static size_t PowerOfTwoAtLeast(size_t v) { size_t p = kPage; while (p < v) p <<= 1; return p; }

  bool Init(uintptr_t b, size_t size) {
    base = RoundUp(b, kPage);
    end = (b + size) & ~(uintptr_t)(kPage - 1);
    if (end <= base) return false;
    free_.clear();
    free_.push_back({base, end});
    st_.assign((end - base) / kPage, 0);
    high = base;
    return true;
  }
  bool Contains(uintptr_t a) const { return a >= base && a < end; }
  bool ContainsRange(uintptr_t a, size_t len) const { return a >= base && len <= end - a && a + len <= end; }
  size_t PageIndex(uintptr_t a) const { return (a - base) / kPage; }
  size_t FreeBytes() const { size_t n = 0; for (const Range& r : free_) n += r.b - r.a; return n; }

  // First fit with alignment. Returns 0 when nothing fits (caller falls back to the backend).
  uintptr_t Alloc(size_t len, size_t align) {
    len = RoundUp(len ? len : 1, kPage);
    align = PowerOfTwoAtLeast(align);
    for (size_t i = 0; i < free_.size(); i++) {
      Range r = free_[i];
      uintptr_t a = RoundUp(r.a, align);
      if (a < r.a || a >= r.b || r.b - a < len) continue;
      uintptr_t e = a + len;
      // replace r by its left and right remainders
      if (a > r.a && e < r.b) { free_[i].b = a; free_.insert(free_.begin() + i + 1, Range{e, r.b}); }
      else if (a > r.a) free_[i].b = a;
      else if (e < r.b) free_[i].a = e;
      else free_.erase(free_.begin() + i);
      in_use += len;
      if (in_use > peak) peak = in_use;
      if (e > high) high = e;
      n_alloc++;
      return a;
    }
    n_fail++;
    return 0;
  }

  // Returns false (and changes nothing) on a range that is not wholly allocated (double free / foreign range).
  bool Free(uintptr_t a, size_t len) {
    len = RoundUp(len, kPage);
    if (!len) return true;
    if ((a & (kPage - 1)) || !ContainsRange(a, len)) { n_bad++; return false; }
    uintptr_t e = a + len;
    // first free range starting after a
    size_t lo = 0, hi = free_.size();
    while (lo < hi) { size_t mid = (lo + hi) / 2; if (free_[mid].a <= a) lo = mid + 1; else hi = mid; }
    size_t i = lo;                                            // insert position
    if (i > 0 && free_[i - 1].b > a) { n_bad++; return false; }   // overlaps the previous free range
    if (i < free_.size() && free_[i].a < e) { n_bad++; return false; }   // overlaps the next free range
    for (size_t p = PageIndex(a), q = PageIndex(e); p < q; p++)
      if (st_[p] & kCommitted) st_[p] |= kDirty;
    bool join_prev = i > 0 && free_[i - 1].b == a;
    bool join_next = i < free_.size() && free_[i].a == e;
    if (join_prev && join_next) { free_[i - 1].b = free_[i].b; free_.erase(free_.begin() + i); }
    else if (join_prev) free_[i - 1].b = e;
    else if (join_next) free_[i].a = a;
    else free_.insert(free_.begin() + i, Range{a, e});
    in_use -= len;
    n_free++;
    return true;
  }

  // Make [a, a+len) accessible: commit through the backend, then zero every stale page in it.
  bool Commit(uintptr_t a, size_t len) {
    uintptr_t a0 = a & ~(uintptr_t)(kPage - 1), e = RoundUp(a + len, kPage);
    if (e <= a0) return true;
    if (!ContainsRange(a0, e - a0)) return false;
    if (commit_fn && !commit_fn((void*)a0, e - a0)) return false;
    size_t p = PageIndex(a0), q = PageIndex(e);
    while (p < q) {
      if (!(st_[p] & kDirty)) { st_[p] = kCommitted; p++; continue; }
      size_t r = p;
      while (r < q && (st_[r] & kDirty)) st_[r++] = kCommitted;
      memset((void*)(base + p * kPage), 0, (r - p) * kPage);
      zeroed += (r - p) * kPage;
      p = r;
    }
    return true;
  }

  // Decommit: the pages stay mapped (the backend cannot unmap) but must read as zero once made accessible again.
  void Decommit(uintptr_t a, size_t len) {
    uintptr_t a0 = a & ~(uintptr_t)(kPage - 1), e = RoundUp(a + len, kPage);
    if (e <= a0 || !ContainsRange(a0, e - a0)) return;
    for (size_t p = PageIndex(a0), q = PageIndex(e); p < q; p++)
      if (st_[p] & kCommitted) st_[p] |= kDirty;
  }
};
