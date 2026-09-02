#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ошибка: запустите через sudo." >&2; exit 1; }
[[ $# -eq 1 ]] || { echo "Использование: sudo ./remove-user.sh email" >&2; exit 1; }

APP_ROOT="/opt/kontur/app"
CONFIG_PATH="/etc/kontur/kontur.json"
NODE="$APP_ROOT/distribution/linux-x64/node/bin/node"
TOOL="$APP_ROOT/distribution/linux-x64/runtime/config-tool.mjs"

[[ -x "$NODE" && -f "$TOOL" && -f "$CONFIG_PATH" ]] || { echo "Ошибка: Контур не установлен." >&2; exit 1; }
"$NODE" "$TOOL" remove-user --config "$CONFIG_PATH" --email "$1"
chown root:kontur "$CONFIG_PATH"
chmod 0640 "$CONFIG_PATH"
systemctl restart kontur-local.service
echo "Локальный доступ пользователя удалён."
