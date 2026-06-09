import { checkbox, confirm, select } from "@inquirer/prompts";
import type { Pool } from "pg";
import { IndexAnalyzer } from "./analyzers/index-analyzer";
import { QueryAnalyzer } from "./analyzers/query-analyzer";
import { TableAnalyzer } from "./analyzers/table-analyzer";
import { StatsCollector } from "./collectors/stats-collector";
import { ReportGenerator } from "./reporters/report-generator";
import type { AnalyzerOptions } from "./types";

interface AnalysisModule {
	name: string;
	value: string;
	description: string;
}

const ANALYSIS_MODULES: AnalysisModule[] = [
	{
		name: "Health Score",
		value: "health",
		description: "Database health metrics and score",
	},
	{
		name: "Unused Indexes",
		value: "unused-indexes",
		description: "Indexes that are rarely or never used",
	},
	{
		name: "Missing Indexes",
		value: "missing-indexes",
		description: "Tables with high sequential scans",
	},
	{
		name: "Duplicate Indexes",
		value: "duplicate-indexes",
		description: "Overlapping or duplicate indexes",
	},
	{
		name: "FK Without Indexes",
		value: "fk-indexes",
		description: "Foreign keys without indexes",
	},
	{
		name: "Slow Queries",
		value: "slow-queries",
		description: "Queries with high execution time",
	},
	{
		name: "Long Running Queries",
		value: "long-running",
		description: "Currently running long queries",
	},
	{
		name: "Blocking Queries",
		value: "blocking",
		description: "Queries blocking other queries",
	},
	{
		name: "Table Statistics",
		value: "tables",
		description: "Largest tables and their stats",
	},
	{
		name: "Tables Needing VACUUM",
		value: "vacuum",
		description: "Tables with high dead tuple ratio",
	},
	{
		name: "Connection Stats",
		value: "connections",
		description: "Database connection statistics",
	},
	{
		name: "PostgreSQL Config",
		value: "config",
		description: "Important configuration settings",
	},
	{
		name: "Extensions",
		value: "extensions",
		description: "Installed PostgreSQL extensions",
	},
	{
		name: "Run VACUUM",
		value: "run-vacuum",
		description: "Execute VACUUM ANALYZE on tables that need it",
	},
	{
		name: "Enable pg_stat_statements",
		value: "create-pg-stat-statements",
		description: "Create pg_stat_statements extension for query analysis",
	},
	{
		name: "Disable pg_stat_statements",
		value: "drop-pg-stat-statements",
		description: "Drop pg_stat_statements extension",
	},
];

export class InteractiveCLI {
	private pool: Pool;
	private indexAnalyzer: IndexAnalyzer;
	private queryAnalyzer: QueryAnalyzer;
	private tableAnalyzer: TableAnalyzer;
	private statsCollector: StatsCollector;
	private reportGenerator: ReportGenerator;

	constructor(pool: Pool, options: AnalyzerOptions = {}) {
		this.pool = pool;
		this.indexAnalyzer = new IndexAnalyzer(pool, options);
		this.queryAnalyzer = new QueryAnalyzer(pool, options);
		this.tableAnalyzer = new TableAnalyzer(pool, options);
		this.statsCollector = new StatsCollector(pool, options);
		this.reportGenerator = new ReportGenerator(
			options.outputDir ?? "./reports",
		);
	}

	async start(): Promise<void> {
		console.clear();
		console.log(
			"╔════════════════════════════════════════════════════════════╗",
		);
		console.log(
			"║         PostgreSQL Database Analyzer - Interactive         ║",
		);
		console.log(
			"╚════════════════════════════════════════════════════════════╝\n",
		);

		const dbNameResult = await this.pool.query(
			"SELECT current_database(), version()",
		);
		const dbName = dbNameResult.rows[0].current_database;
		const version = dbNameResult.rows[0].version
			.split(" ")
			.slice(0, 2)
			.join(" ");
		console.log(`Connected to: ${dbName} (${version})\n`);

		let continueLoop = true;

		while (continueLoop) {
			const action = await select({
				message: "What would you like to do?",
				choices: [
					{ name: "🔍 Quick Analysis (select modules)", value: "quick" },
					{ name: "📊 Full Analysis (all modules)", value: "full" },
					{ name: "⚡ Health Check Only", value: "health" },
					{ name: "🧹 Run VACUUM", value: "vacuum" },
					{ name: "🔎 Single Module Analysis", value: "single" },
					{ name: "📋 Generate Report", value: "report" },
					{ name: "❌ Exit", value: "exit" },
				],
			});

			switch (action) {
				case "quick":
					await this.runQuickAnalysis();
					break;
				case "full":
					await this.runFullAnalysis();
					break;
				case "health":
					await this.runHealthCheck();
					break;
				case "vacuum":
					await this.runVacuumFromMenu();
					break;
				case "single":
					await this.runSingleModule();
					break;
				case "report":
					await this.generateFullReport();
					break;
				case "exit":
					continueLoop = false;
					break;
			}

			if (continueLoop && action !== "exit") {
				continueLoop = await confirm({
					message: "Would you like to continue?",
					default: true,
				});
			}
		}

		console.log("\nGoodbye!\n");
	}

	private async runQuickAnalysis(): Promise<void> {
		const selected = await checkbox({
			message: "Select analysis modules:",
			choices: ANALYSIS_MODULES.map((m) => ({
				name: `${m.name} - ${m.description}`,
				value: m.value,
			})),
		});

		if (selected.length === 0) {
			console.log("\nNo modules selected.\n");
			return;
		}

		console.log("\n");
		for (const module of selected) {
			await this.runModule(module);
			console.log("");
		}
	}

	private async runFullAnalysis(): Promise<void> {
		console.log("\n🔄 Running full analysis...\n");

		const modules = [
			"health",
			"unused-indexes",
			"missing-indexes",
			"slow-queries",
			"tables",
			"vacuum",
		];
		for (const module of modules) {
			await this.runModule(module);
			console.log("");
		}
	}

	private async runHealthCheck(): Promise<void> {
		console.log("\n⚡ Running health check...\n");
		await this.runModule("health");
	}

	private async runVacuumFromMenu(): Promise<void> {
		console.log("\n🧹 Running VACUUM...\n");
		await this.runModule("run-vacuum");
	}

	private async runSingleModule(): Promise<void> {
		const module = await select({
			message: "Select analysis module:",
			choices: ANALYSIS_MODULES.map((m) => ({
				name: `${m.name} - ${m.description}`,
				value: m.value,
			})),
		});

		console.log("\n");
		await this.runModule(module);
	}

	private async runModule(module: string): Promise<void> {
		const moduleName =
			ANALYSIS_MODULES.find((m) => m.value === module)?.name ?? module;
		console.log(`━━━ ${moduleName} ━━━`);

		try {
			switch (module) {
				case "health":
					await this.showHealth();
					break;
				case "unused-indexes":
					await this.showUnusedIndexes();
					break;
				case "missing-indexes":
					await this.showMissingIndexes();
					break;
				case "duplicate-indexes":
					await this.showDuplicateIndexes();
					break;
				case "fk-indexes":
					await this.showFKWithoutIndexes();
					break;
				case "slow-queries":
					await this.showSlowQueries();
					break;
				case "long-running":
					await this.showLongRunning();
					break;
				case "blocking":
					await this.showBlocking();
					break;
				case "tables":
					await this.showTableStats();
					break;
				case "vacuum":
					await this.showVacuumNeeded();
					break;
				case "connections":
					await this.showConnections();
					break;
				case "config":
					await this.showConfig();
					break;
				case "extensions":
					await this.showExtensions();
					break;
				case "run-vacuum":
					await this.runVacuum();
					break;
				case "create-pg-stat-statements":
					await this.createPgStatStatements();
					break;
				case "drop-pg-stat-statements":
					await this.dropPgStatStatements();
					break;
			}
		} catch (error) {
			console.log(`  ❌ Error: ${error}`);
		}
	}

	private async showHealth(): Promise<void> {
		const metrics = await this.statsCollector.getDatabaseMetrics();

		let score = 100;
		if (metrics.cacheHitRatio < 90) score -= 20;
		else if (metrics.cacheHitRatio < 95) score -= 10;
		if (metrics.indexHitRatio < 90) score -= 15;
		if (metrics.deadTuplesRatio > 10) score -= 15;

		const status =
			score >= 90
				? "🟢 Excellent"
				: score >= 70
					? "🟡 Good"
					: score >= 50
						? "🟠 Warning"
						: "🔴 Critical";

		console.log(`  Health Score: ${score}/100 ${status}`);
		console.log(`  Database Size: ${metrics.databaseSize}`);
		console.log(`  Cache Hit Ratio: ${metrics.cacheHitRatio}%`);
		console.log(`  Index Hit Ratio: ${metrics.indexHitRatio}%`);
		console.log(`  Dead Tuples Ratio: ${metrics.deadTuplesRatio}%`);
		console.log(
			`  Connections: ${metrics.activeConnections} active / ${metrics.totalConnections} total`,
		);
	}

	private async showUnusedIndexes(): Promise<void> {
		const indexes = await this.indexAnalyzer.getUnusedIndexes();
		if (indexes.length === 0) {
			console.log("  ✅ No unused indexes found");
			return;
		}

		console.log(`  Found ${indexes.length} unused indexes:`);
		const totalSize = indexes.reduce((acc, idx) => acc + idx.sizeBytes, 0);
		console.log(`  Total wasted space: ${this.formatBytes(totalSize)}`);
		console.log("");

		for (const idx of indexes.slice(0, 10)) {
			console.log(`  • ${idx.schema}.${idx.index} (${idx.size})`);
			console.log(`    Table: ${idx.table}, Scans: ${idx.indexScans}`);
		}

		if (indexes.length > 10) {
			console.log(`  ... and ${indexes.length - 10} more`);
		}
	}

	private async showMissingIndexes(): Promise<void> {
		const tables = await this.indexAnalyzer.getMissingIndexes();
		if (tables.length === 0) {
			console.log("  ✅ No tables with missing indexes detected");
			return;
		}

		console.log(`  Found ${tables.length} tables that may need indexes:`);
		console.log("");

		for (const table of tables.slice(0, 10)) {
			console.log(`  • ${table.schema}.${table.table}`);
			console.log(
				`    Sequential scans: ${table.seqScans}, Benefit: ${table.estimatedBenefit}`,
			);
		}

		if (tables.length > 10) {
			console.log(`  ... and ${tables.length - 10} more`);
		}
	}

	private async showDuplicateIndexes(): Promise<void> {
		const duplicates = await this.indexAnalyzer.getDuplicateIndexes();
		if (duplicates.length === 0) {
			console.log("  ✅ No duplicate indexes found");
			return;
		}

		console.log(
			`  Found ${duplicates.length} duplicate/overlapping index pairs:`,
		);
		console.log("");

		for (const dup of duplicates.slice(0, 5)) {
			console.log(`  • ${dup.schema}.${dup.table}`);
			console.log(`    ${dup.index1} vs ${dup.index2}`);
			console.log(`    ${dup.recommendation}`);
		}
	}

	private async showFKWithoutIndexes(): Promise<void> {
		const fks = await this.indexAnalyzer.getForeignKeysWithoutIndexes();
		if (fks.length === 0) {
			console.log("  ✅ All foreign keys have indexes");
			return;
		}

		console.log(`  Found ${fks.length} foreign keys without indexes:`);
		console.log("");

		for (const fk of fks.slice(0, 10)) {
			console.log(
				`  • ${fk.table}.${fk.column} → ${fk.foreignTable}.${fk.foreignColumn}`,
			);
		}
	}

	private async showSlowQueries(): Promise<void> {
		const queries = await this.queryAnalyzer.getAllQueryStats(10, 10);
		if (queries.length === 0) {
			console.log(
				"  ⚠️  No query statistics available (pg_stat_statements required)",
			);
			return;
		}

		console.log(`  Top ${queries.length} queries by total time:`);
		console.log("");

		for (let i = 0; i < queries.length; i++) {
			const q = queries[i];
			console.log(`  ${i + 1}. ${q.queryPreview?.substring(0, 60)}...`);
			console.log(
				`     Calls: ${q.calls}, Total: ${q.totalTime.toFixed(0)}ms, Mean: ${q.meanTime.toFixed(2)}ms`,
			);
		}
	}

	private async showLongRunning(): Promise<void> {
		const queries = await this.queryAnalyzer.getLongRunningQueries();
		if (queries.length === 0) {
			console.log("  ✅ No long-running queries");
			return;
		}

		console.log(`  Found ${queries.length} long-running queries:`);
		console.log("");

		for (const q of queries) {
			console.log(`  • PID ${q.pid}: ${q.duration}`);
			console.log(`    ${q.query.substring(0, 60)}...`);
		}
	}

	private async showBlocking(): Promise<void> {
		const blocks = await this.queryAnalyzer.getBlockingQueries();
		if (blocks.length === 0) {
			console.log("  ✅ No blocking queries");
			return;
		}

		console.log(`  ⚠️  Found ${blocks.length} blocking situations:`);
		console.log("");

		for (const b of blocks) {
			console.log(`  • PID ${b.blockingPid} blocking PID ${b.blockedPid}`);
			console.log(`    Duration: ${b.blockedDuration}`);
		}
	}

	private async showTableStats(): Promise<void> {
		const tables = await this.tableAnalyzer.getLargestTables(10);
		console.log(`  Top ${tables.length} largest tables:`);
		console.log("");

		for (const t of tables) {
			console.log(`  • ${t.schema}.${t.table}: ${t.totalSize}`);
			console.log(
				`    Rows: ${t.rowCount.toLocaleString()}, Table: ${t.tableSize}, Index: ${t.indexSize}`,
			);
		}
	}

	private async showVacuumNeeded(): Promise<void> {
		const tables = await this.tableAnalyzer.getTablesNeedingVacuum();
		if (tables.length === 0) {
			console.log("  ✅ No tables urgently need VACUUM");
			return;
		}

		console.log(`  Found ${tables.length} tables needing VACUUM:`);
		console.log("");

		for (const t of tables.slice(0, 10)) {
			console.log(`  • ${t.schema}.${t.table}`);
			console.log(
				`    Dead tuples: ${t.deadTuples.toLocaleString()} (${t.deadTupleRatio}%)`,
			);
		}
	}

	private async showConnections(): Promise<void> {
		const stats = await this.statsCollector.getConnectionStats();
		console.log(`  Total: ${stats.total}`);
		console.log(`  Active: ${stats.active}`);
		console.log(`  Idle: ${stats.idle}`);
		console.log(`  Idle in transaction: ${stats.idleInTransaction}`);
	}

	private async showConfig(): Promise<void> {
		const config = await this.statsCollector.getConfigurationSettings();
		console.log("  Important settings:");
		console.log("");

		for (const c of config.slice(0, 15)) {
			console.log(`  • ${c.name}: ${c.setting}`);
		}
	}

	private async showExtensions(): Promise<void> {
		const extensions = await this.statsCollector.getExtensions();
		console.log(`  Installed extensions (${extensions.length}):`);
		console.log("");

		for (const ext of extensions) {
			console.log(`  • ${ext.name} v${ext.version}`);
		}
	}

	private async createPgStatStatements(): Promise<void> {
		const existsResult = await this.pool.query(
			"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
		);

		if (existsResult.rows.length > 0) {
			console.log("  ✅ pg_stat_statements extension already exists");
			return;
		}

		const shouldProceed = await confirm({
			message: "Create pg_stat_statements extension?",
			default: true,
		});

		if (!shouldProceed) {
			console.log("  ⏭️  Skipped");
			return;
		}

		try {
			await this.pool.query(
				"CREATE EXTENSION IF NOT EXISTS pg_stat_statements",
			);
			console.log("  ✅ pg_stat_statements extension created successfully");
		} catch (error) {
			console.log(`  ❌ Failed to create extension: ${error}`);
		}
	}

	private async dropPgStatStatements(): Promise<void> {
		const existsResult = await this.pool.query(
			"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
		);

		if (existsResult.rows.length === 0) {
			console.log("  ⚠️  pg_stat_statements extension does not exist");
			return;
		}

		const shouldProceed = await confirm({
			message:
				"Drop pg_stat_statements extension? This will remove all query statistics.",
			default: false,
		});

		if (!shouldProceed) {
			console.log("  ⏭️  Skipped");
			return;
		}

		try {
			await this.pool.query("DROP EXTENSION IF EXISTS pg_stat_statements");
			console.log("  ✅ pg_stat_statements extension dropped successfully");
		} catch (error) {
			console.log(`  ❌ Failed to drop extension: ${error}`);
		}
	}

	private async runVacuum(): Promise<void> {
		const tables = await this.tableAnalyzer.getTablesNeedingVacuum();

		if (tables.length === 0) {
			console.log("  ✅ No tables need VACUUM");
			return;
		}

		console.log(`  Found ${tables.length} tables needing VACUUM:`);
		console.log("");

		for (const t of tables) {
			console.log(
				`  • ${t.schema}.${t.table} (${t.deadTuples.toLocaleString()} dead tuples, ${t.deadTupleRatio}%)`,
			);
		}

		console.log("");

		const shouldProceed = await confirm({
			message: `Run VACUUM ANALYZE on ${tables.length} tables?`,
			default: false,
		});

		if (!shouldProceed) {
			console.log("  ⏭️  Skipped");
			return;
		}

		const useFullVacuum = await confirm({
			message:
				"Use VACUUM FULL? (locks tables but reclaims more space, use during maintenance)",
			default: false,
		});

		console.log("");
		console.log(
			`  🔄 Running VACUUM ${useFullVacuum ? "FULL " : ""}ANALYZE...`,
		);
		console.log("");

		const summary = await this.tableAnalyzer.autoVacuum({
			analyze: true,
			full: useFullVacuum,
			onProgress: (result, index, total) => {
				const status = result.success ? "✓" : "✗";
				const duration = `${result.duration}ms`;
				console.log(
					`  [${index}/${total}] ${status} ${result.schema}.${result.table} (${duration})`,
				);
				if (!result.success && result.error) {
					console.log(`         Error: ${result.error}`);
				}
			},
		});

		console.log("");
		console.log(
			`  ✅ Completed: ${summary.successful}/${summary.totalTables} tables`,
		);
		console.log(`  ⏱️  Total time: ${summary.totalDuration}ms`);

		if (summary.failed > 0) {
			console.log(`  ⚠️  Failed: ${summary.failed} tables`);
		}
	}

	private async generateFullReport(): Promise<void> {
		console.log("\n📋 Generating full report...\n");

		const [
			metrics,
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
			tableStats,
			slowQueries,
			bloatedTables,
		] = await Promise.all([
			this.statsCollector.getDatabaseMetrics(),
			this.indexAnalyzer.getUnusedIndexes(),
			this.indexAnalyzer.getMissingIndexes(),
			this.indexAnalyzer.getDuplicateIndexes(),
			this.tableAnalyzer.getTableStats(),
			this.queryAnalyzer.getSlowQueries(),
			this.tableAnalyzer.getBloatedTables(),
		]);

		const dbNameResult = await this.pool.query("SELECT current_database()");
		const databaseName = dbNameResult.rows[0].current_database;

		const report = {
			generatedAt: new Date(),
			databaseName,
			metrics,
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
			tableStats,
			slowQueries,
			bloatedTables,
			recommendations: [],
		};

		const [markdown, json] = await Promise.all([
			this.reportGenerator.generateFullReport(report),
			this.reportGenerator.generateJsonReport(report),
		]);

		console.log(`  ✅ Reports generated:`);
		console.log(`     Markdown: ${markdown}`);
		console.log(`     JSON: ${json}`);
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024)
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}
}
