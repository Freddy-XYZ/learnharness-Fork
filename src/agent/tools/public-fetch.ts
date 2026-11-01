import dns from "node:dns";
import net from "node:net";
import { Agent, buildConnector } from "undici";

/**
 * Public-internet-only fetch for the model-driven web tools (web_fetch,
 * web_fetch_pdf). A URL the model chose — possibly steered by prompt
 * injection in a fetched page — must never reach this machine, the LAN, or
 * cloud metadata (169.254.169.254).
 *
 * The check runs at CONNECT time on every connection, so redirects and DNS
 * rebinding (public answer first, private answer on the real connect) are
 * covered too: DNS names go through a checking `lookup`, IP literals (which
 * Node connects without a lookup) through the connector wrapper.
 *
 * Uses the global fetch with an undici `dispatcher` (Node's documented
 * custom-dispatcher seam), so tests that stub globalThis.fetch keep working.
 */

const blocked = new net.BlockList();
for (const [prefix, bits] of [
	["0.0.0.0", 8], // "this network"
	["10.0.0.0", 8],
	["100.64.0.0", 10], // carrier-grade NAT
	["127.0.0.0", 8],
	["169.254.0.0", 16], // link-local, cloud metadata
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15], // benchmarking
	["224.0.0.0", 4], // multicast
	["240.0.0.0", 4], // reserved + broadcast
] as const) blocked.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [
	["::", 128], // unspecified
	["::1", 128],
	["64:ff9b:1::", 48], // local-use NAT64
	["fc00::", 7], // unique local
	["fe80::", 10], // link-local
	["ff00::", 8], // multicast
] as const) blocked.addSubnet(prefix, bits, "ipv6");

/** True only for globally routable addresses. BlockList checks IPv4-mapped
 *  IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1) against the IPv4 rules itself.
 *  Non-IP input is not public. */
export function isPublicAddress(address: string): boolean {
	const ip = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
	const family = net.isIP(ip);
	if (family === 0) return false;
	return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

function blockedError(host: string, address: string): Error {
	return Object.assign(new Error(`blocked: ${host} resolves to the non-public address ${address}`), { code: "ERR_NON_PUBLIC_ADDRESS" });
}

const checkedLookup: net.LookupFunction = (hostname, options, callback) => {
	dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
		if (err) return callback(err, "", 0);
		const bad = addresses.find((a) => !isPublicAddress(a.address));
		if (bad) return callback(blockedError(hostname, bad.address), "", 0);
		const first = addresses[0];
		if (!first) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "", 0);
		if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
		callback(null, first.address, first.family);
	});
};

const connect = buildConnector({ lookup: checkedLookup });

const publicAgent = new Agent({
	connect(options, callback) {
		if (net.isIP(options.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(options.hostname)) {
			callback(blockedError(options.hostname, options.hostname), null);
			return;
		}
		connect(options, callback);
	},
});

/** fetch() that only ever connects to public internet addresses. */
export function publicFetch(url: string, init: RequestInit = {}): Promise<Response> {
	return fetch(url, { ...init, dispatcher: publicAgent } as RequestInit);
}

/** The error text for a blocked fetch (fetch wraps connect errors as
 *  "fetch failed" with the reason on `cause`), or null for other errors. */
export function nonPublicReason(err: unknown): string | null {
	const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
	return cause?.code === "ERR_NON_PUBLIC_ADDRESS" ? (cause.message ?? "blocked: non-public address") : null;
}
