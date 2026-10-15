/* fh-nx native host: EGL/GLES2 window, QuickJS runtime, WebGL1 + Canvas 2D + file bindings, a browser
 * shim. Runs js/env.js then js/boot.js from sdmc:/switch/fh-nx/ against the game's www/ tree.
 * Everything that touches JS or GL happens on one worker thread (QuickJS wants a big stack, and the
 * GL context must stay on the thread that made it current); the main thread polls the pad. */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <switch.h>

#include "audio_mix.h"
#include "audio_out.h"
#include "js_alloc.h"
#include "js_canvas.h"
#include "js_gl.h"
#include "mods.h"
#include "mods_menu.h"
#include "nx_common.h"
#include "quickjs.h"

#define BASE "sdmc:/switch/fh-nx"
#define WIDTH 1280
#define HEIGHT 720

static FILE *g_log;
static volatile int g_quit;

/* pad state, written by the main thread, read by the worker through nx.pad() */
static volatile u64 g_buttons;
static volatile int g_stick[4];
static volatile int g_touch, g_touch_x, g_touch_y;       /* touch screen, 1280x720 pixels */
static volatile int g_menu_req;                          /* set by the main thread: hold - for 2 s */
static volatile int g_mute;                              /* frames of pad input hidden from the game after the menu closes */
static volatile int g_relaunch;                          /* Apply: start this NRO again so the mods take effect */
static char g_nro[512];

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
static void log_line(const char *s) { say("%s\n", s); }

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

/* ---- the platform half of __nx ------------------------------------------------------------------ */

static JSValue nx_pad(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    u64 b = g_mute > 0 ? 0 : g_buttons;
    JSValue a = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, (double)(b & 0xffffffffu)));
    JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, (double)(b >> 32)));
    for (int i = 0; i < 4; i++) JS_SetPropertyUint32(ctx, a, 2 + i, JS_NewInt32(ctx, g_mute > 0 ? 0 : g_stick[i]));
    return a;
}

static JSRuntime *s_rt;

/* nx.openMenu(): open the mods menu from script (also how tests reach it without a 2 s hold) */
static JSValue nx_open_menu(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    g_menu_req = 1;
    return JS_UNDEFINED;
}

/* nx.gc(): run one full collection and return its duration in ms (device-side probe). */
static JSValue nx_gc(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    u64 t0 = armGetSystemTick();
    JS_RunGC(s_rt);
    u64 t1 = armGetSystemTick();
    return JS_NewFloat64(ctx, (double)(t1 - t0) * 1000.0 / (double)armGetSystemTickFreq());
}

/* nx.mem(): [malloc_size bytes, object count] */
static JSValue nx_mem(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    JSMemoryUsage u;
    JS_ComputeMemoryUsage(s_rt, &u);
    JSValue a = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, (double)u.malloc_size));
    JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, (double)u.obj_count));
    return a;
}

static int run_file(JSContext *ctx, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { say("missing %s\n", path); return 0; }
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

/* ---- worker ------------------------------------------------------------------------------------- */

/* One run of the game: a fresh QuickJS runtime booting MV. Returns 1 when the mods menu asked for a restart (Apply),
 * so the same process starts the game again with the new mod set; 0 when the app should exit. */
static int run_session(void) {
    int restart = 0;
    JSRuntime *rt = JS_NewRuntime2(js_fast_malloc_functions(), NULL);       /* pool allocator: see js_alloc.h */
    JS_SetMaxStackSize(rt, 8u << 20);
    s_rt = rt;
    JSContext *ctx = JS_NewContext(rt);

    JSValue g = JS_GetGlobalObject(ctx);
    JSValue nx = JS_NewObject(ctx);
    nx_common_init(ctx, nx, BASE "/www", log_line);
    JS_SetPropertyStr(ctx, nx, "saveDir", JS_NewString(ctx, BASE "/save"));
    JS_SetPropertyStr(ctx, nx, "pad", JS_NewCFunction(ctx, nx_pad, "pad", 0));
    JS_SetPropertyStr(ctx, nx, "openMenu", JS_NewCFunction(ctx, nx_open_menu, "openMenu", 0));
    JS_SetPropertyStr(ctx, nx, "gc", JS_NewCFunction(ctx, nx_gc, "gc", 0));
    JS_SetPropertyStr(ctx, nx, "mem", JS_NewCFunction(ctx, nx_mem, "mem", 0));
    JS_SetPropertyStr(ctx, nx, "width", JS_NewInt32(ctx, WIDTH));
    JS_SetPropertyStr(ctx, nx, "height", JS_NewInt32(ctx, HEIGHT));
    JS_SetPropertyStr(ctx, nx, "gl", js_gl_create(ctx, WIDTH, HEIGHT));
    js_canvas_init(ctx, nx);
    js_audio_init(ctx, nx);
    say("mods: %d found\n", mods_init(BASE "/www", BASE "/mods", BASE "/mods.ini"));
    mods_js_init(ctx, nx);
    {
        int arc = audio_out_start();
        say("audio out: %s (rc=0x%x)\n", arc == 0 ? "started" : "FAILED", (unsigned)arc);
    }
    JS_SetPropertyStr(ctx, g, "__nx", nx);

    const char *entry = BASE "/js/boot.js";
    int ok = run_file(ctx, BASE "/js/env.js") && run_file(ctx, entry);
    JSValue tick = JS_GetPropertyStr(ctx, g, "__tick");
    int errors = 0;
    u64 frames = 0, t_js = 0, t_swap = 0;
    u64 t0 = armGetSystemTick();
    int menu_ok = menu_init(BASE "/www/fonts/Eczar-Regular.ttf", "Fear & Hunger"), menu_open = 0;
    say("mods menu: %s\n", menu_ok ? "ready (hold - for 2 s)" : "unavailable");

    while (ok && !g_quit) {
        u64 a = armGetSystemTick();
        if (g_menu_req && menu_ok && !menu_open) { menu_open = 1; g_menu_req = 0; menu_reset_focus(); }
        if (menu_open) {
            /* the menu owns the screen: the game is not ticked while it is open */
            MenuInput in = {g_buttons, g_stick[0], g_stick[1], g_touch, g_touch_x, g_touch_y, NULL};
            int r = menu_frame(&in);
            eglSwapBuffers(s_display, s_surface);
            if (r == MENU_APPLIED) { restart = 1; break; }
            else if (r == MENU_CLOSED) {
                menu_release_gl();
                menu_open = 0;
                g_mute = 20;                                  /* the closing press must not reach the game */
                JSValue f = JS_GetPropertyStr(ctx, g, "__menuClosed");
                if (JS_IsFunction(ctx, f)) { JSValue rr = JS_Call(ctx, f, JS_UNDEFINED, 0, NULL); JS_FreeValue(ctx, rr); }
                JS_FreeValue(ctx, f);
            }
            u64 spent = armGetSystemTick() - a, budget = armGetSystemTickFreq() / 60;
            if (spent < budget) svcSleepThread(armTicksToNs(budget - spent));
            continue;
        }
        if (g_mute > 0) g_mute--;
        JSValue arg = JS_NewFloat64(ctx, (double)armTicksToNs(a) / 1e6);
        JSValue r = JS_Call(ctx, tick, JS_UNDEFINED, 1, &arg);
        JS_FreeValue(ctx, arg);
        if (JS_IsException(r)) {
            nx_dump_exception(ctx);
            if (++errors >= 50) { say("too many JS errors, stopping\n"); break; }
        }
        JS_FreeValue(ctx, r);
        JSContext *pc;
        while (JS_ExecutePendingJob(rt, &pc) > 0) {}
        t_js += armGetSystemTick() - a;

        u64 sw0 = armGetSystemTick();
        eglSwapBuffers(s_display, s_surface);
        t_swap += armGetSystemTick() - sw0;
        /* A swap with nothing new drawn returns at once (MV skips frames), which would spin the loop at
         * 120 ticks/s. The game logic is a fixed 60 Hz, so never tick faster than that. */
        u64 spent = armGetSystemTick() - a, budget = armGetSystemTickFreq() / 60;
        if (spent < budget) svcSleepThread(armTicksToNs(budget - spent));
        if (++frames % 300 == 0) {
            double secs = (double)(armGetSystemTick() - t0) / armGetSystemTickFreq();
            JsGlStats gs;
            js_gl_stats(&gs, 1);
            double ms = 1000.0 / armGetSystemTickFreq() / 300;           /* ticks -> ms per frame over the 300-frame window */
            say("[host] %llu frames, %.1f fps, JS+GL %.2f ms/frame (swap wait %.2f; GL: upload %.2f [%.1f/frame, %.2f MB/frame], draw %.2f [%.0f/frame], buffer %.2f), audio played %.1f s\n",
                (unsigned long long)frames, frames / secs, (double)t_js * ms, (double)t_swap * ms, (double)gs.upload_ticks * ms,
                gs.upload_n / 300.0, gs.upload_bytes / 300.0 / 1048576.0, (double)gs.draw_ticks * ms, gs.draw_n / 300.0,
                (double)gs.buffer_ticks * ms, audio_out_played() / 48000.0);
            t_js = 0; t_swap = 0; t0 = armGetSystemTick(); frames = 0;
        }
    }

    audio_out_stop();
    audio_shutdown();
    JS_FreeValue(ctx, tick);
    JS_FreeValue(ctx, g);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    js_gl_release_all();
    return restart;
}

static void worker(void *arg) {
    (void)arg;
    if (!egl_start()) { g_quit = 1; return; }
    while (!g_quit && run_session()) say("restarting the game with the new mod set\n");
    egl_stop();
    g_quit = 1;
}

int main(int argc, char **argv) {
    g_log = fopen(BASE "/log.txt", "w");
    say("fh-nx host\n");
    snprintf(g_nro, sizeof g_nro, "%s", argc > 0 && argv[0] ? argv[0] : BASE "/../fh-nx.nro");
    padConfigureInput(1, HidNpadStyleSet_NpadStandard);
    PadState pad;
    padInitializeDefault(&pad);
    hidInitializeTouchScreen();
    u64 minus_since = 0;

    Thread th;
    if (R_FAILED(threadCreate(&th, worker, NULL, NULL, 16u << 20, 0x2C, -2))) {
        say("threadCreate failed\n");
        return 1;
    }
    threadStart(&th);
    while (appletMainLoop() && !g_quit) {
        padUpdate(&pad);
        u64 held = padGetButtons(&pad);
        g_buttons = held;
        HidAnalogStickState l = padGetStickPos(&pad, 0), r = padGetStickPos(&pad, 1);
        g_stick[0] = l.x; g_stick[1] = l.y; g_stick[2] = r.x; g_stick[3] = r.y;
        HidTouchScreenState ts = {0};
        if (hidGetTouchScreenStates(&ts, 1) && ts.count > 0) { g_touch = 1; g_touch_x = (int)ts.touches[0].x; g_touch_y = (int)ts.touches[0].y; }
        else g_touch = 0;
        if (held & HidNpadButton_Minus) {                                   /* hold - for 2 s: the mods menu */
            u64 now = armGetSystemTick();
            if (!minus_since) minus_since = now;
            else if (now - minus_since > 2 * armGetSystemTickFreq()) { g_menu_req = 1; minus_since = 0; }
        } else minus_since = 0;
        if (padGetButtonsDown(&pad) & HidNpadButton_Plus) g_quit = 1;       /* dev: + quits */
        svcSleepThread(4000000ULL);
    }
    g_quit = 1;
    threadWaitForExit(&th);
    threadClose(&th);
    if (g_log) fclose(g_log);
    return 0;
}
