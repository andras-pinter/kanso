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
    let col = ColumnRepo::create(&pool, &board.id, "Todo", None).await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "Write tests")
        .await
        .unwrap();

    let fetched = CardRepo::get(&pool, &card.id).await.unwrap().unwrap();
    assert_eq!(fetched.id, card.id);
    assert_eq!(fetched.title, "Write tests");
    assert_eq!(fetched.column_id, col.id);
    assert!(fetched.body_text.is_none());
    assert!(fetched.archived_at.is_none());

    let listed = CardRepo::list_by_column(&pool, &col.id, false).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, card.id);
}

#[tokio::test]
async fn test_card_body_fts_roundtrip() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let before = card.updated_at;

    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    sqlx::query("UPDATE cards SET title = 'T2' WHERE id = ?1")
        .bind(&card.id)
        .execute(&pool)
        .await
        .unwrap();

    let after = CardRepo::get(&pool, &card.id).await.unwrap().unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "A").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "B").await.unwrap();

    CardRepo::archive(&pool, &a.id).await.unwrap();

    let listed = CardRepo::list_by_column(&pool, &col.id, false).await.unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    CardRepo::create(&pool, &col.id, "T").await.unwrap();

    sqlx::query("DELETE FROM columns WHERE id = ?1")
        .bind(&col.id)
        .execute(&pool)
        .await
        .unwrap();

    let listed = CardRepo::list_by_column(&pool, &col.id, false).await.unwrap();
    assert!(listed.is_empty());
}

// ---------- Phase 1: new CRUD + move tests ----------

use kanso_core::repo::{BoardPatch, CardPatch, ColumnPatch};

#[tokio::test]
async fn test_board_full_crud() {
    let pool = fixture_pool().await;
    let a = BoardRepo::create(&pool, "A").await.unwrap();
    let b = BoardRepo::create(&pool, "B").await.unwrap();

    let listed = BoardRepo::list_all(&pool, false).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed[0].position < listed[1].position);

    let updated = BoardRepo::update(
        &pool,
        &a.id,
        BoardPatch {
            name: Some("A2".into()),
            color: Some(Some("#fff".into())),
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.name, "A2");
    assert_eq!(updated.color.as_deref(), Some("#fff"));

    BoardRepo::archive(&pool, &b.id).await.unwrap();
    assert_eq!(BoardRepo::list_all(&pool, false).await.unwrap().len(), 1);
    assert_eq!(BoardRepo::list_all(&pool, true).await.unwrap().len(), 2);

    BoardRepo::unarchive(&pool, &b.id).await.unwrap();
    assert_eq!(BoardRepo::list_all(&pool, false).await.unwrap().len(), 2);

    BoardRepo::hard_delete(&pool, &a.id).await.unwrap();
    assert!(BoardRepo::get(&pool, &a.id).await.unwrap().is_none());
}

#[tokio::test]
async fn test_board_cascade_delete_wipes_columns_and_cards() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    CardRepo::set_body(&pool, &card.id, b"", "needle text")
        .await
        .unwrap();

    BoardRepo::hard_delete(&pool, &board.id).await.unwrap();

    assert!(BoardRepo::get(&pool, &board.id).await.unwrap().is_none());
    assert!(ColumnRepo::get(&pool, &col.id).await.unwrap().is_none());
    assert!(CardRepo::get(&pool, &card.id).await.unwrap().is_none());
    let hits = CardRepo::search(&pool, "needle").await.unwrap();
    assert!(hits.is_empty(), "FTS row leaked after cascade delete");
}

#[tokio::test]
async fn test_column_crud_and_archive() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let c1 = ColumnRepo::create(&pool, &board.id, "Todo", Some("#aaa"))
        .await
        .unwrap();
    let c2 = ColumnRepo::create(&pool, &board.id, "Done", None).await.unwrap();
    assert!(c1.position < c2.position);

    let updated = ColumnRepo::update(
        &pool,
        &c1.id,
        ColumnPatch {
            name: Some("WIP".into()),
            color: Some(None),
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.name, "WIP");
    assert!(updated.color.is_none());

    ColumnRepo::archive(&pool, &c2.id).await.unwrap();
    let active = ColumnRepo::list_by_board(&pool, &board.id, false)
        .await
        .unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, c1.id);
    let all = ColumnRepo::list_by_board(&pool, &board.id, true)
        .await
        .unwrap();
    assert_eq!(all.len(), 2, "include_archived must surface archived columns");

    ColumnRepo::unarchive(&pool, &c2.id).await.unwrap();
    let active = ColumnRepo::list_by_board(&pool, &board.id, false)
        .await
        .unwrap();
    assert_eq!(active.len(), 2);
}

#[tokio::test]
async fn test_card_patch_partial_and_due_at_clear() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let with_due = CardRepo::update(
        &pool,
        &card.id,
        CardPatch {
            due_at: Some(Some(1_700_000_000_000)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(with_due.due_at, Some(1_700_000_000_000));
    assert_eq!(with_due.title, "T");

    let title_only = CardRepo::update(
        &pool,
        &card.id,
        CardPatch {
            title: Some("T2".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(title_only.title, "T2");
    assert_eq!(title_only.due_at, Some(1_700_000_000_000));

    let cleared = CardRepo::update(
        &pool,
        &card.id,
        CardPatch {
            due_at: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(cleared.due_at.is_none());
    assert_eq!(cleared.title, "T2");
}

#[tokio::test]
async fn test_card_move_within_column_to_end() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let c = CardRepo::create(&pool, &col.id, "c").await.unwrap();

    // Move b to end.
    CardRepo::move_card(&pool, &b.id, &col.id, None, None)
        .await
        .unwrap();

    let order: Vec<String> = CardRepo::list_by_column(&pool, &col.id, false)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.title)
        .collect();
    assert_eq!(order, vec!["a", "c", "b"]);
    let _ = (a, c);
}

#[tokio::test]
async fn test_card_move_between_adjacent_neighbours() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let c = CardRepo::create(&pool, &col.id, "c").await.unwrap();

    // Move c between a and b.
    CardRepo::move_card(&pool, &c.id, &col.id, Some(&a.id), Some(&b.id))
        .await
        .unwrap();

    let titles: Vec<String> = CardRepo::list_by_column(&pool, &col.id, false)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.title)
        .collect();
    assert_eq!(titles, vec!["a", "c", "b"]);
}

#[tokio::test]
async fn test_card_move_rejects_non_adjacent_neighbours() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let _b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let c = CardRepo::create(&pool, &col.id, "c").await.unwrap();
    let d = CardRepo::create(&pool, &col.id, "d").await.unwrap();

    // a and c are NOT adjacent (b is between them).
    let res = CardRepo::move_card(&pool, &d.id, &col.id, Some(&a.id), Some(&c.id)).await;
    assert!(matches!(
        res,
        Err(kanso_core::KansoError::InvalidMove(_))
    ));
}

#[tokio::test]
async fn test_card_move_cross_column() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let src = ColumnRepo::create(&pool, &board.id, "Src", None).await.unwrap();
    let dst = ColumnRepo::create(&pool, &board.id, "Dst", None).await.unwrap();
    let card = CardRepo::create(&pool, &src.id, "T").await.unwrap();
    CardRepo::create(&pool, &dst.id, "X").await.unwrap();

    let moved = CardRepo::move_card(&pool, &card.id, &dst.id, None, None)
        .await
        .unwrap();
    assert_eq!(moved.column_id, dst.id);

    assert!(CardRepo::list_by_column(&pool, &src.id, false)
        .await
        .unwrap()
        .is_empty());
    let dst_cards = CardRepo::list_by_column(&pool, &dst.id, false).await.unwrap();
    assert_eq!(dst_cards.len(), 2);
    assert_eq!(dst_cards[1].id, card.id);
}

#[tokio::test]
async fn test_card_list_include_archived_toggle() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let _b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    CardRepo::archive(&pool, &a.id).await.unwrap();

    assert_eq!(
        CardRepo::list_by_column(&pool, &col.id, false).await.unwrap().len(),
        1
    );
    assert_eq!(
        CardRepo::list_by_column(&pool, &col.id, true).await.unwrap().len(),
        2
    );

    CardRepo::unarchive(&pool, &a.id).await.unwrap();
    assert_eq!(
        CardRepo::list_by_column(&pool, &col.id, false).await.unwrap().len(),
        2
    );
}

#[tokio::test]
async fn test_card_patch_body_text_clear() {
    use kanso_core::repo::CardPatch;
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let with_body = CardRepo::update(
        &pool,
        &card.id,
        CardPatch {
            body_text: Some(Some("notes go here".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(with_body.body_text.as_deref(), Some("notes go here"));

    let untouched = CardRepo::update(
        &pool,
        &card.id,
        CardPatch {
            title: Some("T2".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(untouched.body_text.as_deref(), Some("notes go here"));

    let cleared = CardRepo::update(
        &pool,
        &card.id,
        CardPatch {
            body_text: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(cleared.body_text.is_none());
}

#[tokio::test]
async fn test_archive_missing_id_returns_not_found() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;

    let missing = "00000000000000000000000000";
    assert!(matches!(
        BoardRepo::archive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "board", .. })
    ));
    assert!(matches!(
        BoardRepo::unarchive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "board", .. })
    ));
    assert!(matches!(
        ColumnRepo::archive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "column", .. })
    ));
    assert!(matches!(
        ColumnRepo::unarchive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "column", .. })
    ));
    assert!(matches!(
        CardRepo::archive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "card", .. })
    ));
    assert!(matches!(
        CardRepo::unarchive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "card", .. })
    ));
}
