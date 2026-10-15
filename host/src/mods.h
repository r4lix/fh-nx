/* Mods for the host: the layered file view (src/vfs) and the plugin additions of enabled mods, exposed to the
 * JS side as nx.modResolve / nx.modPlugins. The mods menu lives in mods_menu.cpp on top of the same state. */
#pragma once
#include "quickjs.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Scan <modsDir>/<id>/mod.json, load <ini> (enabled flags + order), and layer the enabled mods over <www>.
 * Returns the number of mods found. */
int mods_init(const char *www, const char *modsDir, const char *ini);

/* nx.modResolve(rel) -> [path, encrypted] when an enabled mod overrides `rel` (a path under www/, using the
 * encrypted spelling the engine asks for), else null.   nx.modPlugins() -> JSON {"plugins":[..],"overrides":[..]} */
void mods_js_init(JSContext *ctx, JSValueConst nx);

#ifdef __cplusplus
}
#endif
