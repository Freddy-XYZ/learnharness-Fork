/**
 * Feynman Mode ("Teach Back / Explain Like I'm 12") — pure core contracts,
 * scorecard normalization, deterministic fallback derivation, and prompt
 * builders. Browser-safe (zero node builtins).
 */

export type FeynmanRating = "strong" | "partial" | "gap";

export interface FeynmanScorecard {
	/** Plain-language accessibility & analogy quality. */
	clarity: FeynmanRating;
	/** Freedom from undefined technical buzzwords / circular definitions. */
	jargonFree: FeynmanRating;
	/** Completeness of the "why / how" mechanism without logical leaps. */
	causalChain: FeynmanRating;
	/** Specific technical terms the learner initially used without unpacking. */
	jargonFlags?: string[];
}

const VALID_RATINGS = new Set<FeynmanRating>(["strong", "partial", "gap"]);

export function isFeynmanRating(value: unknown): value is FeynmanRating {
	return typeof value === "string" && VALID_RATINGS.has(value as FeynmanRating);
}

export function isFeynmanMode(mode: unknown): boolean {
	return mode === "feynman";
}

/**
 * Validate and normalize an optional `feynmanScorecard` payload from `conclude`.
 * Returns `null` if absent or malformed.
 */
export function normalizeFeynmanScorecard(raw: unknown): FeynmanScorecard | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	if (
		!isFeynmanRating(obj.clarity) ||
		!isFeynmanRating(obj.jargonFree) ||
		!isFeynmanRating(obj.causalChain)
	) {
		return null;
	}
	const flags = Array.isArray(obj.jargonFlags)
		? obj.jargonFlags
				.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
				.map((f) => f.trim())
		: undefined;
	return {
		clarity: obj.clarity,
		jargonFree: obj.jargonFree,
		causalChain: obj.causalChain,
		...(flags && flags.length > 0 ? { jargonFlags: flags } : {}),
	};
}

/**
 * Deterministic fallback scorecard when a `feynman`-mode problem concludes
 * without an explicit `feynmanScorecard` object.
 */
export function deriveDefaultFeynmanScorecard(
	outcome: string,
	missClass?: string | null,
): FeynmanScorecard {
	if (outcome === "solved") {
		return {
			clarity: "strong",
			jargonFree: "strong",
			causalChain: "strong",
		};
	}
	if (outcome === "solvedWithHints") {
		return {
			clarity: "strong",
			jargonFree: missClass === "cue" || missClass === "discrimination" ? "partial" : "strong",
			causalChain: "partial",
		};
	}
	return {
		clarity: "partial",
		jargonFree: "partial",
		causalChain: "gap",
	};
}

/**
 * Resolve the scorecard to display on a `ConcludeCard`: returns the explicit
 * scorecard if present, or derives one when the problem mode was `"feynman"`.
 * Returns `null` for non-Feynman problems without a scorecard.
 */
export function resolveFeynmanScorecard(
	concludeInput: { outcome?: unknown; missClass?: unknown; feynmanScorecard?: unknown } | undefined,
	problemInput: { mode?: unknown } | undefined,
): FeynmanScorecard | null {
	if (!concludeInput) return null;
	const outcome = typeof concludeInput.outcome === "string" ? concludeInput.outcome : "";
	if (outcome === "dismissed") return null;

	const explicit = normalizeFeynmanScorecard(concludeInput.feynmanScorecard);
	if (explicit) return explicit;

	if (isFeynmanMode(problemInput?.mode)) {
		const missClass = typeof concludeInput.missClass === "string" ? concludeInput.missClass : null;
		return deriveDefaultFeynmanScorecard(outcome, missClass);
	}
	return null;
}

/** Human-readable label for a Feynman pillar rating. */
export function formatFeynmanRatingLabel(rating: FeynmanRating): string {
	switch (rating) {
		case "strong":
			return "Clear";
		case "partial":
			return "Needed nudge";
		case "gap":
			return "Gap";
	}
}

/** Canonical opening prompt for starting a Feynman Teach-Back session. */
export function buildFeynmanPrompt(topicLabel: string, stepSummary?: string): string {
	const clean = topicLabel.trim();
	const suffix = stepSummary && stepSummary.trim().length > 0 ? ` (${stepSummary.trim()})` : "";
	return `Teach back (Feynman): ${clean}${suffix} — ask me to explain the core mechanism simply in plain language as if to a curious 12-year-old, probe any jargon or causal leaps, and score my explanation.`;
}
