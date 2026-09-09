import { createHash } from "node:crypto";

export const INLINE_BYTES = 2_048;
export const PAGE_BYTES = 64_000;
export const PAGE_ENTRIES = 40;
export const PAYLOAD_BYTES = 16_000;
export const MAX_SESSIONS_PER_TOOL = 50;

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function bounded(value: string, max = INLINE_BYTES): { text?: string; omitted: boolean } {
  if (Buffer.byteLength(value, "utf8") > max) return { omitted: true };
  return { text: value, omitted: false };
}

export function utf8Chunk(value: string, offset: number, maxBytes = PAYLOAD_BYTES): { content: string; next: number } {
  let byteOffset = 0;
  let content = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteOffset >= offset && content && Buffer.byteLength(content, "utf8") + characterBytes > maxBytes) break;
    if (byteOffset >= offset) content += character;
    byteOffset += characterBytes;
  }
  return { content, next: byteOffset };
}

export function textChunks(value: string): string[] {
  if (Buffer.byteLength(value, "utf8") <= PAYLOAD_BYTES) return [value];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < Buffer.byteLength(value, "utf8")) {
    const next = utf8Chunk(value, offset);
    chunks.push(next.content);
    offset = next.next;
  }
  return chunks;
}
