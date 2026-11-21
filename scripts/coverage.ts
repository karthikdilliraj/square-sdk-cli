/**
 * coverage.ts - Run the test suite with coverage and enforce thresholds.
 *
 * Bun 1.3.14's `coverageThreshold` in bunfig.toml makes any coverage run exit
 * non-zero without a message, so the gate is applied here from the lcov report
 * instead: run the suite, parse the totals, compare, print a summary.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const THRESHOLDS = { lines: 0.85, functions: 0.8 };

const coverageDir = mkdtempSync(join(tmpdir(), "square-cli-coverage-"));

try {
  const run = spawnSync(
    "bun",
    ["test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${coverageDir}`],
    { stdio: "inherit" },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);

  const report = readFileSync(join(coverageDir, "lcov.info"), "utf8");
  const totals = { lines: { hit: 0, found: 0 }, functions: { hit: 0, found: 0 } };

  for (const line of report.split("\n")) {
    const [key, raw] = line.split(":");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (key === "LF") totals.lines.found += value;
    else if (key === "LH") totals.lines.hit += value;
    else if (key === "FNF") totals.functions.found += value;
    else if (key === "FNH") totals.functions.hit += value;
  }

  const ratio = (t: { hit: number; found: number }) => (t.found === 0 ? 1 : t.hit / t.found);
  const actual = {
    lines: ratio(totals.lines),
    functions: ratio(totals.functions),
  };

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  console.log(
    `\nCoverage: lines ${pct(actual.lines)} (min ${pct(THRESHOLDS.lines)}), ` +
      `functions ${pct(actual.functions)} (min ${pct(THRESHOLDS.functions)})`,
  );

  const failures = (Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[]).filter(
    (key) => actual[key] < THRESHOLDS[key],
  );
  if (failures.length > 0) {
    console.error(`✗ Coverage below threshold: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(coverageDir, { recursive: true, force: true });
}
