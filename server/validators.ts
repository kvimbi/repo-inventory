import { STATUSES } from "../core/state.ts";
import type { ProjectStatus } from "../core/types.ts";

export interface AnnotationPatchResult {
  id: string;
  patch: {
    status?: ProjectStatus;
    note?: string;
    snoozedUntil?: string | null;
    favourite?: boolean;
    alias?: string | null;
    suppressedFlags?: string[];
    todo?: boolean;
  };
}

export function parseAndValidateAnnotationBody(body: unknown): { error?: string; data?: AnnotationPatchResult } {
  if (!body || typeof body !== "object") {
    return { error: "request body must be an object" };
  }

  const b = body as {
    id?: unknown;
    status?: unknown;
    note?: unknown;
    snoozedUntil?: unknown;
    favourite?: unknown;
    alias?: unknown;
    suppressedFlags?: unknown;
    todo?: unknown;
  };

  if (typeof b.id !== "string" || b.id === "") {
    return { error: "id is required and must be a non-empty string" };
  }

  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status as never)) {
      return { error: `status must be one of: ${STATUSES.join(", ")}` };
    }
  }

  if (b.note !== undefined) {
    if (typeof b.note !== "string") {
      return { error: "note must be a string" };
    }
    if (b.note.length > 2000) {
      return { error: "note must be 2000 characters or less" };
    }
  }

  if (b.snoozedUntil !== undefined && b.snoozedUntil !== null) {
    const d = new Date(b.snoozedUntil as string);
    if (Number.isNaN(d.getTime())) {
      return { error: "snoozedUntil must be a valid ISO date string or null" };
    }
  }

  if (b.favourite !== undefined && typeof b.favourite !== "boolean") {
    return { error: "favourite must be a boolean" };
  }

  if (b.todo !== undefined && typeof b.todo !== "boolean") {
    return { error: "todo must be a boolean" };
  }

  if (b.alias !== undefined && b.alias !== null) {
    if (typeof b.alias !== "string") {
      return { error: "alias must be a string or null" };
    }
    if (b.alias.length > 100) {
      return { error: "alias must be 100 characters or less" };
    }
  }

  if (b.suppressedFlags !== undefined && b.suppressedFlags !== null) {
    if (!Array.isArray(b.suppressedFlags) || !b.suppressedFlags.every((f: unknown) => typeof f === "string")) {
      return { error: "suppressedFlags must be an array of strings" };
    }
  }

  const patch: AnnotationPatchResult["patch"] = {};
  if ("status" in b) patch.status = b.status as never;
  if ("note" in b) patch.note = b.note as string;
  if ("snoozedUntil" in b) {
    patch.snoozedUntil = b.snoozedUntil === null
      ? null
      : new Date(b.snoozedUntil as string).toISOString();
  }
  if ("favourite" in b) patch.favourite = b.favourite as boolean;
  if ("todo" in b) patch.todo = b.todo as boolean;
  if ("alias" in b) {
    patch.alias = typeof b.alias === "string" && b.alias.trim() !== "" ? b.alias.trim() : null;
  }
  if ("suppressedFlags" in b) {
    patch.suppressedFlags = Array.isArray(b.suppressedFlags)
      ? b.suppressedFlags.filter((f): f is string => typeof f === "string")
      : [];
  }

  return { data: { id: b.id, patch } };
}

export interface BatchAnnotationPatchResult {
  ids: string[];
  patch: {
    status?: ProjectStatus;
    note?: string;
    snoozedUntil?: string | null;
    favourite?: boolean;
    alias?: string | null;
    suppressedFlags?: string[];
    todo?: boolean;
  };
}

export function parseAndValidateBatchAnnotationBody(body: unknown): { error?: string; data?: BatchAnnotationPatchResult } {
  if (!body || typeof body !== "object") {
    return { error: "request body must be an object" };
  }

  const b = body as {
    ids?: unknown;
    status?: unknown;
    note?: unknown;
    snoozedUntil?: unknown;
    favourite?: unknown;
    alias?: unknown;
    suppressedFlags?: unknown;
    todo?: unknown;
  };

  if (!Array.isArray(b.ids) || b.ids.length === 0 || !b.ids.every((id) => typeof id === "string" && id.trim() !== "")) {
    return { error: "ids is required and must be a non-empty array of strings" };
  }

  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status as never)) {
      return { error: `status must be one of: ${STATUSES.join(", ")}` };
    }
  }

  if (b.note !== undefined) {
    if (typeof b.note !== "string") {
      return { error: "note must be a string" };
    }
    if (b.note.length > 2000) {
      return { error: "note must be 2000 characters or less" };
    }
  }

  if (b.snoozedUntil !== undefined && b.snoozedUntil !== null) {
    const d = new Date(b.snoozedUntil as string);
    if (Number.isNaN(d.getTime())) {
      return { error: "snoozedUntil must be a valid ISO date string or null" };
    }
  }

  if (b.favourite !== undefined && typeof b.favourite !== "boolean") {
    return { error: "favourite must be a boolean" };
  }

  if (b.todo !== undefined && typeof b.todo !== "boolean") {
    return { error: "todo must be a boolean" };
  }

  if (b.alias !== undefined && b.alias !== null) {
    if (typeof b.alias !== "string") {
      return { error: "alias must be a string or null" };
    }
    if (b.alias.length > 100) {
      return { error: "alias must be 100 characters or less" };
    }
  }

  if (b.suppressedFlags !== undefined && b.suppressedFlags !== null) {
    if (!Array.isArray(b.suppressedFlags) || !b.suppressedFlags.every((f: unknown) => typeof f === "string")) {
      return { error: "suppressedFlags must be an array of strings" };
    }
  }

  const patch: BatchAnnotationPatchResult["patch"] = {};
  if ("status" in b) patch.status = b.status as never;
  if ("note" in b) patch.note = b.note as string;
  if ("snoozedUntil" in b) {
    patch.snoozedUntil = b.snoozedUntil === null
      ? null
      : new Date(b.snoozedUntil as string).toISOString();
  }
  if ("favourite" in b) patch.favourite = b.favourite as boolean;
  if ("todo" in b) patch.todo = b.todo as boolean;
  if ("alias" in b) {
    patch.alias = typeof b.alias === "string" && b.alias.trim() !== "" ? b.alias.trim() : null;
  }
  if ("suppressedFlags" in b) {
    patch.suppressedFlags = Array.isArray(b.suppressedFlags)
      ? b.suppressedFlags.filter((f): f is string => typeof f === "string")
      : [];
  }

  return { data: { ids: b.ids as string[], patch } };
}
