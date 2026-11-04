/* The part of the QuickJS-ng C API that the fh-nx host uses, implemented on V8 (qjs_v8.cc).
 *
 * The host's bindings (js_gl.c, js_canvas.c, audio_mix.c, nx_common.c, mods.cpp, main.c) compile unchanged against this
 * header when the build puts host/v8 first on the include path (make ENGINE=v8).
 *
 * Ownership follows QuickJS: functions that return a JSValue hand over a reference, JS_FreeValue drops it, setters
 * (JS_SetPropertyStr...) take the value they are given. Under V8:
 *   - numbers, booleans, undefined and null are immediates;
 *   - inside a native function (a JS_NewCFunction callback) every object/string is a V8 local handle that lives until
 *     the callback returns, and JS_FreeValue on it does nothing;
 *   - outside any callback (setup code, main loop) objects/strings are persistent handles that JS_FreeValue releases.
 * A value must not be kept across callbacks without JS_DupValue (which makes a persistent handle). */
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct JSRuntime JSRuntime;
typedef struct JSContext JSContext;
typedef uint32_t JSClassID;

enum {
    JS_TAG_UNDEFINED = 0,
    JS_TAG_NULL,
    JS_TAG_BOOL,
    JS_TAG_INT,
    JS_TAG_FLOAT64,
    JS_TAG_EXCEPTION,
    JS_TAG_V8_LOCAL,    /* u.p: a v8::Local slot, valid while the current callback runs */
    JS_TAG_V8_GLOBAL,   /* u.p: a heap v8::Global<v8::Value>*, owned */
    JS_TAG_FINALIZING,  /* u.p: the object record handed to a class finalizer (JS_GetOpaque works on it) */
};

typedef struct JSValue {
    union { void *p; double f; int32_t i; } u;
    int32_t tag;
} JSValue;
#define JSValueConst JSValue

static inline JSValue JS_MKVAL_(int tag, int32_t i) { JSValue v; v.u.p = 0; v.u.i = i; v.tag = tag; return v; }
#define JS_UNDEFINED JS_MKVAL_(JS_TAG_UNDEFINED, 0)
#define JS_NULL JS_MKVAL_(JS_TAG_NULL, 0)
#define JS_FALSE JS_MKVAL_(JS_TAG_BOOL, 0)
#define JS_TRUE JS_MKVAL_(JS_TAG_BOOL, 1)
#define JS_EXCEPTION JS_MKVAL_(JS_TAG_EXCEPTION, 0)

static inline JSValue JS_NewInt32(JSContext *ctx, int32_t v) { (void)ctx; return JS_MKVAL_(JS_TAG_INT, v); }
static inline JSValue JS_NewBool(JSContext *ctx, bool v) { (void)ctx; return JS_MKVAL_(JS_TAG_BOOL, v ? 1 : 0); }
static inline JSValue JS_NewFloat64(JSContext *ctx, double d) {
    (void)ctx;
    JSValue v;
    if (d >= -2147483648.0 && d <= 2147483647.0 && (double)(int32_t)d == d && !(d == 0 && 1 / d < 0)) {
        v.u.p = 0; v.u.i = (int32_t)d; v.tag = JS_TAG_INT;
    } else { v.u.f = d; v.tag = JS_TAG_FLOAT64; }
    return v;
}
static inline bool JS_IsException(JSValue v) { return v.tag == JS_TAG_EXCEPTION; }

typedef JSValue JSCFunction(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv);
typedef JSValue JSCGetterMagic(JSContext *ctx, JSValueConst this_val, int magic);
typedef JSValue JSCSetterMagic(JSContext *ctx, JSValueConst this_val, JSValueConst val, int magic);
typedef void JSClassFinalizer(JSRuntime *rt, JSValueConst val);
typedef void *JSReallocArrayBufferDataFunc(JSRuntime *rt, void *opaque, void *ptr, size_t size);

typedef struct JSClassDef {
    const char *class_name;
    JSClassFinalizer *finalizer;
} JSClassDef;

enum { JS_DEF_CFUNC = 0, JS_DEF_CGETSET_MAGIC = 1 };
typedef struct JSCFunctionListEntry {
    const char *name;
    uint8_t def_type;
    uint8_t length;
    int16_t magic;
    JSCFunction *func;
    JSCGetterMagic *getter;
    JSCSetterMagic *setter;
} JSCFunctionListEntry;
#define JS_CFUNC_DEF(name, length, func1) { name, JS_DEF_CFUNC, length, 0, func1, 0, 0 }
#define JS_CGETSET_MAGIC_DEF(name, fgetter, fsetter, magic) { name, JS_DEF_CGETSET_MAGIC, 0, magic, 0, fgetter, fsetter }

typedef struct JSMallocFunctions JSMallocFunctions;   /* unused under V8 (V8 has its own heap) */
typedef struct JSMemoryUsage { int64_t malloc_size, obj_count; } JSMemoryUsage;

#define JS_EVAL_TYPE_GLOBAL 0
typedef enum JSTypedArrayEnum { JS_TYPED_ARRAY_UINT8C = 0, JS_TYPED_ARRAY_INT16 = 3 } JSTypedArrayEnum;

/* runtime / context */
JSRuntime *JS_NewRuntime2(const JSMallocFunctions *mf, void *opaque);
void JS_SetMaxStackSize(JSRuntime *rt, size_t size);
void JS_FreeRuntime(JSRuntime *rt);
JSContext *JS_NewContext(JSRuntime *rt);
void JS_FreeContext(JSContext *ctx);
JSRuntime *JS_GetRuntime(JSContext *ctx);
void JS_RunGC(JSRuntime *rt);
void JS_ComputeMemoryUsage(JSRuntime *rt, JSMemoryUsage *s);
int JS_ExecutePendingJob(JSRuntime *rt, JSContext **pctx);

/* values */
JSValue JS_DupValue(JSContext *ctx, JSValueConst v);
void JS_FreeValue(JSContext *ctx, JSValue v);
bool JS_IsUndefined(JSValueConst v);
bool JS_IsObject(JSValueConst v);
bool JS_IsString(JSValueConst v);
bool JS_IsArray(JSValueConst v);
bool JS_IsArrayBuffer(JSValueConst v);
bool JS_IsFunction(JSContext *ctx, JSValueConst v);
JSValue JS_NewString(JSContext *ctx, const char *s);
JSValue JS_NewStringLen(JSContext *ctx, const char *s, size_t len);
JSValue JS_NewObject(JSContext *ctx);
JSValue JS_NewArray(JSContext *ctx);
JSValue JS_GetGlobalObject(JSContext *ctx);
int JS_ToInt32(JSContext *ctx, int32_t *pres, JSValueConst v);
int JS_ToUint32(JSContext *ctx, uint32_t *pres, JSValueConst v);
int JS_ToFloat64(JSContext *ctx, double *pres, JSValueConst v);
int JS_ToBool(JSContext *ctx, JSValueConst v);
const char *JS_ToCStringLen(JSContext *ctx, size_t *plen, JSValueConst v);
const char *JS_ToCString(JSContext *ctx, JSValueConst v);
void JS_FreeCString(JSContext *ctx, const char *s);

/* properties */
JSValue JS_GetPropertyStr(JSContext *ctx, JSValueConst obj, const char *name);
int JS_SetPropertyStr(JSContext *ctx, JSValueConst obj, const char *name, JSValue val);
JSValue JS_GetPropertyUint32(JSContext *ctx, JSValueConst obj, uint32_t idx);
int JS_SetPropertyUint32(JSContext *ctx, JSValueConst obj, uint32_t idx, JSValue val);
int JS_SetPropertyFunctionList(JSContext *ctx, JSValueConst obj, const JSCFunctionListEntry *tab, int len);

/* functions, scripts, errors */
JSValue JS_NewCFunction(JSContext *ctx, JSCFunction *func, const char *name, int length);
JSValue JS_Call(JSContext *ctx, JSValueConst func, JSValueConst this_val, int argc, JSValueConst *argv);
JSValue JS_Eval(JSContext *ctx, const char *input, size_t input_len, const char *filename, int eval_flags);
JSValue JS_ParseJSON(JSContext *ctx, const char *buf, size_t len, const char *filename);
JSValue JS_GetException(JSContext *ctx);
JSValue JS_ThrowRangeError(JSContext *ctx, const char *fmt, ...);
JSValue JS_ThrowTypeError(JSContext *ctx, const char *fmt, ...);
JSValue JS_ThrowSyntaxError(JSContext *ctx, const char *fmt, ...);
JSValue JS_ThrowOutOfMemory(JSContext *ctx);

/* classes with a C pointer */
JSClassID JS_NewClassID(JSRuntime *rt, JSClassID *pclass_id);
int JS_NewClass(JSRuntime *rt, JSClassID class_id, const JSClassDef *def);
void JS_SetClassProto(JSContext *ctx, JSClassID class_id, JSValue proto);
JSValue JS_NewObjectClass(JSContext *ctx, JSClassID class_id);
void JS_SetOpaque(JSValueConst obj, void *opaque);
void *JS_GetOpaque(JSValueConst obj, JSClassID class_id);
void *JS_GetOpaque2(JSContext *ctx, JSValueConst obj, JSClassID class_id);

/* binary data */
uint8_t *JS_GetArrayBuffer(JSContext *ctx, size_t *psize, JSValueConst obj);
JSValue JS_GetTypedArrayBuffer(JSContext *ctx, JSValueConst obj, size_t *pbyte_offset, size_t *pbyte_length,
                               size_t *pbytes_per_element);
JSValue JS_NewArrayBufferCopy(JSContext *ctx, const uint8_t *buf, size_t len);
JSValue JS_NewArrayBuffer(JSContext *ctx, uint8_t *buf, size_t len, size_t max_len, JSReallocArrayBufferDataFunc *free_func,
                          void *opaque, bool is_shared);
JSValue JS_NewTypedArray(JSContext *ctx, int argc, JSValueConst *argv, JSTypedArrayEnum type);

/* V8-only extras (no QuickJS equivalent) */
void JS_V8ExternalMemory(JSContext *ctx, int64_t delta_bytes);   /* tell the GC about C memory owned by JS objects */
const char *JS_V8Stats(JSRuntime *rt);                           /* one line: heap, GC counts and pause times */

#ifdef __cplusplus
}
#endif
