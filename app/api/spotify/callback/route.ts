import { completeSpotifyCallback } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const url = new URL(req.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");

	if (error) {
		return new Response(renderCallbackHtml(false, `Spotify authorization cancelled: ${error}`), {
			status: 400,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (!code || !state) {
		return new Response(renderCallbackHtml(false, "Missing code or state parameter."), {
			status: 400,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	const result = await completeSpotifyCallback(code, state, url.origin);
	if (!result.ok) {
		return new Response(renderCallbackHtml(false, result.error), {
			status: 400,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	return new Response(renderCallbackHtml(true, "Spotify successfully connected! You can close this window."), {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function renderCallbackHtml(ok: boolean, message: string): string {
	const safeMsg = escapeHtml(message);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Spotify Connection — Learning Harness</title>
<style>
	body {
		background: #0d0d0d;
		color: #f2f0ec;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100vh;
		margin: 0;
	}
	.card {
		border: 1px solid #262626;
		border-radius: 12px;
		padding: 24px 32px;
		max-width: 420px;
		text-align: center;
		background: #141414;
	}
	.badge {
		display: inline-block;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 11px;
		margin-bottom: 12px;
		background: ${ok ? "rgba(30, 215, 96, 0.15)" : "rgba(239, 68, 68, 0.15)"};
		color: ${ok ? "#1ed760" : "#f87171"};
	}
	p { font-size: 13px; line-height: 1.5; color: #a3a3a3; margin: 8px 0 0; }
</style>
</head>
<body>
	<div class="card">
		<div class="badge">${ok ? "CONNECTED" : "ERROR"}</div>
		<div>${safeMsg}</div>
		<p>${ok ? "Returning to Learning Harness…" : "Please return to Settings and try again."}</p>
	</div>
	<script>
		if (${ok ? "true" : "false"}) {
			try {
				if (window.opener) {
					window.opener.postMessage({ type: "lh:spotify-connected" }, "*");
				}
			} catch (e) {}
			setTimeout(function() {
				window.close();
			}, 600);
		}
	</script>
</body>
</html>`;
}
