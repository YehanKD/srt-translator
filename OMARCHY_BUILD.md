# TO: Future Hermes (on Omarchy) — Build the SRT Translator as a Linux app

## What this is
A desktop app that translates **English SRT subtitle files → Sinhala** using an OpenAI-compatible AI API. Built with **Electron + React 19 + TypeScript + Tailwind v4** (electron-vite toolchain). The user (Yehan) is moving from Windows to **Omarchy (Arch-based)** and wants this app to run natively there. On Windows it shipped as an NSIS `.exe` installer; we need a Linux package (AppImage + .deb, ideally also an AUR PKGBUILD).

## Current code state (already done — verify, don't redo)
The source was made **platform-portable** in a prior session:
- The only Windows-specific code was MKV extraction (`mkv-extract` module). It previously hardcoded `mkvmerge.exe`/`mkvextract.exe` and Windows install paths. It now:
  - selects binary names per-OS (`.exe` on win32, bare `mkvmerge`/`mkvextract` on Linux/macOS)
  - searches `/usr/bin`, `/usr/local/bin`, etc. on Linux
  - gives a platform-correct install hint if tools are missing
- `electron-builder` config has a `linux:` block targeting **appImage** + **deb**, reusing the existing `icon.png`, and **excludes** the Windows-only `*.exe` MKV tools from the Linux package.
- `package.json` has a `package:linux` script: `electron-vite build && electron-builder --linux --publish never`
- The core SRT→Sinhala translation has **zero** OS dependencies (pure JS), so it works on Linux untouched.
- `index.ts` `window-all-closed` handler already quits on non-darwin — correct for Linux.

## Prerequisites on Omarchy
- Node.js + npm (the project built fine on Node 22 / npm 12; any modern LTS works)
- For MKV extraction feature only: `sudo pacman -S mkvtoolnix-cli` (provides `mkvmerge` + `mkvextract`). Plain SRT translation needs nothing.

## Build steps (run from inside the project directory)
```bash
npm install
npm run package:linux
```
Output lands in the configured release/output dir:
- `*.AppImage` — run directly after `chmod +x`
- `*.deb` — install with `sudo pacman -U` is wrong on Arch; on Arch prefer AppImage, or convert, or build an AUR package. (Note: `.deb` is mainly for Debian/Ubuntu users; on Omarchy itself the AppImage is the clean path.)

## Gotchas to watch
1. **You cannot build the Linux package from Windows** — electron-builder must run on a Linux host. That's why this is a future-me task on Omarchy, not something the Windows session can finish.
2. **MKV feature is a soft dependency** — if `mkvtoolnix-cli` isn't installed, the MKV button should error gracefully (the code throws a helpful message), not crash. Verify this once.
3. **Icon** — Linux build uses `icon.png` (already present). If it's missing, add a 512×512 png or the build warns.
4. **Wayland** — Omarchy is Hyprland/Wayland. Electron works under Wayland with `--ozone-platform=wayland` but may need `--enable-features=WaylandWindowDecorations` or fall back to XWayland. If the window looks broken, test launching the AppImage with `./app.AppImage --ozone-platform=wayland` and adjust the launch wrapper if needed.
5. **Native module check** — this project has no native node modules, so no `rebuild` step needed. If that ever changes, run `npm rebuild` or `electron-rebuild`.

## Optional / nice-to-have
- Draft an **AUR PKGBUILD** so Yehan can `yay -S srt-translator`. This is the cleanest install on Arch/Omarchy.
- Smoke-test: open the built AppImage, drop in a sample `.srt`, translate a few chunks, confirm Sinhala output and export.

## How to verify success
- AppImage launches on Omarchy ✅
- SRT file loads, translates to Sinhala, exports correctly ✅
- (If mkvtoolnix-cli installed) MKV track extraction works; if not installed, shows friendly error ✅
