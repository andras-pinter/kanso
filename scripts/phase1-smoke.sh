#!/usr/bin/env bash
# phase1-smoke.sh — exercise every Phase 1 REST endpoint against a running kanso.
#
# Usage:
#   KANSO_PORT=$(cat "$HOME/Library/Application Support/com.kanso.app/port") \
#     scripts/phase1-smoke.sh
#
# Or pass the port explicitly:
#   KANSO_PORT=53219 scripts/phase1-smoke.sh

set -euo pipefail

PORT="${KANSO_PORT:?set KANSO_PORT (read it from the port token written by the app)}"
BASE="http://127.0.0.1:${PORT}"

c() { curl -sS -o /tmp/kanso-smoke.body -w "%{http_code}" "$@"; }
expect() {
  local code="$1" want="$2" label="$3"
  if [[ "$code" != "$want" ]]; then
    echo "FAIL $label: expected $want got $code" >&2
    cat /tmp/kanso-smoke.body >&2
    echo >&2
    exit 1
  fi
  printf '  %s -> %s\n' "$label" "$code"
}

echo "==> healthz"
expect "$(c "$BASE/healthz")" 200 "GET /healthz"

echo "==> boards"
expect "$(c "$BASE/boards")" 200 "GET /boards"
expect "$(c -XPOST "$BASE/boards" -H 'content-type: application/json' -d '{"name":"Smoke Board"}')" 201 "POST /boards"
BOARD_ID=$(python3 -c 'import json;print(json.load(open("/tmp/kanso-smoke.body"))["id"])')
expect "$(c -XPATCH "$BASE/boards/${BOARD_ID}" -H 'content-type: application/json' -d '{"name":"Smoke Board v2"}')" 200 "PATCH /boards/:id"
expect "$(c -XPOST "$BASE/boards/${BOARD_ID}/archive")" 200 "POST /boards/:id/archive"
expect "$(c -XPOST "$BASE/boards/${BOARD_ID}/unarchive")" 200 "POST /boards/:id/unarchive"

echo "==> columns"
expect "$(c "$BASE/boards/${BOARD_ID}/columns")" 200 "GET /boards/:id/columns"
expect "$(c -XPOST "$BASE/boards/${BOARD_ID}/columns" -H 'content-type: application/json' -d '{"name":"Smoke Col","color":"#888"}')" 201 "POST /boards/:id/columns"
COLUMN_ID=$(python3 -c 'import json;print(json.load(open("/tmp/kanso-smoke.body"))["id"])')
expect "$(c -XPATCH "$BASE/columns/${COLUMN_ID}" -H 'content-type: application/json' -d '{"color":null}')" 200 "PATCH /columns/:id (clear color)"
expect "$(c -XPOST "$BASE/columns/${COLUMN_ID}/archive")" 200 "POST /columns/:id/archive"
expect "$(c -XPOST "$BASE/columns/${COLUMN_ID}/unarchive")" 200 "POST /columns/:id/unarchive"

echo "==> a second column for move"
expect "$(c -XPOST "$BASE/boards/${BOARD_ID}/columns" -H 'content-type: application/json' -d '{"name":"Other","color":null}')" 201 "POST second column"
COLUMN_B=$(python3 -c 'import json;print(json.load(open("/tmp/kanso-smoke.body"))["id"])')

echo "==> cards"
expect "$(c "$BASE/columns/${COLUMN_ID}/cards")" 200 "GET /columns/:id/cards"
expect "$(c -XPOST "$BASE/columns/${COLUMN_ID}/cards" -H 'content-type: application/json' -d '{"title":"Smoke Card"}')" 201 "POST /columns/:id/cards"
CARD_ID=$(python3 -c 'import json;print(json.load(open("/tmp/kanso-smoke.body"))["id"])')
expect "$(c -XPATCH "$BASE/cards/${CARD_ID}" -H 'content-type: application/json' -d '{"title":"Smoke Card v2","due_at":1700000000000}')" 200 "PATCH /cards/:id (set due_at)"
expect "$(c -XPATCH "$BASE/cards/${CARD_ID}" -H 'content-type: application/json' -d '{"due_at":null}')" 200 "PATCH /cards/:id (clear due_at)"
expect "$(c -XPOST "$BASE/cards/${CARD_ID}/move" -H 'content-type: application/json' -d "{\"target_column_id\":\"${COLUMN_B}\"}")" 200 "POST /cards/:id/move (append)"
expect "$(c -XPOST "$BASE/cards/${CARD_ID}/archive")" 200 "POST /cards/:id/archive"
expect "$(c -XPOST "$BASE/cards/${CARD_ID}/unarchive")" 200 "POST /cards/:id/unarchive"

echo "==> negative cases"
expect "$(c -XPOST "$BASE/columns/${COLUMN_ID}/cards" -H 'content-type: application/json' -d '{"title":"  "}')" 400 "blank title -> 400"
expect "$(c "$BASE/boards/${BOARD_ID}/columns")" 200 "GET columns for board (sanity)"

echo "==> cascade delete"
expect "$(c -XDELETE "$BASE/boards/${BOARD_ID}")" 204 "DELETE /boards/:id"
# After cascade delete, listing the board's columns returns an empty array
# (the parent existence isn't re-verified by the list handler — cards/columns
# rows are gone via ON DELETE CASCADE, so the listing is correctly empty).
expect "$(c "$BASE/boards/${BOARD_ID}/columns")" 200 "GET columns for deleted board -> 200 []"
if [[ "$(cat /tmp/kanso-smoke.body)" != "[]" ]]; then
  echo "FAIL cascade: expected [] got $(cat /tmp/kanso-smoke.body)" >&2
  exit 1
fi
echo "  cascade verified: columns wiped"

echo "OK — all Phase 1 endpoints exercised."
