//! Integration test: posts to the axum router against a real sqlx pool
//! backed by a tempfile DB, then verifies the card landed via a direct
//! repo read. Proves the router is genuinely backed by the shared pool.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use kanso_api::{router, AppState, CardDto};
use kanso_core::db::{migrate, open};
use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo};
use tower::ServiceExt;

#[tokio::test]
async fn post_card_persists_via_shared_pool() {
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("kanso.db");

    let pool = open(&db).await.unwrap();
    migrate(&pool).await.unwrap();
    let board = BoardRepo::create(&pool, "Test").await.unwrap();
    let column = ColumnRepo::create(&pool, &board.id, "Todo").await.unwrap();

    let app = router(AppState { pool: pool.clone() });

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/columns/{}/cards", column.id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"title":"from test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let created: CardDto = serde_json::from_slice(&body).unwrap();
    assert_eq!(created.title, "from test");
    assert_eq!(created.column_id, column.id);

    let from_db = CardRepo::list_by_column(&pool, &column.id).await.unwrap();
    assert_eq!(from_db.len(), 1);
    assert_eq!(from_db[0].id, created.id);
    assert_eq!(from_db[0].title, "from test");
}
