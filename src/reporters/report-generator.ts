import * as fs from "node:fs";
import * as path from "node:path";
import { calculateHealthScore, resolveThresholds } from "../thresholds";
import type {
	AnalysisReport,
	AnalyzerOptions,
	BloatedTable,
	DatabaseMetrics,
	SlowQuery,
	TableStats,
} from "../types";
import { HtmlReporter } from "./html-reporter";

export class ReportGenerator {
	constructor(
		private outputDir: string = "./reports",
		private options: AnalyzerOptions = {},
	) {}

	async generateFullReport(
		report: AnalysisReport,
		timestamp?: string,
	): Promise<string> {
		const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `db-analysis-${ts}.md`;
		const filepath = path.join(this.outputDir, filename);

		const content = this.buildMarkdownReport(report);

		await this.ensureOutputDir();
		fs.writeFileSync(filepath, content);

		return filepath;
	}

	async generateJsonReport(
		report: AnalysisReport,
		timestamp?: string,
	): Promise<string> {
		const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `db-analysis-${ts}.json`;
		const filepath = path.join(this.outputDir, filename);

		await this.ensureOutputDir();
		fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

		return filepath;
	}

	async generateHtmlReport(
		report: AnalysisReport,
		timestamp?: string,
	): Promise<string> {
		const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `db-analysis-${ts}.html`;
		const filepath = path.join(this.outputDir, filename);

		await this.ensureOutputDir();
		fs.writeFileSync(
			filepath,
			HtmlReporter.generate(report, this.options.thresholds),
		);

		return filepath;
	}

	private async ensureOutputDir(): Promise<void> {
		if (!fs.existsSync(this.outputDir)) {
			fs.mkdirSync(this.outputDir, { recursive: true });
		}
	}

	private buildMarkdownReport(report: AnalysisReport): string {
		const sections: string[] = [];

		sections.push(this.buildHeader(report));
		sections.push(this.buildExecutiveSummary(report));
		sections.push(this.buildMetricsSection(report.metrics));
		sections.push(this.buildIndexAnalysisSection(report));
		sections.push(this.buildTableAnalysisSection(report.tableStats));
		sections.push(this.buildSlowQueriesSection(report.slowQueries));
		sections.push(this.buildBloatSection(report.bloatedTables));
		sections.push(this.buildRecommendationsSection(report.recommendations));

		return sections.join("\n\n");
	}

	private buildHeader(report: AnalysisReport): string {
		return `# Database Analysis Report

**Database:** ${report.databaseName}
**Generated:** ${report.generatedAt.toISOString()}
**Tool:** PostgreSQL Database Analyzer

---`;
	}

	private buildExecutiveSummary(report: AnalysisReport): string {
		const issues: string[] = [];

		if (report.unusedIndexes.length > 0) {
			const totalSize = report.unusedIndexes.reduce(
				(acc, idx) => acc + idx.sizeBytes,
				0,
			);
			issues.push(
				`- **${report.unusedIndexes.length}** unused indexes consuming **${this.formatBytes(totalSize)}**`,
			);
		}

		if (report.missingIndexes.length > 0) {
			issues.push(
				`- **${report.missingIndexes.length}** tables with high sequential scan activity`,
			);
		}

		if (report.duplicateIndexes.length > 0) {
			issues.push(
				`- **${report.duplicateIndexes.length}** duplicate/overlapping index pairs`,
			);
		}

		if (report.slowQueries.length > 0) {
			issues.push(`- **${report.slowQueries.length}** slow queries identified`);
		}

		if (report.bloatedTables.length > 0) {
			issues.push(
				`- **${report.bloatedTables.length}** tables with significant bloat`,
			);
		}

		const healthIndicators = this.calculateHealthIndicators(report);

		return `## Executive Summary

### Health Score: ${healthIndicators.score}/100 ${this.getHealthEmoji(healthIndicators.score)}

### Key Findings
${issues.length > 0 ? issues.join("\n") : "- No critical issues found"}

### Quick Stats
| Metric | Value |
|--------|-------|
| Database Size | ${report.metrics.databaseSize} |
| Cache Hit Ratio | ${report.metrics.cacheHitRatio}% |
| Index Hit Ratio | ${report.metrics.indexHitRatio}% |
| Active Connections | ${report.metrics.activeConnections} |
| Tables Analyzed | ${report.tableStats.length} |`;
	}

	private buildMetricsSection(metrics: DatabaseMetrics): string {
		const thresholds = resolveThresholds(this.options.thresholds);

		return `## Database Metrics

### Performance Metrics
| Metric | Value | Status |
|--------|-------|--------|
| Cache Hit Ratio | ${metrics.cacheHitRatio}% | ${this.getStatusBadge(metrics.cacheHitRatio, thresholds.cacheHitRatio.warning, thresholds.cacheHitRatio.critical)} |
| Index Hit Ratio | ${metrics.indexHitRatio}% | ${this.getStatusBadge(metrics.indexHitRatio, thresholds.indexHitRatio.warning, thresholds.indexHitRatio.critical)} |
| Dead Tuples Ratio | ${metrics.deadTuplesRatio}% | ${this.getStatusBadgeInverse(metrics.deadTuplesRatio, thresholds.deadTuplesRatio.warning, thresholds.deadTuplesRatio.critical)} |

### Connection Statistics
| Metric | Value |
|--------|-------|
| Total Connections | ${metrics.totalConnections} |
| Active Connections | ${metrics.activeConnections} |
| Idle Connections | ${metrics.idleConnections} |

### Storage
| Metric | Value |
|--------|-------|
| Database Size | ${metrics.databaseSize} |`;
	}

	private buildIndexAnalysisSection(report: AnalysisReport): string {
		let content = `## Index Analysis\n\n`;

		content += `### Unused Indexes (${report.unusedIndexes.length})\n\n`;
		if (report.unusedIndexes.length > 0) {
			content += `These indexes have very few or no scans and may be candidates for removal:\n\n`;
			content += `| Schema | Table | Index | Size | Scans | Status |\n`;
			content += `|--------|-------|-------|------|-------|--------|\n`;

			for (const idx of report.unusedIndexes.slice(0, 20)) {
				content += `| ${idx.schema} | ${idx.table} | ${idx.index} | ${idx.size} | ${idx.indexScans} | ${(idx as { usageStatus?: string }).usageStatus ?? "Unused"} |\n`;
			}

			if (report.unusedIndexes.length > 20) {
				content += `\n*... and ${report.unusedIndexes.length - 20} more unused indexes*\n`;
			}

			const totalSize = report.unusedIndexes.reduce(
				(acc, idx) => acc + idx.sizeBytes,
				0,
			);
			content += `\n**Total space used by unused indexes:** ${this.formatBytes(totalSize)}\n`;
		} else {
			content += `No unused indexes found.\n`;
		}

		content += `\n### Tables Needing Index Review (${report.missingIndexes.length})\n\n`;
		if (report.missingIndexes.length > 0) {
			content += `These tables have high sequential scan activity and may benefit from additional indexes:\n\n`;
			content += `| Schema | Table | Seq Scans | Rows Read | Priority |\n`;
			content += `|--------|-------|-----------|-----------|----------|\n`;

			for (const idx of report.missingIndexes.slice(0, 20)) {
				content += `| ${idx.schema} | ${idx.table} | ${idx.seqScans.toLocaleString()} | ${idx.seqTupRead.toLocaleString()} | ${(idx as { priority?: string }).priority ?? "Medium"} |\n`;
			}

			if (report.missingIndexes.length > 20) {
				content += `\n*... and ${report.missingIndexes.length - 20} more tables*\n`;
			}
		} else {
			content += `No tables with excessive sequential scans found.\n`;
		}

		content += `\n### Duplicate/Overlapping Indexes (${report.duplicateIndexes.length})\n\n`;
		if (report.duplicateIndexes.length > 0) {
			content += `These index pairs have overlapping columns and may be consolidated:\n\n`;
			content += `| Schema | Table | Index 1 | Index 2 | Recommendation |\n`;
			content += `|--------|-------|---------|---------|----------------|\n`;

			for (const dup of report.duplicateIndexes) {
				content += `| ${dup.schema} | ${dup.table} | ${dup.index1} | ${dup.index2} | ${dup.recommendation} |\n`;
			}
		} else {
			content += `No duplicate indexes found.\n`;
		}

		return content;
	}

	private buildTableAnalysisSection(tableStats: TableStats[]): string {
		let content = `## Table Analysis\n\n`;

		const largestTables = [...tableStats]
			.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
			.slice(0, 15);

		content += `### Largest Tables\n\n`;
		content += `| Schema | Table | Total Size | Table Size | Index Size | Rows |\n`;
		content += `|--------|-------|------------|------------|------------|------|\n`;

		for (const t of largestTables) {
			content += `| ${t.schema} | ${t.table} | ${t.totalSize} | ${t.tableSize} | ${t.indexSize} | ${t.rowCount.toLocaleString()} |\n`;
		}

		const highDeadTuples = tableStats
			.filter((t) => t.deadTuples > 1000 || t.deadTupleRatio > 5)
			.sort((a, b) => b.deadTuples - a.deadTuples)
			.slice(0, 10);

		if (highDeadTuples.length > 0) {
			content += `\n### Tables with High Dead Tuples\n\n`;
			content += `| Schema | Table | Dead Tuples | Dead Tuple Ratio | Last Vacuum |\n`;
			content += `|--------|-------|-------------|------------------|-------------|\n`;

			for (const t of highDeadTuples) {
				const lastVacuum = t.lastVacuum
					? new Date(t.lastVacuum).toISOString().split("T")[0]
					: "Never";
				content += `| ${t.schema} | ${t.table} | ${t.deadTuples.toLocaleString()} | ${t.deadTupleRatio}% | ${lastVacuum} |\n`;
			}
		}

		const highSeqScans = tableStats
			.filter((t) => t.seqScans > 1000 && t.rowCount > 1000)
			.sort((a, b) => b.seqScans - a.seqScans)
			.slice(0, 10);

		if (highSeqScans.length > 0) {
			content += `\n### Tables with High Sequential Scans\n\n`;
			content += `| Schema | Table | Seq Scans | Index Scans | Rows |\n`;
			content += `|--------|-------|-----------|-------------|------|\n`;

			for (const t of highSeqScans) {
				content += `| ${t.schema} | ${t.table} | ${t.seqScans.toLocaleString()} | ${t.indexScans.toLocaleString()} | ${t.rowCount.toLocaleString()} |\n`;
			}
		}

		return content;
	}

	private buildSlowQueriesSection(slowQueries: SlowQuery[]): string {
		let content = `## Slow Queries Analysis\n\n`;

		if (slowQueries.length === 0) {
			content += `No slow queries captured. Ensure pg_stat_statements extension is installed.\n`;
			content += `\n### To enable pg_stat_statements:\n`;
			content += "```sql\n";
			content += "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;\n";
			content += "```\n";
			content += `\nAlso add to postgresql.conf:\n`;
			content += "```\n";
			content += "shared_preload_libraries = 'pg_stat_statements'\n";
			content += "pg_stat_statements.track = all\n";
			content += "```\n";
			return content;
		}

		content += `### Top Queries by Total Execution Time\n\n`;
		const topByTime = [...slowQueries]
			.sort((a, b) => b.totalTime - a.totalTime)
			.slice(0, 10);

		for (let i = 0; i < topByTime.length; i++) {
			const q = topByTime[i];
			content += `#### ${i + 1}. Query (Total: ${this.formatMs(q.totalTime)}, Avg: ${this.formatMs(q.meanTime)}, Calls: ${q.calls.toLocaleString()})\n\n`;
			content += "```sql\n";
			content += `${q.query}\n`;
			content += "```\n\n";

			if (q.recommendations.length > 0) {
				content += `**Recommendations:**\n`;
				for (const rec of q.recommendations) {
					content += `- ${rec}\n`;
				}
				content += "\n";
			}

			content += `| Metric | Value |\n`;
			content += `|--------|-------|\n`;
			content += `| Cache Hit Ratio | ${q.hitRatio}% |\n`;
			content += `| Rows Returned | ${q.rows.toLocaleString()} |\n`;
			content += `| Min Time | ${this.formatMs(q.minTime)} |\n`;
			content += `| Max Time | ${this.formatMs(q.maxTime)} |\n\n`;
		}

		return content;
	}

	private buildBloatSection(bloatedTables: BloatedTable[]): string {
		let content = `## Table Bloat Analysis\n\n`;

		if (bloatedTables.length === 0) {
			content += `No significant table bloat detected.\n`;
			return content;
		}

		content += `The following tables have significant bloat and may benefit from VACUUM FULL or pg_repack:\n\n`;
		content += `| Schema | Table | Bloat Size | Bloat Ratio | Recommendation |\n`;
		content += `|--------|-------|------------|-------------|----------------|\n`;

		for (const t of bloatedTables) {
			content += `| ${t.schema} | ${t.table} | ${t.bloatSize} | ${t.bloatRatio}% | ${t.recommendation} |\n`;
		}

		content += `\n### How to reduce bloat:\n`;
		content += "```sql\n";
		content +=
			"-- Option 1: VACUUM FULL (locks table, use during maintenance window)\n";
		content += "VACUUM FULL schema.table_name;\n\n";
		content += "-- Option 2: pg_repack (minimal locking, requires extension)\n";
		content += "-- Install: CREATE EXTENSION pg_repack;\n";
		content += "-- Run: pg_repack -d database_name -t schema.table_name\n";
		content += "```\n";

		return content;
	}

	private buildRecommendationsSection(recommendations: string[]): string {
		let content = `## Recommendations\n\n`;

		if (recommendations.length === 0) {
			content += `No specific recommendations at this time. Database appears healthy.\n`;
			return content;
		}

		content += `Based on the analysis, consider the following actions:\n\n`;
		for (let i = 0; i < recommendations.length; i++) {
			content += `${i + 1}. ${recommendations[i]}\n\n`;
		}

		return content;
	}

	private calculateHealthIndicators(report: AnalysisReport): {
		score: number;
		issues: string[];
	} {
		const issues: string[] = [];
		const score = calculateHealthScore(report, this.options.thresholds);
		const thresholds = resolveThresholds(this.options.thresholds);

		if (report.metrics.cacheHitRatio < thresholds.cacheHitRatio.critical) {
			issues.push("Low cache hit ratio");
		} else if (
			report.metrics.cacheHitRatio < thresholds.cacheHitRatio.warning
		) {
			issues.push("Suboptimal cache hit ratio");
		}

		if (report.metrics.indexHitRatio < thresholds.indexHitRatio.critical) {
			issues.push("Low index hit ratio");
		}

		if (report.metrics.deadTuplesRatio > thresholds.deadTuplesRatio.critical) {
			issues.push("High dead tuple ratio");
		} else if (
			report.metrics.deadTuplesRatio > thresholds.deadTuplesRatio.warning
		) {
			issues.push("Moderate dead tuple ratio");
		}

		if (report.unusedIndexes.length > 10) {
			issues.push("Many unused indexes");
		}

		if (report.missingIndexes.length > 5) {
			issues.push("Tables missing indexes");
		}

		if (report.slowQueries.length > 10) {
			issues.push("Many slow queries");
		}

		return { score, issues };
	}

	private getHealthEmoji(score: number): string {
		if (score >= 90) return "";
		if (score >= 70) return "";
		if (score >= 50) return "";
		return "";
	}

	private getStatusBadge(value: number, good: number, warn: number): string {
		if (value >= good) return "Good";
		if (value >= warn) return "Warning";
		return "Critical";
	}

	private getStatusBadgeInverse(
		value: number,
		good: number,
		warn: number,
	): string {
		if (value <= good) return "Good";
		if (value <= warn) return "Warning";
		return "Critical";
	}

	private formatBytes(bytes: number): string {
		const units = ["B", "KB", "MB", "GB", "TB"];
		let unitIndex = 0;
		let size = bytes;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(2)} ${units[unitIndex]}`;
	}

	private formatMs(ms: number): string {
		if (ms < 1000) return `${ms.toFixed(2)} ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
		return `${(ms / 60000).toFixed(2)} min`;
	}

	printSummary(report: AnalysisReport): void {
		const health = this.calculateHealthIndicators(report);

		console.log(`\n${"=".repeat(60)}`);
		console.log("DATABASE ANALYSIS SUMMARY");
		console.log("=".repeat(60));
		console.log(`\nDatabase: ${report.databaseName}`);
		console.log(
			`Health Score: ${health.score}/100 ${this.getHealthEmoji(health.score)}`,
		);
		console.log(`\nKey Metrics:`);
		console.log(`  - Database Size: ${report.metrics.databaseSize}`);
		console.log(`  - Cache Hit Ratio: ${report.metrics.cacheHitRatio}%`);
		console.log(`  - Index Hit Ratio: ${report.metrics.indexHitRatio}%`);
		console.log(`  - Active Connections: ${report.metrics.activeConnections}`);

		console.log(`\nFindings:`);
		console.log(`  - Unused Indexes: ${report.unusedIndexes.length}`);
		console.log(
			`  - Tables Needing Index Review: ${report.missingIndexes.length}`,
		);
		console.log(`  - Duplicate Indexes: ${report.duplicateIndexes.length}`);
		console.log(`  - Slow Queries: ${report.slowQueries.length}`);
		console.log(`  - Bloated Tables: ${report.bloatedTables.length}`);

		if (report.recommendations.length > 0) {
			console.log(`\nTop Recommendations:`);
			for (const rec of report.recommendations.slice(0, 5)) {
				console.log(`  - ${rec}`);
			}
		}

		console.log(`\n${"=".repeat(60)}`);
	}
}
