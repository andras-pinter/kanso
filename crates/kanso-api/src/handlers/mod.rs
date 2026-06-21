pub mod board;
pub mod card;
pub mod column;
pub mod tag;

pub(crate) const DEFAULT_PAGE_LIMIT: u32 = 100;
pub(crate) const MAX_PAGE_LIMIT: u32 = 500;

/// Resolve raw `?limit`/`?offset` query params into the (limit, offset)
/// the repo layer expects. `limit` defaults to [`DEFAULT_PAGE_LIMIT`] and
/// is silently clamped to [`MAX_PAGE_LIMIT`] — over-asking is not an error.
pub(crate) fn resolve_page(limit: Option<u32>, offset: Option<u32>) -> (u32, u32) {
    (
        limit.unwrap_or(DEFAULT_PAGE_LIMIT).min(MAX_PAGE_LIMIT),
        offset.unwrap_or(0),
    )
}
