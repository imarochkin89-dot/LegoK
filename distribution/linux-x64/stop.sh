#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ошибка: запустите через sudo." >&2; exit 1; }
systemctl stop kontur-local.service
echo "Контур остановлен."
