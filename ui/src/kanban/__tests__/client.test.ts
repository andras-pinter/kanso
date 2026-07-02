import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setInvoker,
  boardArchive,
  boardCardTagsList,
  boardCreate,
  boardDelete,
  boardUnarchive,
  boardUpdate,
  boardsList,
  cardArchive,
  cardBodyGet,
  cardBodySet,
  cardCreate,
  cardMove,
  cardSearch,
  cardTagAdd,
  cardTagRemove,
  cardTagsList,
  cardUnarchive,
  cardUpdate,
  cardsList,
  columnArchive,
  columnCreate,
  columnMove,
  columnUnarchive,
  columnUpdate,
  columnsList,
  defaultColumn,
  tagArchive,
  tagCardsList,
  tagCreate,
  tagDelete,
  tagGet,
  tagUnarchive,
  tagUpdate,
  tagsList,
  type InvokeFn,
} from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';

describe('kanban api client', () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const fakeInvoker: InvokeFn = vi.fn(async (cmd, args) => {
    calls.push({ cmd, args });
    return undefined as unknown as never;
  });

  beforeEach(() => {
    calls.length = 0;
    __setInvoker(fakeInvoker);
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('forwards default_column / api_port style commands without args', async () => {
    await defaultColumn();
    expect(calls).toEqual([{ cmd: 'default_column', args: undefined }]);
  });

  it('serializes board commands with camelCase arg names', async () => {
    await boardsList(true);
    await boardCreate('Backlog');
    await boardUpdate('b1', { name: 'X' });
    await boardArchive('b1');
    await boardUnarchive('b1');
    await boardDelete('b1');

    expect(calls).toEqual([
      { cmd: 'boards_list', args: { includeArchived: true } },
      { cmd: 'board_create', args: { name: 'Backlog' } },
      { cmd: 'board_update', args: { id: 'b1', patch: { name: 'X' } } },
      { cmd: 'board_archive', args: { id: 'b1' } },
      { cmd: 'board_unarchive', args: { id: 'b1' } },
      { cmd: 'board_delete', args: { id: 'b1' } },
    ]);
  });

  it('serializes column commands', async () => {
    await columnsList('b1', false);
    await columnCreate('b1', 'Todo', '#ccc');
    await columnUpdate('c1', { color: null });
    await columnArchive('c1');
    await columnUnarchive('c1');
    await columnMove('c1', { before: 'c2' });
    await columnMove('c1', { after: 'c3' });
    await columnMove('c1');

    expect(calls).toEqual([
      { cmd: 'columns_list', args: { boardId: 'b1', includeArchived: false } },
      { cmd: 'column_create', args: { boardId: 'b1', name: 'Todo', color: '#ccc' } },
      { cmd: 'column_update', args: { id: 'c1', patch: { color: null } } },
      { cmd: 'column_archive', args: { id: 'c1' } },
      { cmd: 'column_unarchive', args: { id: 'c1' } },
      { cmd: 'column_move', args: { id: 'c1', before: 'c2', after: undefined } },
      { cmd: 'column_move', args: { id: 'c1', before: undefined, after: 'c3' } },
      { cmd: 'column_move', args: { id: 'c1', before: undefined, after: undefined } },
    ]);
  });

  it('serializes card commands', async () => {
    await cardsList('c1');
    await cardCreate('c1', 'Hi');
    await cardUpdate('k1', { title: 'Renamed', body_text: null });
    await cardArchive('k1');
    await cardUnarchive('k1');

    expect(calls).toEqual([
      { cmd: 'cards_list', args: { columnId: 'c1', includeArchived: false } },
      { cmd: 'card_create', args: { columnId: 'c1', title: 'Hi' } },
      {
        cmd: 'card_update',
        args: { id: 'k1', patch: { title: 'Renamed', body_text: null } },
      },
      { cmd: 'card_archive', args: { id: 'k1' } },
      { cmd: 'card_unarchive', args: { id: 'k1' } },
    ]);
  });

  it('card_move passes target_column_id + at most one anchor', async () => {
    await cardMove('k1', { targetColumnId: 'c2' });
    await cardMove('k1', { targetColumnId: 'c2', before: 'k2' });
    await cardMove('k1', { targetColumnId: 'c2', after: 'k3' });

    expect(calls).toEqual([
      {
        cmd: 'card_move',
        args: { id: 'k1', targetColumnId: 'c2', before: undefined, after: undefined },
      },
      {
        cmd: 'card_move',
        args: { id: 'k1', targetColumnId: 'c2', before: 'k2', after: undefined },
      },
      {
        cmd: 'card_move',
        args: { id: 'k1', targetColumnId: 'c2', before: undefined, after: 'k3' },
      },
    ]);
  });

  it('forwards card body get / set with the canonical arg shape', async () => {
    await cardBodyGet('k1');
    await cardBodySet('k1', { body_blocksuite_b64: 'AAA=', body_text: 'hi' });

    expect(calls).toEqual([
      { cmd: 'card_body_get', args: { id: 'k1' } },
      {
        cmd: 'card_body_set',
        args: { id: 'k1', body: { body_blocksuite_b64: 'AAA=', body_text: 'hi' } },
      },
    ]);
  });

  it('supports text-only card body writes', async () => {
    await cardBodySet('k2', { body_text: 'plain' });
    expect(calls).toEqual([
      {
        cmd: 'card_body_set',
        args: { id: 'k2', body: { body_text: 'plain' } },
      },
    ]);
  });

  it('serializes tag + search commands', async () => {
    await tagsList(true);
    await tagGet('t1');
    await tagCreate('Important', '#f00');
    await tagUpdate('t1', { color: null });
    await tagArchive('t1');
    await tagUnarchive('t1');
    await tagDelete('t1');
    await tagCardsList('t1');
    await cardTagsList('k1', true);
    await cardTagAdd('k1', 't1');
    await cardTagRemove('k1', 't1');
    await boardCardTagsList('b1');
    await cardSearch('foo');

    expect(calls).toEqual([
      { cmd: 'tags_list', args: { includeArchived: true } },
      { cmd: 'tag_get', args: { id: 't1' } },
      { cmd: 'tag_create', args: { body: { name: 'Important', color: '#f00' } } },
      { cmd: 'tag_update', args: { id: 't1', patch: { color: null } } },
      { cmd: 'tag_archive', args: { id: 't1' } },
      { cmd: 'tag_unarchive', args: { id: 't1' } },
      { cmd: 'tag_delete', args: { id: 't1' } },
      { cmd: 'tag_cards_list', args: { tagId: 't1', includeArchived: false } },
      { cmd: 'card_tags_list', args: { cardId: 'k1', includeArchived: true } },
      { cmd: 'card_tag_add', args: { cardId: 'k1', tagId: 't1' } },
      { cmd: 'card_tag_remove', args: { cardId: 'k1', tagId: 't1' } },
      { cmd: 'board_card_tags_list', args: { boardId: 'b1' } },
      { cmd: 'card_search', args: { q: 'foo', includeArchived: false, limit: undefined, offset: undefined } },
    ]);
  });
});
