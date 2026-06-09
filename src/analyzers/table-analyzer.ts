import type { Pool } from "pg";
import { QUERIES } from "../queries";
import type {
	AnalyzerOptions,
	BloatedTable,
	TableStats,
	VacuumResult,
	VacuumSummary,
	VacuumTarget,
} from "../types";

export class TableAnalyzer {
	constructor(
		private pool: Pool,
		private options: AnalyzerOptions = {},
	) {}

	async getTableStats(): Promise<TableStats[]> {
		const result = await this.pool.query(QUERIES.tableStats);
		const excludeSchemas = this.options.excludeSchemas ?? [];

		return result.rows
			.filter((row) => !excludeSchemas.includes(row.schema))
			.map((row) => ({
				schema: row.schema,
				table: row.table,
				rowCount: Number.parseInt(row.row_count, 10),
				totalSize: row.total_size,
				totalSizeBytes: Number.parseInt(row.total_size_bytes, 10),
				tableSize: row.table_size,
				indexSize: row.index_size,
				seqScans: Number.parseInt(row.seq_scans, 10),
				indexScans: Number.parseInt(row.idx_scans, 10),
				deadTuples: Number.parseInt(row.dead_tuples, 10),
				lastVacuum: row.last_vacuum || row.last_autovacuum,
				lastAnalyze: row.last_analyze || row.last_autoanalyze,
				deadTupleRatio: Number.parseFloat(row.dead_tuple_ratio),
			}));
	}

	async getBloatedTables(): Promise<BloatedTable[]> {
		try {
			const result = await this.pool.query(QUERIES.tableBloat);

			return result.rows
				.filter((row) => Number.parseFloat(row.bloat_ratio) > 10)
				.map((row) => ({
					schema: row.schema,
					table: row.table,
					bloatSize: row.bloat_size,
					bloatSizeBytes: Number.parseInt(row.bloat_size_bytes, 10),
					bloatRatio: Number.parseFloat(row.bloat_ratio),
					recommendation: this.generateBloatRecommendation(row),
				}));
		} catch (error) {
			console.warn("Could not calculate table bloat:", error);
			return [];
		}
	}

	async getTablesNeedingVacuum(): Promise<
		{
			schema: string;
			table: string;
			deadTuples: number;
			deadTupleRatio: number;
			lastVacuum: Date | null;
			recommendation: string;
		}[]
	> {
		const stats = await this.getTableStats();

		return stats
			.filter((t) => t.deadTupleRatio > 10 || t.deadTuples > 10000)
			.map((t) => ({
				schema: t.schema,
				table: t.table,
				deadTuples: t.deadTuples,
				deadTupleRatio: t.deadTupleRatio,
				lastVacuum: t.lastVacuum,
				recommendation: this.generateVacuumRecommendation(t),
			}))
			.sort((a, b) => b.deadTupleRatio - a.deadTupleRatio);
	}

	async getTablesNeedingAnalyze(): Promise<
		{
			schema: string;
			table: string;
			rowCount: number;
			lastAnalyze: Date | null;
			daysSinceAnalyze: number | null;
		}[]
	> {
		const stats = await this.getTableStats();
		const now = new Date();

		return stats
			.filter((t) => {
				if (!t.lastAnalyze) return t.rowCount > 1000;
				const daysSince = Math.floor(
					(now.getTime() - new Date(t.lastAnalyze).getTime()) /
						(1000 * 60 * 60 * 24),
				);
				return daysSince > 7 && t.rowCount > 1000;
			})
			.map((t) => ({
				schema: t.schema,
				table: t.table,
				rowCount: t.rowCount,
				lastAnalyze: t.lastAnalyze,
				daysSinceAnalyze: t.lastAnalyze
					? Math.floor(
							(now.getTime() - new Date(t.lastAnalyze).getTime()) /
								(1000 * 60 * 60 * 24),
						)
					: null,
			}))
			.sort(
				(a, b) => (b.daysSinceAnalyze ?? 999) - (a.daysSinceAnalyze ?? 999),
			);
	}

	async getLargestTables(limit = 20): Promise<
		{
			schema: string;
			table: string;
			totalSize: string;
			totalSizeBytes: number;
			tableSize: string;
			indexSize: string;
			rowCount: number;
			avgRowSize: number;
		}[]
	> {
		const stats = await this.getTableStats();

		return stats
			.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
			.slice(0, limit)
			.map((t) => ({
				schema: t.schema,
				table: t.table,
				totalSize: t.totalSize,
				totalSizeBytes: t.totalSizeBytes,
				tableSize: t.tableSize,
				indexSize: t.indexSize,
				rowCount: t.rowCount,
				avgRowSize:
					t.rowCount > 0 ? Math.round(t.totalSizeBytes / t.rowCount) : 0,
			}));
	}

	async getTableWithHighSeqScans(): Promise<
		{
			schema: string;
			table: string;
			seqScans: number;
			indexScans: number;
			seqScanRatio: number;
			rowCount: number;
			recommendation: string;
		}[]
	> {
		const stats = await this.getTableStats();

		return stats
			.filter((t) => t.seqScans > 100 && t.rowCount > 1000)
			.map((t) => {
				const totalScans = t.seqScans + t.indexScans;
				const seqScanRatio =
					totalScans > 0 ? (t.seqScans / totalScans) * 100 : 0;

				return {
					schema: t.schema,
					table: t.table,
					seqScans: t.seqScans,
					indexScans: t.indexScans,
					seqScanRatio: Math.round(seqScanRatio * 100) / 100,
					rowCount: t.rowCount,
					recommendation: this.generateSeqScanRecommendation(t, seqScanRatio),
				};
			})
			.filter((t) => t.seqScanRatio > 50)
			.sort((a, b) => b.seqScans - a.seqScans);
	}

	private generateBloatRecommendation(row: {
		bloat_ratio: string;
		table_bytes: string;
	}): string {
		const bloatRatio = Number.parseFloat(row.bloat_ratio);

		if (bloatRatio > 50) {
			return "Critical bloat level. Consider VACUUM FULL or pg_repack to reclaim space.";
		}
		if (bloatRatio > 30) {
			return "High bloat level. Schedule VACUUM FULL during maintenance window.";
		}
		if (bloatRatio > 20) {
			return "Moderate bloat. Review autovacuum settings for this table.";
		}
		return "Minor bloat. Monitor and ensure autovacuum is working properly.";
	}

	private generateVacuumRecommendation(stats: TableStats): string {
		const parts: string[] = [];

		if (stats.deadTupleRatio > 20) {
			parts.push(`High dead tuple ratio (${stats.deadTupleRatio}%).`);
		}

		if (!stats.lastVacuum) {
			parts.push("Table has never been vacuumed.");
		} else {
			const daysSince = Math.floor(
				(Date.now() - new Date(stats.lastVacuum).getTime()) /
					(1000 * 60 * 60 * 24),
			);
			if (daysSince > 7) {
				parts.push(`Last vacuum was ${daysSince} days ago.`);
			}
		}

		parts.push("Run VACUUM ANALYZE on this table.");

		return parts.join(" ");
	}

	private generateSeqScanRecommendation(
		stats: TableStats,
		seqScanRatio: number,
	): string {
		if (seqScanRatio > 90 && stats.rowCount > 10000) {
			return "Critical: Almost all scans are sequential. Indexes are either missing or not being used.";
		}
		if (seqScanRatio > 70) {
			return "High sequential scan ratio. Analyze query patterns and add appropriate indexes.";
		}
		if (seqScanRatio > 50) {
			return "Moderate sequential scan ratio. Review queries to identify missing index opportunities.";
		}
		return "Some sequential scans detected. May be acceptable for small result sets.";
	}

	generateTableReport(stats: TableStats[]): {
		totalTables: number;
		totalSize: number;
		totalRows: number;
		tablesWithHighDeadTuples: number;
		tablesNeverVacuumed: number;
		tablesNeverAnalyzed: number;
		avgDeadTupleRatio: number;
	} {
		const totalSize = stats.reduce((acc, t) => acc + t.totalSizeBytes, 0);
		const totalRows = stats.reduce((acc, t) => acc + t.rowCount, 0);
		const tablesWithHighDeadTuples = stats.filter(
			(t) => t.deadTupleRatio > 10,
		).length;
		const tablesNeverVacuumed = stats.filter((t) => !t.lastVacuum).length;
		const tablesNeverAnalyzed = stats.filter((t) => !t.lastAnalyze).length;
		const avgDeadTupleRatio =
			stats.length > 0
				? stats.reduce((acc, t) => acc + t.deadTupleRatio, 0) / stats.length
				: 0;

		return {
			totalTables: stats.length,
			totalSize,
			totalRows,
			tablesWithHighDeadTuples,
			tablesNeverVacuumed,
			tablesNeverAnalyzed,
			avgDeadTupleRatio: Math.round(avgDeadTupleRatio * 100) / 100,
		};
	}

	/**
	 * Execute VACUUM ANALYZE on a single table
	 */
	async vacuumTable(
		schema: string,
		table: string,
		options: { analyze?: boolean; full?: boolean } = { analyze: true },
	): Promise<VacuumResult> {
		const startTime = Date.now();
		const fullTableName = `"${schema}"."${table}"`;

		try {
			let command = "VACUUM";
			if (options.full) {
				command += " FULL";
			}
			if (options.analyze) {
				command += " ANALYZE";
			}
			command += ` ${fullTableName}`;

			await this.pool.query(command);

			return {
				schema,
				table,
				success: true,
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				schema,
				table,
				success: false,
				duration: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Execute VACUUM ANALYZE on multiple tables
	 */
	async vacuumTables(
		tables: VacuumTarget[],
		options: {
			analyze?: boolean;
			full?: boolean;
			onProgress?: (result: VacuumResult, index: number, total: number) => void;
		} = { analyze: true },
	): Promise<VacuumSummary> {
		const results: VacuumResult[] = [];
		const startTime = Date.now();

		for (let i = 0; i < tables.length; i++) {
			const { schema, table } = tables[i];
			const result = await this.vacuumTable(schema, table, {
				analyze: options.analyze,
				full: options.full,
			});
			results.push(result);

			if (options.onProgress) {
				options.onProgress(result, i + 1, tables.length);
			}
		}

		return {
			totalTables: tables.length,
			successful: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
			totalDuration: Date.now() - startTime,
			results,
		};
	}

	/**
	 * Auto-vacuum tables that need it (based on dead tuple ratio)
	 */
	async autoVacuum(
		options: {
			analyze?: boolean;
			full?: boolean;
			onProgress?: (result: VacuumResult, index: number, total: number) => void;
		} = { analyze: true },
	): Promise<VacuumSummary> {
		const tablesNeedingVacuum = await this.getTablesNeedingVacuum();
		const targets: VacuumTarget[] = tablesNeedingVacuum.map((t) => ({
			schema: t.schema,
			table: t.table,
		}));

		return this.vacuumTables(targets, options);
	}
}
