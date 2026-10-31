/**
 * Server-side Spotify OAuth 2.0 (Authorization Code with PKCE) + Web API proxy
 * with automatic Spotify Connect device discovery and macOS Spotify.app bridge fallback.
 *
 * - Client ID comes from `keyValue("SPOTIFY_CLIENT_ID")` (configured in Settings -> Providers).
 * - OAuth tokens + pending PKCE verifier live in `<PATHS.data>/spotify-auth.json` (mode 0600).
 * - Automatically refreshes access tokens using the stored `refresh_token`.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PATHS } from "../../config.ts";
import {
	buildSpotifyAuthorizeUrl,
	buildSpotifyRedirectUri,
	clampSpotifyVolume,
	SPOTIFY_CLIENT_ID_KEY,
	type SpotifyAuthStatus,
	type SpotifyPlaybackState,
	type SpotifyPlaylistSummary,
	type SpotifyTrack,
} from "../core/spotify.ts";
import { keyValue } from "./keys.ts";

const execFileAsync = promisify(execFile);

interface StoredSpotifyRecord {
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	displayName?: string | null;
	email?: string | null;
	product?: string | null;
	pendingPkce?: {
		codeVerifier: string;
		state: string;
		redirectUri: string;
		createdAt: number;
	};
}

function spotifyStorePath(): string {
	const dir = process.env.LH_DATA_DIR ? path.resolve(process.env.LH_DATA_DIR) : PATHS.data;
	return path.join(dir, "spotify-auth.json");
}

function readSpotifyRecord(): StoredSpotifyRecord {
	try {
		const raw = JSON.parse(fs.readFileSync(spotifyStorePath(), "utf-8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return raw as StoredSpotifyRecord;
	} catch {
		return {};
	}
}

function writeSpotifyRecord(record: StoredSpotifyRecord): void {
	const file = spotifyStorePath();
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `.spotify-auth.json.tmp-${process.pid}-${Date.now()}`);
	fs.writeFileSync(tmp, `${JSON.stringify(record, null, "\t")}\n`, { mode: 0o600 });
	fs.chmodSync(tmp, 0o600);
	fs.renameSync(tmp, file);
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = crypto.randomBytes(48).toString("base64url");
	const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
	return { codeVerifier, codeChallenge };
}

export function getSpotifyClientId(): string | undefined {
	const val = keyValue(SPOTIFY_CLIENT_ID_KEY)?.trim();
	return val ? val : undefined;
}

export function getSpotifyStatus(): SpotifyAuthStatus {
	const clientId = getSpotifyClientId();
	const rec = readSpotifyRecord();
	const connected = Boolean(clientId && rec.refreshToken && rec.accessToken);
	return {
		clientIdPresent: Boolean(clientId),
		connected,
		displayName: connected ? (rec.displayName ?? "Spotify User") : null,
		email: connected ? (rec.email ?? null) : null,
		product: connected ? (rec.product ?? null) : null,
		expiresAt: connected ? (rec.expiresAt ?? null) : null,
	};
}

export function startSpotifyLogin(origin: string): { ok: true; authorizeUrl: string; redirectUri: string } | { ok: false; error: string } {
	const clientId = getSpotifyClientId();
	if (!clientId) {
		return { ok: false, error: "Please save your SPOTIFY_CLIENT_ID first." };
	}
	const redirectUri = buildSpotifyRedirectUri(origin);
	const { codeVerifier, codeChallenge } = generatePkcePair();
	const state = crypto.randomBytes(16).toString("base64url");
	const rec = readSpotifyRecord();
	rec.pendingPkce = {
		codeVerifier,
		state,
		redirectUri,
		createdAt: Date.now(),
	};
	writeSpotifyRecord(rec);
	const authorizeUrl = buildSpotifyAuthorizeUrl({
		clientId,
		redirectUri,
		codeChallenge,
		state,
	});
	return { ok: true, authorizeUrl, redirectUri };
}

export async function completeSpotifyCallback(
	code: string,
	state: string,
	origin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const clientId = getSpotifyClientId();
	if (!clientId) {
		return { ok: false, error: "SPOTIFY_CLIENT_ID is not configured." };
	}
	const rec = readSpotifyRecord();
	const pending = rec.pendingPkce;
	if (!pending || pending.state !== state) {
		return { ok: false, error: "Invalid or expired OAuth state. Please try connecting again." };
	}
	const redirectUri = pending.redirectUri || buildSpotifyRedirectUri(origin);
	const body = new URLSearchParams({
		client_id: clientId,
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri,
		code_verifier: pending.codeVerifier,
	});

	const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!tokenRes.ok) {
		const errBody = (await tokenRes.json().catch(() => ({}))) as { error_description?: string; error?: string };
		return {
			ok: false,
			error: errBody.error_description ?? errBody.error ?? `Token exchange failed (${tokenRes.status})`,
		};
	}
	const tokenData = (await tokenRes.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
	const accessToken = tokenData.access_token;
	const refreshToken = tokenData.refresh_token ?? rec.refreshToken;
	const expiresAt = Date.now() + (tokenData.expires_in ?? 3600) * 1000;

	let displayName: string | null = rec.displayName ?? null;
	let email: string | null = rec.email ?? null;
	let product: string | null = rec.product ?? null;

	try {
		const meRes = await fetch("https://api.spotify.com/v1/me", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (meRes.ok) {
			const me = (await meRes.json()) as {
				display_name?: string;
				id?: string;
				email?: string;
				product?: string;
			};
			displayName = me.display_name || me.id || "Spotify User";
			email = me.email ?? null;
			product = me.product ?? null;
		}
	} catch {
		/* ignore profile error if token succeeded */
	}

	writeSpotifyRecord({
		accessToken,
		refreshToken,
		expiresAt,
		displayName,
		email,
		product,
	});
	return { ok: true };
}

export function disconnectSpotify(): void {
	writeSpotifyRecord({});
}

export async function getValidSpotifyAccessToken(): Promise<string | null> {
	const clientId = getSpotifyClientId();
	if (!clientId) return null;
	const rec = readSpotifyRecord();
	if (!rec.accessToken || !rec.refreshToken) return null;

	if (rec.expiresAt && rec.expiresAt - Date.now() > 60_000) {
		return rec.accessToken;
	}

	try {
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: rec.refreshToken,
			client_id: clientId,
		});
		const res = await fetch("https://accounts.spotify.com/api/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});
		if (!res.ok) return rec.accessToken;
		const data = (await res.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};
		if (!data.access_token) return rec.accessToken;
		const updated: StoredSpotifyRecord = {
			...rec,
			accessToken: data.access_token,
			refreshToken: data.refresh_token ?? rec.refreshToken,
			expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		};
		writeSpotifyRecord(updated);
		return updated.accessToken!;
	} catch {
		return rec.accessToken;
	}
}

function mapSpotifyTrackItem(item: Record<string, unknown> | null | undefined): SpotifyTrack | null {
	if (!item || typeof item.id !== "string" || typeof item.name !== "string") return null;
	const artistsRaw = Array.isArray(item.artists) ? item.artists : [];
	const artists = artistsRaw
		.map((a) => (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string" ? (a as { name: string }).name : ""))
		.filter(Boolean)
		.join(", ");
	const albumObj = item.album && typeof item.album === "object" ? (item.album as { name?: string; images?: Array<{ url?: string }> }) : undefined;
	const album = typeof albumObj?.name === "string" ? albumObj.name : "";
	const albumArtUrl = albumObj?.images?.[0]?.url ?? null;
	const durationMs = typeof item.duration_ms === "number" ? item.duration_ms : 0;
	const uri = typeof item.uri === "string" ? item.uri : `spotify:track:${item.id}`;
	return {
		id: item.id,
		name: item.name,
		artists: artists || "Unknown Artist",
		album,
		albumArtUrl,
		durationMs,
		uri,
	};
}

// ─── macOS Spotify.app Local Bridge Fallback ──────────────────────────────
// Standard Electron binaries do not ship Google's proprietary Widevine CDM
// required by the browser Web Playback SDK. When no remote/browser Connect
// device is active, macOS users with Spotify.app installed get zero-config
// playback control + state readback via AppleScript (`osascript`).

function isMacSpotifyAppInstalled(): boolean {
	if (process.platform !== "darwin") return false;
	try {
		return fs.existsSync("/Applications/Spotify.app");
	} catch {
		return false;
	}
}

async function readMacSpotifyState(): Promise<SpotifyPlaybackState | null> {
	if (!isMacSpotifyAppInstalled()) return null;
	const script = `
if application "Spotify" is running then
	tell application "Spotify"
		set pState to player state as string
		if pState is "stopped" then
			return "STOPPED||" & (sound volume as string)
		end if
		set tId to id of current track as string
		set tName to name of current track as string
		set tArtist to artist of current track as string
		set tAlbum to album of current track as string
		set tArt to artwork url of current track as string
		set tDur to duration of current track as string
		set pPos to player position as string
		set sVol to sound volume as string
		return pState & "||" & tId & "||" & tName & "||" & tArtist & "||" & tAlbum & "||" & tArt & "||" & tDur & "||" & pPos & "||" & sVol
	end tell
else
	return "NOT_RUNNING"
end if`;
	try {
		const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 2000 });
		const out = stdout.trim();
		if (!out || out === "NOT_RUNNING") return null;
		const parts = out.split("||");
		if (parts[0] === "STOPPED") {
			return {
				isPlaying: false,
				progressMs: 0,
				volumePercent: clampSpotifyVolume(Number(parts[1] ?? 70)),
				deviceName: "Spotify App (Mac)",
				deviceId: "mac-spotify-app",
				track: null,
			};
		}
		const [pState, rawUri, name, artists, album, albumArtUrl, durRaw, posRaw, volRaw] = parts;
		const durationNum = Number(durRaw?.replace(",", ".") ?? 0);
		// Spotify's AppleScript `duration` is in milliseconds, `player position` is in seconds
		const durationMs = durationNum > 1000 ? Math.round(durationNum) : Math.round(durationNum * 1000);
		const progressMs = Math.round(Number(posRaw?.replace(",", ".") ?? 0) * 1000);
		const volumePercent = clampSpotifyVolume(Number(volRaw ?? 70));
		const uri = rawUri || "spotify:track:local";
		const id = uri.split(":").pop() || "local";
		return {
			isPlaying: pState === "playing",
			progressMs: Number.isFinite(progressMs) ? progressMs : 0,
			volumePercent,
			deviceName: "Spotify App (Mac)",
			deviceId: "mac-spotify-app",
			track: name
				? {
						id,
						name,
						artists: artists || "Unknown Artist",
						album: album || "",
						albumArtUrl: albumArtUrl || null,
						durationMs: Number.isFinite(durationMs) ? durationMs : 0,
						uri,
					}
				: null,
		};
	} catch {
		return null;
	}
}

async function executeMacSpotifyCommand(cmd: SpotifyPlayerCommand, fallbackUri?: string): Promise<boolean> {
	if (!isMacSpotifyAppInstalled()) return false;
	const sanitizeUri = (u: string) => u.replace(/[^a-zA-Z0-9:_-]/g, "");
	let tellBody = "";
	switch (cmd.action) {
		case "play": {
			const target = fallbackUri ? sanitizeUri(fallbackUri) : "";
			tellBody = target
				? `if player state is stopped then\nplay track "${target}"\nelse\nplay\nend if`
				: "play";
			break;
		}
		case "pause":
			tellBody = "pause";
			break;
		case "next":
			tellBody = "next track";
			break;
		case "previous":
			tellBody = "previous track";
			break;
		case "volume": {
			const vol = clampSpotifyVolume(cmd.volumePercent ?? 70);
			tellBody = `set sound volume to ${vol}`;
			break;
		}
		case "seek": {
			const sec = Math.max(0, (cmd.positionMs ?? 0) / 1000);
			tellBody = `set player position to ${sec.toFixed(2)}`;
			break;
		}
		case "playUri": {
			const raw = cmd.uri || cmd.contextUri || fallbackUri || "";
			const safe = sanitizeUri(raw);
			if (!safe) return false;
			tellBody = `play track "${safe}"`;
			break;
		}
		default:
			return false;
	}
	const script = `tell application "Spotify"\n${tellBody}\nend tell`;
	try {
		await execFileAsync("osascript", ["-e", script], { timeout: 4000 });
		return true;
	} catch {
		return false;
	}
}

interface SpotifyDeviceInfo {
	id: string;
	name: string;
	is_active: boolean;
	is_restricted: boolean;
	volume_percent: number | null;
}

async function fetchAvailableSpotifyDevices(token: string): Promise<SpotifyDeviceInfo[]> {
	try {
		const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return [];
		const data = (await res.json()) as {
			devices?: Array<{
				id?: string | null;
				name?: string | null;
				is_active?: boolean;
				is_restricted?: boolean;
				volume_percent?: number | null;
			}>;
		};
		return (data.devices ?? [])
			.filter((d): d is NonNullable<typeof d> & { id: string } => Boolean(d && typeof d.id === "string" && !d.is_restricted))
			.map((d) => ({
				id: d.id,
				name: d.name ?? "Spotify Device",
				is_active: Boolean(d.is_active),
				is_restricted: Boolean(d.is_restricted),
				volume_percent: typeof d.volume_percent === "number" ? d.volume_percent : null,
			}));
	} catch {
		return [];
	}
}

async function resolveTargetDeviceId(
	token: string,
	preferredDeviceId?: string,
	forceLookup = false,
): Promise<string | undefined> {
	if (preferredDeviceId === "mac-spotify-app") return undefined;
	if (preferredDeviceId && !forceLookup) return preferredDeviceId;
	const devices = await fetchAvailableSpotifyDevices(token);
	if (preferredDeviceId && devices.some((d) => d.id === preferredDeviceId)) {
		return preferredDeviceId;
	}
	// Default to the in-page Web Playback SDK ("LearnHarness Player") whenever available
	const inApp = devices.find((d) => d.name === "LearnHarness Player");
	if (inApp) return inApp.id;
	const active = devices.find((d) => d.is_active);
	if (active) return active.id;
	return devices[0]?.id ?? preferredDeviceId;
}

export async function fetchSpotifyPlaybackState(): Promise<SpotifyPlaybackState | null> {
	const token = await getValidSpotifyAccessToken();
	if (!token) return null;
	try {
		const res = await fetch("https://api.spotify.com/v1/me/player", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (res.status === 204 || !res.ok) {
			const devices = await fetchAvailableSpotifyDevices(token);
			const inApp = devices.find((d) => d.name === "LearnHarness Player");
			const primary = inApp ?? devices.find((d) => d.is_active) ?? devices[0];
			if (primary) {
				const macState = await readMacSpotifyState();
				return {
					isPlaying: false,
					progressMs: macState?.progressMs ?? 0,
					volumePercent: primary.volume_percent ?? 70,
					deviceName: primary.name,
					deviceId: primary.id,
					track: macState?.track ?? null,
				};
			}
			const macState = await readMacSpotifyState();
			if (macState) return macState;
			return {
				isPlaying: false,
				progressMs: 0,
				volumePercent: 70,
				deviceName: null,
				deviceId: null,
				track: null,
			};
		}
		const data = (await res.json()) as {
			is_playing?: boolean;
			progress_ms?: number;
			device?: { id?: string | null; name?: string | null; volume_percent?: number | null };
			item?: Record<string, unknown> | null;
		};
		const track = mapSpotifyTrackItem(data.item);
		if (!track) {
			const macState = await readMacSpotifyState();
			if (macState?.track) {
				return {
					...macState,
					deviceName: data.device?.name ?? macState.deviceName,
					deviceId: data.device?.id ?? macState.deviceId,
				};
			}
		}
		return {
			isPlaying: Boolean(data.is_playing),
			progressMs: typeof data.progress_ms === "number" ? data.progress_ms : 0,
			volumePercent: typeof data.device?.volume_percent === "number" ? data.device.volume_percent : 70,
			deviceName: data.device?.name ?? null,
			deviceId: data.device?.id ?? null,
			track,
		};
	} catch {
		return (await readMacSpotifyState()) ?? null;
	}
}

export async function fetchSpotifyPlaylists(): Promise<SpotifyPlaylistSummary[]> {
	const token = await getValidSpotifyAccessToken();
	if (!token) return [];
	try {
		const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=24", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return [];
		const data = (await res.json()) as {
			items?: Array<{
				id?: string;
				name?: string;
				uri?: string;
				images?: Array<{ url?: string }>;
				tracks?: { total?: number };
				items?: { total?: number };
			} | null>;
		};
		return (data.items ?? [])
			.filter((pl): pl is NonNullable<typeof pl> & { id: string; name: string; uri: string } =>
				Boolean(pl && typeof pl.id === "string" && typeof pl.name === "string" && typeof pl.uri === "string"),
			)
			.map((pl) => ({
				id: pl.id,
				name: pl.name,
				imageUrl: pl.images?.[0]?.url ?? null,
				trackCount:
					typeof pl.tracks?.total === "number"
						? pl.tracks.total
						: typeof pl.items?.total === "number"
							? pl.items.total
							: 0,
				uri: pl.uri,
			}));
	} catch {
		return [];
	}
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrack[]> {
	const token = await getValidSpotifyAccessToken();
	const q = query.trim();
	if (!token || !q) return [];
	try {
		const url = new URL("https://api.spotify.com/v1/search");
		url.searchParams.set("q", q);
		url.searchParams.set("type", "track");
		url.searchParams.set("limit", "12");
		const res = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return [];
		const data = (await res.json()) as {
			tracks?: { items?: Array<Record<string, unknown>> };
		};
		return (data.tracks?.items ?? [])
			.map((item) => mapSpotifyTrackItem(item))
			.filter((t): t is SpotifyTrack => t !== null);
	} catch {
		return [];
	}
}

async function resolveFallbackStarterUri(): Promise<{ contextUri?: string; uri?: string }> {
	const playlists = await fetchSpotifyPlaylists();
	if (playlists[0]) {
		return { contextUri: playlists[0].uri };
	}
	const tracks = await searchSpotifyTracks("lofi study beats");
	if (tracks[0]) {
		return { uri: tracks[0].uri };
	}
	return {};
}

export interface SpotifyPlayerCommand {
	action: "play" | "pause" | "next" | "previous" | "volume" | "seek" | "playUri" | "transferDevice";
	deviceId?: string;
	volumePercent?: number;
	positionMs?: number;
	uri?: string;
	contextUri?: string;
	play?: boolean;
}

export async function executeSpotifyPlayerCommand(
	cmd: SpotifyPlayerCommand,
): Promise<{ ok: boolean; error?: string }> {
	const token = await getValidSpotifyAccessToken();
	if (!token) return { ok: false, error: "Not connected to Spotify." };

	// If currently using the local macOS Spotify.app bridge directly:
	if (cmd.deviceId === "mac-spotify-app") {
		const fallback = cmd.action === "play" ? await resolveFallbackStarterUri() : {};
		const ok = await executeMacSpotifyCommand(cmd, fallback.contextUri ?? fallback.uri);
		if (ok) return { ok: true };
	}

	const resolvedDeviceId = await resolveTargetDeviceId(token, cmd.deviceId);
	const deviceQuery = resolvedDeviceId ? `?device_id=${encodeURIComponent(resolvedDeviceId)}` : "";

	// IMPORTANT: Do NOT send "content-type: application/json" on requests without a JSON body,
	// otherwise Spotify Web API rejects PUT/POST with 400 Bad Request (Malformed json).
	const authHeaders: Record<string, string> = {
		Authorization: `Bearer ${token}`,
	};
	const jsonHeaders: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};

	try {
		let res: Response;
		switch (cmd.action) {
			case "play": {
				res = await fetch(`https://api.spotify.com/v1/me/player/play${deviceQuery}`, {
					method: "PUT",
					headers: authHeaders,
				});
				// If the target device (e.g. in-page "LearnHarness Player") is not active yet or has no queued context:
				if (!res.ok && resolvedDeviceId) {
					const transferRes = await fetch("https://api.spotify.com/v1/me/player", {
						method: "PUT",
						headers: jsonHeaders,
						body: JSON.stringify({ device_ids: [resolvedDeviceId], play: true }),
					});
					await new Promise((r) => setTimeout(r, 250));
					const checkState = await fetch("https://api.spotify.com/v1/me/player", {
						headers: authHeaders,
					}).catch(() => null);
					const checkJson = checkState?.ok
						? ((await checkState.json().catch(() => ({}))) as { is_playing?: boolean; item?: unknown })
						: null;
					if (transferRes.ok && checkJson?.is_playing && checkJson.item) {
						res = transferRes;
					} else {
						const starter = await resolveFallbackStarterUri();
						if (starter.contextUri || starter.uri) {
							const payload = starter.contextUri
								? { context_uri: starter.contextUri }
								: { uris: [starter.uri!] };
							res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(resolvedDeviceId)}`, {
								method: "PUT",
								headers: jsonHeaders,
								body: JSON.stringify(payload),
							});
						}
					}
				}
				break;
			}
			case "pause":
				res = await fetch(`https://api.spotify.com/v1/me/player/pause${deviceQuery}`, {
					method: "PUT",
					headers: authHeaders,
				});
				break;
			case "next":
				res = await fetch(`https://api.spotify.com/v1/me/player/next${deviceQuery}`, {
					method: "POST",
					headers: authHeaders,
				});
				break;
			case "previous":
				res = await fetch(`https://api.spotify.com/v1/me/player/previous${deviceQuery}`, {
					method: "POST",
					headers: authHeaders,
				});
				break;
			case "volume": {
				const vol = clampSpotifyVolume(cmd.volumePercent ?? 50);
				const devParam = resolvedDeviceId ? `&device_id=${encodeURIComponent(resolvedDeviceId)}` : "";
				const macVolPromise =
					!resolvedDeviceId && isMacSpotifyAppInstalled()
						? execFileAsync(
								"osascript",
								["-e", `if application "Spotify" is running then tell application "Spotify" to set sound volume to ${vol}`],
								{ timeout: 1500 },
							)
								.then(() => true)
								.catch(() => false)
						: Promise.resolve(false);
				const [apiRes, macApplied] = await Promise.all([
					fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}${devParam}`, {
						method: "PUT",
						headers: authHeaders,
					}).catch(() => null),
					macVolPromise,
				]);
				if (macApplied || (apiRes && (apiRes.ok || apiRes.status === 204))) {
					return { ok: true };
				}
				res = apiRes ?? new Response(null, { status: 500 });
				break;
			}
			case "seek": {
				const pos = Math.max(0, Math.floor(cmd.positionMs ?? 0));
				const devParam = resolvedDeviceId ? `&device_id=${encodeURIComponent(resolvedDeviceId)}` : "";
				res = await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${pos}${devParam}`, {
					method: "PUT",
					headers: authHeaders,
				});
				break;
			}
			case "playUri": {
				const payload = cmd.contextUri
					? { context_uri: cmd.contextUri }
					: cmd.uri
						? cmd.uri.startsWith("spotify:track:")
							? { uris: [cmd.uri] }
							: { context_uri: cmd.uri }
						: {};
				res = await fetch(`https://api.spotify.com/v1/me/player/play${deviceQuery}`, {
					method: "PUT",
					headers: jsonHeaders,
					body: JSON.stringify(payload),
				});
				break;
			}
			case "transferDevice": {
				const target = cmd.deviceId ?? resolvedDeviceId;
				if (!target) return { ok: false, error: "Kein Zielgerät verfügbar." };
				res = await fetch("https://api.spotify.com/v1/me/player", {
					method: "PUT",
					headers: jsonHeaders,
					body: JSON.stringify({ device_ids: [target], play: cmd.play ?? true }),
				});
				break;
			}
		}

		if (!res.ok && res.status !== 204) {
			// Fallback to local macOS Spotify.app via AppleScript when no Connect device is active
			const starter = cmd.action === "play" ? await resolveFallbackStarterUri() : {};
			const macOk = await executeMacSpotifyCommand(cmd, starter.contextUri ?? starter.uri);
			if (macOk) {
				return { ok: true };
			}

			const errData = (await res.json().catch(() => ({}))) as { error?: { message?: string; reason?: string } };
			if (res.status === 404 || errData.error?.reason === "NO_ACTIVE_DEVICE") {
				return {
					ok: false,
					error: "Kein aktives Spotify-Gerät gefunden. Öffne kurz die Spotify-App oder nutze LearnHarness im Browser.",
				};
			}
			return {
				ok: false,
				error: errData.error?.message ?? `Spotify API Fehler (${res.status})`,
			};
		}
		return { ok: true };
	} catch (err) {
		const macOk = await executeMacSpotifyCommand(cmd);
		if (macOk) return { ok: true };
		return { ok: false, error: err instanceof Error ? err.message : "Netzwerkfehler" };
	}
}
