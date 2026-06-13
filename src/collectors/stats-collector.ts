import type { Pool } from "pg";
import { applySqlFilters } from "../filter-helpers";
import { QUERIES } from "../queries";
import {
	getInverseThresholdStatus,
	getPositiveThresholdStatus,
	resolveThresholds,
} from "../thresholds";
import type { AnalyzerOptions, DatabaseMetrics } from "../types";

export class StatsCollector {
	constructor(
		private pool: Pool,
		private options: AnalyzerOptions = {},
	) {}

	async getDatabaseMetrics(): Promise<DatabaseMetrics> {
		const cacheHitQuery = applySqlFilters({
			query: QUERIES.cacheHitRatio,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "schemaname",
			tableColumn: "relname",
		});
		const indexHitQuery = applySqlFilters({
			query: QUERIES.indexHitRatio,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "schemaname",
			tableColumn: "relname",
		});
		const deadTuplesQuery = applySqlFilters({
			query: QUERIES.deadTuplesRatio,
			schemas: this.options.schemas,
			tables: this.options.tables,
			schemaColumn: "schemaname",
			tableColumn: "relname",
		});

		const [metricsResult, cacheResult, indexResult, deadTuplesResult] =
			await Promise.all([
				this.pool.query(QUERIES.databaseMetrics),
				this.pool.query(cacheHitQuery.text, cacheHitQuery.values),
				this.pool.query(indexHitQuery.text, indexHitQuery.values),
				this.pool.query(deadTuplesQuery.text, deadTuplesQuery.values),
			]);

		const metrics = metricsResult.rows[0];
		const cacheHitRatio = Number.parseFloat(
			cacheResult.rows[0]?.cache_hit_ratio ?? "0",
		);
		const indexHitRatio = Number.parseFloat(
			indexResult.rows[0]?.index_hit_ratio ?? "0",
		);
		const deadTuplesRatio = Number.parseFloat(
			deadTuplesResult.rows[0]?.dead_tuples_ratio ?? "0",
		);

		return {
			databaseSize: metrics.database_size,
			databaseSizeBytes: Number.parseInt(metrics.database_size_bytes, 10),
			totalConnections: Number.parseInt(metrics.total_connections, 10),
			activeConnections: Number.parseInt(metrics.active_connections, 10),
			idleConnections: Number.parseInt(metrics.idle_connections, 10),
			cacheHitRatio,
			indexHitRatio,
			deadTuplesRatio,
			bloatEstimate: "N/A",
		};
	}

	async getConnectionStats(): Promise<{
		total: number;
		active: number;
		idle: number;
		idleInTransaction: number;
		waiting: number;
		byUser: { user: string; count: number }[];
		byApplication: { application: string; count: number }[];
	}> {
		const result = await this.pool.query(`
      SELECT
        state,
        usename as user,
        application_name as application,
        count(*) as count
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state, usename, application_name
      ORDER BY count DESC
    `);

		const stats = {
			total: 0,
			active: 0,
			idle: 0,
			idleInTransaction: 0,
			waiting: 0,
			byUser: [] as { user: string; count: number }[],
			byApplication: [] as { application: string; count: number }[],
		};

		const userCounts = new Map<string, number>();
		const appCounts = new Map<string, number>();

		for (const row of result.rows) {
			const count = Number.parseInt(row.count, 10);
			stats.total += count;

			switch (row.state) {
				case "active":
					stats.active += count;
					break;
				case "idle":
					stats.idle += count;
					break;
				case "idle in transaction":
				case "idle in transaction (aborted)":
					stats.idleInTransaction += count;
					break;
			}

			if (row.user) {
				userCounts.set(row.user, (userCounts.get(row.user) ?? 0) + count);
			}
			if (row.application) {
				appCounts.set(
					row.application,
					(appCounts.get(row.application) ?? 0) + count,
				);
			}
		}

		stats.byUser = Array.from(userCounts.entries())
			.map(([user, count]) => ({ user, count }))
			.sort((a, b) => b.count - a.count);

		stats.byApplication = Array.from(appCounts.entries())
			.map(([application, count]) => ({ application, count }))
			.sort((a, b) => b.count - a.count);

		return stats;
	}

	async getReplicationStats(): Promise<{
		isReplica: boolean;
		replicationLag: string | null;
		replicationSlots: {
			slotName: string;
			slotType: string;
			active: boolean;
			restartLsn: string;
		}[];
	}> {
		const isReplicaResult = await this.pool.query(`
      SELECT pg_is_in_recovery() as is_replica
    `);

		const isReplica = isReplicaResult.rows[0]?.is_replica === true;

		let replicationLag: string | null = null;
		if (isReplica) {
			try {
				const lagResult = await this.pool.query(`
          SELECT
            CASE
              WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN '0 seconds'
              ELSE COALESCE(
                EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::text || ' seconds',
                'unknown'
              )
            END as lag
        `);
				replicationLag = lagResult.rows[0]?.lag ?? null;
			} catch {
				replicationLag = "unknown";
			}
		}

		let replicationSlots: {
			slotName: string;
			slotType: string;
			active: boolean;
			restartLsn: string;
		}[] = [];

		try {
			const slotsResult = await this.pool.query(`
        SELECT
          slot_name,
          slot_type,
          active,
          restart_lsn
        FROM pg_replication_slots
      `);

			replicationSlots = slotsResult.rows.map((row) => ({
				slotName: row.slot_name,
				slotType: row.slot_type,
				active: row.active,
				restartLsn: row.restart_lsn,
			}));
		} catch {
			// Replication slots query may fail on some configurations
		}

		return {
			isReplica,
			replicationLag,
			replicationSlots,
		};
	}

	async getWalStats(): Promise<{
		walSize: string;
		walSegmentSize: string;
		archiveMode: string;
		archivedCount: number;
		failedCount: number;
	}> {
		try {
			const result = await this.pool.query(`
        SELECT
          pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')) as wal_size,
          current_setting('wal_segment_size') as wal_segment_size,
          current_setting('archive_mode') as archive_mode
      `);

			const archiveResult = await this.pool
				.query(`
        SELECT
          archived_count,
          failed_count
        FROM pg_stat_archiver
      `)
				.catch(() => ({ rows: [{ archived_count: 0, failed_count: 0 }] }));

			return {
				walSize: result.rows[0]?.wal_size ?? "unknown",
				walSegmentSize: result.rows[0]?.wal_segment_size ?? "unknown",
				archiveMode: result.rows[0]?.archive_mode ?? "unknown",
				archivedCount: Number.parseInt(
					archiveResult.rows[0]?.archived_count ?? "0",
					10,
				),
				failedCount: Number.parseInt(
					archiveResult.rows[0]?.failed_count ?? "0",
					10,
				),
			};
		} catch {
			return {
				walSize: "unknown",
				walSegmentSize: "unknown",
				archiveMode: "unknown",
				archivedCount: 0,
				failedCount: 0,
			};
		}
	}

	async getConfigurationSettings(): Promise<
		{
			name: string;
			setting: string;
			unit: string | null;
			category: string;
			description: string;
		}[]
	> {
		const importantSettings = [
			"shared_buffers",
			"effective_cache_size",
			"work_mem",
			"maintenance_work_mem",
			"max_connections",
			"max_parallel_workers",
			"max_parallel_workers_per_gather",
			"random_page_cost",
			"effective_io_concurrency",
			"autovacuum",
			"autovacuum_vacuum_threshold",
			"autovacuum_analyze_threshold",
			"autovacuum_vacuum_scale_factor",
			"autovacuum_analyze_scale_factor",
			"checkpoint_completion_target",
			"wal_buffers",
			"min_wal_size",
			"max_wal_size",
			"default_statistics_target",
		];

		const result = await this.pool.query(
			`
      SELECT
        name,
        setting,
        unit,
        category,
        short_desc as description
      FROM pg_settings
      WHERE name = ANY($1)
      ORDER BY category, name
    `,
			[importantSettings],
		);

		return result.rows.map((row) => ({
			name: row.name,
			setting: row.setting,
			unit: row.unit,
			category: row.category,
			description: row.description,
		}));
	}

	async getExtensions(): Promise<
		{
			name: string;
			version: string;
			schema: string;
			description: string;
		}[]
	> {
		const result = await this.pool.query(`
      SELECT
        e.extname as name,
        e.extversion as version,
        n.nspname as schema,
        c.description
      FROM pg_extension e
      LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
      LEFT JOIN pg_description c ON c.objoid = e.oid
      ORDER BY e.extname
    `);

		return result.rows.map((row) => ({
			name: row.name,
			version: row.version,
			schema: row.schema,
			description: row.description ?? "",
		}));
	}

	async getServerInfo(): Promise<{
		version: string;
		versionNum: number;
		uptime: string;
		startTime: Date | null;
		maxConnections: number;
		serverEncoding: string;
		timeZone: string;
	}> {
		const result = await this.pool.query(`
			SELECT
				version() as version,
				current_setting('server_version_num')::int as version_num,
				current_setting('max_connections')::int as max_connections,
				current_setting('server_encoding') as server_encoding,
				current_setting('TimeZone') as time_zone,
				pg_postmaster_start_time() as start_time,
				now() - pg_postmaster_start_time() as uptime
		`);

		const row = result.rows[0];
		const versionMatch = row.version.match(/PostgreSQL (\d+\.\d+)/);

		return {
			version: versionMatch
				? versionMatch[1]
				: row.version.split(" ").slice(0, 2).join(" "),
			versionNum: row.version_num,
			uptime: this.formatInterval(row.uptime),
			startTime: row.start_time,
			maxConnections: row.max_connections,
			serverEncoding: row.server_encoding,
			timeZone: row.time_zone,
		};
	}

	private formatInterval(
		interval:
			| { days?: number; hours?: number; minutes?: number; seconds?: number }
			| string,
	): string {
		if (typeof interval === "string") {
			return interval;
		}
		const parts: string[] = [];
		if (interval.days) parts.push(`${interval.days}d`);
		if (interval.hours) parts.push(`${interval.hours}h`);
		if (interval.minutes) parts.push(`${interval.minutes}m`);
		return parts.length > 0 ? parts.join(" ") : "< 1m";
	}

	generateMetricsReport(metrics: DatabaseMetrics): {
		healthScore: number;
		issues: string[];
		recommendations: string[];
	} {
		const thresholds = resolveThresholds(this.options.thresholds);
		const issues: string[] = [];
		const recommendations: string[] = [];
		let healthScore = 100;

		const cacheStatus = getPositiveThresholdStatus(
			metrics.cacheHitRatio,
			thresholds.cacheHitRatio,
		);
		const indexStatus = getPositiveThresholdStatus(
			metrics.indexHitRatio,
			thresholds.indexHitRatio,
		);
		const deadTuplesStatus = getInverseThresholdStatus(
			metrics.deadTuplesRatio,
			thresholds.deadTuplesRatio,
		);

		if (cacheStatus === "critical") {
			healthScore -= 20;
			issues.push(`Low cache hit ratio: ${metrics.cacheHitRatio}%`);
			recommendations.push(
				"Consider increasing shared_buffers or optimizing queries to improve cache efficiency.",
			);
		} else if (cacheStatus === "warning") {
			healthScore -= 10;
			issues.push(`Suboptimal cache hit ratio: ${metrics.cacheHitRatio}%`);
		}

		if (indexStatus === "critical") {
			healthScore -= 15;
			issues.push(`Low index hit ratio: ${metrics.indexHitRatio}%`);
			recommendations.push(
				"Review index usage and consider adding missing indexes or increasing shared_buffers.",
			);
		}

		if (deadTuplesStatus === "critical") {
			healthScore -= 15;
			issues.push(`High dead tuple ratio: ${metrics.deadTuplesRatio}%`);
			recommendations.push(
				"Review autovacuum settings and consider manual VACUUM on heavily updated tables.",
			);
		} else if (deadTuplesStatus === "warning") {
			healthScore -= 5;
			issues.push(`Moderate dead tuple ratio: ${metrics.deadTuplesRatio}%`);
		}

		const connectionRatio =
			(metrics.activeConnections / Math.max(metrics.totalConnections, 1)) * 100;
		if (connectionRatio > 80) {
			healthScore -= 10;
			issues.push(
				`High connection usage: ${metrics.activeConnections}/${metrics.totalConnections}`,
			);
			recommendations.push(
				"Consider using connection pooling (e.g., PgBouncer) to manage connections more efficiently.",
			);
		}

		return {
			healthScore: Math.max(0, healthScore),
			issues,
			recommendations,
		};
	}
}
