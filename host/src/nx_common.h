#pragma once
#include "quickjs.h"

/* Platform-neutral half of the `nx` object, shared by the Switch host and the PC test harness:
 *   log(str)  now() -> ms  sleep(ms)
 *   readFile(path) -> string|null (UTF-8, BOM stripped)    readBinary(path) -> ArrayBuffer|null
 *   writeFile(path, string|ArrayBuffer) -> bool            removeFile(path) -> bool    mkdir(path) -> bool
 *   loadScript(path) -> true (global eval; an exception is logged, the script still counts as loaded) | null (unreadable)
 *   root                                                    the game's www/ directory
 * No libnx dependency. */
typedef void (*NxLogFn)(const char *msg);

void nx_common_init(JSContext *ctx, JSValueConst nx, const char *root, NxLogFn log);
void nx_dump_exception(JSContext *ctx);
