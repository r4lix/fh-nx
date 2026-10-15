#pragma once
#include "quickjs.h"

/* Builds the WebGL1 context object (all functions and constants) backed by the current GLES2
 * context. width/height become drawingBufferWidth/Height. */
/* Delete every GL object the game still holds and reset the layer's state (soft restart). */
void js_gl_release_all(void);
JSValue js_gl_create(JSContext *ctx, int width, int height);

/* Per-frame GL call cost, for the host's stats line: ticks spent inside texture uploads, draws and buffer
 * uploads since the last reset, and how many of each ran. */
typedef struct { unsigned long long upload_ticks, draw_ticks, buffer_ticks; unsigned upload_n, draw_n, buffer_n; unsigned long long upload_bytes; } JsGlStats;
void js_gl_stats(JsGlStats *out, int reset);
