import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { startOAuth } from "../src/oauth.ts";
import { fixture } from "./helpers.mjs";

const registrations = (f) => f.calls.filter((call) => call.path === "/register").length;

async function signIn(login) {
  await fetch(login.url);
  return login.callback();
}

test("browser OAuth uses PKCE S256, public registration, state and issuer checks", async (t) => {
  const f = await fixture(t);
  const login = await startOAuth(f.baseUrl, 1000);
  const authURL = new URL(login.url);
  assert.equal(authURL.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authURL.searchParams.get("utm_source"), "magpie");
  const redirect = new URL(authURL.searchParams.get("redirect_uri"));
  redirect.searchParams.set("state", "wrong");
  redirect.searchParams.set("code", "wrong");
  assert.equal((await fetch(redirect)).status, 400);
  redirect.searchParams.set("state", authURL.searchParams.get("state"));
  redirect.searchParams.set("iss", "https://wrong.example");
  assert.equal((await fetch(redirect)).status, 400);
  const browser = await fetch(login.url);
  assert.equal(browser.status, 200);
  const response = await login.callback();
  assert.equal(response.type, "success");
  assert.equal(response.access, "test-access-0");
  assert.equal(response.refresh, "test-refresh-0");
  assert.equal(response.clientId, "test-public-client");
  assert.equal(f.state.grants, 1);
  assert.equal((await login.callback()).type, "failed");
  assert.equal(f.state.grants, 1);
});

test("declined consent and abandoned sign-ins finish without leaking tokens or callback listeners", async (t) => {
  const f = await fixture(t);
  f.state.decline = true;
  const declined = await startOAuth(f.baseUrl, 1000);
  await fetch(declined.url);
  assert.match((await declined.callback()).error, /declined/);
  const abandoned = await startOAuth(f.baseUrl, 40);
  assert.match((await abandoned.callback()).error, /timed out/);
  const redirect = new URL(abandoned.url).searchParams.get("redirect_uri");
  await assert.rejects(fetch(redirect));
});

test("sign-ins reuse the registered client and its callback port", async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, "search1api-oauth-client.json");
  const first = await startOAuth(f.baseUrl, 1000, file);
  assert.equal((await signIn(first)).type, "success");
  const second = await startOAuth(f.baseUrl, 1000, file);
  assert.equal(
    new URL(second.url).searchParams.get("redirect_uri"),
    new URL(first.url).searchParams.get("redirect_uri"),
  );
  const result = await signIn(second);
  assert.equal(result.type, "success");
  assert.equal(result.clientId, "test-public-client");
  assert.equal(registrations(f), 1);
  assert.equal(f.state.grants, 2);
});

test("a busy callback port or a saved client for another issuer registers anew", async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, "search1api-oauth-client.json");
  const first = await startOAuth(f.baseUrl, 1000, file);
  await signIn(first);
  const port = new URL(new URL(first.url).searchParams.get("redirect_uri")).port;
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(Number(port), "127.0.0.1", resolve));
  t.after(() => blocker.close());
  const busy = await startOAuth(f.baseUrl, 1000, file);
  assert.notEqual(new URL(new URL(busy.url).searchParams.get("redirect_uri")).port, port);
  assert.equal((await signIn(busy)).type, "success");
  assert.equal(registrations(f), 2);
  await writeFile(file, JSON.stringify({ issuer: "https://other.example", clientId: "x", redirectUri: "http://127.0.0.1:1/callback" }));
  await signIn(await startOAuth(f.baseUrl, 1000, file));
  assert.equal(registrations(f), 3);
});

test("a reused client that does not finish signing in is forgotten", async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, "search1api-oauth-client.json");
  await signIn(await startOAuth(f.baseUrl, 1000, file));
  f.state.decline = true;
  assert.equal((await signIn(await startOAuth(f.baseUrl, 1000, file))).type, "failed");
  await assert.rejects(access(file));
  f.state.decline = false;
  assert.equal((await signIn(await startOAuth(f.baseUrl, 1000, file))).type, "success");
  assert.equal(registrations(f), 2);
});
