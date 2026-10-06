#pragma once
#include <string>
#include <vector>

// Minimal JSON reader, enough for mod.json. No writer: nothing in the port needs one.
struct Json {
    enum Type { Null, Bool, Num, Str, Arr, Obj };
    Type t = Null;
    bool b = false;
    double n = 0;
    std::string s;
    std::vector<Json> a;                // Arr items, or Obj values
    std::vector<std::string> keys;      // Obj keys, parallel to `a`

    const Json* get(const std::string& key) const;
    std::string str(const std::string& key, const std::string& def = "") const;
    bool boolean(const std::string& key, bool def = false) const;
    double num(const std::string& key, double def = 0) const;

    static bool parse(const std::string& text, Json& out, std::string& err);
};
