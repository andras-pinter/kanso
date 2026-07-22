//! Integration tests: drive the axum router with a real sqlx pool to prove
//! the HTTP contract works end-to-end for every Phase 1 entity.

#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use kanso_api::{router, AppState, BoardDto, CardDto, CardListDto, ColumnDto};
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

async fn seeded_column(
    pool: &sqlx::SqlitePool,
    board_id: &str,
    index: usize,
) -> kanso_core::domain::Column {
    ColumnRepo::list_by_board(pool, board_id)
        .await
        .unwrap()
        .into_iter()
        .nth(index)
        .unwrap()
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
    let res = app.oneshot(req_no_auth("GET", "/boards")).await.unwrap();
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
        .oneshot(req("GET", &format!("/boards/{}/columns", created.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let columns: Vec<ColumnDto> = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(columns.len(), 4);
    assert_eq!(
        columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        vec!["Incoming", "Todo", "In Progress", "Done"]
    );

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
        .oneshot(req("DELETE", &format!("/boards/{}", created.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}
#[tokio::test]
async fn card_crud_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let column = seeded_column(&pool, &board.id, 1).await;

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
    let created: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(created.title, "from test");

    let from_db = CardRepo::list_by_column(&pool, &column.id).await.unwrap();
    assert_eq!(from_db.len(), 1);
    assert_eq!(from_db[0].id, created.id);

    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", created.id),
            json!({"due_at": 1_700_000_000_000_i64}),
        ))
        .await
        .unwrap();
    let with_due: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
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
    let title_only: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
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
    let cleared: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(cleared.due_at.is_none(), "null must clear due_at");

    let res = app
        .oneshot(req("DELETE", &format!("/cards/{}", created.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert!(CardRepo::get(&pool, &created.id).await.unwrap().is_none());
}

#[tokio::test]
async fn card_move_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
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
    let listed: Vec<CardListDto> = serde_json::from_value(body_json(res).await).unwrap();
    let titles: Vec<_> = listed.iter().map(|c| c.title.clone()).collect();
    assert_eq!(titles, vec!["a", "c", "b"]);
}

#[tokio::test]
async fn create_card_rejects_blank_title() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;

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
    let col = seeded_column(&pool, &board.id, 0).await;
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
async fn card_body_markdown_clear_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let read_body = |app: axum::Router, id: String| async move {
        let res = app
            .oneshot(req("GET", &format!("/cards/{}", id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let full: CardDto = serde_json::from_value(body_json(res).await).unwrap();
        full.body_markdown
    };

    // Set body_markdown via PATCH. Response is now the thin list DTO.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", card.id),
            json!({"body_markdown": "scratch"}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let after: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(after.has_body, "PATCH response should flag has_body=true");
    assert_eq!(
        read_body(app.clone(), card.id.clone()).await.as_deref(),
        Some("scratch")
    );

    // Omitting body_markdown leaves it untouched.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", card.id),
            json!({"title": "T2"}),
        ))
        .await
        .unwrap();
    let after: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(after.has_body, "omit must leave body_markdown untouched");
    assert_eq!(
        read_body(app.clone(), card.id.clone()).await.as_deref(),
        Some("scratch"),
        "omit must leave body_markdown untouched",
    );

    // Explicit null clears it.
    let res = app
        .clone()
        .oneshot(req_json(
            "PATCH",
            &format!("/cards/{}", card.id),
            json!({"body_markdown": null}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let after: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(!after.has_body, "null must clear body_markdown");
    assert!(read_body(app.clone(), card.id).await.is_none());
}

#[tokio::test]
async fn get_card_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
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
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "Body").await.unwrap();

    // Fresh card: markdown is null.
    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/body", card.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let fresh: kanso_api::CardBodyDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(fresh.body_markdown.is_none());

    let md = "# Answer\n\n- carrots\n- beans\n";
    let res = app
        .clone()
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            json!({ "body_markdown": md }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let returned: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(returned.id, card.id);
    assert!(returned.updated_at >= card.updated_at);

    let res = app
        .clone()
        .oneshot(req("GET", &format!("/cards/{}/body", card.id)))
        .await
        .unwrap();
    let got: kanso_api::CardBodyDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(got.body_markdown.as_deref(), Some(md));
    assert!(got.updated_at >= card.updated_at);

    // FTS must see the new markdown (unicode61 strips '#', '-' as non-word chars).
    let hits = CardRepo::search(&pool, "carrots").await.unwrap();
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
async fn card_body_put_empty_string_clears_body() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    // Seed a body.
    let res = app
        .clone()
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            json!({ "body_markdown": "seed" }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Empty string is our "clear" sentinel — PUT semantics require a value.
    let res = app
        .clone()
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            json!({ "body_markdown": "" }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(req("GET", &format!("/cards/{}/body", card.id)))
        .await
        .unwrap();
    let got: kanso_api::CardBodyDto = serde_json::from_value(body_json(res).await).unwrap();
    assert!(got.body_markdown.is_none(), "empty string must clear body");
}

#[tokio::test]
async fn card_body_put_under_limit_succeeds() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    // ~7 MiB of markdown — well under the 8 MiB PUT cap.
    let md = "a".repeat(7 * 1024 * 1024);
    let body = json!({ "body_markdown": md });
    let res = app
        .oneshot(req_json("PUT", &format!("/cards/{}/body", card.id), body))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let _returned: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
}

#[tokio::test]
async fn card_body_put_over_limit_returns_413() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let md = "a".repeat(9 * 1024 * 1024);
    let body = json!({ "body_markdown": md });
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
        .oneshot(req("DELETE", &format!("/tags/{}", tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn card_tag_link_via_http() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
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
    assert_eq!(res.status(), StatusCode::OK);
    let linked: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(linked.id, card.id);

    // idempotent
    let res = app
        .clone()
        .oneshot(req("POST", &format!("/cards/{}/tags/{}", card.id, tag.id)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let _: CardListDto = serde_json::from_value(body_json(res).await).unwrap();

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
    let cards: Vec<CardListDto> = serde_json::from_value(body_json(res).await).unwrap();
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
    assert_eq!(res.status(), StatusCode::OK);
    let unlinked: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
    assert_eq!(unlinked.id, card.id);

    // idempotent unlink
    let res = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/cards/{}/tags/{}", card.id, tag.id),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let _: CardListDto = serde_json::from_value(body_json(res).await).unwrap();

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
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "Plain Title")
        .await
        .unwrap();
    CardRepo::set_body(&pool, &card.id, Some("ribbon ribbon ribbon"))
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
    let col = seeded_column(&pool, &board.id, 1).await;
    let card = CardRepo::create(&pool, &col.id, "Buy seeds").await.unwrap();

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

// ---------- Phase 4 W2: bulk board card-tag links ----------

use kanso_api::CardTagLinkDto;
use kanso_core::repo::TagRepo;

#[tokio::test]
async fn board_card_tags_via_http_returns_links() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 1).await;
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
    let mut got: Vec<(String, String)> = links.into_iter().map(|l| (l.card_id, l.tag_id)).collect();
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
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    let payload = serde_json::json!({
        "body_markdown": "x".repeat(1_500_000),
    });
    let res = app
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            payload,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let _returned: CardListDto = serde_json::from_value(body_json(res).await).unwrap();
}

#[tokio::test]
async fn card_body_put_empty_body_returns_400() {
    let (app, pool, _tmp) = setup().await;
    let board = BoardRepo::create(&pool, "B").await.unwrap();
    let col = seeded_column(&pool, &board.id, 0).await;
    let card = CardRepo::create(&pool, &col.id, "T").await.unwrap();

    // Missing the required `body_markdown` field must fail deserialization.
    // Axum surfaces JSON deserialization errors as 422 (UNPROCESSABLE_ENTITY).
    let res = app
        .oneshot(req_json(
            "PUT",
            &format!("/cards/{}/body", card.id),
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
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
    let col = seeded_column(&pool, &board.id, 0).await;
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
    let col = seeded_column(&pool, &board.id, 0).await;
    for i in 0..5 {
        let c = CardRepo::create(&pool, &col.id, &format!("hit {i}"))
            .await
            .unwrap();
        CardRepo::set_body(&pool, &c.id, Some("needle needle needle"))
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
    let col = seeded_column(&pool, &board.id, 0).await;
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
        let col = seeded_column(&pool, &board.id, 1).await;
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
        assert_eq!(snap.columns.len(), 4);
        assert_eq!(snap.columns[1].column.id, col.id);
        assert_eq!(snap.columns[1].cards.len(), 1);
        assert_eq!(snap.columns[1].cards[0].card.id, card.id);
        assert_eq!(snap.columns[1].cards[0].tag_ids, vec![tag.id.clone()]);
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
        let col = seeded_column(&pool, &board.id, 0).await;
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
        let col = seeded_column(&pool, &board.id, 1).await;
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

/// Guardrails against `body_markdown` regressing back into list, search,
/// board-full, or write responses. Typed deserialization silently ignores
/// unknown JSON fields, so a regression would go undetected without raw
/// key assertions. These tests fail loudly if body_markdown ever creeps
/// back into a thin-DTO response.
mod thin_dto_shape {
    use super::*;

    fn assert_thin_card(card: &Value, ctx: &str) {
        assert!(
            card.get("body_markdown").is_none(),
            "{ctx}: card carries body_markdown; expected thin shape. card={card}",
        );
        assert!(
            card.get("has_body").and_then(|v| v.as_bool()).is_some(),
            "{ctx}: card missing has_body bool. card={card}",
        );
    }

    async fn seed_body(app: &axum::Router, column_id: &str, title: &str, body: &str) -> String {
        let res = app
            .clone()
            .oneshot(req_json(
                "POST",
                &format!("/columns/{column_id}/cards"),
                json!({ "title": title }),
            ))
            .await
            .unwrap();
        let v = body_json(res).await;
        let id = v["id"].as_str().unwrap().to_string();
        let res = app
            .clone()
            .oneshot(req_json(
                "PUT",
                &format!("/cards/{id}/body"),
                json!({ "body_markdown": body }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        id
    }

    #[tokio::test]
    async fn card_list_response_has_no_body_markdown() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        seed_body(&app, &column_id, "with body", "hello **there**").await;
        seed_body(&app, &column_id, "empty body", "").await;

        let res = app
            .oneshot(req("GET", &format!("/columns/{column_id}/cards")))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let v = body_json(res).await;
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        for c in arr {
            assert_thin_card(c, "card_list");
        }
    }

    #[tokio::test]
    async fn card_search_response_has_no_body_markdown() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        seed_body(&app, &column_id, "findme", "some *markdown* body").await;

        let res = app
            .oneshot(req("GET", "/cards/search?q=findme"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let v = body_json(res).await;
        let hits = v.as_array().unwrap();
        assert!(!hits.is_empty());
        for hit in hits {
            let card = hit.get("card").unwrap();
            assert_thin_card(card, "card_search");
        }
    }

    #[tokio::test]
    async fn board_full_response_has_no_body_markdown() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        seed_body(&app, &column_id, "one", "body one").await;
        seed_body(&app, &column_id, "two", "").await;

        let res = app
            .oneshot(req("GET", &format!("/boards/{}/_full", board.id)))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let v = body_json(res).await;
        for col in v["columns"].as_array().unwrap() {
            for cwt in col["cards"].as_array().unwrap() {
                let card = cwt.get("card").unwrap();
                assert_thin_card(card, "board_full");
            }
        }
    }

    #[tokio::test]
    async fn card_write_responses_have_no_body_markdown() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let col_a = seeded_column(&pool, &board.id, 0).await.id;
        let col_b = seeded_column(&pool, &board.id, 1).await.id;

        // POST /columns/:id/cards
        let res = app
            .clone()
            .oneshot(req_json(
                "POST",
                &format!("/columns/{col_a}/cards"),
                json!({ "title": "new" }),
            ))
            .await
            .unwrap();
        let created = body_json(res).await;
        assert_thin_card(&created, "card_create");
        let id = created["id"].as_str().unwrap().to_string();

        // PATCH /cards/:id (with body_markdown in the patch — response must
        // still be thin).
        let res = app
            .clone()
            .oneshot(req_json(
                "PATCH",
                &format!("/cards/{id}"),
                json!({ "body_markdown": "**patched**", "title": "renamed" }),
            ))
            .await
            .unwrap();
        let patched = body_json(res).await;
        assert_thin_card(&patched, "card_update");
        assert_eq!(patched["has_body"].as_bool(), Some(true));

        // POST /cards/:id/move
        let res = app
            .clone()
            .oneshot(req_json(
                "POST",
                &format!("/cards/{id}/move"),
                json!({ "target_column_id": col_b }),
            ))
            .await
            .unwrap();
        let moved = body_json(res).await;
        assert_thin_card(&moved, "card_move");

        // PUT /cards/:id/body
        let res = app
            .clone()
            .oneshot(req_json(
                "PUT",
                &format!("/cards/{id}/body"),
                json!({ "body_markdown": "replaced" }),
            ))
            .await
            .unwrap();
        let put = body_json(res).await;
        assert_thin_card(&put, "card_body_set");
        assert_eq!(put["has_body"].as_bool(), Some(true));

        // Tag link/unlink
        let res = app
            .clone()
            .oneshot(req_json(
                "POST",
                "/tags",
                json!({ "name": "t1", "color": "#000000" }),
            ))
            .await
            .unwrap();
        let tag_id = body_json(res).await["id"].as_str().unwrap().to_string();
        let res = app
            .clone()
            .oneshot(req("POST", &format!("/cards/{id}/tags/{tag_id}")))
            .await
            .unwrap();
        assert_thin_card(&body_json(res).await, "card_tag_add");
        let res = app
            .clone()
            .oneshot(req("DELETE", &format!("/cards/{id}/tags/{tag_id}")))
            .await
            .unwrap();
        assert_thin_card(&body_json(res).await, "card_tag_remove");
    }

    /// GET /cards/:id is the *only* endpoint that should still expose
    /// body_markdown — this test locks in that asymmetry so we notice if
    /// someone thins it accidentally.
    #[tokio::test]
    async fn card_get_single_still_exposes_body_markdown() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        let id = seed_body(&app, &column_id, "single", "keep me").await;

        let res = app
            .oneshot(req("GET", &format!("/cards/{id}")))
            .await
            .unwrap();
        let v = body_json(res).await;
        assert_eq!(v["body_markdown"].as_str(), Some("keep me"));
        assert!(
            v.get("has_body").is_none(),
            "card_get returns CardDto, not CardListDto — has_body should NOT appear",
        );
    }
}

/// `has_body` derivation edges: NULL, empty string, and whitespace-only
/// bodies must all resolve to `false` per trimmed-nonblank semantics.
/// A single non-whitespace character flips it to `true`.
mod has_body_edges {
    use super::*;

    async fn seed_card(app: &axum::Router, column_id: &str, title: &str) -> String {
        let res = app
            .clone()
            .oneshot(req_json(
                "POST",
                &format!("/columns/{column_id}/cards"),
                json!({ "title": title }),
            ))
            .await
            .unwrap();
        body_json(res).await["id"].as_str().unwrap().to_string()
    }

    async fn list_card_by_id(app: &axum::Router, column_id: &str, id: &str) -> Value {
        let res = app
            .clone()
            .oneshot(req("GET", &format!("/columns/{column_id}/cards")))
            .await
            .unwrap();
        let v = body_json(res).await;
        let card = v
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"].as_str() == Some(id));
        assert!(card.is_some(), "card {id} not in list");
        card.unwrap().clone()
    }

    #[tokio::test]
    async fn null_body_is_false() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        let id = seed_card(&app, &column_id, "fresh").await;
        // Fresh card has never had a body set → NULL in DB.
        let card = list_card_by_id(&app, &column_id, &id).await;
        assert_eq!(
            card["has_body"].as_bool(),
            Some(false),
            "NULL body should read as has_body=false; got {card}",
        );
    }

    #[tokio::test]
    async fn empty_string_body_is_false() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        let id = seed_card(&app, &column_id, "wiped").await;
        let res = app
            .clone()
            .oneshot(req_json(
                "PUT",
                &format!("/cards/{id}/body"),
                json!({ "body_markdown": "" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await["has_body"].as_bool(), Some(false));
    }

    #[tokio::test]
    async fn whitespace_only_body_is_false() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        let id = seed_card(&app, &column_id, "blank").await;
        let res = app
            .clone()
            .oneshot(req_json(
                "PUT",
                &format!("/cards/{id}/body"),
                json!({ "body_markdown": "   \n\t  \n" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            body_json(res).await["has_body"].as_bool(),
            Some(false),
            "whitespace-only body should read as has_body=false",
        );
    }

    #[tokio::test]
    async fn single_visible_char_is_true() {
        let (app, pool, _tmp) = setup().await;
        let board = BoardRepo::create(&pool, "B").await.unwrap();
        let column_id = seeded_column(&pool, &board.id, 0).await.id;
        let id = seed_card(&app, &column_id, "written").await;
        let res = app
            .clone()
            .oneshot(req_json(
                "PUT",
                &format!("/cards/{id}/body"),
                json!({ "body_markdown": "x" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await["has_body"].as_bool(), Some(true));
    }
}
