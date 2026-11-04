#pragma once
#include "ControlsModel.hpp"
#include "DebugModel.hpp"
#include "SettingsModel.hpp"
#include "ModMenuModel.hpp"
#include "imgui.h"
#include <string>

// Dear ImGui front-end for ModMenuModel, laid out like Fizeau's config app: a header with the
// master checkbox, a tab bar on the left, and an info pane on the right. It only issues ImGui
// calls; the host owns the context, input and rendering (GLES on the Switch, nothing in tests).
class ModMenuUi {
public:
    struct Header {
        std::string title;     // "Fear & Hunger, version 0.1.0"
        std::string status;    // right-aligned: clock / fps, may be empty
    };

    // `controls` (optional) adds the Controls tab; it is saved as soon as a binding changes.
    // `debug` (optional) adds the Debug tab (testing cheats) while it holds the game's state.
    explicit ModMenuUi(ModMenuModel& model, ControlsModel* controls = nullptr, SettingsModel* settings = nullptr,
                       DebugModel* debug = nullptr)
        : model_(model), controls_(controls), settings_(settings), debug_(debug) {}

    // Call once per frame between NewFrame() and Render(). Returns true on the frame the
    // player pressed Apply; lastApplied() then holds what that cost (reload / restart).
    bool draw(const Header& header, ImVec2 display);

    const ModMenuModel::Plan& lastApplied() const { return applied_; }
    bool lastApplyFailed() const { return applyFailed_; }

    // L/R on the pad: -1 / +1 moves the tab selection.
    void stepTab(int dir) { tabStep_ = dir; }

    // Put the pad/keyboard focus on the first control again (call when the menu is opened).
    void resetFocus() { focusFirst_ = true; }

    // Where the Apply/Reset buttons were drawn last frame, so tests can click them.
    struct Rects { ImVec2 apply, reset, master; };
    const Rects& rects() const { return rects_; }

private:
    ModMenuModel& model_;
    ControlsModel* controls_;
    SettingsModel* settings_;
    DebugModel* debug_;
    int debugPage_ = 0;            // 0 cheats, 1 teleport, 2 items
    int itemKind_ = 0;             // 0 items, 1 weapons, 2 armors
    size_t debugItem_ = 0;
    size_t selected_ = 0;
    int sort_ = 0;                 // how the mod list is shown; the load order itself never changes with it
    size_t control_ = 0;
    int tab_ = 0;
    int tabId_ = 0;                // which tab was drawn last (0 mods, 1 controls, 2 plugins, 3 help)
    int tabStep_ = 0;
    bool focusFirst_ = true;
    ModMenuModel::Plan applied_;
    bool applyFailed_ = false;
    Rects rects_;

    void tabMods();
    void tabControls();
    void tabSystem();
    void tabPlugins();
    void tabHelp();
    void tabDebug();
    void infoPane(ImVec2 pos, ImVec2 size);
    void planLine(const ModMenuModel::Plan& p);
};
