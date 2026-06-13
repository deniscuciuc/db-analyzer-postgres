export interface DatabaseConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: boolean | { rejectUnauthorized: boolean };
}

export interface ReportThreshold {
	warning: number;
	critical: number;
}

export interface ThresholdOverrides {
	cacheHitRatio?: ReportThreshold;
	indexHitRatio?: ReportThreshold;
	deadTuplesRatio?: ReportThreshold;
}

export interface IndexInfo {
	schema: string;
	table: string;
	index: string;
	columns: string;
	indexType: string;
	size: string;
	sizeBytes: number;
}

export interface UnusedIndex extends IndexInfo {
	indexScans: number;
	lastUsed: Date | null;
	isUnique?: boolean;
	isPrimary?: boolean;
	usageStatus?: string;
	indexDefinition?: string;
	dropStatement?: string;
}

export interface MissingIndex {
	schema: string;
	table: string;
	columns: string;
	seqScans: number;
	seqTupRead: number;
	estimatedBenefit: string;
	suggestedIndex: string;
}

export interface DuplicateIndex {
	schema: string;
	table: string;
	index1: string;
	index2: string;
	columns1: string;
	columns2: string;
	recommendation: string;
}

export interface TableStats {
	schema: string;
	table: string;
	rowCount: number;
	totalSize: string;
	totalSizeBytes: number;
	tableSize: string;
	indexSize: string;
	seqScans: number;
	indexScans: number;
	deadTuples: number;
	deadTupleRatio: number;
	lastVacuum: Date | null;
	lastAnalyze: Date | null;
}

export interface QueryStats {
	queryId: string;
	query: string;
	queryPreview?: string;
	calls: number;
	totalTime: number;
	meanTime: number;
	minTime: number;
	maxTime: number;
	rows: number;
	sharedBlksHit: number;
	sharedBlksRead: number;
	hitRatio: number;
}

export interface SlowQuery extends QueryStats {
	recommendations: string[];
}

export interface DatabaseMetrics {
	databaseSize: string;
	databaseSizeBytes: number;
	totalConnections: number;
	activeConnections: number;
	idleConnections: number;
	cacheHitRatio: number;
	indexHitRatio: number;
	deadTuplesRatio: number;
	bloatEstimate: string;
}

export interface LockInfo {
	pid: number;
	lockType: string;
	mode: string;
	granted: boolean;
	waitingPid: number | null;
	query: string;
	duration: string;
}

export interface BloatedTable {
	schema: string;
	table: string;
	bloatSize: string;
	bloatSizeBytes: number;
	bloatRatio: number;
	recommendation: string;
}

export interface AnalysisReport {
	generatedAt: Date;
	databaseName: string;
	metrics: DatabaseMetrics;
	unusedIndexes: UnusedIndex[];
	missingIndexes: MissingIndex[];
	duplicateIndexes: DuplicateIndex[];
	tableStats: TableStats[];
	slowQueries: SlowQuery[];
	bloatedTables: BloatedTable[];
	recommendations: string[];
}

export type FullReport = AnalysisReport;

export interface AnalyzerOptions {
	includeSystemTables?: boolean;
	minIndexScans?: number;
	minSeqScans?: number;
	slowQueryThresholdMs?: number;
	topQueriesLimit?: number;
	excludeSchemas?: string[];
	outputDir?: string;
	schemas?: string[];
	tables?: string[];
	thresholds?: ThresholdOverrides;
}

export interface VacuumTarget {
	schema: string;
	table: string;
}

export interface VacuumResult {
	schema: string;
	table: string;
	success: boolean;
	duration: number;
	error?: string;
}

export interface VacuumSummary {
	totalTables: number;
	successful: number;
	failed: number;
	totalDuration: number;
	results: VacuumResult[];
}
