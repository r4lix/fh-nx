#include "cpu_boost.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <switch.h>

extern void fh_log(const char *fmt, ...);   /* main.c: log.txt + nxlink */

/* With a clock manager running (Horizon OC's hoc:clk, sys-clk's sysclk:ipc) a plain clkrst request is accepted and then undone by the
 * manager, which owns the clocks. So the boost goes through the manager's temporary override (command 8 SetOverride, module 0 = CPU),
 * as its own overlay does; 0 Hz removes the override and the manager's profile/stock clock applies again. Without a manager, clkrst. */
static const char *s_mgr;      /* "hoc:clk" / "sysclk:ipc", or NULL */
static ClkrstSession s_sess;
static int s_open;             /* clkrst fallback session */
static u32 s_orig_hz;          /* clkrst fallback: what the console ran at before we touched it */
static int s_target_mhz;       /* 0 = leave the clock alone */
static int s_auto;             /* Auto mode: s_target_mhz follows the load */
static int s_level;            /* Auto: index in k_levels */
static const int k_levels[] = {0, 1224, 1428, 1581, 1785};   /* 0 = the console's own clock (1020 MHz) */
#define N_LEVELS ((int)(sizeof k_levels / sizeof k_levels[0]))
#define STOCK_MHZ 1020
static double s_win_ms, s_win_n, s_win_over, s_calm_ms, s_calm_n, s_calm_over;
static u64 s_win_t0, s_calm_t0, s_last_change;
static int s_in_focus = 1;
static int s_applied;          /* an override / rate is currently set by us */
static Mutex s_lock;
static AppletHookCookie s_hook;

int cpu_boost_read_setting(const char *ini_path) {
    FILE *f = fopen(ini_path, "r");
    if (!f) return CPU_BOOST_DEFAULT_MHZ;
    char line[128];
    int mhz = CPU_BOOST_DEFAULT_MHZ, v2 = 0;
    while (fgets(line, sizeof line, f)) {
        if (strncmp(line, "cpu_mhz=", 8) == 0) mhz = atoi(line + 8);
        else if (strncmp(line, "cpu_v2=", 7) == 0) v2 = 1;
    }
    fclose(f);
    if (!v2 && mhz == 1700) mhz = CPU_BOOST_AUTO;     /* 1700 was the default before Auto existed (SettingsModel.cpp agrees) */
    return mhz < 0 ? CPU_BOOST_AUTO : mhz;
}

static Result mgr_override(u32 hz) {
    Service s;
    Result rc = smGetService(&s, s_mgr);
    if (R_FAILED(rc)) return rc;
    struct { u32 module; u32 hz; } args = { 0, hz };
    rc = serviceDispatchIn(&s, 8, args);
    serviceClose(&s);
    return rc;
}

static void apply_locked(void) {
    int on = s_target_mhz > 0 && s_in_focus;
    u32 want = on ? (u32)s_target_mhz * 1000000u : 0;
    if (s_mgr) {
        if (!on && !s_applied) return;
        Result rc = mgr_override(want);
        s_applied = on && R_SUCCEEDED(rc);
        fh_log("cpu: %s override %u MHz%s (rc 0x%x)\n", s_mgr, want / 1000000u, on ? "" : " (removed)", rc);
    } else if (s_open) {
        if (!on) { if (!s_applied) return; want = s_orig_hz; }
        Result rc = clkrstSetClockRate(&s_sess, want);
        u32 now = 0;
        clkrstGetClockRate(&s_sess, &now);
        s_applied = on && R_SUCCEEDED(rc);
        fh_log("cpu: clkrst asked %u MHz, reports %u MHz (rc 0x%x)\n", want / 1000000u, now / 1000000u, rc);
    }
}

static void on_applet(AppletHookType hook, void *param) {
    (void)param;
    if (hook != AppletHookType_OnFocusState && hook != AppletHookType_OnResume) return;
    int focus = appletGetFocusState() == AppletFocusState_InFocus;
    mutexLock(&s_lock);
    if (focus != s_in_focus || hook == AppletHookType_OnResume) { s_in_focus = focus; apply_locked(); }
    mutexUnlock(&s_lock);
}

void cpu_boost_init(int mhz) {
    mutexInit(&s_lock);
    s_auto = mhz == CPU_BOOST_AUTO;
    s_level = 0;
    s_target_mhz = s_auto ? 0 : mhz;
    Service s;
    for (int i = 0; i < 2 && !s_mgr; i++) {
        const char *nm = i == 0 ? "hoc:clk" : "sysclk:ipc";
        if (R_SUCCEEDED(smGetService(&s, nm))) { serviceClose(&s); s_mgr = nm; }
    }
    if (!s_mgr) {
        if (R_SUCCEEDED(clkrstInitialize())) {
            if (R_SUCCEEDED(clkrstOpenSession(&s_sess, PcvModuleId_CpuBus, 3))) { s_open = 1; clkrstGetClockRate(&s_sess, &s_orig_hz); }
            else clkrstExit();
        }
        if (!s_open) { fh_log("cpu: no clock manager and no clkrst, clock left alone\n"); return; }
    }
    if (s_auto) fh_log("cpu: %s, auto clock\n", s_mgr ? s_mgr : "clkrst (no clock manager running)");
    else fh_log("cpu: %s, setting %d MHz\n", s_mgr ? s_mgr : "clkrst (no clock manager running)", mhz);
    appletHook(&s_hook, on_applet, NULL);
    mutexLock(&s_lock);
    apply_locked();
    mutexUnlock(&s_lock);
}

void cpu_boost_set(int mhz) {
    mutexLock(&s_lock);
    s_auto = mhz == CPU_BOOST_AUTO;
    if (s_auto) { s_level = 0; s_win_t0 = s_calm_t0 = 0; }
    s_target_mhz = s_auto ? 0 : (mhz < 0 ? 0 : mhz);
    if (s_target_mhz == 0) { int f = s_in_focus; s_in_focus = 0; apply_locked(); s_in_focus = f; }
    else apply_locked();
    mutexUnlock(&s_lock);
}

void cpu_boost_exit(void) {
    if (!s_mgr && !s_open) return;
    appletUnhook(&s_hook);
    mutexLock(&s_lock);
    s_in_focus = 0;
    apply_locked();                          /* override removed / original rate back */
    if (s_open) { clkrstCloseSession(&s_sess); clkrstExit(); s_open = 0; }
    s_mgr = NULL;
    mutexUnlock(&s_lock);
}

/* Auto clock. The game has 16.7 ms per frame. Up one step as soon as it runs short (half a second averaging over 12.5 ms of work,
 * or 3 frames over budget); down one step only after 3 calm seconds in which the lower clock would still leave room (work scaled
 * by the clock ratio under 10 ms on average, at most 2 frames that would miss the budget: a lone GC or load spike does not hold
 * the clock up). At most one step every half second. */
static void set_level_locked(int lv, double ms) {
    if (lv < 0) lv = 0;
    if (lv >= N_LEVELS) lv = N_LEVELS - 1;
    if (lv == s_level) return;
    fh_log("cpu auto: %d -> %d MHz (game %.1f ms/frame)\n", k_levels[s_level] ? k_levels[s_level] : STOCK_MHZ,
           k_levels[lv] ? k_levels[lv] : STOCK_MHZ, ms);
    s_level = lv;
    s_target_mhz = k_levels[lv];
    if (s_target_mhz == 0) { int f = s_in_focus; s_in_focus = 0; apply_locked(); s_in_focus = f; }
    else apply_locked();
}
void cpu_boost_frame(double work_ms) {
    if (!s_auto || (!s_mgr && !s_open)) return;
    u64 now = armGetSystemTick(), f = armGetSystemTickFreq();
    mutexLock(&s_lock);
    if (!s_win_t0) { s_win_t0 = s_calm_t0 = now; s_win_ms = s_win_n = s_win_over = s_calm_ms = s_calm_n = s_calm_over = 0; }
    s_win_ms += work_ms; s_win_n++;
    if (work_ms > 16.7) s_win_over++;
    s_calm_ms += work_ms; s_calm_n++;
    if (s_level > 0) {                                 /* would this frame miss the budget one step lower? */
        double lower = k_levels[s_level - 1] ? k_levels[s_level - 1] : STOCK_MHZ;
        if (work_ms * k_levels[s_level] / lower > 16.0) s_calm_over++;
    }
    int can_step = now - s_last_change > f / 2;
    if (now - s_win_t0 > f / 2) {
        double avg = s_win_ms / s_win_n;
        if (can_step && s_level < N_LEVELS - 1 && (avg > 12.5 || s_win_over >= 3)) {
            set_level_locked(s_level + 1, avg);
            s_last_change = now;
            s_calm_t0 = now; s_calm_ms = s_calm_n = s_calm_over = 0;
        }
        s_win_t0 = now; s_win_ms = s_win_n = s_win_over = 0;
    }
    if (now - s_calm_t0 > 3 * f) {
        if (s_level > 0 && can_step) {
            double cur = k_levels[s_level], lower = k_levels[s_level - 1] ? k_levels[s_level - 1] : STOCK_MHZ, k = cur / lower;
            double avg = s_calm_ms / s_calm_n;
            if (avg * k < 10.0 && s_calm_over <= 2) { set_level_locked(s_level - 1, avg); s_last_change = now; }
        }
        s_calm_t0 = now; s_calm_ms = s_calm_n = s_calm_over = 0;
    }
    mutexUnlock(&s_lock);
}
int cpu_boost_current_mhz(void) {
    int on = s_target_mhz > 0 && s_in_focus && (s_mgr || s_open);
    return on ? s_target_mhz : STOCK_MHZ;
}
int cpu_boost_is_auto(void) { return s_auto; }
