# GitHub Copilot Instructions — PostgreSQL Analyzer

You are operating inside the **PostgreSQL Analyzer** repository. This file is your authoritative guide: follow it before searching the codebase.

## What this tool does

A CLI that analyzes PostgreSQL databases and emits **JSON to stdout** (with `-j`) or **Markdown reports** to `./reports/`. Use it to find unused / missing / duplicate indexes, slow queries, table bloat, dead tuples, and overall health.

## Prerequisites checklist

Before running any command, verify:

1. `.env` exists at the repo root. If missing: copy `.env.example` and ask the user for connection details — never invent credentials.
2. `node_modules/` exists. If missing, run `pnpm install`.
3. `DB_*` (or `PG*`) variables are exported in `.env` (the file uses `export` so it must be sourced).
4. For slow-query analysis, the `pg_stat_statements` extension must be enabled. If missing, suggest `pnpm pg-stat-statements:create`.

## Standard workflow

Always start with the health check, then drill down only if the score is below 90.

```bash
# 1. Health check (always first)
pnpm analyze:health

# 2. If healthScore < 90, drill into specifics in parallel
pnpm analyze:indexes      # unused indexes
pnpm analyze:queries      # slow queries
pnpm analyze:tables       # largest tables
pnpm analyze:fk           # foreign keys without indexes

# 3. For deeper investigation, use direct CLI
. ./.env && npx ts-node index.ts -j -c <command>
```

## All commands

| Command                       | When to use                                       |
| ----------------------------- | ------------------------------------------------- |
| `full`                        | Complete report                                   |
| `health`                      | First check, overall score                        |
| `server-info`                 | PostgreSQL version + server info                  |
| `unused-indexes`              | Find indexes to drop                              |
| `missing-indexes`             | Tables with high seq-scan activity                |
| `duplicate-indexes`           | Redundant / overlapping indexes                   |
| `fk-without-indexes`          | Foreign keys missing supporting indexes           |
| `generate-drop-sql`           | Ready-to-run `DROP INDEX` statements              |
| `slow-queries`                | Top queries from `pg_stat_statements`             |
| `long-running`                | Currently long-running queries (debug stuck ones) |
| `blocking`                    | Locks / blocking sessions (debug deadlocks)       |
| `tables`                      | Largest tables                                    |
| `vacuum-needed`               | Tables that need `VACUUM`                         |
| `run-vacuum`                  | Execute `VACUUM ANALYZE`                          |
| `connections`                 | Connection statistics (pool issues)               |
| `config`                      | Configuration settings                            |
| `extensions`                  | Installed extensions                              |
| `create-pg-stat-statements`   | Create `pg_stat_statements` extension             |
| `drop-pg-stat-statements`     | Drop `pg_stat_statements` extension               |

## JSON output contracts

All JSON is emitted to **stdout** with the `-j` flag. Pipe to `jq` for filtering.

### `health`

```json
{
  "healthScore": 90,
  "metrics": {
    "databaseSize": "177 MB",
    "databaseSizeBytes": 185863315,
    "totalConnections": 4,
    "activeConnections": 3,
    "cacheHitRatio": 99.98,
    "indexHitRatio": 99.99,
    "deadTuplesRatio": 4.2
  },
  "issues": [
    "Found 11 unused indexes consuming 16.57 MB.",
    "Found 4 duplicate/overlapping index pairs."
  ]
}
```

### `unused-indexes`

```json
{
  "unusedIndexes": [
    {
      "schema": "public",
      "table": "users",
      "index": "idx_users_old",
      "size": "2.5 MB",
      "sizeBytes": 2621440,
      "indexScans": 0,
      "recommendation": "DROP INDEX public.idx_users_old;"
    }
  ],
  "totalCount": 11,
  "totalSizeBytes": 17367040
}
```

The `recommendation` field already contains a ready-to-run `DROP INDEX` statement. Confirm with the user before executing.

### `slow-queries`

```json
{
  "slowQueries": [
    {
      "queryPreview": "SELECT * FROM large_table WHERE...",
      "calls": 1523,
      "totalTime": 45230.5,
      "meanTime": 29.7,
      "rows": 15230,
      "sharedBlksHit": 12500,
      "sharedBlksRead": 250
    }
  ]
}
```

Prioritization:
- High `totalTime` → most impact when optimized.
- High `meanTime` → each call is slow (look for missing indexes / bad plans).
- High `calls` with moderate `meanTime` → frequently used hot path.

## Score interpretation

| Score   | Status    | Action                  |
| ------- | --------- | ----------------------- |
| 90–100  | Excellent | Monitor only            |
| 70–89   | Good      | Plan optimization       |
| 50–69   | Warning   | Needs attention         |
| 0–49    | Critical  | Immediate action needed |

| Metric            | Good  | Warning | Critical |
| ----------------- | ----- | ------- | -------- |
| Cache hit ratio   | > 95% | 90–95%  | < 90%    |
| Index hit ratio   | > 95% | 90–95%  | < 90%    |
| Dead tuples ratio | < 5%  | 5–10%   | > 10%    |

## Reporting back to the user

When summarizing, follow this structure:

````markdown
## PostgreSQL Analysis Results

### Health Score: X/100

### Key Metrics

| Metric             | Value |
| ------------------ | ----- |
| Database Size      | …     |
| Cache Hit Ratio    | …     |
| Index Hit Ratio    | …     |
| Active Connections | …     |

### Findings

1. …
2. …

### Recommendations

- **Critical:** …
- **Important:** …
- **Consider:** …

### Suggested SQL

```sql
DROP INDEX public.idx_users_old;
CREATE INDEX CONCURRENTLY idx_orders_status_created_at
  ON orders (status, created_at DESC);
VACUUM (ANALYZE) public.orders;
```
````

## Operational rules for the agent

- **Always reply in English.** Do not use Russian or Ukrainian.
- **Never run destructive commands without explicit user confirmation:** `run-vacuum`, `generate-drop-sql` (executing the produced SQL), `drop-pg-stat-statements`, any `DROP INDEX`.
- Prefer `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` to avoid table locks in production.
- **Use `-j` for parsing.** Markdown output is for humans only.
- **`pg_stat_statements` is required** for slow-query analysis. Check `extensions` first.
- **Connect as a superuser or role with `pg_read_all_stats`** to see full query text. Restricted users see `<insufficient privilege>`.
- **Do not invent credentials or hostnames.** Ask the user.
- **Do not commit `.env`** or any file containing secrets.

## Error reference

| Error                                                | Likely cause                  | Suggested fix                                                       |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `ECONNREFUSED`                                       | Cannot reach the database     | Check `DB_HOST` / `DB_PORT` and network                             |
| `SSL required`                                       | Server requires TLS           | Add `--ssl` or `DB_SSL=true`                                        |
| `permission denied for ...`                          | User lacks privileges         | Use a superuser or `GRANT pg_read_all_stats TO your_user;`          |
| `relation pg_stat_statements ... does not exist`     | Extension missing             | `pnpm pg-stat-statements:create`                                    |
| Empty slow queries                                   | No traffic / threshold high   | Wait for traffic or lower `--slow-query-threshold`                  |

## File layout (for navigation)

```
index.ts                          # CLI entry, command dispatch
src/interactive.ts                # Interactive menu
src/queries.ts                    # SQL queries
src/analyzers/{index,query,table}-analyzer.ts
src/collectors/stats-collector.ts # Database metrics
src/reporters/report-generator.ts # Markdown + JSON output
```
