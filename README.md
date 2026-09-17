# SRT Translator

A desktop app that translates **subtitles in any language into natural spoken Sinhala**, using Gemini models through your own Google account — no API key required.

Built with Electron + React 19 + TypeScript + Tailwind v4.

![Electron](https://img.shields.io/badge/Electron-42-47848F) ![React](https://img.shields.io/badge/React-19-61DAFB) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## What it does

- **Translate a subtitle file** — drop in an `.srt`, get Sinhala out. The source language is detected by the model, so English, Hindi, Arabic, Tamil and others all work.
- **Pull subtitles out of a movie** — pick an `.mkv`, choose a text subtitle track, and it extracts + loads it for translation (needs MKVToolNix).
- **Batch translate with live preview** — chunks run in parallel with adaptive concurrency; the table fills in as results arrive.
- **Multi-tab** — translate several files at once; each tab has its own job, progress and export.
- **Anti-spoiler blur** — toggle a blur over the preview columns so you can't read ahead. Works during translation too, and is switchable with an eye icon.
- **Light / dark theme** — with a circular reveal animation expanding from the toggle button. Falls back to a colour crossfade where View Transitions aren't available, and to an instant swap when the OS asks for reduced motion.
- **Subtitle cleanup** — strip speaker-name tags (`CHOW:`) and remove non-dialogue sound cues (`[ALARM BLARING]`).
- **Quota view** — see per-model and plan-appropriate remaining quota for your account (5-hour window on paid plans, weekly on free).

## Authentication

Sign in once with your Google account. The app uses the same public OAuth client that Google's own Antigravity desktop client ships, so it draws on the Gemini quota attached to **your** account (Free / Pro / Ultra tiers are all supported; model availability depends on your plan).

Your session is remembered between launches: the refresh token is encrypted with your OS keyring via Electron's `safeStorage` (GNOME Keyring/KWallet on Linux, DPAPI on Windows, Keychain on macOS). Access tokens are never written to disk. If no keyring is available, nothing is persisted rather than storing a credential in plaintext.

Sign out at any time from the account bar — this revokes the token with Google and deletes the stored credential.

## Install

### Windows

Download and run `SRT Translator Setup 2.0.0.exe` from [Releases](https://github.com/YehanKD/srt-translator/releases).

The installer is not code-signed, so Windows SmartScreen may show *"Unknown publisher"* — choose **More info → Run anyway**.

### Arch Linux / Omarchy (AUR)

```bash
yay -S srt-translator
```

### Any Linux (AppImage)

```bash
chmod +x "SRT Translator-2.0.0.AppImage"
./"SRT Translator-2.0.0.AppImage"
```

### Debian / Ubuntu

```bash
sudo dpkg -i srt-translator_2.0.0_amd64.deb
```

## Optional: MKV subtitle extraction

Only needed for the "extract from a movie" feature. Plain `.srt` translation works without it.

| Distro | Command |
|---|---|
| Arch / Omarchy | `sudo pacman -S mkvtoolnix-cli` |
| Debian / Ubuntu | `sudo apt install mkvtoolnix` |
| macOS | `brew install mkvtoolnix` |

On Windows the required binaries ship with the installer. If the tools are missing, the app shows a clear message instead of failing silently.

> **Note:** image-based subtitle tracks (PGS, VobSub) can't be translated — they'd need OCR. The track picker marks them as *not translatable*.

## Building from source

Requires Node.js 20+.

```bash
git clone https://github.com/YehanKD/srt-translator.git
cd srt-translator
npm install

npm run dev            # development
npm run typecheck      # type-check main + renderer
npm run package:linux  # AppImage + .deb   -> release/
npm run package        # Windows NSIS installer -> release/
```

Both package scripts write into `release/` and leave each other's output alone, so rebuilding the Linux packages does not remove an existing Windows installer.

**Cross-compiling Windows from Linux** works — `electron-builder` drives the NSIS installer through Wine. Two cautions:

- Wine must be installed (`wine --version`).
- Never run two `electron-builder` processes at once. They extract Electron into the same temporary directory and race, failing with `ENOENT ... win-unpacked.tmp/electron.exe`.

## How it works

```
renderer/                 React UI (tabs, preview, account bar, modals)
  src/components/         TabBar, TabView, SubtitlePreview, JobStrip, …
  src/hooks/              useTranslation, useTheme, useAntigravity
  src/lib/                model picker, quota helpers
  src/styles/globals.css  design tokens + component classes
src/preload/              contextBridge IPC surface (no node in renderer)
src/main/
  index.ts                window lifecycle
  ipc-handlers.ts         all IPC entry points
  modules/
    srt-parser.ts         parse / serialize / clean AI output
    translation-engine.ts parallel chunk translation, retries, failure reporting
    prompt-builder.ts     Sinhala translation prompt
    mkv-extract.ts        MKVToolNix integration (+ ASS -> SRT)
    file-io.ts            open/save dialogs
    antigravity/          Google account auth, quota, and the inference transport
```

### Translation pipeline

Subtitles are split into chunks of 15 and translated in parallel (6 concurrent, adapting down on rate limits and recovering when clean). Each chunk owns a fixed slot in the result array, so the output order always matches the input regardless of which request finishes first.

Cue **timings and ordering are taken from the original file** — only the text is replaced. That means a model renumbering its output can't corrupt your timestamps.

The model is selected automatically: the latest Pro model available on your account is preferred, never a Flash variant. The picker lives under **Advanced** so the main UI stays uncluttered, and quota stays visible on the main bar.

### Failure behaviour

If a chunk exhausts all retries, the job **reports an error** — it never presents a partly-untranslated file as finished. The lines that did translate are kept and shown, with a warning that the rest are still in the original language; the export button changes to *Export Anyway (Incomplete)*. Deterministic errors (model not available on your plan, access denied) stop the queue immediately rather than firing doomed requests.

Cancelling is a **distinct outcome** from failing: the run reports *Cancelled* (not an error) and whatever translated so far stays exportable.

## Troubleshooting

**Window doesn't appear on Hyprland / Wayland**
Launch with XWayland — native Wayland plus Vulkan fails to map the window:

```bash
./"SRT Translator-2.0.0.AppImage" --ozone-platform=x11 --enable-features=WaylandWindowDecorations
```

**AppImage won't start (`libfuse.so.2`)**
Install FUSE, or bypass it:

```bash
sudo pacman -S fuse2                        # Arch
./App.AppImage --appimage-extract-and-run   # or skip FUSE entirely
```

**Slow startup on Arch**
The AppImage's FUSE mount is slow on some kernels. `--appimage-extract-and-run` skips it (cold start drops from ~40s to a few seconds). The AUR package's launcher already does this.

The bundled squashfs also uses **zstd** compression rather than xz. xz is decompressed on every file read through FUSE, and Electron touches hundreds of files during startup — with xz a cold launch took 77 seconds. The file is slightly larger with zstd but starts in about a second.

**Theme toggle has no animation**
Windows and Linux both honour the OS "reduce motion" setting, and the app respects it by design. Re-enable animations:

- **Windows:** Settings → Accessibility → Visual effects → Animation effects → On
- **Linux (GNOME):** `gsettings set org.gnome.desktop.interface enable-animations true`

**"Model not available on this account"**
Not every model is available on every plan. Pick a different model from the Advanced panel.

## Credits

Uses the public Antigravity OAuth client credentials so a consumer Google account can access Gemini quota, mirroring the behaviour of the official Antigravity client.

## License

[MIT](LICENSE)
