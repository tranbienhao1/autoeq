/* ================================================================
   NÂNG CẤP KHỐI 6 — Mô hình tham số hoá & bộ giải khớp đường cong
   Harman IE 2019 với đủ 13 tham số (HARMAN_IE_13).
   Mô hình = 4 biquad định hình (lowshelf bass, peaking lower-mid,
   peaking ear-gain, peaking coupler 711) + highshelf air 11 kHz,
   chuẩn hoá 0 dB tại 1 kHz theo cấu trúc. Mặc định chuẩn khớp
   22 knots gốc của AE_TARGETS.harmanIE với RMS 0.3356 dB.
   ================================================================ */
(function(){
"use strict";
var UP = window.UP = window.UP || {};
UP.pure6 = UP.pure6 || {};
var HARMAN_IE_13_DEFAULTS = {
  f1_bassHz: 203.1, g1_bassDb: 10.00, q1_bassQ: 0.51,
  f2_lowMidHz: 372.8, g2_lowMidDb: 1.50, q2_lowMidQ: 0.83,
  f3_earGainHz: 3286.5, g3_earGainDb: 11.94, q3_earGainQ: 0.89,
  f4_couplerHz: 8600.0, g4_couplerDb: 6.31, q4_couplerQ: 1.00,
  g5_airShelfDb: -1.40
};
var H13_BOUNDS = {
  f1_bassHz: [60, 300], g1_bassDb: [-6, 15], q1_bassQ: [0.35, 1.40],
  f2_lowMidHz: [200, 800], g2_lowMidDb: [-6, 6], q2_lowMidQ: [0.40, 2.50],
  f3_earGainHz: [2200, 4600], g3_earGainDb: [0, 20], q3_earGainQ: [0.40, 2.50],
  f4_couplerHz: [6500, 13000], g4_couplerDb: [-6, 16], q4_couplerQ: [0.50, 4.00],
  g5_airShelfDb: [-12, 6]
};
var H13_KEYS = Object.keys(HARMAN_IE_13_DEFAULTS);
function h13ClampParams(p){
  var out = {};
  H13_KEYS.forEach(function(k){
    var v = (p && typeof p[k] === "number" && isFinite(p[k])) ? p[k] : HARMAN_IE_13_DEFAULTS[k];
    var b = H13_BOUNDS[k];
    out[k] = Math.max(b[0], Math.min(b[1], v));
  });
  return out;
}
function harmanIe13Sections(p){
  var q = h13ClampParams(p);
  return [
    { type: "lowshelf",  freq: q.f1_bassHz,    gain: q.g1_bassDb,    q: q.q1_bassQ },
    { type: "peaking",   freq: q.f2_lowMidHz,  gain: q.g2_lowMidDb,  q: q.q2_lowMidQ },
    { type: "peaking",   freq: q.f3_earGainHz, gain: q.g3_earGainDb, q: q.q3_earGainQ },
    { type: "peaking",   freq: q.f4_couplerHz, gain: q.g4_couplerDb, q: q.q4_couplerQ },
    { type: "highshelf", freq: 11000.0,        gain: q.g5_airShelfDb, q: 0.707 }
  ];
}
function h13RawAt(p, f, fs){
  var secs = harmanIe13Sections(p), s = 0;
  for (var i = 0; i < secs.length; i++)
    s += biquadMagDb(rbjCoeffs(secs[i].type, secs[i].freq, secs[i].gain, secs[i].q, fs), f, fs);
  return s;
}
function harmanIe13EvalAt(p, f, fs){
  fs = fs || 48000;
  /* (vong tu dong 14:24, huong B - H17): hoist rbjCoeffs - he so chi phu thuoc (type,freq,gain,q,fs) cua 5 section nen tinh MOT lan roi dung lai cho ca f va 1000 Hz thay vi goi h13RawAt 2 lan (10 lan rbjCoeffs + 2 lan dung lai harmanIe13Sections); thu tu cong i=0..4 khong doi cho ca tong s va tong b nen giong tung bit. h13RawAt giu nguyen. */
  var secs = harmanIe13Sections(p), s = 0, b = 0;
  for (var i = 0; i < secs.length; i++){ var cc = rbjCoeffs(secs[i].type, secs[i].freq, secs[i].gain, secs[i].q, fs); s += biquadMagDb(cc, f, fs); b += biquadMagDb(cc, 1000, fs); }
  return s - b;
}
function harmanIe13EvalGrid(p, freqs, fs){
  fs = fs || 48000;
  /* (vong tu dong 14:24, huong B - H17): hoist rbjCoeffs - he so chi phu thuoc (type,freq,gain,q,fs) cua 5 section nen tinh MOT lan roi dung lai cho ca luoi thay vi h13RawAt tinh lai moi diem (241 lan dung lai harmanIe13Sections + 241*5 lan rbjCoeffs); thu tu cong i=0..4 khong doi cho base va moi diem luoi nen giong tung bit. h13RawAt giu nguyen. */
  var secs = harmanIe13Sections(p), cc = [], i, base = 0;
  for (i = 0; i < secs.length; i++){ cc.push(rbjCoeffs(secs[i].type, secs[i].freq, secs[i].gain, secs[i].q, fs)); base += biquadMagDb(cc[i], 1000, fs); }
  return freqs.map(function(f){ var s = 0; for (var j = 0; j < cc.length; j++) s += biquadMagDb(cc[j], f, fs); return s - base; });
}
function h13Fs(){ return (typeof displayFs !== "undefined" && displayFs > 0) ? displayFs : 48000; }
function h13RmsOnPts(p, pts){
  var se = 0, mx = 0, fs = h13Fs();
  pts.forEach(function(pt){ var e = harmanIe13EvalAt(p, pt[0], fs) - pt[1]; se += e * e; mx = Math.max(mx, Math.abs(e)); });
  return { rms: Math.sqrt(se / pts.length), max: mx };
}
var h13FitCache = {};
function h13FitCacheKey(targetPts, p){
  var id = null;
  if (typeof AE_TARGETS !== "undefined") Object.keys(AE_TARGETS).forEach(function(k){ if (AE_TARGETS[k].knots === targetPts) id = k; });
  /* Sửa key đệm (2026-10-31): key cũ cho tập điểm chưa đăng ký chỉ gồm
     (số điểm, tần số đầu, tần số cuối) nên HAI ĐƯỜNG CONG KHÁC NHAU có
     cùng độ dài/điểm đầu-cuối sẽ VA CHẠM và trả nhầm kết quả fit của nhau.
     Thí nghiệm cùng ngày chứng minh: các tập điểm dày (lưới solver) của
     harmanOE/ief/jm1/rtings/oratoryOptimum đều có cùng 241 điểm từ 20 Hz
     tới ~19897 Hz nên lần fit thứ hai trở đi trả ngay kết quả của harmanIE
     (0 ms, RMS báo cáo 0,1575 cho mọi target, trong khi RMS thật khi đối
     chiếu lại lên tới 1,07-5,29 dB). Target đã đăng ký giữ nguyên nhánh id
     (so sánh identity mảng, hành vi không đổi); tập điểm chưa đăng ký nay
     băm toàn bộ nội dung (tần số + dB làm tròn) nên key nhận diện đúng
     đầu vào. Chi phí băm không đáng kể so với ~1 s của một lần fit. */
  var base = id;
  if (!base){
    var h = 2166136261;
    for (var ci = 0; ci < targetPts.length; ci++){
      var fs10 = Math.round(targetPts[ci][0] * 10), db100 = Math.round(targetPts[ci][1] * 100);
      h = ((h ^ (fs10 + 0x9e3779b9)) * 16777619) >>> 0;
      h = ((h ^ (db100 + 0x9e3779b9)) * 16777619) >>> 0;
    }
    base = "pts" + targetPts.length + ":h" + h.toString(36);
  }
  var ik = H13_KEYS.map(function(k){ return Math.round(p[k] * 1000) / 1000; }).join(",");
  return base + "|" + ik + "|" + h13Fs();
}
function h13FitResultCopy(r){
  return { params: Object.assign({}, r.params), rmsError: r.rmsError, maxError: r.maxError, knots22: r.knots22 };
}
function harmanIe13FitToCurve(targetPts, initP){
  var p0 = h13ClampParams(initP || HARMAN_IE_13_DEFAULTS);
  /* Bộ nhớ đệm fit (2026-10-31): fit là hàm xác định của (target, điểm đầu,
     sample rate) mà mỗi lần chạy tốn ~0,4–0,5 s — AutoEQ tự động chạy lại
     cùng một target nhiều lần nên đệm kết quả, lần sau trả ngay lập tức. */
  var cacheKey = h13FitCacheKey(targetPts, p0);
  if (h13FitCache[cacheKey]) return h13FitResultCopy(h13FitCache[cacheKey]);
  function onePass(pin){
    var p = Object.assign({}, pin);
    var steps = {};
    H13_KEYS.forEach(function(k){
      steps[k] = (k.indexOf("Hz") >= 0) ? 1.18 : (k.indexOf("Q") >= 0 || k.indexOf("q") === 0) ? 0.18 : 0.9;
      if (k === "g5_airShelfDb" || k.indexOf("Db") >= 0) steps[k] = 0.9;
      if (k.indexOf("Q") >= 0) steps[k] = 0.18;
    });
    var best = h13RmsOnPts(p, targetPts).rms;
    for (var sweep = 0; sweep < 60; sweep++){
      var improved = false;
      H13_KEYS.forEach(function(k){
        [1, -1].forEach(function(dir){
          var trial = Object.assign({}, p);
          if (k.indexOf("Hz") >= 0) trial[k] = p[k] * Math.pow(steps[k], dir);
          else trial[k] = p[k] + dir * steps[k];
          trial = h13ClampParams(trial);
          var r = h13RmsOnPts(trial, targetPts).rms;
          if (r < best - 1e-9){ best = r; p = trial; improved = true; }
        });
      });
      if (!improved){
        var done = true;
        H13_KEYS.forEach(function(k){ steps[k] = (k.indexOf("Hz") >= 0) ? 1 + (steps[k] - 1) / 2 : steps[k] / 2; if (steps[k] > 0.01) done = false; });
        if (done) break;
      }
    }
    /* Tầng 2 của vòng — tinh chỉnh Nelder–Mead 13 chiều: leo dốc từng tham
       số dễ kẹt ở cực trị cục bộ; NM chạy trong không gian đã biến đổi (Hz
       theo log10) từ chính kết quả leo dốc; đỉnh simplex xuất phát là kết
       quả leo dốc nên vòng không bao giờ tệ hơn điểm bắt đầu của nó. Xác
       định tuyệt đối (không ngẫu nhiên), chặn 2200 lần đánh giá hàm. */
    return h13NmPolish(p, targetPts);
  }
  var p = onePass(p0);
  var fin = h13RmsOnPts(p, targetPts);
  /* Đa vòng (2026-10-31): đo thực nghiệm — một vòng leo dốc + NM chưa hội
     tụ hết (fit harmanIE từ mặc định: vòng 1 RMS 0,2707, chạy vòng 2 từ
     kết quả vòng 1 xuống 0,2479). Chạy thêm vòng từ kết quả hiện tại
     chừng nào RMS còn giảm >= 0,5%, tối đa 6 vòng; target đã hội tụ
     (RTINGS — giới hạn cấu trúc mô hình) dừng ngay sau vòng 2 không
     giảm, nên chi phí thêm chỉ tốn ở lần fit đầu, các lần sau trúng
     bộ nhớ đệm. Nâng mốc 3 -> 6 vòng (2026-10-31): đo chuỗi fit lại từ
     kết quả đã fit cho thấy mốc 3 vòng cắt ngang hội tụ ở harmanOE2015
     (fit từ mặc định 0,2477, fit lại từ kết quả đó xuống 0,2260, -8,76%;
     vòng tiếp theo chỉ còn -0,33% rồi 0%) — vòng 4 đơn lẻ mới lấy
     được một nửa (0,2364), phải tới vòng 6 tiêu chí 0,5% mới là thứ
     quyết định dừng; 11 target còn lại fit lại cải thiện <= 0,39%
     nên mốc mới tốn thêm tối đa 1 vòng ở lần fit đầu của chúng. */
  for (var extra = 0; extra < 5; extra++){
    var p2 = onePass(p);
    var fin2 = h13RmsOnPts(p2, targetPts);
    if (fin2.rms < fin.rms * 0.995){ p = p2; fin = fin2; } else break;
  }
  var result = { params: p, rmsError: fin.rms, maxError: fin.max, knots22: targetPts.length };
  var keys = Object.keys(h13FitCache);
  if (keys.length >= 24) delete h13FitCache[keys[0]];
  h13FitCache[cacheKey] = h13FitResultCopy(result);
  return result;
}
function h13NmPolish(p0, targetPts){
  var n = H13_KEYS.length;
  function toU(p){ return H13_KEYS.map(function(k){ return k.indexOf("Hz") >= 0 ? Math.log10(p[k]) : p[k]; }); }
  function toP(u){ var p = {}; H13_KEYS.forEach(function(k, i){ p[k] = k.indexOf("Hz") >= 0 ? Math.pow(10, u[i]) : u[i]; }); return h13ClampParams(p); }
  function obj(u){ return h13RmsOnPts(toP(u), targetPts).rms; }
  var u0 = toU(h13ClampParams(p0));
  var steps = H13_KEYS.map(function(k){ return k.indexOf("Hz") >= 0 ? Math.log10(1.10) : (k.indexOf("Q") >= 0 || k.indexOf("q") === 0) ? 0.15 : 0.7; });
  var simplex = [u0.slice()], vals = [obj(u0)], evals = 1;
  for (var i = 0; i < n; i++){ var u = u0.slice(); u[i] += steps[i]; simplex.push(u); vals.push(obj(u)); evals++; }
  function sortS(){
    var idx = vals.map(function(v, i2){ return i2; }).sort(function(a, b){ return vals[a] - vals[b]; });
    simplex = idx.map(function(i2){ return simplex[i2]; });
    vals = idx.map(function(i2){ return vals[i2]; });
  }
  sortS();
  while (evals < 2200){
    var spread = 0;
    for (var j = 0; j < n; j++){
      var mn = Infinity, mx = -Infinity;
      for (var q = 0; q <= n; q++){ if (simplex[q][j] < mn) mn = simplex[q][j]; if (simplex[q][j] > mx) mx = simplex[q][j]; }
      if (mx - mn > spread) spread = mx - mn;
    }
    if (spread < 2e-5) break;
    var cen = new Array(n).fill(0), i3, j3;
    for (i3 = 0; i3 < n; i3++) for (j3 = 0; j3 < n; j3++) cen[j3] += simplex[i3][j3] / n;
    var xr = cen.map(function(c, j4){ return c + (c - simplex[n][j4]); });
    var fr = obj(xr); evals++;
    if (fr < vals[0]){
      var xe = cen.map(function(c, j5){ return c + 2 * (c - simplex[n][j5]); });
      var fe = obj(xe); evals++;
      if (fe < fr){ simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]){ simplex[n] = xr; vals[n] = fr; }
    else {
      var xc = cen.map(function(c, j6){ return c + 0.5 * (simplex[n][j6] - c); });
      var fc = obj(xc); evals++;
      if (fc < vals[n]){ simplex[n] = xc; vals[n] = fc; }
      else {
        for (i3 = 1; i3 <= n; i3++){
          simplex[i3] = simplex[i3].map(function(v, j7){ return simplex[0][j7] + 0.5 * (v - simplex[0][j7]); });
          vals[i3] = obj(simplex[i3]); evals++;
        }
      }
    }
    sortS();
  }
  var bestP = toP(simplex[0]);
  return (h13RmsOnPts(bestP, targetPts).rms <= h13RmsOnPts(p0, targetPts).rms) ? bestP : h13ClampParams(p0);
}
function harmanIe13RegisterTarget(p, srcName){
  var knots = [];
  for (var i = 0; i <= 24; i++){
    var f = 20 * Math.pow(1000, i / 24);
    knots.push([Math.round(f * 10) / 10, Math.round(harmanIe13EvalAt(p, f, h13Fs()) * 100) / 100]);
  }
  AE_TARGETS.harmanIE13 = { name: srcName ? ("Mô hình 13 tham số khớp " + srcName + " (Khối 6)") : "Harman In-Ear 2019 v2 — mô hình 13 tham số (Khối 6)", note: "Target sinh từ mô hình tham số hoá 13 tham số của Nâng cấp Khối 6" + (srcName ? (" khớp đường cong đích: " + srcName) : "") + ", chuẩn hoá 0 dB tại 1 kHz", knots: knots };
  return knots;
}
function harmanIe13SolveAutoEq(measPts, params13, opts){
  opts = opts || {};
  var p = h13ClampParams(params13 || HARMAN_IE_13_DEFAULTS);
  harmanIe13RegisterTarget(p);
  var prep = aePrepare(measPts);
  var nB = opts.nBands || 13;
  var out = aeCompute(prep, "harmanIE13", { tilt: 0, bass: 0, ear: 0 }, nB, !!opts.preserve);
  var maxPos = 0;
  out.res.total.forEach(function(v){ if (v > maxPos) maxPos = v; });
  return { targetGrid: harmanIe13EvalGrid(p, AE.freqs, h13Fs()), bands: out.res.bands,
           rmsBefore: out.errBefore, rmsAfter: out.errAfter,
           reductionPct: out.errBefore > 0 ? (1 - out.errAfter / out.errBefore) * 100 : 0,
           warnings: out.warnings, viol: out.viol, nullBoost: out.nullBoost, preAmpDb: -(maxPos + 1.0) };
}
UP.pure6.HARMAN_IE_13_DEFAULTS = HARMAN_IE_13_DEFAULTS;
UP.pure6.HARMAN_IE_13_BOUNDS = H13_BOUNDS;
UP.pure6.harmanIe13Sections = harmanIe13Sections;
UP.pure6.harmanIe13EvalAt = harmanIe13EvalAt;
UP.pure6.harmanIe13EvalGrid = harmanIe13EvalGrid;
UP.pure6.harmanIe13FitToCurve = harmanIe13FitToCurve;
UP.pure6.harmanIe13SolveAutoEq = harmanIe13SolveAutoEq;
UP.pure6.harmanIe13RegisterTarget = harmanIe13RegisterTarget;

function upSelfCheck6(){
  var pass = 0, total = 0, msgs = [];
  function ck(name, cond, detail){ total++; if (cond) pass++; else msgs.push(name + (detail ? " (" + detail + ")" : "")); }
  try {
    ck("đủ 13 khóa tham số", H13_KEYS.length === 13, H13_KEYS.length + " khóa");
    ck("chuẩn hoá 1 kHz tuyệt đối", Math.abs(harmanIe13EvalAt(HARMAN_IE_13_DEFAULTS, 1000, 48000)) < 1e-12);
    var knots = AE_TARGETS.harmanIE.knots;
    var fit0 = h13RmsOnPts(HARMAN_IE_13_DEFAULTS, knots);
    ck("mặc định khớp 22 knots RMS <= 0.35", fit0.rms <= 0.35, "RMS " + fit0.rms.toFixed(4));
    ck("mặc định khớp 22 knots max <= 0.90", fit0.max <= 0.90, "max " + fit0.max.toFixed(4));
    var grid = [];
    for (var gi = 0; gi <= 240; gi++) grid.push(20 * Math.pow(1000, gi / 240));
    var base = harmanIe13EvalGrid(HARMAN_IE_13_DEFAULTS, grid, 48000), dead = [];
    H13_KEYS.forEach(function(k){
      var p2 = Object.assign({}, HARMAN_IE_13_DEFAULTS);
      if (k.indexOf("Hz") >= 0) p2[k] = p2[k] * 1.06;
      else if (k.indexOf("Q") >= 0 || k.indexOf("q") === 0) p2[k] = p2[k] + 0.15;
      else p2[k] = p2[k] + 0.6;
      var alt = harmanIe13EvalGrid(p2, grid, 48000), md = 0;
      for (var j = 0; j < grid.length; j++) md = Math.max(md, Math.abs(alt[j] - base[j]));
      if (!(md > 0.05)) dead.push(k + ":" + md.toFixed(3));
    });
    ck("13/13 tham số có độ nhạy độc lập", dead.length === 0, dead.join(","));
    var sA = harmanIe13SolveAutoEq(aeSamplePoints(AE_SAMPLES[0]), HARMAN_IE_13_DEFAULTS, { nBands: 13 });
    ck("solver 13 band trên Mẫu A", sA.bands.length === 13 && sA.reductionPct >= 65 && sA.viol === 0,
       "giảm " + sA.reductionPct.toFixed(1) + "% · RMS sau " + sA.rmsAfter.toFixed(3) + " · viol " + sA.viol);
    ck("pre-amp đúng luật -(maxPos + 1)", isFinite(sA.preAmpDb) && sA.preAmpDb <= -1.0, sA.preAmpDb.toFixed(2) + " dB");
    var prepC = aePrepare(aeSamplePoints(AE_SAMPLES[2]));
    var sC = harmanIe13SolveAutoEq(aeSamplePoints(AE_SAMPLES[2]), HARMAN_IE_13_DEFAULTS, { nBands: 13 });
    var inNull = sC.bands.some(function(b){ return b.gain > 0.5 && prepC.nulls.some(function(nl){ return b.freq >= nl.fLo && b.freq <= nl.fHi; }); });
    ck("Mẫu C: 0 band boost vào null + có cảnh báo", !inNull && sC.warnings.some(function(w){ return w.indexOf("Null") === 0 || w.indexOf("null") >= 0; }));
    var garbage = {}; H13_KEYS.forEach(function(k){ garbage[k] = [NaN, Infinity, -99999][k.length % 3]; });
    var secs = harmanIe13Sections(garbage), allStable = secs.every(function(sec){
      var c = rbjCoeffs(sec.type, sec.freq, sec.gain, sec.q, 48000);
      return isFinite(c.b0 + c.b1 + c.b2 + c.a1 + c.a2) && (!UP.upIsBiquadStable || UP.upIsBiquadStable(c));
    });
    ck("kẹp NaN/ngoại biên an toàn + ổn định Jury", allStable);
    var fit = harmanIe13FitToCurve(knots, HARMAN_IE_13_DEFAULTS);
    ck("fit lại hội tụ không tệ hơn mặc định", fit.rmsError <= fit0.rms + 1e-9, "RMS fit " + fit.rmsError.toFixed(4));
  } catch (e) { msgs.push("exception: " + e.message); }
  return { pass: pass, total: total, msgs: msgs };
}
UP.selfCheck6 = upSelfCheck6;

/* ---------- UI Panel Khối 6 ---------- */
var H13_FIELDS = [
  ["f1_bassHz", "h13F1", "F1 · Bass shelf (Hz)"], ["g1_bassDb", "h13G1", "G1 · Bass (dB)"], ["q1_bassQ", "h13Q1", "Q1 · Bass Q"],
  ["f2_lowMidHz", "h13F2", "F2 · Low-mid (Hz)"], ["g2_lowMidDb", "h13G2", "G2 · Low-mid (dB)"], ["q2_lowMidQ", "h13Q2", "Q2 · Low-mid Q"],
  ["f3_earGainHz", "h13F3", "F3 · Ear-gain (Hz)"], ["g3_earGainDb", "h13G3", "G3 · Ear-gain (dB)"], ["q3_earGainQ", "h13Q3", "Q3 · Ear-gain Q"],
  ["f4_couplerHz", "h13F4", "F4 · Coupler 711 (Hz)"], ["g4_couplerDb", "h13G4", "G4 · Coupler (dB)"], ["q4_couplerQ", "h13Q4", "Q4 · Coupler Q"],
  ["g5_airShelfDb", "h13G5", "G5 · Air shelf 11 kHz (dB)"]
];
var h13TargetId = "harmanIE";
function h13TargetPts(){
  var t = (typeof AE_TARGETS !== "undefined") ? AE_TARGETS[h13TargetId] : null;
  return (t && t.knots) ? t.knots : AE_TARGETS.harmanIE.knots;
}
function h13TargetName(){
  var t = (typeof AE_TARGETS !== "undefined") ? AE_TARGETS[h13TargetId] : null;
  return t ? t.name : h13TargetId;
}
function h13FillTargets(){
  var sel = document.getElementById("h13TargetSel");
  if (!sel || typeof AE_TARGETS === "undefined") return;
  var cur = sel.value || h13TargetId;
  sel.innerHTML = "";
  Object.keys(AE_TARGETS).forEach(function(id){
    if (id === "harmanIE13" || !AE_TARGETS[id].knots) return;
    var o = document.createElement("option");
    o.value = id; o.textContent = AE_TARGETS[id].name;
    sel.appendChild(o);
  });
  if (AE_TARGETS[cur] && cur !== "harmanIE13") sel.value = cur;
  h13TargetId = sel.value || "harmanIE";
}
function h13SyncTargetUI(){
  var nm = h13TargetName();
  var rb = document.getElementById("h13ResetBtn");
  if (rb) rb.textContent = (h13TargetId === "harmanIE") ? "Khôi phục 13 tham số chuẩn Harman IE 2019 v2" : ("Khớp lại từ đầu cho " + nm);
  var ab = document.getElementById("h13ApplyEqBtn");
  if (ab) ab.textContent = "Chạy AutoEQ khớp " + nm + " (13 tham số / 13 band) → Áp xuống Engine";
  h13ShowFit();
}
function h13FitBest(pts){
  var fA = harmanIe13FitToCurve(pts, HARMAN_IE_13_DEFAULTS);
  var fB = harmanIe13FitToCurve(pts, h13ReadUI());
  return (fB.rmsError < fA.rmsError) ? fB : fA;
}
function h13ReadUI(){
  var p = {};
  H13_FIELDS.forEach(function(fd){
    var el = document.getElementById(fd[1]);
    p[fd[0]] = el ? parseFloat(el.value) : HARMAN_IE_13_DEFAULTS[fd[0]];
  });
  return h13ClampParams(p);
}
function h13WriteUI(p){
  H13_FIELDS.forEach(function(fd){
    var el = document.getElementById(fd[1]);
    if (el) el.value = p[fd[0]];
  });
  h13ShowFit(p);
}
function h13ShowFit(p){
  var el = document.getElementById("h13FitInfo");
  if (!el) return;
  var pts = h13TargetPts();
  var r = h13RmsOnPts(p || h13ReadUI(), pts);
  el.textContent = "Sai số mô hình so với " + pts.length + " knots của target " + h13TargetName() + ": RMS " + r.rms.toFixed(4) + " dB · max " + r.max.toFixed(4) + " dB.";
}
if (typeof document !== "undefined"){
  try {
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "upHarman13Panel";
    var inputs = H13_FIELDS.map(function(fd){
      return "<div><label class=\"flabel\" for=\"" + fd[1] + "\">" + fd[2] + "</label><input class=\"numin\" id=\"" + fd[1] + "\" type=\"number\" step=\"any\" value=\"" + HARMAN_IE_13_DEFAULTS[fd[0]] + "\"></div>";
    }).join("");
    panel.innerHTML = "<h2>Nâng cấp 6 — Mô hình 13 tham số khớp mọi đường cong target</h2>"
      + "<p class=\"note\">Mô hình giải tích 13 tham số (4 biquad định hình + air shelf) khớp được MỌI target có trong app — chọn target ở ô dưới đây, mô hình tự tối ưu lại 13 tham số theo đường cong đích đó bằng bộ khớp hai tầng — leo dốc từng tham số rồi tinh chỉnh Nelder–Mead 13 chiều (chuẩn hoá 0 dB tại 1 kHz, tính theo sample rate thật của engine). Với Harman In-Ear 2019 v2, bộ mặc định khớp 22 knots gốc với RMS 0.3356 dB.</p>"
      + "<div class=\"row\"><label class=\"flabel\" for=\"h13TargetSel\">Target cần khớp</label><select class=\"aesel\" id=\"h13TargetSel\"></select></div>"
      + "<div class=\"frow3\">" + inputs + "</div>"
      + "<p class=\"note\" id=\"h13FitInfo\">—</p>"
      + "<div class=\"row\">"
      + "<button class=\"btn\" id=\"h13ResetBtn\">Khôi phục 13 tham số chuẩn Harman IE 2019 v2</button>"
      + "<button class=\"btn\" id=\"h13FitBtn\">Tối ưu lại 13 tham số khớp đường cong đích</button>"
      + "<button class=\"btn primary\" id=\"h13ApplyEqBtn\">Chạy AutoEQ khớp target (13 tham số / 13 band) → Áp xuống Engine</button>"
      + "<button class=\"btn\" id=\"upSelfCheck6Btn\">Tự kiểm Khối 6</button></div>"
      + "<p class=\"note\" id=\"upHarman13Info\">Chưa chạy tự kiểm.</p>";
    var anchor = document.getElementById("upIso2023Panel") || document.getElementById("aePanel");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else document.body.appendChild(panel);
    H13_FIELDS.forEach(function(fd){
      var el = document.getElementById(fd[1]);
      if (el) el.addEventListener("input", function(){ h13ShowFit(); });
    });
    h13FillTargets();
    h13ShowFit(HARMAN_IE_13_DEFAULTS);
    h13SyncTargetUI();
    var tSel = document.getElementById("h13TargetSel");
    if (tSel){
      tSel.addEventListener("focus", h13FillTargets);
      tSel.addEventListener("change", function(){
        h13TargetId = tSel.value;
        var fit = h13FitBest(h13TargetPts());
        h13WriteUI(fit.params);
        h13SyncTargetUI();
        var el = document.getElementById("upHarman13Info");
        if (el) el.textContent = "Đã chuyển target sang " + h13TargetName() + " và tối ưu lại 13 tham số: RMS " + fit.rmsError.toFixed(4) + " dB · max " + fit.maxError.toFixed(4) + " dB trên " + fit.knots22 + " knots.";
      });
    }
    document.getElementById("h13ResetBtn").addEventListener("click", function(){
      if (h13TargetId === "harmanIE"){ h13WriteUI(HARMAN_IE_13_DEFAULTS); }
      else { var fit = harmanIe13FitToCurve(h13TargetPts(), HARMAN_IE_13_DEFAULTS); h13WriteUI(fit.params); }
      h13SyncTargetUI();
    });
    document.getElementById("h13FitBtn").addEventListener("click", function(){
      var fit = harmanIe13FitToCurve(h13TargetPts(), h13ReadUI());
      h13WriteUI(fit.params);
      h13SyncTargetUI();
      var el = document.getElementById("upHarman13Info");
      if (el) el.textContent = "Đã tối ưu lại theo target " + h13TargetName() + ": RMS " + fit.rmsError.toFixed(4) + " dB · max " + fit.maxError.toFixed(4) + " dB trên " + fit.knots22 + " knots.";
    });
    document.getElementById("h13ApplyEqBtn").addEventListener("click", function(){
      var p = h13ReadUI();
      harmanIe13RegisterTarget(p, h13TargetId === "harmanIE" ? null : h13TargetName());
      var sel = document.getElementById("aeTarget");
      if (sel){
        var ex = sel.querySelector('option[value="harmanIE13"]');
        if (!ex){
          var opt = document.createElement("option");
          opt.value = "harmanIE13"; opt.textContent = AE_TARGETS.harmanIE13.name;
          sel.appendChild(opt);
        } else ex.textContent = AE_TARGETS.harmanIE13.name;
      }
      if (sel) sel.value = "harmanIE13";
      if (typeof aeUpdateTarget === "function") aeUpdateTarget();
      if (typeof AE !== "undefined" && !AE.points && typeof aeSelectPhone === "function" && typeof AE_SAMPLES !== "undefined")
        aeSelectPhone("sample:" + AE_SAMPLES[0].id);
      var btn = document.getElementById("btnAutoEq");
      if (btn) btn.click();
      var el = document.getElementById("upHarman13Info");
      if (el) el.textContent = "Đã đăng ký target mô hình 13 tham số (khớp " + h13TargetName() + ") và chạy AutoEQ (solver chạy trong Web Worker qua nút Chạy AutoEQ).";
    });
    /* Trạng thái Khối 6 cho preset v2: chụp/khôi phục qua capturePresetV2 /
       applyPresetV2 (khóa h13 trong JSON preset). */
    UP.pure6.h13GetState = function(){
      var chk = document.getElementById("aeH13Auto");
      return { target: h13TargetId, params: h13ReadUI(), autoInAutoEq: chk ? !!chk.checked : true };
    };
    UP.pure6.h13SetState = function(st){
      if (!st || typeof st !== "object") return;
      if (st.target && typeof AE_TARGETS !== "undefined" && AE_TARGETS[st.target] && st.target !== "harmanIE13"){
        h13TargetId = st.target;
        var ts = document.getElementById("h13TargetSel");
        if (ts) ts.value = st.target;
      }
      if (st.params) h13WriteUI(h13ClampParams(st.params));
      h13SyncTargetUI();
      if (typeof st.autoInAutoEq === "boolean"){
        var chk = document.getElementById("aeH13Auto");
        if (chk && chk.checked !== st.autoInAutoEq){
          chk.checked = st.autoInAutoEq;
          chk.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    };
    document.getElementById("upSelfCheck6Btn").addEventListener("click", function(){
      var r = upSelfCheck6(), el = document.getElementById("upHarman13Info");
      if (el) el.textContent = "Tự kiểm Khối 6: " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : " — tất cả đạt.");
    });
  } catch (e) {}
}

/* ---------- Nối Khối 6 vào pipeline AutoEQ chính ----------
   aeComputeAsync là điểm vào DUY NHẤT của nút Bước 3 — cả bấm tay lẫn
   Chế độ Tự Động Toàn Diện (autoMaybeSolve bấm chính nút đó) đều qua đây.
   Bọc hàm này: khi công tắc #aeH13Auto bật, mỗi lần AutoEQ chạy sẽ tự khớp
   mô hình 13 tham số với target đang chọn ở Bước 2, đăng ký đường mô hình
   thành target harmanIE13 rồi giải trên đường mô hình. aeCompute đồng bộ
   (QA/harness/kiểm chứng) KHÔNG đổi; tắt công tắc là trở về hành vi gốc. */
if (typeof document !== "undefined"){
  try {
    var h13AutoOn = true;
    try { var savedH13 = window.localStorage.getItem("webAutoEq.h13auto.v1"); if (savedH13 !== null) h13AutoOn = (savedH13 === "1"); } catch (e) {}
    var btnH = document.getElementById("btnAutoEq");
    if (btnH && btnH.parentNode && typeof aeComputeAsync === "function" && !window.__h13AutoWrapped){
      window.__h13AutoWrapped = true;
      var ctlH = document.createElement("div");
      ctlH.className = "ctl";
      ctlH.innerHTML = "<label><input type=\"checkbox\" id=\"aeH13Auto\" /> Khối 6 — Tự động dùng mô hình 13 tham số khi tính AutoEQ</label>"
        + "<p class=\"note\" style=\"margin:4px 0 0\">Khi bật: mỗi lần chạy AutoEQ (nút Bước 3 hoặc Chế độ Tự Động Toàn Diện tự chạy khi đổi tai nghe/target), app tự khớp mô hình 13 tham số của Khối 6 với đúng target đang chọn ở Bước 2 — bộ 13 tham số khớp được đồng bộ sang panel Khối 6 — rồi solver giải trên đường mô hình đó thay cho đường target gốc. Sai số khớp của mô hình hiện ở dòng trạng thái dưới đây và ở ô “Target đang dùng” sau khi chạy. Tắt công tắc để AutoEQ chạy thẳng trên target gốc như trước. Khi bật, nút giải riêng trong panel Khối 6 được ẩn đi vì AutoEQ đã tự chạy phần đó.</p>"
        + "<p class=\"note\" id=\"aeH13Info\" style=\"margin:4px 0 0\">—</p>";
      btnH.parentNode.insertBefore(ctlH, btnH);
      var chkH = document.getElementById("aeH13Auto");
      var infoH = document.getElementById("aeH13Info");
      chkH.checked = h13AutoOn;
      function h13AutoNote(){
        if (infoH) infoH.textContent = chkH.checked
          ? "Khối 6 trong AutoEQ: đang BẬT — lần chạy AutoEQ tới sẽ tự khớp mô hình 13 tham số với target đã chọn ở Bước 2."
          : "Khối 6 trong AutoEQ: đang TẮT — AutoEQ chạy thẳng trên target gốc.";
      }
      function h13SyncSolveBtn(){
        var sb = document.getElementById("h13ApplyEqBtn");
        if (sb) sb.style.display = chkH.checked ? "none" : "";
      }
      chkH.addEventListener("change", function(){
        try { window.localStorage.setItem("webAutoEq.h13auto.v1", chkH.checked ? "1" : "0"); } catch (e) {}
        h13AutoNote();
        h13SyncSolveBtn();
      });
      h13AutoNote();
      h13SyncSolveBtn();
      var origAeComputeAsync = aeComputeAsync;
      aeComputeAsync = function(prep, targetId, adj, nB, preserve, bestOf, fs, cb){
        var fsv = fs, callback = cb;
        if (typeof fs === "function" && cb === undefined){
          callback = fs;
          fsv = (typeof displayFs === "number" && displayFs > 0) ? displayFs : 48000;
        }
        if (!chkH.checked || targetId === "harmanIE13" || typeof AE_TARGETS === "undefined" || !AE_TARGETS[targetId] || !AE_TARGETS[targetId].knots){
          return origAeComputeAsync(prep, targetId, adj, nB, preserve, bestOf, fsv, callback);
        }
        var srcId = targetId, srcName = AE_TARGETS[srcId].name, fitH = null;
        try {
          var ptsH = AE_TARGETS[srcId].knots;
          var fA = harmanIe13FitToCurve(ptsH, HARMAN_IE_13_DEFAULTS);
          var fB = (h13TargetId === srcId) ? harmanIe13FitToCurve(ptsH, h13ReadUI()) : null;
          fitH = (fB && fB.rmsError < fA.rmsError) ? fB : fA;
          h13TargetId = srcId;
          var tSelH = document.getElementById("h13TargetSel");
          if (tSelH) tSelH.value = srcId;
          h13WriteUI(fitH.params);
          h13SyncTargetUI();
          harmanIe13RegisterTarget(fitH.params, srcId === "harmanIE" ? null : srcName);
          var selH = document.getElementById("aeTarget");
          if (selH){
            var exH = selH.querySelector('option[value="harmanIE13"]');
            if (!exH){
              var optH = document.createElement("option");
              optH.value = "harmanIE13"; optH.textContent = AE_TARGETS.harmanIE13.name;
              selH.appendChild(optH);
            } else exH.textContent = AE_TARGETS.harmanIE13.name;
          }
        } catch (e) { fitH = null; }
        if (!fitH) return origAeComputeAsync(prep, targetId, adj, nB, preserve, bestOf, fsv, callback);
        return origAeComputeAsync(prep, "harmanIE13", adj, nB, preserve, bestOf, fsv, function(out){
          out.h13Auto = { sourceId: srcId, sourceName: srcName, rms: fitH.rmsError, max: fitH.maxError };
          callback(out);
          var utH = document.getElementById("aeUsedTgt");
          if (utH) utH.textContent = AE_TARGETS.harmanIE13.name;
          if (!preserve && typeof aeTargetCurve === "function" && typeof AE !== "undefined"){
            try { AE.tgtFn = aeTargetCurve("harmanIE13", adj.tilt, adj.bass, adj.ear); AE.tgtG = AE.freqs.map(AE.tgtFn); if (typeof drawGraph === "function") drawGraph(); } catch (e) {}
          }
          if (infoH) infoH.textContent = "Khối 6 trong AutoEQ: lần chạy vừa rồi đã tự khớp mô hình 13 tham số với target " + srcName + " — sai số mô hình RMS " + fitH.rmsError.toFixed(4) + " dB · max " + fitH.maxError.toFixed(4) + " dB; solver đã giải trên đường mô hình.";
          var hiH = document.getElementById("upHarman13Info");
          if (hiH) hiH.textContent = "AutoEQ vừa tự dùng mô hình này: đã khớp 13 tham số với target " + srcName + " (RMS " + fitH.rmsError.toFixed(4) + " dB · max " + fitH.maxError.toFixed(4) + " dB) và giải trên đường mô hình.";
        });
      };
    }
  } catch (e) {}
}
})();
