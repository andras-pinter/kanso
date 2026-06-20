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
      case 'tag_cards_list': {
        const tagId = a.tagId as string;
        const cardIds = Object.entries(server.links)
          .filter(([, tags]) => tags.includes(tagId))
          .map(([cid]) => ({
            id: cid,
            column_id: 'c',
            title: cid,
            body_text: null,
            position: cid,
            due_at: null,
            created_at: 0,
            updated_at: 0,
            archived_at: null,
          }));
        return cardIds as never;
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
    currentBoardId: null,
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
});
