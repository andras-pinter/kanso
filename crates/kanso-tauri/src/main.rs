use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use kanso_api::{AppState, CardDto};
use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo};
use rand::RngCore;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

mod error;
use error::AppError;

#[derive(Clone)]
struct RuntimeState {
    pool: SqlitePool,
    seed: Arc<SeedIds>,
    api_port: u16,
}

#[derive(Debug, Clone, Serialize)]
struct SeedIds {
    board_id: String,
    column_id: String,
}

#[tauri::command]
async fn create_card(
    state: State<'_, RuntimeState>,
    title: String,
    column_id: Option<String>,
) -> Result<CardDto, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::invalid("title must not be empty"));
    }
    let column_id = column_id.unwrap_or_else(|| state.seed.column_id.clone());
    let card = CardRepo::create(&state.pool, &column_id, title).await?;
    Ok(CardDto::from(card))
}

#[tauri::command]
async fn list_cards(
    state: State<'_, RuntimeState>,
    column_id: Option<String>,
) -> Result<Vec<CardDto>, AppError> {
    let column_id = column_id.unwrap_or_else(|| state.seed.column_id.clone());
    let cards = CardRepo::list_by_column(&state.pool, &column_id).await?;
    Ok(cards.into_iter().map(CardDto::from).collect())
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
            let runtime_state =
                tauri::async_runtime::block_on(
                    async move { bootstrap(&db_path, &port_path).await },
                )
                .map_err(|e| format!("bootstrap: {e}"))?;

            let api_state = AppState {
                pool: runtime_state.pool.clone(),
            };
            let port = runtime_state.api_port;
            tauri::async_runtime::spawn(async move {
                let addr = SocketAddr::from(([127, 0, 0, 1], port));
                match TcpListener::bind(addr).await {
                    Ok(listener) => {
                        tracing::info!(?addr, "kanso-api listening");
                        if let Err(e) = axum::serve(listener, kanso_api::router(api_state)).await {
                            tracing::error!(error = ?e, "axum serve failed");
                        }
                    }
                    Err(e) => tracing::error!(error = ?e, "bind {addr} failed"),
                }
            });

            handle.manage(runtime_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_card,
            list_cards,
            default_column,
            api_port
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

async fn bootstrap(
    db_path: &Path,
    port_path: &Path,
) -> Result<RuntimeState, Box<dyn std::error::Error + Send + Sync>> {
    let pool = kanso_core::db::open(db_path).await?;
    kanso_core::db::migrate(&pool).await?;
    let seed = Arc::new(ensure_seed(&pool).await?);

    // Bind a TCP listener up front so we know the port before writing the
    // port file. The listener is dropped and rebound inside the spawned
    // axum task. Loopback-only, so the TOCTOU window is harmless.
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);

    write_port_file(port_path, port).await?;

    Ok(RuntimeState {
        pool,
        seed,
        api_port: port,
    })
}

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
    let column = ColumnRepo::create(pool, &board.id, "Todo").await?;
    Ok(SeedIds {
        board_id: board.id,
        column_id: column.id,
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
