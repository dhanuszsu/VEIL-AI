import { BrowserContext, Page } from "playwright";
export interface BrowserLaunchOptions {
    headless?: boolean;
    extensionPath?: string;
    viewport?: {
        width: number;
        height: number;
    };
    slowMo?: number;
    userDataDir?: string;
}
export interface AgenticBrowserInstance {
    context: BrowserContext;
    page: Page;
    extensionId: string | null;
    close: () => Promise<void>;
}
export declare function launchAgenticBrowser(options?: BrowserLaunchOptions): Promise<AgenticBrowserInstance>;
