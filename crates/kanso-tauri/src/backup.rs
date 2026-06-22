use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use thiserror::Error;

const KEEP_DAILY_BACKUPS: usize = 7;

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("backup path is not valid UTF-8: {0:?}")]
    NonUtf8Path(PathBuf),

    #[error("backup I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("backup database error: {0}")]
    Db(#[from] sqlx::Error),
}

pub async fn backup_on_launch(db_path: &Path, data_dir: &Path) -> Result<(), BackupError> {
    backup_for_date(db_path, data_dir, &crate::time::today_utc()).await
}

async fn backup_for_date(db_path: &Path, data_dir: &Path, date: &str) -> Result<(), BackupError> {
    if !db_path.exists() {
        return Ok(());
    }

    let backups_dir = data_dir.join("backups");
    fs::create_dir_all(&backups_dir)?;

    let target = backups_dir.join(format!("kanso-{date}.db"));
    if !target.exists() {
        vacuum_into(db_path, &target).await?;
    }

    prune_backups(&backups_dir)?;
    Ok(())
}

async fn vacuum_into(db_path: &Path, target: &Path) -> Result<(), BackupError> {
    let target_str = target
        .to_str()
        .ok_or_else(|| BackupError::NonUtf8Path(target.to_path_buf()))?;
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;

    let result = sqlx::query("VACUUM main INTO ?1")
        .bind(target_str)
        .execute(&pool)
        .await;
    pool.close().await;
    result?;
    Ok(())
}

fn prune_backups(backups_dir: &Path) -> Result<(), BackupError> {
    let mut files = Vec::new();
    for entry in fs::read_dir(backups_dir)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if is_backup_name(name) {
            files.push(entry.path());
        }
    }

    files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    for old in files.into_iter().skip(KEEP_DAILY_BACKUPS) {
        fs::remove_file(old)?;
    }
    Ok(())
}

fn is_backup_name(name: &str) -> bool {
    name.len() == "kanso-YYYY-MM-DD.db".len() && name.starts_with("kanso-") && name.ends_with(".db")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn keeps_last_seven_daily_backups() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("kanso.db");
        let pool = kanso_core::db::open(&db_path).await.expect("open");
        kanso_core::db::migrate(&pool).await.expect("migrate");
        pool.close().await;

        for day in 1..=8 {
            backup_for_date(&db_path, dir.path(), &format!("2026-06-{day:02}"))
                .await
                .expect("backup");
        }
        backup_for_date(&db_path, dir.path(), "2026-06-08")
            .await
            .expect("same-day backup");

        let mut names: Vec<String> = fs::read_dir(dir.path().join("backups"))
            .expect("read backups")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();

        assert_eq!(names.len(), 7);
        assert_eq!(names[0], "kanso-2026-06-02.db");
        assert_eq!(names[6], "kanso-2026-06-08.db");
    }
}
