import { ServerAction, SanitizedElement, GoalClassification } from "@privatesight/shared";

export interface ValidationResult {
  valid: boolean;
  reason: string;
  action: ServerAction;
}

export interface ActionValidationContext {
  userGoal: string;
  classification: GoalClassification;
  pageElements: SanitizedElement[];
  previousActions: ServerAction[];
  stepNumber: number;
}

function extractNonStopWords(text: string): string[] {
  const stopWords = new Set(["the", "a", "an", "and", "or", "for", "to", "in", "on", "at", "with", "by", "of", "my", "your", "button", "field", "input", "box", "bar", "link", "form"]);
  return text
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

export function findMatchingPageElement(
  target: ServerAction["target"] | undefined | null,
  pageElements: SanitizedElement[]
): SanitizedElement | undefined {
  if (!target) return undefined;

  console.log(`[MATCH] Searching for target: ${JSON.stringify(target)} in ${pageElements.length} elements`);

  // 1. Stable observation element ID (matching el.id directly)
  if (target.elementId) {
    const byObsId = pageElements.find((el) => {
      console.log(`[MATCH] Checking el.id ${el.id} against ${target.elementId}`);
      return el.id === target.elementId;
    });
    if (byObsId) return byObsId;
  }

  // 2. DOM id attribute (matching el.elementId)
  if (target.elementId) {
    const byDomId = pageElements.find(
      (el) => el.elementId && el.elementId.toLowerCase() === target.elementId!.toLowerCase()
    );
    if (byDomId) return byDomId;
  }

  // 3. CSS Selector (matching el.selector)
  if (target.selector) {
    const bySel = pageElements.find((el) => el.selector && el.selector === target.selector);
    if (bySel) return bySel;
  }

  // 4. aria-label
  const searchLabel = (target.label || target.text || "").trim().toLowerCase();
  if (searchLabel) {
    const byAria = pageElements.find((el) => el.ariaLabel && el.ariaLabel.toLowerCase() === searchLabel);
    if (byAria) return byAria;
  }

  // 5. Associated label / element label
  if (searchLabel) {
    const byExactLabel = pageElements.find((el) => el.label && el.label.toLowerCase() === searchLabel);
    if (byExactLabel) return byExactLabel;
  }

  // 6. Text content or button value
  if (searchLabel) {
    const byText = pageElements.find((el) => {
      const text = (el.textContent || el.label || "").toLowerCase();
      return text === searchLabel || text.includes(searchLabel) || searchLabel.includes(text);
    });
    if (byText) return byText;
  }

  // 7. Placeholder
  if (searchLabel) {
    const byPlaceholder = pageElements.find((el) => el.placeholder && el.placeholder.toLowerCase() === searchLabel);
    if (byPlaceholder) return byPlaceholder;
  }

  // 8. Name attribute
  if (searchLabel || target.elementId) {
    const nameTarget = (searchLabel || target.elementId!).toLowerCase();
    const byName = pageElements.find((el) => el.name && el.name.toLowerCase() === nameTarget);
    if (byName) return byName;
  }

  // 9. Role + text
  if (searchLabel) {
    const byRoleText = pageElements.find((el) => {
      const combined = `${el.role} ${el.label} ${el.textContent || ""}`.toLowerCase();
      return combined.includes(searchLabel);
    });
    if (byRoleText) return byRoleText;
  }

  // 10. Bounding-box overlap
  if (target.bounds && typeof target.bounds.x === "number") {
    const bounds = target.bounds;
    const byBounds = pageElements.find((el) => {
      if (!el.bounds) return false;
      return (
        el.bounds.x < (bounds.x ?? 0) + (bounds.width ?? 0) &&
        (el.bounds.x ?? 0) + (el.bounds.width ?? 0) > (bounds.x ?? 0) &&
        el.bounds.y < (bounds.y ?? 0) + (bounds.height ?? 0) &&
        (el.bounds.y ?? 0) + (el.bounds.height ?? 0) > (bounds.y ?? 0)
      );
    });
    if (byBounds) return byBounds;
  }

  return undefined;
}

function isActionRelevantToGoal(action: ServerAction, classification: GoalClassification, pageElements: SanitizedElement[]): boolean {
  if (!classification.extractedIntent) {
    if (classification.mode === "information" || classification.mode === "informational" || classification.mode === "ambiguous" || classification.mode === "unsupported") {
      return false;
    }
    return true;
  }

  if (action.type === "scroll" || action.type === "wait") {
    return true;
  }

  const intent = classification.extractedIntent;
  const targetElement = findMatchingPageElement(action.target, pageElements);

  if (!targetElement) return false;

  const targetLabel = (targetElement.label || "").toLowerCase();
  const targetName = (targetElement.name || "").toLowerCase();
  const targetId = (targetElement.elementId || "").toLowerCase();
  const targetAria = (targetElement.ariaLabel || "").toLowerCase();
  const targetPlaceholder = (targetElement.placeholder || "").toLowerCase();
  const fullTargetContext = `${targetLabel} ${targetName} ${targetId} ${targetAria} ${targetPlaceholder}`.toLowerCase();
  const collapsedContext = fullTargetContext.replace(/[\s_-]+/g, "");

  const intentTarget = intent.target?.toLowerCase() || "";
  const intentAction = intent.action?.toLowerCase() || "";
  const isGenericSemanticTarget =
    intentTarget.includes("most important") ||
    intentTarget.includes("main element") ||
    intentTarget.includes("primary element") ||
    intentTarget.includes("key element") ||
    intentTarget === "element" ||
    intentTarget === "button" ||
    intentTarget.includes("important element");

  const targetKeywords = extractNonStopWords(intentTarget);

  const matchesTarget =
    isGenericSemanticTarget ||
    targetKeywords.length === 0 ||
    targetKeywords.some((kw) => fullTargetContext.includes(kw) || collapsedContext.includes(kw.replace(/[\s_-]+/g, "")));

  if (intentAction === "click" || intentAction === "press" || intentAction === "tap" || intentAction === "select") {
    if (action.type !== "click" && action.type !== "focus" && action.type !== "highlight") {
      return false;
    }
    return matchesTarget || intentTarget === "it" || intentTarget === "element";
  }

  if (intentAction === "find" || intentAction === "locate" || intentAction === "identify" || intentAction === "show me" || intentAction === "highlight") {
    if (action.type !== "highlight" && action.type !== "focus") {
      return false;
    }
    return matchesTarget;
  }

  if (intentAction === "search") {
    if (action.type !== "type" && action.type !== "focus" && action.type !== "highlight") {
      return false;
    }
    return targetElement.role === "searchbox" || fullTargetContext.includes("search");
  }

  if (intentAction === "fill" || intentAction === "enter" || intentAction === "type" || intentAction === "input") {
    if (action.type !== "type" && action.type !== "fill_private" && action.type !== "focus" && action.type !== "highlight") {
      return false;
    }
    const isFormLevelFill = intentTarget === "form" || intentTarget === "out the form" || intentTarget.includes("form") || intentTarget.includes("details");
    return matchesTarget || isFormLevelFill;
  }

  if (intentAction === "delete") {
    if (action.type !== "click" && action.type !== "highlight" && action.type !== "focus") {
      return false;
    }
    return fullTargetContext.includes("delete") || fullTargetContext.includes("remove");
  }

  if (intentAction === "navigate") {
    if (action.type !== "click" && action.type !== "highlight" && action.type !== "focus") {
      return false;
    }
    return matchesTarget;
  }

  if (intentAction === "submit") {
    if (action.type !== "click" && action.type !== "highlight" && action.type !== "focus") {
      return false;
    }
    return fullTargetContext.includes("submit") || fullTargetContext.includes("send") || fullTargetContext.includes("confirm");
  }

  return true;
}

function isDestructiveAction(action: ServerAction, targetElement: SanitizedElement): boolean {
  if (action.type !== "click") return false;

  const destructiveRoles = ["button", "link"];
  const destructiveLabels = ["delete", "remove", "purchase", "buy", "pay", "transfer", "erase", "close account", "destroy"];

  const label = (targetElement.label || "").toLowerCase();
  if (destructiveRoles.includes(targetElement.role) && destructiveLabels.some((l) => label.includes(l))) {
    return true;
  }

  return false;
}

function isFormLevelFillGoal(classification: GoalClassification): boolean {
  const target = (classification.extractedIntent?.target || "").toLowerCase();
  return target === "form" || target === "out the form" || target.includes("form") || target.includes("details");
}

export function validateActionAgainstGoal(
  action: ServerAction,
  context: ActionValidationContext
): ValidationResult {
  const { userGoal, classification, pageElements, previousActions, stepNumber } = context;

  if (stepNumber > 50) {
    return {
      valid: false,
      reason: "Maximum step count (50) exceeded. Stopping to prevent infinite loop.",
      action,
    };
  }

  if (classification.mode === "informational" || classification.mode === "ambiguous" || classification.mode === "unsupported") {
    return {
      valid: false,
      reason: `Goal mode "${classification.mode}" does not require browser actions.`,
      action,
    };
  }

  if (action.target) {
    const targetElement = findMatchingPageElement(action.target, pageElements);
    if (!targetElement && action.type !== "scroll" && action.type !== "wait") {
      return {
        valid: false,
        reason: `Target element ${action.target.elementId || action.target.selector || action.target.label || "unknown"} not found in current page observation.`,
        action,
      };
    }

    if (targetElement) {
      const isWholeForm = isFormLevelFillGoal(classification);
      const isPasswordField = targetElement.inputType === "password" || (targetElement.label || "").toLowerCase().includes("password");

      if (targetElement.sensitive) {
        if (action.type === "fill_private" || action.type === "highlight") {
          // Allowed
        } else if (isWholeForm && action.type === "type" && !isPasswordField) {
          // Allowed for filling full form
        } else {
          return {
            valid: false,
            reason: "Action targets a sensitive/redacted element.",
            action,
          };
        }
      }

      if (!targetElement.visible || !targetElement.enabled) {
        return {
          valid: false,
          reason: "Target element is not visible or enabled.",
          action,
        };
      }

      if (isDestructiveAction(action, targetElement) && !classification.extractedIntent?.action?.match(/click|submit|delete|remove|destroy|erase|close/)) {
        return {
          valid: false,
          reason: `Action targets potentially destructive element "${targetElement.label}" but goal doesn't explicitly request it.`,
          action,
        };
      }
    }
  } else if (action.type !== "scroll" && action.type !== "wait") {
    return {
      valid: false,
      reason: "Action missing valid target.",
      action,
    };
  }

  if (!isActionRelevantToGoal(action, classification, pageElements)) {
    return {
      valid: false,
      reason: `Action "${action.type}" on "${action.target?.elementId || "unknown"}" is not relevant to the user's goal: "${userGoal}".`,
      action,
    };
  }

  const duplicateAction = previousActions.find(
    (prev) => prev.type === action.type && prev.target?.elementId === action.target?.elementId
  );
  if (duplicateAction) {
    return {
      valid: false,
      reason: "Duplicate action detected - same action on same element already attempted.",
      action,
    };
  }

  return {
    valid: true,
    reason: "Action validated successfully.",
    action,
  };
}

export function validatePlanActions(
  planActions: ServerAction[],
  context: ActionValidationContext
): ValidationResult[] {
  return planActions.map((action, index) =>
    validateActionAgainstGoal(action, { ...context, stepNumber: context.stepNumber + index })
  );
}