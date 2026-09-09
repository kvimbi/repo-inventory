import { useState, useEffect, useRef } from "react";
import type { Inventory, ScanProgress } from "../../core/types.ts";
import { formatTimestamp } from "../lib/format.ts";
import { Logo } from "./Logo.tsx";
import { isElectron } from "../electronBridge.ts";

export interface HeaderProps {
  activeSection: "projects" | "agentTools";
  onSelectSection: (section: "projects" | "agentTools") => void;
  inventory: Inventory | null;
  busy: "loading" | "scanning" | null;
  scanProgress: ScanProgress | null;
  onQuickRefresh?: () => void;
  onFullRescan?: (fetchRemotes: boolean) => void;
  onOpenChat?: () => void;
  onOpenSkills?: () => void;
  onOpenSettings: () => void;
}

export function Header({
  activeSection,
  onSelectSection,
  inventory,
  busy,
  scanProgress,
  onQuickRefresh,
  onFullRescan,
  onOpenChat,
  onOpenSkills,
  onOpenSettings,
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const totalSkillsCount =
    inventory?.projects.reduce((acc, p) => acc + (p.skills?.length ?? 0), 0) ?? 0;

  // Close dropdown on outside click or escape
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  const rootsCount = inventory?.roots?.length ?? (inventory?.root ? 1 : 0);
  const rootsTitle = inventory?.roots?.join("\n") ?? inventory?.root ?? "";
  const isScanning = busy === "scanning";

  return (
    <header
      className={`flex items-center justify-between border-b border-border bg-panel px-4 py-2.5 gap-4 ${
        isElectron() ? "app-drag pl-20" : ""
      }`}
    >
      {/* Left: Brand & Tabs Switcher */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span className="text-sm font-semibold tracking-tight text-ink select-none">
            repo-inventory
          </span>
        </div>

        {/* Tab switcher: Projects vs Agent Tools */}
        <nav className="flex items-center rounded-lg border border-border bg-surface p-0.5 app-no-drag">
          <button
            type="button"
            onClick={() => onSelectSection("projects")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeSection === "projects"
                ? "bg-panel text-ink shadow-xs"
                : "text-muted hover:text-ink"
            }`}
          >
            <span>Projects</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectSection("agentTools")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeSection === "agentTools"
                ? "bg-panel text-ink shadow-xs"
                : "text-muted hover:text-ink"
            }`}
          >
            <span>Agent Tools</span>
          </button>
        </nav>

        {activeSection === "projects" && inventory && (
          <div className="hidden lg:flex items-center gap-2 text-xs">
            <span className="h-3.5 w-px bg-border" />
            <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[11px] font-medium text-muted">
              {inventory.projects.length} projects
            </span>
            <span
              className="rounded-full bg-surface border border-border px-2 py-0.5 text-[11px] text-muted font-mono max-w-[200px] truncate"
              title={rootsTitle}
            >
              {rootsCount > 1 ? `${rootsCount} roots` : inventory.root}
            </span>
            <span
              className="flex items-center gap-1.5 text-[11px] text-muted"
              title={`Last scanned at ${inventory.scannedAt}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-good/80" />
              {formatTimestamp(inventory.scannedAt)}
            </span>
            {!inventory.fetched && (
              <span
                className="rounded-full bg-warn/10 border border-warn/30 px-2 py-0.5 text-[11px] text-warn"
                title="Remote state is cached. True ahead/behind branch counts may be stale."
              >
                cache only
              </span>
            )}
          </div>
        )}
      </div>

      {/* Center: AI Assistant Trigger */}
      {activeSection === "projects" && onOpenChat && onOpenSkills ? (
        <div className="flex items-center justify-center flex-1 max-w-sm app-no-drag">
          <button
            type="button"
            onClick={onOpenChat}
            className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border/80 bg-surface/80 hover:bg-surface px-3 py-1.5 text-xs text-muted hover:text-ink hover:border-info/40 shadow-xs transition-all cursor-pointer"
            title="Ask AI Assistant about projects, architectures, and flags (Cmd+K)"
          >
            <div className="flex items-center gap-2 min-w-0">
              <svg
                className="h-3.5 w-3.5 text-info group-hover:scale-110 transition-transform"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
              </svg>
              <span className="font-medium truncate">Ask about projects…</span>
            </div>
            <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted group-hover:text-ink">
              ⌘K
            </kbd>
          </button>

          {/* Agent Skills Catalog Button */}
          <button
            type="button"
            onClick={onOpenSkills}
            title="Open Agent Skills Catalog"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent/50 hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <span className="text-accent">⚡</span>
            <span>Skills</span>
            {totalSkillsCount > 0 && (
              <span className="rounded-full bg-accent/20 text-accent border border-accent/30 px-1.5 py-0.2 text-[10px] font-mono">
                {totalSkillsCount}
              </span>
            )}
          </button>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Right: Actions (Refresh Split Button + Settings) */}
      <div className="flex items-center gap-2 app-no-drag">
        {/* Split Refresh Button (for Projects) */}
        {activeSection === "projects" && onQuickRefresh && onFullRescan && (
          <div className="relative inline-flex items-stretch rounded-md border border-border bg-panel shadow-xs" ref={dropdownRef}>
            {/* Main Action: Quick Refresh */}
            <button
              type="button"
              disabled={busy !== null}
              onClick={onQuickRefresh}
              title="Quick refresh active & favorited projects (Cmd+R)"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-panel hover:bg-panel-hover rounded-l-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg
                className={`h-3.5 w-3.5 text-info ${isScanning ? "animate-spin" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
              </svg>
              <span>
                {isScanning
                  ? scanProgress?.total
                    ? `Refreshing (${scanProgress.done ?? 0}/${scanProgress.total})…`
                    : "Refreshing…"
                  : "Refresh"}
              </span>
            </button>

            {/* Dropdown Toggle */}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setDropdownOpen((prev) => !prev)}
              title="Scan options"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
              className="flex items-center justify-center px-1.5 border-l border-border bg-panel hover:bg-panel-hover rounded-r-md text-muted hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg
                className={`h-3 w-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* Dropdown Menu Popover */}
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 rounded-lg border border-border bg-panel shadow-xl py-1.5 z-50 text-xs animate-in fade-in slide-in-from-top-1 duration-100">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-panel-hover flex items-start gap-2.5 transition-colors cursor-pointer"
                  onClick={() => {
                    setDropdownOpen(false);
                    onQuickRefresh();
                  }}
                >
                  <span className="text-info mt-0.5">⚡</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between font-medium text-ink">
                      <span>Quick refresh</span>
                      <kbd className="font-mono text-[10px] text-muted">⌘R</kbd>
                    </div>
                    <p className="text-[11px] text-muted leading-tight mt-0.5">
                      Fast status probe of active & favorited projects (~200ms)
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-panel-hover flex items-start gap-2.5 transition-colors cursor-pointer"
                  onClick={() => {
                    setDropdownOpen(false);
                    onFullRescan(false);
                  }}
                >
                  <span className="text-muted mt-0.5">🔄</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between font-medium text-ink">
                      <span>Full rescan</span>
                      <kbd className="font-mono text-[10px] text-muted">⇧⌘R</kbd>
                    </div>
                    <p className="text-[11px] text-muted leading-tight mt-0.5">
                      Scan directories for newly cloned or deleted repos
                    </p>
                  </div>
                </button>

                <div className="my-1 border-t border-border/60" />

                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-panel-hover flex items-start gap-2.5 transition-colors cursor-pointer text-muted hover:text-ink"
                  onClick={() => {
                    setDropdownOpen(false);
                    onFullRescan(true);
                  }}
                >
                  <span className="text-muted/70 mt-0.5">🌐</span>
                  <div className="flex-1">
                    <div className="font-medium">Rescan + fetch remotes</div>
                    <p className="text-[10px] text-muted/80 leading-tight mt-0.5">
                      Rescan & fetch git remotes to update ahead/behind counts
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Settings Button */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings (Cmd+,)"
          className="btn btn-secondary px-2.5 py-1.5 text-xs rounded-md text-muted hover:text-ink cursor-pointer"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  );
}
