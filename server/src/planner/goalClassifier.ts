import { PageMap, SanitizedElement } from "@privatesight/shared";

export type GoalMode =
  | "informational"
  | "browser_action"
  | "form_task"
  | "navigation_task"
  | "ambiguous"
  | "unsupported";

export interface GoalClassification {
  mode: GoalMode;
  confidence: number;
  interpretation: string;
  extractedIntent?: {
    action?: string;
    target?: string;
    value?: string;
  };
  requiresClarification: boolean;
  clarificationQuestion?: string;
}

const INFORMATIONAL_KEYWORDS = [
  "what can you do",
  "what do you do",
  "capabilities",
  "help",
  "how does this work",
  "what is this",
  "describe",
  "explain",
  "tell me about",
  "what are you",
  "who are you",
  "features",
  "functions",
  "abilities",
  "analyze this page for sensitive data and privacy risks",
  "analyze this page",
  "analyze page",
  "analyze privacy",
  "analyze",
  "privacy audit",
  "privacy risks",
  "privacy analysis",
  "privacy",
  "sensitive data",
  "audit privacy",
  "check privacy",
  "inspect privacy",
];

const BROWSER_ACTION_KEYWORDS = [
  "click",
  "press",
  "tap",
  "select",
  "choose",
  "find",
  "locate",
  "identify",
  "show me",
  "highlight",
  "focus",
  "scroll",
  "go to",
  "navigate",
  "open",
  "close",
  "expand",
  "collapse",
  "toggle",
  "hover",
  "wait",
];

const FORM_TASK_KEYWORDS = [
  "fill",
  "enter",
  "type",
  "input",
  "complete",
  "submit",
  "send",
  "register",
  "sign up",
  "sign in",
  "login",
  "log in",
  "create account",
  "submit form",
  "fill out",
  "fill in",
  "provide",
  "give",
];

const NAVIGATION_KEYWORDS = [
  "go to",
  "navigate to",
  "open",
  "visit",
  "load",
  "redirect",
  "page",
  "url",
  "link",
  "menu",
  "tab",
  "section",
];

const AMBIGUOUS_KEYWORDS = [
  "do it",
  "continue",
  "proceed",
  "next",
  "go",
  "run",
  "execute",
  "perform",
  "action",
  "handle this",
  "take care",
  "fix",
  "solve",
  "process",
  "complete it",
];

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function extractIntent(goal: string, mode: GoalMode): GoalClassification["extractedIntent"] {
  const lower = goal.toLowerCase();
  const intent: GoalClassification["extractedIntent"] = {};

  if (mode === "browser_action") {
    const clickMatch = lower.match(/(click|press|tap|select)\s+(?:the\s+)?(.+)/);
    if (clickMatch) {
      intent.action = "click";
      intent.target = clickMatch[2].trim();
    }
    const findMatch = lower.match(/(find|locate|identify|show me)\s+(?:the\s+)?(.+)/);
    if (findMatch) {
      intent.action = "find";
      intent.target = findMatch[2].trim();
    }
    const scrollMatch = lower.match(/scroll\s+(up|down)/);
    if (scrollMatch) {
      intent.action = "scroll";
      intent.target = scrollMatch[1];
    }
  }

  if (mode === "form_task") {
    const fillMatch = lower.match(/(fill|enter|type|input)\s+(?:the\s+)?(.+?)(?:\s+as\s+(.+))?$/);
    if (fillMatch) {
      intent.action = "fill";
      intent.target = fillMatch[2].trim();
      intent.value = fillMatch[3]?.trim();
    }
    const submitMatch = lower.match(/submit\s+(?:the\s+)?(.+)/);
    if (submitMatch) {
      intent.action = "submit";
      intent.target = submitMatch[1].trim();
    }
  }

  if (mode === "navigation_task") {
    const navMatch = lower.match(/(go to|navigate to|open|visit)\s+(?:the\s+)?(.+)/);
    if (navMatch) {
      intent.action = "navigate";
      intent.target = navMatch[2].trim();
    }
  }

  return Object.keys(intent).length > 0 ? intent : undefined;
}

export function classifyGoal(userGoal: string, pageMap?: PageMap): GoalClassification {
  const trimmed = userGoal.trim();

  if (!trimmed) {
    return {
      mode: "ambiguous",
      confidence: 0,
      interpretation: "Empty goal provided",
      requiresClarification: true,
      clarificationQuestion: "Please specify what you'd like me to do.",
    };
  }

  const lower = trimmed.toLowerCase();

  if (matchesAny(lower, INFORMATIONAL_KEYWORDS)) {
    return {
      mode: "informational",
      confidence: 0.95,
      interpretation: "User is asking about capabilities or requesting information about the page.",
      requiresClarification: false,
    };
  }

  if (matchesAny(lower, BROWSER_ACTION_KEYWORDS)) {
    const intent = extractIntent(trimmed, "browser_action");
    return {
      mode: "browser_action",
      confidence: intent ? 0.9 : 0.75,
      interpretation: intent
        ? `User wants to perform browser action: ${intent.action} on "${intent.target}"`
        : "User wants to perform a browser action but target is unclear.",
      extractedIntent: intent,
      requiresClarification: !intent,
      clarificationQuestion: !intent ? "What specific element or action would you like me to perform?" : undefined,
    };
  }

  if (matchesAny(lower, FORM_TASK_KEYWORDS)) {
    const intent = extractIntent(trimmed, "form_task");
    return {
      mode: "form_task",
      confidence: intent ? 0.9 : 0.75,
      interpretation: intent
        ? `User wants to fill/form interaction: ${intent.action} "${intent.target}"${intent.value ? ` with "${intent.value}"` : ""}`
        : "User wants to interact with a form but details are unclear.",
      extractedIntent: intent,
      requiresClarification: !intent,
      clarificationQuestion: !intent ? "Which field should I fill, and with what value?" : undefined,
    };
  }

  if (matchesAny(lower, NAVIGATION_KEYWORDS)) {
    const intent = extractIntent(trimmed, "navigation_task");
    return {
      mode: "navigation_task",
      confidence: intent ? 0.9 : 0.75,
      interpretation: intent
        ? `User wants to navigate to: ${intent.target}`
        : "User wants to navigate but destination is unclear.",
      extractedIntent: intent,
      requiresClarification: !intent,
      clarificationQuestion: !intent ? "Where would you like me to navigate?" : undefined,
    };
  }

  if (matchesAny(lower, AMBIGUOUS_KEYWORDS)) {
    return {
      mode: "ambiguous",
      confidence: 0.6,
      interpretation: "User request is ambiguous - refers to a previous context or unspecified action.",
      requiresClarification: true,
      clarificationQuestion: "Could you clarify what specific action you'd like me to take?",
    };
  }

  if (pageMap && pageMap.elements.length > 0) {
    const pageContext = pageMap.elements
      .filter((el) => el.visible && el.enabled && !el.sensitive)
      .map((el) => `${el.role}: ${el.label}`)
      .slice(0, 10)
      .join(", ");
    return {
      mode: "unsupported",
      confidence: 0.3,
      interpretation: `Goal not recognized. Available page elements: ${pageContext}`,
      requiresClarification: true,
      clarificationQuestion: `I don't understand "${trimmed}". Try asking me to click, fill, find, scroll, or navigate to something specific.`,
    };
  }

  return {
    mode: "unsupported",
    confidence: 0.2,
    interpretation: "Goal not recognized and no page context available.",
    requiresClarification: true,
    clarificationQuestion: "Please specify what you'd like me to do (e.g., 'click the submit button', 'fill the name field', 'scroll down').",
  };
}

export function isInformationalMode(mode: GoalMode): boolean {
  return mode === "informational";
}

export function requiresBrowserAction(mode: GoalMode): boolean {
  return ["browser_action", "form_task", "navigation_task"].includes(mode);
}

export function shouldExecuteActions(classification: GoalClassification): boolean {
  if (classification.requiresClarification) return false;
  if (classification.mode === "informational") return false;
  if (classification.mode === "ambiguous") return false;
  if (classification.mode === "unsupported") return false;
  return true;
}