export const DEPLOY_SECURITY_HEADERS = Object.freeze([
  Object.freeze({
    name: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  }),
  Object.freeze({ name: "X-Frame-Options", value: "DENY" }),
  Object.freeze({ name: "X-Content-Type-Options", value: "nosniff" }),
  Object.freeze({ name: "Referrer-Policy", value: "strict-origin-when-cross-origin" }),
  Object.freeze({ name: "Cross-Origin-Opener-Policy", value: "same-origin" }),
  Object.freeze({
    name: "Permissions-Policy",
    value:
      "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), hid=(), idle-detection=()",
  }),
  Object.freeze({
    name: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  }),
]);

export const DEPLOY_SECURITY_HEADER_NAMES = Object.freeze(
  DEPLOY_SECURITY_HEADERS.map((header) => header.name),
);

export const NETLIFY_HEADERS_FILE_NAME = "_headers";
export const AZURE_STATIC_WEB_APP_CONFIG_FILE_NAME = "staticwebapp.config.json";
export const NGINX_EXAMPLE_CONFIG_PATH = "deploy/nginx.conf";
