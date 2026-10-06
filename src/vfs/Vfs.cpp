#include "Vfs.hpp"
#include <cstdio>
#include <filesystem>

namespace fs = std::filesystem;

namespace {

const char* encryptedExt(const std::string& ext) {
    if (ext == ".png") return ".rpgmvp";
    if (ext == ".ogg") return ".rpgmvo";
    if (ext == ".m4a") return ".rpgmvm";
    return nullptr;
}

bool isFile(const std::string& p) {
    std::error_code ec;
    return fs::is_regular_file(p, ec);
}

} // namespace

void Vfs::setMods(const std::vector<std::string>& dirs) {
    layers_.resize(1);
    layers_.insert(layers_.end(), dirs.begin(), dirs.end());
}

std::optional<std::string> Vfs::normalize(const std::string& logical) {
    std::string out, part;
    auto flush = [&]() -> bool {
        if (part.empty() || part == ".") { part.clear(); return true; }
        if (part == "..") return false;
        if (!out.empty()) out += '/';
        out += part;
        part.clear();
        return true;
    };
    if (logical.size() >= 2 && logical[1] == ':') return std::nullopt;     // drive letter
    for (char c : logical) {
        if (c == '\\') c = '/';
        if (c == '/') { if (!flush()) return std::nullopt; }
        else if (c == '\0') return std::nullopt;
        else part += c;
    }
    if (!flush()) return std::nullopt;
    if (out.empty()) return std::nullopt;
    return out;
}

std::optional<Vfs::Resolved> Vfs::resolve(const std::string& logical) const {
    auto norm = normalize(logical);
    if (!norm) return std::nullopt;

    std::string stem = *norm, ext;
    size_t dot = norm->find_last_of('.');
    size_t slash = norm->find_last_of('/');
    if (dot != std::string::npos && (slash == std::string::npos || dot > slash)) {
        stem = norm->substr(0, dot);
        ext = norm->substr(dot);
    }
    const char* enc = encryptedExt(ext);

    for (size_t i = layers_.size(); i-- > 0;) {
        std::string plain = layers_[i] + "/" + *norm;
        if (isFile(plain)) return Resolved{plain, i, false};
        if (enc) {
            std::string e = layers_[i] + "/" + stem + enc;
            if (isFile(e)) return Resolved{e, i, true};
        }
    }
    return std::nullopt;
}

bool Vfs::read(const std::string& logical, std::vector<uint8_t>& out, Resolved* info) const {
    auto r = resolve(logical);
    if (!r) return false;
    FILE* f = std::fopen(r->path.c_str(), "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    out.resize(n > 0 ? (size_t)n : 0);
    bool ok = out.empty() || std::fread(out.data(), 1, out.size(), f) == out.size();
    std::fclose(f);
    if (ok && info) *info = *r;
    return ok;
}
