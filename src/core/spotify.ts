/**
 * Pure, browser-safe Spotify contracts and helpers:
 * - SPOTIFY_CLIENT_ID_KEY & SPOTIFY_KEY_INFO (Settings key row metadata)
 * - OAuth 2.0 PKCE URL builder & scopes
 * - Track, playback state, and playlist types
 * - Time & volume formatting/clamping utilities
 */

import type { AuthKeyInfo } from "./auth-keys.ts";

export const SPOTIFY_CLIENT_ID_KEY = "SPOTIFY_CLIENT_ID" as const;

export const SPOTIFY_KEY_INFO: AuthKeyInfo = {
	id: SPOTIFY_CLIENT_ID_KEY,
	label: "Spotify Client ID",
	description: "Spotify Developer Client ID for in-app music streaming and playback control.",
	docsUrl: "https://developer.spotify.com/dashboard",
};

export const SPOTIFY_SCOPES: readonly string[] = [
	"streaming",
	"user-read-email",
	"user-read-private",
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"playlist-read-private",
	"playlist-read-collaborative",
] as const;

export interface SpotifyAuthStatus {
	clientIdPresent: boolean;
	connected: boolean;
	displayName: string | null;
	email?: string | null;
	product?: string | null;
	expiresAt?: number | null;
}

export interface SpotifyTrack {
	id: string;
	name: string;
	artists: string;
	album: string;
	albumArtUrl: string | null;
	durationMs: number;
	uri: string;
}

export interface SpotifyPlaybackState {
	isPlaying: boolean;
	progressMs: number;
	volumePercent: number;
	deviceName: string | null;
	deviceId: string | null;
	track: SpotifyTrack | null;
}

export interface SpotifyPlaylistSummary {
	id: string;
	name: string;
	imageUrl: string | null;
	trackCount: number;
	uri: string;
}

/**
 * Normalize a Spotify redirect origin: Spotify's OAuth 2.0 security policy
 * requires `127.0.0.1` instead of `localhost` for loopback HTTP redirect URIs
 * (while keeping port and path intact).
 */
export function normalizeSpotifyRedirectOrigin(origin: string): string {
	try {
		const url = new URL(origin);
		if (url.hostname === "localhost") {
			url.hostname = "127.0.0.1";
		}
		return url.origin;
	} catch {
		return origin.replace(/\/+$/, "");
	}
}

/** The packaged desktop app's server runs on a random port, so its OAuth
 *  redirect is this fixed URI instead: Electron main listens on it only
 *  while a login is open (electron/spotify-login.cjs). Same URI the README
 *  has users register for `npm run dev`. */
export const SPOTIFY_DESKTOP_REDIRECT_URI = "http://127.0.0.1:3000/api/spotify/callback";

export function buildSpotifyRedirectUri(origin: string): string {
	return `${normalizeSpotifyRedirectOrigin(origin)}/api/spotify/callback`;
}

export function buildSpotifyAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	state: string;
	scopes?: readonly string[];
}): string {
	const url = new URL("https://accounts.spotify.com/authorize");
	url.searchParams.set("client_id", params.clientId.trim());
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", params.redirectUri);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("code_challenge", params.codeChallenge);
	url.searchParams.set("state", params.state);
	url.searchParams.set("scope", (params.scopes ?? SPOTIFY_SCOPES).join(" "));
	return url.toString();
}

/** Format milliseconds into `m:ss` (e.g., 185000 -> "3:05"). */
export function formatTrackTime(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0:00";
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/** Clamp volume percentage to integer 0..100. */
export function clampSpotifyVolume(volumePercent: number): number {
	if (!Number.isFinite(volumePercent)) return 50;
	return Math.max(0, Math.min(100, Math.round(volumePercent)));
}
