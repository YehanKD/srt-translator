#!/bin/bash
# Launcher for SRT Translator on Hyprland/Wayland.
# Uses --appimage-extract-and-run to skip the slow FUSE mount (the default
# AppImage runtime mount added ~40s to startup on Omarchy's kernel). Running
# the extracted binary directly brings cold-start down to a few seconds.
# We also export the display + DBus env explicitly, because launching from the
# app menu does NOT inherit a terminal's DISPLAY/WAYLAND_DISPLAY/DBUS vars
# (missing DBUS made Electron retry the bus for ~11s x several attempts).
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
export DISPLAY="${DISPLAY:-:0}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
cd "$(dirname "$0")" || exit 1
exec "./SRT Translator-1.0.0.AppImage" \
  --appimage-extract-and-run \
  --ozone-platform=x11 \
  --enable-features=WaylandWindowDecorations \
  --disable-gpu \
  --disable-software-rasterizer
