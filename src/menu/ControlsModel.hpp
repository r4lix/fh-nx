#pragma once
#include <string>
#include <vector>

// Which Switch button triggers which game action. The defaults follow Ley's Gamepad Controller Scheme (Nexus mods/132) laid out
// by Nintendo's button positions; the player changes them in the mods menu and they are kept in controls.ini.
class ControlsModel {
public:
    struct Action {
        const char* symbol;      // the name MV's Input knows the action by ("ok", "shift", "c", ...)
        const char* label;
        const char* help;
        const char* defaultButton;
    };

    static const std::vector<Action>& actions();
    static const std::vector<std::string>& buttons();     // the buttons an action may use

    explicit ControlsModel(std::string iniPath);

    void load();
    bool save() const;
    void resetDefaults();

    const std::string& button(size_t action) const { return bound_[action]; }
    // Moves `action` to the next/previous button; if another action already has it, the two swap.
    void cycle(size_t action, int dir);
    bool isDefault() const;

    std::string toJson() const;    // {"ok":"A","cancel":"B",...}

private:
    std::string ini_;
    std::vector<std::string> bound_;
};
