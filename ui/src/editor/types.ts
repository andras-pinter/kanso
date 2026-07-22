export interface EditorOptions {
  /** Initial markdown; empty string means "fresh editor". */
  initialMarkdown?: string;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
}

export interface EditorHandle {
  /** Tear the editor down and detach listeners. */
  destroy(): void;
  /** Current document serialized as markdown. */
  getMarkdown(): string;
  /** Replace the current content with the given markdown. */
  setMarkdown(md: string): void;
  /** Subscribe to doc mutations. Returns an unsubscribe handle. */
  onChange(cb: () => void): () => void;
}
