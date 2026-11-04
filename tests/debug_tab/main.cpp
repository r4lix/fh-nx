// Build + run from tests/debug_tab: g++ -std=gnu++17 -g -DIMGUI_USER_CONFIG='"imconfig_assert.h"' -I. -I../../third_party/imgui -I../../src main.cpp ../../src/menu/*.cpp ../../src/vfs/*.cpp ../../src/core/Json.cpp ../../third_party/imgui/imgui*.cpp -o t.exe && ./t.exe
// PC run of the menu's Debug tab with a fake game state and the pad sequence used on the device; IM_ASSERT prints and aborts.
#include "../../src/menu/ModMenuUi.hpp"
#include <cstdio>
#include <string>
int main() {
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad;
    io.BackendFlags |= ImGuiBackendFlags_HasGamepad;
    io.Fonts->AddFontDefault();
    unsigned char* px; int w, h;
    io.Fonts->GetTexDataAsRGBA32(&px, &w, &h);
    ModManager mm;
    ModMenuModel model(mm, "unused.ini");
    ControlsModel controls("unused_controls.ini");
    SettingsModel settings("unused_settings.ini");
    DebugModel dbg;
    std::string st = "noclip 0\ngod 0\nspeed 4\nlight 240\nlightlock 0\nfullbright 0\nwhere 80 26 34 Back_alleys\n";
    for (int i = 1; i <= 169; i++) st += "map " + std::to_string(i) + " Map name " + std::to_string(i) + "\n";
    for (int i = 1; i <= 300; i++) st += std::string("item ") + "iwa"[i % 3] + " " + std::to_string(i) + " 0 Thing " + std::to_string(i) + "\n";
    dbg.setState(st);
    ModMenuUi ui(model, &controls, &settings, &dbg);
    const char* seq[] = {"R", "R", "R", "Down", "A", "Up", "Right", "A", "Down", "Down", "Down", "A", "Right", "A", "Down", "A", "X", "Left", "Left", "A"};
    auto key = [](const std::string& k) {
        if (k == "A") return ImGuiKey_GamepadFaceDown; if (k == "X") return ImGuiKey_GamepadFaceLeft;
        if (k == "Up") return ImGuiKey_GamepadDpadUp; if (k == "Down") return ImGuiKey_GamepadDpadDown;
        if (k == "Left") return ImGuiKey_GamepadDpadLeft; return ImGuiKey_GamepadDpadRight;
    };
    int f = 0;
    auto frame = [&]() {
        io.DisplaySize = ImVec2(1280, 720); io.DeltaTime = 1.f / 60.f;
        ImGui::NewFrame();
        ui.draw({"Fear & Hunger", ""}, ImVec2(1280, 720));
        ImGui::Render();
        f++;
    };
    ui.resetFocus();
    for (int i = 0; i < 5; i++) frame();
    for (const char* s : seq) {
        std::string k = s;
        std::printf("press %s\n", s); std::fflush(stdout);
        if (k == "R") ui.stepTab(+1);
        else { io.AddKeyEvent(key(k), true); frame(); io.AddKeyEvent(key(k), false); }
        for (int i = 0; i < 8; i++) frame();
    }
    std::printf("commands:\n%s", dbg.commands().c_str());
    return 0;
}
