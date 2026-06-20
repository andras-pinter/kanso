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
    let hits: Vec<CardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, card.id);

    let res = app
        .clone()
        .oneshot(req("GET", "/cards/search?q="))
        .await
        .unwrap();
    let hits: Vec<CardDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert!(hits.is_empty());
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
