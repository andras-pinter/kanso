# Agent Surface Inventory (Phase 4a)

Read-only snapshot of every user-observable operation exposed by kanso, mapped
across its four surfaces:

- **HTTP** — `kanso-api` axum router (loopback, bearer-auth).
- **Tauri** — `kanso-tauri` `#[tauri::command]` handlers used by the React UI.
- **CLI** — `extensions/kanso/extension.mjs` tools registered with the
  Copilot CLI `joinSession` API.
- **MCP** — `extensions/kanso-mcp/lib/server.mjs` `registerTool` /
  `registerResource` calls.

Empty cells are rendered as `—` so gaps are visible. This document is inventory
only; fixes are Phase 4b.

## Inventory table

| Concern                        | HTTP route (kanso-api)                          | Tauri command (kanso-tauri)          | CLI tool (extensions/kanso)                | MCP tool / resource (extensions/kanso-mcp) | Return shape                                                 | Notes |
|--------------------------------|-------------------------------------------------|--------------------------------------|--------------------------------------------|--------------------------------------------|--------------------------------------------------------------|-------|
| Health check                   | `GET /healthz`                                  | —                                    | —                                          | —                                          | `"ok"` (text/plain)                                          | Only unauthenticated route. |
| List boards                    | `GET /boards`                                   | `boards_list`                        | `kanso_list` (no args)                     | `kanso_list` (no args); resource `kanso://boards` | `Vec<BoardDto>`                                              | CLI/MCP flatten to a bullet list, drop timestamps/color. |
| Get board                      | `GET /boards/:id`                               | —                                    | —                                          | resource `kanso://boards/{id}` (via `boardFull` + fallback `boardGet` in card snapshot) | `BoardDto`                                                   | No dedicated Tauri command; UI uses `_full`. |
| Get board (full snapshot)      | `GET /boards/:id/_full?include_archived`        | —                                    | —                                          | resource `kanso://boards/{id}`             | `BoardFullDto` (board + tags + columns + cards + tag_ids)    | Returns 409 for >1000 cards. |
| Create board                   | `POST /boards`                                  | `board_create`                       | —                                          | —                                          | `201 BoardDto`                                               | Body: `{name}`. |
| Update board                   | `PATCH /boards/:id`                             | `board_update`                       | —                                          | —                                          | `BoardDto`                                                   | Patch fields: `name`, `color` (nullable via double-option). |
| Archive board                  | `POST /boards/:id/archive`                      | `board_archive`                      | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | **No body** — caller cannot see new `archived_at`/`updated_at`. |
| Unarchive board                | `POST /boards/:id/unarchive`                    | `board_unarchive`                    | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | Same 200-no-body pattern. |
| Hard-delete board              | `DELETE /boards/:id`                            | `board_delete`                       | —                                          | —                                          | `204 No Content`                                             | Only surface for destructive delete. |
| List card→tag links for board  | `GET /boards/:id/card_tags`                     | `board_card_tags_list`               | —                                          | —                                          | `Vec<CardTagLinkDto>` `{card_id, tag_id}`                    | Used by UI for tag chips per card. |
| List columns on a board        | `GET /boards/:board_id/columns`                 | `columns_list`                       | `kanso_list` (`board_id`)                  | `kanso_list` (`board_id`)                  | `Vec<ColumnDto>`                                             | CLI/MCP append per-column card count; extra N round-trips. |
| Get column                     | `GET /columns/:id`                              | —                                    | —                                          | Used internally by MCP `kanso://cards/{id}` (`columnGet`) | `ColumnDto`                                                  | Not exposed as a Tauri command or user-visible tool. |
| Create column                  | `POST /boards/:board_id/columns`                | `column_create`                      | —                                          | —                                          | `201 ColumnDto`                                              | Body: `{name, color?}`. |
| Update column                  | `PATCH /columns/:id`                            | `column_update`                      | —                                          | —                                          | `ColumnDto`                                                  | Patch: `name`, `color` (nullable). |
| Move (reorder) column          | `POST /columns/:id/move`                        | `column_move`                        | —                                          | —                                          | `ColumnDto`                                                  | Body: `{before?, after?}` fractional ranking. |
| Archive column                 | `POST /columns/:id/archive`                     | `column_archive`                     | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | 200-no-body. |
| Unarchive column               | `POST /columns/:id/unarchive`                   | `column_unarchive`                   | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | 200-no-body. |
| List cards in column           | `GET /columns/:column_id/cards`                 | `cards_list`                         | `kanso_list` (`column_id`)                 | `kanso_list` (`column_id`)                 | `Vec<CardDto>`                                               | CLI/MCP show `id title [archived] body_preview`. |
| Get card                       | `GET /cards/:id`                                | —                                    | —                                          | resource `kanso://cards/{id}` (`cardGet`)  | `CardDto`                                                    | No dedicated Tauri command. |
| Create card                    | `POST /columns/:column_id/cards`                | `card_create`; legacy `create_card`  | `kanso_add`                                | `kanso_add`                                | `201 CardDto`                                                | CLI/MCP `kanso_add` optionally follows with PATCH `body_text`; not atomic. |
| Update card                    | `PATCH /cards/:id`                              | `card_update`                        | (implicit via `kanso_add` body path)       | (implicit via `kanso_add` body path)       | `CardDto`                                                    | Patch: `title`, `body_text` (nullable), `due_at` (nullable). |
| Move card (cross-column / reorder) | `POST /cards/:id/move`                      | `card_move`                          | `kanso_move` (append only)                 | `kanso_move` (append only)                 | `CardDto`                                                    | Body: `{target_column_id, before?, after?}`. CLI/MCP omit before/after so cards always land at the end. |
| Archive card                   | `POST /cards/:id/archive`                       | `card_archive`                       | `kanso_done`                               | `kanso_done`                               | HTTP `200` empty; Tauri `()`; CLI/MCP return string          | 200-no-body; agent can’t confirm new `archived_at`. |
| Unarchive card                 | `POST /cards/:id/unarchive`                     | `card_unarchive`                     | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | Not reachable from agent surfaces. |
| Get card body (BlockSuite)     | `GET /cards/:id/body`                           | `card_body_get`                      | —                                          | —                                          | `CardBodyDto {body_blocksuite_b64, body_text, updated_at}`   | 8 MiB PUT cap on paired setter. |
| Set card body                  | `PUT /cards/:id/body`                           | `card_body_set`                      | —                                          | —                                          | HTTP `204`; Tauri `()`                                       | No body — no `updated_at` returned. |
| Search cards (FTS5)            | `GET /cards/search?q=…&include_archived&limit&offset` | `card_search`                  | `kanso_search`                             | `kanso_search`                             | `Vec<CardSearchHitDto>` `{card, column_id, column_name, board_id, board_name}` | Tauri arg is `query`; HTTP/CLI/MCP arg is `q` — **naming divergence**. |
| List tags                      | `GET /tags`                                     | `tags_list`                          | —                                          | —                                          | `Vec<TagDto>`                                                | No agent surface. |
| Get tag                        | (none)                                          | `tag_get`                            | —                                          | —                                          | `TagDto`                                                     | **HTTP gap** — no `GET /tags/:id`. |
| Create tag                     | `POST /tags`                                    | `tag_create`                         | —                                          | —                                          | `201 TagDto`                                                 | Body: `{name, color?}`. |
| Update tag                     | `PATCH /tags/:id`                               | `tag_update`                         | —                                          | —                                          | `TagDto`                                                     | Patch: `name`, `color` (nullable). |
| Archive tag                    | `POST /tags/:id/archive`                        | `tag_archive`                        | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | 200-no-body. |
| Unarchive tag                  | `POST /tags/:id/unarchive`                      | `tag_unarchive`                      | —                                          | —                                          | HTTP `200` empty; Tauri `()`                                 | 200-no-body. |
| Hard-delete tag                | `DELETE /tags/:id`                              | `tag_delete`                         | —                                          | —                                          | `204 No Content`                                             | Destructive. |
| List tags on a card            | `GET /cards/:id/tags`                           | `card_tags_list`                     | —                                          | (internal, used by `kanso://cards/{id}`)   | `Vec<TagDto>`                                                | MCP consumes but doesn’t expose as a tool. |
| List cards for a tag           | `GET /tags/:id/cards`                           | `tag_cards_list`                     | —                                          | —                                          | `Vec<CardDto>`                                               | No agent surface. |
| Link tag to card               | `POST /cards/:id/tags/:tag_id`                  | `card_tag_add`                       | —                                          | —                                          | `204 No Content` / Tauri `()`                                | 204-no-body. |
| Unlink tag from card           | `DELETE /cards/:id/tags/:tag_id`                | `card_tag_remove`                    | —                                          | —                                          | `204 No Content` / Tauri `()`                                | 204-no-body. |
| Boards index (agent snapshot)  | —                                               | —                                    | —                                          | resource `kanso://boards`                  | `text/markdown`                                              | Aggregates `/boards` + `/columns` + `/cards`; capped at 500 boards, 1000 cards/board. |
| Card snapshot (agent)          | —                                               | —                                    | —                                          | resource `kanso://cards/{id}`              | `text/markdown`                                              | Best-effort joins card + column + board + tags. |

**Legacy aliases** in Tauri only (marked for retirement per source comment):

| Concern                        | Tauri command | Notes |
|--------------------------------|---------------|-------|
| Create card into seed column   | `create_card(title, column_id?)` | Wraps `card_create`; defaults to `RuntimeState::seed.column_id`. `CardsPanel.tsx` legacy path. |
| List cards in seed column      | `list_cards(column_id?)`         | Wraps `cards_list`; same seed-fallback. |

## Analysis

### 1. Return-shape audit — mutations that swallow state

Every mutation an agent would want to observe after calling should return the
updated resource. These currently return empty responses (200-no-body or 204):

| Mutation                                | Surface           | What agent loses |
|-----------------------------------------|-------------------|------------------|
| `POST /boards/:id/archive` / unarchive  | HTTP + Tauri      | new `archived_at`, `updated_at` |
| `POST /columns/:id/archive` / unarchive | HTTP + Tauri      | same |
| `POST /cards/:id/archive` / unarchive   | HTTP + Tauri + CLI (`kanso_done`) + MCP | same — `kanso_done` currently returns a hand-rolled `"kanso: archived card <id>"` string with no state |
| `POST /tags/:id/archive` / unarchive    | HTTP + Tauri      | same |
| `DELETE /boards/:id`                    | HTTP + Tauri      | 204, no confirmation payload |
| `DELETE /tags/:id`                      | HTTP + Tauri      | 204, no confirmation payload |
| `PUT /cards/:id/body`                   | HTTP + Tauri      | new `updated_at` — forces a follow-up `GET /cards/:id/body` to know the write timestamp |
| `POST /cards/:id/tags/:tag_id`          | HTTP + Tauri      | no card/tag state, no timestamp |
| `DELETE /cards/:id/tags/:tag_id`        | HTTP + Tauri      | same |

Mutations that _do_ return the resource (good, keep as-is): create board /
column / card / tag, update (PATCH) of same, `POST /columns/:id/move`,
`POST /cards/:id/move`.

### 2. Surface gaps — where agents cannot reach

CLI + MCP tool surface is confined to five verbs (`kanso_list`, `kanso_add`,
`kanso_move`, `kanso_done`, `kanso_search`). Everything else in the HTTP/Tauri
plane is invisible to agents:

- **Board CRUD** — create, update (rename, recolor), archive, unarchive,
  delete. Agents cannot manage boards at all.
- **Column CRUD** — create, update, move (reorder), archive, unarchive.
  `kanso_list` reads them but nothing writes.
- **Card update** — `PATCH /cards/:id` (title, body_text, due date). CLI/MCP
  only mutate `body_text` implicitly via `kanso_add`. `due_at` is unreachable.
- **Card body (BlockSuite)** — `GET`/`PUT /cards/:id/body` are entirely absent
  from CLI and MCP. Agents can’t read or write the rich body.
- **Card unarchive** — no `kanso_undone`; only archive is exposed.
- **Card reorder within a column** — CLI/MCP `kanso_move` always appends
  (no `before`/`after` args).
- **Tags** — no tool surface at all. Cannot list, create, rename, recolor,
  archive, delete, link, unlink, or query cards-by-tag. MCP consumes
  `/cards/:id/tags` internally to render the card snapshot but does not
  publish it.
- **Search filters** — `include_archived` and `offset` on `/cards/search`
  exist on HTTP; CLI/MCP `kanso_search` only forwards `q` and `limit`.
- **HTTP-only gap**: there is no `GET /tags/:id`; Tauri has `tag_get` but the
  HTTP surface does not (the MCP resource cannot read a single tag over HTTP
  even if it wanted to).

### 3. Contract mismatches across surfaces

- **`card_search` arg name**: HTTP uses `?q=…`; CLI + MCP forward `q`; the
  Tauri command `card_search(query, include_archived?)` renames it to `query`
  and drops pagination (`limit`/`offset` unavailable on the Tauri path). This
  is the only field-name divergence between HTTP and Tauri.
- **Pagination on `card_search`**: HTTP supports `limit`/`offset`; Tauri
  `card_search` omits both. CLI/MCP `kanso_search` supports `limit` (default 20,
  hard cap 50) but not `offset`.
- **CLI/MCP `kanso_move` return shape**: string (`"kanso: moved card <id> to
  column <col>"`) parsed from the underlying `CardDto` — the model does not
  see position/updated_at/tags even though the HTTP call returns them.
- **`kanso_add` optional body path is non-atomic**: on success, if `body` is
  provided the sequence is `POST /columns/:id/cards` then
  `PATCH /cards/:new_id`. A PATCH failure strands a titled, empty-body card.
  No API surface merges them.
- **Timestamps**: uniformly `i64` epoch (`created_at`, `updated_at`,
  `archived_at`, `due_at`, `CardBodyDto.updated_at`) across HTTP and Tauri.
  Nothing serializes them as strings — consistent.
- **Field naming**: snake_case in HTTP JSON and Tauri command arguments; no
  camelCase surfaces detected. `card_id`, `tag_id`, `column_id`, `board_id`,
  `target_column_id` are consistent everywhere.
- **`board_full`**: only reachable as `GET /boards/:id/_full`; there is no
  Tauri command wrapping it (the React UI uses individual endpoints). MCP is
  the only consumer of `boardFull` today.

### 4. `tags.color` in extension input schemas

Neither the CLI (`extensions/kanso/extension.mjs`) nor the MCP server
(`extensions/kanso-mcp/lib/server.mjs`) exposes any tag mutation tool. There
is no `create_tag` / `update_tag` / `tag_add` in either extension, and the
five registered tools (`kanso_list`, `kanso_add`, `kanso_move`, `kanso_done`,
`kanso_search`) do not accept a `color` argument. Consequence: **Phase 2’s
UI-side removal of tag color has no follow-up needed in either extension** —
the extensions never surfaced a tag-color input to begin with.

`color` remains present in the HTTP wire types (`CreateTagBody`, `TagPatchDto`,
`TagDto`) and their Tauri mirrors (`tag_create(body: CreateTagBody)`,
`tag_update(patch: TagPatchDto)`). That matches the Phase 2 note that the
`tags.color` column is retained but the UI ignores it. No divergence between
surfaces to flag.
