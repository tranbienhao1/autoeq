#!/usr/bin/env node
"use strict";

/**
 * Builds the fast CommonJS solver + DB bundle (`.cache/autoeq_core.cjs`)
 * directly from the modular source files (`src/` + `data/headphone-db.js`),
 * with optional `--html` fallback for legacy standalone single-file HTML builds.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv) {
  const out = {
    root: path.resolve(__dirname, "../.."),
    html: null,
    out: path.resolve(__dirname, "../../.cache/autoeq_core.cjs"),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) out.root = path.resolve(argv[++i]);
    else if (argv[i] === "--html" && argv[i + 1]) out.html = path.resolve(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) out.out = path.resolve(argv[++i]);
  }
  return out;
}

function sliceBetween(src, startMarker, endMarker, label) {
  const s = startMarker ? src.indexOf(startMarker) : 0;
  if (s < 0) throw new Error(`Missing start marker for ${label}: ${startMarker}`);
  const e = endMarker ? src.indexOf(endMarker, s) : src.length;
  if (e < 0) throw new Error(`Missing end marker for ${label}: ${endMarker}`);
  return src.slice(s, e);
}

function loadSources(args) {
  const dspFile = path.join(args.root, "src/01-dsp-core.js");
  const aeFile = path.join(args.root, "src/03-autoeq-solver.js");
  const dbRawFile = path.join(args.root, "data/headphone-db.js");
  const dbExpFile = path.join(args.root, "src/06-database-export.js");

  if (!args.html && fs.existsSync(dspFile) && fs.existsSync(aeFile) && fs.existsSync(dbRawFile) && fs.existsSync(dbExpFile)) {
    const dspScript = fs.readFileSync(dspFile, "utf8");
    const aeScript = fs.readFileSync(aeFile, "utf8");
    const dbRawJs = fs.readFileSync(dbRawFile, "utf8");
    const dbScript = fs.readFileSync(dbExpFile, "utf8");
    const sourceMd5 = crypto
      .createHash("md5")
      .update(dspScript + "\n" + aeScript + "\n" + dbRawJs + "\n" + dbScript)
      .digest("hex");
    return { dspScript, aeScript, dbRawJs, dbScript, sourceMd5 };
  }

  const htmlPath = args.html || path.join(args.root, "Web AutoEQ - DSP Core.html");
  const htmlBuf = fs.readFileSync(htmlPath);
  const sourceMd5 = crypto.createHash("md5").update(htmlBuf).digest("hex");
  const html = htmlBuf.toString("utf8");

  const inlineScripts = [];
  const inlineRe = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = inlineRe.exec(html)) !== null) {
    if (m[1] && m[1].trim().length > 0) inlineScripts.push(m[1]);
  }
  const b64Match = html.match(/<script\s+src="data:application\/javascript;base64,([^"]+)"/i);
  if (!b64Match) throw new Error("Could not find modular files or embedded base64 DB in HTML.");
  const dbRawJs = Buffer.from(b64Match[1], "base64").toString("utf8");

  const dspScript = inlineScripts.find((s) => s.includes("function rbjCoeffs(") && s.includes("function biquadMagDb("));
  const aeScript = inlineScripts.find((s) => s.includes("var AE_TARGETS") && s.includes("function aeComputeOnce("));
  const dbScript = inlineScripts.find((s) => s.includes("var DB_GRID = [];") && s.includes("function dbBuildPhones()"));
  if (!dspScript || !aeScript || !dbScript) {
    throw new Error("Could not locate required inline <script> blocks in HTML.");
  }
  return { dspScript, aeScript, dbRawJs, dbScript, sourceMd5 };
}

function main() {
  const args = parseArgs(process.argv);
  const { dspScript, aeScript, dbRawJs, dbScript, sourceMd5 } = loadSources(args);

  const dspCoreSlice = sliceBetween(
    dspScript,
    "var FREQS",
    "/* ---------------- Cache đáp tuyến trên lưới log cố định ----------------",
    "DSP Core (rbjCoeffs + biquadMagDb)"
  );

  const aeCoreSlice = sliceBetween(
    aeScript,
    null,
    "function aeComputeAsync(",
    "AutoEQ Solver Core"
  );

  const dbGridSlice = sliceBetween(
    dbScript,
    "var DB_GRID = [];",
    "/* ================================================================\n   Chặng 2 bước 2.2",
    "DB Grid & Decoder"
  );

  const dbBuildSlice = sliceBetween(
    dbScript,
    "function dbAttribution(e){",
    "var DB = { cur: null };",
    "DB_PHONES Builder"
  );

  const solverCoreMd5 = crypto
    .createHash("md5")
    .update(dspCoreSlice + "\n" + aeCoreSlice)
    .digest("hex");

  const bundle = [
    "// Auto-generated verbatim from modular src/ + data/ — DO NOT EDIT MANUALLY",
    "var document = { getElementById: function(){ return null; } };",
    dspCoreSlice,
    "function $(id){ return null; }",
    aeCoreSlice,
    dbRawJs,
    dbGridSlice,
    dbBuildSlice,
    `var HTML_MD5 = ${JSON.stringify(sourceMd5)};`,
    `var SOLVER_CORE_MD5 = ${JSON.stringify(solverCoreMd5)};`,
    "module.exports = {",
    "  HTML_MD5: HTML_MD5,",
    "  SOLVER_CORE_MD5: SOLVER_CORE_MD5,",
    "  AE_FS: AE_FS,",
    "  AE_LIMITS: AE_LIMITS,",
    "  AE_TARGETS: AE_TARGETS,",
    "  AE_SAMPLES: AE_SAMPLES,",
    "  AE: AE,",
    "  DB_BUILD: typeof DB_BUILD !== 'undefined' ? DB_BUILD : null,",
    "  DB_PHONES: DB_PHONES,",
    "  DB_RUNTIME_REJECTED: DB_RUNTIME_REJECTED,",
    "  aeInterp: aeInterp,",
    "  aeSamplePoints: aeSamplePoints,",
    "  aePrepare: aePrepare,",
    "  aeSolve: aeSolve,",
    "  aeSolveSeeded: typeof aeSolveSeeded !== 'undefined' ? aeSolveSeeded : null,",
    "  aeBuildSeed12: typeof aeBuildSeed12 !== 'undefined' ? aeBuildSeed12 : null,",
    "  aeComputeSetup: aeComputeSetup,",
    "  aeComputeFinish: aeComputeFinish,",
    "  aeComputeOnce: aeComputeOnce,",
    "  aeCompute: aeCompute,",
    "  aeRms: aeRms",
    "};",
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, bundle, "utf8");

  const loaded = require(args.out);
  const targetIds = Object.keys(loaded.AE_TARGETS);
  console.log(
    JSON.stringify({
      ok: true,
      out: args.out,
      sourceMd5: loaded.HTML_MD5,
      solverCoreMd5: loaded.SOLVER_CORE_MD5,
      phonesCount: loaded.DB_PHONES.length,
      rejectedCount: loaded.DB_RUNTIME_REJECTED.length,
      targetsCount: targetIds.length,
      targets: targetIds,
    })
  );
}

main();
