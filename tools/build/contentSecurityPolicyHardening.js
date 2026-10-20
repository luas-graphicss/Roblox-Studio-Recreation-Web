const POLICY_META_MARKER = "Content-Security-Policy";
const POLICY_ATTRIBUTE_PREFIX = 'content="';
const POLICY_ATTRIBUTE_QUOTE = '"';

const DIRECTIVE_SEPARATOR = ";";
const SOURCE_SEPARATOR = " ";

export const SCRIPT_SRC_DIRECTIVE = "script-src";


export const LIVE_PREVIEW_ONLY_SCRIPT_SOURCE = "blob:";

function findPolicyValueRange(htmlText) {
  const markerIndex = htmlText.indexOf(POLICY_META_MARKER);
  if (markerIndex === -1) return null;
  const attributeIndex = htmlText.indexOf(POLICY_ATTRIBUTE_PREFIX, markerIndex);
  if (attributeIndex === -1) return null;
  const valueStartIndex = attributeIndex + POLICY_ATTRIBUTE_PREFIX.length;
  const valueEndIndex = htmlText.indexOf(POLICY_ATTRIBUTE_QUOTE, valueStartIndex);
  if (valueEndIndex === -1) return null;
  return { valueStartIndex, valueEndIndex };
}

function asText(value) {
  return String(value == null ? "" : value);
}


export function readContentSecurityPolicyFromHtml(html) {
  const htmlText = asText(html);
  const valueRange = findPolicyValueRange(htmlText);
  if (!valueRange) return "";
  return htmlText.slice(valueRange.valueStartIndex, valueRange.valueEndIndex);
}

function isDirectiveNamed(directiveText, directiveName) {
  return (
    directiveText === directiveName ||
    directiveText.startsWith(directiveName + SOURCE_SEPARATOR)
  );
}


export function readDirectiveSources(policyText, directiveName) {
  const directiveText = asText(policyText)
    .split(DIRECTIVE_SEPARATOR)
    .map((rawDirective) => rawDirective.trim())
    .find((candidate) => isDirectiveNamed(candidate, directiveName));
  if (!directiveText) return null;
  return directiveText
    .slice(directiveName.length)
    .trim()
    .split(/\s+/)
    .filter((source) => source.length > 0);
}

function leadingWhitespaceOf(text) {
  return text.slice(0, text.length - text.trimStart().length);
}

export function hardenScriptSourcesForDeploy(policyText) {
  const authoredScriptSources = readDirectiveSources(policyText, SCRIPT_SRC_DIRECTIVE);
  if (!authoredScriptSources) {
    throw new Error(
      "The Content Security Policy declares no " + SCRIPT_SRC_DIRECTIVE + " directive.",
    );
  }
  const deployedScriptSources = authoredScriptSources.filter(
    (source) => source !== LIVE_PREVIEW_ONLY_SCRIPT_SOURCE,
  );
  if (deployedScriptSources.length === 0) {
    throw new Error(
      "Removing " +
        LIVE_PREVIEW_ONLY_SCRIPT_SOURCE +
        " would leave " +
        SCRIPT_SRC_DIRECTIVE +
        " with no source at all.",
    );
  }
  const deployedDirective = [SCRIPT_SRC_DIRECTIVE, ...deployedScriptSources].join(SOURCE_SEPARATOR);
  return asText(policyText)
    .split(DIRECTIVE_SEPARATOR)
    .map((rawDirective) =>
      isDirectiveNamed(rawDirective.trim(), SCRIPT_SRC_DIRECTIVE)
        ? leadingWhitespaceOf(rawDirective) + deployedDirective
        : rawDirective,
    )
    .join(DIRECTIVE_SEPARATOR);
}


export function hardenContentSecurityPolicyForDeploy(html) {
  const htmlText = asText(html);
  const valueRange = findPolicyValueRange(htmlText);
  if (!valueRange) {
    throw new Error("index.html declares no Content Security Policy meta tag to harden.");
  }
  const authoredPolicy = htmlText.slice(valueRange.valueStartIndex, valueRange.valueEndIndex);
  const deployedPolicy = hardenScriptSourcesForDeploy(authoredPolicy);
  return (
    htmlText.slice(0, valueRange.valueStartIndex) +
    deployedPolicy +
    htmlText.slice(valueRange.valueEndIndex)
  );
}
