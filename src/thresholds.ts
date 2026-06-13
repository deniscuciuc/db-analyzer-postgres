import type {
	AnalysisReport,
	ReportThreshold,
	ThresholdOverrides,
} from "./types";

const DEFAULT_THRESHOLDS = {
	cacheHitRatio: { warning: 95, critical: 90 },
	indexHitRatio: { warning: 95, critical: 90 },
	deadTuplesRatio: { warning: 5, critical: 10 },
} as const;

export interface ResolvedThresholdOverrides {
	cacheHitRatio: ReportThreshold;
	indexHitRatio: ReportThreshold;
	deadTuplesRatio: ReportThreshold;
}

export function resolveThresholds(
	overrides?: ThresholdOverrides,
): ResolvedThresholdOverrides {
	return {
		cacheHitRatio: {
			...DEFAULT_THRESHOLDS.cacheHitRatio,
			...overrides?.cacheHitRatio,
		},
		indexHitRatio: {
			...DEFAULT_THRESHOLDS.indexHitRatio,
			...overrides?.indexHitRatio,
		},
		deadTuplesRatio: {
			...DEFAULT_THRESHOLDS.deadTuplesRatio,
			...overrides?.deadTuplesRatio,
		},
	};
}

export function getPositiveThresholdStatus(
	value: number,
	threshold: ReportThreshold,
): "good" | "warning" | "critical" {
	if (value >= threshold.warning) return "good";
	if (value >= threshold.critical) return "warning";
	return "critical";
}

export function getInverseThresholdStatus(
	value: number,
	threshold: ReportThreshold,
): "good" | "warning" | "critical" {
	if (value <= threshold.warning) return "good";
	if (value <= threshold.critical) return "warning";
	return "critical";
}

export function calculateHealthScore(
	report: AnalysisReport,
	overrides?: ThresholdOverrides,
): number {
	const thresholds = resolveThresholds(overrides);
	let score = 100;

	if (
		getPositiveThresholdStatus(
			report.metrics.cacheHitRatio,
			thresholds.cacheHitRatio,
		) === "critical"
	) {
		score -= 20;
	} else if (
		getPositiveThresholdStatus(
			report.metrics.cacheHitRatio,
			thresholds.cacheHitRatio,
		) === "warning"
	) {
		score -= 10;
	}

	if (
		getPositiveThresholdStatus(
			report.metrics.indexHitRatio,
			thresholds.indexHitRatio,
		) === "critical"
	) {
		score -= 15;
	}

	if (
		getInverseThresholdStatus(
			report.metrics.deadTuplesRatio,
			thresholds.deadTuplesRatio,
		) === "critical"
	) {
		score -= 15;
	} else if (
		getInverseThresholdStatus(
			report.metrics.deadTuplesRatio,
			thresholds.deadTuplesRatio,
		) === "warning"
	) {
		score -= 5;
	}

	if (report.unusedIndexes.length > 10) score -= 10;
	if (report.missingIndexes.length > 5) score -= 10;
	if (report.slowQueries.length > 10) score -= 10;

	return Math.max(0, score);
}
