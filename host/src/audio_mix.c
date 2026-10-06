/* See audio_mix.h. Each playing sound is a "voice" with its own libvorbis decoder over the sound's
 * compressed bytes, decoded on demand in chunks as the mixer reads it, so a five-minute BGM starts at
 * once and costs a few MB. Sources are linearly resampled to 48 kHz; looping seeks the decoder to the
 * loop start. All voice state is guarded by one mutex (JS thread calls in, audio thread mixes). */
#include "audio_mix.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include <vorbis/vorbisfile.h>

#ifdef __SWITCH__
#include <switch.h>
typedef Mutex AMutex;
#define AM_LOCK(m) mutexLock(m)
#define AM_UNLOCK(m) mutexUnlock(m)
static AMutex g_mutex;
#else
#include <pthread.h>
typedef pthread_mutex_t AMutex;
#define AM_LOCK(m) pthread_mutex_lock(m)
#define AM_UNLOCK(m) pthread_mutex_unlock(m)
static AMutex g_mutex = PTHREAD_MUTEX_INITIALIZER;
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* ---- sounds: compressed bytes + stream facts ----------------------------------------------------- */

typedef struct {
    uint8_t *data;
    size_t size;
    int channels, rate;
    int64_t frames;
    int used;
} Sound;

#define MAX_SOUNDS 512
static Sound g_sounds[MAX_SOUNDS];

typedef struct { const uint8_t *data; size_t size, pos; } MemSrc;

static size_t mem_read(void *ptr, size_t sz, size_t n, void *ds) {
    MemSrc *m = ds;
    size_t want = sz * n, left = m->size - m->pos;
    if (want > left) want = left;
    memcpy(ptr, m->data + m->pos, want);
    m->pos += want;
    return sz ? want / sz : 0;
}
static int mem_seek(void *ds, ogg_int64_t off, int whence) {
    MemSrc *m = ds;
    ogg_int64_t base = whence == SEEK_SET ? 0 : whence == SEEK_CUR ? (ogg_int64_t)m->pos : (ogg_int64_t)m->size;
    ogg_int64_t p = base + off;
    if (p < 0 || p > (ogg_int64_t)m->size) return -1;
    m->pos = (size_t)p;
    return 0;
}
static int mem_close(void *ds) { return 0; }
static long mem_tell(void *ds) { return (long)((MemSrc *)ds)->pos; }
static const ov_callbacks k_mem_cb = {mem_read, mem_seek, mem_close, mem_tell};

/* ---- voices -------------------------------------------------------------------------------------- */

#define MAX_VOICES 24
#define CHUNK 8192                      /* decoded frames held per voice */

typedef struct {
    int used, sound;
    OggVorbis_File vf;
    MemSrc src;
    int vf_open, channels, rate, eof;
    int64_t total;
    int loop;
    double loop_start, loop_end;        /* source frames */
    double vol, pitch, pan;
    double pos;                         /* source frame position of the next output sample */
    float *buf[2];                      /* decoded window: frames [buf_start, buf_start + buf_len) */
    int64_t buf_start;
    int buf_len;
    int64_t dec_next;                   /* frame index the decoder will produce next */
    uint32_t gen;
} Voice;

static Voice g_voices[MAX_VOICES];
static uint32_t g_gen;

static void voice_free(Voice *v) {
    if (v->vf_open) ov_clear(&v->vf);
    free(v->buf[0]);
    free(v->buf[1]);
    memset(v, 0, sizeof *v);
}

/* Decode forward from the decoder's current position into the window. keep: carry the last frame of the
 * old window as frame 0 so interpolation across the boundary stays exact. */
static void voice_fill(Voice *v, int keep) {
    int base = 0;
    if (keep && v->buf_len > 0) {
        for (int c = 0; c < 2; c++) v->buf[c][0] = v->buf[c][v->buf_len - 1];
        v->buf_start += v->buf_len - 1;
        base = 1;
    } else {
        v->buf_start = v->dec_next;
    }
    int got = 0;
    while (base + got < CHUNK) {
        float **pcm;
        int bs;
        long n = ov_read_float(&v->vf, &pcm, CHUNK - base - got, &bs);
        if (n <= 0) { v->eof = 1; break; }
        for (long i = 0; i < n; i++) {
            v->buf[0][base + got + i] = pcm[0][i];
            v->buf[1][base + got + i] = v->channels > 1 ? pcm[1][i] : pcm[0][i];
        }
        got += (int)n;
        v->dec_next += n;
    }
    v->buf_len = base + got;
}

static void voice_seek(Voice *v, int64_t frame) {
    if (frame < 0) frame = 0;
    if (frame >= v->total) frame = v->total > 0 ? v->total - 1 : 0;
    ov_pcm_seek(&v->vf, frame);
    v->dec_next = frame;
    v->eof = 0;
    v->buf_len = 0;
    voice_fill(v, 0);
}

static int voice_has(const Voice *v, int64_t frame) {
    return frame >= v->buf_start && frame < v->buf_start + v->buf_len;
}

/* Make `frame` available in the window (sequential reads just decode on; anything else seeks). */
static int voice_ensure(Voice *v, int64_t frame) {
    if (voice_has(v, frame)) return 1;
    if (frame >= v->total) return 0;
    if (frame == v->buf_start + v->buf_len && !v->eof) { voice_fill(v, 1); return voice_has(v, frame); }
    voice_seek(v, frame);
    return voice_has(v, frame);
}

static void pan_gains(const Voice *v, double *gl, double *gr) {
    double p = v->pan < -1 ? -1 : v->pan > 1 ? 1 : v->pan;
    if (v->channels == 1) {                          /* mono: equal-power law, centre is -3 dB, as in Web Audio */
        double x = (p + 1) / 2;
        *gl = cos(x * M_PI / 2);
        *gr = sin(x * M_PI / 2);
    } else {                                          /* stereo: unity at centre, attenuate the far side */
        *gl = p > 0 ? cos(p * M_PI / 2) : 1;
        *gr = p < 0 ? cos(-p * M_PI / 2) : 1;
    }
}

void audio_render(int16_t *out, int frames) {
    static float *mix;
    static int mix_cap;
    if (frames > mix_cap) { free(mix); mix = malloc(sizeof(float) * 2 * frames); mix_cap = frames; }
    memset(mix, 0, sizeof(float) * 2 * frames);

    AM_LOCK(&g_mutex);
    for (int vi = 0; vi < MAX_VOICES; vi++) {
        Voice *v = &g_voices[vi];
        if (!v->used) continue;
        double step = (double)v->rate / AUDIO_RATE * v->pitch, gl, gr;
        pan_gains(v, &gl, &gr);
        gl *= v->vol;
        gr *= v->vol;
        int done = 0;
        for (int i = 0; i < frames && !done; i++) {
            if (v->loop && v->loop_end > v->loop_start && v->pos >= v->loop_end) {
                v->pos = v->loop_start + fmod(v->pos - v->loop_end, v->loop_end - v->loop_start);
            }
            int64_t i0 = (int64_t)v->pos;
            if (i0 >= v->total || !voice_ensure(v, i0)) { done = 1; break; }
            double f = v->pos - (double)i0;
            int a = (int)(i0 - v->buf_start), b = a;
            if (a + 1 < v->buf_len) b = a + 1;
            else if (!v->eof && voice_ensure(v, i0 + 1)) { a = (int)(i0 - v->buf_start); b = a + 1; }   /* decoding on shifts the window */
            float l = v->buf[0][a] + (v->buf[0][b] - v->buf[0][a]) * (float)f;
            float r = v->buf[1][a] + (v->buf[1][b] - v->buf[1][a]) * (float)f;
            mix[2 * i] += l * (float)gl;
            mix[2 * i + 1] += r * (float)gr;
            v->pos += step;
        }
        if (done) voice_free(v);
    }
    AM_UNLOCK(&g_mutex);

    for (int i = 0; i < frames * 2; i++) {
        float s = mix[i];
        s = s > 1.0f ? 1.0f : s < -1.0f ? -1.0f : s;
        out[i] = (int16_t)(s * 32767.0f);
    }
}

void audio_shutdown(void) {
    AM_LOCK(&g_mutex);
    for (int i = 0; i < MAX_VOICES; i++) if (g_voices[i].used) voice_free(&g_voices[i]);
    for (int i = 0; i < MAX_SOUNDS; i++) if (g_sounds[i].used) { free(g_sounds[i].data); memset(&g_sounds[i], 0, sizeof(Sound)); }
    AM_UNLOCK(&g_mutex);
}

/* ---- JS bindings --------------------------------------------------------------------------------- */

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
static double argd(JSContext *ctx, JSValueConst *argv, int i) {
    double d = 0;
    JS_ToFloat64(ctx, &d, argv[i]);
    return d;
}

static JSValue au_load(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    size_t len = 0;
    const uint8_t *src = argc ? view_bytes(ctx, argv[0], &len) : NULL;
    if (!src || len < 64) return JS_NULL;
    uint8_t *copy = malloc(len);
    memcpy(copy, src, len);
    MemSrc ms = {copy, len, 0};
    OggVorbis_File vf;
    if (ov_open_callbacks(&ms, &vf, NULL, 0, k_mem_cb) < 0) { free(copy); return JS_NULL; }
    vorbis_info *vi = ov_info(&vf, -1);
    int ch = vi->channels, rate = (int)vi->rate;
    int64_t total = ov_pcm_total(&vf, -1);
    ov_clear(&vf);
    if (ch < 1 || ch > 2 || rate <= 0 || total <= 0) { free(copy); return JS_NULL; }

    AM_LOCK(&g_mutex);
    int id = -1;
    for (int i = 1; i < MAX_SOUNDS; i++) if (!g_sounds[i].used) { id = i; break; }
    if (id > 0) g_sounds[id] = (Sound){copy, len, ch, rate, total, 1};
    AM_UNLOCK(&g_mutex);
    if (id < 0) { free(copy); return JS_NULL; }

    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewInt32(ctx, id));
    JS_SetPropertyStr(ctx, o, "channels", JS_NewInt32(ctx, ch));
    JS_SetPropertyStr(ctx, o, "rate", JS_NewInt32(ctx, rate));
    JS_SetPropertyStr(ctx, o, "length", JS_NewFloat64(ctx, (double)total));
    JS_SetPropertyStr(ctx, o, "duration", JS_NewFloat64(ctx, (double)total / rate));
    return o;
}

static JSValue au_release(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int32_t id = 0;
    JS_ToInt32(ctx, &id, argv[0]);
    AM_LOCK(&g_mutex);
    if (id > 0 && id < MAX_SOUNDS && g_sounds[id].used) {
        for (int i = 0; i < MAX_VOICES; i++) if (g_voices[i].used && g_voices[i].sound == id) voice_free(&g_voices[i]);
        free(g_sounds[id].data);
        memset(&g_sounds[id], 0, sizeof(Sound));
    }
    AM_UNLOCK(&g_mutex);
    return JS_UNDEFINED;
}

static JSValue au_play(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int32_t id = 0;
    JS_ToInt32(ctx, &id, argv[0]);
    int loop = JS_ToBool(ctx, argv[1]);
    double ls = argd(ctx, argv, 2), le = argd(ctx, argv, 3), off = argd(ctx, argv, 4);
    double vol = argd(ctx, argv, 5), pitch = argd(ctx, argv, 6), pan = argd(ctx, argv, 7);

    AM_LOCK(&g_mutex);
    int voice = 0;
    if (id > 0 && id < MAX_SOUNDS && g_sounds[id].used) {
        Sound *s = &g_sounds[id];
        int slot = -1;
        for (int i = 0; i < MAX_VOICES; i++) if (!g_voices[i].used) { slot = i; break; }
        if (slot < 0) {                              /* all busy: steal the oldest voice */
            uint32_t oldest = 0xffffffffu;
            for (int i = 0; i < MAX_VOICES; i++) if (g_voices[i].gen < oldest) { oldest = g_voices[i].gen; slot = i; }
            voice_free(&g_voices[slot]);
        }
        Voice *v = &g_voices[slot];
        memset(v, 0, sizeof *v);
        v->src = (MemSrc){s->data, s->size, 0};
        if (ov_open_callbacks(&v->src, &v->vf, NULL, 0, k_mem_cb) == 0) {
            v->vf_open = 1;
            v->used = 1;
            v->sound = id;
            v->channels = s->channels;
            v->rate = s->rate;
            v->total = s->frames;
            v->loop = loop;
            v->loop_start = ls * s->rate;
            v->loop_end = le * s->rate;
            if (v->loop_end <= 0 || v->loop_end > (double)s->frames) v->loop_end = (double)s->frames;
            if (v->loop_start < 0 || v->loop_start >= v->loop_end) v->loop_start = 0;
            v->vol = vol;
            v->pitch = pitch > 0 ? pitch : 1;
            v->pan = pan;
            v->buf[0] = malloc(sizeof(float) * CHUNK);
            v->buf[1] = malloc(sizeof(float) * CHUNK);
            v->gen = ++g_gen;
            double start = off * s->rate;
            if (start < 0) start = 0;
            if (start >= (double)s->frames) start = 0;
            v->pos = start;
            voice_seek(v, (int64_t)start);
            voice = slot + 1;
        } else {
            memset(v, 0, sizeof *v);
        }
    }
    AM_UNLOCK(&g_mutex);
    return JS_NewInt32(ctx, voice);
}

static Voice *voice_of(JSContext *ctx, JSValueConst a) {
    int32_t n = 0;
    JS_ToInt32(ctx, &n, a);
    if (n < 1 || n > MAX_VOICES || !g_voices[n - 1].used) return NULL;
    return &g_voices[n - 1];
}
static JSValue au_stop(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    AM_LOCK(&g_mutex);
    Voice *v = voice_of(ctx, argv[0]);
    if (v) voice_free(v);
    AM_UNLOCK(&g_mutex);
    return JS_UNDEFINED;
}
static JSValue au_set_params(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    AM_LOCK(&g_mutex);
    Voice *v = voice_of(ctx, argv[0]);
    if (v) { v->vol = argd(ctx, argv, 1); v->pitch = argd(ctx, argv, 2) > 0 ? argd(ctx, argv, 2) : 1; v->pan = argd(ctx, argv, 3); }
    AM_UNLOCK(&g_mutex);
    return JS_UNDEFINED;
}
static JSValue au_is_playing(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    AM_LOCK(&g_mutex);
    int on = voice_of(ctx, argv[0]) != NULL;
    AM_UNLOCK(&g_mutex);
    return JS_NewBool(ctx, on);
}
static JSValue au_position(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    AM_LOCK(&g_mutex);
    Voice *v = voice_of(ctx, argv[0]);
    double p = v ? v->pos / v->rate : -1;
    AM_UNLOCK(&g_mutex);
    return JS_NewFloat64(ctx, p);
}
static JSValue au_render(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    int32_t n = 0;
    JS_ToInt32(ctx, &n, argv[0]);
    if (n <= 0 || n > 1 << 20) return JS_ThrowRangeError(ctx, "render: bad frame count");
    int16_t *pcm = malloc(sizeof(int16_t) * 2 * n);
    audio_render(pcm, n);
    JSValue ab = JS_NewArrayBufferCopy(ctx, (const uint8_t *)pcm, sizeof(int16_t) * 2 * n);
    free(pcm);
    JSValue arg = ab;
    JSValue ta = JS_NewTypedArray(ctx, 1, &arg, JS_TYPED_ARRAY_INT16);
    JS_FreeValue(ctx, ab);
    return ta;
}

void js_audio_init(JSContext *ctx, JSValueConst nx) {
    JSValue a = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, a, "load", JS_NewCFunction(ctx, au_load, "load", 1));
    JS_SetPropertyStr(ctx, a, "release", JS_NewCFunction(ctx, au_release, "release", 1));
    JS_SetPropertyStr(ctx, a, "play", JS_NewCFunction(ctx, au_play, "play", 8));
    JS_SetPropertyStr(ctx, a, "stop", JS_NewCFunction(ctx, au_stop, "stop", 1));
    JS_SetPropertyStr(ctx, a, "setParams", JS_NewCFunction(ctx, au_set_params, "setParams", 4));
    JS_SetPropertyStr(ctx, a, "isPlaying", JS_NewCFunction(ctx, au_is_playing, "isPlaying", 1));
    JS_SetPropertyStr(ctx, a, "position", JS_NewCFunction(ctx, au_position, "position", 1));
    JS_SetPropertyStr(ctx, a, "render", JS_NewCFunction(ctx, au_render, "render", 1));
    JS_SetPropertyStr(ctx, nx, "audio", a);
}
