/* Canvas 2D on QuickJS: see js_canvas.h.
 *
 * Pixels are RGBA8 with straight (non-premultiplied) alpha, which is what a browser hands to
 * WebGL when UNPACK_PREMULTIPLY_ALPHA is off and what getImageData returns. Paths are kept in
 * device space (transformed as they are built, as the spec says), filled by a 4x vertically
 * supersampled scanline rasteriser with exact horizontal coverage. Text is rasterised glyph by
 * glyph with stb_truetype and cached. */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "js_canvas.h"

#define STB_TRUETYPE_IMPLEMENTATION
#define STBTT_STATIC
#include "imstb_truetype.h"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_NO_STDIO
#define STBI_NO_LINEAR
#define STBI_NO_HDR
#include "stb_image.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* ---- pixel storage ----------------------------------------------------------------------------- */

typedef struct { uint8_t *px; int refs; } Buf;
typedef struct { Buf *b; int w, h; int refs; } Surface;

static JSClassID surface_class, ctx_class, grad_class;

static Buf *buf_new(size_t bytes) {
    Buf *b = malloc(sizeof *b);
    b->px = calloc(bytes ? bytes : 1, 1);
    b->refs = 1;
    return b;
}
static void buf_unref(Buf *b) {
    if (b && --b->refs == 0) { free(b->px); free(b); }
}

static Surface *surface_new(int w, int h) {
    if (w < 0) w = 0;
    if (h < 0) h = 0;
    Surface *s = malloc(sizeof *s);
    s->w = w; s->h = h; s->refs = 1;
    s->b = buf_new((size_t)w * h * 4);
    return s;
}
static void surface_unref(Surface *s) {
    if (s && --s->refs == 0) { buf_unref(s->b); free(s); }
}

static void surface_finalizer(JSRuntime *rt, JSValue v) {
    surface_unref(JS_GetOpaque(v, surface_class));
}
/* ArrayBuffer memory manager: the views are fixed-length, so only "free" (size 0) is ever asked. */
static void *buffer_realloc(JSRuntime *rt, void *opaque, void *ptr, size_t size) {
    if (size == 0) buf_unref(opaque);
    return NULL;
}

/* ---- colours ----------------------------------------------------------------------------------- */

typedef struct { uint8_t r, g, b, a; } RGBA;

static const struct { const char *name; uint32_t rgb; } k_names[] = {
    {"black", 0x000000}, {"white", 0xffffff}, {"red", 0xff0000}, {"green", 0x008000}, {"blue", 0x0000ff},
    {"yellow", 0xffff00}, {"gray", 0x808080}, {"grey", 0x808080}, {"orange", 0xffa500}, {"cyan", 0x00ffff},
    {"magenta", 0xff00ff}, {"purple", 0x800080}, {"pink", 0xffc0cb}, {"brown", 0xa52a2a}, {"lime", 0x00ff00},
    {"silver", 0xc0c0c0}, {"maroon", 0x800000}, {"navy", 0x000080}, {"teal", 0x008080}, {"gold", 0xffd700},
};

static int hexv(int c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static uint8_t clamp8(double v) { return v < 0 ? 0 : v > 255 ? 255 : (uint8_t)(v + 0.5); }

static int parse_color(const char *s, RGBA *out) {
    while (*s == ' ') s++;
    if (*s == '#') {
        size_t n = strlen(s + 1);
        int v[8];
        if (n != 3 && n != 4 && n != 6 && n != 8) return 0;
        for (size_t i = 0; i < n; i++) if ((v[i] = hexv(s[1 + i])) < 0) return 0;
        if (n <= 4) {
            out->r = v[0] * 17; out->g = v[1] * 17; out->b = v[2] * 17; out->a = n == 4 ? v[3] * 17 : 255;
        } else {
            out->r = v[0] * 16 + v[1]; out->g = v[2] * 16 + v[3]; out->b = v[4] * 16 + v[5];
            out->a = n == 8 ? v[6] * 16 + v[7] : 255;
        }
        return 1;
    }
    if (!strncmp(s, "rgb", 3)) {
        const char *p = strchr(s, '(');
        if (!p) return 0;
        double c[4] = {0, 0, 0, 1};
        int n = 0;
        for (p++; *p && *p != ')' && n < 4; n++) {
            char *end;
            c[n] = strtod(p, &end);
            if (end == p) return 0;
            p = end;
            if (*p == '%') { c[n] = c[n] * 255 / 100; p++; }
            while (*p == ' ' || *p == ',' || *p == '/') p++;
        }
        if (n < 3) return 0;
        out->r = clamp8(c[0]); out->g = clamp8(c[1]); out->b = clamp8(c[2]);
        out->a = clamp8(c[3] * 255);
        return 1;
    }
    if (!strcmp(s, "transparent")) { out->r = out->g = out->b = out->a = 0; return 1; }
    for (size_t i = 0; i < sizeof k_names / sizeof k_names[0]; i++)
        if (!strcasecmp(s, k_names[i].name)) {
            out->r = k_names[i].rgb >> 16; out->g = k_names[i].rgb >> 8; out->b = k_names[i].rgb; out->a = 255;
            return 1;
        }
    return 0;
}

/* ---- gradients and paints ---------------------------------------------------------------------- */

typedef struct {
    int radial;
    double x0, y0, r0, x1, y1, r1;
    int n;
    struct { double off; RGBA c; } stops[32];
    RGBA lut[256];
    int lut_ok, refs;
} Gradient;

typedef struct { Gradient *g; RGBA c; } Paint;

static void grad_unref(Gradient *g) { if (g && --g->refs == 0) free(g); }
static void grad_finalizer(JSRuntime *rt, JSValue v) { grad_unref(JS_GetOpaque(v, grad_class)); }

static void grad_build(Gradient *g) {
    for (int i = 0; i < 256; i++) {
        double t = i / 255.0;
        RGBA out = {0, 0, 0, 0};
        if (g->n) {
            if (t <= g->stops[0].off) out = g->stops[0].c;
            else if (t >= g->stops[g->n - 1].off) out = g->stops[g->n - 1].c;
            else for (int k = 1; k < g->n; k++)
                if (t <= g->stops[k].off) {
                    double span = g->stops[k].off - g->stops[k - 1].off;
                    double f = span > 0 ? (t - g->stops[k - 1].off) / span : 1;
                    RGBA a = g->stops[k - 1].c, b = g->stops[k].c;
                    out.r = clamp8(a.r + (b.r - a.r) * f); out.g = clamp8(a.g + (b.g - a.g) * f);
                    out.b = clamp8(a.b + (b.b - a.b) * f); out.a = clamp8(a.a + (b.a - a.a) * f);
                    break;
                }
        }
        g->lut[i] = out;
    }
    g->lut_ok = 1;
}

/* Colour of a paint at device pixel centre (px, py); inv maps device -> user space. */
static RGBA paint_at(const Paint *p, const double *inv, double px, double py) {
    if (!p->g) return p->c;
    Gradient *g = p->g;
    if (!g->lut_ok) grad_build(g);
    double ux = inv[0] * px + inv[2] * py + inv[4], uy = inv[1] * px + inv[3] * py + inv[5];
    double t;
    if (!g->radial) {
        double dx = g->x1 - g->x0, dy = g->y1 - g->y0, l2 = dx * dx + dy * dy;
        t = l2 > 0 ? ((ux - g->x0) * dx + (uy - g->y0) * dy) / l2 : 0;
    } else {
        double dx = g->x1 - g->x0, dy = g->y1 - g->y0, dr = g->r1 - g->r0;
        double qx = ux - g->x0, qy = uy - g->y0;
        double a = dx * dx + dy * dy - dr * dr, b = -2 * (qx * dx + qy * dy + g->r0 * dr), c = qx * qx + qy * qy - g->r0 * g->r0;
        double t1, t2;
        if (fabs(a) < 1e-12) {
            if (fabs(b) < 1e-12) return (RGBA){0, 0, 0, 0};
            t1 = t2 = -c / b;
        } else {
            double disc = b * b - 4 * a * c;
            if (disc < 0) return (RGBA){0, 0, 0, 0};
            double sq = sqrt(disc);
            t1 = (-b + sq) / (2 * a);
            t2 = (-b - sq) / (2 * a);
            if (t2 > t1) { double tmp = t1; t1 = t2; t2 = tmp; }
        }
        if (g->r0 + t1 * dr >= 0) t = t1;
        else if (g->r0 + t2 * dr >= 0) t = t2;
        else return (RGBA){0, 0, 0, 0};
    }
    int idx = t <= 0 ? 0 : t >= 1 ? 255 : (int)(t * 255 + 0.5);
    return g->lut[idx];
}

/* ---- state ------------------------------------------------------------------------------------- */

typedef struct { uint8_t *m; int refs; } Mask;

enum { SRC_OVER, LIGHTER, LIGHTEN, DARKEN, MULTIPLY, SCREEN, DEST_OUT, COPY, SRC_ATOP, DEST_IN, SRC_IN, SRC_OUT, DEST_OVER, DEST_ATOP, XOR, DIFFERENCE };
static const char *k_comp_names[] = {"source-over", "lighter", "lighten", "darken", "multiply", "screen", "destination-out", "copy",
                                     "source-atop", "destination-in", "source-in", "source-out", "destination-over", "destination-atop", "xor", "difference"};
/* modes where a source pixel of alpha 0 still changes the destination (it clears it, or is replaced by it) */
static inline int comp_acts_on_clear(int comp) { return comp == COPY || comp == DEST_IN || comp == SRC_IN || comp == SRC_OUT || comp == DEST_ATOP || comp == XOR; }

typedef struct {
    double m[6];
    Paint fill, stroke;
    double alpha;
    int comp;
    double lw;
    int join, align, baseline, smooth;
    char family[160];
    double fsize;
    Mask *clip;
} State;

typedef struct { double x, y; } Pt;
typedef struct { Pt *p; int n, cap, closed; } Sub;
typedef struct { Sub *s; int n, cap; } Path;

#define STACK_MAX 32
typedef struct {
    Surface *s;
    State st;
    State stack[STACK_MAX];
    int sp;
    Path path;
} Ctx;

static void mask_unref(Mask *m) { if (m && --m->refs == 0) { free(m->m); free(m); } }
static void state_ref(State *st) {
    if (st->fill.g) st->fill.g->refs++;
    if (st->stroke.g) st->stroke.g->refs++;
    if (st->clip) st->clip->refs++;
}
static void state_unref(State *st) {
    grad_unref(st->fill.g);
    grad_unref(st->stroke.g);
    mask_unref(st->clip);
}
static void state_init(State *st) {
    memset(st, 0, sizeof *st);
    st->m[0] = st->m[3] = 1;
    st->fill.c = (RGBA){0, 0, 0, 255};
    st->stroke.c = (RGBA){0, 0, 0, 255};
    st->alpha = 1;
    st->lw = 1;
    st->smooth = 1;
    st->fsize = 10;
    strcpy(st->family, "sans-serif");
}

static void path_clear(Path *p) {
    for (int i = 0; i < p->n; i++) free(p->s[i].p);
    p->n = 0;
}
static Sub *path_sub(Path *p, int fresh) {
    if (fresh || p->n == 0) {
        if (p->n == p->cap) { p->cap = p->cap ? p->cap * 2 : 4; p->s = realloc(p->s, p->cap * sizeof(Sub)); }
        Sub *s = &p->s[p->n++];
        memset(s, 0, sizeof *s);
        return s;
    }
    return &p->s[p->n - 1];
}
static void sub_add(Sub *s, double x, double y) {
    if (s->n == s->cap) { s->cap = s->cap ? s->cap * 2 : 16; s->p = realloc(s->p, s->cap * sizeof(Pt)); }
    s->p[s->n++] = (Pt){x, y};
}

static void tf_point(const double *m, double x, double y, double *ox, double *oy) {
    *ox = m[0] * x + m[2] * y + m[4];
    *oy = m[1] * x + m[3] * y + m[5];
}
static void tf_mul(double *r, const double *a, const double *b) {   /* r = a * b (apply b first) */
    double m0 = a[0] * b[0] + a[2] * b[1], m1 = a[1] * b[0] + a[3] * b[1];
    double m2 = a[0] * b[2] + a[2] * b[3], m3 = a[1] * b[2] + a[3] * b[3];
    double m4 = a[0] * b[4] + a[2] * b[5] + a[4], m5 = a[1] * b[4] + a[3] * b[5] + a[5];
    r[0] = m0; r[1] = m1; r[2] = m2; r[3] = m3; r[4] = m4; r[5] = m5;
}
static int tf_inv(double *r, const double *m) {
    double det = m[0] * m[3] - m[1] * m[2];
    if (fabs(det) < 1e-12) return 0;
    double id = 1 / det;
    r[0] = m[3] * id; r[1] = -m[1] * id; r[2] = -m[2] * id; r[3] = m[0] * id;
    r[4] = (m[2] * m[5] - m[3] * m[4]) * id;
    r[5] = (m[1] * m[4] - m[0] * m[5]) * id;
    return 1;
}

/* ---- compositing ------------------------------------------------------------------------------- */

static inline int mul255(int a, int b) { return (a * b + 127) / 255; }

/* d: destination pixel (straight RGBA), s: source colour, a: effective source alpha 0..255. */
static void blend_px(uint8_t *d, RGBA s, int a, int comp) {
    if (a <= 0 && !comp_acts_on_clear(comp)) return;
    int da = d[3];
    switch (comp) {
    case SRC_ATOP:                           /* the source only shows where there is destination; alpha is the destination's */
        if (da == 0) return;
        d[0] = (uint8_t)(d[0] + ((s.r - d[0]) * a + (s.r >= d[0] ? 127 : -127)) / 255);
        d[1] = (uint8_t)(d[1] + ((s.g - d[1]) * a + (s.g >= d[1] ? 127 : -127)) / 255);
        d[2] = (uint8_t)(d[2] + ((s.b - d[2]) * a + (s.b >= d[2] ? 127 : -127)) / 255);
        return;
    case DEST_IN:                            /* keep the destination only where the source is: alpha scales by the source's */
        d[3] = (uint8_t)mul255(da, a);
        return;
    case SRC_IN: {                           /* the source, only where there is destination */
        int oa = mul255(a, da);
        d[0] = s.r; d[1] = s.g; d[2] = s.b; d[3] = (uint8_t)oa;
        return;
    }
    case SRC_OUT: {                          /* the source, only where there is no destination */
        int oa = mul255(a, 255 - da);
        d[0] = s.r; d[1] = s.g; d[2] = s.b; d[3] = (uint8_t)oa;
        return;
    }
    case DEST_ATOP:                          /* the destination, only where there is source; the source shows behind it */
        d[0] = (uint8_t)((s.r * (255 - da) + d[0] * da) / 255);
        d[1] = (uint8_t)((s.g * (255 - da) + d[1] * da) / 255);
        d[2] = (uint8_t)((s.b * (255 - da) + d[2] * da) / 255);
        d[3] = (uint8_t)a;
        return;
    case DEST_OVER: {                        /* the source goes behind the destination */
        int k = mul255(a, 255 - da), oa = da + k;
        if (oa == 0) return;
        d[0] = (uint8_t)((d[0] * da + s.r * k) / oa);
        d[1] = (uint8_t)((d[1] * da + s.g * k) / oa);
        d[2] = (uint8_t)((d[2] * da + s.b * k) / oa);
        d[3] = (uint8_t)oa;
        return;
    }
    case XOR: {
        int ka = mul255(a, 255 - da), kb = mul255(da, 255 - a), oa = ka + kb;
        if (oa == 0) { d[0] = d[1] = d[2] = d[3] = 0; return; }
        d[0] = (uint8_t)((s.r * ka + d[0] * kb) / oa);
        d[1] = (uint8_t)((s.g * ka + d[1] * kb) / oa);
        d[2] = (uint8_t)((s.b * ka + d[2] * kb) / oa);
        d[3] = (uint8_t)oa;
        return;
    }
    case DEST_OUT:
        d[3] = (uint8_t)mul255(da, 255 - a);
        return;
    case COPY:
        d[0] = s.r; d[1] = s.g; d[2] = s.b; d[3] = (uint8_t)a;
        return;
    case LIGHTER: {
        if (da == 255) {
            int v;
            v = d[0] + mul255(s.r, a); d[0] = v > 255 ? 255 : v;
            v = d[1] + mul255(s.g, a); d[1] = v > 255 ? 255 : v;
            v = d[2] + mul255(s.b, a); d[2] = v > 255 ? 255 : v;
            return;
        }
        int dr = mul255(d[0], da), dg = mul255(d[1], da), db = mul255(d[2], da);
        int r = dr + mul255(s.r, a), g = dg + mul255(s.g, a), b = db + mul255(s.b, a), oa = da + a;
        if (r > 255) r = 255;
        if (g > 255) g = 255;
        if (b > 255) b = 255;
        if (oa > 255) oa = 255;
        d[0] = (uint8_t)(r * 255 / oa > 255 ? 255 : r * 255 / oa);
        d[1] = (uint8_t)(g * 255 / oa > 255 ? 255 : g * 255 / oa);
        d[2] = (uint8_t)(b * 255 / oa > 255 ? 255 : b * 255 / oa);
        d[3] = (uint8_t)oa;
        return;
    }
    case LIGHTEN: case DARKEN: case MULTIPLY: case SCREEN: case DIFFERENCE:
        if (da != 0) {                       /* blend function B(dst, src), then source-over of B */
            int r = s.r, g = s.g, b = s.b;
            int dr = d[0], dg = d[1], db = d[2];
            switch (comp) {
            case LIGHTEN: r = r > dr ? r : dr; g = g > dg ? g : dg; b = b > db ? b : db; break;
            case DARKEN: r = r < dr ? r : dr; g = g < dg ? g : dg; b = b < db ? b : db; break;
            case MULTIPLY: r = mul255(r, dr); g = mul255(g, dg); b = mul255(b, db); break;
            case DIFFERENCE: r = r > dr ? r - dr : dr - r; g = g > dg ? g - dg : dg - g; b = b > db ? b - db : db - b; break;
            default: r = r + dr - mul255(r, dr); g = g + dg - mul255(g, dg); b = b + db - mul255(b, db); break;
            }
            s.r = r; s.g = g; s.b = b;
        }
        /* fall through */
    default:                                  /* source-over */
        if (a >= 255 || da == 0) {
            d[0] = s.r; d[1] = s.g; d[2] = s.b; d[3] = (uint8_t)(da == 0 ? a : 255);
            if (da == 0 && a < 255) d[3] = (uint8_t)a;
            return;
        }
        if (da == 255) {
            d[0] = (uint8_t)(d[0] + ((s.r - d[0]) * a + (s.r >= d[0] ? 127 : -127)) / 255);
            d[1] = (uint8_t)(d[1] + ((s.g - d[1]) * a + (s.g >= d[1] ? 127 : -127)) / 255);
            d[2] = (uint8_t)(d[2] + ((s.b - d[2]) * a + (s.b >= d[2] ? 127 : -127)) / 255);
            return;
        }
        {
            int oa = a + mul255(da, 255 - a);
            if (oa == 0) { d[0] = d[1] = d[2] = d[3] = 0; return; }
            int k = mul255(da, 255 - a);
            d[0] = (uint8_t)((s.r * a + d[0] * k) / oa);
            d[1] = (uint8_t)((s.g * a + d[1] * k) / oa);
            d[2] = (uint8_t)((s.b * a + d[2] * k) / oa);
            d[3] = (uint8_t)oa;
        }
    }
}

static inline int global_alpha255(const State *st) {
    double a = st->alpha < 0 ? 0 : st->alpha > 1 ? 1 : st->alpha;
    return (int)(a * 255 + 0.5);
}

/* One pixel of paint with coverage cov (0..255), honouring clip, global alpha and composite op. */
static inline void put_px(Ctx *c, int x, int y, RGBA s, int cov) {
    const State *st = &c->st;
    if (x < 0 || y < 0 || x >= c->s->w || y >= c->s->h) return;
    if (st->clip) cov = mul255(cov, st->clip->m[(size_t)y * c->s->w + x]);
    int a = mul255(mul255(s.a, global_alpha255(st)), cov);
    blend_px(c->s->b->px + ((size_t)y * c->s->w + x) * 4, s, a, st->comp);
}

/* ---- scanline polygon fill --------------------------------------------------------------------- */

#define SS 4

typedef struct { double x0, y0, x1, y1; int dir; } Edge;

typedef void (*RowFn)(Ctx *c, int y, int x0, int x1, const float *cov, void *user);

static void fill_polys(Ctx *c, const Sub *subs, int ns, RowFn row_fn, void *user) {
    int ne = 0, cap = 0;
    Edge *edges = NULL;
    double miny = 1e30, maxy = -1e30, minx = 1e30, maxx = -1e30;
    for (int i = 0; i < ns; i++) {
        const Sub *sp = &subs[i];
        if (sp->n < 2) continue;
        for (int k = 0; k < sp->n; k++) {
            Pt a = sp->p[k], b = sp->p[(k + 1) % sp->n];
            if (a.x < minx) minx = a.x;
            if (a.x > maxx) maxx = a.x;
            if (a.y < miny) miny = a.y;
            if (a.y > maxy) maxy = a.y;
            if (a.y == b.y) continue;
            if (ne == cap) { cap = cap ? cap * 2 : 64; edges = realloc(edges, cap * sizeof(Edge)); }
            Edge e = a.y < b.y ? (Edge){a.x, a.y, b.x, b.y, 1} : (Edge){b.x, b.y, a.x, a.y, -1};
            edges[ne++] = e;
        }
    }
    int W = c->s->w, H = c->s->h;
    int y0 = (int)floor(miny), y1 = (int)ceil(maxy);
    if (y0 < 0) y0 = 0;
    if (y1 > H) y1 = H;
    int xlo = (int)floor(minx), xhi = (int)ceil(maxx);
    if (xlo < 0) xlo = 0;
    if (xhi > W) xhi = W;
    if (ne && xhi > xlo) {
        float *cov = calloc(W + 2, sizeof(float));
        double *xs = malloc(sizeof(double) * ne);
        int *dirs = malloc(sizeof(int) * ne);
        for (int y = y0; y < y1; y++) {
            memset(cov + xlo, 0, sizeof(float) * (xhi - xlo + 1));
            int any = 0;
            for (int k = 0; k < SS; k++) {
                double sy = y + (k + 0.5) / SS;
                int nx = 0;
                for (int e = 0; e < ne; e++) {
                    if (sy < edges[e].y0 || sy >= edges[e].y1) continue;
                    double t = (sy - edges[e].y0) / (edges[e].y1 - edges[e].y0);
                    double x = edges[e].x0 + (edges[e].x1 - edges[e].x0) * t;
                    int j = nx++;
                    while (j > 0 && xs[j - 1] > x) { xs[j] = xs[j - 1]; dirs[j] = dirs[j - 1]; j--; }
                    xs[j] = x; dirs[j] = edges[e].dir;
                }
                int wind = 0;
                for (int j = 0; j + 1 < nx; j++) {
                    wind += dirs[j];
                    if (!wind) continue;
                    double xa = xs[j], xb = xs[j + 1];
                    if (xb <= xlo || xa >= xhi) continue;
                    if (xa < xlo) xa = xlo;
                    if (xb > xhi) xb = xhi;
                    int ia = (int)floor(xa), ib = (int)floor(xb);
                    any = 1;
                    if (ia == ib) { cov[ia] += (float)((xb - xa) / SS); continue; }
                    cov[ia] += (float)((ia + 1 - xa) / SS);
                    for (int x = ia + 1; x < ib; x++) cov[x] += 1.0f / SS;
                    cov[ib] += (float)((xb - ib) / SS);
                }
            }
            if (any) row_fn(c, y, xlo, xhi, cov, user);
        }
        free(cov); free(xs); free(dirs);
    }
    free(edges);
}

typedef struct { const Paint *paint; double inv[6]; int ok; } PaintRow;

static void paint_row(Ctx *c, int y, int x0, int x1, const float *cov, void *user) {
    PaintRow *pr = user;
    for (int x = x0; x < x1; x++) {
        float cv = cov[x];
        if (cv <= 0.002f) continue;
        int cv255 = cv >= 1.0f ? 255 : (int)(cv * 255 + 0.5f);
        RGBA col = pr->paint->g ? paint_at(pr->paint, pr->inv, x + 0.5, y + 0.5) : pr->paint->c;
        put_px(c, x, y, col, cv255);
    }
}

static void paint_inverse(Ctx *c, const Paint *p, PaintRow *pr) {
    pr->paint = p;
    pr->ok = tf_inv(pr->inv, c->st.m);
    if (!pr->ok) { pr->inv[0] = pr->inv[3] = 1; pr->inv[1] = pr->inv[2] = pr->inv[4] = pr->inv[5] = 0; }
}

static void fill_path(Ctx *c, const Sub *subs, int ns, const Paint *p) {
    PaintRow pr;
    paint_inverse(c, p, &pr);
    fill_polys(c, subs, ns, paint_row, &pr);
}

/* ---- axis-aligned rectangle fast paths -----------------------------------------------------------
 * Bitmap.fillRect and TerraxLighting's per-frame screen-sized mask make rectangle fills the hottest
 * thing the 2D canvas does. A solid fill that replaces pixels is a 32-bit store per pixel; the rest still
 * avoids the per-pixel clip/alpha/dispatch work of put_px. */

static inline void lerp_over(uint8_t *d, RGBA s, int a) {            /* d opaque */
    d[0] = (uint8_t)(d[0] + ((s.r - d[0]) * a + (s.r >= d[0] ? 127 : -127)) / 255);
    d[1] = (uint8_t)(d[1] + ((s.g - d[1]) * a + (s.g >= d[1] ? 127 : -127)) / 255);
    d[2] = (uint8_t)(d[2] + ((s.b - d[2]) * a + (s.b >= d[2] ? 127 : -127)) / 255);
}

/* For a fixed colour and alpha, source-over onto an opaque pixel is three table lookups. */
typedef struct { uint8_t t[3][256]; int ready; } OverLut;
static void over_lut_build(OverLut *l, RGBA s, int a) {
    const int sc[3] = {s.r, s.g, s.b};
    for (int k = 0; k < 3; k++)
        for (int d = 0; d < 256; d++) l->t[k][d] = (uint8_t)(d + ((sc[k] - d) * a + (sc[k] >= d ? 127 : -127)) / 255);
    l->ready = 1;
}

/* a: source alpha after globalAlpha (0..255). lut: optional, built once per rectangle. */
static void span_solid(Ctx *c, int y, int x0, int x1, RGBA s, int a, OverLut *lut) {
    int n = x1 - x0, comp = c->st.comp;
    if (n <= 0) return;
    uint8_t *row = c->s->b->px + ((size_t)y * c->s->w + x0) * 4;
    const uint8_t *clip = c->st.clip ? c->st.clip->m + (size_t)y * c->s->w + x0 : NULL;
    if (!clip) {
        if (comp == COPY || (comp == SRC_OVER && a >= 255)) {
            uint32_t px = (uint32_t)s.r | ((uint32_t)s.g << 8) | ((uint32_t)s.b << 16) | ((uint32_t)(comp == COPY ? a : 255) << 24);
            uint32_t *d = (uint32_t *)row;
            for (int i = 0; i < n; i++) d[i] = px;
            return;
        }
        if (comp == SRC_OVER) {
            if (a <= 0) return;
            if (lut && !lut->ready) over_lut_build(lut, s, a);
            for (int i = 0; i < n; i++, row += 4) {
                if (row[3] == 255 && lut) { row[0] = lut->t[0][row[0]]; row[1] = lut->t[1][row[1]]; row[2] = lut->t[2][row[2]]; }
                else if (row[3] == 255) lerp_over(row, s, a);
                else blend_px(row, s, a, comp);
            }
            return;
        }
        if (comp == LIGHTER && a > 0) {
            int ar = mul255(s.r, a), ag = mul255(s.g, a), ab = mul255(s.b, a);
            for (int i = 0; i < n; i++, row += 4) {
                if (row[3] == 255) {
                    int v;
                    v = row[0] + ar; row[0] = v > 255 ? 255 : v;
                    v = row[1] + ag; row[1] = v > 255 ? 255 : v;
                    v = row[2] + ab; row[2] = v > 255 ? 255 : v;
                } else blend_px(row, s, a, comp);
            }
            return;
        }
    }
    for (int i = 0; i < n; i++, row += 4)                       /* clip mask, or a mode without a fast path */
        blend_px(row, s, clip ? mul255(a, clip[i]) : a, comp);
}

static void rect_gradient(Ctx *c, int ix0, int iy0, int ix1, int iy1, const Paint *p) {
    Gradient *g = p->g;
    if (!g->lut_ok) grad_build(g);
    PaintRow pr;
    paint_inverse(c, p, &pr);
    const double *inv = pr.inv;
    int ga = global_alpha255(&c->st), comp = c->st.comp;
    int skip_black = comp == LIGHTER;                           /* adding black changes nothing */
    int concentric = g->radial && g->x0 == g->x1 && g->y0 == g->y1 && g->r1 != g->r0;
    float invdr = concentric ? (float)(1.0 / (g->r1 - g->r0)) : 0;
    int linear = !g->radial;
    double dx = g->x1 - g->x0, dy = g->y1 - g->y0, l2 = dx * dx + dy * dy;
    /* Beyond r1 a concentric gradient is a flat colour. When that colour changes nothing (black added,
     * or fully transparent) only the disc needs visiting, which skips a fifth of a light's bounding box
     * and all of its corners. Valid for scale+translate transforms (no rotation/skew). */
    /* The additive light (TerraxLighting's workhorse) gets its own loop: distance -> table index in a tight
     * float pass the compiler can vectorise, then one table lookup and a saturating add per pixel. */
    int light_fast = concentric && comp == LIGHTER && !c->st.clip && inv[1] == 0 && inv[2] == 0;
    uint8_t addt[3][256];
    if (light_fast)
        for (int k = 0; k < 256; k++) {
            int a = mul255(g->lut[k].a, ga);
            addt[0][k] = (uint8_t)mul255(g->lut[k].r, a);
            addt[1][k] = (uint8_t)mul255(g->lut[k].g, a);
            addt[2][k] = (uint8_t)mul255(g->lut[k].b, a);
        }
    static uint8_t idxbuf[16384];
    int disc_only = concentric && inv[1] == 0 && inv[2] == 0 && inv[0] != 0 &&
                    (g->lut[255].a == 0 || (skip_black && !(g->lut[255].r | g->lut[255].g | g->lut[255].b)));
    for (int y = iy0; y < iy1; y++) {
        int xa = ix0, xb = ix1;
        double py = y + 0.5;
        if (disc_only) {
            double qy = inv[3] * py + inv[5] - g->y0;
            double rem = g->r1 * g->r1 - qy * qy;
            if (rem < 0) continue;
            double hw = sqrt(rem);                                        /* user-space half width of the disc on this row */
            double ua = g->x0 - hw - inv[4], ub = g->x0 + hw - inv[4];    /* solve inv0*(x+0.5) + inv4 = user x */
            double fa = ua / inv[0] - 0.5, fb = ub / inv[0] - 0.5;
            if (fa > fb) { double t = fa; fa = fb; fb = t; }
            xa = (int)floor(fa); xb = (int)ceil(fb) + 1;
            if (xa < ix0) xa = ix0;
            if (xb > ix1) xb = ix1;
            if (xb <= xa) continue;
        }
        uint8_t *row = c->s->b->px + ((size_t)y * c->s->w + xa) * 4;
        const uint8_t *clip = c->st.clip ? c->st.clip->m + (size_t)y * c->s->w + xa : NULL;
        double ux = inv[0] * (xa + 0.5) + inv[2] * py + inv[4], uy = inv[1] * (xa + 0.5) + inv[3] * py + inv[5];
        if (light_fast && xb - xa <= 16384) {
            int n = xb - xa;
            float qx0 = (float)(ux - g->x0), qy = (float)(uy - g->y0), step = (float)inv[0], r0 = (float)g->r0, qy2 = qy * qy;
            for (int i = 0; i < n; i++) {                           /* pass 1: float only, vectorisable */
                float qx = qx0 + step * (float)i;
                float t = (sqrtf(qx * qx + qy2) - r0) * invdr;
                t = t < 0.0f ? 0.0f : t > 1.0f ? 1.0f : t;
                idxbuf[i] = (uint8_t)(int)(t * 255.0f + 0.5f);
            }
            for (int i = 0; i < n; i++, row += 4) {                 /* pass 2: lookup + saturating add */
                int k = idxbuf[i];
                int ar = addt[0][k], ag = addt[1][k], ab = addt[2][k];
                if (!(ar | ag | ab)) continue;
                if (row[3] == 255) {
                    int v;
                    v = row[0] + ar; row[0] = v > 255 ? 255 : v;
                    v = row[1] + ag; row[1] = v > 255 ? 255 : v;
                    v = row[2] + ab; row[2] = v > 255 ? 255 : v;
                } else {
                    RGBA col = g->lut[k];
                    blend_px(row, col, mul255(col.a, ga), comp);
                }
            }
            continue;
        }
        for (int x = xa; x < xb; x++, row += 4, ux += inv[0], uy += inv[1]) {
            RGBA col;
            if (concentric) {
                float qx = (float)(ux - g->x0), qy = (float)(uy - g->y0);
                float t = (sqrtf(qx * qx + qy * qy) - (float)g->r0) * invdr;
                col = g->lut[t <= 0 ? 0 : t >= 1 ? 255 : (int)(t * 255 + 0.5f)];
            } else if (linear) {
                double t = l2 > 0 ? ((ux - g->x0) * dx + (uy - g->y0) * dy) / l2 : 0;
                col = g->lut[t <= 0 ? 0 : t >= 1 ? 255 : (int)(t * 255 + 0.5)];
            } else {
                col = paint_at(p, inv, x + 0.5, py);
            }
            if (col.a == 0) continue;
            if (skip_black && !(col.r | col.g | col.b)) continue;
            int a = mul255(col.a, ga);
            if (clip) a = mul255(a, clip[x - xa]);
            if (comp == LIGHTER && row[3] == 255) {              /* the additive light: no function call per pixel */
                int v;
                v = row[0] + mul255(col.r, a); row[0] = v > 255 ? 255 : v;
                v = row[1] + mul255(col.g, a); row[1] = v > 255 ? 255 : v;
                v = row[2] + mul255(col.b, a); row[2] = v > 255 ? 255 : v;
            } else {
                blend_px(row, col, a, comp);
            }
        }
    }
}

/* Axis-aligned rectangle, device space. Integer edges take the span fast paths. */
static void fill_rect_dev(Ctx *c, double x0, double y0, double x1, double y1, const Paint *p) {
    if (x1 < x0) { double t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { double t = y0; y0 = y1; y1 = t; }
    int ix0 = (int)lrint(x0), iy0 = (int)lrint(y0), ix1 = (int)lrint(x1), iy1 = (int)lrint(y1);
    if (fabs(x0 - ix0) < 1e-6 && fabs(y0 - iy0) < 1e-6 && fabs(x1 - ix1) < 1e-6 && fabs(y1 - iy1) < 1e-6) {
        if (ix0 < 0) ix0 = 0;
        if (iy0 < 0) iy0 = 0;
        if (ix1 > c->s->w) ix1 = c->s->w;
        if (iy1 > c->s->h) iy1 = c->s->h;
        if (p->g) { rect_gradient(c, ix0, iy0, ix1, iy1, p); return; }
        int a = mul255(p->c.a, global_alpha255(&c->st));
        OverLut lut = {{{0}}, 0};
        for (int y = iy0; y < iy1; y++) span_solid(c, y, ix0, ix1, p->c, a, &lut);
        return;
    }
    if (p->g && c->st.comp == LIGHTER) {
        /* An additive gradient rectangle (TerraxLighting's lights, drawn into a scaled-down mask so their edges land
         * between pixels) fades to nothing at its border: covering the outer pixels whole instead of antialiasing the
         * rim changes nothing visible, and avoids the general per-pixel path, ~10x slower. */
        int jx0 = (int)floor(x0), jy0 = (int)floor(y0), jx1 = (int)ceil(x1), jy1 = (int)ceil(y1);
        if (jx0 < 0) jx0 = 0;
        if (jy0 < 0) jy0 = 0;
        if (jx1 > c->s->w) jx1 = c->s->w;
        if (jy1 > c->s->h) jy1 = c->s->h;
        rect_gradient(c, jx0, jy0, jx1, jy1, p);
        return;
    }
    Pt pts[4] = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}};
    Sub s = {pts, 4, 4, 1};
    fill_path(c, &s, 1, p);
}

/* ---- JS helpers -------------------------------------------------------------------------------- */

static double argd(JSContext *ctx, JSValueConst *argv, int i) {
    double v = 0;
    JS_ToFloat64(ctx, &v, argv[i]);
    return v;
}
static Ctx *get_ctx(JSContext *ctx, JSValueConst this_val) { return JS_GetOpaque2(ctx, this_val, ctx_class); }

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

/* ---- context lifecycle ------------------------------------------------------------------------- */

static void ctx_finalizer(JSRuntime *rt, JSValue v) {
    Ctx *c = JS_GetOpaque(v, ctx_class);
    if (!c) return;
    state_unref(&c->st);
    for (int i = 0; i < c->sp; i++) state_unref(&c->stack[i]);
    path_clear(&c->path);
    free(c->path.s);
    surface_unref(c->s);
    free(c);
}

/* ---- state setters/getters --------------------------------------------------------------------- */

static void set_paint(JSContext *ctx, Paint *dst, JSValueConst v) {
    Gradient *g = JS_IsObject(v) ? JS_GetOpaque(v, grad_class) : NULL;
    if (g) {
        g->refs++;
        grad_unref(dst->g);
        dst->g = g;
        return;
    }
    const char *s = JS_ToCString(ctx, v);
    RGBA col;
    if (s && parse_color(s, &col)) {
        grad_unref(dst->g);
        dst->g = NULL;
        dst->c = col;
    }
    if (s) JS_FreeCString(ctx, s);
}

enum { P_FILL, P_STROKE, P_ALPHA, P_COMP, P_LW, P_JOIN, P_FONT, P_ALIGN, P_BASELINE, P_SMOOTH };

static JSValue style_get(JSContext *ctx, JSValueConst this_val, int magic) {
    Ctx *c = get_ctx(ctx, this_val);
    if (!c) return JS_EXCEPTION;
    char buf[256];
    switch (magic) {
    case P_FILL: case P_STROKE: {
        const Paint *p = magic == P_FILL ? &c->st.fill : &c->st.stroke;
        if (p->c.a == 255) snprintf(buf, sizeof buf, "#%02x%02x%02x", p->c.r, p->c.g, p->c.b);
        else snprintf(buf, sizeof buf, "rgba(%d, %d, %d, %.3g)", p->c.r, p->c.g, p->c.b, p->c.a / 255.0);
        return JS_NewString(ctx, buf);
    }
    case P_ALPHA: return JS_NewFloat64(ctx, c->st.alpha);
    case P_COMP: return JS_NewString(ctx, k_comp_names[c->st.comp]);
    case P_LW: return JS_NewFloat64(ctx, c->st.lw);
    case P_JOIN: return JS_NewString(ctx, c->st.join == 0 ? "miter" : c->st.join == 1 ? "round" : "bevel");
    case P_FONT: snprintf(buf, sizeof buf, "%gpx %s", c->st.fsize, c->st.family); return JS_NewString(ctx, buf);
    case P_ALIGN: return JS_NewString(ctx, c->st.align == 0 ? "left" : c->st.align == 1 ? "center" : "right");
    case P_BASELINE: return JS_NewString(ctx, "alphabetic");
    case P_SMOOTH: return JS_NewBool(ctx, c->st.smooth);
    }
    return JS_UNDEFINED;
}

/* "italic bold 28px GameFont, sans-serif" -> size + family list. Unparseable strings are ignored. */
static int parse_font(const char *s, double *size, char *family, size_t famcap) {
    const char *p = s;
    while (*p) {
        while (*p == ' ') p++;
        char *end;
        double v = strtod(p, &end);
        if (end != p && (!strncmp(end, "px", 2) || !strncmp(end, "pt", 2))) {
            *size = v * (end[0] == 'p' && end[1] == 't' ? 4.0 / 3.0 : 1.0);
            p = end + 2;
            while (*p == ' ' || *p == '/') p++;
            if (*p == '+' || (*p >= '0' && *p <= '9')) { strtod(p, &end); p = end; while (*p == ' ') p++; }  /* line-height */
            snprintf(family, famcap, "%s", p);
            return 1;
        }
        while (*p && *p != ' ') p++;
    }
    return 0;
}

static JSValue style_set(JSContext *ctx, JSValueConst this_val, JSValueConst v, int magic) {
    Ctx *c = get_ctx(ctx, this_val);
    if (!c) return JS_EXCEPTION;
    double d;
    const char *s;
    switch (magic) {
    case P_FILL: set_paint(ctx, &c->st.fill, v); break;
    case P_STROKE: set_paint(ctx, &c->st.stroke, v); break;
    case P_ALPHA:
        if (!JS_ToFloat64(ctx, &d, v) && d >= 0 && d <= 1) c->st.alpha = d;
        break;
    case P_COMP:
        if ((s = JS_ToCString(ctx, v))) {
            for (int i = 0; i < (int)(sizeof k_comp_names / sizeof k_comp_names[0]); i++)
                if (!strcmp(s, k_comp_names[i])) c->st.comp = i;       /* unknown values are ignored, as in browsers */
            JS_FreeCString(ctx, s);
        }
        break;
    case P_LW:
        if (!JS_ToFloat64(ctx, &d, v) && d > 0) c->st.lw = d;
        break;
    case P_JOIN:
        if ((s = JS_ToCString(ctx, v))) {
            if (!strcmp(s, "miter")) c->st.join = 0;
            else if (!strcmp(s, "round")) c->st.join = 1;
            else if (!strcmp(s, "bevel")) c->st.join = 2;
            JS_FreeCString(ctx, s);
        }
        break;
    case P_FONT:
        if ((s = JS_ToCString(ctx, v))) {
            double sz;
            char fam[160];
            if (parse_font(s, &sz, fam, sizeof fam)) { c->st.fsize = sz; strcpy(c->st.family, fam); }
            JS_FreeCString(ctx, s);
        }
        break;
    case P_ALIGN:
        if ((s = JS_ToCString(ctx, v))) {
            if (!strcmp(s, "left") || !strcmp(s, "start")) c->st.align = 0;
            else if (!strcmp(s, "center")) c->st.align = 1;
            else if (!strcmp(s, "right") || !strcmp(s, "end")) c->st.align = 2;
            JS_FreeCString(ctx, s);
        }
        break;
    case P_BASELINE:
        if ((s = JS_ToCString(ctx, v))) {
            const char *names[] = {"alphabetic", "top", "middle", "bottom", "hanging", "ideographic"};
            for (int i = 0; i < 6; i++) if (!strcmp(s, names[i])) c->st.baseline = i;
            JS_FreeCString(ctx, s);
        }
        break;
    case P_SMOOTH: c->st.smooth = JS_ToBool(ctx, v); break;
    }
    return JS_UNDEFINED;
}

/* ---- save / restore / transforms --------------------------------------------------------------- */

static JSValue c2d_save(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    if (c->sp < STACK_MAX) {
        c->stack[c->sp] = c->st;
        state_ref(&c->stack[c->sp]);
        c->sp++;
    }
    return JS_UNDEFINED;
}
static JSValue c2d_restore(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    if (c->sp > 0) {
        state_unref(&c->st);
        c->st = c->stack[--c->sp];            /* the stack's reference moves to the live state */
    }
    return JS_UNDEFINED;
}
static JSValue c2d_setTransform(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    if (argc < 6) return JS_UNDEFINED;
    for (int i = 0; i < 6; i++) c->st.m[i] = argd(ctx, argv, i);
    return JS_UNDEFINED;
}
static JSValue c2d_resetTransform(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    c->st.m[0] = c->st.m[3] = 1;
    c->st.m[1] = c->st.m[2] = c->st.m[4] = c->st.m[5] = 0;
    return JS_UNDEFINED;
}
static JSValue c2d_transform(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    if (argc < 6) return JS_UNDEFINED;
    double m[6];
    for (int i = 0; i < 6; i++) m[i] = argd(ctx, argv, i);
    tf_mul(c->st.m, c->st.m, m);
    return JS_UNDEFINED;
}
static JSValue c2d_translate(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    double m[6] = {1, 0, 0, 1, argd(ctx, argv, 0), argd(ctx, argv, 1)};
    tf_mul(c->st.m, c->st.m, m);
    return JS_UNDEFINED;
}
static JSValue c2d_scale(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    double m[6] = {argd(ctx, argv, 0), 0, 0, argd(ctx, argv, 1), 0, 0};
    tf_mul(c->st.m, c->st.m, m);
    return JS_UNDEFINED;
}
static JSValue c2d_rotate(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    double a = argd(ctx, argv, 0), cs = cos(a), sn = sin(a);
    double m[6] = {cs, sn, -sn, cs, 0, 0};
    tf_mul(c->st.m, c->st.m, m);
    return JS_UNDEFINED;
}

/* ---- path building ----------------------------------------------------------------------------- */

static void path_move(Ctx *c, double x, double y) {
    Sub *s = path_sub(&c->path, 1);
    double dx, dy;
    tf_point(c->st.m, x, y, &dx, &dy);
    sub_add(s, dx, dy);
}
static void path_line(Ctx *c, double x, double y) {
    if (c->path.n == 0) { path_move(c, x, y); return; }
    Sub *s = path_sub(&c->path, 0);
    if (s->closed) { Pt p0 = s->p[0]; s = path_sub(&c->path, 1); sub_add(s, p0.x, p0.y); }
    double dx, dy;
    tf_point(c->st.m, x, y, &dx, &dy);
    sub_add(s, dx, dy);
}

static JSValue c2d_beginPath(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    path_clear(&c->path);
    return JS_UNDEFINED;
}
static JSValue c2d_closePath(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    if (c->path.n) c->path.s[c->path.n - 1].closed = 1;
    return JS_UNDEFINED;
}
static JSValue c2d_moveTo(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    path_move(c, argd(ctx, argv, 0), argd(ctx, argv, 1));
    return JS_UNDEFINED;
}
static JSValue c2d_lineTo(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    path_line(c, argd(ctx, argv, 0), argd(ctx, argv, 1));
    return JS_UNDEFINED;
}
static JSValue c2d_rect(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    double x = argd(ctx, argv, 0), y = argd(ctx, argv, 1), w = argd(ctx, argv, 2), h = argd(ctx, argv, 3);
    path_move(c, x, y);
    path_line(c, x + w, y);
    path_line(c, x + w, y + h);
    path_line(c, x, y + h);
    c->path.s[c->path.n - 1].closed = 1;
    return JS_UNDEFINED;
}
static JSValue c2d_arc(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    double x = argd(ctx, argv, 0), y = argd(ctx, argv, 1), r = argd(ctx, argv, 2);
    double a0 = argd(ctx, argv, 3), a1 = argd(ctx, argv, 4);
    int ccw = argc > 5 && JS_ToBool(ctx, argv[5]);
    if (r < 0) return JS_UNDEFINED;
    double sweep = a1 - a0;
    if (!ccw) { if (sweep >= 2 * M_PI) sweep = 2 * M_PI; else while (sweep < 0) sweep += 2 * M_PI; }
    else { if (sweep <= -2 * M_PI) sweep = -2 * M_PI; else while (sweep > 0) sweep -= 2 * M_PI; }
    double scale = fmax(hypot(c->st.m[0], c->st.m[1]), hypot(c->st.m[2], c->st.m[3]));
    double rdev = fmax(r * scale, 0.5);
    int n = (int)ceil(fabs(sweep) / (2 * acos(fmax(0.0, 1 - 0.1 / rdev))));
    if (n < 8) n = 8;
    if (n > 720) n = 720;
    for (int i = 0; i <= n; i++) {
        double a = a0 + sweep * i / n;
        double px = x + r * cos(a), py = y + r * sin(a);
        if (i == 0) path_line(c, px, py); else path_line(c, px, py);
    }
    return JS_UNDEFINED;
}

static Pt cur_user(Ctx *c) {                  /* current point back in user space */
    Pt r = {0, 0};
    if (!c->path.n) return r;
    Sub *s = &c->path.s[c->path.n - 1];
    double inv[6];
    if (!s->n || !tf_inv(inv, c->st.m)) return r;
    Pt p = s->p[s->n - 1];
    tf_point(inv, p.x, p.y, &r.x, &r.y);
    return r;
}
static JSValue c2d_quadraticCurveTo(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    Pt p0 = cur_user(c);
    double cx = argd(ctx, argv, 0), cy = argd(ctx, argv, 1), x = argd(ctx, argv, 2), y = argd(ctx, argv, 3);
    for (int i = 1; i <= 16; i++) {
        double t = i / 16.0, u = 1 - t;
        path_line(c, u * u * p0.x + 2 * u * t * cx + t * t * x, u * u * p0.y + 2 * u * t * cy + t * t * y);
    }
    return JS_UNDEFINED;
}
static JSValue c2d_bezierCurveTo(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    Pt p0 = cur_user(c);
    double c1x = argd(ctx, argv, 0), c1y = argd(ctx, argv, 1), c2x = argd(ctx, argv, 2), c2y = argd(ctx, argv, 3);
    double x = argd(ctx, argv, 4), y = argd(ctx, argv, 5);
    for (int i = 1; i <= 24; i++) {
        double t = i / 24.0, u = 1 - t;
        path_line(c, u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
                  u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
    }
    return JS_UNDEFINED;
}

/* ---- fill / stroke / clip ---------------------------------------------------------------------- */

static JSValue c2d_fill(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    fill_path(c, c->path.s, c->path.n, &c->st.fill);
    return JS_UNDEFINED;
}

/* Stroke as the union of one quad per segment plus joins; all pieces wound the same way so a
 * non-zero fill merges them. Caps are butt. */
static void stroke_path(Ctx *c) {
    double scale = sqrt(fabs(c->st.m[0] * c->st.m[3] - c->st.m[1] * c->st.m[2]));
    double hw = c->st.lw * scale / 2;
    int count = 0;
    for (int i = 0; i < c->path.n; i++) count += c->path.s[i].n * 2 + 2;
    Sub *pieces = malloc(sizeof(Sub) * (count + 1));
    Pt *pool = malloc(sizeof(Pt) * (size_t)(count + 1) * 24);
    int np = 0;
    size_t used = 0;
    for (int i = 0; i < c->path.n; i++) {
        const Sub *s = &c->path.s[i];
        int segs = s->closed ? s->n : s->n - 1;
        for (int k = 0; k < segs; k++) {
            Pt a = s->p[k], b = s->p[(k + 1) % s->n];
            double dx = b.x - a.x, dy = b.y - a.y, len = hypot(dx, dy);
            if (len < 1e-9) continue;
            double nx = -dy / len * hw, ny = dx / len * hw;
            Pt *q = pool + used;
            q[0] = (Pt){a.x + nx, a.y + ny}; q[1] = (Pt){b.x + nx, b.y + ny};
            q[2] = (Pt){b.x - nx, b.y - ny}; q[3] = (Pt){a.x - nx, a.y - ny};
            double area = 0;
            for (int j = 0; j < 4; j++) area += q[j].x * q[(j + 1) % 4].y - q[(j + 1) % 4].x * q[j].y;
            if (area < 0) { Pt t = q[0]; q[0] = q[3]; q[3] = t; t = q[1]; q[1] = q[2]; q[2] = t; }
            pieces[np++] = (Sub){q, 4, 4, 1};
            used += 4;
            if (c->st.join == 1 && (k + 1 < segs || s->closed)) {       /* round join: a disc at the vertex */
                Pt *d = pool + used;
                int m = hw < 2 ? 8 : 16;
                for (int j = 0; j < m; j++) d[j] = (Pt){b.x + hw * cos(2 * M_PI * j / m), b.y + hw * sin(2 * M_PI * j / m)};
                double ar = 0;
                for (int j = 0; j < m; j++) ar += d[j].x * d[(j + 1) % m].y - d[(j + 1) % m].x * d[j].y;
                if (ar < 0) for (int j = 0; j < m / 2; j++) { Pt t = d[j]; d[j] = d[m - 1 - j]; d[m - 1 - j] = t; }
                pieces[np++] = (Sub){d, m, m, 1};
                used += m;
            }
        }
    }
    if (np) {
        PaintRow pr;
        paint_inverse(c, &c->st.stroke, &pr);
        /* stroke geometry is already in device space: paint with the device->user mapping */
        fill_polys(c, pieces, np, paint_row, &pr);
    }
    free(pieces);
    free(pool);
}

static JSValue c2d_stroke(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    stroke_path(c);
    return JS_UNDEFINED;
}

static void mask_row(Ctx *c, int y, int x0, int x1, const float *cov, void *user) {
    uint8_t *m = user;
    for (int x = x0; x < x1; x++) {
        float cv = cov[x];
        m[(size_t)y * c->s->w + x] = cv >= 1.0f ? 255 : cv <= 0 ? 0 : (uint8_t)(cv * 255 + 0.5f);
    }
}

static JSValue c2d_clip(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    size_t n = (size_t)c->s->w * c->s->h;
    uint8_t *fresh = calloc(n ? n : 1, 1);
    fill_polys(c, c->path.s, c->path.n, mask_row, fresh);
    if (c->st.clip)
        for (size_t i = 0; i < n; i++) fresh[i] = (uint8_t)mul255(fresh[i], c->st.clip->m[i]);
    Mask *m = malloc(sizeof *m);
    m->m = fresh;
    m->refs = 1;
    mask_unref(c->st.clip);
    c->st.clip = m;
    return JS_UNDEFINED;
}

static JSValue c2d_fillRect(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    double x = argd(ctx, argv, 0), y = argd(ctx, argv, 1), w = argd(ctx, argv, 2), h = argd(ctx, argv, 3);
    const double *m = c->st.m;
    if (m[1] == 0 && m[2] == 0) {
        double x0, y0, x1, y1;
        tf_point(m, x, y, &x0, &y0);
        tf_point(m, x + w, y + h, &x1, &y1);
        fill_rect_dev(c, x0, y0, x1, y1, &c->st.fill);
    } else {
        Pt pts[4];
        tf_point(m, x, y, &pts[0].x, &pts[0].y);
        tf_point(m, x + w, y, &pts[1].x, &pts[1].y);
        tf_point(m, x + w, y + h, &pts[2].x, &pts[2].y);
        tf_point(m, x, y + h, &pts[3].x, &pts[3].y);
        Sub s = {pts, 4, 4, 1};
        fill_path(c, &s, 1, &c->st.fill);
    }
    return JS_UNDEFINED;
}
static JSValue c2d_strokeRect(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    Path saved = c->path;
    c->path = (Path){0};
    c2d_rect(ctx, self, argc, argv);
    stroke_path(c);
    path_clear(&c->path);
    free(c->path.s);
    c->path = saved;
    return JS_UNDEFINED;
}
static JSValue c2d_clearRect(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    int comp = c->st.comp;
    int alpha_pushed = 0;
    double alpha = c->st.alpha;
    Paint fill = c->st.fill;
    c->st.comp = COPY;
    c->st.alpha = 1;
    c->st.fill.g = NULL;
    c->st.fill.c = (RGBA){0, 0, 0, 0};
    (void)alpha_pushed;
    c2d_fillRect(ctx, self, argc, argv);
    c->st.comp = comp;
    c->st.alpha = alpha;
    c->st.fill = fill;
    return JS_UNDEFINED;
}

/* ---- drawImage / pixel access ------------------------------------------------------------------ */

static void sample_bilinear(const Surface *src, int sx0, int sy0, int sw, int sh, double u, double v, int smooth, RGBA *out) {
    const uint8_t *px = src->b->px;
    double fu = u - 0.5, fv = v - 0.5;
    int x0 = (int)floor(fu), y0 = (int)floor(fv);
    if (!smooth) {
        int x = (int)floor(u), y = (int)floor(v);
        x = x < 0 ? 0 : x >= sw ? sw - 1 : x;
        y = y < 0 ? 0 : y >= sh ? sh - 1 : y;
        const uint8_t *p = px + ((size_t)(sy0 + y) * src->w + sx0 + x) * 4;
        out->r = p[0]; out->g = p[1]; out->b = p[2]; out->a = p[3];
        return;
    }
    int ax = (int)((fu - x0) * 256), ay = (int)((fv - y0) * 256);
    int xs[2] = {x0, x0 + 1}, ys[2] = {y0, y0 + 1};
    for (int i = 0; i < 2; i++) {
        xs[i] = xs[i] < 0 ? 0 : xs[i] >= sw ? sw - 1 : xs[i];
        ys[i] = ys[i] < 0 ? 0 : ys[i] >= sh ? sh - 1 : ys[i];
    }
    int wgt[4] = {(256 - ax) * (256 - ay), ax * (256 - ay), (256 - ax) * ay, ax * ay};
    long pr = 0, pg = 0, pb = 0, pa = 0;
    for (int k = 0; k < 4; k++) {
        const uint8_t *p = px + ((size_t)(sy0 + ys[k >> 1]) * src->w + sx0 + xs[k & 1]) * 4;
        long a = p[3] * (long)wgt[k];
        pa += a;
        pr += p[0] * a;               /* premultiplied accumulation */
        pg += p[1] * a;
        pb += p[2] * a;
    }
    if (pa == 0) { out->r = out->g = out->b = out->a = 0; return; }
    out->r = (uint8_t)(pr / pa); out->g = (uint8_t)(pg / pa); out->b = (uint8_t)(pb / pa);
    out->a = (uint8_t)((pa + 32768) >> 16);
}

static Surface *source_surface(JSContext *ctx, JSValueConst v) {
    if (!JS_IsObject(v)) return NULL;
    JSValue sv = JS_GetPropertyStr(ctx, v, "_s");
    Surface *s = JS_IsObject(sv) ? JS_GetOpaque(sv, surface_class) : NULL;
    JS_FreeValue(ctx, sv);                 /* the canvas keeps it alive */
    return s;
}

/* Unrotated, positively scaled drawImage (window skins, stretched backgrounds, scene snapshots): the
 * sampling positions per column and per row are computed once, then each pixel is a fixed-point bilinear
 * blend of four texels. The generic inverse-mapping path costs several times more per pixel. */
static void draw_scaled_axis(Ctx *c, const Surface *src, int isx, int isy, int isw, int ish, const double *full,
                             int x0, int y0, int x1, int y1) {
    int W = x1 - x0, H = y1 - y0;
    if (W <= 0 || H <= 0) return;
    int smooth = c->st.smooth, gaw = global_alpha255(&c->st), comp = c->st.comp;
    int fast = comp == SRC_OVER && !c->st.clip && gaw == 255;
    int *tab = malloc(sizeof(int) * 4 * (size_t)(W + H));
    int *ca = tab, *cb = tab + W, *cw = tab + 2 * W, *rv = tab + 3 * W;          /* columns: a, b, weight, valid */
    int *ra = tab + 4 * W, *rb = ra + H, *rw = ra + 2 * H, *rvalid = ra + 3 * H;
    (void)rv;
    int *cvalid = tab + 3 * W;
    for (int i = 0; i < W; i++) {
        double u = (x0 + i + 0.5 - full[4]) / full[0];
        cvalid[i] = u >= 0 && u < isw;
        if (!cvalid[i]) continue;
        if (smooth) {
            double fu = u - 0.5;
            int ia = (int)floor(fu);
            cw[i] = (int)((fu - ia) * 256);
            ca[i] = ia < 0 ? 0 : ia >= isw ? isw - 1 : ia;
            cb[i] = ia + 1 < 0 ? 0 : ia + 1 >= isw ? isw - 1 : ia + 1;
        } else {
            int ia = (int)floor(u);
            ca[i] = cb[i] = ia < 0 ? 0 : ia >= isw ? isw - 1 : ia;
            cw[i] = 0;
        }
    }
    for (int j = 0; j < H; j++) {
        double v = (y0 + j + 0.5 - full[5]) / full[3];
        rvalid[j] = v >= 0 && v < ish;
        if (!rvalid[j]) continue;
        if (smooth) {
            double fv = v - 0.5;
            int ia = (int)floor(fv);
            rw[j] = (int)((fv - ia) * 256);
            ra[j] = ia < 0 ? 0 : ia >= ish ? ish - 1 : ia;
            rb[j] = ia + 1 < 0 ? 0 : ia + 1 >= ish ? ish - 1 : ia + 1;
        } else {
            int ia = (int)floor(v);
            ra[j] = rb[j] = ia < 0 ? 0 : ia >= ish ? ish - 1 : ia;
            rw[j] = 0;
        }
    }
    const uint8_t *spx = src->b->px;
    for (int j = 0; j < H; j++) {
        if (!rvalid[j]) continue;
        const uint8_t *rowa = spx + ((size_t)(isy + ra[j]) * src->w + isx) * 4;
        const uint8_t *rowb = spx + ((size_t)(isy + rb[j]) * src->w + isx) * 4;
        int wy = rw[j];
        uint8_t *drow = c->s->b->px + ((size_t)(y0 + j) * c->s->w + x0) * 4;
        for (int i = 0; i < W; i++, drow += 4) {
            if (!cvalid[i]) continue;
            int wx = cw[i];
            const uint8_t *p00 = rowa + ca[i] * 4, *p10 = rowa + cb[i] * 4, *p01 = rowb + ca[i] * 4, *p11 = rowb + cb[i] * 4;
            RGBA o;
            if ((p00[3] & p10[3] & p01[3] & p11[3]) == 255) {                     /* opaque neighbourhood */
                int w00 = (256 - wx) * (256 - wy), w10 = wx * (256 - wy), w01 = (256 - wx) * wy, w11 = wx * wy;
                o.r = (uint8_t)((p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11 + 32768) >> 16);
                o.g = (uint8_t)((p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11 + 32768) >> 16);
                o.b = (uint8_t)((p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11 + 32768) >> 16);
                o.a = 255;
            } else {
                long w00 = (256 - wx) * (256 - wy), w10 = wx * (256 - wy), w01 = (256 - wx) * wy, w11 = wx * wy;
                long a00 = p00[3] * w00, a10 = p10[3] * w10, a01 = p01[3] * w01, a11 = p11[3] * w11;
                long sa = a00 + a10 + a01 + a11;
                if (sa == 0) continue;
                o.r = (uint8_t)((p00[0] * a00 + p10[0] * a10 + p01[0] * a01 + p11[0] * a11) / sa);
                o.g = (uint8_t)((p00[1] * a00 + p10[1] * a10 + p01[1] * a01 + p11[1] * a11) / sa);
                o.b = (uint8_t)((p00[2] * a00 + p10[2] * a10 + p01[2] * a01 + p11[2] * a11) / sa);
                o.a = (uint8_t)((sa + 32768) >> 16);
            }
            if (fast) {
                if (o.a == 255) { drow[0] = o.r; drow[1] = o.g; drow[2] = o.b; drow[3] = 255; }
                else if (o.a) blend_px(drow, o, o.a, SRC_OVER);
            } else {
                if (o.a == 0 && comp != COPY) continue;
                put_px(c, x0 + i, y0 + j, o, 255);
            }
        }
    }
    free(tab);
}

static JSValue c2d_drawImage(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    Surface *src = source_surface(ctx, argv[0]);
    if (!src || src->w <= 0 || src->h <= 0) return JS_UNDEFINED;
    double sx = 0, sy = 0, sw = src->w, sh = src->h, dx, dy, dw, dh;
    if (argc >= 9) {
        sx = argd(ctx, argv, 1); sy = argd(ctx, argv, 2); sw = argd(ctx, argv, 3); sh = argd(ctx, argv, 4);
        dx = argd(ctx, argv, 5); dy = argd(ctx, argv, 6); dw = argd(ctx, argv, 7); dh = argd(ctx, argv, 8);
    } else if (argc >= 5) {
        dx = argd(ctx, argv, 1); dy = argd(ctx, argv, 2); dw = argd(ctx, argv, 3); dh = argd(ctx, argv, 4);
    } else {
        dx = argd(ctx, argv, 1); dy = argd(ctx, argv, 2); dw = src->w; dh = src->h;
    }
    /* clamp the source rectangle to the image, shrinking the destination to match */
    if (sw < 0) { sx += sw; sw = -sw; dx += dw; dw = -dw; }
    if (sh < 0) { sy += sh; sh = -sh; dy += dh; dh = -dh; }
    if (sw == 0 || sh == 0 || dw == 0 || dh == 0) return JS_UNDEFINED;
    double fx = dw / sw, fy = dh / sh;
    if (sx < 0) { dx -= sx * fx; dw += sx * fx; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy * fy; dh += sy * fy; sh += sy; sy = 0; }
    if (sx + sw > src->w) { dw -= (sx + sw - src->w) * fx; sw = src->w - sx; }
    if (sy + sh > src->h) { dh -= (sy + sh - src->h) * fy; sh = src->h - sy; }
    if (sw <= 0 || sh <= 0) return JS_UNDEFINED;

    int isx = (int)floor(sx + 0.5), isy = (int)floor(sy + 0.5), isw = (int)floor(sw + 0.5), ish = (int)floor(sh + 0.5);
    if (isw < 1) isw = 1;
    if (ish < 1) ish = 1;
    if (isx + isw > src->w) isw = src->w - isx;
    if (isy + ish > src->h) ish = src->h - isy;

    /* user-space dest rect -> device; sample by inverse mapping from device pixel centres */
    double full[6], inv[6];
    double map[6] = {dw / isw, 0, 0, dh / ish, dx, dy};      /* source pixel space -> user space */
    tf_mul(full, c->st.m, map);
    if (!tf_inv(inv, full)) return JS_UNDEFINED;
    double cx[4] = {0, isw, isw, 0}, cy[4] = {0, 0, ish, ish};
    double minx = 1e30, maxx = -1e30, miny = 1e30, maxy = -1e30;
    for (int i = 0; i < 4; i++) {
        double X, Y;
        tf_point(full, cx[i], cy[i], &X, &Y);
        minx = fmin(minx, X); maxx = fmax(maxx, X); miny = fmin(miny, Y); maxy = fmax(maxy, Y);
    }
    int x0 = (int)floor(minx), x1 = (int)ceil(maxx), y0 = (int)floor(miny), y1 = (int)ceil(maxy);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > c->s->w) x1 = c->s->w;
    if (y1 > c->s->h) y1 = c->s->h;

    int identity = fabs(full[0] - 1) < 1e-9 && fabs(full[3] - 1) < 1e-9 && full[1] == 0 && full[2] == 0 &&
                   fabs(full[4] - lrint(full[4])) < 1e-9 && fabs(full[5] - lrint(full[5])) < 1e-9;
    if (!identity && full[1] == 0 && full[2] == 0 && full[0] > 0 && full[3] > 0) {
        draw_scaled_axis(c, src, isx, isy, isw, ish, full, x0, y0, x1, y1);
        return JS_UNDEFINED;
    }
    int gaw = global_alpha255(&c->st);
    int fast_copy = identity && c->st.comp == SRC_OVER && !c->st.clip;           /* any globalAlpha: handled per pixel below */
    int fast_add = identity && c->st.comp == LIGHTER && !c->st.clip;               /* Bitmap.blur: nine additive copies, alpha 1/9 */
    for (int y = y0; y < y1; y++) {
        for (int x = x0; x < x1; x++) {
            RGBA s;
            if (identity) {
                int u = x - (int)lrint(full[4]), v = y - (int)lrint(full[5]);
                if (u < 0 || v < 0 || u >= isw || v >= ish) continue;
                const uint8_t *p = src->b->px + ((size_t)(isy + v) * src->w + isx + u) * 4;
                if (fast_copy) {                                   /* plain over, no clip: skip put_px's per-pixel work */
                    if (p[3] == 255 && gaw == 255) { memcpy(c->s->b->px + ((size_t)y * c->s->w + x) * 4, p, 4); continue; }
                    if (p[3] == 0) continue;
                    blend_px(c->s->b->px + ((size_t)y * c->s->w + x) * 4, (RGBA){p[0], p[1], p[2], p[3]}, mul255(p[3], gaw), SRC_OVER);
                    continue;
                }
                if (fast_add) {
                    uint8_t *d = c->s->b->px + ((size_t)y * c->s->w + x) * 4;
                    if (p[3] == 0) continue;
                    int a = mul255(p[3], gaw);
                    if (d[3] == 255) {
                        int v;
                        v = d[0] + mul255(p[0], a); d[0] = v > 255 ? 255 : v;
                        v = d[1] + mul255(p[1], a); d[1] = v > 255 ? 255 : v;
                        v = d[2] + mul255(p[2], a); d[2] = v > 255 ? 255 : v;
                    } else blend_px(d, (RGBA){p[0], p[1], p[2], p[3]}, a, LIGHTER);
                    continue;
                }
                s = (RGBA){p[0], p[1], p[2], p[3]};
            } else {
                double u = inv[0] * (x + 0.5) + inv[2] * (y + 0.5) + inv[4];
                double v = inv[1] * (x + 0.5) + inv[3] * (y + 0.5) + inv[5];
                if (u < 0 || v < 0 || u >= isw || v >= ish) continue;
                sample_bilinear(src, isx, isy, isw, ish, u, v, c->st.smooth, &s);
            }
            if (s.a == 0 && !comp_acts_on_clear(c->st.comp)) continue;
            put_px(c, x, y, s, 255);
        }
    }
    return JS_UNDEFINED;
}

static JSValue make_image_data(JSContext *ctx, int w, int h, const uint8_t *src_or_null) {
    size_t n = (size_t)w * h * 4;
    JSValue ab = JS_NewArrayBufferCopy(ctx, src_or_null, n);       /* src_or_null NULL -> zeroed copy below */
    if (JS_IsException(ab)) return ab;
    JSValue arg = ab;
    JSValue data = JS_NewTypedArray(ctx, 1, &arg, JS_TYPED_ARRAY_UINT8C);
    JS_FreeValue(ctx, ab);
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, h));
    JS_SetPropertyStr(ctx, o, "data", data);
    return o;
}

static JSValue c2d_getImageData(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    int x = (int)argd(ctx, argv, 0), y = (int)argd(ctx, argv, 1), w = (int)argd(ctx, argv, 2), h = (int)argd(ctx, argv, 3);
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (w <= 0 || h <= 0) return JS_ThrowRangeError(ctx, "getImageData: empty rectangle");
    uint8_t *tmp = calloc((size_t)w * h * 4, 1);
    for (int row = 0; row < h; row++) {
        int sy = y + row;
        if (sy < 0 || sy >= c->s->h) continue;
        int xa = x < 0 ? -x : 0, xb = x + w > c->s->w ? c->s->w - x : w;
        if (xb <= xa) continue;
        memcpy(tmp + ((size_t)row * w + xa) * 4, c->s->b->px + ((size_t)sy * c->s->w + x + xa) * 4, (size_t)(xb - xa) * 4);
    }
    JSValue r = make_image_data(ctx, w, h, tmp);
    free(tmp);
    return r;
}
/* Bitmap.adjustTone, natively: add (r,g,b) to every pixel's colour, clamped, alpha untouched. MV does this
 * with a per-pixel JavaScript loop over getImageData, ~7 ms per window background on a PC and every window
 * refresh pays it. */
static JSValue c2d_adjustTone(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    int dr = (int)argd(ctx, argv, 0), dg = (int)argd(ctx, argv, 1), db = (int)argd(ctx, argv, 2);
    uint8_t *p = c->s->b->px;
    size_t n = (size_t)c->s->w * c->s->h;
    if (dr < -255) dr = -255; if (dr > 255) dr = 255;
    if (dg < -255) dg = -255; if (dg > 255) dg = 255;
    if (db < -255) db = -255; if (db > 255) db = 255;
    for (size_t i = 0; i < n; i++, p += 4) {
        int v;
        v = p[0] + dr; p[0] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = p[1] + dg; p[1] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = p[2] + db; p[2] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return JS_UNDEFINED;
}

/* Bitmap.blur, natively: MV runs two passes of a 3x3 box blur as 18 full-screen additive draws (~100 ms on a PC,
 * about 0.5 s on the Switch, paid on every menu open and map transfer through snapForBackground). This does the
 * same two passes (edge pixels clamped, as MV's padded copy does) as separable 3-tap sums. */
static JSValue c2d_blur(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    int passes = argc > 0 ? (int)argd(ctx, argv, 0) : 2;
    int w = c->s->w, h = c->s->h;
    if (w < 1 || h < 1) return JS_UNDEFINED;
    uint8_t *px = c->s->b->px;
    uint8_t *tmp = malloc((size_t)w * h * 4);
    if (!tmp) return JS_ThrowOutOfMemory(ctx);
    for (int pass = 0; pass < passes; pass++) {
        for (int y = 0; y < h; y++) {                       /* horizontal: px -> tmp */
            const uint8_t *r = px + (size_t)y * w * 4;
            uint8_t *o = tmp + (size_t)y * w * 4;
            for (int x = 0; x < w; x++) {
                const uint8_t *a = r + (x > 0 ? x - 1 : 0) * 4, *b = r + x * 4, *d = r + (x < w - 1 ? x + 1 : x) * 4;
                for (int k = 0; k < 4; k++) o[x * 4 + k] = (uint8_t)((a[k] + b[k] + d[k] + 1) / 3);
            }
        }
        for (int y = 0; y < h; y++) {                       /* vertical: tmp -> px */
            const uint8_t *r0 = tmp + (size_t)(y > 0 ? y - 1 : 0) * w * 4, *r1 = tmp + (size_t)y * w * 4, *r2 = tmp + (size_t)(y < h - 1 ? y + 1 : y) * w * 4;
            uint8_t *o = px + (size_t)y * w * 4;
            for (int i = 0; i < w * 4; i++) o[i] = (uint8_t)((r0[i] + r1[i] + r2[i] + 1) / 3);
        }
    }
    free(tmp);
    return JS_UNDEFINED;
}

static JSValue c2d_createImageData(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int w = (int)argd(ctx, argv, 0), h = (int)argd(ctx, argv, 1);
    if (w <= 0 || h <= 0) return JS_ThrowRangeError(ctx, "createImageData: empty size");
    uint8_t *tmp = calloc((size_t)w * h * 4, 1);
    JSValue r = make_image_data(ctx, w, h, tmp);
    free(tmp);
    return r;
}
static JSValue c2d_putImageData(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    JSValue wv = JS_GetPropertyStr(ctx, argv[0], "width"), hv = JS_GetPropertyStr(ctx, argv[0], "height"), dv = JS_GetPropertyStr(ctx, argv[0], "data");
    int w = 0, h = 0;
    JS_ToInt32(ctx, &w, wv);
    JS_ToInt32(ctx, &h, hv);
    size_t len = 0;
    const uint8_t *data = view_bytes(ctx, dv, &len);
    int dx = (int)argd(ctx, argv, 1), dy = (int)argd(ctx, argv, 2);
    if (data && len >= (size_t)w * h * 4)
        for (int row = 0; row < h; row++) {
            int ty = dy + row;
            if (ty < 0 || ty >= c->s->h) continue;
            int xa = dx < 0 ? -dx : 0, xb = dx + w > c->s->w ? c->s->w - dx : w;
            if (xb > xa)
                memcpy(c->s->b->px + ((size_t)ty * c->s->w + dx + xa) * 4, data + ((size_t)row * w + xa) * 4, (size_t)(xb - xa) * 4);
        }
    JS_FreeValue(ctx, wv); JS_FreeValue(ctx, hv); JS_FreeValue(ctx, dv);
    return JS_UNDEFINED;
}

/* ---- gradients --------------------------------------------------------------------------------- */

static JSValue make_gradient(JSContext *ctx, Gradient *g) {
    JSValue o = JS_NewObjectClass(ctx, grad_class);
    JS_SetOpaque(o, g);
    return o;
}
static JSValue c2d_createLinearGradient(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Gradient *g = calloc(1, sizeof *g);
    g->refs = 1;
    g->x0 = argd(ctx, argv, 0); g->y0 = argd(ctx, argv, 1); g->x1 = argd(ctx, argv, 2); g->y1 = argd(ctx, argv, 3);
    return make_gradient(ctx, g);
}
static JSValue c2d_createRadialGradient(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Gradient *g = calloc(1, sizeof *g);
    g->refs = 1;
    g->radial = 1;
    g->x0 = argd(ctx, argv, 0); g->y0 = argd(ctx, argv, 1); g->r0 = argd(ctx, argv, 2);
    g->x1 = argd(ctx, argv, 3); g->y1 = argd(ctx, argv, 4); g->r1 = argd(ctx, argv, 5);
    return make_gradient(ctx, g);
}
static JSValue grad_addColorStop(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Gradient *g = JS_GetOpaque2(ctx, self, grad_class);
    if (!g) return JS_EXCEPTION;
    double off = argd(ctx, argv, 0);
    if (off < 0 || off > 1) return JS_ThrowRangeError(ctx, "addColorStop: offset out of range");
    const char *s = JS_ToCString(ctx, argv[1]);
    RGBA col;
    if (!s || !parse_color(s, &col)) { if (s) JS_FreeCString(ctx, s); return JS_ThrowSyntaxError(ctx, "addColorStop: bad colour"); }
    JS_FreeCString(ctx, s);
    if (g->n < 32) {
        int j = g->n++;
        while (j > 0 && g->stops[j - 1].off > off) { g->stops[j] = g->stops[j - 1]; j--; }
        g->stops[j].off = off;
        g->stops[j].c = col;
        g->lut_ok = 0;
    }
    return JS_UNDEFINED;
}

/* ---- text -------------------------------------------------------------------------------------- */

typedef struct {
    char family[96];
    uint8_t *data;
    stbtt_fontinfo info;
} Font;
#define MAX_FONTS 16
static Font g_fonts[MAX_FONTS];
static int g_nfonts;

typedef struct {
    int used, font, cp, sizeq, sxq, strokeq;
    uint8_t *bm;
    int w, h, xoff, yoff;
} GlyphEntry;
#define GCACHE 2048
static GlyphEntry g_gcache[GCACHE];

static int register_font(const char *family, const char *path) {
    if (g_nfonts >= MAX_FONTS) return 0;
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc(n);
    if (fread(buf, 1, n, f) != (size_t)n) { fclose(f); free(buf); return 0; }
    fclose(f);
    Font *ft = &g_fonts[g_nfonts];
    if (!stbtt_InitFont(&ft->info, buf, stbtt_GetFontOffsetForIndex(buf, 0))) { free(buf); return 0; }
    ft->data = buf;
    snprintf(ft->family, sizeof ft->family, "%s", family);
    g_nfonts++;
    return 1;
}

static int family_eq(const char *list_item, size_t len, const char *name) {
    while (len && (*list_item == ' ' || *list_item == '"' || *list_item == '\'')) { list_item++; len--; }
    while (len && (list_item[len - 1] == ' ' || list_item[len - 1] == '"' || list_item[len - 1] == '\'')) len--;
    return strlen(name) == len && !strncasecmp(list_item, name, len);
}

/* First registered font named in the CSS family list; otherwise the first registered font. */
static int find_font(const char *list) {
    const char *p = list;
    while (*p) {
        const char *e = strchr(p, ',');
        size_t len = e ? (size_t)(e - p) : strlen(p);
        for (int i = 0; i < g_nfonts; i++) if (family_eq(p, len, g_fonts[i].family)) return i;
        if (!e) break;
        p = e + 1;
    }
    return g_nfonts ? 0 : -1;
}

static int utf8_next(const char **pp) {
    const unsigned char *p = (const unsigned char *)*pp;
    int c = *p++;
    if (c < 0x80) { *pp = (const char *)p; return c; }
    int n = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : 1;
    c &= 0x3F >> n;
    while (n-- && (*p & 0xC0) == 0x80) c = (c << 6) | (*p++ & 0x3F);
    *pp = (const char *)p;
    return c;
}

static const GlyphEntry *glyph_get(int font, int cp, double scale_x, double scale_y, double size, double stroke_r) {
    int sxq = (int)(scale_x / scale_y * 1000 + 0.5), sq = (int)(size * 16 + 0.5), stq = (int)(stroke_r * 16 + 0.5);
    unsigned h = ((unsigned)font * 73856093u) ^ ((unsigned)cp * 19349663u) ^ ((unsigned)sq * 83492791u) ^ ((unsigned)sxq * 2654435761u) ^ ((unsigned)stq * 40503u);
    GlyphEntry *e = &g_gcache[h % GCACHE];
    if (e->used && e->font == font && e->cp == cp && e->sizeq == sq && e->sxq == sxq && e->strokeq == stq) return e;
    free(e->bm);
    memset(e, 0, sizeof *e);
    int w = 0, hh = 0, xo = 0, yo = 0;
    uint8_t *bm = stbtt_GetCodepointBitmap(&g_fonts[font].info, (float)scale_x, (float)scale_y, cp, &w, &hh, &xo, &yo);
    if (stroke_r > 0) {                       /* dilate by the stroke radius: the visible part of a centred stroke */
        int pad = (int)ceil(stroke_r) + 1;
        int nw = (bm ? w : 0) + pad * 2, nh = (bm ? hh : 0) + pad * 2;
        uint8_t *out = calloc((size_t)nw * nh, 1);
        if (bm) {
            for (int y = 0; y < nh; y++)
                for (int x = 0; x < nw; x++) {
                    double best = 0;
                    for (int dy = -pad; dy <= pad; dy++)
                        for (int dx = -pad; dx <= pad; dx++) {
                            int sx = x - pad + dx, sy = y - pad + dy;
                            if (sx < 0 || sy < 0 || sx >= w || sy >= hh) continue;
                            double cov = bm[sy * w + sx] / 255.0;
                            if (cov <= 0) continue;
                            double k = stroke_r + 0.5 - sqrt((double)(dx * dx + dy * dy));
                            k = k < 0 ? 0 : k > 1 ? 1 : k;
                            if (cov * k > best) best = cov * k;
                        }
                    out[y * nw + x] = (uint8_t)(best * 255 + 0.5);
                }
            stbtt_FreeBitmap(bm, NULL);
        }
        bm = out; xo -= pad; yo -= pad; w = nw; hh = nh;
    }
    e->used = 1; e->font = font; e->cp = cp; e->sizeq = sq; e->sxq = sxq; e->strokeq = stq;
    e->bm = bm; e->w = w; e->h = hh; e->xoff = xo; e->yoff = yo;
    return e;
}

typedef struct { int cps[1024]; double adv[1024]; int n; double width; } Run;

static void layout_run(int font, double size, const char *text, Run *r) {
    stbtt_fontinfo *fi = &g_fonts[font].info;
    double scale = stbtt_ScaleForMappingEmToPixels(fi, (float)size);
    r->n = 0;
    r->width = 0;
    for (const char *p = text; *p && r->n < 1024;) {
        int cp = utf8_next(&p);
        int adv = 0, lsb = 0;
        stbtt_GetCodepointHMetrics(fi, cp, &adv, &lsb);
        double a = adv * scale;
        if (*p) a += stbtt_GetCodepointKernAdvance(fi, cp, utf8_next(&(const char *){p})) * scale;
        r->cps[r->n] = cp;
        r->adv[r->n++] = a;
        r->width += a;
    }
}

static JSValue c2d_measureText(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    const char *s = JS_ToCString(ctx, argv[0]);
    if (!s) return JS_EXCEPTION;
    int font = find_font(c->st.family);
    double w;
    if (font < 0) w = strlen(s) * c->st.fsize * 0.5;
    else { Run *r = malloc(sizeof *r); layout_run(font, c->st.fsize, s, r); w = r->width; free(r); }
    JS_FreeCString(ctx, s);
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "width", JS_NewFloat64(ctx, w));
    return o;
}

static JSValue draw_text(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv, int stroke) {
    Ctx *c = get_ctx(ctx, self);
    if (!c) return JS_EXCEPTION;
    int font = find_font(c->st.family);
    if (font < 0) return JS_UNDEFINED;
    const char *s = JS_ToCString(ctx, argv[0]);
    if (!s) return JS_EXCEPTION;
    double x = argd(ctx, argv, 1), y = argd(ctx, argv, 2);
    double maxw = argc > 3 && !JS_IsUndefined(argv[3]) ? argd(ctx, argv, 3) : 0;
    Run *run = malloc(sizeof *run);
    double size = c->st.fsize;
    layout_run(font, size, s, run);
    JS_FreeCString(ctx, s);

    double sx = 1;
    if (maxw > 0 && run->width > maxw) sx = maxw / run->width;
    double pen = x;
    if (c->st.align == 1) pen -= run->width * sx / 2;
    else if (c->st.align == 2) pen -= run->width * sx;
    int asc = 0, desc = 0, gap = 0;
    stbtt_GetFontVMetrics(&g_fonts[font].info, &asc, &desc, &gap);
    double scale = stbtt_ScaleForMappingEmToPixels(&g_fonts[font].info, (float)size);
    double base = y;
    if (c->st.baseline == 1 || c->st.baseline == 4) base = y + asc * scale;
    else if (c->st.baseline == 2) base = y + (asc + desc) * scale / 2;
    else if (c->st.baseline == 3 || c->st.baseline == 5) base = y + desc * scale;

    const Paint *paint = stroke ? &c->st.stroke : &c->st.fill;
    PaintRow pr;
    paint_inverse(c, paint, &pr);
    double stroke_r = stroke ? c->st.lw * fmax(c->st.m[0], c->st.m[3]) / 2 : 0;
    for (int i = 0; i < run->n; i++) {
        const GlyphEntry *g = glyph_get(font, run->cps[i], scale * sx, scale, size, stroke_r);
        if (g->bm) {
            double ox, oy;
            tf_point(c->st.m, pen, base, &ox, &oy);
            int gx = (int)floor(ox + 0.5) + g->xoff, gy = (int)floor(oy + 0.5) + g->yoff;
            for (int yy = 0; yy < g->h; yy++)
                for (int xx = 0; xx < g->w; xx++) {
                    int cov = g->bm[yy * g->w + xx];
                    if (!cov) continue;
                    RGBA col = paint->g ? paint_at(paint, pr.inv, gx + xx + 0.5, gy + yy + 0.5) : paint->c;
                    put_px(c, gx + xx, gy + yy, col, cov);
                }
        }
        pen += run->adv[i] * sx;
    }
    free(run);
    return JS_UNDEFINED;
}
static JSValue c2d_fillText(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) { return draw_text(ctx, self, argc, argv, 0); }
static JSValue c2d_strokeText(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) { return draw_text(ctx, self, argc, argv, 1); }

/* ---- registration ------------------------------------------------------------------------------ */

static JSValue nx_create_surface(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int w = 0, h = 0;
    JS_ToInt32(ctx, &w, argv[0]);
    JS_ToInt32(ctx, &h, argv[1]);
    if (w > 16384 || h > 16384 || (int64_t)w * h > 64 * 1024 * 1024) return JS_ThrowRangeError(ctx, "canvas too large");
    JSValue o = JS_NewObjectClass(ctx, surface_class);
    JS_SetOpaque(o, surface_new(w, h));
    return o;
}
static JSValue nx_surface_resize(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Surface *s = JS_GetOpaque2(ctx, argv[0], surface_class);
    if (!s) return JS_EXCEPTION;
    int w = 0, h = 0;
    JS_ToInt32(ctx, &w, argv[1]);
    JS_ToInt32(ctx, &h, argv[2]);
    if (w < 0 || h < 0 || w > 16384 || h > 16384 || (int64_t)w * h > 64 * 1024 * 1024) return JS_ThrowRangeError(ctx, "canvas too large");
    buf_unref(s->b);                         /* old pixels live on only through any ArrayBuffer view */
    s->b = buf_new((size_t)w * h * 4);
    s->w = w;
    s->h = h;
    return JS_UNDEFINED;
}
static JSValue nx_surface_buffer(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Surface *s = JS_GetOpaque2(ctx, argv[0], surface_class);
    if (!s) return JS_EXCEPTION;
    s->b->refs++;
    return JS_NewArrayBuffer(ctx, s->b->px, (size_t)s->w * s->h * 4, 0, buffer_realloc, s->b, 0);
}
static JSValue nx_surface_from_rgba(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    size_t len;
    const uint8_t *src = view_bytes(ctx, argv[0], &len);
    int w = 0, h = 0;
    JS_ToInt32(ctx, &w, argv[1]);
    JS_ToInt32(ctx, &h, argv[2]);
    if (!src || w <= 0 || h <= 0 || len < (size_t)w * h * 4) return JS_ThrowTypeError(ctx, "surfaceFromRGBA: bad buffer");
    Surface *s = surface_new(w, h);
    memcpy(s->b->px, src, (size_t)w * h * 4);
    JSValue o = JS_NewObjectClass(ctx, surface_class);
    JS_SetOpaque(o, s);
    return o;
}
/* decodeImage(bytes) -> {surface, width, height} or null. PNG only (what MV ships). The decoder's
 * malloc'd RGBA buffer becomes the surface's pixel store without a copy. */
static JSValue nx_decode_image(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    size_t len = 0;
    const uint8_t *src = argc ? view_bytes(ctx, argv[0], &len) : NULL;
    if (!src || len < 8 || len > 0x7fffffff) return JS_NULL;
    int w = 0, h = 0, n = 0;
    uint8_t *px = stbi_load_from_memory(src, (int)len, &w, &h, &n, 4);
    if (!px) return JS_NULL;
    Surface *s = malloc(sizeof *s);
    s->b = malloc(sizeof(Buf));
    s->b->px = px;
    s->b->refs = 1;
    s->w = w; s->h = h; s->refs = 1;
    JSValue so = JS_NewObjectClass(ctx, surface_class);
    JS_SetOpaque(so, s);
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "surface", so);
    JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, h));
    return o;
}

static JSValue nx_create_context(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    Surface *s = JS_GetOpaque2(ctx, argv[0], surface_class);
    if (!s) return JS_EXCEPTION;
    Ctx *c = calloc(1, sizeof *c);
    c->s = s;
    s->refs++;
    state_init(&c->st);
    JSValue o = JS_NewObjectClass(ctx, ctx_class);
    JS_SetOpaque(o, c);
    if (argc > 1) JS_SetPropertyStr(ctx, o, "canvas", JS_DupValue(ctx, argv[1]));
    return o;
}
static JSValue nx_register_font(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *fam = JS_ToCString(ctx, argv[0]), *path = JS_ToCString(ctx, argv[1]);
    int ok = fam && path && register_font(fam, path);
    if (fam) JS_FreeCString(ctx, fam);
    if (path) JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

#define GS(name, magic) JS_CGETSET_MAGIC_DEF(name, style_get, style_set, magic)
static const JSCFunctionListEntry k_ctx_funcs[] = {
    GS("fillStyle", P_FILL), GS("strokeStyle", P_STROKE), GS("globalAlpha", P_ALPHA),
    GS("globalCompositeOperation", P_COMP), GS("lineWidth", P_LW), GS("lineJoin", P_JOIN), GS("font", P_FONT),
    GS("textAlign", P_ALIGN), GS("textBaseline", P_BASELINE), GS("imageSmoothingEnabled", P_SMOOTH),
    JS_CFUNC_DEF("save", 0, c2d_save), JS_CFUNC_DEF("restore", 0, c2d_restore),
    JS_CFUNC_DEF("setTransform", 6, c2d_setTransform), JS_CFUNC_DEF("resetTransform", 0, c2d_resetTransform),
    JS_CFUNC_DEF("transform", 6, c2d_transform), JS_CFUNC_DEF("translate", 2, c2d_translate),
    JS_CFUNC_DEF("scale", 2, c2d_scale), JS_CFUNC_DEF("rotate", 1, c2d_rotate),
    JS_CFUNC_DEF("beginPath", 0, c2d_beginPath), JS_CFUNC_DEF("closePath", 0, c2d_closePath),
    JS_CFUNC_DEF("moveTo", 2, c2d_moveTo), JS_CFUNC_DEF("lineTo", 2, c2d_lineTo), JS_CFUNC_DEF("rect", 4, c2d_rect),
    JS_CFUNC_DEF("arc", 6, c2d_arc), JS_CFUNC_DEF("quadraticCurveTo", 4, c2d_quadraticCurveTo),
    JS_CFUNC_DEF("bezierCurveTo", 6, c2d_bezierCurveTo),
    JS_CFUNC_DEF("fill", 0, c2d_fill), JS_CFUNC_DEF("stroke", 0, c2d_stroke), JS_CFUNC_DEF("clip", 0, c2d_clip),
    JS_CFUNC_DEF("fillRect", 4, c2d_fillRect), JS_CFUNC_DEF("strokeRect", 4, c2d_strokeRect),
    JS_CFUNC_DEF("clearRect", 4, c2d_clearRect), JS_CFUNC_DEF("drawImage", 9, c2d_drawImage),
    JS_CFUNC_DEF("getImageData", 4, c2d_getImageData), JS_CFUNC_DEF("putImageData", 3, c2d_putImageData),
    JS_CFUNC_DEF("createImageData", 2, c2d_createImageData), JS_CFUNC_DEF("__adjustTone", 3, c2d_adjustTone), JS_CFUNC_DEF("__blur", 1, c2d_blur),
    JS_CFUNC_DEF("createLinearGradient", 4, c2d_createLinearGradient),
    JS_CFUNC_DEF("createRadialGradient", 6, c2d_createRadialGradient),
    JS_CFUNC_DEF("measureText", 1, c2d_measureText), JS_CFUNC_DEF("fillText", 4, c2d_fillText),
    JS_CFUNC_DEF("strokeText", 4, c2d_strokeText),
};

void js_canvas_init(JSContext *ctx, JSValueConst nx) {
    JSRuntime *rt = JS_GetRuntime(ctx);
    {   /* classes are per runtime: registered again on a soft restart (the class ids stay the same) */
        JS_NewClassID(rt, &surface_class);
        JSClassDef sdef = {"Surface", surface_finalizer};
        JS_NewClass(rt, surface_class, &sdef);
        JS_NewClassID(rt, &ctx_class);
        JSClassDef cdef = {"CanvasRenderingContext2D", ctx_finalizer};
        JS_NewClass(rt, ctx_class, &cdef);
        JS_NewClassID(rt, &grad_class);
        JSClassDef gdef = {"CanvasGradient", grad_finalizer};
        JS_NewClass(rt, grad_class, &gdef);
    }
    JSValue proto = JS_NewObject(ctx);
    JS_SetPropertyFunctionList(ctx, proto, k_ctx_funcs, sizeof k_ctx_funcs / sizeof k_ctx_funcs[0]);
    JS_SetClassProto(ctx, ctx_class, proto);
    JSValue gproto = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, gproto, "addColorStop", JS_NewCFunction(ctx, grad_addColorStop, "addColorStop", 2));
    JS_SetClassProto(ctx, grad_class, gproto);

    JS_SetPropertyStr(ctx, nx, "createSurface", JS_NewCFunction(ctx, nx_create_surface, "createSurface", 2));
    JS_SetPropertyStr(ctx, nx, "surfaceResize", JS_NewCFunction(ctx, nx_surface_resize, "surfaceResize", 3));
    JS_SetPropertyStr(ctx, nx, "surfaceBuffer", JS_NewCFunction(ctx, nx_surface_buffer, "surfaceBuffer", 1));
    JS_SetPropertyStr(ctx, nx, "surfaceFromRGBA", JS_NewCFunction(ctx, nx_surface_from_rgba, "surfaceFromRGBA", 3));
    JS_SetPropertyStr(ctx, nx, "decodeImage", JS_NewCFunction(ctx, nx_decode_image, "decodeImage", 1));
    JS_SetPropertyStr(ctx, nx, "createContext", JS_NewCFunction(ctx, nx_create_context, "createContext", 2));
    JS_SetPropertyStr(ctx, nx, "registerFont", JS_NewCFunction(ctx, nx_register_font, "registerFont", 2));
}
