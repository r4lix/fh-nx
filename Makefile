# Host build (g++/MSYS2) for the parts that do not touch the Switch: Json, Vfs, ModManager.
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O1 -g -Wall -Wextra

SRC := src/core/Json.cpp src/vfs/Vfs.cpp src/vfs/ModManager.cpp

build/test_vfs: $(SRC) tests/test_vfs.cpp $(wildcard src/*/*.hpp)
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(SRC) tests/test_vfs.cpp -o $@

.PHONY: test clean
test: build/test_vfs
	./build/test_vfs

clean:
	rm -rf build
