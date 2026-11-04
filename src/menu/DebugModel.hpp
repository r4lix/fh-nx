#pragma once
#include <string>
#include <vector>

// Testing cheats for the menu's Debug tab. The game (boot.js, __debugMenuState) describes its state as text lines when the menu
// opens; the menu stages changes here; when it closes, commands() is handed back to the game (__debugMenuApply).
//
// State lines from the game:          Command lines back to the game:
//   noclip 0|1                          noclip 0|1
//   god 0|1                             god 0|1
//   speed <1-6>                         speed <n>
//   light <radius>                      light <radius>
//   lightlock 0|1                       lightlock 0|1
//   fullbright 0|1                      fullbright 0|1
//   where <mapId> <x> <y> <name>        heal
//   map <id> <name>                     teleport <mapId>
//   item <i|w|a> <id> <owned> <name>    give <i|w|a> <id> <count>
class DebugModel {
public:
    struct Map { int id; std::string name; };
    struct Item { char kind; int id; int owned; std::string name; };

    void setState(const std::string& text);    // replaces everything, clears staged actions
    bool available() const { return available_; }
    std::string commands() const;               // "" when nothing changed

    bool noclip = false, god = false, lightLock = false, fullBright = false;
    int speed = 4, light = 300;
    bool heal = false;
    int teleport = 0;                           // 0 = none
    std::vector<int> give;                      // per item index: how many to add

    int whereMap = 0, whereX = 0, whereY = 0;
    std::string whereName;
    const std::vector<Map>& maps() const { return maps_; }
    const std::vector<Item>& items() const { return items_; }
    const std::string& mapName(int id) const;

    static const std::vector<int>& speedSteps();
    static const std::vector<int>& lightSteps();
    void cycleSpeed();
    void cycleLight();

private:
    bool available_ = false;
    bool noclip0_ = false, god0_ = false, lightLock0_ = false, fullBright0_ = false;
    int speed0_ = 4, light0_ = 300;
    std::vector<Map> maps_;
    std::vector<Item> items_;
};
