import { chromium, BrowserContext, Page } from "playwright";
import { resolve, join } from "path";
import { existsSync } from "fs";

export interface BrowserLaunchOptions {
  headless?: boolean;
  extensionPath?: string;
  viewport?: { width: number; height: number };
  slowMo?: number;
  userDataDir?: string;
}

export interface AgenticBrowserInstance {
  context: BrowserContext;
  page: Page;
  extensionId: string | null;
  close: () => Promise<void>;
}

export async function launchAgenticBrowser(options: BrowserLaunchOptions = {}): Promise<AgenticBrowserInstance> {
  const rootDir = resolve(__dirname, "../..");
  const defaultExtPath = resolve(rootDir, "extension/dist");
  const extPath = options.extensionPath || defaultExtPath;

  if (!existsSync(extPath)) {
    throw new Error(
      `Veil extension build not found at: ${extPath}\nPlease run "npm run build:extension" first.`
    );
  }

  const manifestPath = join(extPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Invalid extension directory: missing manifest.json at ${manifestPath}`);
  }

  const userDataDir = options.userDataDir || resolve(rootDir, ".browser-profile");

  const launchArgs = [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  // Headless mode with extensions requires special headless=new flag in Chromium
  if (options.headless) {
    launchArgs.push("--headless=new");
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Chrome extensions require headful or headless=new via args
    args: launchArgs,
    viewport: options.viewport || { width: 1280, height: 800 },
    slowMo: options.slowMo || 100,
  });

  // Wait for background service worker or extension to initialize
  let extensionId: string | null = null;
  let serviceWorkers = context.serviceWorkers();
  if (serviceWorkers.length > 0) {
    const swUrl = serviceWorkers[0].url();
    const match = swUrl.match(/chrome-extension:\/\/([a-z0-9]+)/i);
    if (match) extensionId = match[1];
  } else {
    // Wait for service worker event
    try {
      const sw = await context.waitForEvent("serviceworker", { timeout: 3000 });
      const swUrl = sw.url();
      const match = swUrl.match(/chrome-extension:\/\/([a-z0-9]+)/i);
      if (match) extensionId = match[1];
    } catch {
      // Background worker might already be dormant or initialized
    }
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  return {
    context,
    page,
    extensionId,
    close: async () => {
      await context.close();
    },
  };
}
