import { NextResponse, type NextRequest } from "next/server";
import { desktopAPIAuthorized, localRequestAllowed } from "./src/server/desktop-access.ts";

const forbidden = (error: string) => NextResponse.json({ error }, { status: 403, headers: { "Cache-Control": "no-store" } });

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
	return NextResponse.next();
}
