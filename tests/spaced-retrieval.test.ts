import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	derivePracticeStats,
	formatNodeReviewBadge,
	selectDueForReview,
	spacingIntervalDaysForStreak,
	type PracticeSessionSlice,
} from "../src/core/spaced-retrieval.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const DAY_MS = 86_400_000;
const BASE_MS = Date.parse("2026-10-01T12:00:00.000Z");

function makePracticePair(
	callIndex: number,
	targets: string[],
	outcome: "solved" | "solvedWithHints" | "movedOn" | "surrendered" | "dismissed",
	retest: boolean,
	timestampMs: number,
): LhMessage[] {
	const probId = `call_prob_${callIndex}`;
	const concId = `call_conc_${callIndex}`;
	return [
		{
			id: `m_prob_${callIndex}`,
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: probId,
					name: "problem",
					arguments: {
						statement: "Test problem",
						mode: "recall",
						target: targets,
						modelSolution: "Test solution",
					},
				},
			],
			timestamp: timestampMs - 1000,
		} as unknown as LhMessage,
		{
			id: `m_prob_res_${callIndex}`,
			role: "toolResult",
			toolCallId: probId,
			toolName: "problem",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: timestampMs - 500,
		} as unknown as LhMessage,
		{
			id: `m_conc_${callIndex}`,
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: concId,
					name: "conclude",
					arguments: {
						outcome,
						verdict: "Verdict",
						rung: outcome === "solvedWithHints" ? "R2" : null,
						missClass: outcome === "solved" ? null : "execution",
						retest,
					},
				},
			],
			timestamp: timestampMs,
		} as unknown as LhMessage,
		{
			id: `m_conc_res_${callIndex}`,
			role: "toolResult",
			toolCallId: concId,
			toolName: "conclude",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: timestampMs + 100,
		} as unknown as LhMessage,
	];
}

describe("spaced-retrieval (derivePracticeStats & selectDueForReview)", () => {
	const propositions = [
		{
			id: "n_1",
			name: "Foundational premise",
			statement: "Premise statement.",
			createdAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "n_2",
			name: "Derived theorem",
			statement: "Theorem statement.",
			createdAt: "2026-09-05T00:00:00.000Z",
		},
		{
			id: "n_3",
			name: "Struggled concept",
			statement: "Struggled statement.",
			createdAt: "2026-09-10T00:00:00.000Z",
		},
		{
			id: "n_4",
			name: "Freshly mastered",
			statement: "Fresh statement.",
			createdAt: "2026-09-15T00:00:00.000Z",
		},
	];

	it("expands spacing intervals across streaks (1d → 3d → 7d → 14d → 30d)", () => {
		assert.equal(spacingIntervalDaysForStreak(0), 0);
		assert.equal(spacingIntervalDaysForStreak(1), 1);
		assert.equal(spacingIntervalDaysForStreak(2), 3);
		assert.equal(spacingIntervalDaysForStreak(3), 7);
		assert.equal(spacingIntervalDaysForStreak(4), 14);
		assert.equal(spacingIntervalDaysForStreak(5), 30);
		assert.equal(spacingIntervalDaysForStreak(9), 30);
	});

	it("classifies unpracticed, fresh, due, and retest propositions accurately", () => {
		const nowMs = BASE_MS + 2 * DAY_MS; // 2 days after BASE_MS
		const session: PracticeSessionSlice = {
			id: "chat_prac_1",
			messages: [
				// n_2: solved once at BASE_MS (1-day interval -> due at BASE_MS + 1d, so overdue at +2d)
				...makePracticePair(1, ["n_2"], "solved", false, BASE_MS),
				// n_3: solvedWithHints at BASE_MS + 1d -> needsRetest ("retest")
				...makePracticePair(2, ["n_3"], "solvedWithHints", false, BASE_MS + DAY_MS),
				// n_4: solved twice (BASE_MS and BASE_MS + 1d -> streak 2 = 3d interval -> fresh at +2d)
				...makePracticePair(3, ["n_4"], "solved", false, BASE_MS),
				...makePracticePair(4, ["n_4"], "solved", false, BASE_MS + DAY_MS),
			],
		};

		const stats = derivePracticeStats(propositions, [session], nowMs);

		assert.equal(stats["n_1"]!.state, "unpracticed");
		assert.equal(stats["n_1"]!.attempts, 0);

		assert.equal(stats["n_2"]!.state, "due");
		assert.equal(stats["n_2"]!.streak, 1);

		assert.equal(stats["n_3"]!.state, "retest");
		assert.equal(stats["n_3"]!.needsRetest, true);
		assert.equal(stats["n_3"]!.streak, 0);

		assert.equal(stats["n_4"]!.state, "fresh");
		assert.equal(stats["n_4"]!.streak, 2);

		// Badges
		assert.equal(formatNodeReviewBadge(stats["n_1"], nowMs).label, "Unpracticed");
		assert.match(formatNodeReviewBadge(stats["n_2"], nowMs).label, /Due for review/);
		assert.match(formatNodeReviewBadge(stats["n_3"], nowMs).label, /Needs retest/);
		assert.match(formatNodeReviewBadge(stats["n_4"], nowMs).label, /Reviewed .* streak 2/);
	});

	it("prioritizes retest → due → unpracticed and pulls in direct premise chains", () => {
		const nowMs = BASE_MS + 2 * DAY_MS;
		const session: PracticeSessionSlice = {
			id: "chat_prac_2",
			messages: [
				...makePracticePair(1, ["n_2"], "solved", false, BASE_MS), // due
				...makePracticePair(2, ["n_3"], "surrendered", true, BASE_MS + DAY_MS), // retest
				...makePracticePair(3, ["n_1"], "solved", false, nowMs - 1000), // fresh!
				...makePracticePair(4, ["n_4"], "solved", false, nowMs - 1000), // fresh!
			],
		};
		const stats = derivePracticeStats(propositions, [session], nowMs);
		// Chain: n_1 (fresh premise) ⟹ n_2 (due conclusion)
		const chains = [{ id: "arg_1", premises: ["n_1"], conclusion: "n_2" }];

		const selection = selectDueForReview(propositions, chains, stats, 6);
		assert.deepEqual(selection.counts, {
			retest: 1,
			due: 1,
			unpracticed: 0,
			totalDue: 2,
		});
		// Target order: n_3 (retest) first, then n_2 (due)
		assert.deepEqual(selection.targetNames, ["Struggled concept", "Derived theorem"]);
		// n_1 is included in propositions because it is a direct premise of due target n_2
		assert.deepEqual(
			selection.propositions.map((p) => p.id),
			["n_1", "n_2", "n_3"],
		);
	});
});
