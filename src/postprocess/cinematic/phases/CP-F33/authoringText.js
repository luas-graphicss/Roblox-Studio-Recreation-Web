import { AUTHORING_TEXT_LIMIT } from "./authoringContract.js";

const encoder = new TextEncoder();

export function authoringTextBytes(text) {
  return encoder.encode(text).byteLength;
}

export function exceedsAuthoringTextBudget(text) {
  return typeof text !== "string" || text.length > AUTHORING_TEXT_LIMIT || authoringTextBytes(text) > AUTHORING_TEXT_LIMIT;
}
