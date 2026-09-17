#!/bin/bash
# Helper: create the GitHub release for this version and upload the Linux
# artifacts + the Windows installer.
#
# Requires: `gh auth login` done first (interactive, needs your GitHub account).
set -e
cd "$(dirname "$0")"

REPO="YehanKD/srt-translator"
VERSION="2.0.0"
TAG="v${VERSION}"

APPIMAGE="release/SRT Translator-${VERSION}.AppImage"
DEB="release/srt-translator_${VERSION}_amd64.deb"
WINEXE="release/SRT Translator Setup ${VERSION}.exe"

# Linux artifacts are required; the Windows installer is optional (it can only
# be built on Windows, so it may not be present on a Linux box).
ASSETS=()
for f in "$APPIMAGE" "$DEB"; do
  if [ ! -f "$f" ]; then
    echo "Missing $f — run 'npm run package:linux' first." >&2
    exit 1
  fi
  ASSETS+=("$f")
done
if [ -f "$WINEXE" ]; then
  ASSETS+=("$WINEXE")
else
  echo "Note: $WINEXE not found — releasing Linux artifacts only."
fi

echo "==> Creating GitHub release $TAG on $REPO"
gh release create "$TAG" "${ASSETS[@]}" \
  --repo "$REPO" \
  --title "SRT Translator $TAG" \
  --notes "AI-powered subtitle translator: any language into natural spoken Sinhala.

Sign in with your Google account to translate using its Gemini quota — no API key needed.

**Highlights**
- Google Antigravity sign-in (replaces the old API-key backend)
- Session is remembered between launches (refresh token encrypted via the OS keyring)
- Failed chunks report an error instead of silently exporting untranslated text
- Per-model quota view with the plan-appropriate reset window
- Linux packages no longer bundle ~38 MB of Windows-only MKVToolNix binaries

**Linux install**
- Arch/Omarchy: \`yay -S srt-translator\`
- AppImage: \`chmod +x\` then run
- Debian/Ubuntu: \`sudo dpkg -i srt-translator_${VERSION}_amd64.deb\`

Optional for MKV subtitle extraction: \`mkvtoolnix-cli\` (Arch) / \`mkvtoolnix\` (Debian)."

echo "==> Uploaded. Verify at https://github.com/$REPO/releases/tag/$TAG"
echo
echo "==> PKGBUILD check — the sha256 must match the uploaded AppImage:"
echo "    $(sha256sum "$APPIMAGE" | cut -d' ' -f1)"
echo "    (GitHub rewrites spaces to dots in asset names: SRT.Translator-${VERSION}.AppImage)"
