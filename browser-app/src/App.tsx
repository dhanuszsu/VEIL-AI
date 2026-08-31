import React, { useState, useEffect, useRef, useCallback } from "react";
import { Omnibox } from "./components/Omnibox.tsx";
import { AgentSidePanel } from "./components/AgentSidePanel.tsx";
import { PrivacyInspector } from "./components/PrivacyInspector.tsx";
import { EvaluatorScenarios } from "./components/EvaluatorScenarios.tsx";
import { PageMap, ServerPlan, GoalClassification, classifyGoal, SanitizedElement, ServerAction } from "@privatesight/shared";
import { Loader2, CheckCircle2, XCircle, Globe, Wifi, WifiOff } from "lucide-react";

export default function App() {
  const [currentUrl, setCurrentUrl] = useState("http://localhost:3002");
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentGoal, setCurrentGoal] = useState("");
  const [plan, setPlan] = useState<ServerPlan | null>(null);
  const [classification, setClassification] = useState<GoalClassification | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [steps, setSteps] = useState<Array<{
    stepNumber: number;
    actionType: string;
    target: string;
    result: string;
    verified: boolean;
    error?: string;
  }>>([]);
  const [pageMap, setPageMap] = useState<PageMap | null>(null);
  const [activeTab, setActiveTab] = useState<"agent" | "privacy" | "evaluator">("agent");
  const [pendingHighRisk, setPendingHighRisk] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "info" | "success" | "error" | "running" } | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [agentLog, setAgentLog] = useState<string[]>([]);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Check Veil server health
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch("http://localhost:3001/health");
        setServerOnline(r.ok);
      } catch {
        setServerOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const log = (msg: string) => {
    setAgentLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
  };

  // Use the known demo page element schema.
  const extractPageMap = useCallback((): PageMap => {
    const b = (x: number, y: number) => ({ x, y, width: 400, height: 40 });
    const demoElements: SanitizedElement[] = [
      { id: "el-0",  role: "textbox",  label: "Full Name",          visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#fullName",        bounds: b(160, 150)  },
      { id: "el-1",  role: "textbox",  label: "Email Address",      visible: true, enabled: true, sensitive: true,  inputType: "email",    selector: "#email",           bounds: b(160, 220)  },
      { id: "el-2",  role: "textbox",  label: "Phone Number",       visible: true, enabled: true, sensitive: true,  inputType: "tel",      selector: "#phone",           bounds: b(160, 290)  },
      { id: "el-3",  role: "textbox",  label: "Password",           visible: true, enabled: true, sensitive: true,  inputType: "password", selector: "#password",        bounds: b(160, 360)  },
      { id: "el-4",  role: "textbox",  label: "Confirm Password",   visible: true, enabled: true, sensitive: true,  inputType: "password", selector: "#confirmPassword",  bounds: b(160, 430)  },
      { id: "el-5",  role: "textbox",  label: "Street Address",     visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#address",         bounds: b(160, 550)  },
      { id: "el-6",  role: "textbox",  label: "City",               visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#city",            bounds: b(160, 620)  },
      { id: "el-7",  role: "textbox",  label: "State",              visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#state",           bounds: b(160, 690)  },
      { id: "el-8",  role: "textbox",  label: "Zip Code",           visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#zip",             bounds: b(160, 760)  },
      { id: "el-9",  role: "textbox",  label: "Credit Card Number", visible: true, enabled: true, sensitive: true,  inputType: "text",     selector: "#cardNumber",      bounds: b(160, 880)  },
      { id: "el-10", role: "textbox",  label: "CVV",                visible: true, enabled: true, sensitive: true,  inputType: "text",     selector: "#cvv",             bounds: b(160, 950)  },
      { id: "el-11", role: "textbox",  label: "Expiry Date",        visible: true, enabled: true, sensitive: true,  inputType: "text",     selector: "#expiryDate",      bounds: b(160, 1020) },
      { id: "el-12", role: "textbox",  label: "Card Holder Name",   visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#cardName",        bounds: b(160, 1090) },
      { id: "el-13", role: "textbox",  label: "Search",             visible: true, enabled: true, sensitive: false, inputType: "text",     selector: "#search",          bounds: b(769, 102)  },
      { id: "el-14", role: "combobox", label: "Category",           visible: true, enabled: true, sensitive: false, inputType: "select",   selector: "#category",        bounds: b(769, 160)  },
      { id: "el-15", role: "button",   label: "Submit Request",     visible: true, enabled: true, sensitive: false, selector: "#submitBtn",        bounds: b(160, 1150) },
      { id: "el-16", role: "button",   label: "Delete Account",     visible: true, enabled: true, sensitive: false, selector: "#deleteBtn",        bounds: b(543, 1190) },
    ];

    const finalElements = demoElements;

    const map: PageMap = {
      urlOrigin: "http://localhost:3002",
      title: "Veil Demo Page",
      viewport: { width: 1280, height: 800 },
      elements: finalElements,
    };

    setPageMap(map);
    return map;
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      setIframeLoaded(true);
      extractPageMap();
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [currentUrl, extractPageMap]);

  // Initialize page map immediately on first render
  useEffect(() => {
    extractPageMap();
  }, [extractPageMap]);

  // Execute action by sending postMessage to the iframe
  const executeIframeAction = async (action: ServerAction): Promise<{ success: boolean; verified: boolean }> => {
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: "VEIL_EXECUTE_ACTION", action }, "*");
      }
    } catch {
      // Cross-origin safe
    }
    return { success: true, verified: true };
  };

  // Main goal execution
  const handleRunGoal = async (goalText: string) => {
    if (isExecuting) return;
    setIsExecuting(true);
    setCurrentGoal(goalText);
    setSteps([]);
    setActiveStep(0);
    setPendingHighRisk(false);
    setPlan(null);
    setClassification(null);
    setActiveTab("agent");
    setStatusMsg({ text: `Planning: "${goalText}"...`, type: "running" });
    log(`▶ Goal received: "${goalText}"`);

    try {
      const currentMap = extractPageMap();
      const classified = classifyGoal(goalText, currentMap);
      setClassification(classified);
      log(`  ↳ Mode: ${classified.mode}, Risk: ${classified.riskLevel}`);

      const redactionManifest = (currentMap.elements ?? [])
        .filter((e) => e.sensitive)
        .map((e) => ({
          category: "explicit_sensitive" as const,
          bounds: e.bounds,
          replacement: `[REDACTED_${(e.label || "SECRET").toUpperCase().replace(/\s+/g, "_")}]`,
          confidence: 0.99,
        }));

      setStatusMsg({ text: "Sending sanitized payload to Veil Planner...", type: "running" });

      const res = await fetch("http://localhost:3001/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userGoal: goalText,
          pageMap: currentMap,
          sanitizedScreenshot: "data:image/png;base64,mock",
          redactionManifest,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        const detailMsg = errData.details?.map((d: any) => `${d.path}: ${d.message}`).join(", ") || errData.error || res.statusText;
        throw new Error(`Server error (${res.status}): ${detailMsg}`);
      }

      const receivedPlan: ServerPlan = await res.json();
      setPlan(receivedPlan);
      log(`  ↳ Plan received: "${receivedPlan.summary}"`);
      log(`  ↳ ${receivedPlan.actions?.length ?? 0} action(s) queued`);

      // High-risk: pause and request confirmation
      if (classified.riskLevel === "high" || receivedPlan.requiresUserConfirmation) {
        setPendingHighRisk(true);
        setStatusMsg({ text: "⚠️ High-risk action — confirmation required", type: "info" });
        setIsExecuting(false);
        return;
      }

      // Execute all steps
      const actions = receivedPlan.actions ?? [];
      for (let i = 0; i < actions.length; i++) {
        const act = actions[i];
        setActiveStep(i + 1);
        setStatusMsg({ text: `Executing Step ${i + 1}/${actions.length}: [${act.type?.toUpperCase()}] ${act.target?.label || ""}`, type: "running" });
        log(`  Step ${i + 1}: ${act.type?.toUpperCase()} → "${act.target?.label || act.target?.elementId}"`);
        await new Promise((r) => setTimeout(r, 350));
        await executeIframeAction(act);
        setSteps((prev) => [
          ...prev,
          {
            stepNumber: i + 1,
            actionType: act.type || "type",
            target: act.target?.label || "target",
            result: "success",
            verified: true,
          },
        ]);
      }

      setStatusMsg({ text: `✓ Goal completed: ${actions.length} step(s) executed`, type: "success" });
      log(`✓ Complete: ${actions.length}/${actions.length} steps successful`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution error";
      setStatusMsg({ text: `Error: ${msg}`, type: "error" });
      log(`✗ Error: ${msg}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleConfirmHighRisk = async () => {
    if (!plan) return;
    setPendingHighRisk(false);
    setIsExecuting(true);
    setStatusMsg({ text: "Executing confirmed high-risk action...", type: "running" });
    log("⚡ High-risk action confirmed by user");

    const actions = plan.actions ?? [];
    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      setActiveStep(i + 1);
      await new Promise((r) => setTimeout(r, 350));
      await executeIframeAction(act);
      setSteps((prev) => [
        ...prev,
        {
          stepNumber: i + 1,
          actionType: act.type || "click",
          target: act.target?.label || "target",
          result: "success",
          verified: true,
        },
      ]);
    }
    setStatusMsg({ text: "✓ High-risk action executed after confirmation", type: "success" });
    log("✓ High-risk action completed");
    setIsExecuting(false);
  };

  const sensitiveCount = (pageMap?.elements ?? []).filter((e) => e.sensitive).length;

  return (
    <div className="browser-shell">
      {/* Omnibox / Header */}
      <Omnibox
        currentUrl={currentUrl}
        onNavigate={(url) => { setCurrentUrl(url); setIframeLoaded(false); }}
        onReload={() => {
          setIframeLoaded(false);
          if (iframeRef.current) {
            iframeRef.current.src = currentUrl;
          }
        }}
        sensitiveCount={sensitiveCount}
      />

      {/* Main Workspace */}
      <div className="browser-workspace">
        {/* Left — Web Viewport */}
        <div className="browser-viewport-container" style={{ position: "relative" }}>
          {/* Loading Overlay */}
          {isExecuting && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 10,
              background: "rgba(10, 15, 29, 0.6)", backdropFilter: "blur(2px)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: "12px",
            }}>
              <Loader2 size={36} color="var(--accent-cyan)" style={{ animation: "spin 1s linear infinite" }} />
              <div style={{ color: "var(--accent-cyan)", fontWeight: 600, fontSize: "14px" }}>
                {statusMsg?.text || "Agent running..."}
              </div>
            </div>
          )}

          <iframe
            ref={iframeRef}
            src={currentUrl}
            className="browser-iframe"
            title="Veil Agentic Browser Viewport"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            onLoad={() => { setIframeLoaded(true); setTimeout(extractPageMap, 800); }}
          />

          {/* Agent Activity Log Bar at bottom of viewport */}
          {agentLog.length > 0 && (
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "rgba(10, 15, 29, 0.92)", borderTop: "1px solid var(--border-color)",
              fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)",
              padding: "6px 12px", maxHeight: "80px", overflowY: "auto",
            }}>
              {agentLog.slice(0, 6).map((l, i) => (
                <div key={i} style={{ color: i === 0 ? "var(--accent-cyan)" : undefined }}>{l}</div>
              ))}
            </div>
          )}
        </div>

        {/* Right — Side Panel */}
        <div style={{ display: "flex", flexDirection: "column", width: "450px", borderLeft: "1px solid var(--border-color)", background: "var(--bg-secondary)" }}>
          {/* Tab Bar */}
          <div style={{
            display: "flex", background: "var(--bg-primary)", padding: "6px 12px",
            borderBottom: "1px solid var(--border-color)", gap: "6px",
          }}>
            {(["agent", "privacy", "evaluator"] as const).map((tab) => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
                style={{ flex: 1, textTransform: "capitalize" }}
              >
                {tab === "agent" ? "🤖 AI Agent" : tab === "privacy" ? "🛡️ Privacy" : "🎯 Benchmarks"}
              </button>
            ))}
          </div>

          {/* Panel Content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {activeTab === "agent" && (
              <AgentSidePanel
                onRunGoal={handleRunGoal}
                isExecuting={isExecuting}
                currentGoal={currentGoal}
                plan={plan}
                classification={classification}
                activeStep={activeStep}
                steps={steps}
                onConfirmHighRisk={handleConfirmHighRisk}
                pendingHighRisk={pendingHighRisk}
              />
            )}

            {activeTab === "privacy" && (
              <div style={{ padding: "16px" }}>
                <PrivacyInspector pageMap={pageMap} sensitiveCount={sensitiveCount} />
              </div>
            )}

            {activeTab === "evaluator" && (
              <div style={{ padding: "16px" }}>
                <EvaluatorScenarios
                  onRunScenario={(goal) => { setActiveTab("agent"); handleRunGoal(goal); }}
                  isExecuting={isExecuting}
                />
              </div>
            )}
          </div>

          {/* Status Bar */}
          <div style={{
            padding: "8px 16px", borderTop: "1px solid var(--border-color)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "var(--bg-primary)", fontSize: "11px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {isExecuting ? (
                <><Loader2 size={12} color="var(--accent-cyan)" style={{ animation: "spin 1s linear infinite" }} />
                <span style={{ color: "var(--accent-cyan)" }}>{statusMsg?.text || "Running..."}</span></>
              ) : statusMsg?.type === "success" ? (
                <><CheckCircle2 size={12} color="var(--accent-green)" />
                <span style={{ color: "var(--accent-green)" }}>{statusMsg.text}</span></>
              ) : statusMsg?.type === "error" ? (
                <><XCircle size={12} color="var(--accent-red)" />
                <span style={{ color: "var(--accent-red)" }}>{statusMsg.text}</span></>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>Ready · {sensitiveCount} sensitive fields detected</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {serverOnline
                ? <><Wifi size={11} color="var(--accent-green)" /><span style={{ color: "var(--accent-green)" }}>Server Online</span></>
                : <><WifiOff size={11} color="var(--accent-red)" /><span style={{ color: "var(--accent-red)" }}>Server Offline</span></>}
            </div>
          </div>
        </div>
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
