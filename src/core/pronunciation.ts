/**
 * Pure pronunciation alignment & evaluation engine (Wave 6 — Deepgram
 * Language Speaking & Pronunciation Validation).
 *
 * Aligns a target word or sentence (`targetPhrase` in `language`) against
 * Deepgram's recognized transcript + per-word confidence array
 * (`channel.alternatives[0].words`) using dynamic programming (Needleman-Wunsch
 * sequence alignment) and normalized edit distance (exact, diacritic-insensitive,
 * and Levenshtein similarity).
 *
 * Produces word-by-word status pills:
 *   - "exact"  (Grün): matched word with high recognition confidence (>= 0.78)
 *   - "fuzzy"  (Gelb): matched word with lower confidence (< 0.78), accent/diacritic
 *                      difference, or minor phonetic closeness (>= 0.65 similarity)
 *   - "missed" (Rot):  missing or substituted word (< 0.65 similarity)
 *
 * Browser-safe, deterministic, zero I/O.
 */

import { Type, type Static } from "typebox";
import { isDictationLanguage, type DictationLanguage } from "./dictation.ts";

export const pronounceSpecSchema = Type.Object({
	phrase: Type.String({
		description:
			"REQUIRED. The exact target word or sentence in the target language that the learner must speak aloud (e.g. 'Buenos días, ¿cómo estás?').",
	}),
	language: Type.String({
		description:
			"REQUIRED. BCP-47 language code for Deepgram speech recognition & TTS (e.g. 'es', 'en', 'fr', 'it', 'pt', 'de', 'nl', 'ja', 'zh', 'ko', 'ru').",
	}),
	phoneticHint: Type.Optional(
		Type.String({
			description:
				"Optional pronunciation guide or syllable stress hint shown to the learner (e.g. 'bwe-nos DEE-as — betone das í').",
		}),
	),
	translation: Type.Optional(
		Type.String({
			description: "Optional translation or meaning of the target phrase.",
		}),
	),
});

export type PronounceSpec = Static<typeof pronounceSpecSchema>;

export interface PronouncedWordInput {
	word: string;
	confidence: number;
	punctuatedWord?: string;
}

export type WordPronunciationStatus = "exact" | "fuzzy" | "missed";

export interface WordPronunciationToken {
	/** Original token from targetPhrase (preserving display punctuation/accents). */
	expected: string;
	/** Matched token spoken by the learner, or null if omitted. */
	spoken: string | null;
	/** Deepgram word confidence in [0, 1], or null if omitted. */
	confidence: number | null;
	/** Visual traffic-light status: exact (green), fuzzy (yellow), missed (red). */
	status: WordPronunciationStatus;
	/** Normalized lexical similarity in [0, 1]. */
	similarity: number;
}

export interface PronunciationEvaluation {
	targetPhrase: string;
	language: string;
	transcript: string;
	/** Overall pronunciation score (0-100), combining word accuracy & Deepgram confidence. */
	overallScorePct: number;
	/** True when overallScorePct >= 75 and no target word was missed. */
	passed: boolean;
	/** Per-target-word alignment and grading breakdown. */
	words: WordPronunciationToken[];
	/** Extra words spoken that did not align to any target word. */
	extraSpokenWords: string[];
	/** Concise German coaching summary for immediate UI display. */
	feedbackSummary: string;
}

/** High-confidence threshold for "exact" (green) classification. */
export const EXACT_CONFIDENCE_FLOOR = 0.78;
/** Minimum lexical similarity for "fuzzy" (yellow) classification. */
export const FUZZY_SIMILARITY_FLOOR = 0.65;
/** Passing overall score threshold (0-100). */
export const PASSING_SCORE_PCT = 75;

/** Strip surrounding and inline punctuation while keeping letters, marks, and numbers. */
export function normalizeWordToken(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "")
		.replace(/[^\p{L}\p{M}\p{N}'’-]/gu, "");
}

/** Strip combining diacritical marks (e.g. á -> a, ñ -> n, ü -> u) for accent-lenient comparison. */
export function stripDiacritics(text: string): string {
	return text.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
}

/** Split a phrase into display tokens that contain at least one letter or digit. */
export function tokenizePhrase(phrase: string): string[] {
	return phrase
		.trim()
		.split(/\s+/)
		.filter((token) => normalizeWordToken(token).length > 0);
}

/** Standard Levenshtein edit distance between two strings. */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(
				curr[j - 1]! + 1,
				prev[j]! + 1,
				prev[j - 1]! + cost,
			);
		}
		for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
	}
	return prev[b.length]!;
}

/**
 * Compute lexical similarity in [0, 1] between an expected token and a spoken token:
 * - 1.00 when normalized forms match identically (including accents)
 * - 0.94 when diacritic-stripped forms match identically (e.g. "como" vs "cómo")
 * - Otherwise 1 - editDistance / maxLen on diacritic-stripped forms
 */
export function wordSimilarity(expectedRaw: string, spokenRaw: string): number {
	const exp = normalizeWordToken(expectedRaw);
	const spk = normalizeWordToken(spokenRaw);
	if (!exp || !spk) return 0;
	if (exp === spk) return 1;
	const expPlain = stripDiacritics(exp);
	const spkPlain = stripDiacritics(spk);
	if (expPlain === spkPlain) return 0.94;
	const maxLen = Math.max(expPlain.length, spkPlain.length);
	if (maxLen === 0) return 1;
	const dist = levenshteinDistance(expPlain, spkPlain);
	return Math.max(0, 1 - dist / maxLen);
}

/**
 * Align expected words with spoken words using dynamic programming
 * so an extra or omitted word does not shift all subsequent words.
 */
function alignWords(
	expectedTokens: readonly string[],
	spokenTokens: readonly PronouncedWordInput[],
): {
	matches: Array<{ expectedIndex: number; spokenIndex: number | null; similarity: number }>;
	extraSpokenIndices: number[];
} {
	const n = expectedTokens.length;
	const m = spokenTokens.length;
	const GAP_PENALTY = -0.35;

	// dp[i][j] = best alignment score for expected[0..i-1] and spoken[0..j-1]
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	const choice: Array<Array<"match" | "skip-expected" | "skip-spoken">> = Array.from(
		{ length: n + 1 },
		() => new Array<"match" | "skip-expected" | "skip-spoken">(m + 1).fill("skip-expected"),
	);

	for (let i = 1; i <= n; i++) {
		dp[i]![0] = i * GAP_PENALTY;
		choice[i]![0] = "skip-expected";
	}
	for (let j = 1; j <= m; j++) {
		dp[0]![j] = j * GAP_PENALTY;
		choice[0]![j] = "skip-spoken";
	}

	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const sim = wordSimilarity(expectedTokens[i - 1]!, spokenTokens[j - 1]!.word);
			// Reward pairing only when similarity is at least marginally plausible (>= 0.35)
			const pairScore = sim >= 0.35 ? sim : -0.5;
			const scoreMatch = dp[i - 1]![j - 1]! + pairScore;
			const scoreSkipExp = dp[i - 1]![j]! + GAP_PENALTY;
			const scoreSkipSpk = dp[i]![j - 1]! + GAP_PENALTY;

			if (scoreMatch >= scoreSkipExp && scoreMatch >= scoreSkipSpk) {
				dp[i]![j] = scoreMatch;
				choice[i]![j] = "match";
			} else if (scoreSkipExp >= scoreSkipSpk) {
				dp[i]![j] = scoreSkipExp;
				choice[i]![j] = "skip-expected";
			} else {
				dp[i]![j] = scoreSkipSpk;
				choice[i]![j] = "skip-spoken";
			}
		}
	}

	const matchedSpokenForExpected = new Array<number | null>(n).fill(null);
	const usedSpoken = new Set<number>();
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && choice[i]![j] === "match") {
			const sim = wordSimilarity(expectedTokens[i - 1]!, spokenTokens[j - 1]!.word);
			if (sim >= 0.35) {
				matchedSpokenForExpected[i - 1] = j - 1;
				usedSpoken.add(j - 1);
			}
			i--;
			j--;
		} else if (i > 0 && (j === 0 || choice[i]![j] === "skip-expected")) {
			i--;
		} else {
			j--;
		}
	}

	const matches = expectedTokens.map((exp, idx) => {
		const spkIdx = matchedSpokenForExpected[idx] ?? null;
		const sim = spkIdx !== null ? wordSimilarity(exp, spokenTokens[spkIdx]!.word) : 0;
		return { expectedIndex: idx, spokenIndex: spkIdx, similarity: sim };
	});

	const extraSpokenIndices: number[] = [];
	for (let s = 0; s < m; s++) {
		if (!usedSpoken.has(s)) extraSpokenIndices.push(s);
	}

	return { matches, extraSpokenIndices };
}

/**
 * Evaluate a learner's spoken pronunciation against a target word or sentence.
 *
 * If `words` (Deepgram's per-word confidence array) is absent or empty, falls
 * back to tokenizing `transcript` with a default confidence of 0.88.
 */
export function evaluatePronunciation(
	targetPhrase: string,
	language: string,
	transcript: string,
	words?: readonly PronouncedWordInput[],
): PronunciationEvaluation {
	const expectedTokens = tokenizePhrase(targetPhrase);
	const spokenInputs: PronouncedWordInput[] =
		words && words.length > 0
			? words
					.filter((w) => normalizeWordToken(w.word).length > 0)
					.map((w) => ({
						word: w.punctuatedWord ?? w.word,
						confidence: Math.max(0, Math.min(1, Number.isFinite(w.confidence) ? w.confidence : 0.88)),
					}))
			: tokenizePhrase(transcript).map((w) => ({ word: w, confidence: 0.88 }));

	if (expectedTokens.length === 0) {
		return {
			targetPhrase,
			language,
			transcript: transcript.trim(),
			overallScorePct: 0,
			passed: false,
			words: [],
			extraSpokenWords: [],
			feedbackSummary: "Keine Zielwörter angegeben.",
		};
	}

	if (spokenInputs.length === 0) {
		return {
			targetPhrase,
			language,
			transcript: "",
			overallScorePct: 0,
			passed: false,
			words: expectedTokens.map((exp) => ({
				expected: exp,
				spoken: null,
				confidence: null,
				status: "missed",
				similarity: 0,
			})),
			extraSpokenWords: [],
			feedbackSummary: "Keine Sprache erkannt — bitte sprich das Wort oder den Satz noch einmal deutlich ein.",
		};
	}

	const { matches, extraSpokenIndices } = alignWords(expectedTokens, spokenInputs);

	let weightedSum = 0;
	const evaluatedWords: WordPronunciationToken[] = matches.map(({ expectedIndex, spokenIndex, similarity }) => {
		const expected = expectedTokens[expectedIndex]!;
		if (spokenIndex === null) {
			return {
				expected,
				spoken: null,
				confidence: null,
				status: "missed",
				similarity: 0,
			};
		}
		const spk = spokenInputs[spokenIndex]!;
		const conf = spk.confidence;
		let status: WordPronunciationStatus;
		if (similarity >= 0.9 && conf >= EXACT_CONFIDENCE_FLOOR) {
			status = "exact";
		} else if (similarity >= FUZZY_SIMILARITY_FLOOR) {
			status = "fuzzy";
		} else {
			status = "missed";
		}

		// Per-word score blends lexical similarity (70%) and Deepgram acoustic confidence (30% on top)
		const wordQuality =
			status === "missed"
				? similarity * 0.4
				: similarity * (0.65 + 0.35 * conf);
		weightedSum += Math.max(0, Math.min(1, wordQuality));

		return {
			expected,
			spoken: spk.word,
			confidence: conf,
			status,
			similarity: Math.round(similarity * 100) / 100,
		};
	});

	const extraSpokenWords = extraSpokenIndices.map((idx) => spokenInputs[idx]!.word);
	const rawAvg = weightedSum / expectedTokens.length;
	const extraPenalty = Math.min(0.2, extraSpokenWords.length * 0.05);
	const overallScorePct = Math.round(Math.max(0, Math.min(1, rawAvg - extraPenalty)) * 100);

	const missedWords = evaluatedWords.filter((w) => w.status === "missed");
	const fuzzyWords = evaluatedWords.filter((w) => w.status === "fuzzy");
	const passed = overallScorePct >= PASSING_SCORE_PCT && missedWords.length === 0;

	let feedbackSummary: string;
	if (passed && fuzzyWords.length === 0) {
		feedbackSummary = `Sehr klare Aussprache (${overallScorePct}%) — alle Wörter wurden präzise erkannt.`;
	} else if (passed) {
		const focus = fuzzyWords.map((w) => `„${w.expected}“`).join(", ");
		feedbackSummary = `Gute Aussprache (${overallScorePct}%) — kleiner Feinschliff möglich bei ${focus}.`;
	} else if (missedWords.length > 0) {
		const focus = missedWords.map((w) => `„${w.expected}“`).join(", ");
		feedbackSummary = `Noch nicht ganz (${overallScorePct}%) — achte besonders auf ${focus}.`;
	} else {
		const focus = fuzzyWords.map((w) => `„${w.expected}“`).join(", ");
		feedbackSummary = `Fast richtig (${overallScorePct}%) — sprich ${focus} noch etwas deutlicher aus.`;
	}

	return {
		targetPhrase,
		language,
		transcript: transcript.trim() || spokenInputs.map((s) => s.word).join(" "),
		overallScorePct,
		passed,
		words: evaluatedWords,
		extraSpokenWords,
		feedbackSummary,
	};
}

/** Normalize any language string (e.g. 'es-ES', 'Spanish', 'fr-FR') to a valid Deepgram Nova-3 language code. */
export function resolveDeepgramLanguage(raw: string): DictationLanguage {
	const cleaned = raw.trim();
	if (isDictationLanguage(cleaned)) return cleaned;
	const lower = cleaned.toLowerCase();
	if (isDictationLanguage(lower)) return lower;
	const base = lower.split(/[-_]/)[0] ?? "";
	if (isDictationLanguage(base)) return base;
	const nameMap: Record<string, DictationLanguage> = {
		spanish: "es",
		spanisch: "es",
		espanol: "es",
		español: "es",
		english: "en",
		englisch: "en",
		french: "fr",
		französisch: "fr",
		francais: "fr",
		français: "fr",
		italian: "it",
		italienisch: "it",
		italiano: "it",
		portuguese: "pt",
		portugiesisch: "pt",
		german: "de",
		deutsch: "de",
		dutch: "nl",
		niederländisch: "nl",
		japanese: "ja",
		japanisch: "ja",
		chinese: "zh",
		chinesisch: "zh",
		korean: "ko",
		koreanisch: "ko",
		russian: "ru",
		russisch: "ru",
	};
	return nameMap[lower] ?? "multi";
}

/** Map a BCP-47 language code to a human-readable German label. */
export function languageDisplayLabel(lang: string): string {
	const code = lang.trim().toLowerCase().split("-")[0] ?? lang;
	const labels: Record<string, string> = {
		es: "Spanisch",
		en: "Englisch",
		fr: "Französisch",
		it: "Italienisch",
		pt: "Portugiesisch",
		de: "Deutsch",
		nl: "Niederländisch",
		ja: "Japanisch",
		zh: "Chinesisch",
		ko: "Koreanisch",
		ru: "Russisch",
		pl: "Polnisch",
		tr: "Türkisch",
		sv: "Schwedisch",
	};
	return labels[code] ?? lang.toUpperCase();
}
