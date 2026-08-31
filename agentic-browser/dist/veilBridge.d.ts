import { Page } from "playwright";
import { PageMap, ServerPlan, GoalClassification } from "@privatesight/shared";
export interface PlanAndExecuteOptions {
    serverUrl?: string;
    autoConfirmHighRisk?: boolean;
    onStep?: (step: {
        index: number;
        action: any;
        status: string;
        details?: any;
    }) => void;
    onPlan?: (plan: ServerPlan, classification: GoalClassification) => void;
}
export interface ExecutionReport {
    userGoal: string;
    url: string;
    classification: GoalClassification;
    plan: ServerPlan | null;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    durationMs: number;
    privacy: {
        totalElements: number;
        sensitiveElements: number;
        redactedFields: number;
        leaksPrevented: number;
    };
    steps: Array<{
        stepNumber: number;
        actionType: string;
        target: string;
        result: string;
        verified: boolean;
        error?: string;
    }>;
}
export declare class VeilBridge {
    private page;
    private serverUrl;
    constructor(page: Page, serverUrl?: string);
    /**
     * Captures the sanitized page map directly from the page content script.
     */
    getPageMap(): Promise<PageMap>;
    /**
     * Sends the sanitized page map & user goal to the Veil server planner.
     */
    requestPlan(userGoal: string, pageMap: PageMap): Promise<ServerPlan>;
    /**
     * Executes an action on the page.
     */
    executeAction(action: any): Promise<{
        success: boolean;
        verified: boolean;
        error?: string;
    }>;
    /**
     * Runs an autonomous end-to-end plan & execution loop for a user goal.
     */
    runGoal(userGoal: string, options?: PlanAndExecuteOptions): Promise<ExecutionReport>;
}
