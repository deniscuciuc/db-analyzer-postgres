export const COMMANDS = [
	"full",
	"health",
	"server-info",
	"unused-indexes",
	"missing-indexes",
	"duplicate-indexes",
	"fk-without-indexes",
	"generate-drop-sql",
	"slow-queries",
	"long-running",
	"blocking",
	"tables",
	"vacuum-needed",
	"run-vacuum",
	"connections",
	"config",
	"extensions",
	"create-pg-stat-statements",
	"drop-pg-stat-statements",
] as const;

export type Command = (typeof COMMANDS)[number];

export const FULL_ANALYSIS_COMMANDS: Command[] = [
	"health",
	"server-info",
	"unused-indexes",
	"missing-indexes",
	"duplicate-indexes",
	"fk-without-indexes",
	"slow-queries",
	"long-running",
	"blocking",
	"tables",
	"vacuum-needed",
	"connections",
	"config",
	"extensions",
];

export const WATCH_ALLOWED = new Set<Command>([
	"health",
	"connections",
	"long-running",
	"blocking",
	"tables",
	"vacuum-needed",
]);

export const WATCH_BLOCKED = new Set<Command>([
	"run-vacuum",
	"generate-drop-sql",
	"create-pg-stat-statements",
	"drop-pg-stat-statements",
]);

export const THRESHOLDS = {
	cacheHitRatio: { warning: 95, critical: 90 },
	indexHitRatio: { warning: 95, critical: 90 },
	deadTuplesRatio: { warning: 5, critical: 10 },
} as const;

export const SCORE_DEDUCTIONS = {
	cacheHitRatioCritical: 20,
	cacheHitRatioWarning: 10,
	indexHitRatioCritical: 15,
	deadTuplesWarning: 5,
	deadTuplesCritical: 15,
} as const;

export const DEFAULTS = {
	host: "localhost",
	port: 5432,
	database: "postgres",
	user: "postgres",
	slowQueryThreshold: 100,
	minIndexScans: 50,
	output: "./reports",
	watchInterval: 30,
} as const;
