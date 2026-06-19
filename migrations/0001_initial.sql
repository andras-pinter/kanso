-- kanso v1 schema
-- ULIDs stored as TEXT, timestamps as INTEGER unix-millis,
-- positions as TEXT for fractional indexing (lexicographic sort).

CREATE TABLE boards (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    position    TEXT NOT NULL,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE TABLE columns (
    id          TEXT PRIMARY KEY,
    board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    TEXT NOT NULL,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE TABLE cards (
    id              TEXT PRIMARY KEY,
    column_id       TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    body_blocksuite BLOB,
    body_text       TEXT,
    position        TEXT NOT NULL,
    due_at          INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    archived_at     INTEGER
);

CREATE TABLE tags (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE TABLE card_tags (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, tag_id)
);

CREATE INDEX idx_columns_board_id    ON columns(board_id);
CREATE INDEX idx_cards_column_id     ON cards(column_id);
CREATE INDEX idx_card_tags_tag_id    ON card_tags(tag_id);
CREATE INDEX idx_boards_archived_at  ON boards(archived_at);
CREATE INDEX idx_columns_archived_at ON columns(archived_at);
CREATE INDEX idx_cards_archived_at   ON cards(archived_at);
CREATE INDEX idx_tags_archived_at    ON tags(archived_at);

-- FTS5 over cards (title + body_text), external content table.
CREATE VIRTUAL TABLE cards_fts USING fts5(
    title,
    body_text,
    content='cards',
    content_rowid='rowid',
    tokenize='unicode61'
);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, title, body_text)
    VALUES (new.rowid, new.title, new.body_text);
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, title, body_text)
    VALUES ('delete', old.rowid, old.title, old.body_text);
END;

CREATE TRIGGER cards_fts_au AFTER UPDATE OF title, body_text ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, title, body_text)
    VALUES ('delete', old.rowid, old.title, old.body_text);
    INSERT INTO cards_fts(rowid, title, body_text)
    VALUES (new.rowid, new.title, new.body_text);
END;

-- updated_at triggers: bump to current unix-millis whenever a row is updated
-- without the caller having already changed updated_at themselves.
CREATE TRIGGER boards_updated_at AFTER UPDATE ON boards
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN
    UPDATE boards SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    WHERE id = NEW.id;
END;

CREATE TRIGGER columns_updated_at AFTER UPDATE ON columns
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN
    UPDATE columns SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    WHERE id = NEW.id;
END;

CREATE TRIGGER cards_updated_at AFTER UPDATE ON cards
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN
    UPDATE cards SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    WHERE id = NEW.id;
END;

CREATE TRIGGER tags_updated_at AFTER UPDATE ON tags
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN
    UPDATE tags SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    WHERE id = NEW.id;
END;
