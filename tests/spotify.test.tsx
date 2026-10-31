import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	buildSpotifyAuthorizeUrl,
	buildSpotifyRedirectUri,
	clampSpotifyVolume,
	formatTrackTime,
	normalizeSpotifyRedirectOrigin,
	SPOTIFY_CLIENT_ID_KEY,
	SPOTIFY_KEY_INFO,
	SPOTIFY_SCOPES,
	validateKeyShape,
} from "../src/core/index.ts";
import { classifyKeys } from "../components/settings/keys-section.tsx";
import { SpotifyPlayerBody } from "../components/spotify-player.tsx";

describe("Spotify core utilities & key validation", () => {
	it("validates SPOTIFY_CLIENT_ID shape (>=16 chars, no whitespace)", () => {
		assert.equal(SPOTIFY_CLIENT_ID_KEY, "SPOTIFY_CLIENT_ID");
		assert.equal(SPOTIFY_KEY_INFO.id, "SPOTIFY_CLIENT_ID");
		assert.ok(validateKeyShape("SPOTIFY_CLIENT_ID", "a1b2c3d4e5f60718293a4b5c6d7e8f90").ok);
		assert.ok(!validateKeyShape("SPOTIFY_CLIENT_ID", "too-short").ok);
		assert.ok(!validateKeyShape("SPOTIFY_CLIENT_ID", "has spaces inside 1234567890").ok);
	});

	it("normalizes localhost to 127.0.0.1 for Spotify OAuth redirect URIs", () => {
		assert.equal(normalizeSpotifyRedirectOrigin("http://localhost:3000"), "http://127.0.0.1:3000");
		assert.equal(
			buildSpotifyRedirectUri("http://localhost:3000"),
			"http://127.0.0.1:3000/api/spotify/callback",
		);
	});

	it("builds a complete PKCE S256 Spotify authorize URL", () => {
		const url = new URL(
			buildSpotifyAuthorizeUrl({
				clientId: "client1234567890abcd",
				redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
				codeChallenge: "challenge_xyz",
				state: "state_123",
			}),
		);
		assert.equal(url.origin, "https://accounts.spotify.com");
		assert.equal(url.pathname, "/authorize");
		assert.equal(url.searchParams.get("client_id"), "client1234567890abcd");
		assert.equal(url.searchParams.get("response_type"), "code");
		assert.equal(url.searchParams.get("code_challenge_method"), "S256");
		assert.equal(url.searchParams.get("code_challenge"), "challenge_xyz");
		assert.equal(url.searchParams.get("state"), "state_123");
		for (const scope of SPOTIFY_SCOPES) {
			assert.ok(url.searchParams.get("scope")?.includes(scope));
		}
	});

	it("formats track time and clamps volume", () => {
		assert.equal(formatTrackTime(0), "0:00");
		assert.equal(formatTrackTime(9_000), "0:09");
		assert.equal(formatTrackTime(185_000), "3:05");
		assert.equal(clampSpotifyVolume(-15), 0);
		assert.equal(clampSpotifyVolume(65.4), 65);
		assert.equal(clampSpotifyVolume(140), 100);
	});
});

describe("classifyKeys with SPOTIFY_CLIENT_ID", () => {
	it("synthesizes spotifyRow when absent and keeps toolRows/providerRows clean", () => {
		const res = classifyKeys([], []);
		assert.equal(res.spotifyRow.id, "SPOTIFY_CLIENT_ID");
		assert.equal(res.spotifyRow.present, false);
		assert.equal(res.providerRows.length, 0);
		assert.equal(res.unknownRows.length, 0);
	});

	it("surfaces stored SPOTIFY_CLIENT_ID in spotifyRow without leaking into unknownRows or providerRows", () => {
		const res = classifyKeys(
			[
				{
					id: "SPOTIFY_CLIENT_ID",
					info: SPOTIFY_KEY_INFO,
					present: true,
					masked: "…8f90 (32 chars)",
					source: "file",
					shadowedByEnv: false,
				},
			],
			[],
		);
		assert.equal(res.spotifyRow.present, true);
		assert.equal(res.spotifyRow.masked, "…8f90 (32 chars)");
		assert.equal(res.providerRows.length, 0);
		assert.equal(res.unknownRows.length, 0);
	});
});

describe("SpotifyPlayerBody UI rendering", () => {
	const noop = () => {};

	it("renders collapsed floating pill with track info and Play/Pause button when connected", () => {
		const html = renderToStaticMarkup(
			<SpotifyPlayerBody
				status={{ clientIdPresent: true, connected: true, displayName: "Freddy" }}
				expanded={false}
				activeTab="now"
				playback={{
					isPlaying: true,
					progressMs: 42_000,
					volumePercent: 75,
					deviceName: "LearnHarness Player",
					deviceId: "dev-1",
					track: {
						id: "t1",
						name: "Clair de Lune",
						artists: "Claude Debussy",
						album: "Suite bergamasque",
						albumArtUrl: null,
						durationMs: 300_000,
						uri: "spotify:track:t1",
					},
				}}
				inAppDeviceId="dev-1"
				playlists={[]}
				searchQuery=""
				searchResults={[]}
				searching={false}
				error={null}
				onToggleExpand={noop}
				onSelectTab={noop}
				onPlayPause={noop}
				onNext={noop}
				onPrevious={noop}
				onVolumeChange={noop}
				onSeek={noop}
				onPlayUri={noop}
				onTransferToInApp={noop}
				onSearchQueryChange={noop}
				onSearchSubmit={noop}
				onOpenSettings={noop}
				onConnectSpotify={noop}
			/>,
		);
		assert.match(html, /data-testid="spotify-player-pill"/);
		assert.match(html, /Clair de Lune/);
		assert.match(html, /data-testid="spotify-pill-play-pause"/);
	});

	it("renders expanded mini-player with transport controls, volume slider, and playlists", () => {
		const html = renderToStaticMarkup(
			<SpotifyPlayerBody
				status={{ clientIdPresent: true, connected: true, displayName: "Freddy" }}
				expanded={true}
				activeTab="playlists"
				playback={{
					isPlaying: false,
					progressMs: 65_000,
					volumePercent: 80,
					deviceName: "MacBook Pro",
					deviceId: "remote-dev",
					track: {
						id: "t2",
						name: "Gymnopédie No. 1",
						artists: "Erik Satie",
						album: "Gymnopédies",
						albumArtUrl: null,
						durationMs: 185_000,
						uri: "spotify:track:t2",
					},
				}}
				inAppDeviceId="in-app-dev"
				playlists={[
					{
						id: "pl1",
						name: "Deep Focus Study",
						imageUrl: null,
						trackCount: 42,
						uri: "spotify:playlist:pl1",
					},
				]}
				searchQuery=""
				searchResults={[]}
				searching={false}
				error={null}
				onToggleExpand={noop}
				onSelectTab={noop}
				onPlayPause={noop}
				onNext={noop}
				onPrevious={noop}
				onVolumeChange={noop}
				onSeek={noop}
				onPlayUri={noop}
				onTransferToInApp={noop}
				onSearchQueryChange={noop}
				onSearchSubmit={noop}
				onOpenSettings={noop}
				onConnectSpotify={noop}
			/>,
		);
		assert.match(html, /data-testid="spotify-player-panel"/);
		assert.match(html, /Gymnopédie No\. 1/);
		assert.match(html, /Erik Satie/);
		assert.match(html, /1:05/);
		assert.match(html, /3:05/);
		assert.match(html, /80%/);
		assert.match(html, /data-testid="spotify-prev-btn"/);
		assert.match(html, /data-testid="spotify-play-pause-btn"/);
		assert.match(html, /data-testid="spotify-next-btn"/);
		assert.match(html, /data-testid="spotify-volume-slider"/);
		assert.match(html, /data-testid="spotify-transfer-btn"/);
		assert.match(html, /Deep Focus Study/);
	});
});
