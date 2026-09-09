import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface JsonlRecord {
  value: unknown;
  offset: number;
}

export interface JsonlReadResult {
  records: JsonlRecord[];
  version: string;
  incomplete?: string;
}

/** Listing scans only early metadata records, leaving transcript bodies on demand. */
export async function findJsonlRecord(path: string, matches: (record: unknown) => boolean): Promise<unknown | undefined> {
  const stream = createReadStream(path, { start: 0, end: 262_143, encoding: "utf8" });
  let buffered = "";
  for await (const chunk of stream) {
    buffered += chunk as string;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
      if (!line) continue;
      try {
        const record: unknown = JSON.parse(line);
        if (matches(record)) return record;
      } catch {
        // A malformed early record cannot establish checkout ownership.
      }
    }
  }
  return undefined;
}

export async function readJsonl(path: string): Promise<JsonlReadResult> {
  const before = await stat(path);
  const stream = createReadStream(path, { encoding: "utf8" });
  const digest = createHash("sha256");
  const records: JsonlRecord[] = [];
  let buffered = "";
  let offset = 0;
  let incomplete: string | undefined;
  for await (const chunk of stream) {
    const text = chunk as string;
    digest.update(text);
    buffered += text;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
      if (line.trim()) {
        try {
          records.push({ value: JSON.parse(line) as unknown, offset });
        } catch {
          incomplete = "A malformed transcript record was omitted.";
        }
      }
      offset += lineBytes;
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  }
  if (buffered.trim()) incomplete = incomplete ?? "An unterminated transcript tail was omitted.";
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("session history changed while it was read; restart the review");
  return { records, version: digest.digest("hex"), incomplete };
}

export async function hashJsonl(path: string): Promise<string> {
  const before = await stat(path);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("session history changed while it was read; restart the review");
  return digest.digest("hex");
}
