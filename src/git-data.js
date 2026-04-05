import path from "node:path";

import { run, shortenSha } from "./utils.js";

function git(repoPath, args) {
  return run("git", ["-C", repoPath, ...args], { windowsHide: true });
}

function tryGit(repoPath, args) {
  try {
    return git(repoPath, args);
  } catch {
    return "";
  }
}

function getRefType(refName) {
  if (refName.startsWith("refs/heads/")) {
    return "branch";
  }
  if (refName.startsWith("refs/remotes/")) {
    return "remote";
  }
  if (refName.startsWith("refs/tags/")) {
    return "tag";
  }
  return "ref";
}

function compareRefs(left, right) {
  const priority = {
    branch: 0,
    remote: 1,
    tag: 2,
    ref: 3,
  };

  const headDelta = Number(right.isHead) - Number(left.isHead);
  if (headDelta !== 0) {
    return headDelta;
  }

  const typeDelta = priority[left.type] - priority[right.type];
  if (typeDelta !== 0) {
    return typeDelta;
  }

  return left.name.localeCompare(right.name);
}

function parseCommitRecords(rawOutput) {
  if (!rawOutput) {
    return [];
  }

  return rawOutput
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record, row) => {
      const [sha, parentText, authorName, authorEmail, authoredAt, authoredIso, subject] =
        record.split("\x1f");

      return {
        sha,
        shortSha: shortenSha(sha),
        parents: parentText ? parentText.split(" ").filter(Boolean) : [],
        authorName,
        authorEmail,
        authoredAt: Number(authoredAt),
        authoredIso,
        subject: subject || "(no subject)",
        row,
        refs: [],
      };
    });
}

function loadRefs(repoPath, visibleCommitSet) {
  const format = "%(objectname)\t%(refname)\t%(refname:short)\t%(HEAD)";
  const rawOutput = git(repoPath, [
    "for-each-ref",
    `--format=${format}`,
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);

  const refsByCommit = new Map();
  const refs = [];

  for (const line of rawOutput.split(/\r?\n/).filter(Boolean)) {
    const [sha, fullName, shortName, headMarker] = line.split("\t");
    const ref = {
      sha,
      fullName,
      name: shortName,
      type: getRefType(fullName),
      isHead: headMarker === "*",
    };

    refs.push(ref);

    if (!visibleCommitSet.has(sha)) {
      continue;
    }

    const commitRefs = refsByCommit.get(sha) ?? [];
    commitRefs.push(ref);
    refsByCommit.set(sha, commitRefs);
  }

  for (const commitRefs of refsByCommit.values()) {
    commitRefs.sort(compareRefs);
  }

  refs.sort(compareRefs);

  return {
    refs,
    refsByCommit,
  };
}

function resolveSinceDays(sinceDays) {
  if (sinceDays == null || sinceDays === "") {
    return null;
  }

  if (!Number.isInteger(sinceDays) || sinceDays < 0) {
    throw new Error(`Invalid --since-days value: ${sinceDays}`);
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return new Date(Date.now() - sinceDays * millisecondsPerDay).toISOString();
}

export function loadRepositoryData(repoPath, options = {}) {
  const maxCommits = Number(options.maxCommits ?? 180);
  const sinceIso = resolveSinceDays(options.sinceDays);
  const rootPath = git(repoPath, ["rev-parse", "--show-toplevel"]).replaceAll("\\", "/");
  const repoName = path.basename(rootPath);
  const remoteUrl = tryGit(rootPath, ["config", "--get", "remote.origin.url"]);
  const headRef = tryGit(rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

  const format = ["%H", "%P", "%an", "%ae", "%at", "%aI", "%s"].join("%x1f");
  const logArgs = [
    "log",
    "--all",
    "--topo-order",
    "--date-order",
    `--max-count=${maxCommits}`,
  ];

  if (sinceIso) {
    logArgs.push(`--since=${sinceIso}`);
  }

  logArgs.push(`--format=${format}%x1e`);

  const rawCommits = git(rootPath, logArgs);
  const commits = parseCommitRecords(rawCommits);
  const visibleCommitSet = new Set(commits.map((commit) => commit.sha));
  const { refs, refsByCommit } = loadRefs(rootPath, visibleCommitSet);

  for (const commit of commits) {
    commit.refs = refsByCommit.get(commit.sha) ?? [];
  }

  return {
    repoPath: rootPath,
    repoName,
    remoteUrl,
    headRef,
    refs,
    commits,
  };
}
