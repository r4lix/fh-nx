#include "ModMenuUi.hpp"
#include <algorithm>
#include <cctype>
#include <vector>

namespace {

std::string lowerStr(std::string s) {
    for (char& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

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
        enum { kMods, kControls, kPlugins, kHelp };
        std::vector<int> ids = {kMods};
        if (controls_) ids.push_back(kControls);
        ids.push_back(kPlugins);
        ids.push_back(kHelp);
        const char* names[] = {"Mods", "Controls", "Plugins", "Help"};
        const int n = (int)ids.size();
        if (tabStep_ != 0) tab_ = (tab_ + tabStep_ + n) % n;
        for (int i = 0; i < n; i++) {
            ImGuiTabItemFlags f = (tabStep_ != 0 && tab_ == i) ? ImGuiTabItemFlags_SetSelected : 0;
            if (ImGui::BeginTabItem(names[ids[i]], nullptr, f)) {
                if (tabStep_ == 0) tab_ = i;
                tabId_ = ids[i];
                if (ids[i] == kMods) tabMods();
                else if (ids[i] == kControls) tabControls();
                else if (ids[i] == kPlugins) tabPlugins();
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

    infoPane(ImVec2(marginX + leftW + gap, marginY), ImVec2(display.x - marginX * 2 - leftW - gap, 240.f));
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

    static const char* sortNames[] = {"Load order", "Name", "Enabled first", "Author", "Tested first"};
    if (ImGui::Button((std::string("Sort: ") + sortNames[sort_]).c_str())) sort_ = (sort_ + 1) % 5;
    ImGui::SameLine();
    ImGui::PushStyleColor(ImGuiCol_Text, kDim);
    ImGui::TextUnformatted(sort_ == 0 ? "top loads first, bottom wins" : "display only");
    ImGui::PopStyleColor();

    std::vector<size_t> order(rows.size());
    for (size_t i = 0; i < order.size(); i++) order[i] = i;
    auto nameOf = [&](size_t i) { const Mod* m = model_.mod(i); return lowerStr(m ? m->name : rows[i].id); };
    auto authorOf = [&](size_t i) { const Mod* m = model_.mod(i); return lowerStr(m ? m->author : std::string()); };
    auto testedOf = [&](size_t i) { const Mod* m = model_.mod(i); return m && m->tested; };
    switch (sort_) {
    case 1: std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return nameOf(a) < nameOf(b); }); break;
    case 2: std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return rows[a].enabled > rows[b].enabled; }); break;
    case 3: std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return authorOf(a) < authorOf(b); }); break;
    case 4: std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return testedOf(a) > testedOf(b); }); break;
    default: break;
    }

    for (size_t k = 0; k < order.size(); k++) {
        size_t i = order[k];
        const Mod* m = model_.mod(i);
        ImGui::PushID((int)i);
        bool on = rows[i].enabled;
        if (ImGui::Checkbox("##on", &on)) model_.toggle(i);
        if (focusFirst_ && k == 0) ImGui::SetItemDefaultFocus();
        ImGui::SameLine();
        std::string label = m ? m->name : rows[i].id;
        if (ImGui::Selectable(label.c_str(), selected_ == i)) selected_ = i;
        if (m && !m->tested) {
            ImGui::SameLine();
            ImGui::TextColored(kDim, "(untested)");
        }
        if (m && m->affectsSaves) {
            ImGui::SameLine();
            ImGui::TextColored(kWarn, "(saves)");
        }
        ImGui::PopID();
    }

    ImGui::Spacing();
    ImGui::BeginDisabled(sort_ != 0);                      // moving only makes sense in load order
    if (ImGui::Button("Move up")) {
        if (model_.moveUp(selected_)) selected_--;
    }
    ImGui::SameLine();
    if (ImGui::Button("Move down")) {
        if (model_.moveDown(selected_)) selected_++;
    }
    ImGui::EndDisabled();
}

void ModMenuUi::tabControls() {
    ImGui::PushStyleColor(ImGuiCol_Text, kDim);
    ImGui::TextWrapped("Press A on an action to move it to the next button. Taking a button that is already used swaps the two.");
    ImGui::PopStyleColor();
    ImGui::Spacing();
    const auto& acts = ControlsModel::actions();
    for (size_t i = 0; i < acts.size(); i++) {
        ImGui::PushID((int)i);
        std::string btn = controls_->button(i);
        std::string text = std::string(acts[i].label) + ":  " + (btn == "STICK_L" ? "L stick click" : btn == "STICK_R" ? "R stick click" : btn);
        if (ImGui::Button(text.c_str(), ImVec2(ImGui::GetContentRegionAvail().x, 0))) {
            controls_->cycle(i, +1);
            controls_->save();
        }
        if (ImGui::IsItemFocused() || ImGui::IsItemHovered()) control_ = i;
        if (focusFirst_ && i == 0) ImGui::SetItemDefaultFocus();
        ImGui::PopID();
    }
    ImGui::Spacing();
    ImGui::BeginDisabled(controls_->isDefault());
    if (ImGui::Button("Reset to defaults")) {
        controls_->resetDefaults();
        controls_->save();
    }
    ImGui::EndDisabled();
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
    ImGui::TextColored(kDim, "(untested)");
    ImGui::SameLine();
    ImGui::TextWrapped("marks a mod nobody has run on a Switch yet. It may not work.");
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

    if (tabId_ == 1 && controls_) {
        const auto& a = ControlsModel::actions()[control_];
        ImGui::TextUnformatted(a.label);
        ImGui::TextColored(kDim, "default: %s", a.defaultButton);
        ImGui::TextWrapped("%s", a.help);
        ImGui::End();
        return;
    }
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
    if (!m->url.empty()) ImGui::TextColored(kDim, "%s", m->url.c_str());
    if (m->tested) ImGui::TextColored(ImVec4(0.45f, 0.85f, 0.5f, 1.f), "Tested on a Switch");
    else ImGui::TextColored(kWarn, "Untested on a Switch");
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
