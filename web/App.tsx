import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { ProjectsView, type ProjectsHeaderState } from "./features/projects/ProjectsView.tsx";
import { AgentToolsView } from "./features/agentTools/AgentToolsView.tsx";
import { GuidanceReviewModal } from "./components/GuidanceReviewModal.tsx";
import { onOpenSettings } from "./apiClient.ts";
import { isElectron } from "./electronBridge.ts";

export function App() {
  const [activeSection, setActiveSection] = useState<"projects" | "agentTools">("projects");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guidanceRequest, setGuidanceRequest] = useState<{ projectId: string; sessionId: string } | null>(null);
  const [projectsHeaderState, setProjectsHeaderState] = useState<ProjectsHeaderState | null>(null);
  const rescanHandlerRef = useRef<((fetchRemotes: boolean) => Promise<void>) | null>(null);

  const handleNavigateToProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveSection("projects");
  }, []);

  // Electron IPC listener for app:open-settings
  useEffect(() => {
    if (!isElectron()) return;
    const unsubscribe = onOpenSettings(() => setSettingsOpen(true));
    return () => unsubscribe();
  }, []);

  // Global Cmd+, keyboard shortcut for settings
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleRegisterRescanHandler = useCallback((handler: (fetchRemotes: boolean) => Promise<void>) => {
    rescanHandlerRef.current = handler;
  }, []);

  const guidanceProject = guidanceRequest
    ? projectsHeaderState?.inventory?.projects.find((project) => project.id === guidanceRequest.projectId)
    : undefined;

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <Header
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        inventory={projectsHeaderState?.inventory ?? null}
        busy={projectsHeaderState?.busy ?? null}
        scanProgress={projectsHeaderState?.scanProgress ?? null}
        onQuickRefresh={projectsHeaderState?.onQuickRefresh}
        onFullRescan={projectsHeaderState?.onFullRescan}
        onOpenChat={projectsHeaderState?.onOpenChat}
        onOpenSkills={projectsHeaderState?.onOpenSkills}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className={activeSection === "projects" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <ProjectsView
            onHeaderStateChange={setProjectsHeaderState}
            registerRescanHandler={handleRegisterRescanHandler}
            selectedProjectId={selectedProjectId}
          />
        </div>
        <div className={activeSection === "agentTools" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <AgentToolsView onNavigateToProject={handleNavigateToProject} onImproveGuidance={(projectId, sessionId) => setGuidanceRequest({ projectId, sessionId })} />
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onRescanRequested={async () => {
            if (rescanHandlerRef.current) {
              await rescanHandlerRef.current(false);
            }
          }}
        />
      )}
      {guidanceRequest && guidanceProject && (
        <GuidanceReviewModal
          project={guidanceProject}
          sessionId={guidanceRequest.sessionId}
          onClose={() => setGuidanceRequest(null)}
        />
      )}
    </div>
  );
}
