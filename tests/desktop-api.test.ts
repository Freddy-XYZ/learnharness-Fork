import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { desktopAPIAuthorized, localRequestAllowed } from "../src/server/desktop-access.ts";
import { proxy } from "../proxy.ts";
import { browserServiceSpawnEnv } from "../src/agent/subagents/headless.ts";
const require = createRequire(import.meta.url);
const { desktopAPIHeaders, HEADER } = require("../electron/desktop-api.cjs");
const { trustedSender, chatGPTControl } = require("../electron/chatgpt-ipc.cjs");
const { externalURLAllowed } = require("../electron/external-url.cjs");
const secret = "a".repeat(64);
const origin = "http://127.0.0.1:12345";

function fixture() {
	const mainFrame = { url: `${origin}/chat/new` };
	const contents = { id: 5, mainFrame, isDestroyed: () => false };
	const win = { webContents: contents, isDestroyed: () => false };
	const details = { url: `${origin}/api/settings`, webContentsId: contents.id, webContents: contents, frame: mainFrame, initiatorOrigin: origin, requestHeaders: { Accept: "application/json" } };
	return { mainFrame, contents, win, details };
}

test("desktop capability injects only trusted app mainframe exact-origin API requests and strips every other case", () => {
	const { details, win, mainFrame, contents } = fixture();
	assert.equal(desktopAPIHeaders(details, origin, secret, [win])[HEADER], secret);
	for (const mutation of [
		{ url: "https://thirdparty.invalid/api/settings" },
		{ url: "http://127.0.0.1:12346/api/settings" },
		{ url: `${origin}/chat/new` },
		{ frame: { url: `${origin}/chat/new` } }, // forged frame identity
		{ frame: { url: "about:srcdoc", parent: mainFrame } },
		{ frame: null },
		{ webContentsId: 6 },
		{ webContents: { ...contents } },
		{ initiatorOrigin: "https://thirdparty.invalid" },
		{ initiatorOrigin: "null" },
	]) {
		const result = desktopAPIHeaders({ ...details, ...mutation, requestHeaders: { "X-LearnHarness-Desktop": secret } }, origin, secret, [win]);
		assert(!Object.keys(result).some((key) => key.toLowerCase() === HEADER), JSON.stringify(mutation));
	}
	assert.equal(desktopAPIHeaders(details, origin, secret, [])[HEADER], undefined, "other WebContents are not app windows");
	mainFrame.url = "https://thirdparty.invalid/after-navigation";
	assert.equal(desktopAPIHeaders(details, origin, secret, [win])[HEADER], undefined, "navigation revokes trust even for the same native frame");
	assert.equal(desktopAPIHeaders(details, origin, null, [win])[HEADER], undefined, "externally launched desktop dev receives no packaged capability");
});

test("all methods fail closed for desktop missing/wrong secret; API-only matcher covers SSE/settings/spending", () => {
	assert(desktopAPIAuthorized(new Headers(), {}), "browser-only API-key mode unchanged");
	assert(!desktopAPIAuthorized(new Headers({ [HEADER]: secret }), { LH_DESKTOP_SERVER: "1" }), "missing server secret must not disable authorization");
	for (const value of [undefined, "", "wrong", secret + ", " + secret]) {
		assert(!desktopAPIAuthorized(new Headers(value === undefined ? {} : { [HEADER]: value }), { LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: secret }));
	}
	assert(desktopAPIAuthorized(new Headers({ [HEADER]: secret }), { LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: secret }));
	const originalMarker = process.env.LH_DESKTOP_SERVER;
	const originalSecret = process.env.LH_DESKTOP_API_SECRET;
	try {
		process.env.LH_DESKTOP_SERVER = "1";
		process.env.LH_DESKTOP_API_SECRET = secret;
		for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
			assert.equal(proxy(new NextRequest(origin + "/api/settings", { method })).status, 403);
			assert.equal(proxy(new NextRequest(origin + "/api/settings", { method, headers: { [HEADER]: secret } })).headers.get("x-middleware-next"), "1");
		}
		for (const pathname of ["/api", "/api/events", "/api/chat", "/api/settings/models", "/api/chats/scratch/markdown"]) assert.equal(proxy(new NextRequest(origin + pathname)).status, 403, pathname);
		for (const pathname of ["/chat/new", "/apiary"]) assert.equal(proxy(new NextRequest(origin + pathname)).headers.get("x-middleware-next"), "1", pathname);
	} finally {
		if (originalMarker === undefined) delete process.env.LH_DESKTOP_SERVER; else process.env.LH_DESKTOP_SERVER = originalMarker;
		if (originalSecret === undefined) delete process.env.LH_DESKTOP_API_SECRET; else process.env.LH_DESKTOP_API_SECRET = originalSecret;
	}
});

test("renderer controls route explicit account forgetting and account-independent boolean consent only", async () => {
	const forgotten: string[] = [], changes: boolean[] = [];
	const connection = { disconnect: async (id: string) => { forgotten.push(id); return { ok: true }; }, consent: async (enabled: boolean) => { changes.push(enabled); return { ok: true }; } };
	assert.deepEqual(await chatGPTControl({ op: "disconnect", id: "fixture-account" }, connection), { ok: true });
	assert.deepEqual(await chatGPTControl({ op: "consent", enabled: false }, connection), { ok: true });
	assert.deepEqual(forgotten, ["fixture-account"]); assert.deepEqual(changes, [false]);
	for (const command of [{ op: "disconnect" }, { op: "disconnect", id: 7 }, { op: "consent", enabled: "false" }]) assert.deepEqual(await chatGPTControl(command, connection), { error: "Unsupported ChatGPT control." });
	assert.deepEqual(changes, [false]);
});

test("renderer controls have no lease or general token bridge, and require the trusted main frame", async () => {
	let leased = false;
	const connection = { lease: async () => { leased = true; return { accessToken: "scratch-private-token" }; } };
	assert.deepEqual(await chatGPTControl({ op: "lease", background: false }, connection), { error: "Unsupported ChatGPT control." });
	assert.equal(leased, false);
	const { contents, mainFrame, win } = fixture();
	const BrowserWindow = { fromWebContents: (value: unknown) => value === contents ? win : null };
	assert(trustedSender({ sender: contents, senderFrame: mainFrame }, origin, BrowserWindow));
	assert(!trustedSender({ sender: contents, senderFrame: { url: mainFrame.url } }, origin, BrowserWindow));
	mainFrame.url = "https://thirdparty.invalid/";
	assert(!trustedSender({ sender: contents, senderFrame: mainFrame }, origin, BrowserWindow));
	assert.equal(browserServiceSpawnEnv({ LH_DESKTOP_API_SECRET: secret, LH_DESKTOP_SERVER: "1" }).LH_DESKTOP_API_SECRET, undefined);
});

test("loopback guard rejects rebound Host names and cross-site Origins on every path", () => {
	const allowed = (h: Record<string, string>) => localRequestAllowed(new Headers(h));
	assert(allowed({}), "non-browser clients without Host/Origin pass");
	for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "localhost"]) assert(allowed({ host }), host);
	assert(allowed({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }));
	for (const h of <Record<string, string>[]>[
		{ host: "evil.example:3000" }, // DNS rebinding
		{ host: "evil.example:3000", origin: "http://evil.example:3000" },
		{ host: "127.0.0.1.evil.example:3000" },
		{ host: "127.0.0.1:3000", origin: "https://evil.example" }, // CSRF
		{ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3001" },
		{ host: "127.0.0.1:3000", origin: "null" },
		{ origin: "http://127.0.0.1:3000" },
		{ host: "bad host" },
	]) assert(!allowed(h), JSON.stringify(h));
	assert.equal(proxy(new NextRequest(origin + "/chat/new", { headers: { host: "evil.example:12345" } })).status, 403, "pages are guarded too");
	assert.equal(proxy(new NextRequest(origin + "/api/spotify/player", { method: "POST", headers: { host: "127.0.0.1:12345", origin: "https://evil.example" } })).status, 403);
});

test("only http(s) and mailto links leave the app", () => {
	for (const url of ["https://example.com", "http://127.0.0.1:1/x", "mailto:a@b.c"]) assert(externalURLAllowed(url), url);
	for (const url of ["file:///etc/passwd", "smb://host/share", "javascript:alert(1)", "vscode://x", "not a url", ""]) assert(!externalURLAllowed(url), url);
});
