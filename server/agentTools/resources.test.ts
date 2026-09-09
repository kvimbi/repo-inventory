import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PREVIEW_BYTES } from "./bounds.ts";
import { AgentToolsCatalog } from "./catalog.ts";
import { discoverTools } from "./discovery.ts";
import { parseFrontmatter, extractFirstParagraph } from "./adapters/frontmatter.ts";
import { codexAdapter } from "./adapters/codex.ts";
import { opencodeAdapter } from "./adapters/opencode.ts";

test("frontmatter parser handles YAML frontmatter, lists, and fallback markdown paragraph", () => {
  // 1. Full frontmatter with YAML list permissions
  const fullYml = `---
name: Code Reviewer
description: Reviews pull requests for correctness
model: claude-3-7-sonnet
permission:
  - read
  - bash
---
# Instructions
Some content here.
`;
  const parsed1 = parseFrontmatter(fullYml);
  assert.equal(parsed1.name, "Code Reviewer");
  assert.equal(parsed1.description, "Reviews pull requests for correctness");
  assert.equal(parsed1.model, "claude-3-7-sonnet");
  assert.deepEqual(parsed1.permission, ["read", "bash"]);

  // 2. Comma-separated permissions and quoted strings
  const commaYml = `---
name: "Bash Runner"
model: "gpt-4o"
permission: "read, bash, network"
---
Lead paragraph describing the tool.

Second paragraph.
`;
  const parsed2 = parseFrontmatter(commaYml);
  assert.equal(parsed2.name, "Bash Runner");
  assert.equal(parsed2.description, "Lead paragraph describing the tool.");
  assert.equal(parsed2.model, "gpt-4o");
  assert.deepEqual(parsed2.permission, ["read", "bash", "network"]);

  // 3. No frontmatter — lead paragraph fallback
  const noFrontmatter = `# Title of Document

<!-- comment -->
This is the lead paragraph that should be extracted as the description.
It spans multiple lines.

Another paragraph.
`;
  const parsed3 = parseFrontmatter(noFrontmatter);
  assert.equal(parsed3.name, undefined);
  assert.equal(
    parsed3.description,
    "This is the lead paragraph that should be extracted as the description. It spans multiple lines.",
  );

  // 4. extractFirstParagraph helper length capping
  const longText = "A".repeat(300);
  const cap = extractFirstParagraph(longText);
  assert.ok(cap);
  assert.ok(cap.endsWith("…"));
  assert.equal(cap.length, 238);
});

test("adapters discover skills, subagents, instructions, and configurations against synthetic fixtures", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-test-"));

  try {
    const fakeHome = join(baseTmp, "home");
    const codexDir = join(fakeHome, ".codex");
    const opencodeDir = join(fakeHome, ".config", "opencode");

    // Setup synthetic Codex directory
    await mkdir(join(codexDir, "skills", "git-helper"), { recursive: true });
    await writeFile(
      join(codexDir, "skills", "git-helper", "SKILL.md"),
      `---
name: Git Helper
description: Helps manage git branches and stashes
---
# Git Helper Body
Instructions go here.`,
      "utf8",
    );
    await writeFile(join(codexDir, "instructions.md"), "# Codex User Instructions\nBe concise.", "utf8");
    await writeFile(join(codexDir, "config.toml"), 'model = "o3-mini"\n', "utf8");
    await mkdir(join(codexDir, "agents"), { recursive: true });
    await writeFile(
      join(codexDir, "agents", "review.toml"),
      'name = "Review Agent"\ndescription = "Reviews code safely"\ndeveloper_instructions = "Inspect the diff and report actionable findings."\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\n[mcp_servers.secret]\ncommand = "do-not-leak"\n',
      "utf8",
    );

    // Setup synthetic OpenCode directory
    await mkdir(join(opencodeDir, "skills"), { recursive: true });
    await writeFile(
      join(opencodeDir, "skills", "linter.md"),
      `---
name: Code Linter
description: Lints source files
---
Linter doc body.`,
      "utf8",
    );
    await mkdir(join(opencodeDir, "agents"), { recursive: true });
    await writeFile(
      join(opencodeDir, "agents", "tester.md"),
      `---
name: Unit Tester
description: Generates unit tests
model: claude-3-5-sonnet
permission:
  - read
  - bash
---
Tester instructions.`,
      "utf8",
    );
    await writeFile(join(opencodeDir, "INSTRUCTIONS.md"), "# OpenCode Instructions", "utf8");
    await writeFile(join(opencodeDir, "opencode.json"), '{"mcp": {}}\n', "utf8");

    // 1. Test Codex adapter
    const codexSkills = await codexAdapter.discoverSkills([codexDir], fakeHome);
    assert.equal(codexSkills.state, "ready");
    assert.equal(codexSkills.items.length, 1);
    assert.equal(codexSkills.items[0].name, "Git Helper");
    assert.equal(codexSkills.items[0].description, "Helps manage git branches and stashes");
    assert.equal(codexSkills.items[0].origin, "user");
    assert.equal(codexSkills.items[0].activation, "enabled");

    const codexSubagents = await codexAdapter.discoverSubagents([codexDir], fakeHome);
    assert.equal(codexSubagents.state, "ready");
    assert.equal(codexSubagents.items.length, 1);
    assert.equal(codexSubagents.items[0].name, "Review Agent");
    assert.equal(codexSubagents.items[0].modelRestriction, "gpt-5.6-sol");
    assert.equal(codexSubagents.items[0].reasoningEffort, "high");
    assert.equal(codexSubagents.items[0].sandboxMode, "read-only");
    assert.equal(codexSubagents.items[0].canonicalId, await realpath(join(codexDir, "agents", "review.toml")));
    assert.equal(codexSubagents.items[0].origin, "user");

    const codexInst = await codexAdapter.discoverInstructions([codexDir], fakeHome);
    assert.equal(codexInst.state, "ready");
    assert.equal(codexInst.items.length, 1);
    assert.equal(codexInst.items[0].name, "instructions.md");

    const codexConfigs = await codexAdapter.discoverConfigurations([codexDir], fakeHome);
    const existingCodexConfig = codexConfigs.find((c) => c.exists);
    assert.ok(existingCodexConfig);
    assert.equal(existingCodexConfig.label, "config.toml");

    // 2. Test OpenCode adapter
    const opencodeSkills = await opencodeAdapter.discoverSkills([opencodeDir], fakeHome);
    assert.equal(opencodeSkills.state, "ready");
    assert.equal(opencodeSkills.items.length, 1);
    assert.equal(opencodeSkills.items[0].name, "Code Linter");

    const opencodeSubagents = await opencodeAdapter.discoverSubagents([opencodeDir], fakeHome);
    assert.equal(opencodeSubagents.state, "ready");
    assert.equal(opencodeSubagents.items.length, 1);
    assert.equal(opencodeSubagents.items[0].name, "Unit Tester");
    assert.equal(opencodeSubagents.items[0].description, "Generates unit tests");
    assert.equal(opencodeSubagents.items[0].modelRestriction, "claude-3-5-sonnet");
    assert.deepEqual(opencodeSubagents.items[0].toolRestrictions, ["read", "bash"]);

    // 3. Test discoverTools with customHome
    const toolMap = await discoverTools(fakeHome);
    const codexDetails = toolMap.get("codex");
    assert.ok(codexDetails);
    assert.equal(codexDetails.skills.items.length, 1);
    assert.equal(codexDetails.instructions.items.length, 1);
    const preview = await new AgentToolsCatalog(() => discoverTools(fakeHome)).readResource(codexDetails.subagents.items[0].id);
    assert.equal(preview.isMarkdown, false);
    assert.match(preview.content, /developer_instructions:/);
    assert.match(preview.content, /Inspect the diff/);
    assert.doesNotMatch(preview.content, /mcp_servers|do-not-leak/);

    const opencodeDetails = toolMap.get("opencode");
    assert.ok(opencodeDetails);
    assert.equal(opencodeDetails.skills.items.length, 1);
    assert.equal(opencodeDetails.subagents.items.length, 1);
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("symlink deduplication by canonicalId and origin resolution", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-symlink-"));

  try {
    const fakeHome = join(baseTmp, "home");
    const codexDir = join(fakeHome, ".codex");
    const sharedSkillsDir = join(baseTmp, "shared-skills");

    // External shared skill
    await mkdir(join(sharedSkillsDir, "shared-git"), { recursive: true });
    await writeFile(
      join(sharedSkillsDir, "shared-git", "SKILL.md"),
      `---
name: Shared Git
description: Shared enterprise git skill
---
Shared skill content.`,
      "utf8",
    );

    await mkdir(join(codexDir, "skills"), { recursive: true });

    // Link 1: points to external shared skill
    await symlink(
      join(sharedSkillsDir, "shared-git"),
      join(codexDir, "skills", "link-one"),
      "dir",
    );

    // Link 2: duplicate symlink pointing to the same external target
    await symlink(
      join(sharedSkillsDir, "shared-git"),
      join(codexDir, "skills", "link-two"),
      "dir",
    );

    const result = await codexAdapter.discoverSkills([codexDir], fakeHome);
    assert.equal(result.state, "ready");
    // Must be deduplicated down to 1 item
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, "Shared Git");
    // Target is outside ~/.codex root, so origin must be "shared"
    assert.equal(result.items[0].origin, "shared");
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("Codex subagent discovery is ready-empty when agents directory is absent", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-codex-empty-"));
  try {
    const result = await codexAdapter.discoverSubagents([join(baseTmp, "home", ".codex")], join(baseTmp, "home"));
    assert.equal(result.state, "ready");
    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics, undefined);
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("Codex subagent discovery retains valid siblings and sanitizes malformed diagnostics", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-codex-errors-"));
  try {
    const agentDir = join(baseTmp, "home", ".codex", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "valid.toml"), 'name = "Valid"\ndescription = "Works"\ndeveloper_instructions = "Do it"\n', "utf8");
    const secretToken = "malformed-secret-token";
    await writeFile(join(agentDir, "broken.toml"), `name = "${secretToken}\n`, "utf8");
    const result = await codexAdapter.discoverSubagents([join(baseTmp, "home", ".codex")], join(baseTmp, "home"));
    assert.equal(result.state, "error");
    assert.equal(result.items.length, 1);
    assert.ok(result.diagnostics?.every((diagnostic) => !diagnostic.includes(secretToken)));
    assert.ok(result.diagnostics?.every((diagnostic) => diagnostic.includes("invalid") || diagnostic.includes("unable to")));
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("Codex subagent discovery validates required fields and deduplicates shared symlinks", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-codex-links-"));
  try {
    const codexRoot = join(baseTmp, "home", ".codex");
    const externalDir = join(baseTmp, "shared", "agents");
    await mkdir(join(codexRoot, "agents"), { recursive: true });
    await mkdir(externalDir, { recursive: true });
    await writeFile(join(externalDir, "shared.toml"), 'name = "Shared"\ndescription = "Shared agent"\ndeveloper_instructions = "Use it"\n', "utf8");
    await symlink(join(externalDir, "shared.toml"), join(codexRoot, "agents", "link-one.toml"));
    await symlink(join(externalDir, "shared.toml"), join(codexRoot, "agents", "link-two.toml"));
    await writeFile(join(codexRoot, "agents", "wrong-type.toml"), 'name = "Wrong Type"\ndescription = false\ndeveloper_instructions = "Nope"\n', "utf8");
    const result = await codexAdapter.discoverSubagents([codexRoot], join(baseTmp, "home"));
    assert.equal(result.state, "error");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].canonicalId, await realpath(join(externalDir, "shared.toml")));
    assert.equal(result.items[0].origin, "shared");
    assert.ok(result.diagnostics?.some((diagnostic) => diagnostic.includes("description") && diagnostic.includes("wrong-type.toml")));
    assert.ok(result.diagnostics?.every((diagnostic) => !diagnostic.includes("Wrong Type")));
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("Codex preview sanitizes malformed TOML and truncates on UTF-8 boundaries", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-codex-preview-"));
  try {
    const codexDir = join(baseTmp, "home", ".codex");
    const agentPath = join(codexDir, "agents", "large.toml");
    await mkdir(join(codexDir, "agents"), { recursive: true });
    await writeFile(agentPath, `name = "Large"\ndescription = "Large"\ndeveloper_instructions = "${"é".repeat(140000)}"\n`, "utf8");
    const catalog = new AgentToolsCatalog(() => discoverTools(join(baseTmp, "home")));
    const details = await catalog.getToolDetails("codex");
    assert.ok(details);
    const preview = await catalog.readResource(details.subagents.items[0].id);
    assert.equal(preview.truncated, true);
    assert.ok(Buffer.byteLength(preview.content, "utf8") <= MAX_PREVIEW_BYTES);
    assert.equal(preview.content.includes("�"), false);
    await writeFile(agentPath, 'name = "malformed-secret-token\n', "utf8");
    await assert.rejects(() => catalog.readResource(details.subagents.items[0].id), /invalid TOML/);
    await assert.rejects(
      () => catalog.readResource(details.subagents.items[0].id),
      (error: unknown) => error instanceof Error && !error.message.includes("malformed-secret-token"),
    );
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("readResource returns bounded content and marks truncated", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-preview-"));

  try {
    const fakeHome = join(baseTmp, "home");
    const codexDir = join(fakeHome, ".codex");
    await mkdir(join(codexDir, "skills", "huge-skill"), { recursive: true });

    // Create a 300 KB markdown document (> MAX_PREVIEW_BYTES = 256,000)
    const largeDoc = "---\nname: Huge Skill\n---\n# Huge Skill\n" + "x".repeat(300_000);
    await writeFile(join(codexDir, "skills", "huge-skill", "SKILL.md"), largeDoc, "utf8");

    const catalog = new AgentToolsCatalog(() => discoverTools(fakeHome));
    const codex = await catalog.getToolDetails("codex");
    assert.ok(codex);
    assert.equal(codex.skills.items.length, 1);
    const skillRef = codex.skills.items[0].id;

    const preview = await catalog.readResource(skillRef);
    assert.equal(preview.id, skillRef);
    assert.equal(preview.name, "Huge Skill");
    assert.equal(preview.isMarkdown, true);
    assert.equal(preview.truncated, true);
    assert.equal(preview.content.length, MAX_PREVIEW_BYTES);
    assert.equal(preview.totalBytes, largeDoc.length);
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("readResource rejects unknown and forged refs", async () => {
  const catalog = new AgentToolsCatalog();
  await assert.rejects(
    async () => {
      await catalog.readResource("forged-nonexistent-ref");
    },
    {
      name: "Error",
      message: /Unknown resource reference: forged-nonexistent-ref/,
    },
  );
});

test("openConfiguration validates ref, existence, canonicalPath, and action", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "agent-tools-opener-"));

  try {
    const fakeHome = join(baseTmp, "home");
    const codexDir = join(fakeHome, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "config.toml"), 'key = "val"\n', "utf8");

    const catalog = new AgentToolsCatalog(() => discoverTools(fakeHome));
    const codex = await catalog.getToolDetails("codex");
    assert.ok(codex);

    const cfgRef = codex.configurations.find((c) => c.exists)?.id;
    assert.ok(cfgRef);

    // 1. Unknown ref
    const resUnknown = await catalog.openConfiguration("unknown-ref-xyz", "editor");
    assert.equal(resUnknown.ok, false);
    assert.ok(resUnknown.message?.includes("Unknown configuration reference"));

    // 2. Non-existent file reference
    const missingCfg = codex.configurations.find((c) => !c.exists);
    if (missingCfg) {
      const resMissing = await catalog.openConfiguration(missingCfg.id, "editor");
      assert.equal(resMissing.ok, false);
      assert.ok(resMissing.message?.includes("File does not exist"));
    }

    // 3. Invalid action
    // @ts-expect-error testing runtime invalid action
    const resInvalidAction = await catalog.openConfiguration(cfgRef, "invalid-action");
    assert.equal(resInvalidAction.ok, false);
    assert.ok(resInvalidAction.message?.includes("Invalid action"));
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});
