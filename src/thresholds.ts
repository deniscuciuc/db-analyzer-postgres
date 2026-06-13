import { SCORE_DEDUCTIONS, THRESHOLDS } from "./constants";
import type {
	AnalysisReport,
	ReportThreshold,
	ThresholdOverrides,
} from "./types";

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
			...THRESHOLDS.cacheHitRatio,
			...overrides?.cacheHitRatio,
		},
		indexHitRatio: {
			...THRESHOLDS.indexHitRatio,
			...overrides?.indexHitRatio,
		},
		deadTuplesRatio: {
			...THRESHOLDS.deadTuplesRatio,
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
		score -= SCORE_DEDUCTIONS.cacheHitRatioCritical;
	} else if (
		getPositiveThresholdStatus(
			report.metrics.cacheHitRatio,
			thresholds.cacheHitRatio,
		) === "warning"
	) {
		score -= SCORE_DEDUCTIONS.cacheHitRatioWarning;
	}

	if (
		getPositiveThresholdStatus(
			report.metrics.indexHitRatio,
			thresholds.indexHitRatio,
		) === "critical"
	) {
		score -= SCORE_DEDUCTIONS.indexHitRatioCritical;
	}

	if (
		getInverseThresholdStatus(
			report.metrics.deadTuplesRatio,
			thresholds.deadTuplesRatio,
		) === "critical"
	) {
		score -= SCORE_DEDUCTIONS.deadTuplesCritical;
	} else if (
		getInverseThresholdStatus(
			report.metrics.deadTuplesRatio,
			thresholds.deadTuplesRatio,
		) === "warning"
	) {
		score -= SCORE_DEDUCTIONS.deadTuplesWarning;
	}

	if (report.unusedIndexes.length > 10) score -= 10;
	if (report.missingIndexes.length > 5) score -= 10;
	if (report.slowQueries.length > 10) score -= 10;

	return Math.max(0, score);
}
