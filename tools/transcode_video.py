#!/usr/bin/env python3
"""Turn a WebM (VP8/VP9 + Vorbis/Opus) into the .fhv container the Switch host plays.

The host has no video decoder, but it can already decode JPEG (stb_image) and Ogg Vorbis (libvorbis), so a movie is
shipped as a sequence of JPEG frames plus one Ogg Vorbis track in a single file:

    u32 little-endian  length H of the JSON header
    H bytes            {"fps": 25, "w": 544, "h": 416, "frames": [[offset, size], ...], "audio": [offset, size]}
    ...                the audio blob and the frames (offsets are from the start of the file)

Needs:  pip install av pillow     Usage:  transcode_video.py in.webm out.fhv [--scale 0.667] [--quality 78]
"""
import argparse
import io
import json
import struct
import sys

import av


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--scale", type=float, default=2 / 3, help="frame size relative to the source (JPEG decode cost on the Switch)")
    ap.add_argument("--quality", type=int, default=78)
    a = ap.parse_args()

    inp = av.open(a.src)
    vs = next(s for s in inp.streams if s.type == "video")
    au = next((s for s in inp.streams if s.type == "audio"), None)
    fps = float(vs.average_rate)
    w = int(round(vs.codec_context.width * a.scale / 2)) * 2
    h = int(round(vs.codec_context.height * a.scale / 2)) * 2

    frames = []
    pcm = []
    for pkt_frame in inp.decode(*[s for s in (vs, au) if s]):
        if isinstance(pkt_frame, av.VideoFrame):
            img = pkt_frame.to_image().resize((w, h))
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=a.quality, optimize=False)
            frames.append(buf.getvalue())
        else:
            pcm.append(pkt_frame)

    audio = b""
    if pcm:
        mem = io.BytesIO()
        out = av.open(mem, "w", format="ogg")
        ast = out.add_stream("vorbis", rate=pcm[0].sample_rate)
        ast.layout = "stereo"
        ast.codec_context.options = {"strict": "-2"}
        ast.bit_rate = 96000
        res = av.AudioResampler(format="fltp", layout="stereo", rate=pcm[0].sample_rate)
        for f in pcm:
            for r in res.resample(f):
                for p in ast.encode(r):
                    out.mux(p)
        for p in ast.encode(None):
            out.mux(p)
        out.close()
        audio = mem.getvalue()

    # lay out: [u32 H][header][audio][frames...]; offsets depend on H, so size the header in two passes
    def build(hdr_len):
        off = 4 + hdr_len
        a_off = off
        off += len(audio)
        table = []
        for f in frames:
            table.append([off, len(f)])
            off += len(f)
        hdr = json.dumps({"fps": fps, "w": w, "h": h, "frames": table, "audio": [a_off, len(audio)]}, separators=(",", ":")).encode()
        return hdr

    hdr = build(0)
    for _ in range(3):
        hdr = build(len(hdr))
    with open(a.dst, "wb") as f:
        f.write(struct.pack("<I", len(hdr)))
        f.write(hdr)
        f.write(audio)
        for fr in frames:
            f.write(fr)
    total = 4 + len(hdr) + len(audio) + sum(len(x) for x in frames)
    print("%d frames %dx%d @ %.2f fps, audio %d KB, file %.1f MB (avg frame %d KB)" % (
        len(frames), w, h, fps, len(audio) // 1024, total / 1048576, sum(len(x) for x in frames) // len(frames) // 1024))


if __name__ == "__main__":
    sys.exit(main())
