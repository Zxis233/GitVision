#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import path from "node:path";

import { loadRepositoryData } from "./git-data.js";
import { layoutGraph } from "./layout.js";
import { renderHtml, renderSvg } from "./render.js";
import { ensureDirectory } from "./utils.js";

function printHelp() {
  console.log(`GitVision

Usage:
  node src/cli.js render <repo-path> [options]

Options:
  -o, --output <file>        Output file path
  --format <svg|html>        Export format, inferred from output when omitted
  --main-branch <name>       Keep the selected branch on lane 0
  --max-commits <number>     Maximum commits to render (default: 180)
  --since-days <number>      Only include commits from the last N days
  --title <text>             Custom chart title
  -h, --help                 Show this help
`);
}

function readOptionValue(args, index, token) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${token}`);
  }
  return value;
}

function parseArgs(argv) {
  const [command, ...args] = argv;
  if (!command || command === "-h" || command === "--help") {
    return { help: true };
  }

  if (command !== "render") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = {
    command,
    repoPath: process.cwd(),
    outputPath: "",
    format: "",
    mainBranch: "",
    maxCommits: 180,
    sinceDays: null,
    title: "",
  };

  let repoAssigned = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith("-") && !repoAssigned) {
      options.repoPath = token;
      repoAssigned = true;
      continue;
    }

    if (token === "-o" || token === "--output") {
      options.outputPath = readOptionValue(args, index, token);
      index += 1;
      continue;
    }

    if (token === "--format") {
      options.format = readOptionValue(args, index, token);
      index += 1;
      continue;
    }

    if (token === "--main-branch") {
      options.mainBranch = readOptionValue(args, index, token);
      index += 1;
      continue;
    }

    if (token === "--max-commits") {
      options.maxCommits = Number(readOptionValue(args, index, token));
      index += 1;
      continue;
    }

    if (token === "--since-days") {
      options.sinceDays = Number(readOptionValue(args, index, token));
      index += 1;
      continue;
    }

    if (token === "--title") {
      options.title = readOptionValue(args, index, token);
      index += 1;
      continue;
    }

    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }

    const [flag, inlineValue] = token.split("=", 2);
    if (flag === "--format" && inlineValue) {
      options.format = inlineValue;
      continue;
    }
    if (flag === "--main-branch" && inlineValue) {
      options.mainBranch = inlineValue;
      continue;
    }
    if (flag === "--max-commits" && inlineValue) {
      options.maxCommits = Number(inlineValue);
      continue;
    }
    if (flag === "--since-days" && inlineValue) {
      options.sinceDays = Number(inlineValue);
      continue;
    }
    if (flag === "--title" && inlineValue) {
      options.title = inlineValue;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

function inferFormat(outputPath, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat.toLowerCase();
  }

  if (outputPath) {
    const extension = path.extname(outputPath).slice(1).toLowerCase();
    if (extension === "svg" || extension === "html") {
      return extension;
    }
  }

  return "svg";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repository = loadRepositoryData(path.resolve(options.repoPath), {
    maxCommits: options.maxCommits,
    sinceDays: options.sinceDays,
  });
  const graph = layoutGraph(repository, {
    mainBranch: options.mainBranch,
  });
  const format = inferFormat(options.outputPath, options.format);
  if (format !== "svg" && format !== "html") {
    throw new Error(`Unsupported format: ${format}`);
  }

  const outputPath = path.resolve(
    options.outputPath || `out/${repository.repoName}-git-graph.${format}`,
  );
  const title = options.title || `${repository.repoName} Git Graph`;
  const svgMarkup = renderSvg(graph, { title });
  const output = format === "html" ? renderHtml(svgMarkup, { title }) : svgMarkup;

  ensureDirectory(outputPath);
  writeFileSync(outputPath, output, "utf8");

  console.log(
    `Wrote ${format.toUpperCase()} graph for ${repository.repoName} to ${outputPath} (${graph.commits.length} commits, ${graph.laneCount} lanes).`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
