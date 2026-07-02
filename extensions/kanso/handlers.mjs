/**
 * Thin JSON-returning handlers for the Copilot CLI tools. Each wraps one
 * @kanso/client helper and returns `JSON.stringify(result)` so the model
 * sees a machine-readable DTO. Errors bubble up to the extension.mjs `wrap`.
 */

import * as crud from "@kanso/client/crud";

const asJson = (fn) => async (client, args) => {
    const res = await fn(client, args ?? {});
    return JSON.stringify(res ?? null);
};

// boards
export const boardList = asJson(crud.boardList);
export const boardGet = asJson(crud.boardGet);
export const boardCreate = asJson(crud.boardCreate);
export const boardUpdate = asJson(crud.boardUpdate);
export const boardArchive = asJson(crud.boardArchive);
export const boardUnarchive = asJson(crud.boardUnarchive);
export const boardDelete = asJson(crud.boardDelete);
export const boardCardTags = asJson(crud.boardCardTags);

// columns
export const columnList = asJson(crud.columnList);
export const columnCreate = asJson(crud.columnCreate);
export const columnUpdate = asJson(crud.columnUpdate);
export const columnMove = asJson(crud.columnMove);
export const columnArchive = asJson(crud.columnArchive);
export const columnUnarchive = asJson(crud.columnUnarchive);

// cards
export const cardList = asJson(crud.cardList);
export const cardGet = asJson(crud.cardGet);
export const cardCreate = asJson(crud.cardCreate);
export const cardUpdate = asJson(crud.cardUpdate);
export const cardMove = asJson(crud.cardMove);
export const cardArchive = asJson(crud.cardArchive);
export const cardUnarchive = asJson(crud.cardUnarchive);
export const cardBodyGet = asJson(crud.cardBodyGet);
export const cardBodySet = asJson(crud.cardBodySet);

// tags
export const tagList = asJson(crud.tagList);
export const tagGet = asJson(crud.tagGet);
export const tagCreate = asJson(crud.tagCreate);
export const tagUpdate = asJson(crud.tagUpdate);
export const tagArchive = asJson(crud.tagArchive);
export const tagUnarchive = asJson(crud.tagUnarchive);
export const tagDelete = asJson(crud.tagDelete);
export const tagCards = asJson(crud.tagCards);
export const cardTags = asJson(crud.cardTags);
export const cardTagAdd = asJson(crud.cardTagAdd);
export const cardTagRemove = asJson(crud.cardTagRemove);

// search
export const cardSearch = asJson(crud.cardSearch);
