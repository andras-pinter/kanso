import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { TagDto } from '../types';

function tag(id: string, name: string, archived = false): TagDto {
  return {
    id,
    name,
    color: '#abcdef',
    created_at: 0,
    updated_at: 0,
    archived_at: archived ? 1 : null,
  };
}

interface FakeServer {
  tags: TagDto[];
  // cardId -> tagIds
  links: Record<string, string[]>;
}

function buildInvoker(server: FakeServer): InvokeFn {
  return async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'tags_list':
        return (a.includeArchived ? server.tags : server.tags.filter((t) => t.archived_at === null)) as never;
      case 'board_card_tags_list': {
        const pairs: { card_id: string; tag_id: string }[] = [];
        for (const [cid, tags] of Object.entries(server.links)) {
          for (const tid of tags) {
            pairs.push({ card_id: cid, tag_id: tid });
          }
        }
        return pairs as never;
      }
      case 'tag_create': {
        const body = a.body as { name: string; color?: string | null };
        const created = tag(`t${server.tags.length + 1}`, body.name);
        created.color = body.color ?? null;
        server.tags.push(created);
        return created as never;
      }
      case 'tag_update': {
        const id = a.id as string;
        const patch = (a.patch ?? {}) as { name?: string; color?: string | null };
        server.tags = server.tags.map((t) =>
          t.id === id
            ? {
                ...t,
                name: patch.name ?? t.name,
                color: patch.color === undefined ? t.color : patch.color,
              }
            : t,
        );
        return server.tags.find((t) => t.id === id) as never;
      }
      case 'tag_archive': {
        const id = a.id as string;
        server.tags = server.tags.map((t) => (t.id === id ? { ...t, archived_at: 1 } : t));
        return undefined as never;
      }
      case 'tag_unarchive': {
        const id = a.id as string;
        server.tags = server.tags.map((t) => (t.id === id ? { ...t, archived_at: null } : t));
        return undefined as never;
      }
      case 'tag_delete': {
        const id = a.id as string;
        server.tags = server.tags.filter((t) => t.id !== id);
        for (const cid of Object.keys(server.links)) {
          server.links[cid] = server.links[cid]!.filter((t) => t !== id);
        }
        return undefined as never;
      }
      case 'card_tag_add': {
        const cid = a.cardId as string;
        const tid = a.tagId as string;
        const list = server.links[cid] ?? [];
        if (!list.includes(tid)) list.push(tid);
        server.links[cid] = list;
        return undefined as never;
      }
      case 'card_tag_remove': {
        const cid = a.cardId as string;
        const tid = a.tagId as string;
        server.links[cid] = (server.links[cid] ?? []).filter((t) => t !== tid);
        return undefined as never;
      }
      default:
        return undefined as never;
    }
  };
}

function reset() {
  useKanbanStore.setState({
    status: 'idle',
    error: null,
    boards: [],
    currentBoardId: 'board1',
    showArchived: false,
    columns: [],
    cardsByColumn: {},
    selectedCardId: null,
    tags: [],
    tagsLoaded: false,
    cardTagMap: {},
  });
}

describe('useKanbanStore tag actions', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = {
      tags: [tag('t1', 'red'), tag('t2', 'blue')],
      links: { card1: ['t1'] },
    };
    __setInvoker(buildInvoker(server));
    reset();
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    reset();
  });

  it('loadTags populates tags and card-tag map', async () => {
    await useKanbanStore.getState().loadTags();
    const s = useKanbanStore.getState();
    expect(s.tagsLoaded).toBe(true);
    expect(s.tags.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(s.cardTagMap.card1).toEqual(['t1']);
  });

  it('addCardTag optimistically updates and persists', async () => {
    await useKanbanStore.getState().loadTags();
    await useKanbanStore.getState().addCardTag('card1', 't2');
    expect(useKanbanStore.getState().cardTagMap.card1).toEqual(['t1', 't2']);
    expect(server.links.card1).toEqual(['t1', 't2']);
  });

  it('removeCardTag rolls back on failure', async () => {
    await useKanbanStore.getState().loadTags();
    // Override invoker to throw on card_tag_remove
    __setInvoker(async (cmd, args) => {
      if (cmd === 'card_tag_remove') throw new Error('boom');
      return buildInvoker(server)(cmd, args);
    });
    await useKanbanStore.getState().removeCardTag('card1', 't1');
    expect(useKanbanStore.getState().cardTagMap.card1).toEqual(['t1']);
    expect(useKanbanStore.getState().error).toContain('boom');
  });

  it('tagCreate appends to tags list', async () => {
    await useKanbanStore.getState().loadTags();
    const created = await useKanbanStore.getState().tagCreate('green', '#00ff00');
    expect(created?.name).toBe('green');
    expect(useKanbanStore.getState().tags.find((t) => t.id === created?.id)?.color).toBe('#00ff00');
  });

  it('tagArchive refreshes tag list with archived flag', async () => {
    await useKanbanStore.getState().loadTags();
    await useKanbanStore.getState().tagArchive('t1');
    expect(useKanbanStore.getState().tags.find((t) => t.id === 't1')?.archived_at).toBe(1);
  });

  it('tagDelete removes from tags and prunes card-tag map', async () => {
    await useKanbanStore.getState().loadTags();
    await useKanbanStore.getState().tagDelete('t1');
    const s = useKanbanStore.getState();
    expect(s.tags.find((t) => t.id === 't1')).toBeUndefined();
    expect(s.cardTagMap.card1).toEqual([]);
  });

  it('loadTags short-circuits the map fetch when no board is active', async () => {
    useKanbanStore.setState({ currentBoardId: null });
    let calledBoardEndpoint = false;
    __setInvoker(async (cmd, args) => {
      if (cmd === 'board_card_tags_list') {
        calledBoardEndpoint = true;
      }
      return buildInvoker(server)(cmd, args);
    });

    await useKanbanStore.getState().loadTags();
    const s = useKanbanStore.getState();
    expect(s.tagsLoaded).toBe(true);
    expect(s.cardTagMap).toEqual({});
    expect(calledBoardEndpoint).toBe(false);
  });

  it('concurrent addCardTag rollback preserves later successful add', async () => {
    await useKanbanStore.getState().loadTags();
    // Reset links so card2 starts clean.
    server.links.card2 = [];

    // Programmable invoker: fail adds for t1, succeed for t2. Resolve t2
    // first by making t1 wait on a manual gate.
    let releaseT1Fail!: () => void;
    const t1Gate = new Promise<void>((res) => {
      releaseT1Fail = res;
    });
    __setInvoker(async (cmd, args) => {
      if (cmd === 'card_tag_add') {
        const a = (args ?? {}) as Record<string, unknown>;
        if (a.tagId === 't1') {
          await t1Gate;
          throw new Error('t1 add boom');
        }
      }
      return buildInvoker(server)(cmd, args);
    });

    const addA = useKanbanStore.getState().addCardTag('card2', 't1');
    const addB = useKanbanStore.getState().addCardTag('card2', 't2');

    await addB;
    expect(useKanbanStore.getState().cardTagMap.card2).toEqual(['t1', 't2']);

    releaseT1Fail();
    await addA;

    // Only t1 should be rolled back; t2 must survive.
    expect(useKanbanStore.getState().cardTagMap.card2).toEqual(['t2']);
  });

  it('switchBoard refreshes cardTagMap for the new board', async () => {
    const linksByBoard: Record<string, Record<string, string[]>> = {
      board1: { card1: ['t1'] },
      board2: { card2: ['t2'], card3: ['t1', 't2'] },
    };
    __setInvoker(async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case 'columns_list':
          return [] as never;
        case 'boards_list':
          return [] as never;
        case 'board_card_tags_list': {
          const bid = a.boardId as string;
          const links = linksByBoard[bid] ?? {};
          const pairs: { card_id: string; tag_id: string }[] = [];
          for (const [cid, tids] of Object.entries(links)) {
            for (const tid of tids) pairs.push({ card_id: cid, tag_id: tid });
          }
          return pairs as never;
        }
        default:
          return buildInvoker(server)(cmd, args);
      }
    });

    useKanbanStore.setState({ currentBoardId: 'board1' });
    await useKanbanStore.getState().loadTags();
    expect(useKanbanStore.getState().cardTagMap).toEqual({ card1: ['t1'] });

    const ok = await useKanbanStore.getState().switchBoard('board2');
    expect(ok).toBe(true);
    const m = useKanbanStore.getState().cardTagMap;
    expect(m.card1).toBeUndefined();
    expect(m.card2).toEqual(['t2']);
    expect(m.card3?.sort()).toEqual(['t1', 't2']);
  });

  it('setShowArchived refreshes cardTagMap', async () => {
    let bulkCalls = 0;
    __setInvoker(async (cmd, args) => {
      if (cmd === 'columns_list') return [] as never;
      if (cmd === 'board_card_tags_list') {
        bulkCalls += 1;
        return [] as never;
      }
      return buildInvoker(server)(cmd, args);
    });

    await useKanbanStore.getState().loadTags();
    const before = bulkCalls;
    await useKanbanStore.getState().setShowArchived(true);
    expect(bulkCalls).toBe(before + 1);
  });

  it('boot: loadTags after load populates map even if tags resolve first', async () => {
    // Reproduces a real boot race: KanbanBoard fires load() and loadTags()
    // concurrently. loadTags reads get().currentBoardId; if load hasn't
    // committed yet, it sees null and short-circuits to {}. load() must
    // refresh the map after committing.
    let releaseContents!: () => void;
    const contentsGate = new Promise<void>((res) => {
      releaseContents = res;
    });

    const tagsPayload: TagDto[] = [tag('t1', 'red')];
    const boardPayload = [{ id: 'board1', name: 'B1', archived_at: null, created_at: 0, updated_at: 0 }];
    const linksPayload = [{ card_id: 'card1', tag_id: 't1' }];

    __setInvoker(async (cmd, _args) => {
      switch (cmd) {
        case 'default_column':
          return { board_id: 'board1', column_id: 'col1' } as never;
        case 'boards_list':
          return boardPayload as never;
        case 'columns_list':
          await contentsGate;
          return [] as never;
        case 'cards_list':
          return [] as never;
        case 'tags_list':
          return tagsPayload as never;
        case 'board_card_tags_list':
          return linksPayload as never;
        default:
          return undefined as never;
      }
    });

    useKanbanStore.setState({ currentBoardId: null, tagsLoaded: false, cardTagMap: {} });

    const loadP = useKanbanStore.getState().load();
    const tagsP = useKanbanStore.getState().loadTags();
    await tagsP;
    // Tags settled while load() is still pending — map must be empty here.
    expect(useKanbanStore.getState().cardTagMap).toEqual({});

    releaseContents();
    await loadP;

    expect(useKanbanStore.getState().currentBoardId).toBe('board1');
    expect(useKanbanStore.getState().cardTagMap).toEqual({ card1: ['t1'] });
  });

  it('reloadTagMap: late response does not clobber newer board', async () => {
    // Switch B (slow) then C (fast). C lands first and commits; B's late
    // response must be discarded by the version/board guard.
    const linksByBoard: Record<string, { card_id: string; tag_id: string }[]> = {
      boardB: [{ card_id: 'cardB', tag_id: 't1' }],
      boardC: [{ card_id: 'cardC', tag_id: 't2' }],
    };
    let releaseB!: () => void;
    const bGate = new Promise<void>((res) => {
      releaseB = res;
    });

    __setInvoker(async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case 'columns_list':
          return [] as never;
        case 'board_card_tags_list': {
          const bid = a.boardId as string;
          if (bid === 'boardB') await bGate;
          return (linksByBoard[bid] ?? []) as never;
        }
        default:
          return buildInvoker(server)(cmd, args);
      }
    });

    useKanbanStore.setState({ currentBoardId: 'boardA' });

    const switchB = useKanbanStore.getState().switchBoard('boardB');
    // Let switchB commit currentBoardId='boardB' and pause inside reloadTagMap awaiting bGate.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(useKanbanStore.getState().currentBoardId).toBe('boardB');

    const switchC = useKanbanStore.getState().switchBoard('boardC');

    await switchC;
    expect(useKanbanStore.getState().currentBoardId).toBe('boardC');
    expect(useKanbanStore.getState().cardTagMap).toEqual({ cardC: ['t2'] });

    releaseB();
    await switchB;

    // B's late fetch must NOT have overwritten C's map.
    expect(useKanbanStore.getState().currentBoardId).toBe('boardC');
    expect(useKanbanStore.getState().cardTagMap).toEqual({ cardC: ['t2'] });
  });
});
