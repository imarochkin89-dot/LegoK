#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ошибка: запустите через sudo." >&2; exit 1; }
systemctl start kontur-local.service
systemctl --no-pager --full status kontur-local.service
