# Host build (g++/MSYS2) for the parts that do not touch the Switch.
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O1 -g -Wall -Wextra

CORE := src/core/Json.cpp src/vfs/Vfs.cpp src/vfs/ModManager.cpp
MENU := src/menu/ModMenuModel.cpp
HDRS := $(wildcard src/*/*.hpp)
IMGUI := $(wildcard third_party/imgui/*.cpp)
UI    := src/menu/ModMenuUi.cpp

build/test_vfs: $(CORE) tests/test_vfs.cpp $(HDRS)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(CORE) tests/test_vfs.cpp -o $@

build/test_menu: $(CORE) $(MENU) tests/test_menu.cpp $(HDRS)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(CORE) $(MENU) tests/test_menu.cpp -o $@

build/test_ui: $(CORE) $(MENU) $(UI) $(IMGUI) tests/test_ui.cpp $(HDRS)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -Ithird_party/imgui $(CORE) $(MENU) $(UI) $(IMGUI) tests/test_ui.cpp -o $@

# ---- host tests that need QuickJS (QJS=/path/to/quickjs-ng) ----------------------------------------
QJS  ?= /tmp/qjs
WWW  ?= C:/Jeux/fh clean build/Fear & Hunger/www
FONT ?= $(WWW)/fonts/Eczar-Regular.ttf
VORBIS := $(addprefix third_party/vorbis/lib/,mdct smallft block envelope window lsp lpc analysis synthesis psy info floor1 floor0 res0 mapping0 registry codebook sharedbook lookup bitrate vorbisfile)
OGG    := third_party/ogg/src/bitwise third_party/ogg/src/framing
QJS_C  := $(QJS)/quickjs.c $(QJS)/libregexp.c $(QJS)/libunicode.c $(QJS)/dtoa.c
HOST_C := host/src/nx_common.c host/src/js_canvas.c host/src/audio_mix.c host/src/js_alloc.c $(addsuffix .c,$(VORBIS) $(OGG))
HOST_CF := -std=gnu11 -O2 -g -w -I$(QJS) -Ithird_party/imgui -Ithird_party/stb -Ithird_party/vorbis/include -Ithird_party/vorbis/lib -Ithird_party/ogg/include -D_GNU_SOURCE
HOST_DEPS := $(HOST_C) host/src/js_canvas.h host/src/audio_mix.h host/src/nx_common.h host/src/js_alloc.h

build/canvas_host: tests/canvas_host.c $(HOST_DEPS)
	@mkdir -p build
	$(CC) $(HOST_CF) tests/canvas_host.c $(HOST_C) $(QJS_C) -lm -lpthread -o $@
# the mods subsystem is C++: compile it to objects and link the whole host with g++
MODS_CPP := host/src/mods.cpp src/vfs/Vfs.cpp src/vfs/ModManager.cpp src/core/Json.cpp src/menu/ModMenuModel.cpp
MODS_OBJ := $(patsubst %.cpp,build/mods_obj/%.o,$(MODS_CPP))
build/mods_obj/%.o: %.cpp host/src/mods.h host/src/mods_state.hpp
	@mkdir -p $(dir $@)
	$(CXX) -std=c++17 -O2 -g -w -I$(QJS) -Ithird_party/imgui -c $< -o $@
BOOT_C := tests/boot_host.c $(HOST_C) $(QJS_C)
BOOT_OBJ := $(patsubst %.c,build/boot_obj/%.o,$(subst :,_,$(BOOT_C)))
build/boot_obj/%.o: %.c $(HOST_DEPS)
	@mkdir -p $(dir $@)
	$(CC) $(HOST_CF) -c $< -o $@
build/boot_host: $(BOOT_OBJ) $(MODS_OBJ)
	@mkdir -p build
	$(CXX) $(BOOT_OBJ) $(MODS_OBJ) -lm -lpthread -o $@

# canvas 2D rasteriser checks (90) and the audio mixer checks (needs build/test_*.ogg, made by decrypt_one.py)
canvas-test: build/canvas_host
	./build/canvas_host tests/canvas_test.js "$(FONT)" build
build/test_se.ogg:
	python tools/decrypt_one.py "$(WWW)" audio/se/horror_chord.rpgmvo build/test_se.ogg
build/test_bgm.ogg:
	python tools/decrypt_one.py "$(WWW)" audio/bgm/fear_and_hunger.rpgmvo build/test_bgm.ogg
audio-test: build/canvas_host build/test_se.ogg build/test_bgm.ogg
	./build/canvas_host tests/audio_test.js x build
bench: build/canvas_host
	./build/canvas_host tests/canvas_bench.js x build
# boot the real MV engine against a fake GL; EXTRA=tests/play_script.js scripts the pad through New Game
SECONDS ?= 20
boot-test: build/boot_host
	./build/boot_host "$(WWW)" "$(CURDIR)" $(SECONDS) build/save $(EXTRA)

.PHONY: canvas-test audio-test bench boot-test

# ---- pure-C++ tests: JSON/VFS/mod manager, menu model, ImGui menu (no QuickJS needed) -----------------
.PHONY: test clean
test: build/test_vfs build/test_menu build/test_ui
	./build/test_vfs
	./build/test_menu
	./build/test_ui

clean:
	rm -rf build
