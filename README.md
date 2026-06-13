# PostgreSQL Database Analyzer

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/@deniscuciuc/pg-analyzer?logo=npm&color=cb3837)](https://www.npmjs.com/package/@deniscuciuc/pg-analyzer)
[![npm downloads](https://img.shields.io/npm/dm/@deniscuciuc/pg-analyzer)](https://www.npmjs.com/package/@deniscuciuc/pg-analyzer)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![CI](https://github.com/deniscuciuc/db-analyzer-postgres/actions/workflows/ci.yml/badge.svg)](https://github.com/deniscuciuc/db-analyzer-postgres/actions/workflows/ci.yml)

A CLI tool that analyzes PostgreSQL databases for performance issues: unused / missing / duplicate indexes, foreign keys without indexes, slow queries, table bloat, dead tuples, VACUUM needs, and connection / cache health. Outputs structured JSON for automation or rich Markdown reports for humans.

## Quick start

No installation required:

```bash
npx @deniscuciuc/pg-analyzer -h localhost -d mydb -U postgres -c health
npx @deniscuciuc/pg-analyzer -h localhost -d mydb -U postgres -c full --json > report.json
```

Or install globally:

```bash
npm install -g @deniscuciuc/pg-analyzer
pg-analyzer -h your-host -d mydb -U postgres -c health
```

> **Working with an AI agent?** See [.github/copilot-instructions.md](.github/copilot-instructions.md) for the integrated GitHub Copilot agent workflow and JSON contracts.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Development / local setup](#development--local-setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Commands](#commands)
- [CLI options](#cli-options)
- [Output formats](#output-formats)
- [Health score](#health-score)
- [Programmatic usage](#programmatic-usage)
- [Managed PostgreSQL providers](#managed-postgresql-providers)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Contributing](#contributing)

---

## Features

### Index analysis

- Unused indexes (low / no scans, ready-to-run `DROP INDEX` statements).
- Missing indexes (tables with high sequential scan activity).
- Duplicate / overlapping indexes.
- Foreign keys without supporting indexes.

### Query analysis

- Slow queries via `pg_stat_statements` (total / mean / min / max time, calls, hit ratio, rows).
- Currently long-running queries.
- Blocking / blocked queries (lock graph).

### Table & storage

- Largest tables, dead-tuple ratio, sequential vs. index scans.
- Table bloat detection.
- Tables needing `VACUUM` / `ANALYZE`, with execution support.

### System metrics

- Database size, cache hit ratio, index hit ratio.
- Connection statistics (active / idle / total).
- Server info, configuration settings, installed extensions.
- Composite **health score (0–100)** with prioritized recommendations.

---

## Requirements

- Node.js >= 20
- pnpm >= 10
- PostgreSQL 12+
- (Optional but recommended) `pg_stat_statements` extension for slow-query analysis

## Development / local setup

```bash
pnpm install
cp .env.example .env
# edit .env with your connection details
```

## Configuration

### Environment variables (`.env`)

```bash
# Database connection (use `export` to make them available to ts-node)
export DB_HOST=your-host.example.com
export DB_PORT=5432
export DB_NAME=mydb
export DB_USER=postgres
export DB_PASSWORD=secret
export DB_SSL=true

# Alternative: standard libpq variables
# export PGHOST=...
# export PGPORT=...
# export PGDATABASE=...
# export PGUSER=...
# export PGPASSWORD=...
```

### Config file (`.analyzerrc.json`)

Place `.analyzerrc.json` in your project root (or `~/.config/db-analyzer/config.json` for global settings).
Copy `analyzerrc.example.json` to get started:

```bash
cp analyzerrc.example.json .analyzerrc.json
```

Connection profiles let you switch databases without re-typing flags:

```bash
# use a named profile
. ./.env && npx ts-node index.ts -c health --profile prod

# or with npm script
pnpm analyze:health -- --profile staging
```

CLI flags always win. When you explicitly select a profile with `--profile`, that
profile's connection fields override sourced environment defaults for that run.

---

## Usage

### Interactive mode

```bash
pnpm start
```

### npm scripts

```bash
# Analysis (JSON output)
pnpm analyze              # Full analysis + Markdown report
pnpm analyze:help         # Help
pnpm analyze:health       # Health score + key metrics
pnpm analyze:indexes      # Unused indexes
pnpm analyze:queries      # Slow queries
pnpm analyze:tables       # Largest tables
pnpm analyze:fk           # Foreign keys without indexes
pnpm analyze:connections  # Connection statistics
pnpm analyze:config       # PostgreSQL configuration
pnpm analyze:html         # Full analysis + Markdown + HTML reports
pnpm analyze:watch        # Live health dashboard (refreshes every 30s)

# Server info
pnpm server:info

# Index management
pnpm indexes:drop-sql     # Generate DROP INDEX statements

# VACUUM
pnpm vacuum               # Run VACUUM ANALYZE on tables that need it
pnpm vacuum:check         # List tables that need VACUUM

# pg_stat_statements
pnpm pg-stat-statements:create
pnpm pg-stat-statements:drop

# Development
pnpm build                # Compile TypeScript
pnpm lint                 # Biome check
pnpm lint:fix             # Biome auto-fix
```

### Direct CLI

```bash
# Source env first so DB_* are exported into the shell
. ./.env && npx ts-node index.ts -j -c <command>

# Examples
. ./.env && npx ts-node index.ts -j -c health
. ./.env && npx ts-node index.ts -j -c slow-queries

# Without env file
npx ts-node index.ts -h localhost -p 5432 -d mydb -U postgres -W secret --ssl -j -c health
```

---

## Commands

| Command                       | Description                                       |
| ----------------------------- | ------------------------------------------------- |
| `full`                        | Complete analysis (default)                       |
| `health`                      | Health score and metrics                          |
| `server-info`                 | Server version and info                           |
| `unused-indexes`              | Indexes with low / no usage                       |
| `missing-indexes`             | Tables with high sequential scan activity         |
| `duplicate-indexes`           | Overlapping indexes                               |
| `fk-without-indexes`          | Foreign keys without supporting indexes           |
| `generate-drop-sql`           | Ready-to-run `DROP INDEX` statements              |
| `slow-queries`                | Top queries from `pg_stat_statements`             |
| `long-running`                | Currently long-running queries                    |
| `blocking`                    | Locks / blocking sessions                         |
| `tables`                      | Largest tables and table stats                    |
| `vacuum-needed`               | Tables that need `VACUUM`                         |
| `run-vacuum`                  | Execute `VACUUM ANALYZE`                          |
| `connections`                 | Connection statistics                             |
| `config`                      | Configuration settings                            |
| `extensions`                  | Installed extensions                              |
| `create-pg-stat-statements`   | Create `pg_stat_statements` extension             |
| `drop-pg-stat-statements`     | Drop `pg_stat_statements` extension               |

## CLI options

| Option                     | Short | Description                              | Default     |
| -------------------------- | ----- | ---------------------------------------- | ----------- |
| `--host`                   | `-h`  | Database host                            | `localhost` |
| `--port`                   | `-p`  | Database port                            | `5432`      |
| `--database`               | `-d`  | Database name                            | `postgres`  |
| `--user`                   | `-U`  | Database user                            | `postgres`  |
| `--password`               | `-W`  | Database password                        | -           |
| `--ssl`                    |       | Enable SSL                               | `false`     |
| `--profile`                |       | Use a named connection profile from `.analyzerrc.json` | - |
| `--config`                 |       | Path to a config file                    | auto-search |
| `--schemas`                |       | Comma-separated schema names to analyze  | all         |
| `--tables`                 |       | Comma-separated table names to analyze   | all         |
| `--compare`                |       | Path to a previous JSON report for diffing | -         |
| `--html`                   |       | Also generate an HTML report             | `false`     |
| `--watch`                  |       | Poll interval in seconds (enables watch mode) | -      |
| `--command`                | `-c`  | Run a single command (see table)         | `full`      |
| `--json`                   | `-j`  | JSON output                              | `false`     |
| `--quiet`                  | `-q`  | Suppress progress output                 | `false`     |
| `--output`                 | `-o`  | Reports directory                        | `./reports` |
| `--slow-query-threshold`   |       | Slow-query threshold (ms)                | `100`       |
| `--min-index-scans`        |       | Min scans to consider an index "used"    | `50`        |
| `--interactive`            | `-i`  | Interactive menu                         | `false`     |

---

## Output formats

### Markdown report

Generated by `pnpm analyze`. Includes:

- Executive summary with health score
- Database metrics (cache / index hit ratio, dead tuples, connections)
- Index analysis (unused / missing / duplicate)
- Table analysis (largest, high dead tuples, high seq scans)
- Slow queries with recommendations
- Bloat analysis
- Prioritized recommendations

Saved to `./reports/db-analysis-{timestamp}.md`.

### JSON report

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "databaseName": "mydb",
  "healthScore": 90,
  "metrics": {
    "databaseSize": "177 MB",
    "cacheHitRatio": 99.98,
    "indexHitRatio": 99.99,
    "deadTuplesRatio": 4.2,
    "totalConnections": 4,
    "activeConnections": 3
  },
  "unusedIndexes": [],
  "missingIndexes": [],
  "duplicateIndexes": [],
  "tableStats": [],
  "slowQueries": [],
  "bloatedTables": [],
  "recommendations": []
}
```

### HTML report

Generated by `pnpm analyze:html` or `pnpm analyze -- --html`. Includes the same content
as the Markdown report in a self-contained HTML file with:

- Light/dark mode (follows OS preference)
- Color-coded severity badges
- Collapsible sections
- Sortable tables
- No external dependencies — share as a single file

Saved to `./reports/db-analysis-{timestamp}.html`.

### Report diff

Compare two snapshots to see what changed:

```bash
# save a baseline
pnpm analyze

# later, compare
pnpm analyze -- --compare ./reports/db-analysis-2026-01-01.json
```

Output:
```
⬆️  Health score       72 → 85 (+13)  ✓ better
⬇️  Cache hit ratio    99.1% → 98.2% (-0.9%)  ✗ worse
↔️  Slow queries       8 → 8  no change
⚠️  New issues (1): idx_products_old (unused index)
✓  Resolved (2): idx_users_tmp, idx_orders_status_old
```

---

## Health score

| Score   | Status    | Action                  |
| ------- | --------- | ----------------------- |
| 90–100  | Excellent | Monitor only            |
| 70–89   | Good      | Plan optimization       |
| 50–69   | Warning   | Needs attention         |
| 0–49    | Critical  | Immediate action needed |

### Key metric thresholds

| Metric            | Good  | Warning   | Critical |
| ----------------- | ----- | --------- | -------- |
| Cache hit ratio   | > 95% | 90–95%    | < 90%    |
| Index hit ratio   | > 95% | 90–95%    | < 90%    |
| Dead tuples ratio | < 5%  | 5–10%     | > 10%    |

---

## Programmatic usage

```ts
import { DatabaseAnalyzer } from "@deniscuciuc/pg-analyzer";

const analyzer = new DatabaseAnalyzer({
  host: "localhost",
  port: 5432,
  database: "mydb",
  user: "postgres",
  password: "password",
  ssl: { rejectUnauthorized: false },
});

const report = await analyzer.analyze();
analyzer.printSummary(report);
await analyzer.generateReport(report);
await analyzer.close();
```

---

## Managed PostgreSQL providers

### Connect as a superuser or read-only admin

For full slow-query text and `pg_stat_statements` visibility, **connect with a privileged user** (superuser or a role with `pg_read_all_stats`). Restricted users see `<insufficient privilege>` instead of query text.

### Enable `pg_stat_statements`

```sql
-- Check availability
SELECT * FROM pg_available_extensions WHERE name = 'pg_stat_statements';

-- Create
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Grant access to other users (optional)
GRANT pg_read_all_stats TO your_app_user;
```

Or use the npm script: `pnpm pg-stat-statements:create`.

---

## Troubleshooting

| Symptom                              | Cause                                | Fix                                                              |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------- |
| `ECONNREFUSED`                       | Cannot reach the database            | Check host / port and network                                    |
| `SSL required`                       | Server requires TLS                  | Add `--ssl` or `DB_SSL=true`                                     |
| `permission denied for ...`          | User lacks privileges                | Use a superuser or `GRANT pg_read_all_stats TO your_user;`       |
| `relation pg_stat_statements ... does not exist` | Extension missing       | `pnpm pg-stat-statements:create`                                 |
| Empty slow queries                   | No traffic since last reset, or threshold too high | Wait for traffic, or lower `--slow-query-threshold` |

---

## Architecture

```
db-analyzer-postgres/
├── index.ts                         # Entry point + CLI
├── package.json
├── src/
│   ├── types.ts                     # Shared types
│   ├── queries.ts                   # SQL queries
│   ├── interactive.ts               # Interactive CLI
│   ├── analyzers/
│   │   ├── index-analyzer.ts
│   │   ├── query-analyzer.ts
│   │   └── table-analyzer.ts
│   ├── collectors/stats-collector.ts
│   └── reporters/report-generator.ts
├── .github/copilot-instructions.md  # AI agent workflow
├── .env.example
└── reports/                         # Generated reports (gitignored)
```

| Class             | Responsibility                                |
| ----------------- | --------------------------------------------- |
| `IndexAnalyzer`   | Unused / missing / duplicate / FK indexes     |
| `QueryAnalyzer`   | Slow / long-running / blocking queries        |
| `TableAnalyzer`   | Stats, bloat, dead tuples, VACUUM             |
| `StatsCollector`  | Metrics, connections, configuration           |
| `ReportGenerator` | Markdown + JSON report output                 |

## Contributing

Bug reports, feature requests, and pull requests are welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

MIT — see [LICENSE](LICENSE).
