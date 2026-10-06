#pragma once
#include "quickjs.h"

/* Builds the WebGL1 context object (all functions and constants) backed by the current GLES2
 * context. width/height become drawingBufferWidth/Height. */
JSValue js_gl_create(JSContext *ctx, int width, int height);
