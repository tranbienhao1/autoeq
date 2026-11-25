#!/usr/bin/env node
/**
 * Antigravity 30-Minute Continuous Watchdog & Codebase Auditor
 * Repo: https://github.com/tranbienhao1/autoeq (branch: autoeq-autopilot)
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execSync } = require("node:child_process");

const ROOT_DIR = module.id === "[eval]" ? process.cwd() : path.resolve(__dirname, "..");
const STATE_DIR = path.join(ROOT_DIR, ".antigravity");
const STATE_FILE = path.join(STATE_DIR, "autoeq_loop_state.json");
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (1,800,000 ms)

const DEFAULT_QUEUE = [
  {
    id: "BUG-01",
    phase: "BUG_HUNT",
    title: "Kiểm toán tích hợp upDecrampedPeakingCoeffs giữa engine chính và AE_WORKER_SRC / aeBandCurve trên 44.1/48/88.2/96 kHz đảm bảo ổn định Jury (|pole| < 1)"
  },
  {
    id: "UPG-01",
    phase: "UPGRADE",
    title: "Thử nghiệm hàm mất mát miền năng lượng / Soft L1 (Huber Loss) và trung bình năng lượng dải > 10 kHz trong aeSolveObjective cho toàn bộ 12 AE_TARGETS"
  },
  {
    id: "OPT-01",
    phase: "OPTIMIZE",
    title: "Tối ưu hóa thuật toán khởi tạo hạt giống aeBuildSeed12 / aeSolveSeeded và giảm thời gian hội tụ đa dải trên nhóm tai nghe RMSE cao"
  },
  {
    id: "BUG-02",
    phase: "BUG_HUNT",
    title: "Kiểm tra điều kiện biên parser aeParseMeasurement / dbParseMeasurement (mốc 1 kHz, tần số trùng/chưa sắp xếp, L/R channel split, coupler 711 vs B&K 5128) và anti-clipping headroom <= -0.2 dBFS"
  },
  {
    id: "UPG-02",
    phase: "UPGRADE",
    title: "Bổ sung phạt anti-ringing cho Peaking boost Q cao và ưu tiên chuyển đổi mượt Low-Shelf / High-Shelf trên các đường cong Harman, IEF, Diffuse Field, JM-1"
  },
  {
    id: "OPT-02",
    phase: "OPTIMIZE",
    title: "Tối ưu hóa hiệu năng hwSolve / geqFit và giảm cấp phát bộ nhớ tạm trong AudioWorklet / solver worker fallback"
  }
];

function getGitValue(args, fallback = null) {
  try {
    return execFileSync("git", args, { cwd: ROOT_DIR, stdio: ["ignore", "pipe", "pipe"] })
      .toString("utf8")
      .trim();
  } catch {
    return fallback;
  }
}

function hasGitUpstream() {
  return getGitValue(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], null) !== null;
}

function buildInitialState() {
  const gitHead = getGitValue(["rev-parse", "HEAD"], "unknown");
  const branch = getGitValue(["branch", "--show-current"], "autoeq-autopilot") || "autoeq-autopilot";
  return {
    repo: "https://github.com/tranbienhao1/autoeq",
    branch,
    cadenceMinutes: 30,
    cycleCount: 0,
    cycle_id: 0,
    chained_step_count: 0,
    git_head: gitHead,
    lastPhase: "OPTIMIZE",
    lastRunIso: null,
    baseline_metrics: {},
    open_bugs: [],
    tested_hypotheses: [],
    diagnostics: { syntaxErrors: [], warnings: [] },
    pendingQueue: DEFAULT_QUEUE.map((item) => ({ ...item })),
    completedTasks: []
  };
}

function loadOrCreateState(options = {}) {
  const dryRun = Boolean(options && options.dryRun);
  if (!fs.existsSync(STATE_FILE)) {
    const initial = buildInitialState();
    if (!dryRun) {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2) + "\n", "utf8");
    }
    return initial;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (err) {
    throw new Error("Invalid JSON in " + STATE_FILE + ": " + err.message);
  }
  if (!Array.isArray(parsed.pendingQueue)) parsed.pendingQueue = DEFAULT_QUEUE.map((item) => ({ ...item }));
  if (!Array.isArray(parsed.completedTasks)) parsed.completedTasks = [];
  if (!Array.isArray(parsed.open_bugs)) parsed.open_bugs = [];
  if (!Array.isArray(parsed.tested_hypotheses)) parsed.tested_hypotheses = [];
  if (typeof parsed.chained_step_count !== "number") parsed.chained_step_count = 0;
  if (typeof parsed.cycle_id !== "number") parsed.cycle_id = parsed.cycleCount || 0;
  return parsed;
}

function scanCodebaseHealth() {
  const syntaxErrors = [];
  const warnings = [];
  const scanDirs = ["src", "data", "scripts", "tests"];

  // Zero-Dependency enforcement
  if (fs.existsSync(path.join(ROOT_DIR, "package.json"))) {
    syntaxErrors.push({
      file: "package.json",
      error: "Zero-Dependency violation: package.json must not exist in autoeq."
    });
  }
  if (fs.existsSync(path.join(ROOT_DIR, "node_modules"))) {
    syntaxErrors.push({
      file: "node_modules",
      error: "Zero-Dependency violation: node_modules/ must not exist in autoeq."
    });
  }

  const checkJsFile = (fullPath) => {
    const rel = path.relative(ROOT_DIR, fullPath).replace(/\\/g, "/");
    try {
      execFileSync(process.execPath, ["--check", fullPath], { stdio: "pipe" });
    } catch (err) {
      syntaxErrors.push({
        file: rel,
        error: String(err.stderr || err.message).trim().slice(0, 300)
      });
    }
    const content = fs.readFileSync(fullPath, "utf8");
    if (content.includes("\r\n")) {
      syntaxErrors.push({
        file: rel,
        error: "CRLF line endings detected; LF (\\n) is strictly required."
      });
    }
    if (rel === "src/06-database-export.js") {
      if (!content.includes("var DB_GRID = [];") || !content.includes("/* ================================================================\n   Chặng 2 bước 2.2")) {
        syntaxErrors.push({
          file: rel,
          error: "Missing extract_core.js LF marker in src/06-database-export.js."
        });
      }
    }
    if (rel.startsWith("src/") && content.includes("createObjectURL(") && !content.includes("revokeObjectURL(")) {
      warnings.push(`${rel}: Uses URL.createObjectURL without URL.revokeObjectURL in the same module.`);
    }
  };

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", ".cache", "sweep-shards", "tmp", ".agents"].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".cjs")) {
        checkJsFile(fullPath);
      }
    }
  };

  for (const dirName of scanDirs) {
    walk(path.join(ROOT_DIR, dirName));
  }

  const indexHtmlPath = path.join(ROOT_DIR, "index.html");
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    if (html.includes("\r\n")) {
      syntaxErrors.push({
        file: "index.html",
        error: "CRLF line endings detected in index.html; LF (\\n) is required."
      });
    }
    const openScripts = (html.match(/<script\b[^>]*>/gi) || []).length;
    const closeScripts = (html.match(/<\/script>/gi) || []).length;
    if (openScripts !== closeScripts) {
      syntaxErrors.push({
        file: "index.html",
        error: `Mismatched <script> tags (${openScripts} open / ${closeScripts} close)`
      });
    }
  }

  return { syntaxErrors, warnings };
}

function runCycle(options = {}) {
  const dryRun = Boolean(options && options.dryRun);
  const nowIso = new Date().toISOString();
  console.log(`\n[Antigravity 30m AutoEQ Engine] Cycle scan started at ${nowIso}${dryRun ? " (dry-run)" : ""}`);

  if (!dryRun && hasGitUpstream()) {
    try {
      execSync("git pull --rebase origin HEAD", { cwd: ROOT_DIR, stdio: "inherit" });
    } catch {
      console.warn("[Antigravity 30m AutoEQ Engine] Skipped git pull --rebase (offline or local changes).");
    }
  } else {
    console.log("[Antigravity 30m AutoEQ Engine] No remote tracking upstream configured for current branch; operating locally.");
  }

  const state = loadOrCreateState({ dryRun });
  const health = scanCodebaseHealth();
  const gitHead = getGitValue(["rev-parse", "HEAD"], state.git_head || "unknown");

  if (!dryRun) {
    state.git_head = gitHead;
    state.cycleCount = (state.cycleCount || 0) + 1;
    state.cycle_id = state.cycleCount;
    state.lastRunIso = nowIso;
    state.diagnostics = health;

    if (health.syntaxErrors.length > 0) {
      state.pendingQueue.unshift({
        id: `URGENT-FIX-${Date.now()}`,
        phase: "BUG_HUNT",
        title: `Fix ${health.syntaxErrors.length} syntax/invariant error(s) in: ${health.syntaxErrors.map((e) => e.file).join(", ")}`
      });
    }
    if (state.pendingQueue.length === 0) {
      state.pendingQueue.push(...DEFAULT_QUEUE.map((item) => ({ ...item })));
    }

    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  const nextTask = (state.pendingQueue && state.pendingQueue[0]) || DEFAULT_QUEUE[0];
  console.log(
    `[Antigravity 30m AutoEQ Engine] Head=${gitHead.slice(0, 7)} | SyntaxErrors=${health.syntaxErrors.length} | Warnings=${health.warnings.length}`
  );
  console.log(`[Antigravity 30m AutoEQ Engine] Next queued task: [${nextTask.phase}] ${nextTask.title}`);
  return { state, health, dryRun };
}

if (require.main === module || module.id === "[eval]") {
  const argv = process.argv.slice(2);
  if (argv.includes("--check")) {
    const state = loadOrCreateState({ dryRun: true });
    const health = scanCodebaseHealth();
    console.log(
      JSON.stringify(
        {
          ok: health.syntaxErrors.length === 0,
          branch: state.branch,
          git_head: state.git_head,
          cycle_id: state.cycle_id,
          chained_step_count: state.chained_step_count,
          syntaxErrors: health.syntaxErrors,
          warnings: health.warnings
        },
        null,
        2
      )
    );
    process.exit(health.syntaxErrors.length === 0 ? 0 : 1);
  } else if (argv.includes("--dry-run")) {
    const { health } = runCycle({ dryRun: true });
    process.exit(health.syntaxErrors.length === 0 ? 0 : 1);
  } else {
    runCycle({ dryRun: false });
    if (!argv.includes("--once")) {
      setInterval(runCycle, INTERVAL_MS);
    }
  }
}

module.exports = {
  loadOrCreateState,
  scanCodebaseHealth,
  runCycle,
  DEFAULT_QUEUE,
  INTERVAL_MS,
  STATE_DIR,
  STATE_FILE
};
