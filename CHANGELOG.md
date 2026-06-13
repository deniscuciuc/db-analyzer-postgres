# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-13

### Added

- PostgreSQL database analyzer CLI with subcommands
- Unused / missing / duplicate index detection with `DROP INDEX` generation
- Foreign key index gap detection
- Slow query analysis via `pg_stat_statements`
- Table bloat detection and VACUUM management
- Database health score (0–100) with prioritized recommendations
- Connection, cache, and configuration metrics
- Interactive CLI mode with prompts
- Markdown report generation to `./reports/`
- JSON output for automation workflows (`-j` flag)
- GitHub Actions CI workflow (lint, build matrix)
- GitHub Actions publish workflow
- Dependabot configuration for npm + GitHub Actions
- MIT license
- Makefile with common development targets
- Config-file support via `.analyzerrc.json`, global fallback config, and named connection profiles
- Schema and table filters for scoped PostgreSQL analysis runs
- Self-contained HTML report generation with light/dark mode and sortable sections
- Report diffing against previous JSON snapshots with delta summaries
- Watch mode for polling-safe commands with refresh intervals and countdown feedback
- `pnpm analyze:html` and `pnpm analyze:watch` convenience scripts
- Global CLI publishing via `npm install -g @deniscuciuc/pg-analyzer` and `npx @deniscuciuc/pg-analyzer`

### Changed

- Full analysis output can now generate Markdown, JSON, and optional HTML reports from the same run
- Compare mode accepts saved JSON reports and wrapped CLI JSON output when diffing snapshots

### Fixed

- Explicit `--profile` selection now overrides sourced environment connection defaults for the active run
