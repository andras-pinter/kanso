pub mod board;
pub mod card;
pub mod column;
pub mod tag;

pub use board::{BoardPatch, BoardRepo};
pub use card::{CardBody, CardPatch, CardRepo};
pub use column::{ColumnPatch, ColumnRepo};
pub use tag::{TagPatch, TagRepo};

pub(crate) fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn new_id() -> String {
    ulid::Ulid::new().to_string()
}
