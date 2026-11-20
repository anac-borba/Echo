// echo-helper (Mac): o pedaço nativo do Echo para computador.
//  - lista os apps que estão tocando som;
//  - captura o som de apps específicos (ou de tudo menos o Echo) com as "torneiras" de áudio do macOS 14.2+;
//  - move o mouse e aperta teclas quando a pessoa que transmite permite o controle remoto (pede Acessibilidade).
// Protocolo igual ao do Windows: comandos em linhas de texto no stdin; no stdout, quadros
// [tipo 'T'|'A'][id][tamanho 4 bytes LE][dados]. Áudio: PCM 16 bits estéreo intercalado, na taxa avisada em "started".
import Foundation
import CoreAudio
import AudioToolbox
import AppKit
import ApplicationServices

let out = FileHandle.standardOutput
let outLock = NSLock()
func frame(_ type: UInt8, _ id: UInt8, _ data: Data) {
  outLock.lock(); defer { outLock.unlock() }
  var hdr = Data([type, id])
  var len = UInt32(data.count).littleEndian
  hdr.append(Data(bytes: &len, count: 4))
  out.write(hdr + data)
}
func text(_ s: String) { frame(UInt8(ascii: "T"), 0, s.data(using: .utf8)!) }
func esc(_ s: String) -> String {
  var o = ""
  for ch in s.unicodeScalars {
    switch ch {
    case "\"": o += "\\\""
    case "\\": o += "\\\\"
    default: if ch.value < 0x20 { o += String(format: "\\u%04x", ch.value) } else { o.unicodeScalars.append(ch) }
    }
  }
  return o
}

/* ───────────── propriedades do Core Audio ───────────── */
func addr(_ sel: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}
func getIDs(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> [AudioObjectID] {
  var a = addr(sel); var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(obj, &a, 0, nil, &size) == noErr, size > 0 else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}
func getU32(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> UInt32? {
  var a = addr(sel); var v: UInt32 = 0; var size = UInt32(MemoryLayout<UInt32>.size)
  return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
}
func getPid(_ obj: AudioObjectID) -> pid_t? {
  var a = addr(kAudioProcessPropertyPID); var v: pid_t = 0; var size = UInt32(MemoryLayout<pid_t>.size)
  return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
}
func getString(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
  var a = addr(sel); var v: Unmanaged<CFString>? = nil; var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr, let s = v?.takeRetainedValue() else { return nil }
  return s as String
}
func processObject(for pid: pid_t) -> AudioObjectID? {
  var a = addr(kAudioHardwarePropertyTranslatePIDToProcessObject)
  var p = pid; var obj: AudioObjectID = 0; var size = UInt32(MemoryLayout<AudioObjectID>.size)
  let st = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, UInt32(MemoryLayout<pid_t>.size), &p, &size, &obj)
  return st == noErr && obj != 0 ? obj : nil
}

/* ───────────── lista de apps com som ───────────── */
func listApps() {
  guard #available(macOS 14.2, *) else { text("{\"t\":\"apps\",\"apps\":[],\"unsupported\":true}"); return }
  var items: [String] = []
  for obj in getIDs(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) {
    guard let pid = getPid(obj), pid > 0 else { continue }
    let running = (getU32(obj, kAudioProcessPropertyIsRunningOutput) ?? 0) != 0
    let bundle = getString(obj, kAudioProcessPropertyBundleID) ?? ""
    var name = NSRunningApplication(processIdentifier: pid)?.localizedName ?? ""
    var appPath = NSRunningApplication(processIdentifier: pid)?.bundleURL?.path ?? ""
    if name.isEmpty {
      // processos auxiliares (ex.: "Google Chrome Helper"): usa o app "dono" pelo identificador
      let base = bundle.components(separatedBy: ".").prefix(3).joined(separator: ".")
      if let owner = NSWorkspace.shared.runningApplications.first(where: { ($0.bundleIdentifier ?? "") == base || bundle.hasPrefix(($0.bundleIdentifier ?? "#") + ".") }) {
        name = owner.localizedName ?? ""; appPath = owner.bundleURL?.path ?? ""
      }
    }
    if name.isEmpty { continue }
    items.append("{\"pid\":\(pid),\"exe\":\"\(esc(name))\",\"bundle\":\"\(esc(bundle))\",\"path\":\"\(esc(appPath))\",\"active\":\(running)}")
  }
  text("{\"t\":\"apps\",\"apps\":[" + items.joined(separator: ",") + "]}")
}

/* ───────────── captura (torneira de áudio do macOS 14.2+) ───────────── */
final class Tap {
  let id: UInt8
  var tapID = AudioObjectID(0), aggID = AudioObjectID(0)
  var proc: AudioDeviceIOProcID? = nil
  init(id: UInt8) { self.id = id }

  @available(macOS 14.2, *)
  func start(include: Bool, objects: [AudioObjectID]) -> Bool {
    let desc = include ? CATapDescription(stereoMixdownOfProcesses: objects) : CATapDescription(stereoGlobalTapButExcludeProcesses: objects)
    desc.uuid = UUID()
    desc.isPrivate = true
    desc.muteBehavior = .unmuted
    var tid = AudioObjectID(0)
    var st = AudioHardwareCreateProcessTap(desc, &tid)
    guard st == noErr else { text("{\"t\":\"err\",\"id\":\(id),\"msg\":\"torneira \(st)\"}"); return false }
    tapID = tid
    // formato da torneira
    var a = addr(kAudioTapPropertyFormat); var asbd = AudioStreamBasicDescription(); var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    AudioObjectGetPropertyData(tapID, &a, 0, nil, &size, &asbd)
    // dispositivo agregado privado só com a torneira
    let uid = "echo-tap-" + UUID().uuidString
    let dict: [String: Any] = [
      kAudioAggregateDeviceNameKey: "Echo",
      kAudioAggregateDeviceUIDKey: uid,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
    ]
    var agg = AudioObjectID(0)
    st = AudioHardwareCreateAggregateDevice(dict as CFDictionary, &agg)
    guard st == noErr else { text("{\"t\":\"err\",\"id\":\(id),\"msg\":\"agregado \(st)\"}"); stop(); return false }
    aggID = agg
    let ch = max(1, Int(asbd.mChannelsPerFrame))
    let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
    let nonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
    let myId = id
    var procID: AudioDeviceIOProcID? = nil
    st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
      let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
      guard abl.count > 0, isFloat else { return }
      // junta em estéreo intercalado 16 bits
      var frames = 0
      if nonInterleaved { frames = Int(abl[0].mDataByteSize) / 4 } else { frames = Int(abl[0].mDataByteSize) / (4 * ch) }
      if frames <= 0 { return }
      var pcm = [Int16](repeating: 0, count: frames * 2)
      func clip(_ v: Float) -> Int16 { Int16(max(-1, min(1, v)) * 32767) }
      if nonInterleaved {
        let l = abl[0].mData!.assumingMemoryBound(to: Float.self)
        let r = (abl.count > 1 ? abl[1].mData! : abl[0].mData!).assumingMemoryBound(to: Float.self)
        for i in 0..<frames { pcm[2 * i] = clip(l[i]); pcm[2 * i + 1] = clip(r[i]) }
      } else {
        let p = abl[0].mData!.assumingMemoryBound(to: Float.self)
        for i in 0..<frames { pcm[2 * i] = clip(p[i * ch]); pcm[2 * i + 1] = clip(p[i * ch + (ch > 1 ? 1 : 0)]) }
      }
      pcm.withUnsafeBufferPointer { frame(UInt8(ascii: "A"), myId, Data(buffer: $0)) }
    }
    guard st == noErr, let p = procID else { text("{\"t\":\"err\",\"id\":\(id),\"msg\":\"ioproc \(st)\"}"); stop(); return false }
    proc = p
    st = AudioDeviceStart(aggID, p)
    guard st == noErr else { text("{\"t\":\"err\",\"id\":\(id),\"msg\":\"iniciar \(st)\"}"); stop(); return false }
    text("{\"t\":\"started\",\"id\":\(id),\"rate\":\(Int(asbd.mSampleRate)),\"ch\":2}")
    return true
  }
  func stop() {
    if let p = proc { AudioDeviceStop(aggID, p); AudioDeviceDestroyIOProcID(aggID, p); proc = nil }
    if aggID != 0 { AudioHardwareDestroyAggregateDevice(aggID); aggID = 0 }
    if tapID != 0, #available(macOS 14.2, *) { AudioHardwareDestroyProcessTap(tapID); tapID = 0 }
  }
}
var taps: [Tap] = []
func stopAll() { taps.forEach { $0.stop() }; taps.removeAll() }
func startCapture(include: Bool, pids: [pid_t]) {
  stopAll()
  guard #available(macOS 14.2, *) else { text("{\"t\":\"err\",\"msg\":\"macOS 14.2 ou mais novo\"}"); return }
  let objs = pids.compactMap { processObject(for: $0) }
  if include && objs.isEmpty { text("{\"t\":\"err\",\"msg\":\"nenhum app com som\"}"); return }
  let t = Tap(id: 1)
  if t.start(include: include, objects: objs) { taps.append(t) }
}

/* ───────────── mouse e teclado (precisa de Acessibilidade) ───────────── */
var buttonsDown = Set<String>()
var lastPos = CGPoint.zero
var lastClick = (time: 0.0, count: 0, pos: CGPoint.zero)
func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
func move(_ x: Double, _ y: Double) {
  lastPos = CGPoint(x: x, y: y)
  let type: CGEventType = buttonsDown.contains("l") ? .leftMouseDragged : buttonsDown.contains("r") ? .rightMouseDragged : .mouseMoved
  post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: lastPos, mouseButton: .left))
}
func button(_ b: String, _ down: Bool) {
  let (t, btn): (CGEventType, CGMouseButton) = {
    switch b {
    case "r": return (down ? .rightMouseDown : .rightMouseUp, .right)
    case "m": return (down ? .otherMouseDown : .otherMouseUp, .center)
    default: return (down ? .leftMouseDown : .leftMouseUp, .left)
    }
  }()
  if down {
    buttonsDown.insert(b)
    let now = Date().timeIntervalSince1970
    if now - lastClick.time < 0.4 && hypot(lastClick.pos.x - lastPos.x, lastClick.pos.y - lastPos.y) < 6 { lastClick.count += 1 } else { lastClick.count = 1 }
    lastClick.time = now; lastClick.pos = lastPos
  } else { buttonsDown.remove(b) }
  let e = CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: lastPos, mouseButton: btn)
  e?.setIntegerValueField(.mouseEventClickState, value: Int64(max(1, lastClick.count)))
  post(e)
}
func wheel(_ dx: Int32, _ dy: Int32) {
  post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0))
}
// código DOM (KeyboardEvent.code) → tecla do Mac (teclado ANSI)
let keyCodes: [String: CGKeyCode] = [
  "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6, "KeyX": 7, "KeyC": 8, "KeyV": 9, "KeyB": 11, "KeyQ": 12,
  "KeyW": 13, "KeyE": 14, "KeyR": 15, "KeyY": 16, "KeyT": 17, "Digit1": 18, "Digit2": 19, "Digit3": 20, "Digit4": 21, "Digit6": 22,
  "Digit5": 23, "Equal": 24, "Digit9": 25, "Digit7": 26, "Minus": 27, "Digit8": 28, "Digit0": 29, "BracketRight": 30, "KeyO": 31,
  "KeyU": 32, "BracketLeft": 33, "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37, "KeyJ": 38, "Quote": 39, "KeyK": 40, "Semicolon": 41,
  "Backslash": 42, "Comma": 43, "Slash": 44, "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50,
  "Backspace": 51, "Escape": 53, "MetaLeft": 55, "MetaRight": 54, "ShiftLeft": 56, "ShiftRight": 60, "CapsLock": 57, "AltLeft": 58,
  "AltRight": 61, "ControlLeft": 59, "ControlRight": 62, "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98,
  "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111, "Home": 115, "PageUp": 116, "Delete": 117, "End": 119, "PageDown": 121,
  "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126, "NumpadEnter": 76, "IntlBackslash": 10,
]
func flags(_ mods: String) -> CGEventFlags {
  var f = CGEventFlags()
  if mods.contains("s") { f.insert(.maskShift) }
  if mods.contains("c") { f.insert(.maskControl) }
  if mods.contains("a") { f.insert(.maskAlternate) }
  if mods.contains("m") { f.insert(.maskCommand) }
  return f
}
func key(_ code: String, _ down: Bool, _ mods: String) {
  guard let k = keyCodes[code] else { return }
  let e = CGEvent(keyboardEventSource: nil, virtualKey: k, keyDown: down)
  e?.flags = flags(mods)
  post(e)
}
func typeText(_ s: String) {
  for ch in s.utf16 {
    var c = ch
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
      e?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
      post(e)
    }
  }
}
func fromHex(_ h: String) -> String {
  var u: [UInt16] = []
  var i = h.startIndex
  while h.distance(from: i, to: h.endIndex) >= 4 { let j = h.index(i, offsetBy: 4); if let v = UInt16(h[i..<j], radix: 16) { u.append(v) }; i = j }
  return String(utf16CodeUnits: u, count: u.count)
}

/* ───────────── comandos ───────────── */
func handle(_ line: String) {
  let p = line.split(separator: " ").map(String.init)
  guard let cmd = p.first else { return }
  switch cmd {
  case "list": listApps()
  case "include", "exclude":
    var pids = p.dropFirst().compactMap { pid_t($0) }
    if cmd == "exclude" && pids.isEmpty { pids = [getpid()] }
    startCapture(include: cmd == "include", pids: pids)
  case "stop": stopAll(); text("{\"t\":\"stopped\"}")
  case "move": if p.count >= 3, let x = Double(p[1]), let y = Double(p[2]) { move(x, y) }
  case "down", "up": if p.count >= 2 { button(p[1], cmd == "down") }
  case "wheel": if p.count >= 3, let dx = Int32(p[1]), let dy = Int32(p[2]) { wheel(dx, dy) }
  case "key": if p.count >= 3 { key(p[2], p[1] == "down", p.count >= 4 ? p[3] : "") }
  case "text": if p.count >= 2 { typeText(fromHex(p[1])) }
  case "axcheck":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    text("{\"t\":\"ax\",\"ok\":\(AXIsProcessTrustedWithOptions(opts))}")
  case "ping": text("{\"t\":\"pong\",\"os\":\"mac\"}")
  default: break
  }
}

text("{\"t\":\"ready\",\"os\":\"mac\"}")
DispatchQueue.global().async {
  while let line = readLine() {
    if line == "quit" { stopAll(); exit(0) }
    DispatchQueue.main.async { handle(line) }
  }
  stopAll(); exit(0)
}
RunLoop.main.run()
