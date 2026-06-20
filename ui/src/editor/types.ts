export interface EditorOptions {
  /** Optional Yjs update (`Y.encodeStateAsUpdate(doc)`) used to hydrate the editor on mount. */
  initialDoc?: Uint8Array;
  /**
   * Optional plaintext used to seed a fresh editor when `initialDoc` is
   * not provided. Lets us auto-convert pre-BlockSuite cards (Wave 5
   * textarea era) without prompting the user.
   */
  initialText?: string;
}

export interface EditorHandle {
  /** Tear the editor down, dispose the workspace, and detach update listeners. */
  destroy(): void;
  /** Snapshot the doc as a Yjs binary update. */
  serialize(): Uint8Array;
  /** Walk the current doc and return FTS5-friendly plaintext. */
  extractPlaintext(): string;
  /** Subscribe to Yjs updates. Returns an unsubscribe handle. */
  onChange(cb: (doc: Uint8Array) => void): () => void;
}
