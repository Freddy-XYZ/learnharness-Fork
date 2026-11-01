import assert from "node:assert/strict";
import { createRequire } from "node:module";
import net from "node:net";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	buildSpotifyAuthorizeUrl,
	buildSpotifyRedirectUri,
	clampSpotifyVolume,
	formatTrackTime,
	normalizeSpotifyRedirectOrigin,
	SPOTIFY_CLIENT_ID_KEY,
	SPOTIFY_DESKTOP_REDIRECT_URI,
	SPOTIFY_KEY_INFO,
	SPOTIFY_SCOPES,
	validateKeyShape,
} from "../src/core/index.ts";
import { classifyKeys, openSpotifyLogin } from "../components/settings/keys-section.tsx";
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

describe("openSpotifyLogin popup handling", () => {
	const AUTH = "https://accounts.spotify.com/authorize?x=1";
	function fakePopup() {
		const popup = { closed: false, location: { href: "" }, close() { popup.closed = true; } };
		return popup;
	}

	it("browser: opens the popup before the server answers, then points it at Spotify", async () => {
		const popup = fakePopup();
		const calls: string[] = [];
		const error = await openSpotifyLogin({
			open: (url) => (calls.push(`open:${url}`), popup as unknown as Window),
			start: async () => (calls.push("start"), { authorizeUrl: AUTH }),
		});
		assert.equal(error, null);
		assert.deepEqual(calls, ["open:", "start"]);
		assert.equal(popup.location.href, AUTH);
	});

	it("browser: closes the blank popup and reports the server error", async () => {
		const popup = fakePopup();
		const error = await openSpotifyLogin({
			open: () => popup as unknown as Window,
			start: async () => ({ error: "Please save your SPOTIFY_CLIENT_ID first." }),
		});
		assert.equal(error, "Please save your SPOTIFY_CLIENT_ID first.");
		assert.equal(popup.closed, true);
	});

	it("browser: reports a blocked popup", async () => {
		const error = await openSpotifyLogin({ open: () => null, start: async () => ({ authorizeUrl: AUTH }) });
		assert.match(error ?? "", /Popup blocked/);
	});

	it("desktop: hands the URL to Electron main, opens no popup, and relays its error", async () => {
		const opened: string[] = [];
		const handed: string[] = [];
		const ok = await openSpotifyLogin({
			desktopLogin: async (url) => (handed.push(url), { ok: true }),
			open: (url) => (opened.push(url), null),
			start: async () => ({ authorizeUrl: AUTH }),
		});
		assert.equal(ok, null);
		assert.deepEqual(handed, [AUTH]);
		assert.deepEqual(opened, []);
		const failed = await openSpotifyLogin({
			desktopLogin: async () => ({ ok: false, error: "Port 3000 is in use" }),
			open: () => null,
			start: async () => ({ authorizeUrl: AUTH }),
		});
		assert.equal(failed, "Port 3000 is in use");
	});
});

describe("desktop Spotify login listener (electron/spotify-login.cjs)", () => {
	const require = createRequire(import.meta.url);
	const { spotifyLoginTarget, runSpotifyLogin } = require("../electron/spotify-login.cjs");
	const authorize = (redirectUri: string, state = "s1") =>
		buildSpotifyAuthorizeUrl({ clientId: "client1234567890abcd", redirectUri, codeChallenge: "c", state });
	async function freePort(): Promise<number> {
		const srv = net.createServer();
		await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
		const { port } = srv.address() as net.AddressInfo;
		await new Promise((r) => srv.close(r));
		return port;
	}

	it("accepts only Spotify authorize URLs with a 127.0.0.1 http redirect", () => {
		assert.equal(spotifyLoginTarget(authorize(SPOTIFY_DESKTOP_REDIRECT_URI))?.state, "s1");
		assert.equal(spotifyLoginTarget(authorize("http://localhost:3000/api/spotify/callback")), null);
		assert.equal(spotifyLoginTarget(authorize("https://evil.example/cb")), null);
		assert.equal(spotifyLoginTarget(authorize(SPOTIFY_DESKTOP_REDIRECT_URI).replace("accounts.spotify.com", "accounts.spotify.com.evil.example")), null);
		assert.equal(spotifyLoginTarget("not a url"), null);
	});

	it("ignores a wrong state, forwards the matching callback, then stops listening", async () => {
		const port = await freePort();
		const redirect = `http://127.0.0.1:${port}/api/spotify/callback`;
		const forwarded: string[] = [];
		let opened = "";
		const done = runSpotifyLogin({
			authorizeUrl: authorize(redirect),
			openExternal: async (url: string) => { opened = url; },
			forward: async (search: string) => (forwarded.push(search), new Response("<p>connected</p>", { status: 200 })),
		});
		while (!opened) await new Promise((r) => setTimeout(r, 5));
		const forged = await fetch(`${redirect}?code=x&state=forged`);
		assert.equal(forged.status, 400);
		const real = await fetch(`${redirect}?code=abc&state=s1`);
		assert.equal(real.status, 200);
		assert.equal(await real.text(), "<p>connected</p>");
		assert.deepEqual(await done, { ok: true });
		assert.deepEqual(forwarded, ["?code=abc&state=s1"]);
		await assert.rejects(fetch(`${redirect}?code=abc&state=s1`));
	});

	it("reports a busy port instead of hanging", async () => {
		const busy = net.createServer();
		await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
		const { port } = busy.address() as net.AddressInfo;
		const result = await runSpotifyLogin({
			authorizeUrl: authorize(`http://127.0.0.1:${port}/api/spotify/callback`),
			openExternal: async () => assert.fail("must not open the browser"),
			forward: async () => assert.fail("must not forward"),
		});
		busy.close();
		assert.equal(result.ok, false);
		assert.match(result.error, /in use/);
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

describe("Spotify OAuth state expiry", () => {
	it("rejects a callback whose login is older than the TTL, before any token exchange", async (t) => {
		const fs = await import("node:fs");
		const os = await import("node:os");
		const path = await import("node:path");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-spotify-"));
		t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
		const saved = { data: process.env.LH_DATA_DIR, id: process.env.SPOTIFY_CLIENT_ID };
		t.after(() => {
			if (saved.data === undefined) delete process.env.LH_DATA_DIR; else process.env.LH_DATA_DIR = saved.data;
			if (saved.id === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = saved.id;
		});
		process.env.LH_DATA_DIR = dir;
		process.env.SPOTIFY_CLIENT_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
		const { startSpotifyLogin, completeSpotifyCallback, SPOTIFY_OAUTH_STATE_TTL_MS } = await import("../src/server/spotify.ts");
		const fetchCalls: string[] = [];
		t.mock.method(globalThis, "fetch", async (url: string) => {
			fetchCalls.push(String(url));
			return new Response("{}", { status: 400 });
		});

		const login = startSpotifyLogin("http://127.0.0.1:3000");
		assert.ok(login.ok);
		const state = new URL(login.authorizeUrl).searchParams.get("state")!;
		const now = Date.now();
		t.mock.method(Date, "now", () => now + SPOTIFY_OAUTH_STATE_TTL_MS + 1);
		const expired = await completeSpotifyCallback("code", state, "http://127.0.0.1:3000");
		assert.deepEqual(expired, { ok: false, error: "Invalid or expired OAuth state. Please try connecting again." });
		assert.equal(fetchCalls.length, 0);

		(Date.now as unknown as { mock: { mockImplementation(f: () => number): void } }).mock.mockImplementation(() => now + 1000);
		const fresh = await completeSpotifyCallback("code", state, "http://127.0.0.1:3000");
		assert.equal(fresh.ok, false);
		assert.deepEqual(fetchCalls, ["https://accounts.spotify.com/api/token"], "a fresh state reaches the token exchange");

		// Packaged desktop server (random port): the redirect is the fixed URI
		// Electron main listens on, never the request origin.
		const savedDesktop = process.env.LH_DESKTOP_SERVER;
		t.after(() => {
			if (savedDesktop === undefined) delete process.env.LH_DESKTOP_SERVER; else process.env.LH_DESKTOP_SERVER = savedDesktop;
		});
		process.env.LH_DESKTOP_SERVER = "1";
		const desktop = startSpotifyLogin("http://127.0.0.1:54321");
		assert.ok(desktop.ok);
		assert.equal(desktop.redirectUri, SPOTIFY_DESKTOP_REDIRECT_URI);
	});
});
