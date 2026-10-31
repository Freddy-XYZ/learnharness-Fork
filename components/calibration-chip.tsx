"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, GaugeIcon, WrenchIcon } from "lucide-react";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { Hint } from "@/components/ui/hint";
import { SessionStarter } from "@/components/start-session";
import {
	buildWeakSpotRepairPrompt,
	type SessionCalibration,
} from "@/src/core";

export function formatCalibrationStatusLabel(calibration: SessionCalibration): string {
	if (calibration.calibrationGapPct === null) {
		return `${calibration.accuracyPct}% accuracy`;
	}
	const gap = calibration.calibrationGapPct;
	const signed = gap > 0 ? `+${gap}%` : `${gap}%`;
	if (calibration.calibrationState === "overconfident") {
		return `Overconfident (${signed})`;
	}
	if (calibration.calibrationState === "underconfident") {
		return `Underconfident (${signed})`;
	}
	return `Well calibrated (${signed})`;
}

export function CalibrationChip({
	chatId,
	title,
	calibration,
}: {
	chatId: string;
	title: string;
	calibration: SessionCalibration;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [startingRepair, setStartingRepair] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const starterRef = useRef(new SessionStarter());
	usePopoverDismiss(rootRef, open, () => setOpen(false));

	if (calibration.totalChecks === 0) return null;

	const handleRepair = async () => {
		if (startingRepair) return;
		setStartingRepair(true);
		try {
			let propositions: { id: string; name: string; statement: string }[] = [];
			const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
			if (res.ok) {
				const body = (await res.json()) as {
					propositions?: { id: string; name: string; statement: string }[];
				};
				if (Array.isArray(body.propositions)) {
					propositions = body.propositions;
				}
			}
			const prompt = buildWeakSpotRepairPrompt(title, calibration);
			const target = await starterRef.current.start({
				title: prompt,
				kind: "practice",
				...(propositions.length > 0 ? { graphContext: { propositions } } : {}),
			}, fetch);
			setOpen(false);
			router.push(target);
		} catch {
			setStartingRepair(false);
		}
	};

	const weakCount = calibration.weakSpots.length;

	return (
		<div ref={rootRef} className="lh-no-drag relative shrink-0">
			<Hint label="Metacognitive calibration & weak spots" side="bottom">
				<button
					type="button"
					data-testid="calibration-chip"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground"
				>
					<GaugeIcon className="size-3.5 text-primary" aria-hidden="true" />
					<span className="tabular-nums">{calibration.accuracyPct}%</span>
					{calibration.hypercorrections.length > 0 && (
						<AlertTriangleIcon className="size-3 text-amber-500" aria-hidden="true" />
					)}
				</button>
			</Hint>
			{open && (
				<div
					data-testid="calibration-popover"
					className="absolute top-full right-0 z-40 mt-1.5 w-80 rounded-xl border bg-card p-3.5 text-xs shadow-xl"
				>
					<div className="mb-2 flex items-center justify-between">
						<span className="font-medium uppercase tracking-wide text-muted-foreground">
							Calibration
						</span>
						<span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground">
							{formatCalibrationStatusLabel(calibration)}
						</span>
					</div>
					<div className="space-y-1 text-muted-foreground">
						<div className="flex justify-between">
							<span>Check accuracy</span>
							<span className="tabular-nums text-card-foreground">
								{calibration.accuracyPct}% ({calibration.totalChecks}{" "}
								{calibration.totalChecks === 1 ? "check" : "checks"})
							</span>
						</div>
						{calibration.meanConfidencePct !== null && (
							<div className="flex justify-between">
								<span>Mean confidence</span>
								<span className="tabular-nums text-card-foreground">
									{calibration.meanConfidencePct}%
								</span>
							</div>
						)}
						{calibration.predictCount > 0 && (
							<div className="flex justify-between">
								<span>Predictions made</span>
								<span className="tabular-nums text-card-foreground">
									{calibration.predictCount}
								</span>
							</div>
						)}
					</div>

					{weakCount > 0 ? (
						<div className="mt-3 border-t border-border/60 pt-2.5">
							<div className="mb-1.5 text-[11px] font-medium text-foreground">
								Weak spots ({weakCount})
							</div>
							<div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
								{calibration.weakSpots.map((item, idx) => (
									<div
										key={idx}
										className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
									>
										<div className="flex items-center justify-between gap-1">
											<span className="font-medium text-foreground">
												{item.nodeTitle ?? "Check"}
											</span>
											<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
												{item.outcomeClass === "hypercorrection"
													? `High-conf miss (${item.confidence}%)`
													: item.outcomeClass === "fragile"
														? `Fragile hit (${item.confidence}%)`
														: "Gap"}
											</span>
										</div>
										<div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
											{item.question}
										</div>
									</div>
								))}
							</div>
							<button
								type="button"
								data-testid="calibration-repair-cta"
								onClick={() => void handleRepair()}
								disabled={startingRepair}
								className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								<WrenchIcon className="size-3.5" aria-hidden="true" />
								{startingRepair
									? "Starting repair…"
									: `Repair weak spots (${weakCount})`}
							</button>
						</div>
					) : (
						<div className="mt-2.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
							All checks answered with solid confidence — no weak spots flagged.
						</div>
					)}
				</div>
			)}
		</div>
	);
}
