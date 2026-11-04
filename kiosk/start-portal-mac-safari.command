#!/bin/bash
# ===================================================================
#  Campus Portal kiosk launcher (Mac, Safari version)
#  For Macs where Chrome can't be installed. Same idea as start-portal-mac.command:
#  - Opens the portal in Safari, full screen
#  - Reopens Safari if it closes or crashes
#  - Restarts Safari once a day at 3:30 AM for a fresh start
#  - Keeps the Mac and the screen awake
#  One-time setup (see README, "Using Safari"):
#  - Put this kiosk's portal link in portal-url.txt (same folder)
#  - Safari > Settings > Websites: allow Camera, Microphone and Auto-Play for the portal site
#  - System Settings > Privacy & Security > Accessibility: turn on Terminal (lets this script make Safari full screen)
#  - Add this file to System Settings > General > Login Items
# ===================================================================
cd "$(dirname "$0")"
URL="$(head -n 1 portal-url.txt | tr -d '\r')"

caffeinate -dimsu &   # no sleep, no screen saver
sleep 20              # give the network a moment after startup

open_portal() {
  osascript -e 'tell application "Safari" to quit' >/dev/null 2>&1
  sleep 4
  open -a Safari "$URL"
  sleep 10
  # Full screen (needs Terminal allowed under Accessibility). Setting it, not toggling, so it's safe to repeat.
  osascript >/dev/null 2>&1 <<'APPLESCRIPT'
tell application "Safari" to activate
delay 1
tell application "System Events" to tell process "Safari"
  set value of attribute "AXFullScreen" of window 1 to true
end tell
APPLESCRIPT
}

open_portal
while true; do
  sleep 60
  if ! pgrep -x Safari >/dev/null; then open_portal; continue; fi
  if [ "$(date +%H%M)" = "0330" ]; then open_portal; sleep 60; fi
done
