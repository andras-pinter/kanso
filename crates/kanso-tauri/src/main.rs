use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use kanso_api::AppState;
use kanso_core::repo::{BoardRepo, ColumnRepo};
use rand::RngCore;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

mod commands;
mod error;
mod ext_install;
mod mcp_hosts;

use commands::{board as cmd_board, card as cmd_card, column as cmd_column, tag as cmd_tag};
use error::AppError;
use ext_install::{CliExtStatus, InstallTarget};
use mcp_hosts::HostInfo;

const MENU_SHOW: &str = "show";
const MENU_QUICK_ADD: &str = "quick_add";
const MENU_REINSTALL_CLI: &str = "reinstall_cli";
const MENU_REINSTALL_MCP: &str = "reinstall_mcp";
const MENU_UNINSTALL_CLI: &str = "uninstall_cli";
const MENU_UNINSTALL_MCP: &str = "uninstall_mcp";
const MENU_QUIT: &str = "quit";

const QUICK_ADD_EVENT: &str = "quick-add:open";

// CmdOrCtrl+Shift+K — SUPER on macOS, CONTROL elsewhere. Not a `const`
// because `Shortcut::new` isn't `const fn` in the plugin.
#[cfg(target_os = "macos")]
fn quick_add_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::SHIFT.union(Modifiers::SUPER)), Code::KeyK)
}
#[cfg(not(target_os = "macos"))]
fn quick_add_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::SHIFT.union(Modifiers::CONTROL)), Code::KeyK)
}

#[derive(Clone)]
pub struct RuntimeState {
    pub pool: SqlitePool,
    pub seed: Arc<SeedIds>,
    pub api_port: u16,
}

struct Bootstrap {
    state: RuntimeState,
    listener: TcpListener,
    api_token: Arc<str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeedIds {
    pub board_id: String,
    pub column_id: String,
}

#[tauri::command]
fn default_column(state: State<'_, RuntimeState>) -> SeedIds {
    (*state.seed).clone()
}

#[tauri::command]
fn api_port(state: State<'_, RuntimeState>) -> u16 {
    state.api_port
}

#[tauri::command]
fn cli_ext_status(app: AppHandle) -> Result<CliExtStatus, AppError> {
    Ok(ext_install::cli_ext_status(&app)?)
}

#[tauri::command]
fn cli_ext_set_consent(app: AppHandle, install: bool) -> Result<CliExtStatus, AppError> {
    match ext_install::set_cli_ext_consent(&app, install) {
        Ok(status) => Ok(status),
        Err(e) => {
            show_error(&app, "Copilot CLI extension", &e.user_message());
            Err(e.into())
        }
    }
}

#[tauri::command]
fn mcp_host_detect(app: AppHandle) -> Result<Vec<HostInfo>, AppError> {
    Ok(mcp_hosts::detect_from_app(&app)?)
}

#[tauri::command]
fn mcp_server_path(app: AppHandle) -> Result<Option<String>, AppError> {
    Ok(mcp_hosts::mcp_server_path_from_app(&app)?)
}

#[tauri::command]
fn reveal_in_file_manager(path: PathBuf) -> Result<(), AppError> {
    Ok(mcp_hosts::reveal_in_file_manager(&path)?)
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    if let Err(e) = run() {
        tracing::error!(error = ?e, "kanso failed to start");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut == &quick_add_shortcut()
                    {
                        open_quick_add(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("create app_data_dir {data_dir:?}: {e}"))?;

            let db_path = data_dir.join("kanso.db");
            let port_path = data_dir.join("port");

            let handle = app.handle().clone();
            let Bootstrap {
                state: runtime_state,
                listener,
                api_token,
            } = tauri::async_runtime::block_on(
                async move { bootstrap(&db_path, &port_path).await },
            )
            .map_err(|e| format!("bootstrap: {e}"))?;

            let api_state = AppState {
                pool: runtime_state.pool.clone(),
                token: api_token,
            };
            let bound = listener
                .local_addr()
                .map_err(|e| format!("local_addr: {e}"))?;
            tauri::async_runtime::spawn(async move {
                tracing::info!(addr = ?bound, "kanso-api listening");
                if let Err(e) = axum::serve(listener, kanso_api::router(api_state)).await {
                    tracing::error!(error = ?e, "axum serve failed");
                }
            });

            setup_tray(&handle).map_err(|e| format!("setup tray: {e}"))?;
            if let Err(e) = handle.global_shortcut().register(quick_add_shortcut()) {
                tracing::warn!(
                    error = ?e,
                    "global shortcut registration failed; quick-add hotkey unavailable",
                );
            }
            if let Err(e) = ext_install::auto_upgrade_if_needed(&handle) {
                show_error(&handle, "Copilot CLI extension", &e.user_message());
                tracing::warn!(error = ?e, "extension auto-upgrade skipped");
            }

            handle.manage(runtime_state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(e) = window.hide() {
                    tracing::warn!(error = ?e, "hide window on close failed");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            default_column,
            api_port,
            cli_ext_status,
            cli_ext_set_consent,
            mcp_host_detect,
            mcp_server_path,
            reveal_in_file_manager,
            cmd_board::boards_list,
            cmd_board::board_create,
            cmd_board::board_update,
            cmd_board::board_archive,
            cmd_board::board_unarchive,
            cmd_board::board_delete,
            cmd_board::board_card_tags_list,
            cmd_column::columns_list,
            cmd_column::column_create,
            cmd_column::column_update,
            cmd_column::column_move,
            cmd_column::column_archive,
            cmd_column::column_unarchive,
            cmd_card::cards_list,
            cmd_card::card_create,
            cmd_card::card_update,
            cmd_card::card_move,
            cmd_card::card_archive,
            cmd_card::card_unarchive,
            cmd_card::card_body_get,
            cmd_card::card_body_set,
            cmd_card::card_search,
            cmd_tag::tags_list,
            cmd_tag::tag_create,
            cmd_tag::tag_get,
            cmd_tag::tag_update,
            cmd_tag::tag_archive,
            cmd_tag::tag_unarchive,
            cmd_tag::tag_delete,
            cmd_tag::card_tags_list,
            cmd_tag::card_tag_add,
            cmd_tag::card_tag_remove,
            cmd_tag::tag_cards_list,
            // Legacy aliases — keep until Wave 5 migrates the UI.
            cmd_card::create_card,
            cmd_card::list_cards,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(MENU_QUICK_ADD, "Quick add card…")
        .separator()
        .text(MENU_SHOW, "Show kanso")
        .separator()
        .text(MENU_REINSTALL_CLI, "Reinstall Copilot CLI extension")
        .text(MENU_REINSTALL_MCP, "Reinstall MCP server")
        .text(MENU_UNINSTALL_CLI, "Uninstall Copilot CLI extension")
        .text(MENU_UNINSTALL_MCP, "Uninstall MCP server")
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("kanso")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_QUICK_ADD => open_quick_add(app),
            MENU_SHOW => show_main_window(app),
            MENU_REINSTALL_CLI => confirm_and_install(app, InstallTarget::Cli),
            MENU_REINSTALL_MCP => confirm_and_install(app, InstallTarget::Mcp),
            MENU_UNINSTALL_CLI => confirm_and_uninstall(app, InstallTarget::Cli),
            MENU_UNINSTALL_MCP => confirm_and_uninstall(app, InstallTarget::Mcp),
            MENU_QUIT => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.show().and_then(|_| window.set_focus()) {
            tracing::warn!(error = ?e, "show main window failed");
        }
    }
}

// Surface the window (it may be hidden in the tray) and tell the frontend to
// open its quick-add modal. The window-show is best-effort: if focusing
// fails we still emit so an already-visible window opens the modal.
fn open_quick_add(app: &AppHandle) {
    show_main_window(app);
    if let Err(e) = app.emit(QUICK_ADD_EVENT, ()) {
        tracing::warn!(error = ?e, "emit quick-add event failed");
    }
}

fn confirm_and_install(app: &AppHandle, target: InstallTarget) {
    let title = target.label();
    confirm(app, title, &format!("Reinstall {title}?"), move |app| {
        match ext_install::install_from_app(&app, target) {
            Ok(()) => show_info(&app, title, &format!("{title} reinstalled.")),
            Err(e) => show_error(&app, title, &e.user_message()),
        }
    });
}

fn confirm_and_uninstall(app: &AppHandle, target: InstallTarget) {
    let title = target.label();
    confirm(app, title, &format!("Uninstall {title}?"), move |app| {
        match ext_install::uninstall_from_app(&app, target) {
            Ok(()) => show_info(&app, title, &format!("{title} uninstalled.")),
            Err(e) => show_error(&app, title, &e.user_message()),
        }
    });
}

fn confirm<F>(app: &AppHandle, title: &str, message: &str, on_yes: F)
where
    F: FnOnce(AppHandle) + Send + 'static,
{
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |yes| {
            if yes {
                on_yes(handle);
            }
        });
}

fn show_info(app: &AppHandle, title: &str, message: &str) {
    show_message(app, title, message, MessageDialogKind::Info);
}

fn show_error(app: &AppHandle, title: &str, message: &str) {
    show_message(app, title, message, MessageDialogKind::Error);
}

fn show_message(app: &AppHandle, title: &str, message: &str, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

async fn bootstrap(
    db_path: &Path,
    port_path: &Path,
) -> Result<Bootstrap, Box<dyn std::error::Error + Send + Sync>> {
    let pool = kanso_core::db::open(db_path).await?;
    kanso_core::db::migrate(&pool).await?;
    let seed = Arc::new(ensure_seed(&pool).await?);

    // Bind once and hand the listener straight to axum — no drop/rebind
    // window where another process could grab the port.
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let token = generate_token();
    write_port_file(port_path, port, &token).await?;
    let api_token: Arc<str> = Arc::from(token);

    Ok(Bootstrap {
        state: RuntimeState {
            pool,
            seed,
            api_port: port,
        },
        listener,
        api_token,
    })
}

/// On a truly empty DB seed one board "My Board" with three columns
/// "To Do" / "In Progress" / "Done". After first launch this is a no-op even
/// if the user later deletes any of the seeded rows.
async fn ensure_seed(
    pool: &SqlitePool,
) -> Result<SeedIds, Box<dyn std::error::Error + Send + Sync>> {
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT b.id, c.id FROM boards b \
         JOIN columns c ON c.board_id = b.id \
         ORDER BY b.created_at ASC, c.position ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    if let Some((board_id, column_id)) = existing {
        return Ok(SeedIds {
            board_id,
            column_id,
        });
    }

    let board = BoardRepo::create(pool, "My Board").await?;
    let todo = ColumnRepo::create(pool, &board.id, "To Do", Some("#7aa2f7")).await?;
    let _wip = ColumnRepo::create(pool, &board.id, "In Progress", Some("#e0af68")).await?;
    let _done = ColumnRepo::create(pool, &board.id, "Done", Some("#9ece6a")).await?;
    Ok(SeedIds {
        board_id: board.id,
        column_id: todo.id,
    })
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

async fn write_port_file(
    path: &Path,
    port: u16,
    token: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let contents = format!("port={port}\ntoken={token}\n");

    // Write to a sibling temp file then atomic-rename into place. A reader that
    // catches us mid-rotation either sees the previous file in full or the new
    // file in full — never an empty/truncated state.
    let tmp = path.with_extension("port.tmp");

    let mut opts = tokio::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut f = opts.open(&tmp).await?;
    f.write_all(contents.as_bytes()).await?;
    f.sync_all().await?;
    drop(f);

    // Defend against a pre-existing tmp file that was created before we started
    // setting the mode at open time.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).await?;
    }

    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn write_port_file_writes_through_tmp_and_renames() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("port");
        write_port_file(&path, 4711, "deadbeef")
            .await
            .expect("write");

        let contents = tokio::fs::read_to_string(&path).await.expect("read");
        assert_eq!(contents, "port=4711\ntoken=deadbeef\n");

        let tmp = path.with_extension("port.tmp");
        assert!(!tmp.exists(), "tmp file should not remain after rename");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = tokio::fs::metadata(&path)
                .await
                .expect("meta")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "port file should be 0600");
        }
    }

    #[tokio::test]
    async fn write_port_file_reader_never_sees_partial() {
        // Race the writer against a reader loop. Because writes are atomic
        // (tmp + rename), the reader should only ever observe a full file —
        // either the previous generation or the new one — never an empty or
        // truncated parse.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("port");
        // Seed an initial file so the reader has something to find immediately.
        write_port_file(&path, 1000, "aaaa").await.expect("seed");

        let reader_path = path.clone();
        let reader = tokio::spawn(async move {
            let mut observed_empty = false;
            for _ in 0..2_000 {
                if let Ok(s) = tokio::fs::read_to_string(&reader_path).await {
                    if s.is_empty() || !s.contains("port=") || !s.contains("token=") {
                        observed_empty = true;
                        break;
                    }
                }
                tokio::task::yield_now().await;
            }
            observed_empty
        });

        for i in 0..200u16 {
            write_port_file(&path, 2000 + i, "bbbb")
                .await
                .expect("write");
        }

        let observed_empty = reader.await.expect("join");
        assert!(!observed_empty, "reader observed empty/partial port file");
    }
}
