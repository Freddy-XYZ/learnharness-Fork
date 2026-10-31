"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, MicIcon, RotateCcwIcon, SquareIcon, Volume2Icon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import {
	DEEPGRAM_KEY_ID,
	DICTATION_KEYLESS,
	ensureAudioGraph,
	mintFreshToken,
	rmsToMeter,
	warmTokens,
} from "@/components/dictation";
import {
	deepgramListenUrl,
	evaluatePronunciation,
	languageDisplayLabel,
	resolveDeepgramLanguage,
	type PronounceSpec,
	type PronouncedWordInput,
	type PronunciationEvaluation,
} from "@/src/core";
import { cn } from "@/lib/utils";

/** Speak a phrase or word aloud using the browser's Web Speech API. */
export function speakTextWithTts(text: string, language: string, rate = 0.95): void {
	if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
	try {
		window.speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		const normalizedLang = language.trim() || "es-ES";
		utterance.lang = normalizedLang;
		utterance.rate = rate;

		const voices = window.speechSynthesis.getVoices();
		const langPrefix = normalizedLang.toLowerCase().split(/[-_]/)[0] ?? "";
		const exactVoice =
			voices.find((v) => v.lang.toLowerCase() === normalizedLang.toLowerCase()) ??
			voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
		if (exactVoice) utterance.voice = exactVoice;

		window.speechSynthesis.speak(utterance);
	} catch {
		/* ignore speechSynthesis errors on unsupported platforms */
	}
}

/**
 * Word-by-word pronunciation evaluation card — rendered both live inside the
 * QuestionDock after speaking and in AnsweredCard in the settled transcript.
 */
export function PronunciationFeedbackView({
	evaluation,
	language,
	className,
}: {
	evaluation: PronunciationEvaluation;
	language: string;
	className?: string;
}) {
	return (
		<div
			data-testid="pronunciation-feedback"
			className={cn("rounded-xl border border-border/70 bg-muted/25 p-3 text-sm", className)}
		>
			<div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span
						data-testid="pronunciation-score"
						className={cn(
							"inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums",
							evaluation.passed
								? "bg-emerald-500/15 text-emerald-500"
								: evaluation.overallScorePct >= 50
									? "bg-amber-500/15 text-amber-500"
									: "bg-red-500/15 text-red-500",
						)}
					>
						{evaluation.passed && <CheckCircle2Icon className="size-3.5" />}
						{evaluation.overallScorePct}% Deepgram-Score
					</span>
					<span className="text-xs text-muted-foreground">{evaluation.feedbackSummary}</span>
				</div>
				<span className="text-[11px] text-muted-foreground">Klicke auf ein Wort zum Vorlesen</span>
			</div>

			<div className="flex flex-wrap gap-1.5" data-testid="pronunciation-word-pills">
				{evaluation.words.map((w, idx) => {
					const confPct = w.confidence !== null ? Math.round(w.confidence * 100) : null;
					const spokenDiffers =
						w.spoken !== null &&
						w.spoken.trim().toLowerCase() !==
							w.expected
								.trim()
								.toLowerCase()
								.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
					return (
						<button
							key={`${idx}-${w.expected}`}
							type="button"
							onClick={() => speakTextWithTts(w.expected, language, 0.85)}
							title={
								w.status === "exact"
									? `Klar erkannt (${confPct ?? 100}% Deepgram-Confidence) — klicken zum Anhören`
									: w.status === "fuzzy"
										? `Fast richtig (${confPct ?? 0}% Confidence${w.spoken ? `, gehört: „${w.spoken}“` : ""}) — klicken zum Anhören`
										: `Nicht erkannt${w.spoken ? ` (gehört: „${w.spoken}“)` : ""} — klicken zum Anhören`
							}
							className={cn(
								"group inline-flex flex-col items-start rounded-lg border px-2.5 py-1 text-left transition-colors cursor-pointer",
								w.status === "exact" &&
									"border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15",
								w.status === "fuzzy" &&
									"border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15",
								w.status === "missed" &&
									"border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15",
							)}
						>
							<span className="flex items-center gap-1.5 text-sm font-medium">
								<span>{w.expected}</span>
								{confPct !== null && (
									<span className="font-mono text-[10px] opacity-75">{confPct}%</span>
								)}
							</span>
							{w.status === "missed" && (
								<span className="text-[10px] opacity-85">
									{w.spoken ? `gehört: „${w.spoken}“` : "fehlt"}
								</span>
							)}
							{w.status === "fuzzy" && spokenDiffers && (
								<span className="text-[10px] opacity-85">gehört: „{w.spoken}“</span>
							)}
						</button>
					);
				})}
			</div>

			{evaluation.transcript && (
				<div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
					<span>
						Erkanntes Transkript: <span className="font-medium text-foreground">„{evaluation.transcript}“</span>
					</span>
				</div>
			)}
		</div>
	);
}

/**
 * Interactive Deepgram Pronunciation Trainer inside the QuestionDock.
 */
export function PronunciationTrainer({
	spec,
	evaluation,
	onEvaluate,
	dontKnow,
	onToggleDontKnow,
}: {
	spec: PronounceSpec;
	evaluation?: PronunciationEvaluation;
	onEvaluate: (ev: PronunciationEvaluation) => void;
	dontKnow?: boolean;
	onToggleDontKnow?: () => void;
}) {
	const { open: openSettings } = useSettingsDialog();
	const [phase, setPhase] = useState<"idle" | "connecting" | "recording" | "stopping">("idle");
	const [error, setError] = useState<string | null>(null);
	const [meterLevel, setMeterLevel] = useState(0);

	const wsRef = useRef<WebSocket | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const workletRef = useRef<AudioWorkletNode | null>(null);
	const pendingFramesRef = useRef<ArrayBuffer[]>([]);
	const genRef = useRef(0);
	const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const levelRef = useRef(0);

	const transcriptsRef = useRef<string[]>([]);
	const wordsRef = useRef<PronouncedWordInput[]>([]);
	const onEvaluateRef = useRef(onEvaluate);
	onEvaluateRef.current = onEvaluate;

	const finalizeRun = useCallback(
		(produceEvaluation: boolean) => {
			genRef.current++;
			if (safetyTimerRef.current) {
				clearTimeout(safetyTimerRef.current);
				safetyTimerRef.current = null;
			}
			if (meterTimerRef.current) {
				clearInterval(meterTimerRef.current);
				meterTimerRef.current = null;
			}
			pendingFramesRef.current = [];
			for (const track of streamRef.current?.getTracks() ?? []) track.stop();
			streamRef.current = null;
			sourceRef.current?.disconnect();
			sourceRef.current = null;
			workletRef.current?.disconnect();
			workletRef.current = null;

			const ws = wsRef.current;
			wsRef.current = null;
			if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
				try {
					ws.close();
				} catch {}
			}
			setPhase("idle");
			setMeterLevel(0);

			if (produceEvaluation) {
				const transcript = transcriptsRef.current.join(" ").trim();
				const words = [...wordsRef.current];
				transcriptsRef.current = [];
				wordsRef.current = [];
				const result = evaluatePronunciation(spec.phrase, spec.language, transcript, words);
				onEvaluateRef.current(result);
			}
			warmTokens.refresh();
		},
		[spec.phrase, spec.language],
	);

	useEffect(() => {
		return () => {
			finalizeRun(false);
		};
	}, [finalizeRun]);

	const startRecording = useCallback(async () => {
		setError(null);
		setPhase("connecting");
		transcriptsRef.current = [];
		wordsRef.current = [];
		pendingFramesRef.current = [];
		levelRef.current = 0;
		const gen = ++genRef.current;

		const dgLang = resolveDeepgramLanguage(spec.language);
		const tokenPromise = warmTokens.mint();
		tokenPromise.catch(() => {});

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
			if (gen !== genRef.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			streamRef.current = stream;

			const { ctx, module } = ensureAudioGraph();
			await module;
			if (ctx.state === "suspended") await ctx.resume();
			if (gen !== genRef.current) return;

			const worklet = new AudioWorkletNode(ctx, "pcm-capture");
			workletRef.current = worklet;
			worklet.port.onmessage = (e) => {
				const msg = e.data as { type: string; rms?: number; buffer?: ArrayBuffer };
				if (msg.type === "level") {
					levelRef.current = msg.rms ?? 0;
				} else if (msg.type === "audio" && msg.buffer) {
					const ws = wsRef.current;
					if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg.buffer);
					else {
						pendingFramesRef.current.push(msg.buffer);
						if (pendingFramesRef.current.length > 256) pendingFramesRef.current.shift();
					}
				}
			};
			const source = ctx.createMediaStreamSource(stream);
			sourceRef.current = source;
			source.connect(worklet);
			worklet.connect(ctx.destination);

			meterTimerRef.current = setInterval(() => {
				setMeterLevel(rmsToMeter(levelRef.current));
			}, 60);
		} catch (e) {
			if (gen !== genRef.current) return;
			const msg =
				e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
					? "Mikrofon-Berechtigung verweigert"
					: e instanceof Error
						? e.message
						: "Mikrofon nicht verfügbar";
			setError(msg);
			finalizeRun(false);
			return;
		}

		let token: string;
		try {
			token = await tokenPromise;
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(e instanceof Error ? e.message : "Deepgram-Token nicht verfügbar");
			finalizeRun(false);
			return;
		}
		if (gen !== genRef.current) return;

		const openWs = (tok: string, isRetry = false) => {
			const ws = new WebSocket(deepgramListenUrl(dgLang), ["bearer", tok]);
			wsRef.current = ws;

			ws.addEventListener("open", () => {
				if (gen !== genRef.current) return;
				for (const frame of pendingFramesRef.current) ws.send(frame);
				pendingFramesRef.current = [];
				setPhase("recording");
			});

			ws.addEventListener("message", (ev) => {
				if (gen !== genRef.current) return;
				let msg: any;
				try {
					msg = JSON.parse(ev.data as string);
				} catch {
					return;
				}
				if (msg.type === "Results" && msg.is_final) {
					const alt = msg.channel?.alternatives?.[0];
					const text: string | undefined = alt?.transcript;
					if (text) transcriptsRef.current.push(text);
					if (Array.isArray(alt?.words)) {
						for (const w of alt.words) {
							if (typeof w?.word === "string") {
								wordsRef.current.push({
									word: w.word,
									punctuatedWord: typeof w.punctuated_word === "string" ? w.punctuated_word : undefined,
									confidence: typeof w.confidence === "number" ? w.confidence : 0.88,
								});
							}
						}
					}
				}
			});

			ws.addEventListener("close", (ev) => {
				if (gen !== genRef.current) return;
				if (ev.code === 1000) {
					finalizeRun(true);
					return;
				}
				if (!isRetry) {
					mintFreshToken()
						.then((fresh) => {
							if (gen === genRef.current) openWs(fresh, true);
						})
						.catch(() => {
							if (gen === genRef.current) {
								setError("Deepgram-Verbindung fehlgeschlagen");
								finalizeRun(false);
							}
						});
				} else {
					setError(`Deepgram-Verbindung getrennt (${ev.code})`);
					finalizeRun(false);
				}
			});
		};

		openWs(token);
	}, [spec.language, finalizeRun]);

	const stopRecording = useCallback(() => {
		const gen = genRef.current;
		if (phase !== "recording" && phase !== "connecting") return;
		setPhase("stopping");

		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;

		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			try {
				ws.send(JSON.stringify({ type: "CloseStream" }));
			} catch {
				finalizeRun(true);
				return;
			}
			safetyTimerRef.current = setTimeout(() => {
				if (gen === genRef.current) finalizeRun(true);
			}, 2500);
		} else {
			finalizeRun(true);
		}
	}, [phase, finalizeRun]);

	const isBusy = phase === "connecting" || phase === "recording" || phase === "stopping";
	const langLabel = languageDisplayLabel(spec.language);

	return (
		<div
			data-testid="pronunciation-trainer"
			className="mb-3 rounded-xl border border-primary/25 bg-primary/[0.03] p-3.5"
		>
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
						<SparklesIcon className="size-3" />
						{langLabel} · {spec.language.toUpperCase()}
					</span>
					<span className="text-xs text-muted-foreground">Aussprache-Training (Deepgram Nova-3)</span>
				</div>
				<div className="flex items-center gap-1.5">
					<Button
						type="button"
						variant="outline"
						size="xs"
						data-testid="pronunciation-listen"
						onClick={() => speakTextWithTts(spec.phrase, spec.language, 0.95)}
						className="gap-1.5 text-xs"
					>
						<Volume2Icon className="size-3.5" />
						Anhören
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						data-testid="pronunciation-listen-slow"
						onClick={() => speakTextWithTts(spec.phrase, spec.language, 0.72)}
						className="text-xs text-muted-foreground hover:text-foreground"
					>
						0.75× Langsam
					</Button>
				</div>
			</div>

			{/* Target phrase display */}
			<div
				data-testid="pronunciation-target-phrase"
				className="my-2 rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-lg font-semibold tracking-tight text-foreground"
			>
				{spec.phrase}
				{spec.phoneticHint && (
					<div className="mt-1 font-mono text-xs font-normal text-muted-foreground">
						Aussprache-Hinweis: [{spec.phoneticHint}]
					</div>
				)}
				{spec.translation && (
					<div className="mt-0.5 text-xs font-normal italic text-muted-foreground">
						Bedeutung: „{spec.translation}“
					</div>
				)}
			</div>

			{/* Recording & Action Bar */}
			<div className="mt-3 flex flex-wrap items-center gap-2.5">
				{!isBusy ? (
					<Button
						type="button"
						variant={evaluation ? "outline" : "default"}
						size="sm"
						data-testid="pronunciation-record-btn"
						onClick={startRecording}
						className="gap-2"
					>
						{evaluation ? <RotateCcwIcon className="size-3.5" /> : <MicIcon className="size-3.5" />}
						{evaluation ? "Nochmal einsprechen" : "Jetzt einsprechen & prüfen"}
					</Button>
				) : (
					<Button
						type="button"
						variant="destructive"
						size="sm"
						data-testid="pronunciation-stop-btn"
						onClick={stopRecording}
						disabled={phase === "stopping"}
						className="gap-2"
					>
						{phase === "connecting" || phase === "stopping" ? (
							<Loader2Icon className="size-3.5 animate-spin" />
						) : (
							<SquareIcon className="size-3.5 fill-current" />
						)}
						{phase === "connecting"
							? "Verbinde Mikrofon…"
							: phase === "stopping"
								? "Werte Aussprache aus…"
								: "Fertig — Aussprache prüfen"}
					</Button>
				)}

				{phase === "recording" && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="inline-block size-2 animate-pulse rounded-full bg-red-500" />
						<span>Sprich jetzt laut…</span>
						<div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full bg-primary transition-all duration-75"
								style={{ width: `${Math.round(Math.max(8, meterLevel * 100))}%` }}
							/>
						</div>
					</div>
				)}

				{onToggleDontKnow && !isBusy && (
					<button
						type="button"
						onClick={onToggleDontKnow}
						className={cn(
							"ml-auto rounded-md border border-dashed px-2.5 py-1 text-xs transition-colors cursor-pointer",
							dontKnow
								? "border-primary bg-primary/10 text-foreground"
								: "border-border text-muted-foreground hover:text-foreground",
						)}
					>
						{dontKnow ? "Überspringen gewählt" : "Ich kann gerade nicht sprechen"}
					</button>
				)}
			</div>

			{error && (
				<div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
					<span>{error}</span>
					{error === DICTATION_KEYLESS && (
						<Button
							type="button"
							variant="outline"
							size="xs"
							onClick={() => openSettings("keys", DEEPGRAM_KEY_ID)}
						>
							Deepgram-Key einrichten
						</Button>
					)}
				</div>
			)}

			{evaluation && !dontKnow && (
				<PronunciationFeedbackView
					evaluation={evaluation}
					language={spec.language}
					className="mt-3"
				/>
			)}
		</div>
	);
}
