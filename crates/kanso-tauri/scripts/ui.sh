#!/usr/bin/env bash
# Locate the ui/ dir relative to this script so Tauri's beforeBuildCommand /
# beforeDevCommand work regardless of the cwd the tauri-cli picks.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$HERE/../../../ui"
exec npm --prefix "$UI_DIR" run "$@"
