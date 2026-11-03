#include "SettingsModel.hpp"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>

const std::vector<SettingsModel::CpuOption>& SettingsModel::cpuOptions() {
    static const std::vector<CpuOption> o = {
        {0, "Console default"}, {1224, "1224 MHz"}, {1428, "1428 MHz"}, {1581, "1581 MHz"}, {1700, "1700 MHz"}, {1785, "1785 MHz"},
    };
    return o;
}

void SettingsModel::load() {
    cpuMhz_ = kDefaultCpuMhz;
    std::ifstream f(ini_);
    std::string line;
    while (std::getline(f, line)) {
        if (line.rfind("cpu_mhz=", 0) == 0) cpuMhz_ = std::max(0, std::atoi(line.c_str() + 8));
    }
}

bool SettingsModel::save() const {
    std::string tmp = ini_ + ".tmp";
    {
        std::ofstream f(tmp, std::ios::trunc);
        if (!f) return false;
        f << "[settings]\n# CPU clock while the game has focus: 0 = console default; the clock service picks the nearest rate\n";
        f << "cpu_mhz=" << cpuMhz_ << "\n";
        if (!f) return false;
    }
    std::remove(ini_.c_str());                     // FAT: rename does not replace
    return std::rename(tmp.c_str(), ini_.c_str()) == 0;
}

void SettingsModel::cycleCpu(int dir) {
    const auto& o = cpuOptions();
    int n = (int)o.size(), cur = 0;
    for (int i = 0; i < n; i++)
        if (o[i].mhz == cpuMhz_) cur = i;
    cpuMhz_ = o[((cur + dir) % n + n) % n].mhz;
    save();
    if (onCpuChange) onCpuChange(cpuMhz_);
}
