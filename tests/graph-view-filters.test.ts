/**
 * Legend/filters predicate tests — the pure half of the graph-view filters
 * panel (isNodeVisible); the sigma reducers just consume its verdict.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayCostTotals, isNodeVisible, resolveNodeActionSelection } from "../components/graph-view.tsx";

const node = {
	name: "Money multiplier",
	statement: "The maximum ratio of broad money a bank can create from each unit of base money.",
};

describe("isNodeVisible (search predicate)", () => {
	it("is visible with an empty query", () => {
		assert.equal(isNodeVisible(node, ""), true);
	});

	it("search matches the statement case-insensitively", () => {
		assert.equal(isNodeVisible(node, "MONEY multiplier"), true);
	});

	it("search matches the statement when the name does not", () => {
		assert.equal(isNodeVisible(node, "MAXIMUM ratio"), true);
		assert.equal(isNodeVisible(node, " velocity"), false);
	});

	it("search matches the name when the statement does not", () => {
		assert.equal(isNodeVisible(node, "money MULTIPLIER"), true);
		assert.equal(isNodeVisible(node, " banking"), false);
	});

	it("whitespace-only query is no filter", () => {
		assert.equal(isNodeVisible(node, "   "), true);
	});


});

describe("displayCostTotals (naming-free cost fold)", () => {
	const stage = (dollars: number, unpricedRuns = 0) => ({
		runs: dollars > 0 ? 1 : 0,
		dollars,
		unpricedRuns,
		tokens: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
		},
	});
	const costs = {
		stages: {
			extraction: stage(1.25, 1),
			audit: stage(0.75),
			naming: stage(9.99, 2), // dead channel — must never reach the display
		},
	} as const;

	it("sums the live stages only — the dead namer's spend is invisible", () => {
		assert.equal(displayCostTotals(costs).totalDollars, 2);
	});

	it("unpriced counts fold the same two stages", () => {
		assert.equal(displayCostTotals(costs).unpricedRuns, 1);
	});
});

describe("resolveNodeActionSelection (node card Practice / Go deeper actions)", () => {
	const propositions = [
		{ id: "n_1", name: "Fractional reserve", statement: "Banks hold only a fraction of deposits as reserves." },
		{ id: "n_2", name: "Deposit re-lending", statement: "Excess reserves are lent out and redeposited." },
		{ id: "n_3", name: "Money multiplier", statement: "Broad money expands by the reciprocal of the reserve ratio." },
		{ id: "n_4", name: "Inflation target", statement: "Central banks target a stable inflation rate." },
	];
	const chains = [
		{ id: "arg_1", premises: ["n_1", "n_2"], conclusion: "n_3" },
	];

	it("selects a standalone proposition when it has no incoming chains", () => {
		const res = resolveNodeActionSelection(propositions[3]!, propositions, chains);
		assert.deepEqual(
			res.propositions.map((p) => p.id),
			["n_4"],
		);
		assert.equal(res.label, "Inflation target");
	});

	it("selects a proposition together with its direct premise chain", () => {
		const res = resolveNodeActionSelection(propositions[2]!, propositions, chains);
		assert.deepEqual(
			res.propositions.map((p) => p.id),
			["n_1", "n_2", "n_3"],
		);
		assert.equal(res.label, "Money multiplier");
	});

	it("selects all premises and the conclusion when clicking an implication node (⟹) and uses the conclusion name as label", () => {
		const impNode = { id: "arg_1", name: "⟹", statement: "Fractional reserve ∧ Deposit re-lending ⟹ Money multiplier" };
		const res = resolveNodeActionSelection(impNode, propositions, chains);
		assert.deepEqual(
			res.propositions.map((p) => p.id),
			["n_1", "n_2", "n_3"],
		);
		assert.equal(res.label, "Money multiplier");
	});

	it("merges with an existing selection without losing previously selected propositions", () => {
		const existing = new Set(["n_4"]);
		const res = resolveNodeActionSelection(propositions[2]!, propositions, chains, existing);
		assert.deepEqual(
			res.propositions.map((p) => p.id),
			["n_1", "n_2", "n_3", "n_4"],
		);
	});
});
