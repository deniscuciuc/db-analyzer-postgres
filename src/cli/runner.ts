import { existsSync, readFileSync } from "node:fs";
import type { Pool } from "pg";

import { IndexAnalyzer } from "../analyzers/index-analyzer";
import { QueryAnalyzer } from "../analyzers/query-analyzer";
import { TableAnalyzer } from "../analyzers/table-analyzer";
import { StatsCollector } from "../collectors/stats-collector";
import { DiffReporter } from "../reporters/diff-reporter";
import { ReportGenerator } from "../reporters/report-generator";
import { calculateHealthScore } from "../thresholds";
import type { AnalysisReport, FullReport } from "../types";
import { formatBytes } from "../utils/format";
import type { ParsedOptions } from "./options";
import { toAnalyzerOptions } from "./options";

interface AnalyzerServices {
	indexes: IndexAnalyzer;
	queries: QueryAnalyzer;
	tables: TableAnalyzer;
	stats: StatsCollector;
	reporter: ReportGenerator;
}

function createServices(pool: Pool, options: ParsedOptions): AnalyzerServices {
	const analyzerOptions = toAnalyzerOptions(options);

	return {
		indexes: new IndexAnalyzer(pool, analyzerOptions),
		queries: new QueryAnalyzer(pool, analyzerOptions),
		tables: new TableAnalyzer(pool, analyzerOptions),
		stats: new StatsCollector(pool, analyzerOptions),
		reporter: new ReportGenerator(options.outputDir, analyzerOptions),
	};
}

export async function buildFullReport(
	pool: Pool,
	options: ParsedOptions,
): Promise<AnalysisReport> {
	const { indexes, queries, tables, stats } = createServices(pool, options);

	const metrics = await stats.getDatabaseMetrics();
	const [unusedIndexes, missingIndexes, duplicateIndexes] = await Promise.all([
		indexes.getUnusedIndexes(),
		indexes.getMissingIndexes(),
		indexes.getDuplicateIndexes(),
	]);
	const [tableStats, bloatedTables, slowQueries] = await Promise.all([
		tables.getTableStats(),
		tables.getBloatedTables(),
		queries.getSlowQueries(),
	]);

	const recommendations = [
		...indexes.generateRecommendations(
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
		),
		...stats.generateMetricsReport(metrics).recommendations,
	];

	const databaseResult = await pool.query("SELECT current_database()");

	return {
		generatedAt: new Date(),
		databaseName: databaseResult.rows[0].current_database,
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

export async function executeCommand(
	pool: Pool,
	options: ParsedOptions,
): Promise<void> {
	const log = options.quiet || options.json ? () => {} : console.log;
	const services = createServices(pool, options);

	if (options.command !== "full") {
		const result = await runCommand(pool, services, options, log);
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const report = await buildFullReport(pool, options);

	if (options.compare) {
		const previous = loadPreviousReport(options.compare);
		DiffReporter.print(
			DiffReporter.diff(report, previous, options.thresholds),
			options.json ? console.error : console.log,
		);
	}

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					success: true,
					report,
					summary: {
						healthScore: calculateHealthScore(report, options.thresholds),
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
				},
				null,
				2,
			),
		);
		return;
	}

	services.reporter.printSummary(report);

	log("\nGenerating reports...");
	const [markdown, json, html] = await Promise.all([
		services.reporter.generateFullReport(report),
		services.reporter.generateJsonReport(report),
		options.html ? services.reporter.generateHtmlReport(report) : undefined,
	]);

	log("\nReports generated:");
	log(`  - Markdown: ${markdown}`);
	log(`  - JSON: ${json}`);
	if (html) {
		log(`  - HTML: ${html}`);
	}

	log("\n--- Additional Information ---\n");

	const fkWithoutIndexes =
		await services.indexes.getForeignKeysWithoutIndexes();
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

	const longRunning = await services.queries.getLongRunningQueries();
	if (longRunning.length > 0) {
		log(`\nLong running queries: ${longRunning.length}`);
		for (const query of longRunning.slice(0, 3)) {
			log(
				`  - PID ${query.pid}: ${query.duration} - ${query.query.substring(0, 50)}...`,
			);
		}
	}

	const blocking = await services.queries.getBlockingQueries();
	if (blocking.length > 0) {
		log(`\nBlocking queries detected: ${blocking.length}`);
		for (const entry of blocking) {
			log(`  - PID ${entry.blockingPid} blocking PID ${entry.blockedPid}`);
		}
	}

	log("\nAnalysis complete!");
}

async function runCommand(
	pool: Pool,
	services: AnalyzerServices,
	options: ParsedOptions,
	log: (...args: unknown[]) => void,
): Promise<unknown> {
	switch (options.command) {
		case "unused-indexes":
			return { unusedIndexes: await services.indexes.getUnusedIndexes() };
		case "missing-indexes": {
			const report = await buildFullReport(pool, options);
			return { missingIndexes: report.missingIndexes };
		}
		case "fk-without-indexes":
			return {
				foreignKeysWithoutIndexes:
					await services.indexes.getForeignKeysWithoutIndexes(),
			};
		case "slow-queries":
			return { slowQueries: await services.queries.getSlowQueries() };
		case "long-running":
			return {
				longRunningQueries: await services.queries.getLongRunningQueries(),
			};
		case "blocking":
			return { blockingQueries: await services.queries.getBlockingQueries() };
		case "tables":
			return { largestTables: await services.tables.getLargestTables(10) };
		case "vacuum-needed":
			return {
				tablesNeedingVacuum: await services.tables.getTablesNeedingVacuum(),
			};
		case "connections":
			return { connectionStats: await services.stats.getConnectionStats() };
		case "config":
			return {
				configurationSettings: await services.stats.getConfigurationSettings(),
			};
		case "extensions":
			return { extensions: await services.stats.getExtensions() };
		case "health": {
			const report = await buildFullReport(pool, options);
			return {
				healthScore: calculateHealthScore(report, options.thresholds),
				metrics: report.metrics,
				issues: report.recommendations,
			};
		}
		case "run-vacuum": {
			log("Running VACUUM ANALYZE on tables that need it...\n");
			const summary = await services.tables.autoVacuum({
				analyze: true,
				onProgress: (result, index, total) => {
					const status = result.success ? "✓" : "✗";
					log(
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
		case "create-pg-stat-statements": {
			const existsResult = await pool.query(
				"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
			);
			if (existsResult.rows.length > 0) {
				return {
					success: true,
					message: "pg_stat_statements extension already exists",
					alreadyExists: true,
				};
			}
			await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
			return {
				success: true,
				message: "pg_stat_statements extension created successfully",
			};
		}
		case "drop-pg-stat-statements": {
			const existsResult = await pool.query(
				"SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
			);
			if (existsResult.rows.length === 0) {
				return {
					success: true,
					message: "pg_stat_statements extension does not exist",
					notExists: true,
				};
			}
			await pool.query("DROP EXTENSION IF EXISTS pg_stat_statements");
			return {
				success: true,
				message: "pg_stat_statements extension dropped successfully",
			};
		}
		case "generate-drop-sql": {
			const indexes = await services.indexes.getUnusedIndexes();
			const dropStatements = indexes.map((index) => ({
				index: `${index.schema}.${index.index}`,
				table: index.table,
				size: index.size,
				scans: index.indexScans,
				sql:
					index.dropStatement ??
					`DROP INDEX CONCURRENTLY IF EXISTS ${index.schema}.${index.index};`,
			}));
			const totalSize = indexes.reduce(
				(accumulator, index) => accumulator + index.sizeBytes,
				0,
			);
			return {
				summary: {
					totalIndexes: dropStatements.length,
					totalSizeBytes: totalSize,
					totalSizeFormatted: formatBytes(totalSize),
				},
				dropStatements,
				combinedSql: dropStatements.map((entry) => entry.sql).join("\n"),
			};
		}
		case "server-info":
			return { serverInfo: await services.stats.getServerInfo() };
		default:
			return buildFullReport(pool, options);
	}
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
