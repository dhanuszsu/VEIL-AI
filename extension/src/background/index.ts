import {
  ClientPayload,
  ServerPlan,
  ServerAction,
  ValidatedAction,
  ActionPolicy,
  ActionType,
  ALLOWED_SERVER_ORIGINS,
  isAllowedOrigin,
  REQUEST_TIMEOUT_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  GoalClassification,
  AgentState,
  AgentStep,
  shouldExecuteActions,
  validateAction,
  SanitizedElement,
  PageMap,
  classifyGoal,
} from "@privatesight/shared";

interface ServerConfig {
  url: string;
  enabled: boolean;
}

interface RateLimitEntry {
  timestamps: number[];
}

interface PageStateTracker {
  tabId: number;
  urlOrigin: string;
  title: string;
  observedAt: number;
  elementCount: number;
}

interface AgentExecutionState {
  sessionId: string | null;
  userGoal: string;
  classification: GoalClassification | null;
  plan: ServerPlan | null;
  currentStep: number;
  maxSteps: number;
  steps: AgentStep[];
  status: AgentState;
  lastPageMap: PageMap | null;
  pageTracker: PageStateTracker | null;
  isExecuting: boolean;
  visionBackend: "webgpu" | "wasm" | "mock";
}

const state = {
  serverConfig: { url: "http://localhost:3001", enabled: true } as ServerConfig,
  rateLimits: new Map<string, RateLimitEntry>(),
  pendingRequests: new Map<string, AbortController>(),
  activeTabId: -1,
  offscreenReady: false,
  offscreenCreating: null as Promise<void> | null,
  agentExecution: {
    sessionId: null,
    userGoal: "",
    classification: null,
    plan: null,
    currentStep: 0,
    maxSteps: 10,
    steps: [],
    status: "idle" as AgentState,
    lastPageMap: null,
    pageTracker: null,
    isExecuting: false,
    visionBackend: "mock",
  } as AgentExecutionState,
};

interface ValidationResult {
  valid: boolean;
  reason: string;
  action: ServerAction;
}

function validateActionLocally(
  action: ServerAction,
  pageMapElements: SanitizedElement[],
  previousActions: ServerAction[],
  stepNumber: number
): ValidationResult {
  // Check max steps
  if (stepNumber >= 10) {
    return {
      valid: false,
      reason: "Maximum step count (10) exceeded. Stopping to prevent infinite loop.",
      action,
    };
  }

  // Check if target element exists in current page map
  if (action.target?.elementId) {
    const targetElement = pageMapElements.find((el) => el.id === action.target?.elementId);
    if (!targetElement) {
      return {
        valid: false,
        reason: `Target element ${action.target.elementId} not found in current page map. Page state may have changed.`,
        action,
      };
    }

    // Check if element is still visible and enabled
    if (!targetElement.visible) {
      return {
        valid: false,
        reason: `Target element ${action.target.elementId} is no longer visible.`,
        action,
      };
    }

    if (!targetElement.enabled) {
      return {
        valid: false,
        reason: `Target element ${action.target.elementId} is disabled.`,
        action,
      };
    }

    // Check if element is sensitive password field (must use fill_private)
    const isPasswordField = (targetElement.inputType === "password") ||
      (targetElement.label || "").toLowerCase().includes("password");
    if (isPasswordField && action.type === "type") {
      return {
        valid: false,
        reason: `Target element ${action.target.elementId} is a sensitive password field (use fill_private).`,
        action,
      };
    }
    if (targetElement.sensitive && action.type !== "fill_private" && action.type !== "type" && action.type !== "highlight") {
      return {
        valid: false,
        reason: `Target element ${action.target.elementId} is sensitive and cannot be acted upon directly.`,
        action,
      };
    }
  }

  // Validate value for type actions
  if (action.type === "type" && !action.value) {
    return {
      valid: false,
      reason: "Type action requires a value.",
      action,
    };
  }

  // Check for duplicate actions on same element
  const duplicateAction = previousActions.find(
    (prev) => prev.type === action.type && prev.target?.elementId === action.target?.elementId
  );
  if (duplicateAction) {
    return {
      valid: false,
      reason: `Duplicate action: ${action.type} on element ${action.target?.elementId} already attempted.`,
      action,
    };
  }

  return { valid: true, reason: "Action validated successfully", action };
}

async function validateActionWithServer(
  action: ServerAction,
  payload: ClientPayload,
  previousActions: ServerAction[],
  stepNumber: number
): Promise<{ valid: boolean; reason: string }> {
  if (!state.serverConfig.enabled) {
    return { valid: true, reason: "Server validation skipped (disabled)" };
  }

  const origin = new URL(state.serverConfig.url).origin;
  if (!isAllowedOrigin(origin)) {
    return { valid: false, reason: `Server origin not in allowlist: ${origin}` };
  }

  const controller = new AbortController();
  const requestId = `${payload.sessionId}-validate-${Date.now()}`;
  state.pendingRequests.set(requestId, controller);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Session-ID": payload.sessionId,
    };
    const response = await fetch(`${state.serverConfig.url}/api/agent/validate-action`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        action,
        previousActions,
        stepNumber,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { valid: false, reason: `Server error: ${response.status} ${response.statusText}` };
    }

    const result = await response.json();
    return { valid: result.valid, reason: result.reason };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { valid: false, reason: "Request cancelled" };
    }
    return { valid: false, reason: error instanceof Error ? error.message : "Unknown error" };
  } finally {
    state.pendingRequests.delete(requestId);
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && tab.id > 0) return tab;
  } catch {}

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id && tab.id > 0) return tab;
  } catch {}

  try {
    const [tab] = await chrome.tabs.query({ active: true });
    if (tab && tab.id && tab.id > 0) return tab;
  } catch {}

  return null;
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const pingRes = await new Promise<{ pong?: boolean }>((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "PING" }, (res) => {
        if (chrome.runtime.lastError || !res?.pong) {
          resolve({});
        } else {
          resolve(res);
        }
      });
    });
    if (pingRes.pong) return true;
  } catch {}

  try {
    console.log(`[VEIL][BACKGROUND] Injecting content.js into tab ${tabId}...`);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise((r) => setTimeout(r, 120));
    return true;
  } catch (err) {
    console.error(`[VEIL][BACKGROUND] Failed to inject content script into tab ${tabId}:`, err);
    return false;
  }
}

async function sendTabMessage(tabId: number, message: any): Promise<any> {
  await ensureContentScript(tabId);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, async (response) => {
      const err = chrome.runtime.lastError;
      if (err && err.message?.includes("Receiving end does not exist")) {
        console.warn(`[VEIL][BACKGROUND] Retry after re-injecting content script on tab ${tabId}`);
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 120));
        chrome.tabs.sendMessage(tabId, message, (retryRes) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(retryRes ?? { success: true });
          }
        });
      } else if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve(response ?? { success: true });
      }
    });
  });
}

async function verifyPageFreshness(expectedTabId: number, expectedTracker: PageStateTracker | null): Promise<boolean> {
  if (state.activeTabId !== expectedTabId) return false;
  if (!expectedTracker) return true;

  try {
    const response = await sendTabMessage(expectedTabId, { type: "GET_PAGE_MAP" });
    if (!response || !response.success || !response.pageMap) return false;
    const currentOrigin = response.pageMap.urlOrigin;
    return currentOrigin === expectedTracker.urlOrigin;
  } catch {
    return false;
  }
}

async function executeAgentStep(
  payload: ClientPayload,
  pageMapElements: SanitizedElement[]
): Promise<{ success: boolean; error?: string; stepResult?: any }> {
  const { agentExecution } = state;
  const { plan, currentStep, steps, classification, pageTracker } = agentExecution;

  console.log(`[VEIL][BACKGROUND] executeAgentStep: step ${currentStep + 1}/${plan?.actions.length}`);

  if (!plan || currentStep >= plan.actions.length || currentStep >= agentExecution.maxSteps) {
    agentExecution.status = "completed";
    agentExecution.isExecuting = false;
    return { success: true };
  }
  // ...

  if (!plan || currentStep >= plan.actions.length || currentStep >= agentExecution.maxSteps) {
    agentExecution.status = "completed";
    agentExecution.isExecuting = false;
    return { success: true };
  }

  // Verify page freshness before executing
  const isFresh = await verifyPageFreshness(state.activeTabId, pageTracker);
  if (!isFresh) {
    agentExecution.status = "failed";
    agentExecution.isExecuting = false;
    const errorMsg = "Page state is stale or active tab changed. Plan invalidated.";
    steps.push({
      stepNumber: currentStep + 1,
      action: plan.actions[currentStep],
      result: "failed",
      error: errorMsg,
      pageChanged: true,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: errorMsg };
  }

  const action = plan.actions[currentStep];

  // Check confirmation requirement for high-risk actions
  if (action.risk === "high" || plan.requiresUserConfirmation) {
    const isConfirmedByUser = steps.some((s) => s.stepNumber === currentStep + 1 && s.result === "pending");
    if (!isConfirmedByUser && action.type !== "highlight" && action.type !== "focus") {
      agentExecution.status = "waiting_for_confirmation";
      agentExecution.isExecuting = false;
      return { success: true, error: "Action requires user confirmation before proceeding." };
    }
  }

  agentExecution.status = "validating";

  // 1. Local validation
  const localValidation = validateActionLocally(
    action,
    pageMapElements,
    steps.map((s) => s.action),
    currentStep
  );

  if (!localValidation.valid) {
    agentExecution.status = "blocked";
    agentExecution.isExecuting = false;
    steps.push({
      stepNumber: currentStep + 1,
      action,
      result: "failed",
      error: localValidation.reason,
      pageChanged: false,
      timestamp: new Date().toISOString(),
      verified: false,
    });
    return { success: false, error: localValidation.reason };
  }

  agentExecution.status = "executing";

  try {
    console.log(`[VEIL][BACKGROUND] sending EXECUTE to content (tab ${state.activeTabId}): ${action.type}`);
    const executeResponse = await sendTabMessage(state.activeTabId, {
      type: "EXECUTE_ACTIONS",
      actions: [action],
    });

    if (!executeResponse || !executeResponse.success) {
      throw new Error(executeResponse?.error || "Execution failed in content script");
    }

    const actionResult = executeResponse.results?.[0];

    agentExecution.status = "verifying";
    await new Promise((r) => setTimeout(r, 150));

    const newPageMapResponse = await sendTabMessage(state.activeTabId, {
      type: "GET_PAGE_MAP",
    });

    let pageChanged = false;
    if (newPageMapResponse?.success && newPageMapResponse.pageMap) {
      const oldElements = agentExecution.lastPageMap?.elements || [];
      const newElements = newPageMapResponse.pageMap.elements || [];
      pageChanged = oldElements.length !== newElements.length;
      agentExecution.lastPageMap = newPageMapResponse.pageMap;
    }

    const stepSuccess = Boolean(actionResult?.success);
    const stepVerified = Boolean(actionResult?.verified);

    const stepRecord: AgentStep = {
      stepNumber: currentStep + 1,
      action,
      result: stepSuccess ? "success" : "failed",
      error: actionResult?.error,
      pageChanged,
      timestamp: new Date().toISOString(),
      verified: stepVerified,
      details: actionResult?.details,
    };

    const existingIndex = steps.findIndex((s) => s.stepNumber === currentStep + 1);
    if (existingIndex >= 0) {
      steps[existingIndex] = stepRecord;
    } else {
      steps.push(stepRecord);
    }

    agentExecution.currentStep = currentStep + 1;

    if (agentExecution.currentStep >= plan.actions.length) {
      agentExecution.status = "completed";
      agentExecution.isExecuting = false;
      console.log(`[VEIL][BACKGROUND] execution complete: completed (${plan.actions.length} action(s))`);
      return { success: true };
    }

    return { success: true, stepResult: actionResult };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const failRecord: AgentStep = {
      stepNumber: currentStep + 1,
      action,
      result: "failed",
      error: errorMsg,
      pageChanged: false,
      timestamp: new Date().toISOString(),
      verified: false,
      details: {},
    };
    const existingIndex = steps.findIndex((s) => s.stepNumber === currentStep + 1);
    if (existingIndex >= 0) {
      steps[existingIndex] = failRecord;
    } else {
      steps.push(failRecord);
    }
    agentExecution.status = "failed";
    agentExecution.isExecuting = false;
    return { success: false, error: errorMsg };
  }
}

async function startAgentExecution(
  payload: ClientPayload,
  plan: ServerPlan,
  classification: GoalClassification,
  pageMapElements: SanitizedElement[]
) {
  const { agentExecution } = state;

  if (agentExecution.isExecuting) {
    return { success: false, error: "Agent already executing" };
  }

  if (!shouldExecuteActions(classification) || plan.actions.length === 0) {
    agentExecution.status = "completed";
    agentExecution.isExecuting = false;
    return { success: true, message: "Goal does not require browser actions" };
  }

  agentExecution.sessionId = payload.sessionId;
  agentExecution.userGoal = payload.userGoal;
  agentExecution.classification = classification;
  agentExecution.plan = plan;
  agentExecution.currentStep = 0;
  agentExecution.maxSteps = Math.max(50, plan.actions.length);
  agentExecution.steps = [];
  agentExecution.status = "observing";
  agentExecution.lastPageMap = payload.pageMap;
  agentExecution.pageTracker = {
    tabId: state.activeTabId,
    urlOrigin: payload.pageMap.urlOrigin,
    title: payload.pageMap.title,
    observedAt: Date.now(),
    elementCount: payload.pageMap.elements.length,
  };
  agentExecution.isExecuting = true;

  agentExecution.status = "interpreting";
  await new Promise((r) => setTimeout(r, 50));

  agentExecution.status = "planning";
  await new Promise((r) => setTimeout(r, 50));

  agentExecution.status = "ready";

  // Check if any high risk actions need confirmation before starting
  const hasHighRisk = plan.actions.some((a) => a.risk === "high") || classification.riskLevel === "high";
  if (hasHighRisk || plan.requiresUserConfirmation) {
    agentExecution.status = "waiting_for_confirmation";
    agentExecution.isExecuting = false;
    return { success: true, requiresConfirmation: true };
  }

  const firstStepResult = await executeAgentStep(payload, pageMapElements);

  while (agentExecution.isExecuting && (agentExecution.status as AgentState) !== "waiting_for_confirmation") {
    await new Promise((r) => setTimeout(r, 100));
    if (agentExecution.currentStep < agentExecution.plan!.actions.length) {
      await executeAgentStep(payload, pageMapElements);
    } else {
      break;
    }
  }

  return firstStepResult;
}

function checkRateLimit(origin: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let entry = state.rateLimits.get(origin);
  if (!entry) {
    entry = { timestamps: [] };
    state.rateLimits.set(origin, entry);
  }

  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  entry.timestamps.push(now);
  return true;
}

async function sendToServer(payload: ClientPayload): Promise<ServerPlan | null> {
  if (!state.serverConfig.enabled) {
    throw new Error("Server communication disabled");
  }

  const origin = new URL(state.serverConfig.url).origin;
  if (!isAllowedOrigin(origin)) {
    throw new Error(`Server origin not in allowlist: ${origin}`);
  }

  if (!checkRateLimit(origin)) {
    throw new Error("Rate limit exceeded");
  }

  const controller = new AbortController();
  const requestId = `${payload.sessionId}-${Date.now()}`;
  state.pendingRequests.set(requestId, controller);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Session-ID": payload.sessionId,
    };
    const response = await fetch(`${state.serverConfig.url}/api/agent/plan`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    const plan = (await response.json()) as ServerPlan;
    return plan;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request cancelled");
    }
    throw error;
  } finally {
    state.pendingRequests.delete(requestId);
  }
}

function validatePlan(plan: ServerPlan, pageMapElements: SanitizedElement[], pageOrigin?: string): ValidatedAction[] {
  return (plan.actions ?? []).map((action) => validateAction(action, pageMapElements, pageOrigin));
}

/* ------------------------------------------------------------------ *
 * Offscreen document lifecycle                                        *
 * ------------------------------------------------------------------ */

const OFFSCREEN_DOC_PATH = "offscreen.html";
const OFFSCREEN_REASONS = ["DOM_PARSER" as chrome.offscreen.Reason];

async function hasOffscreenDocument(): Promise<boolean> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOC_PATH)],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (state.offscreenCreating) {
    return state.offscreenCreating;
  }
  state.offscreenCreating = (async () => {
    if (await hasOffscreenDocument()) {
      state.offscreenReady = true;
      return;
    }
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOC_PATH,
        reasons: OFFSCREEN_REASONS,
        justification: "Host ONNX Runtime Web vision pipeline for lightweight browser agents.",
      });
      state.offscreenReady = true;
    } catch (err) {
      console.warn("[Veil] Offscreen creation error (may already exist):", err);
      state.offscreenReady = true;
    }
  })().finally(() => {
    state.offscreenCreating = null;
  });
  return state.offscreenCreating;
}

async function processVisionInOffscreen(imageData: { dataUrl: string; width: number; height: number }): Promise<any> {
  await ensureOffscreenDocument();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        target: "OFFSCREEN",
        type: "OFFSCREEN_PROCESS_FRAME",
        imageData,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from offscreen" });
      }
    );
  });
}

function handleEmergencyStop(): void {
  // 1. Abort all pending network requests
  for (const controller of state.pendingRequests.values()) {
    controller.abort();
  }
  state.pendingRequests.clear();

  // 2. Stop agent execution state
  state.agentExecution.isExecuting = false;
  state.agentExecution.status = "stopped";
  state.agentExecution.plan = null;

  // 3. Inform active tab to remove highlights and stop action executions
  if (state.activeTabId > 0) {
    sendTabMessage(state.activeTabId, { type: "EMERGENCY_STOP" }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * Message router                                                      *
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  // Ignore messages meant specifically for offscreen
  if (message.target === "OFFSCREEN") return false;

  (async () => {
    try {
      switch (message.type) {
        case "ANALYZE_AND_PLAN": {
          console.log(`[VEIL][BACKGROUND] received ANALYZE: "${message.userGoal || ""}"`);
          const activeTab = await getActiveTab();
          if (!activeTab || !activeTab.id) {
            console.error("[VEIL][BACKGROUND] No active tab found");
            sendResponse({ success: false, error: "No active tab found. Please open a web page." });
            break;
          }
          console.log(`[VEIL][BACKGROUND] active tab = ${activeTab.id} (${activeTab.url || "unknown URL"})`);
          state.activeTabId = activeTab.id;

          const scriptReady = await ensureContentScript(activeTab.id);
          if (!scriptReady) {
            sendResponse({ success: false, error: "Could not initialize content perception on active tab." });
            break;
          }

          console.log(`[VEIL][BACKGROUND] sending OBSERVE to content (tab ${activeTab.id})`);
          const captureResponse = await sendTabMessage(activeTab.id, {
            type: "CAPTURE_AND_SEND",
            userGoal: message.userGoal || "",
          });

          if (!captureResponse.success || !captureResponse.payload) {
            console.error(`[VEIL][BACKGROUND] Capture failed: ${captureResponse.error}`);
            sendResponse({ success: false, error: captureResponse.error || "Page observation failed" });
            break;
          }

          const payload: ClientPayload = captureResponse.payload;
          console.log(`[VEIL][BACKGROUND] received sanitized context: ${payload.redactionManifest?.length ?? 0} redacted items (${payload.pageMap?.elements?.length ?? 0} elements)`);

          console.log(`[VEIL][BACKGROUND] sending plan request to server (${state.serverConfig.url}/api/agent/plan)`);
          const plan = await sendToServer(payload);
          if (!plan) {
            console.error("[VEIL][BACKGROUND] Server failed to return a plan");
            sendResponse({ success: false, error: "Server failed to return an action plan" });
            break;
          }

          console.log(`[VEIL][BACKGROUND] received plan from server: "${plan.summary}" (${plan.actions?.length ?? 0} actions)`);
          const validated = validatePlan(plan, payload.pageMap.elements ?? [], payload.pageMap.urlOrigin);
          const classification = classifyGoal(payload.userGoal, payload.pageMap);

          const hasAutoActions = validated.some((v) => v.policy === "auto");
          const isInformational = classification.mode === "information" || classification.mode === "informational";
          const shouldAutoExecute = hasAutoActions && (plan?.actions?.length ?? 0) > 0 && !isInformational && classification.riskLevel !== "high" && !plan.requiresUserConfirmation;

          let executionResult: any = { success: true };
          if (shouldAutoExecute) {
            console.log(`[VEIL][BACKGROUND] auto-executing plan with ${plan.actions.length} action(s)`);
            executionResult = await startAgentExecution(payload, plan, classification, payload.pageMap.elements ?? []);
          } else if (plan.requiresUserConfirmation || classification.riskLevel === "high") {
            console.log(`[VEIL][BACKGROUND] plan requires user confirmation (risk: ${classification.riskLevel})`);
            state.agentExecution = {
              sessionId: payload.sessionId,
              userGoal: payload.userGoal,
              classification,
              plan,
              currentStep: 0,
              maxSteps: Math.max(50, plan.actions.length),
              steps: [],
              status: "waiting_for_confirmation",
              lastPageMap: payload.pageMap,
              pageTracker: {
                tabId: activeTab.id,
                urlOrigin: payload.pageMap.urlOrigin,
                title: payload.pageMap.title,
                observedAt: Date.now(),
                elementCount: payload.pageMap.elements.length,
              },
              isExecuting: false,
              visionBackend: "mock",
            };
          } else {
            state.agentExecution = {
              sessionId: payload.sessionId,
              userGoal: payload.userGoal,
              classification,
              plan,
              currentStep: 0,
              maxSteps: Math.max(50, plan.actions.length),
              steps: [],
              status: isInformational ? "completed" : "ready",
              lastPageMap: payload.pageMap,
              pageTracker: {
                tabId: activeTab.id,
                urlOrigin: payload.pageMap.urlOrigin,
                title: payload.pageMap.title,
                observedAt: Date.now(),
                elementCount: payload.pageMap.elements.length,
              },
              isExecuting: false,
              visionBackend: "mock",
            };
          }

          sendResponse({
            success: true,
            payload,
            plan,
            validatedActions: validated,
            executionResult,
            classification,
            agentExecution: state.agentExecution,
          });
          break;
        }

        case "CONFIRM_ACTION": {
          const { payload, actionId } = message;

          // 1. Verify active pending plan exists
          if (!state.agentExecution.plan || state.agentExecution.plan.actions.length === 0) {
            sendResponse({ success: false, error: "No active plan to confirm." });
            break;
          }

          // 2. Verify emergency stop is not active
          if (state.agentExecution.status === "stopped") {
            sendResponse({ success: false, error: "Cannot execute: emergency stop has been triggered." });
            break;
          }

          // 3. Verify pending action matches
          const pendingAction = state.agentExecution.plan.actions[state.agentExecution.currentStep];
          if (!pendingAction) {
            sendResponse({ success: false, error: "No pending action remaining in current plan." });
            break;
          }
          if (actionId && pendingAction.id && pendingAction.id !== actionId) {
            sendResponse({ success: false, error: `Action mismatch: expected ${pendingAction.id}, got ${actionId}.` });
            break;
          }

          // 4. Verify active tab has not changed
          const activeTab = await getActiveTab();
          if (!activeTab || activeTab.id !== state.activeTabId) {
            sendResponse({ success: false, error: "Active tab has changed. Please re-analyze the page." });
            break;
          }

          // 5. Verify page origin has not changed
          if (state.agentExecution.pageTracker && payload?.pageMap?.urlOrigin) {
            if (payload.pageMap.urlOrigin !== state.agentExecution.pageTracker.urlOrigin) {
              sendResponse({ success: false, error: "Page origin has changed since observation. Please re-analyze." });
              break;
            }
          }

          // 6. Verify plan staleness (not older than 5 minutes)
          if (state.agentExecution.pageTracker?.observedAt) {
            const ageMs = Date.now() - state.agentExecution.pageTracker.observedAt;
            if (ageMs > 5 * 60 * 1000) {
              sendResponse({ success: false, error: "Plan has become stale. Please re-analyze the page." });
              break;
            }
          }

          console.log(`[VEIL][BACKGROUND] user confirmed action: ${pendingAction.type} (${pendingAction.id})`);
          state.agentExecution.isExecuting = true;
          state.agentExecution.status = "executing";

          // Mark step as confirmed
          state.agentExecution.steps.push({
            stepNumber: state.agentExecution.currentStep + 1,
            action: pendingAction,
            result: "pending",
            pageChanged: false,
            timestamp: new Date().toISOString(),
            verified: false,
          });

          const stepResult = await executeAgentStep(payload, payload?.pageMap?.elements ?? []);

          while (state.agentExecution.isExecuting && (state.agentExecution.status as AgentState) !== "waiting_for_confirmation") {
            await new Promise((r) => setTimeout(r, 50));
            if (state.agentExecution.plan && state.agentExecution.currentStep < state.agentExecution.plan.actions.length) {
              await executeAgentStep(payload, payload?.pageMap?.elements ?? []);
            } else {
              break;
            }
          }

          sendResponse({ success: true, stepResult, agentExecution: state.agentExecution });
          break;
        }

        case "CANCEL_CONFIRMATION":
        case "CANCEL_ACTION": {
          console.log("[VEIL][BACKGROUND] user cancelled pending action / confirmation");
          state.agentExecution.isExecuting = false;
          state.agentExecution.status = "idle";
          state.agentExecution.plan = null;
          state.agentExecution.steps = [];
          if (state.activeTabId > 0) {
            sendTabMessage(state.activeTabId, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
          }
          sendResponse({ success: true, status: "idle", agentExecution: state.agentExecution });
          break;
        }

        case "GET_PRIVACY_STATUS": {
          const activeTab = await getActiveTab();
          if (!activeTab || !activeTab.id) {
            sendResponse({
              success: true,
              status: {
                backend: "mock" as const,
                redactedCount: 0,
                lastCapture: undefined,
                sessionActive: false,
              },
            });
            break;
          }
          state.activeTabId = activeTab.id;
          await ensureContentScript(activeTab.id);
          const contentRes = await sendTabMessage(activeTab.id, { type: "GET_PRIVACY_STATUS" });
          if (contentRes.success && contentRes.status) {
            sendResponse({ success: true, status: contentRes.status });
          } else {
            sendResponse({
              success: true,
              status: {
                backend: "mock" as const,
                redactedCount: 0,
                lastCapture: undefined,
                sessionActive: false,
              },
            });
          }
          break;
        }

        case "VISION_PROCESS": {
          console.log("[VEIL][BACKGROUND] routing frame to offscreen document");
          const result = await processVisionInOffscreen(message.imageData);
          sendResponse(result);
          break;
        }

        case "SEND_TO_SERVER": {
          const payload = message.payload as ClientPayload;
          const pageOrigin = payload.pageMap?.urlOrigin;
          const plan = await sendToServer(payload);
          const validated = plan ? validatePlan(plan, message.pageMapElements ?? [], pageOrigin) : [];

          const classification = classifyGoal(payload.userGoal, payload.pageMap);

          const hasAutoActions = validated.some((v) => v.policy === "auto");
          const isInformational = classification.mode === "information" || classification.mode === "informational";
          const shouldAutoExecute = hasAutoActions && (plan?.actions?.length ?? 0) > 0 && !isInformational && classification.riskLevel !== "high";

          let executionResult = { success: true };
          if (shouldAutoExecute && plan) {
            executionResult = await startAgentExecution(payload, plan, classification, message.pageMapElements ?? []);
          }

          sendResponse({ success: true, plan, validatedActions: validated, executionResult, classification });
          break;
        }

        case "GET_AGENT_STATE": {
          sendResponse({
            success: true,
            agentExecution: state.agentExecution,
          });
          break;
        }

        case "STEP_AGENT": {
          const payload = message.payload as ClientPayload;
          const plan = message.plan as ServerPlan;
          const classification = message.classification as GoalClassification;
          const pageMapElements = message.pageMapElements ?? [];

          if (!state.agentExecution.isExecuting) {
            state.agentExecution.sessionId = payload.sessionId;
            state.agentExecution.userGoal = payload.userGoal;
            state.agentExecution.classification = classification;
            state.agentExecution.plan = plan;
            state.agentExecution.currentStep = 0;
            state.agentExecution.maxSteps = 10;
            state.agentExecution.steps = [];
            state.agentExecution.status = "ready";
            state.agentExecution.lastPageMap = payload.pageMap;
            state.agentExecution.pageTracker = {
              tabId: state.activeTabId,
              urlOrigin: payload.pageMap.urlOrigin,
              title: payload.pageMap.title,
              observedAt: Date.now(),
              elementCount: payload.pageMap.elements.length,
            };
            state.agentExecution.isExecuting = true;
          }

          const result = await executeAgentStep(payload, pageMapElements);
          sendResponse({ success: true, result, agentExecution: state.agentExecution });
          break;
        }

        case "CANCEL_AGENT":
        case "EMERGENCY_STOP": {
          handleEmergencyStop();
          sendResponse({ success: true, status: "stopped" });
          break;
        }

        case "UPDATE_SERVER_CONFIG": {
          const { url, enabled } = message.config ?? {};
          if (url) {
            try {
              new URL(url);
              state.serverConfig.url = url;
            } catch {
              sendResponse({ success: false, error: "Invalid server URL" });
              return;
            }
          }
          if (typeof enabled === "boolean") state.serverConfig.enabled = enabled;
          sendResponse({ success: true, config: state.serverConfig });
          break;
        }

        case "GET_SERVER_CONFIG": {
          sendResponse({ success: true, config: state.serverConfig });
          break;
        }

        case "SET_ACTIVE_TAB": {
          state.activeTabId = message.tabId;
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown background message type: ${message.type}` });
      }
    } catch (error) {
      console.error("[VEIL][BACKGROUND] Error handling message:", error);
      sendResponse({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  })();

  return true;
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  state.activeTabId = activeInfo.tabId;
  // If active tab switches during execution, pause or invalidate execution
  if (state.agentExecution.isExecuting && state.agentExecution.pageTracker?.tabId !== activeInfo.tabId) {
    state.agentExecution.status = "blocked";
    state.agentExecution.isExecuting = false;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.activeTabId && changeInfo.status === "loading") {
    // Navigation occurred, invalidate current page state
    if (state.agentExecution.isExecuting) {
      state.agentExecution.status = "blocked";
      state.agentExecution.isExecuting = false;
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VEIL][BACKGROUND] Extension installed/updated");
});

console.log("[VEIL][BACKGROUND] Background service worker initialized");

