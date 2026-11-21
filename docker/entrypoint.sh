#!/bin/sh
# Starts the app. Docker runs this as root only long enough to make the receipts
# folder usable, then runs the app as the "app" user (uid 1001).
#
# A bind-mounted folder belongs to whoever made it on the host. The app keeps the
# folder's group (your group, when install.sh made it) and runs with it, so you can
# read receipts (they are saved group-readable) and back them up without sudo.
# A folder Docker made itself belongs to root; then the app's own group is used.
set -e
if [ "$(id -u)" = 0 ]; then
  dir="${RECEIPTS_DIR:-/data/receipts}"
  mkdir -p "$dir"
  gid=$(stat -c %g "$dir")
  [ "$gid" != 0 ] || gid=$(id -g app)
  find "$dir" \( ! -user app -o ! -group "$gid" \) -exec chown "app:$gid" {} +
  exec su-exec "app:$gid" "$@"
fi
exec "$@"
