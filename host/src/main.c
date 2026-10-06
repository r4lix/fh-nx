/* fh-nx native host skeleton: EGL/GLES2 window, QuickJS runtime, WebGL1 bindings, a browser shim.
 * Runs js/env.js then js/demo.js from sdmc:/switch/fh-nx/ against the game's www/ tree. Everything
 * that touches JS or GL happens on one worker thread (QuickJS wants a big stack, and the GL context
 * must stay on the thread that made it current); the main thread only watches the pad. */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <switch.h>

#include "js_gl.h"
#include "quickjs.h"

#define BASE "sdmc:/switch/fh-nx"
#define WIDTH 1280
#define HEIGHT 720

static FILE *g_log;
static volatile int g_quit;

static void say(const char *fmt, ...) {
    va_list a;
    va_start(a, fmt);
    vprintf(fmt, a);
    va_end(a);
    if (g_log) {
        va_start(a, fmt);
        vfprintf(g_log, fmt, a);
        va_end(a);
        fflush(g_log);
    }
}

/* ---- EGL ---------------------------------------------------------------------------------------- */

static EGLDisplay s_display;
static EGLContext s_context;
static EGLSurface s_surface;

static int egl_start(void) {
    s_display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (!s_display || !eglInitialize(s_display, NULL, NULL)) { say("eglInitialize failed\n"); return 0; }
    eglBindAPI(EGL_OPENGL_ES_API);
    static const EGLint cfg_attr[] = {EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
                                      EGL_DEPTH_SIZE, 24, EGL_STENCIL_SIZE, 8, EGL_NONE};
    EGLConfig cfg;
    EGLint n = 0;
    if (!eglChooseConfig(s_display, cfg_attr, &cfg, 1, &n) || n < 1) { say("eglChooseConfig failed\n"); return 0; }
    NWindow *win = nwindowGetDefault();
    nwindowSetDimensions(win, WIDTH, HEIGHT);
    s_surface = eglCreateWindowSurface(s_display, cfg, win, NULL);
    if (!s_surface) { say("eglCreateWindowSurface failed\n"); return 0; }
    static const EGLint ctx_attr[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    s_context = eglCreateContext(s_display, cfg, EGL_NO_CONTEXT, ctx_attr);
    if (!s_context) { say("eglCreateContext failed\n"); return 0; }
    eglMakeCurrent(s_display, s_surface, s_surface, s_context);
    eglSwapInterval(s_display, 1);
    say("GL: %s | %s | %s\n", glGetString(GL_VENDOR), glGetString(GL_RENDERER), glGetString(GL_VERSION));
    return 1;
}

static void egl_stop(void) {
    if (!s_display) return;
    eglMakeCurrent(s_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (s_context) eglDestroyContext(s_display, s_context);
    if (s_surface) eglDestroySurface(s_display, s_surface);
    eglTerminate(s_display);
}

/* ---- the __nx object --------------------------------------------------------------------------- */

static char *read_all(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc(n > 0 ? n + 1 : 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, n, f);
    fclose(f);
    buf[got] = 0;
    *len = got;
    return buf;
}

static void dump_exception(JSContext *ctx) {
    JSValue ex = JS_GetException(ctx);
    const char *s = JS_ToCString(ctx, ex);
    say("JS EXCEPTION: %s\n", s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    JSValue st = JS_GetPropertyStr(ctx, ex, "stack");
    if (!JS_IsUndefined(st)) {
        const char *ss = JS_ToCString(ctx, st);
        if (ss) { say("%s\n", ss); JS_FreeCString(ctx, ss); }
    }
    JS_FreeValue(ctx, st);
    JS_FreeValue(ctx, ex);
}

static JSValue nx_log(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *s = argc ? JS_ToCString(ctx, argv[0]) : NULL;
    say("%s\n", s ? s : "");
    if (s) JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}

static JSValue nx_now(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    return JS_NewFloat64(ctx, (double)armTicksToNs(armGetSystemTick()) / 1e6);
}

static JSValue nx_read_file(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *buf = read_all(path, &len);
    JS_FreeCString(ctx, path);
    if (!buf) return JS_NULL;
    JSValue v = JS_NewStringLen(ctx, buf, len);
    free(buf);
    return v;
}

static JSValue nx_read_binary(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *buf = read_all(path, &len);
    JS_FreeCString(ctx, path);
    if (!buf) return JS_NULL;
    JSValue v = JS_NewArrayBufferCopy(ctx, (const uint8_t *)buf, len);
    free(buf);
    return v;
}

static JSValue nx_load_script(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *src = read_all(path, &len);
    if (!src) { say("cannot read %s\n", path); JS_FreeCString(ctx, path); return JS_FALSE; }
    JSValue r = JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_GLOBAL);
    free(src);
    JS_FreeCString(ctx, path);
    if (JS_IsException(r)) { dump_exception(ctx); return JS_FALSE; }
    JS_FreeValue(ctx, r);
    return JS_TRUE;
}

static int run_file(JSContext *ctx, const char *path) {
    size_t len;
    char *src = read_all(path, &len);
    if (!src) { say("missing %s\n", path); return 0; }
    JSValue r = JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_GLOBAL);
    free(src);
    if (JS_IsException(r)) { dump_exception(ctx); return 0; }
    JS_FreeValue(ctx, r);
    return 1;
}

/* ---- worker ------------------------------------------------------------------------------------- */

static void worker(void *arg) {
    (void)arg;
    if (!egl_start()) { g_quit = 1; return; }

    JSRuntime *rt = JS_NewRuntime();
    JS_SetMaxStackSize(rt, 8u << 20);
    JSContext *ctx = JS_NewContext(rt);

    JSValue g = JS_GetGlobalObject(ctx);
    JSValue nx = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, nx, "log", JS_NewCFunction(ctx, nx_log, "log", 1));
    JS_SetPropertyStr(ctx, nx, "now", JS_NewCFunction(ctx, nx_now, "now", 0));
    JS_SetPropertyStr(ctx, nx, "readFile", JS_NewCFunction(ctx, nx_read_file, "readFile", 1));
    JS_SetPropertyStr(ctx, nx, "readBinary", JS_NewCFunction(ctx, nx_read_binary, "readBinary", 1));
    JS_SetPropertyStr(ctx, nx, "loadScript", JS_NewCFunction(ctx, nx_load_script, "loadScript", 1));
    JS_SetPropertyStr(ctx, nx, "root", JS_NewString(ctx, BASE "/www"));
    JS_SetPropertyStr(ctx, nx, "width", JS_NewInt32(ctx, WIDTH));
    JS_SetPropertyStr(ctx, nx, "height", JS_NewInt32(ctx, HEIGHT));
    JS_SetPropertyStr(ctx, nx, "gl", js_gl_create(ctx, WIDTH, HEIGHT));
    JS_SetPropertyStr(ctx, g, "__nx", nx);

    int ok = run_file(ctx, BASE "/js/env.js") && run_file(ctx, BASE "/js/demo.js");
    JSValue tick = JS_GetPropertyStr(ctx, g, "__tick");
    int errors = 0;
    u64 frames = 0, t_js = 0;
    u64 t0 = armGetSystemTick();

    while (ok && !g_quit) {
        u64 a = armGetSystemTick();
        JSValue arg = JS_NewFloat64(ctx, (double)armTicksToNs(a) / 1e6);
        JSValue r = JS_Call(ctx, tick, JS_UNDEFINED, 1, &arg);
        JS_FreeValue(ctx, arg);
        if (JS_IsException(r)) {
            dump_exception(ctx);
            if (++errors >= 5) { say("too many JS errors, stopping\n"); break; }
        }
        JS_FreeValue(ctx, r);
        JSContext *pc;
        while (JS_ExecutePendingJob(rt, &pc) > 0) {}
        t_js += armGetSystemTick() - a;

        eglSwapBuffers(s_display, s_surface);
        if (++frames % 120 == 0) {
            double secs = (double)(armGetSystemTick() - t0) / armGetSystemTickFreq();
            say("[host] %llu frames, %.1f fps, JS+GL %.2f ms/frame\n", (unsigned long long)frames, frames / secs,
                (double)t_js * 1000.0 / armGetSystemTickFreq() / 120);
            t_js = 0; t0 = armGetSystemTick(); frames = 0;
        }
    }

    JS_FreeValue(ctx, tick);
    JS_FreeValue(ctx, g);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    egl_stop();
    g_quit = 1;
}

int main(void) {
    g_log = fopen(BASE "/log.txt", "w");
    say("fh-nx host skeleton\n");
    padConfigureInput(1, HidNpadStyleSet_NpadStandard);
    PadState pad;
    padInitializeDefault(&pad);

    Thread th;
    if (R_FAILED(threadCreate(&th, worker, NULL, NULL, 16u << 20, 0x2C, -2))) {
        say("threadCreate failed\n");
        return 1;
    }
    threadStart(&th);
    while (appletMainLoop() && !g_quit) {
        padUpdate(&pad);
        if (padGetButtonsDown(&pad) & HidNpadButton_Plus) g_quit = 1;
        svcSleepThread(16000000ULL);
    }
    g_quit = 1;
    threadWaitForExit(&th);
    threadClose(&th);
    if (g_log) fclose(g_log);
    return 0;
}
