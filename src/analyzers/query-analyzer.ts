import type { Pool } from "pg";
import { QUERIES } from "../queries";
import type { AnalyzerOptions, QueryStats, SlowQuery } from "../types";

export class QueryAnalyzer {
	constructor(
		private pool: Pool,
		private options: AnalyzerOptions = {},
	) {}

	async checkPgStatStatementsExtension(): Promise<boolean> {
		try {
			const result = await this.pool.query(QUERIES.checkPgStatStatements);
			return result.rows[0]?.exists === true;
		} catch {
			return false;
		}
	}

	async getSlowQueries(): Promise<SlowQuery[]> {
		const hasPgStatStatements = await this.checkPgStatStatementsExtension();

		if (!hasPgStatStatements) {
			console.warn(
				"pg_stat_statements extension is not installed. Slow query analysis unavailable.",
			);
			console.warn(
				"To enable: CREATE EXTENSION pg_stat_statements; and configure shared_preload_libraries",
			);
			return [];
		}

		const thresholdMs = this.options.slowQueryThresholdMs ?? 100;
		const limit = this.options.topQueriesLimit ?? 50;

		try {
			const result = await this.pool.query(QUERIES.slowQueries, [
				thresholdMs,
				limit,
			]);

			return result.rows.map((row) => ({
				queryId: row.query_id,
				query: this.normalizeQuery(row.query),
				calls: Number.parseInt(row.calls, 10),
				totalTime: Number.parseFloat(row.total_time_ms),
				meanTime: Number.parseFloat(row.mean_time_ms),
				minTime: Number.parseFloat(row.min_time_ms),
				maxTime: Number.parseFloat(row.max_time_ms),
				rows: Number.parseInt(row.rows, 10),
				sharedBlksHit: Number.parseInt(row.shared_blks_hit, 10),
				sharedBlksRead: Number.parseInt(row.shared_blks_read, 10),
				hitRatio: Number.parseFloat(row.cache_hit_ratio),
				recommendations: this.generateQueryRecommendations(row),
			}));
		} catch (error) {
			console.error("Error fetching slow queries:", error);
			return [];
		}
	}

	async getAllQueryStats(minCalls = 10, limit = 50): Promise<QueryStats[]> {
		const hasPgStatStatements = await this.checkPgStatStatementsExtension();

		if (!hasPgStatStatements) {
			console.warn("pg_stat_statements extension is not installed.");
			console.warn("To enable: CREATE EXTENSION pg_stat_statements;");
			return [];
		}

		try {
			const result = await this.pool.query(QUERIES.allQueryStats, [
				minCalls,
				limit,
			]);

			return result.rows
				.filter((row) => !row.query.includes("<insufficient"))
				.map((row) => ({
					queryId: row.query_id,
					query: row.query,
					queryPreview: this.normalizeQuery(row.query).substring(0, 120),
					calls: Number.parseInt(row.calls, 10),
					rows: Number.parseInt(row.rows, 10),
					totalTime: Number.parseFloat(row.total_time_ms),
					meanTime: Number.parseFloat(row.mean_time_ms),
					minTime: Number.parseFloat(row.min_time_ms),
					maxTime: Number.parseFloat(row.max_time_ms),
					sharedBlksHit: Number.parseInt(row.shared_blks_hit, 10),
					sharedBlksRead: Number.parseInt(row.shared_blks_read, 10),
					hitRatio: Number.parseFloat(row.cache_hit_ratio),
				}));
		} catch (error) {
			console.error("Error fetching query stats:", error);
			return [];
		}
	}

	async getLongRunningQueries(): Promise<
		{
			pid: number;
			user: string;
			database: string;
			state: string;
			query: string;
			duration: string;
			waitEventType: string | null;
			waitEvent: string | null;
		}[]
	> {
		const result = await this.pool.query(QUERIES.longRunningQueries);

		return result.rows.map((row) => ({
			pid: row.pid,
			user: row.user,
			database: row.database,
			state: row.state,
			query: this.normalizeQuery(row.query),
			duration: row.duration,
			waitEventType: row.wait_event_type,
			waitEvent: row.wait_event,
		}));
	}

	async getBlockingQueries(): Promise<
		{
			blockedPid: number;
			blockedUser: string;
			blockingPid: number;
			blockingUser: string;
			blockedQuery: string;
			blockingQuery: string;
			blockedState: string;
			blockedDuration: string;
		}[]
	> {
		const result = await this.pool.query(QUERIES.locks);

		return result.rows.map((row) => ({
			blockedPid: row.blocked_pid,
			blockedUser: row.blocked_user,
			blockingPid: row.blocking_pid,
			blockingUser: row.blocking_user,
			blockedQuery: this.normalizeQuery(row.blocked_query),
			blockingQuery: this.normalizeQuery(row.blocking_query),
			blockedState: row.blocked_state,
			blockedDuration: row.blocked_duration,
		}));
	}

	private normalizeQuery(query: string): string {
		if (!query) return "";
		return query.replace(/\s+/g, " ").trim().substring(0, 500);
	}

	private generateQueryRecommendations(row: {
		mean_time_ms: string;
		cache_hit_ratio: string;
		calls: string;
		rows: string;
		query: string;
	}): string[] {
		const recommendations: string[] = [];
		const meanTime = Number.parseFloat(row.mean_time_ms);
		const hitRatio = Number.parseFloat(row.cache_hit_ratio);
		const calls = Number.parseInt(row.calls, 10);
		const rowsPerCall = Number.parseInt(row.rows, 10) / Math.max(calls, 1);
		const query = row.query.toLowerCase();

		if (hitRatio < 90) {
			recommendations.push(
				`Low cache hit ratio (${hitRatio}%). Consider adding indexes or increasing shared_buffers.`,
			);
		}

		if (meanTime > 1000) {
			recommendations.push(
				"Query takes over 1 second on average. Review execution plan with EXPLAIN ANALYZE.",
			);
		}

		if (query.includes("where") && meanTime > 100 && calls > 100) {
			recommendations.push(
				"Frequently executed query with WHERE clause and high mean time. Verify indexes exist on filtered columns using EXPLAIN ANALYZE.",
			);
		}

		if (rowsPerCall > 10000) {
			recommendations.push(
				"Query returns many rows. Consider adding LIMIT or pagination if applicable.",
			);
		}

		if (query.includes("select *")) {
			recommendations.push(
				"Query uses SELECT *. Consider selecting only needed columns to reduce I/O.",
			);
		}

		if (
			query.includes("like '%") ||
			(query.includes("like $") && query.includes("%"))
		) {
			recommendations.push(
				"LIKE with leading wildcard prevents index usage. Consider full-text search or trigram indexes.",
			);
		}

		if ((query.match(/\bor\b/g) || []).length > 2) {
			recommendations.push(
				"Multiple OR conditions may prevent optimal index usage. Consider UNION or restructuring.",
			);
		}

		if (query.includes("not in")) {
			recommendations.push(
				"NOT IN can be slow with large lists. Consider using NOT EXISTS or LEFT JOIN with NULL check.",
			);
		}

		return recommendations;
	}

	generateQueryReport(slowQueries: SlowQuery[]): {
		totalSlowQueries: number;
		totalExecutionTime: number;
		averageExecutionTime: number;
		queriesWithLowCacheHit: number;
		topTimeConsumers: SlowQuery[];
		topCallCount: SlowQuery[];
	} {
		const totalExecutionTime = slowQueries.reduce(
			(acc, q) => acc + q.totalTime,
			0,
		);
		const averageExecutionTime =
			slowQueries.length > 0 ? totalExecutionTime / slowQueries.length : 0;
		const queriesWithLowCacheHit = slowQueries.filter(
			(q) => q.hitRatio < 90,
		).length;

		return {
			totalSlowQueries: slowQueries.length,
			totalExecutionTime,
			averageExecutionTime,
			queriesWithLowCacheHit,
			topTimeConsumers: [...slowQueries]
				.sort((a, b) => b.totalTime - a.totalTime)
				.slice(0, 10),
			topCallCount: [...slowQueries]
				.sort((a, b) => b.calls - a.calls)
				.slice(0, 10),
		};
	}
}
