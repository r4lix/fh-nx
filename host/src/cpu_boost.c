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
static int s_in_focus = 1;
static int s_applied;          /* an override / rate is currently set by us */
static Mutex s_lock;
static AppletHookCookie s_hook;

int cpu_boost_read_setting(const char *ini_path) {
    FILE *f = fopen(ini_path, "r");
    if (!f) return CPU_BOOST_DEFAULT_MHZ;
    char line[128];
    int mhz = CPU_BOOST_DEFAULT_MHZ;
    while (fgets(line, sizeof line, f)) {
        if (strncmp(line, "cpu_mhz=", 8) == 0) { mhz = atoi(line + 8); break; }
    }
    fclose(f);
    return mhz < 0 ? 0 : mhz;
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
    s_target_mhz = mhz;
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
    fh_log("cpu: %s, setting %d MHz\n", s_mgr ? s_mgr : "clkrst (no clock manager running)", mhz);
    appletHook(&s_hook, on_applet, NULL);
    mutexLock(&s_lock);
    apply_locked();
    mutexUnlock(&s_lock);
}

void cpu_boost_set(int mhz) {
    mutexLock(&s_lock);
    s_target_mhz = mhz < 0 ? 0 : mhz;
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
