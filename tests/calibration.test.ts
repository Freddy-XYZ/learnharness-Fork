import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildWeakSpotRepairPrompt,
	classifyCheckOutcome,
	deriveSessionCalibration,
} from "../src/core/calibration.ts";
import type { PlanTree } from "../src/core/contracts.ts";

const plan: PlanTree = {
	nodes: [
		{ id: "n_1", title: "Base rate fallacy" },
		{ id: "n_2", title: "Likelihood ratio" },
		{ id: "n_3", title: "Posterior odds" },
	],
	edges: [
		{ from: "n_1", to: "n_2" },
		{ from: "n_2", to: "n_3" },
	],
	version: 1,
};

function quizPart(opts: {
	nodeId?: string;
	type?: "predict" | "check";
	tool?: string;
	question: string;
	correct: boolean;
	dontKnow?: boolean;
	confidence?: number;
	dismissed?: boolean;
}) {
	return {
		type: "tool-quiz",
		state: "output-available",
		input: {
			nodeId: opts.nodeId,
			type: opts.type ?? "check",
			question: opts.question,
		},
		output: {
			kind: "quiz",
			tool: opts.tool,
			questionType: opts.type ?? "check",
			questionText: opts.question,
			dontKnow: opts.dontKnow ?? false,
			correct: opts.correct,
			confidence: opts.confidence,
			dismissed: opts.dismissed ?? false,
			answers: [],
			answeredAt: "2026-10-30T12:00:00.000Z",
		},
	};
}

describe("metacognitive calibration & hypercorrection weak-spot detector", () => {
	it("classifies check outcomes along CONFIDENCE_STOPS thresholds", () => {
		assert.equal(classifyCheckOutcome(false, false, 90), "hypercorrection");
		assert.equal(classifyCheckOutcome(false, false, 70), "hypercorrection");
		assert.equal(classifyCheckOutcome(false, false, 50), "gap");
		assert.equal(classifyCheckOutcome(false, true, null), "gap");
		assert.equal(classifyCheckOutcome(true, false, 50), "fragile");
		assert.equal(classifyCheckOutcome(true, false, 30), "fragile");
		assert.equal(classifyCheckOutcome(true, false, 70), "solid");
		assert.equal(classifyCheckOutcome(true, false, 100), "solid");
	});

	it("excludes predict and probe questions from check calibration and prioritizes hypercorrection → fragile → gap", () => {
		const messages = [
			{
				parts: [
					// Probe quiz: ignored entirely
					quizPart({
						tool: "probe",
						question: "Opening probe",
						correct: false,
						confidence: 90,
					}),
					// Predict quiz: counted in predictCount, never penalized as a check weak spot
					quizPart({
						nodeId: "n_1",
						type: "predict",
						question: "What do you predict happens to the prior?",
						correct: false,
						confidence: 90,
					}),
					// Check 1 on n_1: high-confidence miss (hypercorrection!)
					quizPart({
						nodeId: "n_1",
						type: "check",
						question: "Why does a 99% test still yield many false positives?",
						correct: false,
						confidence: 90,
					}),
					// Check 2 on n_2: low-confidence hit (fragile!)
					quizPart({
						nodeId: "n_2",
						type: "check",
						question: "How is the likelihood ratio defined?",
						correct: true,
						confidence: 50,
					}),
					// Check 3 on n_3: solid mastery
					quizPart({
						nodeId: "n_3",
						type: "check",
						question: "How do prior odds combine with the likelihood ratio?",
						correct: true,
						confidence: 90,
					}),
				],
			},
		];

		const cal = deriveSessionCalibration(messages, plan);
		assert.equal(cal.predictCount, 1);
		assert.equal(cal.totalChecks, 3);
		assert.equal(cal.accuracyPct, 67); // 2 of 3 correct
		assert.equal(cal.meanConfidencePct, 77); // (90 + 50 + 90) / 3 = 76.67 -> 77
		assert.equal(cal.calibrationGapPct, 10); // 77 - 67 = +10 -> within [-12, +12] calibrated band
		assert.equal(cal.calibrationState, "calibrated");

		assert.equal(cal.hypercorrections.length, 1);
		assert.equal(cal.hypercorrections[0]!.nodeTitle, "Base rate fallacy");
		assert.equal(cal.fragileHits.length, 1);
		assert.equal(cal.fragileHits[0]!.nodeTitle, "Likelihood ratio");
		assert.equal(cal.gaps.length, 0);
		assert.deepEqual(
			cal.weakSpots.map((w) => w.nodeTitle),
			["Base rate fallacy", "Likelihood ratio"],
		);

		const prompt = buildWeakSpotRepairPrompt("Bayes' Rule", cal);
		assert.equal(
			prompt,
			"Repair weak spots in Bayes' Rule: Base rate fallacy, Likelihood ratio",
		);
	});

	it("flags overconfidence when mean confidence exceeds accuracy by more than 12 percentage points", () => {
		const messages = [
			{
				parts: [
					quizPart({
						nodeId: "n_1",
						type: "check",
						question: "Q1",
						correct: false,
						confidence: 100,
					}),
					quizPart({
						nodeId: "n_2",
						type: "check",
						question: "Q2",
						correct: true,
						confidence: 90,
					}),
				],
			},
		];
		const cal = deriveSessionCalibration(messages, plan);
		assert.equal(cal.accuracyPct, 50);
		assert.equal(cal.meanConfidencePct, 95);
		assert.equal(cal.calibrationGapPct, 45);
		assert.equal(cal.calibrationState, "overconfident");
	});
});
