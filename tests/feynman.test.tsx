import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";

import {
	buildFeynmanPrompt,
	deriveDefaultFeynmanScorecard,
	derivePracticeStats,
	normalizeFeynmanScorecard,
	resolveFeynmanScorecard,
	type ArtifactPartProps,
	type LhMessage,
} from "../src/core/index.ts";
import { healEncodedArguments } from "../src/core/argument-heal.ts";
import { concludeInputObject, problemInputObject } from "../src/agent/tools/practice.ts";
import { PracticeDock } from "../components/practice-dock.tsx";
import { ConcludeCard, ProblemCard } from "../components/practice-cards.tsx";
import { SessionWrapUpBody } from "../components/session-wrap-up.tsx";

const part = (over: Partial<ArtifactPartProps["part"]>): ArtifactPartProps["part"] => ({
	type: "tool-problem",
	state: "input-available",
	toolCallId: "call_f1",
	...over,
});

describe("Feynman mode — core logic & scorecard resolution", () => {
	it("normalizes valid explicit feynmanScorecard and strips empty jargonFlags", () => {
		const card = normalizeFeynmanScorecard({
			clarity: "strong",
			jargonFree: "partial",
			causalChain: "strong",
			jargonFlags: ["eigenvalue", "  ", "unitary operator"],
		});
		assert.deepEqual(card, {
			clarity: "strong",
			jargonFree: "partial",
			causalChain: "strong",
			jargonFlags: ["eigenvalue", "unitary operator"],
		});
		assert.equal(normalizeFeynmanScorecard({ clarity: "bogus" }), null);
		assert.equal(normalizeFeynmanScorecard(null), null);
	});

	it("derives deterministic fallback scorecard for feynman-mode problems", () => {
		assert.deepEqual(deriveDefaultFeynmanScorecard("solved", null), {
			clarity: "strong",
			jargonFree: "strong",
			causalChain: "strong",
		});
		assert.deepEqual(deriveDefaultFeynmanScorecard("solvedWithHints", "discrimination"), {
			clarity: "strong",
			jargonFree: "partial",
			causalChain: "partial",
		});
		assert.deepEqual(deriveDefaultFeynmanScorecard("surrendered", "structural"), {
			clarity: "partial",
			jargonFree: "partial",
			causalChain: "gap",
		});
	});

	it("resolveFeynmanScorecard returns null for standard recall/discrimination/composition problems without scorecard", () => {
		assert.equal(
			resolveFeynmanScorecard({ outcome: "solved" }, { mode: "recall" }),
			null,
		);
		assert.equal(
			resolveFeynmanScorecard({ outcome: "dismissed" }, { mode: "feynman" }),
			null,
		);
		const fallback = resolveFeynmanScorecard(
			{ outcome: "solved" },
			{ mode: "feynman" },
		);
		assert.deepEqual(fallback, {
			clarity: "strong",
			jargonFree: "strong",
			causalChain: "strong",
		});
	});

	it("buildFeynmanPrompt formats the Teach-Back opening prompt", () => {
		const prompt = buildFeynmanPrompt("Bayes' Rule", "Prior odds, Likelihood ratio");
		assert.match(prompt, /Teach back \(Feynman\): Bayes' Rule \(Prior odds, Likelihood ratio\)/);
		assert.match(prompt, /12-year-old/);
	});
});

describe("Feynman mode — practice tool schemas & argument healing", () => {
	it("problemInputObject accepts mode: 'feynman' and heals double-encoded '\"feynman\"'", () => {
		const raw = {
			statement: "Explain to a curious 12-year-old why a balloon expands when heated.",
			mode: '"feynman"',
			target: ["ideal-gas-kinetic"],
			modelSolution: "Faster molecules bounce harder and more often against the rubber wall…",
		};
		const healed = healEncodedArguments(raw, problemInputObject);
		const validated = validateToolArguments(
			{ name: "problem", parameters: problemInputObject } as never,
			{ id: "call_f1", type: "toolCall", name: "problem", arguments: healed } as never,
		) as { mode: string };
		assert.equal(validated.mode, "feynman");
	});

	it("concludeInputObject accepts optional feynmanScorecard", () => {
		const args = {
			outcome: "solvedWithHints",
			verdict: "Unpacked 'entropy' after one follow-up question.",
			rung: "R1",
			missClass: "discrimination",
			retest: false,
			feynmanScorecard: {
				clarity: "strong",
				jargonFree: "partial",
				causalChain: "strong",
				jargonFlags: ["entropy", "microstate"],
			},
		};
		const validated = validateToolArguments(
			{ name: "conclude", parameters: concludeInputObject } as never,
			{ id: "call_c1", type: "toolCall", name: "conclude", arguments: args } as never,
		) as { feynmanScorecard?: { jargonFlags?: string[] } };
		assert.deepEqual(validated.feynmanScorecard?.jargonFlags, ["entropy", "microstate"]);
	});
});

describe("Feynman mode — UI surface (PracticeDock, ProblemCard, ConcludeCard, SessionWrapUpBody)", () => {
	it("PracticeDock renders Teach back · Feynman badge and ELI12 prompt when mode is feynman", () => {
		const html = renderToStaticMarkup(
			<PracticeDock
				problemCallId="call_f1"
				input={{
					statement: "Explain how public-key encryption works without using math jargon.",
					mode: "feynman",
				}}
				expanded={true}
				onExpand={() => {}}
				onSubmit={() => {}}
			/>,
		);
		assert.match(html, /data-testid="practice-feynman-badge"/);
		assert.match(html, /Teach back · Feynman/);
		assert.match(html, /EXPLAIN LIKE I&#x27;M 12/);
		assert.match(html, /Submit explanation/);
	});

	it("ProblemCard renders the Feynman badge when mode is feynman", () => {
		const html = renderToStaticMarkup(
			<ProblemCard
				part={part({
					input: {
						statement: "Explain recursion to a 12-year-old.",
						mode: "feynman",
						modelSolution: "A Russian nesting doll with a smallest solid doll at the center.",
					},
				})}
			/>,
		);
		assert.match(html, /data-testid="problem-card-feynman-badge"/);
		assert.match(html, /Teach back · Feynman/);
	});

	it("ConcludeCard renders the 3-pillar Feynman Scorecard and unpacked jargon flags", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: {
						outcome: "solvedWithHints",
						verdict: "Great analogy once 'stack frame' was unpacked.",
						feynmanScorecard: {
							clarity: "strong",
							jargonFree: "partial",
							causalChain: "strong",
							jargonFlags: ["stack frame"],
						},
					},
					problemInput: { mode: "feynman", target: ["n_recursion"] },
					reveal: "Each step waits on a smaller copy until the base case answers.",
				})}
			/>,
		);
		assert.match(html, /data-testid="feynman-scorecard"/);
		assert.match(html, /data-testid="feynman-pillar-clarity"/);
		assert.match(html, /data-testid="feynman-pillar-jargonFree"/);
		assert.match(html, /data-testid="feynman-pillar-causalChain"/);
		assert.match(html, /data-testid="feynman-jargon-flags"/);
		assert.match(html, /stack frame/);
	});

	it("SessionWrapUpBody renders the Teach back (Feynman) action button", () => {
		const html = renderToStaticMarkup(
			<SessionWrapUpBody
				steps={[{ id: "s1", title: "Mechanism" }]}
				propositions={[{ id: "p1", name: "Core claim", statement: "A causes B." }]}
				uncoveredCount={0}
				extracting={false}
				startingPractice={false}
				propositionsOpen={false}
				onTogglePropositions={() => {}}
				onPractice={() => {}}
				onFeynman={() => {}}
				onExtract={() => {}}
			/>,
		);
		assert.match(html, /data-testid="wrap-up-feynman"/);
		assert.match(html, /Teach back \(Feynman\)/);
	});

	it("Spaced Retrieval updates node review intervals from concluded Feynman problems", () => {
		const now = Date.parse("2026-10-30T12:00:00Z");
		const messages: LhMessage[] = [
			{
				id: "m1",
				role: "assistant",
				timestamp: now - 3600_000,
				content: [
					{
						type: "toolCall",
						id: "call_f1",
						name: "problem",
						arguments: {
							statement: "Explain A -> B simply.",
							mode: "feynman",
							target: ["p1"],
							modelSolution: "Simple cause and effect.",
						},
					},
				],
			} as unknown as LhMessage,
			{
				id: "m2",
				role: "toolResult",
				toolCallId: "call_f1",
				toolName: "problem",
				content: [{ type: "text", text: "Problem posed" }],
				details: null,
				isError: false,
				timestamp: now - 3599_000,
			} as unknown as LhMessage,
			{
				id: "m3",
				role: "assistant",
				timestamp: now - 1800_000,
				content: [
					{
						type: "toolCall",
						id: "call_c1",
						name: "conclude",
						arguments: {
							outcome: "solved",
							verdict: "Crystal clear explanation without jargon.",
							rung: null,
							missClass: null,
							retest: false,
							feynmanScorecard: {
								clarity: "strong",
								jargonFree: "strong",
								causalChain: "strong",
							},
						},
					},
				],
			} as unknown as LhMessage,
		];
		const stats = derivePracticeStats(
			[{ id: "p1", name: "Core claim" }],
			[{ id: "sess_1", messages }],
			now,
		);
		assert.equal(stats.p1?.attempts, 1);
		assert.equal(stats.p1?.streak, 1);
		assert.equal(stats.p1?.state, "fresh");
	});
});
