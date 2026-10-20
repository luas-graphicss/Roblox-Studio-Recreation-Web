import { hardenContentSecurityPolicyForDeploy } from "./contentSecurityPolicyHardening.js";

export const CONTENT_SECURITY_POLICY_PLUGIN_NAME = "rsw-harden-content-security-policy";

export function createContentSecurityPolicyPlugin() {
  return {
    name: CONTENT_SECURITY_POLICY_PLUGIN_NAME,
    apply: "build",
    transformIndexHtml: {


      order: "post",
      handler: (html) => hardenContentSecurityPolicyForDeploy(html),
    },
  };
}
