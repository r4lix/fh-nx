#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// Layered read-only view of the game's www/ tree. Layer 0 is the base game; every
// layer after it is an enabled mod, in load order, so later layers win.
//
// Callers ask for the logical path the engine uses ("img/pictures/foo.png"). Each layer
// is probed for the plain file and for the RPG Maker MV encrypted twin (.rpgmvp/.rpgmvo/
// .rpgmvm), so a mod can ship plain PNG/OGG over an encrypted base asset.
class Vfs {
public:
    struct Resolved {
        std::string path;     // real file on disk
        size_t layer = 0;     // 0 = base, n = n-th mod
        bool encrypted = false;
    };

    explicit Vfs(std::string baseDir) { layers_.push_back(std::move(baseDir)); }

    // Replace the mod layers (lowest priority first). The base layer is untouched.
    void setMods(const std::vector<std::string>& dirs);

    std::optional<Resolved> resolve(const std::string& logical) const;
    bool exists(const std::string& logical) const { return resolve(logical).has_value(); }

    // Whole-file read; decrypts nothing, the caller checks Resolved::encrypted.
    bool read(const std::string& logical, std::vector<uint8_t>& out, Resolved* info = nullptr) const;

    // Canonical form of a logical path ('/' separators, no "." or empty parts). Returns
    // nullopt for anything that would escape the root (".." or an absolute/drive path).
    static std::optional<std::string> normalize(const std::string& logical);

private:
    std::vector<std::string> layers_;
};
