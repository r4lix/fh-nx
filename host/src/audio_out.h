#pragma once
/* Switch audio output: an audout thread that pulls 48 kHz stereo s16 from audio_render(). */
int audio_out_start(void);          /* 0 on success, else a libnx result code */
unsigned long long audio_out_played(void);   /* samples the hardware has actually played */
void audio_out_stop(void);
