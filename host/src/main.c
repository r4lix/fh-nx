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
#include "cpu_boost.h"
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
static volatile int g_relaunch;
static volatile u64 g_js_since;                         /* tick count when the current frame's JS started, 0 outside JS */                          /* Apply: start this NRO again so the mods take effect */
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
void fh_log(const char *fmt, ...) {                   /* for the other host modules (cpu_boost.c) */
    char b[512];
    va_list a;
    va_start(a, fmt);
    vsnprintf(b, sizeof b, fmt, a);
    va_end(a);
    say("%s", b);
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

/* nx.quit(): end the app the normal way (MV's SceneManager.exit -> window.close, and scripted test runs): the loops see g_quit,
 * the session ends and main returns, so a launcher (hbmenu, SwitchLink) gets the console back. */
/* nx.restart(): start the game again in a fresh JS runtime, the way the mods menu's Apply does (scripted tests of that path). */
static volatile int g_restart_req;
static int g_session;
static JSValue nx_restart(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    g_restart_req = 1;
    return JS_UNDEFINED;
}

/* nx.showError(text): MV stopped on an error (Graphics.printError). Without a browser nothing would show it and the game would
 * just freeze: the host draws it in a box over the last frame, and + quits. */
static char g_err[900];
static JSValue nx_show_error(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *s = argc ? JS_ToCString(ctx, argv[0]) : NULL;
    if (s && !s[0]) g_err[0] = 0;                    /* "" takes the box away (scripted tests that go on) */
    else if (s) snprintf(g_err, sizeof g_err, "The game stopped because of an error.\n\n%.600s\n\nPress + to quit. log.txt in sdmc:/switch/fh-nx has the details.", s);
    if (s) JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}

static JSValue nx_quit(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    g_quit = 1;
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

/* settings.ini "widescreen=1": the game boots at 1110x624 (boot.js reads nx.widescreen) */
static int read_widescreen(void) {
    FILE *f = fopen(BASE "/settings.ini", "r");
    if (!f) return 0;
    char line[128];
    int on = 0;
    while (fgets(line, sizeof line, f))
        if (strncmp(line, "widescreen=", 11) == 0) on = atoi(line + 11) != 0;
    fclose(f);
    return on;
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

/* ---- the menu's Debug tab ------------------------------------------------------------------------ */

/* Menu opening: ask the game (boot.js __debugMenuState) for its cheat state, map and item lists. */
static void debug_menu_open(JSContext *ctx, JSValueConst g) {
    const char *text = NULL;
    JSValue f = JS_GetPropertyStr(ctx, g, "__debugMenuState");
    JSValue r = JS_UNDEFINED;
    if (JS_IsFunction(ctx, f)) {
        r = JS_Call(ctx, f, JS_UNDEFINED, 0, NULL);
        if (JS_IsException(r)) nx_dump_exception(ctx);
        else if (JS_IsString(r)) text = JS_ToCString(ctx, r);
    }
    menu_set_debug_state(text ? text : "");
    if (text) JS_FreeCString(ctx, text);
    JS_FreeValue(ctx, r);
    JS_FreeValue(ctx, f);
}

/* Menu closed: hand the staged commands to the game (boot.js __debugMenuApply). */
static void debug_menu_close(JSContext *ctx, JSValueConst g) {
    const char *cmds = menu_debug_commands();
    if (!cmds || !cmds[0]) return;
    say("debug menu: %s", cmds);
    JSValue f = JS_GetPropertyStr(ctx, g, "__debugMenuApply");
    if (JS_IsFunction(ctx, f)) {
        JSValue arg = JS_NewString(ctx, cmds);
        JSValue r = JS_Call(ctx, f, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(r)) nx_dump_exception(ctx);
        JS_FreeValue(ctx, r);
        JS_FreeValue(ctx, arg);
    }
    JS_FreeValue(ctx, f);
}

/* ---- performance overlay (System tab) ------------------------------------------------------------ */

typedef struct { u64 t0, frames, js, swap, worst, prev_end; char text[512]; } Overlay;

/* Once a second: the text shown in the corner. boot.js __overlayLine adds the scene and map. */
static void overlay_update(Overlay *o, JSContext *ctx, JSValueConst g, JSRuntime *rt) {
    u64 now = armGetSystemTick(), f = armGetSystemTickFreq();
    if (o->t0 && now - o->t0 < f) return;
    double secs = o->t0 ? (double)(now - o->t0) / f : 1, ms = 1000.0 / f, n = o->frames ? (double)o->frames : 1;
    JSMemoryUsage u;
    JS_ComputeMemoryUsage(rt, &u);
    const char *line = NULL;
    JSValue fn = JS_GetPropertyStr(ctx, g, "__overlayLine"), r = JS_UNDEFINED;
    if (JS_IsFunction(ctx, fn)) {
        r = JS_Call(ctx, fn, JS_UNDEFINED, 0, NULL);
        if (JS_IsString(r)) line = JS_ToCString(ctx, r);
    }
#ifdef FH_V8
    const char *eng = "V8";
#else
    const char *eng = "QuickJS";
#endif
    snprintf(o->text, sizeof o->text,
             "%.0f fps   worst frame %.1f ms\ngame %.1f ms   screen wait %.1f ms\n%s   heap %.0f MB   cpu %d MHz%s%s%s",
             o->t0 ? o->frames / secs : 0.0, (double)o->worst * ms, (double)o->js * ms / n, (double)o->swap * ms / n, eng,
             u.malloc_size / 1048576.0, cpu_boost_current_mhz(), cpu_boost_is_auto() ? " (auto)" : "", line ? "\n" : "",
             line ? line : "");
    if (line) JS_FreeCString(ctx, line);
    JS_FreeValue(ctx, r);
    JS_FreeValue(ctx, fn);
    o->t0 = now; o->frames = o->js = o->swap = o->worst = 0;
}

/* ---- worker ------------------------------------------------------------------------------------- */

/* One run of the game: a fresh QuickJS runtime booting MV. Returns 1 when the mods menu asked for a restart (Apply),
 * so the same process starts the game again with the new mod set; 0 when the app should exit. */
#ifdef FH_V8
/* Launched from the album (applet mode): the V8 build is meant for full memory mode (launch through a game, holding R), where it
 * has its JIT and ~3 GB. In applet mode it would have no JIT and far too little memory for the game, so it says so instead of
 * starting. + quits (the main thread's error-box check). */
static int applet_mode(void) {
    FILE *force = fopen(BASE "/force_applet", "r");      /* testing: behave as if launched from the album */
    if (force) { fclose(force); return 1; }
    AppletType t = appletGetAppletType();
    return t != AppletType_Application && t != AppletType_SystemApplication;
}
static void applet_screen(void) {
    say("applet mode (type %d): asking for a full memory launch\n", (int)appletGetAppletType());
    mods_init(BASE "/www", BASE "/mods", BASE "/mods.ini");
    if (!menu_init(BASE "/www/fonts/Eczar-Regular.ttf", "Fear & Hunger")) return;
    snprintf(g_err, sizeof g_err,
             "Fear & Hunger needs full memory mode.\n\nIt was started from the album, where the game does not have enough memory "
             "to run. Close it, then hold R while starting any game: the homebrew menu opens in full memory mode, and Fear & "
             "Hunger runs at full speed from there.\n\nPress + to quit.");
    while (!g_quit) {
        glClearColor(0.f, 0.f, 0.f, 1.f);
        glClear(GL_COLOR_BUFFER_BIT);
        menu_overlay_ex(g_err, 1);
        eglSwapBuffers(s_display, s_surface);
        svcSleepThread(16000000ULL);
    }
}
#endif

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
    JS_SetPropertyStr(ctx, nx, "quit", JS_NewCFunction(ctx, nx_quit, "quit", 0));
    JS_SetPropertyStr(ctx, nx, "restart", JS_NewCFunction(ctx, nx_restart, "restart", 0));
    JS_SetPropertyStr(ctx, nx, "showError", JS_NewCFunction(ctx, nx_show_error, "showError", 1));
    g_err[0] = 0;
    JS_SetPropertyStr(ctx, nx, "session", JS_NewInt32(ctx, ++g_session));
    JS_SetPropertyStr(ctx, nx, "mem", JS_NewCFunction(ctx, nx_mem, "mem", 0));
#ifdef FH_V8
    JS_SetPropertyStr(ctx, nx, "engine", JS_NewString(ctx, "v8"));
#else
    JS_SetPropertyStr(ctx, nx, "engine", JS_NewString(ctx, "quickjs"));
#endif
    JS_SetPropertyStr(ctx, nx, "widescreen", JS_NewBool(ctx, read_widescreen()));
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
    Overlay ov = {0};
    int menu_ok = menu_init(BASE "/www/fonts/Eczar-Regular.ttf", "Fear & Hunger"), menu_open = 0;
    say("mods menu: %s\n", menu_ok ? "ready (hold - for 2 s)" : "unavailable");

    g_restart_req = 0;
    while (ok && !g_quit) {
        if (g_restart_req) { restart = 1; break; }
        u64 a = armGetSystemTick();
        int snap_now = g_menu_req && menu_ok && !menu_open;      /* run one more game frame, keep it as the menu's backdrop */
        if (snap_now) g_menu_req = 0;
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
                debug_menu_close(ctx, g);
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
        g_js_since = armGetSystemTick();
        JSValue r = JS_Call(ctx, tick, JS_UNDEFINED, 1, &arg);
        g_js_since = 0;
#ifdef FH_V8
        JS_V8ClearTerminate();                                   /* after a watchdog stop: the next frame may run JS again */
#endif
        JS_FreeValue(ctx, arg);
        if (JS_IsException(r)) {
            nx_dump_exception(ctx);
            if (++errors >= 50) { say("too many JS errors, stopping\n"); break; }
        }
        JS_FreeValue(ctx, r);
        JSContext *pc;
        while (JS_ExecutePendingJob(rt, &pc) > 0) {}
        t_js += armGetSystemTick() - a;

        if (snap_now) { menu_snapshot(); debug_menu_open(ctx, g); menu_open = 1; menu_reset_focus(); }
        u64 js_end = armGetSystemTick();
        cpu_boost_frame((double)(js_end - a) * 1000.0 / armGetSystemTickFreq());   /* Auto clock: steps on the game's work time */
        if (g_err[0] && menu_ok) {
            menu_overlay_ex(g_err, 1);
            JSValue f = JS_GetPropertyStr(ctx, g, "__overlayDrawn");
            if (JS_IsFunction(ctx, f)) { JSValue rr = JS_Call(ctx, f, JS_UNDEFINED, 0, NULL); JS_FreeValue(ctx, rr); }
            JS_FreeValue(ctx, f);
        } else if (!snap_now && menu_overlay_on()) {
            overlay_update(&ov, ctx, g, rt);
            menu_overlay(ov.text);
            JSValue f = JS_GetPropertyStr(ctx, g, "__overlayDrawn");    /* the overlay changed GL state behind the game's renderer */
            if (JS_IsFunction(ctx, f)) { JSValue rr = JS_Call(ctx, f, JS_UNDEFINED, 0, NULL); JS_FreeValue(ctx, rr); }
            JS_FreeValue(ctx, f);
        } else ov.t0 = 0;
        u64 sw0 = armGetSystemTick();
        eglSwapBuffers(s_display, s_surface);
        u64 sw1 = armGetSystemTick();
        t_swap += sw1 - sw0;
        ov.frames++;
        ov.js += js_end - a;
        ov.swap += sw1 - sw0;
        if (ov.prev_end && sw1 - ov.prev_end > ov.worst) ov.worst = sw1 - ov.prev_end;
        ov.prev_end = sw1;
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
#ifdef FH_V8
            say("[host] v8: %s\n", JS_V8Stats(rt));
#endif
            t_js = 0; t_swap = 0; t0 = armGetSystemTick(); frames = 0;
        }
    }

    say("session end: audio\n");
    audio_out_stop();
    audio_shutdown();
    say("session end: JS runtime\n");
    JS_FreeValue(ctx, tick);
    JS_FreeValue(ctx, g);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    say("session end: GL\n");
    js_gl_release_all();
    say("session end: done\n");
    return restart;
}

static void worker(void *arg) {
    (void)arg;
    if (!egl_start()) { g_quit = 1; return; }
#ifdef FH_V8
    if (applet_mode()) { applet_screen(); egl_stop(); g_quit = 1; return; }
#endif
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
    cpu_boost_init(cpu_boost_read_setting(BASE "/settings.ini"));   /* before loading: boot and map loads gain too */
    u64 minus_since = 0;
    u64 stuck_seen = 0;                                                  /* watchdog: the JS frame it already reported */

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
        if (g_err[0] && (padGetButtonsDown(&pad) & HidNpadButton_Plus)) g_quit = 1;   /* the error box: + quits */
#ifdef FH_DEV_QUIT
        if (padGetButtonsDown(&pad) & HidNpadButton_Plus) g_quit = 1;       /* dev builds only: + quits (tools/dev_*.sh rely on it) */
#endif
        /* watchdog: one frame of game JS running for 10 s is an endless loop. V8 logs the JS stack and stops that script, so the
         * game goes on; 20 s means it is stuck in native code (logged, nothing more can be done from here). */
        u64 js0 = g_js_since;
        if (js0 && js0 != stuck_seen) {
            u64 el = armGetSystemTick() - js0, f = armGetSystemTickFreq();
            if (el > 10 * f) {
#ifdef FH_V8
                say("watchdog: a frame of game code has run for 10 s, stopping it\n");
                JS_V8InterruptStuck();
#else
                say("watchdog: a frame of game code has run for 10 s\n");
#endif
                stuck_seen = js0;
            }
        } else if (js0 && js0 == stuck_seen && armGetSystemTick() - js0 > 20 * armGetSystemTickFreq()) {
            say("watchdog: still stuck after 20 s (native code, not JS)\n");
            stuck_seen = ~0ULL;
        }
        svcSleepThread(4000000ULL);
    }
    g_quit = 1;
    /* The game thread ends its session (audio, JS runtime, GL) and returns. Should it hang there, the app must still exit: a main
     * thread blocked here stops servicing the applet, and the console then ignores HOME until it is power-cycled. */
    if (R_FAILED(waitSingleHandle(th.handle, 8000000000ULL))) say("exit: game thread did not end within 8 s, leaving without it\n");
    else threadClose(&th);
    cpu_boost_exit();
    if (g_log) fclose(g_log);
    return 0;
}
