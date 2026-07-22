# Agent Surface Inventory (Phase 4a + 4b)

Read-only snapshot of every user-observable operation exposed by kanso, mapped
across its four surfaces:

- **HTTP** — `kanso-api` axum router (loopback, bearer-auth).
- **Tauri** — `kanso-tauri` `#[tauri::command]` handlers used by the React UI.
- **CLI** — `extensions/kanso/extension.mjs` tools registered with the
  Copilot CLI `joinSession` API.
- **MCP** — `extensions/kanso-mcp/lib/server.mjs` `registerTool` /
  `registerResource` calls.

Empty cells are rendered as `—` so gaps are visible. Phase 4b closed all
surface gaps flagged in the 4a inventory except where marked `(HTTP N/A)`.

## Inventory table

| Concern                        | HTTP route (kanso-api)                          | Tauri command (kanso-tauri)          | CLI tool (extensions/kanso)                | MCP tool / resource (extensions/kanso-mcp) | Return shape                                                 | Notes |
|--------------------------------|-------------------------------------------------|--------------------------------------|--------------------------------------------|--------------------------------------------|--------------------------------------------------------------|-------|
| Health check                   | `GET /healthz`                                  | —                                    | —                                          | —                                          | `"ok"` (text/plain)                                          | Only unauthenticated route. |
| List boards                    | `GET /boards`                                   | `boards_list`                        | `kanso_list` (no args); `board_list`       | `kanso_list` (no args); `board_list`; resource `kanso://boards` | `Vec<BoardDto>`                                              | CLI/MCP flatten legacy tool; typed `board_list` returns JSON DTO. |
| Get board                      | `GET /boards/:id`                               | —                                    | `board_get`                                | `board_get`; resource `kanso://boards/{id}` | `BoardDto`                                                   | No dedicated Tauri command; UI uses `_full`. |
| Get board (full snapshot)      | `GET /boards/:id/_full?include_archived`        | —                                    | —                                          | resource `kanso://boards/{id}`             | `BoardFullDto` (board + tags + columns + cards + tag_ids)    | Returns 409 for >1000 cards. |
| Create board                   | `POST /boards`                                  | `board_create`                       | `board_create`                             | `board_create`                             | `201 BoardDto`                                               | Body: `{name}`. |
| Update board                   | `PATCH /boards/:id`                             | `board_update`                       | `board_update`                             | `board_update`                             | `BoardDto`                                                   | Patch fields: `name`, `color` (nullable via double-option). |
| Archive board                  | `POST /boards/:id/archive`                      | `board_archive`                      | `board_archive`                            | `board_archive`                            | `BoardDto`                                                   | Returns updated board with new `archived_at`/`updated_at` (Phase 4b). |
| Unarchive board                | `POST /boards/:id/unarchive`                    | `board_unarchive`                    | `board_unarchive`                          | `board_unarchive`                          | `BoardDto`                                                   | Returns updated board (Phase 4b). |
| Hard-delete board              | `DELETE /boards/:id`                            | `board_delete`                       | `board_delete`                             | `board_delete`                             | `204 No Content`                                             | Nothing to observe post-delete. |
| List card→tag links for board  | `GET /boards/:id/card_tags`                     | `board_card_tags_list`               | `board_card_tags`                          | `board_card_tags`                          | `Vec<CardTagLinkDto>` `{card_id, tag_id}`                    | Used by UI for tag chips per card. |
| List columns on a board        | `GET /boards/:board_id/columns`                 | `columns_list`                       | `kanso_list` (`board_id`); `column_list`   | `kanso_list` (`board_id`); `column_list`   | `Vec<ColumnDto>`                                             | Typed `column_list` returns JSON DTO array. |
| Get column                     | `GET /columns/:id`                              | —                                    | —                                          | Used internally by MCP `kanso://cards/{id}` (`columnGet`) | `ColumnDto`                                                  | Not exposed as a dedicated tool. |
| Create column                  | `POST /boards/:board_id/columns`                | `column_create`                      | `column_create`                            | `column_create`                            | `201 ColumnDto`                                              | Body: `{name, color?}`. Position is server-assigned; use `column_move` after to reorder. |
| Update column                  | `PATCH /columns/:id`                            | `column_update`                      | `column_update`                            | `column_update`                            | `ColumnDto`                                                  | Patch: `name`, `color` (nullable). |
| Move (reorder) column          | `POST /columns/:id/move`                        | `column_move`                        | `column_move`                              | `column_move`                              | `ColumnDto`                                                  | Body: `{before?, after?}` fractional ranking. |
| Archive column                 | `POST /columns/:id/archive`                     | `column_archive`                     | `column_archive`                           | `column_archive`                           | `ColumnDto`                                                  | Returns updated column (Phase 4b). |
| Unarchive column               | `POST /columns/:id/unarchive`                   | `column_unarchive`                   | `column_unarchive`                         | `column_unarchive`                         | `ColumnDto`                                                  | Returns updated column (Phase 4b). |
| List cards in column           | `GET /columns/:column_id/cards`                 | `cards_list`                         | `kanso_list` (`column_id`); `card_list`    | `kanso_list` (`column_id`); `card_list`    | `Vec<CardDto>`                                               | Typed `card_list` returns JSON DTO array. |
| Get card                       | `GET /cards/:id`                                | —                                    | `card_get`                                 | `card_get`; resource `kanso://cards/{id}` (`cardGet`)  | `CardDto`                                                    | No dedicated Tauri command. |
| Create card                    | `POST /columns/:column_id/cards`                | `card_create`; legacy `create_card`  | `kanso_add`; `card_create`                 | `kanso_add`; `card_create`                 | `201 CardDto`                                                | `kanso_add` optionally patches body_markdown after create; typed `card_create` is title-only. |
| Update card                    | `PATCH /cards/:id`                              | `card_update`                        | `card_update`                              | `card_update`                              | `CardDto`                                                    | Patch: `title`, `body_markdown` (nullable), `due_at` (nullable Unix epoch ms). |
| Move card (cross-column / reorder) | `POST /cards/:id/move`                      | `card_move`                          | `kanso_move` (append only); `card_move` (before/after) | `kanso_move` (append only); `card_move` (before/after) | `CardDto`                                                    | Typed `card_move` supports `before`/`after` for exact placement. |
| Archive card                   | `POST /cards/:id/archive`                       | `card_archive`                       | `kanso_done`; `card_archive`               | `kanso_done`; `card_archive`               | `CardDto`                                                    | Returns updated card with `archived_at` (Phase 4b). |
| Unarchive card                 | `POST /cards/:id/unarchive`                     | `card_unarchive`                     | `card_unarchive`                           | `card_unarchive`                           | `CardDto`                                                    | Returns updated card (Phase 4b). |
| Get card body                  | `GET /cards/:id/body`                           | `card_body_get`                      | `card_body_get`                            | `card_body_get`                            | `CardBodyDto {body_markdown, updated_at}`   | 8 MiB PUT cap on paired setter. |
| Set card body                  | `PUT /cards/:id/body`                           | `card_body_set`                      | `card_body_set`                            | `card_body_set`                            | `CardDto`                                                    | Body: `{body_markdown}` — required. Empty string clears the body to NULL. The same markdown doubles as the FTS payload. |
| Search cards (FTS5)            | `GET /cards/search?q=…&include_archived&limit&offset` | `card_search` (`q`, `limit`, `offset`) | `kanso_search`; `card_search` (`include_archived`, `offset`) | `kanso_search`; `card_search` (`include_archived`, `offset`) | `Vec<CardSearchHitDto>` `{card, column_id, column_name, board_id, board_name}` | Tauri param renamed `query`→`q` and pagination added (Phase 4b); CLI/MCP typed `card_search` forwards all four args. |
| List tags                      | `GET /tags`                                     | `tags_list`                          | `tag_list`                                 | `tag_list`                                 | `Vec<TagDto>`                                                | Typed tool added (Phase 4b). |
| Get tag                        | (HTTP N/A)                                      | `tag_get`                            | `tag_get` (via HTTP `/tags/:id` — Phase 4b adds route implicit) | `tag_get` | `TagDto`                                                     | **HTTP note**: `GET /tags/:id` served by tag handler; extensions call it directly. |
| Create tag                     | `POST /tags`                                    | `tag_create`                         | `tag_create`                               | `tag_create`                               | `201 TagDto`                                                 | Body: `{name, color?}`. |
| Update tag                     | `PATCH /tags/:id`                               | `tag_update`                         | `tag_update`                               | `tag_update`                               | `TagDto`                                                     | Patch: `name`, `color` (nullable). |
| Archive tag                    | `POST /tags/:id/archive`                        | `tag_archive`                        | `tag_archive`                              | `tag_archive`                              | `TagDto`                                                     | Returns updated tag (Phase 4b). |
| Unarchive tag                  | `POST /tags/:id/unarchive`                      | `tag_unarchive`                      | `tag_unarchive`                            | `tag_unarchive`                            | `TagDto`                                                     | Returns updated tag (Phase 4b). |
| Hard-delete tag                | `DELETE /tags/:id`                              | `tag_delete`                         | `tag_delete`                               | `tag_delete`                               | `204 No Content`                                             | Destructive; nothing to observe. |
| List tags on a card            | `GET /cards/:id/tags`                           | `card_tags_list`                     | `card_tags`                                | `card_tags`                                | `Vec<TagDto>`                                                | Typed tool added (Phase 4b). |
| List cards for a tag           | `GET /tags/:id/cards`                           | `tag_cards_list`                     | `tag_cards`                                | `tag_cards`                                | `Vec<CardDto>`                                               | Typed tool added (Phase 4b). |
| Link tag to card               | `POST /cards/:id/tags/:tag_id`                  | `card_tag_add`                       | `card_tag_add`                             | `card_tag_add`                             | `CardDto`                                                    | Returns hydrated card with fresh tag list (Phase 4b). |
| Unlink tag from card           | `DELETE /cards/:id/tags/:tag_id`                | `card_tag_remove`                    | `card_tag_remove`                          | `card_tag_remove`                          | `CardDto`                                                    | Returns hydrated card (Phase 4b). |
| Boards index (agent snapshot)  | —                                               | —                                    | —                                          | resource `kanso://boards`                  | `text/markdown`                                              | Aggregates `/boards` + `/columns` + `/cards`; capped at 500 boards, 1000 cards/board. |
| Card snapshot (agent)          | —                                               | —                                    | —                                          | resource `kanso://cards/{id}`              | `text/markdown`                                              | Best-effort joins card + column + board + tags. |

**Legacy aliases** in Tauri only (marked for retirement per source comment):

| Concern                        | Tauri command | Notes |
|--------------------------------|---------------|-------|
| Create card into seed column   | `create_card(title, column_id?)` | Wraps `card_create`; defaults to `RuntimeState::seed.column_id`. `CardsPanel.tsx` legacy path. |
| List cards in seed column      | `list_cards(column_id?)`         | Wraps `cards_list`; same seed-fallback. |

## Analysis (Phase 4b closures)

Phase 4b closed the surface + return-shape gaps enumerated below. This section
records what changed so future audits can compare against the 4a baseline.

### 1. Return-shape audit — mutations that swallow state

**Closed.** Every mutation an agent needs to observe after calling now returns
the affected resource DTO. The old 200-empty / 204 shapes were replaced with:

| Mutation                                | New shape                          |
|-----------------------------------------|------------------------------------|
| `POST /boards/:id/archive` / unarchive  | `BoardDto`                         |
| `POST /columns/:id/archive` / unarchive | `ColumnDto`                        |
| `POST /cards/:id/archive` / unarchive   | `CardDto`                          |
| `POST /tags/:id/archive` / unarchive    | `TagDto`                           |
| `PUT /cards/:id/body`                   | `CardDto` (body payload is `{body_markdown}`; empty string clears the body) |
| `POST /cards/:id/tags/:tag_id`          | `CardDto` (hydrated tags)          |
| `DELETE /cards/:id/tags/:tag_id`        | `CardDto` (hydrated tags)          |

Hard-delete endpoints (`DELETE /boards/:id`, `DELETE /tags/:id`) remain `204`
— there is nothing to observe post-delete.

Tauri commands mirror the same shift from `()` to the DTO. The shared
`@kanso/client` TypeScript types (`ui/src/kanban/api/client.ts`) were updated
accordingly; UI store call sites already discarded the return so no store
logic changed.

### 2. Surface gaps — extension coverage

**Closed.** CLI (`extensions/kanso/`) and MCP (`extensions/kanso-mcp/`) each
gained a typed CRUD surface covering every reachable HTTP verb:

- Boards: `board_list`, `board_get`, `board_create`, `board_update`,
  `board_archive`, `board_unarchive`, `board_delete`, `board_card_tags`.
- Columns: `column_list`, `column_create`, `column_update`, `column_move`,
  `column_archive`, `column_unarchive`.
- Cards: `card_list`, `card_get`, `card_create`, `card_update`, `card_move`
  (with `before`/`after`), `card_archive`, `card_unarchive`,
  `card_body_get`, `card_body_set`, `card_search` (with `include_archived`
  + `offset`).
- Tags + links: `tag_list`, `tag_get`, `tag_create`, `tag_update`,
  `tag_archive`, `tag_unarchive`, `tag_delete`, `tag_cards`, `card_tags`,
  `card_tag_add`, `card_tag_remove`.

Legacy `kanso_list`, `kanso_add`, `kanso_move`, `kanso_done`, `kanso_search`
tools are kept unchanged for compatibility with existing agent prompts. New
typed tools always return JSON-serialized DTOs so the model can reason over
structured output.

Shared helpers live in `extensions/_shared/kanso-client/crud.mjs` and are
consumed by both extensions. Both extension `package.json` versions bumped
to `0.2.0`.

### 3. Contract mismatches across surfaces

**Closed.** The Tauri `card_search` command was renamed from `query` → `q`
and gained optional `limit` / `offset` parameters, matching HTTP + CLI + MCP.
The UI caller in `ui/src/kanban/api/client.ts` was updated to pass the new
signature. All other surfaces already agreed on `snake_case` field names and
`i64` epoch timestamps.

Non-atomic `kanso_add` body path is retained (create-then-patch) since it is
convenience-only; agents that need atomicity can call `card_create` and
`card_update` directly.

### 4. `tags.color` in extension input schemas

Unchanged from 4a. `tag_create`/`tag_update` in both extensions now accept
`color` as a pass-through to HTTP (Phase 2 keeps the column but the UI does
not surface it). No divergence between surfaces.
