import { NextResponse, type NextRequest } from "next/server";
import { desktopAPIAuthorized, localRequestAllowed } from "./src/server/desktop-access.ts";

/** On every response: no other site may frame LearnHarness (clickjacking
 * against the local UI), and no response is MIME-sniffed. The app's own
 * demo iframes are srcdoc documents, which these headers do not affect. */
const SECURITY_HEADERS = {
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
};

function secured(response: NextResponse): NextResponse {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
}

const forbidden = (error: string) => secured(NextResponse.json({ error }, { status: 403, headers: { "Cache-Control": "no-store" } }));

/** No matcher: runs on every request, so the loopback Host/Origin guard
 * also covers pages (which server-render chat records).
 * The desktop capability applies to every API method, including SSE and
 * spending/settings routes. No public callback or worker bypass: internal
 * jobs call server functions, and any legitimate self-HTTP request must
 * carry the private capability. */
export function proxy(request: NextRequest) {
	if (!localRequestAllowed(request.headers)) return forbidden("Requests must come from this machine's LearnHarness origin.");
	const { pathname } = request.nextUrl;
	if ((pathname === "/api" || pathname.startsWith("/api/")) && !desktopAPIAuthorized(request.headers)) {
		return forbidden("Desktop API access requires the trusted LearnHarness window.");
	}
	return secured(NextResponse.next());
}
