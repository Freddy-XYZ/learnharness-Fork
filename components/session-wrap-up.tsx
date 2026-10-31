"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, ChevronRightIcon, DumbbellIcon, MessageSquareQuoteIcon, SparklesIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	buildFeynmanPrompt,
	buildWeakSpotRepairPrompt,
	derivePlanStatuses,
	type PlanTree,
	type SessionCalibration,
} from "@/src/core";
import { topoFor } from "@/components/plan-block";
import { formatCalibrationStatusLabel } from "@/components/calibration-chip";
import { SessionStarter } from "@/components/start-session";
import { useActivity } from "@/components/activity-dock";
import type { SessionCoverage } from "@/components/extraction-coverage";

export interface WrapUpProposition {
	id: string;
	name: string;
	statement: string;
}

export interface WrapUpMessageSlice {
	parts: Array<{ type: string; state?: string; input?: unknown; output?: unknown }>;
}

/**
 * Pure predicate: true when a teaching session's plan has been walked to
 * completion and the final node's check question has settled.
 */
export function isLessonPlanComplete(
	tree: PlanTree | null | undefined,
	messages: readonly WrapUpMessageSlice[],
	busy: boolean,
	hasPendingQuestion: boolean,
): boolean {
	if (!tree || tree.nodes.length === 0) return false;
	if (busy || hasPendingQuestion) return false;
	const statuses = derivePlanStatuses(tree, messages);
	if (!statuses.current) return false;
	const allCovered = tree.nodes.every(
		(n) => statuses.visited.has(n.id) || statuses.current === n.id,
	);
	if (!allCovered) return false;

	let currentCheckAnswered = false;
	for (const m of messages) {
		for (const part of m.parts) {
			if (part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			const input = part.input as { nodeId?: unknown; type?: unknown } | undefined;
			if (input?.nodeId !== statuses.current) continue;
			if (input?.type === "predict") continue;
			if (part.state === "output-available") {
				currentCheckAnswered = true;
			}
		}
	}
	return currentCheckAnswered;
}

/**
 * Pure presentational body for the session wrap-up card (exported for SSR
 * render tests).
 */
export function SessionWrapUpBody({
	steps,
	propositions,
	calibration,
	uncoveredCount,
	extracting,
	startingPractice,
	propositionsOpen,
	onTogglePropositions,
	onPractice,
	onFeynman,
	onRepairWeakSpots,
	onExtract,
}: {
	steps: readonly { id: string; title: string }[];
	propositions: readonly WrapUpProposition[];
	calibration?: SessionCalibration;
	uncoveredCount: number;
	extracting: boolean;
	startingPractice: boolean;
	propositionsOpen: boolean;
	onTogglePropositions: () => void;
	onPractice: () => void;
	onFeynman?: () => void;
	onRepairWeakSpots?: () => void;
	onExtract: () => void;
}) {
	const weakCount = calibration?.weakSpots.length ?? 0;
	return (
		<div
			data-testid="session-wrap-up-card"
			className="my-4 rounded-xl border border-border bg-card p-4 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<div className="flex items-center gap-2 text-sm font-medium text-foreground">
						<CheckCircle2Icon aria-hidden="true" className="size-4 text-primary" />
						<span>Lesson complete</span>
						<span className="text-xs font-normal text-muted-foreground">
							· {steps.length} {steps.length === 1 ? "step" : "steps"} covered
							{propositions.length > 0
								? ` · ${propositions.length} ${propositions.length === 1 ? "proposition" : "propositions"} mapped`
								: ""}
						</span>
					</div>
					<p className="text-xs text-muted-foreground">
						You’ve completed every node in the lesson plan. Lock in what you learned with a targeted practice session.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{(uncoveredCount > 0 || extracting) && (
						<button
							type="button"
							data-testid="wrap-up-extract"
							onClick={onExtract}
							disabled={extracting}
							className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
						>
							<SparklesIcon aria-hidden="true" className={cn("size-3.5", extracting && "animate-spin")} />
							{extracting
								? "Extracting…"
								: `Extract remaining (${uncoveredCount})`}
						</button>
					)}
					{weakCount > 0 && onRepairWeakSpots && (
						<button
							type="button"
							data-testid="wrap-up-repair"
							onClick={onRepairWeakSpots}
							disabled={startingPractice}
							className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
						>
							<WrenchIcon aria-hidden="true" className="size-3.5 text-primary" />
							Repair weak spots ({weakCount})
						</button>
					)}
					{onFeynman && (
						<button
							type="button"
							data-testid="wrap-up-feynman"
							onClick={onFeynman}
							disabled={startingPractice}
							className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
						>
							<MessageSquareQuoteIcon aria-hidden="true" className="size-3.5 text-primary" />
							Teach back (Feynman)
						</button>
					)}
					<button
						type="button"
						data-testid="wrap-up-practice"
						onClick={onPractice}
						disabled={startingPractice}
						className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
					>
						<DumbbellIcon aria-hidden="true" className="size-3.5" />
						{startingPractice ? "Starting…" : "Practice this session"}
					</button>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap gap-1.5">
				{steps.map((step, i) => (
					<span
						key={step.id}
						data-testid={`wrap-up-step-${step.id}`}
						className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-xs text-foreground/90"
					>
						<span className="font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
						<span>{step.title}</span>
					</span>
				))}
			</div>

			{calibration && calibration.totalChecks > 0 && (
				<div
					data-testid="wrap-up-calibration"
					className="mt-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-xs"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2 text-muted-foreground">
							<span className="font-medium text-foreground">Metacognitive calibration</span>
							<span>
								· Accuracy {calibration.accuracyPct}%
								{calibration.meanConfidencePct !== null
									? ` · Mean confidence ${calibration.meanConfidencePct}%`
									: ""}
							</span>
						</div>
						<span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[10px] font-medium text-foreground">
							{formatCalibrationStatusLabel(calibration)}
						</span>
					</div>
					{calibration.weakSpots.length > 0 && (
						<div className="mt-2 flex flex-wrap gap-1.5">
							{calibration.weakSpots.map((w, idx) => (
								<span
									key={idx}
									className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px]"
								>
									<span className="font-medium text-foreground">
										{w.nodeTitle ?? "Check"}
									</span>
									<span className="text-muted-foreground">
										·{" "}
										{w.outcomeClass === "hypercorrection"
											? `High-conf miss (${w.confidence}%)`
											: w.outcomeClass === "fragile"
												? `Fragile hit (${w.confidence}%)`
												: "Gap"}
									</span>
								</span>
							))}
						</div>
					)}
				</div>
			)}

			{propositions.length > 0 && (
				<div className="mt-3 border-t border-border/60 pt-2.5">
					<button
						type="button"
						data-testid="wrap-up-propositions-toggle"
						onClick={onTogglePropositions}
						className="flex w-full cursor-pointer items-center gap-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<ChevronRightIcon
							aria-hidden="true"
							className={cn("size-3.5 shrink-0 transition-transform", propositionsOpen && "rotate-90")}
						/>
						<span>
							Extracted propositions ({propositions.length})
						</span>
					</button>
					{propositionsOpen && (
						<div
							data-testid="wrap-up-propositions-list"
							className="mt-2 space-y-1.5 rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-2.5 text-xs"
						>
							{propositions.map((p) => (
								<div key={p.id} className="leading-relaxed">
									<span className="font-medium text-foreground/90">{p.name}</span>
									<span className="text-muted-foreground"> — {p.statement}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function SessionWrapUpCard({
	chatId,
	title,
	tree,
	calibration,
	refreshKey = 0,
}: {
	chatId: string;
	title: string;
	tree: PlanTree;
	calibration?: SessionCalibration;
	refreshKey?: number;
}) {
	const router = useRouter();
	const activity = useActivity();
	const runHere = activity.feed.extractions.some((run) => run.chatId === chatId);

	const [propositions, setPropositions] = useState<WrapUpProposition[]>([]);
	const [coverage, setCoverage] = useState<SessionCoverage | null>(null);
	const [extracting, setExtracting] = useState(false);
	const [startingPractice, setStartingPractice] = useState(false);
	const [propositionsOpen, setPropositionsOpen] = useState(false);
	const starterRef = useRef(new SessionStarter());
	const lastUncoveredRef = useRef<number | null>(null);

	const steps = useMemo(() => topoFor(tree.nodes, tree.edges).order, [tree.nodes, tree.edges]);

	const loadSessionData = useCallback(async () => {
		try {
			const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
			if (!res.ok) return;
			const body = (await res.json()) as {
				coverage?: SessionCoverage | null;
				propositions?: WrapUpProposition[];
			};
			if (Array.isArray(body.propositions)) {
				setPropositions(body.propositions);
			}
			if (body.coverage !== undefined) {
				const next = body.coverage ?? null;
				if (
					next &&
					(next.running ||
						(lastUncoveredRef.current !== null && next.uncoveredTokens !== lastUncoveredRef.current))
				) {
					setExtracting(false);
				}
				lastUncoveredRef.current = next?.uncoveredTokens ?? null;
				setCoverage(next);
			}
		} catch {
			// Best-effort read
		}
	}, [chatId]);

	useEffect(() => {
		void loadSessionData();
	}, [loadSessionData, refreshKey, runHere]);

	useEffect(() => {
		if (coverage?.running !== true && !extracting) return;
		const timer = setInterval(() => void loadSessionData(), 2000);
		return () => clearInterval(timer);
	}, [loadSessionData, coverage?.running, extracting]);

	const handleExtract = async () => {
		setExtracting(true);
		activity.refresh();
		try {
			const res = await fetch("/api/graph/coverage/extract", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ chatId }),
			});
			if (!res.ok && res.status !== 409) {
				setExtracting(false);
			}
		} catch {
			setExtracting(false);
		}
		void loadSessionData();
	};

	const handlePractice = async () => {
		if (startingPractice) return;
		setStartingPractice(true);
		try {
			const stepSummary = steps.map((s) => s.title).join(", ");
			const prompt = `Practice ${title}${stepSummary ? ` (${stepSummary})` : ""}`;
			const target = await starterRef.current.start({
				title: prompt,
				kind: "practice",
				...(propositions.length > 0 ? { graphContext: { propositions } } : {}),
			}, fetch);
			router.push(target);
		} catch {
			setStartingPractice(false);
		}
	};

	const handleFeynman = async () => {
		if (startingPractice) return;
		setStartingPractice(true);
		try {
			const stepSummary = steps.map((s) => s.title).join(", ");
			const prompt = buildFeynmanPrompt(title, stepSummary);
			const target = await starterRef.current.start({
				title: prompt,
				kind: "practice",
				...(propositions.length > 0 ? { graphContext: { propositions } } : {}),
			}, fetch);
			router.push(target);
		} catch {
			setStartingPractice(false);
		}
	};

	const handleRepairWeakSpots = async () => {
		if (startingPractice || !calibration) return;
		setStartingPractice(true);
		try {
			const prompt = buildWeakSpotRepairPrompt(title, calibration);
			const target = await starterRef.current.start({
				title: prompt,
				kind: "practice",
				...(propositions.length > 0 ? { graphContext: { propositions } } : {}),
			}, fetch);
			router.push(target);
		} catch {
			setStartingPractice(false);
		}
	};

	return (
		<SessionWrapUpBody
			steps={steps}
			propositions={propositions}
			calibration={calibration}
			uncoveredCount={coverage?.uncoveredCount ?? 0}
			extracting={Boolean(coverage?.running || extracting)}
			startingPractice={startingPractice}
			propositionsOpen={propositionsOpen}
			onTogglePropositions={() => setPropositionsOpen((v) => !v)}
			onPractice={() => void handlePractice()}
			onFeynman={() => void handleFeynman()}
			onRepairWeakSpots={() => void handleRepairWeakSpots()}
			onExtract={() => void handleExtract()}
		/>
	);
}
