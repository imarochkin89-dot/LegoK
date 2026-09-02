#!/usr/bin/env bash
set -Eeuo pipefail

REMOVE_DATA="false"
CONFIRMED="false"
for argument in "$@"; do
  case "$argument" in
    --remove-data) REMOVE_DATA="true" ;;
    --yes) CONFIRMED="true" ;;
    --help|-h)
      echo "Использование: sudo ./uninstall.sh [--remove-data --yes]"
      echo "Без параметров удаляется служба и приложение, но сохраняются данные и настройки."
      exit 0
      ;;
    *) echo "Ошибка: неизвестный параметр $argument" >&2; exit 1 ;;
  esac
done

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ошибка: запустите через sudo." >&2; exit 1; }
if [[ "$REMOVE_DATA" == "true" && "$CONFIRMED" != "true" ]]; then
  echo "Ошибка: полное удаление требует параметров --remove-data --yes." >&2
  exit 1
fi

systemctl disable --now kontur-local.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/kontur-local.service
systemctl daemon-reload
sed -i '/^# BEGIN KONTUR LOCAL EDITION$/,/^# END KONTUR LOCAL EDITION$/d' /etc/hosts

if [[ -d /opt/kontur/app ]]; then
  rm -rf -- /opt/kontur/app
fi

if [[ "$REMOVE_DATA" == "true" ]]; then
  rm -rf -- /etc/kontur /var/lib/kontur /var/log/kontur
  userdel kontur >/dev/null 2>&1 || true
  echo "Приложение, настройки и рабочие данные удалены. Резервные копии в /var/backups/kontur сохранены."
else
  echo "Служба и приложение удалены. Настройки и данные сохранены в /etc/kontur и /var/lib/kontur."
fi
