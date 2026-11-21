#!/usr/bin/env node
"use strict";

/**
 * Aggregates all `shard-*.jsonl.gz` outputs from the parallel matrix run,
 * validates 100% completeness, zero duplicates, zero safety violations,
 * writes canonical `results_all.jsonl.gz`, `summary.json`, and `REPORT.md`.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function parseArgs(argv) {
  const out = {
    shardsDir: path.resolve(__dirname, "../../sweep-shards"),
    outDir: path.resolve(__dirname, "../../sweep-results"),
    expectedPairs: 60000,
    splitCheckpointPhone: 1563, // previous checkpoint boundary (18,756 pairs = 0..1562)
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--shards-dir" && argv[i + 1]) out.shardsDir = path.resolve(argv[++i]);
    else if (a === "--out-dir" && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
    else if (a === "--expected-pairs" && argv[i + 1]) out.expectedPairs = parseInt(argv[++i], 10);
    else if (a === "--split-phone" && argv[i + 1]) out.splitCheckpointPhone = parseInt(argv[++i], 10);
  }
  return out;
}

function roundN(x, n) {
  const p = Math.pow(10, n);
  return Math.round(x * p) / p;
}

function computeStats(values) {
  if (!values.length) {
    return { count: 0, mean: 0, median: 0, min: 0, p10: 0, p25: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const pct = (q) => {
    const pos = (n - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  };
  return {
    count: n,
    mean: roundN(sum / n, 4),
    median: roundN(pct(0.5), 4),
    min: roundN(sorted[0], 4),
    p10: roundN(pct(0.1), 4),
    p25: roundN(pct(0.25), 4),
    p75: roundN(pct(0.75), 4),
    p90: roundN(pct(0.9), 4),
    p95: roundN(pct(0.95), 4),
    p99: roundN(pct(0.99), 4),
    max: roundN(sorted[n - 1], 4),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const files = fs
    .readdirSync(args.shardsDir)
    .filter((f) => /^shard-\d+\.jsonl\.gz$/.test(f))
    .sort();
  const metaFiles = fs
    .readdirSync(args.shardsDir)
    .filter((f) => /^shard-\d+\.meta\.json$/.test(f))
    .sort();

  if (!files.length) {
    throw new Error(`No shard-*.jsonl.gz files found in ${args.shardsDir}`);
  }

  const shardMetas = metaFiles.map((f) => JSON.parse(fs.readFileSync(path.join(args.shardsDir, f), "utf8")));
  const rows = [];
  const seenKeys = new Set();
  let duplicates = 0;

  for (const file of files) {
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(args.shardsDir, file)));
    const lines = buf.toString("utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      const key = `${r.phoneIdx}:${r.targetIdx}`;
      if (seenKeys.has(key)) {
        duplicates++;
        continue;
      }
      seenKeys.add(key);
      rows.push(r);
    }
  }

  rows.sort((a, b) => a.phoneIdx - b.phoneIdx || a.targetIdx - b.targetIdx);

  if (args.expectedPairs > 0 && rows.length !== args.expectedPairs) {
    throw new Error(`Expected ${args.expectedPairs} unique pairs, but found ${rows.length} (duplicates=${duplicates}).`);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const allGzPath = path.join(args.outDir, "results_all.jsonl.gz");

  const gzip = zlib.createGzip({ level: 9 });
  const outStream = fs.createWriteStream(allGzPath);
  gzip.pipe(outStream);
  const doneGz = new Promise((res, rej) => {
    outStream.on("finish", res);
    outStream.on("error", rej);
    gzip.on("error", rej);
  });
  for (const r of rows) {
    gzip.write(JSON.stringify(r) + "\n");
  }
  gzip.end();
  await doneGz;

  // Compute global and segmented statistics
  const allAfter = [];
  const allBefore = [];
  const prevAfter = []; // phoneIdx < splitCheckpointPhone (first 18,756 pairs)
  const remAfter = [];  // phoneIdx >= splitCheckpointPhone (remaining 41,244 pairs)
  const byTarget = {};
  const byType = {};
  const byPickedBands = {};
  const byPhone = new Map();

  let totalViol = 0;
  let totalNullBoost = 0;
  let hardPairs = 0;
  let minPair = null;
  let maxPair = null;

  for (const r of rows) {
    allAfter.push(r.rmsAfter);
    allBefore.push(r.rmsBefore);
    if (r.phoneIdx < args.splitCheckpointPhone) prevAfter.push(r.rmsAfter);
    else remAfter.push(r.rmsAfter);

    if (!byTarget[r.target]) byTarget[r.target] = [];
    byTarget[r.target].push(r.rmsAfter);

    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r.rmsAfter);

    const pbKey = String(r.pickedBands || 10);
    byPickedBands[pbKey] = (byPickedBands[pbKey] || 0) + 1;

    let phEntry = byPhone.get(r.phoneIdx);
    if (!phEntry) {
      phEntry = { phoneIdx: r.phoneIdx, phone: r.phone, brand: r.brand, type: r.type, rig: r.rig, source: r.source, count: 0, sumBefore: 0, sumAfter: 0, minAfter: Infinity, maxAfter: 0, worstTarget: "", targetRms: {}, targetBands: {} };
      byPhone.set(r.phoneIdx, phEntry);
    }
    phEntry.count++;
    phEntry.sumBefore += r.rmsBefore;
    phEntry.sumAfter += r.rmsAfter;
    phEntry.targetRms[r.target] = r.rmsAfter;
    phEntry.targetBands[r.target] = r.pickedBands || 10;
    if (r.rmsAfter < phEntry.minAfter) phEntry.minAfter = r.rmsAfter;
    if (r.rmsAfter > phEntry.maxAfter) {
      phEntry.maxAfter = r.rmsAfter;
      phEntry.worstTarget = r.target;
    }

    totalViol += r.viol;
    totalNullBoost += r.nullBoost;
    if (r.ms > 1500) hardPairs++;

    if (!minPair || r.rmsAfter < minPair.rmsAfter) minPair = r;
    if (!maxPair || r.rmsAfter > maxPair.rmsAfter) maxPair = r;
  }

  // Write compact CSV of all headphones x 12 targets for Excel / Google Sheets
  const targetCols = Object.keys(byTarget);
  const csvEsc = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csvLines = [
    ["phoneIdx", "phone", "brand", "type", "rig", "source", "meanRmsBefore", "meanRmsAfter", "minRmsAfter", "maxRmsAfter", "worstTarget", ...targetCols.map((t) => `${t}_rms`), ...targetCols.map((t) => `${t}_bands`)].join(","),
  ];
  for (const p of Array.from(byPhone.values()).sort((a, b) => a.phoneIdx - b.phoneIdx)) {
    csvLines.push(
      [
        p.phoneIdx,
        csvEsc(p.phone),
        csvEsc(p.brand),
        csvEsc(p.type),
        csvEsc(p.rig),
        csvEsc(p.source),
        roundN(p.sumBefore / p.count, 4),
        roundN(p.sumAfter / p.count, 4),
        roundN(p.minAfter, 4),
        roundN(p.maxAfter, 4),
        csvEsc(p.worstTarget),
        ...targetCols.map((t) => (p.targetRms[t] != null ? roundN(p.targetRms[t], 4) : "")),
        ...targetCols.map((t) => (p.targetBands[t] != null ? p.targetBands[t] : "")),
      ].join(",")
    );
  }
  const csvPath = path.join(args.outDir, "all_phones_summary.csv");
  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  const phonesComplete12 = Array.from(byPhone.values()).filter((p) => p.count === 12).length;
  const worst50Pairs = rows
    .slice()
    .sort((a, b) => b.rmsAfter - a.rmsAfter)
    .slice(0, 50)
    .map((r) => ({
      phoneIdx: r.phoneIdx,
      phone: r.phone,
      type: r.type,
      target: r.target,
      rmsBefore: r.rmsBefore,
      rmsAfter: r.rmsAfter,
      pickedBands: r.pickedBands,
      ms: r.ms,
    }));

  const worst30Phones = Array.from(byPhone.values())
    .map((p) => ({
      phoneIdx: p.phoneIdx,
      phone: p.phone,
      type: p.type,
      source: p.source,
      meanRmsAfter: roundN(p.sumAfter / p.count, 4),
      maxRmsAfter: roundN(p.maxAfter, 4),
      worstTarget: p.worstTarget,
    }))
    .sort((a, b) => b.meanRmsAfter - a.meanRmsAfter)
    .slice(0, 30);

  const targetSummary = {};
  for (const [k, arr] of Object.entries(byTarget)) targetSummary[k] = computeStats(arr);

  const typeSummary = {};
  for (const [k, arr] of Object.entries(byType)) typeSummary[k] = computeStats(arr);

  const maxShardWallSec = shardMetas.length ? Math.max(...shardMetas.map((m) => m.wallSec || 0)) : 0;
  const sumShardCpuWallSec = shardMetas.reduce((acc, m) => acc + (m.wallSec || 0), 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    htmlMd5: shardMetas[0] ? shardMetas[0].htmlMd5 : null,
    solverCoreMd5: shardMetas[0] ? shardMetas[0].solverCoreMd5 : null,
    mode: shardMetas[0] ? shardMetas[0].mode : "10",
    shardsCount: files.length,
    maxShardWallSec: roundN(maxShardWallSec, 2),
    sumShardWallSec: roundN(sumShardCpuWallSec, 2),
    totalPairs: rows.length,
    uniquePhones: byPhone.size,
    phonesComplete12,
    duplicates,
    totalViolations: totalViol,
    totalNullBoosts: totalNullBoost,
    hardPairsOver1500ms: hardPairs,
    byPickedBands,
    rmsBefore: computeStats(allBefore),
    rmsAfter: computeStats(allAfter),
    segments: {
      first18756_0_to_1562: computeStats(prevAfter),
      remaining41244_1563_to_4999: computeStats(remAfter),
    },
    bestPair: minPair
      ? { phoneIdx: minPair.phoneIdx, phone: minPair.phone, target: minPair.target, rmsBefore: minPair.rmsBefore, rmsAfter: minPair.rmsAfter }
      : null,
    worstPair: maxPair
      ? { phoneIdx: maxPair.phoneIdx, phone: maxPair.phone, target: maxPair.target, rmsBefore: maxPair.rmsBefore, rmsAfter: maxPair.rmsAfter }
      : null,
    byType: typeSummary,
    byTarget: targetSummary,
    worst30Phones,
    worst50Pairs,
  };

  const summaryPath = path.join(args.outDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  // Build Markdown report
  const gzSizeMb = (fs.statSync(allGzPath).size / (1024 * 1024)).toFixed(2);
  const pickedDesc = Object.entries(byPickedBands)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([b, c]) => `${b} band: ${c.toLocaleString("en-US")} (${((100 * c) / Math.max(1, rows.length)).toFixed(1)}%)`)
    .join(" · ");
  const md = [
    "# Báo cáo Tổng kết Full Sweep Web AutoEQ (`60.000` cặp = `5.000` tai nghe × `12` target)",
    "",
    `- **Thời điểm hoàn tất**: \`${summary.generatedAt}\``,
    `- **Phiên bản mã nguồn**: HTML MD5 \`${summary.htmlMd5}\` · Solver Core MD5 \`${summary.solverCoreMd5}\` · Chế độ: \`${summary.mode}\``,
    `- **Hạ tầng song song**: \`${summary.shardsCount}\` shards · Shard lâu nhất: \`${summary.maxShardWallSec}s\` (~${(summary.maxShardWallSec / 60).toFixed(1)} phút) · Tổng thời gian shard gộp: \`${summary.sumShardWallSec}s\``,
    `- **Tổng số cặp đã giải**: **\`${summary.totalPairs.toLocaleString("en-US")}\`** (\`${summary.phonesComplete12}/${summary.uniquePhones}\` tai nghe đủ 12/12 target)`,
    `- **Phân bố số band được chọn**: ${pickedDesc}`,
    `- **Kiểm định an toàn**: Vi phạm giới hạn = **\`${summary.totalViolations}\`** · Null-boost = **\`${summary.totalNullBoosts}\`** · Trùng lặp = **\`${summary.duplicates}\`**`,
    `- **Dữ liệu nén**: \`results_all.jsonl.gz\` (\`${gzSizeMb} MB\`) · Bảng tổng hợp 5.000 tai nghe: \`all_phones_summary.csv\``,
    "",
    "## 1. Thống kê sai số khớp mục tiêu (RMS dB)",
    "",
    "| Tập dữ liệu | Số cặp | RMS Trung bình | Trung vị (p50) | p90 | p95 | p99 | Tốt nhất (Min) | Tệ nhất (Max) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| **Trước EQ (\`rmsBefore\`)** | ${summary.rmsBefore.count} | ${summary.rmsBefore.mean} dB | ${summary.rmsBefore.median} dB | ${summary.rmsBefore.p90} dB | ${summary.rmsBefore.p95} dB | ${summary.rmsBefore.p99} dB | ${summary.rmsBefore.min} dB | ${summary.rmsBefore.max} dB |`,
    `| **Sau EQ — Toàn bộ (\`0..4999\`)** | **${summary.rmsAfter.count}** | **${summary.rmsAfter.mean} dB** | **${summary.rmsAfter.median} dB** | **${summary.rmsAfter.p90} dB** | **${summary.rmsAfter.p95} dB** | **${summary.rmsAfter.p99} dB** | **${summary.rmsAfter.min} dB** | **${summary.rmsAfter.max} dB** |`,
    `| Phân đoạn đầu (\`0..1562\`) | ${summary.segments.first18756_0_to_1562.count} | ${summary.segments.first18756_0_to_1562.mean} dB | ${summary.segments.first18756_0_to_1562.median} dB | ${summary.segments.first18756_0_to_1562.p90} dB | ${summary.segments.first18756_0_to_1562.p95} dB | ${summary.segments.first18756_0_to_1562.p99} dB | ${summary.segments.first18756_0_to_1562.min} dB | ${summary.segments.first18756_0_to_1562.max} dB |`,
    `| **Phần còn lại (\`1563..4999\`)** | **${summary.segments.remaining41244_1563_to_4999.count}** | **${summary.segments.remaining41244_1563_to_4999.mean} dB** | **${summary.segments.remaining41244_1563_to_4999.median} dB** | **${summary.segments.remaining41244_1563_to_4999.p90} dB** | **${summary.segments.remaining41244_1563_to_4999.p95} dB** | **${summary.segments.remaining41244_1563_to_4999.p99} dB** | **${summary.segments.remaining41244_1563_to_4999.min} dB** | **${summary.segments.remaining41244_1563_to_4999.max} dB** |`,
    "",
    `- **Cặp khớp tốt nhất**: \`#${summary.bestPair ? summary.bestPair.phoneIdx : "-"} ${summary.bestPair ? summary.bestPair.phone : "-"} × ${summary.bestPair ? summary.bestPair.target : "-"}\` (\`${summary.bestPair ? summary.bestPair.rmsBefore : 0} → ${summary.bestPair ? summary.bestPair.rmsAfter : 0} dB\`)`,
    `- **Cặp khó nhất toàn cục**: \`#${summary.worstPair ? summary.worstPair.phoneIdx : "-"} ${summary.worstPair ? summary.worstPair.phone : "-"} × ${summary.worstPair ? summary.worstPair.target : "-"}\` (\`${summary.worstPair ? summary.worstPair.rmsBefore : 0} → ${summary.worstPair ? summary.worstPair.rmsAfter : 0} dB\`)`,
    "",
    "## 2. Phân tích theo Loại tai nghe (`type`)",
    "",
    "| Loại tai nghe | Số cặp | RMS Trung bình | Trung vị | p95 | Max |",
    "|---|---:|---:|---:|---:|---:|",
    ...Object.entries(summary.byType).map(
      ([t, s]) => `| **${t}** | ${s.count} | ${s.mean} dB | ${s.median} dB | ${s.p95} dB | ${s.max} dB |`
    ),
    "",
    "## 3. Phân tích theo Đường mục tiêu (`target`)",
    "",
    "| Target | Số cặp | RMS Trung bình | Trung vị | p95 | Max |",
    "|---|---:|---:|---:|---:|---:|",
    ...Object.entries(summary.byTarget).map(
      ([t, s]) => `| \`${t}\` | ${s.count} | ${s.mean} dB | ${s.median} dB | ${s.p95} dB | ${s.max} dB |`
    ),
    "",
    "## 4. Top 15 Tai nghe có RMS trung bình cao nhất (Đầu vào phục vụ nâng cấp `[L2]`)",
    "",
    "| # | PhoneIdx | Tai nghe | Loại | RMS TB (12 target) | RMS Tệ nhất | Target tệ nhất |",
    "|---:|---:|---|---|---:|---:|---|",
    ...summary.worst30Phones.slice(0, 15).map(
      (p, i) => `| ${i + 1} | ${p.phoneIdx} | ${p.phone} | ${p.type} | ${p.meanRmsAfter} dB | ${p.maxRmsAfter} dB | \`${p.worstTarget}\` |`
    ),
    "",
    "## 5. Top 20 Cặp `(Tai nghe × Target)` dư sai cao nhất toàn cục",
    "",
    "| # | PhoneIdx | Tai nghe | Loại | Target | Trước EQ | Sau EQ | Thời gian |",
    "|---:|---:|---|---|---|---:|---:|---:|",
    ...summary.worst50Pairs.slice(0, 20).map(
      (r, i) => `| ${i + 1} | ${r.phoneIdx} | ${r.phone} | ${r.type} | \`${r.target}\` | ${r.rmsBefore} dB | **${r.rmsAfter} dB** | ${r.ms} ms |`
    ),
    "",
  ].join("\n");

  const reportPath = path.join(args.outDir, "REPORT.md");
  fs.writeFileSync(reportPath, md, "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      totalPairs: summary.totalPairs,
      rmsAfterMean: summary.rmsAfter.mean,
      rmsAfterMedian: summary.rmsAfter.median,
      violations: summary.totalViolations,
      nullBoosts: summary.totalNullBoosts,
      reportPath,
      summaryPath,
      allGzPath,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
