"use strict";

/** Only these schemes leave the app via shell.openExternal: link targets
 * come from model-written content, and file:/custom schemes can launch
 * local programs. */
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function externalURLAllowed(target) {
	try {
		return EXTERNAL_PROTOCOLS.has(new URL(target).protocol);
	} catch {
		return false;
	}
}
module.exports = { externalURLAllowed };
