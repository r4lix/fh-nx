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

# Canvas 2D host tests: QuickJS (QJS=/path/to/quickjs-ng) + the native rasteriser, no GPU.
QJS  ?= /tmp/qjs
FONT ?= $(CURDIR)/tests/fonts/test.ttf
build/canvas_host: tests/canvas_host.c host/src/js_canvas.c host/src/js_canvas.h
	@mkdir -p build
	$(CC) -std=gnu11 -O1 -g -Wno-unused-function -Wno-unused-variable -I$(QJS) -Ithird_party/imgui -Ithird_party/stb tests/canvas_host.c host/src/js_canvas.c $(QJS)/quickjs.c $(QJS)/libregexp.c $(QJS)/libunicode.c $(QJS)/dtoa.c -D_GNU_SOURCE -lm -o $@
canvas-test: build/canvas_host
	./build/canvas_host tests/canvas_test.js "$(FONT)" build

.PHONY: test clean canvas-test
test: build/test_vfs build/test_menu build/test_ui
	./build/test_vfs
	./build/test_menu
	./build/test_ui

clean:
	rm -rf build
