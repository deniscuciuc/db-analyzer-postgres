import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PostgresAnalyzer } from "../src/api";
import * as api from "../src/index";
import { ReportGenerator } from "../src/reporters/report-generator";
import type { AnalysisReport } from "../src/types";

function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
	return {
		generatedAt: new Date("2026-09-10T00:00:00Z"),
		databaseName: "analyze",
		metrics: {
			databaseSize: "100 MB",
			databaseSizeBytes: 104_857_600,
			totalConnections: 5,
			activeConnections: 3,
			idleConnections: 2,
			cacheHitRatio: 99.5,
			indexHitRatio: 98.2,
			deadTuplesRatio: 1,
			bloatEstimate: "2 MB",
		},
		unusedIndexes: [],
		missingIndexes: [],
		duplicateIndexes: [],
		tableStats: [],
		slowQueries: [],
		bloatedTables: [],
		recommendations: [],
		...overrides,
	};
}

test("the library entry point exports the analyzer and helpers", () => {
	assert.equal(typeof api.PostgresAnalyzer, "function");
	assert.equal(typeof api.quoteIdentifier, "function");
	assert.equal(typeof api.calculateHealthScore, "function");
	assert.equal(typeof api.ReportGenerator, "function");
	assert.equal(typeof api.IndexAnalyzer, "function");
	assert.ok(Array.isArray(api.COMMANDS));
});

test("constructing an analyzer opens no connection", () => {
	const analyzer = new PostgresAnalyzer({ host: "203.0.113.1", port: 1 });
	assert.ok(analyzer instanceof PostgresAnalyzer);
});

test("analyze reports a connection failure clearly", async () => {
	const analyzer = new PostgresAnalyzer({ host: "127.0.0.1", port: 1 });

	await assert.rejects(
		() => analyzer.analyze(),
		(error: Error) => {
			assert.match(error.message, /Cannot connect to PostgreSQL/);
			return true;
		},
	);

	await analyzer.close();
});

test("close is safe when never connected, and idempotent", async () => {
	const analyzer = new PostgresAnalyzer();
	await analyzer.close();
	await analyzer.close();
});

test("a caller-supplied pool is not ended by close", async () => {
	let endCalls = 0;
	const fakePool = {
		on: () => fakePool,
		query: async () => ({ rows: [{ "?column?": 1 }] }),
		end: async () => {
			endCalls++;
		},
	};

	const analyzer = new PostgresAnalyzer({ pool: fakePool as never });
	await analyzer.connect();
	await analyzer.close();

	assert.equal(endCalls, 0, "close must not end a pool it does not own");
});

test("healthScore returns a number for a healthy report", () => {
	const analyzer = new PostgresAnalyzer();

	const score = analyzer.healthScore(report());

	assert.equal(typeof score, "number");
	assert.ok(score > 0 && score <= 100, `score was ${score}`);
});

test("healthScore drops when the cache hit ratio is poor", () => {
	const analyzer = new PostgresAnalyzer();

	const healthy = analyzer.healthScore(report());
	const unhealthy = analyzer.healthScore(
		report({
			metrics: {
				...report().metrics,
				cacheHitRatio: 60,
				indexHitRatio: 60,
				deadTuplesRatio: 25,
			},
		}),
	);

	assert.ok(unhealthy < healthy, `${unhealthy} should be below ${healthy}`);
});

test("the markdown report contains the database name and metrics", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "pg-report-"));
	const generator = new ReportGenerator(outputDir, {});

	const path = await generator.generateFullReport(report());
	const contents = readFileSync(path, "utf8");

	assert.ok(path.endsWith(".md"), path);
	// Asserting on content, not just that a file appeared with the right extension.
	assert.match(contents, /analyze/);
	assert.match(contents, /100 MB/);
});

test("the json report is valid JSON carrying the report", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "pg-report-"));
	const generator = new ReportGenerator(outputDir, {});

	const path = await generator.generateJsonReport(report());
	const parsed = JSON.parse(readFileSync(path, "utf8"));

	assert.ok(path.endsWith(".json"), path);
	assert.equal(parsed.databaseName ?? parsed.report?.databaseName, "analyze");
});

test("the html report escapes a hostile identifier", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "pg-report-"));
	const generator = new ReportGenerator(outputDir, {});

	const path = await generator.generateHtmlReport(
		report({
			unusedIndexes: [
				{
					schema: "public",
					table: "<script>alert(1)</script>",
					index: "idx_evil",
					size: "1 MB",
					sizeBytes: 1_048_576,
					indexScans: 0,
					isUnique: false,
					isPrimary: false,
					definition: "CREATE INDEX ...",
					reason: "Never scanned",
				} as never,
			],
		}),
	);
	const contents = readFileSync(path, "utf8");

	assert.ok(path.endsWith(".html"), path);
	assert.ok(
		!contents.includes("<script>alert(1)</script>"),
		"a table name must not be interpolated into the HTML unescaped",
	);
	assert.match(contents, /&lt;script&gt;/);
});
