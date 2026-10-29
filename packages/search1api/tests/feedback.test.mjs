import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Search1APIPlugin } from "../index.mjs";
import { context } from "./helpers.mjs";

const baseUrl = "https://search1api.invalid";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

// Every fetch is replaced: reports may only go to the Search1API API.
async function stub(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), "search1api-feedback-test-"));
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SEARCH1API_API_KEY;
  delete process.env.SEARCH1API_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: new URL(String(url)), ...init };
    calls.push(call);
    assert.equal(call.url.origin, baseUrl);
    return handler(call);
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SEARCH1API_API_KEY;
    else process.env.SEARCH1API_API_KEY = originalKey;
    await rm(directory, { recursive: true, force: true });
  });
  const input = { directory, client: { auth: { set: async () => {} } } };
  return { calls, input };
}

const report = { message: "Empty results for a known page", intent: "search for the docs page, expected it first", category: "bug", model: "fixture-model" };

test("feedback goes to Search1API's feedback API with the caller's credential", async (t) => {
  const f = await stub(t, () => json({ id: "fb_fixture", status: "new" }, 201));
  const plugin = await Search1APIPlugin(f.input, { baseUrl, apiKey: "fixture-key" });
  // The agent decides what to send from the description alone.
  assert.match(plugin.tool.send_feedback.description, /agentback\.app/);
  assert.match(plugin.tool.send_feedback.description, /linked to the signed-in Search1API account/);
  assert.doesNotMatch(plugin.tool.send_feedback.args.properties.intent.description, /trying to accomplish/);
  const text = await plugin.tool.send_feedback.execute(report, context());
  assert.equal(text, "Feedback recorded (fb_fixture). Thank you.");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url.pathname, "/feedback");
  assert.equal(f.calls[0].method, "POST");
  assert.equal(new Headers(f.calls[0].headers).get("authorization"), "Bearer fixture-key");
  assert.deepEqual(JSON.parse(f.calls[0].body), {
    message: report.message,
    intent: report.intent,
    category: "bug",
    agent: { name: "Magpie", model: "fixture-model" },
  });
});

test("a report that cannot be sent never fails the task", async (t) => {
  let status = 503;
  const f = await stub(t, () => json({ ok: false }, status));
  const keyed = await Search1APIPlugin(f.input, { baseUrl, apiKey: "fixture-key" });
  const message = { message: "Missing capability" };
  assert.match(await keyed.tool.send_feedback.execute(message, context()), /not recorded: .*\(503\)/);
  status = 429;
  assert.match(await keyed.tool.send_feedback.execute(message, context()), /not recorded: .*\(429\)/);
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  assert.match(await keyed.tool.send_feedback.execute(message, context()), /not recorded/);
  const signedOut = await Search1APIPlugin(f.input, { baseUrl });
  assert.match(await signedOut.tool.send_feedback.execute(message, context()), /not recorded: Sign in/);
});

test("invalid feedback is refused before any request", async (t) => {
  const f = await stub(t, () => json({}));
  const plugin = await Search1APIPlugin(f.input, { baseUrl, apiKey: "fixture-key" });
  for (const args of [{}, { message: "" }, { message: "x", category: "praise" }, { message: "x", extra: 1 }])
    await assert.rejects(plugin.tool.send_feedback.execute(args, context()));
  assert.equal(f.calls.length, 0);
});
