#!/usr/bin/env node

import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ALLOWED_EXTRA_FLAGS = new Set(["--format", "--max-commits", "--since-days", "--title"]);
const FLAGS_REQUIRING_VALUE = new Set(["--format", "--max-commits", "--since-days", "--title"]);
const DEFAULT_FORMAT = "svg";
const GITHUB_SHORTCUT_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const output = [stderr, stdout].filter(Boolean).join("\n");
    const details = output ? `\n${output}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${details}`);
  }
}

function requireInput(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}

function tokenizeArgs(input) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escape = false;

  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escape || quote) {
    throw new Error("Invalid extra args: unmatched quote or trailing escape.");
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseExtraArgs(input) {
  const tokens = tokenizeArgs(input.trim());
  const parsed = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Invalid extra arg: ${token}. Only long-form flags are allowed.`);
    }

    const [flag, inlineValue] = token.split("=", 2);
    if (!ALLOWED_EXTRA_FLAGS.has(flag)) {
      throw new Error(`Unsupported extra arg: ${flag}`);
    }

    let value = inlineValue ?? "";
    if (!inlineValue && FLAGS_REQUIRING_VALUE.has(flag)) {
      const nextToken = tokens[index + 1];
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
      }
      value = nextToken;
      index += 1;
    }

    parsed.push({ flag, value });
  }

  return parsed;
}

export function sanitizeSegment(value, fallback = "value") {
  const sanitized = String(value)
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

function isLocalRepositoryPath(value) {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.startsWith("\\")
  );
}

function buildGitHubShortcutInfo(shortcut) {
  const normalized = shortcut.replace(/\.git$/i, "");
  const [owner, repo] = normalized.split("/", 2);

  return {
    originalUrl: shortcut,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    host: "github.com",
    owner,
    repo,
  };
}

export function parseRepositoryInfo(repoUrl) {
  const trimmed = repoUrl.trim();

  if (isLocalRepositoryPath(trimmed)) {
    const repoName = path.basename(trimmed).replace(/\.git$/i, "");
    return {
      originalUrl: trimmed,
      cloneUrl: trimmed,
      host: "",
      owner: "Local",
      repo: repoName || "Repository",
    };
  }

  const sshMatch = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  if (sshMatch) {
    return buildRepositoryInfo(trimmed, sshMatch[1], sshMatch[2]);
  }

  if (GITHUB_SHORTCUT_PATTERN.test(trimmed)) {
    return buildGitHubShortcutInfo(trimmed);
  }

  try {
    const url = new URL(trimmed);
    return buildRepositoryInfo(trimmed, url.hostname, url.pathname);
  } catch {
    const repoName = path.basename(trimmed).replace(/\.git$/i, "");
    return {
      originalUrl: trimmed,
      cloneUrl: trimmed,
      host: "",
      owner: "Local",
      repo: repoName || "Repository",
    };
  }
}

function buildRepositoryInfo(originalUrl, host, pathname) {
  const segments = String(pathname)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);

  const repo = segments.at(-1) || "Repository";
  const owner = segments.at(-2) || "Owner";
  const normalizedHost = String(host).toLowerCase();

  return {
    originalUrl,
    cloneUrl: originalUrl,
    host: normalizedHost,
    owner,
    repo,
  };
}

function buildAuthenticatedClone(repoInfo, token) {
  if (!token || repoInfo.host !== "github.com") {
    return {
      cloneUrl: repoInfo.cloneUrl,
      gitConfig: [],
    };
  }

  const cloneUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
  const basicAuth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    cloneUrl,
    gitConfig: ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basicAuth}`],
  };
}

export function entriesToArgs(entries) {
  const args = [];
  for (const entry of entries) {
    args.push(entry.flag);
    if (entry.value) {
      args.push(entry.value);
    }
  }
  return args;
}

export function resolveFormat(entries) {
  const formatEntry = entries.find((entry) => entry.flag === "--format");
  return formatEntry?.value?.toLowerCase() || DEFAULT_FORMAT;
}

function compressParameterEntry(entry) {
  switch (entry.flag) {
    case "--max-commits":
      return `mc${sanitizeSegment(entry.value, "0")}`;
    case "--since-days":
      return `d${sanitizeSegment(entry.value, "0")}`;
    case "--format":
      return sanitizeSegment(entry.value, "svg").toLowerCase();
    case "--title":
      return `t${sanitizeSegment(entry.value, "title").slice(0, 32)}`;
    default:
      return sanitizeSegment(`${entry.flag}-${entry.value}`, "arg");
  }
}

export function buildParameterSlug(entries) {
  if (entries.length === 0) {
    return "default";
  }

  return entries.map((entry) => compressParameterEntry(entry)).join("-");
}

function writeOutput(name, value) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `${name}=${value}\n`, "utf8");
  }
}

function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const repoUrl = requireInput("WORKFLOW_REPO_URL");
  const mainBranch = requireInput("WORKFLOW_MAIN_BRANCH");
  const extraArgsInput = process.env.WORKFLOW_EXTRA_ARGS || "";
  const repoReadPat = (process.env.WORKFLOW_REPO_READ_PAT || "").trim();
  const repoInfo = parseRepositoryInfo(repoUrl);
  const extraArgEntries = parseExtraArgs(extraArgsInput);
  const extraArgs = entriesToArgs(extraArgEntries);
  const format = resolveFormat(extraArgEntries);

  if (!["svg", "html"].includes(format)) {
    throw new Error(`Unsupported format for workflow export: ${format}`);
  }

  const scratchRoot = path.join(workspace, "tmp", "workflow-runs");
  mkdirSync(scratchRoot, { recursive: true });
  const runRoot = mkdtempSync(path.join(scratchRoot, "render-"));
  const cloneDir = path.join(runRoot, "target-repo");
  const artifactDir = path.join(runRoot, "artifacts");
  mkdirSync(artifactDir, { recursive: true });

  const { cloneUrl, gitConfig } = buildAuthenticatedClone(repoInfo, repoReadPat);
  run("git", [...gitConfig, "clone", "--filter=blob:none", "--quiet", cloneUrl, cloneDir], {
    cwd: workspace,
  });

  const fileName = `${sanitizeSegment(repoInfo.owner, "Owner")}-${sanitizeSegment(
    repoInfo.repo,
    "Repository",
  )}_${sanitizeSegment(mainBranch, "branch")}_${buildParameterSlug(extraArgEntries)}.${format}`;
  const artifactPath = path.join(artifactDir, fileName);

  const renderArgs = [path.join(workspace, "src", "cli.js"), "render", cloneDir, "-o", artifactPath];
  renderArgs.push("--main-branch", mainBranch, ...extraArgs);
  run(process.execPath, renderArgs, { cwd: workspace });

  writeOutput("artifact_name", fileName);
  writeOutput("artifact_path", artifactPath);

  console.log(`Generated ${fileName}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
