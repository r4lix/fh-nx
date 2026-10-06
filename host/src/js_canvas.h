#pragma once
#include "quickjs.h"

/* Canvas 2D for the MV engine: a software rasteriser behind the CanvasRenderingContext2D API
 * subset RPG Maker MV and its plugins use. Adds to the `nx` object:
 *   createSurface(w, h)            -> Surface (RGBA8, straight alpha)
 *   surfaceResize(surface, w, h)   clears to transparent black
 *   surfaceBuffer(surface)         -> ArrayBuffer over the live pixels (what texImage2D uploads)
 *   createContext(surface, canvas) -> CanvasRenderingContext2D
 *   registerFont(family, path)     -> bool
 *   surfaceFromRGBA(ab, w, h)      -> Surface (copy)
 *   decodeImage(bytes)             -> {surface, width, height} | null   (PNG)
 * No libnx or GL dependency: it builds and runs on the host for testing. */
void js_canvas_init(JSContext *ctx, JSValueConst nx);
