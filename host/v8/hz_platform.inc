// ---- optional page pool (--hz-pool): V8 data pages from one reservation with reuse; code/JIT pages go to V8's own ----
class HzPageAllocator final : public v8::PageAllocator {
 public:
  explicit HzPageAllocator(v8::PageAllocator* os) : os_(os) { mutexInit(&mtx_); }
  bool Init(size_t bytes) {
    void* r = mmap(nullptr, bytes, 0, kMapAnon | kMapPrivate, -1, 0);
    if (r == (void*)-1 || !r) return false;
    pool_.commit_fn = [](void* a, size_t n) { return mprotect(a, n, kProtRW) == 0; };
    return pool_.Init((uintptr_t)r, bytes);
  }
  void Stats(size_t* in_use, size_t* peak, size_t* high, size_t* zeroed, uint64_t* fallbacks, uint64_t* bad) {
    mutexLock(&mtx_);
    *in_use = pool_.in_use; *peak = pool_.peak; *high = pool_.high - pool_.base; *zeroed = pool_.zeroed;
    *fallbacks = fallbacks_; *bad = pool_.n_bad;
    mutexUnlock(&mtx_);
  }

  size_t AllocatePageSize() override { return os_->AllocatePageSize(); }
  size_t CommitPageSize() override { return os_->CommitPageSize(); }
  void SetRandomMmapSeed(int64_t seed) override { os_->SetRandomMmapSeed(seed); }
  void* GetRandomMmapAddr() override { return os_->GetRandomMmapAddr(); }

  void* AllocatePages(void* hint, size_t length, size_t alignment, Permission perm) override {
    if (perm == kNoAccessWillJitLater || perm == kReadWriteExecute || perm == kReadExecute)
      return os_->AllocatePages(hint, length, alignment, perm);
    mutexLock(&mtx_);
    uintptr_t a = pool_.Alloc(length, alignment);
    if (a && perm != kNoAccess && !pool_.Commit(a, length)) { pool_.Free(a, length); a = 0; }
    if (!a) fallbacks_++;
    mutexUnlock(&mtx_);
    return a ? (void*)a : os_->AllocatePages(hint, length, alignment, perm);
  }
  bool FreePages(void* address, size_t length) override {
    if (!In(address)) return os_->FreePages(address, length);
    mutexLock(&mtx_);
    bool ok = pool_.Free((uintptr_t)address, length);
    mutexUnlock(&mtx_);
    return ok;
  }
  bool ReleasePages(void* address, size_t length, size_t new_length) override {
    if (!In(address)) return os_->ReleasePages(address, length, new_length);
    if (new_length >= length) return true;
    mutexLock(&mtx_);
    bool ok = pool_.Free((uintptr_t)address + new_length, length - new_length);
    mutexUnlock(&mtx_);
    return ok;
  }
  bool SetPermissions(void* address, size_t length, Permission perm) override {
    if (!In(address)) return os_->SetPermissions(address, length, perm);
    if (perm == kNoAccess) return true;              // the backend cannot revoke access; content must be kept anyway
    mutexLock(&mtx_);
    bool ok = pool_.Commit((uintptr_t)address, length);
    mutexUnlock(&mtx_);
    return ok;
  }
  bool RecommitPages(void* address, size_t length, Permission perm) override {
    if (!In(address)) return os_->RecommitPages(address, length, perm);
    return SetPermissions(address, length, perm);
  }
  bool DiscardSystemPages(void* address, size_t size) override {
    if (!In(address)) return os_->DiscardSystemPages(address, size);
    return true;                                     // a hint; content may stay
  }
  bool DecommitPages(void* address, size_t size) override {
    if (!In(address)) return os_->DecommitPages(address, size);
    mutexLock(&mtx_);
    pool_.Decommit((uintptr_t)address, size);        // reads as zero once made accessible again
    mutexUnlock(&mtx_);
    return true;
  }
  bool SealPages(void* address, size_t length) override {
    return In(address) ? false : os_->SealPages(address, length);
  }
  bool ResizeAllocationAt(void* address, size_t old_length, size_t new_length, Permission perm) override {
    return In(address) ? false : os_->ResizeAllocationAt(address, old_length, new_length, perm);
  }
  bool ReserveForSharedMemoryMapping(void* address, size_t size) override {
    return In(address) ? false : os_->ReserveForSharedMemoryMapping(address, size);
  }
  std::unique_ptr<SharedMemory> AllocateSharedPages(size_t length, const void* original) override {
    return os_->AllocateSharedPages(length, original);
  }
  bool CanAllocateSharedPages() override { return os_->CanAllocateSharedPages(); }

 private:
  bool In(void* a) const { return pool_.Contains((uintptr_t)a); }   // the pool's bounds never change after Init
  v8::PageAllocator* os_;
  HzPool pool_;
  Mutex mtx_;
  uint64_t fallbacks_ = 0;
};

// Forwards everything to the default single-threaded platform except the page allocator.
class HzPlatform final : public v8::Platform {
 public:
  HzPlatform(v8::Platform* in, v8::PageAllocator* pa) : in_(in), pa_(pa) {}
  v8::PageAllocator* GetPageAllocator() override { return pa_; }
  v8::ThreadIsolatedAllocator* GetThreadIsolatedAllocator() override { return in_->GetThreadIsolatedAllocator(); }
  size_t GetZeroSegmentSize() override { return in_->GetZeroSegmentSize(); }
  void OnCriticalMemoryPressure() override { in_->OnCriticalMemoryPressure(); }
  int NumberOfWorkerThreads() override { return in_->NumberOfWorkerThreads(); }
  std::shared_ptr<v8::TaskRunner> GetForegroundTaskRunner(v8::Isolate* isolate, v8::TaskPriority priority) override {
    return in_->GetForegroundTaskRunner(isolate, priority);
  }
  bool IdleTasksEnabled(v8::Isolate* isolate) override { return in_->IdleTasksEnabled(isolate); }
  std::unique_ptr<v8::ScopedBoostablePriority> CreateBoostablePriorityScope() override {
    return in_->CreateBoostablePriorityScope();
  }
  std::unique_ptr<v8::ScopedBlockingCall> CreateBlockingScope(v8::BlockingType type) override {
    return in_->CreateBlockingScope(type);
  }
  double MonotonicallyIncreasingTime() override { return in_->MonotonicallyIncreasingTime(); }
  int64_t CurrentClockTimeMilliseconds() override { return in_->CurrentClockTimeMilliseconds(); }
  double CurrentClockTimeMillis() override { return in_->CurrentClockTimeMillis(); }
  double CurrentClockTimeMillisecondsHighResolution() override {
    return in_->CurrentClockTimeMillisecondsHighResolution();
  }
  StackTracePrinter GetStackTracePrinter() override { return in_->GetStackTracePrinter(); }
  v8::TracingController* GetTracingController() override { return in_->GetTracingController(); }
  void DumpWithoutCrashing() override { in_->DumpWithoutCrashing(); }
  v8::HighAllocationThroughputObserver* GetHighAllocationThroughputObserver() override {
    return in_->GetHighAllocationThroughputObserver();
  }

 protected:
  std::unique_ptr<v8::JobHandle> CreateJobImpl(v8::TaskPriority priority, std::unique_ptr<v8::JobTask> job,
                                               const v8::SourceLocation& loc) override {
    return in_->CreateJob(priority, std::move(job), loc);
  }
  void PostTaskOnWorkerThreadImpl(v8::TaskPriority priority, std::unique_ptr<v8::Task> task,
                                  const v8::SourceLocation& loc) override {
    in_->PostTaskOnWorkerThread(priority, std::move(task), loc);
  }
  void PostDelayedTaskOnWorkerThreadImpl(v8::TaskPriority priority, std::unique_ptr<v8::Task> task, double delay,
                                         const v8::SourceLocation& loc) override {
    in_->PostDelayedTaskOnWorkerThread(priority, std::move(task), delay, loc);
  }

 private:
  v8::Platform* in_;
  v8::PageAllocator* pa_;
};
