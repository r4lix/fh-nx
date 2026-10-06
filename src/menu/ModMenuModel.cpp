#include "ModMenuModel.hpp"
#include <algorithm>
#include <map>

namespace {

bool hasFiles(const Mod& m) { return !m.files.empty(); }
bool hasScript(const Mod& m) { return !m.plugins.empty() || !m.paramOverrides.empty(); }

std::string lower(std::string s) {
    for (char& c : s) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
    return s;
}

// Same asset spelled plain or encrypted must collide.
std::string key(const std::string& rel) {
    std::string k = lower(rel);
    if (k.size() > 7) {
        std::string ext = k.substr(k.size() - 7);
        std::string stem = k.substr(0, k.size() - 7);
        if (ext == ".rpgmvp") return stem + ".png";
        if (ext == ".rpgmvo") return stem + ".ogg";
        if (ext == ".rpgmvm") return stem + ".m4a";
    }
    return k;
}

} // namespace

ModMenuModel::ModMenuModel(ModManager& mm, std::string iniPath)
    : mm_(mm), ini_(std::move(iniPath)), active_(mm.active()) {
    load();
}

void ModMenuModel::load() {
    rows_.clear();
    for (const Mod& m : mm_.mods()) rows_.push_back({m.id, m.enabled});
    active_ = mm_.active();
}

void ModMenuModel::reset() { load(); }

bool ModMenuModel::moveUp(size_t row) {
    if (row == 0 || row >= rows_.size()) return false;
    std::swap(rows_[row], rows_[row - 1]);
    return true;
}

bool ModMenuModel::moveDown(size_t row) {
    if (row + 1 >= rows_.size()) return false;
    std::swap(rows_[row], rows_[row + 1]);
    return true;
}

bool ModMenuModel::dirty() const {
    if (active_ != mm_.active()) return true;
    const auto& cur = mm_.mods();
    if (cur.size() != rows_.size()) return true;
    for (size_t i = 0; i < rows_.size(); i++)
        if (cur[i].id != rows_[i].id || cur[i].enabled != rows_[i].enabled) return true;
    return false;
}

// Ids of the mods that would actually load, in load order.
std::vector<std::string> ModMenuModel::enabledOrder(const std::vector<Row>& rows) const {
    std::vector<std::string> out;
    for (const Row& r : rows) if (r.enabled) out.push_back(r.id);
    return out;
}

ModMenuModel::Plan ModMenuModel::plan() const {
    Plan p;
    if (!dirty()) return p;

    std::vector<Row> committed;
    for (const Mod& m : mm_.mods()) committed.push_back({m.id, m.enabled});

    // Everything below compares what loads before with what would load after. When the
    // master switch is off nothing loads, so that side is the empty set.
    std::vector<std::string> before = mm_.active() ? enabledOrder(committed) : std::vector<std::string>();
    std::vector<std::string> after = active_ ? enabledOrder(rows_) : std::vector<std::string>();

    auto find = [&](const std::string& id) -> const Mod* {
        for (const Mod& m : mm_.mods()) if (m.id == id) return &m;
        return nullptr;
    };

    // Mods that start or stop loading.
    std::vector<std::string> flipped;
    for (const auto& id : before)
        if (std::find(after.begin(), after.end(), id) == after.end()) flipped.push_back(id);
    for (const auto& id : after)
        if (std::find(before.begin(), before.end(), id) == before.end()) flipped.push_back(id);
    for (const auto& id : flipped) {
        const Mod* m = find(id);
        if (!m) continue;
        if (hasFiles(*m)) p.reloadAssets = true;
        if (hasScript(*m)) p.restartRuntime = true;
        if (m->affectsSaves) p.savesWarning = true;
    }

    // Same set, different order: the winner of a conflict (or the plugin load order) moves.
    std::vector<std::string> a = before, b = after;
    std::sort(a.begin(), a.end());
    std::sort(b.begin(), b.end());
    if (a == b && before != after) {
        p.reloadAssets = true;
        for (const auto& id : after) {
            const Mod* m = find(id);
            if (m && hasScript(*m)) p.restartRuntime = true;
        }
    }
    return p;
}

bool ModMenuModel::apply() {
    std::vector<std::pair<std::string, bool>> order;
    for (const Row& r : rows_) order.emplace_back(r.id, r.enabled);
    mm_.apply(order);
    mm_.setActive(active_);
    return mm_.saveConfig(ini_);
}

const Mod* ModMenuModel::mod(size_t row) const {
    if (row >= rows_.size()) return nullptr;
    for (const Mod& m : mm_.mods()) if (m.id == rows_[row].id) return &m;
    return nullptr;
}

std::vector<ModMenuModel::Overlap> ModMenuModel::overlaps(size_t row) const {
    std::vector<Overlap> out;
    const Mod* self = mod(row);
    if (!self || row >= rows_.size() || !rows_[row].enabled) return out;

    // file key -> id of the last staged-enabled mod providing it
    std::map<std::string, std::string> winner;
    for (const Row& r : rows_) {
        if (!r.enabled) continue;
        for (const Mod& m : mm_.mods())
            if (m.id == r.id)
                for (const std::string& f : m.files) winner[key(f)] = m.id;
    }
    std::map<std::string, int> providers;
    for (const Row& r : rows_) {
        if (!r.enabled || r.id == self->id) continue;
        for (const Mod& m : mm_.mods())
            if (m.id == r.id)
                for (const std::string& f : m.files) providers[key(f)]++;
    }
    for (const std::string& f : self->files) {
        std::string k = key(f);
        if (providers.count(k)) out.push_back({k, winner[k]});
    }
    return out;
}
