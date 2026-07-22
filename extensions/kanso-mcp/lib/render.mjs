/**
 * Pure markdown renderers for kanso MCP resources. Kept separate from the
 * server wiring so they're trivially unit-testable.
 *
 * Body excerpts are extracted from the card's `body_markdown` field and
 * capped at 500 chars after whitespace collapse.
 */

const EXCERPT_MAX_CHARS = 500;

/**
 * @typedef {Object} BoardListEntry
 * @property {string} id
 * @property {string} name
 * @property {number} [archived_at]
 */

/**
 * @typedef {Object} BoardListEntryEnriched
 * @property {string} id
 * @property {string} name
 * @property {number | string} columns
 * @property {number | string} cards
 * @property {boolean} [truncated]
 */

/**
 * Boards index. The caller fetches `/boards` and (optionally) per-board
 * column/card counts; we just format whatever shape they provide. Counts
 * are rendered as-is (numbers or the `?` placeholder when enrichment failed).
 *
 * @param {{ boards: BoardListEntryEnriched[], truncated?: boolean }} dto
 * @returns {string}
 */
export const renderBoardsIndex = ({ boards, truncated = false }) => {
    const lines = ["# Kanso boards", ""];
    if (boards.length === 0) {
        lines.push("_No boards._");
        return lines.join("\n");
    }
    lines.push("| id | name | columns | cards |", "|----|------|---------|-------|");
    for (const b of boards) {
        const name = String(b.name).replace(/\|/g, "\\|");
        lines.push(`| ${b.id} | ${name} | ${b.columns} | ${b.cards} |`);
    }
    if (truncated) {
        lines.push("", "_500+ boards; showing first 500._");
    }
    return lines.join("\n");
};

/**
 * Single board snapshot. Input is the `BoardFullDto` straight off the wire.
 * Tags listed at the top dedupe to those actually referenced by at least
 * one card.
 *
 * @param {any} dto BoardFullDto
 * @returns {string}
 */
export const renderBoardSnapshot = (dto) => {
    const board = dto.board ?? {};
    const tags = Array.isArray(dto.tags) ? dto.tags : [];
    const columns = Array.isArray(dto.columns) ? dto.columns : [];
    const tagById = new Map(tags.map((t) => [t.id, t]));

    const lines = [`# Board: ${board.name ?? "(unnamed)"}`];

    if (tags.length > 0) {
        const names = tags.map((t) => `\`${t.name}\``).join(", ");
        lines.push("", `Tags: ${names}`);
    }

    if (columns.length === 0) {
        lines.push("", "_No columns._");
        return lines.join("\n");
    }

    for (const col of columns) {
        const colMeta = col.column ?? {};
        const cards = Array.isArray(col.cards) ? col.cards : [];
        lines.push("", `## ${colMeta.name ?? "(unnamed column)"} (${cards.length} card${cards.length === 1 ? "" : "s"})`);
        if (cards.length === 0) {
            lines.push("_(empty)_");
            continue;
        }
        for (const cwt of cards) {
            lines.push(renderCardLine(cwt.card ?? {}, cwt.tag_ids ?? [], tagById));
        }
    }

    return lines.join("\n");
};

/**
 * @param {any} card CardDto
 * @param {string[]} tagIds
 * @param {Map<string, { name: string }>} tagById
 * @returns {string}
 */
const renderCardLine = (card, tagIds, tagById) => {
    const title = card.title ?? "(untitled)";
    const tagPart =
        tagIds.length > 0
            ? " " +
              tagIds
                  .map((id) => tagById.get(id))
                  .filter(Boolean)
                  .map((t) => `[#${t.name}]`)
                  .join(" ")
            : "";
    const duePart = formatDue(card.due_at);
    const notesPart = card.has_body ? " _(has notes)_" : "";
    return `- **${title}**${tagPart}${duePart}${notesPart}`;
};

/**
 * Render a single CardDto (the `cards/{id}` resource).
 *
 * @param {{ card: any, column?: any, board?: any, tags?: any[] }} args
 * @returns {string}
 */
export const renderCard = ({ card, column, board, tags = [] }) => {
    const lines = [`# Card: ${card.title ?? "(untitled)"}`];

    const meta = [];
    if (board?.name) meta.push(`Board: **${board.name}**`);
    if (column?.name) meta.push(`Column: **${column.name}**`);
    else if (card.column_id) meta.push(`Column id: \`${card.column_id}\``);
    if (card.due_at !== null && card.due_at !== undefined) {
        meta.push(`Due: ${formatIsoFromMs(card.due_at)}`);
    }
    if (meta.length > 0) {
        lines.push("", meta.join("  ·  "));
    }

    if (tags.length > 0) {
        lines.push("", `Tags: ${tags.map((t) => `\`${t.name}\``).join(", ")}`);
    }

    lines.push("", "## Body");
    const excerpt = excerptFromBodyMarkdown(card.body_markdown);
    if (excerpt) {
        lines.push(excerpt);
    } else {
        lines.push("_(empty)_");
    }
    return lines.join("\n");
};

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
const formatDue = (ms) => {
    if (ms === null || ms === undefined) return "";
    return ` — due ${formatIsoFromMs(ms)}`;
};

/**
 * Format an epoch-ms timestamp as YYYY-MM-DD (UTC). The desktop app stores
 * `due_at` as epoch ms; we render UTC date-only so the snapshot doesn't drift
 * across host timezones.
 *
 * @param {number} ms
 * @returns {string}
 */
const formatIsoFromMs = (ms) => {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return String(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

/**
 * Take a `body_markdown` string and return a normalized excerpt suitable for
 * a card list row. Markdown punctuation is left intact — the excerpt is meant
 * for human reading, not FTS.
 *
 * @param {string | null | undefined} md
 * @returns {string}
 */
const excerptFromBodyMarkdown = (md) => {
    if (typeof md !== "string") return "";
    const trimmed = md.replace(/\s+/g, " ").trim();
    if (trimmed === "") return "";
    if (trimmed.length <= EXCERPT_MAX_CHARS) return trimmed;
    return trimmed.slice(0, EXCERPT_MAX_CHARS - 1) + "…";
};

/**
 * Exported for testing.
 * @internal
 */
export const _EXCERPT_MAX_CHARS = EXCERPT_MAX_CHARS;

/**
 * Exported for tests that want to exercise the excerpt helper directly.
 * @internal
 */
export const _excerptFromBodyMarkdown = excerptFromBodyMarkdown;
