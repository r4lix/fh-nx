// Host-side tests for ModMenuModel: staging, Apply/Reset, and the cost plan.
#include "../src/menu/ModMenuModel.hpp"
#include <cstdio>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static void put(const fs::path& p, const std::string& data) {
    fs::create_directories(p.parent_path());
    std::ofstream(p, std::ios::binary) << data;
}

int main() {
    fs::path root = fs::temp_directory_path() / "fh_menu_test";
    fs::remove_all(root);
    fs::path mods = root / "mods", ini = root / "cfg/mods.ini";

    // art: files only. wide: files + plugin + param override. map: files, touches saves.
    // cheat: plugin only.
    put(mods / "art/mod.json", R"({"name":"Art"})");
    put(mods / "art/img/pictures/a.png", "x");
    put(mods / "art/img/pictures/b.png", "x");
    put(mods / "wide/mod.json", R"({"name":"Wide","plugins":["Full"],"plugin_params":[{"plugin":"T","params":{"k":"v"}}]})");
    put(mods / "wide/img/pictures/a.rpgmvp", "x");
    put(mods / "map/mod.json", R"({"name":"Map","affects_saves":true})");
    put(mods / "map/data/Map074.json", "x");
    put(mods / "cheat/mod.json", R"({"name":"Cheat","plugins":["Win"]})");
    put(mods / "cheat/js/plugins/Win.js", "//");

    ModManager mm;
    mm.scan(mods.string());
    ModMenuModel menu(mm, ini.string());
    CHECK(menu.rows().size() == 4);
    CHECK(!menu.dirty() && !menu.plan().any());

    auto row = [&](const char* id) { for (size_t i = 0; i < menu.rows().size(); i++) if (menu.rows()[i].id == id) return i; return (size_t)99; };

    // --- staging does not touch the manager
    menu.toggle(row("art"));
    CHECK(menu.dirty());
    CHECK(!mm.find("art")->enabled);
    auto p = menu.plan();
    CHECK(p.reloadAssets && !p.restartRuntime && !p.savesWarning);   // art: files only

    menu.toggle(row("cheat"));
    p = menu.plan();
    CHECK(p.reloadAssets && p.restartRuntime);                       // cheat adds a plugin

    menu.toggle(row("map"));
    CHECK(menu.plan().savesWarning);

    // --- reset throws it all away
    menu.reset();
    CHECK(!menu.dirty() && !menu.plan().any());
    CHECK(!menu.rows()[row("art")].enabled);

    // --- apply commits, persists, and the plan clears
    menu.toggle(row("art"));
    menu.toggle(row("wide"));
    CHECK(menu.apply());
    CHECK(mm.find("art")->enabled && mm.find("wide")->enabled);
    CHECK(!menu.dirty() && !menu.plan().any());
    CHECK(mm.extraPlugins().size() == 1);
    CHECK(fs::exists(ini));

    // --- overlaps: art and wide both provide pictures/a (png vs encrypted twin)
    // art loads before wide here (scan order: art, cheat, map, wide)
    auto ov = menu.overlaps(row("art"));
    CHECK(ov.size() == 1 && ov[0].file == "img/pictures/a.png" && ov[0].winner == "wide");
    CHECK(menu.overlaps(row("map")).empty());                        // disabled mod: nothing to show
    // staging a swap flips the winner before anything is applied
    menu.moveDown(row("art"));
    menu.moveDown(row("art"));
    menu.moveDown(row("art"));
    CHECK(menu.rows().back().id == "art");
    ov = menu.overlaps(row("art"));
    CHECK(ov.size() == 1 && ov[0].winner == "art");

    // --- reorder alone: assets reload, runtime restart only because wide has plugins
    p = menu.plan();
    CHECK(p.reloadAssets && p.restartRuntime && !p.savesWarning);
    menu.reset();

    // order change of two file-only mods must not ask for a restart
    menu.toggle(row("cheat"));
    menu.toggle(row("wide"));
    CHECK(menu.apply());
    CHECK(!menu.plan().any());
    menu.toggle(row("wide"));
    menu.moveDown(row("art"));       // art past cheat/map
    menu.reset();
    CHECK(!menu.dirty());

    // --- master switch: off means nothing loads, so the plan is the cost of unloading
    menu.reset();
    menu.setMasterActive(false);
    CHECK(menu.dirty());
    p = menu.plan();
    CHECK(p.reloadAssets && p.restartRuntime);
    CHECK(menu.apply());
    CHECK(!mm.active() && mm.enabledDirs().empty());
    menu.setMasterActive(true);
    CHECK(menu.plan().reloadAssets);                                  // coming back costs the same

    // --- the ini survives: a fresh manager sees the same state
    ModManager fresh;
    fresh.scan(mods.string());
    fresh.loadConfig(ini.string());
    CHECK(!fresh.active());
    CHECK(fresh.find("cheat")->enabled && fresh.find("art")->enabled);

    fs::remove_all(root);
    std::printf(failures ? "%d FAILED\n" : "menu tests passed\n", failures);
    return failures ? 1 : 0;
}
