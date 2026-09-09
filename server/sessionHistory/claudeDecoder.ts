import { bounded, textChunks } from "./bounds.ts";
import type { LocalHistoryEntry } from "./source.ts";

export type ClaudeRecord = Record<string, unknown>;

export function asObject(value: unknown): ClaudeRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ClaudeRecord : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asIso(value: unknown): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" ? new Date(value).toISOString() : undefined;
}

export function blockContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const block = asObject(item);
      return asString(block?.text) ?? JSON.stringify(item);
    }).join("\n");
  }
  return value === undefined || value === null ? undefined : JSON.stringify(value);
}

export function decodeClaudeRecords(records: Array<{ value: unknown; offset: number }>): LocalHistoryEntry[] {
  const calls = new Map<string, { entry: LocalHistoryEntry; index: number }>();
  const entries: LocalHistoryEntry[] = [];

  for (const record of records) {
    const item = asObject(record.value);
    if (!item) continue;

    const recordId = asString(item.uuid) ?? `offset-${record.offset}`;
    const parentId = asString(item.parentUuid);
    const createdAt = asIso(item.timestamp);
    const itemType = asString(item.type);

    // Explicit attachment records in Cowork and Claude
    if (itemType === "attachment") {
      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:attachment`,
        parentId,
        createdAt,
        type: "attachment",
        unavailable: "attachment content is not review evidence",
      });
      continue;
    }

    const message = asObject(item.message);
    const isMeta = item.isMeta === true;
    const rawRole = asString(message?.role);
    // Meta user records carry injected instructions/tasks; do not present them as user corrections
    const role = isMeta ? undefined : (rawRole === "user" || rawRole === "assistant" ? rawRole : undefined);

    const content = message?.content ?? item.content;
    const blocks = typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : [];

    blocks.forEach((raw, blockIndex) => {
      const block = asObject(raw);
      if (!block) return;
      const type = isMeta ? "meta" : (asString(block.type) ?? "unsupported");

      if (isMeta) {
        entries.push({
          nativeRecordId: recordId,
          blockIndex,
          messageId: recordId,
          partId: `${recordId}:${blockIndex}`,
          parentId,
          role: undefined,
          type: "meta",
          unavailable: "injected meta context is not review evidence",
        });
        return;
      }

      if (type === "text") {
        const text = asString(block.text);
        if (text === undefined) {
          entries.push({
            nativeRecordId: recordId,
            blockIndex,
            messageId: recordId,
            partId: `${recordId}:${blockIndex}`,
            parentId,
            role,
            type,
            unavailable: "text payload unavailable",
          });
          return;
        }
        textChunks(text).forEach((chunk, chunkIndex) =>
          entries.push({
            nativeRecordId: recordId,
            blockIndex,
            chunkIndex,
            messageId: recordId,
            partId: `${recordId}:${blockIndex}`,
            parentId,
            role,
            type,
            text: chunk,
            createdAt,
            unavailable: chunkIndex ? `text chunk ${chunkIndex + 1}` : undefined,
          })
        );
        return;
      }

      if (type === "tool_use") {
        const callId = asString(block.id) ?? `${recordId}:${blockIndex}`;
        const input = block.input === undefined ? undefined : JSON.stringify(block.input);
        const bound = input === undefined ? { omitted: false } : bounded(input);
        const entry: LocalHistoryEntry = {
          nativeRecordId: recordId,
          blockIndex,
          messageId: recordId,
          partId: `${recordId}:${blockIndex}`,
          parentId,
          role,
          type,
          createdAt,
          tool: {
            nativeCallId: callId,
            name: asString(block.name) ?? "unknown",
            status: "unknown",
            input: bound.text,
            inputOmitted: bound.omitted,
            outputAvailable: false,
          },
        };
        calls.set(callId, { entry, index: entries.length });
        entries.push(entry);
        return;
      }

      if (type === "tool_result") {
        const call = calls.get(asString(block.tool_use_id) ?? "");
        const rawResult = block.content;
        const result = typeof rawResult === "string" ? rawResult : rawResult === undefined ? undefined : JSON.stringify(rawResult);
        if (call?.entry.tool) {
          const bound = result === undefined ? { omitted: false } : bounded(result);
          const failed = block.is_error === true;
          call.entry.tool = {
            ...call.entry.tool,
            status: failed ? "error" : "success",
            error: failed ? bound.text : undefined,
            errorOmitted: failed && bound.omitted,
            outputAvailable: !failed && result !== undefined,
          };
          return;
        }
        entries.push({
          nativeRecordId: recordId,
          blockIndex,
          messageId: recordId,
          partId: `${recordId}:${blockIndex}`,
          parentId,
          role,
          type,
          unavailable: "tool result has no matching tool call in this transcript",
        });
        return;
      }

      if (type === "thinking") {
        entries.push({
          nativeRecordId: recordId,
          blockIndex,
          messageId: recordId,
          partId: `${recordId}:${blockIndex}`,
          parentId,
          role,
          type,
          unavailable: "thinking content is not review evidence",
        });
        return;
      }

      entries.push({
        nativeRecordId: recordId,
        blockIndex,
        messageId: recordId,
        partId: `${recordId}:${blockIndex}`,
        parentId,
        role,
        type,
        unavailable: `unsupported Claude content block: ${type}`,
      });
    });
  }

  return entries;
}

export function getClaudeToolPayloadFromRecords(
  records: Array<{ value: unknown; offset: number }>,
  nativeCallId: string,
  section: "input" | "output" | "error",
  version: string,
): { content?: string; available: boolean; version: string } {
  for (const record of records) {
    const item = asObject(record.value);
    const message = asObject(item?.message);
    const content = message?.content ?? item?.content;
    const blocks = typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : [];

    for (const raw of blocks) {
      const block = asObject(raw);
      if (!block) continue;

      if (asString(block.type) === "tool_use" && asString(block.id) === nativeCallId && section === "input") {
        const value = block.input === undefined ? undefined : JSON.stringify(block.input);
        return value === undefined
          ? { available: false, version }
          : { content: value, available: true, version };
      }

      if (asString(block.type) === "tool_result" && asString(block.tool_use_id) === nativeCallId) {
        const failed = block.is_error === true;
        if ((section === "error") !== failed || section === "input") continue;
        const value = blockContent(block.content);
        return value === undefined
          ? { available: false, version }
          : { content: value, available: true, version };
      }
    }
  }

  return { available: false, version };
}
