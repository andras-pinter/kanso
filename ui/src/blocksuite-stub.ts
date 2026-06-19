// BlockSuite (@blocksuite/affine 0.22.x) publishes raw .ts source via its
// `exports` field. Those files don't pass strict typecheck (`Property 'x' is
// used before its initialization`, Zod inference mismatches, etc.) and
// `skipLibCheck` doesn't help — that only suppresses `.d.ts`.
//
// Workaround: tsconfig `paths` redirects every `@blocksuite/*` (including
// every subpath) to THIS file at compile time. tsc therefore types BlockSuite
// imports as `any` and never visits the unbuildable source. Vite/Rollup
// ignore tsconfig paths, so the real packages are still bundled at build time
// and at runtime nothing changes.
//
// The trade-off: editor code (extensions.ts + internal.ts) sees BlockSuite
// untyped. The public surface stays strict — see ./editor/types.ts.
//
// When a new BlockSuite symbol is needed, add it here. The list is
// alphabetised. Keep it minimal.
//
// Do NOT delete this file — tsconfig.app.json paths references it.

/* eslint-disable @typescript-eslint/no-explicit-any */

const __any: any = undefined;

export default __any;

// ---- types ----
export type ExtensionType = any;
export type Store = any;
export type Workspace = any;
// Aliases for classes that are also referenced as types in the editor code.
export type ViewExtensionManager = any;
export type StoreExtensionManager = any;
export type TestAffineEditorContainer = any;

// ---- @blocksuite/affine root + subpaths ----
export const AffineSchemas: any = __any;
export const Schema: any = __any;
export const Transformer: any = __any;
export const Text: any = __any;
export const TestWorkspace: any = __any;
export const CommunityCanvasTextFonts: any = __any;
export const FontConfigExtension: any = __any;
export const FeatureFlagService: any = __any;
export const ViewExtensionManager: any = __any;
export const StoreExtensionManager: any = __any;

// ---- @blocksuite/integration-test ----
export const TestAffineEditorContainer: any = __any;
export const effects: any = (() => undefined) as any;

// ---- @blocksuite/affine-foundation ----
export const FoundationStoreExtension: any = __any;
export const FoundationViewExtension: any = __any;

// ---- @blocksuite/affine-block-* ----
export const CalloutStoreExtension: any = __any;
export const CalloutViewExtension: any = __any;
export const CodeBlockViewExtension: any = __any;
export const CodeStoreExtension: any = __any;
export const DividerStoreExtension: any = __any;
export const DividerViewExtension: any = __any;
export const ImageStoreExtension: any = __any;
export const ImageViewExtension: any = __any;
export const ListStoreExtension: any = __any;
export const ListViewExtension: any = __any;
export const NoteStoreExtension: any = __any;
export const NoteViewExtension: any = __any;
export const ParagraphStoreExtension: any = __any;
export const ParagraphViewExtension: any = __any;
export const RootStoreExtension: any = __any;
export const RootViewExtension: any = __any;
export const SurfaceStoreExtension: any = __any;
export const SurfaceViewExtension: any = __any;

// ---- @blocksuite/affine-inline-* ----
export const FootnoteStoreExtension: any = __any;
export const FootnoteViewExtension: any = __any;
export const InlinePresetStoreExtension: any = __any;
export const InlinePresetViewExtension: any = __any;
// LatexStoreExtension / LatexViewExtension are exported under aliases in
// extensions.ts (InlineLatexStoreExtension / InlineLatexViewExtension).
export const LatexStoreExtension: any = __any;
export const LatexViewExtension: any = __any;
export const LinkStoreExtension: any = __any;
export const LinkViewExtension: any = __any;
export const MentionViewExtension: any = __any;
export const ReferenceStoreExtension: any = __any;
export const ReferenceViewExtension: any = __any;

// ---- @blocksuite/affine-widget-* ----
export const DragHandleViewExtension: any = __any;
export const KeyboardToolbarViewExtension: any = __any;
export const LinkedDocViewExtension: any = __any;
export const PageDraggingAreaViewExtension: any = __any;
export const RemoteSelectionViewExtension: any = __any;
export const ScrollAnchoringViewExtension: any = __any;
export const SlashMenuViewExtension: any = __any;
export const ToolbarViewExtension: any = __any;
export const ViewportOverlayViewExtension: any = __any;
