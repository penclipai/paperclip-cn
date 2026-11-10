import assert from "node:assert/strict";

const SHA = /^[a-f0-9]{40}$/;
const repository = "penclipai/paperclip-cn";

/** Establish the source-review base, not runner authorization or human approval. */
export function workflowReviewBase({ env, event, checkoutSha, parents, isAncestor, localBase }) {
  if (env.GITHUB_ACTIONS !== "true") {
    assert.match(localBase ?? "", SHA, "Fetch the fork master before local workflow review");
    return localBase;
  }
  assert.equal(env.GITHUB_REPOSITORY, repository, "Unexpected workflow review repository");
  assert.equal(env.GITHUB_REPOSITORY_ID, "1192887762", "Unexpected workflow review repository ID");
  assert.equal(env.GITHUB_EVENT_NAME, "pull_request", "Workflow source review requires the PR merge context");
  const pr = event?.pull_request;
  assert.equal(pr?.base?.repo?.full_name, repository, "Unexpected PR base repository");
  assert.equal(pr?.base?.repo?.id, 1192887762, "Unexpected PR base repository ID");
  assert.equal(pr?.base?.ref, "master", "Workflow changes must target the fork master");
  assert.match(pr?.base?.sha ?? "", SHA, "Missing PR base SHA");
  assert.match(pr?.head?.sha ?? "", SHA, "Missing PR head SHA");
  assert.match(env.GITHUB_SHA ?? "", SHA, "Missing GitHub merge SHA");
  assert.equal(checkoutSha, env.GITHUB_SHA, "Review must use the tested GitHub merge checkout");
  assert.equal(parents?.length, 2, "Review requires the immutable merge and both parents");
  assert.match(parents[0], SHA, "Invalid merge base parent");
  assert.equal(parents[1], pr.head.sha, "Merge checkout does not contain the event's exact PR head");
  assert.equal(isAncestor(pr.base.sha, parents[0]), true, "Merge base must descend from the event's protected base");
  return parents[0];
}
