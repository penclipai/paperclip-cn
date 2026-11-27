import { translateInstant } from "@/i18n";

const DEFAULT_OAUTH_FAILURE_KEY = "oauth.failure.default";
const DEFAULT_OAUTH_FAILURE_DEFAULT = "Authorization did not complete. Try again when you’re ready.";

function defaultOAuthFailureMessage(): string {
  return translateInstant(DEFAULT_OAUTH_FAILURE_KEY, { defaultValue: DEFAULT_OAUTH_FAILURE_DEFAULT });
}

const OAUTH_PROVIDER_ERROR_COPY = new Map<string, { key: string; defaultValue: string }>([
  ["invalid_scope", { key: "oauth.providerError.invalidScope", defaultValue: "The provider rejected the requested permissions. Check your OAuth app’s configured scopes and try again." }],
  ["invalid_redirect_uri", { key: "oauth.providerError.invalidRedirectUri", defaultValue: "The provider rejected Paperclip’s callback URL. Check that the callback URL in your OAuth app matches Paperclip and try again." }],
  ["invalid_client", { key: "oauth.providerError.invalidClient", defaultValue: "The provider rejected this OAuth app’s client credentials. Check your client ID and secret and try again." }],
  ["unauthorized_client", { key: "oauth.providerError.unauthorizedClient", defaultValue: "The provider refused to authorize this OAuth app. Check your OAuth app configuration and try again." }],
  ["invalid_grant", { key: "oauth.providerError.invalidGrant", defaultValue: "The provider rejected the authorization code. Try signing in again." }],
  ["invalid_request", { key: "oauth.providerError.invalidRequest", defaultValue: "The provider rejected the sign-in request. Check your OAuth app settings and try again." }],
  ["invalid_client_metadata", { key: "oauth.providerError.invalidClientMetadata", defaultValue: "The provider rejected Paperclip’s client registration details. Try again or use your own OAuth app." }],
  ["invalid_software_statement", { key: "oauth.providerError.invalidClientMetadata", defaultValue: "The provider rejected Paperclip’s client registration details. Try again or use your own OAuth app." }],
  ["unapproved_software_statement", { key: "oauth.providerError.invalidClientMetadata", defaultValue: "The provider rejected Paperclip’s client registration details. Try again or use your own OAuth app." }],
  ["unsupported_grant_type", { key: "oauth.providerError.unsupportedGrantType", defaultValue: "The provider does not support the OAuth grant Paperclip uses." }],
  ["unsupported_response_type", { key: "oauth.providerError.unsupportedResponseType", defaultValue: "The provider does not support the OAuth sign-in flow Paperclip uses." }],
  ["server_error", { key: "oauth.providerError.serverError", defaultValue: "The provider reported an internal error. Try again shortly." }],
  ["temporarily_unavailable", { key: "oauth.providerError.temporarilyUnavailable", defaultValue: "The provider is temporarily unavailable. Try again shortly." }],
  ["account_selection_required", { key: "oauth.providerError.accountSelectionRequired", defaultValue: "The provider requires you to select an account. Try connecting again." }],
  ["consent_required", { key: "oauth.providerError.consentRequired", defaultValue: "The provider requires consent to be granted. Try connecting again." }],
  ["interaction_required", { key: "oauth.providerError.interactionRequired", defaultValue: "The provider requires interactive sign-in. Try connecting again." }],
  ["login_required", { key: "oauth.providerError.loginRequired", defaultValue: "The provider requires you to sign in first. Try connecting again." }],
]);

export function allowlistedOAuthProviderError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "access_denied" || OAUTH_PROVIDER_ERROR_COPY.has(value)) return value;
  return null;
}

export function readConnectionIntentOAuthFailureCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null;
}

export function readConnectionIntentOAuthProviderError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  return allowlistedOAuthProviderError((data as { providerError?: unknown }).providerError);
}

export function oauthFailureMessage(code: string | null, providerError?: string | null): string {
  const safeProviderError = allowlistedOAuthProviderError(providerError);
  if (safeProviderError && safeProviderError !== "access_denied") {
    const providerCopy = OAUTH_PROVIDER_ERROR_COPY.get(safeProviderError);
    if (providerCopy) return translateInstant(providerCopy.key, { defaultValue: providerCopy.defaultValue });
  }
  switch (code) {
    case "oauth_state_expired":
    case "oauth_state_missing":
      return translateInstant("oauth.failure.stateExpired", { defaultValue: "The sign-in took too long or was already used. Try again and finish signing in within a few minutes." });
    case "oauth_session_mismatch":
      return translateInstant("oauth.failure.sessionMismatch", { defaultValue: "Sign-in finished in a different Paperclip session. Stay signed in to Paperclip in this browser and try again." });
    case "oauth_redirect_origin_unsupported":
      return translateInstant("oauth.failure.redirectOriginUnsupported", { defaultValue: "Sign-in returned to a different Paperclip address than the one you started from. Open Paperclip at its usual address and try again." });
    case "oauth_token_exchange_failed":
    case "oauth_token_endpoint_rejected":
    case "oauth_access_token_missing":
      return translateInstant("oauth.failure.tokenExchangeFailed", { defaultValue: "The provider accepted your sign-in but didn’t give Paperclip access. Try again; if it keeps happening, check that your account or organization allows this app." });
    case "oauth_insufficient_scope":
    case "oauth_scope_grant_invalid":
      return translateInstant("oauth.failure.insufficientScope", { defaultValue: "The provider didn’t grant the access Paperclip asked for. Try again and approve every requested permission." });
    case "slack_mcp_access_disabled":
      return translateInstant("oauth.failure.slackMcpDisabled", { defaultValue: "Slack MCP access is disabled for this app. Ask the Slack app owner to enable Model Context Protocol under Features → Agents & AI Apps, then try again." });
    case "github_installation_required":
      return translateInstant("oauth.failure.githubInstallationRequired", { defaultValue: "You signed in, but the Paperclip for GitHub app isn’t installed on any account you can use. Install it and choose at least one repository, then try again. An organization owner may need to approve the install." });
    default:
      return defaultOAuthFailureMessage();
  }
}

export function oauthCallbackErrorMessage(
  outcome: string | null,
  code: string | null,
  providerError?: string | null,
): string {
  const safeProviderError = allowlistedOAuthProviderError(providerError);
  if (code === "github_installation_required") {
    return translateInstant("oauth.callback.githubInstallationRequired", { defaultValue: "GitHub access is required. Install Paperclip and grant at least one repository, then try again." });
  }
  const defaultMsg = defaultOAuthFailureMessage();
  const specific = oauthFailureMessage(
    code && code !== "oauth_authorization_denied" ? code : null,
    safeProviderError,
  );
  if (specific !== defaultMsg) return specific;
  if (outcome === "denied" || safeProviderError === "access_denied") {
    return translateInstant("oauth.callback.denied", { defaultValue: "Authorization was cancelled or declined. Your saved connection was not changed." });
  }
  return translateInstant("oauth.callback.incomplete", { defaultValue: "Authorization did not complete. Your saved connection is still here, so you can try again." });
}
