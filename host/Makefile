# Cross-build the native host skeleton (Switch). Needs devkitPro and a quickjs-ng checkout
# (QJS=/path/to/quickjs-ng).
DEVKITPRO ?= /opt/devkitpro
QJS       ?= /tmp/qjs
PORTLIBS  := $(DEVKITPRO)/portlibs/switch
CC        := $(DEVKITPRO)/devkitA64/bin/aarch64-none-elf-gcc
CXX       := $(DEVKITPRO)/devkitA64/bin/aarch64-none-elf-g++
ARCH      := -march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE
CFLAGS    := -O2 -g $(ARCH) -D__SWITCH__ -I$(DEVKITPRO)/libnx/include -I$(PORTLIBS)/include -I$(QJS) -I../third_party/imgui -I../third_party/stb -D_GNU_SOURCE -Wall -Wno-unused-parameter -Wno-unused-function
LDFLAGS   := -specs=$(DEVKITPRO)/libnx/switch.specs -g $(ARCH) -L$(DEVKITPRO)/libnx/lib -L$(PORTLIBS)/lib
QSRC      := $(QJS)/quickjs.c $(QJS)/libregexp.c $(QJS)/libunicode.c $(QJS)/dtoa.c
SRC       := src/main.c src/js_gl.c

build/fh-nx.nro: build/fh-nx.elf build/fh-nx.nacp
	$(DEVKITPRO)/tools/bin/elf2nro $< $@ --icon=$(DEVKITPRO)/libnx/default_icon.jpg --nacp=build/fh-nx.nacp
build/fh-nx.nacp:
	@mkdir -p build
	$(DEVKITPRO)/tools/bin/nacptool --create "Fear & Hunger NX" "r4lix" "0.0.1" $@
# quickjs is compiled without warnings: it is third-party and noisy
build/quickjs.o: $(QSRC)
	@mkdir -p build
	$(CC) $(CFLAGS) -w -c $(QJS)/quickjs.c -o build/quickjs.o
	$(CC) $(CFLAGS) -w -c $(QJS)/libregexp.c -o build/libregexp.o
	$(CC) $(CFLAGS) -w -c $(QJS)/libunicode.c -o build/libunicode.o
	$(CC) $(CFLAGS) -w -c $(QJS)/dtoa.c -o build/dtoa.o
VORBIS_SRC := $(addprefix ../third_party/vorbis/lib/,mdct smallft block envelope window lsp lpc analysis synthesis psy info floor1 floor0 res0 mapping0 registry codebook sharedbook lookup bitrate vorbisfile)
OGG_SRC    := ../third_party/ogg/src/bitwise ../third_party/ogg/src/framing
AUDIO_INC  := -I../third_party/vorbis/include -I../third_party/vorbis/lib -I../third_party/ogg/include
THIRD_OBJ  := $(addprefix build/tp_,$(notdir $(VORBIS_SRC) $(OGG_SRC)))
THIRD_OBJ  := $(addsuffix .o,$(THIRD_OBJ))
# third-party code is compiled without warnings
$(foreach f,$(VORBIS_SRC) $(OGG_SRC),$(eval build/tp_$(notdir $(f)).o: $(f).c ; @mkdir -p build ; $(CC) $(CFLAGS) $(AUDIO_INC) -w -c $$< -o $$@))

# the rasteriser is float-heavy and self-contained: let the compiler vectorise it (never QuickJS: JS needs strict NaN/inf)
build/js_canvas.o: CFLAGS += -O3 -ffast-math
build/%.o: src/%.c src/js_gl.h src/js_canvas.h src/nx_common.h src/audio_mix.h src/audio_out.h src/js_alloc.h src/gl_consts.inc
	@mkdir -p build
	$(CC) $(CFLAGS) $(AUDIO_INC) -c $< -o $@
# linked with g++: Mesa's EGL is C++
build/fh-nx.elf: build/main.o build/nx_common.o build/js_gl.o build/js_canvas.o build/audio_mix.o build/audio_out.o build/js_alloc.o $(THIRD_OBJ) build/quickjs.o build/fh-nx.nacp
	$(CXX) build/main.o build/nx_common.o build/js_gl.o build/js_canvas.o build/audio_mix.o build/audio_out.o build/js_alloc.o $(THIRD_OBJ) build/quickjs.o build/libregexp.o build/libunicode.o build/dtoa.o $(LDFLAGS) 	    -lEGL -lGLESv2 -lglapi -ldrm_nouveau -lnx -lm -o $@
clean:
	rm -rf build
