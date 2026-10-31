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
	let body: { action?: string; origin?: string } = {};
	try {
		body = (await req.json()) as { action?: string; origin?: string };
	} catch {
		/* empty body */
	}

	if (body.action === "disconnect") {
		disconnectSpotify();
		return Response.json({ ok: true, status: getSpotifyStatus() });
	}

	if (body.action === "login") {
		const reqUrl = new URL(req.url);
		const origin = body.origin || reqUrl.origin;
		const res = startSpotifyLogin(origin);
		if (!res.ok) {
			return Response.json({ ok: false, error: res.error }, { status: 400 });
		}
		return Response.json(res);
	}

	return Response.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
