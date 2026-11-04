#pragma once
#include <functional>
#include <string>
#include <vector>

// Port settings kept in settings.ini (next to mods.ini). Changes are saved at once and handed to the host through onChange.
class SettingsModel {
public:
    struct CpuOption { int mhz; const char* label; };
    static const std::vector<CpuOption>& cpuOptions();     // 0 = the console's own clock
    static constexpr int kDefaultCpuMhz = 1700;

    explicit SettingsModel(std::string iniPath) : ini_(std::move(iniPath)) {}
    void load();
    bool save() const;

    int cpuMhz() const { return cpuMhz_; }
    void cycleCpu(int dir);                                // next/previous option, saves, calls onChange
    std::function<void(int mhz)> onCpuChange;

    // 16:9 game area (1110x624 instead of 816x624). The resolution is set when the game boots: takes effect at the next start.
    bool widescreen() const { return widescreen_; }
    void toggleWidescreen();

private:
    std::string ini_;
    int cpuMhz_ = kDefaultCpuMhz;
    bool widescreen_ = false;
};
