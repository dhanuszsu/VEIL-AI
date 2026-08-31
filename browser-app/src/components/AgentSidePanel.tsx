import React, { useState } from "react";
import { Sparkles, Send, CheckCircle2, Clock, AlertTriangle, Play, ShieldAlert, Cpu } from "lucide-react";
import { ServerPlan, GoalClassification, ServerAction } from "@privatesight/shared";

interface AgentSidePanelProps {
  onRunGoal: (goal: string) => void;
  isExecuting: boolean;
  currentGoal: string;
  plan: ServerPlan | null;
  classification: GoalClassification | null;
  activeStep: number;
  steps: Array<{
    stepNumber: number;
    actionType: string;
    target: string;
    result: string;
    verified: boolean;
    error?: string;
  }>;
  onConfirmHighRisk?: () => void;
  pendingHighRisk?: boolean;
}

export const AgentSidePanel: React.FC<AgentSidePanelProps> = ({
  onRunGoal,
  isExecuting,
  currentGoal,
  plan,
  classification,
  activeStep,
  steps,
  onConfirmHighRisk,
  pendingHighRisk,
}) => {
  const [inputGoal, setInputGoal] = useState("");

  const quickActions = [
    { label: "Fill Form", goal: "Fill out the form with my details" },
    { label: "Analyze Privacy", goal: "Analyze this page for sensitive data and privacy risks" },
    { label: "Find Element", goal: "Find the most important element on this page" },
    { label: "Fill Private", goal: "Fill the password field using my local secret" },
    { label: "Delete Account", goal: "Delete my account" },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputGoal.trim() || isExecuting) return;
    onRunGoal(inputGoal.trim());
    setInputGoal("");
  };

  return (
    <div className="agent-panel">
      <div className="panel-header">
        <div className="panel-header__title">
          <Sparkles size={16} className="text-cyan" style={{ color: "var(--accent-cyan)" }} />
          <span>Veil AI Agent</span>
        </div>
        <div className="panel-header__tabs">
          <span className="tab-btn active">Live Planner</span>
        </div>
      </div>

      <div className="panel-content">
        {/* Quick Action Chips */}
        <div>
          <div className="card__title" style={{ marginBottom: "8px" }}>Quick Presets</div>
          <div className="quick-chips">
            {quickActions.map((q, idx) => (
              <button
                key={idx}
                className="chip-btn"
                onClick={() => onRunGoal(q.goal)}
                disabled={isExecuting}
              >
                <Sparkles size={10} />
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Current Plan Summary Card */}
        {plan && (
          <div className="card">
            <div className="card__header">
              <span className="card__title">Autonomous Plan</span>
              <span style={{ fontSize: "11px", color: "var(--accent-cyan)", fontWeight: 600 }}>
                {classification?.mode?.toUpperCase() || "ACTION"}
              </span>
            </div>
            <p style={{ fontSize: "13px", lineHeight: "1.4", color: "var(--text-primary)" }}>
              {plan.summary}
            </p>
            {classification && (
              <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                Risk Level: <strong style={{ color: classification.riskLevel === "high" ? "var(--accent-yellow)" : "var(--accent-green)" }}>
                  {classification.riskLevel?.toUpperCase()}
                </strong> | Confidence: <strong>{Math.round((plan.confidence || 0.9) * 100)}%</strong>
              </div>
            )}
          </div>
        )}

        {/* High Risk Confirmation Box */}
        {pendingHighRisk && (
          <div className="confirmation-box">
            <div className="confirmation-box__title">
              <ShieldAlert size={16} />
              <span>Consequential Action Confirmation Required</span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              The agent wants to execute a high-risk destructive action. Review before allowing:
            </p>
            <div className="confirmation-box__actions">
              <button
                className="action-pill-btn action-pill-btn--primary"
                onClick={onConfirmHighRisk}
                style={{ width: "100%", justifyContent: "center" }}
              >
                Confirm & Authorize
              </button>
            </div>
          </div>
        )}

        {/* Action Steps Timeline */}
        {plan && plan.actions && plan.actions.length > 0 && (
          <div>
            <div className="card__title" style={{ marginBottom: "8px" }}>
              Action Steps ({steps.length}/{plan.actions.length})
            </div>
            <div className="step-list">
              {plan.actions.map((act: ServerAction, idx: number) => {
                const executed = steps.find((s) => s.stepNumber === idx + 1);
                const isCurrent = activeStep === idx + 1;

                return (
                  <div key={idx} className="step-item" style={{ borderColor: isCurrent ? "var(--accent-cyan)" : undefined }}>
                    <div className="step-item__badge">{act.type?.toUpperCase()}</div>
                    <div className="step-item__details">
                      <div className="step-item__title">
                        {act.type === "type" ? `Fill "${act.target?.label || "field"}" with "${(act as any).value || "..."}"` :
                         act.type === "click" ? `Click "${act.target?.label || "button"}"` :
                         act.type === "highlight" ? `Highlight "${act.target?.label || "element"}"` :
                         `Fill password on-device`}
                      </div>
                      <div className="step-item__subtitle">
                        Target: {act.target?.label || act.target?.elementId || "resolved"}
                      </div>
                    </div>
                    <div>
                      {executed ? (
                        <span className="step-item__status step-item__status--success">
                          <CheckCircle2 size={15} /> Verified
                        </span>
                      ) : isCurrent ? (
                        <span className="step-item__status step-item__status--running">
                          <Clock size={15} /> Running
                        </span>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Queued</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Goal Input Box */}
      <div className="agent-input-container">
        <form className="agent-input-box" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Instruct the agent (e.g. 'Fill form', 'Analyze privacy')..."
            value={inputGoal}
            onChange={(e) => setInputGoal(e.target.value)}
            disabled={isExecuting}
          />
          <button type="submit" className="agent-submit-btn" disabled={!inputGoal.trim() || isExecuting}>
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
};
