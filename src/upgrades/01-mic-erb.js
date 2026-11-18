/* ================================================================
   NÂNG CẤP KHỐI 1 — Mic calibration + đo lặp + ERB smoothing
   Khối tự chứa, chỉ BỌC (wrap) aeSetMeasurement, không sửa logic gốc.
   Quy ước bù mic (REW): file hiệu chuẩn ghi đáp tuyến của mic; đường đo
   bằng mic bị lệch đúng bằng (cal(f) - cal(1 kHz)) nên hiệu chuẩn là
   đo(f) - (cal(f) - cal(1 kHz)). Mức tuyệt đối đã chuẩn hoá 0 dB @ 1 kHz
   trong aePrepare nên chỉ phần lệch tương đối mới có ý nghĩa.
   ERB smoothing: cửa sổ trượt có bề rộng = 1 ERB tại tần số đó
   (ERB(f) = 24.7 * (4.37*f/1000 + 1) Hz), đổi ra octave; tối thiểu 1/12 oct.
   Guard: vùng đường THÔ lõm sâu > 10 dB so với xu hướng 1/3 oct được
   liệt kê riêng; solver gốc đã loại null hẹp khỏi hiệu chỉnh (W = 0),
   nên guard này là lớp hiển thị/kiểm tra bổ sung, không thay solver.
   ================================================================ */
(function(){
"use strict";
var UP = window.UP = window.UP || {};
function upInterp(pts, f){
  if (!pts || !pts.length) return 0;
  if (f <= pts[0][0]) return pts[0][1];
  if (f >= pts[pts.length-1][0]) return pts[pts.length-1][1];
  var lo = 0, hi = pts.length - 1;
  while (hi - lo > 1){ var m = (lo + hi) >> 1; if (pts[m][0] <= f) lo = m; else hi = m; }
  var t = (Math.log(f) - Math.log(pts[lo][0])) / (Math.log(pts[hi][0]) - Math.log(pts[lo][0]));
  return pts[lo][1] + t * (pts[hi][1] - pts[lo][1]);
}
function upErbHz(f){ return 24.7 * (4.37 * f / 1000 + 1); }
function upErbWidthOct(f){
  var e = upErbHz(f), lo = Math.max(10, f - e / 2), hi = f + e / 2;
  return Math.log2(hi / lo);
}
function upSmoothWidth(vals, freqs, widthFn){
  var n = vals.length, out = new Array(n), i, j;
  for (i = 0; i < n; i++){
    var half = widthFn(freqs[i]) / 2, s = 0, c = 0, li = Math.log(freqs[i]);
    for (j = 0; j < n; j++){
      if (Math.abs(Math.log(freqs[j]) - li) <= half + 1e-12){ s += vals[j]; c++; }
    }
    out[i] = c ? s / c : vals[i];
  }
  return out;
}
function upErbSmooth(vals, freqs){
  return upSmoothWidth(vals, freqs, function(f){ return Math.max(1 / 12, upErbWidthOct(f)); });
}
function upGuardIntervals(vals, freqs){
  var trend = upSmoothWidth(vals, freqs, function(){ return 1 / 3; });
  var out = [], i = 0, n = vals.length;
  while (i < n){
    if (trend[i] - vals[i] > 10){
      var j = i, pk = i;
      while (j < n && trend[j] - vals[j] > 10){ if (trend[j] - vals[j] > trend[pk] - vals[pk]) pk = j; j++; }
      out.push({ fLo: freqs[i], fHi: freqs[j - 1], fc: freqs[pk], depth: trend[pk] - vals[pk] });
      i = j;
    } else i++;
  }
  return out;
}
function upParseMicCal(text){
  var lines = String(text).split(/\r?\n/), pts = [], bad = [], skipped = 0;
  for (var li = 0; li < lines.length; li++){
    var raw = lines[li].trim();
    if (!raw){ continue; }
    var first = raw.charAt(0);
    if (first === "*" || first === "#" || first === ";"){ skipped++; continue; }
    var toks = raw.split(/[,;\t ]+/).filter(function(x){ return x.length > 0; });
    var f = parseFloat(toks[0]), v = toks.length > 1 ? parseFloat(toks[1]) : NaN;
    if (isFinite(f) && isFinite(v)){
      if (f >= 10 && f <= 24000 && v > -100 && v < 200){ pts.push([f, v]); continue; }
      bad.push(li + 1); continue;
    }
    if (/[0-9]/.test(first)) bad.push(li + 1); else skipped++;
  }
  if (bad.length) throw new Error("Dòng hiệu chuẩn không đọc được ở dòng: " + bad.slice(0, 8).join(", ") + " — file cần 2 cột: tần số (Hz) và dB.");
  if (pts.length < 8) throw new Error("Chỉ tìm thấy " + pts.length + " điểm hiệu chuẩn hợp lệ (cần tối thiểu 8).");
  pts.sort(function(a, b){ return a[0] - b[0]; });
  var ded = [];
  for (var i = 0; i < pts.length; i++){
    if (ded.length && Math.abs(ded[ded.length-1][0] - pts[i][0]) < 1e-9){
      var d = ded[ded.length-1]; d[1] = (d[1] * d[2] + pts[i][1]) / (d[2] + 1); d[2]++;
    } else ded.push([pts[i][0], pts[i][1], 1]);
  }
  return { points: ded.map(function(d){ return [d[0], d[1]]; }), skipped: skipped };
}
function upMicCalAt(calPts, f){ return upInterp(calPts, f) - upInterp(calPts, 1000); }
function upApplyMicCal(measPts, calPts){
  return measPts.map(function(p){ return [p[0], p[1] - upMicCalAt(calPts, p[0])]; });
}
function upAverageRuns(runs){
  if (!runs || runs.length < 1) throw new Error("Cần ít nhất 1 lần đo.");
  var freqSet = {}, fi;
  runs.forEach(function(r){ r.forEach(function(p){ freqSet[p[0]] = true; }); });
  var freqs = Object.keys(freqSet).map(function(x){ return parseFloat(x); }).sort(function(a, b){ return a - b; });
  var points = [], spreads = [], warnings = [];
  freqs.forEach(function(f){
    var vals = [];
    runs.forEach(function(r){
      if (f >= r[0][0] && f <= r[r.length-1][0]) vals.push(upInterp(r, f));
    });
    if (!vals.length) return;
    /* Trung bình NĂNG LƯỢNG (power-average) — nâng cấp 2026-10-31: trung
       bình số học trên dB luôn thấp hơn trung bình năng lượng khi các lần
       đo khác nhau (bất đẳng thức Jensen), và sai lệch lớn dần đúng ở
       vùng lệch nhiều nhất. Quy ước trung bình mức âm (như REW và các
       chuẩn đo SPL) là trung bình tuyến tính của 10^(dB/10) rồi đổi lại
       dB. Lệch 80/82 dB: số học cho 81,000 — năng lượng cho 81,115. */
    var s = 0; vals.forEach(function(v){ s += Math.pow(10, v / 10); });
    var mean = 10 * Math.log10(s / vals.length), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    points.push([f, mean]); spreads.push({ f: f, spread: mx - mn, n: vals.length });
  });
  var maxSpread = 0, maxFreq = 0, sumSp = 0;
  spreads.forEach(function(sp){ sumSp += sp.spread; if (sp.spread > maxSpread){ maxSpread = sp.spread; maxFreq = sp.f; } });
  var meanSpread = spreads.length ? sumSp / spreads.length : 0;
  if (runs.length < 2) warnings.push("Chỉ có 1 lần đo — chưa phải trung bình đo lặp.");
  if (maxSpread > 3) warnings.push("CẢNH BÁO: độ lệch lớn nhất giữa các lần đo là " + maxSpread.toFixed(2) + " dB tại " + Math.round(maxFreq) + " Hz (ngưỡng 3 dB) — nên đo lại / kiểm tra vị trí mic trước khi dùng trung bình.");
  if (meanSpread > 1.5) warnings.push("CẢNH BÁO: độ lệch trung bình giữa các lần đo là " + meanSpread.toFixed(2) + " dB (ngưỡng 1,5 dB).");
  return { points: points, spreads: spreads, maxSpread: maxSpread, maxSpreadFreq: maxFreq, meanSpread: meanSpread, warnings: warnings, nRuns: runs.length };
}
UP.pure1 = { interp: upInterp, erbHz: upErbHz, erbWidthOct: upErbWidthOct, erbSmooth: upErbSmooth,
  guardIntervals: upGuardIntervals, parseMicCal: upParseMicCal, micCalAt: upMicCalAt,
  applyMicCal: upApplyMicCal, averageRuns: upAverageRuns };
UP.micCal = UP.micCal || null;
UP.runs = UP.runs || [];
UP.erbOn = !!UP.erbOn;
function upApplyErbToCurrent(){
  try{
    if (typeof AE !== "undefined" && AE && AE.rawG && AE.freqs && typeof aeGridFn === "function"){
      AE.sm = upErbSmooth(AE.rawG, AE.freqs); AE.smFn = aeGridFn(AE.sm);
      if (typeof drawGraph === "function") drawGraph();
      return true;
    }
  }catch(e){}
  return false;
}
UP.applyErbToCurrent = upApplyErbToCurrent;
/* Bọc aeSetMeasurement: sau khi đường đo mới được nạp, nếu ERB đang bật thì
   thay bản làm mượt mặc định (1/6–1/12 oct) bằng bản ERB. Không đổi pts/raw/nulls. */
try{
  if (typeof aeSetMeasurement === "function" && !aeSetMeasurement._upWrapped){
    var origAeSet = aeSetMeasurement;
    var wrappedAeSet = function(pts, name, rig, source){
      var r = origAeSet(pts, name, rig, source);
      if (UP.erbOn) upApplyErbToCurrent();
      return r;
    };
    wrappedAeSet._upWrapped = true;
    aeSetMeasurement = wrappedAeSet;
  }
}catch(e){}
function upSelfCheck1(){
  var pass = 0, total = 0, msgs = [];
  function ck(name, cond, detail){ total++; if (cond) pass++; else msgs.push(name + " FAIL: " + detail); }
  try{
    var corr = upApplyMicCal([[1000, 80], [3000, 80]], [[1000, 0], [3000, 2]]);
    ck("bù mic", Math.abs(corr[1][1] - 78) < 1e-9, JSON.stringify(corr));
    var avg = upAverageRuns([[[1000, 80], [2000, 82]], [[1000, 82], [2000, 82]]]);
    ck("trung bình đo lặp (năng lượng)", Math.abs(avg.points[0][1] - 81.1148) < 1e-3 && Math.abs(avg.maxSpread - 2) < 1e-9, JSON.stringify(avg.points));
    var avgBad = upAverageRuns([[[1000, 80]], [[1000, 84]]]);
    ck("cảnh báo lệch lớn", avgBad.warnings.length > 0 && avgBad.maxSpread === 4, avgBad.warnings.join(" | "));
    var flat = upErbSmooth([5, 5, 5, 5, 5], [100, 200, 400, 800, 1600]);
    ck("ERB giữ đường phẳng", flat.every(function(v){ return Math.abs(v - 5) < 1e-9; }), JSON.stringify(flat));
    /* Lưới test phải dày như lưới solver thật (1/24 oct): trên lưới thưa 1 oct
       thì cửa sổ ERB (~0,2 oct) không chứa điểm lân cận nào nên không làm mượt được. */
    var gf = [], gv = [], gv2 = [];
    for (var gi = 0; gi <= 96; gi++){ var gfq = 100 * Math.pow(2, gi / 24); gf.push(gfq); gv.push(0); gv2.push(0); }
    var gi400 = 0; for (var gj = 0; gj < gf.length; gj++) if (Math.abs(Math.log(gf[gj] / 400)) < Math.abs(Math.log(gf[gi400] / 400))) gi400 = gj;
    gv[gi400] = 20; gv2[gi400] = -15;
    var spike = upErbSmooth(gv, gf);
    ck("ERB làm mượt đỉnh nhọn", spike[gi400] < 20 && spike[gi400] > 0, "spike@" + Math.round(gf[gi400]) + "=" + spike[gi400].toFixed(2));
    var guard = upGuardIntervals(gv2, gf);
    ck("guard phát hiện lõm sâu", guard.length >= 1, JSON.stringify(guard));
    var cal = upParseMicCal("20 0.0\n100 0.5\n1000 0.0\n10000 -1.0\n20000 -2.0\n50 0.2\n500 0.1\n2000 0.3\n4000 -0.5\n8000 -0.8\n");
    ck("parse file cal REW", cal.points.length === 10 && cal.points[0][0] === 20, "n=" + cal.points.length);
  }catch(e){ msgs.push("exception: " + e.message); }
  return { pass: pass, total: total, msgs: msgs };
}
UP.selfCheck1 = upSelfCheck1;
if (typeof document !== "undefined"){
  try{
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = "<h2>Nâng cấp 1 — Mic calibration + đo lặp + ERB smoothing</h2>"
      + "<p class=\"note\">Bù mic theo file hiệu chuẩn REW (.txt/.csv), trung bình năng lượng (power-average) nhiều lần đo có cảnh báo lệch, và smoothing ERB cho đường đưa vào solver. Đường thô vẫn được giữ để kiểm tra guard (lõm sâu &gt; 10 dB).</p>"
      + "<div><label class=\"flabel\" for=\"upMicCalFile\">File hiệu chuẩn micro (.txt/.csv kiểu REW: tần số, dB)</label>"
      + "<input type=\"file\" id=\"upMicCalFile\" accept=\".txt,.csv\" /></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upMicCalApply\">Áp bù mic cho đường đo hiện tại</button>"
      + "<button class=\"btn small\" id=\"upMicCalClear\">Bỏ bù mic (về đường gốc đã lưu)</button></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>Hiệu chuẩn mic</span><b id=\"upMicCalInfo\">Chưa nạp file hiệu chuẩn.</b></div>"
      + "<div style=\"margin-top:12px\"><label class=\"flabel\" for=\"upRunFiles\">Đo lặp: chọn nhiều file đo cùng một tai nghe (mỗi file = 1 lần đo)</label>"
      + "<input type=\"file\" id=\"upRunFiles\" accept=\".txt,.csv\" multiple /></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upRunAvg\">Tính trung bình + cảnh báo lệch</button>"
      + "<button class=\"btn small\" id=\"upRunApply\">Dùng trung bình làm đường đo</button></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>Đo lặp</span><b id=\"upRunInfo\">Chưa có lần đo nào.</b></div>"
      + "<div style=\"margin-top:12px\"><label><input type=\"checkbox\" id=\"upErbToggle\" /> Dùng smoothing ERB cho đường đưa vào solver (thay bản 1/6–1/12 oct mặc định)</label></div>"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:8px\"><button class=\"btn small\" id=\"upGuardBtn\">Kiểm tra guard trên đường thô</button>"
      + "<button class=\"btn small\" id=\"upSelfCheckBtn\">Tự kiểm Khối 1 (case tổng hợp)</button></div>"
      + "<div class=\"kv\" style=\"margin-top:6px\"><span>ERB / guard / tự kiểm</span><b id=\"upErbInfo\">ERB đang tắt.</b></div>";
    var anchor = document.getElementById("aePanel");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else document.body.appendChild(panel);
    function upReadFile(file, cb){
      var rd = new FileReader();
      rd.onload = function(){ cb(null, String(rd.result || "")); };
      rd.onerror = function(){ cb(new Error("Không đọc được file.")); };
      rd.readAsText(file);
    }
    function upSetInfo(id, txt){ var el = document.getElementById(id); if (el) el.textContent = txt; }
    document.getElementById("upMicCalFile").addEventListener("change", function(e){
      var f = e.target.files && e.target.files[0]; if (!f) return;
      upReadFile(f, function(err, txt){
        if (err){ upSetInfo("upMicCalInfo", "Lỗi: " + err.message); return; }
        try{ UP.micCal = upParseMicCal(txt); upSetInfo("upMicCalInfo", "Đã nạp " + UP.micCal.points.length + " điểm hiệu chuẩn từ " + f.name + " (đã chuẩn hoá 0 dB @ 1 kHz khi áp bù)."); }
        catch(ex){ upSetInfo("upMicCalInfo", "Lỗi file hiệu chuẩn: " + ex.message); }
      });
    });
    document.getElementById("upMicCalApply").addEventListener("click", function(){
      if (!UP.micCal){ upSetInfo("upMicCalInfo", "Chưa nạp file hiệu chuẩn — chọn file ở trên trước."); return; }
      if (typeof AE === "undefined" || !AE.points){ upSetInfo("upMicCalInfo", "Chưa có đường đo nào — chọn tai nghe ở Bước 1 trước."); return; }
      if (!UP.micOrig) UP.micOrig = AE.points;
      var corrected = upApplyMicCal(AE.points, UP.micCal.points);
      if (typeof aeSetMeasurement === "function") aeSetMeasurement(corrected, AE.name + " (đã bù mic)", AE.rig, (AE.source || "") + " · bù mic cal");
      upSetInfo("upMicCalInfo", "Đã áp bù mic cho đường đo hiện tại (trừ cal(f) - cal(1 kHz) tại mỗi tần số).");
    });
    document.getElementById("upMicCalClear").addEventListener("click", function(){
      if (!UP.micOrig){ upSetInfo("upMicCalInfo", "Chưa có đường gốc đã lưu."); return; }
      var orig = UP.micOrig; UP.micOrig = null;
      if (typeof aeSetMeasurement === "function") aeSetMeasurement(orig, AE.name.replace(" (đã bù mic)", ""), AE.rig, AE.source || "");
      upSetInfo("upMicCalInfo", "Đã về đường gốc (bỏ bù mic).");
    });
    document.getElementById("upRunFiles").addEventListener("change", function(e){
      var files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      var runs = [], done = 0, errs = [];
      files.forEach(function(f){
        upReadFile(f, function(err, txt){
          done++;
          if (err){ errs.push(f.name + ": " + err.message); }
          else{
            try{
              var parsed = (typeof aeParseMeasurement === "function") ? aeParseMeasurement(txt) : upParseMicCal(txt);
              runs.push(parsed.points);
            }catch(ex){ errs.push(f.name + ": " + ex.message); }
          }
          if (done === files.length){
            UP.runs = runs; UP.lastAvg = null;
            upSetInfo("upRunInfo", "Đã nạp " + runs.length + "/" + files.length + " lần đo hợp lệ." + (errs.length ? " Lỗi: " + errs.join(" | ") : ""));
          }
        });
      });
    });
    document.getElementById("upRunAvg").addEventListener("click", function(){
      if (!UP.runs || !UP.runs.length){ upSetInfo("upRunInfo", "Chưa có lần đo nào — chọn file đo lặp ở trên."); return; }
      try{
        var avg = upAverageRuns(UP.runs); UP.lastAvg = avg;
        var txt = "Trung bình " + avg.nRuns + " lần đo, " + avg.points.length + " điểm; lệch lớn nhất " + avg.maxSpread.toFixed(2) + " dB tại " + Math.round(avg.maxSpreadFreq) + " Hz; lệch trung bình " + avg.meanSpread.toFixed(2) + " dB.";
        if (avg.warnings.length) txt += " " + avg.warnings.join(" ");
        upSetInfo("upRunInfo", txt);
      }catch(ex){ upSetInfo("upRunInfo", "Lỗi: " + ex.message); }
    });
    document.getElementById("upRunApply").addEventListener("click", function(){
      if (!UP.lastAvg){ upSetInfo("upRunInfo", "Bấm “Tính trung bình” trước."); return; }
      var name = (typeof AE !== "undefined" && AE.name) ? AE.name : "Đo lặp";
      var rig = (typeof AE !== "undefined" && AE.rig) ? AE.rig : "other";
      if (typeof aeSetMeasurement === "function") aeSetMeasurement(UP.lastAvg.points, name + " (trung bình " + UP.lastAvg.nRuns + " lần đo)", rig, "Trung bình đo lặp (" + UP.lastAvg.nRuns + " lần)");
      upSetInfo("upRunInfo", "Đã dùng trung bình làm đường đo." + (UP.lastAvg.warnings.length ? " Lưu ý: " + UP.lastAvg.warnings.join(" ") : ""));
    });
    document.getElementById("upErbToggle").addEventListener("change", function(e){
      UP.erbOn = !!e.target.checked;
      if (UP.erbOn){
        if (upApplyErbToCurrent()) upSetInfo("upErbInfo", "ERB đang BẬT — đường solver hiện tại đã đổi sang smoothing ERB; đường thô không đổi, guard vẫn kiểm tra trên đường thô.");
        else upSetInfo("upErbInfo", "ERB đang BẬT — chưa có đường đo, sẽ áp khi nạp đường đo mới.");
      } else {
        upSetInfo("upErbInfo", "ERB đang TẮT — nạp lại đường đo để về bản làm mượt mặc định.");
      }
    });
    document.getElementById("upGuardBtn").addEventListener("click", function(){
      if (typeof AE === "undefined" || !AE.rawG || !AE.freqs){ upSetInfo("upErbInfo", "Chưa có đường đo để kiểm tra guard."); return; }
      var g = upGuardIntervals(AE.rawG, AE.freqs);
      if (!g.length) upSetInfo("upErbInfo", "Guard: không phát hiện lõm sâu > 10 dB so với xu hướng 1/3 oct trên đường thô.");
      else upSetInfo("upErbInfo", "Guard: phát hiện " + g.length + " vùng lõm sâu trên đường thô: " + g.map(function(x){ return "~" + Math.round(x.fc) + " Hz (sâu " + x.depth.toFixed(1) + " dB)"; }).join("; ") + " — solver gốc đã loại null hẹp khỏi hiệu chỉnh, không boost vào các vùng này.");
    });
    document.getElementById("upSelfCheckBtn").addEventListener("click", function(){
      var r = upSelfCheck1();
      upSetInfo("upErbInfo", "Tự kiểm Khối 1: " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : " — tất cả case tổng hợp đều đạt."));
    });
  }catch(e){}
  }
})();

