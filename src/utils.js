import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const MAX_BUFFER = 32 * 1024 * 1024;

export function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trimEnd();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const output = [stderr, stdout].filter(Boolean).join("\n");
    const details = output ? `\n${output}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${details}`);
  }
}

export function ensureDirectory(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function shortenSha(sha, length = 7) {
  return sha.slice(0, length);
}

export function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function estimateTextWidth(text, fontSize = 14) {
  let width = 0;
  for (const char of String(text)) {
    width += /[^\u0000-\u00ff]/u.test(char) ? fontSize : fontSize * 0.58;
  }
  return width;
}

export function estimateMonospaceWidth(text, fontSize = 14, asciiAdvance = 0.62) {
  let cells = 0;
  for (const char of String(text)) {
    cells += /[^\u0000-\u00ff]/u.test(char) ? 2 : 1;
  }
  return cells * fontSize * asciiAdvance;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
