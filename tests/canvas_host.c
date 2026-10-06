/* Host runner for the Canvas 2D tests: QuickJS + js_canvas.c, no GPU, no libnx.
 *   canvas_host <test.js> <font.ttf> [out dir] */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quickjs.h"
#include "../host/src/js_canvas.h"
#include "../host/src/nx_common.h"
#include "../host/src/audio_mix.h"

static const char *g_outdir = ".";

static JSValue js_print(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    for (int i = 0; i < argc; i++) {
        const char *s = JS_ToCString(ctx, argv[i]);
        printf("%s%s", i ? " " : "", s ? s : "?");
        if (s) JS_FreeCString(ctx, s);
    }
    printf("\n");
    return JS_UNDEFINED;
}

/* writePPM(name, rgbaBuffer, w, h): flattens straight-alpha RGBA onto a checkerboard so
 * transparency is visible. */
static JSValue js_write_ppm(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *name = JS_ToCString(ctx, argv[0]);
    size_t len;
    uint8_t *px = JS_GetArrayBuffer(ctx, &len, argv[1]);
    int w, h;
    JS_ToInt32(ctx, &w, argv[2]);
    JS_ToInt32(ctx, &h, argv[3]);
    char path[512];
    snprintf(path, sizeof path, "%s/%s", g_outdir, name);
    FILE *f = fopen(path, "wb");
    if (f && px) {
        fprintf(f, "P6\n%d %d\n255\n", w, h);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) {
                const uint8_t *p = px + ((size_t)y * w + x) * 4;
                int bg = (((x >> 3) + (y >> 3)) & 1) ? 200 : 140;
                for (int c = 0; c < 3; c++) fputc((p[c] * p[3] + bg * (255 - p[3])) / 255, f);
            }
        fclose(f);
    }
    JS_FreeCString(ctx, name);
    return JS_UNDEFINED;
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: canvas_host test.js font.ttf [outdir]\n"); return 2; }
    if (argc > 3) g_outdir = argv[3];
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    JSValue g = JS_GetGlobalObject(ctx), nx = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, g, "print", JS_NewCFunction(ctx, js_print, "print", 1));
    JS_SetPropertyStr(ctx, nx, "writePPM", JS_NewCFunction(ctx, js_write_ppm, "writePPM", 4));
    JS_SetPropertyStr(ctx, nx, "fontPath", JS_NewString(ctx, argv[2]));
    nx_common_init(ctx, nx, ".", NULL);
    js_canvas_init(ctx, nx);
    js_audio_init(ctx, nx);
    JS_SetPropertyStr(ctx, g, "__nx", nx);
    FILE *f = fopen(argv[1], "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    char *src = malloc(n + 1); fread(src, 1, n, f); src[n] = 0; fclose(f);
    JSValue r = JS_Eval(ctx, src, n, argv[1], JS_EVAL_TYPE_GLOBAL);
    int rc = 0;
    if (JS_IsException(r)) {
        JSValue ex = JS_GetException(ctx);
        const char *s = JS_ToCString(ctx, ex);
        printf("EXCEPTION: %s\n", s);
        JSValue st = JS_GetPropertyStr(ctx, ex, "stack");
        const char *ss = JS_ToCString(ctx, st);
        if (ss) printf("%s\n", ss);
        rc = 1;
    }
    JSValue fails = JS_GetPropertyStr(ctx, g, "__failures");
    int nf = 0;
    JS_ToInt32(ctx, &nf, fails);
    return rc || nf ? 1 : 0;
}
