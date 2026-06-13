import type { Pool } from "pg";
import { applySqlFilters } from "../filter-helpers";
import { QUERIES } from "../queries";
import type {
	AnalyzerOptions,
	DuplicateIndex,
	IndexInfo,
	MissingIndex,
	UnusedIndex,
} from "../types";
import { formatBytes } from "../utils/format";

export class IndexAnalyzer {
	constructor(
		private pool: Pool,
		private options: AnalyzerOptions = {},
	) {}

	async getAllIndexes(): Promise<IndexInfo[]> {
		const { text, values } = applySqlFilters({
			query: QUERIES.allIndexes,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "schemaname",
			tableColumn: "relname",
		});
		const result = await this.pool.query(text, values);

		return result.rows.map((row) => ({
			schema: row.schema,
			table: row.table,
			index: row.index,
			columns: "",
			indexType: "",
			size: row.size,
			sizeBytes: Number.parseInt(row.size_bytes, 10),
		}));
	}

	async getUnusedIndexes(): Promise<UnusedIndex[]> {
		const minScans = this.options.minIndexScans ?? 50;
		const { text, values } = applySqlFilters({
			query: QUERIES.unusedIndexes,
			values: [minScans],
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "s.schemaname",
			tableColumn: "s.relname",
		});
		const result = await this.pool.query(text, values);

		return result.rows.map((row) => ({
			schema: row.schema,
			table: row.table,
			index: row.index,
			columns: this.extractColumnsFromDefinition(row.index_definition),
			indexType: this.extractTypeFromDefinition(row.index_definition),
			size: row.size,
			sizeBytes: Number.parseInt(row.size_bytes, 10),
			indexScans: Number.parseInt(row.index_scans, 10),
			lastUsed: null,
			isUnique: row.is_unique,
			isPrimary: row.is_primary,
			usageStatus: row.usage_status,
			indexDefinition: row.index_definition,
			dropStatement: `DROP INDEX ${row.schema}.${row.index};`,
		}));
	}

	async getMissingIndexes(): Promise<MissingIndex[]> {
		const minSeqScans = this.options.minSeqScans ?? 100;
		const { text, values } = applySqlFilters({
			query: QUERIES.missingIndexes,
			values: [minSeqScans],
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "schemaname",
			tableColumn: "relname",
		});
		const result = await this.pool.query(text, values);

		return result.rows.map((row) => ({
			schema: row.schema,
			table: row.table,
			columns: "",
			seqScans: Number.parseInt(row.seq_scans, 10),
			seqTupRead: Number.parseInt(row.seq_tup_read, 10),
			estimatedBenefit: this.calculateBenefit(row),
			suggestedIndex: `-- Analyze queries on ${row.schema}.${row.table} to determine optimal index`,
			rowCount: Number.parseInt(row.row_count, 10),
			tableSize: row.table_size,
			seqScanRatio: Number.parseFloat(row.seq_scan_ratio),
			priority: row.priority,
		}));
	}

	async getDuplicateIndexes(): Promise<DuplicateIndex[]> {
		const { text, values } = applySqlFilters({
			query: QUERIES.duplicateIndexes,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "n.nspname",
			tableColumn: "t.relname",
		});
		const result = await this.pool.query(text, values);

		return result.rows.map((row) => ({
			schema: row.schema,
			table: row.table,
			index1: row.index1,
			index2: row.index2,
			columns1: row.columns1,
			columns2: row.columns2,
			recommendation: row.recommendation,
		}));
	}

	async getForeignKeysWithoutIndexes(): Promise<
		{
			schema: string;
			table: string;
			column: string;
			foreignTable: string;
			foreignColumn: string;
			suggestedIndex: string;
			partialCoverageIndexes: string | null;
		}[]
	> {
		const { text, values } = applySqlFilters({
			query: QUERIES.foreignKeysWithoutIndexes,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "tc.table_schema",
			tableColumn: "tc.table_name",
		});
		const result = await this.pool.query(text, values);

		return result.rows.map((row) => ({
			schema: row.schema,
			table: row.table,
			column: row.column,
			foreignTable: row.foreign_table,
			foreignColumn: row.foreign_column,
			suggestedIndex: row.suggested_index,
			partialCoverageIndexes: row.partial_coverage_indexes,
		}));
	}

	async getIndexUsageSummary(): Promise<
		{
			schema: string;
			table: string;
			indexUsageRatio: number;
			sequentialScans: number;
			indexScans: number;
			rows: number;
			tableSize: string;
		}[]
	> {
		const { text, values } = applySqlFilters({
			query: QUERIES.indexUsageSummary,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "schemaname",
			tableColumn: "relname",
		});
		const result = await this.pool.query(text, values);

		return result.rows.map((row) => ({
			schema: row.schema,
			table: row.table,
			indexUsageRatio: Number.parseFloat(row.index_usage_ratio),
			sequentialScans: Number.parseInt(row.sequential_scans, 10),
			indexScans: Number.parseInt(row.index_scans, 10),
			rows: Number.parseInt(row.rows, 10),
			tableSize: row.table_size,
		}));
	}

	private extractColumnsFromDefinition(definition: string): string {
		const match = definition.match(/\(([^)]+)\)/);
		return match ? match[1] : "";
	}

	private extractTypeFromDefinition(definition: string): string {
		if (definition.includes("USING btree")) return "btree";
		if (definition.includes("USING hash")) return "hash";
		if (definition.includes("USING gin")) return "gin";
		if (definition.includes("USING gist")) return "gist";
		if (definition.includes("USING brin")) return "brin";
		return "btree";
	}

	private calculateBenefit(row: {
		seq_scans: string;
		seq_tup_read: string;
		row_count: string;
	}): string {
		const seqScans = Number.parseInt(row.seq_scans, 10);
		const rowCount = Number.parseInt(row.row_count, 10);

		if (rowCount > 100000 && seqScans > 1000) return "Very High";
		if (rowCount > 10000 && seqScans > 100) return "High";
		if (rowCount > 1000 && seqScans > 50) return "Medium";
		return "Low";
	}

	generateRecommendations(
		unusedIndexes: UnusedIndex[],
		missingIndexes: MissingIndex[],
		duplicateIndexes: DuplicateIndex[],
	): string[] {
		const recommendations: string[] = [];

		const totalUnusedSize = unusedIndexes.reduce(
			(acc, idx) => acc + idx.sizeBytes,
			0,
		);
		if (unusedIndexes.length > 0) {
			recommendations.push(
				`Found ${unusedIndexes.length} unused indexes consuming ${formatBytes(totalUnusedSize)}. Consider removing them to improve write performance and reduce storage.`,
			);
		}

		if (duplicateIndexes.length > 0) {
			recommendations.push(
				`Found ${duplicateIndexes.length} duplicate/overlapping index pairs. Review and consolidate to reduce maintenance overhead.`,
			);
		}

		const highPriorityMissing = missingIndexes.filter(
			(m) => (m as { priority?: string }).priority === "High priority",
		);
		if (highPriorityMissing.length > 0) {
			recommendations.push(
				`Found ${highPriorityMissing.length} tables with high sequential scan activity that may benefit from indexes. Analyze query patterns to determine optimal indexes.`,
			);
		}

		return recommendations;
	}
}
