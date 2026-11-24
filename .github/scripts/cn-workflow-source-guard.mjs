const SHA = /^[0-9a-f]{40}$/;
const protectedPaths = [
  ".github/workflows/pr-trusted.yml",
  ".github/workflows/ci-routing.yml",
  ".github/scripts/cn-workflow-source-guard.mjs",
  ".github/scripts/tests/cn-workflow-source-guard.test.mjs",
  ".github/scripts/tests/cn-workflow-identity.test.mjs",
  ".github/scripts/cn-workflow-review-context.mjs",
  ".github/scripts/tests/cn-workflow-review-context.test.mjs",
];

const normalize = (value) => value.replaceAll("\r\n", "\n");

const fail = (message) => {
  throw new Error(`Workflow source guard: ${message}`);
};

function callerPin(source) {
  if (typeof source !== "string") {
    fail("caller source is unavailable");
  }

  const candidates = [];
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?\s*$/gm)) {
    const target = match[1];
    if (target.includes(".github/workflows/pr-trusted.yml")) {
      candidates.push({ target, start: match.index, end: match.index + match[0].length });
    }
  }
  if (candidates.length !== 1) {
    fail("caller must contain exactly one trusted workflow reference");
  }

  const candidate = candidates[0];
  const match = candidate.target.match(
    /^penclipai\/paperclip-cn\/\.github\/workflows\/pr-trusted\.yml@([0-9a-f]{40})$/,
  );
  if (!match) {
    fail("caller must use the immutable trusted fork workflow reference");
  }
  return { sha: match[1], start: candidate.start, end: candidate.end, line: source.slice(candidate.start, candidate.end) };
}

function requiredFiles(currentFiles) {
  if (!currentFiles || typeof currentFiles !== "object" || Array.isArray(currentFiles)) {
    fail("current workflow source is unavailable");
  }
  for (const path of protectedPaths) {
    if (typeof currentFiles[path] !== "string") {
      fail("current workflow source is incomplete");
    }
  }
}

function readSource(readAt, sha, path) {
  let value;
  try {
    value = readAt(sha, path);
  } catch {
    fail("trusted workflow source could not be read");
  }
  if (typeof value !== "string") {
    fail("trusted workflow source is unavailable");
  }
  return normalize(value);
}

function ancestorOf(isAncestor, ancestor, descendant) {
  let result;
  try {
    result = isAncestor(ancestor, descendant);
  } catch {
    fail("trusted ancestry could not be verified");
  }
  if (result !== true) {
    fail("trusted workflow commit is not an ancestor of the approved base");
  }
}

/**
 * Verifies that a reusable-workflow source update is dormant, or is a
 * protected immutable-pin rotation. This is a local source-integrity guard;
 * protected-branch review and runner policy remain external requirements.
 */
export function verifyWorkflowSourceUpdate({
  baseSha,
  baseCaller,
  caller,
  readAt,
  currentFiles,
  isAncestor,
}) {
  if (!SHA.test(baseSha ?? "")) {
    fail("approved base SHA must be a full lowercase commit SHA");
  }
  if (typeof readAt !== "function" || typeof isAncestor !== "function") {
    fail("trusted git callbacks are unavailable");
  }
  if (typeof baseCaller !== "string" || typeof caller !== "string") {
    fail("caller source is unavailable");
  }
  requiredFiles(currentFiles);

  const normalizedBaseCaller = normalize(baseCaller);
  const normalizedCaller = normalize(caller);
  const oldCaller = callerPin(normalizedBaseCaller);
  const newCaller = callerPin(normalizedCaller);
  ancestorOf(isAncestor, oldCaller.sha, baseSha);

  const activeTrusted = readSource(
    readAt,
    oldCaller.sha,
    ".github/workflows/pr-trusted.yml",
  );
  const delegatesRouting = /uses:\s*\.\/\.github\/workflows\/ci-routing\.yml(?:\s|$)/m.test(
    activeTrusted,
  );
  const activeRouting = delegatesRouting
    ? readSource(readAt, oldCaller.sha, ".github/workflows/ci-routing.yml")
    : null;

  if (normalizedCaller === normalizedBaseCaller) {
    return {
      mode: "dormant-source",
      pinnedSha: oldCaller.sha,
      activeTrusted,
      activeRouting,
    };
  }

  if (newCaller.sha === oldCaller.sha) {
    fail("caller changed without rotating its immutable workflow pin");
  }
  const expectedCaller = `${normalizedBaseCaller.slice(0, oldCaller.start)}${oldCaller.line.replace(oldCaller.sha, newCaller.sha)}${normalizedBaseCaller.slice(oldCaller.end)}`;
  if (normalizedCaller !== expectedCaller) {
    fail("caller may only replace the trusted workflow commit SHA");
  }
  ancestorOf(isAncestor, newCaller.sha, baseSha);

  for (const path of protectedPaths) {
    if (normalize(currentFiles[path]) !== readSource(readAt, newCaller.sha, path)) {
      fail("protected workflow source does not match its immutable pin");
    }
  }

  return {
    mode: "protected-pin-update",
    pinnedSha: newCaller.sha,
    activeTrusted,
    activeRouting,
  };
}
