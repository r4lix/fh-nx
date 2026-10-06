// Host-side tests for the mod layer: Json, Vfs, ModManager. Plain asserts, no framework.
#include "../src/core/Json.hpp"
#include "../src/vfs/ModManager.hpp"
#include "../src/vfs/Vfs.hpp"
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static void put(const fs::path& p, const std::string& data) {
    fs::create_directories(p.parent_path());
    std::ofstream(p, std::ios::binary) << data;
}

static void testJson() {
    Json j; std::string err;
    CHECK(Json::parse("\xEF\xBB\xBF{\"a\":[1,2.5,\"x\\u00e9\\n\"],\"b\":true,\"c\":null,\"d\":{\"e\":\"f\"}}", j, err));
    CHECK(j.t == Json::Obj);
    CHECK(j.get("a") && j.get("a")->a.size() == 3);
    CHECK(j.get("a")->a[1].n == 2.5);
    CHECK(j.get("a")->a[2].s == "x\xC3\xA9\n");
    CHECK(j.boolean("b"));
    CHECK(j.get("d")->str("e") == "f");
    CHECK(j.str("missing", "dflt") == "dflt");
    CHECK(Json::parse("\"\\ud83d\\ude00\"", j, err) && j.s == "\xF0\x9F\x98\x80");
    CHECK(!Json::parse("{\"a\":}", j, err));
    CHECK(!Json::parse("[1,2", j, err));
    CHECK(!Json::parse("{} x", j, err));
}

static void testNormalize() {
    CHECK(Vfs::normalize("img\\pictures/./a.png") == "img/pictures/a.png");
    CHECK(Vfs::normalize("/img//a.png") == "img/a.png");
    CHECK(!Vfs::normalize("../secret"));
    CHECK(!Vfs::normalize("img/../../x"));
    CHECK(!Vfs::normalize("C:/Windows/x"));
    CHECK(!Vfs::normalize(""));
}

int main() {
    fs::path root = fs::temp_directory_path() / "fh_vfs_test";
    fs::remove_all(root);
    fs::path base = root / "www", mods = root / "mods";

    put(base / "img/pictures/a.rpgmvp", "base-a-enc");
    put(base / "img/pictures/b.rpgmvp", "base-b-enc");
    put(base / "audio/bgm/x.rpgmvo", "base-x");
    put(base / "data/Map074.json", "base-map");

    put(mods / "hdart/mod.json", R"({"name":"HD Art","version":"1.0"})");
    put(mods / "hdart/img/pictures/a.png", "hd-a-plain");
    put(mods / "hdart/img/pictures/c.png", "hd-c");
    put(mods / "mapfix/mod.json", R"({"name":"Map fix","affects_saves":true})");
    put(mods / "mapfix/data/Map074.json", "fixed-map");
    put(mods / "mapfix/img/pictures/a.rpgmvp", "fix-a-enc");
    put(mods / "cheat/mod.json", R"({"name":"Cheat","plugins":[{"name":"AlwaysWin","parameters":{"on":"1"}},"Plain"]})");
    put(mods / "cheat/js/plugins/AlwaysWin.js", "//");
    put(mods / "hdart/mod.json", R"({"name":"HD Art","version":"1.0","plugin_params":[{"plugin":"TerraxLighting","params":{"Screensize X":"1280"}},{"params":{}}]})");
    put(mods / "broken/mod.json", "{ nope");
    put(mods / "nomanifest/readme.txt", "x");

    testJson();
    testNormalize();

    // --- ModManager
    ModManager mm;
    CHECK(mm.scan(mods.string()) == 3);
    CHECK(mm.errors().size() == 2);
    CHECK(mm.find("mapfix")->affectsSaves);
    CHECK(mm.find("cheat")->plugins.size() == 2);
    CHECK(mm.find("cheat")->plugins[0].params.size() == 1);
    CHECK(mm.find("hdart")->files.size() == 2);          // mod.json excluded
    CHECK(mm.enabledDirs().empty());                      // everything starts disabled

    // --- Vfs: base only
    Vfs vfs(base.string());
    auto r = vfs.resolve("img/pictures/a.png");
    CHECK(r && r->layer == 0 && r->encrypted);            // base asset is the encrypted twin
    CHECK(!vfs.exists("img/pictures/c.png"));
    CHECK(!vfs.exists("../mods/hdart/mod.json"));

    // --- enable mods: later wins
    mm.setEnabled("hdart", true);
    mm.setEnabled("mapfix", true);
    vfs.setMods(mm.enabledDirs());
    r = vfs.resolve("img/pictures/a.png");
    CHECK(r && r->encrypted && r->layer == 2);            // mapfix loads after hdart, so its file wins
    r = vfs.resolve("img/pictures/c.png");
    CHECK(r && !r->encrypted && r->layer == 1);           // plain mod PNG, no encrypted twin needed
    std::vector<uint8_t> buf;
    CHECK(vfs.read("data/Map074.json", buf) && std::string(buf.begin(), buf.end()) == "fixed-map");
    CHECK(vfs.exists("img/pictures/c.png"));
    CHECK(vfs.exists("img/pictures/b.png"));              // untouched base asset still reachable

    // --- conflicts: hdart a.png vs mapfix a.rpgmvp are the same logical asset
    auto cf = mm.conflicts();
    CHECK(cf.size() == 1 && cf[0].file == "img/pictures/a.png");
    CHECK(cf[0].mods.size() == 2 && cf[0].mods[0] == "hdart" && cf[0].mods[1] == "mapfix");

    // --- load order flips the winner
    size_t hd = 0;
    for (size_t i = 0; i < mm.mods().size(); i++) if (mm.mods()[i].id == "hdart") hd = i;
    CHECK(mm.move(hd, +1));                               // hdart now loads after mapfix
    vfs.setMods(mm.enabledDirs());
    r = vfs.resolve("img/pictures/a.png");
    CHECK(r && !r->encrypted && r->path.find("hdart") != std::string::npos);

    // --- plugin parameter overrides
    CHECK(mm.find("hdart")->paramOverrides.size() == 1);   // entry without a plugin name is skipped
    auto po = mm.paramOverrides();                          // hdart and mapfix are enabled here
    CHECK(po.size() == 1 && po[0].plugin == "TerraxLighting" && po[0].params[0].second == "1280");
    mm.setEnabled("hdart", false);
    CHECK(mm.paramOverrides().empty());
    mm.setEnabled("hdart", true);

    // --- plugins only come from enabled mods
    CHECK(mm.extraPlugins().empty());
    mm.setEnabled("cheat", true);
    CHECK(mm.extraPlugins().size() == 2);
    mm.setEnabled("cheat", false);

    // --- ini round trip keeps order, state, and picks up new mods disabled
    fs::path ini = root / "config/mods.ini";
    CHECK(mm.saveConfig(ini.string()));
    ModManager again;
    again.scan(mods.string());
    again.loadConfig(ini.string());
    CHECK(again.mods().size() == 3);
    for (size_t i = 0; i < 3; i++) {
        CHECK(again.mods()[i].id == mm.mods()[i].id);
        CHECK(again.mods()[i].enabled == mm.mods()[i].enabled);
    }
    put(mods / "zz_new/mod.json", "{}");
    ModManager third;
    third.scan(mods.string());
    third.loadConfig(ini.string());
    CHECK(third.mods().size() == 4 && third.mods().back().id == "zz_new" && !third.mods().back().enabled);

    fs::remove_all(root);
    std::printf(failures ? "%d FAILED\n" : "all tests passed\n", failures);
    return failures ? 1 : 0;
}
