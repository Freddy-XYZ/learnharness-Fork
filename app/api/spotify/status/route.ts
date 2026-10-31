import {
	disconnectSpotify,
	getSpotifyStatus,
	getValidSpotifyAccessToken,
	startSpotifyLogin,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const status = getSpotifyStatus();
	const accessToken = status.connected ? await getValidSpotifyAccessToken() : null;
	return Response.json({
		status,
		accessToken,
	});
}

export async function POST(req: Request) {
	let body: { action?: string } = {};
	try {
		body = (await req.json()) as { action?: string };
	} catch {
		/* empty body */
	}

	if (body.action === "disconnect") {
		disconnectSpotify();
		return Response.json({ ok: true, status: getSpotifyStatus() });
	}

	if (body.action === "login") {
		// Browser-set Origin (proxy already pinned it to this loopback Host),
		// never a client-chosen value: it decides the OAuth redirect_uri.
		const origin = req.headers.get("origin") ?? new URL(req.url).origin;
		const res = startSpotifyLogin(origin);
		if (!res.ok) {
			return Response.json({ ok: false, error: res.error }, { status: 400 });
		}
		return Response.json(res);
	}

	return Response.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
