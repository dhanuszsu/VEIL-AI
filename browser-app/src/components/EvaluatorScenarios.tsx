import React from "react";
import { PlayCircle, ShieldAlert, CheckSquare, Search, FileText } from "lucide-react";

interface EvaluatorScenariosProps {
  onRunScenario: (goal: string) => void;
  isExecuting: boolean;
}

export const EvaluatorScenarios: React.FC<EvaluatorScenariosProps> = ({
  onRunScenario,
  isExecuting,
}) => {
  const scenarios = [
    {
      title: "1. Autonomous Form Fill",
      desc: "Agent plans and fills all form fields automatically while protecting secrets on-device.",
      goal: "Fill out the form with my details",
      icon: <FileText size={15} color="var(--accent-cyan)" />,
      badge: "Form Auto-Fill",
    },
    {
      title: "2. Privacy Audit & Zero Leak",
      desc: "Scans DOM and vision for sensitive regions; generates 0 mutation actions.",
      goal: "Analyze this page for sensitive data and privacy risks",
      icon: <ShieldAlert size={15} color="var(--accent-teal)" />,
      badge: "Zero Network Leaks",
    },
    {
      title: "3. Semantic Target Discovery",
      desc: "Resolves abstract goals ('most important element') and highlights with teal glow.",
      goal: "Find the most important element on this page",
      icon: <Search size={15} color="var(--accent-green)" />,
      badge: "Vision Highlight",
    },
    {
      title: "4. Destructive Action Guardrail",
      desc: "Intercepts high-risk account deletion; enforces explicit confirmation prompt.",
      goal: "Delete my account",
      icon: <CheckSquare size={15} color="var(--accent-yellow)" />,
      badge: "Safety Intercept",
    },
  ];

  return (
    <div className="card" style={{ marginTop: "12px" }}>
      <div className="card__header">
        <span className="card__title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <PlayCircle size={14} color="var(--accent-green)" />
          Evaluator Benchmark Suite
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {scenarios.map((sc, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {sc.icon}
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{sc.title}</div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{sc.desc}</div>
              </div>
            </div>
            <button
              className="action-pill-btn"
              onClick={() => onRunScenario(sc.goal)}
              disabled={isExecuting}
              style={{ fontSize: "10px", padding: "4px 8px" }}
            >
              Run Demo
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
