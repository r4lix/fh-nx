// On-device calibration for the fh-nx spike: runs QuickJS on the Switch against the same
// scripts as spike/*.js and reports time + heap, so the x86 numbers can be scaled honestly.
// Scripts and data live on the SD card in sdmc:/switch/fh-bench/ (see tools/prep_bench.py).
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <switch.h>

#include "quickjs.h"

#define BENCH_DIR "sdmc:/switch/fh-bench"

static FILE *g_log;

static void out(const char *fmt, ...) {
    va_list a;
    va_start(a, fmt);
    vprintf(fmt, a);
    va_end(a);
    fflush(stdout);
    if (g_log) {
        va_start(a, fmt);
        vfprintf(g_log, fmt, a);
        va_end(a);
        fflush(g_log);
    }
}

static JSValue js_print(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    for (int i = 0; i < argc; i++) {
        const char *s = JS_ToCString(ctx, argv[i]);
        out("%s%s", i ? " " : "", s ? s : "?");
        if (s) JS_FreeCString(ctx, s);
    }
    out("\n");
    return JS_UNDEFINED;
}

static JSValue js_load_file(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    FILE *f = fopen(path, "rb");
    JS_FreeCString(ctx, path);
    if (!f) return JS_NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc(n > 0 ? n : 1);
    if (!buf) { fclose(f); return JS_NULL; }
    size_t got = fread(buf, 1, n, f);
    fclose(f);
    JSValue v = JS_NewStringLen(ctx, buf, got);
    free(buf);
    return v;
}

static JSValue js_exit(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    return JS_ThrowInternalError(ctx, "exit() called");
}

static void dump_error(JSContext *ctx) {
    JSValue ex = JS_GetException(ctx);
    const char *s = JS_ToCString(ctx, ex);
    out("EXCEPTION: %s\n", s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    JSValue st = JS_GetPropertyStr(ctx, ex, "stack");
    if (!JS_IsUndefined(st)) {
        const char *ss = JS_ToCString(ctx, st);
        if (ss) { out("%s\n", ss); JS_FreeCString(ctx, ss); }
    }
    JS_FreeValue(ctx, st);
    JS_FreeValue(ctx, ex);
}

static void run_script(const char *name, const char *arg2) {
    char path[256];
    snprintf(path, sizeof path, BENCH_DIR "/%s", name);
    FILE *f = fopen(path, "rb");
    if (!f) { out("missing %s\n", path); return; }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *src = malloc(n + 1);
    fread(src, 1, n, f);
    src[n] = 0;
    fclose(f);

    out("\n===== %s =====\n", name);
    JSRuntime *rt = JS_NewRuntime();
    JS_SetMaxStackSize(rt, 8u << 20);
    JSContext *ctx = JS_NewContext(rt);
    JSValue g = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, g, "print", JS_NewCFunction(ctx, js_print, "print", 1));
    JSValue std = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, std, "loadFile", JS_NewCFunction(ctx, js_load_file, "loadFile", 1));
    JS_SetPropertyStr(ctx, std, "exit", JS_NewCFunction(ctx, js_exit, "exit", 1));
    JS_SetPropertyStr(ctx, g, "std", std);
    JS_SetPropertyStr(ctx, g, "os", JS_NewObject(ctx));
    JSValue args = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, args, 0, JS_NewString(ctx, "qjs"));
    JS_SetPropertyUint32(ctx, args, 1, JS_NewString(ctx, BENCH_DIR "/www"));
    if (arg2) JS_SetPropertyUint32(ctx, args, 2, JS_NewString(ctx, arg2));
    JS_SetPropertyStr(ctx, g, "scriptArgs", args);
    JS_FreeValue(ctx, g);
    static const char prelude[] = "globalThis.console={log:print,info:print,warn:print,error:print,debug:print};";
    JS_FreeValue(ctx, JS_Eval(ctx, prelude, sizeof prelude - 1, "prelude", JS_EVAL_TYPE_GLOBAL));

    u64 t0 = armGetSystemTick();
    JSValue r = JS_Eval(ctx, src, n, name, JS_EVAL_TYPE_GLOBAL);
    u64 t1 = armGetSystemTick();
    if (JS_IsException(r)) dump_error(ctx);
    JS_FreeValue(ctx, r);
    out("script wall time: %.0f ms\n", (double)(t1 - t0) * 1000.0 / armGetSystemTickFreq());

    JSMemoryUsage mu;
    JS_ComputeMemoryUsage(rt, &mu);
    out("heap: %.1f MB allocated in %lld blocks, bytecode %.1f MB\n", mu.malloc_size / 1048576.0,
        (long long)mu.malloc_count, mu.js_func_code_size / 1048576.0);

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    free(src);
}

static volatile int g_done;

static void bench_thread(void *arg) {
    (void)arg;
    run_script("bench_load.js", NULL);
    run_script("bench_db.js", NULL);
    run_script("bench_pixi.js", "300");
    g_done = 1;
}

int main(void) {
    consoleInit(NULL);
    socketInitializeDefault();
    nxlinkStdio();
    padConfigureInput(1, HidNpadStyleSet_NpadStandard);
    PadState pad;
    padInitializeDefault(&pad);

    g_log = fopen(BENCH_DIR "/log.txt", "w");
    out("fh-nx QuickJS bench on Horizon\n");

    u32 hz = 0;
    if (R_SUCCEEDED(clkrstInitialize())) {
        ClkrstSession s;
        if (R_SUCCEEDED(clkrstOpenSession(&s, PcvModuleId_CpuBus, 3))) {
            if (R_SUCCEEDED(clkrstGetClockRate(&s, &hz))) out("CPU clock: %u MHz\n", hz / 1000000);
            clkrstCloseSession(&s);
        }
        clkrstExit();
    }
    if (!hz) out("CPU clock: unknown (clkrst unavailable)\n");
    AppletOperationMode om = appletGetOperationMode();
    out("operation mode: %s\n", om == AppletOperationMode_Handheld ? "handheld" : "docked");
    u64 total = 0, used = 0;
    svcGetInfo(&total, InfoType_TotalMemorySize, CUR_PROCESS_HANDLE, 0);
    svcGetInfo(&used, InfoType_UsedMemorySize, CUR_PROCESS_HANDLE, 0);
    out("process memory: %.0f MB total, %.0f MB used\n", total / 1048576.0, used / 1048576.0);

    // QuickJS recursion needs far more stack than the main thread has.
    Thread th;
    if (R_SUCCEEDED(threadCreate(&th, bench_thread, NULL, NULL, 16u << 20, 0x2C, -2))) {
        threadStart(&th);
        while (!g_done && appletMainLoop()) {       // keep the console refreshing while it runs
            consoleUpdate(NULL);
            svcSleepThread(100000000ULL);
        }
        threadWaitForExit(&th);
        threadClose(&th);
    } else {
        out("threadCreate failed\n");
    }

    svcGetInfo(&used, InfoType_UsedMemorySize, CUR_PROCESS_HANDLE, 0);
    out("\nDONE. process memory now %.0f MB used. Press + to exit.\n", used / 1048576.0);
    if (g_log) fclose(g_log);
    while (appletMainLoop()) {
        padUpdate(&pad);
        if (padGetButtonsDown(&pad) & HidNpadButton_Plus) break;
        consoleUpdate(NULL);
    }
    socketExit();
    consoleExit(NULL);
    return 0;
}
