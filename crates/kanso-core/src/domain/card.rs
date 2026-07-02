use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Card {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub body_blocksuite: Option<Vec<u8>>,
    pub body_text: Option<String>,
    pub position: String,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
