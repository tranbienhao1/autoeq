"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_MD = path.join(ROOT, ".agent", "workflows", "auto_evolve_30m.md");
const RULE_MD = path.join(ROOT, ".agent", "rules", "autoeq_autonomy.md");
const SCHEDULE_STATE_MD = path.join(ROOT, ".agent", "SCHEDULE_STATE.md");
const LOOP_SCRIPT = path.join(ROOT, "scripts", "antigravity_30m_loop.js");
const VERIFY_SCRIPT = path.join(ROOT, "scripts", "verify_autoeq.js");
const GH_WORKFLOW = path.join(ROOT, ".github", "workflows", "antigravity-30m.yml");
const STATE_JSON = path.join(ROOT, ".antigravity", "autoeq_loop_state.json");
const CHANGELOG_MD = path.join(ROOT, "AUTOEQ_CHANGELOG.md");
const GITIGNORE = path.join(ROOT, ".gitignore");
const SIDECAR_JSON = "C:\\Users\\thien\\.gemini\\config\\sidecars\\autoeq-autopilot\\sidecar.json";

const FORBIDDEN_TOKENS = [
  "thien" + "nguyen",
  "Noc" + "turne",
  "Fi" + "iO",
  "LRC" + "LIB",
  "lrc" + "get",
  "A" + "PK",
  "And" + "roid",
  "BitPerfect" + "AudioPlayer",
  "D" + "SD",
  "D" + "SD64",
  "D" + "SD128",
  "D" + "SD256"
];
const FORBIDDEN_RE = new RegExp("\\b(" + FORBIDDEN_TOKENS.join("|") + ")\\b", "i");

describe("AutoEQ 30-Minute & 1-Minute Chained Scheduling System", () => {
  it("1. .agent/workflows/auto_evolve_30m.md has 3-section layout, 4-step AutoEQ cycle, 60s chaining & compact < 2000 char Section III", () => {
    assert.ok(fs.existsSync(WORKFLOW_MD), "auto_evolve_30m.md must exist");
    const content = fs.readFileSync(WORKFLOW_MD, "utf8");
    assert.ok(!content.includes("\r\n"), "auto_evolve_30m.md must use LF line endings");

    assert.match(content, /https:\/\/github\.com\/tranbienhao1\/autoeq/);
    assert.match(content, /autoeq-autopilot/);
    assert.match(content, /## I\. QUY TẮC TỰ HÀNH/);
    assert.match(content, /## II\. QUY TRÌNH 4 BƯỚC TRONG MỖI CHU KỲ 30 PHÚT/);
    assert.match(content, /### BƯỚC 1: TỰ ĐỘNG DÒ LỖI & TỰ SỬA \(`BUG HUNT & SELF-HEALING`\)/);
    assert.match(content, /### BƯỚC 2: TÌM CẢI TIẾN & NÂNG CẤP CHẤT ÂM CHO CÁC TARGET CURVES/);
    assert.match(content, /### BƯỚC 3: ĐO LƯỜNG KIỂM CHỨNG \(`3-TIER VERIFICATION GATE`\)/);
    assert.match(content, /### BƯỚC 4: QUÁ TRÌNH LÀM VIỆC NỐI ĐUÔI 1 PHÚT \(`1-MINUTE CHAINED FOLLOW-UP`\)/);
    assert.match(content, /## III\. BẢN PROMPT SCHEDULE RÚT GỌN/);

    assert.match(content, /CronExpression="\*\/30 \* \* \* \*"/);
    assert.match(content, /IsDaemon=true/);
    assert.match(content, /DurationSeconds\s*=\s*60/);
    assert.match(content, /TimerCondition\s*=\s*"never"/);
    assert.match(content, /max_composite_gain \+ preamp <= -0\.2 dBFS/);
    assert.match(content, /44\.1\s*kHz.*48\s*kHz.*88\.2\s*kHz.*96\s*kHz/);
    assert.match(content, /711.*5128/);
    assert.match(content, /\.antigravity\/autoeq_loop_state\.json/);
    assert.match(content, /AUTOEQ_CHANGELOG\.md/);
    assert.match(content, /teamwork/i);
    assert.match(content, /\[skip-interview\]/);

    const sec3Marker = "## III. BẢN PROMPT SCHEDULE RÚT GỌN (< 2.000 KÝ TỰ) — PHẦN 3";
    const idx = content.indexOf(sec3Marker);
    assert.ok(idx >= 0, "Section III header must exist");
    const sec3Body = content.slice(idx + sec3Marker.length).trim();
    assert.ok(sec3Body.length > 200 && sec3Body.length < 2000, `Section III length (${sec3Body.length}) must be < 2000 chars`);
  });

  it("2. .agent/rules/autoeq_autonomy.md has alwaysApply frontmatter, Zero-Dependency, LF & DSP/anti-clipping rules", () => {
    assert.ok(fs.existsSync(RULE_MD), "autoeq_autonomy.md must exist");
    const content = fs.readFileSync(RULE_MD, "utf8");
    assert.ok(!content.includes("\r\n"), "autoeq_autonomy.md must use LF line endings");
    assert.match(content, /^---\ndescription: .+\nglobs: "\*\*\/\*"\nalwaysApply: true\n---/);
    assert.match(content, /package\.json/);
    assert.match(content, /LF \(`\\n`\)/);
    assert.match(content, /max_composite_gain \+ preamp <= -0\.2 dBFS/);
    assert.match(content, /DurationSeconds=60/);
    assert.match(content, /TimerCondition="never"/);
    assert.match(content, /verify_autoeq\.js/);
    assert.match(content, /teamwork/i);
    assert.match(content, /\[skip-interview\]/);
  });

  it("3. .agent/SCHEDULE_STATE.md matches expected structure", () => {
    assert.ok(fs.existsSync(SCHEDULE_STATE_MD), "SCHEDULE_STATE.md must exist");
    const content = fs.readFileSync(SCHEDULE_STATE_MD, "utf8");
    assert.ok(!content.includes("\r\n"), "SCHEDULE_STATE.md must use LF line endings");
    assert.match(content, /\*\*run_id\*\*:\s*\d+/);
    assert.match(content, /\*\*branch\*\*:\s*autoeq-autopilot/);
    assert.match(content, /\*\*last_commit\*\*:/);
    assert.match(content, /\*\*status\*\*:/);
    assert.match(content, /\*\*active_chain\*\*:/);
    assert.match(content, /## next_queue/);
    assert.match(content, /## completed_history/);
    assert.match(content, /## do_not_repeat/);
    assert.match(content, /## blockers/);
  });

  it("4. scripts/antigravity_30m_loop.js exports required API, retains setInterval, passes --dry-run without mutating state", () => {
    assert.ok(fs.existsSync(LOOP_SCRIPT), "antigravity_30m_loop.js must exist");
    const code = fs.readFileSync(LOOP_SCRIPT, "utf8");
    assert.ok(!code.includes("\r\n"), "antigravity_30m_loop.js must use LF line endings");
    execFileSync(process.execPath, ["--check", LOOP_SCRIPT], { stdio: "pipe" });

    assert.ok(code.includes("setInterval(runCycle, INTERVAL_MS);"), "must retain setInterval(runCycle, INTERVAL_MS);");
    const mod = require(LOOP_SCRIPT);
    assert.equal(mod.INTERVAL_MS, 30 * 60 * 1000);
    assert.equal(typeof mod.loadOrCreateState, "function");
    assert.equal(typeof mod.scanCodebaseHealth, "function");
    assert.equal(typeof mod.runCycle, "function");
    assert.ok(Array.isArray(mod.DEFAULT_QUEUE) && mod.DEFAULT_QUEUE.length === 6);
    assert.ok(mod.STATE_FILE.endsWith(path.join(".antigravity", "autoeq_loop_state.json")));

    const health = mod.scanCodebaseHealth();
    assert.equal(health.syntaxErrors.length, 0, `Unexpected syntaxErrors: ${JSON.stringify(health.syntaxErrors)}`);

    const beforeStat = fs.existsSync(STATE_JSON) ? fs.readFileSync(STATE_JSON, "utf8") : null;
    execFileSync(process.execPath, [LOOP_SCRIPT, "--dry-run"], { cwd: ROOT, stdio: "pipe" });
    const afterStat = fs.existsSync(STATE_JSON) ? fs.readFileSync(STATE_JSON, "utf8") : null;
    assert.equal(afterStat, beforeStat, "--dry-run must not mutate .antigravity/autoeq_loop_state.json");
  });

  it("5. scripts/verify_autoeq.js exists, uses LF, and passes node --check", () => {
    assert.ok(fs.existsSync(VERIFY_SCRIPT), "verify_autoeq.js must exist");
    const code = fs.readFileSync(VERIFY_SCRIPT, "utf8");
    assert.ok(!code.includes("\r\n"), "verify_autoeq.js must use LF line endings");
    execFileSync(process.execPath, ["--check", VERIFY_SCRIPT], { stdio: "pipe" });
  });

  it("6. .github/workflows/antigravity-30m.yml defines 30m cron, workflow_dispatch, loop + node --test", () => {
    assert.ok(fs.existsSync(GH_WORKFLOW), "antigravity-30m.yml must exist");
    const yml = fs.readFileSync(GH_WORKFLOW, "utf8");
    assert.ok(!yml.includes("\r\n"), "antigravity-30m.yml must use LF line endings");
    assert.match(yml, /cron: '\*\/30 \* \* \* \*'/);
    assert.match(yml, /workflow_dispatch:/);
    assert.match(yml, /contents: write/);
    assert.match(yml, /scripts\/antigravity_30m_loop\.js --once/);
    assert.match(yml, /node --test tests\/\*\.test\.cjs/);
    assert.match(yml, /\[skip ci\]/);
  });

  it("7. .antigravity/autoeq_loop_state.json has valid JSON and all R2 + watchdog fields", () => {
    assert.ok(fs.existsSync(STATE_JSON), "autoeq_loop_state.json must exist");
    const raw = fs.readFileSync(STATE_JSON, "utf8");
    assert.ok(!raw.includes("\r\n"), "autoeq_loop_state.json must use LF line endings");
    const state = JSON.parse(raw);

    assert.equal(state.repo, "https://github.com/tranbienhao1/autoeq");
    assert.equal(state.branch, "autoeq-autopilot");
    assert.equal(state.cadenceMinutes, 30);
    assert.ok(typeof state.git_head === "string" && state.git_head.length >= 7);
    assert.ok(typeof state.cycle_id === "number" && state.cycle_id >= 0);
    assert.ok(typeof state.chained_step_count === "number" && state.chained_step_count >= 0 && state.chained_step_count <= 3);
    assert.ok(state.baseline_metrics && typeof state.baseline_metrics === "object");
    assert.ok(state.baseline_metrics.samples36 && typeof state.baseline_metrics.samples36.rmsAfterMean === "number");
    assert.ok(state.baseline_metrics.stratified600 && typeof state.baseline_metrics.stratified600.rmsAfterMean === "number");
    assert.ok(Array.isArray(state.open_bugs));
    assert.ok(Array.isArray(state.tested_hypotheses));
    assert.ok(state.diagnostics && Array.isArray(state.diagnostics.syntaxErrors));
    assert.equal(state.diagnostics.syntaxErrors.length, 0);
    assert.ok(Array.isArray(state.pendingQueue) && state.pendingQueue.length > 0);
    assert.ok(Array.isArray(state.completedTasks));
  });

  it("8. AUTOEQ_CHANGELOG.md, .gitignore & Zero-Dependency invariants hold", () => {
    assert.ok(fs.existsSync(CHANGELOG_MD), "AUTOEQ_CHANGELOG.md must exist");
    const chg = fs.readFileSync(CHANGELOG_MD, "utf8");
    assert.ok(!chg.includes("\r\n"), "AUTOEQ_CHANGELOG.md must use LF line endings");
    assert.match(chg, /docs\/auto-audit-log\.md/);
    assert.match(chg, /d2d12cc/);

    const gi = fs.readFileSync(GITIGNORE, "utf8");
    assert.ok(!gi.includes("\r\n"), ".gitignore must use LF line endings");
    assert.match(gi, /\.agent\/RUN\.LOCK/);
    assert.match(gi, /\.antigravity\/\*\.lock/);
    assert.doesNotMatch(gi, /^\.antigravity\/?$/m);
    assert.doesNotMatch(gi, /^\.agent\/?$/m);

    assert.equal(fs.existsSync(path.join(ROOT, "package.json")), false, "Zero-Dependency: package.json must NOT exist");
    assert.equal(fs.existsSync(path.join(ROOT, "node_modules")), false, "Zero-Dependency: node_modules must NOT exist");
  });

  it("9. Zero legacy reference-repo leftovers & sidecar.json reconciled", () => {
    const filesToScan = [
      WORKFLOW_MD,
      RULE_MD,
      SCHEDULE_STATE_MD,
      LOOP_SCRIPT,
      VERIFY_SCRIPT,
      GH_WORKFLOW,
      STATE_JSON,
      CHANGELOG_MD,
      GITIGNORE,
      __filename,
      path.join(ROOT, "tests", "autoeq-dsp-verification.test.cjs")
    ];
    for (const f of filesToScan) {
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      const m = text.match(FORBIDDEN_RE);
      assert.equal(m, null, `Forbidden reference ${m && m[0]} found in ${path.relative(ROOT, f)}`);
    }

    if (fs.existsSync(SIDECAR_JSON)) {
      const sidecarRaw = fs.readFileSync(SIDECAR_JSON, "utf8");
      const sidecar = JSON.parse(sidecarRaw);
      assert.equal(sidecar.builtin, "schedule");
      assert.ok(Array.isArray(sidecar.args) && sidecar.args[0].includes("*/30 * * * *"));
      const joined = JSON.stringify(sidecar);
      assert.equal(joined.match(FORBIDDEN_RE), null, "sidecar.json must have zero forbidden references");
      assert.doesNotMatch(joined, /python\s+-m\s+http\.server/, "sidecar.json must not reference missing python command");
      assert.match(joined, /verify_autoeq\.js/);
      assert.match(joined, /autoeq_loop_state\.json/);
      assert.match(joined, /AUTOEQ_CHANGELOG\.md/);
      assert.match(joined, /DurationSeconds=60/);
      assert.match(joined, /teamwork/i);
      assert.match(joined, /\[skip-interview\]/);
    }
  });

  it("10. scripts/antigravity_30m_loop.js works under setInterval-stripping eval(code) in isolated mock repo and throws contextual JSON error", () => {
    const probeParent = fs.mkdtempSync(path.join(os.tmpdir(), "autoeq-loop-eval-"));
    const mockRepo = path.join(probeParent, "mock_repo");
    const mockScripts = path.join(mockRepo, "scripts");
    fs.mkdirSync(mockScripts, { recursive: true });
    const mockLoopPath = path.join(mockScripts, "antigravity_30m_loop.js");
    fs.copyFileSync(LOOP_SCRIPT, mockLoopPath);

    try {
      const evalDriver = [
        "const fs = require('node:fs');",
        "let code = fs.readFileSync('scripts/antigravity_30m_loop.js', 'utf8');",
        "code = code.replace('setInterval(runCycle, INTERVAL_MS);', '');",
        "eval(code);"
      ].join("");

      execFileSync(process.execPath, ["-e", evalDriver], {
        cwd: mockRepo,
        stdio: "pipe"
      });

      const mockStatePath = path.join(mockRepo, ".antigravity", "autoeq_loop_state.json");
      const parentStateDir = path.join(probeParent, ".antigravity");
      assert.equal(fs.existsSync(mockStatePath), true, "eval(code) must create .antigravity/autoeq_loop_state.json inside mock_repo");
      assert.equal(fs.existsSync(parentStateDir), false, "eval(code) must NOT write .antigravity in parent directory");

      const created = JSON.parse(fs.readFileSync(mockStatePath, "utf8"));
      assert.equal(created.cycle_id, 1);
      assert.equal(created.cycleCount, 1);
      assert.equal(created.diagnostics.syntaxErrors.length, 0);

      const beforeDry = fs.readFileSync(mockStatePath, "utf8");
      execFileSync(process.execPath, [mockLoopPath, "--dry-run"], {
        cwd: mockRepo,
        stdio: "pipe"
      });
      assert.equal(fs.readFileSync(mockStatePath, "utf8"), beforeDry, "--dry-run must not mutate mock state");

      fs.writeFileSync(mockStatePath, "{bad-json", "utf8");
      assert.throws(
        () => {
          execFileSync(process.execPath, [mockLoopPath, "--dry-run"], {
            cwd: mockRepo,
            stdio: "pipe"
          });
        },
        (err) => {
          const msg = String(err.stderr || err.message || "");
          return msg.includes("Invalid JSON in ") && msg.includes("autoeq_loop_state.json");
        }
      );
    } finally {
      fs.rmSync(probeParent, { recursive: true, force: true });
    }
  });
});
