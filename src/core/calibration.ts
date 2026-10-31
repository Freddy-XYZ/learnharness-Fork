/**
 * Metacognitive calibration & Hypercorrection weak-spot analysis.
 *
 * Grounded in cognitive psychology (Butterfield & Metcalfe, 2001 — the
 * Hypercorrection Effect; Dunlosky & Metcalfe — metacognitive monitoring):
 *   - High-confidence misses (`confidence >= 70` and `correct === false`)
 *     expose committed misconceptions with the highest learning return when
 *     explicitly repaired.
 *   - Low-confidence hits (`confidence <= 50` and `correct === true`)
 *     expose fragile knowledge or lucky guesses that decay rapidly without
 *     reinforcement.
 *   - `predict` questions (posed before teaching a step) are intentionally
 *     excluded from check calibration and weak spots so productive failure
 *     before instruction is never penalized.
 */

import type { PlanTree } from "./contracts.ts";
import type { QuestionAnswerData } from "./question-core.ts";

export type CheckOutcomeClass = "hypercorrection" | "fragile" | "gap" | "solid";
export type CalibrationState = "calibrated" | "overconfident" | "underconfident" | "unrated";

export interface CalibrationItem {
	nodeId: string | null;
	nodeTitle: string | null;
	question: string;
	correct: boolean;
	dontKnow: boolean;
	confidence: number | null;
	outcomeClass: CheckOutcomeClass;
}

export interface SessionCalibration {
	totalChecks: number;
	predictCount: number;
	accuracyPct: number;
	meanConfidencePct: number | null;
	/** meanConfidencePct - accuracyPct (positive = overconfident, negative = underconfident). */
	calibrationGapPct: number | null;
	calibrationState: CalibrationState;
	hypercorrections: CalibrationItem[];
	fragileHits: CalibrationItem[];
	gaps: CalibrationItem[];
	weakSpots: CalibrationItem[];
}

export interface CalibrationMessageSlice {
	parts: Array<{ type: string; state?: string; input?: unknown; output?: unknown }>;
}

/** Classify a single answered check quiz into its metacognitive outcome class. */
export function classifyCheckOutcome(
	correct: boolean,
	dontKnow: boolean,
	confidence: number | null,
): CheckOutcomeClass {
	if (dontKnow) return "gap";
	if (!correct) {
		return confidence !== null && confidence >= 70 ? "hypercorrection" : "gap";
	}
	return confidence !== null && confidence <= 50 ? "fragile" : "solid";
}

/**
 * Derive metacognitive calibration metrics and weak spots from a session's
 * answered `tool-quiz` parts. Only `check` questions (not `predict` or `probe`)
 * enter the calibration and weak-spot sets.
 */
export function deriveSessionCalibration(
	messages: readonly CalibrationMessageSlice[],
	tree?: PlanTree | null,
): SessionCalibration {
	const nodeTitleById = new Map<string, string>();
	if (tree) {
		for (const n of tree.nodes) {
			nodeTitleById.set(n.id, n.title);
		}
	}

	const checkItems: CalibrationItem[] = [];
	const probeItems: CalibrationItem[] = [];
	let predictCount = 0;

	for (const m of messages) {
		for (const part of m.parts) {
			if (
				(part.type !== "tool-quiz" && part.type !== "tool-probe" && part.type !== "tool-pronounce") ||
				part.state !== "output-available"
			)
				continue;
			const output = part.output as QuestionAnswerData | undefined;
			if (!output || output.dismissed || (output.kind !== "quiz" && output.kind !== "pronounce")) continue;

			const input = part.input as { type?: unknown; nodeId?: unknown; question?: unknown } | undefined;
			const qType = output.questionType ?? (typeof input?.type === "string" ? input.type : undefined);
			if (qType === "predict") {
				predictCount += 1;
				continue;
			}
			const isProbe = part.type === "tool-probe" || output.tool === "probe";

			const nodeId = typeof input?.nodeId === "string" ? input.nodeId : null;
			const nodeTitle = nodeId ? (nodeTitleById.get(nodeId) ?? nodeId) : null;
			const question =
				(typeof input?.question === "string" && input.question.trim()) ||
				output.questionText ||
				(isProbe ? "Diagnostic probe" : "Check question");
			const dontKnow = Boolean(output.dontKnow);
			const correct = !dontKnow && Boolean(output.correct);
			const confidence =
				!dontKnow && typeof output.confidence === "number" && Number.isFinite(output.confidence)
					? output.confidence
					: null;

			const outcomeClass = classifyCheckOutcome(correct, dontKnow, confidence);
			const item: CalibrationItem = {
				nodeId,
				nodeTitle,
				question,
				correct,
				dontKnow,
				confidence,
				outcomeClass,
			};
			if (isProbe) {
				probeItems.push(item);
			} else {
				checkItems.push(item);
			}
		}
	}

	const activeItems = checkItems.length > 0 ? checkItems : probeItems;
	const totalChecks = activeItems.length;
	const correctCount = activeItems.filter((i) => i.correct).length;
	const accuracyPct = totalChecks > 0 ? Math.round((correctCount / totalChecks) * 100) : 0;

	const ratedItems = activeItems.filter((i) => i.confidence !== null);
	const meanConfidencePct =
		ratedItems.length > 0
			? Math.round(ratedItems.reduce((sum, i) => sum + (i.confidence ?? 0), 0) / ratedItems.length)
			: null;
	// Calibration gap compares mean confidence on rated items against accuracy on those rated items
	const ratedAccuracyPct =
		ratedItems.length > 0
			? Math.round((ratedItems.filter((i) => i.correct).length / ratedItems.length) * 100)
			: null;
	const calibrationGapPct =
		meanConfidencePct !== null && ratedAccuracyPct !== null
			? meanConfidencePct - ratedAccuracyPct
			: null;

	let calibrationState: CalibrationState = "unrated";
	if (calibrationGapPct !== null) {
		if (calibrationGapPct > 12) calibrationState = "overconfident";
		else if (calibrationGapPct < -12) calibrationState = "underconfident";
		else calibrationState = "calibrated";
	}

	const hypercorrections = activeItems.filter((i) => i.outcomeClass === "hypercorrection");
	const fragileHits = activeItems.filter((i) => i.outcomeClass === "fragile");
	const gaps = activeItems.filter((i) => i.outcomeClass === "gap");
	const weakSpots = [...hypercorrections, ...fragileHits, ...gaps];

	return {
		totalChecks,
		predictCount,
		accuracyPct,
		meanConfidencePct,
		calibrationGapPct,
		calibrationState,
		hypercorrections,
		fragileHits,
		gaps,
		weakSpots,
	};
}

/**
 * Build a concise, targeted opening prompt for a weak-spot repair practice
 * session, prioritizing high-confidence misses (hypercorrection targets) and
 * fragile low-confidence hits.
 */
export function buildWeakSpotRepairPrompt(
	sessionTitle: string,
	calibration: SessionCalibration,
): string {
	const focusLabels: string[] = [];
	const seen = new Set<string>();
	for (const item of calibration.weakSpots) {
		const label = item.nodeTitle ?? item.question;
		if (!seen.has(label)) {
			seen.add(label);
			focusLabels.push(label);
		}
		if (focusLabels.length >= 4) break;
	}
	if (focusLabels.length === 0) {
		return `Practice ${sessionTitle}`;
	}
	return `Repair weak spots in ${sessionTitle}: ${focusLabels.join(", ")}`;
}
