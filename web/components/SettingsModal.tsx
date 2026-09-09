import { useState, useEffect, useCallback } from "react";
import { fetchConfig, updateConfig, chooseDirectory } from "../apiClient.ts";
import {
  type AiProviderName,
  GEMINI_MODEL_PRESETS,
  BEDROCK_MODEL_PRESETS,
  BEDROCK_REGION_PRESETS,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_GEMINI_REVIEW_MODEL,
  DEFAULT_BEDROCK_REVIEW_MODEL,
  DEFAULT_BEDROCK_REGION,
} from "../../core/aiModels.ts";

interface SettingsModalProps {
  onClose: () => void;
  onRescanRequested?: () => Promise<void>;
}

const DEFAULT_SEARCH_PATTERNS = [
  "(find|fd)",
  "(grep|rg|ag)",
  "(ls|dir)",
  "tree",
  "(cat|head|tail|wc|sort|uniq|awk|sed|cut|tr|xargs)",
  "(file|stat)",
  "git\\s+(status|log|branch|rev-parse|show|diff|tag)",
];

function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) return trimmed;
  const hasStart = trimmed.startsWith("^");
  const hasEnd = trimmed.endsWith("$");
  if (hasStart && hasEnd) return trimmed;
  const prefix = hasStart ? "" : "^\\s*";
  const suffix = hasEnd ? "" : "(?:\\b.*|$)";
  return `${prefix}(?:${trimmed})${suffix}`;
}

function ModelPicker({
  provider,
  onChangeProvider,
  model,
  onChangeModel,
  feature,
}: {
  provider: AiProviderName;
  onChangeProvider: (provider: AiProviderName) => void;
  model: string;
  onChangeModel: (model: string) => void;
  feature: "chat" | "review";
}) {
  const presets = provider === "bedrock" ? BEDROCK_MODEL_PRESETS : GEMINI_MODEL_PRESETS;
  const defaultModel =
    provider === "bedrock"
      ? feature === "review"
        ? DEFAULT_BEDROCK_REVIEW_MODEL
        : DEFAULT_BEDROCK_CHAT_MODEL
      : feature === "review"
        ? DEFAULT_GEMINI_REVIEW_MODEL
        : DEFAULT_GEMINI_CHAT_MODEL;

  const currentModel = model || defaultModel;
  const isCustom = !presets.some((p) => p.id === currentModel);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            onChangeProvider("gemini");
            if (provider !== "gemini") {
              onChangeModel(feature === "review" ? DEFAULT_GEMINI_REVIEW_MODEL : DEFAULT_GEMINI_CHAT_MODEL);
            }
          }}
          className={`flex-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            provider === "gemini"
              ? "border-info bg-info/15 text-info font-semibold"
              : "border-border bg-surface text-muted hover:text-ink"
          }`}
        >
          Google Gemini
        </button>
        <button
          type="button"
          onClick={() => {
            onChangeProvider("bedrock");
            if (provider !== "bedrock") {
              onChangeModel(feature === "review" ? DEFAULT_BEDROCK_REVIEW_MODEL : DEFAULT_BEDROCK_CHAT_MODEL);
            }
          }}
          className={`flex-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            provider === "bedrock"
              ? "border-info bg-info/15 text-info font-semibold"
              : "border-border bg-surface text-muted hover:text-ink"
          }`}
        >
          Amazon Bedrock
        </button>
      </div>

      <div className="space-y-1.5">
        <select
          value={isCustom ? "custom" : currentModel}
          onChange={(e) => {
            if (e.target.value !== "custom") {
              onChangeModel(e.target.value);
            }
          }}
          className="w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink focus:border-info focus:outline-hidden"
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} ({preset.id})
            </option>
          ))}
          <option value="custom">Custom model ID…</option>
        </select>

        {isCustom && (
          <input
            type="text"
            value={currentModel}
            onChange={(e) => onChangeModel(e.target.value)}
            placeholder={
              provider === "bedrock"
                ? "e.g. us.anthropic.claude-3-5-sonnet-20241022-v2:0"
                : "e.g. gemini-3.8-flash"
            }
            className="w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
          />
        )}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose, onRescanRequested }: SettingsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
  const [newRootInput, setNewRootInput] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showGeminiApiKey, setShowGeminiApiKey] = useState(false);
  const [bedrockApiKey, setBedrockApiKey] = useState("");
  const [showBedrockApiKey, setShowBedrockApiKey] = useState(false);
  const [bedrockRegion, setBedrockRegion] = useState(DEFAULT_BEDROCK_REGION);
  const [chatProvider, setChatProvider] = useState<AiProviderName>("gemini");
  const [chatModel, setChatModel] = useState("");
  const [guidanceReviewProvider, setGuidanceReviewProvider] = useState<AiProviderName>("gemini");
  const [guidanceReviewModel, setGuidanceReviewModel] = useState("");
  const [openCodeDatabasePath, setOpenCodeDatabasePath] = useState("");
  const [claudeConfigDir, setClaudeConfigDir] = useState("");
  const [claudeDesktopSessionsPath, setClaudeDesktopSessionsPath] = useState("");
  const [claudeCoworkSessionsPath, setClaudeCoworkSessionsPath] = useState("");
  const [codexHome, setCodexHome] = useState("");
  const [guidanceHistorySources, setGuidanceHistorySources] = useState<Array<"opencode" | "claude" | "cowork" | "codex">>([
    "opencode",
    "claude",
    "cowork",
    "codex",
  ]);
  const [allowedPatterns, setAllowedPatterns] = useState<string[]>([]);
  const [newPatternInput, setNewPatternInput] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchConfig()
      .then((cfg) => {
        if (cancelled) return;
        setRoots(cfg.roots && cfg.roots.length > 0 ? cfg.roots : [cfg.root]);
        setGeminiApiKey(cfg.geminiApiKey ?? "");
        setBedrockApiKey(cfg.bedrockApiKey ?? "");
        setBedrockRegion(cfg.bedrockRegion ?? DEFAULT_BEDROCK_REGION);
        setChatProvider(cfg.chatProvider ?? cfg.aiProvider ?? "gemini");
        setChatModel(cfg.chatModel ?? "");
        setGuidanceReviewProvider(cfg.guidanceReviewProvider ?? cfg.aiProvider ?? "gemini");
        setGuidanceReviewModel(cfg.guidanceReviewModel ?? "");
        setOpenCodeDatabasePath(cfg.openCodeDatabasePath ?? "");
        setClaudeConfigDir(cfg.claudeConfigDir ?? "");
        setClaudeDesktopSessionsPath(cfg.claudeDesktopSessionsPath ?? "");
        setClaudeCoworkSessionsPath(cfg.claudeCoworkSessionsPath ?? "");
        setCodexHome(cfg.codexHome ?? "");
        setGuidanceHistorySources(cfg.guidanceHistorySources ?? ["opencode", "claude", "cowork", "codex"]);
        setAllowedPatterns(
          Array.isArray(cfg.allowedRootBashPatterns) && cfg.allowedRootBashPatterns.length > 0
            ? cfg.allowedRootBashPatterns
            : DEFAULT_SEARCH_PATTERNS,
        );
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleBrowseFolder = useCallback(async () => {
    setError(null);
    try {
      const selected = await chooseDirectory();
      if (selected) {
        const trimmed = selected.trim();
        if (!roots.includes(trimmed)) {
          setRoots((prev) => [...prev, trimmed]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [roots]);

  const handleAddManualRoot = useCallback(() => {
    const trimmed = newRootInput.trim();
    if (!trimmed) return;
    if (roots.includes(trimmed)) {
      setError("This directory is already added.");
      return;
    }
    setRoots((prev) => [...prev, trimmed]);
    setNewRootInput("");
    setError(null);
  }, [newRootInput, roots]);

  const handleRemoveRoot = useCallback((indexToRemove: number) => {
    if (roots.length <= 1) {
      setError("At least one root directory is required.");
      return;
    }
    setRoots((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setError(null);
  }, [roots]);

  const handleAddPattern = useCallback(() => {
    const trimmed = newPatternInput.trim();
    if (!trimmed) return;
    try {
      new RegExp(normalizePattern(trimmed));
    } catch {
      setPatternError("Invalid regular expression syntax.");
      return;
    }
    if (allowedPatterns.includes(trimmed)) {
      setPatternError("This pattern is already in the list.");
      return;
    }
    setAllowedPatterns((prev) => [...prev, trimmed]);
    setNewPatternInput("");
    setPatternError(null);
  }, [newPatternInput, allowedPatterns]);

  const handleRemovePattern = useCallback((indexToRemove: number) => {
    setAllowedPatterns((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setPatternError(null);
  }, []);

  const handleResetPatterns = useCallback(() => {
    setAllowedPatterns(DEFAULT_SEARCH_PATTERNS);
    setPatternError(null);
  }, []);

  const handleSave = useCallback(
    async (triggerRescan = false) => {
      if (roots.length === 0) {
        setError("At least one root directory is required.");
        return;
      }

      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      try {
        await updateConfig({
          roots,
          geminiApiKey: geminiApiKey.trim(),
          bedrockApiKey: bedrockApiKey.trim(),
          bedrockRegion: bedrockRegion.trim() || DEFAULT_BEDROCK_REGION,
          chatProvider,
          chatModel: chatModel.trim() || undefined,
          guidanceReviewProvider,
          guidanceReviewModel: guidanceReviewModel.trim() || undefined,
          openCodeDatabasePath: openCodeDatabasePath.trim(),
          claudeConfigDir: claudeConfigDir.trim(),
          claudeDesktopSessionsPath: claudeDesktopSessionsPath.trim(),
          claudeCoworkSessionsPath: claudeCoworkSessionsPath.trim(),
          codexHome: codexHome.trim(),
          guidanceHistorySources,
          allowedRootBashPatterns: allowedPatterns,
        });

        setSuccessMessage("Settings saved successfully.");

        if (triggerRescan && onRescanRequested) {
          await onRescanRequested();
          onClose();
        } else {
          setTimeout(() => {
            onClose();
          }, 600);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [
      roots,
      geminiApiKey,
      bedrockApiKey,
      bedrockRegion,
      chatProvider,
      chatModel,
      guidanceReviewProvider,
      guidanceReviewModel,
      openCodeDatabasePath,
      claudeConfigDir,
      claudeDesktopSessionsPath,
      claudeCoworkSessionsPath,
      guidanceHistorySources,
      allowedPatterns,
      onRescanRequested,
      onClose,
    ],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[680px] flex-col rounded-lg border border-border bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <svg
              className="h-5 w-5 text-muted"
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
            <div>
              <h2 className="text-sm font-semibold text-ink">Desktop Settings</h2>
              <p className="text-xs text-muted">Configure scan directories and AI agent credentials</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost px-2.5 py-1 text-base text-muted hover:text-ink"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-xs text-muted">
              Loading settings…
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded border border-critical/30 bg-critical/10 p-3 text-xs text-critical">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="rounded border border-good/30 bg-good/10 p-3 text-xs text-good">
                  {successMessage}
                </div>
              )}

              {/* Root Directories Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
                      Root Directories
                    </h3>
                    <p className="text-xs text-muted">
                      One or more base directories scanned for git repositories and projects.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    className="btn btn-secondary px-2.5 py-1 text-xs"
                  >
                    <svg
                      className="h-3.5 w-3.5 mr-1"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    Browse Folder…
                  </button>
                </div>

                <div className="space-y-1.5">
                  {roots.map((r, index) => (
                    <div
                      key={`${r}-${index}`}
                      className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <svg
                          className="h-4 w-4 shrink-0 text-muted"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="font-mono truncate text-ink select-all">{r}</span>
                        {index === 0 && (
                          <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-muted">
                            primary
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveRoot(index)}
                        disabled={roots.length <= 1}
                        className="btn btn-ghost ml-2 px-1.5 py-0.5 text-xs text-muted hover:text-critical disabled:opacity-30"
                        title={roots.length <= 1 ? "At least one root directory is required" : "Remove directory"}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add manually */}
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newRootInput}
                    onChange={(e) => setNewRootInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddManualRoot();
                      }
                    }}
                    placeholder="Or enter path manually (e.g. ~/code or /Users/...)"
                    className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualRoot}
                    disabled={!newRootInput.trim()}
                    className="btn btn-secondary px-3 py-1.5 text-xs"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* AI Provider Credentials Section */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div>
                  <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
                    AI Provider Credentials
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Configure API keys for Google Gemini and Amazon Bedrock models.
                  </p>
                </div>

                {/* Gemini API Key */}
                <div className="space-y-2 rounded border border-border bg-surface/40 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ink">Google Gemini API Key</span>
                      {geminiApiKey.trim() ? (
                        <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-medium text-good">
                          Configured
                        </span>
                      ) : (
                        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                          Not set
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type={showGeminiApiKey ? "text" : "password"}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full rounded border border-border bg-surface px-3 py-1.5 pr-16 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGeminiApiKey((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost px-2 py-0.5 text-[11px] text-muted hover:text-ink"
                    >
                      {showGeminiApiKey ? "Hide" : "Show"}
                    </button>
                  </div>

                  <p className="text-[11px] text-muted">
                    Keys are stored locally. Generate or manage keys in the{" "}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-info hover:underline"
                    >
                      Google AI Studio dashboard ↗
                    </a>.
                  </p>
                </div>

                {/* Amazon Bedrock API Key */}
                <div className="space-y-2 rounded border border-border bg-surface/40 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ink">Amazon Bedrock API Key</span>
                      {bedrockApiKey.trim() ? (
                        <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-medium text-good">
                          Configured
                        </span>
                      ) : (
                        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                          Not set
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type={showBedrockApiKey ? "text" : "password"}
                      value={bedrockApiKey}
                      onChange={(e) => setBedrockApiKey(e.target.value)}
                      placeholder="Bedrock API key (bearer token)..."
                      className="w-full rounded border border-border bg-surface px-3 py-1.5 pr-16 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBedrockApiKey((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost px-2 py-0.5 text-[11px] text-muted hover:text-ink"
                    >
                      {showBedrockApiKey ? "Hide" : "Show"}
                    </button>
                  </div>

                  {/* Bedrock Region */}
                  <div className="space-y-1 pt-1">
                    <label className="block text-xs text-muted">
                      Bedrock AWS Region
                      <select
                        value={BEDROCK_REGION_PRESETS.some((r) => r.id === bedrockRegion) ? bedrockRegion : "custom"}
                        onChange={(e) => {
                          if (e.target.value !== "custom") {
                            setBedrockRegion(e.target.value);
                          }
                        }}
                        className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink focus:border-info focus:outline-hidden"
                      >
                        {BEDROCK_REGION_PRESETS.map((region) => (
                          <option key={region.id} value={region.id}>
                            {region.label}
                          </option>
                        ))}
                        <option value="custom">Custom region…</option>
                      </select>
                    </label>
                    {!BEDROCK_REGION_PRESETS.some((r) => r.id === bedrockRegion) && (
                      <input
                        type="text"
                        value={bedrockRegion}
                        onChange={(e) => setBedrockRegion(e.target.value)}
                        placeholder="e.g. us-east-1"
                        className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
                      />
                    )}
                  </div>

                  <p className="text-[11px] text-muted">
                    Generate an API key (bearer token) in the AWS Console under Amazon Bedrock &gt; API keys. Ensure model access is granted in Bedrock.
                  </p>
                </div>
              </div>

              {/* AI Models & Providers Section */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div>
                  <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
                    AI Models &amp; Providers
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Select active AI provider and model for chat assistant and agent guidance reviews.
                  </p>
                </div>

                {/* Chat Assistant Model */}
                <div className="space-y-2 rounded border border-border bg-surface/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink">Chat Assistant</span>
                    <span className="text-[10px] text-muted uppercase font-mono">{chatProvider}</span>
                  </div>
                  <ModelPicker
                    provider={chatProvider}
                    onChangeProvider={setChatProvider}
                    model={chatModel}
                    onChangeModel={setChatModel}
                    feature="chat"
                  />
                </div>

                {/* Guidance Review Model */}
                <div className="space-y-3 rounded border border-border bg-surface/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink">Agent Guidance Review</span>
                    <span className="text-[10px] text-muted uppercase font-mono">{guidanceReviewProvider}</span>
                  </div>
                  <ModelPicker
                    provider={guidanceReviewProvider}
                    onChangeProvider={setGuidanceReviewProvider}
                    model={guidanceReviewModel}
                    onChangeModel={setGuidanceReviewModel}
                    feature="review"
                  />

                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <label className="block text-xs text-muted">OpenCode database path
                      <input
                        type="text"
                        value={openCodeDatabasePath}
                        onChange={(e) => setOpenCodeDatabasePath(e.target.value)}
                        placeholder="Default: ~/.local/share/opencode/opencode.db"
                        className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
                      />
                    </label>
                    <label className="block text-xs text-muted">Claude Code configuration directory
                      <input type="text" value={claudeConfigDir} onChange={(e) => setClaudeConfigDir(e.target.value)} placeholder="Default: $CLAUDE_CONFIG_DIR or ~/.claude" className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden" />
                    </label>
                    <label className="block text-xs text-muted">Claude Desktop Code sessions directory
                      <input type="text" value={claudeDesktopSessionsPath} onChange={(e) => setClaudeDesktopSessionsPath(e.target.value)} placeholder="Default: ~/Library/Application Support/Claude/claude-code-sessions" className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden" />
                    </label>
                    <label className="block text-xs text-muted">Claude Cowork sessions directory
                      <input type="text" value={claudeCoworkSessionsPath} onChange={(e) => setClaudeCoworkSessionsPath(e.target.value)} placeholder="Default: ~/Library/Application Support/Claude/local-agent-mode-sessions" className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden" />
                    </label>
                    <label className="block text-xs text-muted">Codex home directory
                      <input type="text" value={codexHome} onChange={(e) => setCodexHome(e.target.value)} placeholder="Default: $CODEX_HOME or ~/.codex" className="mt-1 w-full rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden" />
                    </label>
                    <div className="flex flex-wrap gap-4 text-xs text-muted pt-1">
                      {(["opencode", "claude", "cowork", "codex"] as const).map((source) => (
                        <label key={source} className="flex items-center gap-2">
                          <input type="checkbox" checked={guidanceHistorySources.includes(source)} onChange={() => setGuidanceHistorySources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])} />
                          {source === "opencode" ? "OpenCode history" : source === "claude" ? "Claude Code history" : source === "cowork" ? "Claude Cowork (local)" : "Codex history"}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Allowed Terminal Search Commands Section */}
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
                        Allowed Terminal Search Commands
                      </h3>
                      <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-muted font-mono">
                        {allowedPatterns.length} patterns
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      Regex whitelist of permitted commands for the AI agent&apos;s root search tool (e.g. <span className="font-mono text-ink">(file|stat)</span>). Leading <span className="font-mono text-ink">^\s*</span> and trailing wildcards are added automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetPatterns}
                    className="btn btn-ghost px-2 py-1 text-xs text-muted hover:text-ink"
                    title="Reset to recommended default patterns"
                  >
                    Reset to Defaults
                  </button>
                </div>

                {patternError && (
                  <div className="rounded border border-critical/30 bg-critical/10 p-2.5 text-xs text-critical">
                    {patternError}
                  </div>
                )}

                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {allowedPatterns.map((pattern, index) => (
                    <div
                      key={`${pattern}-${index}`}
                      className="flex items-center justify-between rounded border border-border bg-surface px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono truncate text-ink select-all text-[11px]">{pattern}</span>
                      <button
                        type="button"
                        onClick={() => handleRemovePattern(index)}
                        className="btn btn-ghost ml-2 px-1.5 py-0.5 text-xs text-muted hover:text-critical"
                        title="Remove pattern"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add pattern */}
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newPatternInput}
                    onChange={(e) => {
                      setNewPatternInput(e.target.value);
                      if (patternError) setPatternError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddPattern();
                      }
                    }}
                    placeholder="e.g. (du|df) or tree"
                    className="flex-1 rounded border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted focus:border-info focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={handleAddPattern}
                    disabled={!newPatternInput.trim()}
                    className="btn btn-secondary px-3 py-1.5 text-xs"
                  >
                    Add Pattern
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-3.5 bg-panel/50">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost px-3 py-1.5 text-xs text-muted hover:text-ink"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading || saving || roots.length === 0}
              onClick={() => handleSave(false)}
              className="btn btn-secondary px-3.5 py-1.5 text-xs"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={loading || saving || roots.length === 0}
              onClick={() => handleSave(true)}
              className="btn btn-primary px-3.5 py-1.5 text-xs"
            >
              {saving ? "Saving…" : "Save & Rescan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
