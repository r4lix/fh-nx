/* Runs the real boot (host/js/env.js + boot.js) on the PC against a fake GL, to find missing browser
 * APIs and exceptions without a device round trip.
 *   boot_host <www dir> <fh-nx repo dir> <seconds> [save dir] */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "quickjs.h"
#include "../host/src/js_canvas.h"
#include "../host/src/nx_common.h"
#include "../host/src/audio_mix.h"
#include "../host/src/js_alloc.h"

static void log_line(const char *s) { printf("%s\n", s); fflush(stdout); }

static int run_file(JSContext *ctx, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { printf("missing %s\n", path); return 0; }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *src = malloc(n + 1);
    size_t got = fread(src, 1, n, f);
    src[got] = 0;
    fclose(f);
    JSValue r = JS_Eval(ctx, src, got, path, JS_EVAL_TYPE_GLOBAL);
    free(src);
    if (JS_IsException(r)) { nx_dump_exception(ctx); return 0; }
    JS_FreeValue(ctx, r);
    return 1;
}

int main(int argc, char **argv) {
    if (argc < 4) { fprintf(stderr, "usage: boot_host <www> <repo> <seconds> [save dir] [extra.js]\n"); return 2; }
    const char *www = argv[1], *repo = argv[2];
    double seconds = atof(argv[3]);
    const char *save = argc > 4 ? argv[4] : "build/save";

    JSRuntime *rt = getenv("FH_DEFAULT_ALLOC") ? JS_NewRuntime() : JS_NewRuntime2(js_fast_malloc_functions(), NULL);   /* FH_DEFAULT_ALLOC=1 for A/B */
    JS_SetMaxStackSize(rt, 8u << 20);
    JSContext *ctx = JS_NewContext(rt);
    JSValue g = JS_GetGlobalObject(ctx), nx = JS_NewObject(ctx);
    nx_common_init(ctx, nx, www, log_line);
    JS_SetPropertyStr(ctx, nx, "saveDir", JS_NewString(ctx, save));
    JS_SetPropertyStr(ctx, nx, "width", JS_NewInt32(ctx, 1280));
    JS_SetPropertyStr(ctx, nx, "height", JS_NewInt32(ctx, 720));
    js_canvas_init(ctx, nx);
    js_audio_init(ctx, nx);
    JS_SetPropertyStr(ctx, g, "__nx", nx);

    char path[1024];
    snprintf(path, sizeof path, "%s/tests/fakegl.js", repo);
    if (!run_file(ctx, path)) return 1;
    JSValue gl = JS_Eval(ctx, "makeFakeGL(1280, 720)", 21, "<gl>", JS_EVAL_TYPE_GLOBAL);
    JS_SetPropertyStr(ctx, nx, "gl", gl);
    snprintf(path, sizeof path, "%s/host/js/env.js", repo);
    if (!run_file(ctx, path)) return 1;
    snprintf(path, sizeof path, "%s/host/js/boot.js", repo);
    if (!run_file(ctx, path)) return 1;

    if (argc > 5) {                                  /* optional extra script: profiling hooks, scripted input */
        if (!run_file(ctx, argv[5])) return 1;
    }
    JSValue tick = JS_GetPropertyStr(ctx, g, "__tick");
    struct timespec t0, now;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    long frames = 0;
    int errors = 0;
    for (;;) {
        clock_gettime(CLOCK_MONOTONIC, &now);
        double el = (now.tv_sec - t0.tv_sec) + (now.tv_nsec - t0.tv_nsec) / 1e9;
        if (el > seconds) break;
        JSValue arg = JS_NewFloat64(ctx, now.tv_sec * 1000.0 + now.tv_nsec / 1e6);
        JSValue r = JS_Call(ctx, tick, JS_UNDEFINED, 1, &arg);
        JS_FreeValue(ctx, arg);
        if (JS_IsException(r)) { nx_dump_exception(ctx); if (++errors > 30) { printf("too many errors\n"); break; } }
        JS_FreeValue(ctx, r);
        JSContext *pc;
        while (JS_ExecutePendingJob(rt, &pc) > 0) {}
        frames++;
        struct timespec ts = {0, 16000000};
        nanosleep(&ts, NULL);
    }
    JSValue calls = JS_Eval(ctx, "JSON.stringify(__nx.gl.__calls)", 31, "<calls>", JS_EVAL_TYPE_GLOBAL);
    const char *cs = JS_ToCString(ctx, calls);
    printf("[harness] %ld ticks, GL calls %s, %d tick errors\n", frames, cs ? cs : "?", errors);
    return errors ? 1 : 0;
}
