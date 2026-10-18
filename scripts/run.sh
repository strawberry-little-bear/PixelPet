#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if command -v go >/dev/null 2>&1; then
  GO_BIN=go
elif [ -x .tools/go/bin/go ]; then
  GO_BIN="$PWD/.tools/go/bin/go"
else
  echo '请先安装 Go 1.26+：https://go.dev/dl/' >&2
  exit 1
fi

if [ ! -f web/dist/index.html ]; then
  echo '请先在 web 目录运行 pnpm install && pnpm build。' >&2
  exit 1
fi

exec "$GO_BIN" run ./cmd/pet
