#!/bin/sh
# Rebuilds the optional Nexus mods from their extracted archives (see mods-src/ and tools/make_mod.py).
#   tools/convert_nexus_mods.sh <dir with the archives extracted to <nexus id>/> <clean www> <mods dir>
# Every mod is written untested (the menu marks it so); flip "tested" in its mod.json after trying it on a Switch.
set -e
X=${1:?extracted dir}; C=${2:?clean www}; M=${3:?mods dir}
mm() { python "$(dirname "$0")/make_mod.py" "$@"; }
N=https://www.nexusmods.com/fearandhunger/mods

mm "$X/11" "$C" "$M" --id nx-infinite-saves --name "Infinite Saves (Easy Mod)" --author ADarkRaccoon --url $N/11 --version 1.4.1 \
   --description "A body in front of the dungeons holds 99 Books of Enlightenment, so you can save as often as you like. Changes the title screen."
mm "$X/13" "$C" "$M" --id nx-sfw --name "Immersive Censorship (SFW Edition)" --author "Platty Gems" --url $N/13 --version 1.1 \
   --description "Makes the game SFW without breaking immersion. Replaces many images and sounds."
mm "$X/24/AutoSave" "$C" "$M" --id nx-autosave --name "Autosave" --author Solnijko --url $N/24 --version 1.0.1 --plugin OrangeAutoSave \
   --description "The first two save slots become autosaves, written each time the party enters a map, alternating between the two."
mm "$X/25" "$C" "$M" --id nx-unlimited-saves --name "Unlimited Saves" --author Soren59 --url $N/25 --version 1.0 \
   --description "The Book of Enlightenment is no longer consumed when used (you still have to find it). Replaces Items.json."
mm "$X/45" "$C" "$M" --id nx-magic-portal --name "Magic Portal" --author DevGTD --url $N/45 --version 1.0 \
   --description "Portals at the start of the game give you every item and skill, for testing or fun. Replaces the first map (Map074.json)."
mm "$X/64" "$C" "$M" --id nx-no-item-limit --name "No Items Limit" --author DevGTD --url $N/64 --version 1.0 \
   --description "The stack limit for items is 9999 instead of 99. Replaces rpg_objects.js."
mm "$X/170/FearAndHunger_AdminPanel_v1.1.0/www" "$C" "$M" --id nx-admin-panel --name "Admin Panel" --author Mojam --url $N/170 --version 1.1.0 --plugin AdminPanel \
   --description "In-game panel for stats, items, skills and events. Its panel is built from web-page (HTML) elements and opened with F10, and the Switch port has neither a browser nor a keyboard, so it is not expected to work."
mm "$X/193" "$C" "$M" --id nx-better-torches --name "Better Torches" --author IzzyRedAndBlue --url $N/193 --version 1.0 \
   --description "Torches last longer and light a larger radius. Replaces CommonEvents.json."
mm "$X/195" "$C" "$M" --id nx-better-consumables --name "Better Consumable Items" --author IzzyRedAndBlue --url $N/195 --version 1.0 \
   --description "More consistent effects for consumable and throwable items. Replaces Items.json, so it conflicts with Unlimited Saves."
mm "$X/206" "$C" "$M" --id nx-funger-trainer --name "Funger Trainer (ULTIMATE Cheat Menu)" --author BMO --url $N/206 --version 2.2.0 \
   --copy "Funger Trainer.js=js/plugins/FungerTrainer.js" --plugin FungerTrainer \
   --description "Cheat menu: god mode, infinite Mind, frozen Hunger, items, teleport and more. Its menu is built from web-page (HTML) elements and opened with F10, and the Switch port has neither a browser nor a keyboard, so it is not expected to work."
mm "$X/164" "$C" "$M" --id nx-more-accessory-slots --name "More Accessory Slots (save compatible)" --author Gabriel --url $N/164 --version 2.0 \
   --copy "MoreSlots.js=js/plugins/MoreSlots.js" --plugin MoreSlots \
   --description "Four extra accessory slots for every character, with a fix so older saves still load."
mm "$X/207" "$C" "$M" --id nx-better-movement --name "Better Movement" --author "MaximusImpetus (Analog Move by Sanshiro, modified by Athones; MIT)" --url $N/207 --version 1.2 \
   --copy "Better_Movement.js=js/plugins/Better_Movement.js" --plugin Better_Movement \
   --description "Pixel-based free movement instead of tile steps; the Dash skill doubles the speed."
mm "$X/117" "$C" "$M" --id nx-quick-loot --name "Quick Loot" --author "Swander (sounds: ZapSplat, Sonic SoundFX)" --url $N/117 --version 1.0.3 \
   --copy "YEP_GabWindowQuickLoot.js=js/plugins/YEP_GabWindowQuickLoot.js" --copy "credits.txt=CREDITS.txt" --plugin YEP_GabWindowQuickLoot \
   --description "Loot containers and bodies without the message window pausing the game, with sound effects per container type."
