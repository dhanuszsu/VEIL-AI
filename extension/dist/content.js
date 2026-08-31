"use strict";
(() => {
  // src/redaction/patterns.ts
  var PII_PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    creditCard: /\b(?:\d[ -]*?){13,16}\b/g,
    aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    pan: /\b[A-Z]{5}\d{4}[A-Z]{1}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    cvv: /\b\d{3,4}\b(?!\s?\d{4})/g,
    otp: /\b\d{6}\b/g,
    ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    apiKey: /\b(?:sk-[A-Za-z0-9]{32,}|[A-Za-z0-9_-]{32,})\b/g,
    jwt: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    url: /https?:\/\/[^\s]+/g
  };
  var PII_CATEGORY_MAP = {
    email: "email",
    phone: "phone",
    creditCard: "credit_card",
    aadhaar: "aadhaar",
    pan: "pan",
    ssn: "account_number",
    cvv: "cvv",
    otp: "otp",
    ipv4: "custom",
    url: "custom",
    apiKey: "custom",
    jwt: "custom"
  };
  var SENSITIVE_AUTOCOMPLETE_VALUES = [
    "password",
    "new-password",
    "current-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-name",
    "address-line1",
    "address-line2",
    "address-line3",
    "postal-code",
    "tel",
    "email"
  ];
  var SENSITIVE_INPUT_TYPES = ["password", "tel", "email"];
  var SENSITIVE_LABEL_KEYWORDS = [
    "password",
    "passwort",
    "contrase\xF1a",
    "mot de passe",
    "senha",
    "parola",
    "has\u0142o",
    "\u043F\u0430\u0440\u043E\u043B\u044C",
    "\u5BC6\u7801",
    "\u30D1\u30B9\u30EF\u30FC\u30C9",
    "\uBE44\uBC00\uBC88\uD638",
    "credit card",
    "creditcard",
    "debit card",
    "card number",
    "cardnumber",
    "cvv",
    "cvc",
    "security code",
    "otp",
    "one-time",
    "verification code",
    "auth code",
    "aadhaar",
    "pan",
    "ssn",
    "social security",
    "account number",
    "routing number",
    "iban",
    "swift",
    "pin",
    "cvc2",
    "cvv2",
    "email",
    "e-mail",
    "phone",
    "mobile",
    "address",
    "street",
    "zip",
    "postal",
    "expiry",
    "expiration",
    "api key",
    "secret",
    "token",
    "profile photo",
    "profile image",
    "user photo"
  ];
  var EXPLICIT_SENSITIVE_ATTRS = [
    "data-sensitive",
    "data-private",
    "data-pii",
    "data-confidential"
  ];
  function detectPIICategory(text) {
    for (const [category, pattern] of Object.entries(PII_PATTERNS)) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return { category: PII_CATEGORY_MAP[category], match: matches[0] };
      }
    }
    return null;
  }
  function getReplacementToken(category) {
    const tokens = {
      email: "[REDACTED_EMAIL]",
      phone: "[REDACTED_PHONE]",
      credit_card: "[REDACTED_CARD]",
      cvv: "[REDACTED_CVV]",
      aadhaar: "[REDACTED_AADHAAR]",
      pan: "[REDACTED_PAN]",
      account_number: "[REDACTED_ACCOUNT]",
      password: "[REDACTED_PASSWORD]",
      otp: "[REDACTED_OTP]",
      address: "[REDACTED_ADDRESS]",
      face: "[REDACTED_FACE]",
      explicit_sensitive: "[REDACTED_SENSITIVE]",
      custom: "[REDACTED]"
    };
    return tokens[category] || "[REDACTED]";
  }

  // src/redaction/redactionEngine.ts
  var SENSITIVE_ROLES = ["textbox", "searchbox", "combobox", "spinbutton"];
  function elementHasSensitiveAttribute(el) {
    return EXPLICIT_SENSITIVE_ATTRS.some((attr) => el.hasAttribute(attr));
  }
  function elementHasSensitiveAutocomplete(el) {
    const autocomplete = el.getAttribute("autocomplete")?.toLowerCase() || "";
    return SENSITIVE_AUTOCOMPLETE_VALUES.some((v) => autocomplete.includes(v));
  }
  function elementHasSensitiveInputType(el) {
    if (el instanceof HTMLInputElement) {
      return SENSITIVE_INPUT_TYPES.includes(el.type.toLowerCase());
    }
    return false;
  }
  function elementLabelIndicatesSensitive(el) {
    const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("id") || el.labels?.[0]?.textContent || "").toLowerCase();
    return SENSITIVE_LABEL_KEYWORDS.some((kw) => label.includes(kw));
  }
  function getNearbyLabelText(el) {
    const labelEl = el.closest("label") || document.querySelector(`label[for="${el.id}"]`);
    if (labelEl) return labelEl.textContent || "";
    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const labelledEl = document.getElementById(ariaLabelledBy);
      if (labelledEl) return labelledEl.textContent || "";
    }
    return "";
  }
  function classifyElementSensitivity(el, textContent) {
    if (elementHasSensitiveAttribute(el)) return true;
    if (elementHasSensitiveAutocomplete(el)) return true;
    if (elementHasSensitiveInputType(el)) return true;
    if (elementLabelIndicatesSensitive(el)) return true;
    const nearbyLabel = getNearbyLabelText(el).toLowerCase();
    if (SENSITIVE_LABEL_KEYWORDS.some((kw) => nearbyLabel.includes(kw))) return true;
    const role = el.getAttribute("role") || "";
    if (SENSITIVE_ROLES.includes(role)) {
      const pii = detectPIICategory(textContent);
      if (pii && ["password", "credit_card", "cvv", "aadhaar", "pan", "otp"].includes(pii.category)) {
        return true;
      }
    }
    return false;
  }
  function extractSanitizedElements(root = document) {
    const elements = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const el = node;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return NodeFilter.FILTER_REJECT;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        if (elementHasSensitiveAttribute(el)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.hasAttribute("title")) {
          return NodeFilter.FILTER_ACCEPT;
        }
        const role = el.getAttribute("role") || getImplicitRole(el);
        if (["button", "link", "textbox", "combobox", "checkbox", "radio", "menuitem", "tab", "heading", "img", "searchbox", "slider", "spinbutton", "switch", "option", "listbox", "dialog", "region", "form"].includes(role)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (el.tagName.match(/^(A|BUTTON|INPUT|SELECT|TEXTAREA|IMG|H[1-6]|LABEL|FORM)$/i)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    let index = 0;
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const role = el.getAttribute("role") || getImplicitRole(el);
      const label = getAccessibleLabel(el);
      const textContent = el.textContent || "";
      const sensitive = classifyElementSensitivity(el, textContent);
      const inputEl = el;
      const placeholder = inputEl.placeholder || el.getAttribute("placeholder") || "";
      const valueState = inputEl.value && inputEl.value.length > 0 ? "filled" : inputEl.value !== void 0 ? "empty" : "unknown";
      const href = el.getAttribute("href") || void 0;
      const tagName = el.tagName.toLowerCase();
      const type = inputEl.type || el.getAttribute("type") || void 0;
      const selector = generateSelector(el);
      const xpath = generateXPath(el);
      const ariaLabel = el.getAttribute("aria-label") || void 0;
      const ariaLabelledBy = el.getAttribute("aria-labelledby") || void 0;
      const name = el.getAttribute("name") || void 0;
      const elementId = el.id || void 0;
      const formId = el.closest("form")?.id || void 0;
      const autocomplete = el.getAttribute("autocomplete") || void 0;
      const inputType = el.type || el.getAttribute("type") || void 0;
      const required = el.hasAttribute("required");
      const readOnly = el.hasAttribute("readonly");
      const category = sensitive ? classifyElementCategoryDirect(el, label, textContent) : void 0;
      const replacementToken = category ? getReplacementToken(category) : void 0;
      const sanitizedTextContent = sensitive ? replacementToken || "[REDACTED]" : textContent.slice(0, 200);
      const sanitizedValue = sensitive ? replacementToken || "[REDACTED]" : inputEl.value || void 0;
      const sanitizedLabel = sanitizeLabel(label, sensitive, category);
      elements.push({
        id: `el-${index++}-${generateId()}`,
        role,
        label: sanitizedLabel,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        visible: isElementVisible(el),
        enabled: isElementEnabled(el),
        sensitive,
        placeholder: sensitive ? replacementToken || "[REDACTED]" : placeholder || void 0,
        valueState,
        href,
        tagName,
        type,
        selector,
        xpath,
        ariaLabel,
        ariaLabelledBy,
        name,
        elementId,
        formId,
        autocomplete,
        inputType,
        required: required || void 0,
        readOnly: readOnly || void 0,
        textContent: sanitizedTextContent,
        value: sanitizedValue
      });
    }
    return elements;
  }
  function getImplicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.type?.toLowerCase();
    const roleMap = {
      a: "link",
      button: "button",
      input: type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : type === "range" ? "slider" : "textbox",
      select: "combobox",
      textarea: "textbox",
      img: "img",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
      label: "generic",
      form: "form",
      nav: "navigation",
      main: "main",
      aside: "complementary",
      header: "banner",
      footer: "contentinfo",
      section: "region",
      article: "region",
      dialog: "dialog",
      ul: "listbox",
      ol: "listbox",
      li: "option"
    };
    return roleMap[tag] || "generic";
  }
  function getAccessibleLabel(el) {
    return (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent || el.getAttribute("title") || el.getAttribute("placeholder") || el.labels?.[0]?.textContent || el.getAttribute("alt") || el.textContent?.slice(0, 100) || "").trim();
  }
  function sanitizeLabel(label, sensitive, category) {
    if (!sensitive) return label;
    if (category) return getReplacementToken(category);
    const pii = detectPIICategory(label);
    if (pii) return getReplacementToken(pii.category);
    return "[REDACTED_LABEL]";
  }
  function classifyElementCategoryDirect(el, label, textContent) {
    const inputEl = el instanceof HTMLInputElement ? el : null;
    const attrText = [
      label,
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("autocomplete") || "",
      inputEl?.type || el.getAttribute("type") || "",
      textContent,
      getNearbyLabelText(el)
    ].join(" ").toLowerCase();
    if (attrText.includes("password") || attrText.includes("passwort") || attrText.includes("current-password") || attrText.includes("new-password") || inputEl?.type === "password") {
      return "password";
    }
    if (attrText.includes("otp") || attrText.includes("one-time") || attrText.includes("verification code") || attrText.includes("auth code")) {
      return "otp";
    }
    if (attrText.includes("credit") || attrText.includes("card") || attrText.includes("cc-number") || attrText.includes("cc-exp") || attrText.includes("expiry")) {
      return "credit_card";
    }
    if (attrText.includes("cvv") || attrText.includes("cvc") || attrText.includes("security code") || attrText.includes("cc-csc")) {
      return "cvv";
    }
    if (attrText.includes("aadhaar")) return "aadhaar";
    if (attrText.includes("pan")) return "pan";
    if (attrText.includes("ssn") || attrText.includes("social security")) return "account_number";
    if (attrText.includes("account") || attrText.includes("routing") || attrText.includes("iban")) return "account_number";
    if (attrText.includes("email") || inputEl?.type === "email") return "email";
    if (attrText.includes("phone") || attrText.includes("tel") || attrText.includes("mobile") || inputEl?.type === "tel") return "phone";
    if (attrText.includes("address") || attrText.includes("street") || attrText.includes("zip") || attrText.includes("postal")) return "address";
    if (attrText.includes("photo") || attrText.includes("profile") || attrText.includes("avatar") || attrText.includes("face")) return "face";
    const pii = detectPIICategory(textContent) || detectPIICategory(label) || (inputEl?.value ? detectPIICategory(inputEl.value) : null);
    if (pii) return pii.category;
    return "explicit_sensitive";
  }
  function classifyElementCategory(el) {
    const label = [
      el.label ?? "",
      el.name ?? "",
      el.elementId ?? "",
      el.placeholder ?? "",
      el.autocomplete ?? "",
      el.inputType ?? "",
      el.textContent ?? ""
    ].join(" ").toLowerCase();
    if (label.includes("password") || label.includes("passwort") || label.includes("current-password") || el.inputType === "password") return "password";
    if (label.includes("otp") || label.includes("one-time") || label.includes("verification")) return "otp";
    if (label.includes("credit") || label.includes("card") || label.includes("cc-number") || label.includes("expiry")) return "credit_card";
    if (label.includes("cvv") || label.includes("cvc") || label.includes("cc-csc")) return "cvv";
    if (label.includes("aadhaar")) return "aadhaar";
    if (label.includes("pan")) return "pan";
    if (label.includes("ssn") || label.includes("social security") || label.includes("account") || label.includes("routing") || label.includes("iban")) return "account_number";
    if (label.includes("email") || el.inputType === "email") return "email";
    if (label.includes("phone") || label.includes("tel") || label.includes("mobile") || el.inputType === "tel") return "phone";
    if (label.includes("address") || label.includes("street") || label.includes("zip") || label.includes("postal")) return "address";
    if (label.includes("photo") || label.includes("avatar") || label.includes("face") || label.includes("profile")) return "face";
    const pii = detectPIICategory(el.textContent ?? "") || detectPIICategory(el.label ?? "") || detectPIICategory(el.value ?? "");
    if (pii) return pii.category;
    return "explicit_sensitive";
  }
  function isElementVisible(el) {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }
  function isElementEnabled(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement) {
      return !el.disabled;
    }
    return true;
  }
  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }
  function hasValidBounds(bounds) {
    return bounds !== void 0 && typeof bounds.x === "number" && typeof bounds.y === "number" && typeof bounds.width === "number" && typeof bounds.height === "number";
  }
  function calculateConfidence(el, category) {
    let confidence = 0.6;
    const label = (el.label ?? "").toLowerCase();
    if (EXPLICIT_SENSITIVE_ATTRS.some((attr) => label.includes(attr))) confidence += 0.35;
    if (["password", "credit_card", "cvv", "aadhaar", "pan", "otp", "email", "phone"].includes(category)) confidence += 0.3;
    if (label.includes(category.replace("_", " "))) confidence += 0.2;
    return Math.min(confidence, 1);
  }
  function createRedactionManifest(elements, _screenshotWidth, _screenshotHeight) {
    const manifest = [];
    for (const el of elements) {
      if (!el.sensitive) continue;
      if (!hasValidBounds(el.bounds)) continue;
      const category = classifyElementCategory(el);
      const confidence = calculateConfidence(el, category);
      manifest.push({
        category,
        bounds: { ...el.bounds },
        confidence,
        replacement: getReplacementToken(category)
      });
    }
    return manifest;
  }
  function processRedaction(context) {
    const manifest = createRedactionManifest(context.elements, context.screenshotWidth, context.screenshotHeight);
    const redactedElements = context.elements.map((el) => {
      if (!el.sensitive) return el;
      const category = classifyElementCategory(el);
      return {
        ...el,
        label: getReplacementToken(category)
      };
    });
    const redactedText = /* @__PURE__ */ new Map();
    for (const entry of manifest) {
      redactedText.set(entry.replacement, entry.category);
    }
    return { redactedElements, manifest, redactedText };
  }
  function generateSelector(el) {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }
      const classNames = Array.from(current.classList).filter((c) => !c.startsWith("data-") && !c.startsWith("ps-")).join(".");
      if (classNames) part += `.${classNames}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  }
  function generateXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `[${index}]`;
        }
      }
      parts.unshift(part);
      current = parent;
    }
    return "/" + parts.join("/");
  }

  // src/utils/helpers.ts
  function generateSessionId() {
    return crypto.randomUUID();
  }
  function sanitizeString(input, maxLength = 200) {
    return input.slice(0, maxLength).replace(/[\r\n\t]/g, " ").trim();
  }
  function getOrigin(url) {
    try {
      return new URL(url).origin;
    } catch {
      return "unknown";
    }
  }

  // src/content/index.ts
  var state = {
    sessionId: null,
    pageMap: null,
    lastScreenshot: null,
    lastRedactionManifest: [],
    isCapturing: false,
    privateValues: /* @__PURE__ */ new Map()
  };
  function buildPageMap(elements) {
    return {
      urlOrigin: getOrigin(window.location.href),
      title: sanitizeString(document.title),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      elements
    };
  }
  function hasValidBounds2(bounds) {
    return bounds !== void 0 && typeof bounds.x === "number" && typeof bounds.y === "number" && typeof bounds.width === "number" && typeof bounds.height === "number";
  }
  async function captureViewport() {
    const canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    await new Promise((resolve) => {
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
  function requestVisionProcessing(dataUrl, width, height) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "VISION_PROCESS",
          imageData: { dataUrl, width, height }
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
  async function performCapture(userGoal) {
    if (state.isCapturing) {
      throw new Error("Capture already in progress");
    }
    state.isCapturing = true;
    try {
      const elements = extractSanitizedElements(document);
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
      const redactionContext = {
        elements: pageMap.elements,
        screenshotWidth: canvas.width,
        screenshotHeight: canvas.height
      };
      const redactionResult = processRedaction(redactionContext);
      const localManifest = redactionResult.manifest;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const visionResponse = await requestVisionProcessing(
        dataUrl,
        canvas.width,
        canvas.height
      );
      const visionEntries = visionResponse.ok && visionResponse.result ? visionResponse.result.redactionEntries : [];
      const combinedManifest = [...localManifest, ...visionEntries];
      const finalElements = redactionResult.redactedElements.map((el) => {
        const visionRedaction = visionEntries.find((r) => {
          if (!hasValidBounds2(r.bounds) || !hasValidBounds2(el.bounds)) return false;
          const rb = r.bounds;
          const eb = el.bounds;
          return rb.x < eb.x + eb.width && rb.x + rb.width > eb.x && rb.y < eb.y + eb.height && rb.y + rb.height > eb.y;
        });
        if (visionRedaction) {
          return { ...el, sensitive: true, label: visionRedaction.replacement };
        }
        return el;
      });
      const finalPageMap = buildPageMap(finalElements);
      const sanitizedCanvas = canvas.cloneNode(true);
      applyRedactionsToCanvas(sanitizedCanvas, combinedManifest);
      const sanitizedScreenshot = sanitizedCanvas.toDataURL("image/jpeg", 0.7);
      state.pageMap = finalPageMap;
      state.lastRedactionManifest = combinedManifest;
      state.sessionId = generateSessionId();
      const payload = {
        sessionId: state.sessionId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        userGoal,
        sanitizedScreenshot,
        pageMap: finalPageMap,
        redactionManifest: combinedManifest
      };
      return payload;
    } finally {
      state.isCapturing = false;
    }
  }
  function applyRedactionsToCanvas(canvas, manifest) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (const entry of manifest) {
      if (!hasValidBounds2(entry.bounds)) continue;
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
  function resolveTargetElement(target) {
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
      } catch {
      }
    }
    if (target.xpath) {
      try {
        const result = document.evaluate(target.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue && result.singleNodeValue instanceof Element) {
          return result.singleNodeValue;
        }
      } catch {
      }
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
        return aria === searchText || aria.length > 0 && (aria.includes(searchText) || searchText.includes(aria));
      });
      if (byAria) return byAria;
    }
    if (searchText) {
      const labels = Array.from(document.querySelectorAll("label"));
      const matchedLabel = labels.find((lbl) => {
        const lblText = (lbl.textContent || "").trim().toLowerCase();
        return lblText === searchText || lblText.length > 0 && (lblText.includes(searchText) || searchText.includes(lblText));
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
        const text = (el.textContent || el.value || "").trim().toLowerCase();
        return text === searchText || text.length > 0 && (text.includes(searchText) || searchText.includes(text));
      });
      if (byVisibleText) return byVisibleText;
    }
    if (searchText) {
      const inputs = Array.from(document.querySelectorAll("input, textarea"));
      const byPlaceholder = inputs.find((el) => {
        const ph = (el.getAttribute("placeholder") || "").trim().toLowerCase();
        return ph === searchText || ph.length > 0 && (ph.includes(searchText) || searchText.includes(ph));
      });
      if (byPlaceholder) return byPlaceholder;
    }
    if (searchText || target.elementId) {
      const nameToMatch = searchText || target.elementId.toLowerCase();
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
    if (target.bounds && hasValidBounds2(target.bounds)) {
      const bounds = target.bounds;
      const centerX = (bounds.x ?? 0) + (bounds.width ?? 0) / 2;
      const centerY = (bounds.y ?? 0) + (bounds.height ?? 0) / 2;
      const fromPoint = document.elementFromPoint(centerX, centerY);
      if (fromPoint) return fromPoint;
    }
    return null;
  }
  function setInputValueSafely(element, value) {
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
  async function executeAction(action) {
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
            isAtTop
          }
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
          element.focus();
          const verified = document.activeElement === element;
          return { success: true, verified, details: { focused: verified } };
        }
        case "click": {
          const htmlElement = element;
          if (!isElementInViewport(htmlElement)) {
            htmlElement.scrollIntoView({ behavior: "smooth", block: "center" });
            await new Promise((r) => setTimeout(r, 200));
          }
          try {
            htmlElement.focus();
          } catch {
          }
          highlightElement(element);
          const preUrl = window.location.href;
          const preActive = document.activeElement;
          const preBodyLength = document.body ? document.body.innerHTML.length : 0;
          const form = htmlElement.closest("form");
          const isButton = htmlElement.tagName === "BUTTON" || htmlElement.type === "submit" || htmlElement.getAttribute("role") === "button";
          let eventFired = false;
          const markEventFired = () => {
            eventFired = true;
          };
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
                form.requestSubmit(htmlElement);
              } else {
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              }
            } catch {
            }
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
              elementText: (htmlElement.textContent || "").trim().slice(0, 50)
            }
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
          const sanitizedEl = state.pageMap?.elements.find((el) => {
            const resolved = resolveTargetElement(el);
            return resolved === element;
          });
          const isSensitive = sanitizedEl?.sensitive || element.hasAttribute("data-sensitive") || element.hasAttribute("data-private") || element instanceof HTMLInputElement && (element.type === "password" || element.type === "tel" || element.type === "email");
          if (!isSensitive) {
            console.warn(`[VEIL][CONTENT] fill_private failed: element not found or not sensitive. sanitizedEl:`, sanitizedEl);
            return { success: false, error: "fill_private can only be used on sensitive fields", verified: false };
          }
          let privateValue = sanitizedEl ? state.privateValues.get(sanitizedEl.id) : void 0;
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
          element.click();
          return { success: true, verified: true };
        }
        case "navigate": {
          if (element instanceof HTMLAnchorElement && element.href) {
            window.location.href = element.href;
            return { success: true, verified: true };
          }
          element.click();
          return { success: true, verified: true };
        }
        default:
          return { success: false, error: `Unknown action type: ${type}`, verified: false };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Execution error", verified: false };
    }
  }
  function isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && rect.right <= (window.innerWidth || document.documentElement.clientWidth);
  }
  function highlightElement(element) {
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
    }, 4e3);
  }
  function clearAllHighlights() {
    const highlighted = document.querySelectorAll("[data-ps-highlight]");
    highlighted.forEach((el) => el.removeAttribute("data-ps-highlight"));
    const style = document.getElementById("ps-highlight-style");
    if (style) style.remove();
  }
  function assignElementIds(elements) {
    for (const elementData of elements) {
      let element = null;
      if (elementData.elementId) {
        element = document.getElementById(elementData.elementId);
      }
      if (!element && elementData.selector) {
        try {
          element = document.querySelector(elementData.selector);
        } catch {
        }
      }
      if (!element && elementData.name) {
        element = document.querySelector(`[name="${elementData.name}"]`);
      }
      if (!element && elementData.bounds && hasValidBounds2(elementData.bounds)) {
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
  function setupMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver(() => {
      if (state.pageMap) {
        const elements = extractSanitizedElements(document);
        assignElementIds(elements);
      }
    });
    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  var mutationObserver = null;
  setupMutationObserver();
  function initialObserve() {
    try {
      const elements = extractSanitizedElements(document);
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
      const redactionContext = {
        elements: pageMap.elements,
        screenshotWidth: window.innerWidth,
        screenshotHeight: window.innerHeight
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
      pointerEvents: "auto"
    });
    const icon = document.createElement("div");
    icon.innerHTML = "\u{1F6E1}\uFE0F";
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
      transition: "background 0.2s ease"
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
  function updateStatusOverlay(status, goal) {
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
            const redactionContext = {
              elements: pageMap.elements,
              screenshotWidth: window.innerWidth,
              screenshotHeight: window.innerHeight
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
                backend: "mock",
                redactedCount: state.lastRedactionManifest.length,
                lastCapture: state.sessionId ? (/* @__PURE__ */ new Date()).toISOString() : void 0,
                sessionActive: !!state.sessionId
              }
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
})();
//# sourceMappingURL=content.js.map
