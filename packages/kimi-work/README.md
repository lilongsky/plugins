# Kimi Work

Use the ordinary **Kimi desktop Work subscription** as a provider in Magpie or OpenCode. This is separate from Kimi Code's subscription/API and from the Kimi agent package, which sends Kimi's inference in the opposite direction to Magpie.

```sh
magpie plugin add @magpie-community/opencode-kimi-work-auth
magpie plugin login kimi-work
```

Open Kimi desktop and sign in to Work on the same computer first. Choose **使用本机 Kimi Work 登录** in the provider's sign-in menu. This imports the membership access/refresh pair into the host's auth store. Magpie renews it directly with Kimi near expiry, including while the browser and desktop app are closed. Initial sign-in still requires a local desktop session file; this package does not capture browser cookies or offer an API-key fallback.

## Models and requests

The account's models and reasoning options come from `https://agent-gw.kimi.com/coding/v1/models`. Chat completions, streaming, tool calls and cancellation use the same Work gateway. The request uses this plugin's own User-Agent; it does not impersonate Kimi's desktop client. It never uses `api.kimi.com` or a Kimi Code API key.

Version 0.1.4 preserves the calling agent's shared instructions, prompts, history and tools unchanged. Instructions, MCP and skills are assigned to that agent in Magpie's Library; the provider does not create a second target or enable resources on its own. The ordinary Kimi agent's Library support starts at `@magpie-community/agent-kimi-desktop` 0.1.1.

An inference HTTP 401 marks the provider sign-in as expired (`kimi_work_login_expired`). Sign in to desktop Work if needed, then **reconnect Kimi Work in Magpie** (or run `magpie plugin login kimi-work`); signing in to the desktop alone does not reconnect the provider. Other HTTP errors, including 429 and 5xx, pass through unchanged with Kimi's status, headers, body and Retry-After. This preserves the distinction between concurrency limits and exhausted allowance, including any upstream reset details. Network failures use `kimi_work_connection_failed` and retain the underlying cause code or fetch error message for diagnosis. Rate limits and service failures do not invalidate the desktop sign-in. Cancellation stays cancellation. No automatic retry sends a conversation twice or falls back to Code.

Models use standard context, capped at 262,144 tokens, rather than silently enabling the higher-priced XL context. The fallback model is `kimi-work/k3-agent`; the signed-in account's live catalog replaces it.

Usage comes from Kimi's membership `GetSubscriptionStats` endpoint. The card's **月度共享额度** heading and single **本月** meter report `subscriptionBalance.amountUsedRatio`, the fraction used of the shared monthly membership pool. If returned, `subscriptionBalance.kimiCodeUsedRatio` appears only as **Code 已用 …%（占总额）** in the meter's text and tooltip: Code's share of the entire monthly pool, not another allowance or the fraction of the used portion. It is never another window/ring, because Magpie renders even informational `aside` windows as separate remaining allowances. Code's share does not constrain Work routing. Missing monthly data stays unknown; Code's five-hour/weekly limits are never substituted. No reset time is reported: `subscriptionBalance.expireTime` and `upcomingExpiration.timestamp` are expiration fields, and have not been verified to describe allowance resets. Magpie's compact card currently labels a window with no reset time as "Not used yet" even when usage is nonzero; that host wording does not mean the monthly pool is unused. An observed Windows request was classified by Kimi as `FEATURE_WORK` while the Code five-hour and weekly ratios stayed unchanged. Kimi controls billing, shared allowances, access and rate limits.

Every reasoning-effort value returned by `/models` is retained, including `STANDARD` if listed. The checked Windows catalog in `tests/fixtures/work-models.redacted.json` lists `LOW` (displayed by Kimi as **Standard**), `HIGH` and `MAX`; the plugin sends the advertised effort value instead of guessing from the display label.

## Sign-in and local files

The plugin reads only the desktop app's `daimon-share/daimon/config.json` under:

- Windows: `%APPDATA%/kimi-desktop/`
- macOS: `~/Library/Application Support/kimi-desktop/`
- Linux: `~/.config/kimi-desktop/`

The internal Work credential is named `credentials.kimiCode`, but its origin must be exactly `https://agent-gw.kimi.com/coding/v1`. That Work API key is reread for inference/model discovery and is not copied into the host's auth store. `credentials.kimiWeb.accessToken`, `refreshToken` and `userId` supply the membership sign-in. The plugin rejects missing credentials and other origins. It never writes Kimi configuration or reads Chrome's profile/cookies.

**Storage change in 0.1.5:** the explicit sign-in callback now returns membership access and refresh tokens alongside the hashed account reference for the host to save. Magpie keeps these in its account-scoped `plugin-auth.json`, using flushed atomic writes and mode `0600`; OpenCode uses its own auth store. These are private credential files, not an extra encrypted vault. Keep the host's profile/backups private. The plugin creates no separate token file and never logs tokens or upstream authentication error bodies. Existing reference-only sign-ins must explicitly reconnect with `magpie plugin login kimi-work` to import the pair; usage reads do not silently migrate or write login state. If a refresh token is missing, sign in to desktop and reconnect the provider.

Magpie calls `auth.refresh` before models, usage and requests when the access token is within one minute of its JWT expiry. The hook calls `https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken` and returns the new access/refresh pair. **Magpie owns the commit:** under its auth-store lock it checks that the original credentials still stand before saving, so a late renewal cannot undo logout or overwrite a replacement login. The plugin never calls `client.auth.set` from usage or renewal. Concurrent renewal calls for the same input pair share an exchange; different reconnect credentials have independent pending work and caches even with the same account id.

If the host cannot save, the rotated pair stays in this plugin process for a persistence retry; restarting before it is saved may require signing in again. Network/429/5xx errors retain the stored login. A rejected refresh requires reconnecting. Usage itself is read-only: an unexpected membership 401 is reported as expired, without a forced rotation or blind write. No background heartbeat, browser process or desktop IPC is required. `auth.refresh` and `auth.usage` are Magpie-specific hooks that OpenCode ignores; automatic membership renewal and the monthly quota display are Magpie features, while the Work inference hooks remain available to OpenCode.

Inference still needs the account's local desktop file and valid Work key. Changing that desktop account requires reconnecting for inference, so requests do not silently switch accounts. Web-token renewal does not recreate a revoked Work key. Each device must have its own desktop sign-in. Server revocation/expiry can still require human sign-in; automatic renewal does not promise a permanent session.

## Origin and provider-id conflict

This submission packages the local desktop-sign-in implementation from [`kupakupar/kimi-work-provider`](https://github.com/kupakupar/kimi-work-provider), whose Git-installed package was version 0.1.2. The community package now starts at 0.1.3. The previously stated preservation of model IDs/account references referred only to that implementation: both use `source: "kimi-work-desktop"` and a hashed account reference.

The separate MIT-licensed [`kimi-work-opencode`](https://www.npmjs.com/package/kimi-work-opencode) by Jared Boynton also uses provider ID `kimi-work`. It is not the source or a dependency of this package, and no migration from its authentication format is implemented. **Do not enable both packages together:** they claim the same provider/auth hooks, so load order can replace model/configuration or sign-in handling. Back up your configuration, keep only the desired plugin enabled, and reconnect it using its own sign-in method. This package does not automatically delete or convert the other package's settings or login data.

## Compatibility and validation

These are undocumented desktop interfaces, not a supported public Kimi API. Windows and Apple-silicon macOS have been tested with real Work inference, including streaming. The [macOS record](COMPATIBILITY.md) includes the Kimi build, observed file/fields, real Magpie route and test limits. Linux and Intel macOS remain unverified. Changed desktop layouts stop with a sign-in error; changed upstream schemas stop model discovery or usage with an error. Inference failures are returned without retrying against Code or another service. Users remain responsible for their subscription's terms.

```sh
bun test packages/kimi-work
bun scripts/check.mjs kimi-work
```

Tests use synthetic sessions and fake HTTP responses: credential separation/rotation, explicit reconnect for reference-only accounts, concurrent renewal by credential lineage, host-save retry recovery, process restart, rejected/transient refreshes, read-only local import/usage, account changes, endpoint restrictions, streaming/tool preservation, model discovery and monthly shared-usage accounting. No account, token, prompt, conversation or vendor binary is distributed. No runtime dependencies.
