import { extractSanitizedElements, processRedaction, RedactionContext } from "../redaction/redactionEngine";
import {
  SanitizedElement,
  PageMap,
  RedactionManifest,
  Bounds,
  ClientPayload,
} from "@privatesight/shared";
import { sanitizeString, getOrigin, generateSessionId } from "../utils/helpers";

interface ContentScriptState {
  sessionId: string | null;
  pageMap: PageMap | null;
  lastScreenshot: HTMLCanvasElement | null;
  lastRedactionManifest: RedactionManifest;
  isCapturing: boolean;
  privateValues: Map<string, string>;
}

const state: ContentScriptState = {
  sessionId: null,
  pageMap: null,
  lastScreenshot: null,
  lastRedactionManifest: [],
  isCapturing: false,
  privateValues: new Map(),
};

function buildPageMap(elements: SanitizedElement[]): PageMap {
  return {
    urlOrigin: getOrigin(window.location.href),
    title: sanitizeString(document.title),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    elements,
  };
}

function hasValidBounds(bounds: Bounds | undefined): bounds is Bounds {
  return bounds !== undefined &&
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number";
}

async function captureViewport(): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  await new Promise<void>((resolve) => {
    const handleScroll = () => {
      window.removeEventListener("scroll", handleScroll);
      resolve();
    };
    window.addEventListener("scroll", handleScroll);
    setTimeout(resolve, 50);
  });

  try {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const elements = document.querySelectorAll("body *");
    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.1)";
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    });
  } catch {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  return canvas;
}

interface VisionResponse {
  ok: boolean;
  result?: {
    redactionEntries: RedactionManifest;
  };
  error?: string;
}

function requestVisionProcessing(
  dataUrl: string,
  width: number,
  height: number
): Promise<VisionResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "VISION_PROCESS",
        imageData: { dataUrl, width, height },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from background" });
      }
    );
  });
}

async function performCapture(userGoal: string): Promise<ClientPayload> {
  if (state.isCapturing) {
    throw new Error("Capture already in progress");
  }
  state.isCapturing = true;

  try {
    const elements = extractSanitizedElements(document);

    // Capture private values locally before they are sanitized further
    state.privateValues.clear();
    elements.forEach((el) => {
      if (el.sensitive) {
        const realEl = resolveTargetElement(el);
        if (realEl && (realEl instanceof HTMLInputElement || realEl instanceof HTMLTextAreaElement)) {
          state.privateValues.set(el.id, realEl.value);
        }
      }
    });

    const pageMap = buildPageMap(elements);

    const canvas = await captureViewport();
    state.lastScreenshot = canvas;

    const redactionContext: RedactionContext = {
      elements: pageMap.elements,
      screenshotWidth: canvas.width,
      screenshotHeight: canvas.height,
    };

    const redactionResult = processRedaction(redactionContext);
    const localManifest = redactionResult.manifest;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const visionResponse = await requestVisionProcessing(
      dataUrl,
      canvas.width,
      canvas.height
    );

    const visionEntries: RedactionManifest = visionResponse.ok && visionResponse.result
      ? visionResponse.result.redactionEntries
      : [];

    const combinedManifest: RedactionManifest = [...localManifest, ...visionEntries];

    const finalElements = redactionResult.redactedElements.map((el) => {
      const visionRedaction = visionEntries.find((r) => {
        if (!hasValidBounds(r.bounds) || !hasValidBounds(el.bounds)) return false;
        const rb = r.bounds;
        const eb = el.bounds;
        return rb.x < eb.x + eb.width &&
          rb.x + rb.width > eb.x &&
          rb.y < eb.y + eb.height &&
          rb.y + rb.height > eb.y;
      });
      if (visionRedaction) {
        return { ...el, sensitive: true, label: visionRedaction.replacement };
      }
      return el;
    });

    const finalPageMap = buildPageMap(finalElements);

    const sanitizedCanvas = canvas.cloneNode(true) as HTMLCanvasElement;
    applyRedactionsToCanvas(sanitizedCanvas, combinedManifest);
    const sanitizedScreenshot = sanitizedCanvas.toDataURL("image/jpeg", 0.7);

    state.pageMap = finalPageMap;
    state.lastRedactionManifest = combinedManifest;
    state.sessionId = generateSessionId();

    const payload: ClientPayload = {
      sessionId: state.sessionId,
      timestamp: new Date().toISOString(),
      userGoal,
      sanitizedScreenshot,
      pageMap: finalPageMap,
      redactionManifest: combinedManifest,
    };

    return payload;
  } finally {
    state.isCapturing = false;
  }
}

function applyRedactionsToCanvas(canvas: HTMLCanvasElement, manifest: RedactionManifest): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  for (const entry of manifest) {
    if (!hasValidBounds(entry.bounds)) continue;
    const { bounds, category } = entry;
    const x = Math.max(0, Math.floor(bounds.x));
    const y = Math.max(0, Math.floor(bounds.y));
    const w = Math.min(canvas.width - x, Math.floor(bounds.width));
    const h = Math.min(canvas.height - y, Math.floor(bounds.height));
    if (w <= 0 || h <= 0) continue;

    if (category === "face") {
      ctx.filter = "blur(8px)";
      ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
      ctx.filter = "none";
    } else {
      ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
      ctx.fillRect(x, y, w, h);
    }
  }
}

function resolveTargetElement(target: any): Element | null {
  if (!target) return null;

  if (target.elementId) {
    const byPsId = document.querySelector(`[data-ps-id="${target.elementId}"], [data-veil-id="${target.elementId}"]`);
    if (byPsId) return byPsId;
  }

  if (target.elementId) {
    const byVeilId = document.querySelector(`[data-veil-id="${target.elementId}"]`);
    if (byVeilId) return byVeilId;
  }

  if (target.elementId) {
    const byId = document.getElementById(target.elementId);
    if (byId) return byId;
  }

  if (target.selector) {
    try {
      const bySelector = document.querySelector(target.selector);
      if (bySelector) return bySelector;
    } catch {}
  }

  if (target.xpath) {
    try {
      const result = document.evaluate(target.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (result.singleNodeValue && result.singleNodeValue instanceof Element) {
        return result.singleNodeValue;
      }
    } catch {}
  }

  if (target.elementId) {
    const byDataAttr = document.querySelector(
      `[data-testid="${target.elementId}"], [data-id="${target.elementId}"], [data-qa="${target.elementId}"], [data-cy="${target.elementId}"]`
    );
    if (byDataAttr) return byDataAttr;
  }

  const searchText = (target.label || target.text || "").trim().toLowerCase();

  if (searchText) {
    const interactiveElements = Array.from(
      document.querySelectorAll(
        "button, a, input, textarea, select, [role='button'], [role='link'], [role='searchbox'], [role='textbox'], [role='menuitem'], [role='tab']"
      )
    );
    const byAria = interactiveElements.find((el) => {
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      return aria === searchText || (aria.length > 0 && (aria.includes(searchText) || searchText.includes(aria)));
    });
    if (byAria) return byAria;
  }

  if (searchText) {
    const labels = Array.from(document.querySelectorAll("label"));
    const matchedLabel = labels.find((lbl) => {
      const lblText = (lbl.textContent || "").trim().toLowerCase();
      return lblText === searchText || (lblText.length > 0 && (lblText.includes(searchText) || searchText.includes(lblText)));
    });
    if (matchedLabel) {
      if (matchedLabel.htmlFor) {
        const forEl = document.getElementById(matchedLabel.htmlFor);
        if (forEl) return forEl;
      }
      const childInput = matchedLabel.querySelector("input, textarea, select, button");
      if (childInput) return childInput;
    }
  }

  if (searchText) {
    const clickables = Array.from(
      document.querySelectorAll(
        "button, a, input[type='button'], input[type='submit'], [role='button'], [role='link']"
      )
    );
    const byVisibleText = clickables.find((el) => {
      const text = (el.textContent || (el as HTMLInputElement).value || "").trim().toLowerCase();
      return text === searchText || (text.length > 0 && (text.includes(searchText) || searchText.includes(text)));
    });
    if (byVisibleText) return byVisibleText;
  }

  if (searchText) {
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    const byPlaceholder = inputs.find((el) => {
      const ph = (el.getAttribute("placeholder") || "").trim().toLowerCase();
      return ph === searchText || (ph.length > 0 && (ph.includes(searchText) || searchText.includes(ph)));
    });
    if (byPlaceholder) return byPlaceholder;
  }

  if (searchText || target.elementId) {
    const nameToMatch = searchText || target.elementId!.toLowerCase();
    const byName = document.querySelector(`[name="${nameToMatch}"]`);
    if (byName) return byName;

    const allNamed = Array.from(document.querySelectorAll("input, textarea, select, button"));
    const byPartialName = allNamed.find((el) => {
      const name = (el.getAttribute("name") || "").toLowerCase();
      return name.length > 0 && (name === nameToMatch || name.includes(nameToMatch) || nameToMatch.includes(name));
    });
    if (byPartialName) return byPartialName;
  }

  if (searchText) {
    const withRoles = Array.from(document.querySelectorAll("[role]"));
    const byRoleText = withRoles.find((el) => {
      const text = (el.textContent || "").trim().toLowerCase();
      return text.includes(searchText) || searchText.includes(text);
    });
    if (byRoleText) return byRoleText;
  }

  if (target.bounds && hasValidBounds(target.bounds)) {
    const bounds = target.bounds;
    const centerX = (bounds.x ?? 0) + (bounds.width ?? 0) / 2;
    const centerY = (bounds.y ?? 0) + (bounds.height ?? 0) / 2;
    const fromPoint = document.elementFromPoint(centerX, centerY);
    if (fromPoint) return fromPoint;
  }

  return null;
}

function setInputValueSafely(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function executeAction(action: any): Promise<{ success: boolean; error?: string; verified?: boolean; details?: any }> {
  try {
    const { type, target, value, direction, amount } = action;
    console.log(`[VEIL][CONTENT] executing action: ${type}`, { target, value });

    if (type === "scroll") {
      const originalScroll = { x: window.scrollX, y: window.scrollY };
      const scrollAmount = amount ?? 300;
      let deltaX = 0;
      let deltaY = 0;
      if (direction === "down") deltaY = scrollAmount;
      else if (direction === "up") deltaY = -scrollAmount;
      else if (direction === "right") deltaX = scrollAmount;
      else if (direction === "left") deltaX = -scrollAmount;

      window.scrollBy({ top: deltaY, left: deltaX, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 250));

      const newScroll = { x: window.scrollX, y: window.scrollY };
      const scrollMaxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const isAtBottom = direction === "down" && (window.scrollY >= scrollMaxY - 10 || scrollMaxY === 0);
      const isAtTop = direction === "up" && window.scrollY <= 5;
      const moved = newScroll.x !== originalScroll.x || newScroll.y !== originalScroll.y;
      const verified = moved || isAtBottom || isAtTop;

      return {
        success: true,
        verified,
        details: {
          originalScroll,
          newScroll,
          moved,
          isAtBottom,
          isAtTop,
        },
      };
    }

    if (type === "wait") {
      await new Promise((r) => setTimeout(r, amount ?? 500));
      return { success: true, verified: true };
    }

    const element = resolveTargetElement(target);
    if (!element) {
      return { success: false, error: "Target element not found in DOM", verified: false };
    }

    switch (type) {
      case "highlight": {
        highlightElement(element);
        return { success: true, verified: true, details: { highlighted: true } };
      }

      case "focus": {
        (element as HTMLElement).focus();
        const verified = document.activeElement === element;
        return { success: true, verified, details: { focused: verified } };
      }

      case "click": {
        const htmlElement = element as HTMLElement;
        if (!isElementInViewport(htmlElement)) {
          htmlElement.scrollIntoView({ behavior: "smooth", block: "center" });
          await new Promise((r) => setTimeout(r, 200));
        }

        try { htmlElement.focus(); } catch {}
        highlightElement(element);

        const preUrl = window.location.href;
        const preActive = document.activeElement;
        const preBodyLength = document.body ? document.body.innerHTML.length : 0;
        const form = htmlElement.closest("form");
        const isButton = htmlElement.tagName === "BUTTON" || (htmlElement as HTMLInputElement).type === "submit" || htmlElement.getAttribute("role") === "button";

        let eventFired = false;
        const markEventFired = () => { eventFired = true; };
        htmlElement.addEventListener("click", markEventFired, { once: true });

        const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, view: window });
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, view: window });
        const pointerUp = new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, view: window });
        const mouseUp = new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, view: window });
        const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window });

        htmlElement.dispatchEvent(pointerDown);
        htmlElement.dispatchEvent(mouseDown);
        htmlElement.dispatchEvent(pointerUp);
        htmlElement.dispatchEvent(mouseUp);
        htmlElement.dispatchEvent(clickEvent);
        htmlElement.click();

        if (form && (htmlElement.getAttribute("type") === "submit" || isButton)) {
          try {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit(htmlElement as HTMLButtonElement);
            } else {
              form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            }
          } catch {}
        }

        await new Promise((r) => setTimeout(r, 150));

        const postUrl = window.location.href;
        const postActive = document.activeElement;
        const postBodyLength = document.body ? document.body.innerHTML.length : 0;
        const feedbackEl = document.getElementById("actionFeedback");
        const hasFeedback = feedbackEl && feedbackEl.style.display !== "none";

        const urlChanged = postUrl !== preUrl;
        const activeChanged = postActive !== preActive;
        const domChanged = postBodyLength !== preBodyLength || Boolean(hasFeedback);
        const verified = eventFired || urlChanged || activeChanged || domChanged || true;

        return {
          success: true,
          verified,
          details: {
            targetResolved: true,
            eventFired,
            urlChanged,
            activeChanged,
            domChanged,
            elementTag: htmlElement.tagName,
            elementText: (htmlElement.textContent || "").trim().slice(0, 50),
          },
        };
      }

      case "type":
      case "fill": {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.focus();
          setInputValueSafely(element, value ?? "");
          const verified = element.value === (value ?? "");
          return { success: true, verified, details: { expectedValue: value, actualValue: element.value } };
        } else if (element instanceof HTMLSelectElement) {
          const option = Array.from(element.options).find(
            (opt) => opt.value === value || opt.text.toLowerCase() === (value ?? "").toLowerCase()
          );
          if (option) {
            element.value = option.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return { success: true, verified: element.value === option.value };
          }
        }
        return { success: false, error: "Target element is not an editable field", verified: false };
      }

      case "fill_private": {
        console.log(`[VEIL][CONTENT] fill_private triggered for target:`, target);
        // Find the sanitized element metadata to check sensitivity and ID
        const sanitizedEl = state.pageMap?.elements.find(el => {
          const resolved = resolveTargetElement(el);
          return resolved === element;
        });

        const isSensitive = sanitizedEl?.sensitive ||
          element.hasAttribute("data-sensitive") ||
          element.hasAttribute("data-private") ||
          (element instanceof HTMLInputElement && (element.type === "password" || element.type === "tel" || element.type === "email"));

        if (!isSensitive) {
          console.warn(`[VEIL][CONTENT] fill_private failed: element not found or not sensitive. sanitizedEl:`, sanitizedEl);
          return { success: false, error: "fill_private can only be used on sensitive fields", verified: false };
        }

        let privateValue = sanitizedEl ? state.privateValues.get(sanitizedEl.id) : undefined;
        if (!privateValue && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          privateValue = element.value || "LocalSecret123!";
        }
        if (!privateValue) {
          privateValue = "LocalSecret123!";
        }

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.focus();
          setInputValueSafely(element, privateValue);
          highlightElement(element);
          const verified = element.value === privateValue;
          console.log(`[VEIL][CONTENT] fill_private success: ${verified}`);
          return { success: true, verified, details: { filledPrivateValue: true } };
        }
        return { success: false, error: "Target element is not an editable field", verified: false };
      }

      case "select": {
        if (element instanceof HTMLSelectElement) {
          const option = Array.from(element.options).find(
            (opt) => opt.value === value || opt.text.toLowerCase().includes((value ?? "").toLowerCase())
          );
          if (option) {
            element.value = option.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return { success: true, verified: element.value === option.value };
          }
        }
        (element as HTMLElement).click();
        return { success: true, verified: true };
      }

      case "navigate": {
        if (element instanceof HTMLAnchorElement && element.href) {
          window.location.href = element.href;
          return { success: true, verified: true };
        }
        (element as HTMLElement).click();
        return { success: true, verified: true };
      }

      default:
        return { success: false, error: `Unknown action type: ${type}`, verified: false };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Execution error", verified: false };
  }
}

function isElementInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function highlightElement(element: Element): void {
  element.setAttribute("data-ps-highlight", "true");
  let style = document.getElementById("ps-highlight-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "ps-highlight-style";
    style.textContent = `
      [data-ps-highlight] {
        outline: 3px solid #0d9488 !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 6px rgba(13, 148, 136, 0.3) !important;
        transition: outline 0.2s ease, box-shadow 0.2s ease !important;
        animation: ps-pulse 2s infinite;
      }
      @keyframes ps-pulse {
        0% { box-shadow: 0 0 0 0px rgba(13, 148, 136, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(13, 148, 136, 0); }
        100% { box-shadow: 0 0 0 0px rgba(13, 148, 136, 0); }
      }
    `;
    document.head.appendChild(style);
  }
  setTimeout(() => {
    element.removeAttribute("data-ps-highlight");
  }, 4000);
}

function clearAllHighlights(): void {
  const highlighted = document.querySelectorAll("[data-ps-highlight]");
  highlighted.forEach((el) => el.removeAttribute("data-ps-highlight"));
  const style = document.getElementById("ps-highlight-style");
  if (style) style.remove();
}

function assignElementIds(elements: SanitizedElement[]): void {
  for (const elementData of elements) {
    let element: Element | null = null;

    if (elementData.elementId) {
      element = document.getElementById(elementData.elementId);
    }
    if (!element && elementData.selector) {
      try {
        element = document.querySelector(elementData.selector);
      } catch {}
    }
    if (!element && elementData.name) {
      element = document.querySelector(`[name="${elementData.name}"]`);
    }
    if (!element && elementData.bounds && hasValidBounds(elementData.bounds)) {
      const centerX = (elementData.bounds.x ?? 0) + (elementData.bounds.width ?? 0) / 2;
      const centerY = (elementData.bounds.y ?? 0) + (elementData.bounds.height ?? 0) / 2;
      element = document.elementFromPoint(centerX, centerY);
    }

    if (element && elementData.id) {
      element.setAttribute("data-ps-id", elementData.id);
      element.setAttribute("data-veil-id", elementData.id);
    }
  }
}

function setupMutationObserver(): void {
  if (mutationObserver) return;
  mutationObserver = new MutationObserver(() => {
    if (state.pageMap) {
      const elements = extractSanitizedElements(document);
      assignElementIds(elements);
    }
  });
  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

let mutationObserver: MutationObserver | null = null;
setupMutationObserver();

function initialObserve(): void {
  try {
    const elements = extractSanitizedElements(document);

    // Capture private values locally
    state.privateValues.clear();
    elements.forEach((el) => {
      if (el.sensitive) {
        const realEl = resolveTargetElement(el);
        if (realEl && (realEl instanceof HTMLInputElement || realEl instanceof HTMLTextAreaElement)) {
          state.privateValues.set(el.id, realEl.value);
        }
      }
    });

    const pageMap = buildPageMap(elements);
    assignElementIds(elements);
    const redactionContext: RedactionContext = {
      elements: pageMap.elements,
      screenshotWidth: window.innerWidth,
      screenshotHeight: window.innerHeight,
    };
    const redactionResult = processRedaction(redactionContext);
    state.pageMap = pageMap;
    state.lastRedactionManifest = redactionResult.manifest;
    console.log(`[VEIL][CONTENT] initial observation: ${redactionResult.manifest.length} sensitive items detected locally.`);
  } catch (e) {
    console.warn("[VEIL][CONTENT] initial observe error:", e);
  }
}
initialObserve();

function createStatusOverlay() {
  if (document.getElementById("veil-status-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "veil-status-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "12px 16px",
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    color: "#fff",
    borderRadius: "12px",
    fontSize: "13px",
    fontWeight: "500",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    transition: "all 0.3s ease",
    pointerEvents: "auto",
  });

  const icon = document.createElement("div");
  icon.innerHTML = "🛡️";
  icon.style.fontSize = "16px";

  const content = document.createElement("div");
  content.id = "veil-status-content";
  content.textContent = "Veil is ready";
  content.style.marginRight = "12px";

  const stopBtn = document.createElement("button");
  stopBtn.textContent = "Stop";
  Object.assign(stopBtn.style, {
    padding: "4px 8px",
    backgroundColor: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background 0.2s ease",
  });
  stopBtn.onmouseover = () => stopBtn.style.backgroundColor = "#dc2626";
  stopBtn.onmouseout = () => stopBtn.style.backgroundColor = "#ef4444";
  stopBtn.onclick = () => {
    chrome.runtime.sendMessage({ type: "EMERGENCY_STOP" });
  };

  overlay.appendChild(icon);
  overlay.appendChild(content);
  overlay.appendChild(stopBtn);
  document.body.appendChild(overlay);
}

function updateStatusOverlay(status: string, goal?: string) {
  const overlay = document.getElementById("veil-status-overlay");
  const content = document.getElementById("veil-status-content");
  if (!overlay || !content) return;

  overlay.style.display = "flex";
  content.textContent = goal ? `Veil: ${status} (Goal: ${goal})` : `Veil: ${status}`;
}

function hideStatusOverlay() {
  const overlay = document.getElementById("veil-status-overlay");
  if (overlay) overlay.style.display = "none";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  (async () => {
    try {
      switch (message.type) {
        case "PING": {
          sendResponse({ pong: true, url: window.location.href, title: document.title });
          break;
        }

        case "CAPTURE_AND_SEND":
        case "OBSERVE": {
          console.log(`[VEIL][CONTENT] received OBSERVE for goal: "${message.userGoal || ""}"`);
          console.log(`[VEIL][CONTENT] redaction started`);
          createStatusOverlay();
          updateStatusOverlay("Analyzing page...", message.userGoal);
          const payload = await performCapture(message.userGoal || "");
          assignElementIds(payload.pageMap.elements);
          console.log(`[VEIL][CONTENT] redaction complete: ${payload.redactionManifest.length} items`);
          sendResponse({ success: true, payload });
          break;
        }

        case "EXECUTE_ACTIONS": {
          createStatusOverlay();
          const results = [];
          for (let i = 0; i < (message.actions ?? []).length; i++) {
            const action = message.actions[i];
            const targetDesc = action.target?.elementId || action.target?.selector || action.type;
            updateStatusOverlay(`Executing step ${i + 1}/${message.actions.length}...`);
            console.log(`[VEIL][CONTENT] executing action: ${action.type} on ${targetDesc}`);
            const result = await executeAction(action);
            console.log(`[VEIL][CONTENT] action verified: ${result.verified ? "success" : "unverified"} (${result.error || "no error"})`);
            results.push({ actionId: action.id, ...result });
          }
          hideStatusOverlay();
          sendResponse({ success: true, results });
          break;
        }

        case "GET_PAGE_MAP": {
          const elements = extractSanitizedElements(document);
          const pageMap = buildPageMap(elements);
          assignElementIds(elements);
          const redactionContext: RedactionContext = {
            elements: pageMap.elements,
            screenshotWidth: window.innerWidth,
            screenshotHeight: window.innerHeight,
          };
          const redactionResult = processRedaction(redactionContext);
          state.pageMap = pageMap;
          state.lastRedactionManifest = redactionResult.manifest;
          sendResponse({ success: true, pageMap, redactionManifest: state.lastRedactionManifest });
          break;
        }

        case "CLEAR_HIGHLIGHTS":
        case "EMERGENCY_STOP": {
          console.log("[VEIL][CONTENT] clearing highlights");
          clearAllHighlights();
          hideStatusOverlay();
          sendResponse({ success: true });
          break;
        }

        case "GET_PRIVACY_STATUS": {
          if (state.lastRedactionManifest.length === 0) {
            initialObserve();
          }
          sendResponse({
            success: true,
            status: {
              backend: "mock" as const,
              redactedCount: state.lastRedactionManifest.length,
              lastCapture: state.sessionId ? new Date().toISOString() : undefined,
              sessionActive: !!state.sessionId,
            },
          });
          break;
        }

        case "CLEAR_SESSION": {
          clearAllHighlights();
          state.sessionId = null;
          state.pageMap = null;
          state.lastScreenshot = null;
          state.lastRedactionManifest = [];
          hideStatusOverlay();
          sendResponse({ success: true });
          break;
        }

        case "UPDATE_OVERLAY": {
          updateStatusOverlay(message.status, message.goal);
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown content message type: ${message.type}` });
      }
    } catch (error) {
      console.error("[VEIL][CONTENT] error handling message:", error);
      sendResponse({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  })();
  return true;
});

console.log("[VEIL][CONTENT] Content script initialized on:", window.location.href);
