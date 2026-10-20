export const CHANGELOG_CATEGORY_IDS = Object.freeze(["feature", "improvement", "bugfix"]);

export const DEFAULT_CHANGELOG_CATEGORY = "improvement";

export const CATEGORY_META = Object.freeze({
  feature: Object.freeze({ label: "New Feature", glyph: "\u2605" }),
  improvement: Object.freeze({ label: "Improvement", glyph: "\u2191" }),
  bugfix: Object.freeze({ label: "Bug Fix", glyph: "\u2713" }),
});

const CATEGORY_ALIASES = Object.freeze({
  fix: "bugfix",
  bug: "bugfix",
  hotfix: "bugfix",
  new: "feature",
});

export function normalizeCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();
  if (CHANGELOG_CATEGORY_IDS.includes(normalized)) return normalized;
  if (CATEGORY_ALIASES[normalized]) return CATEGORY_ALIASES[normalized];
  return DEFAULT_CHANGELOG_CATEGORY;
}
