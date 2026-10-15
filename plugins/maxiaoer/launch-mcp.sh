#!/bin/sh
# GUI clients may not inherit the shell PATH that activates nvm/Homebrew.
# Do not source shell profiles: their output can corrupt the MCP stdio stream.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

usable_node() {
  [ -n "$1" ] && [ -x "$1" ] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1
}
start_node() {
  if usable_node "$1"; then
    node_path=$1
    shift
    exec "$node_path" "$script_dir/server.cjs" "$@"
  fi
}

# Explicit overrides must fail clearly rather than silently use another runtime.
if [ -n "${MAXIAOER_NODE_PATH:-}" ]; then
  if ! usable_node "$MAXIAOER_NODE_PATH"; then
    echo '蚂小儿 MCP：MAXIAOER_NODE_PATH 必须指向可执行的 Node.js 22+。' >&2
    exit 1
  fi
  exec "$MAXIAOER_NODE_PATH" "$script_dir/server.cjs" "$@"
fi
start_node "${CODEX_MCP_NODE_PATH:-}" "$@"
start_node "$(command -v node || true)" "$@"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
  "${VOLTA_HOME:-${HOME:-}/.volta}/bin/node" \
  "${NVM_DIR:-${HOME:-}/.nvm}"/versions/node/*/bin/node \
  "${FNM_DIR:-${HOME:-}/.local/share/fnm}"/node-versions/*/installation/bin/node \
  "${HOME:-}/Library/Application Support/fnm"/node-versions/*/installation/bin/node; do
  start_node "$candidate" "$@"
done
echo '蚂小儿 MCP：找不到 Node.js 22+。请安装 Node.js，或将 MAXIAOER_NODE_PATH 设置为 node 可执行文件的完整路径。' >&2
exit 1
