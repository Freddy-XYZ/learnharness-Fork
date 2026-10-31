import {
	executeSpotifyPlayerCommand,
	fetchSpotifyPlaybackState,
	fetchSpotifyPlaylists,
	searchSpotifyTracks,
	type SpotifyPlayerCommand,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const url = new URL(req.url);
	const view = url.searchParams.get("view");
	const query = url.searchParams.get("q");

	if (view === "playlists") {
		const playlists = await fetchSpotifyPlaylists();
		return Response.json({ playlists });
	}

	if (query !== null) {
		const tracks = await searchSpotifyTracks(query);
		return Response.json({ tracks });
	}

	const playback = await fetchSpotifyPlaybackState();
	return Response.json({ playback });
}

export async function POST(req: Request) {
	let body: SpotifyPlayerCommand;
	try {
		body = (await req.json()) as SpotifyPlayerCommand;
	} catch {
		return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
	}

	if (!body || typeof body.action !== "string") {
		return Response.json({ ok: false, error: "Missing action" }, { status: 400 });
	}

	const result = await executeSpotifyPlayerCommand(body);
	if (!result.ok) {
		return Response.json(result, { status: 400 });
	}
	// For continuous sliders (volume / seek), return immediately without waiting
	// or re-fetching playback state so the slider never lags or snaps back.
	if (body.action === "volume" || body.action === "seek") {
		return Response.json({ ok: true });
	}
	// Spotify's playback endpoints update asynchronously (~220ms); wait briefly
	// so the returned state reflects the newly started track/status.
	await new Promise((r) => setTimeout(r, 220));
	const playback = await fetchSpotifyPlaybackState();
	return Response.json({ ok: true, playback });
}
