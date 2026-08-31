import React, { useState, useEffect, useCallback } from "react";
import {
  PrivacyStatus,
  ClientPayload,
  ServerPlan,
  ValidatedAction,
  ActionPolicy,
  TelemetryEntry,
  GoalClassification,
  AgentState,
  AgentExecutionContext,
} from "@privatesight/shared";
import {
  ShieldIcon,
  ServerIcon,
  TargetIcon,
  SparkleIcon,
  ChevronIcon,
  AlertIcon,
  TrashIcon,
  InfoIcon,
  GaugeIcon,
  EyeOffIcon,
  SettingsIcon,
  SearchIcon,
  CrosshairIcon,
  PlayIcon,
  PauseIcon,
  StopIcon,
  RefreshCwIcon,
  PulseIcon,
} from "./icons";

import { StatusPill, StatusTone } from "./components/StatusPill";
import { MetricCard } from "./components/MetricCard";
import { ToggleCard } from "./components/ToggleCard";
import { ServerActionItem } from "./components/ServerActionItem";
import { HighRiskConfirmationCard } from "./components/HighRiskConfirmationCard";
import { AgentStateIndicator } from "./components/AgentStateIndicator";
import { ExecutionSteps } from "./components/ExecutionSteps";

interface PopupProps {}

const QUICK_GOALS = [
  { label: "Analyze Privacy", goal: "Analyze this page for sensitive data and privacy risks", icon: <ShieldIcon size={12} strokeWidth={2} /> },
  { label: "Fill Private", goal: "Fill the password field using my local secret", icon: <SettingsIcon size={12} strokeWidth={2} /> },
  { label: "Fill Form", goal: "Fill out the form with my details", icon: <TargetIcon size={12} strokeWidth={2} /> },
  { label: "Find Element", goal: "Find the most important element on this page", icon: <SearchIcon size={12} strokeWidth={2} /> },
  { label: "Navigate", goal: "Navigate to the main settings section", icon: <CrosshairIcon size={12} strokeWidth={2} /> },
];

const Popup: React.FC<PopupProps> = () => {
  const [active, setActive] = useState(true);
  const [serverConnected, setServerConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState("http://localhost:3001");
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyStatus | null>(null);
  const [userGoal, setUserGoal] = useState("");
  const [lastPayload, setLastPayload] = useState<ClientPayload | null>(null);
  const [serverPlan, setServerPlan] = useState<ServerPlan | null>(null);
  const [validatedActions, setValidatedActions] = useState<ValidatedAction[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManifest, setShowManifest] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [agentExecution, setAgentExecution] = useState<AgentExecutionContext | null>(null);
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  const sendBackgroundMessage = useCallback(
    (type: string, data?: any): Promise<any> => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type, ...data }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response ?? { success: true });
          }
        });
      });
    },
    []
  );

  const sendContentMessage = useCallback(
    (type: string, data?: any, _tabId?: number): Promise<any> => {
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab || !tab.id) {
            chrome.tabs.query({ active: true }, (allTabs) => {
              const anyTab = allTabs[0];
              if (!anyTab || !anyTab.id) {
                resolve({ success: false, error: "No active tab found" });
                return;
              }
              chrome.tabs.sendMessage(anyTab.id, { type, ...data }, (response) => {
                if (chrome.runtime.lastError) {
                  resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                  resolve(response ?? { success: true });
                }
              });
              return;
            });
            return;
          }
          chrome.tabs.sendMessage(tab.id, { type, ...data }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response ?? { success: true });
            }
          });
        });
      });
    },
    []
  );

  const refreshStatus = useCallback(async () => {
    try {
      const statusRes = await sendBackgroundMessage("GET_PRIVACY_STATUS");
      if (statusRes?.success && statusRes.status) {
        setPrivacyStatus(statusRes.status);
      }
      const config = await sendBackgroundMessage("GET_SERVER_CONFIG");
      if (config?.success && config.config) {
        setServerConnected(config.config.enabled);
        setServerUrl(config.config.url);
      }
    } catch (e) {
      console.warn("[VEIL][POPUP] refreshStatus error:", e);
    }
  }, [sendBackgroundMessage]);

  const pollAgentState = useCallback(async () => {
    if (!agentExecution?.sessionId) return;

    const response = await sendBackgroundMessage("GET_AGENT_STATE");
    if (response.success && response.agentExecution) {
      setAgentExecution(response.agentExecution);
      if (!response.agentExecution.isExecuting) {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
      }
    }
  }, [agentExecution, sendBackgroundMessage, pollingInterval]);

  const handleCapture = useCallback(async (goalOverride?: string) => {
    const targetGoal = (goalOverride !== undefined ? goalOverride : userGoal).trim();
    if (!targetGoal) {
      setError("Please enter a goal before analyzing the page.");
      return;
    }
    setLoading(true);
    setError(null);
    setServerPlan(null);
    setValidatedActions([]);
    setAgentExecution(null);

    try {
      console.log(`[VEIL][POPUP] sending ANALYZE: "${targetGoal}"`);
      const response = await sendBackgroundMessage("ANALYZE_AND_PLAN", { userGoal: targetGoal });
      if (!response.success) {
        throw new Error(response.error || "Failed to analyze and plan");
      }

      console.log(`[VEIL][POPUP] received ANALYZE response: ${response.plan?.summary}`);

      const payload = response.payload;
      if (payload) {
        setLastPayload(payload);
        setPrivacyStatus({
          backend: "mock" as const,
          redactedCount: payload.redactionManifest?.length ?? 0,
          lastCapture: payload.timestamp,
          sessionActive: true,
        });

        const telemetryEntry = {
          timestamp: new Date().toISOString(),
          metric: "total_latency_ms" as const,
          value: Date.now() - new Date(payload.timestamp).getTime(),
          sessionId: payload.sessionId,
        };
        setTelemetry((prev) => [...prev, telemetryEntry].slice(-50));
      }

      if (response.plan) {
        setServerPlan(response.plan);
      }
      if (response.validatedActions) {
        setValidatedActions(response.validatedActions);
      }
      if (response.agentExecution) {
        setAgentExecution(response.agentExecution);
        if (response.agentExecution.isExecuting) {
          const interval = setInterval(pollAgentState, 1000);
          setPollingInterval(interval);
        }
      }
    } catch (err) {
      console.error("[VEIL][POPUP] Capture error:", err);
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setLoading(false);
    }
  }, [userGoal, sendBackgroundMessage, pollAgentState]);

  const handleConfirmAction = async (actionId?: string) => {
    const targetActionId =
      actionId ||
      validatedActions.find((a) => a.policy === "confirm")?.action.id ||
      serverPlan?.actions[currentStep]?.id ||
      validatedActions[0]?.action.id;
    if (!targetActionId) return;

    try {
      setLoading(true);
      setError(null);
      console.log(`[VEIL][POPUP] confirming action: ${targetActionId}`);
      const response = await sendBackgroundMessage("CONFIRM_ACTION", {
        actionId: targetActionId,
        userGoal,
        payload: lastPayload,
      });

      if (response.success && response.agentExecution) {
        setAgentExecution(response.agentExecution);
        setValidatedActions((prev) =>
          prev.map((a) => {
            const currentAction = a.action;
            const actionIdMatch = currentAction.id === targetActionId;
            return actionIdMatch
              ? { ...a, policy: "auto" as ActionPolicy, reason: "User confirmed" }
              : a;
          })
        );
      } else if (!response.success) {
        setError(response.error || "Action confirmation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action confirmation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelConfirmation = async () => {
    console.log("[VEIL][POPUP] user cancelled confirmation");
    try {
      setLoading(true);
      const response = await sendBackgroundMessage("CANCEL_CONFIRMATION");
      if (response.success && response.agentExecution) {
        setAgentExecution(response.agentExecution);
      } else {
        setAgentExecution((prev) => (prev ? { ...prev, isExecuting: false, status: "idle", plan: null } : null));
      }
      setValidatedActions((prev) =>
        prev.map((a) => ({ ...a, policy: "reject" as ActionPolicy, reason: "Cancelled by user" }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancellation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRejectAction = (actionId: string) => {
    setValidatedActions((prev) =>
      prev.map((a) => {
        const currentAction = a.action;
        const actionIdMatch = currentAction.id === actionId;
        return actionIdMatch
          ? { ...a, policy: "reject" as ActionPolicy, reason: "User rejected" }
          : a;
      })
    );
  };

  const handleStepAgent = async () => {
    if (!lastPayload || !serverPlan || !agentExecution?.classification) return;

    const response = await sendBackgroundMessage("STEP_AGENT", {
      payload: lastPayload,
      plan: serverPlan,
      classification: agentExecution.classification,
      pageMapElements: lastPayload.pageMap.elements,
    });

    if (response.success) {
      setAgentExecution(response.agentExecution);
      if (response.agentExecution.isExecuting) {
        const interval = setInterval(pollAgentState, 1000);
        setPollingInterval(interval);
      }
    }
  };

  const handleCancelAgent = async () => {
    console.log("[VEIL][POPUP] cancelling agent execution");
    await sendBackgroundMessage("CANCEL_AGENT");
    setAgentExecution((prev: AgentExecutionContext | null) => prev ? { ...prev, isExecuting: false, status: "stopped" } : null);
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  };

  const handleClearSession = async () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    console.log("[VEIL][POPUP] clearing session");
    await sendBackgroundMessage("CANCEL_AGENT");
    await sendContentMessage("CLEAR_SESSION");
    setLastPayload(null);
    setServerPlan(null);
    setValidatedActions([]);
    setAgentExecution(null);
    setPrivacyStatus(null);
    setError(null);
  };

  const handleServerUrlChange = async (url: string) => {
    setServerUrl(url);
    try {
      new URL(url);
      await sendBackgroundMessage("UPDATE_SERVER_CONFIG", { config: { url, enabled: true } });
      setServerConnected(true);
    } catch {
      setServerConnected(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  const redactedCount = lastPayload?.redactionManifest?.length ?? 0;
  const payloadSize = lastPayload?.sanitizedScreenshot?.length ?? 0;
  const payloadKb = Math.round(payloadSize / 1024);
  const backend = privacyStatus?.backend ?? "mock";
  const sessionActive = !!privacyStatus?.sessionActive;
  const pendingActionCount = validatedActions.filter((a) => a.policy === "confirm").length;

  const currentStep = agentExecution?.currentStep ?? 0;
  const totalSteps = serverPlan?.actions.length ?? 0;
  const isExecuting = agentExecution?.isExecuting ?? false;
  const agentStatus = agentExecution?.status ?? "idle";

  const overallTone: StatusTone = !active
    ? "off"
    : !serverConnected
    ? "warn"
    : loading
    ? "warn"
    : error
    ? "danger"
    : "ok";

  const overallLabel = !active
    ? "Idle"
    : !serverConnected
    ? "Server offline"
    : loading
    ? "Analyzing…"
    : error
    ? "Error"
    : sessionActive
    ? "Secured"
    : "Ready";

  const showAgentSection = !!serverPlan || !!agentExecution;

  return (
    <div className="popup">
      <header className="popup__header">
        <div className="popup__brand">
          <span className="popup__logo" aria-hidden>
            <ShieldIcon size={18} strokeWidth={2.2} />
          </span>
          <div>
            <div className="popup__title">Veil</div>
            <div className="popup__subtitle">Private vision for AI agents</div>
          </div>
        </div>
        <StatusPill tone={overallTone}>{overallLabel}</StatusPill>
      </header>

      <div className="popup__body">
        <div className="toggle-row">
          <ToggleCard
            active={active}
            onToggle={() => setActive((v) => !v)}
            icon={<EyeOffIcon size={15} />}
            title="Agent"
            hint={active ? "Privacy redaction on" : "Paused"}
          />
          <ToggleCard
            active={serverConnected}
            onToggle={() => handleServerUrlChange(serverConnected ? "" : serverUrl)}
            icon={<ServerIcon size={15} />}
            title="Server"
            hint={serverConnected ? "Connected" : "Offline"}
            disabled={loading}
          />
        </div>

        {serverConnected && (
          <div className="server-row">
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              onBlur={(e) => handleServerUrlChange(e.target.value)}
              placeholder="Server URL"
              className="input"
              disabled={loading}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="status status--ok" title="Connected">
              <span className="status__dot" />
              Live
            </span>
          </div>
        )}

        <div className="metrics">
          <MetricCard label="Backend" value={backend} accent />
          <MetricCard
            label="Redacted"
            value={redactedCount}
            unit={redactedCount === 1 ? "item" : "items"}
          />
          <MetricCard
            label="Payload"
            value={payloadSize > 0 ? payloadKb : 0}
            unit="KB"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="user-goal">
            <TargetIcon size={13} strokeWidth={2} />
            User goal
          </label>

          <div className="quick-actions">
            {QUICK_GOALS.map((q) => (
              <button
                key={q.label}
                className={`chip ${userGoal === q.goal ? "chip--active" : ""}`}
                onClick={() => {
                  setUserGoal(q.goal);
                  handleCapture(q.goal);
                }}
                disabled={loading}
                title={q.label}
              >
                {q.icon}
                {q.label}
              </button>
            ))}
          </div>

          <textarea
            id="user-goal"
            value={userGoal}
            onChange={(e) => setUserGoal(e.target.value)}
            placeholder="Tell Veil what you want to do on this page…"
            rows={2}
            className="textarea"
            disabled={loading}
          />
          <span className="field__helper">
            Describe a task in plain language. Veil will inspect the page and act only on your request.
          </span>
          <span className="field__hint">
            Stays on-device. Only sanitized output reaches the server.
          </span>
        </div>

        <button
          onClick={() => handleCapture()}
          disabled={loading || !active || !userGoal.trim() || !serverConnected}
          className="btn btn--primary btn--block"
        >
          {loading ? (
            <>
              <span className="spinner" />
              Analyzing page…
            </>
          ) : (
            <>
              <SparkleIcon size={14} strokeWidth={2.2} />
              Analyze & plan
            </>
          )}
        </button>

        {error && (
          <div className="alert alert--error" role="alert">
            <span className="alert__icon">
              <AlertIcon size={14} strokeWidth={2} />
            </span>
            <span>{error}</span>
          </div>
        )}

        {showAgentSection && (
          <div className="popup__section">
            <div className="popup__divider" />
            <AgentStateIndicator
              status={agentStatus}
              classification={agentExecution?.classification ?? undefined}
              currentStep={currentStep}
              totalSteps={totalSteps}
            />

            {serverPlan && (
              <div className="plan-section">
                <div className="plan-header">
                  <div className="plan-header__title">
                    <SparkleIcon size={13} strokeWidth={2} />
                    {agentExecution?.classification?.mode === "informational" ? "Response" : "Action Plan"}
                  </div>
                  <StatusPill
                    tone={serverPlan.requiresUserConfirmation ? "warn" : "ok"}
                  >
                    {agentExecution?.classification?.mode === "informational"
                      ? "Informational"
                      : serverPlan.requiresUserConfirmation
                      ? `${pendingActionCount} to confirm`
                      : "Auto-executable"}
                  </StatusPill>
                </div>
                <div className="plan-summary">{serverPlan.summary}</div>

                {agentExecution?.classification?.mode !== "informational" && (
                  <>
                    {agentExecution?.classification?.requiresClarification && (
                      <div className="alert alert--warn">
                        <AlertIcon size={13} strokeWidth={2} />
                        <span>{agentExecution.classification.clarificationQuestion}</span>
                      </div>
                    )}

                    {validatedActions.length > 0 && (
                      <div className="actions">
                        {validatedActions.map((action, index) => {
                          const step = agentExecution?.steps.find((s) => s.stepNumber === index + 1);
                          return (
                            <ServerActionItem
                              key={action.action.id}
                              action={action}
                              index={index}
                              onConfirm={handleConfirmAction}
                              onReject={handleRejectAction}
                              isExecuting={isExecuting}
                              stepNumber={currentStep + 1}
                              step={step}
                            />
                          );
                        })}
                      </div>
                    )}

                    {(agentStatus === "waiting_for_confirmation" || (serverPlan.requiresUserConfirmation && !agentExecution?.steps.some((s) => s.result === "success"))) && validatedActions.length > 0 && (
                      <div style={{ marginTop: "12px" }}>
                        <HighRiskConfirmationCard
                          plan={serverPlan}
                          pendingAction={validatedActions.find((a) => a.policy === "confirm") || validatedActions[0]}
                          onConfirm={() => handleConfirmAction()}
                          onCancel={handleCancelConfirmation}
                          isExecuting={isExecuting}
                        />
                      </div>
                    )}

                    {agentExecution && agentExecution.steps.length > 0 && (
                      <ExecutionSteps
                        steps={agentExecution.steps}
                        planActions={serverPlan.actions}
                        currentStep={currentStep}
                      />
                    )}

                    {!isExecuting && agentStatus === "ready" && serverPlan.actions.length > 0 && (
                      <button
                        onClick={handleStepAgent}
                        className="btn btn--primary btn--block"
                        style={{ marginTop: "12px" }}
                      >
                        <PlayIcon size={14} strokeWidth={2.2} />
                        Execute Step {currentStep + 1} of {totalSteps}
                      </button>
                    )}

                    {isExecuting && (
                      <button
                        onClick={handleCancelAgent}
                        className="btn btn--danger btn--block"
                        style={{ marginTop: "12px" }}
                      >
                        <StopIcon size={14} strokeWidth={2.2} />
                        Stop Execution
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {lastPayload && lastPayload.redactionManifest && lastPayload.redactionManifest.length > 0 && (
          <details
            className="disclosure"
            open={showManifest}
            onToggle={(e) => setShowManifest((e.target as HTMLDetailsElement).open)}
          >
            <summary className="disclosure__summary">
              <span className="disclosure__summary-left">
                <EyeOffIcon size={13} />
                Redaction manifest
                <span className="disclosure__count">{redactedCount}</span>
              </span>
              <span className="disclosure__chevron">
                <ChevronIcon size={14} />
              </span>
            </summary>
            <div className="disclosure__content">
              {lastPayload.redactionManifest.map((entry, i) => {
                if (!entry.bounds) return null;
                return (
                  <div key={i} className="manifest-row">
                    <span className="manifest-row__category">{entry.category}</span>
                    <span className="manifest-row__bounds">
                      ({Math.round(entry.bounds.x)},{Math.round(entry.bounds.y)})
                    </span>
                    <span className="manifest-row__confidence">
                      {Math.round((entry.confidence ?? 0) * 100)}%
                    </span>
                    <span className="manifest-row__arrow">→</span>
                    <span className="manifest-row__replacement">
                      {entry.replacement}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {telemetry.length > 0 && (
          <details
            className="disclosure"
            open={showTelemetry}
            onToggle={(e) => setShowTelemetry((e.target as HTMLDetailsElement).open)}
          >
            <summary className="disclosure__summary">
              <span className="disclosure__summary-left">
                <PulseIcon size={13} />
                Telemetry
                <span className="disclosure__count">{telemetry.length}</span>
              </span>
              <span className="disclosure__chevron">
                <ChevronIcon size={14} />
              </span>
            </summary>
            <div className="disclosure__content">
              {telemetry
                .slice()
                .reverse()
                .map((entry, i) => (
                  <div key={i} className="telemetry-row">
                    <span className="telemetry-row__metric">{entry.metric}</span>
                    <span className="telemetry-row__value">{entry.value} ms</span>
                  </div>
                ))}
            </div>
          </details>
        )}

        <details
          className="disclosure"
          open={showSettings}
          onToggle={(e) => setShowSettings((e.target as HTMLDetailsElement).open)}
        >
          <summary className="disclosure__summary">
            <span className="disclosure__summary-left">
              <SettingsIcon size={13} />
              Settings & safety
            </span>
            <span className="disclosure__chevron">
              <ChevronIcon size={14} />
            </span>
          </summary>
          <div className="disclosure__content" style={{ padding: "10px 12px" }}>
            <div
              className="alert alert--info"
              style={{ marginBottom: 0 }}
              role="note"
            >
              <span className="alert__icon">
                <InfoIcon size={13} strokeWidth={2} />
              </span>
              <span>
                Raw screenshots, form values, and URLs never leave this device.
                Only the redacted page map, redaction manifest, and goal text
                are sent to the configured server.
              </span>
            </div>
          </div>
        </details>

        <div className="popup__footer">
          <span className="popup__footer-meta">
            <GaugeIcon size={11} />
            {active ? "Privacy redaction active" : "Agent disabled"}
          </span>
          <button
            onClick={handleClearSession}
            className="btn btn--danger"
            title="Clear session and redaction state"
          >
            <TrashIcon size={12} />
            Emergency stop
          </button>
        </div>
      </div>
    </div>
  );
};

export default Popup;
export { Popup };
