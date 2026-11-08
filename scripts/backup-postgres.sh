#!/bin/sh
set -eu
umask 077
mkdir -p /backups
keep="${BACKUP_KEEP:-7}"
case "$keep" in ''|*[!0-9]*) echo 'Invalid BACKUP_KEEP' >&2; exit 1;; esac
[ "$keep" -ge 1 ] || exit 1
snapshot() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid)"
  file="/backups/balance-$stamp.dump"
  temp="$file.partial"
  trap 'rm -f "$temp"' EXIT HUP INT TERM
  pg_dump --format=custom --no-owner --no-acl --file="$temp"
  pg_restore --list "$temp" > /dev/null
  mv "$temp" "$file"
  (cd /backups && sha256sum "balance-$stamp.dump" > "balance-$stamp.dump.sha256")
  # Retention only matches files created by this script in /backups.
  ls -1t /backups/balance-*.dump | tail -n +$((keep + 1)) | while IFS= read -r old; do
    rm -f "$old" "$old.sha256"
  done
  echo "Created PostgreSQL snapshot $stamp"
}
while :; do
  snapshot
  [ "${1:-}" != '--once' ] || exit 0
  sleep 86400
done
