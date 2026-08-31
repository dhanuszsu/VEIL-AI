import { PageMap, SanitizedElement, GoalMode, GoalClassification, ActionRiskLevel, GoalIntent } from "@privatesight/shared";

const INFORMATIONAL_KEYWORDS = [
  "what can you do",
  "what do you do",
  "capabilities",
  "help",
  "how does this work",
  "what is this",
  "what is on this page",
  "what is on",
  "describe this page",
  "describe",
  "explain this page",
  "explain",
  "tell me about this page",
  "tell me about",
  "what are you",
  "who are you",
  "features",
  "functions",
  "abilities",
  "what information is this page asking me for",
  "what is this page asking",
  "what fields are on this page",
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

const DELETE_KEYWORDS = [
  "delete my account",
  "delete account",
  "delete profile",
  "remove my account",
  "remove account",
  "erase my account",
  "erase account",
  "close my account",
  "close account",
  "delete",
];

const SEARCH_KEYWORDS = [
  "search for",
  "search products",
  "search item",
  "search",
  "query for",
  "look up",
];

const SCROLL_KEYWORDS = [
  "scroll down to see more",
  "scroll down to",
  "scroll down",
  "scroll up to",
  "scroll up",
  "scroll to top",
  "scroll to bottom",
  "scroll",
  "page down",
  "page up",
];

const HIGHLIGHT_KEYWORDS = [
  "highlight the",
  "highlight",
  "mark",
  "outline",
];

const FIND_KEYWORDS = [
  "find the",
  "find my",
  "find",
  "locate the",
  "locate",
  "identify the",
  "identify",
  "show me the",
  "show me",
  "where is",
  "where are",
];

const CLICK_KEYWORDS = [
  "click the",
  "click on the",
  "click on",
  "click it",
  "click",
  "press the",
  "press",
  "tap the",
  "tap",
  "select the",
  "select",
  "choose the",
  "choose",
];

const FILL_KEYWORDS = [
  "fill my",
  "fill the",
  "fill out",
  "fill in",
  "fill",
  "enter my",
  "enter the",
  "enter",
  "type my",
  "type the",
  "type",
  "input my",
  "input the",
  "input",
  "set my",
  "set the",
  "set",
];

const SUBMIT_KEYWORDS = [
  "submit the form",
  "submit form",
  "submit request",
  "submit my",
  "submit",
  "send the form",
  "send form",
];

const NAVIGATION_KEYWORDS = [
  "go to the",
  "go to",
  "navigate to the",
  "navigate to",
  "open the",
  "open",
  "visit the",
  "visit",
  "load the",
  "load",
];

const AMBIGUOUS_KEYWORDS = [
  "do it",
  "do something",
  "continue",
  "proceed",
  "next",
  "go ahead",
  "run",
  "execute",
  "perform",
  "action",
  "handle this",
  "take care of it",
  "take care",
  "fix it",
  "fix",
  "solve it",
  "solve",
  "process",
  "complete it",
  "make it work",
];

function matchesAnyPrefixOrKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase().trim();
  return keywords.some((kw) => {
    const kwLower = kw.toLowerCase().trim();
    if (lower === kwLower) return true;
    const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
    return regex.test(lower);
  });
}

function extractIntentFromGoal(goal: string): { mode: GoalMode; intent?: GoalIntent; confidence: number } {
  const raw = goal.trim();
  const lower = raw.toLowerCase();

  // 1. Informational queries
  if (matchesAnyPrefixOrKeyword(lower, INFORMATIONAL_KEYWORDS)) {
    return {
      mode: "information",
      intent: { action: "information", risk: "low", requiresConfirmation: false },
      confidence: 0.98,
    };
  }

  // 2. Delete / Destructive queries (High Risk)
  if (matchesAnyPrefixOrKeyword(lower, DELETE_KEYWORDS)) {
    const deleteMatch = lower.match(/(?:delete|remove|erase|close)\s+(?:my\s+)?(.+)/i);
    const target = deleteMatch ? deleteMatch[1].trim() : "account";
    return {
      mode: "delete",
      intent: {
        action: "delete",
        target,
        risk: "high",
        requiresConfirmation: true,
      },
      confidence: 0.95,
    };
  }

  // 3. Scroll queries
  if (matchesAnyPrefixOrKeyword(lower, SCROLL_KEYWORDS)) {
    const direction = lower.includes("up") ? "up" : "down";
    return {
      mode: "scroll",
      intent: {
        action: "scroll",
        target: direction,
        risk: "low",
        requiresConfirmation: false,
      },
      confidence: 0.95,
    };
  }

  // 4. Click / Select queries (Evaluated before Submit so "click the submit button" is recognized as click)
  if (matchesAnyPrefixOrKeyword(lower, CLICK_KEYWORDS)) {
    const clickMatch = lower.match(/(?:click|press|tap|select|choose)\s+(?:on\s+)?(?:the\s+)?(.+)/i);
    const target = clickMatch ? clickMatch[1].trim() : "";
    return {
      mode: "click",
      intent: {
        action: "click",
        target: target || "element",
        risk: "medium",
        requiresConfirmation: false,
      },
      confidence: 0.92,
    };
  }

  // 5. Search queries
  if (matchesAnyPrefixOrKeyword(lower, SEARCH_KEYWORDS)) {
    const searchMatch = lower.match(/(?:search\s+for|query\s+for|look\s+up|search)\s+(?:the\s+)?(.+)/i);
    const query = searchMatch ? searchMatch[1].trim() : "";
    return {
      mode: "search",
      intent: {
        action: "search",
        target: query || "search",
        value: query || undefined,
        risk: "low",
        requiresConfirmation: false,
      },
      confidence: 0.92,
    };
  }

  // 6. Highlight queries
  if (matchesAnyPrefixOrKeyword(lower, HIGHLIGHT_KEYWORDS)) {
    const hlMatch = lower.match(/(?:highlight|mark|outline)\s+(?:the\s+)?(.+)/i);
    const target = hlMatch ? hlMatch[1].trim() : "element";
    return {
      mode: "highlight",
      intent: {
        action: "highlight",
        target,
        risk: "low",
        requiresConfirmation: false,
      },
      confidence: 0.94,
    };
  }

  // 7. Find / Locate queries
  if (matchesAnyPrefixOrKeyword(lower, FIND_KEYWORDS)) {
    const findMatch = lower.match(/(?:find|locate|identify|show me|where is|where are)\s+(?:the\s+|my\s+)?(.+)/i);
    const target = findMatch ? findMatch[1].trim() : "element";
    return {
      mode: "find",
      intent: {
        action: "find",
        target,
        risk: "low",
        requiresConfirmation: false,
      },
      confidence: 0.94,
    };
  }

  // 8. Fill / Type queries
  if (matchesAnyPrefixOrKeyword(lower, FILL_KEYWORDS)) {
    let target = "";
    let value = "";

    const typeIntoMatch = raw.match(/(?:type|enter|input)\s+(.+?)\s+(?:into|in)\s+(?:the\s+|my\s+)?(.+)/i);
    if (typeIntoMatch) {
      value = typeIntoMatch[1].trim();
      target = typeIntoMatch[2].trim();
    } else {
      const fillAsMatch = raw.match(/(?:fill|enter|type|input|set)\s+(?:the\s+|my\s+)?(.+?)\s+(?:using|with|as|=|to)\s+(.+)/i);
      if (fillAsMatch) {
        target = fillAsMatch[1].trim();
        value = fillAsMatch[2].trim();
      } else {
        const fillOnlyMatch = raw.match(/(?:fill|enter|type|input|set)\s+(?:the\s+|my\s+)?(.+)/i);
        if (fillOnlyMatch) {
          target = fillOnlyMatch[1].trim();
        }
      }
    }

    // Clean up targets like "out the form" or "out form" -> "form"
    if (target.toLowerCase().startsWith("out the ")) {
      target = target.replace(/^out\s+the\s+/i, "");
    } else if (target.toLowerCase().startsWith("out ")) {
      target = target.replace(/^out\s+/i, "");
    }

    return {
      mode: "fill",
      intent: {
        action: "fill",
        target: target || "field",
        value: value || undefined,
        risk: "medium",
        requiresConfirmation: !value,
      },
      confidence: 0.92,
    };
  }

  // 9. Submit queries
  if (matchesAnyPrefixOrKeyword(lower, SUBMIT_KEYWORDS)) {
    const submitMatch = lower.match(/(?:submit|send)\s+(?:the\s+)?(.+)/i);
    const target = submitMatch ? submitMatch[1].trim() : "form";
    return {
      mode: "submit",
      intent: {
        action: "submit",
        target,
        risk: "medium",
        requiresConfirmation: true,
      },
      confidence: 0.92,
    };
  }

  // 10. Navigate queries
  if (matchesAnyPrefixOrKeyword(lower, NAVIGATION_KEYWORDS)) {
    const navMatch = lower.match(/(?:go to|navigate to|open|visit|load)\s+(?:the\s+)?(.+)/i);
    const target = navMatch ? navMatch[1].trim() : "";
    return {
      mode: "navigate",
      intent: {
        action: "navigate",
        target: target || "page",
        risk: "medium",
        requiresConfirmation: true,
      },
      confidence: 0.88,
    };
  }

  // 11. Ambiguous queries
  if (matchesAnyPrefixOrKeyword(lower, AMBIGUOUS_KEYWORDS)) {
    return {
      mode: "ambiguous",
      confidence: 0.4,
    };
  }

  // 12. Unsupported / Unknown
  return {
    mode: "unsupported",
    confidence: 0.2,
  };
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
      riskLevel: "low",
      requiresConfirmation: false,
    };
  }

  const { mode, intent, confidence } = extractIntentFromGoal(trimmed);
  const riskLevel = intent?.risk || (mode === "delete" ? "high" : "low");
  const requiresConfirmation = intent?.requiresConfirmation ?? (riskLevel === "high");

  switch (mode) {
    case "information":
      return {
        mode: "information",
        confidence,
        interpretation: "User is asking for information or capabilities. 0 browser actions required.",
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "low",
        requiresConfirmation: false,
      };

    case "delete":
      return {
        mode: "delete",
        confidence,
        interpretation: `User requested destructive action: delete ${intent?.target || "account"}. Explicit user confirmation is strictly required.`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "high",
        requiresConfirmation: true,
      };

    case "scroll":
      return {
        mode: "scroll",
        confidence,
        interpretation: `User requested scrolling ${intent?.target || "down"}.`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "low",
        requiresConfirmation: false,
      };

    case "search":
      return {
        mode: "search",
        confidence,
        interpretation: `User requested search for: "${intent?.value || intent?.target}".`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "low",
        requiresConfirmation: false,
      };

    case "highlight":
      return {
        mode: "highlight",
        confidence,
        interpretation: `User requested highlighting element: "${intent?.target}".`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "low",
        requiresConfirmation: false,
      };

    case "find":
      return {
        mode: "find",
        confidence,
        interpretation: `User requested locating element: "${intent?.target}". Element will be highlighted without modification.`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "low",
        requiresConfirmation: false,
      };

    case "click":
      return {
        mode: "click",
        confidence,
        interpretation: `User requested clicking element: "${intent?.target}".`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "medium",
        requiresConfirmation: false,
      };

    case "fill":
      return {
        mode: "fill",
        confidence,
        interpretation: intent?.value
          ? `User requested filling "${intent.target}" with provided value.`
          : `User requested filling "${intent?.target || "field"}" (value not provided, confirmation required).`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "medium",
        requiresConfirmation,
      };

    case "submit":
      return {
        mode: "submit",
        confidence,
        interpretation: `User requested submitting "${intent?.target || "form"}".`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "medium",
        requiresConfirmation: true,
      };

    case "navigate":
      return {
        mode: "navigate",
        confidence,
        interpretation: `User requested navigating to: "${intent?.target}".`,
        extractedIntent: intent,
        requiresClarification: false,
        riskLevel: "medium",
        requiresConfirmation: true,
      };

    case "ambiguous":
      return {
        mode: "ambiguous",
        confidence: 0.4,
        interpretation: "The user request is ambiguous. 0 actions will be performed until clarification is provided.",
        requiresClarification: true,
        clarificationQuestion: "Please clarify what specific action you would like me to take.",
        riskLevel: "low",
        requiresConfirmation: false,
      };

    case "unsupported":
    default: {
      if (pageMap && pageMap.elements.length > 0) {
        const availableSafe = pageMap.elements
          .filter((el) => el.visible && el.enabled && !el.sensitive)
          .map((el) => el.label)
          .filter(Boolean)
          .slice(0, 5)
          .join(", ");
        return {
          mode: "unsupported",
          confidence: 0.2,
          interpretation: `Unsupported or unknown request: "${trimmed}".`,
          requiresClarification: true,
          clarificationQuestion: availableSafe
            ? `I don't understand "${trimmed}". Try asking to find, click, or fill elements like: ${availableSafe}.`
            : `I don't understand "${trimmed}". Try asking me to find, click, fill, search, or scroll.`,
          riskLevel: "low",
          requiresConfirmation: false,
        };
      }
      return {
        mode: "unsupported",
        confidence: 0.2,
        interpretation: `Unsupported or unknown request: "${trimmed}".`,
        requiresClarification: true,
        clarificationQuestion: "Please specify an action (e.g. 'find the submit button', 'click Submit Request', 'fill my name as John').",
        riskLevel: "low",
        requiresConfirmation: false,
      };
    }
  }
}

export function isInformationalMode(mode: GoalMode): boolean {
  return mode === "information" || mode === "informational";
}

export function requiresBrowserAction(mode: GoalMode): boolean {
  return ["find", "highlight", "fill", "click", "select", "type", "search", "navigate", "navigation_task", "submit", "delete", "browser_action", "form_task"].includes(mode);
}

export function shouldExecuteActions(classification: GoalClassification): boolean {
  if (classification.requiresClarification) return false;
  if (isInformationalMode(classification.mode)) return false;
  if (classification.mode === "ambiguous" || classification.mode === "unsupported") return false;
  return true;
}