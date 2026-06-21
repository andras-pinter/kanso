//! Integration tests: drive the axum router with a real sqlx pool to prove
//! the HTTP contract works end-to-end for every Phase 1 entity.

#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use kanso_api::{router, AppState, BoardDto, CardDto, ColumnDto};
use kanso_core::db::{migrate, open};
use kanso_core::repo::{BoardRepo, CardRepo, ColumnRepo};
use serde_json::{json, Value};
use tower::ServiceExt;

const TEST_TOKEN: &str = "test-token-roundtrip";
const TEST_HOST: &str = "127.0.0.1:9999";

async fn setup() -> (axum::Router, sqlx::SqlitePool, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("kanso.db");
    let pool = open(&db).await.unwrap();
    migrate(&pool).await.unwrap();
    let app = router(AppState {
        pool: pool.clone(),
        token: Arc::from(TEST_TOKEN),
    });
    (app, pool, tmp)
}

fn req_json(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("host", TEST_HOST)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn req(method: &str, uri: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("host", TEST_HOST)
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap()
}

fn req_no_auth(method: &str, uri: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("host", TEST_HOST)
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
    let res = app.oneshot(req_no_auth("GET", "/healthz")).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn healthz_no_auth_still_ok() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/healthz")
                .header("host", TEST_HOST)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn boards_list_without_auth_returns_401() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .oneshot(req_no_auth("GET", "/boards"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let v = body_json(res).await;
    assert_eq!(v["error"], "unauthorized");
}

#[tokio::test]
async fn boards_list_with_wrong_token_returns_401() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/boards")
                .header("host", TEST_HOST)
                .header("authorization", "Bearer not-the-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let v = body_json(res).await;
    assert_eq!(v["error"], "unauthorized");
}

#[tokio::test]
async fn boards_list_with_correct_token_returns_200() {
    let (app, _pool, _tmp) = setup().await;
    let res = app.oneshot(req("GET", "/boards")).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn boards_list_with_malformed_auth_returns_401() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/boards")
                .header("host", TEST_HOST)
                .header("authorization", TEST_TOKEN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn boards_create_without_auth_returns_401() {
    let (app, pool, _tmp) = setup().await;
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/boards")
                .header("host", TEST_HOST)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"name": "Should Not Land"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM boards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
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

    let res = app.clone().oneshot(req("GET", "/boards")).await.unwrap();
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

    let res = app.clone().oneshot(req("GET", "/boards")).await.unwrap();
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
    let column = ColumnRepo::create(&pool, &board.id, "Todo", None)
        .await
        .unwrap();

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
    let from_db = CardRepo::list_by_column(&pool, &column.id, false)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();

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
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
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

#[tokio::test]
async fn card_body_text_clear_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    // Set body_text via PATCH.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", card.id),
            json!({"body_text": "scratch"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let after: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(after.body_text.as_deref(), Some("scratch"));

    // Omitting body_text leaves it untouched.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", card.id),
            json!({"title": "T2"}),
        ))
        .await
        .unwrap();
    let after: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(
        after.body_text.as_deref(),
        Some("scratch"),
        "omit must leave body_text untouched"
    );

    // Explicit null clears it.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", card.id),
            json!({"body_text": null}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let after: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(after.body_text.is_none(), "null must clear body_text");
}

#[tokio::test]
async fn list_columns_include_archived_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let c1 = ColumnRepo::create(&pool, &board.id, "Active", None)
        .await
        .unwrap();
    let c2 = ColumnRepo::create(&pool, &board.id, "Hidden", None)
        .await
        .unwrap();
    ColumnRepo::archive(&pool, &c2.id).await.unwrap();

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/boards/{}/columns", board.id)))
        .await
        .unwrap();
    let active: Vec<ColumnDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, c1.id);

    let res = app
        .clone()
        .oneshot(req(
            "GET",
            &format!("/boards/{}/columns?include_archived=true", board.id),
        ))
        .await
        .unwrap();
    let all: Vec<ColumnDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn archive_missing_card_returns_404() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .oneshot(req("POST", "/cards/00000000000000000000000000/archive"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_card_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Pick").await.unwrap();

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}", card.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let got: CardDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(got.id, card.id);
    assert_eq!(got.title, "Pick");
    assert_eq!(got.column_id, col.id);

    let miss = app
        .oneshot(req("GET", "/cards/00000000000000000000000000"))
        .await
        .unwrap();
    assert_eq!(miss.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn card_body_put_get_roundtrip_via_http() {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine as _;

    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Body").await.unwrap();

    // Fresh card: both blob fields null.
    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/body", card.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let fresh: kanso_api::CardBodyDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(fresh.body_blocksuite_b64.is_none());
    assert!(fresh.body_text.is_none());

    // Round-trip a real-ish blob with bytes a JSON string cannot hold.
    let blob: Vec<u8> = (0..=255u8).collect();
    let blob_b64 = B64.encode(&blob);
    let res = app
        .clone()
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            json!({
                "body_blocksuite_b64": blob_b64,
                "body_text": "the answer is carrots",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/body", card.id)))
        .await
        .unwrap();
    let got: kanso_api::CardBodyDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(got.body_blocksuite_b64.as_deref(), Some(blob_b64.as_str()));
    assert_eq!(got.body_text.as_deref(), Some("the answer is carrots"));
    assert!(got.updated_at >= card.updated_at);

    // FTS must see the new body_text.
    let hits = CardRepo::search(&pool, "carrots", false).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, card.id);
}

#[tokio::test]
async fn card_body_get_unknown_returns_404() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .oneshot(req("GET", "/cards/00000000000000000000000000/body"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn card_body_put_invalid_base64_returns_400() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let res = app
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            json!({"body_blocksuite_b64": "not!base64!@#$", "body_text": "x"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn card_body_put_under_limit_succeeds() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    // ~7 MiB of valid base64 ("A" decodes to a single zero byte; padded to a multiple of 4).
    let mut b64 = "A".repeat(7 * 1024 * 1024);
    while b64.len() % 4 != 0 {
        b64.push('=');
    }

    let body = json!({"body_blocksuite_b64": b64, "body_text": "x"});
    let res = app
        .oneshot(req_json("PUT", &format!("/cards/{}/body", card.id), body))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn card_body_put_over_limit_returns_413() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let mut b64 = "A".repeat(9 * 1024 * 1024);
    while b64.len() % 4 != 0 {
        b64.push('=');
    }

    let body = json!({"body_blocksuite_b64": b64, "body_text": "x"});
    let res = app
        .oneshot(req_json("PUT", &format!("/cards/{}/body", card.id), body))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

// ---------- Phase 3: tags + card-tag links + search + column move ----------

use kanso_api::TagDto;

#[tokio::test]
async fn tag_crud_via_http() {
    let (app, _pool, _tmp) = setup().await;

    let res = app
        .clone()
        .oneshot(req_json(
            "POST",
            "/tags",
            json!({"name": "ops", "color": "#fff"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let tag: TagDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(tag.name, "ops");

    let res = app
        .clone()
        .oneshot(req_json("POST", "/tags", json!({"name": "ops"})))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);

    let res = app.clone().oneshot(req("GET", "/tags")).await.unwrap();
    let listed: Vec<TagDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(listed.len(), 1);

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/tags/{}", tag.id),
            json!({"color": null}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let patched: TagDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(patched.color.is_none());

    let res = app
        .clone()
        .oneshot(req("POST", &format!("/tags/{}/archive", tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(req("POST", "/tags/00000000000000000000000000/archive"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let res = app
        .clone()
        .oneshot(req("DELETE", &format!("/tags/{}", tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn card_tag_link_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let res = app
        .clone()
        .oneshot(req_json("POST", "/tags", json!({"name": "ops"})))
        .await
        .unwrap();
    let tag: TagDto = serde_json::from_value(body_json(res).await).unwrap();

    let res = app
        .clone()
        .oneshot(req("POST", &format!("/cards/{}/tags/{}", card.id, tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // idempotent
    let res = app
        .clone()
        .oneshot(req("POST", &format!("/cards/{}/tags/{}", card.id, tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/tags", card.id)))
        .await
        .unwrap();
    let tags: Vec<TagDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(tags.len(), 1);

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/tags/{}/cards", tag.id)))
        .await
        .unwrap();
    let cards: Vec<CardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].id, card.id);

    let res = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/cards/{}/tags/{}", card.id, tag.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // idempotent unlink
    let res = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/cards/{}/tags/{}", card.id, tag.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // missing card -> 404
    let res = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/cards/00000000000000000000000000/tags/{}", tag.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn card_search_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Plain Title")
        .await
        .unwrap();
    CardRepo::set_body(&pool, &card.id, b"y", "ribbon ribbon ribbon")
        .await
        .unwrap();

    let res = app
        .clone()
        .oneshot(req("GET", "/cards/search?q=ribbon"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let hits = body_json(res).await;
    let arr = hits.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["card"]["id"], card.id);

    let res = app
        .clone()
        .oneshot(req("GET", "/cards/search?q="))
        .await
        .unwrap();
    let hits = body_json(res).await;
    assert!(hits.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn card_search_returns_board_and_column_context() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "Garden").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "Todo", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "Buy seeds")
        .await
        .unwrap();

    let res = app
        .clone()
        .oneshot(req("GET", "/cards/search?q=seeds"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let hits = body_json(res).await;
    let arr = hits.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    let hit = &arr[0];
    assert_eq!(hit["card"]["id"], card.id);
    assert_eq!(hit["card"]["title"], "Buy seeds");
    assert_eq!(hit["column_id"], col.id);
    assert_eq!(hit["column_name"], "Todo");
    assert_eq!(hit["board_id"], board.id);
    assert_eq!(hit["board_name"], "Garden");
}

#[tokio::test]
async fn column_move_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let a = ColumnRepo::create(&pool, &board.id, "a", None)
        .await
        .unwrap();
    let b = ColumnRepo::create(&pool, &board.id, "b", None)
        .await
        .unwrap();
    let _c = ColumnRepo::create(&pool, &board.id, "c", None)
        .await
        .unwrap();

    let res = app
        .clone()
        .oneshot(req_json(
            "POST",
            &format!("/columns/{}/move", b.id),
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/boards/{}/columns", board.id)))
        .await
        .unwrap();
    let listed: Vec<ColumnDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(
        listed.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        vec!["a", "c", "b"]
    );

    // PATCH color
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/columns/{}", a.id),
            json!({"color": "#abc"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let patched: ColumnDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(patched.color.as_deref(), Some("#abc"));
}

#[tokio::test]
async fn tag_update_blank_name_returns_400() {
    let (app, _pool, _tmp) = setup().await;
    let res = app
        .clone()
        .oneshot(req_json("POST", "/tags", json!({"name": "ok"})))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let tag: TagDto = serde_json::from_value(body_json(res).await).unwrap();

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/tags/{}", tag.id),
            json!({"name": "   "}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn link_archived_tag_returns_400_and_archive_filter_works() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    let card2 = CardRepo::create(&pool, &col.id, "T2").await.unwrap();

    let res = app
        .clone()
        .oneshot(req_json("POST", "/tags", json!({"name": "buried"})))
        .await
        .unwrap();
    let tag: TagDto = serde_json::from_value(body_json(res).await).unwrap();

    // Link succeeds while tag is live.
    let res = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/cards/{}/tags/{}", card.id, tag.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Archive the tag.
    let res = app
        .clone()
        .oneshot(req("POST", &format!("/tags/{}/archive", tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Default list hides archived links.
    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/tags", card.id)))
        .await
        .unwrap();
    let visible: Vec<TagDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert!(visible.is_empty(), "got {visible:?}");

    // Opt-in surfaces them.
    let res = app
        .clone()
        .oneshot(req(
            "GET",
            &format!("/cards/{}/tags?include_archived=true", card.id),
        ))
        .await
        .unwrap();
    let all: Vec<TagDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(all.len(), 1);

    // Linking a fresh card to the archived tag is a 400.
    let res = app
        .clone()
        .oneshot(req(
            "POST",
            &format!("/cards/{}/tags/{}", card2.id, tag.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ---------- Phase 4 W2: bulk board card-tag links ----------

use kanso_api::CardTagLinkDto;
use kanso_core::repo::TagRepo;

#[tokio::test]
async fn board_card_tags_via_http_returns_links() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "Todo", None)
        .await
        .unwrap();
    let c1 = CardRepo::create(&pool, &col.id, "one").await.unwrap();
    let c2 = CardRepo::create(&pool, &col.id, "two").await.unwrap();
    let t1 = TagRepo::create(&pool, "alpha", None).await.unwrap();
    let t2 = TagRepo::create(&pool, "beta", None).await.unwrap();
    CardRepo::add_tag(&pool, &c1.id, &t1.id).await.unwrap();
    CardRepo::add_tag(&pool, &c1.id, &t2.id).await.unwrap();
    CardRepo::add_tag(&pool, &c2.id, &t2.id).await.unwrap();

    let res = app
        .oneshot(req("GET", &format!("/boards/{}/card_tags", board.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let links: Vec<CardTagLinkDto> = serde_json::from_value(body_json(res).await).unwrap();
    let mut got: Vec<(String, String)> = links
        .into_iter()
        .map(|l| (l.card_id, l.tag_id))
        .collect();
    got.sort();
    let mut expected = vec![
        (c1.id.clone(), t1.id.clone()),
        (c1.id.clone(), t2.id.clone()),
        (c2.id.clone(), t2.id.clone()),
    ];
    expected.sort();
    assert_eq!(got, expected);
}

#[tokio::test]
async fn board_card_tags_empty_board_returns_empty_array() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "Empty").await.unwrap();

    let res = app
        .oneshot(req("GET", &format!("/boards/{}/card_tags", board.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = body_json(res).await;
    assert_eq!(v, serde_json::json!([]));
}

#[tokio::test]
async fn board_card_tags_requires_auth() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();

    let res = app
        .oneshot(req_no_auth(
            "GET",
            &format!("/boards/{}/card_tags", board.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let v = body_json(res).await;
    assert_eq!(v["error"], "unauthorized");
}

// ---- Wave 3: body limit, pagination, DNS-rebinding guard --------------------

#[tokio::test]
async fn body_over_limit_returns_413() {
    let (app, _pool, _tmp) = setup().await;
    // The global cap is 1 MiB; pad the name well past it.
    let huge = "x".repeat(2 * 1024 * 1024);
    let body = serde_json::json!({ "name": huge });
    let res = app
        .oneshot(req_json("POST", "/boards", body))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn card_body_put_above_1mib_still_accepted() {
    // The /cards/:id/body PUT keeps its own 8 MiB override; verify a payload
    // bigger than the global 1 MiB cap doesn't get rejected by it.
    use base64::Engine as _;
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let payload = serde_json::json!({
        "body_blocksuite_b64": base64::engine::general_purpose::STANDARD
            .encode(vec![0u8; 1_500_000]),
        "body_text": "x".repeat(1_500_000),
    });
    let res = app
        .oneshot(req_json("PUT", &format!("/cards/{}/body", card.id), payload))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn boards_list_respects_limit_and_offset() {
    let (app, pool, _tmp) = setup().await;
    for name in ["A", "B", "C", "D", "E"] {
        BoardRepo::create(&pool, name).await.unwrap();
    }
    let res = app
        .oneshot(req("GET", "/boards?limit=2&offset=1"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = body_json(res).await;
    let arr = v.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["name"], "B");
    assert_eq!(arr[1]["name"], "C");
}

#[tokio::test]
async fn boards_list_limit_clamps_to_500() {
    let (app, pool, _tmp) = setup().await;
    for i in 0..3 {
        BoardRepo::create(&pool, &format!("B{i}")).await.unwrap();
    }
    let res = app
        .oneshot(req("GET", "/boards?limit=10000"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = body_json(res).await;
    assert_eq!(v.as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn boards_list_default_pagination_applies() {
    let (app, pool, _tmp) = setup().await;
    for i in 0..3 {
        BoardRepo::create(&pool, &format!("B{i}")).await.unwrap();
    }
    let res = app.oneshot(req("GET", "/boards")).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = body_json(res).await;
    let arr = v.as_array().unwrap();
    assert!(arr.len() <= 100);
    assert_eq!(arr.len(), 3);
}

#[tokio::test]
async fn tag_cards_paginated_smoke() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None).await.unwrap();
    let tag = kanso_core::repo::TagRepo::create(&pool, "t", None)
        .await
        .unwrap();
    for i in 0..4 {
        let c = CardRepo::create(&pool, &col.id, &format!("c{i}"))
            .await
            .unwrap();
        CardRepo::add_tag(&pool, &c.id, &tag.id).await.unwrap();
    }
    let res = app
        .oneshot(req("GET", &format!("/tags/{}/cards?limit=2", tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = body_json(res).await;
    assert_eq!(v.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn request_with_attacker_host_returns_403() {
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("host", "evil.com")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let v = body_json(res).await;
    assert_eq!(v["error"], "forbidden_host");
}

#[tokio::test]
async fn request_with_loopback_host_passes() {
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("host", "127.0.0.1:9999")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn request_with_localhost_host_passes() {
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("host", "localhost:9999")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn request_missing_host_returns_403() {
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn healthz_also_host_guarded() {
    let (app, _pool, _tmp) = setup().await;

    let bad = Request::builder()
        .method("GET")
        .uri("/healthz")
        .header("host", "evil.com")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(bad).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    let good = Request::builder()
        .method("GET")
        .uri("/healthz")
        .header("host", "127.0.0.1:9999")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(good).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}
#[tokio::test]
async fn duplicate_host_headers_are_rejected() {
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("host", "127.0.0.1:9999")
        .header("host", "evil.com")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mixed_case_localhost_host_passes() {
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("host", "LocalHost:9999")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn host_with_surrounding_whitespace_passes() {
    // hyper's HeaderValue forbids ASCII control chars but accepts surrounding
    // spaces; our guard trims OWS before matching.
    let (app, _pool, _tmp) = setup().await;
    let r = Request::builder()
        .method("GET")
        .uri("/boards")
        .header("host", "  127.0.0.1:9999  ")
        .header("authorization", format!("Bearer {TEST_TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(r).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn cards_search_respects_limit_and_offset() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    for i in 0..5 {
        let c = CardRepo::create(&pool, &col.id, &format!("hit {i}"))
            .await
            .unwrap();
        CardRepo::set_body(&pool, &c.id, b"y", "needle needle needle")
            .await
            .unwrap();
    }

    let res = app
        .clone()
        .oneshot(req("GET", "/cards/search?q=needle&limit=2&offset=0"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let page0 = body_json(res).await;
    let arr0 = page0.as_array().unwrap();
    assert_eq!(arr0.len(), 2);

    let res = app
        .clone()
        .oneshot(req("GET", "/cards/search?q=needle&limit=2&offset=1"))
        .await
        .unwrap();
    let page1 = body_json(res).await;
    let arr1 = page1.as_array().unwrap();
    assert_eq!(arr1.len(), 2);

    let ids0: std::collections::HashSet<String> = arr0
        .iter()
        .map(|h| h["card"]["id"].as_str().unwrap().to_string())
        .collect();
    let ids1: std::collections::HashSet<String> = arr1
        .iter()
        .map(|h| h["card"]["id"].as_str().unwrap().to_string())
        .collect();
    // page1 starts one row later; it must NOT be identical to page0.
    assert_ne!(ids0, ids1);
    // And the second-row item from page0 must appear in page1.
    let p0_second = arr0[1]["card"]["id"].as_str().unwrap().to_string();
    assert!(ids1.contains(&p0_second));
}

#[tokio::test]
async fn tags_for_card_default_pagination() {
    use kanso_core::repo::TagRepo;
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = ColumnRepo::create(&pool, &board.id, "C", None)
        .await
        .unwrap();
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();
    for i in 0..3 {
        let t = TagRepo::create(&pool, &format!("tag-{i:02}"), None)
            .await
            .unwrap();
        CardRepo::add_tag(&pool, &card.id, &t.id).await.unwrap();
    }

    // Default (no params) returns all 3 (well under 100).
    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/tags", card.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = body_json(res).await;
    assert_eq!(v.as_array().unwrap().len(), 3);

    // limit=1 clamps the page.
    let res = app
        .clone()
        .oneshot(req(
            "GET",
            &format!("/cards/{}/tags?limit=1&offset=1", card.id),
        ))
        .await
        .unwrap();
    let v = body_json(res).await;
    assert_eq!(v.as_array().unwrap().len(), 1);

    // limit over MAX silently clamps; no 400.
    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/tags?limit=99999", card.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

// ---- Phase 6 Wave A: /boards/:id/_full ------------------------------------

mod board_full_endpoint {
    use super::*;
    use kanso_api::BoardFullDto;
    use kanso_core::repo::TagRepo;

    #[tokio::test]
    async fn board_full_endpoint_returns_nested_dto() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "Todo", None).await.unwrap();
        let card = CardRepo::create(&pool, &col.id, "do it").await.unwrap();
        let tag = TagRepo::create(&pool, "urgent", None).await.unwrap();
        CardRepo::add_tag(&pool, &card.id, &tag.id).await.unwrap();

        let res = app
            .oneshot(req("GET", &format!("/boards/{}/_full", board.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_json(res).await;
        let snap: BoardFullDto = serde_json::from_value(body).unwrap();
        assert_eq!(snap.board.id, board.id);
        assert_eq!(snap.columns.len(), 1);
        assert_eq!(snap.columns[0].column.id, col.id);
        assert_eq!(snap.columns[0].cards.len(), 1);
        assert_eq!(snap.columns[0].cards[0].card.id, card.id);
        assert_eq!(snap.columns[0].cards[0].tag_ids, vec![tag.id.clone()]);
        assert_eq!(snap.tags.len(), 1);
        assert_eq!(snap.tags[0].id, tag.id);
    }

    #[tokio::test]
    async fn board_full_endpoint_requires_auth() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let res = app
            .oneshot(req_no_auth("GET", &format!("/boards/{}/_full", board.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn board_full_endpoint_returns_404_for_unknown_board() {
        let (app, _pool, _tmp) = setup().await;
        let res = app
            .oneshot(req("GET", "/boards/does-not-exist/_full"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn board_full_endpoint_returns_409_when_over_cap() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "Huge").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "c", None).await.unwrap();
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

        let res = app
            .oneshot(req("GET", &format!("/boards/{}/_full", board.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT);
        let v = body_json(res).await;
        let err = v["error"].as_str().unwrap();
        assert!(err.contains("1000"), "got: {err}");
        assert!(err.contains("too large"), "got: {err}");
    }

    #[tokio::test]
    async fn board_full_endpoint_respects_include_archived_flag() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "Todo", None).await.unwrap();
        let live = CardRepo::create(&pool, &col.id, "live").await.unwrap();
        let dead = CardRepo::create(&pool, &col.id, "dead").await.unwrap();
        CardRepo::archive(&pool, &dead.id).await.unwrap();

        let res = app
            .clone()
            .oneshot(req("GET", &format!("/boards/{}/_full", board.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let snap: BoardFullDto = serde_json::from_value(body_json(res).await).unwrap();
        assert_eq!(snap.columns[0].cards.len(), 1);
        assert_eq!(snap.columns[0].cards[0].card.id, live.id);

        let res = app
            .oneshot(req(
                "GET",
                &format!("/boards/{}/_full?include_archived=true", board.id),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let snap: BoardFullDto = serde_json::from_value(body_json(res).await).unwrap();
        assert_eq!(snap.columns[0].cards.len(), 2);
    }

    #[tokio::test]
    async fn board_full_endpoint_host_guarded() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let r = Request::builder()
            .method("GET")
            .uri(format!("/boards/{}/_full", board.id))
            .header("host", "evil.com")
            .header("authorization", format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(r).await.unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        let v = body_json(res).await;
        assert_eq!(v["error"], "forbidden_host");
    }
}

// ---- Phase 7 Wave B: singular GET /boards/:id and /columns/:id ------------

mod singular_gets {
    use super::*;

    #[tokio::test]
    async fn board_get_happy() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "Solo").await.unwrap();
        let res = app
            .oneshot(req("GET", &format!("/boards/{}", board.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let dto: BoardDto = serde_json::from_value(body_json(res).await).unwrap();
        assert_eq!(dto.id, board.id);
        assert_eq!(dto.name, "Solo");
    }

    #[tokio::test]
    async fn board_get_404_for_unknown_id() {
        let (app, _pool, _tmp) = setup().await;
        let res = app
            .oneshot(req("GET", "/boards/does-not-exist"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        let v = body_json(res).await;
        let err = v["error"].as_str().unwrap();
        assert!(err.contains("board not found"), "got: {err}");
    }

    #[tokio::test]
    async fn column_get_happy() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let col = ColumnRepo::create(&pool, &board.id, "Todo", None)
            .await
            .unwrap();
        let res = app
            .oneshot(req("GET", &format!("/columns/{}", col.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let dto: ColumnDto = serde_json::from_value(body_json(res).await).unwrap();
        assert_eq!(dto.id, col.id);
        assert_eq!(dto.name, "Todo");
        assert_eq!(dto.board_id, board.id);
    }

    #[tokio::test]
    async fn column_get_404_for_unknown_id() {
        let (app, _pool, _tmp) = setup().await;
        let res = app
            .oneshot(req("GET", "/columns/does-not-exist"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        let v = body_json(res).await;
        let err = v["error"].as_str().unwrap();
        assert!(err.contains("column not found"), "got: {err}");
    }
}
