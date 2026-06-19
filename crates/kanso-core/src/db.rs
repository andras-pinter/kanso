use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

use crate::Result;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

pub async fn open(path: &Path) -> Result<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;
    Ok(pool)
}

pub async fn open_memory() -> Result<SqlitePool> {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")?
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    Ok(pool)
}

pub async fn migrate(pool: &SqlitePool) -> Result<()> {
    MIGRATOR.run(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    async fn setup() -> SqlitePool {
        let pool = open_memory().await.unwrap();
        migrate(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_open_memory_runs_migrations() {
        let pool = setup().await;
        let tables: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
                .fetch_all(&pool)
                .await
                .unwrap();
        let names: Vec<&str> = tables.iter().map(|t| t.0.as_str()).collect();
        for expected in [
            "boards",
            "columns",
            "cards",
            "tags",
            "card_tags",
            "cards_fts",
        ] {
            assert!(names.contains(&expected), "missing table: {expected}");
        }
    }

    #[tokio::test]
    async fn test_foreign_keys_enabled() {
        let pool = setup().await;
        let (fk,): (i64,) = sqlx::query_as("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fk, 1);
    }

    #[tokio::test]
    async fn test_wal_mode_enabled() {
        // File-backed DB because :memory: cannot use WAL.
        let dir = tempdir_path();
        let pool = open(&dir).await.unwrap();
        migrate(&pool).await.unwrap();
        let (mode,): (String,) = sqlx::query_as("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[tokio::test]
    async fn test_fts5_available() {
        // Proves the bundled SQLite ships FTS5.
        let pool = open_memory().await.unwrap();
        sqlx::query("CREATE VIRTUAL TABLE probe USING fts5(x)")
            .execute(&pool)
            .await
            .unwrap();
    }

    fn tempdir_path() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("kanso-test-{}.db", ulid::Ulid::new()));
        p
    }
}
