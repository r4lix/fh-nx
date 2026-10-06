#pragma once
#include <stdint.h>
#include "quickjs.h"

/* Software mixer + Ogg Vorbis streaming decoder behind MV's Web Audio calls. Platform-neutral: the
 * Switch host feeds audio_render() from an audout thread, the PC tests call it directly.
 *
 * JS side (`nx.audio`):
 *   load(arrayBuffer)  -> {id, channels, rate, length, duration} | null     (parses headers; keeps the bytes)
 *   release(id)
 *   play(id, loop, loopStartSec, loopEndSec, offsetSec, volume, pitch, pan) -> voice (> 0) | 0
 *   stop(voice)   setParams(voice, volume, pitch, pan)   isPlaying(voice)   position(voice) -> seconds
 *   render(frames) -> Int16Array of interleaved stereo (tests only)
 * Output format is 48 kHz signed 16-bit stereo. */
#define AUDIO_RATE 48000

void js_audio_init(JSContext *ctx, JSValueConst nx);
void audio_render(int16_t *out, int frames);      /* mix `frames` stereo frames; thread-safe */
void audio_shutdown(void);
