use thiserror::Error;

#[derive(Debug, Error)]
pub enum KansoError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("{entity} not found: {id}")]
    NotFound { entity: &'static str, id: String },

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("invalid move: {0}")]
    InvalidMove(String),
}

pub type Result<T> = std::result::Result<T, KansoError>;
