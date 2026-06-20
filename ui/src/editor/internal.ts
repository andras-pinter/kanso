// TECH DEBT: @blocksuite/integration-test is a test package consumed as a
// production dep — it's the only working reference for TestAffineEditorContainer
// and itEffects() (custom-element side-effect registration). See ui/README.md
// for the full rationale and a pointer to the PoC RESULTS.md.
//
// BlockSuite ships raw .ts source that fails strict typecheck; tsconfig
// `paths` redirects `@blocksuite/*` to a stub ambient declaration so this
// file sees those imports as `any`. Runtime resolution (vite/rollup) is
// unaffected. Our public surface is hand-typed in ./types.ts.

import '@blocksuite/affine/effects';
import { effects as itEffects } from '@blocksuite/integration-test/effects';
import { TestAffineEditorContainer } from '@blocksuite/integration-test';
import { AffineSchemas } from '@blocksuite/affine/schemas';
import { Schema, Transformer, Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import {
  CommunityCanvasTextFonts,
  FontConfigExtension,
  FeatureFlagService,
} from '@blocksuite/affine/shared/services';
import type { ExtensionType, Store, Workspace } from '@blocksuite/affine/store';
import * as Y from 'yjs';

import { getViewManager, getStoreManager } from './extensions';
import { extractPlaintext } from './plaintext';
import type { EditorHandle, EditorOptions } from './types';

itEffects();

const DOC_ID = 'doc:home';

// Root title lives at model.props.title, not model.title — block models proxy
// props but the root model needs explicit access. Same goes for prop:text on
// content blocks. This helper avoids leaking that quirk to callers.
type SpaceDocHost = { spaceDoc: Y.Doc };

function buildRuntimeExtensions(): ExtensionType[] {
  return [FontConfigExtension(CommunityCanvasTextFonts)];
}

function createWorkspace(): Workspace {
  const schema = new Schema();
  schema.register(AffineSchemas);
  const storeManager = getStoreManager();
  const ws = new TestWorkspace({
    id: 'kanso-workspace',
    blobSources: { main: undefined as never, shadows: [] },
  } as never);
  ws.storeExtensions = storeManager.get('store');
  ws.start();
  new Transformer({
    schema,
    blobCRUD: ws.blobSync,
    docCRUD: {
      create: (id: string) => ws.createDoc(id).getStore({ id }),
      get: (id: string) => ws.getDoc(id)?.getStore({ id }) ?? null,
      delete: (id: string) => ws.removeDoc(id),
    },
  });
  return ws;
}

function seedDoc(workspace: Workspace, initialText?: string): Store {
  workspace.meta.initialize();
  const doc = workspace.createDoc(DOC_ID);
  const store = doc.getStore({ id: DOC_ID });
  doc.load(() => {
    const rootId = store.addBlock('affine:page', { title: new Text('Untitled') });
    store.addBlock('affine:surface', {}, rootId);
    const noteId = store.addBlock('affine:note', {}, rootId);
    // Auto-convert legacy plaintext bodies (Wave 5 textarea era) into a
    // single paragraph block. Single block round-trips the text verbatim
    // through extractPlaintext — splitting on '\n\n' would lose blank-line
    // separators on the way back out, so we keep it whole.
    const seed = initialText && initialText.length > 0 ? initialText : '';
    store.addBlock('affine:paragraph', { text: new Text(seed) }, noteId);
  });
  return store;
}

function hydrateDoc(workspace: Workspace, update: Uint8Array): Store {
  workspace.meta.initialize();
  const doc = workspace.createDoc(DOC_ID);
  const store = doc.getStore({ id: DOC_ID });
  Y.applyUpdate(doc.spaceDoc, update);
  if (!doc.loaded) doc.load();
  return store;
}

function getYDoc(store: Store, workspace: Workspace): Y.Doc {
  const direct = (store as unknown as Partial<SpaceDocHost>).spaceDoc;
  if (direct) return direct;
  const fallback = workspace.getDoc(DOC_ID) as unknown as SpaceDocHost | undefined;
  if (!fallback?.spaceDoc) throw new Error('failed to resolve spaceDoc for editor store');
  return fallback.spaceDoc;
}

export async function mountEditor(
  container: HTMLElement,
  opts: EditorOptions = {}
): Promise<EditorHandle> {
  const workspace = createWorkspace();
  const store = opts.initialDoc
    ? hydrateDoc(workspace, opts.initialDoc)
    : seedDoc(workspace, opts.initialText);

  const viewManager = getViewManager();
  const runtimeExts = buildRuntimeExtensions();

  const editor = document.createElement('affine-editor-container') as TestAffineEditorContainer;
  editor.autofocus = true;
  editor.doc = store;
  editor.pageSpecs = [...viewManager.get('page'), ...runtimeExts];
  editor.edgelessSpecs = [...viewManager.get('edgeless'), ...runtimeExts];

  store.get(FeatureFlagService).setFlag('enable_advanced_block_visibility', true);

  container.appendChild(editor);
  await editor.updateComplete;

  const ydoc = getYDoc(store, workspace);
  const listeners = new Set<(doc: Uint8Array) => void>();
  const onUpdate = () => {
    if (listeners.size === 0) return;
    const snapshot = Y.encodeStateAsUpdate(ydoc);
    for (const cb of listeners) cb(snapshot);
  };
  ydoc.on('update', onUpdate);

  let disposed = false;

  return {
    destroy: () => {
      if (disposed) return;
      disposed = true;
      ydoc.off('update', onUpdate);
      listeners.clear();
      editor.remove();
      try {
        workspace.dispose?.();
      } catch {
        // workspace dispose is best-effort
      }
    },
    serialize: () => Y.encodeStateAsUpdate(ydoc),
    extractPlaintext: () => extractPlaintext(ydoc),
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
