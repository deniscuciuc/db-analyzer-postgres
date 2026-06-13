import { calculateHealthScore } from "../thresholds";
import type { FullReport, ThresholdOverrides } from "../types";

export interface MetricDiff {
	label: string;
	before: string | number;
	after: string | number;
	delta?: number;
	trend: "better" | "worse" | "neutral" | "unchanged";
}

export interface ReportDiff {
	currentAt: string;
	previousAt: string;
	timeDelta: string;
	metrics: MetricDiff[];
	newIssues: string[];
	resolvedIssues: string[];
}

type TrendDirection = "higher" | "lower" | "neutral";

export const DiffReporter = {
	diff(
		current: FullReport,
		previous: FullReport,
		thresholdOverrides?: ThresholdOverrides,
	): ReportDiff {
		const currentIssues = collectIssues(current);
		const previousIssues = collectIssues(previous);
		const metrics: MetricDiff[] = [
			createMetricDiff(
				"Health score",
				calculateHealthScore(previous, thresholdOverrides),
				calculateHealthScore(current, thresholdOverrides),
				"higher",
			),
			createMetricDiff(
				"Cache hit ratio",
				previous.metrics.cacheHitRatio,
				current.metrics.cacheHitRatio,
				"higher",
			),
			createMetricDiff(
				"Index hit ratio",
				previous.metrics.indexHitRatio,
				current.metrics.indexHitRatio,
				"higher",
			),
			createMetricDiff(
				"Dead tuples ratio",
				previous.metrics.deadTuplesRatio,
				current.metrics.deadTuplesRatio,
				"lower",
			),
			createMetricDiff(
				"Unused indexes",
				previous.unusedIndexes.length,
				current.unusedIndexes.length,
				"lower",
			),
			createMetricDiff(
				"Missing indexes",
				previous.missingIndexes.length,
				current.missingIndexes.length,
				"lower",
			),
			createMetricDiff(
				"Duplicate indexes",
				previous.duplicateIndexes.length,
				current.duplicateIndexes.length,
				"lower",
			),
			createMetricDiff(
				"Slow queries",
				previous.slowQueries.length,
				current.slowQueries.length,
				"lower",
			),
			createMetricDiff(
				"Bloated tables",
				previous.bloatedTables.length,
				current.bloatedTables.length,
				"lower",
			),
			createMetricDiff(
				"Total connections",
				previous.metrics.totalConnections,
				current.metrics.totalConnections,
				"neutral",
			),
		];

		return {
			currentAt: toIsoString(current.generatedAt),
			previousAt: toIsoString(previous.generatedAt),
			timeDelta: describeTimeDelta(previous.generatedAt, current.generatedAt),
			metrics,
			newIssues: currentIssues.filter(
				(issue) => !previousIssues.includes(issue),
			),
			resolvedIssues: previousIssues.filter(
				(issue) => !currentIssues.includes(issue),
			),
		};
	},

	print(
		diff: ReportDiff,
		write: (
			message?: unknown,
			...optionalParams: unknown[]
		) => void = console.log,
	): void {
		write(
			`\nReport diff (${diff.previousAt} → ${diff.currentAt}, ${diff.timeDelta})`,
		);

		for (const metric of diff.metrics) {
			const arrow =
				metric.trend === "better" ? "⬆️" : metric.trend === "worse" ? "⬇️" : "↔️";
			const status =
				metric.trend === "better"
					? "✓ better"
					: metric.trend === "worse"
						? "✗ worse"
						: metric.trend === "unchanged"
							? "no change"
							: "informational";
			const delta =
				metric.delta === undefined || metric.delta === 0
					? ""
					: ` (${metric.delta > 0 ? "+" : ""}${formatValue(metric.delta, metric.label)})`;

			write(
				`${arrow}  ${metric.label.padEnd(18)} ${formatValue(metric.before, metric.label)} → ${formatValue(metric.after, metric.label)}${delta}  ${status}`,
			);
		}

		if (diff.newIssues.length > 0) {
			write(
				`⚠️  New issues (${diff.newIssues.length}): ${diff.newIssues.join(", ")}`,
			);
		}

		if (diff.resolvedIssues.length > 0) {
			write(
				`✓  Resolved (${diff.resolvedIssues.length}): ${diff.resolvedIssues.join(", ")}`,
			);
		}
	},
};

function createMetricDiff(
	label: string,
	before: number,
	after: number,
	direction: TrendDirection,
): MetricDiff {
	const delta = Math.round((after - before) * 100) / 100;

	if (delta === 0) {
		return { label, before, after, delta: 0, trend: "unchanged" };
	}

	if (direction === "neutral") {
		return { label, before, after, delta, trend: "neutral" };
	}

	const improved =
		(direction === "higher" && delta > 0) ||
		(direction === "lower" && delta < 0);

	return {
		label,
		before,
		after,
		delta,
		trend: improved ? "better" : "worse",
	};
}

function collectIssues(report: FullReport): string[] {
	const unused = report.unusedIndexes.map(
		(index) => `unused index ${index.schema}.${index.index}`,
	);
	const missing = report.missingIndexes.map(
		(index) => `missing index ${index.schema}.${index.table}`,
	);
	const duplicates = report.duplicateIndexes.map(
		(index) =>
			`duplicate indexes ${index.schema}.${index.table}:${index.index1}/${index.index2}`,
	);
	const slowQueries = report.slowQueries.map(
		(query) =>
			`slow query ${query.queryPreview ?? query.query.substring(0, 60)}`,
	);
	const bloated = report.bloatedTables.map(
		(table) => `bloated table ${table.schema}.${table.table}`,
	);

	return [...unused, ...missing, ...duplicates, ...slowQueries, ...bloated];
}

function describeTimeDelta(
	previousAt: Date | string,
	currentAt: Date | string,
): string {
	const previous = new Date(previousAt);
	const current = new Date(currentAt);
	const deltaMs = Math.max(0, current.getTime() - previous.getTime());
	const deltaMinutes = Math.round(deltaMs / 60000);

	if (deltaMinutes < 60) {
		return `${deltaMinutes || 1} minute${deltaMinutes === 1 ? "" : "s"} apart`;
	}

	const deltaHours = Math.round(deltaMinutes / 60);
	if (deltaHours < 48) {
		return `${deltaHours} hour${deltaHours === 1 ? "" : "s"} apart`;
	}

	const deltaDays = Math.round(deltaHours / 24);
	return `${deltaDays} day${deltaDays === 1 ? "" : "s"} apart`;
}

function toIsoString(value: Date | string): string {
	return new Date(value).toISOString();
}

function formatValue(value: number | string, label: string): string {
	if (typeof value === "string") {
		return value;
	}

	if (label.includes("ratio")) {
		return `${value}%`;
	}

	return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}
