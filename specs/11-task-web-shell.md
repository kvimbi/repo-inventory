# TASK 11 — Web shell: bootstrap, API client, layout

**Goal:** the frontend builds, loads real data from the API, and renders a shell
with a header and a placeholder body.

**Files you create:**

- `web/index.html`
- `web/main.tsx`
- `web/styles.css`
- `web/api.ts`
- `web/lib/format.ts`
- `web/App.tsx`

**Files you must not touch:** everything else. In particular, do **not** create
components — TASK 12 does that.

---

## Constraints

- React 19 with function components and hooks. No class components.
- **No state management library, no router, no component library.** Plain
  `useState` / `useMemo` / `useEffect`.
- Tailwind CSS v4 via `@tailwindcss/vite` (already configured in `vite.config.ts`).
  There is **no** `tailwind.config.js` in v4 — configuration goes in CSS.
- Import types from `../core/types.ts` using a relative path out of `web/`. Vite
  handles it. Never redeclare a type that already exists there.
- Dark theme only. The user runs this beside a terminal.

## `web/index.html`

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>repo-inventory</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

The script `src` is `/main.tsx` because Vite's root is `web/`.

## `web/styles.css`

```css
@import "tailwindcss";

@theme {
  --color-surface: #0d1117;
  --color-panel: #161b22;
  --color-border: #30363d;
  --color-ink: #e6edf3;
  --color-muted: #8b949e;
  --color-critical: #f85149;
  --color-warn: #d29922;
  --color-info: #58a6ff;
  --color-good: #3fb950;
}

html, body, #root { height: 100%; }
body { background: var(--color-surface); color: var(--color-ink); }
```

Those five severity colours are the visual language of the whole app. Define them
once here; never hard-code a hex value in a component.

## `web/main.tsx`

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
```

No `StrictMode`: it double-invokes effects, which would fire the scan request
twice.

## `web/lib/format.ts`

Pure formatting helpers, no React. Duplicating the two from `core/report.ts` is
correct here — the frontend must not import server code.

```ts
export function formatBytes(bytes: number | undefined): string;
export function formatAge(days: number | null | undefined): string;
/** "2026-07-26 14:03" in local time. */
export function formatTimestamp(iso: string | null | undefined): string;
/** "in sync" | "local-only" | "no upstream" | "↑3" | "↓2" | "↑3 ↓2" */
export function formatSync(project: Project): string;
/** Tailwind text colour class for a severity, e.g. "text-critical". */
export function severityColor(severity: FlagSeverity): string;
```

`formatBytes` and `formatAge` behave exactly as specified in `07-task-report.md`
— same outputs for the same inputs. `formatSync` uses the priority order from
that same task.

## `web/api.ts`

Typed wrappers around the endpoints from TASK 09. One function per endpoint, no
caching, no retries.

```ts
import type { Inventory, Annotation, Project, ProjectStatus } from "../core/types.ts";

export interface AnnotationPatch {
  status?: ProjectStatus;
  note?: string;
  snoozedUntil?: string | null;
}

export interface ScriptResult {
  script: string;
  included: string[];
  skipped: string[];
}

export async function fetchInventory(): Promise<Inventory>;
export async function runScan(fetchRemotes: boolean): Promise<Inventory>;
export async function saveAnnotation(id: string, patch: AnnotationPatch): Promise<{ annotation: Annotation; project: Project | null }>;
export async function generateScript(action: string, ids: string[]): Promise<ScriptResult>;
```

Implementation rules:

- All requests go to relative paths (`/api/...`). In dev, `vite.config.ts` proxies
  them to port 4747.
- One shared helper does the fetch and error handling:

  ```ts
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
  ```

- `runScan` sends `POST /api/scan` with `{ fetch: fetchRemotes }`. A scan can take
  minutes with `--fetch`, so do **not** add an `AbortSignal.timeout`.

## `web/App.tsx`

Owns all data loading and top-level state. Export a named `App`.

State:

```tsx
const [inventory, setInventory] = useState<Inventory | null>(null);
const [error, setError] = useState<string | null>(null);
const [busy, setBusy] = useState<"loading" | "scanning" | null>("loading");
```

Behaviour:

1. On mount, `fetchInventory()`, then `setInventory`, `setBusy(null)`. On failure
   `setError(message)`.
2. `handleScan(fetchRemotes: boolean)`: set `busy` to `"scanning"`, call
   `runScan`, replace the inventory, clear `busy` in a `finally`.
3. `handleAnnotationSaved(project: Project)`: replace that project in
   `inventory.projects` by `id`, immutably. Do not refetch the whole inventory —
   the server already returned the recomputed project.

Layout — a fixed header over a scrolling body:

```tsx
<div className="flex h-full flex-col">
  <header className="flex items-center gap-4 border-b border-border bg-panel px-5 py-3">
    <h1 className="text-sm font-semibold tracking-wide">repo-inventory</h1>
    <span className="text-xs text-muted">{/* root · N projects · scanned <timestamp> */}</span>
    {/* staleness warning when inventory.fetched === false */}
    <div className="ml-auto flex items-center gap-2">
      <button /* Rescan */ />
      <button /* Rescan + fetch */ />
    </div>
  </header>
  <main className="min-h-0 flex-1 overflow-auto p-5">
    {/* TASK 12 fills this. For now: a count and a plain list of relPaths. */}
  </main>
</div>
```

Required details:

- When `inventory.fetched === false`, show
  `remote state cached — ahead/behind may be stale` in `text-warn`. The user must
  never mistake cached ahead/behind for live truth.
- Both scan buttons are disabled while `busy !== null`, and show
  `Scanning…` while `busy === "scanning"`. A scan takes 15+ seconds; an
  unresponsive-looking button will get clicked five times.
- Render `error` as a dismissible bar above `main`, in `text-critical`.
- Show a plain `Loading…` while `busy === "loading"` and `inventory === null`.

Keep `App.tsx` under ~130 lines. It is a coordinator; it must not grow rendering
logic that belongs in a component.

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
npm run build
```

Both must succeed. Then check it end to end:

```bash
npm run serve &
sleep 25
curl -s localhost:4747/ | grep -o '<title>[^<]*</title>'
curl -s -o /dev/null -w 'index: %{http_code}\n' localhost:4747/
curl -s -o /dev/null -w 'deep link: %{http_code}\n' localhost:4747/some/deep/path
kill %1
```

Checklist:

- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds and `dist/index.html` exists
- [ ] `dist/` contains a hashed `.css` asset — proves Tailwind ran
- [ ] `<title>repo-inventory</title>` is served
- [ ] `index: 200` and `deep link: 200` (the catch-all works)
- [ ] Opening <http://127.0.0.1:4747> shows the header with the real root path,
      the real project count and the scanned timestamp
- [ ] The staleness warning is visible, since the default scan does not fetch
- [ ] The body lists 50+ `relPath` strings
- [ ] The browser console has **no** errors or warnings
- [ ] Clicking `Rescan` disables both buttons, shows `Scanning…`, and the project
      count updates when it finishes

## Report back

Confirm the build output file list, and paste the exact header text rendered
(root, count, timestamp, staleness warning).
