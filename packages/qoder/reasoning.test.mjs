// An earlier assistant turn's thinking goes back to Qoder in
// reasoning_content, as Qoder's own client (qoder-agent-sdk) sends it. The
// plugin left it out from its first version on, so a model behind Qoder
// never saw what it had thought on the turns before (uk.jent on Discord).

import { expect, test } from "bun:test"
import { _internal } from "./index.mjs"

const { qoderMessages } = _internal

const assistants = (out) => out.filter((m) => m.role === "assistant")

test("a reply's thinking goes back with it", () => {
  const out = qoderMessages([
    { role: "user", content: "pick a word" },
    { role: "assistant", content: "Picked.", reasoning_content: "I pick PERIWINKLE." },
    { role: "user", content: "which?" },
  ])
  expect(assistants(out)).toEqual([{ role: "assistant", content: [{ type: "text", text: "Picked." }], reasoning_content: "I pick PERIWINKLE." }])
})

test("a tool call's thinking goes back with it", () => {
  const out = qoderMessages([
    { role: "user", content: "what time is it" },
    {
      role: "assistant",
      content: "",
      reasoning_content: "I should ask the clock.",
      tool_calls: [{ id: "c1", type: "function", function: { name: "get_time", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "c1", content: "12:00" },
  ])
  const [call] = assistants(out)
  expect(call.reasoning_content).toBe("I should ask the clock.")
  expect(call.tool_calls.map((c) => c.id)).toEqual(["c1"])
})

test("thinking sent as reasoning or reasoning_details goes back too", () => {
  const out = qoderMessages([
    { role: "user", content: "a" },
    { role: "assistant", content: "b", reasoning: "thought one" },
    { role: "user", content: "c" },
    { role: "assistant", content: "d", reasoning_details: [{ type: "reasoning.text", text: "thought " }, { type: "reasoning.summary", summary: "two" }] },
    { role: "user", content: "e" },
  ])
  expect(assistants(out).map((m) => m.reasoning_content)).toEqual(["thought one", "thought two"])
})

test("a turn without thinking carries no reasoning_content", () => {
  const out = qoderMessages([
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
    { role: "assistant", content: "", reasoning_content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "ok" },
    { role: "assistant", content: "", reasoning_content: " ", tool_calls: [{ id: "c2", type: "function", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c2", content: "ok" },
  ])
  for (const m of assistants(out)) expect("reasoning_content" in m).toBe(false)
})

test("a turn with only thinking is still left out, as Qoder's client leaves it", () => {
  const out = qoderMessages([
    { role: "user", content: "a" },
    { role: "assistant", content: "", reasoning_content: "cut off while thinking" },
    { role: "user", content: "go on" },
  ])
  expect(assistants(out)).toEqual([])
})

test("a user turn never carries reasoning_content", () => {
  const out = qoderMessages([{ role: "user", content: "a", reasoning_content: "not mine" }])
  expect("reasoning_content" in out[0]).toBe(false)
})
