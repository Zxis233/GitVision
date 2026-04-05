import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParameterSlug,
  entriesToArgs,
  parseExtraArgs,
  parseRepositoryInfo,
  resolveFormat,
} from "../scripts/render-workflow.js";

test("workflow helper expands owner/repo shorthand to a GitHub clone URL", () => {
  const info = parseRepositoryInfo("openai/gym");

  assert.equal(info.host, "github.com");
  assert.equal(info.owner, "openai");
  assert.equal(info.repo, "gym");
  assert.equal(info.cloneUrl, "https://github.com/openai/gym.git");
});

test("workflow helper keeps local repository paths as local clones", () => {
  const info = parseRepositoryInfo("E:\\MyRV_DIDE");

  assert.equal(info.host, "");
  assert.equal(info.owner, "Local");
  assert.equal(info.repo, "MyRV_DIDE");
  assert.equal(info.cloneUrl, "E:\\MyRV_DIDE");
});

test("workflow helper compresses extra args into a short artifact slug", () => {
  const entries = parseExtraArgs('--max-commits 100 --since-days 365 --format html --title "Weekly Export"');

  assert.deepEqual(entriesToArgs(entries), [
    "--max-commits",
    "100",
    "--since-days",
    "365",
    "--format",
    "html",
    "--title",
    "Weekly Export",
  ]);
  assert.equal(resolveFormat(entries), "html");
  assert.equal(buildParameterSlug(entries), "mc100-d365-html-tWeekly-Export");
});
