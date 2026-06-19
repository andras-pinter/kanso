import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CardDto {
  id: string;
  column_id: string;
  title: string;
  position: string;
  created_at: number;
  updated_at: number;
}

interface AppError {
  kind: string;
  message: string;
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function CardsPanel() {
  const [cards, setCards] = useState<CardDto[]>([]);
  const [loading, setLoading] = useState<boolean>(() => isTauri());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<CardDto[]>('list_cards', {});
      setCards(list);
      setError(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    // Initial load. refresh() awaits invoke, so setState only fires post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(async () => {
    const title = window.prompt('Card title?');
    if (!title || !title.trim()) return;
    try {
      await invoke<CardDto>('create_card', { title: title.trim() });
      await refresh();
    } catch (e) {
      setError(formatError(e));
    }
  }, [refresh]);

  if (!isTauri()) {
    return (
      <section style={{ marginTop: '1rem' }}>
        <p>Cards panel is only available inside the Tauri shell.</p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button type="button" onClick={onCreate}>
          + New card
        </button>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error && (
        <p style={{ color: 'crimson' }} role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading cards…</p>
      ) : cards.length === 0 ? (
        <p>No cards yet.</p>
      ) : (
        <ul>
          {cards.map((c) => (
            <li key={c.id}>{c.title}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const err = e as AppError;
    return `${err.kind}: ${err.message}`;
  }
  return String(e);
}
