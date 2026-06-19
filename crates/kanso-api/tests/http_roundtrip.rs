//! Integration tests: drive the axum router with a real sqlx pool to prove
//! the HTTP contract works end-to-end for every Phase 1 entity.

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use kanso_api::{router, AppState, BoardDto, CardDto, ColumnDto};
use kanso_core::db::{migrate, open};
use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn setup() -> (axum::Router, sqlx::SqlitePool, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("kanso.db");
    let pool = open(&db).await.unwrap();
    migrate(&pool).await.unwrap();
    let app = router(AppState { pool: pool.clone() });
    (app, pool, tmp)
}

fn req_json(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn req(method: &str, uri: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .body(Body::empty())
        .unwrap()
}

async fn body_json(res: axum::response::Response) -> Value {
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

#[tokio::test]
async fn healthz_responds_ok() {
    let (app, _pool, _tmp) = setup().await;
    let res = app.oneshot(req("GET", "/healthz")).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn board_crud_via_http() {
    let (app, _pool, _tmp) = setup().await;

    let res = app
        .clone()
        .oneshot(req_json("POST", "/boards", json!({"name": "Main"})))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let created: BoardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(created.name, "Main");

    let res = app
        .clone()
        .oneshot(req("GET", "/boards"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let listed: Vec<BoardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(listed.len(), 1);

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/boards/{}", created.id),
            json!({"name": "Renamed", "color": "#abc"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let patched: BoardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(patched.name, "Renamed");
    assert_eq!(patched.color.as_deref(), Some("#abc"));

    let res = app
        .clone()
        .oneshot(req("POST", &format!("/boards/{}/archive", created.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(req("GET", "/boards"))
        .await
        .unwrap();
    let active: Vec<BoardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert!(active.is_empty());

    let res = app
        .clone()
        .oneshot(req("GET", "/boards?include_archived=true"))
        .await
        .unwrap();
    let all: Vec<BoardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(all.len(), 1);

    let res = app
        .clone()
        .oneshot(req("POST", &format!("/boards/{}/unarchive", created.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(req("DELETE", &format!("/boards/{}", created.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn column_crud_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();

    let res = app
        .clone()
        .oneshot(req_json(
            "POST",
            &format!("/boards/{}/columns", board.id),
            json!({"name": "Todo", "color": "#aaa"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let col: ColumnDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(col.name, "Todo");
    assert_eq!(col.color.as_deref(), Some("#aaa"));

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/boards/{}/columns", board.id)))
        .await
        .unwrap();
    let cols: Vec<ColumnDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(cols.len(), 1);

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/columns/{}", col.id),
            json!({"color": null}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let patched: ColumnDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(patched.color.is_none());
    assert_eq!(patched.name, "Todo");

    let res = app
        .clone()
        .oneshot(req("POST", &format!("/columns/{}/archive", col.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .oneshot(req("POST", &format!("/columns/{}/unarchive", col.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn card_crud_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let column = ColumnRepo::create(&pool, &board.id, "Todo", None).await.unwrap();

    let res = app
        .clone()
        .oneshot(req_json(
            "POST",
            &format!("/columns/{}/cards", column.id),
            json!({"title": "from test"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let created: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(created.title, "from test");

    // Persisted via the shared pool.
    let from_db = CardRepo::list_by_column(&pool, &column.id, false).await.unwrap();
    assert_eq!(from_db.len(), 1);
    assert_eq!(from_db[0].id, created.id);

    // due_at: set, then clear via null.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", created.id),
            json!({"due_at": 1_700_000_000_000_i64}),
        ))
        .await
        .unwrap();
    let with_due: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(with_due.due_at, Some(1_700_000_000_000));

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", created.id),
            json!({"title": "renamed"}),
        ))
        .await
        .unwrap();
    let title_only: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(title_only.title, "renamed");
    assert_eq!(
        title_only.due_at,
        Some(1_700_000_000_000),
        "omitted due_at must be left untouched"
    );

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", created.id),
            json!({"due_at": null}),
        ))
        .await
        .unwrap();
    let cleared: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(cleared.due_at.is_none(), "null must clear due_at");
}

#[tokio::test]
async fn card_archive_round_trip_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let _b = CardRepo::create(&pool, &col.id, "b").await.unwrap();

    let res = app
        .clone()
        .oneshot(req("POST", &format!("/cards/{}/archive", a.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/columns/{}/cards", col.id)))
        .await
        .unwrap();
    let active: Vec<CardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(active.len(), 1);

    let res = app
        .clone()
        .oneshot(req(
            "GET",
            &format!("/columns/{}/cards?include_archived=true", col.id),
        ))
        .await
        .unwrap();
    let all: Vec<CardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(all.len(), 2);

    let res = app
        .oneshot(req("POST", &format!("/cards/{}/unarchive", a.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn card_move_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let c = CardRepo::create(&pool, &col.id, "c").await.unwrap();

    let res = app
        .clone()
        .oneshot(req_json(
            "POST",
            &format!("/cards/{}/move", c.id),
            json!({"target_column_id": col.id, "before": a.id, "after": b.id}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(req("GET", &format!("/columns/{}/cards", col.id)))
        .await
        .unwrap();
    let listed: Vec<CardDto> = serde_json::from_value(body_json(res).await).unwrap();
    let titles: Vec<_> = listed.iter().map(|c| c.title.clone()).collect();
    assert_eq!(titles, vec!["a", "c", "b"]);
}

#[tokio::test]
async fn create_card_rejects_blank_title() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();

    let res = app
        .oneshot(req_json(
            "POST",
            &format!("/columns/{}/cards", col.id),
            json!({"title": "   "}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn move_card_non_adjacent_returns_400() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let a = CardRepo::create(&pool, &col.id, "a").await.unwrap();
    let _b = CardRepo::create(&pool, &col.id, "b").await.unwrap();
    let c = CardRepo::create(&pool, &col.id, "c").await.unwrap();
    let d = CardRepo::create(&pool, &col.id, "d").await.unwrap();

    let res = app
        .oneshot(req_json(
            "POST",
            &format!("/cards/{}/move", d.id),
            json!({"target_column_id": col.id, "before": a.id, "after": c.id}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}
