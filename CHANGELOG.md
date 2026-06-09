# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- GitHub Actions release workflow
- Dependabot configuration for npm + GitHub Actions
- MIT license
- Makefile with common development targets
