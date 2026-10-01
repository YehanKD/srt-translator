#!/bin/bash
# Helper: create the GitHub release for this version and upload the Linux
# artifacts + the Windows installer.
#
# Requires: `gh auth login` done first (interactive, needs your GitHub account).
set -e
cd "$(dirname "$0")"

REPO="YehanKD/srt-translator"
VERSION="2.0.2"
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
- **Sound cues, song lyrics and speaker names are removed automatically.** Previously three buttons you had to remember to press; they now run when you open a file, so the preview shows exactly what will be translated. No more paying quota to translate `[door closes]`, `♪ song lyrics ♪` or `JASON:`.
- **App log for troubleshooting.** The app writes a log of sign-in, translation and error events — find it under *Advanced → Open log file*. Previously a failure left no trace at all when launched from the app menu.
- **Interrupted translations resume.** A crash, a closed window or a cancel no longer throws away the work already done; reopening the same file continues from where it stopped instead of re-translating from the start.
- **Quota updates itself.** The indicator refreshes on a timer and again right after a translation finishes, so it no longer needs the Refresh button.
- **Faster translation.** Concurrency ramps from 6 to 12 requests as the backend stays clean, cutting wall time on long files roughly in half. Any rate-limit response pulls it straight back down.
- **Truncated responses are no longer hidden.** If the model returned fewer cues than asked, the missing lines used to keep their original text while the job still reported success — a part-English file that looked finished. It now retries and reports incomplete instead.
- **Sign-in works for brand-new Google accounts.** Accounts that had never used Gemini Code Assist were rejected with \"No Cloud Code project available\". A missing project is no longer treated as a sign-in failure — the session is saved and discovery retries automatically.
- **New models are adopted automatically.** The newest Gemini Pro on your account is chosen at each launch, so a newly released model is used without updating the app.
- Quota shows the model actually in use, not the lowest across every model on the account
- Translates from any source language, not just English
- MKV-extracted subtitles are named after the movie, so players auto-load them
- Session is remembered between launches (refresh token encrypted via the OS keyring)
- Light/dark theme with a circular reveal animation
- Failed chunks report an error instead of silently exporting untranslated text; cancelling reports Cancelled, not Failed
- AppImage cold start dropped from ~77s to ~1s (zstd squashfs)

**Linux install**
- Arch/Omarchy: \`yay -S srt-translator\`
- AppImage: \`chmod +x\` then run
- Debian/Ubuntu: \`sudo dpkg -i srt-translator_${VERSION}_amd64.deb\`

**Windows install**
- Run the installer. It is not code-signed, so SmartScreen may show \"Unknown publisher\" — choose *More info → Run anyway*.

Optional for MKV subtitle extraction: \`mkvtoolnix-cli\` (Arch) / \`mkvtoolnix\` (Debian); bundled on Windows."

echo "==> Uploaded. Verify at https://github.com/$REPO/releases/tag/$TAG"
echo
echo "==> PKGBUILD check — the sha256 must match the uploaded AppImage:"
echo "    $(sha256sum "$APPIMAGE" | cut -d' ' -f1)"
echo "    (GitHub rewrites spaces to dots in asset names: SRT.Translator-${VERSION}.AppImage)"
