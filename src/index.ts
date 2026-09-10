/**
 * Library entry point for `@deniscuciuc/pg-analyzer`.
 *
 * Importing this module has no side effects. The CLI lives in `src/cli/main.ts` and is
 * reached through the `pg-analyzer` binary — importing the package used to run an analysis
 * as a side effect of `require()`, because the CLI was the package entry point.
 */

export { IndexAnalyzer } from "./analyzers/index-analyzer";
export { QueryAnalyzer } from "./analyzers/query-analyzer";
export { TableAnalyzer } from "./analyzers/table-analyzer";
export type { PostgresAnalyzerOptions } from "./api";
export { PostgresAnalyzer } from "./api";
export { StatsCollector } from "./collectors/stats-collector";
export type { Command } from "./constants";
export {
	COMMANDS,
	DEFAULTS,
	DESTRUCTIVE_COMMANDS,
	THRESHOLDS,
} from "./constants";
export { DiffReporter } from "./reporters/diff-reporter";
export { HtmlReporter } from "./reporters/html-reporter";
export { ReportGenerator } from "./reporters/report-generator";
export { calculateHealthScore } from "./thresholds";
export type {
	AnalysisReport,
	AnalyzerOptions,
	BloatedTable,
	DatabaseConfig,
	DatabaseMetrics,
	DuplicateIndex,
	FullReport,
	IndexInfo,
	LockInfo,
	MissingIndex,
	QueryStats,
	ReportThreshold,
	SlowQuery,
	TableStats,
	ThresholdOverrides,
	UnusedIndex,
	VacuumResult,
	VacuumSummary,
	VacuumTarget,
} from "./types";
export { quoteIdentifier, quoteQualifiedName } from "./utils/sql";
