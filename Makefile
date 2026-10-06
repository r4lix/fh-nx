# Host build (g++/MSYS2) for the parts that do not touch the Switch.
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O1 -g -Wall -Wextra

CORE := src/core/Json.cpp src/vfs/Vfs.cpp src/vfs/ModManager.cpp
MENU := src/menu/ModMenuModel.cpp
HDRS := $(wildcard src/*/*.hpp)

build/test_vfs: $(CORE) tests/test_vfs.cpp $(HDRS)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(CORE) tests/test_vfs.cpp -o $@

build/test_menu: $(CORE) $(MENU) tests/test_menu.cpp $(HDRS)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(CORE) $(MENU) tests/test_menu.cpp -o $@

.PHONY: test clean
test: build/test_vfs build/test_menu
	./build/test_vfs
	./build/test_menu

clean:
	rm -rf build
