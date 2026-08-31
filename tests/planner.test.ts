import { describe, it, expect } from "vitest";
import { createRuleBasedPlan } from "../server/src/planner/ruleBasedPlanner";
import { classifyGoal, shouldExecuteActions } from "../shared/src/planner/goalClassifier";

const createMockPageMap = (elements: any[]) => ({
  urlOrigin: "https://example.com",
  title: "Test Page",
  viewport: { width: 1920, height: 1080 },
  elements,
});

const mockElements = [
  {
    id: "el-1",
    role: "button",
    label: "Submit Request",
    bounds: { x: 100, y: 100, width: 120, height: 40 },
    visible: true,
    enabled: true,
    sensitive: false,
  },
  {
    id: "el-2",
    role: "textbox",
    label: "Search products",
    bounds: { x: 100, y: 200, width: 300, height: 40 },
    visible: true,
    enabled: true,
    sensitive: false,
  },
  {
    id: "el-3",
    role: "textbox",
    label: "Full Name",
    bounds: { x: 100, y: 300, width: 300, height: 40 },
    visible: true,
    enabled: true,
    sensitive: false,
  },
  {
    id: "el-4",
    role: "textbox",
    label: "Email",
    bounds: { x: 100, y: 400, width: 300, height: 40 },
    visible: true,
    enabled: true,
    sensitive: true,
  },
  {
    id: "el-5",
    role: "textbox",
    label: "Password",
    bounds: { x: 100, y: 500, width: 300, height: 40 },
    visible: true,
    enabled: true,
    sensitive: true,
  },
  {
    id: "el-6",
    role: "button",
    label: "Delete Account",
    bounds: { x: 100, y: 600, width: 150, height: 40 },
    visible: true,
    enabled: true,
    sensitive: false,
  },
  {
    id: "el-7",
    role: "link",
    label: "Settings",
    bounds: { x: 100, y: 700, width: 100, height: 40 },
    visible: true,
    enabled: true,
    sensitive: false,
  },
];

describe("Goal Classifier", () => {
  it("classifies 'what can you do' as information", () => {
    const classification = classifyGoal("what can you do", createMockPageMap(mockElements));
    expect(classification.mode === "information" || classification.mode === "informational").toBe(true);
    expect(classification.requiresClarification).toBe(false);
    expect(shouldExecuteActions(classification)).toBe(false);
  });

  it("classifies 'what is on this page' as information", () => {
    const classification = classifyGoal("what is on this page", createMockPageMap(mockElements));
    expect(classification.mode === "information" || classification.mode === "informational").toBe(true);
    expect(shouldExecuteActions(classification)).toBe(false);
  });

  it("classifies 'describe this form' as information", () => {
    const classification = classifyGoal("describe this form", createMockPageMap(mockElements));
    expect(classification.mode === "information" || classification.mode === "informational").toBe(true);
    expect(shouldExecuteActions(classification)).toBe(false);
  });

  it("classifies 'click the submit button' as click intent", () => {
    const classification = classifyGoal("click the submit button", createMockPageMap(mockElements));
    expect(classification.mode === "click" || classification.mode === "browser_action").toBe(true);
    expect(classification.extractedIntent?.action).toBe("click");
    expect(classification.extractedIntent?.target).toBe("submit button");
    expect(shouldExecuteActions(classification)).toBe(true);
  });

  it("classifies 'find the submit button' as find intent", () => {
    const classification = classifyGoal("find the submit button", createMockPageMap(mockElements));
    expect(classification.mode === "find" || classification.mode === "highlight" || classification.mode === "browser_action").toBe(true);
    expect(classification.extractedIntent?.action).toBe("find");
    expect(shouldExecuteActions(classification)).toBe(true);
  });

  it("classifies 'search for products' as search intent", () => {
    const classification = classifyGoal("search for products", createMockPageMap(mockElements));
    expect(classification.mode === "search" || classification.mode === "browser_action").toBe(true);
    expect(classification.extractedIntent?.action).toBe("search");
    expect(classification.extractedIntent?.target).toBe("products");
    expect(shouldExecuteActions(classification)).toBe(true);
  });

  it("classifies 'fill the form' as fill intent", () => {
    const classification = classifyGoal("fill the form", createMockPageMap(mockElements));
    expect(classification.mode === "fill" || classification.mode === "form_task").toBe(true);
    expect(shouldExecuteActions(classification)).toBe(true);
  });

  it("classifies 'fill name as John' as fill intent with value", () => {
    const classification = classifyGoal("fill name as John", createMockPageMap(mockElements));
    expect(classification.mode === "fill" || classification.mode === "form_task").toBe(true);
    expect(classification.extractedIntent?.action).toBe("fill");
    expect(classification.extractedIntent?.target).toBe("name");
    expect(classification.extractedIntent?.value).toBe("John");
  });

  it("classifies 'go to settings' as navigate intent", () => {
    const classification = classifyGoal("go to settings", createMockPageMap(mockElements));
    expect(classification.mode === "navigate" || classification.mode === "navigation_task").toBe(true);
    expect(classification.extractedIntent?.action).toBe("navigate");
  });

  it("classifies 'delete my account' as delete high-risk intent", () => {
    const classification = classifyGoal("delete my account", createMockPageMap(mockElements));
    expect(classification.mode).toBe("delete");
    expect(classification.riskLevel).toBe("high");
    expect(classification.requiresConfirmation).toBe(true);
  });

  it("classifies 'do it' as ambiguous", () => {
    const classification = classifyGoal("do it", createMockPageMap(mockElements));
    expect(classification.mode).toBe("ambiguous");
    expect(classification.requiresClarification).toBe(true);
    expect(shouldExecuteActions(classification)).toBe(false);
  });

  it("classifies 'continue' as ambiguous", () => {
    const classification = classifyGoal("continue", createMockPageMap(mockElements));
    expect(classification.mode).toBe("ambiguous");
    expect(shouldExecuteActions(classification)).toBe(false);
  });

  it("classifies unknown goal as unsupported", () => {
    const classification = classifyGoal("fly to the moon", createMockPageMap(mockElements));
    expect(classification.mode).toBe("unsupported");
    expect(classification.requiresClarification).toBe(true);
    expect(shouldExecuteActions(classification)).toBe(false);
  });
});

describe("Rule-Based Planner", () => {
  it("finds submit button for find goal", () => {
    const context = {
      userGoal: "find the submit button",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.some((a) => a.type === "highlight")).toBe(true);
    expect(plan.summary).toContain("submit button");
  });

  it("finds search input for search goal", () => {
    const context = {
      userGoal: "search for products",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.some((a) => a.type === "type" && a.value === "products")).toBe(true);
    expect(plan.summary).toContain("products");
  });

  it("handles form fill goal with specified value", () => {
    const context = {
      userGoal: "fill name as John",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBeGreaterThan(0);
    const typeAction = plan.actions.find((a) => a.type === "type");
    expect(typeAction?.value).toBe("John");
  });

  it("handles scroll down goal", () => {
    const context = {
      userGoal: "scroll down to see more",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.some((a) => a.type === "scroll" && a.direction === "down")).toBe(true);
    expect(plan.confidence).toBeGreaterThan(0.8);
  });

  it("handles scroll up goal", () => {
    const context = {
      userGoal: "scroll up",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.some((a) => a.type === "scroll" && a.direction === "up")).toBe(true);
  });

  it("requires confirmation when high-risk action present", () => {
    const context = {
      userGoal: "delete my account",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.requiresUserConfirmation).toBe(true);
    expect(plan.actions.some((a) => a.risk === "high")).toBe(true);
  });

  // TEST 1: "what can you do" executes ZERO browser actions
  it("TEST 1: 'what can you do' executes ZERO browser actions", () => {
    const context = {
      userGoal: "what can you do",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBe(0);
    expect(plan.summary.toLowerCase()).toContain("safe actions");
  });

  // TEST 2: "find the submit button" does not click it
  it("TEST 2: 'find the submit button' does not click it", () => {
    const context = {
      userGoal: "find the submit button",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.some((a) => a.type === "click")).toBe(false);
    expect(plan.actions.some((a) => a.type === "highlight")).toBe(true);
  });

  // TEST 3: explicit click commands only click the requested target
  it("TEST 3: 'click the submit button' clicks only that button", () => {
    const context = {
      userGoal: "click the submit button",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    const clickAction = plan.actions.find((a) => a.type === "click");
    expect(clickAction).toBeDefined();
    expect(clickAction?.target?.elementId).toBe("el-1");
  });

  // TEST 4: "fill name as John" does not invent data for other fields
  it("TEST 4: 'fill name as John' fills only requested field", () => {
    const context = {
      userGoal: "fill name as John",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBe(1);
    expect(plan.actions[0].type).toBe("type");
    expect(plan.actions[0].value).toBe("John");
    expect(plan.actions[0].target?.elementId).toBe("el-3");
  });

  // TEST 5: "do it" asks for clarification, zero arbitrary actions
  it("TEST 5: 'do it' asks for clarification, zero arbitrary actions", () => {
    const context = {
      userGoal: "do it",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBe(0);
    expect(plan.summary).toContain("clarify");
  });

  // TEST 6: If target does not exist, no fallback to first interactive element
  it("TEST 6: nonexistent target does not trigger fallback actions", () => {
    const context = {
      userGoal: "click the nonexistent button",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBe(0);
    expect(plan.summary).toContain("Could not find");
  });

  // TEST 7: Sensitive fields remain redacted
  it("TEST 7: Sensitive fields are not targeted for actions", () => {
    const context = {
      userGoal: "click the password field",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    const clickAction = plan.actions.find((a) => a.type === "click");
    expect(clickAction).toBeUndefined();
  });

  it("ambiguous goals ask for clarification, zero actions", () => {
    const context = {
      userGoal: "Do something",
      pageMap: createMockPageMap(mockElements),
      redactionManifest: [],
    };

    const plan = createRuleBasedPlan(context);

    expect(plan.actions.length).toBe(0);
    expect(plan.summary).toContain("clarify");
  });

  describe("Quick Action Goals", () => {
    it("handles 'Analyze this page for sensitive data and privacy risks' with 0 browser actions and privacy audit", () => {
      const context = {
        userGoal: "Analyze this page for sensitive data and privacy risks",
        pageMap: createMockPageMap(mockElements),
        redactionManifest: [
          { category: "email", bounds: { x: 100, y: 400, width: 300, height: 40 }, confidence: 0.95, replacement: "[REDACTED_EMAIL]" },
          { category: "password", bounds: { x: 100, y: 500, width: 300, height: 40 }, confidence: 0.95, replacement: "[REDACTED_PASSWORD]" },
        ],
      };

      const classification = classifyGoal(context.userGoal, context.pageMap);
      expect(classification.mode === "information" || classification.mode === "informational").toBe(true);
      expect(shouldExecuteActions(classification)).toBe(false);

      const plan = createRuleBasedPlan(context);
      expect(plan.actions).toHaveLength(0);
      expect(plan.summary).toContain("Privacy Audit Complete");
      expect(plan.summary).toContain("sensitive element(s)");
    });

    it("handles 'Fill the password field using my local secret' by generating fill_private action", () => {
      const context = {
        userGoal: "Fill the password field using my local secret",
        pageMap: createMockPageMap(mockElements),
        redactionManifest: [],
      };

      const classification = classifyGoal(context.userGoal, context.pageMap);
      expect(classification.mode).toBe("fill");

      const plan = createRuleBasedPlan(context);
      expect(plan.actions.length).toBeGreaterThan(0);
      const privateAction = plan.actions.find((a) => a.type === "fill_private");
      expect(privateAction).toBeDefined();
      expect(privateAction?.target?.elementId).toBe("el-5");
      expect(privateAction?.value).toBeUndefined(); // Value must never leave client
      expect(plan.requiresUserConfirmation).toBe(true);
    });

    it("handles 'Fill out the form with my details' by filling safe editable fields", () => {
      const context = {
        userGoal: "Fill out the form with my details",
        pageMap: createMockPageMap(mockElements),
        redactionManifest: [],
      };

      const classification = classifyGoal(context.userGoal, context.pageMap);
      expect(classification.mode).toBe("fill");

      const plan = createRuleBasedPlan(context);
      expect(plan.actions.length).toBeGreaterThan(0);
      // Fills safe fields (el-3 full name) and PII fields (el-4 email) with demo values
      // Password field (el-5) gets a fill_private action
      const filledElementIds = plan.actions.map((a) => a.target?.elementId);
      expect(filledElementIds).toContain("el-3"); // full name - safe field
      expect(filledElementIds).toContain("el-4"); // email - PII, filled with demo value
      // el-5 (password) should be handled via fill_private, not type
      const passwordAction = plan.actions.find((a) => a.target?.elementId === "el-5");
      if (passwordAction) {
        expect(passwordAction.type).toBe("fill_private"); // must not use plain type on password
      }
    });

    it("handles 'Find the most important element on this page' by highlighting the primary action", () => {
      const context = {
        userGoal: "Find the most important element on this page",
        pageMap: createMockPageMap(mockElements),
        redactionManifest: [],
      };

      const classification = classifyGoal(context.userGoal, context.pageMap);
      expect(classification.mode).toBe("find");

      const plan = createRuleBasedPlan(context);
      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.actions[0].type).toBe("highlight");
      expect(plan.actions[0].target?.elementId).toBe("el-1"); // Submit Request button
      expect(plan.summary).toContain("primary element");
    });
  });
});