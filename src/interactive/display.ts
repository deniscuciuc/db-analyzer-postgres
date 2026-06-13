import { SCORE_DEDUCTIONS, THRESHOLDS } from "../constants";
import { formatBytes, formatNumber, formatPercent } from "../utils/format";
import {
	healthEmoji,
	healthLabel,
	printBullet,
	printRow,
	printSection,
	printSeparator,
	printSubBullet,
} from "../utils/print";

type HealthMetrics = {
	databaseSize: string;
	totalConnections: number;
	activeConnections: number;
	cacheHitRatio: number;
	indexHitRatio: number;
	deadTuplesRatio: number;
};

type UnusedIndex = {
	schema: string;
	table: string;
	index: string;
	size: string;
	sizeBytes: number;
	indexScans: number;
	dropStatement?: string;
};

type MissingIndex = {
	schema: string;
	table: string;
	seqScans: number;
	estimatedBenefit: string;
};

type DuplicateIndex = {
	schema: string;
	table: string;
	index1: string;
	index2: string;
	recommendation: string;
};

type ForeignKeyWithoutIndex = {
	table: string;
	column: string;
	foreignTable: string;
	foreignColumn: string;
	suggestedIndex: string;
};

type QueryStat = {
	queryPreview?: string;
	calls: number;
	totalTime: number;
	meanTime: number;
};

type LongRunningQuery = {
	pid: number;
	duration: string;
	query: string;
	waitEventType: string | null;
	waitEvent: string | null;
};

type BlockingQuery = {
	blockedPid: number;
	blockingPid: number;
	blockedDuration: string;
	blockedQuery: string;
};

type TableStat = {
	schema: string;
	table: string;
	totalSize: string;
	rowCount: number;
	tableSize: string;
	indexSize: string;
};

type VacuumNeeded = {
	schema: string;
	table: string;
	deadTuples: number;
	deadTupleRatio: number;
};

type ConnectionStats = {
	total: number;
	active: number;
	idle: number;
	idleInTransaction: number;
	waiting: number;
	byUser: { user: string; count: number }[];
	byApplication: { application: string; count: number }[];
};

type ConfigurationSetting = {
	name: string;
	setting: string;
	unit: string | null;
	category: string;
};

type Extension = {
	name: string;
	version: string;
	schema: string;
};

type ServerInfo = {
	version: string;
	uptime: string;
	maxConnections: number;
	serverEncoding: string;
	timeZone: string;
};

export function computeHealthScore(metrics: HealthMetrics): number {
	let score = 100;

	if (metrics.cacheHitRatio < THRESHOLDS.cacheHitRatio.critical) {
		score -= SCORE_DEDUCTIONS.cacheHitRatioCritical;
	} else if (metrics.cacheHitRatio < THRESHOLDS.cacheHitRatio.warning) {
		score -= SCORE_DEDUCTIONS.cacheHitRatioWarning;
	}

	if (metrics.indexHitRatio < THRESHOLDS.indexHitRatio.critical) {
		score -= SCORE_DEDUCTIONS.indexHitRatioCritical;
	}

	if (metrics.deadTuplesRatio > THRESHOLDS.deadTuplesRatio.critical) {
		score -= SCORE_DEDUCTIONS.deadTuplesCritical;
	} else if (metrics.deadTuplesRatio > THRESHOLDS.deadTuplesRatio.warning) {
		score -= SCORE_DEDUCTIONS.deadTuplesWarning;
	}

	return Math.max(0, score);
}

export function showHealth(metrics: HealthMetrics): void {
	const score = computeHealthScore(metrics);
	printRow(
		"Health score",
		`${score}/100 ${healthEmoji(score)} ${healthLabel(score)}`,
	);
	printRow("Database size", metrics.databaseSize);
	printRow("Cache hit ratio", formatPercent(metrics.cacheHitRatio));
	printRow("Index hit ratio", formatPercent(metrics.indexHitRatio));
	printRow("Dead tuples ratio", formatPercent(metrics.deadTuplesRatio));
	printRow(
		"Connections",
		`${metrics.activeConnections} active / ${metrics.totalConnections} total`,
	);
}

export function showUnusedIndexes(indexes: UnusedIndex[]): void {
	if (indexes.length === 0) {
		console.log("  ✅ No unused indexes found");
		return;
	}

	const totalSize = indexes.reduce(
		(accumulator, index) => accumulator + index.sizeBytes,
		0,
	);
	console.log(
		`  Found ${indexes.length} unused indexes — ${formatBytes(totalSize)} wasted`,
	);
	printSeparator();

	for (const index of indexes.slice(0, 10)) {
		printBullet(`${index.schema}.${index.index} (${index.size})`);
		printSubBullet(`Table: ${index.table} | Scans: ${index.indexScans}`);
	}

	if (indexes.length > 10) {
		console.log(`  ... and ${indexes.length - 10} more`);
	}
}

export function showMissingIndexes(tables: MissingIndex[]): void {
	if (tables.length === 0) {
		console.log("  ✅ No tables with missing indexes detected");
		return;
	}

	console.log(`  Found ${tables.length} tables that may need indexes:`);
	printSeparator();

	for (const table of tables.slice(0, 10)) {
		printBullet(`${table.schema}.${table.table}`);
		printSubBullet(
			`Seq scans: ${formatNumber(table.seqScans)} | Benefit: ${table.estimatedBenefit}`,
		);
	}

	if (tables.length > 10) {
		console.log(`  ... and ${tables.length - 10} more`);
	}
}

export function showDuplicateIndexes(duplicates: DuplicateIndex[]): void {
	if (duplicates.length === 0) {
		console.log("  ✅ No duplicate indexes found");
		return;
	}

	console.log(`  Found ${duplicates.length} duplicate/overlapping pairs:`);
	printSeparator();

	for (const duplicate of duplicates.slice(0, 10)) {
		printBullet(`${duplicate.schema}.${duplicate.table}`);
		printSubBullet(`${duplicate.index1} vs ${duplicate.index2}`);
		printSubBullet(duplicate.recommendation);
	}
}

export function showFKWithoutIndexes(fks: ForeignKeyWithoutIndex[]): void {
	if (fks.length === 0) {
		console.log("  ✅ All foreign keys have indexes");
		return;
	}

	console.log(`  Found ${fks.length} foreign keys without indexes:`);
	printSeparator();

	for (const fk of fks.slice(0, 10)) {
		printBullet(
			`${fk.table}.${fk.column} → ${fk.foreignTable}.${fk.foreignColumn}`,
		);
		printSubBullet(`Suggested: ${fk.suggestedIndex}`);
	}
}

export function showDropSql(indexes: UnusedIndex[]): void {
	if (indexes.length === 0) {
		console.log("  ✅ No unused indexes — nothing to drop");
		return;
	}

	console.log(`  -- DROP statements for ${indexes.length} unused indexes:`);
	printSeparator();

	for (const index of indexes) {
		console.log(
			`  ${index.dropStatement ?? `DROP INDEX CONCURRENTLY IF EXISTS ${index.schema}.${index.index};`}`,
		);
	}
}

export function showSlowQueries(queries: QueryStat[]): void {
	if (queries.length === 0) {
		console.log("  ⚠️  No query stats (pg_stat_statements required)");
		return;
	}

	console.log(`  Top ${queries.length} queries by total time:`);
	printSeparator();

	for (const [index, query] of queries.entries()) {
		console.log(`  ${index + 1}. ${query.queryPreview?.substring(0, 70)}...`);
		printSubBullet(
			`Calls: ${formatNumber(query.calls)} | Total: ${query.totalTime.toFixed(0)}ms | Mean: ${query.meanTime.toFixed(2)}ms`,
		);
	}
}

export function showLongRunning(queries: LongRunningQuery[]): void {
	if (queries.length === 0) {
		console.log("  ✅ No long-running queries");
		return;
	}

	console.log(`  Found ${queries.length} long-running queries:`);
	printSeparator();

	for (const query of queries) {
		printBullet(`PID ${query.pid}: ${query.duration}`);
		printSubBullet(query.query.substring(0, 80));
		if (query.waitEventType || query.waitEvent) {
			printSubBullet(
				`Waiting: ${query.waitEventType ?? "unknown"} / ${query.waitEvent ?? "unknown"}`,
			);
		}
	}
}

export function showBlocking(blocks: BlockingQuery[]): void {
	if (blocks.length === 0) {
		console.log("  ✅ No blocking queries");
		return;
	}

	console.log(`  ⚠️  ${blocks.length} blocking situations:`);
	printSeparator();

	for (const block of blocks) {
		printBullet(`PID ${block.blockingPid} blocking PID ${block.blockedPid}`);
		printSubBullet(`Duration: ${block.blockedDuration}`);
		printSubBullet(block.blockedQuery.substring(0, 80));
	}
}

export function showTableStats(tables: TableStat[]): void {
	console.log(`  Top ${tables.length} largest tables:`);
	printSeparator();

	for (const table of tables) {
		printBullet(`${table.schema}.${table.table}: ${table.totalSize}`);
		printSubBullet(
			`Rows: ${formatNumber(table.rowCount)} | Table: ${table.tableSize} | Indexes: ${table.indexSize}`,
		);
	}
}

export function showVacuumNeeded(tables: VacuumNeeded[]): void {
	if (tables.length === 0) {
		console.log("  ✅ No tables urgently need VACUUM");
		return;
	}

	console.log(`  Found ${tables.length} tables needing VACUUM:`);
	printSeparator();

	for (const table of tables.slice(0, 10)) {
		printBullet(`${table.schema}.${table.table}`);
		printSubBullet(
			`Dead tuples: ${formatNumber(table.deadTuples)} (${formatPercent(table.deadTupleRatio, 1)})`,
		);
	}

	if (tables.length > 10) {
		console.log(`  ... and ${tables.length - 10} more`);
	}
}

export function showConnections(stats: ConnectionStats): void {
	printRow("Total", stats.total);
	printRow("Active", stats.active);
	printRow("Idle", stats.idle);
	printRow("Idle in transaction", stats.idleInTransaction);
	printRow("Waiting", stats.waiting);

	if (stats.byUser.length > 0) {
		printSection("By user");
		for (const entry of stats.byUser.slice(0, 5)) {
			printBullet(`${entry.user}: ${entry.count}`);
		}
	}

	if (stats.byApplication.length > 0) {
		printSection("By application");
		for (const entry of stats.byApplication.slice(0, 5)) {
			printBullet(`${entry.application}: ${entry.count}`);
		}
	}
}

export function showConfig(settings: ConfigurationSetting[]): void {
	console.log("  Important settings:");
	printSeparator();

	for (const setting of settings.slice(0, 15)) {
		const value = setting.unit
			? `${setting.setting}${setting.unit}`
			: setting.setting;
		printBullet(`${setting.name}: ${value}`);
		printSubBullet(setting.category);
	}
}

export function showExtensions(extensions: Extension[]): void {
	console.log(`  Installed extensions (${extensions.length}):`);
	printSeparator();

	for (const extension of extensions) {
		printBullet(`${extension.name} v${extension.version}`);
		printSubBullet(`Schema: ${extension.schema}`);
	}
}

export function showServerInfo(info: ServerInfo): void {
	printRow("Version", info.version);
	printRow("Uptime", info.uptime);
	printRow("Max connections", info.maxConnections);
	printRow("Encoding", info.serverEncoding);
	printRow("Time zone", info.timeZone);
}

export function showCurrentSettings(
	profile: string | undefined,
	schemas: string[] | undefined,
	tables: string[] | undefined,
): void {
	printRow("Active profile", profile ?? "(none — using env / flags)");
	printRow("Schema filter", schemas?.join(", ") ?? "(all schemas)");
	printRow("Table filter", tables?.join(", ") ?? "(all tables)");
}
