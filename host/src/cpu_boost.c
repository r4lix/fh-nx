#include "cpu_boost.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <switch.h>

extern void fh_log(const char *fmt, ...);   /* main.c: log.txt + nxlink */

static ClkrstSession s_sess;
static int s_open;
static u32 s_orig_hz;          /* what the console ran at before we touched it */
static int s_target_mhz;       /* 0 = leave it alone */
static int s_in_focus = 1;
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

static void apply_locked(void) {
    if (!s_open) return;
    u32 want = (s_target_mhz > 0 && s_in_focus) ? (u32)s_target_mhz * 1000000u : s_orig_hz;
    if (!want) return;
    Result rc = clkrstSetClockRate(&s_sess, want);
    u32 now = 0;
    clkrstGetClockRate(&s_sess, &now);
    fh_log("cpu: asked %u MHz, running %u MHz%s (rc 0x%x)\n", want / 1000000u, now / 1000000u,
           want == s_orig_hz ? " (console default)" : "", rc);
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
    if (R_FAILED(clkrstInitialize())) { fh_log("cpu: clkrst unavailable, clock left alone\n"); return; }
    if (R_FAILED(clkrstOpenSession(&s_sess, PcvModuleId_CpuBus, 3))) { clkrstExit(); fh_log("cpu: no CpuBus session\n"); return; }
    s_open = 1;
    clkrstGetClockRate(&s_sess, &s_orig_hz);
    fh_log("cpu: console clock %u MHz, setting %d MHz\n", s_orig_hz / 1000000u, mhz);
    appletHook(&s_hook, on_applet, NULL);
    mutexLock(&s_lock);
    if (mhz > 0) apply_locked();
    mutexUnlock(&s_lock);
}

void cpu_boost_set(int mhz) {
    mutexLock(&s_lock);
    s_target_mhz = mhz < 0 ? 0 : mhz;
    apply_locked();
    mutexUnlock(&s_lock);
}

void cpu_boost_exit(void) {
    if (!s_open) return;
    appletUnhook(&s_hook);
    mutexLock(&s_lock);
    if (s_orig_hz) clkrstSetClockRate(&s_sess, s_orig_hz);
    clkrstCloseSession(&s_sess);
    clkrstExit();
    s_open = 0;
    mutexUnlock(&s_lock);
}
