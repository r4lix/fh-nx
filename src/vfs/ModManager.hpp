#pragma once
#include <string>
#include <utility>
#include <vector>

// A plugin a mod adds to the game's plugin list (same shape as an entry in js/plugins.js).
struct PluginEntry {
    std::string name;
    std::string description;
    std::vector<std::pair<std::string, std::string>> params;
};

struct Mod {
    std::string id;            // folder name; also the key in mods.ini
    std::string dir;           // absolute path to the mod folder
    std::string name, version, author, description;
    bool enabled = false;
    bool affectsSaves = false; // menu warns before toggling: it changes data existing saves rely on
    std::vector<PluginEntry> plugins;
    std::vector<std::string> files;   // files the mod overrides, relative to its root
};

// Finds mods under <modsDir>/<id>/mod.json and keeps their enabled state and load order.
// Load order is list order; later mods win file conflicts.
class ModManager {
public:
    struct Conflict {
        std::string file;                 // case-folded logical path, plain-asset spelling
        std::vector<std::string> mods;    // ids of the enabled mods providing it, load order
    };

    // Returns the number of mods found. Folders without a usable mod.json land in errors().
    size_t scan(const std::string& modsDir);

    // mods.ini: a "[mods]" section of "<id>=<0|1>" lines, in load order. Missing ids are
    // dropped, new mods are appended disabled.
    void loadConfig(const std::string& iniPath);
    bool saveConfig(const std::string& iniPath) const;

    std::vector<Mod>& mods() { return mods_; }
    const std::vector<Mod>& mods() const { return mods_; }
    const std::vector<std::string>& errors() const { return errors_; }

    Mod* find(const std::string& id);
    bool setEnabled(const std::string& id, bool on);
    bool move(size_t index, int delta);   // swaps with the neighbour in that direction

    std::vector<std::string> enabledDirs() const;         // for Vfs::setMods
    std::vector<PluginEntry> extraPlugins() const;        // appended to the base plugin list
    std::vector<Conflict> conflicts() const;

private:
    std::vector<Mod> mods_;
    std::vector<std::string> errors_;
};
