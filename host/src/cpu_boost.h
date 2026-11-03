/* CPU clock boost through clkrst, as many homebrew do: the clock asked for in settings.ini (cpu_mhz=, default 1700) while the
 * game has focus, the console's own clock back while it is in the background (HOME menu) and when the app exits. The clock service
 * picks the nearest rate the console offers; a clock manager (Horizon OC / sys-clk profile for this title) still overrides it. */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

#define CPU_BOOST_DEFAULT_MHZ 1700

int cpu_boost_read_setting(const char *ini_path);   /* cpu_mhz from the ini, CPU_BOOST_DEFAULT_MHZ when absent; 0 = leave the clock alone */
void cpu_boost_init(int mhz);                        /* opens the clkrst session, remembers the current clock, applies mhz */
void cpu_boost_set(int mhz);                         /* change the target now (the menu); 0 = back to the console's clock */
void cpu_boost_exit(void);                           /* puts the original clock back */

#ifdef __cplusplus
}
#endif
