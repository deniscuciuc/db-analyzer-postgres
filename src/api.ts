import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import { Pool } from "pg";
import { buildFullReport } from "./cli/runner";
import { DEFAULTS } from "./constants";
import { ReportGenerator } from "./reporters/report-generator";
import { calculateHealthScore } from "./thresholds";
import type {
	AnalysisReport,
	AnalyzerOptions,
	ThresholdOverrides,
	VacuumSummary,
} from "./types";

/** Connection and analysis settings for {@link PostgresAnalyzer}. */
export interface PostgresAnalyzerOptions {
	/** Host name. Defaults to `localhost`. */
	host?: string;
	/** Port. Defaults to `5432`. */
	port?: number;
	/** Database name. Defaults to `postgres`. */
	database?: string;
	/** User name. Defaults to `postgres`. */
	user?: string;
	/** Password, if the server requires one. */
	password?: string;
	/**
	 * Enable TLS. The server certificate is verified unless {@link sslRejectUnauthorized}
	 * is set to `false`. Defaults to `false`.
	 */
	ssl?: boolean;
	/** Path to a CA bundle used to verify the server certificate. Implies {@link ssl}. */
	sslCa?: string;
	/**
	 * Set to `false` to skip certificate verification. Leaves the connection open to
	 * interception, so it must be an explicit choice.
	 */
	sslRejectUnauthorized?: boolean;
	/** Restrict analysis to these schemas. */
	schemas?: string[];
	/** Restrict analysis to these tables. */
	tables?: string[];
	/** Directory that {@link PostgresAnalyzer.generateReport} writes into. Defaults to `./reports`. */
	outputDir?: string;
	/** Queries slower than this many milliseconds are reported. Defaults to `100`. */
	slowQueryThresholdMs?: number;
	/** Below this many scans an index is considered unused. Defaults to `50`. */
	minIndexScans?: number;
	/** Override the built-in health thresholds. */
	thresholds?: ThresholdOverrides;
	/**
	 * Use this pool instead of creating one. The caller keeps ownership: `close()` will not
	 * end a pool it did not create.
	 */
	pool?: Pool;
}

/**
 * Programmatic entry point for the PostgreSQL analyzer.
 *
 * Importing this module has no side effects — unlike the CLI entry point, which connects and
 * runs an analysis on import. Always `close()` when finished, ideally in a `finally`.
 *
 * ```ts
 * import { PostgresAnalyzer } from "@deniscuciuc/pg-analyzer";
 *
 * const analyzer = new PostgresAnalyzer({ database: "app", user: "postgres" });
 * try {
 *   const report = await analyzer.analyze();
 *   console.log(analyzer.healthScore(report));
 * } finally {
 *   await analyzer.close();
 * }
 * ```
 */
export class PostgresAnalyzer {
	private readonly options: PostgresAnalyzerOptions;
	private readonly analyzerOptions: AnalyzerOptions;
	private readonly ownsPool: boolean;
	private pool: Pool | undefined;

	constructor(options: PostgresAnalyzerOptions = {}) {
		this.options = options;

		this.analyzerOptions = {
			slowQueryThresholdMs:
				options.slowQueryThresholdMs ?? DEFAULTS.slowQueryThreshold,
			minIndexScans: options.minIndexScans ?? DEFAULTS.minIndexScans,
			topQueriesLimit: 50,
			outputDir: options.outputDir ?? DEFAULTS.output,
			schemas: options.schemas,
			tables: options.tables,
			thresholds: options.thresholds,
		};

		this.pool = options.pool;
		this.ownsPool = options.pool === undefined;
	}

	/**
	 * Creates the connection pool and verifies it can reach the server. Called automatically
	 * by {@link analyze}; call it directly to surface a connection failure early.
	 */
	async connect(): Promise<void> {
		if (!this.pool) {
			this.pool = new Pool({
				host: this.options.host ?? DEFAULTS.host,
				port: this.options.port ?? DEFAULTS.port,
				database: this.options.database ?? DEFAULTS.database,
				user: this.options.user ?? DEFAULTS.user,
				password: this.options.password,
				ssl: this.buildSslConfig(),
			});

			// pg emits 'error' on idle-client failures; with no listener Node treats it as an
			// unhandled error event and terminates the process.
			this.pool.on("error", () => {});
		}

		try {
			await this.pool.query("SELECT 1");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Cannot connect to PostgreSQL: ${message}`);
		}
	}

	/** Runs a full analysis and returns the report. */
	async analyze(): Promise<AnalysisReport> {
		await this.connect();

		return buildFullReport(this.requirePool(), {
			...this.analyzerOptions,
			command: "full",
		} as never);
	}

	/** Computes the health score for a report, 0 to 100. */
	healthScore(report: AnalysisReport): number {
		return calculateHealthScore(report, this.analyzerOptions.thresholds);
	}

	/**
	 * Runs `VACUUM ANALYZE` on the tables that need it.
	 *
	 * This changes server state, which is why it is a separate method rather than part of
	 * {@link analyze}.
	 */
	async vacuum(options: { full?: boolean } = {}): Promise<VacuumSummary> {
		await this.connect();

		const { TableAnalyzer } = await import("./analyzers/table-analyzer");
		const tables = new TableAnalyzer(this.requirePool(), this.analyzerOptions);

		return tables.autoVacuum({ analyze: true, full: options.full });
	}

	/**
	 * Writes a report to {@link PostgresAnalyzerOptions.outputDir}.
	 *
	 * @param format Output format. Defaults to `markdown`.
	 * @param report A report from {@link analyze}; one is generated if omitted.
	 * @returns The path of the file written.
	 */
	async generateReport(
		format: "markdown" | "json" | "html" = "markdown",
		report?: AnalysisReport,
	): Promise<string> {
		const resolved = report ?? (await this.analyze());
		const generator = new ReportGenerator(
			this.analyzerOptions.outputDir ?? DEFAULTS.output,
			this.analyzerOptions,
		);

		switch (format) {
			case "json":
				return generator.generateJsonReport(resolved);
			case "html":
				return generator.generateHtmlReport(resolved);
			default:
				return generator.generateFullReport(resolved);
		}
	}

	/**
	 * Closes the pool. Does nothing when the pool was supplied by the caller, who retains
	 * ownership of it.
	 */
	async close(): Promise<void> {
		if (!this.pool || !this.ownsPool) {
			return;
		}

		const pool = this.pool;
		this.pool = undefined;
		await pool.end();
	}

	private buildSslConfig(): ConnectionOptions | undefined {
		const { ssl, sslCa, sslRejectUnauthorized } = this.options;

		if (!ssl && !sslCa) {
			return undefined;
		}

		if (sslCa) {
			return { ca: readFileSync(sslCa, "utf8") };
		}

		// Verification is on unless explicitly disabled: TLS without it encrypts but does
		// not authenticate the server.
		return sslRejectUnauthorized === false ? { rejectUnauthorized: false } : {};
	}

	private requirePool(): Pool {
		if (!this.pool) {
			throw new Error("Not connected. Call connect() first.");
		}
		return this.pool;
	}
}
