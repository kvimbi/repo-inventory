import type { Probe } from "../core/types.ts";
import { measureFootprint } from "../core/discover.ts";
import { DISPOSABLE_DIRS } from "../core/config.ts";
import { stat } from "node:fs/promises";
import { join } from "node:path";

async function hasReadme(path: string): Promise<boolean> {
  const names = ["README.md", "README.rst", "README.txt", "readme.md"];
  for (const name of names) {
    try {
      await stat(join(path, name));
      return true;
    } catch {
      // file does not exist
    }
  }
  return false;
}

export const probe: Probe = {
  name: "footprint",
  order: 60,
  async detect({ path, pruneDirs, facts, quick }) {
    if (quick && facts.sourceBytes !== undefined) {
      if (facts.lastTouchedAt) {
        const mtimeMs = new Date(facts.lastTouchedAt).getTime();
        const ageDays = Math.floor((Date.now() - mtimeMs) / 86_400_000);
        return { lastTouchedAgeDays: ageDays };
      }
      return {};
    }
    const { sourceBytes, disposableBytes, sourceFiles, newestMtimeMs } = await measureFootprint(
      path,
      pruneDirs,
      DISPOSABLE_DIRS,
    );

    const out: Record<string, unknown> = {
      sourceBytes,
      disposableBytes,
      sourceFiles,
    };

    if (newestMtimeMs > 0) {
      out.lastTouchedAt = new Date(newestMtimeMs).toISOString();
      const ageDays = Math.floor((Date.now() - newestMtimeMs) / 86_400_000);
      out.lastTouchedAgeDays = ageDays;
    } else {
      out.lastTouchedAt = null;
      out.lastTouchedAgeDays = null;
    }

    out.hasReadme = await hasReadme(path);

    return out;
  },
};
