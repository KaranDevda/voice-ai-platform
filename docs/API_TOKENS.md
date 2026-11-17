# API tokens

Signed-in users can create and revoke API tokens from **Account → API tokens**. A token is shown once; the database stores only its SHA-256 hash. Give each integration only the permissions it needs and use the shortest practical expiry (maximum 365 days). The `platform.admin` permission is never available to API tokens.

Send the secret in the HTTP authorization header:

```http
Authorization: Bearer va_<token>
```

REST routes that authenticate with `requireUser()` accept these tokens. The route and database permission checks still apply, and the token's permissions are intersected with the owner's current permissions on every request. Suspending the owner, removing a permission, expiring the token, or revoking it prevents further use. Token management itself requires the owner's signed-in browser session. WebSocket voice streams, browser pages, and device-sync credentials remain separate authentication paths.

Migrations `0034_api_tokens.sql` and `0035_api_token_auth.sql` create the hashed-token table and the narrowly-scoped lookup function. On a new deployment, run the normal database provisioning/migration process so `voiceai_app` receives execute permission on `auth_find_api_token(text)`.
