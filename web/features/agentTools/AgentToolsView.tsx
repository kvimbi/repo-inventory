import { useState, useEffect, useCallback } from "react";
import type { AgentToolDetails, AgentToolId, AgentToolSummary, RecentSessionSummary } from "../../../core/types.ts";
import { getAgentToolDetails, listAgentTools, refreshAgentTools } from "../../apiClient.ts";
import { ToolSidebar } from "./ToolSidebar.tsx";
import { OverviewTab } from "./OverviewTab.tsx";
import { SkillsTab } from "./components/SkillsTab.tsx";
import { SubagentsTab } from "./components/SubagentsTab.tsx";
import { InstructionsTab } from "./components/InstructionsTab.tsx";
import { ConfigTab } from "./components/ConfigTab.tsx";
import { McpTab } from "./components/McpTab.tsx";
import { SessionsTab } from "./components/SessionsTab.tsx";
import { ResourcePreviewDrawer } from "./components/ResourcePreviewDrawer.tsx";
import { SessionTranscriptDrawer } from "./components/SessionTranscriptDrawer.tsx";

export interface AgentToolsViewProps {
  onNavigateToProject?: (projectId: string) => void;
  onImproveGuidance?: (projectId: string, sessionId: string) => void;
}

type AgentToolTab =
  | "overview"
  | "skills"
  | "subagents"
  | "instructions"
  | "mcp"
  | "config"
  | "sessions";

interface TabItem {
  id: AgentToolTab;
  label: string;
}

const TABS: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "skills", label: "Skills" },
  { id: "subagents", label: "Sub-agents" },
  { id: "instructions", label: "Instructions" },
  { id: "mcp", label: "MCP Servers" },
  { id: "config", label: "Configuration" },
  { id: "sessions", label: "Recent Sessions" },
];

export function AgentToolsView({ onNavigateToProject, onImproveGuidance }: AgentToolsViewProps = {}) {
  const [tools, setTools] = useState<AgentToolSummary[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<AgentToolId | null>(null);
  const [details, setDetails] = useState<AgentToolDetails | null>(null);
  const [activeTab, setActiveTab] = useState<AgentToolTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ ref: string; title: string } | null>(null);
  const [transcriptSession, setTranscriptSession] = useState<RecentSessionSummary | null>(null);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAgentTools();
      setTools(res.tools);
      if (res.tools.length > 0) {
        setSelectedToolId((prev) => (prev && res.tools.some((t) => t.id === prev) ? prev : res.tools[0].id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshAgentTools();
      setTools(res.tools);
      if (selectedToolId) {
        const d = await getAgentToolDetails(selectedToolId);
        setDetails(d);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [selectedToolId]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  useEffect(() => {
    if (!selectedToolId) {
      setDetails(null);
      return;
    }

    let active = true;
    void getAgentToolDetails(selectedToolId)
      .then((d) => {
        if (active) {
          setDetails(d);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      active = false;
    };
  }, [selectedToolId]);

  const selectedTool = tools.find((t) => t.id === selectedToolId) ?? null;
  const installedCount = tools.filter((t) => t.installation.installed).length;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-surface">
      {/* Top Bar for Agent Tools */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-ink">Agent Tools Matrix</span>
          <span className="h-3 w-px bg-border" />
          <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[11px] text-muted">
            {tools.length} configured tools
          </span>
          <span className="rounded-full bg-good/10 border border-good/30 px-2 py-0.5 text-[11px] text-good font-medium">
            {installedCount} installed
          </span>
        </div>

        <button
          type="button"
          disabled={loading || refreshing}
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Re-probe CLI candidates, paths, and configurations"
        >
          <svg
            className={`h-3.5 w-3.5 text-info ${refreshing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
          </svg>
          <span>{refreshing ? "Probing tools…" : "Refresh Probes"}</span>
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between border-b border-border bg-critical/10 px-4 py-2 text-xs text-critical">
          <span>{error}</span>
          <button
            type="button"
            className="text-[11px] underline cursor-pointer"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Master-Detail Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ToolSidebar
          tools={tools}
          selectedToolId={selectedToolId}
          onSelectTool={setSelectedToolId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
          {loading && !details ? (
            <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted">
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin text-info"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
                </svg>
                <span>Discovering host agent tools…</span>
              </div>
            </div>
          ) : details && selectedTool ? (
            <>
              {/* Detail Header & Tabs Bar */}
              <div className="border-b border-border bg-panel px-6 pt-4 pb-0">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-ink tracking-tight">
                      {selectedTool.name}
                    </h2>
                    <span className="font-mono text-xs text-muted">({selectedTool.id})</span>
                    {selectedTool.installation.installed ? (
                      <span className="rounded-full bg-good/15 border border-good/30 px-2 py-0.5 text-[11px] text-good font-medium">
                        Installed
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[11px] text-muted font-medium">
                        Not Installed
                      </span>
                    )}
                  </div>

                  {selectedTool.installation.version && (
                    <span className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-xs text-muted">
                      v{selectedTool.installation.version}
                    </span>
                  )}
                </div>

                {/* Tabs Navigation */}
                <div className="flex items-center gap-1 overflow-x-auto">
                  {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          isActive
                            ? "border-accent text-ink font-semibold"
                            : "border-transparent text-muted hover:text-ink hover:border-border"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {activeTab === "overview" && <OverviewTab details={details} />}
                {activeTab === "skills" && (
                  <SkillsTab
                    skills={details.skills}
                    onPreview={(ref, title) => setPreviewTarget({ ref, title })}
                  />
                )}
                {activeTab === "subagents" && (
                  <SubagentsTab
                    subagents={details.subagents}
                    toolName={selectedTool.name}
                    onPreview={(ref, title) => setPreviewTarget({ ref, title })}
                  />
                )}
                {activeTab === "instructions" && (
                  <InstructionsTab
                    instructions={details.instructions}
                    onPreview={(ref, title) => setPreviewTarget({ ref, title })}
                  />
                )}
                {activeTab === "config" && (
                  <ConfigTab configurations={details.configurations} />
                )}
                {activeTab === "mcp" && (
                  <McpTab
                    mcpServers={details.mcpServers}
                    configurations={details.configurations}
                  />
                )}
                {activeTab === "sessions" && (
                  <SessionsTab
                    sessions={details.recentSessions}
                    toolName={selectedTool.name}
                    onNavigateToProject={onNavigateToProject}
                    onViewTranscript={(s) => setTranscriptSession(s)}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted">
              Select an agent tool from the sidebar to inspect details.
            </div>
          )}
        </main>
      </div>

      <ResourcePreviewDrawer
        refId={previewTarget?.ref ?? null}
        title={previewTarget?.title}
        onClose={() => setPreviewTarget(null)}
      />

      <SessionTranscriptDrawer
        session={transcriptSession}
        onClose={() => setTranscriptSession(null)}
        onNavigateToProject={onNavigateToProject}
        onImproveGuidance={onImproveGuidance}
      />
    </div>
  );
}
