// Headless test of ModMenuUi: runs the real ImGui layout with no renderer, checks it
// produces geometry, and clicks Apply/Reset through ImGui's input queue.
#include "../src/menu/ModMenuUi.hpp"
#include <cstdio>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static void put(const fs::path& p, const std::string& data) {
    fs::create_directories(p.parent_path());
    std::ofstream(p, std::ios::binary) << data;
}

static const ImVec2 kDisplay(1280, 720);

// One ImGui frame; returns draw-list vertex count and whether Apply fired.
static int frame(ModMenuUi& ui, bool* applied = nullptr) {
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = kDisplay;
    io.DeltaTime = 1.f / 60.f;
    ImGui::NewFrame();
    bool a = ui.draw({"Fear & Hunger NX, version test", "18:26:04 - Fps: 60.00"}, kDisplay);
    if (applied) *applied = a;
    ImGui::Render();
    return ImGui::GetDrawData()->TotalVtxCount;
}

static void click(ModMenuUi& ui, ImVec2 at, int frames = 3) {
    ImGuiIO& io = ImGui::GetIO();
    io.AddMousePosEvent(at.x + 4, at.y + 4);
    frame(ui);
    io.AddMouseButtonEvent(0, true);
    frame(ui);
    io.AddMouseButtonEvent(0, false);
    for (int i = 0; i < frames; i++) frame(ui);
}

int main() {
    fs::path root = fs::temp_directory_path() / "fh_ui_test";
    fs::remove_all(root);
    fs::path mods = root / "mods", ini = root / "cfg/mods.ini";
    put(mods / "art/mod.json", R"({"name":"Art","version":"1.0","author":"me","description":"Pretty."})");
    put(mods / "art/img/pictures/a.png", "x");
    put(mods / "map/mod.json", R"({"name":"Map","affects_saves":true,"plugins":["P"]})");
    put(mods / "map/data/Map074.json", "x");

    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.Fonts->AddFontDefault();
    unsigned char* px; int w, h;
    io.Fonts->GetTexDataAsRGBA32(&px, &w, &h);

    ModManager mm;
    mm.scan(mods.string());
    ModMenuModel model(mm, ini.string());
    ModMenuUi ui(model);

    // Two frames so widgets settle; the first frame has no remembered sizes.
    CHECK(frame(ui) > 0);
    CHECK(frame(ui) > 100);
    CHECK(ui.rects().apply.x > 0);

    // Apply is disabled with nothing staged: clicking it must do nothing.
    bool applied = false;
    click(ui, ui.rects().apply);
    CHECK(!mm.find("art")->enabled && !fs::exists(ini));

    // Stage a change straight on the model, then click Apply.
    model.toggle(0);
    frame(ui);
    CHECK(model.dirty());
    click(ui, ui.rects().reset);                // Reset discards
    CHECK(!model.dirty());

    model.toggle(0);
    frame(ui);
    ImGuiIO& i2 = ImGui::GetIO();
    ImVec2 at = ui.rects().apply;
    i2.AddMousePosEvent(at.x + 4, at.y + 4);
    frame(ui);
    i2.AddMouseButtonEvent(0, true);
    frame(ui, &applied);
    bool sawApply = applied;
    i2.AddMouseButtonEvent(0, false);
    for (int i = 0; i < 3 && !sawApply; i++) { frame(ui, &applied); sawApply = applied; }
    CHECK(sawApply);
    CHECK(mm.mods()[0].enabled && fs::exists(ini));
    CHECK(ui.lastApplied().reloadAssets && !ui.lastApplied().restartRuntime);
    CHECK(!ui.lastApplyFailed());

    // Master switch checkbox, tab stepping, and a mod with saves + plugins all draw cleanly.
    click(ui, ui.rects().master);
    CHECK(!model.masterActive());
    for (int i = 0; i < 4; i++) { ui.stepTab(1); CHECK(frame(ui) > 0); }
    ui.stepTab(-1);
    CHECK(frame(ui) > 0);

    // No mods at all: the empty state still draws.
    ModManager none;
    ModMenuModel emptyModel(none, (root / "x.ini").string());
    ModMenuUi emptyUi(emptyModel);
    CHECK(frame(emptyUi) > 0);

    ImGui::DestroyContext();
    fs::remove_all(root);
    std::printf(failures ? "%d FAILED\n" : "ui tests passed\n", failures);
    return failures ? 1 : 0;
}
