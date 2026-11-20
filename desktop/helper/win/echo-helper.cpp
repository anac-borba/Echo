// echo-helper (Windows): o pedaço nativo do Echo para computador.
//  - lista os apps que estão tocando som;
//  - captura o som de apps específicos (ou de tudo menos o Echo) com o "process loopback" do Windows 10 2004+;
//  - move o mouse e aperta teclas quando a pessoa que transmite permite o controle remoto.
// Conversa com o app (Electron) por stdin/stdout:
//   entrada: uma linha de texto por comando (ver handle());
//   saída: quadros [tipo 1 byte]['T' texto | 'A' áudio][id 1 byte][tamanho 4 bytes LE][dados].
//   Áudio: PCM 16 bits, 48 kHz, estéreo, intercalado.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <audioclientactivationparams.h>
#include <psapi.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <sstream>
#include <thread>
#include <mutex>
#include <atomic>
#include <memory>
#include <map>
#include <set>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "user32.lib")

using Microsoft::WRL::ComPtr;

static std::mutex outMx;
static void writeFrame(char type, uint8_t id, const void* data, uint32_t len) {
  std::lock_guard<std::mutex> lk(outMx);
  char hdr[6] = { type, (char)id };
  memcpy(hdr + 2, &len, 4);
  fwrite(hdr, 1, 6, stdout);
  if (len) fwrite(data, 1, len, stdout);
  fflush(stdout);
}
static void text(const std::string& s) { writeFrame('T', 0, s.data(), (uint32_t)s.size()); }

static std::string jsonEsc(const std::string& s) {
  std::string o;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o;
}
static std::string utf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, 0);
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
  return s;
}
static std::wstring exeName(DWORD pid, std::wstring* fullOut = nullptr) {
  std::wstring name;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (h) {
    wchar_t buf[MAX_PATH * 2]; DWORD n = MAX_PATH * 2;
    if (QueryFullProcessImageNameW(h, 0, buf, &n)) {
      std::wstring full(buf, n);
      if (fullOut) *fullOut = full;
      size_t p = full.find_last_of(L"\\/");
      name = p == std::wstring::npos ? full : full.substr(p + 1);
    }
    CloseHandle(h);
  }
  return name;
}

/* ───────────── lista de apps com som ───────────── */
static void listApps() {
  ComPtr<IMMDeviceEnumerator> en;
  std::string out = "{\"t\":\"apps\",\"apps\":[";
  bool first = true;
  std::set<DWORD> seen;
  if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&en)))) {
    ComPtr<IMMDeviceCollection> devs;
    if (SUCCEEDED(en->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devs))) {
      UINT nd = 0; devs->GetCount(&nd);
      for (UINT d = 0; d < nd; d++) {
        ComPtr<IMMDevice> dev; if (FAILED(devs->Item(d, &dev))) continue;
        ComPtr<IAudioSessionManager2> mgr;
        if (FAILED(dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)mgr.GetAddressOf()))) continue;
        ComPtr<IAudioSessionEnumerator> se; if (FAILED(mgr->GetSessionEnumerator(&se))) continue;
        int ns = 0; se->GetCount(&ns);
        for (int i = 0; i < ns; i++) {
          ComPtr<IAudioSessionControl> c; if (FAILED(se->GetSession(i, &c))) continue;
          ComPtr<IAudioSessionControl2> c2; if (FAILED(c.As(&c2))) continue;
          if (c2->IsSystemSoundsSession() == S_OK) continue;
          DWORD pid = 0; c2->GetProcessId(&pid);
          if (!pid || seen.count(pid)) continue;
          AudioSessionState st; c->GetState(&st);
          if (st == AudioSessionStateExpired) continue;
          std::wstring full; std::wstring nm = exeName(pid, &full);
          if (nm.empty()) continue;
          seen.insert(pid);
          if (!first) out += ","; first = false;
          out += "{\"pid\":" + std::to_string(pid) + ",\"exe\":\"" + jsonEsc(utf8(nm)) + "\",\"path\":\"" + jsonEsc(utf8(full)) + "\",\"active\":" + (st == AudioSessionStateActive ? "true" : "false") + "}";
        }
      }
    }
  }
  out += "]}";
  text(out);
}

/* ───────────── captura por processo (process loopback) ───────────── */
class ActivateHandler : public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>, Microsoft::WRL::FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT hr = E_FAIL;
  ComPtr<IAudioClient> client;
  ~ActivateHandler() { CloseHandle(done); }
  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    ComPtr<IUnknown> unk; HRESULT r = S_OK;
    hr = op->GetActivateResult(&r, &unk);
    if (SUCCEEDED(hr)) hr = r;
    if (SUCCEEDED(hr)) hr = unk.As(&client);
    SetEvent(done);
    return S_OK;
  }
};

struct Capture {
  uint8_t id; DWORD pid; bool include;
  std::atomic<bool> stop{ false };
  std::thread th;
};
static std::vector<std::unique_ptr<Capture>> caps;
static std::mutex capMx;

static void captureLoop(Capture* c) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  AUDIOCLIENT_ACTIVATION_PARAMS ap = {};
  ap.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  ap.ProcessLoopbackParams.TargetProcessId = c->pid;
  ap.ProcessLoopbackParams.ProcessLoopbackMode = c->include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv = {}; pv.vt = VT_BLOB; pv.blob.cbSize = sizeof(ap); pv.blob.pBlobData = (BYTE*)&ap;
  auto h = Microsoft::WRL::Make<ActivateHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, h.Get(), &op);
  if (SUCCEEDED(hr)) { WaitForSingleObject(h->done, 5000); hr = h->hr; }
  if (FAILED(hr) || !h->client) { text("{\"t\":\"err\",\"id\":" + std::to_string(c->id) + ",\"msg\":\"ativar " + std::to_string((long)hr) + "\"}"); CoUninitialize(); return; }
  ComPtr<IAudioClient> ac = h->client;
  WAVEFORMATEX wf = {};
  wf.wFormatTag = WAVE_FORMAT_PCM; wf.nChannels = 2; wf.nSamplesPerSec = 48000; wf.wBitsPerSample = 16;
  wf.nBlockAlign = wf.nChannels * wf.wBitsPerSample / 8; wf.nAvgBytesPerSec = wf.nSamplesPerSec * wf.nBlockAlign;
  hr = ac->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 200000, 0, &wf, nullptr);
  HANDLE ev = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  ComPtr<IAudioCaptureClient> cc;
  if (SUCCEEDED(hr)) hr = ac->SetEventHandle(ev);
  if (SUCCEEDED(hr)) hr = ac->GetService(IID_PPV_ARGS(&cc));
  if (SUCCEEDED(hr)) hr = ac->Start();
  if (FAILED(hr)) { text("{\"t\":\"err\",\"id\":" + std::to_string(c->id) + ",\"msg\":\"iniciar " + std::to_string((long)hr) + "\"}"); CloseHandle(ev); CoUninitialize(); return; }
  text("{\"t\":\"started\",\"id\":" + std::to_string(c->id) + ",\"rate\":48000,\"ch\":2}");
  std::vector<int16_t> silence;
  while (!c->stop) {
    if (WaitForSingleObject(ev, 200) != WAIT_OBJECT_0) continue;
    UINT32 n = 0;
    while (SUCCEEDED(cc->GetNextPacketSize(&n)) && n) {
      BYTE* data; UINT32 frames; DWORD flags;
      if (FAILED(cc->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      uint32_t bytes = frames * wf.nBlockAlign;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.assign(frames * 2, 0); writeFrame('A', c->id, silence.data(), bytes); }
      else writeFrame('A', c->id, data, bytes);
      cc->ReleaseBuffer(frames);
    }
  }
  ac->Stop();
  CloseHandle(ev);
  CoUninitialize();
}

static void stopAll() {
  std::lock_guard<std::mutex> lk(capMx);
  for (auto& c : caps) c->stop = true;
  for (auto& c : caps) if (c->th.joinable()) c->th.join();
  caps.clear();
}
static void startCapture(bool include, const std::vector<DWORD>& pids) {
  stopAll();
  std::lock_guard<std::mutex> lk(capMx);
  uint8_t id = 1;
  for (DWORD pid : pids) {
    auto c = std::make_unique<Capture>();
    c->id = id++; c->pid = pid; c->include = include;
    Capture* raw = c.get();
    c->th = std::thread(captureLoop, raw);
    caps.push_back(std::move(c));
    if (!include) break; // excluir: uma captura só (tudo menos aquele processo)
  }
}

/* ───────────── mouse e teclado ───────────── */
static void sendMouse(DWORD flags, LONG x = 0, LONG y = 0, DWORD data = 0) {
  INPUT in = {}; in.type = INPUT_MOUSE; in.mi.dwFlags = flags; in.mi.dx = x; in.mi.dy = y; in.mi.mouseData = data;
  SendInput(1, &in, sizeof in);
}
static void moveTo(int x, int y) {
  // coordenadas absolutas na área de trabalho virtual (todos os monitores)
  int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (vw <= 1 || vh <= 1) return;
  LONG ax = (LONG)((x - vx) * 65535.0 / (vw - 1)), ay = (LONG)((y - vy) * 65535.0 / (vh - 1));
  sendMouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, ax, ay);
}
static void button(const std::string& b, bool down) {
  DWORD f = 0;
  if (b == "l") f = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
  else if (b == "r") f = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
  else if (b == "m") f = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
  if (f) sendMouse(f);
}
static void key(WORD vk, bool down) {
  INPUT in = {}; in.type = INPUT_KEYBOARD; in.ki.wVk = vk; in.ki.wScan = (WORD)MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
  in.ki.dwFlags = (down ? 0 : KEYEVENTF_KEYUP);
  switch (vk) { case VK_LEFT: case VK_RIGHT: case VK_UP: case VK_DOWN: case VK_HOME: case VK_END: case VK_PRIOR: case VK_NEXT: case VK_INSERT: case VK_DELETE: case VK_RCONTROL: case VK_RMENU: in.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY; }
  SendInput(1, &in, sizeof in);
}
static void typeText(const std::wstring& s) {
  for (wchar_t ch : s) {
    INPUT in[2] = {};
    in[0].type = in[1].type = INPUT_KEYBOARD;
    in[0].ki.wScan = in[1].ki.wScan = ch;
    in[0].ki.dwFlags = KEYEVENTF_UNICODE; in[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    SendInput(2, in, sizeof(INPUT));
  }
}
// código DOM (KeyboardEvent.code) → tecla virtual do Windows
static WORD vkFromCode(const std::string& c) {
  if (c.size() == 4 && c.rfind("Key", 0) == 0 && c[3] >= 'A' && c[3] <= 'Z') return (WORD)c[3];
  if (c.size() == 6 && c.rfind("Digit", 0) == 0 && c[5] >= '0' && c[5] <= '9') return (WORD)c[5];
  if (c.size() >= 2 && c[0] == 'F' && isdigit((unsigned char)c[1])) { int n = atoi(c.c_str() + 1); if (n >= 1 && n <= 24) return (WORD)(VK_F1 + n - 1); }
  static const std::map<std::string, WORD> m = {
    {"Enter", VK_RETURN}, {"NumpadEnter", VK_RETURN}, {"Backspace", VK_BACK}, {"Tab", VK_TAB}, {"Escape", VK_ESCAPE}, {"Space", VK_SPACE},
    {"ShiftLeft", VK_LSHIFT}, {"ShiftRight", VK_RSHIFT}, {"ControlLeft", VK_LCONTROL}, {"ControlRight", VK_RCONTROL},
    {"AltLeft", VK_LMENU}, {"AltRight", VK_RMENU}, {"MetaLeft", VK_LWIN}, {"MetaRight", VK_RWIN}, {"CapsLock", VK_CAPITAL},
    {"ArrowLeft", VK_LEFT}, {"ArrowRight", VK_RIGHT}, {"ArrowUp", VK_UP}, {"ArrowDown", VK_DOWN}, {"Home", VK_HOME}, {"End", VK_END},
    {"PageUp", VK_PRIOR}, {"PageDown", VK_NEXT}, {"Insert", VK_INSERT}, {"Delete", VK_DELETE},
    {"Minus", VK_OEM_MINUS}, {"Equal", VK_OEM_PLUS}, {"Comma", VK_OEM_COMMA}, {"Period", VK_OEM_PERIOD}, {"Semicolon", VK_OEM_1},
    {"Slash", VK_OEM_2}, {"Backquote", VK_OEM_3}, {"BracketLeft", VK_OEM_4}, {"Backslash", VK_OEM_5}, {"BracketRight", VK_OEM_6},
    {"Quote", VK_OEM_7}, {"IntlBackslash", VK_OEM_102},
  };
  auto it = m.find(c); return it == m.end() ? 0 : it->second;
}
static std::wstring fromHex(const std::string& hex) {
  std::wstring w;
  for (size_t i = 0; i + 4 <= hex.size(); i += 4) w += (wchar_t)std::stoul(hex.substr(i, 4), nullptr, 16);
  return w;
}

/* ───────────── comandos ───────────── */
static void handle(const std::string& line) {
  std::istringstream ss(line);
  std::string cmd; ss >> cmd;
  if (cmd == "list") listApps();
  else if (cmd == "include" || cmd == "exclude") {
    std::vector<DWORD> pids; DWORD p; while (ss >> p) pids.push_back(p);
    if (cmd == "exclude" && pids.empty()) pids.push_back(GetCurrentProcessId());
    startCapture(cmd == "include", pids);
  }
  else if (cmd == "stop") { stopAll(); text("{\"t\":\"stopped\"}"); }
  else if (cmd == "move") { int x, y; if (ss >> x >> y) moveTo(x, y); }
  else if (cmd == "down" || cmd == "up") { std::string b; ss >> b; button(b, cmd == "down"); }
  else if (cmd == "wheel") { int dx = 0, dy = 0; ss >> dx >> dy; if (dy) sendMouse(MOUSEEVENTF_WHEEL, 0, 0, (DWORD)(-dy)); if (dx) sendMouse(MOUSEEVENTF_HWHEEL, 0, 0, (DWORD)dx); }
  else if (cmd == "key") { std::string d, code; ss >> d >> code; WORD vk = vkFromCode(code); if (vk) key(vk, d == "down"); }
  else if (cmd == "text") { std::string hex; ss >> hex; typeText(fromHex(hex)); }
  else if (cmd == "ping") text("{\"t\":\"pong\",\"os\":\"win\"}");
}

int main() {
  _setmode(_fileno(stdout), _O_BINARY);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  text("{\"t\":\"ready\",\"os\":\"win\"}");
  char buf[8192];
  while (fgets(buf, sizeof buf, stdin)) {
    std::string line(buf);
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line == "quit") break;
    try { handle(line); } catch (...) { text("{\"t\":\"err\",\"msg\":\"comando\"}"); }
  }
  stopAll();
  CoUninitialize();
  return 0;
}
