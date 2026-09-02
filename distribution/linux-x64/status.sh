#!/usr/bin/env bash
set -Eeuo pipefail
systemctl --no-pager --full status kontur-local.service || true
echo
journalctl -u kontur-local.service -n 30 --no-pager || true
