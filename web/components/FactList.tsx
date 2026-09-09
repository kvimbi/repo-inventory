import type { Project } from "../../core/types.ts";
import { formatBytes, formatAge, formatTimestamp } from "../lib/format.ts";

interface FactListProps {
  project: Project;
}

export function FactList({ project }: FactListProps) {
  const rows: React.ReactNode[] = [];

  // Identity group
  const identityRows = [
    { key: "kind", value: project.kind },
    { key: "group", value: project.group },
    { key: "depth", value: project.depth },
    { key: "nestedIn", value: project.nestedIn },
    { key: "id", value: project.id },
  ].filter((r) => r.value !== undefined);

  if (identityRows.length > 0) {
    rows.push(
      <FactGroup key="identity" title="Identity">
        {identityRows.map((r) => (
          <FactRow key={r.key} label={r.key} value={String(r.value)} />
        ))}
      </FactGroup>
    );
  }

  // Git group
  const gitRows = [
    { key: "branch", value: project.branch },
    { key: "branchCount", value: project.branchCount },
    { key: "remoteName", value: project.remoteName },
    { key: "remoteUrl", value: project.remoteUrl, isLink: true },
    { key: "remoteHost", value: project.remoteHost },
    { key: "defaultBranch", value: project.defaultBranch },
    { key: "detached", value: project.detached === undefined ? undefined : project.detached ? "yes" : "no" },
  ].filter((r) => r.value !== undefined);

  if (gitRows.length > 0 && project.isGit) {
    rows.push(
      <FactGroup key="git" title="Git">
        {gitRows.map((r) => (
          <FactRow
            key={r.key}
            label={r.key}
            value={String(r.value)}
            isLink={r.isLink && String(r.value).startsWith("http")}
          />
        ))}
      </FactGroup>
    );
  }

  // Sync group
  const syncRows = [
    { key: "ahead", value: project.ahead },
    { key: "behind", value: project.behind },
    { key: "noUpstream", value: project.noUpstream === undefined ? undefined : project.noUpstream ? "yes" : "no" },
    { key: "dirtyFiles", value: project.dirtyFiles },
    { key: "untrackedFiles", value: project.untrackedFiles },
    { key: "stashes", value: project.stashes },
    { key: "localOnlyBranches", value: project.localOnlyBranches, isChips: true },
    { key: "lastFetchAt", value: project.lastFetchAt === null ? "never" : formatTimestamp(project.lastFetchAt) },
  ].filter((r) => r.value !== undefined && r.value !== "never" || r.key === "lastFetchAt");

  if (syncRows.length > 0 && project.isGit) {
    rows.push(
      <FactGroup key="sync" title="Sync">
        {syncRows.map((r) => (
          <FactRow
            key={r.key}
            label={r.key}
            value={r.isChips ? "" : String(r.value)}
            chips={r.isChips ? (r.value as string[]) : undefined}
          />
        ))}
      </FactGroup>
    );
  }

  // History group
  const historyRows = [
    { key: "lastCommitAt", value: formatTimestamp(project.lastCommitAt) },
    { key: "lastCommitSubject", value: project.lastCommitSubject },
    { key: "lastCommitAgeDays", value: formatAge(project.lastCommitAgeDays) },
    { key: "commits30d", value: (project as { commits30d?: number }).commits30d },
    { key: "commits90d", value: (project as { commits90d?: number }).commits90d },
    { key: "commitsTotal", value: (project as { commitCount?: number }).commitCount },
    { key: "authors", value: project.authors?.join(", ") },
    { key: "lastTouchedAt", value: formatTimestamp(project.lastTouchedAt) },
  ].filter((r) => r.value !== undefined && r.value !== "");

  if (historyRows.length > 0) {
    rows.push(
      <FactGroup key="history" title="History">
        {historyRows.map((r) => (
          <FactRow key={r.key} label={r.key} value={String(r.value)} />
        ))}
      </FactGroup>
    );
  }

  // Stack group
  const stackRows = [
    { key: "stack", value: project.stack, isChips: true },
    { key: "frameworks", value: project.frameworks, isChips: true },
    { key: "isMonorepo", value: project.isMonorepo === undefined ? undefined : project.isMonorepo ? "yes" : "no" },
    { key: "packageCount", value: project.packageCount },
    { key: "agentTooling", value: project.agentTooling, isChips: true },
    { key: "skills", value: project.skills?.map((s) => s.name), isChips: true },
    { key: "manifests", value: project.manifests, isScroll: true },
  ].filter((r) => r.value !== undefined && (!Array.isArray(r.value) || r.value.length > 0));

  if (stackRows.length > 0) {
    rows.push(
      <FactGroup key="stack" title="Stack">
        {stackRows.map((r) => (
          <FactRow
            key={r.key}
            label={r.key}
            value={r.isChips || r.isScroll ? "" : String(r.value)}
            chips={r.isChips ? (r.value as string[]) : undefined}
            scroll={r.isScroll ? r.value as string[] : undefined}
          />
        ))}
      </FactGroup>
    );
  }

  // Footprint group
  const footprintRows = [
    { key: "sourceBytes", value: formatBytes(project.sourceBytes) },
    { key: "disposableBytes", value: formatBytes(project.disposableBytes) },
    { key: "sourceFiles", value: project.sourceFiles },
    { key: "hasReadme", value: project.hasReadme === undefined ? undefined : project.hasReadme ? "yes" : "no" },
  ].filter((r) => r.value !== undefined && r.value !== "");

  // Duplicates group
  if (project.duplicateOf && project.duplicateOf.length > 0) {
    const duplicateRows = [
      { key: "role", value: project.isDuplicateCopy ? "Duplicate copy (replica)" : "Primary copy (canonical)" },
      { key: "copies", value: project.duplicateOf, isChips: true },
      { key: "rootCommitSha", value: project.rootCommitSha ? project.rootCommitSha.slice(0, 10) : undefined },
    ].filter((r) => r.value !== undefined);

    rows.push(
      <FactGroup key="duplicates" title="Duplicates">
        {duplicateRows.map((r) => (
          <FactRow
            key={r.key}
            label={r.key}
            value={r.isChips ? "" : String(r.value)}
            chips={r.isChips ? (r.value as string[]) : undefined}
          />
        ))}
      </FactGroup>
    );
  }

  return <div className="space-y-4">{rows}</div>;
}

function FactGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/80 bg-surface/50 p-3 shadow-2xs">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted/80 pb-1 border-b border-border/40">
        {title}
      </h3>
      <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[11px] font-mono">{children}</div>
    </div>
  );
}

function FactRow({
  label,
  value,
  isLink,
  chips,
  scroll,
}: {
  label: string;
  value: string;
  isLink?: boolean;
  chips?: string[];
  scroll?: string[];
}) {
  return (
    <>
      <div className="text-muted/80 text-[10px] truncate select-none">{label}</div>
      <div className="break-all text-ink/90">
        {isLink ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-info hover:underline font-sans">
            {value}
          </a>
        ) : chips ? (
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c} className="rounded bg-surface border border-border/60 px-1.5 py-0.5 text-[10px] font-mono text-muted">
                {c}
              </span>
            ))}
          </div>
        ) : scroll ? (
          <div className="max-h-24 overflow-auto rounded border border-border/60 bg-surface p-1.5 text-[10px]">
            {scroll.map((s) => (
              <div key={s} className="text-muted/90 font-mono">
                {s}
              </div>
            ))}
          </div>
        ) : (
          <span>{value}</span>
        )}
      </div>
    </>
  );
}
