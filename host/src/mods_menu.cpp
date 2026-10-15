#include "mods_menu.h"
#include "mods_state.hpp"

#include <GLES2/gl2.h>
#include <switch.h>

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <memory>

#include "../../src/menu/ModMenuUi.hpp"
#include "imgui.h"

namespace {

constexpr float kW = 1280.f, kH = 720.f;

struct Menu {
    bool ready = false;
    std::string title;
    std::unique_ptr<ModMenuUi> ui;
    GLuint prog = 0, fontTex = 0, vbo = 0, ibo = 0;
    GLint locProj = -1, locTex = -1, locPos = -1, locUv = -1, locCol = -1;
    uint64_t prev = 0;
    int prevTouch = 0;
};
Menu g;

const char* kVs =
    "uniform mat4 ProjMtx;\n"
    "attribute vec2 Position;\n"
    "attribute vec2 UV;\n"
    "attribute vec4 Color;\n"
    "varying vec2 Frag_UV;\n"
    "varying vec4 Frag_Color;\n"
    "void main() { Frag_UV = UV; Frag_Color = Color; gl_Position = ProjMtx * vec4(Position.xy, 0.0, 1.0); }\n";
const char* kFs =
    "precision mediump float;\n"
    "uniform sampler2D Texture;\n"
    "varying vec2 Frag_UV;\n"
    "varying vec4 Frag_Color;\n"
    "void main() { gl_FragColor = Frag_Color * texture2D(Texture, Frag_UV); }\n";

GLuint compile(GLenum type, const char* src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[512];
        glGetShaderInfoLog(s, sizeof log, nullptr, log);
        std::printf("menu shader: %s\n", log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}

void render(ImDrawData* dd) {
    if (!dd || dd->CmdListsCount == 0) return;
    glViewport(0, 0, (GLsizei)kW, (GLsizei)kH);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_STENCIL_TEST);
    glEnable(GL_BLEND);
    glBlendEquation(GL_FUNC_ADD);
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    glEnable(GL_SCISSOR_TEST);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);

    const float L = dd->DisplayPos.x, R = dd->DisplayPos.x + dd->DisplaySize.x, T = dd->DisplayPos.y, B = dd->DisplayPos.y + dd->DisplaySize.y;
    const float proj[4][4] = {
        {2.0f / (R - L), 0.0f, 0.0f, 0.0f},
        {0.0f, 2.0f / (T - B), 0.0f, 0.0f},
        {0.0f, 0.0f, -1.0f, 0.0f},
        {(R + L) / (L - R), (T + B) / (B - T), 0.0f, 1.0f},
    };
    glUseProgram(g.prog);
    glUniform1i(g.locTex, 0);
    glUniformMatrix4fv(g.locProj, 1, GL_FALSE, &proj[0][0]);
    glActiveTexture(GL_TEXTURE0);
    glBindBuffer(GL_ARRAY_BUFFER, g.vbo);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, g.ibo);
    glEnableVertexAttribArray(g.locPos);
    glEnableVertexAttribArray(g.locUv);
    glEnableVertexAttribArray(g.locCol);
    glVertexAttribPointer(g.locPos, 2, GL_FLOAT, GL_FALSE, sizeof(ImDrawVert), (const void*)offsetof(ImDrawVert, pos));
    glVertexAttribPointer(g.locUv, 2, GL_FLOAT, GL_FALSE, sizeof(ImDrawVert), (const void*)offsetof(ImDrawVert, uv));
    glVertexAttribPointer(g.locCol, 4, GL_UNSIGNED_BYTE, GL_TRUE, sizeof(ImDrawVert), (const void*)offsetof(ImDrawVert, col));

    for (int n = 0; n < dd->CmdListsCount; n++) {
        const ImDrawList* cl = dd->CmdLists[n];
        glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)cl->VtxBuffer.Size * (GLsizeiptr)sizeof(ImDrawVert), cl->VtxBuffer.Data, GL_STREAM_DRAW);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)cl->IdxBuffer.Size * (GLsizeiptr)sizeof(ImDrawIdx), cl->IdxBuffer.Data, GL_STREAM_DRAW);
        for (int i = 0; i < cl->CmdBuffer.Size; i++) {
            const ImDrawCmd* pcmd = &cl->CmdBuffer[i];
            if (pcmd->UserCallback) continue;
            ImVec2 clipMin(pcmd->ClipRect.x - dd->DisplayPos.x, pcmd->ClipRect.y - dd->DisplayPos.y);
            ImVec2 clipMax(pcmd->ClipRect.z - dd->DisplayPos.x, pcmd->ClipRect.w - dd->DisplayPos.y);
            if (clipMax.x <= clipMin.x || clipMax.y <= clipMin.y) continue;
            glScissor((int)clipMin.x, (int)(kH - clipMax.y), (int)(clipMax.x - clipMin.x), (int)(clipMax.y - clipMin.y));
            glBindTexture(GL_TEXTURE_2D, (GLuint)(intptr_t)pcmd->GetTexID());
            glDrawElements(GL_TRIANGLES, (GLsizei)pcmd->ElemCount, sizeof(ImDrawIdx) == 2 ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT,
                           (const void*)(intptr_t)(pcmd->IdxOffset * sizeof(ImDrawIdx)));
        }
    }
}

void feed(const MenuInput& in, ModMenuUi& ui) {
    ImGuiIO& io = ImGui::GetIO();
    struct Map { uint64_t bit; ImGuiKey key; };
    static const Map map[] = {
        {HidNpadButton_A, ImGuiKey_GamepadFaceDown},   {HidNpadButton_B, ImGuiKey_GamepadFaceRight},
        {HidNpadButton_X, ImGuiKey_GamepadFaceLeft},   {HidNpadButton_Y, ImGuiKey_GamepadFaceUp},
        {HidNpadButton_Up, ImGuiKey_GamepadDpadUp},    {HidNpadButton_Down, ImGuiKey_GamepadDpadDown},
        {HidNpadButton_Left, ImGuiKey_GamepadDpadLeft}, {HidNpadButton_Right, ImGuiKey_GamepadDpadRight},
        {HidNpadButton_L, ImGuiKey_GamepadL1},         {HidNpadButton_R, ImGuiKey_GamepadR1},
    };
    for (const Map& m : map) io.AddKeyEvent(m.key, (in.buttons & m.bit) != 0);
    const float dead = 0.25f;
    float x = in.stick_lx / 32767.f, y = in.stick_ly / 32767.f;
    auto axis = [&](ImGuiKey key, float v) { io.AddKeyAnalogEvent(key, v > dead, v > dead ? (v - dead) / (1.f - dead) : 0.f); };
    axis(ImGuiKey_GamepadLStickLeft, -x);
    axis(ImGuiKey_GamepadLStickRight, x);
    axis(ImGuiKey_GamepadLStickUp, y);       // libnx: +y is up
    axis(ImGuiKey_GamepadLStickDown, -y);
    uint64_t down = in.buttons & ~g.prev;
    if (down & HidNpadButton_L) ui.stepTab(-1);
    if (down & HidNpadButton_R) ui.stepTab(+1);

    io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
    if (in.touch) {
        io.AddMousePosEvent((float)in.touch_x, (float)in.touch_y);
        if (!g.prevTouch) io.AddMouseButtonEvent(0, true);
    } else if (g.prevTouch) {
        io.AddMouseButtonEvent(0, false);
    }
    g.prevTouch = in.touch;
}

} // namespace

extern "C" int menu_init(const char* ttfPath, const char* title) {
    if (g.ready) return 1;
    ModsState& s = mods_state();
    if (!s.model) return 0;

    GLuint vs = compile(GL_VERTEX_SHADER, kVs), fs = compile(GL_FRAGMENT_SHADER, kFs);
    if (!vs || !fs) return 0;
    g.prog = glCreateProgram();
    glAttachShader(g.prog, vs);
    glAttachShader(g.prog, fs);
    glLinkProgram(g.prog);
    GLint ok = 0;
    glGetProgramiv(g.prog, GL_LINK_STATUS, &ok);
    if (!ok) { std::printf("menu: shader link failed\n"); return 0; }
    glDeleteShader(vs);
    glDeleteShader(fs);
    g.locProj = glGetUniformLocation(g.prog, "ProjMtx");
    g.locTex = glGetUniformLocation(g.prog, "Texture");
    g.locPos = glGetAttribLocation(g.prog, "Position");
    g.locUv = glGetAttribLocation(g.prog, "UV");
    g.locCol = glGetAttribLocation(g.prog, "Color");
    glGenBuffers(1, &g.vbo);
    glGenBuffers(1, &g.ibo);

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad;
    io.BackendFlags |= ImGuiBackendFlags_HasGamepad;
    ImFont* font = ttfPath ? io.Fonts->AddFontFromFileTTF(ttfPath, 30.0f) : nullptr;
    if (!font) {
        ImFontConfig cfg;
        cfg.SizePixels = 30.0f;
        io.Fonts->AddFontDefault(&cfg);
    }
    ImGui::StyleColorsDark();
    ImGuiStyle& st = ImGui::GetStyle();
    st.WindowRounding = 6.f;
    st.FrameRounding = 4.f;
    st.ItemSpacing = ImVec2(10, 10);
    st.FramePadding = ImVec2(10, 6);

    unsigned char* px = nullptr;
    int w = 0, h = 0;
    io.Fonts->GetTexDataAsRGBA32(&px, &w, &h);
    glGenTextures(1, &g.fontTex);
    glBindTexture(GL_TEXTURE_2D, g.fontTex);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px);
    io.Fonts->SetTexID((ImTextureID)(intptr_t)g.fontTex);
    glBindTexture(GL_TEXTURE_2D, 0);

    g.ui = std::make_unique<ModMenuUi>(*s.model);
    g.title = title ? title : "Fear & Hunger NX";
    g.ready = true;
    return 1;
}

extern "C" void menu_reset_focus(void) {
    if (g.ui) g.ui->resetFocus();
}

extern "C" int menu_frame(const MenuInput* in) {
    if (!g.ready) return MENU_CLOSED;
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(kW, kH);
    io.DeltaTime = 1.f / 60.f;
    feed(*in, *g.ui);

    uint64_t down = in->buttons & ~g.prev;
    g.prev = in->buttons;
    bool closeRequested = (down & HidNpadButton_B) || (down & HidNpadButton_Minus);

    ImGui::NewFrame();
    ModMenuUi::Header header{g.title, in->status ? in->status : ""};
    bool applied = g.ui->draw(header, ImVec2(kW, kH));
    ImGui::Render();

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, (GLsizei)kW, (GLsizei)kH);
    glDisable(GL_SCISSOR_TEST);
    glClearColor(0.06f, 0.06f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    render(ImGui::GetDrawData());

    if (applied) return MENU_APPLIED;
    if (closeRequested) return MENU_CLOSED;
    return MENU_OPEN;
}

extern "C" void menu_release_gl(void) {
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_BLEND);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
    glBindTexture(GL_TEXTURE_2D, 0);
    glUseProgram(0);
    if (g.locPos >= 0) glDisableVertexAttribArray(g.locPos);
    if (g.locUv >= 0) glDisableVertexAttribArray(g.locUv);
    if (g.locCol >= 0) glDisableVertexAttribArray(g.locCol);
    g.prev = 0;
}
