#include "ModMenuUi.hpp"
#include <algorithm>

namespace {

const ImVec4 kWarn(1.0f, 0.78f, 0.25f, 1.0f);
const ImVec4 kDim(0.62f, 0.66f, 0.72f, 1.0f);

} // namespace

bool ModMenuUi::draw(const Header& header, ImVec2 display) {
    const float marginX = 40.f, marginY = 36.f, gap = 20.f;
    const float leftW = std::max(360.f, display.x * 0.43f);
    const float h = display.y - marginY * 2;

    bool applied = false;
    const bool focusNow = focusFirst_;
    if (focusNow) ImGui::SetNextWindowFocus();             // the pad starts in the mod list, not in the details pane
    ImGui::SetNextWindowPos(ImVec2(marginX, marginY));
    ImGui::SetNextWindowSize(ImVec2(leftW, h));
    ImGui::Begin(header.title.c_str(), nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse |
                     ImGuiWindowFlags_NoSavedSettings);

    bool active = model_.masterActive();
    if (ImGui::Checkbox("Mods active", &active)) model_.setMasterActive(active);
    rects_.master = ImGui::GetItemRectMin();
    if (!header.status.empty()) {
        float w = ImGui::CalcTextSize(header.status.c_str()).x;
        ImGui::SameLine(ImGui::GetWindowWidth() - w - ImGui::GetStyle().WindowPadding.x);
        ImGui::TextUnformatted(header.status.c_str());
    }

    if (ImGui::BeginTabBar("tabs")) {
        const char* names[] = {"Mods", "Plugins", "Help"};
        if (tabStep_ != 0) tab_ = (tab_ + tabStep_ + 3) % 3;
        for (int i = 0; i < 3; i++) {
            ImGuiTabItemFlags f = (tabStep_ != 0 && tab_ == i) ? ImGuiTabItemFlags_SetSelected : 0;
            if (ImGui::BeginTabItem(names[i], nullptr, f)) {
                if (tabStep_ == 0) tab_ = i;
                if (i == 0) tabMods();
                else if (i == 1) tabPlugins();
                else tabHelp();
                ImGui::EndTabItem();
            }
        }
        tabStep_ = 0;
        ImGui::EndTabBar();
    }

    // Apply / Reset live at the bottom of the left window, whatever the tab.
    ImGui::SetCursorPosY(ImGui::GetWindowHeight() - ImGui::GetFrameHeight() * 2 -
                         ImGui::GetStyle().WindowPadding.y - ImGui::GetStyle().ItemSpacing.y);
    ImGui::Separator();
    planLine(model_.plan());
    bool dirty = model_.dirty();
    ImGui::BeginDisabled(!dirty);
    if (ImGui::Button("Apply")) {
        applied_ = model_.plan();
        applyFailed_ = !model_.apply();
        applied = true;
    }
    rects_.apply = ImGui::GetItemRectMin();
    ImGui::SameLine();
    if (ImGui::Button("Reset")) model_.reset();
    rects_.reset = ImGui::GetItemRectMin();
    ImGui::EndDisabled();
    ImGui::End();

    infoPane(ImVec2(marginX + leftW + gap, marginY), ImVec2(display.x - marginX * 2 - leftW - gap, 190.f));
    if (focusNow) focusFirst_ = false;
    return applied;
}

void ModMenuUi::planLine(const ModMenuModel::Plan& p) {
    if (!model_.dirty()) {
        ImGui::TextColored(kDim, "No pending changes");
        return;
    }
    std::string s = "Apply will:";
    if (p.reloadAssets) s += " reload assets";
    if (p.restartRuntime) s += p.reloadAssets ? ", restart game runtime" : " restart game runtime";
    if (!p.reloadAssets && !p.restartRuntime) s += " save the order";
    ImGui::TextUnformatted(s.c_str());
}

void ModMenuUi::tabMods() {
    const auto& rows = model_.rows();
    if (rows.empty()) {
        ImGui::TextColored(kDim, "No mods found in sdmc:/switch/fh-nx/mods/");
        return;
    }
    if (selected_ >= rows.size()) selected_ = rows.size() - 1;

    ImGui::PushStyleColor(ImGuiCol_Text, kDim);
    ImGui::TextWrapped("Load order: top loads first, bottom wins conflicts");
    ImGui::PopStyleColor();
    for (size_t i = 0; i < rows.size(); i++) {
        const Mod* m = model_.mod(i);
        ImGui::PushID((int)i);
        bool on = rows[i].enabled;
        if (ImGui::Checkbox("##on", &on)) model_.toggle(i);
        if (focusFirst_ && i == selected_) ImGui::SetItemDefaultFocus();
        ImGui::SameLine();
        std::string label = m ? m->name : rows[i].id;
        if (ImGui::Selectable(label.c_str(), selected_ == i)) selected_ = i;
        if (m && m->affectsSaves) {
            ImGui::SameLine();
            ImGui::TextColored(kWarn, "(saves)");
        }
        ImGui::PopID();
    }

    ImGui::Spacing();
    if (ImGui::Button("Move up")) {
        if (model_.moveUp(selected_)) selected_--;
    }
    ImGui::SameLine();
    if (ImGui::Button("Move down")) {
        if (model_.moveDown(selected_)) selected_++;
    }
}

void ModMenuUi::tabPlugins() {
    bool any = false;
    ImGui::TextColored(kDim, "Plugins added or changed by enabled mods");
    for (size_t i = 0; i < model_.rows().size(); i++) {
        const Mod* m = model_.mod(i);
        if (!m || !model_.rows()[i].enabled) continue;
        for (const PluginEntry& p : m->plugins) {
            ImGui::BulletText("%s  (adds, from %s)", p.name.c_str(), m->name.c_str());
            any = true;
        }
        for (const ParamOverride& o : m->paramOverrides) {
            ImGui::BulletText("%s  (%zu parameter%s, from %s)", o.plugin.c_str(), o.params.size(),
                              o.params.size() == 1 ? "" : "s", m->name.c_str());
            any = true;
        }
    }
    if (!any) ImGui::TextColored(kDim, "None. Only the base game's plugins run.");
    if (!model_.masterActive()) ImGui::TextColored(kWarn, "Mods are switched off, so none of this applies.");
}

void ModMenuUi::tabHelp() {
    ImGui::TextWrapped("Hold - for 2 seconds in game to open this menu. The game pauses behind it.");
    ImGui::Spacing();
    ImGui::TextWrapped("Changes are staged. Nothing happens until you press Apply; Reset throws them away.");
    ImGui::Spacing();
    ImGui::TextWrapped("Image, audio and data mods apply by reloading assets. Mods that add plugins "
                       "or change plugin settings also restart the game runtime (not your save).");
    ImGui::Spacing();
    ImGui::TextColored(kWarn, "(saves)");
    ImGui::SameLine();
    ImGui::TextWrapped("marks a mod that changes data existing saves depend on. Toggling it can "
                       "break a save: back up first.");
}

void ModMenuUi::infoPane(ImVec2 pos, ImVec2 size) {
    ImGui::SetNextWindowPos(pos);
    ImGui::SetNextWindowSize(size);
    ImGui::Begin("Details", nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse |
                     ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoFocusOnAppearing |
                     ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);   // read-only: the pad stays on the list

    const Mod* m = model_.mod(selected_);
    if (!m) {
        ImGui::TextColored(kDim, "Select a mod");
        ImGui::End();
        return;
    }
    ImGui::TextUnformatted(m->name.c_str());
    if (!m->version.empty() || !m->author.empty())
        ImGui::TextColored(kDim, "%s%s%s", m->version.empty() ? "" : ("v" + m->version).c_str(),
                           (!m->version.empty() && !m->author.empty()) ? "  by " : (m->author.empty() ? "" : "by "),
                           m->author.c_str());
    if (!m->description.empty()) ImGui::TextWrapped("%s", m->description.c_str());
    if (m->affectsSaves) ImGui::TextColored(kWarn, "Changes data that existing saves rely on.");

    ImGui::Separator();
    ImGui::Text("Overrides %zu file%s", m->files.size(), m->files.size() == 1 ? "" : "s");
    auto ov = model_.overlaps(selected_);
    if (!ov.empty()) {
        int lost = 0;
        for (auto& o : ov) if (o.winner != m->id) lost++;
        ImGui::TextColored(kWarn, "%zu shared with other enabled mods, %d won by them", ov.size(), lost);
    }
    ImGui::End();
}
