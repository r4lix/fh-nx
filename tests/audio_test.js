// Audio mixer host tests: decode, play, loop, volume/pan/pitch, stop. Uses real decrypted game assets
// (build/test_se.ogg, build/test_bgm.ogg, made by tools/decrypt_one.py). Offline: nx.audio.render()
// pulls mixed 48 kHz stereo straight from the mixer.
const nx = globalThis.__nx;
globalThis.__failures = 0;
let checks = 0;
function fail(msg) { globalThis.__failures++; print("FAIL " + msg); }
function ok(name, cond) { checks++; if (!cond) fail(name); }
function near(name, got, want, tol) { checks++; if (Math.abs(got - want) > tol) fail(name + ": got " + got + " want " + want + " +-" + tol); }

function peak(pcm, ch) { let p = 0; for (let i = ch; i < pcm.length; i += 2) p = Math.max(p, Math.abs(pcm[i])); return p; }
function energy(pcm) { let e = 0; for (let i = 0; i < pcm.length; i++) e += pcm[i] * pcm[i]; return e; }

const seBytes = nx.readBinary("build/test_se.ogg"), bgmBytes = nx.readBinary("build/test_bgm.ogg");
ok("test assets present", seBytes && bgmBytes);

// ---- load ------------------------------------------------------------------------------------
const se = nx.audio.load(seBytes);
ok("SE decodes", se && se.id > 0);
print("SE: " + se.channels + "ch " + se.rate + "Hz " + se.duration.toFixed(3) + "s");
ok("SE info plausible", (se.rate === 44100 || se.rate === 48000 || se.rate === 22050) && se.duration > 0.3 && se.duration < 60);
ok("garbage is rejected", nx.audio.load(new ArrayBuffer(4096)) === null);
ok("tiny buffer rejected", nx.audio.load(new ArrayBuffer(8)) === null);
ok("non-buffer rejected", nx.audio.load("x") === null);
const bgm = nx.audio.load(bgmBytes);
ok("BGM decodes", bgm && bgm.id > 0 && bgm.duration > 30);
print("BGM: " + bgm.channels + "ch " + bgm.rate + "Hz " + bgm.duration.toFixed(1) + "s");

const OFF = 2.0;      // the chord fades in from silence, so audibility checks start 2 s in

// ---- one-shot --------------------------------------------------------------------------------
{
  const v = nx.audio.play(se.id, false, 0, 0, 0, 1, 1, 0);
  ok("play returns a voice", v > 0);
  ok("playing", nx.audio.isPlaying(v));
  nx.audio.render(2400);
  near("position advances (0.05 s)", nx.audio.position(v), 0.05, 0.002);
  const audibleV = nx.audio.play(se.id, false, 0, 0, OFF, 1, 1, 0);
  const first = nx.audio.render(4800);
  ok("SE is audible (peak " + peak(first, 0) + ")", peak(first, 0) > 500 || peak(first, 1) > 500);
  nx.audio.stop(audibleV);
  nx.audio.render(Math.ceil(se.duration * 48000) + 4800);
  ok("one-shot ends by itself", !nx.audio.isPlaying(v));
  ok("silence once ended", peak(nx.audio.render(960), 0) === 0);
}

// ---- volume, pan, pitch ---------------------------------------------------------------------
{
  const full = nx.audio.play(se.id, false, 0, 0, OFF, 1, 1, 0);
  const a = nx.audio.render(4800); nx.audio.stop(full);
  const half = nx.audio.play(se.id, false, 0, 0, OFF, 0.5, 1, 0);
  const b = nx.audio.render(4800); nx.audio.stop(half);
  near("volume 0.5 halves the energy^0.5", Math.sqrt(energy(b) / energy(a)), 0.5, 0.02);
  const mute = nx.audio.play(se.id, false, 0, 0, OFF, 0, 1, 0);
  ok("volume 0 is silent", peak(nx.audio.render(4800), 0) === 0); nx.audio.stop(mute);

  const left = nx.audio.play(se.id, false, 0, 0, OFF, 1, 1, -1);
  const l = nx.audio.render(4800); nx.audio.stop(left);
  ok("pan hard left silences the right channel (L " + peak(l, 0) + ", R " + peak(l, 1) + ")", peak(l, 0) > 300 && peak(l, 1) < peak(l, 0) * 0.02);
  const right = nx.audio.play(se.id, false, 0, 0, OFF, 1, 1, 1);
  const r = nx.audio.render(4800); nx.audio.stop(right);
  ok("pan hard right silences the left channel", peak(r, 1) > 300 && peak(r, 0) < peak(r, 1) * 0.02);

  const fast = nx.audio.play(se.id, false, 0, 0, OFF, 1, 2, 0);
  nx.audio.render(4800);
  near("pitch 2 doubles playback speed", nx.audio.position(fast) - OFF, 0.2, 0.004); nx.audio.stop(fast);
  const mid = nx.audio.play(se.id, false, 0, 0, se.duration / 2, 1, 1, 0);
  near("start offset", nx.audio.position(mid), se.duration / 2, 0.002); nx.audio.stop(mid);

  const v = nx.audio.play(se.id, false, 0, 0, OFF, 1, 1, 0);
  nx.audio.setParams(v, 0, 1, 0);
  ok("setParams mutes a live voice", peak(nx.audio.render(2400), 0) === 0);
  nx.audio.setParams(v, 1, 1, 0);
  const back = nx.audio.render(4800);
  ok("setParams unmutes it", peak(back, 0) > 300 || peak(back, 1) > 300);
  nx.audio.stop(v);
  ok("stop ends the voice", !nx.audio.isPlaying(v));
}

// ---- streaming a long track and looping ------------------------------------------------------
{
  const t0 = nx.now();
  const v = nx.audio.play(bgm.id, true, 5.0, 8.0, 0, 1, 1, 0);        // loop 5 s..8 s, like MV's LOOPSTART/LOOPLENGTH
  const startMs = nx.now() - t0;
  ok("BGM starts at once (" + startMs.toFixed(1) + " ms)", startMs < 250);
  let maxPos = 0, audible = 0;
  const t1 = nx.now();
  for (let i = 0; i < 12 * 50; i++) {                                    // 12 s of audio, in 20 ms blocks
    const pcm = nx.audio.render(960);
    if (peak(pcm, 0) > 100) audible++;
    maxPos = Math.max(maxPos, nx.audio.position(v));
  }
  const renderMs = nx.now() - t1;
  ok("loop keeps playing past its end", nx.audio.isPlaying(v));
  ok("loop never runs past loopEnd (max " + maxPos.toFixed(3) + ")", maxPos < 8.0 + 0.03);
  const pos = nx.audio.position(v);
  ok("position wrapped into the loop (" + pos.toFixed(3) + ")", pos >= 5.0 - 0.001 && pos < 8.0);
  ok("music is audible most of the time (" + audible + "/600 blocks)", audible > 300);
  print("decode+mix cost: " + (renderMs / 12).toFixed(1) + " ms per second of audio on this machine (x" + (12000 / renderMs).toFixed(0) + " realtime)");
  nx.audio.stop(v);

  // a seam check: the loop wrap must not produce a click far above the surrounding level
  const w = nx.audio.play(bgm.id, true, 5.0, 6.0, 5.9, 1, 1, 0);
  const seam = nx.audio.render(48000 * 0.6 | 0);
  let maxJump = 0, rms = 0;
  for (let i = 2; i < seam.length; i += 2) { maxJump = Math.max(maxJump, Math.abs(seam[i] - seam[i - 2])); rms += seam[i] * seam[i]; }
  rms = Math.sqrt(rms / (seam.length / 2));
  ok("loop seam has no huge discontinuity (max step " + maxJump + ", rms " + rms.toFixed(0) + ")", maxJump < Math.max(6000, rms * 6));
  nx.audio.stop(w);
}

// ---- many voices ---------------------------------------------------------------------------------
{
  const voices = [];
  for (let i = 0; i < 30; i++) voices.push(nx.audio.play(se.id, false, 0, 0, 0, 0.1, 1, 0));
  ok("more voices than slots does not crash (stole the oldest)", voices.filter((v) => v > 0).length === 30);
  ok("render with a full voice table", nx.audio.render(960).length === 1920);
  for (const v of voices) nx.audio.stop(v);
  nx.audio.release(se.id);
  ok("released sound cannot be played", nx.audio.play(se.id, false, 0, 0, 0, 1, 1, 0) === 0);
  ok("stale voice id is harmless", (nx.audio.stop(9999), true));
}

print(globalThis.__failures ? globalThis.__failures + " FAILED of " + checks + " checks" : "audio: all " + checks + " checks passed");
