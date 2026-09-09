import type { Probe, AgentSkill } from "../core/types.ts";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SKILL_ROOTS = [".agents/skills", ".claude/skills"] as const;
const CANDIDATE_DOC_NAMES = ["SKILL.md", "skill.md", "README.md", "readme.md"] as const;
const MAX_HEADER_BYTES = 4096;

/**
 * Extracts skill name and description from frontmatter or lead markdown paragraph.
 */
function parseSkillMetadata(raw: string, fallbackName: string): { name: string; description?: string } {
  let name = fallbackName;
  let description: string | undefined;

  const trimmed = raw.trim();
  if (trimmed.startsWith("---")) {
    const endIdx = trimmed.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const frontmatter = trimmed.slice(3, endIdx);
      for (const line of frontmatter.split("\n")) {
        const nameMatch = /^name:\s*["']?([^"'\n\r]+)["']?/i.exec(line.trim());
        if (nameMatch && nameMatch[1]) {
          name = nameMatch[1].trim();
        }
        const descMatch = /^description:\s*["']?([^"'\n\r]+)["']?/i.exec(line.trim());
        if (descMatch && descMatch[1]) {
          description = descMatch[1].trim();
        }
      }

      const body = trimmed.slice(endIdx + 4).trim();
      if (!description && body) {
        description = extractFirstParagraph(body);
      }
      return { name, description };
    }
  }

  // No YAML frontmatter — use lead paragraph as description
  description = extractFirstParagraph(trimmed);
  return { name, description };
}

function extractFirstParagraph(content: string): string | undefined {
  const lines = content.split("\n");
  const paraLines: string[] = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l) {
      if (paraLines.length > 0) break;
      continue;
    }
    // Skip headings, comments, blockquotes, code blocks, or horizontal rules
    if (
      l.startsWith("#") ||
      l.startsWith("<!--") ||
      l.startsWith("```") ||
      l.startsWith("---") ||
      l.startsWith("===") ||
      l.startsWith(">")
    ) {
      continue;
    }
    paraLines.push(l);
  }

  if (paraLines.length === 0) return undefined;
  const combined = paraLines.join(" ");
  return combined.length > 240 ? `${combined.slice(0, 237)}…` : combined;
}

async function tryReadHeader(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath);
    return buf.subarray(0, MAX_HEADER_BYTES).toString("utf8");
  } catch {
    return null;
  }
}

export const probe: Probe = {
  name: "agent-skills",
  order: 55,
  async detect({ path, facts, quick }) {
    if (quick && facts.skills !== undefined) {
      return {};
    }

    const found: AgentSkill[] = [];
    const seenNames = new Set<string>();

    for (const skillRoot of SKILL_ROOTS) {
      const fullSkillRoot = join(path, skillRoot);
      try {
        const rootStat = await stat(fullSkillRoot);
        if (!rootStat.isDirectory()) continue;
      } catch {
        continue;
      }

      let entries;
      try {
        entries = await readdir(fullSkillRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          const dirRelPath = `${skillRoot}/${entry.name}`;
          let docRelFile: string | undefined;
          let docContent: string | null = null;

          // Check standard candidate files inside skill folder
          for (const cand of [...CANDIDATE_DOC_NAMES, `${entry.name}.md`]) {
            const fullCandPath = join(fullSkillRoot, entry.name, cand);
            const content = await tryReadHeader(fullCandPath);
            if (content !== null) {
              docRelFile = `${dirRelPath}/${cand}`;
              docContent = content;
              break;
            }
          }

          const parsed = docContent
            ? parseSkillMetadata(docContent, entry.name)
            : { name: entry.name, description: undefined };

          if (!seenNames.has(parsed.name)) {
            seenNames.add(parsed.name);
            found.push({
              name: parsed.name,
              relPath: dirRelPath,
              description: parsed.description,
              docFile: docRelFile,
            });
          }
        } else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("README")) {
          const baseName = entry.name.slice(0, -3);
          const fileRelPath = `${skillRoot}/${entry.name}`;
          const fullFilePath = join(fullSkillRoot, entry.name);
          const docContent = await tryReadHeader(fullFilePath);

          const parsed = docContent
            ? parseSkillMetadata(docContent, baseName)
            : { name: baseName, description: undefined };

          if (!seenNames.has(parsed.name)) {
            seenNames.add(parsed.name);
            found.push({
              name: parsed.name,
              relPath: fileRelPath,
              description: parsed.description,
              docFile: fileRelPath,
            });
          }
        }
      }
    }

    if (found.length === 0) return {};
    // Sort skills alphabetically by name for deterministic order
    found.sort((a, b) => a.name.localeCompare(b.name));
    return { skills: found };
  },
};
