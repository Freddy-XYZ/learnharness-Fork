import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { isPublicAddress, nonPublicReason, publicFetch } from "../src/agent/tools/public-fetch.ts";
import { createWebTools } from "../src/agent/tools/web.ts";

test("isPublicAddress: only globally routable addresses pass", () => {
	for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "::ffff:808:808"]) assert.equal(isPublicAddress(ip), true, ip);
	for (const ip of [
		"127.0.0.1", "127.8.9.10", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
		"100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
		"::1", "::", "[::1]", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
		"::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "not-an-ip", "",
	]) assert.equal(isPublicAddress(ip), false, ip);
});

test("publicFetch refuses this machine by IP literal and by DNS name, before any request is sent", async (t) => {
	let hits = 0;
	const server = http.createServer((_req, res) => { hits++; res.end("internal"); });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const { port } = server.address() as AddressInfo;
	for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`]) {
		const err = await publicFetch(url).then(() => null, (e: unknown) => e);
		assert.match(nonPublicReason(err) ?? "", /^blocked: .* non-public address/, url);
	}
	assert.equal(hits, 0);
});

test("web_fetch reports a blocked internal URL instead of fetching it", async () => {
	const tools = createWebTools(() => null);
	const result = await tools.web_fetch!.execute("call-1", { url: "http://169.254.169.254/latest/meta-data/" });
	const text = JSON.stringify(result);
	assert.match(text, /web_fetch failed for http:\/\/169\.254\.169\.254\/latest\/meta-data\/: blocked: /);
});
