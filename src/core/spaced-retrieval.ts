/**
 * Spaced retrieval & mastery tracking over the knowledge graph.
 *
 * Pure, deterministic derivation over propositions + practice session
 * transcripts (no separate mutable ledger): every concluded `problem` +
 * `conclude` pair in a practice session exercises its `target` propositions.
 *
 * Expanding spacing schedule (Cepeda et al. / Bjork desirable difficulties):
 * consecutive clean solves ("solved" with retest !== true) expand the review
 * interval across SPACING_INTERVAL_DAYS (1d → 3d → 7d → 14d → 30d). Any
 * hint-assisted solve, move-on, surrender, dismissal, or explicit retest flag
 * resets the streak and places the proposition into the "retest" bucket.
 */

import type { GraphChain, GraphNode, NodePracticeStats, NodeReviewState } from "./contracts.ts";
import { resolveTargetId } from "./chains.ts";
import { PRACTICE_CONCLUDE_TOOL, problemInputForConclude, type LhMessage } from "./native-messages.ts";

export const SPACING_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
const DAY_MS = 86_400_000;

export interface PracticeSessionSlice {
	id: string;
	updatedAt?: string;
	messages: readonly LhMessage[];
}

interface PracticeAttemptEvent {
	timestampMs: number;
	outcome: NonNullable<NodePracticeStats["lastOutcome"]>;
	retest: boolean;
}

const VALID_OUTCOMES = new Set<NonNullable<NodePracticeStats["lastOutcome"]>>([
	"solved",
	"solvedWithHints",
	"movedOn",
	"surrendered",
	"dismissed",
]);

/** Spacing interval in days for a given clean-solve streak (>= 1). */
export function spacingIntervalDaysForStreak(streak: number): number {
	if (streak <= 0) return 0;
	const idx = Math.min(streak - 1, SPACING_INTERVAL_DAYS.length - 1);
	return SPACING_INTERVAL_DAYS[idx]!;
}

/**
 * Derive per-proposition practice statistics from all practice sessions.
 * Pure & deterministic.
 */
export function derivePracticeStats(
	propositions: readonly Pick<GraphNode, "id" | "name">[],
	sessions: readonly PracticeSessionSlice[],
	nowMs: number = Date.now(),
): Record<string, NodePracticeStats> {
	const eventsByNode = new Map<string, PracticeAttemptEvent[]>();
	for (const p of propositions) {
		eventsByNode.set(p.id, []);
	}

	for (const session of sessions) {
		const fallbackMs = session.updatedAt ? Date.parse(session.updatedAt) : 0;
		const messages = session.messages ?? [];
		for (const m of messages) {
			if ((m as { role?: string }).role !== "assistant") continue;
			const content = (m as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			const msgTs = typeof (m as { timestamp?: unknown }).timestamp === "number"
				? ((m as { timestamp: number }).timestamp)
				: (Number.isFinite(fallbackMs) ? fallbackMs : 0);

			for (const block of content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
				if (block.type !== "toolCall" || block.name !== PRACTICE_CONCLUDE_TOOL || typeof block.id !== "string") {
					continue;
				}
				const args = (block.arguments ?? {}) as { outcome?: unknown; retest?: unknown };
				const rawOutcome = typeof args.outcome === "string" ? args.outcome : null;
				if (!rawOutcome || !VALID_OUTCOMES.has(rawOutcome as NonNullable<NodePracticeStats["lastOutcome"]>)) {
					continue;
				}
				const outcome = rawOutcome as NonNullable<NodePracticeStats["lastOutcome"]>;
				const retest = Boolean(args.retest);

				const problemInput = problemInputForConclude(messages, block.id);
				const rawTargets = problemInput?.target;
				if (!Array.isArray(rawTargets) || rawTargets.length === 0) continue;

				const resolvedIds = new Set<string>();
				for (const rawTarget of rawTargets) {
					if (typeof rawTarget !== "string") continue;
					const resolved = resolveTargetId(rawTarget, propositions);
					if (resolved && eventsByNode.has(resolved)) {
						resolvedIds.add(resolved);
					}
				}

				for (const nodeId of resolvedIds) {
					eventsByNode.get(nodeId)!.push({
						timestampMs: msgTs,
						outcome,
						retest,
					});
				}
			}
		}
	}

	const result: Record<string, NodePracticeStats> = {};
	for (const p of propositions) {
		const events = eventsByNode.get(p.id) ?? [];
		events.sort((a, b) => a.timestampMs - b.timestampMs);

		if (events.length === 0) {
			result[p.id] = {
				attempts: 0,
				streak: 0,
				lastPracticedAt: null,
				lastOutcome: null,
				needsRetest: false,
				state: "unpracticed",
				nextDueAt: null,
			};
			continue;
		}

		let streak = 0;
		for (const ev of events) {
			if (ev.outcome === "solved" && !ev.retest) {
				streak += 1;
			} else {
				streak = 0;
			}
		}

		const last = events[events.length - 1]!;
		const needsRetest = last.outcome !== "solved" || last.retest;
		const lastPracticedAt = last.timestampMs > 0 ? new Date(last.timestampMs).toISOString() : null;

		let state: NodeReviewState;
		let nextDueAt: string | null = null;
		if (needsRetest) {
			state = "retest";
		} else {
			const intervalDays = spacingIntervalDaysForStreak(streak);
			const dueMs = last.timestampMs + intervalDays * DAY_MS;
			nextDueAt = last.timestampMs > 0 ? new Date(dueMs).toISOString() : null;
			state = last.timestampMs > 0 && nowMs >= dueMs ? "due" : "fresh";
		}

		result[p.id] = {
			attempts: events.length,
			streak,
			lastPracticedAt,
			lastOutcome: last.outcome,
			needsRetest,
			state,
			nextDueAt,
		};
	}

	return result;
}

export interface DueReviewSelection {
	/** Selected propositions (core targets + their direct premise chains). */
	propositions: { id: string; name: string; statement: string }[];
	/** Names of the primary due target propositions (for the composer prompt). */
	targetNames: string[];
	/** Breakdown of due states across the entire graph. */
	counts: {
		retest: number;
		due: number;
		unpracticed: number;
		totalDue: number;
	};
}

/**
 * Select a focused batch of due propositions (default up to 6 targets) plus
 * their direct premise chains, prioritized by:
 *   1. "retest" (struggled / hints / flagged for retest — most recent first)
 *   2. "due" (spacing interval expired — most overdue first)
 *   3. "unpracticed" (never practiced — oldest createdAt first)
 */
export function selectDueForReview(
	propositions: readonly Pick<GraphNode, "id" | "name" | "statement" | "createdAt">[],
	chains: readonly Pick<GraphChain, "id" | "premises" | "conclusion">[],
	practiceStats: Readonly<Record<string, NodePracticeStats>> | undefined,
	maxTargets: number = 6,
): DueReviewSelection {
	const retestList: Pick<GraphNode, "id" | "name" | "statement" | "createdAt">[] = [];
	const dueList: Pick<GraphNode, "id" | "name" | "statement" | "createdAt">[] = [];
	const unpracticedList: Pick<GraphNode, "id" | "name" | "statement" | "createdAt">[] = [];

	for (const p of propositions) {
		const st = practiceStats?.[p.id];
		const state: NodeReviewState = st?.state ?? "unpracticed";
		if (state === "retest") retestList.push(p);
		else if (state === "due") dueList.push(p);
		else if (state === "unpracticed") unpracticedList.push(p);
	}

	// 1. Retest: most recently practiced first
	retestList.sort((a, b) => {
		const ta = practiceStats?.[a.id]?.lastPracticedAt ?? "";
		const tb = practiceStats?.[b.id]?.lastPracticedAt ?? "";
		return tb.localeCompare(ta) || a.id.localeCompare(b.id);
	});

	// 2. Due: most overdue (earliest nextDueAt) first
	dueList.sort((a, b) => {
		const da = practiceStats?.[a.id]?.nextDueAt ?? "";
		const db = practiceStats?.[b.id]?.nextDueAt ?? "";
		return da.localeCompare(db) || a.id.localeCompare(b.id);
	});

	// 3. Unpracticed: oldest createdAt first
	unpracticedList.sort((a, b) => {
		return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
	});

	const prioritizedTargets = [...retestList, ...dueList, ...unpracticedList].slice(0, Math.max(1, maxTargets));
	const selectedIds = new Set<string>();
	for (const target of prioritizedTargets) {
		selectedIds.add(target.id);
		for (const c of chains) {
			if (c.conclusion === target.id) {
				for (const premiseId of c.premises) selectedIds.add(premiseId);
			}
		}
	}

	const picked: { id: string; name: string; statement: string }[] = [];
	for (const p of propositions) {
		if (selectedIds.has(p.id)) {
			picked.push({ id: p.id, name: p.name, statement: p.statement });
		}
	}

	return {
		propositions: picked,
		targetNames: prioritizedTargets.map((t) => t.name),
		counts: {
			retest: retestList.length,
			due: dueList.length,
			unpracticed: unpracticedList.length,
			totalDue: retestList.length + dueList.length + unpracticedList.length,
		},
	};
}

/** Human-readable badge text for a proposition node's spaced-retrieval status. */
export function formatNodeReviewBadge(
	stats: NodePracticeStats | undefined,
	nowMs: number = Date.now(),
): { label: string; state: NodeReviewState } {
	if (!stats || stats.attempts === 0 || stats.state === "unpracticed") {
		return { label: "Unpracticed", state: "unpracticed" };
	}
	const ageSuffix = stats.lastPracticedAt
		? (() => {
				const days = Math.max(0, Math.floor((nowMs - Date.parse(stats.lastPracticedAt)) / DAY_MS));
				return days === 0 ? "today" : `${days}d ago`;
			})()
		: null;
	if (stats.state === "retest") {
		return {
			label: ageSuffix ? `Needs retest · ${ageSuffix}` : "Needs retest",
			state: "retest",
		};
	}
	if (stats.state === "due") {
		return {
			label: ageSuffix ? `Due for review · ${ageSuffix}` : "Due for review",
			state: "due",
		};
	}
	return {
		label: `Reviewed${ageSuffix ? ` ${ageSuffix}` : ""} · streak ${stats.streak}`,
		state: "fresh",
	};
}
