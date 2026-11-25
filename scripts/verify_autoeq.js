#!/usr/bin/env node
/**
 * 3-Tier Verification Gate CLI for Web AutoEQ (Zero-Dependency)
 *
 * Tier 1: Syntax (`node --check`), LF line endings, Zero-Dependency check,
 *         `scripts/sweep/extract_core.js`, and `scripts/build_single_file.js`.
 * Tier 2: `node --test tests/*.test.cjs` (DSP/Target/Parser/Anti-Clipping + Schedule tests).
 * Tier 3: Bounded benchmark (`AE_SAMPLES` 36 pairs + stratified DB slice via `run_shard.js`).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const opts = {
    jsonOnly: false,
    skipBuild: false,
    skipBench: false,
    quick: false,
    shards: 100
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.jsonOnly = true;
    else if (a === "--skip-build") opts.skipBuild = true;
    else if (a === "--skip-bench") opts.skipBench = true;
    else if (a === "--quick") {
      opts.quick = true;
      opts.shards = 500;
    } else if (a === "--shards" && argv[i + 1]) {
      opts.shards = Math.max(1, parseInt(argv[++i], 10));
    }
  }
  return opts;
}

function collectJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".cache", "sweep-shards", "tmp", ".agents"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".cjs")) out.push(full);
  }
  return out;
}

function runNodeScript(scriptRelPath, args = []) {
  const full = path.join(ROOT_DIR, scriptRelPath);
  const out = execFileSync(process.execPath, [full, ...args], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return out.toString("utf8").trim();
}

function runTier1(opts) {
  if (fs.existsSync(path.join(ROOT_DIR, "package.json"))) {
    throw new Error("Zero-Dependency violation: package.json exists.");
  }
  if (fs.existsSync(path.join(ROOT_DIR, "node_modules"))) {
    throw new Error("Zero-Dependency violation: node_modules/ exists.");
  }

  const files = [];
  for (const d of ["src", "data", "scripts", "tests"]) {
    collectJsFiles(path.join(ROOT_DIR, d), files);
  }

  for (const f of files) {
    execFileSync(process.execPath, ["--check", f], { cwd: ROOT_DIR, stdio: "pipe" });
    const raw = fs.readFileSync(f, "utf8");
    if (raw.includes("\r\n")) {
      throw new Error(`CRLF detected in ${path.relative(ROOT_DIR, f)}`);
    }
  }

  const dbExp = fs.readFileSync(path.join(ROOT_DIR, "src/06-database-export.js"), "utf8");
  if (!dbExp.includes("var DB_GRID = [];") || !dbExp.includes("/* ================================================================\n   Chặng 2 bước 2.2")) {
    throw new Error("extract_core.js LF marker missing in src/06-database-export.js");
  }

  let extractInfo = null;
  let buildInfo = null;
  if (!opts.skipBuild) {
    const extRaw = runNodeScript("scripts/sweep/extract_core.js");
    extractInfo = JSON.parse(extRaw.split(/\r?\n/).pop());
    if (!extractInfo.ok || extractInfo.rejectedCount !== 0 || extractInfo.phonesCount !== 5000 || extractInfo.targetsCount !== 12) {
      throw new Error(`extract_core.js failed invariant: ${JSON.stringify(extractInfo)}`);
    }

    const bldRaw = runNodeScript("scripts/build_single_file.js");
    buildInfo = JSON.parse(bldRaw.split(/\r?\n/).pop());
    if (!buildInfo.ok) {
      throw new Error(`build_single_file.js failed: ${JSON.stringify(buildInfo)}`);
    }
  }

  return {
    ok: true,
    checkedFiles: files.length,
    extractCore: extractInfo,
    singleFileBuild: buildInfo
  };
}

function runTier2() {
  const testDir = path.join(ROOT_DIR, "tests");
  const testFiles = fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith(".test.cjs"))
    .sort()
    .map((f) => path.join(testDir, f));

  if (testFiles.length === 0) {
    throw new Error("No *.test.cjs files found in tests/");
  }

  const t0 = Date.now();
  const stdout = execFileSync(process.execPath, ["--test", ...testFiles], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"]
  }).toString("utf8");

  return {
    ok: true,
    testFiles: testFiles.map((f) => path.relative(ROOT_DIR, f).replace(/\\/g, "/")),
    durationMs: Date.now() - t0,
    outputTail: stdout.trim().split(/\r?\n/).slice(-12).join("\n")
  };
}

function runTier3(opts) {
  const corePath = path.join(ROOT_DIR, ".cache/autoeq_core.cjs");
  if (!fs.existsSync(corePath)) {
    runNodeScript("scripts/sweep/extract_core.js");
  }
  const core = require(corePath);
  const targets = Object.keys(core.AE_TARGETS);

  let sBefore = 0;
  let sAfter = 0;
  let sMaxAfter = 0;
  let sViol = 0;
  let sNullBoost = 0;
  let sCount = 0;

  for (const sample of core.AE_SAMPLES) {
    const prep = core.aePrepare(sample.knots);
    for (const tid of targets) {
      const out = core.aeComputeOnce(prep, tid, { tilt: 0, bass: 0, ear: 0 }, 10, false, 48000);
      if (!Number.isFinite(out.errBefore) || !Number.isFinite(out.errAfter)) {
        throw new Error(`Non-finite RMSE on ${sample.id} x ${tid}`);
      }
      sBefore += out.errBefore;
      sAfter += out.errAfter;
      if (out.errAfter > sMaxAfter) sMaxAfter = out.errAfter;
      sViol += out.viol || 0;
      sNullBoost += out.nullBoost ? 1 : 0;
      sCount++;
    }
  }

  if (sViol !== 0 || sNullBoost !== 0) {
    throw new Error(`AE_SAMPLES safety failure: violations=${sViol}, nullBoosts=${sNullBoost}`);
  }

  const tmpDir = path.join(ROOT_DIR, ".cache", `verify-tmp-${process.pid}-${Date.now()}`);
  const shardsDir = path.join(tmpDir, "shards");
  const outDir = path.join(tmpDir, "out");
  fs.mkdirSync(shardsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  let dbSummary;
  try {
    const expectedPhones = Math.ceil(core.DB_PHONES.length / opts.shards);
    const expectedPairs = expectedPhones * targets.length;

    runNodeScript("scripts/sweep/run_shard.js", [
      "--shard", "0",
      "--shards", String(opts.shards),
      "--mode", "10",
      "--out-dir", shardsDir
    ]);

    runNodeScript("scripts/sweep/aggregate_results.js", [
      "--shards-dir", shardsDir,
      "--out-dir", outDir,
      "--expected-pairs", String(expectedPairs)
    ]);

    dbSummary = JSON.parse(fs.readFileSync(path.join(outDir, "summary.json"), "utf8"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (
    dbSummary.totalViolations !== 0 ||
    dbSummary.totalNullBoosts !== 0 ||
    dbSummary.duplicates !== 0 ||
    !Number.isFinite(dbSummary.rmsAfter.mean) ||
    !Number.isFinite(dbSummary.rmsAfter.p95)
  ) {
    throw new Error(
      `Stratified DB benchmark gate failed: violations=${dbSummary.totalViolations}, nullBoosts=${dbSummary.totalNullBoosts}, duplicates=${dbSummary.duplicates}`
    );
  }

  return {
    ok: true,
    htmlMd5: core.HTML_MD5,
    solverCoreMd5: core.SOLVER_CORE_MD5,
    samples36: {
      pairs: sCount,
      rmsBeforeMean: +(sBefore / sCount).toFixed(4),
      rmsAfterMean: +(sAfter / sCount).toFixed(4),
      rmsAfterMax: +sMaxAfter.toFixed(4),
      violations: sViol,
      nullBoosts: sNullBoost
    },
    stratifiedDb: {
      shards: opts.shards,
      totalPairs: dbSummary.totalPairs,
      uniquePhones: dbSummary.uniquePhones,
      rmsBeforeMean: dbSummary.rmsBefore.mean,
      rmsAfterMean: dbSummary.rmsAfter.mean,
      rmsAfterMedian: dbSummary.rmsAfter.median,
      rmsAfterP95: dbSummary.rmsAfter.p95,
      rmsAfterMax: dbSummary.rmsAfter.max,
      totalViolations: dbSummary.totalViolations,
      totalNullBoosts: dbSummary.totalNullBoosts,
      duplicates: dbSummary.duplicates
    }
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const report = {
    ok: false,
    timestamp: new Date().toISOString(),
    tier1: null,
    tier2: null,
    tier3: null,
    totalDurationMs: 0
  };

  report.tier1 = runTier1(opts);
  report.tier2 = runTier2();
  if (!opts.skipBench) {
    report.tier3 = runTier3(opts);
  }
  report.ok = true;
  report.totalDurationMs = Date.now() - t0;

  if (opts.jsonOnly) {
    console.log(JSON.stringify(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("[verify_autoeq] FAILED:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { runTier1, runTier2, runTier3 };
