#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Ошибка: запустите через sudo." >&2; exit 1; }
[[ $# -ge 1 ]] || { echo "Использование: sudo ./add-user.sh email [Имя]" >&2; exit 1; }

EMAIL="$1"
DISPLAY_NAME="${2:-}"
APP_ROOT="/opt/kontur/app"
CONFIG_PATH="/etc/kontur/kontur.json"
NODE="$APP_ROOT/distribution/linux-x64/node/bin/node"
TOOL="$APP_ROOT/distribution/linux-x64/runtime/config-tool.mjs"

[[ -x "$NODE" && -f "$TOOL" && -f "$CONFIG_PATH" ]] || { echo "Ошибка: Контур не установлен." >&2; exit 1; }

ARGS=("$TOOL" add-user --config "$CONFIG_PATH" --email "$EMAIL")
[[ -z "$DISPLAY_NAME" ]] || ARGS+=(--name "$DISPLAY_NAME")
RESULT="$("$NODE" "${ARGS[@]}")"
chown root:kontur "$CONFIG_PATH"
chmod 0640 "$CONFIG_PATH"
systemctl restart kontur-local.service

# shellcheck disable=SC2016
"$NODE" -e '
  const value = JSON.parse(process.argv[1]);
  console.log("Пользователь создан.");
  console.log(`Email: ${value.email}`);
  console.log(`Пароль: ${value.password}`);
  console.log("Добавьте этот же email в разделе «Команда» планировщика.");
' "$RESULT"
