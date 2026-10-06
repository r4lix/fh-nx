// Renders the mods menu to a PPM with a tiny software rasterizer (no GPU, no backend), so the
// layout can be looked at on the PC.   ui_snapshot <mods dir> <out.ppm> [select-mod-id-to-enable...]
#include "../src/menu/ModMenuUi.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

struct Tex { std::vector<unsigned char> rgba; int w = 0, h = 0; };

static void tri(std::vector<unsigned char>& fb, int W, int H, const Tex& tex, const ImDrawVert& a,
                const ImDrawVert& b, const ImDrawVert& c, ImVec4 clip) {
    float minx = std::min({a.pos.x, b.pos.x, c.pos.x}), maxx = std::max({a.pos.x, b.pos.x, c.pos.x});
    float miny = std::min({a.pos.y, b.pos.y, c.pos.y}), maxy = std::max({a.pos.y, b.pos.y, c.pos.y});
    int x0 = std::max((int)std::floor(minx), (int)clip.x), x1 = std::min((int)std::ceil(maxx), (int)clip.z);
    int y0 = std::max((int)std::floor(miny), (int)clip.y), y1 = std::min((int)std::ceil(maxy), (int)clip.w);
    x0 = std::max(x0, 0); y0 = std::max(y0, 0); x1 = std::min(x1, W); y1 = std::min(y1, H);
    float d = (b.pos.y - c.pos.y) * (a.pos.x - c.pos.x) + (c.pos.x - b.pos.x) * (a.pos.y - c.pos.y);
    if (std::fabs(d) < 1e-6f) return;
    for (int y = y0; y < y1; y++)
        for (int x = x0; x < x1; x++) {
            float px = x + 0.5f, py = y + 0.5f;
            float l1 = ((b.pos.y - c.pos.y) * (px - c.pos.x) + (c.pos.x - b.pos.x) * (py - c.pos.y)) / d;
            float l2 = ((c.pos.y - a.pos.y) * (px - c.pos.x) + (a.pos.x - c.pos.x) * (py - c.pos.y)) / d;
            float l3 = 1 - l1 - l2;
            if (l1 < -0.001f || l2 < -0.001f || l3 < -0.001f) continue;
            float u = l1 * a.uv.x + l2 * b.uv.x + l3 * c.uv.x, v = l1 * a.uv.y + l2 * b.uv.y + l3 * c.uv.y;
            int tx = std::clamp((int)(u * tex.w), 0, tex.w - 1), ty = std::clamp((int)(v * tex.h), 0, tex.h - 1);
            const unsigned char* t = &tex.rgba[(ty * tex.w + tx) * 4];
            auto ch = [&](int s) { return (float)((a.col >> s) & 255) * l1 + (float)((b.col >> s) & 255) * l2 + (float)((c.col >> s) & 255) * l3; };
            float sr = ch(0) * t[0] / 255.f, sg = ch(8) * t[1] / 255.f, sb = ch(16) * t[2] / 255.f, sa = ch(24) * t[3] / 255.f / 255.f;
            unsigned char* o = &fb[(y * W + x) * 3];
            o[0] = (unsigned char)(o[0] * (1 - sa) + sr * sa);
            o[1] = (unsigned char)(o[1] * (1 - sa) + sg * sa);
            o[2] = (unsigned char)(o[2] * (1 - sa) + sb * sa);
        }
}

int main(int argc, char** argv) {
    if (argc < 3) { std::fprintf(stderr, "usage: ui_snapshot <mods dir> <out.ppm> [enable-id...]\n"); return 1; }
    const int W = 1280, H = 720;

    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    ImFontConfig fc; fc.SizePixels = 20.f;
    io.Fonts->AddFontDefault(&fc);
    Tex tex;
    unsigned char* px;
    io.Fonts->GetTexDataAsRGBA32(&px, &tex.w, &tex.h);
    tex.rgba.assign(px, px + (size_t)tex.w * tex.h * 4);
    ImGui::StyleColorsDark();

    ModManager mm;
    mm.scan(argv[1]);
    for (int i = 3; i < argc; i++) mm.setEnabled(argv[i], true);
    ModMenuModel model(mm, "snapshot.ini.unused");
    ModMenuUi ui(model);

    for (int f = 0; f < 3; f++) {
        io.DisplaySize = ImVec2(W, H);
        io.DeltaTime = 1.f / 60.f;
        ImGui::NewFrame();
        ui.draw({"Fear & Hunger NX, version 0.1.0", "Time: 18:26:04 - Fps: 60.00"}, ImVec2(W, H));
        ImGui::Render();
    }

    std::vector<unsigned char> fb((size_t)W * H * 3);
    for (size_t i = 0; i < fb.size(); i += 3) { fb[i] = 40; fb[i + 1] = 30; fb[i + 2] = 50; }
    ImDrawData* dd = ImGui::GetDrawData();
    for (int n = 0; n < dd->CmdListsCount; n++) {
        const ImDrawList* dl = dd->CmdLists[n];
        for (const ImDrawCmd& cmd : dl->CmdBuffer)
            for (unsigned i = cmd.IdxOffset; i + 2 < cmd.IdxOffset + cmd.ElemCount; i += 3)
                tri(fb, W, H, tex, dl->VtxBuffer[dl->IdxBuffer[i] + cmd.VtxOffset], dl->VtxBuffer[dl->IdxBuffer[i + 1] + cmd.VtxOffset],
                    dl->VtxBuffer[dl->IdxBuffer[i + 2] + cmd.VtxOffset], cmd.ClipRect);
    }
    FILE* o = std::fopen(argv[2], "wb");
    std::fprintf(o, "P6\n%d %d\n255\n", W, H);
    std::fwrite(fb.data(), 1, fb.size(), o);
    std::fclose(o);
    ImGui::DestroyContext();
    return 0;
}
