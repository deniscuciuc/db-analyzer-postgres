import { existsSync, readFileSync } from "node:fs";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type { Pool } from "pg";

import { IndexAnalyzer } from "../analyzers/index-analyzer";
import { QueryAnalyzer } from "../analyzers/query-analyzer";
import { TableAnalyzer } from "../analyzers/table-analyzer";
import { StatsCollector } from "../collectors/stats-collector";
import { listProfiles, loadConfig } from "../config/loader";
import { FULL_ANALYSIS_COMMANDS } from "../constants";
import { DiffReporter } from "../reporters/diff-reporter";
import { ReportGenerator } from "../reporters/report-generator";
import type { AnalyzerOptions, FullReport } from "../types";
import { runWatchLoop } from "../watch/runner";
import * as display from "./display";
import {
	ANALYSIS_MENU_CHOICES,
	MAIN_MENU_CHOICES,
	MAINTENANCE_MENU_CHOICES,
	MODULE_CHOICES,
	REPORTS_MENU_CHOICES,
	SETTINGS_MENU_CHOICES,
	WATCH_COMMAND_CHOICES,
} from "./menus";

export class InteractiveCLI {
	private readonly config = loadConfig();
	private activeProfile?: string;
	private activeSchemas?: string[];
	private activeTables?: string[];
	private indexes!: IndexAnalyzer;
	private queries!: QueryAnalyzer;
	private tables!: TableAnalyzer;
	private stats!: StatsCollector;
	private reporter!: ReportGenerator;

	constructor(
		private readonly pool: Pool,
		private readonly baseOptions: AnalyzerOptions = {},
	) {
		this.rebuildAnalyzers();
	}

	async start(): Promise<void> {
		console.clear();
		const databaseRow = await this.pool.query(
			"SELECT current_database(), version()",
		);
		const databaseName = databaseRow.rows[0].current_database;
		const version = databaseRow.rows[0].version
			.split(" ")
			.slice(0, 2)
			.join(" ");

		console.log(`\n  PostgreSQL Analyzer — ${databaseName} (${version})\n`);

		let running = true;
		while (running) {
			const action = await select({
				message: "Main menu",
				choices: MAIN_MENU_CHOICES,
			});

			switch (action) {
				case "analysis":
					await this.analysisMenu();
					break;
				case "reports":
					await this.reportsMenu();
					break;
				case "watch":
					await this.watchMenu();
					break;
				case "maintenance":
					await this.maintenanceMenu();
					break;
				case "settings":
					await this.settingsMenu();
					break;
				case "exit":
					running = false;
					break;
			}
		}

		console.log("\n  Goodbye!\n");
	}

	private rebuildAnalyzers(): void {
		const options: AnalyzerOptions = {
			...this.baseOptions,
			schemas: this.activeSchemas ?? this.baseOptions.schemas,
			tables: this.activeTables ?? this.baseOptions.tables,
		};

		this.indexes = new IndexAnalyzer(this.pool, options);
		this.queries = new QueryAnalyzer(this.pool, options);
		this.tables = new TableAnalyzer(this.pool, options);
		this.stats = new StatsCollector(this.pool, options);
		this.reporter = new ReportGenerator(
			options.outputDir ?? "./reports",
			options,
		);
	}

	private async analysisMenu(): Promise<void> {
		const choice = await select({
			message: "Run analysis",
			choices: ANALYSIS_MENU_CHOICES,
		});

		switch (choice) {
			case "full":
				await this.runFullAnalysis();
				break;
			case "health":
				await this.runModule("health");
				break;
			case "quick":
				await this.runQuickAnalysis();
				break;
			case "single":
				await this.runSingleModule();
				break;
			case "back":
				return;
		}
	}

	private async runFullAnalysis(): Promise<void> {
		console.log("\n  Running full analysis...\n");

		for (const command of FULL_ANALYSIS_COMMANDS) {
			console.log(`  ─── ${command} ───`);
			await this.runModule(command);
			console.log("");
		}
	}

	private async runQuickAnalysis(): Promise<void> {
		const selected = await checkbox({
			message: "Select modules to run:",
			choices: MODULE_CHOICES,
		});

		if (selected.length === 0) {
			console.log("  Nothing selected.");
			return;
		}

		for (const module of selected) {
			console.log(`\n  ─── ${module} ───`);
			await this.runModule(module);
		}
	}

	private async runSingleModule(): Promise<void> {
		const module = await select({
			message: "Select module:",
			choices: MODULE_CHOICES,
		});
		console.log("");
		await this.runModule(module);
	}

	private async runModule(module: string): Promise<void> {
		try {
			switch (module) {
				case "health":
					display.showHealth(await this.stats.getDatabaseMetrics());
					break;
				case "server-info":
					display.showServerInfo(await this.stats.getServerInfo());
					break;
				case "unused-indexes":
					display.showUnusedIndexes(await this.indexes.getUnusedIndexes());
					break;
				case "missing-indexes":
					display.showMissingIndexes(await this.indexes.getMissingIndexes());
					break;
				case "duplicate-indexes":
					display.showDuplicateIndexes(
						await this.indexes.getDuplicateIndexes(),
					);
					break;
				case "fk-without-indexes":
					display.showFKWithoutIndexes(
						await this.indexes.getForeignKeysWithoutIndexes(),
					);
					break;
				case "generate-drop-sql":
					display.showDropSql(await this.indexes.getUnusedIndexes());
					break;
				case "slow-queries":
					display.showSlowQueries(await this.queries.getAllQueryStats(10, 10));
					break;
				case "long-running":
					display.showLongRunning(await this.queries.getLongRunningQueries());
					break;
				case "blocking":
					display.showBlocking(await this.queries.getBlockingQueries());
					break;
				case "tables":
					display.showTableStats(await this.tables.getLargestTables(10));
					break;
				case "vacuum-needed":
					display.showVacuumNeeded(await this.tables.getTablesNeedingVacuum());
					break;
				case "connections":
					display.showConnections(await this.stats.getConnectionStats());
					break;
				case "config":
					display.showConfig(await this.stats.getConfigurationSettings());
					break;
				case "extensions":
					display.showExtensions(await this.stats.getExtensions());
					break;
			}
		} catch (error) {
			console.log(`  ❌ Error: ${error}`);
		}
	}

	private async reportsMenu(): Promise<void> {
		const choice = await select({
			message: "Generate report",
			choices: REPORTS_MENU_CHOICES,
		});

		if (choice === "back") {
			return;
		}

		console.log("\n  Collecting data...");
		const report = await this.buildFullReport();

		if (choice === "markdown" || choice === "html") {
			const markdownPath = await this.reporter.generateFullReport(report);
			const jsonPath = await this.reporter.generateJsonReport(report);
			console.log(`  ✅ Markdown: ${markdownPath}`);
			console.log(`  ✅ JSON:     ${jsonPath}`);

			if (choice === "html") {
				const htmlPath = await this.reporter.generateHtmlReport(report);
				console.log(`  ✅ HTML:     ${htmlPath}`);
			}
		}

		if (choice === "diff") {
			const previousPath = await input({
				message: "Path to previous JSON report:",
				validate: (value) => (existsSync(value) ? true : "File not found"),
			});
			const previous = loadPreviousReport(previousPath);
			DiffReporter.print(
				DiffReporter.diff(report, previous, this.baseOptions.thresholds),
			);
		}
	}

	private async watchMenu(): Promise<void> {
		const command = await select({
			message: "Command to watch:",
			choices: WATCH_COMMAND_CHOICES,
		});
		const interval = await input({
			message: "Refresh interval in seconds:",
			default: "30",
			validate: (value) =>
				Number(value) > 0 ? true : "Must be a positive number",
		});

		console.log("  Starting watch mode. Press Ctrl+C to stop.\n");

		await runWatchLoop({
			intervalSeconds: Number(interval),
			command,
			runCommand: () => this.runModule(command),
		});
	}

	private async maintenanceMenu(): Promise<void> {
		const choice = await select({
			message: "Maintenance",
			choices: MAINTENANCE_MENU_CHOICES,
		});

		switch (choice) {
			case "run-vacuum":
				await this.runVacuumFlow();
				break;
			case "generate-drop-sql":
				await this.runModule("generate-drop-sql");
				break;
			case "create-pg-stat-statements":
				await this.managePgStatStatements(true);
				break;
			case "drop-pg-stat-statements":
				await this.managePgStatStatements(false);
				break;
			case "back":
				return;
		}
	}

	private async runVacuumFlow(): Promise<void> {
		const tables = await this.tables.getTablesNeedingVacuum();
		if (tables.length === 0) {
			console.log("  ✅ No tables need VACUUM");
			return;
		}

		display.showVacuumNeeded(tables);
		const shouldProceed = await confirm({
			message: `Run VACUUM ANALYZE on ${tables.length} tables?`,
			default: false,
		});
		if (!shouldProceed) {
			console.log("  Skipped.");
			return;
		}

		const full = await confirm({
			message: "Use VACUUM FULL? (locks tables — for maintenance windows only)",
			default: false,
		});

		const summary = await this.tables.autoVacuum({
			analyze: true,
			full,
			onProgress: (result, index, total) => {
				const status = result.success ? "✓" : "✗";
				console.log(
					`  [${index}/${total}] ${status} ${result.schema}.${result.table} (${result.duration}ms)`,
				);
				if (!result.success && result.error) {
					console.log(`    Error: ${result.error}`);
				}
			},
		});

		console.log(
			`\n  ✅ Done: ${summary.successful}/${summary.totalTables} — ${summary.totalDuration}ms`,
		);
		if (summary.failed > 0) {
			console.log(`  ⚠️  Failed: ${summary.failed}`);
		}
	}

	private async managePgStatStatements(create: boolean): Promise<void> {
		const exists =
			(
				await this.pool.query(
					"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
				)
			).rows.length > 0;

		if (create && exists) {
			console.log("  ✅ Already enabled");
			return;
		}
		if (!create && !exists) {
			console.log("  ⚠️  Not enabled");
			return;
		}

		const action = create ? "Enable" : "Disable";
		const warning = create ? "" : " This removes all query statistics.";
		const shouldProceed = await confirm({
			message: `${action} pg_stat_statements?${warning}`,
			default: create,
		});
		if (!shouldProceed) {
			console.log("  Skipped.");
			return;
		}

		const sql = create
			? "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
			: "DROP EXTENSION IF EXISTS pg_stat_statements";

		try {
			await this.pool.query(sql);
			console.log(`  ✅ ${action}d successfully`);
		} catch (error) {
			console.log(`  ❌ Failed: ${error}`);
		}
	}

	private async settingsMenu(): Promise<void> {
		const choice = await select({
			message: "Settings",
			choices: SETTINGS_MENU_CHOICES,
		});

		switch (choice) {
			case "profile": {
				const profiles = listProfiles(this.config);
				if (profiles.length === 0) {
					console.log("  ⚠️  No profiles found in .analyzerrc.json");
					break;
				}
				const selectedProfile = await select({
					message: "Select profile:",
					choices: [
						...profiles.map((profile) => ({ name: profile, value: profile })),
						{ name: "(none — use env/flags)", value: "" },
					],
				});
				this.activeProfile = selectedProfile || undefined;
				console.log(
					`  ✅ Profile set to "${this.activeProfile ?? "none"}". Restart the tool to apply connection changes.`,
				);
				break;
			}
			case "schemas": {
				const value = await input({
					message: "Schema names (comma-separated, blank = all):",
					default: this.activeSchemas?.join(", ") ?? "",
				});
				this.activeSchemas = parseList(value);
				this.rebuildAnalyzers();
				console.log(
					`  ✅ Schema filter: ${this.activeSchemas?.join(", ") ?? "(all)"}`,
				);
				break;
			}
			case "tables": {
				const value = await input({
					message: "Table names (comma-separated, blank = all):",
					default: this.activeTables?.join(", ") ?? "",
				});
				this.activeTables = parseList(value);
				this.rebuildAnalyzers();
				console.log(
					`  ✅ Table filter: ${this.activeTables?.join(", ") ?? "(all)"}`,
				);
				break;
			}
			case "show":
				display.showCurrentSettings(
					this.activeProfile,
					this.activeSchemas,
					this.activeTables,
				);
				break;
			case "back":
				return;
		}
	}

	private async buildFullReport() {
		const databaseRow = await this.pool.query("SELECT current_database()");
		const databaseName = databaseRow.rows[0].current_database;
		const [
			metrics,
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
			tableStats,
			slowQueries,
			bloatedTables,
		] = await Promise.all([
			this.stats.getDatabaseMetrics(),
			this.indexes.getUnusedIndexes(),
			this.indexes.getMissingIndexes(),
			this.indexes.getDuplicateIndexes(),
			this.tables.getTableStats(),
			this.queries.getSlowQueries(),
			this.tables.getBloatedTables(),
		]);
		const recommendations = [
			...this.indexes.generateRecommendations(
				unusedIndexes,
				missingIndexes,
				duplicateIndexes,
			),
			...this.stats.generateMetricsReport(metrics).recommendations,
		];

		return {
			generatedAt: new Date(),
			databaseName,
			metrics,
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
			tableStats,
			slowQueries,
			bloatedTables,
			recommendations,
		};
	}
}

function parseList(value: string): string[] | undefined {
	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

	return items.length > 0 ? items : undefined;
}

function loadPreviousReport(path: string): FullReport {
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"report" in parsed &&
		parsed.report
	) {
		return parsed.report as FullReport;
	}

	return parsed as FullReport;
}
