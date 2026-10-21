#!/bin/bash
# ===================================================================
#  Campus Portal kiosk launcher (Mac)
#  - Opens the portal full screen in its own Chrome window
#  - Reopens it if Chrome closes or crashes
#  - Restarts Chrome once a day at 3:30 AM for a fresh start
#  - Keeps the Mac and the screen awake
#  Setup: put this kiosk's portal link in portal-url.txt (same folder), then add this file
#  in System Settings > General > Login Items so it runs when the Mac starts.
#  (If the Mac says it can't open it: right-click > Open once, or run chmod +x on it.)
# ===================================================================
cd "$(dirname "$0")"
URL="$(head -n 1 portal-url.txt | tr -d '\r')"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$HOME/Library/Application Support/CampusPortalChrome"
[ -x "$CHROME" ] || { echo "Google Chrome was not found in Applications."; read -r; exit 1; }

caffeinate -dimsu &   # no sleep, no screen saver
sleep 20              # give the network a moment after startup

while true; do
  "$CHROME" --kiosk "$URL" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check \
    --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --disable-session-crashed-bubble \
    --noerrdialogs --disable-infobars --disable-features=Translate --disable-background-timer-throttling \
    --disable-renderer-backgrounding --disable-backgrounding-occluded-windows >/dev/null 2>&1 &
  PID=$!
  while kill -0 "$PID" 2>/dev/null; do
    sleep 60
    if [ "$(date +%H%M)" = "0330" ]; then kill "$PID"; sleep 15; fi
  done
  sleep 5
done
