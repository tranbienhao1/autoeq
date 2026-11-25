"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CORE_PATH = path.join(ROOT, ".cache", "autoeq_core.cjs");

function loadCoreBundle() {
  if (!fs.existsSync(CORE_PATH)) {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "sweep", "extract_core.js")], {
      cwd: ROOT,
      stdio: "pipe"
    });
  }
  return require(CORE_PATH);
}

function createAutoEqVmContext() {
  const els = new Map();
  const makeEl = (id) => {
    const el = {
      id: id || "",
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getAttribute() { return null; },
      appendChild(ch) {
        el.children.push(ch);
        if (ch && ch.value !== undefined) el.options.push(ch);
        return ch;
      },
      insertBefore(ch) { return el.appendChild(ch); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      parentNode: null,
      value: id === "aeTarget" ? "harmanOE" : (id === "aeSmooth" ? "psycho" : "0"),
      checked: false,
      disabled: false,
      textContent: "",
      innerHTML: "",
      files: [],
      options: [],
      children: [],
      childNodes: [],
      dataset: {},
      width: 300,
      height: 150,
      getContext() { return null; }
    };
    return el;
  };
  const doc = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    createElement(tag) { return makeEl(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: makeEl("body"),
    addEventListener() {}
  };

  // Non-retaining timers so background module initialization timers cannot hang node --test
  const safeSetInterval = () => 0;
  const safeSetTimeout = () => 0;

  const ctx = vm.createContext({
    console, Math, Array, Object, Number, String, Boolean, JSON, Date, RegExp, Error, TypeError, RangeError,
    Map, Set, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, ArrayBuffer, DataView,
    isFinite, isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, atob, btoa,
    setTimeout: safeSetTimeout,
    clearTimeout() {},
    setInterval: safeSetInterval,
    clearInterval() {},
    performance: { now: () => Date.now() },
    document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: "node-vm" },
    location: { search: "", href: "http://localhost/" },
    Blob,
    URL: undefined,
    Worker: undefined,
    AudioContext: undefined,
    WebAssembly,
    drawGraph() {},
    updateAll() {},
    buildUI() {},
    syncPreUI() {},
    pushCoeffs() {}
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;

  const scripts = [
    "src/01-dsp-core.js",
    "src/03-autoeq-solver.js",
    "data/headphone-db.js",
    "src/06-database-export.js",
    "src/upgrades/03-rig-weighted.js",
    "src/upgrades/04-decramped-biquad.js"
  ];
  for (const rel of scripts) {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    vm.runInContext(code, ctx, { filename: rel });
  }
  return ctx;
}

describe("AutoEQ DSP, Anti-Clipping, Parsers & Multi-Target Verification", () => {
  const vmCtx = createAutoEqVmContext();
  const core = loadCoreBundle();

  it("1. RBJ Biquad & Jury stability (|pole| < 1) across 44.1 / 48 / 88.2 / 96 kHz + decramped peaking", () => {
    const rates = [44100, 48000, 88200, 96000];
    const types = ["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass", "notch", "allpass"];
    const freqs = [20, 100, 1000, 8000, 16000, 20000];
    const gains = [-12, 0, 12];
    const qs = [0.5, 1.41, 10];

    for (const fsRate of rates) {
      for (const ty of types) {
        for (const fc of freqs) {
          for (const g of gains) {
            for (const q of qs) {
              const c = vmCtx.rbjCoeffs(ty, fc, g, q, fsRate);
              assert.ok(Number.isFinite(c.b0 + c.b1 + c.b2 + c.a1 + c.a2), `Non-finite RBJ coeff at fs=${fsRate} ${ty} ${fc}Hz`);
              assert.equal(vmCtx.UP.pure4.upIsBiquadStable(c), true, `Jury unstable at fs=${fsRate} ${ty} ${fc}Hz g=${g} Q=${q}`);
            }
          }
        }
      }
      // Decramped peaking reduces Nyquist cramping at 14 kHz vs standard RBJ
      const dec = vmCtx.UP.pure4.upDecrampedPeakingCoeffs(14000, 8, 1.5, fsRate);
      assert.equal(vmCtx.UP.pure4.upIsBiquadStable(dec), true, `Decramped unstable at fs=${fsRate}`);
      const rbj = vmCtx.rbjCoeffs("peaking", 14000, 8, 1.5, fsRate);
      const errAt = (coeff) => {
        let s = 0, n = 0;
        for (let i = 0; i <= 40; i++) {
          const f = 14000 * Math.pow(20000 / 14000, i / 40);
          const e = vmCtx.biquadMagDb(coeff, f, fsRate) - vmCtx.UP.pure4.upAnalogPeakingMagDb(14000, 8, 1.5, f);
          s += e * e;
          n++;
        }
        return Math.sqrt(s / n);
      };
      if (fsRate <= 48000) {
        assert.ok(errAt(dec) < errAt(rbj), `Decramped should reduce Nyquist cramping error at fs=${fsRate}`);
      }
    }

    assert.equal(vmCtx.UP.pure4.upIsBiquadStable({ b0: 1, b1: 0, b2: 0, a1: -2.1, a2: 1.05 }), false);
    const sc4 = vmCtx.UP.selfCheck4();
    assert.equal(sc4.pass, sc4.total, `UP.selfCheck4 failures: ${sc4.msgs.join("; ")}`);
  });

  it("2. NaN / Inf / degenerate parameter safety in rbjCoeffs and upDecrampedPeakingCoeffs", () => {
    const badInputs = [
      ["peaking", NaN, 6, 1, 48000],
      ["peaking", 1000, Infinity, 1, 48000],
      ["lowshelf", 100, 6, -Infinity, 48000],
      ["highshelf", 8000, 6, 1, 0],
      ["peaking", 1000, 6, 1, -48000],
      ["unknown_type", 1000, 6, 1, 48000],
      ["lowshelf", 100, 6, 1, 48000, -10]
    ];
    for (const args of badInputs) {
      const c = vmCtx.rbjCoeffs(...args);
      assert.ok(Number.isFinite(c.b0 + c.b1 + c.b2 + c.a1 + c.a2));
      assert.equal(vmCtx.UP.pure4.upIsBiquadStable(c), true);
    }
    const decBad = vmCtx.UP.pure4.upDecrampedPeakingCoeffs(NaN, 6, 1.5, 48000);
    assert.deepEqual({ ...decBad }, { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
  });

  it("3. Anti-clipping invariant: max_composite_gain + preamp <= -0.2 dBFS across sample rates & solver outputs", () => {
    // Configure multi-band positive gains in VM and verify computeAutoPre
    vmCtx.preMode = "auto";
    vmCtx.extraHeadDb = 0;
    for (let i = 0; i < vmCtx.bands.length; i++) {
      vmCtx.bands[i].on = true;
      vmCtx.bands[i].gain = i === 1 ? 7.5 : (i === 5 ? 6.0 : (i === 8 ? 5.0 : 0));
    }
    vmCtx.BAND_CC.length = 0;
    vmCtx.GRID_TOT = {};

    for (const fsRate of [44100, 48000, 88200, 96000]) {
      vmCtx.computeAutoPre(fsRate);
      let maxComposite = -Infinity;
      for (let k = 0; k <= 960; k++) {
        const f = 20 * Math.pow(1000, k / 960);
        const g = vmCtx.totalDbAt(f, fsRate);
        if (g > maxComposite) maxComposite = g;
      }
      const headroom = maxComposite + vmCtx.autoPreDb;
      assert.ok(headroom <= -0.2 + 1e-6, `Anti-clipping violated at fs=${fsRate}: ${headroom.toFixed(4)} dBFS`);
      assert.ok(headroom <= -1.0 + 1e-3, `CEIL_DB=-1.0 expected, got ${headroom.toFixed(4)} dBFS`);
    }

    // BUG-03 regression: 16 kHz +12 dB highshelf @ 88.2 / 96 kHz must not clip above 20 kHz
    const savedBands = vmCtx.bands.map((b) => ({ ...b }));
    try {
      for (let i = 0; i < vmCtx.bands.length; i++) {
        vmCtx.bands[i].on = i === 0;
        vmCtx.bands[i].type = "highshelf";
        vmCtx.bands[i].freq = 16000;
        vmCtx.bands[i].gain = i === 0 ? 12 : 0;
        vmCtx.bands[i].q = 0.707;
      }
      vmCtx.BAND_CC.length = 0;
      vmCtx.GRID_TOT = {};
      for (const fsRate of [44100, 48000, 88200, 96000]) {
        vmCtx.computeAutoPre(fsRate);
        const nyq = fsRate / 2;
        const probes = [0, 20, 1000, 16000, 20000];
        if (nyq > 20000) probes.push(30000, 40000, 47000, nyq);
        for (const f of probes) {
          const hr = vmCtx.totalDbAt(f, fsRate) + vmCtx.autoPreDb;
          assert.ok(hr <= -1.0 + 1e-3, `BUG-03 regression at fs=${fsRate} f=${f}: ${hr.toFixed(4)} dBFS`);
          assert.ok(hr <= -0.2 + 1e-6, `BUG-03 anti-clipping violated at fs=${fsRate} f=${f}: ${hr.toFixed(4)} dBFS`);
        }
      }
    } finally {
      for (let i = 0; i < vmCtx.bands.length; i++) Object.assign(vmCtx.bands[i], savedBands[i]);
      vmCtx.BAND_CC.length = 0;
      vmCtx.GRID_TOT = {};
    }

    // Verify hwPreamp on solved sample bands satisfies <= -0.2 dBFS
    const prep = core.aePrepare(core.AE_SAMPLES[0].knots);
    const solved = core.aeComputeOnce(prep, "harmanOE", { tilt: 0, bass: 0, ear: 0 }, 10, false, 48000);
    const hwPre = vmCtx.hwPreamp(solved.res.bands);
    const maxTotal = Math.max(0, ...solved.res.total);
    assert.ok(maxTotal + hwPre <= -0.2 + 1e-6, `hwPreamp violated anti-clipping: ${(maxTotal + hwPre).toFixed(4)}`);
  });

  it("4. Parsers, 1 kHz normalization, unsorted/duplicate freqs, L/R split & 711 vs 5128 rig checks", () => {
    // Unsorted + duplicate frequencies + comments
    const rawRew = [
      "* REW Test Header",
      "* Measurement: Test Unit B&K 5128",
      "2000 84.0",
      "1000 82.0",
      "1000 80.0",
      "20 75.0",
      "50 78.0",
      "100 80.0",
      "400 80.5",
      "4000 85.0",
      "8000 83.0",
      "16000 76.0"
    ].join("\n");

    const aeParsed = vmCtx.aeParseMeasurement(rawRew);
    assert.equal(aeParsed.points.length, 9, "Duplicate 1000 Hz must be merged");
    for (let i = 1; i < aeParsed.points.length; i++) {
      assert.ok(aeParsed.points[i][0] > aeParsed.points[i - 1][0], "Frequencies must be strictly ascending");
    }
    const p1k = aeParsed.points.find((p) => p[0] === 1000);
    assert.equal(p1k[1], 81.0, "Duplicate frequencies must average SPL");

    // 1 kHz normalization in aePrepare
    const prep = core.aePrepare(aeParsed.points);
    const normAt1k = core.aeInterp(prep.ptsN, 1000);
    assert.ok(Math.abs(normAt1k) < 1e-12, `Expected ptsN 0 dB @ 1 kHz, got ${normAt1k}`);
    const rawAt1k = core.aeInterp(prep.rawG.map((v, i) => [core.AE.freqs[i], v]), 1000);
    assert.ok(Math.abs(rawAt1k) < 0.05, `Expected resampled rawG near 0 dB @ 1 kHz, got ${rawAt1k}`);

    // European comma decimals & rigGuess in dbParseMeasurement
    const commaCsv = [
      "# Measurement: Studio 5128 Check",
      "20;75,5",
      "50;78,0",
      "100;80,2",
      "250;80,5",
      "500;80,1",
      "1000;80,0",
      "2500;85,4",
      "6000;82,1",
      "12000;78,0"
    ].join("\n");
    const dbParsed = vmCtx.dbParseMeasurement(commaCsv, "test-5128.csv");
    assert.equal(dbParsed.rigGuess, "5128");
    assert.equal(dbParsed.points[0][1], 75.5);

    // BUG-02 regression: aeParseMeasurement handles European comma decimals and rejects NaN/Infinity lines
    const aeCommaParsed = vmCtx.aeParseMeasurement(commaCsv);
    assert.equal(aeCommaParsed.points[0][1], 75.5);
    const aeCommaSemicolon = [
      "frequency,raw",
      "B&K 5128",
      "20,0; -3,5",
      "50,0; -1,2",
      "100,0; 0,0",
      "250,0; 0,5",
      "500,0; -0,4",
      "1000,0; -2,5",
      "2500,0; 3,1",
      "6000,0; 1,2",
      "12000,0; -1,0"
    ].join("\n");
    const aeSemiParsed = vmCtx.aeParseMeasurement(aeCommaSemicolon);
    const semi1k = aeSemiParsed.points.find((p) => p[0] === 1000);
    assert.deepEqual([...semi1k], [1000, -2.5]);

    const nanMeas = "20 80\n50 80\n100 80\n200 80\n400 80\nNaN 80\n1000 80\n2000 80\n4000 80\n8000 80";
    const infMeas = "20 80\n50 80\n100 80\n200 80\n400 80\nInfinity 80\n1000 80\n2000 80\n4000 80\n8000 80";
    const valNanMeas = "20 80\n50 80\n100 80\n200 80\n400 80\n1000 NaN\n2000 80\n4000 80\n8000 80";
    for (const badTxt of [nanMeas, infMeas, valNanMeas]) {
      assert.throws(() => vmCtx.aeParseMeasurement(badTxt), /không đọc được/);
      assert.throws(() => vmCtx.dbParseMeasurement(badTxt, "bad.txt"), /không đọc được/);
    }

    // Malformed / short measurement throws explicit Error
    assert.throws(() => vmCtx.aeParseMeasurement("20 80\n1000 80\n"), /tối thiểu 8/);
    assert.throws(() => vmCtx.dbParseMeasurement("20 80\n50 abc\n100 80\n200 80\n400 80\n1000 80\n2000 80\n4000 80\n8000 80", "bad.txt"), /không đọc được/);

    // L/R & M/S independent channel stores
    const lrRes = vmCtx.lrSelfCheck();
    assert.equal(lrRes.pass, lrRes.total);
    const msRes = vmCtx.msSelfCheck();
    assert.equal(msRes.pass, msRes.total);

    // 711 vs 5128 rig check & selfCheck3
    const sc3 = vmCtx.UP.selfCheck3();
    assert.equal(sc3.pass, sc3.total, `UP.selfCheck3 failures: ${sc3.msgs.join("; ")}`);
    assert.equal(vmCtx.UP.pure3.rigCheck("711", "jm1", vmCtx.AE_TARGETS).status, "mismatch");
    assert.equal(vmCtx.UP.pure3.rigCheck("5128", "jm1", vmCtx.AE_TARGETS).status, "ok");
  });

  it("5. All 12 AE_TARGETS + Tilt/Bass/Ear-Gain + aeCompute convergence & null protection", () => {
    const targetIds = Object.keys(core.AE_TARGETS);
    assert.equal(targetIds.length, 12);

    for (const tid of targetIds) {
      const fnBase = vmCtx.aeTargetCurve(tid, 0, 0, 0);
      assert.ok(Math.abs(fnBase(1000)) < 1e-9, `Target ${tid} must normalize to 0 dB @ 1 kHz`);

      const fnAdj = vmCtx.aeTargetCurve(tid, -0.5, 4, 2);
      assert.ok(Math.abs(fnAdj(1000)) < 1e-9, `Adjusted target ${tid} must remain 0 dB @ 1 kHz`);
      assert.ok(fnAdj(40) > fnBase(40), `Positive bass+neg tilt must raise 40 Hz for ${tid}`);
      assert.ok(fnAdj(3000) > fnBase(3000) - 1.5, `Ear-gain adjustment sanity for ${tid}`);
    }

    // Converge on AE_SAMPLES (including sampleC 8 kHz narrow null guard)
    for (const sample of core.AE_SAMPLES) {
      const prep = core.aePrepare(sample.knots);
      for (const tid of ["harmanOE", "jm1"]) {
        const res = core.aeCompute(prep, tid, { tilt: 0, bass: 0, ear: 0 }, 10, false, false, 48000);
        assert.ok(res.errAfter < res.errBefore, `${sample.id} x ${tid} did not improve`);
        assert.equal(res.viol, 0, `${sample.id} x ${tid} had limit violations`);
        assert.equal(res.nullBoost, false, `${sample.id} x ${tid} boosted protected null`);
      }
    }
  });
});
