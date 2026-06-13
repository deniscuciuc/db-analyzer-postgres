import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { IndexAnalyzer } from "./src/analyzers/index-analyzer";
import { QueryAnalyzer } from "./src/analyzers/query-analyzer";
import { TableAnalyzer } from "./src/analyzers/table-analyzer";
import { StatsCollector } from "./src/collectors/stats-collector";
import { loadConfig, resolveProfile } from "./src/config";
import { InteractiveCLI } from "./src/interactive";
import { DiffReporter } from "./src/reporters/diff-reporter";
import { ReportGenerator } from "./src/reporters/report-generator";
import { calculateHealthScore } from "./src/thresholds";
import type {
	AnalysisReport,
	AnalyzerOptions,
	DatabaseConfig,
	FullReport,
	VacuumSummary,
	VacuumTarget,
} from "./src/types";
import { runWatchLoop } from "./src/watch";

class DatabaseAnalyzer {
	private pool: Pool;
	private indexAnalyzer: IndexAnalyzer;
	private queryAnalyzer: QueryAnalyzer;
	private tableAnalyzer: TableAnalyzer;
	private statsCollector: StatsCollector;
	private reportGenerator: ReportGenerator;

	constructor(config: DatabaseConfig, options: AnalyzerOptions = {}) {
		this.pool = new Pool({
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.user,
			password: config.password,
			ssl: config.ssl,
		});

		this.indexAnalyzer = new IndexAnalyzer(this.pool, options);
		this.queryAnalyzer = new QueryAnalyzer(this.pool, options);
		this.tableAnalyzer = new TableAnalyzer(this.pool, options);
		this.statsCollector = new StatsCollector(this.pool, options);
		this.reportGenerator = new ReportGenerator(
			options.outputDir ?? "./reports",
			options,
		);
	}

	async analyze(): Promise<AnalysisReport> {
		console.log("Starting database analysis...\n");

		console.log("Collecting database metrics...");
		const metrics = await this.statsCollector.getDatabaseMetrics();

		console.log("Analyzing indexes...");
		const [unusedIndexes, missingIndexes, duplicateIndexes] = await Promise.all(
			[
				this.indexAnalyzer.getUnusedIndexes(),
				this.indexAnalyzer.getMissingIndexes(),
				this.indexAnalyzer.getDuplicateIndexes(),
			],
		);

		console.log("Analyzing tables...");
		const [tableStats, bloatedTables] = await Promise.all([
			this.tableAnalyzer.getTableStats(),
			this.tableAnalyzer.getBloatedTables(),
		]);

		console.log("Analyzing queries...");
		const slowQueries = await this.queryAnalyzer.getSlowQueries();

		console.log("Generating recommendations...");
		const indexRecommendations = this.indexAnalyzer.generateRecommendations(
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
		);
		const metricsReport = this.statsCollector.generateMetricsReport(metrics);

		const recommendations = [
			...indexRecommendations,
			...metricsReport.recommendations,
		];

		const dbNameResult = await this.pool.query("SELECT current_database()");
		const databaseName = dbNameResult.rows[0].current_database;

		const report: AnalysisReport = {
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

		return report;
	}

	async generateReport(
		report: AnalysisReport,
		options: { html?: boolean } = {},
	): Promise<{
		markdown: string;
		json: string;
		html?: string;
	}> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const [markdown, json, html] = await Promise.all([
			this.reportGenerator.generateFullReport(report, timestamp),
			this.reportGenerator.generateJsonReport(report, timestamp),
			options.html
				? this.reportGenerator.generateHtmlReport(report, timestamp)
				: Promise.resolve(undefined),
		]);

		return { markdown, json, html };
	}

	printSummary(report: AnalysisReport): void {
		this.reportGenerator.printSummary(report);
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	async getIndexUsageSummary() {
		return this.indexAnalyzer.getIndexUsageSummary();
	}

	async getForeignKeysWithoutIndexes() {
		return this.indexAnalyzer.getForeignKeysWithoutIndexes();
	}

	async getLongRunningQueries() {
		return this.queryAnalyzer.getLongRunningQueries();
	}

	async getBlockingQueries() {
		return this.queryAnalyzer.getBlockingQueries();
	}

	async getConnectionStats() {
		return this.statsCollector.getConnectionStats();
	}

	async getConfigurationSettings() {
		return this.statsCollector.getConfigurationSettings();
	}

	async getExtensions() {
		return this.statsCollector.getExtensions();
	}

	async getServerInfo() {
		return this.statsCollector.getServerInfo();
	}

	async getTablesNeedingVacuum() {
		return this.tableAnalyzer.getTablesNeedingVacuum();
	}

	async getLargestTables(limit?: number) {
		return this.tableAnalyzer.getLargestTables(limit);
	}

	async getAllQueryStats(minCalls = 10, limit = 50) {
		return this.queryAnalyzer.getAllQueryStats(minCalls, limit);
	}

	async vacuumTable(
		schema: string,
		table: string,
		options?: { analyze?: boolean; full?: boolean },
	) {
		return this.tableAnalyzer.vacuumTable(schema, table, options);
	}

	async vacuumTables(
		tables: VacuumTarget[],
		options?: {
			analyze?: boolean;
			full?: boolean;
			onProgress?: (
				result: { schema: string; table: string; success: boolean },
				index: number,
				total: number,
			) => void;
		},
	): Promise<VacuumSummary> {
		return this.tableAnalyzer.vacuumTables(tables, options);
	}

	async autoVacuum(options?: {
		analyze?: boolean;
		full?: boolean;
		onProgress?: (
			result: { schema: string; table: string; success: boolean },
			index: number,
			total: number,
		) => void;
	}): Promise<VacuumSummary> {
		return this.tableAnalyzer.autoVacuum(options);
	}

	async createPgStatStatements(): Promise<{
		success: boolean;
		message: string;
		alreadyExists?: boolean;
	}> {
		try {
			const existsResult = await this.pool.query(
				"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
			);

			if (existsResult.rows.length > 0) {
				return {
					success: true,
					message: "pg_stat_statements extension already exists",
					alreadyExists: true,
				};
			}

			await this.pool.query(
				"CREATE EXTENSION IF NOT EXISTS pg_stat_statements",
			);
			return {
				success: true,
				message: "pg_stat_statements extension created successfully",
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to create pg_stat_statements: ${error}`,
			};
		}
	}

	async dropPgStatStatements(): Promise<{
		success: boolean;
		message: string;
		notExists?: boolean;
	}> {
		try {
			const existsResult = await this.pool.query(
				"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
			);

			if (existsResult.rows.length === 0) {
				return {
					success: true,
					message: "pg_stat_statements extension does not exist",
					notExists: true,
				};
			}

			await this.pool.query("DROP EXTENSION IF EXISTS pg_stat_statements");
			return {
				success: true,
				message: "pg_stat_statements extension dropped successfully",
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to drop pg_stat_statements: ${error}`,
			};
		}
	}
}

async function main() {
	const args = process.argv.slice(2);

	const options: {
		host?: string;
		port?: number;
		database?: string;
		user?: string;
		password?: string;
		ssl?: boolean;
		output?: string;
		slowQueryThreshold?: number;
		minIndexScans?: number;
		help?: boolean;
		json?: boolean;
		quiet?: boolean;
		command?: string;
		interactive?: boolean;
		profile?: string;
		configPath?: string;
		schemas?: string;
		tables?: string;
		compare?: string;
		html?: boolean;
		watch?: boolean | string;
	} = {};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--host":
			case "-h":
				options.host = args[++i];
				break;
			case "--port":
			case "-p":
				options.port = Number.parseInt(args[++i], 10);
				break;
			case "--database":
			case "-d":
				options.database = args[++i];
				break;
			case "--user":
			case "-U":
				options.user = args[++i];
				break;
			case "--password":
			case "-W":
				options.password = args[++i];
				break;
			case "--ssl":
				options.ssl = true;
				break;
			case "--output":
			case "-o":
				options.output = args[++i];
				break;
			case "--profile":
				options.profile = args[++i];
				break;
			case "--config":
				options.configPath = args[++i];
				break;
			case "--schemas":
				options.schemas = args[++i];
				break;
			case "--tables":
				options.tables = args[++i];
				break;
			case "--compare":
				options.compare = args[++i];
				break;
			case "--html":
				options.html = true;
				break;
			case "--watch": {
				const nextValue = args[i + 1];
				if (nextValue && !nextValue.startsWith("-")) {
					options.watch = nextValue;
					i++;
				} else {
					options.watch = true;
				}
				break;
			}
			case "--slow-query-threshold":
				options.slowQueryThreshold = Number.parseInt(args[++i], 10);
				break;
			case "--min-index-scans":
				options.minIndexScans = Number.parseInt(args[++i], 10);
				break;
			case "--help":
				options.help = true;
				break;
			case "--json":
			case "-j":
				options.json = true;
				break;
			case "--quiet":
			case "-q":
				options.quiet = true;
				break;
			case "--command":
			case "-c":
				options.command = args[++i];
				break;
			case "--interactive":
			case "-i":
			case "start":
				options.interactive = true;
				break;
		}
	}

	if (options.help) {
		printHelp();
		process.exit(0);
	}

	try {
		const configFile = loadConfig(options.configPath);
		const profile = resolveProfile(configFile, options.profile);
		const preferProfile = Boolean(options.profile);
		const watchInterval = parseWatchInterval(options.watch);
		if (watchInterval !== undefined && options.json) {
			throw new Error("--watch cannot be combined with --json.");
		}
		const analyzerOptions: AnalyzerOptions = {
			slowQueryThresholdMs:
				options.slowQueryThreshold ?? configFile.slowQueryThreshold ?? 100,
			minIndexScans: options.minIndexScans ?? configFile.minIndexScans ?? 50,
			topQueriesLimit: 50,
			outputDir: options.output ?? configFile.output ?? "./reports",
			schemas: parseListOption(options.schemas),
			tables: parseListOption(options.tables),
			thresholds: configFile.thresholds,
		};

		const envSsl =
			process.env.DB_SSL === "true" || process.env.PGSSLMODE === "require"
				? true
				: undefined;
		const envPort = process.env.DB_PORT ?? process.env.PGPORT;
		const resolvedSsl = resolveValue(
			options.ssl,
			envSsl,
			profile.ssl,
			false,
			preferProfile,
		);

		const config: DatabaseConfig = {
			host: resolveValue(
				options.host,
				process.env.DB_HOST ?? process.env.PGHOST,
				profile.host,
				"localhost",
				preferProfile,
			),
			port: resolveValue(
				options.port,
				envPort ? Number.parseInt(envPort, 10) : undefined,
				profile.port,
				5432,
				preferProfile,
			),
			database: resolveValue(
				options.database,
				process.env.DB_NAME ?? process.env.PGDATABASE,
				profile.database,
				"postgres",
				preferProfile,
			),
			user: resolveValue(
				options.user,
				process.env.DB_USER ?? process.env.PGUSER,
				profile.user,
				"postgres",
				preferProfile,
			),
			password: resolveValue(
				options.password,
				process.env.DB_PASSWORD ?? process.env.PGPASSWORD,
				profile.password,
				"",
				preferProfile,
			),
			ssl: resolvedSsl ? { rejectUnauthorized: false } : undefined,
		};

		if (options.interactive) {
			const pool = new Pool({
				host: config.host,
				port: config.port,
				database: config.database,
				user: config.user,
				password: config.password,
				ssl: config.ssl,
			});

			try {
				const interactive = new InteractiveCLI(pool, analyzerOptions);
				await interactive.start();
			} finally {
				await pool.end();
			}
			return;
		}

		const log = options.quiet || options.json ? () => {} : console.log;
		log(
			`\nConnecting to PostgreSQL at ${config.host}:${config.port}/${config.database}...`,
		);

		const analyzer = new DatabaseAnalyzer(config, analyzerOptions);

		try {
			if (watchInterval !== undefined) {
				await runWatchLoop({
					intervalSeconds: watchInterval,
					command: options.command ?? "full",
					runCommand: () =>
						executeAnalyzerCommand(analyzer, options, analyzerOptions, log),
				});
				return;
			}

			await executeAnalyzerCommand(analyzer, options, analyzerOptions, log);
		} finally {
			await analyzer.close();
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.json) {
			console.log(JSON.stringify({ success: false, error: message }));
		} else {
			console.error("Error during analysis:", message);
		}
		process.exit(1);
	}
}

async function executeAnalyzerCommand(
	analyzer: DatabaseAnalyzer,
	options: {
		json?: boolean;
		command?: string;
		compare?: string;
		html?: boolean;
	},
	analyzerOptions: AnalyzerOptions,
	log: (...args: unknown[]) => void,
): Promise<void> {
	if (options.command && options.command !== "full") {
		const result = await runCommand(analyzer, options.command);
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const report = await analyzer.analyze();

	if (options.compare) {
		const previous = loadPreviousReport(options.compare);
		DiffReporter.print(
			DiffReporter.diff(report, previous, analyzerOptions.thresholds),
			options.json ? console.error : console.log,
		);
	}

	if (options.json) {
		const output = {
			success: true,
			report,
			summary: {
				healthScore: calculateHealthScore(report, analyzerOptions.thresholds),
				databaseSize: report.metrics.databaseSize,
				cacheHitRatio: report.metrics.cacheHitRatio,
				indexHitRatio: report.metrics.indexHitRatio,
				unusedIndexesCount: report.unusedIndexes.length,
				missingIndexesCount: report.missingIndexes.length,
				duplicateIndexesCount: report.duplicateIndexes.length,
				slowQueriesCount: report.slowQueries.length,
				bloatedTablesCount: report.bloatedTables.length,
			},
			recommendations: report.recommendations,
		};
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	analyzer.printSummary(report);

	log("\nGenerating reports...");
	const { markdown, json, html } = await analyzer.generateReport(report, {
		html: options.html,
	});

	log("\nReports generated:");
	log(`  - Markdown: ${markdown}`);
	log(`  - JSON: ${json}`);
	if (html) {
		log(`  - HTML: ${html}`);
	}

	log("\n--- Additional Information ---\n");

	const fkWithoutIndexes = await analyzer.getForeignKeysWithoutIndexes();
	if (fkWithoutIndexes.length > 0) {
		log(`Foreign keys without indexes: ${fkWithoutIndexes.length}`);
		for (const fk of fkWithoutIndexes.slice(0, 5)) {
			log(
				`  - ${fk.table}.${fk.column} -> ${fk.foreignTable}.${fk.foreignColumn}`,
			);
			log(`    Suggested: ${fk.suggestedIndex}`);
		}
		if (fkWithoutIndexes.length > 5) {
			log(`  ... and ${fkWithoutIndexes.length - 5} more`);
		}
	}

	const longRunning = await analyzer.getLongRunningQueries();
	if (longRunning.length > 0) {
		log(`\nLong running queries: ${longRunning.length}`);
		for (const query of longRunning.slice(0, 3)) {
			log(
				`  - PID ${query.pid}: ${query.duration} - ${query.query.substring(0, 50)}...`,
			);
		}
	}

	const blocking = await analyzer.getBlockingQueries();
	if (blocking.length > 0) {
		log(`\nBlocking queries detected: ${blocking.length}`);
		for (const entry of blocking) {
			log(`  - PID ${entry.blockingPid} blocking PID ${entry.blockedPid}`);
		}
	}

	log("\nAnalysis complete!");
}

function loadPreviousReport(comparePath: string): FullReport {
	if (!existsSync(comparePath)) {
		throw new Error(`Compare report not found: ${comparePath}`);
	}

	try {
		const parsed = JSON.parse(readFileSync(comparePath, "utf-8")) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"report" in parsed &&
			parsed.report
		) {
			return parsed.report as FullReport;
		}

		return parsed as FullReport;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not parse compare report at ${comparePath}: ${message}`,
		);
	}
}

function parseListOption(value?: string): string[] | undefined {
	const entries = value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	return entries && entries.length > 0 ? entries : undefined;
}

function parseWatchInterval(watch?: boolean | string): number | undefined {
	if (watch === undefined) {
		return undefined;
	}

	const intervalSeconds =
		watch === true ? 30 : Number.parseInt(String(watch), 10);

	if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
		throw new Error(`Invalid watch interval: ${watch}`);
	}

	return intervalSeconds;
}

function resolveValue<T>(
	cliValue: T | undefined,
	envValue: T | undefined,
	profileValue: T | undefined,
	fallbackValue: T,
	preferProfile: boolean,
): T {
	if (cliValue !== undefined) {
		return cliValue;
	}

	if (preferProfile) {
		return profileValue ?? envValue ?? fallbackValue;
	}

	return envValue ?? profileValue ?? fallbackValue;
}

async function runCommand(
	analyzer: DatabaseAnalyzer,
	command: string,
): Promise<unknown> {
	switch (command) {
		case "indexes":
		case "unused-indexes":
			return { unusedIndexes: await analyzer.getIndexUsageSummary() };

		case "missing-indexes": {
			const report = await analyzer.analyze();
			return { missingIndexes: report.missingIndexes };
		}

		case "fk-without-indexes":
			return {
				foreignKeysWithoutIndexes:
					await analyzer.getForeignKeysWithoutIndexes(),
			};

		case "slow-queries":
		case "query-stats": {
			const queryStats = await analyzer.getAllQueryStats(10, 50);
			return {
				queryStats,
				summary: {
					totalQueries: queryStats.length,
					totalCalls: queryStats.reduce((acc, q) => acc + q.calls, 0),
					totalTimeMs: queryStats.reduce((acc, q) => acc + q.totalTime, 0),
					topByTotalTime: queryStats.slice(0, 10).map((q) => ({
						query: q.queryPreview,
						calls: q.calls,
						totalMs: q.totalTime,
						meanMs: q.meanTime,
						maxMs: q.maxTime,
					})),
				},
			};
		}

		case "long-running":
			return { longRunningQueries: await analyzer.getLongRunningQueries() };

		case "blocking":
			return { blockingQueries: await analyzer.getBlockingQueries() };

		case "tables":
		case "largest-tables":
			return { largestTables: await analyzer.getLargestTables() };

		case "vacuum-needed":
			return { tablesNeedingVacuum: await analyzer.getTablesNeedingVacuum() };

		case "connections":
			return { connectionStats: await analyzer.getConnectionStats() };

		case "config":
			return {
				configurationSettings: await analyzer.getConfigurationSettings(),
			};

		case "extensions":
			return { extensions: await analyzer.getExtensions() };

		case "health": {
			const healthReport = await analyzer.analyze();
			return {
				healthScore: calculateHealthScore(healthReport),
				metrics: healthReport.metrics,
				issues: healthReport.recommendations,
			};
		}

		case "run-vacuum":
		case "vacuum-run":
		case "auto-vacuum": {
			console.log("Running VACUUM ANALYZE on tables that need it...\n");
			const summary = await analyzer.autoVacuum({
				analyze: true,
				onProgress: (result, index, total) => {
					const status = result.success ? "✓" : "✗";
					console.log(
						`  [${index}/${total}] ${status} ${result.schema}.${result.table}`,
					);
				},
			});
			return {
				vacuumSummary: summary,
				message:
					summary.totalTables === 0
						? "No tables need VACUUM"
						: `Vacuumed ${summary.successful}/${summary.totalTables} tables in ${summary.totalDuration}ms`,
			};
		}

		case "create-pg-stat-statements":
		case "enable-pg-stat-statements": {
			return await analyzer.createPgStatStatements();
		}

		case "drop-pg-stat-statements":
		case "disable-pg-stat-statements": {
			return await analyzer.dropPgStatStatements();
		}

		case "generate-drop-sql":
		case "drop-indexes-sql": {
			const report = await analyzer.analyze();
			const dropStatements = report.unusedIndexes.map((idx) => ({
				index: `${idx.schema}.${idx.index}`,
				table: idx.table,
				size: idx.size,
				scans: idx.indexScans,
				sql: `DROP INDEX ${idx.schema}.${idx.index};`,
			}));
			const totalSize = report.unusedIndexes.reduce(
				(acc, idx) => acc + idx.sizeBytes,
				0,
			);
			return {
				summary: {
					totalIndexes: dropStatements.length,
					totalSizeBytes: totalSize,
					totalSizeFormatted: formatBytes(totalSize),
				},
				dropStatements,
				combinedSql: dropStatements.map((d) => d.sql).join("\n"),
			};
		}

		case "server-info": {
			return { serverInfo: await analyzer.getServerInfo() };
		}

		default:
			return await analyzer.analyze();
	}
}

function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let unitIndex = 0;
	let size = bytes;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function printHelp() {
	console.log(`
PostgreSQL Database Analyzer (AI-friendly)
===========================================

Analyzes PostgreSQL databases to identify:
- Unused indexes that can be removed
- Missing indexes (tables with high sequential scans)
- Duplicate/overlapping indexes
- Slow queries
- Table bloat
- Database health metrics

Usage:
  npx ts-node index.ts [options]

Connection Options:
  -h, --host <host>          Database host (env: DB_HOST/PGHOST)
  -p, --port <port>          Database port (env: DB_PORT/PGPORT)
  -d, --database <name>      Database name (env: DB_NAME/PGDATABASE)
  -U, --user <user>          Database user (env: DB_USER/PGUSER)
  -W, --password <pass>      Database password (env: DB_PASSWORD/PGPASSWORD)
  --ssl                      Enable SSL (env: DB_SSL=true)
  --profile <name>           Use named profile from .analyzerrc.json
  --config <path>            Use a custom config file path

Analysis Options:
  --slow-query-threshold <ms>  Slow query threshold in ms (default: 100)
  --min-index-scans <n>        Min scans to consider index "used" (default: 50)
  --schemas <list>             Comma-separated schemas to analyze
  --tables <list>              Comma-separated tables to analyze
  --compare <path>             Compare against a previous JSON report
  --watch [seconds]            Watch mode (default interval: 30s)

Output Options:
  -o, --output <dir>         Output directory for reports (default: ./reports)
  -j, --json                 Output JSON to stdout (for AI/programmatic use)
  --html                     Also generate an HTML report
  -q, --quiet                Suppress non-essential output
  -i, --interactive          Interactive mode with menu
  start                      Alias for --interactive

AI/Programmatic Commands:
  -c, --command <cmd>        Run specific analysis command

Available Commands:
  full              Full analysis (default)
  health            Health score and metrics only
  indexes           Index usage summary
  unused-indexes    Unused indexes
  missing-indexes   Tables needing indexes
  fk-without-indexes  Foreign keys without indexes
  slow-queries      Query statistics from pg_stat_statements (alias: query-stats)
  long-running      Currently long-running queries
  blocking          Currently blocking queries
  tables            Largest tables
  vacuum-needed     Tables needing VACUUM
  run-vacuum        Run VACUUM ANALYZE on tables that need it (auto-vacuum)
  connections       Connection statistics
  config            PostgreSQL configuration
  extensions        Installed extensions
  server-info       PostgreSQL server info (version, uptime)
  generate-drop-sql Generate DROP INDEX SQL for unused indexes
  create-pg-stat-statements   Create pg_stat_statements extension
  drop-pg-stat-statements     Drop pg_stat_statements extension

Note: slow-queries requires pg_stat_statements extension and sufficient privileges.
      Connect with a superuser or role with pg_read_all_stats to see full query text.

Examples:

  # Full analysis with human-readable output
  pnpm analyze

  # Full analysis with JSON output (for AI)
  npx ts-node index.ts --json

  # Specific command with JSON (for AI)
  npx ts-node index.ts -j -c health
  npx ts-node index.ts -j -c unused-indexes
  npx ts-node index.ts -j -c slow-queries

  # Check health score only
  npx ts-node index.ts --json --command health

  # Get blocking queries (useful for debugging)
  npx ts-node index.ts -j -c blocking

  # Generate HTML output
  npx ts-node index.ts --html -c full

  # Compare with a previous JSON snapshot
  npx ts-node index.ts --compare ./reports/db-analysis-previous.json

  # Watch health output
  npx ts-node index.ts -c health --watch 10

AI Integration:
  Use --json flag for structured output that AI can parse.
  Use --command for specific analyses to reduce output size.
  Output is always valid JSON when --json is specified.
`);
}

// Export for programmatic use
export { DatabaseAnalyzer };
export type { AnalysisReport, AnalyzerOptions, DatabaseConfig };

// Run only if called directly (not when imported as a module)
if (require.main === module) {
	main().catch(console.error);
}
