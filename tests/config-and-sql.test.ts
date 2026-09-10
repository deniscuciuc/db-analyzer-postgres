import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, resolveProfile } from "../src/config/loader";
import { quoteIdentifier, quoteQualifiedName } from "../src/utils/sql";

function writeConfig(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pg-config-"));
	const path = join(dir, "config.json");
	writeFileSync(path, contents);
	return path;
}

test("loadConfig reads an explicit config path", () => {
	const path = writeConfig(
		JSON.stringify({
			output: "./out",
			slowQueryThreshold: 250,
			profiles: { staging: { host: "staging.example.com", port: 6543 } },
		}),
	);

	const config = loadConfig(path);

	assert.equal(config.output, "./out");
	assert.equal(config.slowQueryThreshold, 250);
	assert.equal(config.profiles?.staging?.host, "staging.example.com");
});

test("a missing explicit config path is an error, not a silent fallback", () => {
	assert.throws(
		() => loadConfig(join(tmpdir(), "does-not-exist-9f3a.json")),
		/Config file not found/,
	);
});

test("malformed JSON at an explicit path names the file", () => {
	const path = writeConfig("{ not json");

	assert.throws(() => loadConfig(path), /Could not parse config file/);
	assert.throws(
		() => loadConfig(path),
		new RegExp(path.replace(/[/\\]/g, "\\$&")),
	);
});

test("resolveProfile returns the named profile", () => {
	const config = {
		profiles: {
			prod: { host: "prod.example.com", port: 5432 },
			staging: { host: "staging.example.com" },
		},
	};

	assert.equal(resolveProfile(config, "prod").host, "prod.example.com");
	assert.equal(resolveProfile(config, "staging").host, "staging.example.com");
});

test("resolveProfile falls back to defaultProfile", () => {
	const config = {
		defaultProfile: "staging",
		profiles: { staging: { host: "staging.example.com" } },
	};

	assert.equal(resolveProfile(config, undefined).host, "staging.example.com");
});

test("an unknown profile name is an error", () => {
	const config = { profiles: { prod: { host: "prod.example.com" } } };

	assert.throws(() => resolveProfile(config, "nope"), /nope/);
});

test("no profiles at all resolves to an empty profile", () => {
	assert.deepEqual(resolveProfile({}, undefined), {});
});

test("quoteIdentifier wraps and escapes", () => {
	assert.equal(quoteIdentifier("users"), '"users"');
	assert.equal(quoteIdentifier("MixedCase"), '"MixedCase"');
	assert.equal(quoteIdentifier("with space"), '"with space"');
});

test("quoteIdentifier doubles an embedded double quote", () => {
	// This is what makes interpolation safe: an unescaped quote would let the rest of the
	// identifier close the quoted string and continue as SQL.
	assert.equal(quoteIdentifier('a"b'), '"a""b"');
	assert.equal(
		quoteIdentifier('evil" ; DROP TABLE users; --'),
		'"evil"" ; DROP TABLE users; --"',
	);
});

test("quoteQualifiedName quotes both parts independently", () => {
	assert.equal(quoteQualifiedName("public", "users"), '"public"."users"');
	assert.equal(quoteQualifiedName('sch"ema', 'ta"ble'), '"sch""ema"."ta""ble"');
});

test("a quoted identifier round-trips through a naive unquote", () => {
	// Sanity check on the escaping rule: unquoting must recover the original name.
	for (const name of ["users", 'a"b', '""', 'a""""b', "DROP TABLE x; --"]) {
		const quoted = quoteIdentifier(name);
		const unquoted = quoted.slice(1, -1).replace(/""/g, '"');
		assert.equal(unquoted, name);
	}
});
