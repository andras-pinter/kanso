import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setInvoker,
  boardCardTagsList,
  boardCreate,
  boardDelete,
  boardUpdate,
  boardsList,
  cardBodyGet,
  cardBodySet,
  cardCreate,
  cardDelete,
  cardMove,
  cardSearch,
  cardTagAdd,
  cardTagRemove,
  cardTagsList,
  cardUpdate,
  cardsList,
  columnsList,
  defaultColumn,
  tagCardsList,
  tagCreate,
  tagDelete,
  tagGet,
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

  it('forwards default_column with no args', async () => {
    await defaultColumn();
    expect(calls).toEqual([{ cmd: 'default_column', args: undefined }]);
  });

  it('serializes board commands with camelCase arg names', async () => {
    await boardsList();
    await boardCreate('Backlog');
    await boardUpdate('b1', { name: 'X' });
    await boardDelete('b1');

    expect(calls).toEqual([
      { cmd: 'boards_list', args: undefined },
      { cmd: 'board_create', args: { name: 'Backlog' } },
      { cmd: 'board_update', args: { id: 'b1', patch: { name: 'X' } } },
      { cmd: 'board_delete', args: { id: 'b1' } },
    ]);
  });

  it('serializes column list', async () => {
    await columnsList('b1');

    expect(calls).toEqual([{ cmd: 'columns_list', args: { boardId: 'b1' } }]);
  });

  it('serializes card commands', async () => {
    await cardsList('c1');
    await cardCreate('c1', 'Hi');
    await cardUpdate('k1', { title: 'Renamed', body_text: null });
    await cardDelete('k1');

    expect(calls).toEqual([
      { cmd: 'cards_list', args: { columnId: 'c1' } },
      { cmd: 'card_create', args: { columnId: 'c1', title: 'Hi' } },
      {
        cmd: 'card_update',
        args: { id: 'k1', patch: { title: 'Renamed', body_text: null } },
      },
      { cmd: 'card_delete', args: { id: 'k1' } },
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
    await tagsList();
    await tagGet('t1');
    await tagCreate('Important', '#f00');
    await tagUpdate('t1', { color: null });
    await tagDelete('t1');
    await tagCardsList('t1');
    await cardTagsList('k1');
    await cardTagAdd('k1', 't1');
    await cardTagRemove('k1', 't1');
    await boardCardTagsList('b1');
    await cardSearch('foo');

    expect(calls).toEqual([
      { cmd: 'tags_list', args: undefined },
      { cmd: 'tag_get', args: { id: 't1' } },
      { cmd: 'tag_create', args: { body: { name: 'Important', color: '#f00' } } },
      { cmd: 'tag_update', args: { id: 't1', patch: { color: null } } },
      { cmd: 'tag_delete', args: { id: 't1' } },
      { cmd: 'tag_cards_list', args: { tagId: 't1' } },
      { cmd: 'card_tags_list', args: { cardId: 'k1' } },
      { cmd: 'card_tag_add', args: { cardId: 'k1', tagId: 't1' } },
      { cmd: 'card_tag_remove', args: { cardId: 'k1', tagId: 't1' } },
      { cmd: 'board_card_tags_list', args: { boardId: 'b1' } },
      { cmd: 'card_search', args: { q: 'foo', limit: undefined, offset: undefined } },
    ]);
  });
});
