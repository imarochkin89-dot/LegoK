#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ошибка: запустите через sudo." >&2; exit 1; }
DESTINATION="${1:-/var/backups/kontur}"
mkdir -p "$DESTINATION"
DESTINATION="$(cd "$DESTINATION" && pwd -P)"
ARCHIVE="$DESTINATION/kontur-backup-$(date -u +%Y%m%d-%H%M%S).tar.gz"
WAS_ACTIVE="false"

if systemctl is-active --quiet kontur-local.service; then
  WAS_ACTIVE="true"
  echo "Контур будет ненадолго остановлен для целостной резервной копии."
  systemctl stop kontur-local.service
fi

restart_service() {
  if [[ "$WAS_ACTIVE" == "true" ]]; then
    systemctl start kontur-local.service || true
  fi
}
trap restart_service EXIT

tar --numeric-owner -czf "$ARCHIVE" -C / etc/kontur var/lib/kontur
chmod 0600 "$ARCHIVE"
restart_service
WAS_ACTIVE="false"
trap - EXIT

echo "Резервная копия создана: $ARCHIVE"
echo "Архив содержит проекты, документы, пользователей и HTTPS-ключ. Храните его в защищённом месте."
