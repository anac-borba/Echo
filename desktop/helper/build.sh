#!/bin/bash
# Compila o programa auxiliar nativo (echo-helper) para o sistema atual. Roda no GitHub (Actions) antes de montar o app.
# Saída: desktop/helper/bin/echo-helper (Mac, universal) ou desktop/helper/bin/echo-helper.exe (Windows).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
mkdir -p bin
case "$(uname -s)" in
  Darwin)
    swiftc -O -target arm64-apple-macos14.0 mac/main.swift -o bin/echo-helper-arm64
    swiftc -O -target x86_64-apple-macos14.0 mac/main.swift -o bin/echo-helper-x64
    lipo -create bin/echo-helper-arm64 bin/echo-helper-x64 -output bin/echo-helper
    rm bin/echo-helper-arm64 bin/echo-helper-x64
    codesign --force --sign - bin/echo-helper
    ;;
  MINGW*|MSYS*|CYGWIN*)
    cd win && MSYS_NO_PATHCONV=1 cl -nologo -O2 -EHsc -std:c++17 -W3 echo-helper.cpp -Fe..\\bin\\echo-helper.exe -link ole32.lib user32.lib mmdevapi.lib && rm -f *.obj
    ;;
  *) echo "sistema sem programa auxiliar"; exit 0 ;;
esac
ls -la "$HERE/bin"
