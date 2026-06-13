import { DEFAULTS } from "../constants";
import type { AnalyzerOptions } from "../types";

export interface ParsedOptions extends AnalyzerOptions {
	host: string;
	port: number;
	database: string;
	user: string;
	password?: string;
	ssl: boolean;
	profile?: string;
	config?: string;
	schemas?: string[];
	tables?: string[];
	compare?: string;
	html: boolean;
	watch?: number;
	command: string;
	json: boolean;
	quiet: boolean;
	outputDir: string;
	slowQueryThreshold: number;
	minIndexScans: number;
	interactive: boolean;
}

export function parseOptions(argv = process.argv.slice(2)): ParsedOptions {
	const options: ParsedOptions = {
		host: DEFAULTS.host,
		port: DEFAULTS.port,
		database: DEFAULTS.database,
		user: DEFAULTS.user,
		ssl: false,
		command: "full",
		json: false,
		quiet: false,
		html: false,
		outputDir: DEFAULTS.output,
		slowQueryThreshold: DEFAULTS.slowQueryThreshold,
		minIndexScans: DEFAULTS.minIndexScans,
		interactive: false,
	};

	for (let index = 0; index < argv.length; index++) {
		switch (argv[index]) {
			case "--host":
			case "-h":
				options.host = argv[++index];
				break;
			case "--port":
			case "-p":
				options.port = Number.parseInt(argv[++index], 10);
				break;
			case "--database":
			case "-d":
				options.database = argv[++index];
				break;
			case "--user":
			case "-U":
				options.user = argv[++index];
				break;
			case "--password":
			case "-W":
				options.password = argv[++index];
				break;
			case "--ssl":
				options.ssl = true;
				break;
			case "--output":
			case "-o":
				options.outputDir = argv[++index];
				break;
			case "--profile":
				options.profile = argv[++index];
				break;
			case "--config":
				options.config = argv[++index];
				break;
			case "--schemas":
				options.schemas = parseList(argv[++index]);
				break;
			case "--tables":
				options.tables = parseList(argv[++index]);
				break;
			case "--compare":
				options.compare = argv[++index];
				break;
			case "--html":
				options.html = true;
				break;
			case "--watch": {
				const nextValue = argv[index + 1];
				if (nextValue && !nextValue.startsWith("-")) {
					options.watch = Number.parseInt(nextValue, 10);
					index++;
				} else {
					options.watch = DEFAULTS.watchInterval;
				}
				break;
			}
			case "--slow-query-threshold":
				options.slowQueryThreshold = Number.parseInt(argv[++index], 10);
				break;
			case "--min-index-scans":
				options.minIndexScans = Number.parseInt(argv[++index], 10);
				break;
			case "--help":
				printHelp();
				process.exit(0);
				return options;
			case "--json":
			case "-j":
				options.json = true;
				break;
			case "--quiet":
			case "-q":
				options.quiet = true;
				break;
			case "--command":
			case "-c":
				options.command = argv[++index];
				break;
			case "--interactive":
			case "-i":
			case "start":
				options.interactive = true;
				break;
		}
	}

	if (options.watch !== undefined) {
		if (!Number.isFinite(options.watch) || options.watch <= 0) {
			throw new Error(`Invalid watch interval: ${options.watch}`);
		}
	}

	return options;
}

export function toAnalyzerOptions(options: ParsedOptions): AnalyzerOptions {
	return {
		slowQueryThresholdMs: options.slowQueryThreshold,
		minIndexScans: options.minIndexScans,
		topQueriesLimit: 50,
		outputDir: options.outputDir,
		schemas: options.schemas,
		tables: options.tables,
		thresholds: options.thresholds,
	};
}

function parseList(value?: string): string[] | undefined {
	const entries = value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	return entries && entries.length > 0 ? entries : undefined;
}

function printHelp(): void {
	console.log(`
PostgreSQL Database Analyzer
============================

Usage:
  npx ts-node index.ts [options]

Connection options:
  -h, --host <host>              Database host (env: DB_HOST/PGHOST)
  -p, --port <port>              Database port (env: DB_PORT/PGPORT)
  -d, --database <name>          Database name (env: DB_NAME/PGDATABASE)
  -U, --user <user>              Database user (env: DB_USER/PGUSER)
  -W, --password <pass>          Database password (env: DB_PASSWORD/PGPASSWORD)
  --ssl                          Enable SSL (env: DB_SSL=true)
  --profile <name>               Use named profile from .analyzerrc.json
  --config <path>                Use a custom config file path

Analysis options:
  --slow-query-threshold <ms>    Slow query threshold in ms (default: ${DEFAULTS.slowQueryThreshold})
  --min-index-scans <n>          Min scans to consider index used (default: ${DEFAULTS.minIndexScans})
  --schemas <list>               Comma-separated schemas to analyze
  --tables <list>                Comma-separated tables to analyze
  --compare <path>               Compare against a previous JSON report
  --watch [seconds]              Watch mode (default interval: ${DEFAULTS.watchInterval}s)

Output options:
  -o, --output <dir>             Output directory for reports (default: ${DEFAULTS.output})
  -j, --json                     Output JSON to stdout
  --html                         Also generate an HTML report
  -q, --quiet                    Suppress non-essential output
  -i, --interactive              Interactive mode with menu
  start                          Alias for --interactive

Commands:
  -c, --command <cmd>            Run a specific analysis command

Available commands:
  full
  health
  server-info
  unused-indexes
  missing-indexes
  duplicate-indexes
  fk-without-indexes
  generate-drop-sql
  slow-queries
  long-running
  blocking
  tables
  vacuum-needed
  run-vacuum
  connections
  config
  extensions
  create-pg-stat-statements
  drop-pg-stat-statements
`);
}
