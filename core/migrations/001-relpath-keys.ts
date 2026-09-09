import type { Migration, StateFile } from "./types.ts";
import type { Annotation } from "../types.ts";

/**
 * Migration 1:
 * Migrates legacy remote-based (`remote:...`) and path-hash-based (`path:...`)
 * annotation keys to direct relative path (`relPath`) keys.
 */
export const migration: Migration = {
  version: 1,
  description: "Migrate legacy remote and path-hash keys to relPath keys",
  migrate(state: StateFile): StateFile {
    const oldAnnotations = state.annotations ?? {};
    const newAnnotations: Record<string, Annotation> = {};

    for (const [key, annotation] of Object.entries(oldAnnotations)) {
      let newKey = key;

      if (annotation.lastSeenAt) {
        newKey = annotation.lastSeenAt;
      } else if (key.startsWith("remote:")) {
        if (key.includes("#")) {
          newKey = key.split("#")[1]!;
        } else {
          const parts = key.replace(/^remote:/, "").split("/");
          newKey = parts[parts.length - 1] ?? key;
        }
      }

      // If there is already an entry for this relPath, prioritize the one with more complete data
      if (newAnnotations[newKey]) {
        const existing = newAnnotations[newKey]!;
        const existingHasData =
          existing.status !== "unknown" ||
          existing.note !== "" ||
          existing.favourite ||
          existing.todo ||
          existing.alias;
        const currentHasData =
          annotation.status !== "unknown" ||
          annotation.note !== "" ||
          annotation.favourite ||
          annotation.todo ||
          annotation.alias;
        if (!existingHasData && currentHasData) {
          newAnnotations[newKey] = annotation;
        }
      } else {
        newAnnotations[newKey] = annotation;
      }
    }

    return {
      version: 1,
      annotations: newAnnotations,
    };
  },
};
