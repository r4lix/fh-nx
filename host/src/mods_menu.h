/* The in-game mods menu: the Dear ImGui front-end from src/menu drawn straight into the default framebuffer with a small
 * GLES2 renderer, driven by the pad (and the touch screen). It owns the screen while it is open; the game is not ticked. */
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint64_t buttons;         /* HidNpadButton_* held now */
    int stick_lx, stick_ly;   /* left stick, -32767..32767 */
    int touch;                /* 1 while the screen is touched */
    int touch_x, touch_y;     /* in 1280x720 pixels */
    const char *status;       /* right side of the header (fps / clock), may be NULL */
} MenuInput;

enum { MENU_OPEN = 0, MENU_CLOSED = 1, MENU_APPLIED = 2 };

/* GL context must be current. Builds the font texture and shaders; fonts: the TTF at <ttfPath> (falls back to ImGui's). */
int menu_init(const char *ttfPath, const char *title);
/* One frame of the open menu: draws it and returns MENU_OPEN / MENU_CLOSED (B on the top level) / MENU_APPLIED. */
int menu_frame(const MenuInput *in);
/* Put the pad focus on the first control (call when the menu opens). */
void menu_reset_focus(void);
/* Reset the screen state the menu changed so the game's own GL layer can carry on. */
void menu_release_gl(void);

#ifdef __cplusplus
}
#endif
