use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Column {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub position: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
