import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_TOOL_IDS, type AgentToolId } from "../../core/types.ts";
import { AgentToolsCatalog } from "./catalog.ts";
import { discoverTools } from "./discovery.ts";

test("discoverTools returns details for all 5 known agent tools", async () => {
  const toolsMap = await discoverTools();
  assert.equal(toolsMap.size, 5);

  for (const id of AGENT_TOOL_IDS) {
    const details = toolsMap.get(id);
    assert.ok(details, `Tool ${id} should be present in discovery map`);
    assert.equal(details.summary.id, id);
    assert.ok(Array.isArray(details.configuredRoots));
    assert.ok(details.configuredRoots.length > 0);
    assert.ok(Array.isArray(details.configurations));
    assert.ok(details.summary.installation.candidatePaths.length > 0);
    assert.ok(details.lastRefreshedAt);
  }
});

test("AgentToolsCatalog lists all 5 tools and matches capability matrix specification", async () => {
  const catalog = new AgentToolsCatalog();
  const list = await catalog.listTools();

  assert.equal(list.length, 5);
  const ids = list.map((t) => t.id);
  assert.deepEqual(ids, ["codex", "opencode", "claude", "antigravity", "gemini"]);

  // 1. Codex
  const codex = await catalog.getToolDetails("codex");
  assert.ok(codex);
  assert.equal(codex.summary.name, "Codex");
  assert.equal(codex.summary.capabilities.skills, "ready");
  assert.equal(codex.summary.capabilities.subagents, "ready");
  assert.equal(codex.summary.capabilities.instructions, "ready");
  assert.equal(codex.summary.capabilities.mcp, "ready");
  assert.equal(codex.summary.capabilities.config, "ready");
  assert.equal(codex.summary.capabilities.sessions, "ready");

  // 2. OpenCode
  const opencode = await catalog.getToolDetails("opencode");
  assert.ok(opencode);
  assert.equal(opencode.summary.name, "OpenCode");
  assert.equal(opencode.summary.capabilities.skills, "ready");
  assert.equal(opencode.summary.capabilities.subagents, "ready");
  assert.equal(opencode.summary.capabilities.instructions, "ready");
  assert.equal(opencode.summary.capabilities.mcp, "ready");
  assert.equal(opencode.summary.capabilities.config, "ready");
  assert.equal(opencode.summary.capabilities.sessions, "ready");

  // 3. Claude Code
  const claude = await catalog.getToolDetails("claude");
  assert.ok(claude);
  assert.equal(claude.summary.name, "Claude Code");
  assert.equal(claude.summary.capabilities.skills, "ready");
  assert.equal(claude.summary.capabilities.subagents, "unsupported");
  assert.equal(
    claude.subagents.reason,
    "Claude Code does not define standalone global sub-agent definition files in V1.",
  );
  assert.equal(claude.summary.capabilities.instructions, "ready");
  assert.equal(claude.summary.capabilities.mcp, "ready");
  assert.equal(claude.summary.capabilities.config, "ready");
  assert.equal(claude.summary.capabilities.sessions, "ready");

  // 4. Antigravity
  const antigravity = await catalog.getToolDetails("antigravity");
  assert.ok(antigravity);
  assert.equal(antigravity.summary.name, "Antigravity");
  assert.equal(antigravity.summary.capabilities.skills, "ready");
  assert.equal(antigravity.summary.capabilities.subagents, "unsupported");
  assert.equal(
    antigravity.subagents.reason,
    "Antigravity sub-agent definitions are managed via internal workspaces and protocol buffers; standalone file format is outside V1 scope.",
  );
  assert.equal(antigravity.summary.capabilities.instructions, "ready");
  assert.equal(antigravity.summary.capabilities.mcp, "ready");
  assert.equal(antigravity.summary.capabilities.config, "ready");
  assert.equal(antigravity.summary.capabilities.sessions, "unsupported");
  assert.equal(
    antigravity.recentSessions.reason,
    "Antigravity sessions unsupported in V1 because native session decoders (SQLite binary blobs / protocol buffers) are outside V1 scope.",
  );

  // 5. Gemini CLI
  const gemini = await catalog.getToolDetails("gemini");
  assert.ok(gemini);
  assert.equal(gemini.summary.name, "Gemini CLI");
  assert.equal(gemini.summary.capabilities.skills, "ready");
  assert.equal(gemini.summary.capabilities.subagents, "unsupported");
  assert.equal(
    gemini.subagents.reason,
    "Gemini CLI does not provide standalone global sub-agent definition files in V1.",
  );
  assert.equal(gemini.summary.capabilities.instructions, "ready");
  assert.equal(gemini.summary.capabilities.mcp, "ready");
  assert.equal(gemini.summary.capabilities.config, "ready");
  assert.equal(gemini.summary.capabilities.sessions, "unsupported");
  assert.equal(
    gemini.recentSessions.reason,
    "Gemini CLI sessions unsupported in V1 because native session decoders are outside V1 scope.",
  );
});

test("AgentToolsCatalog returns null for invalid tool id", async () => {
  const catalog = new AgentToolsCatalog();
  const result = await catalog.getToolDetails("invalid-tool-id" as AgentToolId);
  assert.equal(result, null);
});

test("AgentToolsCatalog coalesces concurrent calls and caches results in memory", async () => {
  let callCount = 0;
  const mockDiscover = async () => {
    callCount++;
    await new Promise((r) => setTimeout(r, 20));
    return discoverTools();
  };

  const catalog = new AgentToolsCatalog(mockDiscover);

  // Fire 4 simultaneous calls
  const [list1, list2, codex1, opencode1] = await Promise.all([
    catalog.listTools(),
    catalog.listTools(),
    catalog.getToolDetails("codex"),
    catalog.getToolDetails("opencode"),
  ]);

  assert.equal(callCount, 1, "Simultaneous calls must coalesce into exactly 1 discovery probe");
  assert.equal(list1.length, 5);
  assert.equal(list2.length, 5);
  assert.equal(codex1?.summary.id, "codex");
  assert.equal(opencode1?.summary.id, "opencode");

  // Subsequent call after probe completes must read from memory cache
  const list3 = await catalog.listTools();
  assert.equal(callCount, 1, "Cached listTools call must not re-run discovery");
  assert.equal(list3.length, 5);
});

test("AgentToolsCatalog invalidates cache on refresh()", async () => {
  let callCount = 0;
  const mockDiscover = async () => {
    callCount++;
    return discoverTools();
  };

  const catalog = new AgentToolsCatalog(mockDiscover);

  await catalog.listTools();
  assert.equal(callCount, 1);

  // Call refresh
  const refreshed = await catalog.refresh();
  assert.equal(callCount, 2, "refresh() must trigger a new discovery run");
  assert.equal(refreshed.length, 5);

  // Following listTools call should use the refreshed cache
  await catalog.listTools();
  assert.equal(callCount, 2, "Call following refresh must use refreshed cache");
});
