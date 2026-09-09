import type { Migration, StateFile } from "./types.ts";
import { migration as m001 } from "./001-relpath-keys.ts";

export const MIGRATIONS: Migration[] = [
  m001,
];

export async function runMigrations(state: StateFile): Promise<{ state: StateFile; migrated: boolean }> {
  let currentVersion = state.version ?? 0;
  let currentState: StateFile = {
    version: currentVersion,
    annotations: state.annotations ?? {},
  };

  let migrated = false;

  // Check if any legacy keys exist even if version was previously recorded as 1
  const hasLegacyKeys = Object.keys(currentState.annotations).some(
    (k) => k.startsWith("remote:") || k.startsWith("path:"),
  );

  for (const migration of MIGRATIONS) {
    if (currentVersion < migration.version || (migration.version === 1 && hasLegacyKeys)) {
      currentState = await migration.migrate(currentState);
      currentVersion = migration.version;
      currentState.version = currentVersion;
      migrated = true;
    }
  }

  return { state: currentState, migrated };
}
