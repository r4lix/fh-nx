/* CPU clock boost through clkrst, as many homebrew do: the clock asked for in settings.ini (cpu_mhz=, default 1700) while the
 * game has focus, the console's own clock back while it is in the background (HOME menu) and when the app exits. The clock service
 * picks the nearest rate the console offers; a clock manager (Horizon OC / sys-clk profile for this title) still overrides it. */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

#define CPU_BOOST_AUTO (-1)            /* step the clock up only while the game needs it (cpu_boost_frame) */
#define CPU_BOOST_DEFAULT_MHZ CPU_BOOST_AUTO

int cpu_boost_read_setting(const char *ini_path);   /* cpu_mhz from the ini, CPU_BOOST_DEFAULT_MHZ when absent; 0 = leave the clock alone */
void cpu_boost_init(int mhz);                        /* opens the clkrst session, remembers the current clock, applies mhz */
void cpu_boost_set(int mhz);                         /* change the target now (the menu); 0 = back to the console's clock */
void cpu_boost_exit(void);
/* Auto mode: call once per game frame with the time the game worked on it (ms, without waiting for the screen). */
void cpu_boost_frame(double work_ms);
/* What runs now: MHz (the console's own clock reads as 1020) and whether Auto picks it. */
int cpu_boost_current_mhz(void);
int cpu_boost_is_auto(void);                           /* puts the original clock back */

#ifdef __cplusplus
}
#endif
