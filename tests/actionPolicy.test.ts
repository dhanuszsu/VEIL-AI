import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateAction, ACTION_POLICY, HIGH_CONFIDENCE_AUTO_ACTIONS, CONFIRMATION_REQUIRED_ACTIONS } from "@privatesight/shared";

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
    label: "Email",
    bounds: { x: 100, y: 200, width: 200, height: 40 },
    visible: true,
    enabled: true,
    sensitive: true,
  },
  {
    id: "el-3",
    role: "link",
    label: "External Link",
    bounds: { x: 100, y: 300, width: 100, height: 30 },
    visible: true,
    enabled: true,
    sensitive: false,
    href: "https://external.com",
  },
  {
    id: "el-4",
    role: "button",
    label: "Delete Account",
    bounds: { x: 100, y: 400, width: 120, height: 40 },
    visible: true,
    enabled: true,
    sensitive: false,
  },
];

describe("Action Policy Validation", () => {
  describe("Auto-allowed actions", () => {
    it("allows highlight with high confidence", () => {
      const action = {
        id: "1",
        type: "highlight",
        target: { elementId: "el-1" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("auto");
    });

    it("allows scroll", () => {
      const action = {
        id: "1",
        type: "scroll",
        direction: "down",
        amount: 300,
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("auto");
    });

    it("allows focus", () => {
      const action = {
        id: "1",
        type: "focus",
        target: { elementId: "el-1" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("auto");
    });

    it("allows wait", () => {
      const action = {
        id: "1",
        type: "wait",
        amount: 500,
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("auto");
    });
  });

  describe("Confirmation required actions", () => {
    it("requires confirmation for destructive click", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-4" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("confirm");
      expect(result.reason).toContain("destructive");
    });

    it("requires confirmation for high-risk marked action", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-1" },
        risk: "high" as const,
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("confirm");
      expect(result.reason).toContain("High-risk");
    });

    it("requires confirmation for low confidence click", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-1" },
        reason: "Test",
        confidence: 0.7,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("confirm");
    });
  });

  describe("Rejected actions", () => {
    it("rejects action targeting sensitive element", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-2" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("reject");
      expect(result.reason).toContain("sensitive");
    });

    it("rejects action with invalid elementId", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "non-existent" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("reject");
      expect(result.reason).toContain("not found");
    });

    it("rejects action targeting invisible element", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-5" },
        reason: "Test",
        confidence: 0.9,
      };
      const elements = [...mockElements, { ...mockElements[0], id: "el-5", visible: false }];
      const result = validateAction(action, elements);
      expect(result.policy).toBe("reject");
    });

    it("requires confirmation for cross-origin navigation", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-3" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("confirm");
      expect(result.reason).toContain("Cross-origin");
    });

    it("requires confirmation for destructive action", () => {
      const action = {
        id: "1",
        type: "click",
        target: { elementId: "el-4" },
        reason: "Test",
        confidence: 0.9,
      };
      const result = validateAction(action, mockElements);
      expect(result.policy).toBe("confirm");
      expect(result.reason).toContain("destructive");
    });
  });

  describe("Policy constants", () => {
    it("defines auto policies for safe actions", () => {
      expect(ACTION_POLICY.highlight).toBe("auto");
      expect(ACTION_POLICY.scroll).toBe("auto");
      expect(ACTION_POLICY.focus).toBe("auto");
      expect(ACTION_POLICY.wait).toBe("auto");
      expect(ACTION_POLICY.type).toBe("auto");
    });

    it("defines confirm policies for risky actions", () => {
      expect(ACTION_POLICY.click).toBe("confirm");
      expect(ACTION_POLICY.fill_private).toBe("confirm");
    });

    it("lists high confidence auto actions", () => {
      expect(HIGH_CONFIDENCE_AUTO_ACTIONS).toContain("highlight");
      expect(HIGH_CONFIDENCE_AUTO_ACTIONS).toContain("scroll");
      expect(HIGH_CONFIDENCE_AUTO_ACTIONS).toContain("focus");
      expect(HIGH_CONFIDENCE_AUTO_ACTIONS).toContain("wait");
      expect(HIGH_CONFIDENCE_AUTO_ACTIONS).toContain("type");
    });

    it("lists confirmation required actions", () => {
      expect(CONFIRMATION_REQUIRED_ACTIONS).toContain("click");
      expect(CONFIRMATION_REQUIRED_ACTIONS).toContain("fill_private");
    });
  });
});