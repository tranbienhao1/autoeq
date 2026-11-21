/* ================================================================
   NÂNG CẤP KHỐI 4 — Decramped Biquad (Orfanidis/Vicanek matched
   pole-zero) + Jury Stability Guard. rbjCoeffs lõi đã mở rộng đủ
   8 họ lọc + shelf slope S ở Giai đoạn 1. Khối này bổ sung:
   - UP.pure4.upDecrampedPeakingCoeffs: peaking khớp cực/zero tương
     tự (matched-z), gain khớp chính xác tại w0 — khử méo nén băng
     thông Nyquist (cramping) của bilinear RBJ ở 8–20 kHz.
   - UP.pure4.upAnalogPeakingMagDb: đáp tuyến nguyên mẫu tương tự.
   - UP.pure4.upIsBiquadStable: điều kiện Jury (cực trong |z|<1).
   - Công tắc #upDecrampToggle: khi bật, band peaking > 6 kHz của
     engine dùng hệ số decramped (mặc định TẮT — giữ nguyên hành vi
     và parity Worker; bật/tắt đều xoá cache hệ số BAND_CC).
   ================================================================ */
(function(){
"use strict";
var UP = window.UP = window.UP || {};
UP.pure4 = UP.pure4 || {};
var rbjOrig = rbjCoeffs;

function upIsBiquadStable(c){
  if (!c) return false;
  var s = c.b0 + c.b1 + c.b2 + c.a1 + c.a2;
  if (!isFinite(s)) return false;
  return Math.abs(c.a2) < 1.0 - 1e-12 && Math.abs(c.a1) < (1.0 + c.a2) - 1e-12;
}
function upBiquadPhaseRad(c, f, fs){
  var w = 2 * Math.PI * f / fs, cw = Math.cos(w), sw = Math.sin(w);
  var nr = c.b0 + c.b1 * cw + c.b2 * Math.cos(2 * w), ni = -(c.b1 * sw + c.b2 * Math.sin(2 * w));
  var dr = 1 + c.a1 * cw + c.a2 * Math.cos(2 * w), di = -(c.a1 * sw + c.a2 * Math.sin(2 * w));
  return Math.atan2(ni, nr) - Math.atan2(di, dr);
}
function upAnalogPeakingMagDb(f0, gainDb, Q, f){
  if (!(f > 0) || !(f0 > 0)) return 0;
  var A = Math.pow(10, gainDb / 40);
  var x = (f / f0 - f0 / f) * Q;
  var mag2 = (x * x + A * A) / (x * x + 1 / (A * A));
  return 10 * Math.log10(mag2);
}
function upDecrampedPeakingCoeffs(freq, gainDb, Q, fs){
  var ID = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  if (!isFinite(freq) || !isFinite(gainDb) || !isFinite(Q) || !isFinite(fs) || fs <= 0) return ID;
  if (Math.abs(gainDb) < 1e-9) return ID;
  freq = Math.max(10, Math.min(freq, 0.495 * fs));
  Q = Math.max(0.1, Math.min(Q, 40));
  var w0 = 2 * Math.PI * freq / fs, G = Math.pow(10, gainDb / 20);
  var rp = Math.exp(-w0 / (2 * Q * Math.sqrt(G)));
  var wp = w0 * Math.sqrt(Math.max(0, 1 - 1 / (4 * Q * Q * G)));
  var rz = Math.exp(-w0 * Math.sqrt(G) / (2 * Q));
  var wz = w0 * Math.sqrt(Math.max(0, 1 - G / (4 * Q * Q)));
  var a1 = -2 * rp * Math.cos(wp), a2 = rp * rp;
  var d1 = -2 * rz * Math.cos(wz), d2 = rz * rz;
  var cw = Math.cos(w0), c2 = Math.cos(2 * w0), sw = Math.sin(w0), s2 = Math.sin(2 * w0);
  var nr = 1 + d1 * cw + d2 * c2, ni = -(d1 * sw + d2 * s2);
  var dr = 1 + a1 * cw + a2 * c2, di = -(a1 * sw + a2 * s2);
  var mag = Math.sqrt((nr * nr + ni * ni) / Math.max(1e-18, dr * dr + di * di));
  if (!(mag > 0) || !isFinite(mag)) return rbjOrig("peaking", freq, gainDb, Q, fs);
  var k = G / mag;
  var c = { b0: k, b1: k * d1, b2: k * d2, a1: a1, a2: a2 };
  if (!upIsBiquadStable(c)) return rbjOrig("peaking", freq, gainDb, Q, fs);
  return c;
}
UP.pure4.upIsBiquadStable = upIsBiquadStable;
UP.pure4.upAnalogPeakingMagDb = upAnalogPeakingMagDb;
UP.pure4.upBiquadPhaseRad = upBiquadPhaseRad;
UP.pure4.upDecrampedPeakingCoeffs = upDecrampedPeakingCoeffs;
UP.upIsBiquadStable = upIsBiquadStable;

/* --- Bọc rbjCoeffs theo công tắc decramp (mặc định tắt) --- */
var decrampOn = false;
UP.setDecramp = function(on){
  decrampOn = !!on;
  try { if (typeof BAND_CC !== "undefined") BAND_CC.length = 0; } catch (e) {}
  /* Pha C (decramp stale): decramp doi he so loc nen cache dap tuyen
     GRID_TOT cung phai xoa nhu moi cho khac (chuyen kenh, doi so band,
     QA guard); chi xoa BAND_CC de lai grid stale sau toggle. */
  try { if (typeof GRID_TOT !== "undefined") GRID_TOT = {}; } catch (e) {}
  try { if (typeof updateAll === "function" && typeof bands !== "undefined" && bands.length) updateAll(true); } catch (e) {}
};
try {
  rbjCoeffs = function(type, freq, gainDb, Q, fs, slopeS){
    if (decrampOn && type === "peaking" && freq > 6000)
      return upDecrampedPeakingCoeffs(freq, gainDb, Q, fs);
    return rbjOrig(type, freq, gainDb, Q, fs, slopeS);
  };
} catch (e) {}

function upSelfCheck4(){
  var pass = 0, total = 0, msgs = [];
  function ck(name, cond, detail){ total++; if (cond) pass++; else msgs.push(name + (detail ? " (" + detail + ")" : "")); }
  var FS = 48000;
  try {
    var types = ["peaking","lowshelf","highshelf","lowpass","highpass","bandpass","notch","allpass"];
    ck("đủ 8 họ lọc", types.every(function(ty){ var c = rbjCoeffs(ty, 1000, 3, 1, FS); return c && isFinite(c.b0 + c.a2); }));
    var cn = rbjCoeffs("notch", 1000, 0, 4, FS);
    ck("notch triệt sâu tại fc", biquadMagDb(cn, 1000, FS) <= -100, biquadMagDb(cn, 1000, FS).toFixed(1) + " dB");
    ck("notch trong suốt ngoài dải", Math.abs(biquadMagDb(cn, 100, FS)) < 0.05 && Math.abs(biquadMagDb(cn, 10000, FS)) < 0.05);
    var ca = rbjCoeffs("allpass", 1000, 0, 2, FS), mx = 0;
    [50, 500, 1000, 5000, 15000].forEach(function(f){ mx = Math.max(mx, Math.abs(biquadMagDb(ca, f, FS))); });
    ck("allpass phẳng tuyệt đối", mx < 1e-11, "max " + mx.toExponential(1) + " dB");
    ck("allpass pha -180 độ tại fc", Math.abs(upBiquadPhaseRad(ca, 1000, FS) + Math.PI) < 1e-9);
    var clp = rbjCoeffs("lowpass", 1000, 0, 0.7071, FS), chp = rbjCoeffs("highpass", 1000, 0, 0.7071, FS);
    ck("lowpass -3.01 dB tại fc, ~-24 dB tại 4 kHz", Math.abs(biquadMagDb(clp, 1000, FS) + 3.01) < 0.05 && Math.abs(biquadMagDb(clp, 4000, FS) + 24) < 0.6,
       biquadMagDb(clp, 4000, FS).toFixed(2) + " dB");
    ck("highpass -3.01 dB tại fc, ~-24 dB tại 250 Hz", Math.abs(biquadMagDb(chp, 1000, FS) + 3.01) < 0.05 && Math.abs(biquadMagDb(chp, 250, FS) + 24) < 0.6,
       biquadMagDb(chp, 250, FS).toFixed(2) + " dB");
    function rmsErr(c, f0, g, q){
      var s = 0, n = 0;
      for (var i = 0; i <= 60; i++){ var f = 14000 * Math.pow(20000 / 14000, i / 60); var e = biquadMagDb(c, f, FS) - upAnalogPeakingMagDb(f0, g, q, f); s += e * e; n++; }
      return Math.sqrt(s / n);
    }
    var eStd = rmsErr(rbjCoeffs("peaking", 14000, 8, 1.5, FS), 14000, 8, 1.5);
    var eDec = rmsErr(upDecrampedPeakingCoeffs(14000, 8, 1.5, FS), 14000, 8, 1.5);
    ck("decramped giảm sai số sườn trên >= 40%", eDec <= 0.6 * eStd, "RBJ " + eStd.toFixed(3) + " -> decramped " + eDec.toFixed(3) + " dB RMS");
    var bad = 0;
    types.forEach(function(ty){ [20, 100, 1000, 16000, 20000].forEach(function(fc){ [-12, 12].forEach(function(g){ [0.5, 10].forEach(function(q){
      if (!upIsBiquadStable(rbjCoeffs(ty, fc, g, q, FS))) bad++;
    }); }); }); });
    ck("Jury: lưới cực đoan 8 họ lọc đều ổn định", bad === 0, bad + " bộ mất ổn định");
    ck("Jury: cực ngoài vòng tròn bị bắt", upIsBiquadStable({ b0: 1, b1: 0, b2: 0, a1: -2.1, a2: 1.05 }) === false);
    ck("decramped identity khi gain = 0", (function(){ var c = upDecrampedPeakingCoeffs(14000, 0, 1.5, FS); return c.b0 === 1 && c.b1 === 0 && c.a2 === 0; })());
  } catch (e) { msgs.push("exception: " + e.message); }
  return { pass: pass, total: total, msgs: msgs };
}
UP.selfCheck4 = upSelfCheck4;

if (typeof document !== "undefined"){
  try {
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "upBiquadPanel";
    panel.innerHTML = "<h2>Nâng cấp 4 — Decramped Biquad 8 họ lọc &amp; Jury Stability Guard</h2>"
      + "<p class=\"note\">rbjCoeffs đã mở rộng đủ 8 họ lọc (thêm Low/High/Band Pass, Notch, All Pass) và shelf có độ dốc S. Bộ lọc peaking khớp cực/zero tương tự (matched-z) khử méo nén băng thông gần Nyquist: sai số sườn trên 14–20 kHz giảm mạnh so với RBJ song tuyến tính, đo thực tế trong tự kiểm.</p>"
      + "<label style=\"display:block;margin:6px 0\"><input type=\"checkbox\" id=\"upDecrampToggle\"> Dùng Biquad bù méo Nyquist (Decramped) cho các band Peaking &gt; 6 kHz</label>"
      + "<p class=\"note\">Mặc định tắt để giữ nguyên parity Worker và mọi kết quả hiện tại. Khi bật, hệ số được tính lại ngay; kiểm chứng parity Worker giả định công tắc đang tắt.</p>"
      + "<div class=\"row\"><button class=\"btn\" id=\"upSelfCheck4Btn\">Tự kiểm Khối 4</button>"
      + "<span class=\"note\" id=\"upBiquadInfo\">Chưa chạy tự kiểm.</span></div>";
    var anchor = document.getElementById("aePanel");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else document.body.appendChild(panel);
    var tg = document.getElementById("upDecrampToggle");
    if (tg) tg.addEventListener("change", function(){ UP.setDecramp(tg.checked); });
    var btn = document.getElementById("upSelfCheck4Btn");
    if (btn) btn.addEventListener("click", function(){
      var r = upSelfCheck4(), el = document.getElementById("upBiquadInfo");
      if (el) el.textContent = "Tự kiểm Khối 4: " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : " — tất cả đạt.");
    });
  } catch (e) {}
}
})();
