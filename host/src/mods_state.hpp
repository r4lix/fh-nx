// Shared state of the mods subsystem (mods.cpp owns it, the menu reads and edits it).
#pragma once
#include "../../src/menu/ModMenuModel.hpp"
#include "../../src/vfs/ModManager.hpp"
#include "../../src/vfs/Vfs.hpp"
#include <memory>
#include <string>

struct ModsState {
    ModManager mm;
    std::unique_ptr<Vfs> vfs;
    std::unique_ptr<ModMenuModel> model;
    std::string www, modsDir, ini;
};

ModsState& mods_state();
