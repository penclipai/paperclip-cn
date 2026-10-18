import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleasePackagePlan,
  checkConfiguration,
  findUnpublishableWorkspaceEdges,
  getReleasePackages,
  getReleaseRepositoryIdentity,
  findReleaseRepositoryIdentityProblems,
} from "./release-package-map.mjs";

function pkg(name, { publishFromCi, ...deps } = {}) {
  return { name, dir: name, publishFromCi, pkg: { name, ...deps } };
}

test("release package manifest covers all public packages with explicit CI enrollment", () => {
  const packages = buildReleasePackagePlan();
  assert.ok(packages.length > 0);
  assert.ok(packages.every((pkg) => typeof pkg.publishFromCi === "boolean"));
});

test("release package list only contains CI-enrolled packages", () => {
  const enabledPackages = getReleasePackages();
  assert.ok(enabledPackages.length > 0);
  assert.ok(enabledPackages.every((pkg) => pkg.publishFromCi === true));
});

test("release package list publishes the installable channel entrypoint last", () => {
  const enabledPackages = getReleasePackages();

  assert.equal(enabledPackages.at(-1)?.name, "penclip");
  assert.ok(enabledPackages.slice(0, -1).some((pkg) => pkg.name === "@penclipai/server"));
});

test("release package list keeps runtime workspace dependencies ahead of consumers", () => {
  const enabledPackages = getReleasePackages();
  const publishIndexByName = new Map(enabledPackages.map((pkg, index) => [pkg.name, index]));

  for (const pkg of enabledPackages) {
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, spec] of Object.entries(pkg.pkg[section] ?? {})) {
        if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
        const dependencyIndex = publishIndexByName.get(dependencyName);
        if (dependencyIndex === undefined) continue;

        assert.ok(
          dependencyIndex < publishIndexByName.get(pkg.name),
          `${dependencyName} must publish before ${pkg.name}`,
        );
      }
    }
  }
});

test("release surface includes the CN fork's built-in Hermes adapter", () => {
  const packages = buildReleasePackagePlan();
  const hermes = packages.find((pkg) => pkg.name === "@penclipai/hermes-paperclip-adapter");
  const gatewayShim = packages.find((pkg) => pkg.name === "@penclipai/adapter-hermes-gateway");

  assert.ok(hermes);
  assert.equal(hermes.publishFromCi, true);
  assert.ok(gatewayShim);
  assert.equal(gatewayShim.publishFromCi, false);
});

test("release package configuration validates successfully", () => {
  assert.doesNotThrow(() => checkConfiguration());
});

test("release package repository identity accepts canonical GitHub HTTPS and git forms", () => {
  for (const repository of [
    "https://github.com/penclipai/paperclip-cn",
    "https://github.com/penclipai/paperclip-cn.git",
    "git+https://github.com/penclipai/paperclip-cn.git",
    "git@github.com:penclipai/paperclip-cn.git",
  ]) {
    assert.equal(getReleaseRepositoryIdentity(repository), "penclipai/paperclip-cn");
  }
});

test("release package repository identity rejects malformed, missing, and non-GitHub values", () => {
  for (const repository of [
    undefined,
    {},
    "https://example.com/penclipai/paperclip-cn",
    "git@github.com:penclipai",
    "https://user:secret@github.com/penclipai/paperclip-cn",
    "https://github.com:8443/penclipai/paperclip-cn",
    "https://github.com/penclipai/paperclip-cn?ref=main",
    "https://github.com/penclipai/paperclip-cn#readme",
  ]) {
    assert.throws(() => getReleaseRepositoryIdentity(repository), /repository/);
  }
});

test("release package repository guard rejects upstream, wrong-owner, and missing identities", () => {
  const packages = [
    pkg("@penclipai/upstream", {
      publishFromCi: true,
      repository: "https://github.com/paperclipai/paperclip",
    }),
    pkg("@penclipai/wrong-owner", {
      publishFromCi: true,
      repository: "https://github.com/example/paperclip-cn",
    }),
    pkg("@penclipai/missing", { publishFromCi: true }),
    pkg("@penclipai/off-train", {
      publishFromCi: false,
      repository: "https://github.com/paperclipai/paperclip",
    }),
  ];

  const problems = findReleaseRepositoryIdentityProblems(packages, "penclipai/paperclip-cn");

  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /@penclipai\/upstream/);
  assert.match(problems.join("\n"), /@penclipai\/wrong-owner/);
  assert.match(problems.join("\n"), /@penclipai\/missing/);
  assert.doesNotMatch(problems.join("\n"), /@penclipai\/off-train/);
});

test("release package repository guard anchors CI identity to the CN fork", () => {
  assert.throws(
    () => findReleaseRepositoryIdentityProblems([], "paperclipai/paperclip"),
    /GITHUB_REPOSITORY must be penclipai\/paperclip-cn/,
  );
});

test("every CI-published package carries the CN fork repository identity", () => {
  assert.deepEqual(
    findReleaseRepositoryIdentityProblems(buildReleasePackagePlan(), "penclipai/paperclip-cn"),
    [],
  );
});

test("guard flags a publishFromCi:true package depending on a publishFromCi:false package", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@penclipai/server", {
      publishFromCi: true,
      dependencies: { "@penclipai/skills-catalog": "workspace:*" },
    }),
    pkg("@penclipai/skills-catalog", { publishFromCi: false }),
  ]);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /@penclipai\/server/);
  assert.match(problems[0], /@penclipai\/skills-catalog/);
});

test("guard inspects optional and peer dependency sections too", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@penclipai/server", {
      publishFromCi: true,
      optionalDependencies: { "@penclipai/opt": "workspace:^" },
      peerDependencies: { "@penclipai/peer": "workspace:*" },
    }),
    pkg("@penclipai/opt", { publishFromCi: false }),
    pkg("@penclipai/peer", { publishFromCi: false }),
  ]);

  assert.equal(problems.length, 2);
});

test("guard treats a workspace dep on an unknown @penclipai package as unpublishable", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@penclipai/server", {
      publishFromCi: true,
      dependencies: { "@penclipai/private-internal": "workspace:*" },
    }),
  ]);

  assert.equal(problems.length, 1);
});

test("guard allows true->true workspace edges", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@penclipai/server", {
      publishFromCi: true,
      dependencies: { "@penclipai/shared": "workspace:*" },
    }),
    pkg("@penclipai/shared", { publishFromCi: true }),
  ]);

  assert.deepEqual(problems, []);
});

test("guard allows upstream-compatible workspace aliases to published CN packages", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@penclipai/plugin-workspace-diff", {
      publishFromCi: true,
      dependencies: { "@penclipai/plugin-sdk": "workspace:@penclipai/plugin-sdk@*" },
    }),
    pkg("@penclipai/plugin-sdk", { publishFromCi: true }),
  ]);

  assert.deepEqual(problems, []);
});

test("guard ignores non-workspace specs, non-internal deps, and edges from off-train packages", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@penclipai/server", {
      publishFromCi: true,
      dependencies: {
        "@penclipai/pinned": "0.3.1",
        zod: "^3.0.0",
      },
    }),
    pkg("@penclipai/pinned", { publishFromCi: false }),
    pkg("@penclipai/offtrain", {
      publishFromCi: false,
      dependencies: { "@penclipai/also-off": "workspace:*" },
    }),
    pkg("@penclipai/also-off", { publishFromCi: false }),
  ]);

  assert.deepEqual(problems, []);
});

test("the live release manifest has no unpublishable workspace edges", () => {
  assert.deepEqual(findUnpublishableWorkspaceEdges(buildReleasePackagePlan()), []);
});
