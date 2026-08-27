#!/bin/bash
# Helper: create a GitHub release and upload the AppImage.
# Requires: `gh auth login` done first (interactive, needs your GitHub account).
set -e
cd "$(dirname "$0")"

REPO="YehanKD/srt-translator"
APP="release/SRT Translator-1.0.0.AppImage"
TAG="v1.0.0"

if [ ! -f "$APP" ]; then
  echo "AppImage not found at $APP. Run 'npm run package:linux' first." >&2
  exit 1
fi

echo "==> Creating GitHub release $TAG on $REPO"
gh release create "$TAG" "$APP" \
  --repo "$REPO" \
  --title "SRT Translator $TAG" \
  --notes "AI-powered English to Sinhala SRT subtitle translator (Linux AppImage)."

echo "==> Done. Verify at https://github.com/$REPO/releases/tag/$TAG"
echo "==> Then update PKGBUILD source URL if the repo path differs, and run:"
echo "    makepkg -si      # local test install"
echo "    (then publish to AUR — see chat notes)"
