/** The auto-merge bulldozer's security shape: it may only ever act on the
 * owner's own PRs, never run PR code, and keep its token scopes minimal. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

type Job = { if?: string; permissions?: Record<string, string>; steps: { uses?: string; run?: string }[] };
type Workflow = { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };

const yaml = createRequire(import.meta.url)("js-yaml") as { load(source: string): Workflow };
const workflow = yaml.load(readFileSync(new URL("../.github/workflows/bulldozer.yml", import.meta.url), "utf8"));
const enable = workflow.jobs["enable-auto-merge"]!;
const sweep = workflow.jobs["update-behind"]!;

test("bulldozer never runs PR code and never acts on forks or other authors", () => {
	assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "schedule", "workflow_dispatch"], "no pull_request_target");
	assert.deepEqual((workflow.on.pull_request as { types: string[] }).types, ["opened", "reopened", "ready_for_review"]);
	assert.deepEqual(workflow.permissions, {}, "no workflow-wide token scopes");
	for (const job of [enable, sweep]) {
		for (const step of job.steps) assert.equal(step.uses, undefined, "no checkout, no third-party actions");
	}
	for (const guard of [
		"!github.event.pull_request.draft",
		"github.event.pull_request.head.repo.full_name == github.repository",
		"github.event.pull_request.user.login == github.repository_owner",
	]) assert.ok(enable.if?.includes(guard), guard);
	assert.equal(sweep.if, "github.event_name != 'pull_request'");
	assert.match(sweep.steps[0]!.run!, /\.isCrossRepository \| not/, "the sweep skips fork PRs too");
	assert.deepEqual(enable.permissions, { contents: "write", "pull-requests": "write" });
	assert.deepEqual(sweep.permissions, { contents: "write", "pull-requests": "write", actions: "write" });
});
