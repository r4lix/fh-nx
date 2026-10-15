#include "ControlsModel.hpp"
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <sstream>

const std::vector<ControlsModel::Action>& ControlsModel::actions() {
    static const std::vector<Action> a = {
        {"ok", "Confirm", "Confirm, talk, interact.", "A"},
        {"cancel", "Cancel", "Cancel, back out of a menu.", "B"},
        {"shift", "Action", "Shoot arrow, En'Garde, lucky coin; dash on the map.", "Y"},
        {"menu", "Menu", "Open the game menu.", "X"},
        {"c", "Phase Step", "The Phase Step key (C on a keyboard).", "L"},
        {"t", "Light torch", "The torch key (T on a keyboard).", "R"},
        {"pageup", "Speed up animations", "Page Up: faster battle animations; previous page in menus.", "ZL"},
        {"pagedown", "Speed up text", "Page Down: faster text; next page in menus.", "ZR"},
    };
    return a;
}

const std::vector<std::string>& ControlsModel::buttons() {
    static const std::vector<std::string> b = {"A", "B", "X", "Y", "L", "R", "ZL", "ZR", "STICK_L", "STICK_R"};
    return b;
}

ControlsModel::ControlsModel(std::string iniPath) : ini_(std::move(iniPath)) { resetDefaults(); }

void ControlsModel::resetDefaults() {
    bound_.clear();
    for (const Action& a : actions()) bound_.push_back(a.defaultButton);
}

bool ControlsModel::isDefault() const {
    for (size_t i = 0; i < bound_.size(); i++)
        if (bound_[i] != actions()[i].defaultButton) return false;
    return true;
}

void ControlsModel::load() {
    resetDefaults();
    std::ifstream f(ini_);
    if (!f) return;
    std::vector<std::string> got = bound_;
    std::string line;
    while (std::getline(f, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        std::string k = line.substr(0, eq), v = line.substr(eq + 1);
        const auto& bt = buttons();
        if (std::find(bt.begin(), bt.end(), v) == bt.end()) continue;
        for (size_t i = 0; i < actions().size(); i++)
            if (k == actions()[i].symbol) got[i] = v;
    }
    // a hand-edited file may bind one button twice: keep it only if every button is used once
    std::vector<std::string> sorted = got;
    std::sort(sorted.begin(), sorted.end());
    if (std::adjacent_find(sorted.begin(), sorted.end()) == sorted.end()) bound_ = got;
}

bool ControlsModel::save() const {
    std::string tmp = ini_ + ".tmp";
    {
        std::ofstream f(tmp, std::ios::trunc);
        if (!f) return false;
        f << "[controls]\n";
        for (size_t i = 0; i < bound_.size(); i++) f << actions()[i].symbol << "=" << bound_[i] << "\n";
        if (!f) return false;
    }
    std::remove(ini_.c_str());                       // FAT: rename does not replace
    return std::rename(tmp.c_str(), ini_.c_str()) == 0;
}

void ControlsModel::cycle(size_t action, int dir) {
    if (action >= bound_.size()) return;
    const auto& bt = buttons();
    long n = (long)bt.size(), cur = std::find(bt.begin(), bt.end(), bound_[action]) - bt.begin();
    std::string next = bt[(size_t)(((cur + dir) % n + n) % n)], old = bound_[action];
    for (size_t i = 0; i < bound_.size(); i++)
        if (i != action && bound_[i] == next) bound_[i] = old;
    bound_[action] = next;
}

std::string ControlsModel::toJson() const {
    std::string o = "{";
    for (size_t i = 0; i < bound_.size(); i++) {
        if (i) o += ",";
        o += std::string("\"") + actions()[i].symbol + "\":\"" + bound_[i] + "\"";
    }
    return o + "}";
}
