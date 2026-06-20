import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setInvoker,
  boardArchive,
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
  cardUnarchive,
  cardUpdate,
  cardsList,
  columnArchive,
  columnCreate,
  columnUnarchive,
  columnUpdate,
  columnsList,
  defaultColumn,
  type InvokeFn,
} from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';

describe('kanban api client', () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const fakeInvoker: InvokeFn = vi.fn(async (cmd, args) => {
    calls.push({ cmd, args });
    // Return shape-shifting placeholder; consumers ignore it in these tests.
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

    expect(calls).toEqual([
      { cmd: 'columns_list', args: { boardId: 'b1', includeArchived: false } },
      { cmd: 'column_create', args: { boardId: 'b1', name: 'Todo', color: '#ccc' } },
      { cmd: 'column_update', args: { id: 'c1', patch: { color: null } } },
      { cmd: 'column_archive', args: { id: 'c1' } },
      { cmd: 'column_unarchive', args: { id: 'c1' } },
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
});
