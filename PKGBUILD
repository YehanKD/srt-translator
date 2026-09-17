# Maintainer: Yehan <yehan@swict.lk>
pkgname=srt-translator
pkgver=2.0.0
pkgrel=1
pkgdesc="AI-powered subtitle translator: any language into natural spoken Sinhala (Electron desktop app)"
arch=('x86_64')
url="https://github.com/YehanKD/srt-translator"
license=('MIT')
depends=('fuse2' 'gtk3' 'nss' 'libxcrypt-compat')
optdepends=(
  'mkvtoolnix-cli: extract subtitles from MKV files'
)
options=('!strip')
_appimage="SRT.Translator-${pkgver}.AppImage"
source=("${url}/releases/download/v${pkgver}/${_appimage}")
sha256sums=('7907c640552eba8a2f6f4a1dce87b48d82030a48428996982b654314b511d15e')

prepare() {
  chmod +x "${srcdir}/${_appimage}"
  "${srcdir}/${_appimage}" --appimage-extract >/dev/null 2>&1
}

package() {
  cd "${srcdir}"

  # AppImage payload (so it runs from /opt without re-mounting FUSE every launch)
  install -dm755 "${pkgdir}/opt/${pkgname}"
  install -Dm755 "${srcdir}/${_appimage}" "${pkgdir}/opt/${pkgname}/${pkgname}.AppImage"

  # Desktop integration
  install -dm755 "${pkgdir}/usr/share/applications"
  install -Dm644 "${srcdir}/squashfs-root/srt-translator.desktop" \
    "${pkgdir}/usr/share/applications/${pkgname}.desktop"

  # Icon (256x256 shipped in the AppImage)
  install -dm755 "${pkgdir}/usr/share/icons/hicolor/256x256/apps"
  install -Dm644 "${srcdir}/squashfs-root/usr/share/icons/hicolor/256x256/apps/srt-translator.png" \
    "${pkgdir}/usr/share/icons/hicolor/256x256/apps/${pkgname}.png"

  # Launcher wrapper that forces XWayland (native Wayland+Vulkan fails to map on Hyprland)
  install -dm755 "${pkgdir}/usr/bin"
  cat > "${pkgdir}/usr/bin/${pkgname}" <<EOF
#!/bin/bash
# Force XWayland: native Wayland + Vulkan fails to map the window on
# Hyprland/Omarchy and stalls. Export display env so launching from the
# app menu (which lacks a terminal's DISPLAY/WAYLAND_DISPLAY/DBUS vars)
# works fast. --appimage-extract-and-run skips the slow FUSE mount
# (~40s startup on this kernel); running the extracted binary directly
# brings cold-start to a few seconds. --disable-gpu avoids a GPU-process
# retry loop under the sandbox.
export WAYLAND_DISPLAY="\${WAYLAND_DISPLAY:-wayland-1}"
export DISPLAY="\${DISPLAY:-:0}"
export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/\$(id -u)/bus}"
exec /opt/${pkgname}/${pkgname}.AppImage --appimage-extract-and-run --ozone-platform=x11 --enable-features=WaylandWindowDecorations --disable-gpu --disable-software-rasterizer "\$@"
EOF
  chmod 755 "${pkgdir}/usr/bin/${pkgname}"

  # License
  install -Dm644 "${srcdir}/squashfs-root/LICENSE.electron.txt" \
    "${pkgdir}/usr/share/licenses/${pkgname}/LICENSE.electron.txt" 2>/dev/null || true
}
