/**
 * IDEs the dashboard can hand a project path to via their CLI launcher.
 *
 * `command` must be the launcher binary's name (found on PATH) — it is
 * executed as `command <absolute-project-path>`, never through a shell, so
 * there is no injection surface here. Add an entry to extend the list; no
 * other file needs to change.
 */
export interface IdeLauncher {
  /** Stable identifier used in the API and by the UI. */
  id: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Executable name (resolved via PATH) used to launch the IDE. */
  command: string;
  /** Optional fixed arguments passed before the project path. */
  args?: string[];
  /** Optional fallback binary names or candidate paths to try if primary command fails. */
  fallbackCommands?: string[];
}

export const IDE_LAUNCHERS: IdeLauncher[] = [
  {
    id: "code",
    label: "VS Code",
    command: "code",
    fallbackCommands: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "~/.local/bin/code",
    ],
  },
  {
    id: "agy-ide",
    label: "Agy IDE",
    command: "agy-ide",
    fallbackCommands: [
      "~/.antigravity-ide/antigravity-ide/bin/agy-ide",
      "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
      "antigravity-ide",
    ],
  },
  {
    id: "webstorm",
    label: "WebStorm",
    command: "webstorm",
    fallbackCommands: [
      "~/Library/Application Support/JetBrains/Toolbox/scripts/webstorm",
      "~/.local/share/JetBrains/Toolbox/scripts/webstorm",
    ],
  },
  { id: "finder", label: "Finder", command: "open" },
  { id: "ghostty", label: "Ghostty", command: "open", args: ["-a", "Ghostty"] },
];

