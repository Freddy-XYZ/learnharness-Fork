import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	answerForPresentation,
	buildAnswer,
	compactAnswerForModel,
	evaluatePronunciation,
	languageDisplayLabel,
	parsePronounceInput,
	questionNeedsReveal,
	resolveDeepgramLanguage,
	toolQuestionKind,
	type QuestionData,
} from "../src/core/index.ts";

describe("pronunciation evaluation engine (src/core/pronunciation.ts)", () => {
	it("evaluates an exact high-confidence match as passed with all words 'exact'", () => {
		const res = evaluatePronunciation("¡Buenos días, ¿cómo estás?!", "es", "Buenos días cómo estás", [
			{ word: "buenos", punctuatedWord: "Buenos", confidence: 0.96 },
			{ word: "días", punctuatedWord: "días,", confidence: 0.92 },
			{ word: "cómo", punctuatedWord: "¿cómo", confidence: 0.94 },
			{ word: "estás", punctuatedWord: "estás?", confidence: 0.91 },
		]);

		assert.equal(res.passed, true);
		assert.ok(res.overallScorePct >= 88, `expected score >= 88, got ${res.overallScorePct}`);
		assert.deepEqual(
			res.words.map((w) => w.status),
			["exact", "exact", "exact", "exact"],
		);
		assert.equal(res.extraSpokenWords.length, 0);
	});

	it("marks low-confidence or slight accent variations as 'fuzzy'", () => {
		const res = evaluatePronunciation("Hola amigo", "es", "hola amigo", [
			{ word: "hola", confidence: 0.95 },
			{ word: "amigo", confidence: 0.62 }, // below 0.78 exact confidence floor
		]);

		assert.equal(res.words[0]?.status, "exact");
		assert.equal(res.words[1]?.status, "fuzzy");
		assert.equal(res.passed, true);
	});

	it("aligns words with DP when a middle word is skipped so subsequent words still match", () => {
		const res = evaluatePronunciation("Yo quiero comer pan", "es", "yo comer pan", [
			{ word: "yo", confidence: 0.95 },
			{ word: "comer", confidence: 0.93 },
			{ word: "pan", confidence: 0.96 },
		]);

		assert.deepEqual(
			res.words.map((w) => ({ expected: w.expected, spoken: w.spoken, status: w.status })),
			[
				{ expected: "Yo", spoken: "yo", status: "exact" },
				{ expected: "quiero", spoken: null, status: "missed" },
				{ expected: "comer", spoken: "comer", status: "exact" },
				{ expected: "pan", spoken: "pan", status: "exact" },
			],
		);
		assert.equal(res.passed, false, "missing a word fails the pass check");
	});

	it("handles empty spoken input gracefully", () => {
		const res = evaluatePronunciation("Merci beaucoup", "fr", "", []);
		assert.equal(res.passed, false);
		assert.equal(res.overallScorePct, 0);
		assert.deepEqual(
			res.words.map((w) => w.status),
			["missed", "missed"],
		);
	});

	it("resolves BCP-47 and language names to Deepgram Nova-3 language codes", () => {
		assert.equal(resolveDeepgramLanguage("es-ES"), "es");
		assert.equal(resolveDeepgramLanguage("es-419"), "es-419");
		assert.equal(resolveDeepgramLanguage("Spanisch"), "es");
		assert.equal(resolveDeepgramLanguage("fr-FR"), "fr");
		assert.equal(resolveDeepgramLanguage("en-US"), "en-US");
		assert.equal(languageDisplayLabel("es-ES"), "Spanisch");
		assert.equal(languageDisplayLabel("fr"), "Französisch");
	});
});

describe("pronounce question contract & answer pipeline", () => {
	it("parses pronounce tool inputs and integrates with buildAnswer + compactAnswerForModel + answerForPresentation", () => {
		const rawInput = {
			type: "check",
			nodeId: "spanish-vowels",
			question: "Sprich diesen Satz laut auf Spanisch aus:",
			phrase: "La casa es blanca",
			language: "es",
			phoneticHint: "la KA-sa es BLAN-ka",
			translation: "Das Haus ist weiß",
		};
		const parsed = parsePronounceInput(rawInput);
		assert.ok(parsed, "parsePronounceInput accepts valid pronounce input");
		assert.equal(parsed.phrase, "La casa es blanca");
		assert.equal(toolQuestionKind("pronounce"), "pronounce");
		assert.equal(questionNeedsReveal("pronounce", rawInput, "teach"), true);
		assert.equal(questionNeedsReveal("pronounce", { ...rawInput, type: "predict" }, "teach"), false);

		const evaluation = evaluatePronunciation("La casa es blanca", "es", "La casa es blanca", [
			{ word: "La", confidence: 0.95 },
			{ word: "casa", confidence: 0.94 },
			{ word: "es", confidence: 0.96 },
			{ word: "blanca", confidence: 0.92 },
		]);

		const qd: QuestionData = {
			id: "call_pron_1",
			kind: "pronounce",
			questionType: "check",
			question: parsed.question,
			mode: "pronounce",
			options: [],
			pronounce: {
				phrase: parsed.phrase,
				language: parsed.language,
				phoneticHint: parsed.phoneticHint,
				translation: parsed.translation,
			},
			createdAt: new Date().toISOString(),
		};

		const answer = buildAnswer(qd, { pronunciation: evaluation }, "pronounce");
		assert.equal(answer.kind, "pronounce");
		assert.equal(answer.correct, true);
		assert.equal(answer.confidence, evaluation.overallScorePct);
		assert.equal(answer.text, "La casa es blanca");

		const compact = compactAnswerForModel(answer);
		assert.equal(compact.kind, "pronounce");
		assert.equal(compact.correct, true);
		assert.ok(compact.pronunciation, "compact answer carries structured pronunciation breakdown for the teacher");

		const presented = answerForPresentation({ ...answer, pronounce: undefined }, rawInput);
		assert.deepEqual(presented.pronounce, {
			phrase: "La casa es blanca",
			language: "es",
			phoneticHint: "la KA-sa es BLAN-ka",
			translation: "Das Haus ist weiß",
		});
	});
});
