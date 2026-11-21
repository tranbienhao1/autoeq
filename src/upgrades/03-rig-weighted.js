/* ================================================================
   NÂNG CẤP KHỐI 3 — Kho 5128/711 chuẩn hoá + solver có trọng số
   - Chuẩn hoá rig: mọi chuỗi rig thô (tên file, nguồn, ghi chú) đều qua
     upNormalizeRig về một trong 3 mã: "711" | "5128" | "other". Không
     đoán rig từ tên nguồn cộng đồng (ví dụ Squig.link) — không nhận
     diện được thì ghi "other" kèm chuỗi gốc, không gán nhầm.
   - Target gắn rig theo ghi chú của chính thư viện AE_TARGETS: Harman
     OE/IE, IEF, Harman 2013 -> 711; JM-1, SoundGuys (đo trên 5128) -> 5128;
     Diffuse/Free Field ISO và RTINGS -> other (không gắn một rig cụ thể).
     Target cá nhân kế thừa rig của target nền (trường base).
   - KHÔNG TRỘN RIG: khi rig đường đo và rig target khác nhau, báo cáo
     solver gắn cảnh báo trộn rig và panel đề xuất target cùng rig. Việc
     tính vẫn chạy (không chặn cứng) để không phá các luồng tự động và
     kiểm chứng có sẵn của app — nhưng kết quả bị gắn cờ, không im lặng.
   - Solver có trọng số: tuỳ chọn nhân trọng số tri giác hiện có với hệ
     số ERB = ERBWidthOct(1000)/ERBWidthOct(f), kẹp [0,5; 1,5] (vùng có
     nhiều bộ lọc thính giác trên mỗi octave được trọng số cao hơn, có chặn).
     Gain/Q cap của khối này CHỈ SIẾT THÊM, không bao giờ nới lỏng quá
     giới hạn an toàn gốc (gain ±12 dB, treble ±8 dB, Q 0,5–10) nhờ bọc
     aeClampBand sau khi hàm gốc đã kẹp.
   - Báo cáo solver: RMS và lỗi lớn nhất TRƯỚC/SAU (20 Hz–10 kHz, như aeRms),
     thêm RMS có trọng số ERB khi bật, danh sách band boost sâu (>= 6 dB)
     rơi vào vùng guard lõm sâu của đường thô, và danh sách band bị kẹp
     thêm bởi cap của khối này.
   ================================================================ */
(function(){
"use strict";
var UP = window.UP = window.UP || {};
function up3Clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function upErbHz3(f){ return 24.7 * (4.37 * f / 1000 + 1); }
function upErbWidthOct3(f){
  var e = upErbHz3(f), lo = Math.max(10, f - e / 2), hi = f + e / 2;
  return Math.log2(hi / lo);
}
function upNormalizeRig(raw){
  var s = String(raw || "").toLowerCase();
  if (/(5128|type\s*4\.3|itu-t\s*p\.57|p\.57)/.test(s)) return { code: "5128", label: "B&K 5128", confidence: "high", raw: String(raw || "") };
  if (/(711|60318-4|ra0045|43ag(?![\s\-]*5128))/.test(s)) return { code: "711", label: "IEC 60318-4 (711)", confidence: "high", raw: String(raw || "") };
  if (s === "711" || s === "5128") return { code: s, label: s === "711" ? "IEC 60318-4 (711)" : "B&K 5128", confidence: "high", raw: String(raw || "") };
  return { code: "other", label: "Rig khác / chưa rõ", confidence: "low", raw: String(raw || "") };
}
function upExtractDate(text){
  var s = String(text || "");
  var m = s.match(/(20\d{2}|19\d{2})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  var d = s.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2})/);
  if (d){
    var dd = ("0" + d[1]).slice(-2), mm = ("0" + d[2]).slice(-2);
    if (parseInt(mm, 10) >= 1 && parseInt(mm, 10) <= 12 && parseInt(dd, 10) >= 1 && parseInt(dd, 10) <= 31) return d[3] + "-" + mm + "-" + dd;
  }
  return null;
}
function upNormalizeMeasurement(m){
  m = m || {};
  var rig = upNormalizeRig(m.rig || m.rigRaw || m.rigLabel || "");
  var date = upExtractDate(m.date || m.filename || m.source || "");
  return { headphone: m.headphone || m.name || "", rig: rig.code, rigLabel: rig.label,
    rigRaw: rig.raw, source: m.source || "", date: date, points: m.points || [] };
}
function upTargetRig(id, targets){
  var map = { harmanOE: "711", harmanIE: "711", ief: "711", harmanOE2013: "711", harmanOE2015: "711", oratoryOptimum: "711",
    jm1: "5128", soundguys: "5128", diffuseField: "other", diffuseFieldKemar: "other", freeField: "other", rtings: "other" };
  if (id === "personal" && targets && targets.personal && targets.personal.base && map[targets.personal.base]) return map[targets.personal.base];
  if (id === "personal" && targets && targets.personal && targets.personal.rig && map[targets.personal.rig]) return targets.personal.rig;
  return map[id] || "other";
}
function upRigCheck(measRig, targetId, targets){
  var meas = upNormalizeRig(measRig).code;
  var tgt = upTargetRig(targetId, targets);
  var label = function(c){ return c === "711" ? "IEC 60318-4 (711)" : c === "5128" ? "B&K 5128" : "Rig khác / chưa rõ"; };
  if (meas === "other" || tgt === "other")
    return { status: "unknown", meas: meas, tgt: tgt,
      message: "Rig chưa xác định ở một phía (đo: " + label(meas) + ", target: " + label(tgt) + ") — không khẳng định được cùng rig, hãy ghi rõ rig trước khi so sánh tuyệt đối." };
  if (meas === tgt)
    return { status: "ok", meas: meas, tgt: tgt, message: "Cùng rig: " + label(meas) + " — đường đo và target so sánh được trực tiếp." };
  var sug = meas === "711" ? "harmanOE" : "jm1";
  return { status: "mismatch", meas: meas, tgt: tgt, suggestedTarget: sug,
    message: "CẢNH BÁO TRỘN RIG: đường đo rig " + label(meas) + " nhưng target rig " + label(tgt) + " — không so sánh tuyệt đối; target cùng rig gợi ý: " + sug + "." };
}
function upSolverReport(args){
  args = args || {};
  var freqs = args.freqs || [], sm = args.sm || [], tgt = args.tgt || [], total = args.total || [];
  var weights = args.weights || null;
  function rms(err, w){
    var s = 0, ws = 0, c = 0;
    for (var i = 0; i < freqs.length; i++){
      if (freqs[i] > 10000) continue;
      var wi = w ? w[i] : 1;
      s += wi * err[i] * err[i]; ws += wi; c++;
    }
    return c ? Math.sqrt(s / (w ? ws : c)) : 0;
  }
  function maxAbs(err){
    var mx = 0, mf = 0;
    for (var i = 0; i < freqs.length; i++){
      if (freqs[i] > 10000) continue;
      if (Math.abs(err[i]) > mx){ mx = Math.abs(err[i]); mf = freqs[i]; }
    }
    return { v: mx, f: mf };
  }
  var errB = [], errA = [];
  for (var i = 0; i < freqs.length; i++){ errB.push(tgt[i] - sm[i]); errA.push(tgt[i] - (sm[i] + total[i])); }
  var deep = [];
  (args.bands || []).forEach(function(b){
    if (!b || !(b.gain >= 6)) return;
    var inGuard = false;
    (args.guard || []).forEach(function(g){ if (b.freq >= g.fLo && b.freq <= g.fHi) inGuard = true; });
    if (inGuard) deep.push({ freq: b.freq, gain: b.gain, reason: "boost >= 6 dB trong vùng guard lõm sâu của đường thô" });
  });
  return { rmsBefore: rms(errB, null), rmsAfter: rms(errA, null),
    wrmsBefore: weights ? rms(errB, weights) : null, wrmsAfter: weights ? rms(errA, weights) : null,
    maxBefore: maxAbs(errB), maxAfter: maxAbs(errA), deepBoost: deep, clamped: args.clamped || [] };
}
UP.pure3 = { normalizeRig: upNormalizeRig, extractDate: upExtractDate,
  normalizeMeasurement: upNormalizeMeasurement, targetRig: upTargetRig,
  rigCheck: upRigCheck, erbWidthOct: upErbWidthOct3, solverReport: upSolverReport };
UP.solverOpts = UP.solverOpts || { erbWeight: false, gainCap: 12, qCap: 10 };
UP.meta = UP.meta || null;
function upErbFactor(f){ return up3Clamp(upErbWidthOct3(1000) / upErbWidthOct3(f), 0.5, 1.5); }
UP.erbFactor = upErbFactor;
/* Bọc aeWeight / aeClampBand / aeCompute — chỉ siết thêm, không đổi chữ ký. */
try{
  if (typeof aeWeight === "function" && !aeWeight._upWrapped){
    var origWeight = aeWeight;
    var wrappedWeight = function(f){
      var w = origWeight(f);
      if (UP.solverOpts && UP.solverOpts.erbWeight) w = w * upErbFactor(f);
      return w;
    };
    wrappedWeight._upWrapped = true; aeWeight = wrappedWeight;
  }
  if (typeof aeClampBand === "function" && !aeClampBand._upWrapped){
    var origClamp = aeClampBand;
    var wrappedClamp = function(b){
      var hit = origClamp(b);
      var o = UP.solverOpts || {};
      if (isFinite(o.gainCap) && o.gainCap < 12){
        if (b.gain > o.gainCap){ b.gain = o.gainCap; hit.push("GainCap"); }
        if (b.gain < -o.gainCap){ b.gain = -o.gainCap; hit.push("GainCap"); }
      }
      if (isFinite(o.qCap) && o.qCap < 10 && b.q > o.qCap){ b.q = o.qCap; hit.push("QCap"); }
      return hit;
    };
    wrappedClamp._upWrapped = true; aeClampBand = wrappedClamp;
  }
  if (typeof aeCompute === "function" && !aeCompute._upWrapped){
    var origCompute = aeCompute;
    var wrappedCompute = function(prep, targetId, adj, nB, preserve, bestOf){
      var out = origCompute(prep, targetId, adj, nB, preserve, bestOf);
      try{
        var freqs = (typeof AE !== "undefined" && AE.freqs) ? AE.freqs : [];
        var weights = null;
        if (UP.solverOpts && UP.solverOpts.erbWeight){
          weights = freqs.map(function(f){
            var w = (typeof aeWeight === "function") ? aeWeight(f) : 1;
            return w;
          });
        }
        var guard = [];
        if (typeof AE !== "undefined" && AE.rawG && AE.freqs && UP.pure1) guard = UP.pure1.guardIntervals(AE.rawG, AE.freqs);
        var clamped = [];
        (out.res.bands || []).forEach(function(b){
          var o = UP.solverOpts || {};
          if (isFinite(o.gainCap) && Math.abs(b.gain) >= o.gainCap - 1e-9 && o.gainCap < 12) clamped.push({ freq: b.freq, gain: b.gain, note: "chạm cap gain " + o.gainCap + " dB của Khối 3" });
          if (isFinite(o.qCap) && b.q >= o.qCap - 1e-9 && o.qCap < 10) clamped.push({ freq: b.freq, q: b.q, note: "chạm cap Q " + o.qCap + " của Khối 3" });
        });
        var rep = upSolverReport({ freqs: freqs, sm: prep.sm, tgt: out.tgtG, total: out.res.total,
          weights: weights, bands: out.res.bands, guard: guard, clamped: clamped });
        var rig = null;
        if (typeof AE !== "undefined"){
          var tgts = (typeof AE_TARGETS !== "undefined") ? AE_TARGETS : null;
          rig = upRigCheck(AE.rig, targetId, tgts);
        }
        UP.lastSolverReport = { report: rep, rig: rig, targetId: targetId };
        out.upReport = rep; out.upRig = rig;
        var el = document.getElementById("upSolverInfo");
        if (el){
          var txt = "RMS trước " + rep.rmsBefore.toFixed(2) + " dB → sau " + rep.rmsAfter.toFixed(2) + " dB; lỗi lớn nhất trước " + rep.maxBefore.v.toFixed(2) + " dB @" + Math.round(rep.maxBefore.f) + " Hz → sau " + rep.maxAfter.v.toFixed(2) + " dB @" + Math.round(rep.maxAfter.f) + " Hz.";
          if (rep.wrmsBefore !== null) txt += " RMS trọng số ERB: trước " + rep.wrmsBefore.toFixed(2) + " dB → sau " + rep.wrmsAfter.toFixed(2) + " dB.";
          if (rep.deepBoost.length) txt += " PHẠT BOOST SÂU: " + rep.deepBoost.map(function(d){ return "+" + d.gain.toFixed(1) + " dB @" + Math.round(d.freq) + " Hz"; }).join("; ") + ".";
          if (rep.clamped.length) txt += " Band chạm cap Khối 3: " + rep.clamped.length + " band.";
          if (rig) txt += " Rig: " + rig.message;
          el.textContent = txt;
        }
      }catch(e){}
      return out;
    };
    wrappedCompute._upWrapped = true; aeCompute = wrappedCompute;
  }
}catch(e){}
function upSelfCheck3(){
  var pass = 0, total = 0, msgs = [];
  function ck(name, cond, detail){ total++; if (cond) pass++; else msgs.push(name + " FAIL: " + detail); }
  try{
    ck("rig 711 từ RA0045", upNormalizeRig("GRAS RA0045").code === "711", JSON.stringify(upNormalizeRig("GRAS RA0045")));
    ck("rig 5128", upNormalizeRig("B&K 5128").code === "5128", JSON.stringify(upNormalizeRig("B&K 5128")));
    ck("rig không đoán từ Squig", upNormalizeRig("squiglink crinacle").code === "other", JSON.stringify(upNormalizeRig("squiglink crinacle")));
    ck("ngày ISO", upExtractDate("đo ngày 2026-10-28") === "2026-10-28", String(upExtractDate("đo ngày 2026-10-28")));
    ck("ngày DD/MM/YYYY", upExtractDate("28/10/2026") === "2026-10-28", String(upExtractDate("28/10/2026")));
    ck("target rig harmanOE=711, jm1=5128", upTargetRig("harmanOE") === "711" && upTargetRig("jm1") === "5128", upTargetRig("harmanOE") + "/" + upTargetRig("jm1"));
    var rc = upRigCheck("5128", "harmanOE");
    ck("phát hiện trộn rig", rc.status === "mismatch" && rc.suggestedTarget === "jm1", JSON.stringify(rc));
    ck("cùng rig OK", upRigCheck("711", "harmanOE").status === "ok", JSON.stringify(upRigCheck("711", "harmanOE")));
    var rep = upSolverReport({ freqs: [100, 1000, 5000], sm: [0, 2, 0], tgt: [0, 0, 0], total: [0, -1, 0],
      weights: [1, 1, 1], bands: [{ freq: 3000, gain: 8, q: 1 }], guard: [{ fLo: 2500, fHi: 3500 }] });
    ck("báo cáo RMS trước/sau", Math.abs(rep.rmsBefore - Math.sqrt(4 / 3)) < 1e-9 && Math.abs(rep.rmsAfter - Math.sqrt(1 / 3)) < 1e-9, JSON.stringify(rep));
    ck("báo cáo lỗi lớn nhất", rep.maxBefore.v === 2 && rep.maxAfter.v === 1, JSON.stringify(rep.maxBefore) + "/" + JSON.stringify(rep.maxAfter));
    ck("phạt boost sâu", rep.deepBoost.length === 1, JSON.stringify(rep.deepBoost));
    var nm = upNormalizeMeasurement({ headphone: "HD 600", rig: "GRAS 711", source: "oratory1990 2026-10-28", points: [[1000, 80]] });
    ck("chuẩn hoá measurement", nm.rig === "711" && nm.date === "2026-10-28" && nm.headphone === "HD 600", JSON.stringify(nm));
  }catch(e){ msgs.push("exception: " + e.message); }
  return { pass: pass, total: total, msgs: msgs };
}
UP.selfCheck3 = upSelfCheck3;
if (typeof document !== "undefined"){
  try{
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = "<h2>Nâng cấp 3 — Kho đo 5128/711 chuẩn hoá + solver có trọng số</h2>"
      + "<p class=\"note\">Metadata rig được chuẩn hoá về 711 / 5128 / chưa rõ, kèm nguồn và ngày đo khi có. Solver: trọng số ERB (tuỳ chọn), cap gain/Q chỉ siết thêm, phạt boost sâu được báo cáo — không chặn cứng luồng tự động có sẵn, nhưng mọi lần chạy trộn rig đều bị gắn cờ trong báo cáo.</p>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px\"><button class=\"btn small\" id=\"upRigCheckBtn\">Kiểm tra rig đường đo vs target hiện tại</button>"
      + "<button class=\"btn small\" id=\"upRigSuggestBtn\">Chuyển sang target cùng rig gợi ý</button></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>Rig / metadata</span><b id=\"upRigInfo\">Chưa kiểm tra rig.</b></div>"
      + "<div style=\"margin-top:10px\"><label class=\"flabel\">Nguồn đo</label><input class=\"numin\" id=\"upMetaSource\" type=\"text\" placeholder=\"vd: oratory1990 / file import\" style=\"width:100%\" />"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:12px;margin-top:8px\">"
      + "<label>Ngày đo <input class=\"numin\" id=\"upMetaDate\" type=\"date\" /></label>"
      + "<label>Rig <select class=\"aesel\" id=\"upMetaRig\"><option value=\"auto\">Tự nhận diện từ nguồn</option><option value=\"711\">IEC 60318-4 (711)</option><option value=\"5128\">B&K 5128</option><option value=\"other\">Rig khác / chưa rõ</option></select></label></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upMetaSave\">Lưu metadata cho đường đo hiện tại</button></div></div>"
      + "<div style=\"margin-top:12px\"><label class=\"flabel\" for=\"upMeasFile\">Import đường đo kèm metadata chuẩn hoá (.txt/.csv)</label><input type=\"file\" id=\"upMeasFile\" accept=\".txt,.csv\" />"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upMeasImport\">Import + chuẩn hoá metadata</button></div></div>"
      + "<h3 style=\"margin:14px 0 6px\">Tuỳ chọn solver (áp cho lần chạy AutoEQ tiếp theo)</h3>"
      + "<div><label><input type=\"checkbox\" id=\"upErbWeightToggle\" /> Trọng số ERB (nhân trọng số tri giác với hệ số ERB, kẹp 0,5–1,5)</label></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:12px;margin-top:8px\">"
      + "<label>Cap gain (dB, ≤ 12) <input class=\"numin\" id=\"upGainCap\" type=\"number\" min=\"1\" max=\"12\" step=\"0.5\" value=\"12\" style=\"width:90px\" /></label>"
      + "<label>Cap Q (≤ 10) <input class=\"numin\" id=\"upQCap\" type=\"number\" min=\"0.5\" max=\"10\" step=\"0.5\" value=\"10\" style=\"width:90px\" /></label></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upSolverOptsApply\">Áp dụng tuỳ chọn solver</button>"
      + "<button class=\"btn small\" id=\"upSelfCheck3Btn\">Tự kiểm Khối 3 (case tổng hợp)</button></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>Báo cáo solver (lần chạy gần nhất)</span><b id=\"upSolverInfo\">Chưa chạy AutoEQ sau khi nâng cấp.</b></div>";
    var panels = document.querySelectorAll(".panel"), anchor3 = null;
    for (var pi = 0; pi < panels.length; pi++){
      var h = panels[pi].querySelector("h2");
      if (h && h.textContent.indexOf("Nâng cấp 2") === 0){ anchor3 = panels[pi]; break; }
    }
    if (anchor3 && anchor3.parentNode) anchor3.parentNode.insertBefore(panel, anchor3.nextSibling);
    else { var aeP = document.getElementById("aePanel"); if (aeP && aeP.parentNode) aeP.parentNode.insertBefore(panel, aeP.nextSibling); else document.body.appendChild(panel); }
    function upSetInfo3(id, txt){ var el = document.getElementById(id); if (el) el.textContent = txt; }
    function upCurrentRigText(){
      if (typeof AE === "undefined" || !AE.name) return "Chưa có đường đo — chọn tai nghe ở Bước 1 trước.";
      var tgtId = document.getElementById("aeTarget") ? document.getElementById("aeTarget").value : "harmanOE";
      var tgts = (typeof AE_TARGETS !== "undefined") ? AE_TARGETS : null;
      var rc = upRigCheck(AE.rig, tgtId, tgts);
      var meta = UP.meta ? (" Nguồn: " + (UP.meta.source || "—") + "; ngày đo: " + (UP.meta.date || "—") + ".") : "";
      return "Đo: " + AE.name + " · rig " + upNormalizeRig(AE.rig).label + " · target " + tgtId + " (rig " + (rc.tgt === "711" ? "IEC 60318-4 (711)" : rc.tgt === "5128" ? "B&K 5128" : "chưa rõ") + "). " + rc.message + meta;
    }
    document.getElementById("upRigCheckBtn").addEventListener("click", function(){
      upSetInfo3("upRigInfo", upCurrentRigText());
    });
    document.getElementById("upRigSuggestBtn").addEventListener("click", function(){
      try{
        if (typeof AE === "undefined" || !AE.rig) throw new Error("Chưa có đường đo.");
        var tgtId = document.getElementById("aeTarget") ? document.getElementById("aeTarget").value : "harmanOE";
        var rc = upRigCheck(AE.rig, tgtId, (typeof AE_TARGETS !== "undefined") ? AE_TARGETS : null);
        if (rc.status !== "mismatch"){ upSetInfo3("upRigInfo", "Không cần đổi: " + rc.message); return; }
        var sel = document.getElementById("aeTarget");
        if (sel){ sel.value = rc.suggestedTarget; if (typeof aeUpdateTarget === "function") aeUpdateTarget(); }
        upSetInfo3("upRigInfo", "Đã chuyển target sang " + rc.suggestedTarget + " (cùng rig với đường đo). " + upCurrentRigText());
      }catch(ex){ upSetInfo3("upRigInfo", "Lỗi: " + ex.message); }
    });
    document.getElementById("upMetaSave").addEventListener("click", function(){
      var rigSel = document.getElementById("upMetaRig").value;
      var src = document.getElementById("upMetaSource").value || "";
      var rig = rigSel === "auto" ? upNormalizeRig(src).code : rigSel;
      UP.meta = { source: src, date: document.getElementById("upMetaDate").value || upExtractDate(src), rig: rig };
      if (typeof AE !== "undefined") AE.meta = UP.meta;
      upSetInfo3("upRigInfo", "Đã lưu metadata: nguồn “" + (src || "—") + "”, rig " + upNormalizeRig(rig).label + ", ngày đo " + (UP.meta.date || "—") + ". Metadata này đi kèm đường đo hiện tại (không ghi đè lên kho gốc).");
    });
    document.getElementById("upMeasImport").addEventListener("click", function(){
      var f = document.getElementById("upMeasFile").files && document.getElementById("upMeasFile").files[0];
      if (!f){ upSetInfo3("upRigInfo", "Chưa chọn file đo."); return; }
      var rd = new FileReader();
      rd.onload = function(){
        try{
          var parsed = (typeof aeParseMeasurement === "function") ? aeParseMeasurement(String(rd.result || "")) : null;
          if (!parsed) throw new Error("Không có parser đo (aeParseMeasurement).");
          var rigSel = document.getElementById("upMetaRig").value;
          var src = document.getElementById("upMetaSource").value || ("File import: " + f.name);
          var nm = upNormalizeMeasurement({ headphone: f.name.replace(/\.(csv|txt)$/i, ""), rig: rigSel === "auto" ? src : rigSel, source: src, date: document.getElementById("upMetaDate").value || "", filename: f.name, points: parsed.points });
          UP.meta = { source: nm.source, date: nm.date, rig: nm.rig };
          if (typeof aeSetMeasurement === "function") aeSetMeasurement(nm.points, nm.headphone + " (rig " + nm.rigLabel + (nm.date ? ", " + nm.date : "") + ")", nm.rig, nm.source);
          upSetInfo3("upRigInfo", "Đã import " + nm.points.length + " điểm: rig " + nm.rigLabel + ", nguồn “" + nm.source + "”, ngày đo " + (nm.date || "— (không có trong file/nguồn)") + ".");
        }catch(ex){ upSetInfo3("upRigInfo", "Lỗi import: " + ex.message); }
      };
      rd.onerror = function(){ upSetInfo3("upRigInfo", "Không đọc được file đã chọn."); };
      rd.readAsText(f);
    });
    document.getElementById("upSolverOptsApply").addEventListener("click", function(){
      var g = parseFloat(document.getElementById("upGainCap").value);
      var q = parseFloat(document.getElementById("upQCap").value);
      UP.solverOpts = {
        erbWeight: !!document.getElementById("upErbWeightToggle").checked,
        gainCap: isFinite(g) ? up3Clamp(g, 1, 12) : 12,
        qCap: isFinite(q) ? up3Clamp(q, 0.5, 10) : 10
      };
      upSetInfo3("upSolverInfo", "Đã áp tuỳ chọn solver: trọng số ERB " + (UP.solverOpts.erbWeight ? "BẬT" : "tắt") + ", cap gain " + UP.solverOpts.gainCap + " dB, cap Q " + UP.solverOpts.qCap + " (chỉ siết thêm so với giới hạn an toàn gốc). Chạy lại AutoEQ để xem báo cáo mới.");
    });
    document.getElementById("upSelfCheck3Btn").addEventListener("click", function(){
      var r = upSelfCheck3();
      upSetInfo3("upSolverInfo", "Tự kiểm Khối 3: " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : " — tất cả case tổng hợp đều đạt."));
    });
  }catch(e){}
  }
})();

