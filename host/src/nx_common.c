#include "nx_common.h"

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#ifdef _WIN32
#include <direct.h>
#include <windows.h>
#define MKDIR(p) _mkdir(p)
#else
#include <unistd.h>
#define MKDIR(p) mkdir(p, 0777)
#endif

static NxLogFn g_log;

static void logf_str(const char *s) {
    if (g_log) g_log(s);
}

void nx_dump_exception(JSContext *ctx) {
    JSValue ex = JS_GetException(ctx);
    const char *s = JS_ToCString(ctx, ex);
    char line[1024];
    snprintf(line, sizeof line, "JS EXCEPTION: %s", s ? s : "?");
    logf_str(line);
    if (s) JS_FreeCString(ctx, s);
    JSValue st = JS_GetPropertyStr(ctx, ex, "stack");
    if (!JS_IsUndefined(st)) {
        const char *ss = JS_ToCString(ctx, st);
        if (ss) { logf_str(ss); JS_FreeCString(ctx, ss); }
    }
    JS_FreeValue(ctx, st);
    JS_FreeValue(ctx, ex);
}

static char *read_all(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc(n > 0 ? n + 1 : 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, n, f);
    fclose(f);
    buf[got] = 0;
    *len = got;
    return buf;
}

static JSValue nx_log(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *s = argc ? JS_ToCString(ctx, argv[0]) : NULL;
    logf_str(s ? s : "");
    if (s) JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}

static JSValue nx_now(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return JS_NewFloat64(ctx, ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6);
}

static JSValue nx_sleep(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    double ms = 0;
    if (argc) JS_ToFloat64(ctx, &ms, argv[0]);
#ifdef _WIN32
    Sleep((DWORD)ms);
#else
    struct timespec ts = {(time_t)(ms / 1000), (long)(((long long)ms % 1000) * 1000000)};
    nanosleep(&ts, NULL);
#endif
    return JS_UNDEFINED;
}

static JSValue nx_read_file(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *buf = read_all(path, &len);
    JS_FreeCString(ctx, path);
    if (!buf) return JS_NULL;
    char *p = buf;
    if (len >= 3 && !memcmp(p, "\xEF\xBB\xBF", 3)) { p += 3; len -= 3; }     /* XHR text decoding drops the BOM */
    JSValue v = JS_NewStringLen(ctx, p, len);
    free(buf);
    return v;
}

/* nx.readRange(path, offset, length) -> ArrayBuffer of that slice of a file (null when it cannot be read): lets a long
 * movie stay on the SD card and be read a frame at a time. */
static JSValue nx_read_range(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    double off = 0, len = 0;
    JS_ToFloat64(ctx, &off, argv[1]);
    JS_ToFloat64(ctx, &len, argv[2]);
    FILE *f = fopen(path, "rb");
    JS_FreeCString(ctx, path);
    if (!f || len < 0 || len > 256.0 * 1048576.0) { if (f) fclose(f); return JS_NULL; }
    uint8_t *buf = malloc(len > 0 ? (size_t)len : 1);
    if (!buf) { fclose(f); return JS_NULL; }
    size_t got = 0;
    if (fseek(f, (long)off, SEEK_SET) == 0) got = fread(buf, 1, (size_t)len, f);
    fclose(f);
    JSValue v = JS_NewArrayBufferCopy(ctx, buf, got);
    free(buf);
    return v;
}

static JSValue nx_read_binary(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *buf = read_all(path, &len);
    JS_FreeCString(ctx, path);
    if (!buf) return JS_NULL;
    JSValue v = JS_NewArrayBufferCopy(ctx, (const uint8_t *)buf, len);
    free(buf);
    return v;
}

static void mkdirs(const char *path) {
    char tmp[1024];
    snprintf(tmp, sizeof tmp, "%s", path);
    for (char *p = tmp + 1; *p; p++)
        if (*p == '/' && p[-1] != ':') {
            *p = 0;
            MKDIR(tmp);
            *p = '/';
        }
    MKDIR(tmp);
}

static JSValue nx_write_file(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    char dir[1024];
    snprintf(dir, sizeof dir, "%s", path);
    char *slash = strrchr(dir, '/');
    if (slash) { *slash = 0; mkdirs(dir); }

    const uint8_t *data = NULL;
    size_t len = 0;
    const char *str = NULL;
    if (JS_IsString(argv[1])) {
        str = JS_ToCStringLen(ctx, &len, argv[1]);
        data = (const uint8_t *)str;
    } else {
        data = JS_GetArrayBuffer(ctx, &len, argv[1]);
    }
    int ok = 0;
    if (data || len == 0) {
        char tmp[1100];
        snprintf(tmp, sizeof tmp, "%s.tmp", path);            /* an interrupted write must not clobber the old file */
        FILE *f = fopen(tmp, "wb");
        if (f) {
            ok = fwrite(data, 1, len, f) == len;
            ok = (fclose(f) == 0) && ok;
            if (ok) { remove(path); ok = rename(tmp, path) == 0; }
            if (!ok) remove(tmp);
        }
    }
    if (str) JS_FreeCString(ctx, str);
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

static JSValue nx_remove_file(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    int ok = remove(path) == 0;
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

static JSValue nx_mkdir(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    mkdirs(path);
    struct stat st;
    int ok = stat(path, &st) == 0;
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

static JSValue nx_load_script(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *src = read_all(path, &len);
    if (!src) {
        char line[1100];
        snprintf(line, sizeof line, "cannot read %s", path);
        logf_str(line);
        JS_FreeCString(ctx, path);
        return JS_NULL;                       /* not found: the one case a script element reports as an error */
    }
    JSValue r = JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_GLOBAL);
    free(src);
    JS_FreeCString(ctx, path);
    if (JS_IsException(r)) nx_dump_exception(ctx);        /* a script that throws still counts as loaded */
    else JS_FreeValue(ctx, r);
    return JS_TRUE;
}

/* ---- lazily parsed JSON arrays ------------------------------------------------------------------
 * A big top-level JSON array (Troops.json: 12.5 MB, 221 elements) is kept as raw bytes outside the JS heap with
 * an index of where each element starts and ends; an element is parsed only when asked for. */
typedef struct { char *buf; size_t len; size_t *off; int n; } LazyJson;
#define MAX_LAZY 8
static LazyJson g_lazy[MAX_LAZY];

static int is_ws(char c) { return c == ' ' || c == '\n' || c == '\r' || c == '\t'; }

static const char *skip_string(const char *p, const char *end) {   /* p at the opening quote */
    for (p++; p < end && *p != '"'; p++) if (*p == '\\') p++;
    return p < end ? p + 1 : end;
}

static const char *skip_value(const char *p, const char *end) {
    if (p >= end) return p;
    if (*p == '"') return skip_string(p, end);
    if (*p == '{' || *p == '[') {
        int depth = 0;
        while (p < end) {
            char c = *p;
            if (c == '"') { p = skip_string(p, end); continue; }
            if (c == '{' || c == '[') depth++;
            else if (c == '}' || c == ']') { if (--depth == 0) return p + 1; }
            p++;
        }
        return end;
    }
    while (p < end && *p != ',' && *p != ']' && !is_ws(*p)) p++;
    return p;
}

/* nx.jsonLazyOpen(path) -> handle (>= 0) or -1 when the file is missing / not an array */
static JSValue nx_json_lazy_open(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    size_t len;
    char *buf = read_all(path, &len);
    JS_FreeCString(ctx, path);
    if (!buf) return JS_NewInt32(ctx, -1);
    const char *p = buf, *end = buf + len;
    if (len >= 3 && !memcmp(p, "\xEF\xBB\xBF", 3)) p += 3;
    while (p < end && is_ws(*p)) p++;
    int h = -1;
    for (int i = 0; i < MAX_LAZY; i++) if (!g_lazy[i].buf) { h = i; break; }
    if (h < 0 || p >= end || *p != '[') { free(buf); return JS_NewInt32(ctx, -1); }
    size_t cap = 256, n = 0, *off = malloc(cap * 2 * sizeof(size_t));
    p++;
    for (;;) {
        while (p < end && (is_ws(*p) || *p == ',')) p++;
        if (p >= end || *p == ']') break;
        const char *s0 = p, *e0 = skip_value(p, end);
        if (n == cap) { cap *= 2; off = realloc(off, cap * 2 * sizeof(size_t)); }
        off[2 * n] = (size_t)(s0 - buf);
        off[2 * n + 1] = (size_t)(e0 - buf);
        n++;
        if (e0 <= p) break;
        p = e0;
    }
    g_lazy[h].buf = buf; g_lazy[h].len = len; g_lazy[h].off = off; g_lazy[h].n = (int)n;
    return JS_NewInt32(ctx, h);
}
static JSValue nx_json_lazy_count(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int h = 0;
    JS_ToInt32(ctx, &h, argv[0]);
    return JS_NewInt32(ctx, (h >= 0 && h < MAX_LAZY && g_lazy[h].buf) ? g_lazy[h].n : 0);
}
static JSValue nx_json_lazy_get(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int h = 0, i = 0;
    JS_ToInt32(ctx, &h, argv[0]);
    JS_ToInt32(ctx, &i, argv[1]);
    if (h < 0 || h >= MAX_LAZY || !g_lazy[h].buf || i < 0 || i >= g_lazy[h].n) return JS_UNDEFINED;
    LazyJson *l = &g_lazy[h];
    size_t b = l->off[2 * i], e = l->off[2 * i + 1];
    char saved = l->buf[e];                       /* JS_ParseJSON wants a NUL-terminated buffer */
    l->buf[e] = 0;
    JSValue v = JS_ParseJSON(ctx, l->buf + b, e - b, "<lazy>");
    l->buf[e] = saved;
    return v;
}

void nx_common_init(JSContext *ctx, JSValueConst nx, const char *root, NxLogFn log) {
    g_log = log;
    JS_SetPropertyStr(ctx, nx, "log", JS_NewCFunction(ctx, nx_log, "log", 1));
    JS_SetPropertyStr(ctx, nx, "now", JS_NewCFunction(ctx, nx_now, "now", 0));
    JS_SetPropertyStr(ctx, nx, "sleep", JS_NewCFunction(ctx, nx_sleep, "sleep", 1));
    JS_SetPropertyStr(ctx, nx, "readFile", JS_NewCFunction(ctx, nx_read_file, "readFile", 1));
    JS_SetPropertyStr(ctx, nx, "readBinary", JS_NewCFunction(ctx, nx_read_binary, "readBinary", 1));
    JS_SetPropertyStr(ctx, nx, "readRange", JS_NewCFunction(ctx, nx_read_range, "readRange", 3));
    JS_SetPropertyStr(ctx, nx, "writeFile", JS_NewCFunction(ctx, nx_write_file, "writeFile", 2));
    JS_SetPropertyStr(ctx, nx, "removeFile", JS_NewCFunction(ctx, nx_remove_file, "removeFile", 1));
    JS_SetPropertyStr(ctx, nx, "mkdir", JS_NewCFunction(ctx, nx_mkdir, "mkdir", 1));
    JS_SetPropertyStr(ctx, nx, "loadScript", JS_NewCFunction(ctx, nx_load_script, "loadScript", 1));
    JS_SetPropertyStr(ctx, nx, "jsonLazyOpen", JS_NewCFunction(ctx, nx_json_lazy_open, "jsonLazyOpen", 1));
    JS_SetPropertyStr(ctx, nx, "jsonLazyCount", JS_NewCFunction(ctx, nx_json_lazy_count, "jsonLazyCount", 1));
    JS_SetPropertyStr(ctx, nx, "jsonLazyGet", JS_NewCFunction(ctx, nx_json_lazy_get, "jsonLazyGet", 2));
    JS_SetPropertyStr(ctx, nx, "root", JS_NewString(ctx, root));
}
