import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions, toAnalyzerOptions } from "../src/cli/options";
import {
	assertConfirmedIfDestructive,
	assertKnownCommand,
} from "../src/cli/validate";
import { DEFAULTS } from "../src/constants";

test("parseOptions returns the documented defaults", () => {
	const options = parseOptions([]);

	assert.equal(options.host, DEFAULTS.host);
	assert.equal(options.port, DEFAULTS.port);
	assert.equal(options.database, DEFAULTS.database);
	assert.equal(options.user, DEFAULTS.user);
	assert.equal(options.command, "full");
	assert.equal(options.ssl, false);
	assert.equal(options.json, false);
	assert.equal(options.yes, false);
	assert.equal(options.dryRun, false);
});

test("parseOptions reads connection flags", () => {
	const options = parseOptions([
		"--host",
		"db.example.com",
		"--port",
		"6543",
		"--database",
		"app",
		"--user",
		"reader",
		"--password",
		"secret",
	]);

	assert.equal(options.host, "db.example.com");
	assert.equal(options.port, 6543);
	assert.equal(options.database, "app");
	assert.equal(options.user, "reader");
	assert.equal(options.password, "secret");
});

test("parseOptions supports the short flag aliases", () => {
	const options = parseOptions([
		"-h",
		"h",
		"-p",
		"1234",
		"-d",
		"d",
		"-U",
		"u",
		"-W",
		"w",
		"-j",
		"-q",
	]);

	assert.equal(options.host, "h");
	assert.equal(options.port, 1234);
	assert.equal(options.database, "d");
	assert.equal(options.user, "u");
	assert.equal(options.password, "w");
	assert.equal(options.json, true);
	assert.equal(options.quiet, true);
});

test("--ssl enables TLS with verification left on", () => {
	const options = parseOptions(["--ssl"]);

	assert.equal(options.ssl, true);
	assert.equal(options.sslNoVerify, false);
	assert.equal(options.sslCa, undefined);
});

test("--ssl-ca implies --ssl and records the bundle path", () => {
	const options = parseOptions(["--ssl-ca", "/etc/ssl/rds.pem"]);

	assert.equal(options.ssl, true);
	assert.equal(options.sslCa, "/etc/ssl/rds.pem");
});

test("--ssl-no-verify must be explicit", () => {
	const options = parseOptions(["--ssl-no-verify"]);

	assert.equal(options.ssl, true);
	assert.equal(options.sslNoVerify, true);
});

test("--watch defaults its interval and accepts one", () => {
	assert.equal(parseOptions(["--watch"]).watch, DEFAULTS.watchInterval);
	assert.equal(parseOptions(["--watch", "5"]).watch, 5);
	// A following flag must not be consumed as the interval.
	assert.equal(
		parseOptions(["--watch", "--json"]).watch,
		DEFAULTS.watchInterval,
	);
});

test("a non-positive watch interval is rejected", () => {
	assert.throws(() => parseOptions(["--watch", "0"]), /Invalid watch interval/);
	// A negative value used to be mistaken for a flag and silently replaced by the default.
	assert.throws(
		() => parseOptions(["--watch", "-1"]),
		/Invalid watch interval/,
	);
});

test("a non-numeric flag value is rejected with the flag named", () => {
	assert.throws(
		() => parseOptions(["--port", "abc"]),
		/--port must be a positive number/,
	);
	assert.throws(
		() => parseOptions(["-p", "0"]),
		/--port must be a positive number/,
	);
	assert.throws(
		() => parseOptions(["--slow-query-threshold", "fast"]),
		/--slow-query-threshold must be a positive number/,
	);
	assert.throws(
		() => parseOptions(["--min-index-scans", "-5"]),
		/--min-index-scans requires a value/,
	);
});

test("a flag at the end of argv is rejected rather than storing undefined", () => {
	assert.throws(() => parseOptions(["--host"]), /--host requires a value/);
	assert.throws(
		() => parseOptions(["--command"]),
		/--command requires a value/,
	);
	assert.throws(() => parseOptions(["--port"]), /--port requires a value/);
});

test("an unknown flag is rejected rather than ignored", () => {
	// --jsno used to silently produce human-readable output instead of JSON.
	assert.throws(() => parseOptions(["--jsno"]), /Unknown option: --jsno/);
	assert.throws(() => parseOptions(["-Z"]), /Unknown option: -Z/);
});

test("list flags are split and trimmed", () => {
	const options = parseOptions([
		"--schemas",
		"public, app ,",
		"--tables",
		"users,orders",
	]);

	assert.deepEqual(options.schemas, ["public", "app"]);
	assert.deepEqual(options.tables, ["users", "orders"]);
});

test("an empty list flag is treated as unset", () => {
	assert.equal(parseOptions(["--schemas", " , "]).schemas, undefined);
});

test("start is an alias for --interactive", () => {
	assert.equal(parseOptions(["start"]).interactive, true);
	assert.equal(parseOptions(["-i"]).interactive, true);
});

test("toAnalyzerOptions maps threshold names the analyzers expect", () => {
	const options = parseOptions([
		"--slow-query-threshold",
		"250",
		"--min-index-scans",
		"7",
	]);
	const analyzerOptions = toAnalyzerOptions(options);

	// The CLI field is slowQueryThreshold; the analyzers read slowQueryThresholdMs.
	assert.equal(analyzerOptions.slowQueryThresholdMs, 250);
	assert.equal(analyzerOptions.minIndexScans, 7);
});

test("assertKnownCommand rejects an unrecognised command", () => {
	assert.throws(() => assertKnownCommand("helth"), /Unknown command: helth/);
	assert.doesNotThrow(() => assertKnownCommand("health"));
	assert.doesNotThrow(() => assertKnownCommand("full"));
});

test("a destructive command needs --yes or --dry-run", () => {
	const base = parseOptions(["-c", "run-vacuum"]);

	assert.throws(
		() => assertConfirmedIfDestructive(base),
		/run-vacuum changes server state/,
	);
	assert.doesNotThrow(() =>
		assertConfirmedIfDestructive({ ...base, yes: true }),
	);
	assert.doesNotThrow(() =>
		assertConfirmedIfDestructive({ ...base, dryRun: true }),
	);
});

test("a read-only command needs no confirmation", () => {
	assert.doesNotThrow(() =>
		assertConfirmedIfDestructive(parseOptions(["-c", "health"])),
	);
});

test("the pg_stat_statements DDL commands are treated as destructive", () => {
	for (const command of [
		"create-pg-stat-statements",
		"drop-pg-stat-statements",
	]) {
		assert.throws(
			() => assertConfirmedIfDestructive(parseOptions(["-c", command])),
			new RegExp(`${command} changes server state`),
		);
	}
});
