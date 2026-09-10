import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import { Pool } from "pg";
import { loadConfig, resolveProfile } from "../config/loader";
import { DEFAULTS } from "../constants";
import { InteractiveCLI } from "../interactive";
import { runWatchLoop } from "../watch/runner";
import { parseOptions, toAnalyzerOptions } from "./options";
import { executeCommand } from "./runner";
import { assertConfirmedIfDestructive, assertKnownCommand } from "./validate";

function resolveValue<T>(
	cliValue: T | undefined,
	envValue: T | undefined,
	profileValue: T | undefined,
	fallbackValue: T,
	preferProfile: boolean,
): T {
	if (cliValue !== undefined && cliValue !== fallbackValue) {
		return cliValue;
	}

	if (preferProfile) {
		return profileValue ?? envValue ?? cliValue ?? fallbackValue;
	}

	return envValue ?? profileValue ?? cliValue ?? fallbackValue;
}

function buildSslConfig(
	enabled: boolean,
	caPath: string | undefined,
	noVerify: boolean,
): ConnectionOptions | undefined {
	if (!enabled) {
		return undefined;
	}

	if (caPath) {
		return { ca: readFileSync(caPath, "utf8") };
	}

	// Opting out of verification has to be explicit: --ssl alone encrypts *and*
	// authenticates, so a misconfigured server fails loudly instead of silently
	// leaving the connection open to interception.
	return noVerify ? { rejectUnauthorized: false } : {};
}

async function main(): Promise<void> {
	const options = parseOptions();
	const config = loadConfig(options.config);
	const profile = resolveProfile(config, options.profile);
	const preferProfile = Boolean(options.profile);

	if (options.watch !== undefined && options.json) {
		throw new Error("--watch cannot be combined with --json.");
	}

	// Validate before opening a connection so a typo fails immediately rather
	// than after a connection timeout.
	assertKnownCommand(options.command);
	assertConfirmedIfDestructive(options);

	const envSsl =
		process.env.DB_SSL === "true" || process.env.PGSSLMODE === "require"
			? true
			: undefined;
	const envPort = process.env.DB_PORT ?? process.env.PGPORT;
	const ssl = resolveValue(
		options.ssl,
		envSsl,
		profile.ssl,
		false,
		preferProfile,
	);

	const pool = new Pool({
		host: resolveValue(
			options.host,
			process.env.DB_HOST ?? process.env.PGHOST,
			profile.host,
			DEFAULTS.host,
			preferProfile,
		),
		port: resolveValue(
			options.port,
			envPort ? Number.parseInt(envPort, 10) : undefined,
			profile.port,
			DEFAULTS.port,
			preferProfile,
		),
		database: resolveValue(
			options.database,
			process.env.DB_NAME ?? process.env.PGDATABASE,
			profile.database,
			DEFAULTS.database,
			preferProfile,
		),
		user: resolveValue(
			options.user,
			process.env.DB_USER ?? process.env.PGUSER,
			profile.user,
			DEFAULTS.user,
			preferProfile,
		),
		password: resolveValue(
			options.password,
			process.env.DB_PASSWORD ?? process.env.PGPASSWORD,
			profile.password,
			"",
			preferProfile,
		),
		ssl: buildSslConfig(ssl, options.sslCa, options.sslNoVerify),
	});

	// pg emits 'error' on idle clients; without a listener Node treats it as an
	// unhandled error event and kills the process. That is near-certain in watch
	// mode, which holds the pool open for hours.
	pool.on("error", (error) => {
		console.warn(`Postgres pool error: ${error.message}`);
	});

	const runtimeOptions = {
		...options,
		outputDir: resolveValue(
			options.outputDir,
			undefined,
			config.output,
			DEFAULTS.output,
			false,
		),
		slowQueryThreshold: resolveValue(
			options.slowQueryThreshold,
			undefined,
			config.slowQueryThreshold,
			DEFAULTS.slowQueryThreshold,
			false,
		),
		minIndexScans: resolveValue(
			options.minIndexScans,
			undefined,
			config.minIndexScans,
			DEFAULTS.minIndexScans,
			false,
		),
		thresholds: config.thresholds,
	};

	try {
		if (runtimeOptions.interactive) {
			const cli = new InteractiveCLI(pool, {
				...toAnalyzerOptions(runtimeOptions),
				slowQueryThresholdMs: runtimeOptions.slowQueryThreshold,
				minIndexScans: runtimeOptions.minIndexScans,
				outputDir: runtimeOptions.outputDir,
				thresholds: config.thresholds,
			});
			await cli.start();
			return;
		}

		if (runtimeOptions.watch !== undefined) {
			await runWatchLoop({
				intervalSeconds: runtimeOptions.watch,
				command: runtimeOptions.command,
				runCommand: () => executeCommand(pool, runtimeOptions),
			});
			return;
		}

		await executeCommand(pool, runtimeOptions);
	} finally {
		await pool.end();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error("Error during analysis:", message);
	// Set exitCode rather than calling process.exit, which can truncate buffered
	// stdout — e.g. a large --json report being piped to a file.
	process.exitCode = 1;
});
