import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import test from "node:test";

import { loadRepositoryData } from "../src/git-data.js";
import { layoutGraph } from "../src/layout.js";

function git(repoPath, args, options = {}) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...options,
  }).trim();
}

function commitFile(repoPath, fileName, content, message, options = {}) {
  writeFileSync(path.join(repoPath, fileName), content, "utf8");
  git(repoPath, ["add", fileName]);

  const env = options.date
    ? {
        ...process.env,
        GIT_AUTHOR_DATE: options.date,
        GIT_COMMITTER_DATE: options.date,
      }
    : undefined;

  git(repoPath, ["commit", "-m", message], env ? { env } : {});
}

function createFixtureRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), "gitvision-"));
  git(path.dirname(repoPath), ["init", "-b", "main", repoPath]);
  git(repoPath, ["config", "user.name", "GitVision Test"]);
  git(repoPath, ["config", "user.email", "gitvision@example.com"]);

  commitFile(repoPath, "README.md", "# Demo\n", "Initial commit");
  git(repoPath, ["checkout", "-b", "feature/render"]);
  commitFile(repoPath, "feature.txt", "lane\n", "Add feature lane");
  git(repoPath, ["checkout", "main"]);
  commitFile(repoPath, "main.txt", "mainline\n", "Update mainline");
  git(repoPath, ["merge", "--no-ff", "feature/render", "-m", "Merge feature lane"]);

  return repoPath;
}

function createDivergedRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), "gitvision-main-"));
  git(path.dirname(repoPath), ["init", "-b", "main", repoPath]);
  git(repoPath, ["config", "user.name", "GitVision Test"]);
  git(repoPath, ["config", "user.email", "gitvision@example.com"]);

  commitFile(repoPath, "README.md", "# Demo\n", "Initial commit");
  commitFile(repoPath, "main.txt", "main\n", "Main baseline");
  git(repoPath, ["checkout", "-b", "feature/render"]);
  commitFile(repoPath, "feature.txt", "feature 1\n", "Feature tip 1");
  commitFile(repoPath, "feature.txt", "feature 2\n", "Feature tip 2");

  return repoPath;
}

function createTimedRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), "gitvision-time-"));
  git(path.dirname(repoPath), ["init", "-b", "main", repoPath]);
  git(repoPath, ["config", "user.name", "GitVision Test"]);
  git(repoPath, ["config", "user.email", "gitvision@example.com"]);

  const day = 24 * 60 * 60 * 1000;
  const oldDate = new Date(Date.now() - 400 * day).toISOString();
  const recentDate = new Date(Date.now() - 10 * day).toISOString();

  commitFile(repoPath, "old.txt", "old\n", "Old commit", { date: oldDate });
  commitFile(repoPath, "recent.txt", "recent\n", "Recent commit", { date: recentDate });

  return repoPath;
}

function findCommitByRef(graph, refName) {
  return graph.commits.find((commit) =>
    commit.refs.some((ref) => ref.name === refName || ref.fullName === refName),
  );
}

test("CLI renders an SVG graph for a repository with branches and merges", () => {
  const repoPath = createFixtureRepository();
  const outputDir = path.join(repoPath, "artifacts");
  const outputPath = path.join(outputDir, "graph.svg");
  mkdirSync(outputDir, { recursive: true });

  execFileSync(process.execPath, ["src/cli.js", "render", repoPath, "-o", outputPath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  assert.equal(existsSync(outputPath), true);
  const svg = readFileSync(outputPath, "utf8");
  assert.match(svg, /<svg/);
  assert.match(svg, /Merge feature lane/);
  assert.match(svg, /feature\/render/);
  assert.match(svg, /Maple Mono Normal NF CN/);
  assert.match(svg, /class="hash"/);
  assert.match(svg, /path/);
});

test("main branch option keeps the selected first-parent chain on lane 0", () => {
  const repoPath = createDivergedRepository();
  const repository = loadRepositoryData(repoPath, { maxCommits: 20 });
  const defaultGraph = layoutGraph(repository);
  const mainGraph = layoutGraph(repository, { mainBranch: "main" });

  const defaultMain = findCommitByRef(defaultGraph, "main");
  const defaultFeature = findCommitByRef(defaultGraph, "feature/render");
  const mainTip = findCommitByRef(mainGraph, "main");
  const featureTip = findCommitByRef(mainGraph, "feature/render");

  assert.ok(defaultMain);
  assert.ok(defaultFeature);
  assert.ok(mainTip);
  assert.ok(featureTip);
  assert.equal(mainTip.lane, 0);
  assert.notEqual(featureTip.lane, 0);
  assert.equal(defaultFeature.lane, 0);
});

test("main branch option fails fast for an unknown branch", () => {
  const repoPath = createFixtureRepository();
  const repository = loadRepositoryData(repoPath, { maxCommits: 20 });

  assert.throws(
    () => layoutGraph(repository, { mainBranch: "missing" }),
    /Main branch not found: missing/,
  );
});

test("since-days filters out commits older than the requested window", () => {
  const repoPath = createTimedRepository();
  const repository = loadRepositoryData(repoPath, { maxCommits: 20, sinceDays: 30 });

  assert.equal(repository.commits.length, 1);
  assert.equal(repository.commits[0].subject, "Recent commit");
});

test("since-days rejects invalid values", () => {
  const repoPath = createFixtureRepository();

  assert.throws(
    () => loadRepositoryData(repoPath, { sinceDays: -1 }),
    /Invalid --since-days value: -1/,
  );
});
