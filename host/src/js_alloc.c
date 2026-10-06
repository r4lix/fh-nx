#include "js_alloc.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* Every block has an 8-byte header before the payload: low 32 bits = size class (or LARGE), high 32 bits =
 * payload size for large blocks. Class i holds blocks of 16*(i+1) bytes in total, i.e. a payload of
 * 16*(i+1)-8. Payloads are 8-byte aligned, which is all QuickJS needs. */
#define HDR 8
#define NCLASS 64                      /* up to a 1016-byte payload */
#define MAX_SMALL (16 * NCLASS - HDR)
#define LARGE 0xffffffffu
#define CHUNK (1u << 20)

static void *g_free[NCLASS];
static char *g_bump, *g_bump_end;

static inline uint64_t *header(const void *p) { return (uint64_t *)((char *)p - HDR); }
static inline size_t class_payload(unsigned cls) { return 16 * (size_t)(cls + 1) - HDR; }

static void *alloc_small(unsigned cls) {
    void *blk = g_free[cls];
    if (blk) {
        g_free[cls] = *(void **)blk;
        return blk;
    }
    size_t total = 16 * (size_t)(cls + 1);
    if ((size_t)(g_bump_end - g_bump) < total) {
        char *c = malloc(CHUNK);
        if (!c) return NULL;
        g_bump = (char *)(((uintptr_t)c + 15) & ~(uintptr_t)15);
        g_bump_end = c + CHUNK;
    }
    char *b = g_bump;
    g_bump += total;
    *(uint64_t *)b = cls;
    return b + HDR;
}

static void *fast_malloc(void *opaque, size_t size) {
    (void)opaque;
    if (size == 0) size = 1;
    if (size <= MAX_SMALL) return alloc_small((unsigned)((size + HDR + 15) / 16 - 1));
    if (size > 0xfffffff0u) return NULL;
    char *p = malloc(size + HDR);
    if (!p) return NULL;
    *(uint64_t *)p = (uint64_t)LARGE | ((uint64_t)size << 32);
    return p + HDR;
}

static void fast_free(void *opaque, void *ptr) {
    (void)opaque;
    if (!ptr) return;
    uint64_t h = *header(ptr);
    unsigned cls = (uint32_t)h;
    if (cls == LARGE) { free((char *)ptr - HDR); return; }
    *(void **)ptr = g_free[cls];
    g_free[cls] = ptr;
}

static size_t fast_usable(const void *ptr) {
    if (!ptr) return 0;
    uint64_t h = *header(ptr);
    unsigned cls = (uint32_t)h;
    return cls == LARGE ? (size_t)(h >> 32) : class_payload(cls);
}

static void *fast_calloc(void *opaque, size_t count, size_t size) {
    if (size && count > 0xfffffff0u / size) return NULL;
    size_t n = count * size;
    void *p = fast_malloc(opaque, n);
    if (p) memset(p, 0, n);
    return p;
}

static void *fast_realloc(void *opaque, void *ptr, size_t size) {
    if (!ptr) return fast_malloc(opaque, size);
    if (size == 0) { fast_free(opaque, ptr); return NULL; }
    uint64_t h = *header(ptr);
    unsigned cls = (uint32_t)h;
    size_t usable = cls == LARGE ? (size_t)(h >> 32) : class_payload(cls);
    if (cls != LARGE) {
        if (size <= usable) return ptr;                       /* still fits its class */
        void *n = fast_malloc(opaque, size);
        if (!n) return NULL;
        memcpy(n, ptr, usable);
        fast_free(opaque, ptr);
        return n;
    }
    if (size <= MAX_SMALL) {                                  /* a large block shrinking into the pool */
        void *n = fast_malloc(opaque, size);
        if (!n) return NULL;
        memcpy(n, ptr, size < usable ? size : usable);
        fast_free(opaque, ptr);
        return n;
    }
    if (size > 0xfffffff0u) return NULL;
    char *p = realloc((char *)ptr - HDR, size + HDR);
    if (!p) return NULL;
    *(uint64_t *)p = (uint64_t)LARGE | ((uint64_t)size << 32);
    return p + HDR;
}

static const JSMallocFunctions g_mf = {fast_calloc, fast_malloc, fast_free, fast_realloc, fast_usable};

const JSMallocFunctions *js_fast_malloc_functions(void) { return &g_mf; }
