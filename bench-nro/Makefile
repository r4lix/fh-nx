# Cross-build the on-device QuickJS benchmark. Needs devkitPro (DEVKITPRO) and a quickjs-ng
# checkout (QJS=/path/to/quickjs-ng).
DEVKITPRO ?= /opt/devkitpro
QJS       ?= /tmp/qjs
CC        := $(DEVKITPRO)/devkitA64/bin/aarch64-none-elf-gcc
ARCH      := -march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE
CFLAGS    := -O2 -g $(ARCH) -D__SWITCH__ -I$(DEVKITPRO)/libnx/include -I$(QJS) -D_GNU_SOURCE -w
LDFLAGS   := -specs=$(DEVKITPRO)/libnx/switch.specs -g $(ARCH) -L$(DEVKITPRO)/libnx/lib
QSRC      := $(QJS)/quickjs.c $(QJS)/libregexp.c $(QJS)/libunicode.c $(QJS)/dtoa.c

build/fh-bench.nro: build/fh-bench.elf
	$(DEVKITPRO)/tools/bin/elf2nro $< $@ --icon=$(DEVKITPRO)/libnx/default_icon.jpg --nacp=build/fh-bench.nacp
build/fh-bench.nacp:
	@mkdir -p build
	$(DEVKITPRO)/tools/bin/nacptool --create "fh-nx bench" "r4lix" "0.1" $@
build/fh-bench.elf: main.c $(QSRC) build/fh-bench.nacp
	$(CC) $(CFLAGS) main.c $(QSRC) $(LDFLAGS) -lnx -lm -o $@
clean:
	rm -rf build
