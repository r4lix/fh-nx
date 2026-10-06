#pragma once
#include "quickjs.h"

/* A fast allocator for the QuickJS runtime. QuickJS performs a malloc/free for nearly every object, string
 * and closure (millions per second in MV), and libc malloc on the Switch is slow and lock-protected.
 * This is a single-threaded size-class pool: blocks up to 1 KB come from per-class free lists carved out of
 * 1 MB chunks, anything larger goes to malloc. It also reports true usable sizes, which lets QuickJS grow
 * strings in place. The runtime must only ever be used from the thread that created it. */
const JSMallocFunctions *js_fast_malloc_functions(void);
