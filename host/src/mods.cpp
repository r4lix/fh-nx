#include "mods.h"
#include "mods_state.hpp"

#include <cstdio>
#include <string>

ModsState& mods_state() {
    static ModsState s;
    return s;
}

namespace {

std::string jesc(const std::string& s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
        case '"': o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n"; break;
        case '\r': o += "\\r"; break;
        case '\t': o += "\\t"; break;
        default:
            if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
            else o += (char)c;
        }
    }
    return o + "\"";
}

std::string params(const std::vector<std::pair<std::string, std::string>>& p) {
    std::string o = "{";
    for (size_t i = 0; i < p.size(); i++) {
        if (i) o += ",";
        o += jesc(p[i].first) + ":" + jesc(p[i].second);
    }
    return o + "}";
}

bool endsWith(const std::string& s, const char* e) {
    size_t n = std::char_traits<char>::length(e);
    return s.size() >= n && s.compare(s.size() - n, n, e) == 0;
}

/* The engine asks for the encrypted spelling (.rpgmvp); the Vfs takes the plain name and finds either twin. */
std::string logicalName(const std::string& rel) {
    if (endsWith(rel, ".rpgmvp")) return rel.substr(0, rel.size() - 7) + ".png";
    if (endsWith(rel, ".rpgmvo")) return rel.substr(0, rel.size() - 7) + ".ogg";
    if (endsWith(rel, ".rpgmvm")) return rel.substr(0, rel.size() - 7) + ".m4a";
    return rel;
}

JSValue js_mod_resolve(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    ModsState& s = mods_state();
    if (!s.vfs || argc < 1) return JS_NULL;
    const char* rel = JS_ToCString(ctx, argv[0]);
    if (!rel) return JS_EXCEPTION;
    std::string logical = logicalName(rel);
    JS_FreeCString(ctx, rel);
    auto r = s.vfs->resolve(logical);
    if (!r || r->layer == 0) return JS_NULL;               // the base game: the caller's own path is right
    JSValue a = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, a, 0, JS_NewString(ctx, r->path.c_str()));
    JS_SetPropertyUint32(ctx, a, 1, JS_NewBool(ctx, r->encrypted));
    return a;
}

JSValue js_mod_plugins(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    ModsState& s = mods_state();
    std::string out = "{\"plugins\":[";
    bool first = true;
    for (const PluginEntry& p : s.mm.extraPlugins()) {
        if (!first) out += ",";
        first = false;
        out += "{\"name\":" + jesc(p.name) + ",\"description\":" + jesc(p.description) + ",\"parameters\":" + params(p.params) + "}";
    }
    out += "],\"overrides\":[";
    first = true;
    for (const ParamOverride& o : s.mm.paramOverrides()) {
        if (!first) out += ",";
        first = false;
        out += "{\"plugin\":" + jesc(o.plugin) + ",\"parameters\":" + params(o.params) + "}";
    }
    out += "]}";
    return JS_NewString(ctx, out.c_str());
}

} // namespace

extern "C" int mods_init(const char* www, const char* modsDir, const char* ini) {
    ModsState& s = mods_state();
    s.www = www;
    s.modsDir = modsDir;
    s.ini = ini;
    size_t n = s.mm.scan(modsDir);
    s.mm.loadConfig(ini);
    s.vfs = std::make_unique<Vfs>(www);
    s.vfs->setMods(s.mm.enabledDirs());
    s.model = std::make_unique<ModMenuModel>(s.mm, ini);
    return (int)n;
}

extern "C" void mods_js_init(JSContext* ctx, JSValueConst nx) {
    JS_SetPropertyStr(ctx, nx, "modResolve", JS_NewCFunction(ctx, js_mod_resolve, "modResolve", 1));
    JS_SetPropertyStr(ctx, nx, "modPlugins", JS_NewCFunction(ctx, js_mod_plugins, "modPlugins", 0));
}
