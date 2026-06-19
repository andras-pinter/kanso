#![allow(clippy::unwrap_used)]

use kanso_core::db::{migrate, open_memory};
use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo};

async fn fixture_pool() -> sqlx::SqlitePool {
    let pool = open_memory().await.unwrap();
    migrate(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn test_card_create_and_fetch() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "Inbox").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "Todo").await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "Write tests")
        .await
        .unwrap();

    let fetched = CardRepo::get(&pool, &card.id).await.unwrap();
    assert_eq!(fetched.id, card.id);
    assert_eq!(fetched.title, "Write tests");
    assert_eq!(fetched.column_id, col.id);
    assert!(fetched.body_text.is_none());
    assert!(fetched.archived_at.is_none());

    let listed = CardRepo::list_by_column(&pool, &col.id).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, card.id);
}

#[tokio::test]
async fn test_card_body_fts_roundtrip() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C").await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "Hello").await.unwrap();

    CardRepo::set_body(&pool, &card.id, b"\x00\x01\x02", "hello world rust")
        .await
        .unwrap();

    let hits = CardRepo::search(&pool, "rust").await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, card.id);
    assert_eq!(hits[0].body_text.as_deref(), Some("hello world rust"));
    assert_eq!(hits[0].body_blocksuite.as_deref(), Some(&[0u8, 1, 2][..]));

    let miss = CardRepo::search(&pool, "python").await.unwrap();
    assert!(miss.is_empty());

    let title_hit = CardRepo::search(&pool, "Hello").await.unwrap();
    assert_eq!(title_hit.len(), 1);
}

#[tokio::test]
async fn test_updated_at_trigger() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C").await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let before = card.updated_at;

    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    sqlx::query("UPDATE cards SET title = 'T2' WHERE id = ?1")
        .bind(&card.id)
        .execute(&pool)
        .await
        .unwrap();

    let after = CardRepo::get(&pool, &card.id).await.unwrap();
    assert!(
        after.updated_at > before,
        "updated_at not bumped: before={before}, after={}",
        after.updated_at
    );
}

#[tokio::test]
async fn test_soft_delete_excluded_from_list() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C").await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "A").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "B").await.unwrap();

    CardRepo::archive(&pool, &a.id).await.unwrap();

    let listed = CardRepo::list_by_column(&pool, &col.id).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, b.id);

    CardRepo::set_body(&pool, &a.id, b"", "needle in haystack")
        .await
        .unwrap();
    CardRepo::set_body(&pool, &b.id, b"", "another needle here")
        .await
        .unwrap();
    let hits = CardRepo::search(&pool, "needle").await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, b.id);
}

#[tokio::test]
async fn test_cascade_delete_column_removes_cards() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C").await.unwrap();
    CardRepo::create(&pool, &col.id, "T").await.unwrap();

    sqlx::query("DELETE FROM columns WHERE id = ?1")
        .bind(&col.id)
        .execute(&pool)
        .await
        .unwrap();

    let listed = CardRepo::list_by_column(&pool, &col.id).await.unwrap();
    assert!(listed.is_empty());
}
