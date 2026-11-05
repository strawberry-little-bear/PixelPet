#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

if command -v go >/dev/null 2>&1; then
  GO_BIN=$(command -v go)
elif [ -x "$ROOT/.tools/go/bin/go" ]; then
  GO_BIN="$ROOT/.tools/go/bin/go"
else
  echo '请先安装 Go 1.26+：https://go.dev/dl/' >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN=$(command -v pnpm)
else
  echo '请先安装 pnpm 11.25.0，并确保 pnpm 在 PATH 中。' >&2
  exit 1
fi

PORT=${PIXELPET_DEVICE_PORT:-18081}
ADDR=${PIXELPET_DEVICE_ADDR:-0.0.0.0:$PORT}
DEVICE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pixelpet-device.XXXXXX")

cleanup() {
  status=$?
  trap - EXIT INT TERM
  echo "临时构建和测试存档保留在：$DEVICE_DIR" >&2
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "构建后端到：$DEVICE_DIR/pixelpet"
"$GO_BIN" build -o "$DEVICE_DIR/pixelpet" ./cmd/pet

echo "构建前端到：$DEVICE_DIR/web"
(
  cd "$ROOT/web"
  "$PNPM_BIN" exec tsc --noEmit
  "$PNPM_BIN" exec vite build --emptyOutDir --outDir "$DEVICE_DIR/web"
)

HOST_IP=${PIXELPET_HOST_IP:-}
if [ -z "$HOST_IP" ] && command -v ipconfig >/dev/null 2>&1; then
  for interface in en0 en1; do
    HOST_IP=$(ipconfig getifaddr "$interface" 2>/dev/null || true)
    [ -n "$HOST_IP" ] && break
  done
fi

echo "隔离测试存档：$DEVICE_DIR/device-test.db"
echo "本机入口：http://127.0.0.1:$PORT/"
if [ -n "$HOST_IP" ]; then
  echo "局域网入口：http://$HOST_IP:$PORT/"
else
  echo '局域网入口：http://电脑的局域网IPv4:'"$PORT"'/（请手动替换 IPv4）'
fi
echo '仅在可信私人 Wi-Fi 短时使用；结束时按 Ctrl+C。'

exec env \
  PIXELPET_DB="$DEVICE_DIR/device-test.db" \
  PIXELPET_ADDR="$ADDR" \
  PIXELPET_WEB="$DEVICE_DIR/web" \
  "$DEVICE_DIR/pixelpet"
