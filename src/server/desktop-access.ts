import { timingSafeEqual } from "node:crypto";

/** Per-launch desktop HTTP capability. This is not an OS-user malware
 * boundary and is not an OAuth credential. Browser-only mode is unchanged. */
export function desktopAPIAuthorized(
	headers: Headers,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const expected = env.LH_DESKTOP_API_SECRET;
	if (env.LH_DESKTOP_SERVER !== "1" && !expected) return true;
	if (!expected || expected.length < 64) return false;
	const supplied = headers.get("x-learnharness-desktop");
	if (!supplied) return false;
	const actual = Buffer.from(supplied);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** DNS-rebinding + CSRF guard for EVERY mode and path (pages server-render
 * chat content too). The server only listens on loopback, so a foreign Host
 * is a rebound name and a foreign Origin is another site posting in.
 * Requests with neither header are non-browser clients (scripts, Electron
 * main) and pass; browsers always send Host. */
export function localRequestAllowed(headers: Headers): boolean {
	const host = headers.get("host");
	try {
		if (host && !LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname)) return false;
		const origin = headers.get("origin");
		return origin === null || new URL(origin).host === host;
	} catch {
		return false; // unparsable Host, or Origin "null" (sandboxed frames, file:)
	}
}
