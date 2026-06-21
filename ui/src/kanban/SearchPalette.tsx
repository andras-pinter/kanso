// Cmd+K command palette: full-screen overlay, centered search panel, debounced
// FTS5 query, click result → openCardOnBoard (switches boards if needed, then
// opens the modal).

import { useEffect, useRef, useState } from 'react';
import { cardSearch } from './api/client';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardSearchHitDto } from './types';

interface Props {
  onClose: () => void;
}

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 10;

export default function SearchPalette({ onClose }: Props) {
  const openCardOnBoard = useKanbanStore((s) => s.openCardOnBoard);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CardSearchHitDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      // Don't setState here; render gates on `query` so stale `results`
      // never show. The next non-empty query overwrites them.
      return;
    }
    const id = ++reqId.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await cardSearch(q, false);
        if (id !== reqId.current) return;
        setResults(hits.slice(0, MAX_RESULTS));
        setErr(null);
      } catch (e) {
        if (id !== reqId.current) return;
        setErr(e instanceof Error ? e.message : String(e));
        setResults([]);
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  const onPick = (hit: CardSearchHitDto) => {
    void openCardOnBoard(hit.card.id, hit.board_id);
    onClose();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const first = results[0];
    if (first) onPick(first);
  };

  return (
    <div
      className="kanso-palette-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="kanso-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search cards"
      >
        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="search"
            className="kanso-palette-input"
            placeholder="Search cards…  (FTS5 phrase, e.g. &quot;buy ribbon&quot;)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search query"
          />
        </form>
        <div className="kanso-palette-results">
          {err && (
            <p className="kanso-palette-state" role="alert">
              Search failed: {err}
            </p>
          )}
          {!err && query.trim() === '' && (
            <p className="kanso-palette-state">Start typing to search…</p>
          )}
          {!err && query.trim() !== '' && !searching && results.length === 0 && (
            <p className="kanso-palette-state">No matches.</p>
          )}
          {!err && results.length > 0 && (
            <ul role="listbox">
              {results.map((hit) => (
                <li key={hit.card.id}>
                  <button
                    type="button"
                    className="kanso-palette-item"
                    onClick={() => onPick(hit)}
                  >
                    <span className="kanso-palette-item-title">{hit.card.title}</span>
                    <span className="kanso-palette-item-sub">
                      {hit.board_name} · {hit.column_name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
