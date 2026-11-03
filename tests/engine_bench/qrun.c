/* QuickJS-ng host for the engine-neutral game bench (same runtime setup as fh-nx host/src/main.c: pool allocator,
 * 8 MB stack). Usage: qrun <engine-label> <file.js>...  Files run in order as global scripts, then __bench_tick()
 * is called until it returns false, draining pending jobs after each call. QRUN_SYSMALLOC=1 uses libc malloc. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "quickjs.h"
#include "js_alloc.h"

static double real_now(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}
static char *read_all(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *b = malloc(n + 1);
    size_t got = fread(b, 1, n, f);
    fclose(f);
    b[got] = 0;
    *len = got;
    return b;
}
static void dump_exception(JSContext *ctx) {
    JSValue e = JS_GetException(ctx);
    const char *s = JS_ToCString(ctx, e);
    printf("exception: %s\n", s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    if (JS_IsObject(e)) {
        JSValue st = JS_GetPropertyStr(ctx, e, "stack");
        const char *ss = JS_ToCString(ctx, st);
        if (ss) { printf("%s\n", ss); JS_FreeCString(ctx, ss); }
        JS_FreeValue(ctx, st);
    }
    JS_FreeValue(ctx, e);
    fflush(stdout);
}
static JSValue h_print(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *s = JS_ToCString(ctx, argv[0]);
    if (s) { puts(s); fflush(stdout); JS_FreeCString(ctx, s); }
    return JS_UNDEFINED;
}
static JSValue h_now(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) { return JS_NewFloat64(ctx, real_now()); }
static JSValue h_read_text(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *p = JS_ToCString(ctx, argv[0]);
    size_t n;
    char *b = p ? read_all(p, &n) : NULL;
    if (p) JS_FreeCString(ctx, p);
    if (!b) return JS_NULL;
    JSValue r = JS_NewStringLen(ctx, b, n);
    free(b);
    return r;
}
static JSValue h_read_bin(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *p = JS_ToCString(ctx, argv[0]);
    size_t n;
    char *b = p ? read_all(p, &n) : NULL;
    if (p) JS_FreeCString(ctx, p);
    if (!b) return JS_NULL;
    JSValue r = JS_NewArrayBufferCopy(ctx, (const uint8_t *)b, n);
    free(b);
    return r;
}
static JSValue h_read_range(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *p = JS_ToCString(ctx, argv[0]);
    int64_t off = 0, len = 0;
    JS_ToInt64(ctx, &off, argv[1]);
    JS_ToInt64(ctx, &len, argv[2]);
    FILE *f = p ? fopen(p, "rb") : NULL;
    if (p) JS_FreeCString(ctx, p);
    if (!f) return JS_NULL;
    uint8_t *b = malloc(len > 0 ? len : 1);
    fseek(f, (long)off, SEEK_SET);
    size_t got = fread(b, 1, len, f);
    fclose(f);
    JSValue r = JS_NewArrayBufferCopy(ctx, b, got);
    free(b);
    return r;
}
static JSValue h_eval_script(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *p = JS_ToCString(ctx, argv[0]);
    if (!p) return JS_EXCEPTION;
    size_t n;
    char *src = read_all(p, &n);
    if (!src) { JS_FreeCString(ctx, p); return JS_NULL; }
    JSValue r = JS_Eval(ctx, src, n, p, JS_EVAL_TYPE_GLOBAL);
    free(src);
    JS_FreeCString(ctx, p);
    if (JS_IsException(r)) dump_exception(ctx);   /* a script that throws still counts as loaded (nx.loadScript) */
    else JS_FreeValue(ctx, r);
    return JS_TRUE;
}
static JSValue h_gc(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) { JS_RunGC(JS_GetRuntime(ctx)); return JS_UNDEFINED; }
static JSValue h_mem(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    JSMemoryUsage u;
    JS_ComputeMemoryUsage(JS_GetRuntime(ctx), &u);
    char b[64];
    JSValue a = JS_NewArray(ctx);
    snprintf(b, sizeof b, "%lldMB", (long long)(u.malloc_size >> 20));
    JS_SetPropertyUint32(ctx, a, 0, JS_NewString(ctx, b));
    snprintf(b, sizeof b, "%lldobj", (long long)u.obj_count);
    JS_SetPropertyUint32(ctx, a, 1, JS_NewString(ctx, b));
    return a;
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: qrun <label> <file.js>...\n"); return 2; }
    double t0 = real_now();
    JSRuntime *rt = getenv("QRUN_SYSMALLOC") ? JS_NewRuntime() : JS_NewRuntime2(js_fast_malloc_functions(), NULL);
    JS_SetMaxStackSize(rt, 8u << 20);
    JSContext *ctx = JS_NewContext(rt);
    JSValue g = JS_GetGlobalObject(ctx), H = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, H, "engine", JS_NewString(ctx, argv[1]));
    JS_SetPropertyStr(ctx, H, "print", JS_NewCFunction(ctx, h_print, "print", 1));
    JS_SetPropertyStr(ctx, H, "realNow", JS_NewCFunction(ctx, h_now, "realNow", 0));
    JS_SetPropertyStr(ctx, H, "readText", JS_NewCFunction(ctx, h_read_text, "readText", 1));
    JS_SetPropertyStr(ctx, H, "readBin", JS_NewCFunction(ctx, h_read_bin, "readBin", 1));
    JS_SetPropertyStr(ctx, H, "readRange", JS_NewCFunction(ctx, h_read_range, "readRange", 3));
    JS_SetPropertyStr(ctx, H, "evalScript", JS_NewCFunction(ctx, h_eval_script, "evalScript", 1));
    JS_SetPropertyStr(ctx, H, "gc", JS_NewCFunction(ctx, h_gc, "gc", 0));
    JS_SetPropertyStr(ctx, H, "mem", JS_NewCFunction(ctx, h_mem, "mem", 0));
    JS_SetPropertyStr(ctx, g, "H", H);
    for (int i = 2; i < argc; i++) {
        size_t n;
        char *src = read_all(argv[i], &n);
        if (!src) { printf("missing %s\n", argv[i]); return 1; }
        JSValue r = JS_Eval(ctx, src, n, argv[i], JS_EVAL_TYPE_GLOBAL);
        free(src);
        if (JS_IsException(r)) { printf("load error in %s\n", argv[i]); dump_exception(ctx); return 1; }
        JS_FreeValue(ctx, r);
    }
    JSValue tick = JS_GetPropertyStr(ctx, g, "__bench_tick");
    int errors = 0;
    for (;;) {
        JSValue r = JS_Call(ctx, tick, JS_UNDEFINED, 0, NULL);
        int more = 1;
        if (JS_IsException(r)) { dump_exception(ctx); if (++errors >= 30) more = 0; }
        else more = JS_ToBool(ctx, r);
        JS_FreeValue(ctx, r);
        JSContext *pc;
        while (JS_ExecutePendingJob(rt, &pc) > 0) {}
        if (!more) break;
    }
    JSValue done = JS_GetPropertyStr(ctx, g, "__bench_done");
    if (JS_IsFunction(ctx, done)) JS_FreeValue(ctx, JS_Call(ctx, done, JS_UNDEFINED, 0, NULL));
    printf("[host] total %.1f s, %d tick errors\n", (real_now() - t0) / 1000.0, errors);
    return 0;
}
