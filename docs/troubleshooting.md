# Troubleshooting

## Styles not applying

If the app renders with unstyled / raw HTML after a build, it is most likely a stale bundle cache.
The kanban CSS pipeline is correct: `kanban.css` is imported by `KanbanBoard.tsx` (and `ConnectAppsPanel.tsx`),
Vite bundles it into `dist/assets/*.css`, and the Tauri CSP is `null` (no restrictions).
There are no CSS-resetting libraries; the only `!important` overrides are inside `kanban.css` itself.

**Rebuild from clean:**

```sh
rm -rf crates/kanso-tauri/target/debug/bundle
rm -rf ui/dist
cd ui && npm run build
cd ../crates/kanso-tauri && cargo tauri build
```

On macOS, also clear the WebKit cache for the `dev.kanso.desktop` identifier if the dev build
still shows stale styles:

```sh
rm -rf ~/Library/WebKit/dev.kanso.desktop
```
