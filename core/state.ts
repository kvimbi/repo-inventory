import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runMigrations } from "./migrations/runner.ts";
import type { StateFile } from "./migrations/types.ts";
import type { Annotation, ProjectStatus } from "./types.ts";

const EMPTY: StateFile = { version: 1, annotations: {} };

export function defaultAnnotation(): Annotation {
  return { status: "unknown", note: "", snoozedUntil: null, favourite: false, alias: null, suppressedFlags: [], todo: false, updatedAt: "" };
}

/**
 * The only hand-authored data in the system, kept in its own file so a scan can
 * never clobber it and so it can be committed to git independently of results.
 */
export class AnnotationStore {
  #path: string;
  #data: StateFile = EMPTY;
  /** Serialises writes so two dashboard clicks cannot interleave a read-modify-write. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  static async open(dir: string): Promise<AnnotationStore> {
    const store = new AnnotationStore(resolve(dir, "data/annotations.json"));
    await store.reload();
    return store;
  }

  async reload(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as StateFile;
      const { state, migrated } = await runMigrations(parsed);
      this.#data = { version: state.version ?? 1, annotations: state.annotations ?? {} };
      if (migrated) {
        await this.#persist();
      }
    } catch {
      this.#data = { version: 1, annotations: {} };
    }
  }

  get(id: string): Annotation {
    return this.#data.annotations[id] ?? defaultAnnotation();
  }

  all(): Record<string, Annotation> {
    return this.#data.annotations;
  }

  /** Merges a partial update and persists. Returns the stored annotation. */
  async update(
    id: string,
    patch: Partial<Pick<Annotation, "status" | "note" | "snoozedUntil" | "favourite" | "alias" | "suppressedFlags" | "todo" | "lastSeenAt">>,
  ): Promise<Annotation> {
    const result = this.#queue.then(async () => {
      const current = this.get(id);
      const next: Annotation = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const isDefault =
        next.status === "unknown" &&
        next.note.trim() === "" &&
        next.snoozedUntil === null &&
        !next.favourite &&
        !next.todo &&
        (!next.alias || next.alias.trim() === "") &&
        (!next.suppressedFlags || next.suppressedFlags.length === 0);
      if (isDefault) delete this.#data.annotations[id];
      else this.#data.annotations[id] = next;
      await this.#persist();
      return next;
    });
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /** Merges a partial update for multiple project IDs and persists in one atomic write. */
  async updateBatch(
    ids: string[],
    patch: Partial<Pick<Annotation, "status" | "note" | "snoozedUntil" | "favourite" | "alias" | "suppressedFlags" | "todo" | "lastSeenAt">>,
  ): Promise<Record<string, Annotation>> {
    const result = this.#queue.then(async () => {
      const now = new Date().toISOString();
      const updated: Record<string, Annotation> = {};
      for (const id of ids) {
        const current = this.get(id);
        const next: Annotation = {
          ...current,
          ...patch,
          updatedAt: now,
        };
        const isDefault =
          next.status === "unknown" &&
          next.note.trim() === "" &&
          next.snoozedUntil === null &&
          !next.favourite &&
          !next.todo &&
          (!next.alias || next.alias.trim() === "") &&
          (!next.suppressedFlags || next.suppressedFlags.length === 0);
        if (isDefault) delete this.#data.annotations[id];
        else this.#data.annotations[id] = next;
        updated[id] = next;
      }
      await this.#persist();
      return updated;
    });
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /** Records where each project was last seen, so orphaned annotations can be traced. */
  async touchSeen(entries: Array<{ id: string; relPath: string }>): Promise<void> {
    let changed = false;
    for (const entry of entries) {
      const current = this.#data.annotations[entry.id];
      if (current && current.lastSeenAt !== entry.relPath) {
        current.lastSeenAt = entry.relPath;
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  /** Annotations whose project no longer exists — usually a rename you should reconcile. */
  orphans(knownIds: Set<string>): Array<{ id: string; annotation: Annotation }> {
    return Object.entries(this.#data.annotations)
      .filter(([id]) => !knownIds.has(id))
      .map(([id, annotation]) => ({ id, annotation }));
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.#data, null, 2)}\n`, "utf8");
    // Atomic replace: a crash mid-write must not leave truncated annotations.
    await rename(tmp, this.#path);
  }
}

export function isSnoozed(annotation: Annotation, now = new Date()): boolean {
  if (!annotation.snoozedUntil) return false;
  const until = new Date(annotation.snoozedUntil);
  return !Number.isNaN(until.getTime()) && until > now;
}

export const STATUSES: ProjectStatus[] = ["unknown", "active", "stale", "obsolete", "archived"];
