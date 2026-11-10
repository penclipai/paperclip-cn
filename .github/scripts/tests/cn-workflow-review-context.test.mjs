import assert from "node:assert/strict";
import test from "node:test";
import { workflowReviewBase } from "../cn-workflow-review-context.mjs";

const oldBase = "a".repeat(40), base = "b".repeat(40), head = "c".repeat(40), merge = "d".repeat(40);
const fixture = () => ({
  env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "penclipai/paperclip-cn", GITHUB_REPOSITORY_ID: "1192887762", GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: merge },
  event: { pull_request: { base: { repo: { full_name: "penclipai/paperclip-cn", id: 1192887762 }, ref: "master", sha: oldBase }, head: { sha: head } } },
  checkoutSha: merge, parents: [base, head],
  isAncestor: (ancestor, descendant) => ancestor === oldBase && descendant === base,
});

test("reviews the exact merge first parent even when the event base is stale", () => {
  assert.equal(workflowReviewBase(fixture()), base);
});

test("local review requires an explicit resolved fork base", () => {
  assert.equal(workflowReviewBase({ env: {}, localBase: base }), base);
  assert.throws(() => workflowReviewBase({ env: {} }), /Fetch the fork master/);
});

for (const [name, mutate] of [
  ["foreign repository", f => { f.env.GITHUB_REPOSITORY = "paperclipai/paperclip"; }],
  ["foreign repository ID", f => { f.env.GITHUB_REPOSITORY_ID = "1170821064"; }],
  ["non-PR event", f => { f.env.GITHUB_EVENT_NAME = "workflow_dispatch"; }],
  ["missing event", f => { f.event = null; }],
  ["foreign PR base", f => { f.event.pull_request.base.repo.full_name = "paperclipai/paperclip"; }],
  ["foreign PR base ID", f => { f.event.pull_request.base.repo.id = 1170821064; }],
  ["non-master target", f => { f.event.pull_request.base.ref = "candidate/release"; }],
  ["invalid base SHA", f => { f.event.pull_request.base.sha = "master"; }],
  ["invalid head SHA", f => { f.event.pull_request.head.sha = "HEAD"; }],
  ["missing GitHub SHA", f => { delete f.env.GITHUB_SHA; }],
  ["wrong checkout", f => { f.checkoutSha = head; }],
  ["single-parent checkout", f => { f.parents = [base]; }],
  ["extra-parent checkout", f => { f.parents.push(oldBase); }],
  ["wrong PR parent", f => { f.parents[1] = oldBase; }],
  ["divergent base", f => { f.isAncestor = () => false; }],
]) {
  test(`rejects ${name} without a local fallback`, () => {
    const input = fixture(); mutate(input); input.localBase = base;
    assert.throws(() => workflowReviewBase(input));
  });
}
