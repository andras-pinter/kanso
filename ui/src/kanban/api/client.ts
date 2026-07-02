// Typed wrapper around Tauri `invoke`. One function per backend command,
// arg names verbatim — the wave brief calls these out as a contract.

import { invoke } from '@tauri-apps/api/core';
import type {
  BoardDto,
  BoardPatch,
  CardBody,
  CardBodySet,
  CardDto,
  CardPatch,
  CardSearchHitDto,
  ColumnDto,
  ColumnMoveArgs,
  ColumnPatch,
  SeedIds,
  SnapshotEnvelopeDto,
  TagDto,
  TagPatch,
} from '../types';

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface CliExtStatus {
  show_consent: boolean;
  bundled_version: string;
  cli_installed_version: string | null;
  consent: boolean;
  dismissed: boolean;
}

export interface HostInfo {
  id: string;
  name: string;
  detected: boolean;
  config_dir: string;
  config_file_hint: string | null;
}

let invoker: InvokeFn = invoke;

// Test-only seam: lets vitest swap the underlying transport without
// running inside a Tauri shell.
export function __setInvoker(fn: InvokeFn): void {
  invoker = fn;
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ---------- meta ----------

export const defaultColumn = (): Promise<SeedIds> => invoker('default_column');

export const cliExtStatus = (): Promise<CliExtStatus> => invoker('cli_ext_status');

export const cliExtSetConsent = (install: boolean): Promise<CliExtStatus> =>
  invoker('cli_ext_set_consent', { install });

export const mcpHostDetect = (): Promise<HostInfo[]> => invoker('mcp_host_detect');

export const mcpServerPath = (): Promise<string | null> => invoker('mcp_server_path');

export const revealInFileManager = (path: string): Promise<void> =>
  invoker('reveal_in_file_manager', { path });

export const exportData = (): Promise<SnapshotEnvelopeDto> => invoker('export_data');

export const importData = (jsonString: string): Promise<void> =>
  invoker('import_data', { jsonString });

export const writeExportFile = (path: string, jsonString: string): Promise<void> =>
  invoker('write_export_file', { path, jsonString });

export const readImportFile = (path: string): Promise<string> =>
  invoker('read_import_file', { path });

// ---------- boards ----------

export const boardsList = (includeArchived = false): Promise<BoardDto[]> =>
  invoker('boards_list', { includeArchived });

export const boardCreate = (name: string): Promise<BoardDto> => invoker('board_create', { name });

export const boardUpdate = (id: string, patch: BoardPatch): Promise<BoardDto> =>
  invoker('board_update', { id, patch });

export const boardArchive = (id: string): Promise<BoardDto> => invoker('board_archive', { id });

export const boardUnarchive = (id: string): Promise<BoardDto> =>
  invoker('board_unarchive', { id });

export const boardDelete = (id: string): Promise<void> => invoker('board_delete', { id });

// ---------- columns ----------

export const columnsList = (boardId: string, includeArchived = false): Promise<ColumnDto[]> =>
  invoker('columns_list', { boardId, includeArchived });

export const columnCreate = (boardId: string, name: string, color?: string): Promise<ColumnDto> =>
  invoker('column_create', { boardId, name, color });

export const columnUpdate = (id: string, patch: ColumnPatch): Promise<ColumnDto> =>
  invoker('column_update', { id, patch });

export const columnArchive = (id: string): Promise<ColumnDto> =>
  invoker('column_archive', { id });

export const columnUnarchive = (id: string): Promise<ColumnDto> =>
  invoker('column_unarchive', { id });

export const columnMove = (id: string, args: ColumnMoveArgs = {}): Promise<ColumnDto> =>
  invoker('column_move', { id, before: args.before, after: args.after });

// ---------- tags ----------

export const tagsList = (includeArchived = false): Promise<TagDto[]> =>
  invoker('tags_list', { includeArchived });

export const tagGet = (id: string): Promise<TagDto> => invoker('tag_get', { id });

export const tagCreate = (name: string, color?: string): Promise<TagDto> =>
  invoker('tag_create', { body: { name, color } });

export const tagUpdate = (id: string, patch: TagPatch): Promise<TagDto> =>
  invoker('tag_update', { id, patch });

export const tagArchive = (id: string): Promise<TagDto> => invoker('tag_archive', { id });

export const tagUnarchive = (id: string): Promise<TagDto> => invoker('tag_unarchive', { id });

export const tagDelete = (id: string): Promise<void> => invoker('tag_delete', { id });

export const tagCardsList = (tagId: string, includeArchived = false): Promise<CardDto[]> =>
  invoker('tag_cards_list', { tagId, includeArchived });

export const cardTagsList = (cardId: string, includeArchived = false): Promise<TagDto[]> =>
  invoker('card_tags_list', { cardId, includeArchived });

export const cardTagAdd = (cardId: string, tagId: string): Promise<CardDto> =>
  invoker('card_tag_add', { cardId, tagId });

export const cardTagRemove = (cardId: string, tagId: string): Promise<CardDto> =>
  invoker('card_tag_remove', { cardId, tagId });

export const boardCardTagsList = (
  boardId: string
): Promise<{ card_id: string; tag_id: string }[]> => invoker('board_card_tags_list', { boardId });

// ---------- cards ----------

export const cardsList = (columnId: string, includeArchived = false): Promise<CardDto[]> =>
  invoker('cards_list', { columnId, includeArchived });

export const cardCreate = (columnId: string, title: string): Promise<CardDto> =>
  invoker('card_create', { columnId, title });

export const cardUpdate = (id: string, patch: CardPatch): Promise<CardDto> =>
  invoker('card_update', { id, patch });

export interface CardMoveArgs {
  targetColumnId: string;
  before?: string;
  after?: string;
}

export const cardMove = (id: string, args: CardMoveArgs): Promise<CardDto> =>
  invoker('card_move', {
    id,
    targetColumnId: args.targetColumnId,
    before: args.before,
    after: args.after,
  });

export const cardArchive = (id: string): Promise<CardDto> => invoker('card_archive', { id });

export const cardUnarchive = (id: string): Promise<CardDto> => invoker('card_unarchive', { id });

export const cardBodyGet = (id: string): Promise<CardBody> => invoker('card_body_get', { id });

export const cardBodySet = (id: string, body: CardBodySet): Promise<CardDto> =>
  invoker('card_body_set', { id, body });

// ---------- search ----------

export const cardSearch = (
  q: string,
  includeArchived = false,
  limit?: number,
  offset?: number,
): Promise<CardSearchHitDto[]> =>
  invoker('card_search', { q, includeArchived, limit, offset });
