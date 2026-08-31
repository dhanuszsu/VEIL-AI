import { Command } from "commander";
import chalk from "chalk";
import readline from "readline";
import { launchAgenticBrowser } from "./browserLauncher.js";
import { VeilBridge } from "./veilBridge.js";
import { runEvaluatorBenchmark } from "./evaluatorSuite.js";
const program = new Command();
program
    .name("veil-browser")
    .description("Agentic Browser for Autonomous Vision Agents with Veil Privacy Protection")
    .version("0.1.0")
    .option("-u, --url <url>", "Initial URL to navigate to", "http://localhost:3002")
    .option("-g, --goal <goal>", "Single natural language goal to execute autonomously")
    .option("-s, --server <serverUrl>", "Veil planner backend server URL", "http://localhost:3001")
    .option("--eval", "Run the comprehensive evaluation benchmark suite", false)
    .option("--headless", "Run browser in headless mode (default: visible headful window)", false);
program.parse(process.argv);
const options = program.opts();
async function startInteractiveRepl(bridge) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    console.log(chalk.bold.green("\n✨ Agentic Browser Ready!"));
    console.log(chalk.gray("Type any goal (e.g. 'Fill out the form with my details', 'Analyze privacy', 'Find submit button') or 'exit' to quit.\n"));
    const promptGoal = () => {
        rl.question(chalk.cyan("veil-agent ❯ "), async (input) => {
            const goal = input.trim();
            if (!goal) {
                promptGoal();
                return;
            }
            if (goal.toLowerCase() === "exit" || goal.toLowerCase() === "quit") {
                rl.close();
                process.exit(0);
            }
            try {
                console.log(chalk.yellow(`\n⚙️  Analyzing page and planning: "${goal}"...`));
                const report = await bridge.runGoal(goal, {
                    onPlan: (plan, classification) => {
                        console.log(chalk.gray(`  Goal mode: ${classification.mode} (risk: ${classification.riskLevel})`));
                        console.log(chalk.bold(`  Plan: ${plan.summary}`));
                        console.log(chalk.gray(`  Steps to execute: ${plan.actions?.length ?? 0}`));
                    },
                    onStep: (step) => {
                        if (step.status === "completed") {
                            console.log(chalk.green(`    ✓ Step ${step.index}: [${step.action.type.toUpperCase()}] ${step.action.target?.label || "target"}`));
                        }
                        else if (step.status === "failed") {
                            console.log(chalk.red(`    ✗ Step ${step.index} failed: ${step.details?.error || "Error"}`));
                        }
                    },
                });
                console.log(chalk.green(`\n✓ Goal Completed in ${report.durationMs}ms (${report.completedSteps}/${report.totalSteps} steps executed)`));
                console.log(chalk.gray(`  🛡️ Privacy: ${report.privacy.sensitiveElements} sensitive element(s) kept protected on-device.\n`));
            }
            catch (err) {
                console.error(chalk.red(`\n✗ Error executing goal: ${err instanceof Error ? err.message : err}\n`));
            }
            promptGoal();
        });
    };
    promptGoal();
}
async function main() {
    console.log(chalk.bold.cyan("\n======================================================="));
    console.log(chalk.bold.cyan("           🛡️  VEIL AGENTIC BROWSER RUNNER            "));
    console.log(chalk.bold.cyan("======================================================="));
    console.log(chalk.gray(`Target URL:     ${options.url}`));
    console.log(chalk.gray(`Veil Server:    ${options.server}`));
    console.log(chalk.gray(`Mode:           ${options.eval ? "Evaluator Benchmark" : options.goal ? "Single Goal" : "Interactive REPL"}`));
    console.log(chalk.gray(`Browser Window: ${options.headless ? "Headless" : "Visible (Headful)"}\n`));
    console.log(chalk.yellow("► Launching Chromium with Veil Extension..."));
    const browser = await launchAgenticBrowser({
        headless: options.headless,
    });
    const bridge = new VeilBridge(browser.page, options.server);
    console.log(chalk.green("✓ Browser launched. Navigating to page..."));
    await browser.page.goto(options.url);
    await browser.page.waitForLoadState("domcontentloaded");
    if (options.eval) {
        await runEvaluatorBenchmark(browser.page, options.url);
        console.log(chalk.green("\n✓ Benchmark complete. Keeping browser open for inspection. Press Ctrl+C to exit."));
    }
    else if (options.goal) {
        console.log(chalk.yellow(`\n⚙️ Executing goal: "${options.goal}"...`));
        const report = await bridge.runGoal(options.goal, {
            onPlan: (plan) => console.log(chalk.bold(`  Plan: ${plan.summary}`)),
            onStep: (step) => {
                if (step.status === "completed") {
                    console.log(chalk.green(`    ✓ Step ${step.index}: [${step.action.type.toUpperCase()}] ${step.action.target?.label || "target"}`));
                }
            },
        });
        console.log(chalk.green(`\n✓ Goal execution finished in ${report.durationMs}ms.`));
        console.log(chalk.gray(`  🛡️ ${report.privacy.sensitiveElements} sensitive field(s) protected on-device.`));
    }
    else {
        await startInteractiveRepl(bridge);
    }
}
main().catch((err) => {
    console.error(chalk.red(`Fatal Error: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
});
