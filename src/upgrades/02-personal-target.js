/* ================================================================
   NÂNG CẤP KHỐI 2 — Target cá nhân từ hearing test + Blind A/B/X
   Phương pháp ƯỚC LƯỢNG CÓ TRỌNG SỐ, MINH BẠCH (ghi rõ trong giao diện):
   - Mỗi ứng viên Blind có một hồ sơ (bass, treble, ear-gain) suy từ các band
     của chính ứng viên đó (xấp xỉ bằng đáp tuyến tổng của các band tại
     vùng bass 50–150 Hz, ear 2,5–3,5 kHz, treble 8–12 kHz khi có aeTotalCurve,
     nếu không thì trung bình gain các band trong vùng).
   - Trung bình có trọng số: w = điểm Preference Rating (1–5). Trung bình
     không trọng số là mốc trung lập. Độ lệch ưa thích = trung bình có
     trọng số − trung bình không trọng số. Nếu mọi ứng viên được chấm bằng
     nhau thì độ lệch = 0 — đúng ý nghĩa "không có bằng chứng thiên vị".
   - ABX (panel Blind A/B/X) đo KHẢ NĂNG PHÂN BIỆT, không đo sở thích, nên
     KHÔNG được trộn vào trọng số. Điểm ABX chỉ dùng làm ghi chú độ tin cậy:
     n >= 5 lượt và độ chính xác < 50% (mức đoán mò) thì target chỉ là gợi ý.
   - Audiogram KHÔNG dùng để chữa thính lực: chỉ tính cân bằng kênh L/R
     bằng 1/2 chênh lệch ngưỡng trung bình, chia đều hai kênh, giới hạn
     ±6 dB mỗi kênh; chênh lệch trung bình >= 10 dB hoặc >= 15 dB tại một
     tần số thì hiển thị khuyến nghị đi kiểm tra thính lực chuyên nghiệp.
     App không có nút trim riêng từng kênh nên các offset chỉ được lưu và
     hiển thị để đặt trên DAC/thiết bị; không giả vờ áp trim trong engine.
   - Target cá nhân = target gốc đang chọn + bass shelf (dạng đúng của
     aeTargetCurve) + chuông ear-gain 3 kHz + treble shelf trên 6 kHz,
     rồi chuẩn hoá lại 0 dB @ 1 kHz. Đăng ký thành AE_TARGETS.personal và
     thêm option vào #aeTarget nên dùng được như mọi target có sẵn.
   ================================================================ */
(function(){
"use strict";
var UP = window.UP = window.UP || {};
function up2Interp(pts, f){
  if (!pts || !pts.length) return 0;
  if (f <= pts[0][0]) return pts[0][1];
  if (f >= pts[pts.length-1][0]) return pts[pts.length-1][1];
  var lo = 0, hi = pts.length - 1;
  while (hi - lo > 1){ var m = (lo + hi) >> 1; if (pts[m][0] <= f) lo = m; else hi = m; }
  var t = (Math.log(f) - Math.log(pts[lo][0])) / (Math.log(pts[hi][0]) - Math.log(pts[lo][0]));
  return pts[lo][1] + t * (pts[hi][1] - pts[lo][1]);
}
function up2Clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
var UP_AUDIO_FREQS = [250, 500, 1000, 2000, 4000, 8000];
function upAudiogramBalance(L, R){
  function mean(a){ var s = 0, n = 0; a.forEach(function(v){ if (isFinite(v)){ s += v; n++; } }); return n ? s / n : NaN; }
  var mL = mean(L), mR = mean(R);
  if (!isFinite(mL) || !isFinite(mR)) throw new Error("Cần nhập ngưỡng nghe (dB HL) cho cả hai tai.");
  var diff = mL - mR, maxDiff = 0;
  for (var i = 0; i < UP_AUDIO_FREQS.length; i++){
    if (isFinite(L[i]) && isFinite(R[i])) maxDiff = Math.max(maxDiff, Math.abs(L[i] - R[i]));
  }
  var offL = up2Clamp(0.25 * diff, -6, 6), offR = up2Clamp(-0.25 * diff, -6, 6);
  var flags = [];
  if (Math.abs(diff) >= 10) flags.push("Chênh lệch ngưỡng trung bình hai tai " + Math.abs(diff).toFixed(1) + " dB (>= 10 dB) — nên kiểm tra thính lực chuyên nghiệp, không tự kết luận.");
  if (maxDiff >= 15) flags.push("Chênh lệch lớn nhất tại một tần số là " + maxDiff.toFixed(1) + " dB (>= 15 dB) — nên kiểm tra thính lực chuyên nghiệp.");
  return { meanL: mL, meanR: mR, diff: diff, maxDiff: maxDiff, offL: offL, offR: offR, flags: flags };
}
function upBandProfileGain(bands){
  function avgRegion(test){
    var s = 0, n = 0;
    (bands || []).forEach(function(b){
      if (!b || b.on === false || !isFinite(b.gain)) return;
      if (test(b)){ s += b.gain; n++; }
    });
    return n ? { v: s / n, n: n } : { v: 0, n: 0 };
  }
  var bass = avgRegion(function(b){ return b.freq <= 250 || b.type === "lowshelf"; });
  var ear = avgRegion(function(b){ return b.freq >= 2000 && b.freq <= 4000; });
  var treble = avgRegion(function(b){ return b.freq >= 6000 || b.type === "highshelf"; });
  return { bass: bass.v, treble: treble.v, ear: ear.v, counts: { bass: bass.n, ear: ear.n, treble: treble.n } };
}
function upCandidateProfile(bands){
  try{
    if (typeof aeTotalCurve === "function" && bands && bands.length){
      var grid = [50, 75, 100, 150, 2500, 3000, 3500, 8000, 10000, 12000];
      var curve = aeTotalCurve(bands.filter(function(b){ return b && b.on !== false; }), grid);
      var mean = function(idx){ var s = 0; idx.forEach(function(i){ s += curve[i]; }); return s / idx.length; };
      return { bass: mean([0, 1, 2, 3]), treble: mean([7, 8, 9]), ear: mean([4, 5, 6]),
        counts: { bass: 4, ear: 3, treble: 3 }, method: "curve" };
    }
  }catch(e){}
  var g = upBandProfileGain(bands);
  g.method = "band-gain";
  return g;
}
function upPersonalFromRatings(items){
  var list = (items || []).filter(function(it){
    return it && it.profile && isFinite(it.rating) && it.rating >= 1 && it.rating <= 5;
  });
  if (list.length < 2) throw new Error("Cần ít nhất 2 ứng viên đã chấm điểm (1–5) mới suy ra được target cá nhân.");
  function wmean(key){
    var s = 0, w = 0; list.forEach(function(it){ s += it.rating * it.profile[key]; w += it.rating; }); return s / w;
  }
  function umean(key){
    var s = 0; list.forEach(function(it){ s += it.profile[key]; }); return s / list.length;
  }
  var weighted = { bass: wmean("bass"), treble: wmean("treble"), ear: wmean("ear") };
  var unweighted = { bass: umean("bass"), treble: umean("treble"), ear: umean("ear") };
  var deltas = {
    bass: up2Clamp(weighted.bass - unweighted.bass, -3, 3),
    treble: up2Clamp(weighted.treble - unweighted.treble, -3, 3),
    ear: up2Clamp(weighted.ear - unweighted.ear, -2, 2)
  };
  return { deltas: deltas, weighted: weighted, unweighted: unweighted, n: list.length,
    items: list.map(function(it){ return { name: it.name || "", rating: it.rating, profile: it.profile }; }) };
}
function upPersonalKnots(baseKnots, deltas){
  function adj(f){
    var bass = deltas.bass * 0.5 * (1 - Math.tanh(Math.log2(f / 180) / 0.9));
    var ear = deltas.ear * Math.exp(-0.5 * Math.pow(Math.log2(f / 3000) / 0.55, 2));
    var treble = deltas.treble * 0.5 * (1 + Math.tanh(Math.log2(f / 6000) / 0.9));
    return bass + ear + treble;
  }
  var raw = baseKnots.map(function(k){ return [k[0], k[1] + adj(k[0])]; });
  var at1k = up2Interp(raw, 1000);
  return raw.map(function(k){ return [k[0], k[1] - at1k]; });
}
function upParseAbxScore(text){
  var m = String(text || "").match(/(\d+)\s*lượt thử[^0-9]*(\d+)/);
  if (!m) return null;
  var n = parseInt(m[1], 10), ok = parseInt(m[2], 10);
  return { n: n, ok: ok, pct: n ? Math.round(ok / n * 100) : 0 };
}
UP.pure2 = { audioFreqs: UP_AUDIO_FREQS, audiogramBalance: upAudiogramBalance,
  bandProfileGain: upBandProfileGain, candidateProfile: upCandidateProfile,
  personalFromRatings: upPersonalFromRatings, personalKnots: upPersonalKnots,
  parseAbxScore: upParseAbxScore };
function upSelfCheck2(){
  var pass = 0, total = 0, msgs = [];
  function ck(name, cond, detail){ total++; if (cond) pass++; else msgs.push(name + " FAIL: " + detail); }
  try{
    var bal = upAudiogramBalance([20, 20, 20, 20, 20, 20], [10, 10, 10, 10, 10, 10]);
    ck("cân bằng L/R", Math.abs(bal.offL - 2.5) < 1e-9 && Math.abs(bal.offR + 2.5) < 1e-9 && Math.abs(bal.diff - 10) < 1e-9, JSON.stringify(bal));
    ck("cờ chênh lệch lớn", bal.flags.length > 0, bal.flags.join(" | "));
    var pers = upPersonalFromRatings([
      { name: "A", rating: 5, profile: { bass: 2, treble: 1, ear: 0 } },
      { name: "B", rating: 1, profile: { bass: -2, treble: -1, ear: 0 } }
    ]);
    ck("target cá nhân có trọng số", Math.abs(pers.deltas.bass - 1.3333333) < 1e-6 && Math.abs(pers.deltas.treble - 0.6666667) < 1e-6, JSON.stringify(pers.deltas));
    var persEq = upPersonalFromRatings([
      { name: "A", rating: 3, profile: { bass: 2, treble: 1, ear: 0 } },
      { name: "B", rating: 3, profile: { bass: -2, treble: -1, ear: 0 } }
    ]);
    ck("chấm bằng nhau thì lệch = 0", Math.abs(persEq.deltas.bass) < 1e-9 && Math.abs(persEq.deltas.treble) < 1e-9, JSON.stringify(persEq.deltas));
    var knots = upPersonalKnots([[20, 5], [100, 4], [1000, 0], [3000, 8], [10000, 4]], { bass: 2, treble: 1, ear: 1 });
    var at1k = up2Interp(knots, 1000);
    ck("target cá nhân chuẩn hoá @1kHz", Math.abs(at1k) < 1e-9, "at1k=" + at1k);
    ck("bass tăng, treble tăng", knots[0][1] > 5 && knots[4][1] > 4, JSON.stringify(knots));
    var abx = upParseAbxScore("Điểm X: 12 lượt thử · đúng 9 · 75%");
    ck("đọc điểm ABX", abx && abx.n === 12 && abx.ok === 9 && abx.pct === 75, JSON.stringify(abx));
    var prof = upBandProfileGain([{ freq: 100, type: "peaking", gain: 3, q: 1, on: true }, { freq: 3000, type: "peaking", gain: -1, q: 1, on: true }, { freq: 8000, type: "peaking", gain: 2, q: 1, on: true }]);
    ck("hồ sơ band", prof.bass === 3 && prof.ear === -1 && prof.treble === 2, JSON.stringify(prof));
  }catch(e){ msgs.push("exception: " + e.message); }
  return { pass: pass, total: total, msgs: msgs };
}
UP.selfCheck2 = upSelfCheck2;
if (typeof document !== "undefined"){
  try{
    var panel = document.createElement("div");
    panel.className = "panel";
    var rows = "";
    UP_AUDIO_FREQS.forEach(function(f){
      rows += "<tr><td>" + f + " Hz</td>"
        + "<td><input class=\"numin\" id=\"upAudL" + f + "\" type=\"number\" step=\"5\" placeholder=\"dB HL\" style=\"width:110px\" /></td>"
        + "<td><input class=\"numin\" id=\"upAudR" + f + "\" type=\"number\" step=\"5\" placeholder=\"dB HL\" style=\"width:110px\" /></td></tr>";
    });
    panel.innerHTML = "<h2>Nâng cấp 2 — Target cá nhân từ hearing test + Blind A/B/X</h2>"
      + "<p class=\"note\">Audiogram chỉ để tính cân bằng kênh (không chẩn đoán, không chữa thính lực). Target cá nhân suy từ điểm Preference Rating của Blind bằng trung bình có trọng số trừ trung bình không trọng số — xem phương pháp trong ghi chú dưới nút suy ra. Điểm ABX chỉ là ghi chú độ tin cậy, không trộn vào trọng số.</p>"
      + "<h3 style=\"margin:10px 0 6px\">Hearing test / audiogram (dB HL, từng tai)</h3>"
      + "<table><tr><th>Tần số</th><th>Tai trái (L)</th><th>Tai phải (R)</th></tr>" + rows + "</table>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upAudCalc\">Tính cân bằng L/R</button>"
      + "<button class=\"btn small\" id=\"upAudSave\">Lưu audiogram (máy này)</button></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>Audiogram / cân bằng</span><b id=\"upAudInfo\">Chưa nhập audiogram.</b></div>"
      + "<h3 style=\"margin:14px 0 6px\">Suy target cá nhân từ Blind + ABX hiện có</h3>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px\"><button class=\"btn small\" id=\"upPersDerive\">Đọc kết quả Blind hiện tại + suy ra</button>"
      + "<button class=\"btn small\" id=\"upPersApply\">Tạo target cá nhân + chọn làm target hiện tại</button>"
      + "<button class=\"btn small\" id=\"upSelfCheck2Btn\">Tự kiểm Khối 2 (case tổng hợp)</button></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:12px;margin-top:8px\">"
      + "<label>Bass ưa thích (dB) <input class=\"numin\" id=\"upPersBass\" type=\"number\" step=\"0.5\" value=\"0\" style=\"width:90px\" /></label>"
      + "<label>Treble ưa thích (dB) <input class=\"numin\" id=\"upPersTreble\" type=\"number\" step=\"0.5\" value=\"0\" style=\"width:90px\" /></label>"
      + "<label>Ear-gain ưa thích (dB) <input class=\"numin\" id=\"upPersEar\" type=\"number\" step=\"0.5\" value=\"0\" style=\"width:90px\" /></label></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>Target cá nhân</span><b id=\"upPersInfo\">Chưa suy ra — chạy Blind (chấm đủ các mẫu, hiện kết quả) rồi bấm “Đọc kết quả Blind hiện tại”.</b></div>"
      + "<p class=\"note\" id=\"upPersNote\" style=\"margin-top:6px\">Phương pháp: w = điểm 1–5 của từng ứng viên; lệch ưa thích = trung bình có trọng số − trung bình không trọng số; giới hạn bass/treble ±3 dB, ear ±2 dB. ABX không đổi trọng số.</p>";
    var panels = document.querySelectorAll(".panel"), anchor2 = null;
    for (var pi = 0; pi < panels.length; pi++){
      var h = panels[pi].querySelector("h2");
      if (h && h.textContent.indexOf("Nâng cấp 1") === 0){ anchor2 = panels[pi]; break; }
    }
    if (anchor2 && anchor2.parentNode) anchor2.parentNode.insertBefore(panel, anchor2.nextSibling);
    else { var aeP = document.getElementById("aePanel"); if (aeP && aeP.parentNode) aeP.parentNode.insertBefore(panel, aeP.nextSibling); else document.body.appendChild(panel); }
    function upSetInfo2(id, txt){ var el = document.getElementById(id); if (el) el.textContent = txt; }
    function upReadAud(){
      var L = [], R = [];
      UP_AUDIO_FREQS.forEach(function(f){
        var l = document.getElementById("upAudL" + f), r = document.getElementById("upAudR" + f);
        L.push(l && l.value !== "" ? parseFloat(l.value) : NaN);
        R.push(r && r.value !== "" ? parseFloat(r.value) : NaN);
      });
      return { L: L, R: R };
    }
    document.getElementById("upAudCalc").addEventListener("click", function(){
      try{
        var a = upReadAud(), bal = upAudiogramBalance(a.L, a.R); UP.lastBalance = bal;
        var txt = "Ngưỡng trung bình L " + bal.meanL.toFixed(1) + " dB HL, R " + bal.meanR.toFixed(1) + " dB HL (chênh " + bal.diff.toFixed(1) + " dB). Cân bằng gợi ý (1/2 chênh lệch, chia đều): L " + (bal.offL >= 0 ? "+" : "") + bal.offL.toFixed(2) + " dB, R " + (bal.offR >= 0 ? "+" : "") + bal.offR.toFixed(2) + " dB — đặt trên DAC/thiết bị (app không có trim riêng từng kênh nên không tự áp trong engine).";
        if (bal.flags.length) txt += " " + bal.flags.join(" ");
        upSetInfo2("upAudInfo", txt);
      }catch(ex){ upSetInfo2("upAudInfo", "Lỗi: " + ex.message); }
    });
    document.getElementById("upAudSave").addEventListener("click", function(){
      try{
        var a = upReadAud();
        window.localStorage.setItem("webAutoEq.audiogram.v1", JSON.stringify({ v: 1, freqs: UP_AUDIO_FREQS, L: a.L, R: a.R, savedAt: new Date().toISOString() }));
        upSetInfo2("upAudInfo", "Đã lưu audiogram vào máy này (localStorage, không gửi máy chủ). Bấm “Tính cân bằng L/R” để xem offset.");
      }catch(ex){ upSetInfo2("upAudInfo", "Không lưu được: " + ex.message); }
    });
    try{
      var savedAud = window.localStorage.getItem("webAutoEq.audiogram.v1");
      if (savedAud){
        var sa = JSON.parse(savedAud);
        if (sa && sa.L && sa.R){
          UP_AUDIO_FREQS.forEach(function(f, i){
            var l = document.getElementById("upAudL" + f), r = document.getElementById("upAudR" + f);
            if (l && isFinite(sa.L[i])) l.value = sa.L[i];
            if (r && isFinite(sa.R[i])) r.value = sa.R[i];
          });
          upSetInfo2("upAudInfo", "Đã khôi phục audiogram đã lưu trên máy này.");
        }
      }
    }catch(e){}
    try{
      var savedPers = window.localStorage.getItem("webAutoEq.personalTarget.v1");
      if (savedPers){
        var sp = JSON.parse(savedPers);
        if (sp && sp.v === 1){
          var persBaseId = (typeof sp.base === "string" && sp.base !== "personal" && AE_TARGETS[sp.base]) ? sp.base : "harmanOE";
          var persBase = AE_TARGETS[persBaseId];
          var pd = sp.deltas || {};
          var persDeltas = {
            bass: up2Clamp(parseFloat(pd.bass) || 0, -6, 6),
            treble: up2Clamp(parseFloat(pd.treble) || 0, -6, 6),
            ear: up2Clamp(parseFloat(pd.ear) || 0, -4, 4)
          };
          var persKnots = [];
          (Array.isArray(sp.knots) ? sp.knots : []).forEach(function(k){
            if (k && isFinite(parseFloat(k[0])) && isFinite(parseFloat(k[1]))){
              var pf = parseFloat(k[0]), pg = parseFloat(k[1]);
              if (pf >= 20 && pf <= 20000) persKnots.push([pf, pg]);
            }
          });
          if (persKnots.length){
            var persBal = null;
            if (sp.balance && isFinite(parseFloat(sp.balance.offL)) && isFinite(parseFloat(sp.balance.offR)))
              persBal = { offL: parseFloat(sp.balance.offL), offR: parseFloat(sp.balance.offR) };
            if (persBal) UP.lastBalance = persBal;
            var persBalNote = persBal ? (" Cân bằng L/R gợi ý: L " + persBal.offL.toFixed(2) + " dB, R " + persBal.offR.toFixed(2) + " dB (đặt trim trên thiết bị).") : "";
            var persBaseNote = (persBaseId === sp.base) ? "" : (typeof sp.base === "string" && sp.base !== "") ? (" Nền gốc đã lưu (" + sp.base + ") không còn hợp lệ, dùng Harman OE làm nền hiển thị; đường cong đã lưu được giữ nguyên.") : " Không lưu nền gốc hợp lệ kèm theo target, dùng Harman OE làm nền hiển thị; đường cong đã lưu được giữ nguyên.";
            AE_TARGETS.personal = { name: "Target cá nhân (Blind + kiểm thính)", rig: persBase.rig || null, base: persBaseId,
              note: "Target cá nhân suy từ Blind (bass " + persDeltas.bass.toFixed(1) + " dB, treble " + persDeltas.treble.toFixed(1) + " dB, ear " + persDeltas.ear.toFixed(1) + " dB) trên nền " + persBase.name + "." + persBalNote, knots: persKnots };
            var persSel = document.getElementById("aeTarget");
            if (persSel && !persSel.querySelector("option[value=\"personal\"]")){
              var persOpt = document.createElement("option"); persOpt.value = "personal"; persOpt.textContent = "Target cá nhân (Blind + kiểm thính)"; persSel.appendChild(persOpt);
            }
            if (persSel) persSel.value = "personal";
            try{ if (typeof aeUpdateTarget === "function") aeUpdateTarget(); }catch(e){}
            upSetInfo2("upPersInfo", "Đã khôi phục target cá nhân đã lưu trên máy này (nền " + persBase.name + ", bass " + persDeltas.bass.toFixed(1) + " dB, treble " + persDeltas.treble.toFixed(1) + " dB, ear " + persDeltas.ear.toFixed(1) + " dB)." + persBaseNote);
          }
        }
      }
    }catch(e){}
    document.getElementById("upPersDerive").addEventListener("click", function(){
      try{
        if (typeof blind === "undefined" || !blind.cands || !blind.cands.length) throw new Error("Chưa có ứng viên Blind nào — thêm ứng viên ở panel “Chấm điểm mù” trước.");
        if (!blind.order || !blind.order.length || !blind.ratings) throw new Error("Chưa có kết quả Blind trong phiên này — bấm “Bắt đầu chấm mù”, chấm đủ các mẫu rồi bấm “Hiện kết quả” ở panel Blind, sau đó quay lại đây.");
        var items = [];
        blind.order.forEach(function(candIdx, pos){
          var rating = blind.ratings[pos];
          if (!rating) return;
          var cand = blind.cands[candIdx];
          if (!cand) return;
          items.push({ name: cand.name, rating: rating, profile: upCandidateProfile(cand.bands) });
        });
        if (items.length < 2) throw new Error("Mới chấm được " + items.length + " mẫu — cần ít nhất 2 mẫu đã chấm.");
        var pers = upPersonalFromRatings(items); UP.lastPersonal = pers;
        document.getElementById("upPersBass").value = pers.deltas.bass.toFixed(1);
        document.getElementById("upPersTreble").value = pers.deltas.treble.toFixed(1);
        document.getElementById("upPersEar").value = pers.deltas.ear.toFixed(1);
        var txt = "Từ " + pers.n + " ứng viên Blind đã chấm: bass " + (pers.deltas.bass >= 0 ? "+" : "") + pers.deltas.bass.toFixed(2) + " dB, treble " + (pers.deltas.treble >= 0 ? "+" : "") + pers.deltas.treble.toFixed(2) + " dB, ear-gain " + (pers.deltas.ear >= 0 ? "+" : "") + pers.deltas.ear.toFixed(2) + " dB (trung bình có trọng số trừ trung bình không trọng số). Chi tiết: " + items.map(function(it){ return it.name + " " + it.rating + "/5 (bass " + it.profile.bass.toFixed(1) + ", treble " + it.profile.treble.toFixed(1) + ", ear " + it.profile.ear.toFixed(1) + ")"; }).join("; ") + ".";
        if (typeof ABX !== "undefined" && ABX.score){
          txt += " ABX: " + ABX.score.n + " lượt thử, đúng " + ABX.score.ok + " (" + (ABX.score.n ? Math.round(ABX.score.ok / ABX.score.n * 100) : 0) + "%) — chỉ ghi chú độ tin cậy, không đổi trọng số.";
          if (ABX.score.n >= 5 && ABX.score.ok / ABX.score.n < 0.5) txt += " Độ chính xác ABX dưới mức đoán mò nên target này chỉ là gợi ý, cần chấm Blind thêm.";
        }
        if (UP.lastBalance) txt += " Cân bằng L/R từ audiogram: L " + UP.lastBalance.offL.toFixed(2) + " dB, R " + UP.lastBalance.offR.toFixed(2) + " dB (lưu kèm target, đặt trim trên thiết bị).";
        upSetInfo2("upPersInfo", txt);
        var note = document.getElementById("upPersNote");
        if (note) note.textContent = "Phương pháp đã dùng: w = điểm 1–5; lệch = trung bình có trọng số − trung bình không trọng số; giới hạn bass/treble ±3 dB, ear ±2 dB. Bấm “Tạo target cá nhân” để đăng ký target này như một target có sẵn.";
      }catch(ex){ upSetInfo2("upPersInfo", "Lỗi: " + ex.message); }
    });
    document.getElementById("upPersApply").addEventListener("click", function(){
      try{
        if (typeof AE_TARGETS === "undefined") throw new Error("Chưa có thư viện target (AE_TARGETS).");
        var baseId = document.getElementById("aeTarget") ? document.getElementById("aeTarget").value : "harmanOE";
        if (baseId === "personal"){
          var persBaseId = AE_TARGETS.personal && AE_TARGETS.personal.base;
          baseId = (typeof persBaseId === "string" && persBaseId !== "personal" && AE_TARGETS[persBaseId]) ? persBaseId : "harmanOE";
        }
        var base = AE_TARGETS[baseId]; if (!base) throw new Error("Target gốc không tồn tại: " + baseId);
        var deltas = {
          bass: up2Clamp(parseFloat(document.getElementById("upPersBass").value) || 0, -6, 6),
          treble: up2Clamp(parseFloat(document.getElementById("upPersTreble").value) || 0, -6, 6),
          ear: up2Clamp(parseFloat(document.getElementById("upPersEar").value) || 0, -4, 4)
        };
        var knots = upPersonalKnots(base.knots, deltas);
        var balNote = UP.lastBalance ? (" Cân bằng L/R gợi ý: L " + UP.lastBalance.offL.toFixed(2) + " dB, R " + UP.lastBalance.offR.toFixed(2) + " dB (đặt trim trên thiết bị).") : "";
        AE_TARGETS.personal = { name: "Target cá nhân (Blind + kiểm thính)", rig: base.rig || null, base: baseId,
          note: "Target cá nhân suy từ Blind (bass " + deltas.bass.toFixed(1) + " dB, treble " + deltas.treble.toFixed(1) + " dB, ear " + deltas.ear.toFixed(1) + " dB) trên nền " + base.name + "." + balNote, knots: knots };
        var sel = document.getElementById("aeTarget");
        if (sel && !sel.querySelector("option[value=\"personal\"]")){
          var opt = document.createElement("option"); opt.value = "personal"; opt.textContent = "Target cá nhân (Blind + kiểm thính)"; sel.appendChild(opt);
        }
        if (sel) sel.value = "personal";
        try{ window.localStorage.setItem("webAutoEq.personalTarget.v1", JSON.stringify({ v: 1, base: baseId, deltas: deltas, knots: knots, balance: UP.lastBalance || null, savedAt: new Date().toISOString() })); }catch(e){}
        if (typeof aeUpdateTarget === "function") aeUpdateTarget();
        upSetInfo2("upPersInfo", "Đã tạo “Target cá nhân (Blind + kiểm thính)” từ nền " + base.name + " (bass " + deltas.bass.toFixed(1) + " dB, treble " + deltas.treble.toFixed(1) + " dB, ear " + deltas.ear.toFixed(1) + " dB) và chọn làm target hiện tại — dùng được như mọi target có sẵn ở Bước 2.");
      }catch(ex){ upSetInfo2("upPersInfo", "Lỗi: " + ex.message); }
    });
    document.getElementById("upSelfCheck2Btn").addEventListener("click", function(){
      var r = upSelfCheck2();
      upSetInfo2("upPersInfo", "Tự kiểm Khối 2: " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : " — tất cả case tổng hợp đều đạt."));
    });
  }catch(e){}
  }
})();

