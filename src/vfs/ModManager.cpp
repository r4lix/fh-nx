#include "ModManager.hpp"
#include "../core/Json.hpp"
#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>

namespace fs = std::filesystem;

namespace {

bool readText(const fs::path& p, std::string& out) {
    std::ifstream f(p, std::ios::binary);
    if (!f) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    out = ss.str();
    return true;
}

std::string lower(std::string s) {
    for (char& c : s) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
    return s;
}

bool endsWith(const std::string& s, const char* e) {
    size_t n = std::char_traits<char>::length(e);
    return s.size() >= n && s.compare(s.size() - n, n, e) == 0;
}

// Key for conflict detection: case-folded, and an encrypted twin counts as its plain name.
std::string conflictKey(const std::string& rel) {
    std::string k = lower(rel);
    if (endsWith(k, ".rpgmvp")) return k.substr(0, k.size() - 7) + ".png";
    if (endsWith(k, ".rpgmvo")) return k.substr(0, k.size() - 7) + ".ogg";
    if (endsWith(k, ".rpgmvm")) return k.substr(0, k.size() - 7) + ".m4a";
    return k;
}

bool parseMod(const fs::path& dir, Mod& m, std::string& err) {
    std::string text;
    if (!readText(dir / "mod.json", text)) { err = "no mod.json"; return false; }
    Json j;
    if (!Json::parse(text, j, err)) return false;
    if (j.t != Json::Obj) { err = "mod.json is not an object"; return false; }

    m.name = j.str("name", m.id);
    m.version = j.str("version");
    m.author = j.str("author");
    m.description = j.str("description");
    m.affectsSaves = j.boolean("affects_saves");

    if (const Json* ps = j.get("plugins")) {
        for (const Json& p : ps->a) {
            PluginEntry e;
            e.name = p.t == Json::Str ? p.s : p.str("name");
            if (e.name.empty()) continue;
            e.description = p.str("description");
            if (const Json* pr = p.get("parameters"))
                for (size_t k = 0; k < pr->keys.size(); k++)
                    e.params.emplace_back(pr->keys[k], pr->a[k].t == Json::Str ? pr->a[k].s : "");
            m.plugins.push_back(std::move(e));
        }
    }

    if (const Json* po = j.get("plugin_params")) {
        for (const Json& o : po->a) {
            ParamOverride ov;
            ov.plugin = o.str("plugin");
            const Json* pr = o.get("params");
            if (ov.plugin.empty() || !pr) continue;
            for (size_t k = 0; k < pr->keys.size(); k++)
                ov.params.emplace_back(pr->keys[k], pr->a[k].t == Json::Str ? pr->a[k].s : "");
            m.paramOverrides.push_back(std::move(ov));
        }
    }

    std::error_code ec;
    for (fs::recursive_directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
        if (!it->is_regular_file(ec)) continue;
        std::string name = it->path().filename().string();
        if (name == ".DS_Store" || name == "Thumbs.db") continue;
        std::string rel = it->path().lexically_relative(dir).generic_string();
        if (lower(rel) == "mod.json") continue;
        m.files.push_back(std::move(rel));
    }
    std::sort(m.files.begin(), m.files.end());
    return true;
}

} // namespace

size_t ModManager::scan(const std::string& modsDir) {
    mods_.clear();
    errors_.clear();
    std::error_code ec;
    std::vector<fs::path> dirs;
    for (fs::directory_iterator it(modsDir, ec), end; !ec && it != end; it.increment(ec))
        if (it->is_directory(ec)) dirs.push_back(it->path());
    std::sort(dirs.begin(), dirs.end());

    for (const fs::path& d : dirs) {
        Mod m;
        m.id = d.filename().string();
        m.dir = d.generic_string();
        std::string err;
        if (parseMod(d, m, err)) mods_.push_back(std::move(m));
        else errors_.push_back(m.id + ": " + err);
    }
    return mods_.size();
}

void ModManager::loadConfig(const std::string& iniPath) {
    std::string text;
    if (!readText(iniPath, text)) return;

    std::vector<std::pair<std::string, bool>> order;
    std::istringstream in(text);
    std::string line;
    bool inMods = false, inGeneral = false;
    while (std::getline(in, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line.empty() || line[0] == ';' || line[0] == '#') continue;
        if (line[0] == '[') { inMods = line == "[mods]"; inGeneral = line == "[general]"; continue; }
        size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        if (inGeneral) {
            if (line.compare(0, eq, "active") == 0) active_ = line.substr(eq + 1) != "0";
            continue;
        }
        if (!inMods) continue;
        order.emplace_back(line.substr(0, eq), line.substr(eq + 1) == "1");
    }

    std::vector<Mod> sorted;
    for (auto& [id, on] : order) {
        auto it = std::find_if(mods_.begin(), mods_.end(), [&](const Mod& m) { return m.id == id; });
        if (it == mods_.end()) continue;
        it->enabled = on;
        sorted.push_back(std::move(*it));
        mods_.erase(it);
    }
    for (Mod& m : mods_) sorted.push_back(std::move(m));   // new mods: disabled, at the end
    mods_ = std::move(sorted);
}

bool ModManager::saveConfig(const std::string& iniPath) const {
    std::error_code ec;
    fs::create_directories(fs::path(iniPath).parent_path(), ec);
    std::string tmp = iniPath + ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f) return false;
        f << "[general]\nactive=" << (active_ ? '1' : '0') << "\n\n[mods]\n";
        for (const Mod& m : mods_) f << m.id << '=' << (m.enabled ? '1' : '0') << '\n';
        if (!f) return false;
    }
    fs::rename(tmp, iniPath, ec);     // an interrupted write must not leave a half-written ini
    return !ec;
}

Mod* ModManager::find(const std::string& id) {
    for (Mod& m : mods_) if (m.id == id) return &m;
    return nullptr;
}

bool ModManager::setEnabled(const std::string& id, bool on) {
    Mod* m = find(id);
    if (!m) return false;
    m->enabled = on;
    return true;
}

bool ModManager::move(size_t index, int delta) {
    if (index >= mods_.size()) return false;
    long to = (long)index + delta;
    if (to < 0 || to >= (long)mods_.size()) return false;
    std::swap(mods_[index], mods_[(size_t)to]);
    return true;
}

void ModManager::apply(const std::vector<std::pair<std::string, bool>>& order) {
    std::vector<Mod> sorted;
    for (const auto& [id, on] : order) {
        auto it = std::find_if(mods_.begin(), mods_.end(), [&](const Mod& m) { return m.id == id; });
        if (it == mods_.end()) continue;
        it->enabled = on;
        sorted.push_back(std::move(*it));
        mods_.erase(it);
    }
    for (Mod& m : mods_) sorted.push_back(std::move(m));
    mods_ = std::move(sorted);
}

std::vector<std::string> ModManager::enabledDirs() const {
    std::vector<std::string> out;
    if (!active_) return out;
    for (const Mod& m : mods_) if (m.enabled) out.push_back(m.dir);
    return out;
}

std::vector<PluginEntry> ModManager::extraPlugins() const {
    std::vector<PluginEntry> out;
    if (!active_) return out;
    for (const Mod& m : mods_)
        if (m.enabled) out.insert(out.end(), m.plugins.begin(), m.plugins.end());
    return out;
}

std::vector<ParamOverride> ModManager::paramOverrides() const {
    std::vector<ParamOverride> out;
    if (!active_) return out;
    for (const Mod& m : mods_)
        if (m.enabled) out.insert(out.end(), m.paramOverrides.begin(), m.paramOverrides.end());
    return out;
}

std::vector<ModManager::Conflict> ModManager::conflicts() const {
    std::map<std::string, Conflict> by;
    for (const Mod& m : mods_) {
        if (!m.enabled) continue;
        for (const std::string& f : m.files) {
            std::string key = conflictKey(f);
            Conflict& c = by[key];
            if (c.file.empty()) c.file = key;
            c.mods.push_back(m.id);
        }
    }
    std::vector<Conflict> out;
    for (auto& [k, c] : by) if (c.mods.size() > 1) out.push_back(std::move(c));
    return out;
}
