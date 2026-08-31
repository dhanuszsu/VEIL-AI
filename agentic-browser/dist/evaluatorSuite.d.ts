import { ExecutionReport } from "./veilBridge.js";
import { Page } from "playwright";
export interface ScenarioResult {
    name: string;
    goal: string;
    success: boolean;
    durationMs: number;
    report: ExecutionReport;
    notes: string[];
}
export declare function runEvaluatorBenchmark(page: Page, demoUrl?: string): Promise<ScenarioResult[]>;
