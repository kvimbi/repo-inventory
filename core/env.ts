import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Returns an augmented PATH string including standard package manager,
 * language runtime, and IDE CLI directories that exist on disk.
 */
export function getAugmentedPath(): string {
  const home = homedir();
  const candidates = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    resolve(home, ".antigravity-ide/antigravity-ide/bin"),
    resolve(home, ".antigravity/bin"),
    resolve(home, ".agy/bin"),
    resolve(home, ".local/bin"),
    resolve(home, "bin"),
    resolve(home, ".cargo/bin"),
    resolve(home, "go/bin"),
    resolve(home, "Library/Application Support/JetBrains/Toolbox/scripts"),
    resolve(home, ".local/share/JetBrains/Toolbox/scripts"),
    "/Applications/Antigravity IDE.app/Contents/Resources/app/bin",
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin",
  ];

  const currentPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  const pathParts = currentPath.split(":");
  const existingExtra = candidates.filter((p) => existsSync(p) && !pathParts.includes(p));

  return [...existingExtra, ...pathParts].join(":");
}

/**
 * Ensures process.env.PATH is augmented in-place with existing tool directories.
 * Safe to call multiple times.
 */
export function ensureAugmentedEnv(): NodeJS.ProcessEnv {
  process.env.PATH = getAugmentedPath();
  return process.env;
}
