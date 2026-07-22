-- kanso v2 body-column reshuffle for the BlockSuite → TipTap migration.
-- - `body_text` renamed to `body_markdown` (single column doubles as storage
--   and FTS payload; markdown is human-readable enough that FTS5's unicode61
--   tokenizer strips `#`, `-`, `*`, `` ` `` as non-word chars anyway).
-- - `body_blocksuite` blob is gone; no more Yjs on disk.
-- - `cards_fts` is dropped and re-created because SQLite cannot rename a
--   content column of an FTS5 external-content table in place; the triggers
--   are re-created for the same reason.
-- No data backfill: dev DB gets reset as part of this migration.

DROP TRIGGER IF EXISTS cards_fts_au;
DROP TRIGGER IF EXISTS cards_fts_ad;
DROP TRIGGER IF EXISTS cards_fts_ai;
DROP TABLE IF EXISTS cards_fts;

ALTER TABLE cards DROP COLUMN body_blocksuite;
ALTER TABLE cards RENAME COLUMN body_text TO body_markdown;

CREATE VIRTUAL TABLE cards_fts USING fts5(
    title,
    body_markdown,
    content='cards',
    content_rowid='rowid',
    tokenize='unicode61'
);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, title, body_markdown)
    VALUES (new.rowid, new.title, new.body_markdown);
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, title, body_markdown)
    VALUES ('delete', old.rowid, old.title, old.body_markdown);
END;

CREATE TRIGGER cards_fts_au AFTER UPDATE OF title, body_markdown ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, title, body_markdown)
    VALUES ('delete', old.rowid, old.title, old.body_markdown);
    INSERT INTO cards_fts(rowid, title, body_markdown)
    VALUES (new.rowid, new.title, new.body_markdown);
END;
