#!/usr/bin/env node
"use strict";

/**
 * Multi-threaded shard runner for the 60,000-pair Web AutoEQ Full Sweep.
 *
 * - Uses interleaved modulo sharding (`(phoneIdx - startPhone) % shards === shard`)
 *   so alphabetically clustered brands (e.g. AKG, Bose, Stax) and headphone types
 *   (In-ear / Over-ear / Earbud) are balanced evenly across all 20 GitHub Actions shards.
 * - Uses a dynamic work-stealing queue across all available CPU cores (`worker_threads`)
 *   so no worker sits idle when another worker hits a heavy T1e refinement pair.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

function parseArgs(argv) {
  const out = {
    core: path.resolve(__dirname, "../../.cache/autoeq_core.cjs"),
    outDir: path.resolve(__dirname, "../../sweep-shards"),
    shard: 0,
    shards: 1,
    startPhone: 0,
    endPhone: -1, // -1 = DB_PHONES.length
    mode: "10", // "10" (aeComputeOnce 10-band) | "bestof" (aeCompute 10/12-seeded/20 best-of)
    threads: Math.max(1, os.cpus().length),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--core" && argv[i + 1]) out.core = path.resolve(argv[++i]);
    else if (a === "--out-dir" && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
    else if (a === "--shard" && argv[i + 1]) out.shard = parseInt(argv[++i], 10);
    else if (a === "--shards" && argv[i + 1]) out.shards = parseInt(argv[++i], 10);
    else if (a === "--start-phone" && argv[i + 1]) out.startPhone = parseInt(argv[++i], 10);
    else if (a === "--end-phone" && argv[i + 1]) out.endPhone = parseInt(argv[++i], 10);
    else if (a === "--mode" && argv[i + 1]) out.mode = String(argv[++i]);
    else if (a === "--threads" && argv[i + 1]) out.threads = Math.max(1, parseInt(argv[++i], 10));
  }
  return out;
}

function roundN(x, n) {
  const p = Math.pow(10, n);
  return Math.round(x * p) / p;
}

if (!isMainThread) {
  const ctx = require(workerData.corePath);
  const targetIds = Object.keys(ctx.AE_TARGETS);
  const mode = workerData.mode;

  parentPort.on("message", (msg) => {
    if (!msg || msg.cmd === "stop") {
      process.exit(0);
    }
    if (msg.cmd === "solvePhone") {
      const phoneIdx = msg.phoneIdx;
      const ph = ctx.DB_PHONES[phoneIdx];
      const pts = [];
      for (let k = 0; k <= 480; k++) {
        const f = 20 * Math.pow(2, k / 48);
        if (f > 20000) break;
        pts.push([f, ctx.aeInterp(ph.knots, f)]);
      }
      const prep = ctx.aePrepare(pts);
      const rows = [];

      for (let targetIdx = 0; targetIdx < targetIds.length; targetIdx++) {
        const tid = targetIds[targetIdx];
        const t0 = Date.now();
        const out =
          mode === "bestof"
            ? ctx.aeCompute(prep, tid, { tilt: 0, bass: 0, ear: 0 }, 10, false, true, 48000)
            : ctx.aeComputeOnce(prep, tid, { tilt: 0, bass: 0, ear: 0 }, 10, false, 48000);
        const wallMs = Date.now() - t0;

        rows.push({
          phoneIdx,
          phone: ph.name,
          brand: ph.brand,
          type: ph.type,
          rig: ph.rig,
          source: ph.srcKey || ph.source,
          targetIdx,
          target: tid,
          rmsBefore: roundN(out.errBefore, 6),
          rmsAfter: roundN(out.errAfter, 6),
          pickedBands: out.bestOf ? out.bestOf.picked : out.res.bands.length,
          viol: out.viol,
          nullCount: prep.nulls ? prep.nulls.length : 0,
          nullBoost: out.nullBoost ? 1 : 0,
          ms: wallMs,
          bands: out.res.bands.map((b) => ({
            t: b.type === "lowshelf" ? "LS" : b.type === "highshelf" ? "HS" : "PK",
            f: roundN(b.freq, 2),
            g: roundN(b.gain, 3),
            q: roundN(b.q, 4),
          })),
        });
      }

      parentPort.postMessage({ phoneIdx, rows });
    }
  });
} else {
  async function runMain() {
    const args = parseArgs(process.argv);
    if (!fs.existsSync(args.core)) {
      throw new Error(`Core bundle not found at ${args.core}. Run extract_core.js first.`);
    }
    const coreMeta = require(args.core);
    const totalDbPhones = coreMeta.DB_PHONES.length;
    const targetIds = Object.keys(coreMeta.AE_TARGETS);
    const startPhone = Math.max(0, args.startPhone);
    const endPhone = args.endPhone < 0 ? totalDbPhones : Math.min(totalDbPhones, args.endPhone);

    if (args.shard < 0 || args.shard >= args.shards) {
      throw new Error(`Invalid shard ${args.shard} for shards=${args.shards}`);
    }

    const queue = [];
    for (let idx = startPhone; idx < endPhone; idx++) {
      if ((idx - startPhone) % args.shards === args.shard) {
        queue.push(idx);
      }
    }

    fs.mkdirSync(args.outDir, { recursive: true });
    const padShard = String(args.shard).padStart(2, "0");
    const outGzPath = path.join(args.outDir, `shard-${padShard}.jsonl.gz`);
    const outMetaPath = path.join(args.outDir, `shard-${padShard}.meta.json`);

    const gzip = zlib.createGzip({ level: 9 });
    const fileStream = fs.createWriteStream(outGzPath);
    gzip.pipe(fileStream);

    const streamDone = new Promise((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
      gzip.on("error", reject);
    });

    const totalPhonesInShard = queue.length;
    const totalPairsExpected = totalPhonesInShard * targetIds.length;
    const numWorkers = Math.min(args.threads, Math.max(1, totalPhonesInShard));

    console.log(
      `[Shard ${padShard}/${String(args.shards).padStart(2, "0")}] Starting: ${totalPhonesInShard} headphones (${totalPairsExpected} pairs) | mode=${args.mode} | threads=${numWorkers} | range=[${startPhone}, ${endPhone})`
    );

    const tStart = Date.now();
    let nextQueuePos = 0;
    let phonesDone = 0;
    let pairsDone = 0;
    let sumRmsAfter = 0;
    let maxRmsAfter = 0;
    let maxRmsPair = "";
    let totalViol = 0;
    let totalNullBoost = 0;
    let hardPairs = 0;

    if (totalPhonesInShard > 0) {
      await new Promise((resolve, reject) => {
        let activeWorkers = numWorkers;

        for (let w = 0; w < numWorkers; w++) {
          const worker = new Worker(__filename, {
            workerData: { corePath: args.core, mode: args.mode },
          });

          const dispatchNext = () => {
            if (nextQueuePos < queue.length) {
              const phoneIdx = queue[nextQueuePos++];
              worker.postMessage({ cmd: "solvePhone", phoneIdx });
            } else {
              worker.postMessage({ cmd: "stop" });
            }
          };

          worker.on("message", (msg) => {
            phonesDone++;
            for (const r of msg.rows) {
              gzip.write(JSON.stringify(r) + "\n");
              pairsDone++;
              sumRmsAfter += r.rmsAfter;
              if (r.rmsAfter > maxRmsAfter) {
                maxRmsAfter = r.rmsAfter;
                maxRmsPair = `${r.phone} × ${r.target}`;
              }
              totalViol += r.viol;
              totalNullBoost += r.nullBoost;
              if (r.ms > 1500) hardPairs++;
            }

            if (phonesDone % 20 === 0 || phonesDone === totalPhonesInShard) {
              const elapsedSec = (Date.now() - tStart) / 1000;
              const rate = pairsDone / Math.max(0.001, elapsedSec);
              const meanRms = sumRmsAfter / Math.max(1, pairsDone);
              console.log(
                `[Shard ${padShard}] ${phonesDone}/${totalPhonesInShard} phones (${pairsDone}/${totalPairsExpected} pairs) | ${elapsedSec.toFixed(1)}s | ${rate.toFixed(2)} pairs/s | meanRMS=${meanRms.toFixed(4)} dB | viol=${totalViol} nullBoost=${totalNullBoost}`
              );
            }

            dispatchNext();
          });

          worker.on("error", reject);
          worker.on("exit", (code) => {
            if (code !== 0) {
              reject(new Error(`Worker exited with code ${code}`));
              return;
            }
            if (--activeWorkers === 0) resolve();
          });

          dispatchNext();
        }
      });
    }

    gzip.end();
    await streamDone;

    const wallSec = (Date.now() - tStart) / 1000;
    const meta = {
      shard: args.shard,
      shards: args.shards,
      mode: args.mode,
      threads: numWorkers,
      startPhone,
      endPhone,
      htmlMd5: coreMeta.HTML_MD5,
      solverCoreMd5: coreMeta.SOLVER_CORE_MD5,
      phonesDone,
      pairsDone,
      wallSec: roundN(wallSec, 2),
      pairsPerSec: roundN(pairsDone / Math.max(0.001, wallSec), 3),
      meanRmsAfter: pairsDone ? roundN(sumRmsAfter / pairsDone, 6) : 0,
      maxRmsAfter: roundN(maxRmsAfter, 6),
      maxRmsPair,
      hardPairs,
      totalViol,
      totalNullBoost,
      completedAt: new Date().toISOString(),
    };

    fs.writeFileSync(outMetaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    console.log(`[Shard ${padShard}] Completed in ${wallSec.toFixed(2)}s -> ${outGzPath}`);
  }

  runMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
