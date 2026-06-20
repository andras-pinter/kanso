// Mirrors crates/kanso-api/src/dto.rs. Keep in lockstep with the backend.

export interface BoardDto {
  id: string;
  name: string;
  position: string;
  color: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface ColumnDto {
  id: string;
  board_id: string;
  name: string;
  position: string;
  color: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface CardDto {
  id: string;
  column_id: string;
  title: string;
  body_text: string | null;
  position: string;
  due_at: number | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface CardBody {
  body_blocksuite_b64: string | null;
  body_text: string | null;
  updated_at: number;
}

export interface CardBodySet {
  body_blocksuite_b64: string;
  body_text: string;
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
  body_text?: string | null;
  due_at?: number | null;
}

export interface ColumnPatch {
  name?: string;
  color?: string | null;
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
  archived_at: number | null;
}

export interface TagPatch {
  name?: string;
  color?: string | null;
}

export interface ColumnMoveArgs {
  before?: string;
  after?: string;
}

export interface AppError {
  kind: string;
  message: string;
}
