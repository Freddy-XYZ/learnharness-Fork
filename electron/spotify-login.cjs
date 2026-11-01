"use strict";

const http = require("node:http");

/** Desktop Spotify login (packaged app). The app server runs on a random
 * port, so the OAuth redirect is a fixed loopback URI (server-side
 * SPOTIFY_DESKTOP_REDIRECT_URI). Main listens on it only while one login is
 * open, accepts exactly one callback carrying the expected state, and
 * forwards it to the server's own callback route with the desktop secret —
 * the proxy never needs a public callback bypass. */

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TIMEOUT_MS = 10 * 60 * 1000; // = SPOTIFY_OAUTH_STATE_TTL_MS

/** The authorize URL's loopback redirect + state, or null unless it is a
 * Spotify authorize URL redirecting to http://127.0.0.1:<port>. */
function spotifyLoginTarget(authorizeUrl) {
	try {
		const url = new URL(authorizeUrl);
		if (`${url.origin}${url.pathname}` !== AUTHORIZE || url.username || url.password) return null;
		const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
		const state = url.searchParams.get("state");
		if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || !redirect.port || !state) return null;
		return { redirect, state };
	} catch {
		return null;
	}
}

let active = null;

/** `forward(search)` delivers the callback query to the app server and
 * returns its Response; its body is shown in the browser tab. */
async function runSpotifyLogin({ authorizeUrl, openExternal, forward, timeoutMs = TIMEOUT_MS }) {
	const target = spotifyLoginTarget(authorizeUrl);
	if (!target) return { ok: false, error: "Invalid Spotify login URL." };
	if (active) {
		active.cancel();
		await active.closed;
	}
	const { redirect, state } = target;
	const listener = http.createServer();
	let finish;
	const result = new Promise((resolve) => { finish = resolve; });
	let markClosed;
	const closed = new Promise((resolve) => { markClosed = resolve; });
	listener.once("close", markClosed);
	let done = false;
	let claimed = false;
	let timer;
	const end = (value) => {
		if (done) return;
		done = true;
		clearTimeout(timer);
		if (listener.listening) {
			listener.close();
			listener.closeAllConnections();
		} else {
			markClosed();
		}
		if (active?.closed === closed) active = null;
		finish(value);
	};
	active = { cancel: () => end({ ok: false, error: "Superseded by a new Spotify login." }), closed };

	listener.on("request", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Referrer-Policy", "no-referrer");
		let callback;
		try { callback = new URL(req.url || "/", redirect); }
		catch { res.writeHead(400).end(); return; }
		if (done || claimed || req.method !== "GET" || callback.pathname !== redirect.pathname || req.headers.host !== redirect.host) {
			res.writeHead(404).end();
			return;
		}
		const params = callback.searchParams;
		// Unsolicited or duplicated callbacks never consume the pending login.
		if (["state", "code", "error"].some((key) => params.getAll(key).length > 1) || params.get("state") !== state) {
			res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Spotify sign-in could not be verified.");
			return;
		}
		claimed = true; // before the async forward: one callback per login
		let ok = false;
		try {
			const response = await forward(callback.search);
			ok = response.ok;
			res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
			res.writeHead(response.status, { "content-type": "text/html; charset=utf-8" }).end(await response.text());
		} catch {
			res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }).end("LearnHarness could not complete the Spotify login.");
		}
		end(ok ? { ok: true } : { ok: false, error: "Spotify login failed. See the browser tab for details." });
	});

	try {
		await new Promise((resolve, reject) => {
			listener.once("error", reject);
			listener.listen(Number(redirect.port), redirect.hostname, resolve);
		});
	} catch (err) {
		end({
			ok: false,
			error: err?.code === "EADDRINUSE"
				? `Port ${redirect.port} is in use, so the Spotify login cannot receive its callback. Quit the program using it and try again.`
				: "Could not start the Spotify login listener.",
		});
		return result;
	}
	timer = setTimeout(() => end({ ok: false, error: "Spotify login timed out. Please try again." }), timeoutMs);
	try {
		await openExternal(authorizeUrl);
	} catch {
		end({ ok: false, error: "Could not open the browser for the Spotify login." });
	}
	return result;
}

module.exports = { spotifyLoginTarget, runSpotifyLogin };
