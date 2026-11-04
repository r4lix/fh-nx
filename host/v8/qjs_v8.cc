// QuickJS-ng API subset on V8 (switch-v8 15.0.243): see quickjs.h for the ownership rules.
#include "quickjs.h"

#include <alloca.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include <switch.h>

#include <libplatform/libplatform.h>
#include <v8.h>

#include "hz_pool.h"

extern "C" void fh_log(const char* fmt, ...);   // main.c
extern "C" {
size_t horizon_mman_data_arena_size(void);
void horizon_mman_teardown(void);
void* mmap(void* addr, size_t len, int prot, int flags, int fd, long off);
int mprotect(void* addr, size_t len, int prot);
}
// flag values of the backend's <sys/mman.h> shim (see build/v8spike/v8-bench/main.cc)
static const int kProtRW = 1 | 2, kMapPrivate = 0x2, kMapAnon = 0x1000;

#include "hz_platform.inc"   // HzPageAllocator, HzPlatform (from the bench)

static_assert(sizeof(v8::Local<v8::Value>) == sizeof(void*), "Local must be one slot pointer");

// ---- records -----------------------------------------------------------------------------------------------------
struct ClassRec {
  std::string name;
  JSClassFinalizer* fin = nullptr;
  v8::Global<v8::Object> proto;
  v8::Global<v8::Function> ctor;
  bool defined = false;
};
struct ObjRec {
  JSClassID cls;
  void* opaque;
  v8::Global<v8::Object> weak;
};
struct FnRec {
  uint64_t ticks = 0, calls = 0;
  std::string name;
  int kind;   // 0 function, 1 getter, 2 setter
  int length;
  int magic;
  JSCFunction* f;
  JSCGetterMagic* g;
  JSCSetterMagic* s;
};
struct JSRuntime {
  v8::Isolate* iso = nullptr;
  v8::ArrayBuffer::Allocator* aba = nullptr;
  std::vector<ClassRec> classes;
  std::unordered_set<ObjRec*> objs;
  std::vector<FnRec*> fns;
  JSContext* ctx = nullptr;
};
struct JSContext {
  JSRuntime* rt;
  v8::Isolate* iso;
  v8::Global<v8::Context> c;
  v8::Global<v8::Value> pending;
  int depth = 0;
};
static JSContext* g_ctx;

// ---- GC accounting -----------------------------------------------------------------------------------------------
static unsigned g_gc_n[2];
static double g_gc_ms[2], g_gc_t0, g_gc_worst;
static int64_t g_ext_bytes;
static uint64_t g_nat_ticks, g_nat_calls, g_ta_calls, g_ta_materialized;   // time spent inside native callbacks (outermost only)
static const char* g_gc_reason = "";
static double now_ms() { return armTicksToNs(armGetSystemTick()) / 1e6; }
static void gc_pro(v8::Isolate*, v8::GCType, v8::GCCallbackFlags) { g_gc_t0 = now_ms(); }
static void gc_epi(v8::Isolate*, v8::GCType t, v8::GCCallbackFlags f) {
  double d = now_ms() - g_gc_t0;
  int k = t == v8::kGCTypeMarkSweepCompact ? 1 : 0;
  g_gc_n[k]++;
  g_gc_ms[k] += d;
  if (d > g_gc_worst) {
    g_gc_worst = d;
    g_gc_reason = (f & v8::kGCCallbackFlagForced) ? " (forced)" : (f & v8::kGCCallbackFlagCollectAllExternalMemory) ? " (external memory)"
                  : (f & v8::kGCCallbackFlagCollectAllAvailableGarbage) ? " (all garbage)" : k ? " (heap limit/marking)" : "";
  }
}

// ---- value conversion ----------------------------------------------------------------------------------------------
static inline v8::Local<v8::Value> slot(void* p) {
  v8::Local<v8::Value> l;
  memcpy((void*)&l, &p, sizeof p);
  return l;
}
static inline JSValue mk_local(v8::Local<v8::Value> l) {
  JSValue v;
  memcpy(&v.u.p, (void*)&l, sizeof(void*));
  v.tag = JS_TAG_V8_LOCAL;
  return v;
}
static v8::Local<v8::Value> L(JSContext* ctx, JSValueConst v) {
  v8::Isolate* iso = ctx->iso;
  switch (v.tag) {
    case JS_TAG_V8_LOCAL: return slot(v.u.p);
    case JS_TAG_V8_GLOBAL: return v8::Local<v8::Value>::New(iso, *(v8::Global<v8::Value>*)v.u.p);
    case JS_TAG_INT: return v8::Integer::New(iso, v.u.i);
    case JS_TAG_FLOAT64: return v8::Number::New(iso, v.u.f);
    case JS_TAG_BOOL: return v8::Boolean::New(iso, v.u.i != 0);
    case JS_TAG_NULL: return v8::Null(iso);
    default: return v8::Undefined(iso);
  }
}
// A V8 value handed to C: a local inside callbacks, an owned persistent handle outside them.
static JSValue out(JSContext* ctx, v8::Local<v8::Value> l) {
  if (l.IsEmpty()) return JS_EXCEPTION;
  if (ctx->depth > 0) return mk_local(l);
  if (l->IsUndefined()) return JS_UNDEFINED;
  if (l->IsNull()) return JS_NULL;
  if (l->IsInt32()) return JS_NewInt32(ctx, l.As<v8::Int32>()->Value());
  if (l->IsNumber()) return JS_NewFloat64(ctx, l.As<v8::Number>()->Value());
  if (l->IsBoolean()) return JS_NewBool(ctx, l->IsTrue());
  JSValue v;
  v.u.p = new v8::Global<v8::Value>(ctx->iso, l);
  v.tag = JS_TAG_V8_GLOBAL;
  return v;
}
template <class T>
static JSValue out(JSContext* ctx, v8::MaybeLocal<T> m) {
  v8::Local<T> l;
  if (!m.ToLocal(&l)) return JS_EXCEPTION;
  return out(ctx, v8::Local<v8::Value>(l));
}
// Outside callbacks the C code owns no handle scope: open one for the duration of each call.
struct Scope {
  std::optional<v8::HandleScope> hs;
  explicit Scope(JSContext* ctx) { if (ctx->depth == 0) hs.emplace(ctx->iso); }
};
static inline v8::Local<v8::Context> C(JSContext* ctx) { return ctx->iso->GetCurrentContext(); }
static v8::Local<v8::String> S(v8::Isolate* iso, const char* s, int len = -1,
                               v8::NewStringType t = v8::NewStringType::kNormal) {
  v8::Local<v8::String> r;
  if (!v8::String::NewFromUtf8(iso, s ? s : "", t, len).ToLocal(&r)) r = v8::String::Empty(iso);
  return r;
}

// ---- callbacks -----------------------------------------------------------------------------------------------------
static FnRec* mkfn(int kind, int length, int magic, JSCFunction* f, JSCGetterMagic* g, JSCSetterMagic* st) {
  FnRec* r = new FnRec();
  r->kind = kind; r->length = length; r->magic = magic; r->f = f; r->g = g; r->s = st;
  return r;
}
static bool g_in_native;
static void set_ret(JSContext* ctx, const v8::FunctionCallbackInfo<v8::Value>& info, JSValue r) {
  auto rv = info.GetReturnValue();
  switch (r.tag) {
    case JS_TAG_INT: rv.Set(r.u.i); break;
    case JS_TAG_FLOAT64: rv.Set(r.u.f); break;
    case JS_TAG_BOOL: rv.Set(r.u.i != 0); break;
    case JS_TAG_NULL: rv.SetNull(); break;
    case JS_TAG_V8_LOCAL: rv.Set(slot(r.u.p)); break;
    case JS_TAG_V8_GLOBAL: {
      auto* g = (v8::Global<v8::Value>*)r.u.p;
      rv.Set(v8::Local<v8::Value>::New(ctx->iso, *g));
      delete g;
      break;
    }
    case JS_TAG_EXCEPTION:
      // an exception caught by JS_Call/JS_Eval inside this callback and not consumed goes on to the caller, as in QuickJS
      if (!ctx->pending.IsEmpty()) {
        ctx->iso->ThrowException(v8::Local<v8::Value>::New(ctx->iso, ctx->pending));
        ctx->pending.Reset();
      }
      break;
    default: break;
  }
}
static void fn_tramp(const v8::FunctionCallbackInfo<v8::Value>& info) {
  FnRec* r = (FnRec*)info.Data().As<v8::External>()->Value(v8::kExternalPointerTypeTagDefault);
  JSContext* ctx = g_ctx;
  JSValue res;
  bool outer = ctx->depth == 0 || !g_in_native;
  uint64_t t0 = 0;
  if (outer) { g_in_native = true; t0 = armGetSystemTick(); }
  ctx->depth++;
  if (r->kind == 0) {
    int argc = info.Length(), n = argc > r->length ? argc : r->length;
    JSValue small[12];
    JSValue* argv = n <= 12 ? small : (JSValue*)alloca(sizeof(JSValue) * n);
    for (int i = 0; i < argc; i++) argv[i] = mk_local(info[i]);
    for (int i = argc; i < n; i++) argv[i] = JS_UNDEFINED;
    res = r->f(ctx, mk_local(info.This()), argc, argv);
  } else if (r->kind == 1) {
    res = r->g(ctx, mk_local(info.This()), r->magic);
  } else {
    res = r->s(ctx, mk_local(info.This()), info.Length() > 0 ? mk_local(info[0]) : JS_UNDEFINED, r->magic);
  }
  ctx->depth--;
  if (outer) { uint64_t d = armGetSystemTick() - t0; g_in_native = false; g_nat_ticks += d; r->ticks += d; r->calls++; }
  g_nat_calls++;
  set_ret(ctx, info, res);
}
static v8::Local<v8::Function> make_fn(JSContext* ctx, FnRec* r, const char* name) {
  ctx->rt->fns.push_back(r);
  if (name) r->name = name;
  v8::Isolate* iso = ctx->iso;
  auto ft = v8::FunctionTemplate::New(iso, fn_tramp, v8::External::New(iso, r, v8::kExternalPointerTypeTagDefault),
                                      v8::Local<v8::Signature>(), r->kind == 0 ? r->length : 0,
                                      v8::ConstructorBehavior::kThrow);
  v8::Local<v8::Function> f = ft->GetFunction(C(ctx)).ToLocalChecked();
  if (name) f->SetName(S(iso, name));
  return f;
}

// ---- runtime / context ---------------------------------------------------------------------------------------------
static std::unique_ptr<v8::Platform> g_platform;
static std::unique_ptr<HzPlatform> g_wrap;
static HzPageAllocator* g_pool;
static bool g_v8_up;
static std::string g_flags;

static void on_fatal(const char* where, const char* msg) { fh_log("V8 FATAL in %s: %s\n", where, msg); }
static void on_oom(const char* where, const v8::OOMDetails& d) {
  fh_log("V8 OUT OF MEMORY in %s (%s)\n", where, d.is_heap_oom ? "JS heap" : "process");
}

static void v8_global_init() {
  if (g_v8_up) return;
  g_v8_up = true;
  // As build/v8spike/v8-bench (the configuration measured on the device), plus anything in sdmc:/switch/fh-nx/v8flags.txt.
  std::string extra;
  if (FILE* f = fopen("sdmc:/switch/fh-nx/v8flags.txt", "rb")) {
    char line[512];
    while (fgets(line, sizeof line, f)) {
      line[strcspn(line, "\r\n")] = 0;
      if (line[0] && line[0] != '#') { extra += " "; extra += line; }
    }
    fclose(f);
  }
  auto take = [&](const char* name) -> std::string {   // removes a pseudo-flag "--name" / "--name=value"; "" when absent
    size_t i = extra.find(name);
    if (i == std::string::npos) return "";
    size_t e = extra.find(' ', i);
    std::string t = extra.substr(i, e == std::string::npos ? std::string::npos : e - i);
    extra.erase(i, t.size());
    return t;
  };
  bool pool = take("--no-hz-pool").empty();
  std::string th = take("--hz-threads=");
  int threads = th.empty() ? 0 : atoi(th.c_str() + 13);
  // threads 0: everything on the game thread (switch-v8's proven setup). threads N: N worker threads for GC marking and
  // sweeping and for optimizing compiles (upstream's worker crash was at platform teardown, which fh-nx never does).
  g_flags = threads > 0 ? "--expose-gc --max-old-space-size=512 --no-compact-code-space"
                        : "--single-threaded --single-threaded-gc --no-concurrent-recompilation --predictable "
                          "--expose-gc --max-old-space-size=512 --no-compact-code-space";
  g_flags += extra;
  // the JIT needs application mode (title override / a forwarder): an applet launch (album) has no JIT memory
  AppletType at = appletGetAppletType();
  if (at != AppletType_Application && at != AppletType_SystemApplication && g_flags.find("--jitless") == std::string::npos) {
    g_flags += " --jitless";
    fh_log("V8: applet mode (type %d): JIT off. Launch through a game (hold R) for full speed.\n", (int)at);
  }
  v8::V8::SetFlagsFromString(g_flags.c_str());
  if (threads > 0)
    g_platform = v8::platform::NewDefaultPlatform(threads, v8::platform::IdleTaskSupport::kDisabled,
                                                  v8::platform::InProcessStackDumping::kDisabled);
  else
    g_platform = v8::platform::NewSingleThreadedDefaultPlatform();
  // V8's data pages from a reusing pool: the backend never reuses freed pages (see docs/engine-alternatives.md)
  size_t arena = horizon_mman_data_arena_size();
  if (pool && arena >= (384u << 20)) {
    size_t want = std::min<size_t>(arena - (192u << 20), 512u << 20);
    g_pool = new HzPageAllocator(g_platform->GetPageAllocator());
    if (g_pool->Init(want)) g_wrap = std::make_unique<HzPlatform>(g_platform.get(), g_pool);
    else { delete g_pool; g_pool = nullptr; }
  }
  fh_log("V8 %s: data arena %zu MB, page pool %s, %d worker threads, flags: %s\n", v8::V8::GetVersion(), arena >> 20,
         g_pool ? "on" : "off", threads, g_flags.c_str());
  v8::V8::InitializePlatform(g_wrap ? (v8::Platform*)g_wrap.get() : g_platform.get());
  v8::V8::Initialize();
  atexit(horizon_mman_teardown);   // releases the backend's arena mappings before libnx hands the process back
}

// One isolate for the whole process: the mods menu's Apply starts the game again in a fresh runtime, and a disposed isolate's
// memory (the 64 MiB JIT code range, V8's own reservations) never comes back from switch-v8's backend, so a third isolate
// failed to start. A "runtime" is the game's JS world: a new context in the kept isolate.
static v8::Isolate* g_iso;
static v8::ArrayBuffer::Allocator* g_aba;
extern "C" JSRuntime* JS_NewRuntime2(const JSMallocFunctions*, void*) {
  v8_global_init();
  JSRuntime* rt = new JSRuntime();
  if (!g_iso) {
    v8::Isolate::CreateParams cp;
    g_aba = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    cp.array_buffer_allocator = g_aba;
    if (g_flags.find("--jitless") == std::string::npos) cp.constraints.set_code_range_size_in_bytes(64u << 20);
    g_iso = v8::Isolate::New(cp);
    g_iso->Enter();
    g_iso->SetFatalErrorHandler(on_fatal);
    g_iso->SetOOMErrorHandler(on_oom);
    g_iso->SetMicrotasksPolicy(v8::MicrotasksPolicy::kExplicit);
    g_iso->AddGCPrologueCallback(gc_pro);
    g_iso->AddGCEpilogueCallback(gc_epi);
  }
  rt->iso = g_iso;
  rt->aba = g_aba;
  rt->classes.resize(16);
  return rt;
}
extern "C" void JS_SetMaxStackSize(JSRuntime* rt, size_t size) {
  volatile int marker = 0;
  rt->iso->SetStackLimit((uintptr_t)&marker - size);
}
extern "C" void JS_FreeRuntime(JSRuntime* rt) {
  {
    v8::HandleScope hs(rt->iso);
    // QuickJS runs the finalizers of every object still alive: canvas surfaces and gradients free their C memory here
    for (ObjRec* o : rt->objs) {
      ClassRec& c = rt->classes[o->cls];
      if (c.fin && o->opaque) {
        JSValue v;
        v.u.p = o;
        v.tag = JS_TAG_FINALIZING;
        c.fin(rt, v);
      }
      o->weak.Reset();
      delete o;
    }
    rt->objs.clear();
    for (ClassRec& c : rt->classes) { c.proto.Reset(); c.ctor.Reset(); }
  }
  // the isolate stays (see JS_NewRuntime2); the old context's objects are garbage now: collect them before the next start
  rt->iso->RequestGarbageCollectionForTesting(v8::Isolate::kFullGarbageCollection);
  delete rt;   // FnRecs stay: functions of the old context may still sit in the heap until a GC (a few KB per start)
}
extern "C" JSContext* JS_NewContext(JSRuntime* rt) {
  JSContext* ctx = new JSContext();
  ctx->rt = rt;
  ctx->iso = rt->iso;
  v8::HandleScope hs(rt->iso);
  v8::Local<v8::Context> c = v8::Context::New(rt->iso);
  ctx->c.Reset(rt->iso, c);
  c->Enter();
  rt->ctx = ctx;
  g_ctx = ctx;
  return ctx;
}
extern "C" void JS_FreeContext(JSContext* ctx) {
  {
    v8::HandleScope hs(ctx->iso);
    v8::Local<v8::Context>::New(ctx->iso, ctx->c)->Exit();
  }
  ctx->pending.Reset();
  ctx->c.Reset();
  if (g_ctx == ctx) g_ctx = nullptr;
  ctx->rt->ctx = nullptr;
  delete ctx;
}
extern "C" JSRuntime* JS_GetRuntime(JSContext* ctx) { return ctx->rt; }
extern "C" void JS_RunGC(JSRuntime* rt) {   // one full collection (needs --expose-gc; LowMemoryNotification runs up to 7)
  rt->iso->RequestGarbageCollectionForTesting(v8::Isolate::kFullGarbageCollection);
}
extern "C" void JS_ComputeMemoryUsage(JSRuntime* rt, JSMemoryUsage* s) {
  v8::HeapStatistics hs;
  rt->iso->GetHeapStatistics(&hs);
  s->malloc_size = (int64_t)(hs.used_heap_size() + hs.external_memory());
  s->obj_count = 0;
}
extern "C" int JS_ExecutePendingJob(JSRuntime* rt, JSContext** pctx) {
  if (pctx) *pctx = rt->ctx;
  v8::HandleScope hs(rt->iso);
  rt->iso->PerformMicrotaskCheckpoint();
  return 0;
}
extern "C" void JS_V8ExternalMemory(JSContext* ctx, int64_t delta) {
  if (!ctx) ctx = g_ctx;
  g_ext_bytes += delta;
  if (!ctx) return;
  ctx->iso->AdjustAmountOfExternalAllocatedMemory(delta);
}
extern "C" const char* JS_V8Stats(JSRuntime* rt) {
  static char b[768];
  v8::HeapStatistics hs;
  rt->iso->GetHeapStatistics(&hs);
  snprintf(b, sizeof b, "heap %.0f/%.0f MB, ext %.0f MB, gc %u minor %.0f ms, %u major %.0f ms, worst %.1f ms%s | native %.0f ms in %llu calls | typed arrays %llu, %llu moved off-heap",
           hs.used_heap_size() / 1048576.0, hs.total_heap_size() / 1048576.0, g_ext_bytes / 1048576.0, g_gc_n[0],
           g_gc_ms[0], g_gc_n[1], g_gc_ms[1], g_gc_worst, g_gc_reason, armTicksToNs(g_nat_ticks) / 1e6,
           (unsigned long long)g_nat_calls, (unsigned long long)g_ta_calls, (unsigned long long)g_ta_materialized);
  g_nat_ticks = g_nat_calls = g_ta_calls = g_ta_materialized = 0;
  // the five native functions that took the most time since the last report
  std::vector<FnRec*> v(rt->fns.begin(), rt->fns.end());
  std::partial_sort(v.begin(), v.begin() + std::min<size_t>(5, v.size()), v.end(),
                    [](FnRec* a, FnRec* b) { return a->ticks > b->ticks; });
  size_t n = strlen(b);
  for (size_t i = 0; i < 5 && i < v.size() && v[i]->ticks; i++)
    n += snprintf(b + n, sizeof b - n, "%s %s %.0fms/%llu", i ? "," : " | top:", v[i]->name.c_str(),
                  armTicksToNs(v[i]->ticks) / 1e6, (unsigned long long)v[i]->calls);
  for (FnRec* f : rt->fns) f->ticks = f->calls = 0;
  g_gc_reason = "";
  g_gc_n[0] = g_gc_n[1] = 0;
  g_gc_ms[0] = g_gc_ms[1] = g_gc_worst = 0;
  return b;
}

// ---- values --------------------------------------------------------------------------------------------------------
extern "C" JSValue JS_DupValue(JSContext* ctx, JSValueConst v) {
  if (v.tag != JS_TAG_V8_LOCAL && v.tag != JS_TAG_V8_GLOBAL) return v;
  Scope sc(ctx);
  JSValue r;
  r.u.p = new v8::Global<v8::Value>(ctx->iso, L(ctx, v));
  r.tag = JS_TAG_V8_GLOBAL;
  return r;
}
extern "C" void JS_FreeValue(JSContext*, JSValue v) {
  if (v.tag == JS_TAG_V8_GLOBAL) delete (v8::Global<v8::Value>*)v.u.p;
}
template <class F>
static bool test(JSValueConst v, F f) {
  if (v.tag == JS_TAG_V8_LOCAL) return f(slot(v.u.p));
  if (v.tag != JS_TAG_V8_GLOBAL || !g_ctx) return false;
  v8::HandleScope hs(g_ctx->iso);
  return f(L(g_ctx, v));
}
extern "C" bool JS_IsUndefined(JSValueConst v) {
  if (v.tag == JS_TAG_UNDEFINED) return true;
  return test(v, [](v8::Local<v8::Value> l) { return l->IsUndefined(); });
}
extern "C" bool JS_IsObject(JSValueConst v) { return test(v, [](v8::Local<v8::Value> l) { return l->IsObject(); }); }
extern "C" bool JS_IsString(JSValueConst v) { return test(v, [](v8::Local<v8::Value> l) { return l->IsString(); }); }
extern "C" bool JS_IsArray(JSValueConst v) { return test(v, [](v8::Local<v8::Value> l) { return l->IsArray(); }); }
extern "C" bool JS_IsArrayBuffer(JSValueConst v) {
  return test(v, [](v8::Local<v8::Value> l) { return l->IsArrayBuffer(); });
}
extern "C" bool JS_IsFunction(JSContext*, JSValueConst v) {
  return test(v, [](v8::Local<v8::Value> l) { return l->IsFunction(); });
}
extern "C" JSValue JS_NewStringLen(JSContext* ctx, const char* s, size_t len) {
  Scope sc(ctx);
  return out(ctx, v8::Local<v8::Value>(S(ctx->iso, s, (int)len)));
}
extern "C" JSValue JS_NewString(JSContext* ctx, const char* s) { return JS_NewStringLen(ctx, s, strlen(s)); }
extern "C" JSValue JS_NewObject(JSContext* ctx) {
  Scope sc(ctx);
  return out(ctx, v8::Local<v8::Value>(v8::Object::New(ctx->iso)));
}
extern "C" JSValue JS_NewArray(JSContext* ctx) {
  Scope sc(ctx);
  return out(ctx, v8::Local<v8::Value>(v8::Array::New(ctx->iso)));
}
extern "C" JSValue JS_GetGlobalObject(JSContext* ctx) {
  Scope sc(ctx);
  return out(ctx, v8::Local<v8::Value>(C(ctx)->Global()));
}
extern "C" int JS_ToInt32(JSContext* ctx, int32_t* pres, JSValueConst v) {
  if (v.tag == JS_TAG_INT) { *pres = v.u.i; return 0; }
  Scope sc(ctx);
  v8::Local<v8::Value> l = L(ctx, v);
  if (l->IsInt32()) { *pres = l.As<v8::Int32>()->Value(); return 0; }
  if (!l->Int32Value(C(ctx)).To(pres)) { *pres = 0; return -1; }
  return 0;
}
extern "C" int JS_ToUint32(JSContext* ctx, uint32_t* pres, JSValueConst v) {
  if (v.tag == JS_TAG_INT) { *pres = (uint32_t)v.u.i; return 0; }
  Scope sc(ctx);
  if (!L(ctx, v)->Uint32Value(C(ctx)).To(pres)) { *pres = 0; return -1; }
  return 0;
}
extern "C" int JS_ToFloat64(JSContext* ctx, double* pres, JSValueConst v) {
  if (v.tag == JS_TAG_INT) { *pres = v.u.i; return 0; }
  if (v.tag == JS_TAG_FLOAT64) { *pres = v.u.f; return 0; }
  Scope sc(ctx);
  v8::Local<v8::Value> l = L(ctx, v);
  if (l->IsNumber()) { *pres = l.As<v8::Number>()->Value(); return 0; }
  if (!l->NumberValue(C(ctx)).To(pres)) { *pres = 0; return -1; }
  return 0;
}
extern "C" int JS_ToBool(JSContext* ctx, JSValueConst v) {
  if (v.tag == JS_TAG_BOOL || v.tag == JS_TAG_INT) return v.u.i != 0;
  Scope sc(ctx);
  return L(ctx, v)->BooleanValue(ctx->iso) ? 1 : 0;
}
extern "C" const char* JS_ToCStringLen(JSContext* ctx, size_t* plen, JSValueConst v) {
  Scope sc(ctx);
  v8::Local<v8::Value> l = L(ctx, v);
  v8::Local<v8::String> s;
  if (l->IsString()) s = l.As<v8::String>();
  else if (!l->ToString(C(ctx)).ToLocal(&s)) { if (plen) *plen = 0; return nullptr; }
  size_t n = s->Utf8Length(ctx->iso);
  char* b = (char*)malloc(n + 1);
  if (!b) { if (plen) *plen = 0; return nullptr; }
  size_t w = s->WriteUtf8(ctx->iso, b, n + 1, v8::String::WriteFlags::kNullTerminate);
  if (w > n) w = n;
  b[w] = 0;
  if (plen) *plen = w;
  return b;
}
extern "C" const char* JS_ToCString(JSContext* ctx, JSValueConst v) { return JS_ToCStringLen(ctx, nullptr, v); }
extern "C" void JS_FreeCString(JSContext*, const char* s) { free((void*)s); }

// ---- properties ----------------------------------------------------------------------------------------------------
static v8::Local<v8::String> key(JSContext* ctx, const char* name) {
  return S(ctx->iso, name, -1, v8::NewStringType::kInternalized);
}
extern "C" JSValue JS_GetPropertyStr(JSContext* ctx, JSValueConst obj, const char* name) {
  Scope sc(ctx);
  v8::Local<v8::Value> o = L(ctx, obj);
  if (!o->IsObject()) return JS_UNDEFINED;
  return out(ctx, o.As<v8::Object>()->Get(C(ctx), key(ctx, name)));
}
extern "C" int JS_SetPropertyStr(JSContext* ctx, JSValueConst obj, const char* name, JSValue val) {
  int ok = -1;
  {
    Scope sc(ctx);
    v8::Local<v8::Value> o = L(ctx, obj);
    if (o->IsObject()) ok = o.As<v8::Object>()->Set(C(ctx), key(ctx, name), L(ctx, val)).FromMaybe(false) ? 1 : -1;
  }
  JS_FreeValue(ctx, val);
  return ok;
}
extern "C" JSValue JS_GetPropertyUint32(JSContext* ctx, JSValueConst obj, uint32_t idx) {
  Scope sc(ctx);
  v8::Local<v8::Value> o = L(ctx, obj);
  if (!o->IsObject()) return JS_UNDEFINED;
  return out(ctx, o.As<v8::Object>()->Get(C(ctx), idx));
}
extern "C" int JS_SetPropertyUint32(JSContext* ctx, JSValueConst obj, uint32_t idx, JSValue val) {
  int ok = -1;
  {
    Scope sc(ctx);
    v8::Local<v8::Value> o = L(ctx, obj);
    if (o->IsObject()) ok = o.As<v8::Object>()->Set(C(ctx), idx, L(ctx, val)).FromMaybe(false) ? 1 : -1;
  }
  JS_FreeValue(ctx, val);
  return ok;
}
extern "C" int JS_SetPropertyFunctionList(JSContext* ctx, JSValueConst obj, const JSCFunctionListEntry* tab, int len) {
  Scope sc(ctx);
  v8::Local<v8::Value> ov = L(ctx, obj);
  if (!ov->IsObject()) return -1;
  v8::Local<v8::Object> o = ov.As<v8::Object>();
  for (int i = 0; i < len; i++) {
    const JSCFunctionListEntry& e = tab[i];
    if (e.def_type == JS_DEF_CFUNC) {
      FnRec* r = mkfn(0, e.length, 0, e.func, nullptr, nullptr);
      o->DefineOwnProperty(C(ctx), key(ctx, e.name), make_fn(ctx, r, e.name), v8::DontEnum).Check();
    } else {
      v8::Local<v8::Function> g, s;
      if (e.getter) g = make_fn(ctx, mkfn(1, 0, e.magic, nullptr, e.getter, nullptr), e.name);
      if (e.setter) s = make_fn(ctx, mkfn(2, 1, e.magic, nullptr, nullptr, e.setter), e.name);
      o->SetAccessorProperty(key(ctx, e.name), g, s, v8::DontEnum);
    }
  }
  return 0;
}

// ---- functions, scripts, errors ------------------------------------------------------------------------------------
extern "C" JSValue JS_NewCFunction(JSContext* ctx, JSCFunction* func, const char* name, int length) {
  Scope sc(ctx);
  return out(ctx, v8::Local<v8::Value>(make_fn(ctx, mkfn(0, length, 0, func, nullptr, nullptr), name)));
}
static JSValue caught(JSContext* ctx, v8::TryCatch& tc) {
  if (tc.HasCaught()) ctx->pending.Reset(ctx->iso, tc.Exception());
  else ctx->pending.Reset(ctx->iso, v8::Exception::Error(S(ctx->iso, "terminated")));
  return JS_EXCEPTION;
}
extern "C" JSValue JS_Call(JSContext* ctx, JSValueConst func, JSValueConst this_val, int argc, JSValueConst* argv) {
  Scope sc(ctx);
  v8::Local<v8::Value> f = L(ctx, func);
  if (!f->IsFunction()) return JS_ThrowTypeError(ctx, "not a function");
  v8::Local<v8::Value>* a = (v8::Local<v8::Value>*)alloca(sizeof(v8::Local<v8::Value>) * (argc > 0 ? argc : 1));
  for (int i = 0; i < argc; i++) a[i] = L(ctx, argv[i]);
  v8::TryCatch tc(ctx->iso);
  v8::Local<v8::Value> r;
  if (!f.As<v8::Function>()->Call(C(ctx), L(ctx, this_val), argc, a).ToLocal(&r)) return caught(ctx, tc);
  return out(ctx, r);
}
extern "C" JSValue JS_Eval(JSContext* ctx, const char* input, size_t input_len, const char* filename, int) {
  Scope sc(ctx);
  v8::Isolate* iso = ctx->iso;
  v8::TryCatch tc(iso);
  v8::ScriptOrigin origin(S(iso, filename ? filename : "<eval>"));
  v8::Local<v8::Script> script;
  if (!v8::Script::Compile(C(ctx), S(iso, input, (int)input_len), &origin).ToLocal(&script)) return caught(ctx, tc);
  v8::Local<v8::Value> r;
  if (!script->Run(C(ctx)).ToLocal(&r)) return caught(ctx, tc);
  return out(ctx, r);
}
extern "C" JSValue JS_ParseJSON(JSContext* ctx, const char* buf, size_t len, const char*) {
  Scope sc(ctx);
  return out(ctx, v8::JSON::Parse(C(ctx), S(ctx->iso, buf, (int)len)));
}
extern "C" JSValue JS_GetException(JSContext* ctx) {
  if (ctx->pending.IsEmpty()) return JS_UNDEFINED;
  JSValue r;
  r.u.p = new v8::Global<v8::Value>(std::move(ctx->pending));
  r.tag = JS_TAG_V8_GLOBAL;
  return r;
}
static JSValue throw_v(JSContext* ctx, v8::Local<v8::Value> (*mk)(v8::Local<v8::String>, v8::Local<v8::Value>),
                       const char* fmt, va_list ap) {
  char b[512];
  vsnprintf(b, sizeof b, fmt, ap);
  Scope sc(ctx);
  v8::Local<v8::Value> e = mk(S(ctx->iso, b), v8::Local<v8::Value>());
  if (ctx->depth > 0) ctx->iso->ThrowException(e);
  else ctx->pending.Reset(ctx->iso, e);   // no JS on the stack: keep it for JS_GetException
  return JS_EXCEPTION;
}
extern "C" JSValue JS_ThrowRangeError(JSContext* ctx, const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  JSValue r = throw_v(ctx, v8::Exception::RangeError, fmt, ap);
  va_end(ap);
  return r;
}
extern "C" JSValue JS_ThrowTypeError(JSContext* ctx, const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  JSValue r = throw_v(ctx, v8::Exception::TypeError, fmt, ap);
  va_end(ap);
  return r;
}
extern "C" JSValue JS_ThrowSyntaxError(JSContext* ctx, const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  JSValue r = throw_v(ctx, v8::Exception::SyntaxError, fmt, ap);
  va_end(ap);
  return r;
}
extern "C" JSValue JS_ThrowOutOfMemory(JSContext* ctx) { return JS_ThrowRangeError(ctx, "out of memory"); }

// ---- classes -------------------------------------------------------------------------------------------------------
static JSClassID g_next_class;
extern "C" JSClassID JS_NewClassID(JSRuntime*, JSClassID* pid) {
  if (*pid == 0) *pid = ++g_next_class;
  return *pid;
}
static ClassRec& cls(JSRuntime* rt, JSClassID id) {
  if (id >= rt->classes.size()) rt->classes.resize(id + 8);
  return rt->classes[id];
}
extern "C" int JS_NewClass(JSRuntime* rt, JSClassID id, const JSClassDef* def) {
  ClassRec& c = cls(rt, id);
  c.name = def->class_name ? def->class_name : "Object";
  c.fin = def->finalizer;
  c.defined = true;
  c.ctor.Reset();
  return 0;
}
extern "C" void JS_SetClassProto(JSContext* ctx, JSClassID id, JSValue proto) {
  {
    Scope sc(ctx);
    ClassRec& c = cls(ctx->rt, id);
    v8::Local<v8::Value> p = L(ctx, proto);
    if (p->IsObject()) c.proto.Reset(ctx->iso, p.As<v8::Object>());
    c.ctor.Reset();
  }
  JS_FreeValue(ctx, proto);
}
static void weak_cb(const v8::WeakCallbackInfo<ObjRec>& info) {
  ObjRec* o = info.GetParameter();
  o->weak.Reset();
  JSRuntime* rt = g_ctx ? g_ctx->rt : nullptr;
  if (rt) {
    rt->objs.erase(o);
    ClassRec& c = rt->classes[o->cls];
    if (c.fin && o->opaque) {
      JSValue v;
      v.u.p = o;
      v.tag = JS_TAG_FINALIZING;
      c.fin(rt, v);
    }
  }
  delete o;
}
extern "C" JSValue JS_NewObjectClass(JSContext* ctx, JSClassID id) {
  Scope sc(ctx);
  v8::Isolate* iso = ctx->iso;
  ClassRec& c = cls(ctx->rt, id);
  if (c.ctor.IsEmpty()) {
    auto ft = v8::FunctionTemplate::New(iso);
    ft->SetClassName(S(iso, c.name.c_str()));
    ft->InstanceTemplate()->SetInternalFieldCount(1);
    v8::Local<v8::Function> f = ft->GetFunction(C(ctx)).ToLocalChecked();
    if (!c.proto.IsEmpty())
      f->Set(C(ctx), S(iso, "prototype"), v8::Local<v8::Object>::New(iso, c.proto)).Check();
    c.ctor.Reset(iso, f);
  }
  v8::Local<v8::Object> o;
  if (!v8::Local<v8::Function>::New(iso, c.ctor)->NewInstance(C(ctx)).ToLocal(&o)) return JS_EXCEPTION;
  ObjRec* r = new ObjRec{id, nullptr, {}};
  o->SetAlignedPointerInInternalField(0, r, v8::kEmbedderDataTypeTagDefault);
  r->weak.Reset(iso, o);
  r->weak.SetWeak(r, weak_cb, v8::WeakCallbackType::kParameter);
  ctx->rt->objs.insert(r);
  return out(ctx, v8::Local<v8::Value>(o));
}
static ObjRec* rec_of(JSValueConst v) {
  if (v.tag == JS_TAG_FINALIZING) return (ObjRec*)v.u.p;
  ObjRec* r = nullptr;
  test(v, [&](v8::Local<v8::Value> l) {
    if (!l->IsObject()) return false;
    v8::Local<v8::Object> o = l.As<v8::Object>();
    if (o->InternalFieldCount() < 1) return false;
    r = (ObjRec*)o->GetAlignedPointerFromInternalField(0, v8::kEmbedderDataTypeTagDefault);
    return true;
  });
  return r;
}
extern "C" void JS_SetOpaque(JSValueConst obj, void* opaque) {
  if (ObjRec* r = rec_of(obj)) r->opaque = opaque;
}
extern "C" void* JS_GetOpaque(JSValueConst obj, JSClassID id) {
  ObjRec* r = rec_of(obj);
  return r && r->cls == id ? r->opaque : nullptr;
}
extern "C" void* JS_GetOpaque2(JSContext* ctx, JSValueConst obj, JSClassID id) {
  void* p = JS_GetOpaque(obj, id);
  if (!p) {
    const char* n = id < ctx->rt->classes.size() ? ctx->rt->classes[id].name.c_str() : "?";
    JS_ThrowTypeError(ctx, "not a %s", n);
  }
  return p;
}

// ---- binary data ---------------------------------------------------------------------------------------------------
extern "C" uint8_t* JS_GetArrayBuffer(JSContext* ctx, size_t* psize, JSValueConst obj) {
  Scope sc(ctx);
  v8::Local<v8::Value> l = L(ctx, obj);
  if (!l->IsArrayBuffer()) { *psize = 0; return nullptr; }
  v8::Local<v8::ArrayBuffer> ab = l.As<v8::ArrayBuffer>();
  *psize = ab->ByteLength();
  return (uint8_t*)ab->Data();
}
extern "C" JSValue JS_GetTypedArrayBuffer(JSContext* ctx, JSValueConst obj, size_t* poff, size_t* plen, size_t* pbpe) {
  Scope sc(ctx);
  v8::Local<v8::Value> l = L(ctx, obj);
  if (!l->IsArrayBufferView()) return JS_EXCEPTION;
  v8::Local<v8::ArrayBufferView> v = l.As<v8::ArrayBufferView>();
  g_ta_calls++;
  if (!v->HasBuffer()) g_ta_materialized++;
  size_t bpe = 1;
  if (l->IsInt16Array() || l->IsUint16Array()) bpe = 2;
  else if (l->IsInt32Array() || l->IsUint32Array() || l->IsFloat32Array()) bpe = 4;
  else if (l->IsFloat64Array() || l->IsBigInt64Array() || l->IsBigUint64Array()) bpe = 8;
  if (poff) *poff = v->ByteOffset();
  if (plen) *plen = v->ByteLength();
  if (pbpe) *pbpe = bpe;
  return out(ctx, v8::Local<v8::Value>(v->Buffer()));
}
extern "C" JSValue JS_NewArrayBufferCopy(JSContext* ctx, const uint8_t* buf, size_t len) {
  Scope sc(ctx);
  v8::Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(ctx->iso, len);
  if (buf && len) memcpy(ab->Data(), buf, len);
  return out(ctx, v8::Local<v8::Value>(ab));
}
struct ExtBuf {
  JSRuntime* rt;
  JSReallocArrayBufferDataFunc* f;
  void* opaque;
};
static void ext_deleter(void* data, size_t, void* p) {
  ExtBuf* e = (ExtBuf*)p;
  if (e->f) e->f(e->rt, e->opaque, data, 0);
  delete e;
}
extern "C" JSValue JS_NewArrayBuffer(JSContext* ctx, uint8_t* buf, size_t len, size_t, JSReallocArrayBufferDataFunc* f,
                                     void* opaque, bool) {
  Scope sc(ctx);
  ExtBuf* e = new ExtBuf{ctx->rt, f, opaque};
  auto bs = v8::ArrayBuffer::NewBackingStore(buf, len, ext_deleter, e);
  return out(ctx, v8::Local<v8::Value>(v8::ArrayBuffer::New(ctx->iso, std::move(bs))));
}
extern "C" JSValue JS_NewTypedArray(JSContext* ctx, int argc, JSValueConst* argv, JSTypedArrayEnum type) {
  Scope sc(ctx);
  if (argc < 1) return JS_EXCEPTION;
  v8::Local<v8::Value> l = L(ctx, argv[0]);
  if (!l->IsArrayBuffer()) return JS_ThrowTypeError(ctx, "JS_NewTypedArray: not an ArrayBuffer");
  v8::Local<v8::ArrayBuffer> ab = l.As<v8::ArrayBuffer>();
  size_t n = ab->ByteLength();
  if (type == JS_TYPED_ARRAY_INT16) return out(ctx, v8::Local<v8::Value>(v8::Int16Array::New(ab, 0, n / 2)));
  return out(ctx, v8::Local<v8::Value>(v8::Uint8ClampedArray::New(ab, 0, n)));
}

// js_alloc.h: QuickJS's pool allocator has no use under V8
extern "C" const JSMallocFunctions* js_fast_malloc_functions(void) { return nullptr; }

// ---- watchdog: a JS call that does not return (an endless loop in game code) ---------------------------------------------
// Called from another thread. The interrupt runs on the JS thread at its next check: it logs the JS stack (where the loop is),
// then execution is terminated, so the call returns with an exception and the game goes on instead of freezing the console.
static void stuck_interrupt(v8::Isolate* iso, void*) {
  v8::HandleScope hs(iso);
  v8::Local<v8::StackTrace> st = v8::StackTrace::CurrentStackTrace(iso, 12);
  fh_log("watchdog: JS stuck for 10 s, stack:\n");
  for (int i = 0; i < st->GetFrameCount(); i++) {
    v8::Local<v8::StackFrame> f = st->GetFrame(iso, i);
    v8::String::Utf8Value fn(iso, f->GetFunctionName()), sc(iso, f->GetScriptName());
    fh_log("    at %s (%s:%d:%d)\n", *fn && **fn ? *fn : "<anonymous>", *sc ? *sc : "?", f->GetLineNumber(), f->GetColumn());
  }
  iso->TerminateExecution();
}
extern "C" void JS_V8InterruptStuck(void) {
  if (g_iso) g_iso->RequestInterrupt(stuck_interrupt, nullptr);
}
extern "C" void JS_V8ClearTerminate(void) {
  if (g_iso && g_iso->IsExecutionTerminating()) g_iso->CancelTerminateExecution();
}
