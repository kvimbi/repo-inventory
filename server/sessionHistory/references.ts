interface SessionReference { sourceId: string; nativeSessionId: string; }
interface CallReference extends SessionReference { nativeCallId: string; }
interface EntryReference extends SessionReference { nativeRecordId: string; blockIndex: number; chunkIndex: number; }

const MAX_REFERENCE_BYTES = 8_192;

function encode(prefix: string, tuple: unknown[]): string {
  return `${prefix}${Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url")}`;
}

function decode(value: string, prefix: string, length: number): unknown[] {
  if (!value.startsWith(prefix) || Buffer.byteLength(value, "utf8") > MAX_REFERENCE_BYTES) throw new Error("invalid history reference");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== length) throw new Error("invalid history reference");
    return parsed;
  } catch {
    throw new Error("invalid history reference");
  }
}

function stringTuple(values: unknown[], numbers = 0): string[] {
  const strings = values.slice(0, values.length - numbers);
  if (!strings.every((value) => typeof value === "string" && value.length > 0)) throw new Error("invalid history reference");
  if (!values.slice(values.length - numbers).every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0)) throw new Error("invalid history reference");
  return strings as string[];
}

export function sessionReference(sourceId: string, nativeSessionId: string): string {
  return encode("gh1_", [sourceId, nativeSessionId]);
}

export function callReference(sourceId: string, nativeSessionId: string, nativeCallId: string): string {
  return encode("gc1_", [sourceId, nativeSessionId, nativeCallId]);
}

export function entryReference(sourceId: string, nativeSessionId: string, nativeRecordId: string, blockIndex = 0, chunkIndex = 0): string {
  return encode("ge1_", [sourceId, nativeSessionId, nativeRecordId, blockIndex, chunkIndex]);
}

export function decodeSessionReference(value: string, allowLegacy = false): SessionReference {
  if (value.startsWith("gh1_")) {
    const [sourceId, nativeSessionId] = stringTuple(decode(value, "gh1_", 2));
    return { sourceId, nativeSessionId };
  }
  if (allowLegacy && value.length > 0) return { sourceId: "opencode", nativeSessionId: value };
  throw new Error("invalid session reference");
}

export function decodeCallReference(value: string, allowLegacy = false): CallReference {
  if (value.startsWith("gc1_")) {
    const [sourceId, nativeSessionId, nativeCallId] = stringTuple(decode(value, "gc1_", 3));
    return { sourceId, nativeSessionId, nativeCallId };
  }
  if (allowLegacy) {
    const separator = value.indexOf(":");
    if (separator > 0 && separator < value.length - 1) return { sourceId: "opencode", nativeSessionId: value.slice(0, separator), nativeCallId: value.slice(separator + 1) };
  }
  throw new Error("invalid tool call reference");
}

export function decodeEntryReference(value: string): EntryReference {
  const values = decode(value, "ge1_", 5);
  const [sourceId, nativeSessionId, nativeRecordId] = stringTuple(values, 2);
  return { sourceId, nativeSessionId, nativeRecordId, blockIndex: values[3] as number, chunkIndex: values[4] as number };
}
