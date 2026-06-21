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
    let col = ColumnRepo::create(&pool, &board.id, "Todo", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Write tests")
        .await
        .unwrap();

    let fetched = CardRepo::get(&pool, &card.id).await.unwrap().unwrap();
    assert_eq!(fetched.id, card.id);
    assert_eq!(fetched.title, "Write tests");
    assert_eq!(fetched.column_id, col.id);
    assert!(fetched.body_text.is_none());
    assert!(fetched.archived_at.is_none());

    let listed = CardRepo::list_by_column(&pool, &col.id, false)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, card.id);
}

#[tokio::test]
async fn test_card_body_fts_roundtrip() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Hello").await.unwrap();

    CardRepo::set_body(&pool, &card.id, b"\x00\x01\x02", "hello world rust")
        .await
        .unwrap();

    let hits = CardRepo::search(&pool, "rust", false).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, card.id);
    assert_eq!(hits[0].body_text.as_deref(), Some("hello world rust"));
    assert_eq!(hits[0].body_blocksuite.as_deref(), Some(&[0u8, 1, 2][..]));

    let miss = CardRepo::search(&pool, "python", false).await.unwrap();
    assert!(miss.is_empty());

    let title_hit = CardRepo::search(&pool, "Hello", false).await.unwrap();
    assert_eq!(title_hit.len(), 1);
}

#[tokio::test]
async fn test_updated_at_trigger() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let a = CardRepo::create(&pool, &col.id, "A").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "B").await.unwrap();

    CardRepo::archive(&pool, &a.id).await.unwrap();

    let listed = CardRepo::list_by_column(&pool, &col.id, false)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, b.id);

    CardRepo::set_body(&pool, &a.id, b"", "needle in haystack")
        .await
        .unwrap();
    CardRepo::set_body(&pool, &b.id, b"", "another needle here")
        .await
        .unwrap();
    let hits = CardRepo::search(&pool, "needle", false).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, b.id);
}

#[tokio::test]
async fn test_cascade_delete_column_removes_cards() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    CardRepo::create(&pool, &col.id, "T").await.unwrap();

    sqlx::query("DELETE FROM columns WHERE id = ?1")
        .bind(&col.id)
        .execute(&pool)
        .await
        .unwrap();

    let listed = CardRepo::list_by_column(&pool, &col.id, false)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    CardRepo::set_body(&pool, &card.id, b"", "needle text")
        .await
        .unwrap();

    BoardRepo::hard_delete(&pool, &board.id).await.unwrap();

    assert!(BoardRepo::get(&pool, &board.id).await.unwrap().is_none());
    assert!(ColumnRepo::get(&pool, &col.id).await.unwrap().is_none());
    assert!(CardRepo::get(&pool, &card.id).await.unwrap().is_none());
    let hits = CardRepo::search(&pool, "needle", false).await.unwrap();
    assert!(hits.is_empty(), "FTS row leaked after cascade delete");
}

#[tokio::test]
async fn test_column_crud_and_archive() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let c1 = ColumnRepo::create(&pool, &board.id, "Todo", Some("#aaa"))
        .await
        .unwrap();
    let c2 = ColumnRepo::create(&pool, &board.id, "Done", None)
        .await
        .unwrap();
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
    assert_eq!(
        all.len(),
        2,
        "include_archived must surface archived columns"
    );

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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let _b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let c = CardRepo::create(&pool, &col.id, "c").await.unwrap();
    let d = CardRepo::create(&pool, &col.id, "d").await.unwrap();

    // a and c are NOT adjacent (b is between them).
    let res = CardRepo::move_card(&pool, &d.id, &col.id, Some(&a.id), Some(&c.id)).await;
    assert!(matches!(res, Err(kanso_core::KansoError::InvalidMove(_))));
}

#[tokio::test]
async fn test_card_move_cross_column() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let src = ColumnRepo::create(&pool, &board.id, "Src", None)
        .await
        .unwrap();
    let dst = ColumnRepo::create(&pool, &board.id, "Dst", None)
        .await
        .unwrap();
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
    let dst_cards = CardRepo::list_by_column(&pool, &dst.id, false)
        .await
        .unwrap();
    assert_eq!(dst_cards.len(), 2);
    assert_eq!(dst_cards[1].id, card.id);
}

#[tokio::test]
async fn test_card_list_include_archived_toggle() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let _b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    CardRepo::archive(&pool, &a.id).await.unwrap();

    assert_eq!(
        CardRepo::list_by_column(&pool, &col.id, false)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        CardRepo::list_by_column(&pool, &col.id, true)
            .await
            .unwrap()
            .len(),
        2
    );

    CardRepo::unarchive(&pool, &a.id).await.unwrap();
    assert_eq!(
        CardRepo::list_by_column(&pool, &col.id, false)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn test_card_patch_body_text_clear() {
    use kanso_core::repo::CardPatch;
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
        Err(KansoError::NotFound {
            entity: "board",
            ..
        })
    ));
    assert!(matches!(
        BoardRepo::unarchive(&pool, missing).await,
        Err(KansoError::NotFound {
            entity: "board",
            ..
        })
    ));
    assert!(matches!(
        ColumnRepo::archive(&pool, missing).await,
        Err(KansoError::NotFound {
            entity: "column",
            ..
        })
    ));
    assert!(matches!(
        ColumnRepo::unarchive(&pool, missing).await,
        Err(KansoError::NotFound {
            entity: "column",
            ..
        })
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

// ---------- Phase 2: body get/set + FTS keep-in-sync ----------

#[tokio::test]
async fn test_card_body_get_returns_none_on_fresh_card() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Fresh").await.unwrap();

    let body = CardRepo::get_body(&pool, &card.id).await.unwrap();
    assert!(body.body_blocksuite.is_none());
    assert!(body.body_text.is_none());
    assert_eq!(body.updated_at, card.updated_at);
}

#[tokio::test]
async fn test_card_body_set_roundtrips_bytes() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let blob: Vec<u8> = (0..=255u8).chain([0u8, 0, 0, 0xff, 0xfe]).collect();
    CardRepo::set_body(&pool, &card.id, &blob, "carrots and beans")
        .await
        .unwrap();

    let body = CardRepo::get_body(&pool, &card.id).await.unwrap();
    assert_eq!(body.body_blocksuite.as_deref(), Some(&blob[..]));
    assert_eq!(body.body_text.as_deref(), Some("carrots and beans"));
    assert!(
        body.updated_at >= card.updated_at,
        "updated_at must advance: was {}, became {}",
        card.updated_at,
        body.updated_at
    );
}

#[tokio::test]
async fn test_card_body_set_updates_fts() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Lunch").await.unwrap();

    CardRepo::set_body(
        &pool,
        &card.id,
        b"binary-doesnt-matter",
        "find me with carrots",
    )
    .await
    .unwrap();

    let hits = CardRepo::search(&pool, "carrots", false).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, card.id);

    // Overwriting body with a string that lacks the keyword must drop the hit.
    CardRepo::set_body(&pool, &card.id, b"new-blob", "now it talks about beans")
        .await
        .unwrap();
    let still_carrots = CardRepo::search(&pool, "carrots", false).await.unwrap();
    assert!(
        still_carrots.is_empty(),
        "old keyword should not be findable after overwrite"
    );
    let beans = CardRepo::search(&pool, "beans", false).await.unwrap();
    assert_eq!(beans.len(), 1);
    assert_eq!(beans[0].id, card.id);
}

#[tokio::test]
async fn test_card_body_set_returns_not_found_for_unknown_id() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    assert!(matches!(
        CardRepo::set_body(&pool, "00000000000000000000000000", b"x", "y").await,
        Err(KansoError::NotFound { entity: "card", .. })
    ));
}

#[tokio::test]
async fn test_card_body_get_returns_not_found_for_unknown_id() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    assert!(matches!(
        CardRepo::get_body(&pool, "00000000000000000000000000").await,
        Err(KansoError::NotFound { entity: "card", .. })
    ));
}

// ---------- Phase 3: tags + card-tag links ----------

use kanso_core::repo::{TagPatch, TagRepo};

#[tokio::test]
async fn test_tag_create_and_list_ordering() {
    let pool = fixture_pool().await;
    TagRepo::create(&pool, "zeta", None).await.unwrap();
    TagRepo::create(&pool, "Alpha", Some("#fff")).await.unwrap();
    TagRepo::create(&pool, "beta", None).await.unwrap();

    let all = TagRepo::list(&pool, false).await.unwrap();
    assert_eq!(
        all.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["Alpha", "beta", "zeta"]
    );
}

#[tokio::test]
async fn test_tag_duplicate_name_conflicts() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    TagRepo::create(&pool, "bug", None).await.unwrap();
    let res = TagRepo::create(&pool, "bug", None).await;
    assert!(matches!(res, Err(KansoError::Conflict(_))), "got {res:?}");
}

#[tokio::test]
async fn test_tag_patch_clears_and_sets_color() {
    let pool = fixture_pool().await;
    let t = TagRepo::create(&pool, "ops", Some("#aaa")).await.unwrap();

    let renamed = TagRepo::update(
        &pool,
        &t.id,
        TagPatch {
            name: Some("Ops".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(renamed.name, "Ops");
    assert_eq!(renamed.color.as_deref(), Some("#aaa"));

    let recoloured = TagRepo::update(
        &pool,
        &t.id,
        TagPatch {
            color: Some(Some("#bbb".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(recoloured.color.as_deref(), Some("#bbb"));

    let cleared = TagRepo::update(
        &pool,
        &t.id,
        TagPatch {
            color: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(cleared.color.is_none());
}

#[tokio::test]
async fn test_tag_update_unique_violation_conflicts() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let a = TagRepo::create(&pool, "a", None).await.unwrap();
    let _b = TagRepo::create(&pool, "b", None).await.unwrap();
    let res = TagRepo::update(
        &pool,
        &a.id,
        TagPatch {
            name: Some("b".into()),
            ..Default::default()
        },
    )
    .await;
    assert!(matches!(res, Err(KansoError::Conflict(_))));
}

#[tokio::test]
async fn test_tag_archive_unarchive_and_404() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let t = TagRepo::create(&pool, "x", None).await.unwrap();
    TagRepo::archive(&pool, &t.id).await.unwrap();
    assert_eq!(TagRepo::list(&pool, false).await.unwrap().len(), 0);
    assert_eq!(TagRepo::list(&pool, true).await.unwrap().len(), 1);
    TagRepo::unarchive(&pool, &t.id).await.unwrap();
    assert_eq!(TagRepo::list(&pool, false).await.unwrap().len(), 1);

    let missing = "00000000000000000000000000";
    assert!(matches!(
        TagRepo::archive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "tag", .. })
    ));
    assert!(matches!(
        TagRepo::unarchive(&pool, missing).await,
        Err(KansoError::NotFound { entity: "tag", .. })
    ));
    assert!(matches!(
        TagRepo::get(&pool, missing).await,
        Err(KansoError::NotFound { entity: "tag", .. })
    ));
    assert!(matches!(
        TagRepo::delete(&pool, missing).await,
        Err(KansoError::NotFound { entity: "tag", .. })
    ));
}

#[tokio::test]
async fn test_tag_delete_cascades_card_tags() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let tag = TagRepo::create(&pool, "ops", None).await.unwrap();

    CardRepo::add_tag(&pool, &card.id, &tag.id).await.unwrap();
    assert_eq!(
        CardRepo::tags_for_card(&pool, &card.id, false)
            .await
            .unwrap()
            .len(),
        1
    );

    TagRepo::delete(&pool, &tag.id).await.unwrap();
    assert!(CardRepo::tags_for_card(&pool, &card.id, false)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn test_card_tag_link_idempotent_and_unlink_idempotent() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let tag = TagRepo::create(&pool, "ops", None).await.unwrap();

    CardRepo::add_tag(&pool, &card.id, &tag.id).await.unwrap();
    CardRepo::add_tag(&pool, &card.id, &tag.id).await.unwrap();
    assert_eq!(
        CardRepo::tags_for_card(&pool, &card.id, false)
            .await
            .unwrap()
            .len(),
        1
    );

    CardRepo::remove_tag(&pool, &card.id, &tag.id)
        .await
        .unwrap();
    CardRepo::remove_tag(&pool, &card.id, &tag.id)
        .await
        .unwrap();
    assert!(CardRepo::tags_for_card(&pool, &card.id, false)
        .await
        .unwrap()
        .is_empty());

    let missing = "00000000000000000000000000";
    assert!(matches!(
        CardRepo::add_tag(&pool, missing, &tag.id).await,
        Err(KansoError::NotFound { entity: "card", .. })
    ));
    assert!(matches!(
        CardRepo::add_tag(&pool, &card.id, missing).await,
        Err(KansoError::NotFound { entity: "tag", .. })
    ));
    assert!(matches!(
        CardRepo::tags_for_card(&pool, missing, false).await,
        Err(KansoError::NotFound { entity: "card", .. })
    ));
    assert!(matches!(
        CardRepo::cards_with_tag(&pool, missing, false).await,
        Err(KansoError::NotFound { entity: "tag", .. })
    ));
}

#[tokio::test]
async fn test_card_delete_cascades_card_tags() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let tag = TagRepo::create(&pool, "ops", None).await.unwrap();
    CardRepo::add_tag(&pool, &card.id, &tag.id).await.unwrap();

    sqlx::query("DELETE FROM cards WHERE id = ?1")
        .bind(&card.id)
        .execute(&pool)
        .await
        .unwrap();

    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM card_tags WHERE tag_id = ?1")
        .bind(&tag.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_cards_with_tag_orders_and_filters_archived() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let tag = TagRepo::create(&pool, "ops", None).await.unwrap();
    CardRepo::add_tag(&pool, &a.id, &tag.id).await.unwrap();
    CardRepo::add_tag(&pool, &b.id, &tag.id).await.unwrap();
    CardRepo::archive(&pool, &a.id).await.unwrap();

    let active = CardRepo::cards_with_tag(&pool, &tag.id, false)
        .await
        .unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, b.id);
    let all = CardRepo::cards_with_tag(&pool, &tag.id, true)
        .await
        .unwrap();
    assert_eq!(all.len(), 2);
}

// ---------- Phase 3: FTS5 search hardening ----------

#[tokio::test]
async fn test_search_empty_query_returns_empty() {
    let pool = fixture_pool().await;
    assert!(CardRepo::search(&pool, "", false).await.unwrap().is_empty());
    assert!(CardRepo::search(&pool, "   ", false)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn test_search_treats_fts_operators_as_literals() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let with_quote = CardRepo::create(&pool, &col.id, "needs \"quote\" here")
        .await
        .unwrap();
    let _other = CardRepo::create(&pool, &col.id, "totally separate")
        .await
        .unwrap();

    // FTS5 operators should NOT be parsed: querying with parens / NEAR shouldn't error.
    let star = CardRepo::search(&pool, "OR NEAR (", false).await.unwrap();
    assert!(
        star.is_empty(),
        "fts operators must not panic or match everything"
    );

    // Embedded double quotes in input must round-trip safely.
    let hit = CardRepo::search(&pool, "\"quote\"", false).await.unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].id, with_quote.id);
}

#[tokio::test]
async fn test_search_include_archived_toggle() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let a = CardRepo::create(&pool, &col.id, "carrot").await.unwrap();
    CardRepo::archive(&pool, &a.id).await.unwrap();

    assert!(CardRepo::search(&pool, "carrot", false)
        .await
        .unwrap()
        .is_empty());
    let all = CardRepo::search(&pool, "carrot", true).await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, a.id);
}

#[tokio::test]
async fn test_search_roundtrips_via_card_body() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Plain title")
        .await
        .unwrap();

    CardRepo::set_body(&pool, &card.id, b"y", "deeply buried tangerine word")
        .await
        .unwrap();
    let hits = CardRepo::search(&pool, "tangerine", false).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, card.id);
}

// ---------- Phase 3: column reorder ----------

#[tokio::test]
async fn test_column_move_to_end_and_between_neighbours() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let a = ColumnRepo::create(&pool, &board.id, "a", None)
        .await
        .unwrap();
    let b = ColumnRepo::create(&pool, &board.id, "b", None)
        .await
        .unwrap();
    let c = ColumnRepo::create(&pool, &board.id, "c", None)
        .await
        .unwrap();

    ColumnRepo::move_column(&pool, &b.id, None, None)
        .await
        .unwrap();
    let order: Vec<String> = ColumnRepo::list_by_board(&pool, &board.id, false)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(order, vec!["a", "c", "b"]);

    ColumnRepo::move_column(&pool, &c.id, Some(&b.id), None)
        .await
        .unwrap();
    let order: Vec<String> = ColumnRepo::list_by_board(&pool, &board.id, false)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(order, vec!["a", "b", "c"]);

    let res = ColumnRepo::move_column(&pool, &a.id, Some(&c.id), Some(&b.id)).await;
    assert!(matches!(res, Err(KansoError::InvalidMove(_))));
}

#[tokio::test]
async fn test_column_patch_color_and_move_via_repo() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let a = ColumnRepo::create(&pool, &board.id, "a", None)
        .await
        .unwrap();
    let b = ColumnRepo::create(&pool, &board.id, "b", Some("#aaa"))
        .await
        .unwrap();

    let recoloured = ColumnRepo::update(
        &pool,
        &a.id,
        ColumnPatch {
            color: Some(Some("#bbb".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(recoloured.color.as_deref(), Some("#bbb"));

    // Reorder: move b before a.
    ColumnRepo::move_column(&pool, &b.id, None, Some(&a.id))
        .await
        .unwrap();
    let order: Vec<String> = ColumnRepo::list_by_board(&pool, &board.id, false)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(order, vec!["b", "a"]);
}

#[tokio::test]
async fn test_tag_update_trims_and_rejects_empty() {
    use kanso_core::repo::TagPatch;
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let tag = TagRepo::create(&pool, "ops", None).await.unwrap();

    let err = TagRepo::update(
        &pool,
        &tag.id,
        TagPatch {
            name: Some("   ".to_string()),
            color: None,
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(err, KansoError::InvalidInput(_)), "got {err:?}");

    let updated = TagRepo::update(
        &pool,
        &tag.id,
        TagPatch {
            name: Some("  renamed  ".to_string()),
            color: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.name, "renamed");
}

#[tokio::test]
async fn test_tag_create_rejects_blank_name() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let err = TagRepo::create(&pool, "   ", None).await.unwrap_err();
    assert!(matches!(err, KansoError::InvalidInput(_)), "got {err:?}");
}

#[tokio::test]
async fn test_archived_tag_hidden_in_tags_for_card() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let tag_a = TagRepo::create(&pool, "alive", None).await.unwrap();
    let tag_b = TagRepo::create(&pool, "buried", None).await.unwrap();

    CardRepo::add_tag(&pool, &card.id, &tag_a.id).await.unwrap();
    CardRepo::add_tag(&pool, &card.id, &tag_b.id).await.unwrap();
    TagRepo::archive(&pool, &tag_b.id).await.unwrap();

    let visible = CardRepo::tags_for_card(&pool, &card.id, false)
        .await
        .unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].name, "alive");

    let all = CardRepo::tags_for_card(&pool, &card.id, true)
        .await
        .unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn test_link_archived_tag_rejected() {
    use kanso_core::KansoError;
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let tag = TagRepo::create(&pool, "dead", None).await.unwrap();
    TagRepo::archive(&pool, &tag.id).await.unwrap();

    let err = CardRepo::add_tag(&pool, &card.id, &tag.id)
        .await
        .unwrap_err();
    assert!(matches!(err, KansoError::InvalidInput(_)), "got {err:?}");

    // Linking succeeds once the tag is unarchived again.
    TagRepo::unarchive(&pool, &tag.id).await.unwrap();
    CardRepo::add_tag(&pool, &card.id, &tag.id).await.unwrap();
}

#[tokio::test]
async fn test_cards_with_tag_ordered_by_column_then_card_position() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let c1 = ColumnRepo::create(&pool, &board.id, "first", None)
        .await
        .unwrap();
    let c2 = ColumnRepo::create(&pool, &board.id, "second", None)
        .await
        .unwrap();
    let c3 = ColumnRepo::create(&pool, &board.id, "third", None)
        .await
        .unwrap();

    // Create cards in creation order: a in c1, b in c2, c in c3, plus a second
    // card in c2 so ordering within a column matters too.
    let card_a = CardRepo::create(&pool, &c1.id, "a").await.unwrap();
    let card_b1 = CardRepo::create(&pool, &c2.id, "b1").await.unwrap();
    let card_b2 = CardRepo::create(&pool, &c2.id, "b2").await.unwrap();
    let card_c = CardRepo::create(&pool, &c3.id, "c").await.unwrap();

    // Reorder columns: third → first → second (so creation order ≠ board order).
    ColumnRepo::move_column(&pool, &c3.id, None, Some(&c1.id))
        .await
        .unwrap();

    let tag = TagRepo::create(&pool, "lbl", None).await.unwrap();
    for cid in [&card_a.id, &card_b1.id, &card_b2.id, &card_c.id] {
        CardRepo::add_tag(&pool, cid, &tag.id).await.unwrap();
    }

    let cards = CardRepo::cards_with_tag(&pool, &tag.id, false)
        .await
        .unwrap();
    let names: Vec<&str> = cards.iter().map(|c| c.title.as_str()).collect();
    // Visual board order after reorder is: third (c), first (a), second (b1, b2)
    assert_eq!(names, vec!["c", "a", "b1", "b2"]);
}

// ---------- Wave 8b H1: search hides transitively archived hits ----------

#[tokio::test]
async fn test_search_hides_cards_in_archived_columns() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "needleA").await.unwrap();
    ColumnRepo::archive(&pool, &col.id).await.unwrap();

    assert!(CardRepo::search(&pool, "needleA", false)
        .await
        .unwrap()
        .is_empty());
    assert!(CardRepo::search_with_context(&pool, "needleA", false)
        .await
        .unwrap()
        .is_empty());

    let inc = CardRepo::search(&pool, "needleA", true).await.unwrap();
    assert_eq!(inc.len(), 1);
    assert_eq!(inc[0].id, card.id);
}

#[tokio::test]
async fn test_search_hides_cards_in_archived_boards() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "needleB").await.unwrap();
    BoardRepo::archive(&pool, &board.id).await.unwrap();

    assert!(CardRepo::search(&pool, "needleB", false)
        .await
        .unwrap()
        .is_empty());
    assert!(CardRepo::search_with_context(&pool, "needleB", false)
        .await
        .unwrap()
        .is_empty());

    let inc = CardRepo::search(&pool, "needleB", true).await.unwrap();
    assert_eq!(inc.len(), 1);
    assert_eq!(inc[0].id, card.id);
}

#[tokio::test]
async fn test_search_with_context_returns_live_card_in_live_board() {
    let pool = fixture_pool().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "Todo", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "needleC").await.unwrap();

    let hits = CardRepo::search_with_context(&pool, "needleC", false)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].card.id, card.id);
    assert_eq!(hits[0].column_id, col.id);
    assert_eq!(hits[0].board_id, board.id);
}

// ---------- Phase 4 W2: bulk card-tag links per board ----------

#[tokio::test]
async fn test_card_tags_for_board_returns_all_links_and_isolates_boards() {
    let pool = fixture_pool().await;

    let board = BoardRepo::create(&pool, "Main").await.unwrap();
    let col_live = ColumnRepo::create(&pool, &board.id, "Todo", None)
        .await
        .unwrap();
    let col_arch = ColumnRepo::create(&pool, &board.id, "Done", None)
        .await
        .unwrap();
    let c_live = CardRepo::create(&pool, &col_live.id, "alive").await.unwrap();
    let c_arch_card = CardRepo::create(&pool, &col_live.id, "archived-card")
        .await
        .unwrap();
    let c_in_arch_col = CardRepo::create(&pool, &col_arch.id, "in-arch-col")
        .await
        .unwrap();
    CardRepo::archive(&pool, &c_arch_card.id).await.unwrap();
    ColumnRepo::archive(&pool, &col_arch.id).await.unwrap();

    let t_live_a = TagRepo::create(&pool, "alpha", None).await.unwrap();
    let t_live_b = TagRepo::create(&pool, "beta", None).await.unwrap();
    let t_arch = TagRepo::create(&pool, "gamma", None).await.unwrap();

    // 6 links across live/archived cards/columns/tags.
    CardRepo::add_tag(&pool, &c_live.id, &t_live_a.id)
        .await
        .unwrap();
    CardRepo::add_tag(&pool, &c_live.id, &t_live_b.id)
        .await
        .unwrap();
    CardRepo::add_tag(&pool, &c_arch_card.id, &t_live_a.id)
        .await
        .unwrap();
    CardRepo::add_tag(&pool, &c_in_arch_col.id, &t_live_b.id)
        .await
        .unwrap();
    // Link the (now-archived) tag before archiving so we exercise inclusion.
    CardRepo::add_tag(&pool, &c_live.id, &t_arch.id).await.unwrap();
    TagRepo::archive(&pool, &t_arch.id).await.unwrap();

    // An unlinked card on the same board — must not appear.
    let _unlinked = CardRepo::create(&pool, &col_live.id, "naked").await.unwrap();
    // An unlinked tag — must not appear.
    let _unlinked_tag = TagRepo::create(&pool, "delta", None).await.unwrap();

    // A second board with its own link — must not leak.
    let other = BoardRepo::create(&pool, "Other").await.unwrap();
    let other_col = ColumnRepo::create(&pool, &other.id, "Todo", None)
        .await
        .unwrap();
    let other_card = CardRepo::create(&pool, &other_col.id, "elsewhere")
        .await
        .unwrap();
    CardRepo::add_tag(&pool, &other_card.id, &t_live_a.id)
        .await
        .unwrap();

    let links = CardRepo::card_tags_for_board(&pool, &board.id)
        .await
        .unwrap();
    let mut expected = vec![
        (c_live.id.clone(), t_live_a.id.clone()),
        (c_live.id.clone(), t_live_b.id.clone()),
        (c_live.id.clone(), t_arch.id.clone()),
        (c_arch_card.id.clone(), t_live_a.id.clone()),
        (c_in_arch_col.id.clone(), t_live_b.id.clone()),
    ];
    expected.sort();
    let mut got = links.clone();
    got.sort();
    assert_eq!(got, expected);

    // Cards / tags without links never surface.
    assert!(links.iter().all(|(cid, _)| cid != &_unlinked.id));
    assert!(links.iter().all(|(_, tid)| tid != &_unlinked_tag.id));
    // Second board's link never leaks.
    assert!(links.iter().all(|(cid, _)| cid != &other_card.id));

    // Empty board returns an empty Vec, not an error.
    let empty_board = BoardRepo::create(&pool, "Empty").await.unwrap();
    assert!(CardRepo::card_tags_for_board(&pool, &empty_board.id)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn boards_paged_with_tied_positions_is_stable_across_pages() {
    // Insert 4 boards, then force-tie their positions. With a stable
    // (position, id) order, paginating (0..2) and (2..4) must cover all
    // four with no overlap.
    let pool = fixture_pool().await;
    for n in ["A", "B", "C", "D"] {
        BoardRepo::create(&pool, n).await.unwrap();
    }
    sqlx::query("UPDATE boards SET position = 0.0")
        .execute(&pool)
        .await
        .unwrap();

    let p0 = BoardRepo::list_all_paged(&pool, false, 2, 0).await.unwrap();
    let p1 = BoardRepo::list_all_paged(&pool, false, 2, 2).await.unwrap();
    assert_eq!(p0.len(), 2);
    assert_eq!(p1.len(), 2);

    let ids0: std::collections::HashSet<_> = p0.iter().map(|b| b.id.clone()).collect();
    let ids1: std::collections::HashSet<_> = p1.iter().map(|b| b.id.clone()).collect();
    assert!(ids0.is_disjoint(&ids1), "pages overlap: {ids0:?} vs {ids1:?}");
    let union: std::collections::HashSet<_> = ids0.union(&ids1).cloned().collect();
    assert_eq!(union.len(), 4, "union must cover all 4 boards");
}

// ---- BoardFull / full_with_context ------------------------------------------

mod board_full {
    use super::*;
    use kanso_core::repo::TagRepo;
    use kanso_core::KansoError;

    #[tokio::test]
    async fn test_full_with_context_returns_nested_structure_and_dedupes_tags() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let c1 = ColumnRepo::create(&pool, &board.id, "Todo", None).await.unwrap();
        let c2 = ColumnRepo::create(&pool, &board.id, "Done", None).await.unwrap();

        let k1 = CardRepo::create(&pool, &c1.id, "k1").await.unwrap();
        let k2 = CardRepo::create(&pool, &c1.id, "k2").await.unwrap();
        let k3 = CardRepo::create(&pool, &c2.id, "k3").await.unwrap();

        let alpha = TagRepo::create(&pool, "alpha", None).await.unwrap();
        let beta = TagRepo::create(&pool, "beta", None).await.unwrap();
        CardRepo::add_tag(&pool, &k1.id, &alpha.id).await.unwrap();
        CardRepo::add_tag(&pool, &k1.id, &beta.id).await.unwrap();
        CardRepo::add_tag(&pool, &k2.id, &beta.id).await.unwrap();
        CardRepo::add_tag(&pool, &k3.id, &alpha.id).await.unwrap();

        let full = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();

        assert_eq!(full.board.id, board.id);
        assert_eq!(full.columns.len(), 2);
        assert_eq!(full.columns[0].column.id, c1.id);
        assert_eq!(full.columns[1].column.id, c2.id);
        assert_eq!(full.columns[0].cards.len(), 2);
        assert_eq!(full.columns[1].cards.len(), 1);
        assert_eq!(full.columns[0].cards[0].card.id, k1.id);
        assert_eq!(full.columns[0].cards[1].card.id, k2.id);

        let mut k1_tags = full.columns[0].cards[0].tag_ids.clone();
        k1_tags.sort();
        let mut expected = vec![alpha.id.clone(), beta.id.clone()];
        expected.sort();
        assert_eq!(k1_tags, expected);
        assert_eq!(full.columns[0].cards[1].tag_ids, vec![beta.id.clone()]);
        assert_eq!(full.columns[1].cards[0].tag_ids, vec![alpha.id.clone()]);

        assert_eq!(full.tags.len(), 2, "tags must be deduped");
        let tag_ids: std::collections::HashSet<_> = full.tags.iter().map(|t| t.id.clone()).collect();
        assert!(tag_ids.contains(&alpha.id));
        assert!(tag_ids.contains(&beta.id));
    }

    #[tokio::test]
    async fn test_full_with_context_archived_filtering() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let visible_col = ColumnRepo::create(&pool, &board.id, "Visible", None)
            .await
            .unwrap();
        let archived_col = ColumnRepo::create(&pool, &board.id, "Hidden", None)
            .await
            .unwrap();
        let live_card = CardRepo::create(&pool, &visible_col.id, "alive").await.unwrap();
        let dead_card = CardRepo::create(&pool, &visible_col.id, "dead").await.unwrap();
        let _orphan = CardRepo::create(&pool, &archived_col.id, "orphan").await.unwrap();

        let archived_tag = TagRepo::create(&pool, "ghost", None).await.unwrap();
        let live_tag = TagRepo::create(&pool, "shown", None).await.unwrap();
        CardRepo::add_tag(&pool, &dead_card.id, &archived_tag.id).await.unwrap();
        CardRepo::add_tag(&pool, &live_card.id, &live_tag.id).await.unwrap();

        CardRepo::archive(&pool, &dead_card.id).await.unwrap();
        ColumnRepo::archive(&pool, &archived_col.id).await.unwrap();

        let visible = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert_eq!(visible.columns.len(), 1);
        assert_eq!(visible.columns[0].column.id, visible_col.id);
        assert_eq!(visible.columns[0].cards.len(), 1);
        assert_eq!(visible.columns[0].cards[0].card.id, live_card.id);
        assert_eq!(visible.tags.len(), 1, "tag only on archived card should be hidden");
        assert_eq!(visible.tags[0].id, live_tag.id);

        let everything = BoardRepo::full_with_context(&pool, &board.id, true)
            .await
            .unwrap();
        assert_eq!(everything.columns.len(), 2);
        let card_count: usize = everything.columns.iter().map(|c| c.cards.len()).sum();
        assert_eq!(card_count, 3);
        assert_eq!(everything.tags.len(), 2);
    }

    #[tokio::test]
    async fn test_full_with_context_404_for_unknown_board() {
        let pool = fixture_pool().await;
        let err = BoardRepo::full_with_context(&pool, "missing-id", false)
            .await
            .unwrap_err();
        assert!(matches!(err, KansoError::NotFound { entity: "board", .. }));
    }

    #[tokio::test]
    async fn test_full_with_context_409_over_cap() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "Huge").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "stuff", None).await.unwrap();

        // 1001 cards via raw INSERTs — fastest path to bust the cap.
        let mut tx = pool.begin().await.unwrap();
        for i in 0..1001 {
            sqlx::query(
                "INSERT INTO cards (id, column_id, title, position, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, 0, 0)",
            )
            .bind(format!("card-{i:04}"))
            .bind(&col.id)
            .bind(format!("c{i}"))
            .bind(format!("{i:05}"))
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();

        let err = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap_err();
        assert!(
            matches!(err, KansoError::Conflict(_)),
            "expected Conflict, got {err:?}"
        );
        let msg = err.to_string();
        assert!(msg.contains("1000"), "got: {msg}");
        assert!(msg.contains("too large"), "got: {msg}");
    }

    #[tokio::test]
    async fn test_full_with_context_empty_board_returns_empty_columns_and_tags() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "Lonely").await.unwrap();
        let full = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert_eq!(full.board.id, board.id);
        assert!(full.columns.is_empty());
        assert!(full.tags.is_empty());
    }

    /// Boundary check: 1000 cards must pass; 1001 must 409.
    #[tokio::test]
    async fn test_full_with_context_exact_cap_boundary() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "Edge").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "c", None).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        for i in 0..1000 {
            sqlx::query(
                "INSERT INTO cards (id, column_id, title, position, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, 0, 0)",
            )
            .bind(format!("card-{i:04}"))
            .bind(&col.id)
            .bind(format!("c{i}"))
            .bind(format!("{i:05}"))
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();

        let ok = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert_eq!(ok.columns[0].cards.len(), 1000);

        sqlx::query(
            "INSERT INTO cards (id, column_id, title, position, created_at, updated_at) \
             VALUES ('card-1000', ?1, 'one more', '99999', 0, 0)",
        )
        .bind(&col.id)
        .execute(&pool)
        .await
        .unwrap();
        let err = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap_err();
        assert!(matches!(err, KansoError::Conflict(_)), "got {err:?}");
    }

    /// Active column whose cards are all archived → column appears with empty
    /// cards array, not omitted.
    #[tokio::test]
    async fn test_full_with_context_active_column_with_only_archived_cards() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "Active", None).await.unwrap();
        let c1 = CardRepo::create(&pool, &col.id, "x").await.unwrap();
        let c2 = CardRepo::create(&pool, &col.id, "y").await.unwrap();
        CardRepo::archive(&pool, &c1.id).await.unwrap();
        CardRepo::archive(&pool, &c2.id).await.unwrap();

        let snap = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert_eq!(snap.columns.len(), 1);
        assert_eq!(snap.columns[0].column.id, col.id);
        assert!(snap.columns[0].cards.is_empty());
    }

    /// Archived column with active cards → column hidden entirely, cards
    /// don't leak through a different column's slot.
    #[tokio::test]
    async fn test_full_with_context_archived_column_hides_its_cards() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let hidden = ColumnRepo::create(&pool, &board.id, "Hidden", None).await.unwrap();
        let _live = CardRepo::create(&pool, &hidden.id, "still here").await.unwrap();
        ColumnRepo::archive(&pool, &hidden.id).await.unwrap();

        let snap = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert!(snap.columns.is_empty());
        let total_cards: usize = snap.columns.iter().map(|c| c.cards.len()).sum();
        assert_eq!(total_cards, 0);
    }

    /// 100 visible + 900 archived cards × 15 tags each ≈ 15_000 raw links —
    /// the unfiltered link query would 409, but the visible-filtered query
    /// only sees ~1500 and succeeds. Guards #2.
    #[tokio::test]
    async fn test_full_with_context_archive_heavy_does_not_trip_link_cap() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "Big").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "c", None).await.unwrap();

        let mut tag_ids = Vec::with_capacity(15);
        for i in 0..15 {
            let t = TagRepo::create(&pool, &format!("t{i:02}"), None).await.unwrap();
            tag_ids.push(t.id);
        }

        let mut tx = pool.begin().await.unwrap();
        for i in 0..1000 {
            let archived = if i < 100 { "NULL" } else { "1" };
            sqlx::query(&format!(
                "INSERT INTO cards (id, column_id, title, position, created_at, updated_at, archived_at) \
                 VALUES (?1, ?2, ?3, ?4, 0, 0, {archived})",
            ))
            .bind(format!("card-{i:04}"))
            .bind(&col.id)
            .bind(format!("c{i}"))
            .bind(format!("{i:05}"))
            .execute(&mut *tx)
            .await
            .unwrap();
            for tid in &tag_ids {
                sqlx::query(
                    "INSERT INTO card_tags (card_id, tag_id) VALUES (?1, ?2)",
                )
                .bind(format!("card-{i:04}"))
                .bind(tid)
                .execute(&mut *tx)
                .await
                .unwrap();
            }
        }
        tx.commit().await.unwrap();

        let snap = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert_eq!(snap.columns.len(), 1);
        assert_eq!(snap.columns[0].cards.len(), 100);
        assert_eq!(snap.tags.len(), 15);
    }

    /// Archived tag linked from a visible card: hidden from top-level `tags`
    /// AND stripped from the card's `tag_ids` so no dangling references.
    #[tokio::test]
    async fn test_full_with_context_strips_archived_tag_references() {
        let pool = fixture_pool().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "c", None).await.unwrap();
        let card = CardRepo::create(&pool, &col.id, "k").await.unwrap();
        let active = TagRepo::create(&pool, "active", None).await.unwrap();
        let ghost = TagRepo::create(&pool, "ghost", None).await.unwrap();
        CardRepo::add_tag(&pool, &card.id, &active.id).await.unwrap();
        CardRepo::add_tag(&pool, &card.id, &ghost.id).await.unwrap();
        TagRepo::archive(&pool, &ghost.id).await.unwrap();

        let filtered = BoardRepo::full_with_context(&pool, &board.id, false)
            .await
            .unwrap();
        assert_eq!(filtered.tags.len(), 1);
        assert_eq!(filtered.tags[0].id, active.id);
        assert_eq!(
            filtered.columns[0].cards[0].tag_ids,
            vec![active.id.clone()],
            "archived tag id must be stripped from card.tag_ids"
        );

        let unfiltered = BoardRepo::full_with_context(&pool, &board.id, true)
            .await
            .unwrap();
        assert_eq!(unfiltered.tags.len(), 2);
        let mut ids = unfiltered.columns[0].cards[0].tag_ids.clone();
        ids.sort();
        let mut expected = vec![active.id.clone(), ghost.id.clone()];
        expected.sort();
        assert_eq!(ids, expected);
    }
}
