use std::path::Path;
use std::sync::Arc;

use kanso_api::AppState;
use kanso_core::repo::{BoardRepo, ColumnRepo};
use rand::RngCore;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

mod commands;
mod error;

use commands::{board as cmd_board, card as cmd_card, column as cmd_column};

#[derive(Clone)]
pub struct RuntimeState {
    pub pool: SqlitePool,
    pub seed: Arc<SeedIds>,
    pub api_port: u16,
}

struct Bootstrap {
    state: RuntimeState,
    listener: TcpListener,
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
            } = tauri::async_runtime::block_on(
                async move { bootstrap(&db_path, &port_path).await },
            )
            .map_err(|e| format!("bootstrap: {e}"))?;

            let api_state = AppState {
                pool: runtime_state.pool.clone(),
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

            handle.manage(runtime_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_column,
            api_port,
            cmd_board::boards_list,
            cmd_board::board_create,
            cmd_board::board_update,
            cmd_board::board_archive,
            cmd_board::board_unarchive,
            cmd_board::board_delete,
            cmd_column::columns_list,
            cmd_column::column_create,
            cmd_column::column_update,
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
            // Legacy aliases — keep until Wave 5 migrates the UI.
            cmd_card::create_card,
            cmd_card::list_cards,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
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

    write_port_file(port_path, port).await?;

    Ok(Bootstrap {
        state: RuntimeState {
            pool,
            seed,
            api_port: port,
        },
        listener,
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

async fn write_port_file(
    path: &Path,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    let contents = format!("port={port}\ntoken={token}\n");
    let mut f = tokio::fs::File::create(path).await?;
    f.write_all(contents.as_bytes()).await?;
    f.flush().await?;
    Ok(())
}
