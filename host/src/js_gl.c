/* WebGL 1 on QuickJS, backed directly by GLES2. PIXI 4.5.4 (and pixi-tilemap/-picture) use about
 * 60 entry points, all core GLES 2.0; this binds those plus the obvious neighbours. The WebGL
 * object types (texture, buffer, ...) are one JS class holding the GL name; uniform locations are
 * the same class holding location+1 so that "not found" (-1) stays distinguishable from 0.
 *
 * Two WebGL behaviours GLES2 lacks are done here in software at upload time: UNPACK_FLIP_Y_WEBGL
 * and UNPACK_PREMULTIPLY_ALPHA_WEBGL. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <GLES2/gl2.h>

#include "js_gl.h"

#define UNPACK_FLIP_Y 0x9240
#define UNPACK_PREMULTIPLY 0x9241
#define UNPACK_COLORSPACE 0x9243

static JSClassID gl_obj_class;
static int g_flip_y, g_premultiply;

/* The game renders at its own logical size (816x624 for stock MV); the screen is 1280x720. While the
 * default framebuffer is bound, viewport and scissor are scaled to fit the logical size into the
 * screen with black bars, instead of the browser's CSS stretch. Off-screen targets are untouched. */
static int g_fb0 = 1, g_screen_w = 1280, g_screen_h = 720, g_log_w, g_log_h;
static int g_vp0[4], g_sc0[4], g_vp0_set, g_sc0_set;      /* what the game last asked for on the default framebuffer */
static void map_rect(int *x, int *y, int *w, int *h) {
    if (g_log_w <= 0 || g_log_h <= 0) return;
    double s = (double)g_screen_w / g_log_w, sy = (double)g_screen_h / g_log_h;
    if (sy < s) s = sy;
    double ox = (g_screen_w - g_log_w * s) / 2, oy = (g_screen_h - g_log_h * s) / 2;
    *x = (int)(ox + *x * s + 0.5);
    *y = (int)(oy + *y * s + 0.5);
    *w = (int)(*w * s + 0.5);
    *h = (int)(*h * s + 0.5);
}
/* The game may set its viewport before the screen's logical size is final, so the request is kept and
 * re-mapped whenever the size changes or the default framebuffer is bound again. */
static void apply_fb0(void) {
    if (!g_fb0) return;
    if (g_vp0_set) { int r[4] = {g_vp0[0], g_vp0[1], g_vp0[2], g_vp0[3]}; map_rect(&r[0], &r[1], &r[2], &r[3]); glViewport(r[0], r[1], r[2], r[3]); }
    if (g_sc0_set) { int r[4] = {g_sc0[0], g_sc0[1], g_sc0[2], g_sc0[3]}; map_rect(&r[0], &r[1], &r[2], &r[3]); glScissor(r[0], r[1], r[2], r[3]); }
}

static const struct { const char *name; int value; } k_consts[] = {
#include "gl_consts.inc"
};

/* ---- argument helpers ------------------------------------------------------------------------- */

static int arg_i(JSContext *ctx, JSValueConst *argv, int i) {
    int32_t v = 0;
    JS_ToInt32(ctx, &v, argv[i]);
    return v;
}
static uint32_t arg_u(JSContext *ctx, JSValueConst *argv, int i) {
    uint32_t v = 0;
    JS_ToUint32(ctx, &v, argv[i]);
    return v;
}
static float arg_f(JSContext *ctx, JSValueConst *argv, int i) {
    double v = 0;
    JS_ToFloat64(ctx, &v, argv[i]);
    return (float)v;
}

static JSValue make_obj(JSContext *ctx, uintptr_t id) {
    JSValue o = JS_NewObjectClass(ctx, gl_obj_class);
    JS_SetOpaque(o, (void *)id);
    return o;
}
static uintptr_t obj_id(JSValueConst v) {
    return JS_IsObject(v) ? (uintptr_t)JS_GetOpaque(v, gl_obj_class) : 0;
}
static GLuint arg_obj(JSValueConst *argv, int i) { return (GLuint)obj_id(argv[i]); }

/* Bytes behind a typed array or ArrayBuffer. NULL if it is neither. */
static const uint8_t *view_bytes(JSContext *ctx, JSValueConst v, size_t *len) {
    size_t off = 0, blen = 0, bpe = 0;
    if (!JS_IsObject(v)) return NULL;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, v, &off, &blen, &bpe);
    if (!JS_IsException(ab)) {
        size_t sz;
        uint8_t *p = JS_GetArrayBuffer(ctx, &sz, ab);
        JS_FreeValue(ctx, ab);
        if (!p) return NULL;
        *len = blen;
        return p + off;
    }
    JS_FreeValue(ctx, JS_GetException(ctx));
    if (JS_IsArrayBuffer(v)) {
        size_t sz;
        uint8_t *p = JS_GetArrayBuffer(ctx, &sz, v);
        *len = sz;
        return p;
    }
    return NULL;
}

/* A float (or int) list from a typed array, or a plain JS array copied into tmp. */
static int get_floats(JSContext *ctx, JSValueConst v, float *tmp, int cap, const float **out) {
    size_t len;
    const uint8_t *p = view_bytes(ctx, v, &len);
    if (p) { *out = (const float *)p; return (int)(len / 4); }
    if (!JS_IsArray(v)) return 0;
    JSValue lv = JS_GetPropertyStr(ctx, v, "length");
    uint32_t n = 0;
    JS_ToUint32(ctx, &n, lv);
    JS_FreeValue(ctx, lv);
    if ((int)n > cap) n = cap;
    for (uint32_t i = 0; i < n; i++) {
        JSValue e = JS_GetPropertyUint32(ctx, v, i);
        double d = 0;
        JS_ToFloat64(ctx, &d, e);
        JS_FreeValue(ctx, e);
        tmp[i] = (float)d;
    }
    *out = tmp;
    return (int)n;
}
static int get_ints(JSContext *ctx, JSValueConst v, int32_t *tmp, int cap, const int32_t **out) {
    size_t len;
    const uint8_t *p = view_bytes(ctx, v, &len);
    if (p) { *out = (const int32_t *)p; return (int)(len / 4); }
    if (!JS_IsArray(v)) return 0;
    JSValue lv = JS_GetPropertyStr(ctx, v, "length");
    uint32_t n = 0;
    JS_ToUint32(ctx, &n, lv);
    JS_FreeValue(ctx, lv);
    if ((int)n > cap) n = cap;
    for (uint32_t i = 0; i < n; i++) {
        JSValue e = JS_GetPropertyUint32(ctx, v, i);
        int32_t d = 0;
        JS_ToInt32(ctx, &d, e);
        JS_FreeValue(ctx, e);
        tmp[i] = d;
    }
    *out = tmp;
    return (int)n;
}

#define FN(name) static JSValue gl_##name(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
#define I(n) arg_i(ctx, argv, n)
#define U(n) arg_u(ctx, argv, n)
#define F(n) arg_f(ctx, argv, n)
#define O(n) arg_obj(argv, n)

/* ---- state / simple calls --------------------------------------------------------------------- */

FN(activeTexture) { glActiveTexture(U(0)); return JS_UNDEFINED; }
FN(blendFunc) { glBlendFunc(U(0), U(1)); return JS_UNDEFINED; }
FN(blendFuncSeparate) { glBlendFuncSeparate(U(0), U(1), U(2), U(3)); return JS_UNDEFINED; }
FN(blendEquation) { glBlendEquation(U(0)); return JS_UNDEFINED; }
FN(clear) { glClear(U(0)); return JS_UNDEFINED; }
FN(clearColor) { glClearColor(F(0), F(1), F(2), F(3)); return JS_UNDEFINED; }
FN(clearStencil) { glClearStencil(I(0)); return JS_UNDEFINED; }
FN(colorMask) { glColorMask(I(0), I(1), I(2), I(3)); return JS_UNDEFINED; }
FN(cullFace) { glCullFace(U(0)); return JS_UNDEFINED; }
FN(depthMask) { glDepthMask(I(0)); return JS_UNDEFINED; }
FN(depthFunc) { glDepthFunc(U(0)); return JS_UNDEFINED; }
FN(disable) { glDisable(U(0)); return JS_UNDEFINED; }
FN(enable) { glEnable(U(0)); return JS_UNDEFINED; }
FN(frontFace) { glFrontFace(U(0)); return JS_UNDEFINED; }
FN(scissor) {
    int x = I(0), y = I(1), w = I(2), h = I(3);
    if (g_fb0) { g_sc0[0] = x; g_sc0[1] = y; g_sc0[2] = w; g_sc0[3] = h; g_sc0_set = 1; apply_fb0(); }
    else glScissor(x, y, w, h);
    return JS_UNDEFINED;
}
FN(stencilFunc) { glStencilFunc(U(0), I(1), U(2)); return JS_UNDEFINED; }
FN(stencilMask) { glStencilMask(U(0)); return JS_UNDEFINED; }
FN(stencilOp) { glStencilOp(U(0), U(1), U(2)); return JS_UNDEFINED; }
FN(viewport) {
    int x = I(0), y = I(1), w = I(2), h = I(3);
    if (g_fb0) { g_vp0[0] = x; g_vp0[1] = y; g_vp0[2] = w; g_vp0[3] = h; g_vp0_set = 1; apply_fb0(); }
    else glViewport(x, y, w, h);
    return JS_UNDEFINED;
}
FN(flush) { glFlush(); return JS_UNDEFINED; }
FN(finish) { glFinish(); return JS_UNDEFINED; }
FN(setLogicalSize) { g_log_w = I(0); g_log_h = I(1); apply_fb0(); return JS_UNDEFINED; }
FN(getError) { return JS_NewInt32(ctx, glGetError()); }
FN(isContextLost) { return JS_FALSE; }
FN(getExtension) { return JS_NULL; }

FN(pixelStorei) {
    uint32_t pname = U(0);
    int v = I(1);
    if (pname == UNPACK_FLIP_Y) g_flip_y = v;
    else if (pname == UNPACK_PREMULTIPLY) g_premultiply = v;
    else if (pname == UNPACK_COLORSPACE) { /* browser default: nothing to do */ }
    else glPixelStorei(pname, v);
    return JS_UNDEFINED;
}

/* ---- objects ---------------------------------------------------------------------------------- */

FN(createBuffer) { GLuint n; glGenBuffers(1, &n); return make_obj(ctx, n); }
FN(createFramebuffer) { GLuint n; glGenFramebuffers(1, &n); return make_obj(ctx, n); }
FN(createRenderbuffer) { GLuint n; glGenRenderbuffers(1, &n); return make_obj(ctx, n); }
FN(createTexture) { GLuint n; glGenTextures(1, &n); return make_obj(ctx, n); }
FN(createProgram) { return make_obj(ctx, glCreateProgram()); }
FN(createShader) { return make_obj(ctx, glCreateShader(U(0))); }
FN(deleteBuffer) { GLuint n = O(0); glDeleteBuffers(1, &n); return JS_UNDEFINED; }
FN(deleteFramebuffer) { GLuint n = O(0); glDeleteFramebuffers(1, &n); return JS_UNDEFINED; }
FN(deleteRenderbuffer) { GLuint n = O(0); glDeleteRenderbuffers(1, &n); return JS_UNDEFINED; }
FN(deleteTexture) { GLuint n = O(0); glDeleteTextures(1, &n); return JS_UNDEFINED; }
FN(deleteProgram) { glDeleteProgram(O(0)); return JS_UNDEFINED; }
FN(deleteShader) { glDeleteShader(O(0)); return JS_UNDEFINED; }
FN(bindBuffer) { glBindBuffer(U(0), O(1)); return JS_UNDEFINED; }
FN(bindFramebuffer) {
    GLuint fb = O(1);
    g_fb0 = fb == 0;
    glBindFramebuffer(U(0), fb);
    if (g_fb0) apply_fb0();
    return JS_UNDEFINED;
}
FN(bindRenderbuffer) { glBindRenderbuffer(U(0), O(1)); return JS_UNDEFINED; }
FN(bindTexture) { glBindTexture(U(0), O(1)); return JS_UNDEFINED; }
FN(framebufferTexture2D) { glFramebufferTexture2D(U(0), U(1), U(2), O(3), I(4)); return JS_UNDEFINED; }
FN(framebufferRenderbuffer) { glFramebufferRenderbuffer(U(0), U(1), U(2), O(3)); return JS_UNDEFINED; }
FN(renderbufferStorage) { glRenderbufferStorage(U(0), U(1), I(2), I(3)); return JS_UNDEFINED; }
FN(checkFramebufferStatus) { return JS_NewInt32(ctx, glCheckFramebufferStatus(U(0))); }
FN(generateMipmap) { glGenerateMipmap(U(0)); return JS_UNDEFINED; }
FN(texParameteri) { glTexParameteri(U(0), U(1), I(2)); return JS_UNDEFINED; }
FN(texParameterf) { glTexParameterf(U(0), U(1), F(2)); return JS_UNDEFINED; }

/* ---- buffers ---------------------------------------------------------------------------------- */

FN(bufferData) {
    uint32_t target = U(0), usage = U(2);
    size_t len;
    const uint8_t *p = view_bytes(ctx, argv[1], &len);
    if (p) glBufferData(target, len, p, usage);
    else glBufferData(target, (GLsizeiptr)I(1), NULL, usage);
    return JS_UNDEFINED;
}
FN(bufferSubData) {
    size_t len;
    const uint8_t *p = view_bytes(ctx, argv[2], &len);
    if (p) glBufferSubData(U(0), I(1), len, p);
    return JS_UNDEFINED;
}
FN(vertexAttribPointer) {
    glVertexAttribPointer(U(0), I(1), U(2), I(3), I(4), (const void *)(uintptr_t)U(5));
    return JS_UNDEFINED;
}
FN(enableVertexAttribArray) { glEnableVertexAttribArray(U(0)); return JS_UNDEFINED; }
FN(disableVertexAttribArray) { glDisableVertexAttribArray(U(0)); return JS_UNDEFINED; }
FN(drawArrays) { glDrawArrays(U(0), I(1), I(2)); return JS_UNDEFINED; }
FN(drawElements) { glDrawElements(U(0), I(1), U(2), (const void *)(uintptr_t)U(3)); return JS_UNDEFINED; }

/* ---- shaders and programs --------------------------------------------------------------------- */

FN(shaderSource) {
    const char *s = JS_ToCString(ctx, argv[1]);
    if (!s) return JS_EXCEPTION;
    glShaderSource(O(0), 1, &s, NULL);
    JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}
FN(compileShader) { glCompileShader(O(0)); return JS_UNDEFINED; }
FN(attachShader) { glAttachShader(O(0), O(1)); return JS_UNDEFINED; }
FN(linkProgram) { glLinkProgram(O(0)); return JS_UNDEFINED; }
FN(useProgram) { glUseProgram(O(0)); return JS_UNDEFINED; }
FN(validateProgram) { glValidateProgram(O(0)); return JS_UNDEFINED; }
FN(bindAttribLocation) {
    const char *s = JS_ToCString(ctx, argv[2]);
    if (!s) return JS_EXCEPTION;
    glBindAttribLocation(O(0), U(1), s);
    JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}
FN(getShaderParameter) {
    GLint v = 0;
    uint32_t p = U(1);
    glGetShaderiv(O(0), p, &v);
    if (p == GL_COMPILE_STATUS || p == GL_DELETE_STATUS) return JS_NewBool(ctx, v != 0);
    return JS_NewInt32(ctx, v);
}
FN(getProgramParameter) {
    GLint v = 0;
    uint32_t p = U(1);
    glGetProgramiv(O(0), p, &v);
    if (p == GL_LINK_STATUS || p == GL_DELETE_STATUS || p == GL_VALIDATE_STATUS) return JS_NewBool(ctx, v != 0);
    return JS_NewInt32(ctx, v);
}
FN(getShaderInfoLog) {
    char buf[2048];
    GLsizei n = 0;
    glGetShaderInfoLog(O(0), sizeof buf - 1, &n, buf);
    return JS_NewStringLen(ctx, buf, n);
}
FN(getProgramInfoLog) {
    char buf[2048];
    GLsizei n = 0;
    glGetProgramInfoLog(O(0), sizeof buf - 1, &n, buf);
    return JS_NewStringLen(ctx, buf, n);
}
FN(getAttribLocation) {
    const char *s = JS_ToCString(ctx, argv[1]);
    if (!s) return JS_EXCEPTION;
    int r = glGetAttribLocation(O(0), s);
    JS_FreeCString(ctx, s);
    return JS_NewInt32(ctx, r);
}
FN(getUniformLocation) {
    const char *s = JS_ToCString(ctx, argv[1]);
    if (!s) return JS_EXCEPTION;
    int r = glGetUniformLocation(O(0), s);
    JS_FreeCString(ctx, s);
    return r < 0 ? JS_NULL : make_obj(ctx, (uintptr_t)(r + 1));
}
static JSValue active_info(JSContext *ctx, const char *name, GLint size, GLenum type) {
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "name", JS_NewString(ctx, name));
    JS_SetPropertyStr(ctx, o, "size", JS_NewInt32(ctx, size));
    JS_SetPropertyStr(ctx, o, "type", JS_NewInt32(ctx, type));
    return o;
}
FN(getActiveAttrib) {
    char name[256];
    GLsizei n = 0;
    GLint size = 0;
    GLenum type = 0;
    glGetActiveAttrib(O(0), U(1), sizeof name - 1, &n, &size, &type, name);
    name[n] = 0;
    return active_info(ctx, name, size, type);
}
FN(getActiveUniform) {
    char name[256];
    GLsizei n = 0;
    GLint size = 0;
    GLenum type = 0;
    glGetActiveUniform(O(0), U(1), sizeof name - 1, &n, &size, &type, name);
    name[n] = 0;
    return active_info(ctx, name, size, type);
}
FN(getShaderPrecisionFormat) {
    GLint range[2] = {0, 0}, prec = 0;
    glGetShaderPrecisionFormat(U(0), U(1), range, &prec);
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "rangeMin", JS_NewInt32(ctx, range[0]));
    JS_SetPropertyStr(ctx, o, "rangeMax", JS_NewInt32(ctx, range[1]));
    JS_SetPropertyStr(ctx, o, "precision", JS_NewInt32(ctx, prec));
    return o;
}
FN(getContextAttributes) {
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "alpha", JS_TRUE);
    JS_SetPropertyStr(ctx, o, "depth", JS_TRUE);
    JS_SetPropertyStr(ctx, o, "stencil", JS_TRUE);
    JS_SetPropertyStr(ctx, o, "antialias", JS_FALSE);
    JS_SetPropertyStr(ctx, o, "premultipliedAlpha", JS_TRUE);
    JS_SetPropertyStr(ctx, o, "preserveDrawingBuffer", JS_FALSE);
    return o;
}
FN(getParameter) {
    uint32_t p = U(0);
    switch (p) {
    case GL_VIEWPORT: case GL_SCISSOR_BOX: case GL_MAX_VIEWPORT_DIMS: {
        GLint v[4] = {0, 0, 0, 0};
        glGetIntegerv(p, v);
        int n = p == GL_MAX_VIEWPORT_DIMS ? 2 : 4;
        JSValue a = JS_NewArray(ctx);
        for (int i = 0; i < n; i++) JS_SetPropertyUint32(ctx, a, i, JS_NewInt32(ctx, v[i]));
        return a;
    }
    case GL_COLOR_CLEAR_VALUE: {
        GLfloat v[4];
        glGetFloatv(p, v);
        JSValue a = JS_NewArray(ctx);
        for (int i = 0; i < 4; i++) JS_SetPropertyUint32(ctx, a, i, JS_NewFloat64(ctx, v[i]));
        return a;
    }
    case GL_VERSION: case GL_VENDOR: case GL_RENDERER: case GL_SHADING_LANGUAGE_VERSION: {
        const GLubyte *s = glGetString(p);
        return JS_NewString(ctx, s ? (const char *)s : "");
    }
    default: {
        GLint v = 0;
        glGetIntegerv(p, &v);
        return JS_NewInt32(ctx, v);
    }
    }
}

/* ---- uniforms --------------------------------------------------------------------------------- */

static int loc(JSValueConst v) { return (int)obj_id(v) - 1; }

FN(uniform1f) { glUniform1f(loc(argv[0]), F(1)); return JS_UNDEFINED; }
FN(uniform2f) { glUniform2f(loc(argv[0]), F(1), F(2)); return JS_UNDEFINED; }
FN(uniform3f) { glUniform3f(loc(argv[0]), F(1), F(2), F(3)); return JS_UNDEFINED; }
FN(uniform4f) { glUniform4f(loc(argv[0]), F(1), F(2), F(3), F(4)); return JS_UNDEFINED; }
FN(uniform1i) { glUniform1i(loc(argv[0]), I(1)); return JS_UNDEFINED; }
FN(uniform2i) { glUniform2i(loc(argv[0]), I(1), I(2)); return JS_UNDEFINED; }
FN(uniform3i) { glUniform3i(loc(argv[0]), I(1), I(2), I(3)); return JS_UNDEFINED; }
FN(uniform4i) { glUniform4i(loc(argv[0]), I(1), I(2), I(3), I(4)); return JS_UNDEFINED; }

#define UNIFORM_FV(N)                                                                           \
    FN(uniform##N##fv) {                                                                        \
        float tmp[1024]; const float *p; int n = get_floats(ctx, argv[1], tmp, 1024, &p);       \
        if (n >= N) glUniform##N##fv(loc(argv[0]), n / N, p);                                   \
        return JS_UNDEFINED;                                                                    \
    }
#define UNIFORM_IV(N)                                                                           \
    FN(uniform##N##iv) {                                                                        \
        int32_t tmp[1024]; const int32_t *p; int n = get_ints(ctx, argv[1], tmp, 1024, &p);     \
        if (n >= N) glUniform##N##iv(loc(argv[0]), n / N, p);                                   \
        return JS_UNDEFINED;                                                                    \
    }
UNIFORM_FV(1) UNIFORM_FV(2) UNIFORM_FV(3) UNIFORM_FV(4)
UNIFORM_IV(1) UNIFORM_IV(2) UNIFORM_IV(3) UNIFORM_IV(4)

#define UNIFORM_MAT(N)                                                                          \
    FN(uniformMatrix##N##fv) {                                                                  \
        float tmp[1024]; const float *p; int n = get_floats(ctx, argv[2], tmp, 1024, &p);       \
        if (n >= N * N) glUniformMatrix##N##fv(loc(argv[0]), n / (N * N), GL_FALSE, p);         \
        return JS_UNDEFINED;                                                                    \
    }
UNIFORM_MAT(2) UNIFORM_MAT(3) UNIFORM_MAT(4)

/* ---- textures --------------------------------------------------------------------------------- */

/* An image-like source: any object with width, height and an RGBA8 `_data` ArrayBuffer (our canvas
 * and Image objects). Applies the WebGL flip/premultiply flags into a temporary copy. */
static const uint8_t *source_pixels(JSContext *ctx, JSValueConst src, int *w, int *h, uint8_t **tmp) {
    *tmp = NULL;
    JSValue wv = JS_GetPropertyStr(ctx, src, "width"), hv = JS_GetPropertyStr(ctx, src, "height");
    JS_ToInt32(ctx, w, wv);
    JS_ToInt32(ctx, h, hv);
    JS_FreeValue(ctx, wv);
    JS_FreeValue(ctx, hv);
    JSValue dv = JS_GetPropertyStr(ctx, src, "_data");
    size_t len = 0;
    const uint8_t *p = view_bytes(ctx, dv, &len);
    JS_FreeValue(ctx, dv);   /* the buffer stays alive through `src` */
    if (!p || *w <= 0 || *h <= 0 || len < (size_t)*w * *h * 4) return NULL;
    if (!g_flip_y && !g_premultiply) return p;
    if (!g_flip_y) {                              /* premultiplying opaque pixels changes nothing: skip the copy */
        const uint32_t *px = (const uint32_t *)p;
        size_t n = (size_t)*w * *h, i = 0;
        while (i < n && (px[i] & 0xff000000u) == 0xff000000u) i++;
        if (i == n) return p;
    }
    uint8_t *out = malloc((size_t)*w * *h * 4);
    if (!out) return NULL;
    for (int y = 0; y < *h; y++) {
        const uint8_t *s = p + (size_t)(g_flip_y ? *h - 1 - y : y) * *w * 4;
        uint8_t *d = out + (size_t)y * *w * 4;
        if (g_premultiply) {
            for (int x = 0; x < *w; x++, s += 4, d += 4) {
                unsigned a = s[3];
                d[0] = (uint8_t)((s[0] * a + 127) / 255);
                d[1] = (uint8_t)((s[1] * a + 127) / 255);
                d[2] = (uint8_t)((s[2] * a + 127) / 255);
                d[3] = (uint8_t)a;
            }
        } else {
            memcpy(d, s, (size_t)*w * 4);
        }
    }
    *tmp = out;
    return out;
}

FN(texImage2D) {
    if (argc >= 9) {
        size_t len;
        const uint8_t *p = view_bytes(ctx, argv[8], &len);
        glTexImage2D(U(0), I(1), I(2), I(3), I(4), I(5), U(6), U(7), p);
    } else if (argc >= 6) {
        int w = 0, h = 0;
        uint8_t *tmp;
        const uint8_t *p = source_pixels(ctx, argv[5], &w, &h, &tmp);
        if (p) glTexImage2D(U(0), I(1), I(2), w, h, 0, U(3), U(4), p);
        free(tmp);
    }
    return JS_UNDEFINED;
}
FN(texSubImage2D) {
    if (argc >= 9) {
        size_t len;
        const uint8_t *p = view_bytes(ctx, argv[8], &len);
        if (p) glTexSubImage2D(U(0), I(1), I(2), I(3), I(4), I(5), U(6), U(7), p);
    } else if (argc >= 7) {
        int w = 0, h = 0;
        uint8_t *tmp;
        const uint8_t *p = source_pixels(ctx, argv[6], &w, &h, &tmp);
        if (p) glTexSubImage2D(U(0), I(1), I(2), I(3), w, h, U(4), U(5), p);
        free(tmp);
    }
    return JS_UNDEFINED;
}
FN(copyTexSubImage2D) {
    glCopyTexSubImage2D(U(0), I(1), I(2), I(3), I(4), I(5), I(6), I(7));
    return JS_UNDEFINED;
}
FN(readPixels) {
    size_t len;
    const uint8_t *p = view_bytes(ctx, argv[6], &len);
    if (p) glReadPixels(I(0), I(1), I(2), I(3), U(4), U(5), (void *)p);
    return JS_UNDEFINED;
}

/* ---- registration ----------------------------------------------------------------------------- */

#define REG(name, n) {#name, gl_##name, n}
static const struct {
    const char *name; JSCFunction *fn; int nargs;
} k_funcs[] = {
    REG(activeTexture,1), REG(blendFunc,2), REG(blendFuncSeparate,4), REG(blendEquation,1), REG(clear,1),
    REG(clearColor,4), REG(clearStencil,1), REG(colorMask,4), REG(cullFace,1), REG(depthMask,1),
    REG(depthFunc,1), REG(disable,1), REG(enable,1), REG(frontFace,1), REG(scissor,4), REG(stencilFunc,3),
    REG(stencilMask,1), REG(stencilOp,3), REG(viewport,4), REG(getError,0), REG(isContextLost,0),
    REG(getExtension,1), REG(pixelStorei,2), REG(flush,0), REG(finish,0), REG(setLogicalSize,2),
    REG(createBuffer,0), REG(createFramebuffer,0), REG(createRenderbuffer,0), REG(createTexture,0),
    REG(createProgram,0), REG(createShader,1), REG(deleteBuffer,1), REG(deleteFramebuffer,1),
    REG(deleteRenderbuffer,1), REG(deleteTexture,1), REG(deleteProgram,1), REG(deleteShader,1),
    REG(bindBuffer,2), REG(bindFramebuffer,2), REG(bindRenderbuffer,2), REG(bindTexture,2),
    REG(framebufferTexture2D,5), REG(framebufferRenderbuffer,4), REG(renderbufferStorage,4),
    REG(checkFramebufferStatus,1), REG(generateMipmap,1), REG(texParameteri,3), REG(texParameterf,3),
    REG(bufferData,3), REG(bufferSubData,3), REG(vertexAttribPointer,6), REG(enableVertexAttribArray,1),
    REG(disableVertexAttribArray,1), REG(drawArrays,3), REG(drawElements,4),
    REG(shaderSource,2), REG(compileShader,1), REG(attachShader,2), REG(linkProgram,1), REG(useProgram,1),
    REG(validateProgram,1), REG(bindAttribLocation,3), REG(getShaderParameter,2), REG(getProgramParameter,2),
    REG(getShaderInfoLog,1), REG(getProgramInfoLog,1), REG(getAttribLocation,2), REG(getUniformLocation,2),
    REG(getActiveAttrib,2), REG(getActiveUniform,2), REG(getShaderPrecisionFormat,2),
    REG(getContextAttributes,0), REG(getParameter,1),
    REG(uniform1f,2), REG(uniform2f,3), REG(uniform3f,4), REG(uniform4f,5),
    REG(uniform1i,2), REG(uniform2i,3), REG(uniform3i,4), REG(uniform4i,5),
    REG(uniform1fv,2), REG(uniform2fv,2), REG(uniform3fv,2), REG(uniform4fv,2),
    REG(uniform1iv,2), REG(uniform2iv,2), REG(uniform3iv,2), REG(uniform4iv,2),
    REG(uniformMatrix2fv,3), REG(uniformMatrix3fv,3), REG(uniformMatrix4fv,3),
    REG(texImage2D,9), REG(texSubImage2D,9), REG(copyTexSubImage2D,8), REG(readPixels,7),
};

JSValue js_gl_create(JSContext *ctx, int width, int height) {
    g_screen_w = width;
    g_screen_h = height;
    static int class_ready;
    if (!class_ready) {
        JS_NewClassID(JS_GetRuntime(ctx), &gl_obj_class);
        JSClassDef def = {"WebGLObject"};
        JS_NewClass(JS_GetRuntime(ctx), gl_obj_class, &def);
        class_ready = 1;
    }
    JSValue gl = JS_NewObject(ctx);
    for (size_t i = 0; i < sizeof k_funcs / sizeof k_funcs[0]; i++)
        JS_SetPropertyStr(ctx, gl, k_funcs[i].name, JS_NewCFunction(ctx, k_funcs[i].fn, k_funcs[i].name, k_funcs[i].nargs));
    for (size_t i = 0; i < sizeof k_consts / sizeof k_consts[0]; i++)
        JS_SetPropertyStr(ctx, gl, k_consts[i].name, JS_NewInt32(ctx, k_consts[i].value));
    JS_SetPropertyStr(ctx, gl, "drawingBufferWidth", JS_NewInt32(ctx, width));
    JS_SetPropertyStr(ctx, gl, "drawingBufferHeight", JS_NewInt32(ctx, height));
    return gl;
}
