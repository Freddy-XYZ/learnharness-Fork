import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

type Job = { permissions?: Record<string, string>; steps: { uses?: string; run?: string }[] };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load(source: string): Workflow };
const workflow = yaml.load(readFileSync(new URL("../.github/workflows/gemini-review.yml", import.meta.url), "utf8"));
const reviewJob = workflow.jobs.review!;

test("gemini review workflow triggers and minimal scopes", () => {
	assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "workflow_dispatch"]);
	assert.deepEqual((workflow.on.pull_request as { types: string[] }).types, ["opened", "synchronize", "reopened"]);
	assert.equal(workflow.permissions.contents, "read");
	assert.equal(workflow.permissions["pull-requests"], "write");
	assert.equal(workflow.permissions.issues, "write");

	const runs = reviewJob.steps.map((s) => s.run).filter(Boolean);
	assert.ok(runs.some((r) => r?.includes("node scripts/gemini-pr-review.mjs")), "executes review script");
});

test("filterDiff ignores lockfiles and preserves code diffs", async () => {
	const { filterDiff } = await import("../scripts/gemini-pr-review.mjs");
	const diff = `diff --git a/package-lock.json b/package-lock.json
index 123..456 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
-old
+new
diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
-console.log(1)
+console.log(2)
`;
	const filtered = filterDiff(diff);
	assert.doesNotMatch(filtered, /package-lock\.json/);
	assert.match(filtered, /src\/app\.ts/);
});
