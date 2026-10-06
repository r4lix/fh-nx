#include "Json.hpp"
#include <cstdlib>

namespace {

struct Parser {
    const std::string& src;
    size_t i = 0;
    std::string err;

    explicit Parser(const std::string& s) : src(s) {}

    void ws() {
        while (i < src.size() && (src[i] == ' ' || src[i] == '\t' || src[i] == '\n' || src[i] == '\r')) i++;
    }
    bool fail(const char* m) {
        if (err.empty()) err = std::string(m) + " at offset " + std::to_string(i);
        return false;
    }
    static void utf8(std::string& o, unsigned cp) {
        if (cp < 0x80) o += (char)cp;
        else if (cp < 0x800) { o += (char)(0xC0 | cp >> 6); o += (char)(0x80 | (cp & 0x3F)); }
        else if (cp < 0x10000) { o += (char)(0xE0 | cp >> 12); o += (char)(0x80 | ((cp >> 6) & 0x3F)); o += (char)(0x80 | (cp & 0x3F)); }
        else { o += (char)(0xF0 | cp >> 18); o += (char)(0x80 | ((cp >> 12) & 0x3F)); o += (char)(0x80 | ((cp >> 6) & 0x3F)); o += (char)(0x80 | (cp & 0x3F)); }
    }
    bool hex4(unsigned& v) {
        if (i + 4 > src.size()) return fail("short unicode escape");
        v = 0;
        for (int k = 0; k < 4; k++) {
            char c = src[i++];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= c - '0';
            else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
            else return fail("bad hex digit");
        }
        return true;
    }
    bool string(std::string& o) {
        if (src[i] != '"') return fail("expected string");
        i++;
        while (i < src.size()) {
            char c = src[i++];
            if (c == '"') return true;
            if (c != '\\') { o += c; continue; }
            if (i >= src.size()) break;
            char e = src[i++];
            switch (e) {
            case '"': o += '"'; break;
            case '\\': o += '\\'; break;
            case '/': o += '/'; break;
            case 'b': o += '\b'; break;
            case 'f': o += '\f'; break;
            case 'n': o += '\n'; break;
            case 'r': o += '\r'; break;
            case 't': o += '\t'; break;
            case 'u': {
                unsigned cp = 0;
                if (!hex4(cp)) return false;
                if (cp >= 0xD800 && cp < 0xDC00 && i + 1 < src.size() && src[i] == '\\' && src[i + 1] == 'u') {
                    i += 2;
                    unsigned lo = 0;
                    if (!hex4(lo)) return false;
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                }
                utf8(o, cp);
                break;
            }
            default: return fail("bad escape");
            }
        }
        return fail("unterminated string");
    }
    bool value(Json& v, int depth) {
        if (depth > 64) return fail("nesting too deep");
        ws();
        if (i >= src.size()) return fail("unexpected end");
        char c = src[i];
        if (c == '{') {
            v.t = Json::Obj;
            i++; ws();
            if (i < src.size() && src[i] == '}') { i++; return true; }
            for (;;) {
                ws();
                std::string k;
                if (!string(k)) return false;
                ws();
                if (i >= src.size() || src[i] != ':') return fail("expected ':'");
                i++;
                Json child;
                if (!value(child, depth + 1)) return false;
                v.keys.push_back(std::move(k));
                v.a.push_back(std::move(child));
                ws();
                if (i < src.size() && src[i] == ',') { i++; continue; }
                if (i < src.size() && src[i] == '}') { i++; return true; }
                return fail("expected ',' or '}'");
            }
        }
        if (c == '[') {
            v.t = Json::Arr;
            i++; ws();
            if (i < src.size() && src[i] == ']') { i++; return true; }
            for (;;) {
                Json child;
                if (!value(child, depth + 1)) return false;
                v.a.push_back(std::move(child));
                ws();
                if (i < src.size() && src[i] == ',') { i++; continue; }
                if (i < src.size() && src[i] == ']') { i++; return true; }
                return fail("expected ',' or ']'");
            }
        }
        if (c == '"') { v.t = Json::Str; return string(v.s); }
        if (src.compare(i, 4, "true") == 0) { v.t = Json::Bool; v.b = true; i += 4; return true; }
        if (src.compare(i, 5, "false") == 0) { v.t = Json::Bool; v.b = false; i += 5; return true; }
        if (src.compare(i, 4, "null") == 0) { v.t = Json::Null; i += 4; return true; }
        if (c == '-' || (c >= '0' && c <= '9')) {
            char* end = nullptr;
            v.n = std::strtod(src.c_str() + i, &end);
            if (end == src.c_str() + i) return fail("bad number");
            v.t = Json::Num;
            i = end - src.c_str();
            return true;
        }
        return fail("unexpected character");
    }
};

} // namespace

const Json* Json::get(const std::string& key) const {
    if (t != Obj) return nullptr;
    for (size_t k = 0; k < keys.size(); k++)
        if (keys[k] == key) return &a[k];
    return nullptr;
}

std::string Json::str(const std::string& key, const std::string& def) const {
    const Json* v = get(key);
    return v && v->t == Str ? v->s : def;
}

bool Json::boolean(const std::string& key, bool def) const {
    const Json* v = get(key);
    return v && v->t == Bool ? v->b : def;
}

double Json::num(const std::string& key, double def) const {
    const Json* v = get(key);
    return v && v->t == Num ? v->n : def;
}

bool Json::parse(const std::string& text, Json& out, std::string& err) {
    Parser p(text);
    if (text.compare(0, 3, "\xEF\xBB\xBF") == 0) p.i = 3;   // UTF-8 BOM
    out = Json();
    if (!p.value(out, 0)) { err = p.err; return false; }
    p.ws();
    if (p.i != text.size()) { err = "trailing data at offset " + std::to_string(p.i); return false; }
    return true;
}
