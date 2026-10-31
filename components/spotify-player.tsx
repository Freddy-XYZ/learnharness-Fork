"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	Disc3Icon,
	ListMusicIcon,
	Music2Icon,
	PauseIcon,
	PlayIcon,
	RadioIcon,
	SearchIcon,
	SettingsIcon,
	SkipBackIcon,
	SkipForwardIcon,
	Volume2Icon,
	VolumeXIcon,
} from "lucide-react";
import {
	clampSpotifyVolume,
	formatTrackTime,
	SPOTIFY_CLIENT_ID_KEY,
	type SpotifyAuthStatus,
	type SpotifyPlaybackState,
	type SpotifyPlaylistSummary,
	type SpotifyTrack,
} from "@/src/core";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { useSettingsSaved } from "@/components/settings-signal";

export type SpotifyPlayerTab = "now" | "playlists" | "search";

export interface SpotifyPlayerBodyProps {
	status: SpotifyAuthStatus;
	expanded: boolean;
	activeTab: SpotifyPlayerTab;
	playback: SpotifyPlaybackState | null;
	inAppDeviceId: string | null;
	playlists: readonly SpotifyPlaylistSummary[];
	searchQuery: string;
	searchResults: readonly SpotifyTrack[];
	searching: boolean;
	error: string | null;
	onToggleExpand: () => void;
	onSelectTab: (tab: SpotifyPlayerTab) => void;
	onPlayPause: () => void;
	onNext: () => void;
	onPrevious: () => void;
	onVolumeChange: (volumePercent: number) => void;
	onSeek: (positionMs: number) => void;
	onPlayUri: (target: { uri?: string; contextUri?: string }) => void;
	onTransferToInApp: () => void;
	onSearchQueryChange: (q: string) => void;
	onSearchSubmit: () => void;
	onOpenSettings: () => void;
	onConnectSpotify: () => void;
}

export function SpotifyPlayerBody({
	status,
	expanded,
	activeTab,
	playback,
	inAppDeviceId,
	playlists,
	searchQuery,
	searchResults,
	searching,
	error,
	onToggleExpand,
	onSelectTab,
	onPlayPause,
	onNext,
	onPrevious,
	onVolumeChange,
	onSeek,
	onPlayUri,
	onTransferToInApp,
	onSearchQueryChange,
	onSearchSubmit,
	onOpenSettings,
	onConnectSpotify,
}: SpotifyPlayerBodyProps) {
	const track = playback?.track ?? null;
	const isPlaying = Boolean(playback?.isPlaying);
	const volumePercent = playback?.volumePercent ?? 70;
	const progressMs = playback?.progressMs ?? 0;
	const durationMs = track?.durationMs ?? 0;
	const isStreamingInApp = Boolean(inAppDeviceId && playback?.deviceId === inAppDeviceId);

	if (!expanded) {
		return (
			<div
				data-testid="spotify-player-pill"
				className="lh-no-drag fixed right-3 bottom-3 z-40 flex max-w-[136px] items-center gap-1.5 rounded-full border border-border/80 bg-card/95 px-2 py-1 text-xs shadow-lg backdrop-blur-md transition-all hover:border-border"
			>
				{status.connected ? (
					<>
						<button
							type="button"
							onClick={onToggleExpand}
							data-testid="spotify-pill-expand"
							className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
							title="Spotify Mini-Player öffnen"
						>
							{track?.albumArtUrl ? (
								<img
									src={track.albumArtUrl}
									alt={track.album || track.name}
									className="size-5 shrink-0 rounded-full object-cover"
								/>
							) : (
								<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
									<Disc3Icon className={`size-3 ${isPlaying ? "animate-spin" : ""}`} />
								</span>
							)}
							<span className="max-w-[68px] truncate font-ui text-[11px] text-foreground">
								{track ? track.name : "Spotify"}
							</span>
						</button>
						<button
							type="button"
							onClick={onPlayPause}
							data-testid="spotify-pill-play-pause"
							aria-label={isPlaying ? "Pause" : "Play"}
							className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 transition-colors hover:bg-emerald-500/25"
						>
							{isPlaying ? <PauseIcon className="size-2.5" /> : <PlayIcon className="size-2.5 translate-x-[0.5px]" />}
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={status.clientIdPresent ? onToggleExpand : onOpenSettings}
						data-testid="spotify-pill-setup"
						className="flex items-center gap-1.5 px-1 py-0.5 font-ui text-[11px] text-muted-foreground transition-colors hover:text-foreground"
						title="Spotify verbinden"
					>
						<Music2Icon className="size-3.5 text-emerald-400" />
						<span>Spotify</span>
					</button>
				)}
			</div>
		);
	}

	return (
		<div
			data-testid="spotify-player-panel"
			className="lh-no-drag fixed right-3 bottom-3 max-xl:bottom-28 z-40 flex w-52 flex-col gap-2.5 rounded-2xl border border-border bg-card/95 p-3 text-xs shadow-2xl backdrop-blur-md"
		>
			{/* Header */}
			<div className="flex items-center justify-between gap-1.5 border-b border-border/60 pb-1.5">
				<div className="flex min-w-0 items-center gap-1">
					<Music2Icon className="size-3 shrink-0 text-emerald-400" />
					<span className="truncate font-mono text-[10px] font-medium tracking-wide text-foreground uppercase">
						Spotify
					</span>
					{status.connected && (
						<span
							data-testid="spotify-device-badge"
							className="max-w-[68px] truncate rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-400"
						>
							{isStreamingInApp
								? "In-App"
								: playback?.deviceName
									? playback.deviceName
									: "Bereit"}
						</span>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					{status.connected && inAppDeviceId && !isStreamingInApp && (
						<button
							type="button"
							onClick={onTransferToInApp}
							data-testid="spotify-transfer-btn"
							title="Hier in der App streamen"
							className="flex items-center gap-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.5 font-mono text-[9px] text-emerald-400 transition-colors hover:bg-emerald-500/20"
						>
							<RadioIcon className="size-2.5" />
							<span>Hier</span>
						</button>
					)}
					<button
						type="button"
						onClick={onOpenSettings}
						data-testid="spotify-panel-settings"
						aria-label="Spotify Einstellungen"
						title="Spotify Einstellungen"
						className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<SettingsIcon className="size-3" />
					</button>
					<button
						type="button"
						onClick={onToggleExpand}
						data-testid="spotify-panel-collapse"
						aria-label="Player einklappen"
						title="Player einklappen"
						className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<ChevronDownIcon className="size-3.5" />
					</button>
				</div>
			</div>

			{!status.connected ? (
				<div data-testid="spotify-unconnected-view" className="flex flex-col items-center gap-2 py-2 text-center">
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{status.clientIdPresent
							? "Verbinde dein Spotify-Konto zum Streamen."
							: "Trage deine Spotify Client ID in den Einstellungen ein."}
					</p>
					{status.clientIdPresent ? (
						<button
							type="button"
							onClick={onConnectSpotify}
							data-testid="spotify-panel-connect-btn"
							className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 font-mono text-[11px] text-emerald-400 transition-colors hover:bg-emerald-500/25"
						>
							Spotify verbinden
						</button>
					) : (
						<button
							type="button"
							onClick={onOpenSettings}
							data-testid="spotify-panel-open-settings-btn"
							className="w-full rounded-lg border border-border bg-accent/60 px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
						>
							Einstellungen öffnen
						</button>
					)}
				</div>
			) : (
				<>
					{/* Current Track Info */}
					<div className="flex items-center gap-2.5">
						{track?.albumArtUrl ? (
							<img
								src={track.albumArtUrl}
								alt={track.album || track.name}
								className="size-10 shrink-0 rounded-lg border border-border/60 object-cover"
							/>
						) : (
							<div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-accent/40 text-emerald-400">
								<Disc3Icon className={`size-5 ${isPlaying ? "animate-spin" : ""}`} />
							</div>
						)}
						<div className="min-w-0 flex-1">
							<p data-testid="spotify-track-title" className="truncate font-ui text-xs font-medium text-foreground">
								{track ? track.name : "Kein aktiver Song"}
							</p>
							<p data-testid="spotify-track-artist" className="truncate text-[10px] text-muted-foreground">
								{track ? track.artists : "Playlist oder Song wählen"}
							</p>
						</div>
					</div>

					{/* Progress / Seek Bar */}
					<div className="flex flex-col gap-0.5">
						<input
							type="range"
							min={0}
							max={Math.max(durationMs, 1)}
							value={Math.min(progressMs, Math.max(durationMs, 1))}
							disabled={!track}
							onChange={(e) => onSeek(Number(e.target.value))}
							aria-label="Song-Fortschritt"
							data-testid="spotify-seek-slider"
							className="h-1 w-full cursor-pointer accent-emerald-400 disabled:cursor-default disabled:opacity-40"
						/>
						<div className="flex justify-between font-mono text-[9px] text-muted-foreground">
							<span data-testid="spotify-time-elapsed">{formatTrackTime(progressMs)}</span>
							<span data-testid="spotify-time-duration">{formatTrackTime(durationMs)}</span>
						</div>
					</div>

					{/* Transport Controls (Prev / Play-Pause / Next) */}
					<div className="flex items-center justify-center gap-3">
						<button
							type="button"
							onClick={onPrevious}
							data-testid="spotify-prev-btn"
							aria-label="Vorheriger Song"
							className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<SkipBackIcon className="size-3.5" />
						</button>
						<button
							type="button"
							onClick={onPlayPause}
							data-testid="spotify-play-pause-btn"
							aria-label={isPlaying ? "Pause" : "Abspielen"}
							className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-black shadow-sm transition-transform hover:scale-105"
						>
							{isPlaying ? (
								<PauseIcon className="size-3.5 fill-current" />
							) : (
								<PlayIcon className="size-3.5 translate-x-[0.5px] fill-current" />
							)}
						</button>
						<button
							type="button"
							onClick={onNext}
							data-testid="spotify-next-btn"
							aria-label="Nächster Song"
							className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<SkipForwardIcon className="size-3.5" />
						</button>
					</div>

					{/* Dedicated Full-Width Volume Row */}
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => onVolumeChange(volumePercent > 0 ? 0 : 70)}
							data-testid="spotify-mute-btn"
							aria-label={volumePercent === 0 ? "Stummschaltung aufheben" : "Stummschalten"}
							className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
						>
							{volumePercent === 0 ? (
								<VolumeXIcon className="size-3" />
							) : (
								<Volume2Icon className="size-3" />
							)}
						</button>
						<input
							type="range"
							min={0}
							max={100}
							value={clampSpotifyVolume(volumePercent)}
							onChange={(e) => onVolumeChange(Number(e.target.value))}
							aria-label="Lautstärke"
							data-testid="spotify-volume-slider"
							className="h-1 min-w-0 flex-1 cursor-pointer accent-emerald-400"
						/>
						<span data-testid="spotify-volume-label" className="w-7 shrink-0 text-right font-mono text-[9px] text-muted-foreground">
							{clampSpotifyVolume(volumePercent)}%
						</span>
					</div>

					{/* Navigation Tabs */}
					<div className="flex items-center gap-1 border-t border-border/60 pt-2">
						<button
							type="button"
							onClick={() => onSelectTab(activeTab === "playlists" ? "now" : "playlists")}
							data-testid="spotify-tab-playlists"
							className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 font-mono text-[11px] transition-colors ${
								activeTab === "playlists"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
							}`}
						>
							<ListMusicIcon className="size-3" />
							<span>Playlists</span>
						</button>
						<button
							type="button"
							onClick={() => onSelectTab(activeTab === "search" ? "now" : "search")}
							data-testid="spotify-tab-search"
							className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 font-mono text-[11px] transition-colors ${
								activeTab === "search"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
							}`}
						>
							<SearchIcon className="size-3" />
							<span>Suche</span>
						</button>
					</div>

					{/* Playlists Drawer */}
					{activeTab === "playlists" && (
						<div
							data-testid="spotify-playlists-drawer"
							className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-1.5"
						>
							{playlists.length === 0 ? (
								<p className="py-3 text-center text-[11px] text-muted-foreground">
									Keine Playlists gefunden.
								</p>
							) : (
								playlists.map((pl) => (
									<button
										key={pl.id}
										type="button"
										onClick={() => onPlayUri({ contextUri: pl.uri })}
										data-testid={`spotify-playlist-${pl.id}`}
										className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
									>
										<span className="truncate font-ui text-xs text-foreground">{pl.name}</span>
										<span className="shrink-0 font-mono text-[10px] text-muted-foreground">
											{pl.trackCount}
										</span>
									</button>
								))
							)}
						</div>
					)}

					{/* Search Drawer */}
					{activeTab === "search" && (
						<div
							data-testid="spotify-search-drawer"
							className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-2"
						>
							<div className="flex items-center gap-1.5">
								<input
									type="text"
									value={searchQuery}
									onChange={(e) => onSearchQueryChange(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") onSearchSubmit();
									}}
									placeholder="Song oder Künstler suchen…"
									aria-label="Spotify Suche"
									data-testid="spotify-search-input"
									className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-ui text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-emerald-500/50"
								/>
								<button
									type="button"
									onClick={onSearchSubmit}
									disabled={searching || !searchQuery.trim()}
									data-testid="spotify-search-submit"
									className="rounded-md bg-emerald-500/15 px-2 py-1 font-mono text-[11px] text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
								>
									Los
								</button>
							</div>
							<div className="max-h-36 space-y-1 overflow-y-auto">
								{searching ? (
									<p className="py-2 text-center text-[11px] text-muted-foreground">Suche läuft…</p>
								) : searchResults.length === 0 ? (
									<p className="py-2 text-center text-[11px] text-muted-foreground">
										{searchQuery.trim() ? "Keine Treffer." : "Suchbegriff eingeben & Enter drücken."}
									</p>
								) : (
									searchResults.map((item) => (
										<button
											key={item.id}
											type="button"
											onClick={() => onPlayUri({ uri: item.uri })}
											data-testid={`spotify-search-result-${item.id}`}
											className="flex w-full flex-col rounded-md px-2 py-1 text-left transition-colors hover:bg-accent"
										>
											<span className="truncate font-ui text-xs text-foreground">{item.name}</span>
											<span className="truncate text-[10px] text-muted-foreground">{item.artists}</span>
										</button>
									))
								)}
							</div>
						</div>
					)}

					{error && (
						<p role="alert" data-testid="spotify-player-error" className="text-[11px] text-red-400">
							{error}
						</p>
					)}
				</>
			)}
		</div>
	);
}

interface SpotifyWebPlaybackPlayer {
	connect: () => Promise<boolean>;
	disconnect: () => void;
	addListener: (event: string, cb: (payload: unknown) => void) => void;
	activateElement?: () => Promise<void>;
	togglePlay: () => Promise<void>;
	nextTrack: () => Promise<void>;
	previousTrack: () => Promise<void>;
	seek: (posMs: number) => Promise<void>;
	setVolume: (fraction: number) => Promise<void>;
}

declare global {
	interface Window {
		onSpotifyWebPlaybackSDKReady?: () => void;
		Spotify?: {
			Player: new (opts: {
				name: string;
				getOAuthToken: (cb: (token: string) => void) => void;
				volume?: number;
			}) => SpotifyWebPlaybackPlayer;
		};
	}
}

export function SpotifyFloatingPlayer() {
	const { open: openSettings } = useSettingsDialog();
	const [status, setStatus] = useState<SpotifyAuthStatus>({
		clientIdPresent: false,
		connected: false,
		displayName: null,
	});
	const [expanded, setExpanded] = useState(false);
	const [activeTab, setActiveTab] = useState<SpotifyPlayerTab>("now");
	const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
	const [inAppDeviceId, setInAppDeviceId] = useState<string | null>(null);
	const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sdkPlayerRef = useRef<SpotifyWebPlaybackPlayer | null>(null);
	const inAppDeviceIdRef = useRef<string | null>(null);
	const commandSeqRef = useRef(0);
	const lastMutationAtRef = useRef(0);
	const lastVolumeEditAtRef = useRef(0);
	const lastSeekEditAtRef = useRef(0);
	const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const applyIncomingPlayback = useCallback((incoming: SpotifyPlaybackState) => {
		const now = Date.now();
		const preferInApp = Boolean(inAppDeviceIdRef.current && (!incoming.isPlaying || incoming.deviceId === "mac-spotify-app"));
		setPlayback((prev) => ({
			...incoming,
			deviceId: preferInApp ? inAppDeviceIdRef.current : incoming.deviceId,
			deviceName: preferInApp ? "LearnHarness Player" : incoming.deviceName,
			// Never snap the volume slider back while the user is adjusting volume
			volumePercent:
				prev && now - lastVolumeEditAtRef.current < 3000
					? prev.volumePercent
					: incoming.volumePercent,
			// Never snap the seek slider back while the user is scrubbing
			progressMs:
				prev && now - lastSeekEditAtRef.current < 2000
					? prev.progressMs
					: incoming.progressMs,
		}));
	}, []);

	const loadStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/spotify/status");
			if (!res.ok) return;
			const data = (await res.json()) as { status?: SpotifyAuthStatus };
			if (data.status) setStatus(data.status);
		} catch {
			/* ignore offline status fetch */
		}
	}, []);

	const refreshPlayback = useCallback(async () => {
		if (Date.now() - lastMutationAtRef.current < 1500) return;
		const seqAtStart = commandSeqRef.current;
		try {
			const res = await fetch("/api/spotify/player");
			if (!res.ok) return;
			const data = (await res.json()) as { playback?: SpotifyPlaybackState | null };
			if (seqAtStart !== commandSeqRef.current) return;
			if (Date.now() - lastMutationAtRef.current < 1500) return;
			if (data.playback) applyIncomingPlayback(data.playback);
		} catch {
			/* ignore */
		}
	}, [applyIncomingPlayback]);

	useEffect(() => {
		void loadStatus();
		const onMessage = (e: MessageEvent) => {
			if (e.data && typeof e.data === "object" && (e.data as { type?: unknown }).type === "lh:spotify-connected") {
				void loadStatus();
				void refreshPlayback();
			}
		};
		const onFocus = () => {
			void loadStatus();
		};
		window.addEventListener("message", onMessage);
		window.addEventListener("focus", onFocus);
		return () => {
			window.removeEventListener("message", onMessage);
			window.removeEventListener("focus", onFocus);
		};
	}, [loadStatus, refreshPlayback]);

	useSettingsSaved((section) => {
		if (section === "keys") {
			void loadStatus();
		}
	});

	// Initialize Spotify Web Playback SDK when connected
	useEffect(() => {
		if (!status.connected) {
			if (sdkPlayerRef.current) {
				sdkPlayerRef.current.disconnect();
				sdkPlayerRef.current = null;
			}
			setInAppDeviceId(null);
			setPlayback(null);
			return;
		}

		void refreshPlayback();

		const initPlayer = () => {
			if (!window.Spotify || sdkPlayerRef.current) return;
			const player = new window.Spotify.Player({
				name: "LearnHarness Player",
				getOAuthToken: (cb) => {
					void fetch("/api/spotify/status")
						.then((r) => r.json())
						.then((d: { accessToken?: string | null }) => {
							if (d.accessToken) cb(d.accessToken);
						})
						.catch(() => undefined);
				},
				volume: 0.7,
			});

			player.addListener("ready", (payload) => {
				const devId = (payload as { device_id?: string })?.device_id;
				if (devId) {
					inAppDeviceIdRef.current = devId;
					setInAppDeviceId(devId);
					setPlayback((prev) =>
						prev
							? { ...prev, deviceId: devId, deviceName: "LearnHarness Player" }
							: {
									isPlaying: false,
									progressMs: 0,
									volumePercent: 70,
									deviceName: "LearnHarness Player",
									deviceId: devId,
									track: null,
								},
					);
					// Automatically make the in-page Web Playback SDK the active target device
					void fetch("/api/spotify/player", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ action: "transferDevice", deviceId: devId, play: false }),
					}).catch(() => undefined);
				}
			});

			player.addListener("player_state_changed", (stateRaw) => {
				if (!stateRaw || typeof stateRaw !== "object") return;
				const st = stateRaw as {
					paused?: boolean;
					position?: number;
					duration?: number;
					track_window?: {
						current_track?: {
							id?: string;
							name?: string;
							uri?: string;
							artists?: Array<{ name?: string }>;
							album?: { name?: string; images?: Array<{ url?: string }> };
						};
					};
				};
				const current = st.track_window?.current_track;
				setPlayback((prev) => ({
					isPlaying: !st.paused,
					progressMs: typeof st.position === "number" ? st.position : 0,
					volumePercent: prev?.volumePercent ?? 70,
					deviceName: "LearnHarness Player",
					deviceId: inAppDeviceIdRef.current ?? prev?.deviceId ?? null,
					track: current?.id
						? {
								id: current.id,
								name: current.name ?? "Track",
								artists: (current.artists ?? []).map((a) => a.name).filter(Boolean).join(", "),
								album: current.album?.name ?? "",
								albumArtUrl: current.album?.images?.[0]?.url ?? null,
								durationMs: typeof st.duration === "number" ? st.duration : 0,
								uri: current.uri ?? `spotify:track:${current.id}`,
							}
						: (prev?.track ?? null),
				}));
			});

			void player.connect();
			sdkPlayerRef.current = player;
		};

		if (window.Spotify) {
			initPlayer();
		} else {
			window.onSpotifyWebPlaybackSDKReady = initPlayer;
			if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
				const script = document.createElement("script");
				script.src = "https://sdk.scdn.co/spotify-player.js";
				script.async = true;
				document.body.appendChild(script);
			}
		}
	}, [status.connected, refreshPlayback]);

	// Periodic playback sync while connected
	useEffect(() => {
		if (!status.connected) return;
		const timer = setInterval(() => {
			if (expanded || playback?.isPlaying) {
				void refreshPlayback();
			}
		}, 5000);
		return () => clearInterval(timer);
	}, [status.connected, expanded, playback?.isPlaying, refreshPlayback]);

	// Smooth local progress tick while playing
	useEffect(() => {
		if (!playback?.isPlaying || !playback.track) return;
		const timer = setInterval(() => {
			setPlayback((prev) => {
				if (!prev || !prev.isPlaying || !prev.track) return prev;
				const nextPos = Math.min(prev.progressMs + 1000, prev.track.durationMs);
				return { ...prev, progressMs: nextPos };
			});
		}, 1000);
		return () => clearInterval(timer);
	}, [playback?.isPlaying, playback?.track]);

	// Load playlists when switching to playlists tab
	useEffect(() => {
		if (!status.connected || activeTab !== "playlists") return;
		void fetch("/api/spotify/player?view=playlists")
			.then((r) => r.json())
			.then((d: { playlists?: SpotifyPlaylistSummary[] }) => {
				if (d.playlists) setPlaylists(d.playlists);
			})
			.catch(() => undefined);
	}, [status.connected, activeTab]);

	const sendCommand = async (body: Record<string, unknown>, opts?: { ignorePlaybackResponse?: boolean }) => {
		const seq = ++commandSeqRef.current;
		lastMutationAtRef.current = Date.now();
		setError(null);
		try {
			const res = await fetch("/api/spotify/player", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				error?: string;
				playback?: SpotifyPlaybackState | null;
			};
			if (seq !== commandSeqRef.current) return;
			if (!res.ok || !data.ok) {
				setError(data.error ?? "Spotify-Befehl fehlgeschlagen.");
			} else if (data.playback && !opts?.ignorePlaybackResponse) {
				applyIncomingPlayback(data.playback);
			}
		} catch {
			if (seq === commandSeqRef.current) {
				setError("Netzwerkfehler bei Spotify-Steuerung.");
			}
		}
	};

	const handlePlayPause = () => {
		void sdkPlayerRef.current?.activateElement?.();
		const nextAction = playback?.isPlaying ? "pause" : "play";
		lastMutationAtRef.current = Date.now();
		setPlayback((prev) => (prev ? { ...prev, isPlaying: !prev.isPlaying } : prev));
		if (sdkPlayerRef.current && inAppDeviceId && playback?.deviceId === inAppDeviceId && playback.track) {
			void sdkPlayerRef.current.togglePlay();
			return;
		}
		void sendCommand({
			action: nextAction,
			deviceId: inAppDeviceId ?? playback?.deviceId ?? undefined,
		});
	};

	const handleNext = () => {
		void sdkPlayerRef.current?.activateElement?.();
		lastMutationAtRef.current = Date.now();
		if (sdkPlayerRef.current && inAppDeviceId && playback?.deviceId === inAppDeviceId && playback.track) {
			void sdkPlayerRef.current.nextTrack();
			return;
		}
		void sendCommand({ action: "next", deviceId: inAppDeviceId ?? playback?.deviceId ?? undefined });
	};

	const handlePrevious = () => {
		void sdkPlayerRef.current?.activateElement?.();
		lastMutationAtRef.current = Date.now();
		if (sdkPlayerRef.current && inAppDeviceId && playback?.deviceId === inAppDeviceId && playback.track) {
			void sdkPlayerRef.current.previousTrack();
			return;
		}
		void sendCommand({ action: "previous", deviceId: inAppDeviceId ?? playback?.deviceId ?? undefined });
	};

	const handleVolumeChange = (vol: number) => {
		const clamped = clampSpotifyVolume(vol);
		lastVolumeEditAtRef.current = Date.now();
		lastMutationAtRef.current = Date.now();
		setPlayback((prev) =>
			prev
				? { ...prev, volumePercent: clamped }
				: {
						isPlaying: false,
						progressMs: 0,
						volumePercent: clamped,
						deviceName: null,
						deviceId: inAppDeviceId,
						track: null,
					},
		);
		if (sdkPlayerRef.current) {
			void sdkPlayerRef.current.setVolume(clamped / 100);
		}
		if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
		const targetDeviceId = inAppDeviceId ?? playback?.deviceId ?? undefined;
		volumeTimerRef.current = setTimeout(() => {
			void sendCommand(
				{
					action: "volume",
					volumePercent: clamped,
					deviceId: targetDeviceId,
				},
				{ ignorePlaybackResponse: true },
			);
		}, 90);
	};

	const handleSeek = (positionMs: number) => {
		const clampedPos = Math.max(0, Math.round(positionMs));
		lastSeekEditAtRef.current = Date.now();
		lastMutationAtRef.current = Date.now();
		setPlayback((prev) => (prev ? { ...prev, progressMs: clampedPos } : prev));
		if (sdkPlayerRef.current && inAppDeviceId && playback?.deviceId === inAppDeviceId) {
			void sdkPlayerRef.current.seek(clampedPos);
		}
		if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
		const targetDeviceId = inAppDeviceId ?? playback?.deviceId ?? undefined;
		seekTimerRef.current = setTimeout(() => {
			void sendCommand(
				{
					action: "seek",
					positionMs: clampedPos,
					deviceId: targetDeviceId,
				},
				{ ignorePlaybackResponse: true },
			);
		}, 120);
	};

	const handlePlayUri = (target: { uri?: string; contextUri?: string }) => {
		void sdkPlayerRef.current?.activateElement?.();
		void sendCommand({
			action: "playUri",
			...target,
			deviceId: inAppDeviceId ?? playback?.deviceId ?? undefined,
		});
	};

	const handleTransferToInApp = () => {
		if (!inAppDeviceId) return;
		void sendCommand({ action: "transferDevice", deviceId: inAppDeviceId });
	};

	const handleSearchSubmit = async () => {
		if (!searchQuery.trim()) return;
		setSearching(true);
		setError(null);
		try {
			const res = await fetch(`/api/spotify/player?q=${encodeURIComponent(searchQuery.trim())}`);
			const data = (await res.json()) as { tracks?: SpotifyTrack[] };
			setSearchResults(data.tracks ?? []);
		} catch {
			setError("Suche fehlgeschlagen.");
		} finally {
			setSearching(false);
		}
	};

	const handleConnectSpotify = async () => {
		setError(null);
		try {
			const res = await fetch("/api/spotify/status", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "login" }),
			});
			const data = (await res.json()) as { ok?: boolean; authorizeUrl?: string; error?: string };
			if (data.authorizeUrl) {
				window.open(data.authorizeUrl, "lh-spotify-auth", "width=520,height=720");
			} else {
				setError(data.error ?? "Verbindung fehlgeschlagen.");
			}
		} catch {
			setError("Verbindung fehlgeschlagen.");
		}
	};

	return (
		<SpotifyPlayerBody
			status={status}
			expanded={expanded}
			activeTab={activeTab}
			playback={playback}
			inAppDeviceId={inAppDeviceId}
			playlists={playlists}
			searchQuery={searchQuery}
			searchResults={searchResults}
			searching={searching}
			error={error}
			onToggleExpand={() => setExpanded((v) => !v)}
			onSelectTab={setActiveTab}
			onPlayPause={handlePlayPause}
			onNext={handleNext}
			onPrevious={handlePrevious}
			onVolumeChange={handleVolumeChange}
			onSeek={handleSeek}
			onPlayUri={handlePlayUri}
			onTransferToInApp={handleTransferToInApp}
			onSearchQueryChange={setSearchQuery}
			onSearchSubmit={() => void handleSearchSubmit()}
			onOpenSettings={() => openSettings("keys", SPOTIFY_CLIENT_ID_KEY)}
			onConnectSpotify={() => void handleConnectSpotify()}
		/>
	);
}
