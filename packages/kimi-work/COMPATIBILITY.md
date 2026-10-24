# macOS compatibility record

## 0.1.6 upstream integration and cancellation regression

Version 0.1.6 incorporates upstream `d324a96` (issue #287), retaining its tool-schema conversion and fixtures, alongside PR #218's membership renewal and single shared monthly meter. The merge conflict was only the `_internal` test-export list; both sets of exports are kept. The official upstream 0.1.5 and the earlier local PR 0.1.5 are different builds. A membership pair already imported by the local PR build stays usable without reconnecting; reference-only official sign-ins still need explicit reconnect.

Independent review of the first merged candidate found a P2 inherited from the upstream body-buffering path: cancelling a partially produced Request/ReadableStream did not interrupt `Response.text()`, so a cancelled request could remain pending. The correction reads with a reader bound to the caller's abort signal, cancels it on abort, preserves the original cancellation reason, and removes the listener/releases the lock. It does not send the request after cancellation. The schema conversion itself is unchanged from upstream; the sign-in, renewal and monthly usage blocks are unchanged from the previously reviewed local build `36f575b`.

Validation on Bun 1.4.3 uses disposable HOME/XDG directories, without real credentials:

- **50 provider tests**, **189 assertions**, including the 7 upstream schema tests and 4 body/cancellation regressions.
- **2158 full-repository tests**, 0 failures; **21 plugin hook checks** passed.
- Slow Request and direct stream cancellation, an already-aborted body, and UTF-8 split across byte chunks are covered. Existing schema, streaming, credential-lineage and host-save-retry regressions remain green.

The independent re-review cleared the cancellation finding. Separate Node and Bun 1.4.3 probes confirmed timely cancellation with no upstream request, original error/reason preservation, listener and reader-lock cleanup, and unchanged normal UTF-8/authentication/SSE behavior. The reviewer independently reran the 50 provider tests and focused hook check; it did not access real credentials or perform deployment.

The first full-suite attempt used an isolated HOME under `/private/tmp`, which the repository's macOS temporary-directory guard rejected. Re-running with HOME inside the current `os.tmpdir()` passed; no other package was changed to bypass that guard. These are synthetic integration/regression results. They do not claim a new live Work inference request or a months-long renewal test. User-authorized local deployment and quota acceptance are recorded separately from these checks.

## PR #218 independent security review

The initial 0.1.5 implementation at `91f52c7` had two reproducible races: usage could restore a signed-out account or overwrite a replacement login because `getAuth` followed by `client.auth.set` is not a conditional write; and a same-uid reconnect could inherit the previous login's pending refresh failure.

The revision removes usage-side rotation, persistence and automatic legacy import. Only explicit sign-in imports credentials; only `auth.refresh` rotates them. Magpie's native renewal commits the returned fields while comparing the expected access/refresh pair under the same auth-store lock. Usage reads stored credentials without writing them. Pending work and cached rotations are keyed by the exact credential pair, preserving independent reconnects. Reference-only accounts need explicit reconnect, and usage no longer forces a refresh after an unexpected 401.

The independent reviewer reproduced the original failures using synthetic credentials and the production host's auth-store/client functions in an isolated VM. The same production native renewal code preserved concurrent logout and replacement login. Current provider regressions include failed host-save retries through subsequent access-token expiry and separate same-uid credential lineages. This review makes no new request with real credentials and does not change the user's configuration. It does not establish long-term vendor refresh policy or solve independent native-host error-notification/cross-process coordination behavior.

The independent second review cleared both findings with no remaining in-scope blocker. It separately passed **39 provider tests**, the focused hook check, and **9 deterministic production-host VM cases**: read-only usage during logout/replacement; native renewal during logout/replacement; fresh/due reconnects during an old 401; 16 concurrent native refresh calls sharing one exchange; actual rename/EIO save failures recovering across access expiry while retaining mode `0600` and account metadata; and recovery through four rotation generations without reusing spent tokens. A separate plugin instance read the persisted pair. The parent run passed **1804 full-repository tests**, **39 provider tests**, and all provider hook checks. These are synthetic host/provider checks, not a new live Kimi or OpenCode run.

## Initial 0.1.5 live probe (before security review)

Observed on Apple-silicon macOS at **2026-10-18 01:43 UTC**, using official Magpie **0.1.1279** and Bun **1.4.3**. This run used a disposable HOME and XDG profile. Only the local desktop Work/membership credential fields were copied into that private test home; the everyday Magpie profile and Kimi desktop files were not changed.

- The saved desktop membership access token returned HTTP **401** before the test.
- `magpie plugin add <local-kimi-work-folder>` and `magpie plugin login kimi-work 1` succeeded in the isolated profile.
- The plugin renewed the membership session directly with Kimi and saved a changed access token **and** refresh token into the isolated host's `plugin-auth.json`. Its observed mode was **0600**. The Work API key was absent from that store.
- The saved new access token read `GetSubscriptionStats` with HTTP **200**. `magpie quota kimi-work --json` showed **月度共享额度** and **其中 Kimi Code（月度总额占比）**. The live Code fraction was nested at `subscriptionBalance.kimiCodeUsedRatio`; no account-specific usage values are included in this record.
- A separate Magpie process ran `magpie quota refresh kimi-work --json`, explicitly asking for a fresh read, and returned the monthly window without an error. It reused the saved new access/refresh pair. No browser, cookies, desktop IPC or new human login was used.
- Content hashes of the existing Magpie providers, settings, plugin list and plugin auth, and the existing Kimi desktop configuration, were unchanged. The disposable home and its credentials were removed afterward.

The renewal RPC/rotation format was also checked against Kimi's current public [web token module](https://statics.moonshot.cn/kimi-web-seo/assets/token-Cpryl615.js). This is an undocumented service. One successful rotation and a separate-process fresh quota read do not establish months of session survival or the server's revocation policy. This upgrade did not send a new inference request; earlier live Work streaming evidence remains below.

At that initial revision, **38 provider tests passed**, **1803 full-repository tests passed**, and `bun scripts/check.mjs` passed for every provider. Those tests did not cover the two real host interleavings above; they are historical evidence, not approval of the superseded usage-side persistence design.

## Upgrade 0.1.4

On Windows 11, 2026-10-17, the upgraded provider read the existing ordinary desktop Work sign-in and live model catalog/usage. An isolated adapter inserted a shared instruction and passed its messages through this provider unchanged to the real Work service. The streamed response was HTTP 200 with `[DONE]` and the exact marker present only in that instruction. The live desktop applications and their configurations were not switched for this request. Synthetic regression tests cover credential rotation, account binding, Request bodies, prompt/tool/stream preservation, expired sign-in, unchanged concurrency/quota/5xx responses, network diagnostics, cancellation and read-only desktop import.

On macOS 26.6.2 arm64, Kimi 3.2.17 build 3.2.17.4, at 2026-10-17 04:37 UTC, version 0.1.4 again read the existing Work sign-in, discovered `k3-agent` and `k2d8-preview`, and returned one shared membership window. This upgrade probe did not submit a Mac desktop conversation; the earlier streamed macOS inference evidence below remains a separate record.

At **2026-10-17 05:31 UTC**, the corrected 0.1.4 provider was also tested through the user's active Mac profile: ordinary Kimi's authenticated loopback adapter → official Magpie 0.1.1276 → Kimi Work `k3-agent`. The Agent was the community-published 0.1.1; the provider was a persistent local source pending this PR. One synthetic streamed request returned HTTP 200, `[DONE]` and exactly `KIMI_MAC_ROUTED_OK`, with a newly appended Magpie usage record identifying `agent: kimi-desktop`, `provider: kimi-work`, `model: k3-agent`, `status: 200`. Desktop credentials, provider settings, general settings and plugin auth were verified unchanged. This request was sent by an HTTP probe, not submitted through the desktop UI. The 429/5xx/network failure cases were tested with synthetic responses, not forced against Kimi's live service.

Observed at **2026-10-16 20:09 UTC** (2026-10-17 04:09 UTC+8).

| Component | Observed version |
|---|---|
| macOS | 26.6.2, Apple silicon / arm64 |
| Ordinary Kimi desktop | 3.2.17, build 3.2.17.4, `com.moonshot.kimichat` |
| Official Magpie | 0.1.1276 |
| Bun | 1.4.3, temporary test runtime |
| Provider code | `d5f84153116a28dcffb89f61a0f4435093d0483e`, package 0.1.3 |

The official Apple-silicon Kimi desktop application was installed; the user signed in personally and opened Work. The provider was installed and signed in using `magpie plugin add <temporary-provider-folder>` and `magpie plugin login kimi-work` in an isolated `XDG_CONFIG_HOME`, while retaining the real macOS home for read-only desktop-session discovery. `MAGPIE_BUN` selected the temporary runtime. The user's everyday Magpie profile was not replaced or restarted.

## File and fields actually observed

The file exists at:

```text
~/Library/Application Support/kimi-desktop/daimon-share/daimon/config.json
```

All four credential values were present and nonempty. This fragment shows field names only; **every value is redacted**:

```json
{
  "credentials": {
    "kimiCode": {
      "apiKey": "<redacted>",
      "baseUrl": "<redacted>"
    },
    "kimiWeb": {
      "accessToken": "<redacted>",
      "userId": "<redacted>"
    }
  }
}
```

The Work credential's origin matched the exact Work origin required by `readDesktop`. No actual value, account identifier, raw config or auth file was exported.

## Executed checks

- Desktop sign-in succeeded, saving only the provider's account reference in the isolated Magpie profile.
- Live model discovery returned `k3-agent` and `k2d8-preview`, each with `low`, `high` and `max` reasoning variants.
- Membership usage was read successfully. The result had one shared-allowance window and no `resetsAt`.
- Calling the provider's sign-in, model and usage hooks left Kimi's configuration byte-for-byte unchanged.
- One real, synthetic streamed inference was sent through the Kimi Agent adapter, the isolated official Magpie gateway and this provider to the real Work service. It returned HTTP 200, `[DONE]`, and exactly `KIMI_WORK_MAC_OK`.

Magpie's resulting route record, projected to non-sensitive fields:

```json
{
  "agent": "kimi-desktop",
  "provider": "kimi-work",
  "model": "k3-agent",
  "requested": "kimi-work/k3-agent",
  "served": "k3-agent",
  "status": 200
}
```

The inference was initiated by a synthetic HTTP client at the adapter's authenticated loopback endpoint. It was **not** a message submitted through Kimi's desktop UI. The control API/runtime, Magpie gateway, provider and Work service were real, not mock servers. No response was substituted. This run did not measure Kimi's billing classification or reset schedule.

After the adapter test, its original service address, current model, native catalog, credentials and unrelated settings were verified restored. The temporary model snapshot was removed, and the separate test gateway was stopped. The user's Kimi login remained in place.

This record covers this Apple-silicon/macOS/Kimi build. Intel macOS, Linux, desktop UI turns, sleep/wake, natural token expiry and future Kimi releases remain outside this run. Synthetic rotation/account-change/error cases remain in the package's unit tests.
