#include "audio_out.h"

#include <stdlib.h>
#include <string.h>

#include <switch.h>

#include "audio_mix.h"

#define FRAMES 1024                                  /* ~21 ms per buffer */
#define NBUF 3
#define ALIGN4K(x) (((x) + 0xfff) & ~0xfffu)

static AudioOutBuffer g_buf[NBUF];
static void *g_mem[NBUF];
static Thread g_thread;
static volatile int g_stop, g_running;

/* Refill and re-queue every buffer the service is no longer holding. Checking each one (instead of
 * trusting the single pointer a wait returns) means a late wake-up that released two cannot lose one. */
static void top_up(void) {
    for (int i = 0; i < NBUF; i++) {
        bool queued = false;
        if (R_FAILED(audoutContainsAudioOutBuffer(&g_buf[i], &queued)) || queued) continue;
        audio_render(g_mem[i], FRAMES);
        g_buf[i].next = NULL;
        g_buf[i].buffer = g_mem[i];
        g_buf[i].buffer_size = ALIGN4K(FRAMES * 4);
        g_buf[i].data_size = FRAMES * 4;
        g_buf[i].data_offset = 0;
        audoutAppendAudioOutBuffer(&g_buf[i]);
    }
}

static void out_thread(void *arg) {
    (void)arg;
    top_up();
    while (!g_stop) {
        AudioOutBuffer *released = NULL;
        u32 n = 0;
        audoutWaitPlayFinish(&released, &n, 100000000ULL);
        top_up();
    }
}

unsigned long long audio_out_played(void) {
    u64 n = 0;
    if (g_running) audoutGetAudioOutPlayedSampleCount(&n);
    return n;
}

int audio_out_start(void) {
    if (g_running) return 0;
    Result rc = audoutInitialize();
    if (R_FAILED(rc)) return (int)rc ? (int)rc : -1;
    rc = audoutStartAudioOut();
    if (R_FAILED(rc)) { audoutExit(); return (int)rc ? (int)rc : -1; }
    for (int i = 0; i < NBUF; i++) {
        g_mem[i] = aligned_alloc(0x1000, ALIGN4K(FRAMES * 4));
        memset(g_mem[i], 0, ALIGN4K(FRAMES * 4));
        memset(&g_buf[i], 0, sizeof g_buf[i]);
    }
    g_stop = 0;
    if (R_FAILED(threadCreate(&g_thread, out_thread, NULL, NULL, 0x10000, 0x20, 1))) return -2;
    threadStart(&g_thread);
    g_running = 1;
    return 0;
}

void audio_out_stop(void) {
    if (!g_running) return;
    g_stop = 1;
    threadWaitForExit(&g_thread);
    threadClose(&g_thread);
    audoutStopAudioOut();
    audoutExit();
    for (int i = 0; i < NBUF; i++) free(g_mem[i]);
    g_running = 0;
}
