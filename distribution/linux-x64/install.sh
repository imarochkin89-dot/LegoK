#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="/opt/kontur"
CONFIG_ROOT="/etc/kontur"
DATA_ROOT="/var/lib/kontur"
LOG_ROOT="/var/log/kontur"
RUN_ROOT="/run/kontur"
PLANNER_HOST="planner.kontur.local"
PORTAL_HOST="portal.kontur.local"
ADMIN_EMAIL="admin@kontur.local"
ADMIN_NAME="Администратор"
ALLOWED_NETWORKS="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
NETWORKS_EXPLICIT="false"

usage() {
  cat <<'EOF'
Контур Community Edition — установка для Linux x64

Использование:
  sudo ./install.sh [параметры]

Параметры:
  --planner-host ИМЯ       DNS-имя планировщика
  --portal-host ИМЯ        DNS-имя клиентского портала
  --admin-email EMAIL      email первого администратора
  --admin-name ИМЯ         отображаемое имя администратора
  --allowed-network CIDR   разрешённая IPv4-подсеть; можно повторять
  --help                   показать эту справку

Без --allowed-network разрешаются частные сети 10/8, 172.16/12 и 192.168/16.
EOF
}

die() {
  printf 'Ошибка: %s\n' "$*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

append_network() {
  if [[ "$NETWORKS_EXPLICIT" == "false" ]]; then
    ALLOWED_NETWORKS="$1"
    NETWORKS_EXPLICIT="true"
  else
    ALLOWED_NETWORKS+=",$1"
  fi
}

while (($#)); do
  case "$1" in
    --planner-host) [[ $# -ge 2 ]] || die "После --planner-host нужно значение."; PLANNER_HOST="$2"; shift 2 ;;
    --portal-host) [[ $# -ge 2 ]] || die "После --portal-host нужно значение."; PORTAL_HOST="$2"; shift 2 ;;
    --admin-email) [[ $# -ge 2 ]] || die "После --admin-email нужно значение."; ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-name) [[ $# -ge 2 ]] || die "После --admin-name нужно значение."; ADMIN_NAME="$2"; shift 2 ;;
    --allowed-network) [[ $# -ge 2 ]] || die "После --allowed-network нужен CIDR."; append_network "$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Запустите установщик через sudo."
[[ "$(uname -m)" == "x86_64" ]] || die "Поддерживается только Linux x86_64."
[[ -r /etc/os-release ]] || die "Не удалось определить дистрибутив Linux."
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:24.04*|debian:12*) ;;
  *) die "Поддерживаются Ubuntu Server 24.04 LTS и Debian 12." ;;
esac

for command_name in tar openssl systemctl useradd install sed; do
  command -v "$command_name" >/dev/null 2>&1 || die "Не найдена команда $command_name. Установите стандартный системный пакет и повторите."
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
APP_ROOT="$INSTALL_ROOT/app"
CONFIG_PATH="$CONFIG_ROOT/kontur.json"
TLS_ROOT="$CONFIG_ROOT/tls"
PFX_PATH="$TLS_ROOT/gateway.pfx"
PID_FILE="$RUN_ROOT/kontur.pid.json"
SERVICE_NAME="kontur-local.service"

[[ "$SOURCE_ROOT" != "$APP_ROOT" && "$SOURCE_ROOT" != "$APP_ROOT/"* ]] || die "Запустите установщик из распакованного архива, а не из /opt/kontur/app."

printf '\nКонтур Community Edition — установка на Linux\n'
printf 'Планировщик: https://%s\n' "$PLANNER_HOST"
printf 'Портал:      https://%s\n' "$PORTAL_HOST"
printf 'Подсети:     %s\n' "$ALLOWED_NETWORKS"

if ! id kontur >/dev/null 2>&1; then
  step "Создание системного пользователя kontur"
  useradd --system --home-dir "$DATA_ROOT" --create-home --shell /usr/sbin/nologin kontur
fi

install -d -m 0755 "$INSTALL_ROOT"
install -d -o root -g kontur -m 0750 "$CONFIG_ROOT" "$TLS_ROOT"
install -d -o kontur -g kontur -m 0750 "$DATA_ROOT" "$LOG_ROOT" "$RUN_ROOT"

systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true

APP_STAGE="$(mktemp -d "$INSTALL_ROOT/.app-stage.XXXXXX")"
PREVIOUS_APP="$INSTALL_ROOT/app.previous"
CERT_STAGE=""
cleanup() {
  if [[ -n "$CERT_STAGE" && -d "$CERT_STAGE" && "$CERT_STAGE" == /tmp/kontur-cert.* ]]; then
    rm -rf -- "$CERT_STAGE"
  fi
  if [[ -d "$APP_STAGE" && "$APP_STAGE" == "$INSTALL_ROOT/.app-stage."* ]]; then
    rm -rf -- "$APP_STAGE"
  fi
}
trap cleanup EXIT

step "Копирование программных файлов"
tar -C "$SOURCE_ROOT" \
  --exclude='./.git' \
  --exclude='./apps/planner/node_modules' \
  --exclude='./apps/portal/node_modules' \
  --exclude='./apps/planner/.wrangler' \
  --exclude='./apps/portal/.wrangler' \
  --exclude='./apps/planner/.next' \
  --exclude='./apps/portal/.next' \
  --exclude='./apps/planner/.vinext' \
  --exclude='./apps/portal/.vinext' \
  --exclude='./apps/planner/.sites-runtime' \
  --exclude='./apps/portal/.sites-runtime' \
  --exclude='./.env' \
  --exclude='./.env.local' \
  -cf - . | tar -C "$APP_STAGE" -xf -

BUNDLED_NODE="$APP_STAGE/distribution/linux-x64/node/bin/node"
BUNDLED_WRANGLER="$APP_STAGE/distribution/linux-x64/runtime-package/node_modules/wrangler/bin/wrangler.js"
PLANNER_BUILD="$APP_STAGE/apps/planner/dist/server/index.js"
PORTAL_BUILD="$APP_STAGE/apps/portal/dist/server/index.js"

if [[ -x "$BUNDLED_NODE" && -f "$BUNDLED_WRANGLER" && -f "$PLANNER_BUILD" && -f "$PORTAL_BUILD" ]]; then
  step "Найден автономный пакет — интернет не требуется"
  NODE_PATH="$BUNDLED_NODE"
else
  step "Сборка из исходников"
  command -v node >/dev/null 2>&1 || die "Для установки из исходников нужен Node.js 22.13 или новее. Скачайте готовый архив из GitHub Releases."
  command -v npm >/dev/null 2>&1 || die "Для установки из исходников нужен npm. Скачайте готовый архив из GitHub Releases."
  NODE_PATH="$(command -v node)"
  "$NODE_PATH" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' \
    || die "Нужен Node.js 22.13 или новее."
  npm ci --prefix "$APP_STAGE/apps/planner" --no-audit --no-fund
  npm ci --prefix "$APP_STAGE/apps/portal" --no-audit --no-fund
  npm run build --prefix "$APP_STAGE/apps/planner"
  npm run build --prefix "$APP_STAGE/apps/portal"
  npm ci --prefix "$APP_STAGE/distribution/linux-x64/runtime-package" --omit=dev --no-audit --no-fund
  install -d -m 0755 "$APP_STAGE/distribution/linux-x64/node/bin"
  ln -s "$NODE_PATH" "$APP_STAGE/distribution/linux-x64/node/bin/node"
fi

if [[ -e "$PREVIOUS_APP" ]]; then
  rm -rf -- "$PREVIOUS_APP"
fi
if [[ -d "$APP_ROOT" ]]; then
  mv "$APP_ROOT" "$PREVIOUS_APP"
fi
mv "$APP_STAGE" "$APP_ROOT"
APP_STAGE=""
chown -R root:root "$APP_ROOT"
chmod 0755 "$APP_ROOT/distribution/linux-x64/node/bin/node"

NODE_PATH="$APP_ROOT/distribution/linux-x64/node/bin/node"
CONFIG_TOOL="$APP_ROOT/distribution/linux-x64/runtime/config-tool.mjs"
FIRST_INSTALL="false"
CREDENTIALS=""

if [[ ! -f "$CONFIG_PATH" ]]; then
  step "Создание конфигурации и первого администратора"
  FIRST_INSTALL="true"
  export KONTUR_INSTALL_ROOT="$INSTALL_ROOT"
  export KONTUR_APP_ROOT="$APP_ROOT"
  export KONTUR_DATA_ROOT="$DATA_ROOT"
  export KONTUR_LOG_ROOT="$LOG_ROOT"
  export KONTUR_TLS_PFX="$PFX_PATH"
  export KONTUR_PID_FILE="$PID_FILE"
  export KONTUR_RUNTIME_CONFIG_ROOT="$RUN_ROOT"
  export KONTUR_PLANNER_HOST="$PLANNER_HOST"
  export KONTUR_PORTAL_HOST="$PORTAL_HOST"
  export KONTUR_ADMIN_EMAIL="$ADMIN_EMAIL"
  export KONTUR_ADMIN_NAME="$ADMIN_NAME"
  export KONTUR_ALLOWED_NETWORKS="$ALLOWED_NETWORKS"
  CREDENTIALS="$("$NODE_PATH" "$CONFIG_TOOL" create --config "$CONFIG_PATH")"
  unset KONTUR_INSTALL_ROOT KONTUR_APP_ROOT KONTUR_DATA_ROOT KONTUR_LOG_ROOT KONTUR_TLS_PFX
  unset KONTUR_PID_FILE KONTUR_RUNTIME_CONFIG_ROOT KONTUR_PLANNER_HOST KONTUR_PORTAL_HOST
  unset KONTUR_ADMIN_EMAIL KONTUR_ADMIN_NAME KONTUR_ALLOWED_NETWORKS
elif [[ "$NETWORKS_EXPLICIT" == "true" ]]; then
  step "Обновление списка разрешённых VLAN"
  "$NODE_PATH" "$CONFIG_TOOL" set-networks --config "$CONFIG_PATH" --networks "$ALLOWED_NETWORKS" >/dev/null
fi

mapfile -t CURRENT_NETWORK_CONFIG < <("$NODE_PATH" -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log(config.network.plannerHost);
  console.log(config.network.portalHost);
  console.log((config.network.allowedNetworks || []).join(","));
' "$CONFIG_PATH")
PLANNER_HOST="${CURRENT_NETWORK_CONFIG[0]}"
PORTAL_HOST="${CURRENT_NETWORK_CONFIG[1]}"
ALLOWED_NETWORKS="${CURRENT_NETWORK_CONFIG[2]}"

chown root:kontur "$CONFIG_PATH"
chmod 0640 "$CONFIG_PATH"

if [[ ! -f "$PFX_PATH" ]]; then
  step "Создание локального центра сертификации и HTTPS-сертификата"
  CERT_STAGE="$(mktemp -d /tmp/kontur-cert.XXXXXX)"
  chmod 0700 "$CERT_STAGE"
  PFX_PASSWORD="$("$NODE_PATH" -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(c.tls.pfxPassword)' "$CONFIG_PATH")"
  printf '%s' "$PFX_PASSWORD" > "$CERT_STAGE/pfx-password"
  chmod 0600 "$CERT_STAGE/pfx-password"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$CERT_STAGE/root.key" >/dev/null 2>&1
  openssl req -x509 -new -sha256 -days 3650 \
    -key "$CERT_STAGE/root.key" \
    -subj "/CN=Kontur Local Root CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign,digitalSignature" \
    -out "$TLS_ROOT/kontur-root-ca.crt"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$CERT_STAGE/server.key" >/dev/null 2>&1
  openssl req -new -key "$CERT_STAGE/server.key" -subj "/CN=$PLANNER_HOST" -out "$CERT_STAGE/server.csr"
  printf 'subjectAltName=DNS:%s,DNS:%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' \
    "$PLANNER_HOST" "$PORTAL_HOST" > "$CERT_STAGE/server.ext"
  openssl x509 -req -sha256 -days 1825 \
    -in "$CERT_STAGE/server.csr" \
    -CA "$TLS_ROOT/kontur-root-ca.crt" \
    -CAkey "$CERT_STAGE/root.key" \
    -CAcreateserial \
    -extfile "$CERT_STAGE/server.ext" \
    -out "$CERT_STAGE/server.crt" >/dev/null 2>&1
  openssl pkcs12 -export \
    -inkey "$CERT_STAGE/server.key" \
    -in "$CERT_STAGE/server.crt" \
    -name "Kontur Local Edition" \
    -passout "file:$CERT_STAGE/pfx-password" \
    -out "$PFX_PATH"
  chown root:kontur "$PFX_PATH"
  chmod 0640 "$PFX_PATH"
  chmod 0644 "$TLS_ROOT/kontur-root-ca.crt"
fi

step "Настройка локальных DNS-имён на сервере"
sed -i '/^# BEGIN KONTUR LOCAL EDITION$/,/^# END KONTUR LOCAL EDITION$/d' /etc/hosts
printf '\n# BEGIN KONTUR LOCAL EDITION\n127.0.0.1 %s %s\n# END KONTUR LOCAL EDITION\n' \
  "$PLANNER_HOST" "$PORTAL_HOST" >> /etc/hosts

step "Установка и запуск службы systemd"
install -o root -g root -m 0644 "$APP_ROOT/distribution/linux-x64/kontur-local.service" "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null

rollback_application() {
  if [[ -d "$PREVIOUS_APP" ]]; then
    local failed_app="$INSTALL_ROOT/app.failed.$(date -u +%Y%m%d%H%M%S)"
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    mv "$APP_ROOT" "$failed_app"
    mv "$PREVIOUS_APP" "$APP_ROOT"
    systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
    echo "Предыдущая версия восстановлена. Неудачная версия сохранена в $failed_app." >&2
  fi
}

if ! systemctl start "$SERVICE_NAME"; then
  rollback_application
  die "Служба не запустилась. Выполните: journalctl -u $SERVICE_NAME -n 100 --no-pager"
fi

READY="false"
for _ in {1..120}; do
  if systemctl is-active --quiet "$SERVICE_NAME" && "$NODE_PATH" -e 'const net=require("net"); const s=net.connect(Number(process.argv[1]),"127.0.0.1",()=>{s.end();process.exit(0)}); s.setTimeout(800,()=>process.exit(1)); s.on("error",()=>process.exit(1))' 443; then
    READY="true"
    break
  fi
  sleep 1
done
if [[ "$READY" != "true" ]]; then
  journalctl -u "$SERVICE_NAME" -n 40 --no-pager >&2 || true
  rollback_application
  die "Служба не стала готова за 120 секунд."
fi

if [[ "$FIRST_INSTALL" == "true" ]]; then
  LOGIN_EMAIL="$("$NODE_PATH" -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.email)' "$CREDENTIALS")"
  LOGIN_PASSWORD="$("$NODE_PATH" -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.password)' "$CREDENTIALS")"
  cat > "$CONFIG_ROOT/FIRST-LOGIN.txt" <<EOF
Контур Community Edition

Планировщик: https://$PLANNER_HOST
Публичный портал: https://$PORTAL_HOST

Email: $LOGIN_EMAIL
Пароль: $LOGIN_PASSWORD

Сохраните пароль в менеджере паролей и удалите этот файл.
Корневой сертификат: $TLS_ROOT/kontur-root-ca.crt
EOF
  chown root:root "$CONFIG_ROOT/FIRST-LOGIN.txt"
  chmod 0600 "$CONFIG_ROOT/FIRST-LOGIN.txt"
fi

cat > "$CONFIG_ROOT/INSTALLATION-RESULT.txt" <<EOF
Контур установлен и запущен.

Планировщик: https://$PLANNER_HOST
Публичный портал: https://$PORTAL_HOST
Разрешённые сети: $ALLOWED_NETWORKS

Первый вход: $CONFIG_ROOT/FIRST-LOGIN.txt
Корневой сертификат: $TLS_ROOT/kontur-root-ca.crt
Состояние: sudo systemctl status $SERVICE_NAME
Журнал: sudo journalctl -u $SERVICE_NAME -f
EOF
chmod 0644 "$CONFIG_ROOT/INSTALLATION-RESULT.txt"

if [[ -d "$PREVIOUS_APP" ]]; then
  rm -rf -- "$PREVIOUS_APP"
fi

printf '\nКонтур установлен и запущен.\n'
printf 'Первый логин: sudo cat %s/FIRST-LOGIN.txt\n' "$CONFIG_ROOT"
printf 'Добавьте DNS-записи %s и %s на IP этого сервера.\n' "$PLANNER_HOST" "$PORTAL_HOST"
printf 'Установите на клиентские компьютеры сертификат %s/kontur-root-ca.crt.\n' "$TLS_ROOT"
