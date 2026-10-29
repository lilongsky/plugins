// The daily credits' window (sdytman on Discord: qoder每天10点开始签到).
// Qoder lists each day's 100 credits from 10:00 (UTC+8) to 09:59 the next
// day; testdata/campaigns-1028.json is a live list read at 09:27 (UTC+8)
// on 2026-10-28, the day before's campaign still open. A check-in says
// when the next one opens (until), so magpie asks again then instead of at
// the next calendar day, whatever zone the machine is in: run this file
// with TZ=UTC and TZ=Etc/GMT+8 (UTC-8) too.
import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { QoderAuthPlugin, QoderCNAuthPlugin } from "./index.mjs"

const real = globalThis.fetch
const originalRuntime = process.env.QODER_RUNTIME_INFO
const originalCNRuntime = process.env.QODERCN_RUNTIME_INFO
let sandbox, native
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "qoder-checkin-window-"))
  process.env.QODER_RUNTIME_INFO = join(sandbox, process.platform === "win32" ? "runtime-info.exe" : "runtime-info")
  writeFileSync(process.env.QODER_RUNTIME_INFO, "fixture")
  process.env.QODERCN_RUNTIME_INFO = process.env.QODER_RUNTIME_INFO
  native = spyOn(childProcess, "execFile").mockImplementation((file, args, options, done) => ({
    stdin: { on() {}, end() { queueMicrotask(() => done(null, JSON.stringify({ machineToken: "mt", machineType: "cfe1" }))) } },
  }))
})
afterEach(() => {
  globalThis.fetch = real
  native.mockRestore()
  setSystemTime()
  if (originalRuntime === undefined) delete process.env.QODER_RUNTIME_INFO
  else process.env.QODER_RUNTIME_INFO = originalRuntime
  if (originalCNRuntime === undefined) delete process.env.QODERCN_RUNTIME_INFO
  else process.env.QODERCN_RUNTIME_INFO = originalCNRuntime
  const target = realpathSync(sandbox)
  if (!target.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("test directory escaped temp root")
  rmSync(target, { recursive: true, force: true })
})

// the live list: the campaign of 10-27 10:00 to 10-28 09:59 (UTC+8)
const LIVE = JSON.parse(readFileSync(join(import.meta.dir, "testdata", "campaigns-1028.json"), "utf8"))
const OCT27 = LIVE.campaigns[0]
// the next day's, as Qoder lists one: a day later, the same length
const OCT28 = { ...OCT27, campaignId: "oct28", campaignKey: "act-20261028-1", startAt: OCT27.startAt + 86400, endAt: OCT27.endAt + 86400 }
const listOf = (...cs) => ({ ...LIVE, campaigns: cs })

const account = () => ({
  type: "oauth", access: "jt", refresh: "rt", expires: Date.now() + 3_600_000,
  accountId: "one@x", uid: "u1", deviceToken: "dt", deviceRefresh: "drt",
})
const json = (v, status = 200) => new Response(JSON.stringify(v), { status })

async function checkin(make, list) {
  let auth = account()
  const claims = []
  globalThis.fetch = async (url) => {
    const u = new URL(String(url))
    if (u.pathname.endsWith("/claim")) {
      claims.push(u.pathname.split("/").at(-2))
      return json({ status: "CLAIMED", benefit: { amount: 100 } })
    }
    return json(list)
  }
  const hooks = await make({ client: { auth: { set: async ({ body }) => (auth = body) } } })
  return { out: await hooks.auth.checkin(async () => auth), claims }
}

// 10:01 (UTC+8) on the day: a minute after the campaign opens
const askAt = (day) => `2026-10-${day}T02:01:00.000Z`

test("the live list's fixture is the day before's campaign, 10:00 to 09:59 (UTC+8)", () => {
  expect(new Date(OCT27.startAt * 1000).toISOString()).toBe("2026-10-27T02:00:00.000Z")
  expect(new Date(OCT27.endAt * 1000).toISOString()).toBe("2026-10-28T01:59:00.000Z")
  expect(OCT27.placements[0].content.en.description).toContain("Daily reset: 10:00 (UTC+8)")
})

for (const make of [QoderAuthPlugin, QoderCNAuthPlugin]) {
  const site = make === QoderAuthPlugin ? "qoder" : "qoder-cn"

  test(`${site}: before 10:00 the day before's credits are claimed, and the check-in asks again at 10:00`, async () => {
    setSystemTime(new Date("2026-10-28T01:27:00Z")) // 09:27 (UTC+8), as the live list was read
    const p = await checkin(make, LIVE)
    expect(p.claims).toEqual([OCT27.campaignId])
    expect(p.out).toEqual({ outcome: "claimed", credit: 100, until: askAt(28) })
  })

  test(`${site}: before 10:00 with the day before's already claimed is done until 10:00, not the day`, async () => {
    setSystemTime(new Date("2026-10-28T01:27:00Z"))
    const p = await checkin(make, listOf({ ...OCT27, claimStatus: "CLAIMED" }))
    expect(p.claims).toEqual([])
    expect(p.out).toEqual({ outcome: "done", credit: 100, until: askAt(28) })
  })

  test(`${site}: after 10:00 today's credits are claimed, and the next ask is tomorrow 10:00`, async () => {
    setSystemTime(new Date("2026-10-28T02:01:30Z")) // 10:01 (UTC+8)
    const p = await checkin(make, listOf({ ...OCT27, claimStatus: "CLAIMED", endAt: OCT27.endAt }, OCT28))
    expect(p.claims).toEqual(["oct28"])
    expect(p.out).toEqual({ outcome: "claimed", credit: 100, until: askAt(29) })
  })

  test(`${site}: across midnight (UTC+8) a claimed campaign holds until 10:00, not until the date changes`, async () => {
    for (const t of ["2026-10-28T15:59:00Z", "2026-10-28T16:01:00Z"]) { // 23:59 and 00:01 (UTC+8)
      setSystemTime(new Date(t))
      const p = await checkin(make, listOf({ ...OCT28, claimStatus: "CLAIMED" }))
      expect(p.out).toEqual({ outcome: "done", credit: 100, until: askAt(29) })
    }
  })

  test(`${site}: between the old campaign's end and 10:00 the check-in fails and asks again at 10:00`, async () => {
    setSystemTime(new Date("2026-10-28T01:59:30Z")) // 09:59:30 (UTC+8)
    const p = await checkin(make, listOf({ ...OCT27, claimStatus: "CLAIMED" }))
    expect(p.out).toEqual({ outcome: "failed", message: "campaigns: today's credits aren't offered yet", until: askAt(28) })
  })
}

test("a campaign longer than a day is asked again at its end", async () => {
  setSystemTime(new Date("2026-10-28T03:00:00Z"))
  const long = { ...OCT28, claimStatus: "CLAIMED", endAt: OCT28.startAt + 3 * 86400 }
  const p = await checkin(QoderAuthPlugin, listOf(long))
  expect(p.out.until).toBe(new Date((long.endAt + 60) * 1000).toISOString())
})

test("times in milliseconds read the same as in seconds", async () => {
  setSystemTime(new Date("2026-10-28T01:27:00Z"))
  const p = await checkin(QoderAuthPlugin, listOf({ ...OCT27, claimStatus: "CLAIMED", startAt: OCT27.startAt * 1000, endAt: OCT27.endAt * 1000 }))
  expect(p.out).toEqual({ outcome: "done", credit: 100, until: askAt(28) })
})
