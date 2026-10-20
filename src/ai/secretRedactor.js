const CREDENTIAL_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{8,}/gi,                             
  /\brbx_[A-Za-z0-9]{20,}/gi,                               
  /\bAIza[A-Za-z0-9_-]{20,}/g,                   
  /\bAKIA[0-9A-Z]{16}\b/g,                     
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                 
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,                               
  /\b(?:api[_-]?key|apikey|token|secret|senha|password)\s*[:=]\s*["']?[^\s"']{6,}/gi,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,                            
]);

export const REDACTION_PLACEHOLDER = "[redacted]";



export function redactCredentials(text, additionalLiteralSecrets = []) {
  let redactedText = String(text == null ? "" : text);
  for (const pattern of CREDENTIAL_PATTERNS) {
    redactedText = redactedText.replace(pattern, REDACTION_PLACEHOLDER);
  }
  const literalSecrets = Array.isArray(additionalLiteralSecrets) ? additionalLiteralSecrets : [];
  for (const literalSecret of literalSecrets) {
    if (typeof literalSecret === "string" && literalSecret.length >= 6) {
      redactedText = redactedText.split(literalSecret).join(REDACTION_PLACEHOLDER);
    }
  }
  return redactedText;
}
