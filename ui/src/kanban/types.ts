// Mirrors crates/kanso-api/src/dto.rs. Keep in lockstep with the backend.

export interface BoardDto {
  id: string;
  name: string;
  position: string;
  color: string | null;
  created_at: number;
  updated_at: number;
}

export interface ColumnDto {
  id: string;
  board_id: string;
  name: string;
  position: string;
  color: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Full card wire shape. Only the dedicated single-card endpoint
 * (`GET /cards/:id`) returns this — every list / board / search / write
 * response uses [`CardListDto`] to keep payloads bounded regardless of
 * body size. Fetch the markdown via `cardBodyGet` when needed.
 */
export interface CardDto {
  id: string;
  column_id: string;
  title: string;
  body_markdown: string | null;
  position: string;
  due_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Card metadata without the markdown body. `has_body` is `true` when the
 * card has a non-blank body (whitespace-only counts as empty). Used by all
 * list/board/search endpoints and every write endpoint (create/update/move/
 * set_body responses).
 */
export interface CardListDto {
  id: string;
  column_id: string;
  title: string;
  has_body: boolean;
  position: string;
  due_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CardBody {
  body_markdown: string | null;
  updated_at: number;
}

export interface CardBodySet {
  body_markdown: string;
}

export interface SeedIds {
  board_id: string;
  column_id: string;
}

// Patch DTO conventions (matches `Option<Option<T>>` on the Rust side):
//   field omitted     -> leave untouched
//   field = null      -> clear
//   field = value     -> set
export interface CardPatch {
  title?: string;
  body_markdown?: string | null;
  due_at?: number | null;
}

export interface BoardPatch {
  name?: string;
  color?: string | null;
}

export interface TagDto {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
  updated_at: number;
}

export interface TagPatch {
  name?: string;
  color?: string | null;
}

export interface CardSearchHitDto {
  card: CardListDto;
  column_id: string;
  column_name: string;
  board_id: string;
  board_name: string;
}

export interface AppError {
  kind: string;
  message: string;
}

export interface SnapshotCardDto {
  id: string;
  column_id: string;
  title: string;
  body_markdown: string | null;
  position: string;
  due_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CardTagLinkDto {
  card_id: string;
  tag_id: string;
}

export interface SnapshotDataDto {
  boards: BoardDto[];
  columns: ColumnDto[];
  cards: SnapshotCardDto[];
  tags: TagDto[];
  card_tags: CardTagLinkDto[];
}

export interface SnapshotEnvelopeDto {
  schema_version: 1;
  exported_at: string;
  data: SnapshotDataDto;
}
