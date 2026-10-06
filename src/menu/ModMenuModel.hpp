#pragma once
#include "../vfs/ModManager.hpp"
#include <string>
#include <vector>

// State behind the mods menu. Edits are staged: nothing reaches the ModManager (or the
// ini) until apply(), and reset() throws them away. That is what makes Apply/Reset mean
// something, as in Fizeau.
class ModMenuModel {
public:
    // What applying the staged changes will cost the player. Shown before they commit.
    struct Plan {
        bool reloadAssets = false;    // file overrides changed: clear caches, reload the scene
        bool restartRuntime = false;  // plugins or plugin parameters changed: soft JS restart
        bool savesWarning = false;    // a toggled mod changes data that existing saves depend on
        bool any() const { return reloadAssets || restartRuntime || savesWarning; }
    };

    struct Row {
        std::string id;
        bool enabled = false;
    };

    ModMenuModel(ModManager& mm, std::string iniPath);

    // --- staged edits
    const std::vector<Row>& rows() const { return rows_; }
    bool masterActive() const { return active_; }
    void setMasterActive(bool on) { active_ = on; }
    void toggle(size_t row) { if (row < rows_.size()) rows_[row].enabled = !rows_[row].enabled; }
    bool moveUp(size_t row);      // lowers priority (loads earlier)
    bool moveDown(size_t row);    // raises priority (loads later, wins conflicts)

    bool dirty() const;
    Plan plan() const;

    // Commit staged state to the ModManager and write the ini. Returns false if the ini
    // could not be written; the ModManager is updated either way so the session matches
    // what the player just chose.
    bool apply();
    void reset();

    // --- read-only info for the right-hand pane
    const Mod* mod(size_t row) const;
    // Files of `row` that another *staged-enabled* mod also provides, with the id of the
    // mod that wins (the later one in staged order).
    struct Overlap { std::string file, winner; };
    std::vector<Overlap> overlaps(size_t row) const;

private:
    ModManager& mm_;
    std::string ini_;
    std::vector<Row> rows_;
    bool active_;

    void load();
    std::vector<std::string> enabledOrder(const std::vector<Row>& rows) const;
};
