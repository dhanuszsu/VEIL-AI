const ACTION_POLICY = {
    highlight: "auto",
    scroll: "auto",
    focus: "auto",
    wait: "auto",
    type: "auto",
    click: "confirm",
    fill_private: "confirm",
};
const HIGH_CONFIDENCE_AUTO_ACTIONS = ["highlight", "scroll", "focus", "wait", "type"];
const CONFIRMATION_REQUIRED_ACTIONS = ["click", "fill_private"];
function isHighConfidenceAuto(type) {
    return HIGH_CONFIDENCE_AUTO_ACTIONS.includes(type);
}
function isConfirmationRequired(type) {
    return CONFIRMATION_REQUIRED_ACTIONS.includes(type);
}
function getBasePolicy(type) {
    return ACTION_POLICY[type] ?? "confirm";
}
function isSameOrigin(url1, url2) {
    try {
        return new URL(url1).origin === new URL(url2).origin;
    }
    catch {
        return false;
    }
}
function getPageOrigin(pageOrigin) {
    if (pageOrigin)
        return pageOrigin;
    if (typeof window !== "undefined")
        return window.location.origin;
    if (typeof self !== "undefined")
        return self.location.origin;
    return "http://localhost";
}
import { findMatchingPageElement } from "../planner/actionValidator";
export function validateAction(action, pageMapElements, pageOrigin) {
    const basePolicy = getBasePolicy(action.type);
    let policy = basePolicy;
    let reason = "";
    let mappedElement = undefined;
    if (action.target) {
        mappedElement = findMatchingPageElement(action.target, pageMapElements);
        if (!mappedElement && action.type !== "scroll" && action.type !== "wait") {
            return { action, policy: "reject", reason: "Target element not found in current page map", mappedElement: undefined };
        }
        if (mappedElement) {
            if (mappedElement.sensitive && action.type === "fill_private" && !mappedElement.sensitive) {
                // fill_private must only target sensitive fields (handled below)
            }
            // Only block: fill_private on non-sensitive fields, or non-fill actions on password fields
            const isPasswordField = (mappedElement.inputType === "password") ||
                (mappedElement.label || "").toLowerCase().includes("password");
            if (mappedElement.sensitive && action.type !== "fill_private" && action.type !== "type" && action.type !== "highlight") {
                return { action, policy: "reject", reason: "Action targets a sensitive/redacted element", mappedElement };
            }
            if (isPasswordField && action.type === "type") {
                return { action, policy: "reject", reason: "Action targets a sensitive password field (use fill_private)", mappedElement };
            }
            if (!mappedElement.visible || !mappedElement.enabled) {
                return { action, policy: "reject", reason: "Target element is not visible or enabled", mappedElement };
            }
        }
    }
    else if (action.type !== "scroll" && action.type !== "wait") {
        return { action, policy: "reject", reason: "Action missing valid target", mappedElement: undefined };
    }
    if (action.risk === "high") {
        policy = "confirm";
        reason = "High-risk action requires explicit user confirmation";
    }
    if (action.type === "click" && mappedElement) {
        const destructiveRoles = ["button", "link"];
        const destructiveLabels = ["delete", "remove", "purchase", "buy", "pay", "transfer", "erase", "close account", "destroy", "wipe"];
        if (destructiveRoles.includes(mappedElement.role) && destructiveLabels.some((l) => mappedElement.label.toLowerCase().includes(l))) {
            policy = "confirm";
            reason = "Potentially destructive action requires confirmation";
        }
    }
    const confidence = action.confidence ?? 0;
    if (confidence < 0.85 && policy !== "reject") {
        policy = "confirm";
        reason = `Low confidence (${Math.round(confidence * 100)}%) requires confirmation`;
    }
    if (action.type === "click" && mappedElement?.role === "link") {
        const href = mappedElement.href;
        const origin = getPageOrigin(pageOrigin);
        if (href && !isSameOrigin(href, origin)) {
            policy = "confirm";
            reason = "Cross-origin navigation requires confirmation";
        }
    }
    return { action, policy, reason, mappedElement };
}
export { ACTION_POLICY, HIGH_CONFIDENCE_AUTO_ACTIONS, CONFIRMATION_REQUIRED_ACTIONS };
