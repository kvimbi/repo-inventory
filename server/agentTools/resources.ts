import { existsSync, statSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { AgentResourcePreview } from "../../core/types.ts";
import { MAX_PREVIEW_BYTES } from "./bounds.ts";
import type { AgentToolsCatalog } from "./catalog.ts";
import { safeParseToml } from "./toml.ts";

function codexPreview(data: Record<string, unknown>, filePath: string): string {
  const required = ["name", "description", "developer_instructions"] as const;
  const invalid = required.find((key) => typeof data[key] !== "string" || !(data[key] as string).trim());
  if (invalid) throw new Error(`${filePath}: required field '${invalid}' must be a non-empty string`);
  const lines = [
    `name: ${data.name as string}`,
    `description: ${data.description as string}`,
  ];
  for (const key of ["model", "model_reasoning_effort", "sandbox_mode"] as const) {
    if (typeof data[key] === "string") lines.push(`${key}: ${data[key] as string}`);
  }
  lines.push(`developer_instructions:\n${data.developer_instructions as string}`);
  return `${lines.join("\n")}\n`;
}

function truncateUtf8(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.byteLength <= maxBytes) return buffer;
  let leadIndex = maxBytes - 1;
  while (leadIndex > 0 && (buffer[leadIndex] & 0xc0) === 0x80) leadIndex--;
  const lead = buffer[leadIndex];
  const expected = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
  const available = maxBytes - leadIndex;
  return buffer.subarray(0, available < expected ? leadIndex : maxBytes);
}

export async function readResource(
  catalog: AgentToolsCatalog,
  ref: string,
): Promise<AgentResourcePreview> {
  const item = await catalog.lookupRef(ref);
  if (!item) {
    throw new Error(`Unknown resource reference: ${ref}`);
  }

  let filePath = item.path;
  if (!existsSync(filePath)) {
    throw new Error(`Resource file does not exist: ${filePath}`);
  }

  const st = await stat(filePath);
  if (st.isDirectory()) {
    const CANDIDATE_DOC_NAMES = ["SKILL.md", "skill.md", "README.md", "readme.md"];
    let foundDoc: string | null = null;
    for (const cand of CANDIDATE_DOC_NAMES) {
      const candPath = resolve(filePath, cand);
      if (existsSync(candPath) && statSync(candPath).isFile()) {
        foundDoc = candPath;
        break;
      }
    }
    if (!foundDoc) {
      throw new Error(`Resource directory does not contain a readable documentation file: ${filePath}`);
    }
    filePath = foundDoc;
  }

  const fileStat = await stat(filePath);
  const totalBytes = fileStat.size;

  if (item.toolId === "codex" && item.kind === "subagent") {
    const raw = await readFile(filePath, "utf8");
    const parsed = safeParseToml(raw);
    if (!parsed.ok) throw new Error(`${filePath}: invalid TOML`);
    const projected = Buffer.from(codexPreview(parsed.data, filePath), "utf8");
    const bounded = truncateUtf8(projected, MAX_PREVIEW_BYTES);
    return {
      id: item.id,
      name: item.name,
      content: bounded.toString("utf8"),
      isMarkdown: false,
      truncated: projected.byteLength > MAX_PREVIEW_BYTES,
      totalBytes,
    };
  }

  const isTruncated = totalBytes > MAX_PREVIEW_BYTES;
  const bytesToRead = Math.min(totalBytes, MAX_PREVIEW_BYTES);

  const buf = Buffer.alloc(bytesToRead);
  const handle = await open(filePath, "r");
  try {
    await handle.read(buf, 0, bytesToRead, 0);
  } finally {
    await handle.close();
  }

  const content = buf.toString("utf8");
  const ext = extname(filePath).toLowerCase();
  const isMarkdown =
    ext === ".md" ||
    ext === ".markdown" ||
    ext === ".mdown" ||
    ext === ".mkd" ||
    item.kind === "skill" ||
    item.kind === "subagent" ||
    item.kind === "instruction";

  return {
    id: item.id,
    name: item.name,
    content,
    isMarkdown,
    truncated: isTruncated,
    totalBytes,
  };
}
