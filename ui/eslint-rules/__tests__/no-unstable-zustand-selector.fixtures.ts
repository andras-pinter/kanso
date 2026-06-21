/**
 * Fixture file for the no-unstable-zustand-selector ESLint rule.
 * The bad patterns below MUST be flagged by the rule; they exist only
 * to verify the lint fires. Normal code must NOT contain these patterns.
 */

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

// Fake store hook for fixture purposes
declare const useKanbanStore: <T>(selector: (s: any) => T) => T;

// ❌ BAD — selector returns ad-hoc array via ??
const badArray = useKanbanStore((s) => s.cardsByColumn['col-1'] ?? []);

// ❌ BAD — selector returns ad-hoc object via ??
const badObject = useKanbanStore((s) => s.settings ?? {});
