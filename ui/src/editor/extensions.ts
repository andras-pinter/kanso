// Curated extension list — composed from official @blocksuite/affine-* packages.
// No fork, no patch, no resolutions. See ui/README.md for the budget rationale:
// curating manually saves ~0.45 MB gz over `getInternalViewExtensions()`.
//
// QUIRK: `affine:code` has a hard DI dep on `@blocksuite/affine-inline-latex`
// (CodeBlockInlineManager registers AffineInlineSpec(latex)). Dropping the
// inline-latex view/store extensions makes the editor explode on mount even if
// the latex block itself is unused. Keep them.
//
// BlockSuite source isn't typecheck-clean; tsconfig `paths` redirects
// `@blocksuite/*` to a stub so this file sees them as `any`. See
// src/blocksuite-stub.d.ts.

import { ViewExtensionManager, StoreExtensionManager } from '@blocksuite/affine/ext-loader';
import type { ExtensionType } from '@blocksuite/affine/store';

import { FoundationViewExtension } from '@blocksuite/affine-foundation/view';
import { FoundationStoreExtension } from '@blocksuite/affine-foundation/store';

// Page-mode blocks
import { RootViewExtension } from '@blocksuite/affine-block-root/view';
import { RootStoreExtension } from '@blocksuite/affine-block-root/store';
import { NoteViewExtension } from '@blocksuite/affine-block-note/view';
import { NoteStoreExtension } from '@blocksuite/affine-block-note/store';
import { ParagraphViewExtension } from '@blocksuite/affine-block-paragraph/view';
import { ParagraphStoreExtension } from '@blocksuite/affine-block-paragraph/store';
import { ListViewExtension } from '@blocksuite/affine-block-list/view';
import { ListStoreExtension } from '@blocksuite/affine-block-list/store';
import { CodeBlockViewExtension } from '@blocksuite/affine-block-code/view';
import { CodeStoreExtension } from '@blocksuite/affine-block-code/store';
import { DividerViewExtension } from '@blocksuite/affine-block-divider/view';
import { DividerStoreExtension } from '@blocksuite/affine-block-divider/store';
import { ImageViewExtension } from '@blocksuite/affine-block-image/view';
import { ImageStoreExtension } from '@blocksuite/affine-block-image/store';
import { CalloutViewExtension } from '@blocksuite/affine-block-callout/view';
import { CalloutStoreExtension } from '@blocksuite/affine-block-callout/store';
// Surface is required by the page root (references surface for edgeless mode).
import { SurfaceViewExtension } from '@blocksuite/affine-block-surface/view';
import { SurfaceStoreExtension } from '@blocksuite/affine-block-surface/store';

// Inline formatting
import { FootnoteViewExtension } from '@blocksuite/affine-inline-footnote/view';
import { FootnoteStoreExtension } from '@blocksuite/affine-inline-footnote/store';
import { LatexViewExtension as InlineLatexViewExtension } from '@blocksuite/affine-inline-latex/view';
import { LatexStoreExtension as InlineLatexStoreExtension } from '@blocksuite/affine-inline-latex/store';
import { LinkViewExtension } from '@blocksuite/affine-inline-link/view';
import { LinkStoreExtension } from '@blocksuite/affine-inline-link/store';
import { MentionViewExtension } from '@blocksuite/affine-inline-mention/view';
import { InlinePresetViewExtension } from '@blocksuite/affine-inline-preset/view';
import { InlinePresetStoreExtension } from '@blocksuite/affine-inline-preset/store';
import { ReferenceViewExtension } from '@blocksuite/affine-inline-reference/view';
import { ReferenceStoreExtension } from '@blocksuite/affine-inline-reference/store';

// Widgets for basic page UX
import { DragHandleViewExtension } from '@blocksuite/affine-widget-drag-handle/view';
import { ToolbarViewExtension } from '@blocksuite/affine-widget-toolbar/view';
import { SlashMenuViewExtension } from '@blocksuite/affine-widget-slash-menu/view';
import { KeyboardToolbarViewExtension } from '@blocksuite/affine-widget-keyboard-toolbar/view';
import { LinkedDocViewExtension } from '@blocksuite/affine-widget-linked-doc/view';
import { PageDraggingAreaViewExtension } from '@blocksuite/affine-widget-page-dragging-area/view';
import { RemoteSelectionViewExtension } from '@blocksuite/affine-widget-remote-selection/view';
import { ScrollAnchoringViewExtension } from '@blocksuite/affine-widget-scroll-anchoring/view';
import { ViewportOverlayViewExtension } from '@blocksuite/affine-widget-viewport-overlay/view';

const viewExtensions: ExtensionType[] = [
  FoundationViewExtension,
  RootViewExtension,
  SurfaceViewExtension,
  NoteViewExtension,
  ParagraphViewExtension,
  ListViewExtension,
  CodeBlockViewExtension,
  DividerViewExtension,
  ImageViewExtension,
  CalloutViewExtension,
  FootnoteViewExtension,
  InlineLatexViewExtension,
  LinkViewExtension,
  MentionViewExtension,
  InlinePresetViewExtension,
  ReferenceViewExtension,
  DragHandleViewExtension,
  ToolbarViewExtension,
  SlashMenuViewExtension,
  KeyboardToolbarViewExtension,
  LinkedDocViewExtension,
  PageDraggingAreaViewExtension,
  RemoteSelectionViewExtension,
  ScrollAnchoringViewExtension,
  ViewportOverlayViewExtension,
];

const storeExtensions: ExtensionType[] = [
  FoundationStoreExtension,
  RootStoreExtension,
  SurfaceStoreExtension,
  NoteStoreExtension,
  ParagraphStoreExtension,
  ListStoreExtension,
  CodeStoreExtension,
  DividerStoreExtension,
  ImageStoreExtension,
  CalloutStoreExtension,
  FootnoteStoreExtension,
  InlineLatexStoreExtension,
  LinkStoreExtension,
  InlinePresetStoreExtension,
  ReferenceStoreExtension,
];

let viewCache: ViewExtensionManager | null = null;
let storeCache: StoreExtensionManager | null = null;

export const getViewManager = (): ViewExtensionManager =>
  (viewCache ??= new ViewExtensionManager(viewExtensions));

export const getStoreManager = (): StoreExtensionManager =>
  (storeCache ??= new StoreExtensionManager(storeExtensions));
