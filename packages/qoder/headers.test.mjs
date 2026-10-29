// The machine headers a Qoder call carries, against what Qoder's own client
// sends (Qoder.app 0.4.3: its worker runtime and the signer it embeds).
// unifilitence's capture (plugins#443) is the fixture: a Windows x64 chat
// went out with the account's machine UUID as Cosy-ClientIp, -MachineId
// and -MachineToken alike, Cosy-MachineType 5 and Cosy-MachineOS
// x86_64_win32. Qoder's client sends that set on its other calls (its
// prepareRequest), but a chat (prepareInferRequest) carries no ClientIp,
// its device identity's MachineToken and MachineType or none, and the
// machine's hostname. x86_64_win32 is Qoder's own name for the machine.
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { hostname } from "node:os"
import { QoderAuthPlugin, _internal } from "./index.mjs"

const { chatHeaders, cosyHeaders, machineOS, machineHostname } = _internal
const MACHINE = "01a1450c-5eb1-7555-ae94-000000000000" // the capture's, redacted part made up
const cred = { type: "oauth", uid: "u1", machineId: MACHINE, access: "a" }
const URL_CHAT = "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1"
const model = { key: "auto", source: "system" }
const payloadOf = (h) => JSON.parse(Buffer.from(h.Authorization.split(".")[1], "base64").toString())

test("Cosy-MachineOS is Qoder's own: x86_64_win32 on Windows x64, aarch64_darwin on a Mac", () => {
  expect(machineOS("x64", "win32")).toBe("x86_64_win32")
  expect(machineOS("arm64", "darwin")).toBe("aarch64_darwin")
  expect(machineOS("x64", "linux")).toBe("x86_64_linux")
  // Qoder renames only x64 and arm64
  expect(machineOS("ia32", "win32")).toBe("ia32_win32")
})

test("a chat carries no Cosy-ClientIp, and no machine token or type without a device identity", () => {
  const h = chatHeaders(URL_CHAT, cred, "body", undefined, model)
  expect(h["Cosy-ClientIp"]).toBeUndefined()
  expect(h["Cosy-MachineToken"]).toBeUndefined()
  expect(h["Cosy-MachineType"]).toBeUndefined()
  expect(h["Cosy-MachineId"]).toBe(MACHINE)
  expect(h["Cosy-MachineOS"]).toBe(machineOS())
  expect(h.Accept).toBe("text/event-stream")
  expect(h["Cache-Control"]).toBe("no-cache")
  expect(h["X-Model-Key"]).toBe("auto")
  expect(h["X-Model-Source"]).toBe("system")
  expect(h["Cosy-MachineHostname"]).toBe(machineHostname(hostname()))
})

test("a chat carries the device identity's machine token and type when one is known", () => {
  const h = chatHeaders(URL_CHAT, cred, "body", undefined, model, { "Cosy-MachineToken": "sdk-token-u1", "Cosy-MachineType": "7" })
  expect(h["Cosy-MachineToken"]).toBe("sdk-token-u1")
  expect(h["Cosy-MachineType"]).toBe("7")
  expect(h["Cosy-ClientIp"]).toBeUndefined()
})

test("every other call keeps Qoder's prepareRequest set: ClientIp, MachineId and MachineToken the machine id", () => {
  const h = cosyHeaders("https://api3.qoder.sh/algo/api/v2/model/list?Encode=1", cred, "", undefined)
  expect(h["Cosy-ClientIp"]).toBe(MACHINE)
  expect(h["Cosy-MachineId"]).toBe(MACHINE)
  expect(h["Cosy-MachineToken"]).toBe(MACHINE)
  expect(h["Cosy-MachineType"]).toBe("5")
  expect(h["Accept-Encoding"]).toBe("identity")
})

test("the signed payload's request id is a dashed UUID and its ideVersion empty, as Qoder's signer writes them", () => {
  const p = payloadOf(cosyHeaders(URL_CHAT, cred, "body", undefined))
  expect(p.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(p.ideVersion).toBe("")
  expect(p.version).toBe("v1")
})

test("Cosy-MachineHostname is the hostname as Qoder's client makes it safe", () => {
  const h8 = (v) => createHash("sha256").update(v, "utf8").digest("hex").slice(0, 8)
  expect(machineHostname("DESKTOP-ABC123")).toBe("DESKTOP-ABC123")
  expect(machineHostname("  my-mac.local ")).toBe("my-mac.local")
  expect(machineHostname("")).toBe("")
  // a non-ASCII name goes as its punycode
  expect(machineHostname("büro")).toBe("xn--bro-hoa")
  expect(machineHostname("张三的电脑")).toBe("xn--ehq892buuqjgb581a")
  // one that has none is made safe and marked with its hash
  expect(machineHostname("PC 张三")).toBe(`PC-${h8("PC 张三")}`)
  // at most 96 characters
  const long = "a".repeat(120)
  expect(machineHostname(long)).toBe(`${"a".repeat(87)}-${h8(long)}`)
})

test("a chat on the wire carries the chat set, not the machine UUID three times (#443)", async () => {
  const line = (body) => `data:${JSON.stringify({ headers: {}, body: JSON.stringify(body), statusCodeValue: 200 })}\n\n`
  const seen = []
  const saved = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input)
    seen.push({ url, headers: Object.fromEntries(new Headers(init.headers)) })
    if (new URL(url).pathname.endsWith("/model/list")) return Response.json({ chat: [{ key: "dfmodel", display_name: "DeepSeek Flash", enable: true }] })
    return new Response(line({ choices: [{ delta: { content: "ok" } }] }) + line({ choices: [{ delta: {}, finish_reason: "stop" }] }), { headers: { "Content-Type": "text/event-stream" } })
  }
  try {
    const auth = { type: "oauth", access: "jt", refresh: "rt", expires: Date.now() + 3_600_000, accountId: "one@x", uid: "u1", machineId: MACHINE }
    const hooks = await QoderAuthPlugin({ client: { auth: { set: async () => {} } } })
    const l = await hooks.auth.loader(async () => auth)
    const res = await l.fetch("https://api3.qoder.sh/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "dfmodel", messages: [{ role: "user", content: "hi" }] }) })
    expect(res.status).toBe(200)
    await res.text()
    const chat = seen.find((r) => r.url.includes("/agent_chat_generation"))
    expect(chat).toBeDefined()
    expect(chat.headers["cosy-clientip"]).toBeUndefined()
    expect(chat.headers["cosy-machinetoken"]).toBeUndefined()
    expect(chat.headers["cosy-machinetype"]).toBeUndefined()
    expect(chat.headers["cosy-machineid"]).toBe(MACHINE)
    expect(chat.headers.accept).toBe("text/event-stream")
    // the listing is not a chat: it keeps the prepareRequest set
    const list = seen.find((r) => r.url.includes("/model/list"))
    expect(list.headers["cosy-clientip"]).toBe(MACHINE)
    expect(list.headers["cosy-machinetoken"]).toBe(MACHINE)
  } finally {
    globalThis.fetch = saved
  }
})
