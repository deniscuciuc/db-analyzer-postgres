export const MAIN_MENU_CHOICES = [
	{ name: "🔍  Run analysis", value: "analysis" },
	{ name: "📊  Generate reports", value: "reports" },
	{ name: "📺  Live monitoring", value: "watch" },
	{ name: "🧹  Maintenance", value: "maintenance" },
	{ name: "⚙️  Settings", value: "settings" },
	{ name: "❌  Exit", value: "exit" },
] as const;

export const ANALYSIS_MENU_CHOICES = [
	{ name: "📊  Full analysis (all modules)", value: "full" },
	{ name: "⚡  Health check", value: "health" },
	{ name: "🔍  Quick analysis (select modules)", value: "quick" },
	{ name: "🔎  Single module", value: "single" },
	{ name: "← Back", value: "back" },
] as const;

export const MODULE_CHOICES = [
	{ name: "Health score", value: "health" },
	{ name: "Server info", value: "server-info" },
	{ name: "Unused indexes", value: "unused-indexes" },
	{ name: "Missing indexes", value: "missing-indexes" },
	{ name: "Duplicate indexes", value: "duplicate-indexes" },
	{ name: "FK without indexes", value: "fk-without-indexes" },
	{ name: "Slow queries", value: "slow-queries" },
	{ name: "Long-running queries", value: "long-running" },
	{ name: "Blocking queries", value: "blocking" },
	{ name: "Table statistics", value: "tables" },
	{ name: "Tables needing VACUUM", value: "vacuum-needed" },
	{ name: "Connection stats", value: "connections" },
	{ name: "PostgreSQL config", value: "config" },
	{ name: "Installed extensions", value: "extensions" },
] as const;

export const REPORTS_MENU_CHOICES = [
	{ name: "📝  Markdown + JSON report", value: "markdown" },
	{ name: "🌐  HTML report", value: "html" },
	{ name: "🔀  Diff with previous report", value: "diff" },
	{ name: "← Back", value: "back" },
] as const;

export const WATCH_COMMAND_CHOICES = [
	{ name: "Health", value: "health" },
	{ name: "Connections", value: "connections" },
	{ name: "Long-running queries", value: "long-running" },
	{ name: "Blocking queries", value: "blocking" },
	{ name: "Table statistics", value: "tables" },
	{ name: "Tables needing VACUUM", value: "vacuum-needed" },
] as const;

export const MAINTENANCE_MENU_CHOICES = [
	{ name: "🧹  Run VACUUM ANALYZE", value: "run-vacuum" },
	{ name: "📋  Generate DROP INDEX statements", value: "generate-drop-sql" },
	{
		name: "⚙️  Enable pg_stat_statements",
		value: "create-pg-stat-statements",
	},
	{
		name: "🗑️  Disable pg_stat_statements",
		value: "drop-pg-stat-statements",
	},
	{ name: "← Back", value: "back" },
] as const;

export const SETTINGS_MENU_CHOICES = [
	{ name: "👤  Switch connection profile", value: "profile" },
	{ name: "🗂️  Set schema filter", value: "schemas" },
	{ name: "📋  Set table filter", value: "tables" },
	{ name: "📄  Show current settings", value: "show" },
	{ name: "← Back", value: "back" },
] as const;
