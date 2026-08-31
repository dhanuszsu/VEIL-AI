import { describe, it, expect } from "vitest";
import { validateActionAgainstGoal } from "../shared/src/planner/actionValidator";
import { classifyGoal } from "../shared/src/planner/goalClassifier";

describe("Emergency Stop & Loop Protection", () => {
  const elements = [
    {
      id: "el-btn",
      role: "button" as const,
      label: "Next",
      bounds: { x: 100, y: 100, width: 100, height: 40 },
      visible: true,
      enabled: true,
      sensitive: false,
    },
  ];

  it("terminates execution when maximum step count is reached", () => {
    const classification = classifyGoal("click next", {
      urlOrigin: "http://localhost:3002",
      title: "Wizard",
      viewport: { width: 1920, height: 1080 },
      elements,
    });

    const result = validateActionAgainstGoal(
      { id: "a1", type: "click", target: { elementId: "el-btn" }, reason: "Next" },
      {
        userGoal: "click next",
        classification,
        pageElements: elements,
        previousActions: [],
        stepNumber: 51, // Exceeded max steps (50)
      }
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Maximum step count");
  });

  it("detects and rejects duplicate repeated actions", () => {
    const classification = classifyGoal("click next", {
      urlOrigin: "http://localhost:3002",
      title: "Wizard",
      viewport: { width: 1920, height: 1080 },
      elements,
    });

    const action = { id: "a1", type: "click" as const, target: { elementId: "el-btn" }, reason: "Next" };

    const result = validateActionAgainstGoal(action, {
      userGoal: "click next",
      classification,
      pageElements: elements,
      previousActions: [action], // already attempted
      stepNumber: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Duplicate action detected");
  });
});
