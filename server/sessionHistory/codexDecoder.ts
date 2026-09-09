import { bounded, textChunks } from "./bounds.ts";
import type { LocalHistoryEntry } from "./source.ts";

export type CodexRecord = Record<string, unknown>;

export function asObject(value: unknown): CodexRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CodexRecord) : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asIso(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        const ms = num < 100_000_000_000 ? Math.round(num * 1000) : Math.round(num);
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
      }
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

export function stringifyValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isStructuredFailure(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const obj = output as Record<string, unknown>;
  if (typeof obj.exit_code === "number" && obj.exit_code !== 0) return true;
  if (typeof obj.exitCode === "number" && obj.exitCode !== 0) return true;
  if (obj.status === "failed" || obj.status === "error") return true;
  if (obj.success === false) return true;
  if (obj.error !== undefined && obj.error !== null && obj.error !== "") return true;
  return false;
}

function extractErrorString(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const obj = output as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (obj.error !== undefined && obj.error !== null) return JSON.stringify(obj.error);
  if (typeof obj.stderr === "string" && obj.stderr.length > 0) return obj.stderr;
  return stringifyValue(output);
}

export function decodeCodexRolloutRecords(records: Array<{ value: unknown; offset: number }>): LocalHistoryEntry[] {
  const calls = new Map<string, { entry: LocalHistoryEntry; index: number }>();
  const entries: LocalHistoryEntry[] = [];

  for (const record of records) {
    const root = asObject(record.value);
    if (!root) continue;

    const recordType = asString(root.type);
    const createdAt = asIso(root.timestamp);

    // Skip event_msg duplicate messages; prefer response_item
    if (recordType === "event_msg") {
      const payload = asObject(root.payload);
      const eventType = asString(payload?.type);
      if (eventType === "user_message" || eventType === "agent_message") {
        continue;
      }
      if (eventType === "turn_completed") {
        continue;
      }
      continue;
    }

    if (recordType === "session_meta" || recordType === "turn_context") {
      continue;
    }

    if (recordType === "compaction") {
      const recordId = `offset-${record.offset}`;
      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:compaction`,
        type: "compaction",
        createdAt,
        unavailable: "pre-compaction content is unavailable",
      });
      continue;
    }

    if (recordType !== "response_item") {
      continue;
    }

    const payload = asObject(root.payload);
    if (!payload) continue;

    const payloadType = asString(payload.type);
    const recordId = asString(payload.id) ?? asString(root.id) ?? `offset-${record.offset}`;

    if (payloadType === "compaction") {
      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:compaction`,
        type: "compaction",
        createdAt,
        unavailable: "pre-compaction content is unavailable",
      });
      continue;
    }

    if (payloadType === "message") {
      const rawRole = asString(payload.role);
      // Do not surface system/developer configuration dumps as user intent
      if (rawRole === "system" || rawRole === "developer") {
        entries.push({
          nativeRecordId: recordId,
          messageId: recordId,
          partId: `${recordId}:system`,
          type: rawRole,
          createdAt,
          unavailable: `${rawRole} configuration dump is not review evidence`,
        });
        continue;
      }

      const role = rawRole === "user" || rawRole === "assistant" ? rawRole : undefined;
      const phase = asString(payload.phase);
      const type = phase ? `message:${phase}` : "message";
      const content = payload.content;

      if (typeof content === "string") {
        textChunks(content).forEach((chunk, chunkIndex) =>
          entries.push({
            nativeRecordId: recordId,
            blockIndex: 0,
            chunkIndex,
            messageId: recordId,
            partId: `${recordId}:0`,
            role,
            type,
            text: chunk,
            createdAt,
            unavailable: chunkIndex ? `text chunk ${chunkIndex + 1}` : undefined,
          }),
        );
        continue;
      }

      if (Array.isArray(content)) {
        content.forEach((rawBlock, blockIndex) => {
          const block = asObject(rawBlock);
          if (!block) return;
          const blockType = asString(block.type) ?? "text";
          if (blockType === "text" || blockType === "input_text") {
            const text = asString(block.text);
            if (text === undefined) {
              entries.push({
                nativeRecordId: recordId,
                blockIndex,
                messageId: recordId,
                partId: `${recordId}:${blockIndex}`,
                role,
                type,
                createdAt,
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
                role,
                type,
                text: chunk,
                createdAt,
                unavailable: chunkIndex ? `text chunk ${chunkIndex + 1}` : undefined,
              }),
            );
            return;
          }

          if (blockType === "image" || blockType === "binary") {
            entries.push({
              nativeRecordId: recordId,
              blockIndex,
              messageId: recordId,
              partId: `${recordId}:${blockIndex}`,
              role,
              type,
              createdAt,
              unavailable: "image/binary content is unavailable",
            });
            return;
          }

          entries.push({
            nativeRecordId: recordId,
            blockIndex,
            messageId: recordId,
            partId: `${recordId}:${blockIndex}`,
            role,
            type,
            createdAt,
            unavailable: `unsupported block type: ${blockType}`,
          });
        });
        continue;
      }

      continue;
    }

    if (payloadType === "function_call") {
      const callId = asString(payload.call_id) ?? asString(payload.id) ?? recordId;
      const name = asString(payload.name) ?? "unknown";
      const rawArgs = payload.arguments;
      const input = stringifyValue(rawArgs);
      const bound = input === undefined ? { omitted: false } : bounded(input);

      const entry: LocalHistoryEntry = {
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:call`,
        role: "assistant",
        type: "function_call",
        createdAt,
        tool: {
          nativeCallId: callId,
          name,
          status: "unknown",
          input: bound.text,
          inputOmitted: bound.omitted,
          outputAvailable: false,
        },
      };
      calls.set(callId, { entry, index: entries.length });
      entries.push(entry);
      continue;
    }

    if (payloadType === "function_call_output") {
      const callId = asString(payload.call_id) ?? asString(payload.id) ?? "";
      const rawOutput = payload.output;
      const call = calls.get(callId);

      const failed = isStructuredFailure(rawOutput);
      const outputText = stringifyValue(rawOutput);

      if (call?.entry.tool) {
        if (failed) {
          const errStr = extractErrorString(rawOutput) ?? outputText ?? "tool call failed";
          const bound = bounded(errStr);
          call.entry.tool = {
            ...call.entry.tool,
            status: "error",
            error: bound.text,
            errorOmitted: bound.omitted,
            outputAvailable: false,
          };
        } else {
          call.entry.tool = {
            ...call.entry.tool,
            status: "success",
            outputAvailable: rawOutput !== undefined,
          };
        }
        continue;
      }

      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:output`,
        role: "user",
        type: "function_call_output",
        createdAt,
        unavailable: "tool output has no matching function call in this transcript",
      });
      continue;
    }

    if (payloadType === "custom_tool_call") {
      const callId = asString(payload.call_id) ?? asString(payload.id) ?? recordId;
      const name = asString(payload.name) ?? "unknown";
      // Preserve freeform input without assuming it is JSON
      const rawInput = payload.input;
      const input = typeof rawInput === "string" ? rawInput : stringifyValue(rawInput);
      const bound = input === undefined ? { omitted: false } : bounded(input);

      const entry: LocalHistoryEntry = {
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:custom_call`,
        role: "assistant",
        type: "custom_tool_call",
        createdAt,
        tool: {
          nativeCallId: callId,
          name,
          status: "unknown",
          input: bound.text,
          inputOmitted: bound.omitted,
          outputAvailable: false,
        },
      };
      calls.set(callId, { entry, index: entries.length });
      entries.push(entry);
      continue;
    }

    if (payloadType === "custom_tool_call_output") {
      const callId = asString(payload.call_id) ?? asString(payload.id) ?? "";
      const rawOutput = payload.output;
      const call = calls.get(callId);

      const failed = isStructuredFailure(rawOutput);
      const outputText = typeof rawOutput === "string" ? rawOutput : stringifyValue(rawOutput);

      if (call?.entry.tool) {
        if (failed) {
          const errStr = extractErrorString(rawOutput) ?? outputText ?? "custom tool call failed";
          const bound = bounded(errStr);
          call.entry.tool = {
            ...call.entry.tool,
            status: "error",
            error: bound.text,
            errorOmitted: bound.omitted,
            outputAvailable: false,
          };
        } else {
          call.entry.tool = {
            ...call.entry.tool,
            status: "success",
            outputAvailable: rawOutput !== undefined,
          };
        }
        continue;
      }

      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:custom_output`,
        role: "user",
        type: "custom_tool_call_output",
        createdAt,
        unavailable: "tool output has no matching custom tool call in this transcript",
      });
      continue;
    }

    if (payloadType === "reasoning") {
      const isEncrypted = payload.encrypted === true || payload.ciphertext !== undefined;
      const text = asString(payload.summary) ?? asString(payload.text);
      if (isEncrypted || !text) {
        entries.push({
          nativeRecordId: recordId,
          messageId: recordId,
          partId: `${recordId}:reasoning`,
          role: "assistant",
          type: "reasoning",
          createdAt,
          unavailable: "Encrypted reasoning is unavailable.",
        });
      } else {
        textChunks(text).forEach((chunk, chunkIndex) =>
          entries.push({
            nativeRecordId: recordId,
            blockIndex: 0,
            chunkIndex,
            messageId: recordId,
            partId: `${recordId}:reasoning`,
            role: "assistant",
            type: "reasoning",
            text: chunk,
            createdAt,
            unavailable: chunkIndex ? `text chunk ${chunkIndex + 1}` : undefined,
          }),
        );
      }
      continue;
    }
  }

  return entries;
}

export function getCodexToolPayloadFromRecords(
  records: Array<{ value: unknown; offset: number }>,
  nativeCallId: string,
  section: "input" | "output" | "error",
  version: string,
): { content?: string; available: boolean; version: string } {
  for (const record of records) {
    const root = asObject(record.value);
    if (!root || asString(root.type) !== "response_item") continue;

    const payload = asObject(root.payload);
    if (!payload) continue;

    const payloadType = asString(payload.type);
    const callId = asString(payload.call_id) ?? asString(payload.id) ?? asString(root.id);

    if ((payloadType === "function_call" || payloadType === "custom_tool_call") && callId === nativeCallId) {
      if (section === "input") {
        const raw = payloadType === "function_call" ? payload.arguments : payload.input;
        const value = typeof raw === "string" ? raw : stringifyValue(raw);
        return value === undefined ? { available: false, version } : { content: value, available: true, version };
      }
    }

    if ((payloadType === "function_call_output" || payloadType === "custom_tool_call_output") && callId === nativeCallId) {
      const raw = payload.output;
      const failed = isStructuredFailure(raw);

      if (section === "error") {
        if (!failed) continue;
        const errStr = extractErrorString(raw) ?? (typeof raw === "string" ? raw : stringifyValue(raw));
        return errStr === undefined ? { available: false, version } : { content: errStr, available: true, version };
      }

      if (section === "output") {
        if (failed) continue;
        const value = typeof raw === "string" ? raw : stringifyValue(raw);
        return value === undefined ? { available: false, version } : { content: value, available: true, version };
      }
    }
  }

  return { available: false, version };
}

export interface ProjectedItemRow {
  item_id: string;
  item_type: string;
  item_json: string;
  rollout_ordinal: number;
  created_at_ms: number;
}

export function decodeCodexProjectedItems(rows: ProjectedItemRow[]): LocalHistoryEntry[] {
  const entries: LocalHistoryEntry[] = [];

  for (const row of rows) {
    let parsed: Record<string, unknown> | undefined;
    try {
      const item: unknown = JSON.parse(row.item_json);
      parsed = asObject(item);
    } catch {
      continue;
    }
    if (!parsed) continue;

    const recordId = row.item_id;
    const createdAt = asIso(row.created_at_ms);
    const type = row.item_type;

    if (type === "userMessage") {
      const content = asString(parsed.content) ?? asString(parsed.text) ?? "";
      textChunks(content).forEach((chunk, chunkIndex) =>
        entries.push({
          nativeRecordId: recordId,
          blockIndex: 0,
          chunkIndex,
          messageId: recordId,
          partId: `${recordId}:0`,
          role: "user",
          type: "message",
          text: chunk,
          createdAt,
          unavailable: chunkIndex ? `text chunk ${chunkIndex + 1}` : undefined,
        }),
      );
      continue;
    }

    if (type === "agentMessage") {
      const text = asString(parsed.text) ?? "";
      textChunks(text).forEach((chunk, chunkIndex) =>
        entries.push({
          nativeRecordId: recordId,
          blockIndex: 0,
          chunkIndex,
          messageId: recordId,
          partId: `${recordId}:0`,
          role: "assistant",
          type: "message",
          text: chunk,
          createdAt,
          unavailable: chunkIndex ? `text chunk ${chunkIndex + 1}` : undefined,
        }),
      );
      continue;
    }

    if (type === "commandExecution") {
      const command = asString(parsed.command) ?? "command";
      const aggregatedOutput = asString(parsed.aggregatedOutput);
      const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : undefined;
      const status = asString(parsed.status);
      const failed = exitCode !== undefined ? exitCode !== 0 : status === "failed" || status === "error";

      const boundInput = bounded(command);
      const boundError = failed && aggregatedOutput ? bounded(aggregatedOutput) : undefined;

      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:command`,
        role: "assistant",
        type: "commandExecution",
        createdAt,
        tool: {
          nativeCallId: recordId,
          name: "bash",
          status: failed ? "error" : "success",
          input: boundInput.text,
          inputOmitted: boundInput.omitted,
          error: boundError?.text,
          errorOmitted: boundError?.omitted,
          outputAvailable: !failed && aggregatedOutput !== undefined,
        },
      });
      continue;
    }

    if (type === "mcpToolCall") {
      const callId = asString(parsed.callId) ?? recordId;
      const name = asString(parsed.name) ?? "mcp";
      const rawArgs = parsed.arguments;
      const inputStr = stringifyValue(rawArgs);
      const boundInput = inputStr !== undefined ? bounded(inputStr) : { omitted: false };
      const rawResult = parsed.result;
      const rawError = parsed.error;
      const failed = rawError !== undefined && rawError !== null && rawError !== "";
      const errorStr = failed ? (typeof rawError === "string" ? rawError : stringifyValue(rawError)) : undefined;
      const boundError = errorStr ? bounded(errorStr) : undefined;

      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:mcp`,
        role: "assistant",
        type: "mcpToolCall",
        createdAt,
        tool: {
          nativeCallId: callId,
          name,
          status: failed ? "error" : "success",
          input: boundInput.text,
          inputOmitted: boundInput.omitted,
          error: boundError?.text,
          errorOmitted: boundError?.omitted,
          outputAvailable: !failed && rawResult !== undefined,
        },
      });
      continue;
    }

    if (type === "compaction") {
      entries.push({
        nativeRecordId: recordId,
        messageId: recordId,
        partId: `${recordId}:compaction`,
        type: "compaction",
        createdAt,
        unavailable: "pre-compaction content is unavailable",
      });
      continue;
    }
  }

  return entries;
}

export function getCodexToolPayloadFromProjectedRows(
  rows: ProjectedItemRow[],
  nativeCallId: string,
  section: "input" | "output" | "error",
  version: string,
): { content?: string; available: boolean; version: string } {
  for (const row of rows) {
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = asObject(JSON.parse(row.item_json));
    } catch {
      continue;
    }
    if (!parsed) continue;

    const recordId = row.item_id;
    const callId = asString(parsed.callId) ?? recordId;
    if (callId !== nativeCallId && recordId !== nativeCallId) continue;

    if (row.item_type === "commandExecution") {
      if (section === "input") {
        const command = asString(parsed.command);
        return command !== undefined ? { content: command, available: true, version } : { available: false, version };
      }
      const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : undefined;
      const status = asString(parsed.status);
      const failed = exitCode !== undefined ? exitCode !== 0 : status === "failed" || status === "error";
      const output = asString(parsed.aggregatedOutput);

      if (section === "error" && failed) {
        return output !== undefined ? { content: output, available: true, version } : { available: false, version };
      }
      if (section === "output" && !failed) {
        return output !== undefined ? { content: output, available: true, version } : { available: false, version };
      }
    }

    if (row.item_type === "mcpToolCall") {
      if (section === "input") {
        const args = stringifyValue(parsed.arguments);
        return args !== undefined ? { content: args, available: true, version } : { available: false, version };
      }
      const rawError = parsed.error;
      const failed = rawError !== undefined && rawError !== null && rawError !== "";
      if (section === "error" && failed) {
        const err = typeof rawError === "string" ? rawError : stringifyValue(rawError);
        return err !== undefined ? { content: err, available: true, version } : { available: false, version };
      }
      if (section === "output" && !failed) {
        const res = typeof parsed.result === "string" ? parsed.result : stringifyValue(parsed.result);
        return res !== undefined ? { content: res, available: true, version } : { available: false, version };
      }
    }
  }

  return { available: false, version };
}
