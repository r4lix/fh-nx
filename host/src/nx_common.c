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

void nx_common_init(JSContext *ctx, JSValueConst nx, const char *root, NxLogFn log) {
    g_log = log;
    JS_SetPropertyStr(ctx, nx, "log", JS_NewCFunction(ctx, nx_log, "log", 1));
    JS_SetPropertyStr(ctx, nx, "now", JS_NewCFunction(ctx, nx_now, "now", 0));
    JS_SetPropertyStr(ctx, nx, "sleep", JS_NewCFunction(ctx, nx_sleep, "sleep", 1));
    JS_SetPropertyStr(ctx, nx, "readFile", JS_NewCFunction(ctx, nx_read_file, "readFile", 1));
    JS_SetPropertyStr(ctx, nx, "readBinary", JS_NewCFunction(ctx, nx_read_binary, "readBinary", 1));
    JS_SetPropertyStr(ctx, nx, "writeFile", JS_NewCFunction(ctx, nx_write_file, "writeFile", 2));
    JS_SetPropertyStr(ctx, nx, "removeFile", JS_NewCFunction(ctx, nx_remove_file, "removeFile", 1));
    JS_SetPropertyStr(ctx, nx, "mkdir", JS_NewCFunction(ctx, nx_mkdir, "mkdir", 1));
    JS_SetPropertyStr(ctx, nx, "loadScript", JS_NewCFunction(ctx, nx_load_script, "loadScript", 1));
    JS_SetPropertyStr(ctx, nx, "root", JS_NewString(ctx, root));
}
