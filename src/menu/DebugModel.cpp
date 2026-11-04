#include "DebugModel.hpp"
#include <cstdio>
#include <cstdlib>
#include <sstream>

void DebugModel::setState(const std::string& text) {
    maps_.clear();
    items_.clear();
    heal = false;
    teleport = 0;
    whereMap = whereX = whereY = 0;
    whereName.clear();
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        std::istringstream ls(line);
        std::string key;
        ls >> key;
        auto rest = [&]() { std::string r; std::getline(ls, r); if (!r.empty() && r[0] == ' ') r.erase(0, 1); return r; };
        int v = 0;
        if (key == "noclip") { ls >> v; noclip = v != 0; }
        else if (key == "god") { ls >> v; god = v != 0; }
        else if (key == "speed") ls >> speed;
        else if (key == "light") ls >> light;
        else if (key == "lightlock") { ls >> v; lightLock = v != 0; }
        else if (key == "fullbright") { ls >> v; fullBright = v != 0; }
        else if (key == "where") { ls >> whereMap >> whereX >> whereY; whereName = rest(); }
        else if (key == "map") { Map m; ls >> m.id; m.name = rest(); maps_.push_back(m); }
        else if (key == "item") {
            Item it; std::string k;
            ls >> k >> it.id >> it.owned;
            it.kind = k.empty() ? 'i' : k[0];
            it.name = rest();
            items_.push_back(it);
        }
    }
    give.assign(items_.size(), 0);
    noclip0_ = noclip; god0_ = god; lightLock0_ = lightLock; fullBright0_ = fullBright;
    speed0_ = speed; light0_ = light;
    available_ = !text.empty();
}

std::string DebugModel::commands() const {
    std::string s;
    char b[96];
    if (noclip != noclip0_) s += noclip ? "noclip 1\n" : "noclip 0\n";
    if (god != god0_) s += god ? "god 1\n" : "god 0\n";
    if (speed != speed0_) { snprintf(b, sizeof b, "speed %d\n", speed); s += b; }
    if (light != light0_) { snprintf(b, sizeof b, "light %d\n", light); s += b; }
    if (lightLock != lightLock0_) s += lightLock ? "lightlock 1\n" : "lightlock 0\n";
    if (fullBright != fullBright0_) s += fullBright ? "fullbright 1\n" : "fullbright 0\n";
    if (heal) s += "heal\n";
    for (size_t i = 0; i < give.size() && i < items_.size(); i++)
        if (give[i] > 0) { snprintf(b, sizeof b, "give %c %d %d\n", items_[i].kind, items_[i].id, give[i]); s += b; }
    if (teleport > 0) { snprintf(b, sizeof b, "teleport %d\n", teleport); s += b; }   // last: the others apply first
    return s;
}

const std::string& DebugModel::mapName(int id) const {
    static const std::string none;
    for (const Map& m : maps_) if (m.id == id) return m.name;
    return none;
}

const std::vector<int>& DebugModel::speedSteps() { static const std::vector<int> v = {1, 2, 3, 4, 5, 6}; return v; }
const std::vector<int>& DebugModel::lightSteps() {
    static const std::vector<int> v = {0, 50, 100, 150, 200, 300, 400, 600, 900, 1500};
    return v;
}
static int nextIn(const std::vector<int>& v, int cur) {
    for (size_t i = 0; i < v.size(); i++) if (v[i] > cur) return v[i];
    return v.front();
}
void DebugModel::cycleSpeed() { speed = nextIn(speedSteps(), speed); }
void DebugModel::cycleLight() { light = nextIn(lightSteps(), light); }
