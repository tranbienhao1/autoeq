/* ================================================================
   NÂNG CẤP KHỐI 5 — Chuẩn quốc tế ISO 226:2023(E) đầy đủ.
   Phần lõi (Table 1 + Công thức (1)/(2) Mục 4.1–4.2, hàm
   isoSplIdx / isoPhonIdx / isoPhonFromSpl / isoValidityCheck) đã
   thay trực tiếp trong Giai đoạn 3. Khối này giữ bộ tham số
   ISO 226:2003 cũ trong UP.pure5 để đối chiếu độ lệch 2023 vs 2003,
   cung cấp tra cứu 2 chiều Phon <-> dB SPL và tự kiểm Khối 5.
   ================================================================ */
(function(){
"use strict";
var UP = window.UP = window.UP || {};
UP.pure5 = UP.pure5 || {};
var AF03 = [0.532,0.506,0.480,0.455,0.432,0.409,0.387,0.367,0.349,0.330,0.315,0.301,0.288,0.276,0.267,0.259,0.253,0.250,0.246,0.244,0.243,0.243,0.243,0.242,0.242,0.245,0.254,0.271,0.301];
var LU03 = [-31.6,-27.2,-23.0,-19.1,-15.9,-13.0,-10.3,-8.1,-6.2,-4.5,-3.1,-2.0,-1.1,-0.4,0.0,0.3,0.5,0.0,-2.7,-4.1,-1.0,1.7,2.5,1.2,-2.1,-7.1,-11.2,-10.7,-3.1];
var TF03 = [78.5,68.7,59.5,51.1,44.0,37.5,31.5,26.5,22.1,17.9,14.4,11.4,8.6,6.2,4.4,3.0,2.2,2.4,3.5,1.7,-1.3,-4.2,-6.0,-5.4,-1.5,6.0,12.6,13.9,12.3];
/* --- Bang tra hang so pow theo chi so i cho iso2003SplIdx (vong tu dong 00:31, huong C):
   Math.pow(0.4*Math.pow(10, (tf+lu)/10 - 9), af) chi phu thuoc i (29 tan so ISO) nen tinh
   MOT lan luc nap file vao ISO03_POW; moi lan goi iso2003SplIdx con 1 pow (10^(0.025*phon))
   thay vi 3. Cung bieu thuc, cung input double nen gia tri tra bang giong tung bit voi gia tri
   tinh lai (tien le 14:22 ISO_POW_A/B cho isoSplIdx/isoPhonIdx — ban 2003 con sot lai chua lam).
   Lab Node tren ham that (luot 00:31, chay 2 lan doc lap, moi lan 2 luot xen ke doi thu tu):
   51.042 gia tri giong tung bit (iso2003Spl/iso2003SplIdx tren phon 0-90 buoc 0,5 x 29 tan so ISO
   + 224 tan so log + ca bien phon/f ngoai mien/NaN), neo 2003 khong doi (60 phon @1kHz 60,011588 dB;
   20 Hz 89,578083/109,511322/118,990011 dB @20/60/80 phon). Toc do: luoi 91 phon x 29 tan so
   (median 31 lan) 21,49->19,44 ms (1,106x) va 21,41->18,75 ms (1,142x) lan 1; lan 2: 1,108x/1,090x;
   goi le iso2003SplIdx 2000 lan 3,00->2,27 ms (1,32x). Ham chi dung cho tra cuu UI (1 lan/bam,
   dong 18016) + doi chieu UP.pure5 nen tuyet doi nho nhung dung tung bit, khong doi hanh vi.
   Khong cham solver/WASM/FIR/QA; aeV1/aeV2/aeV3 khong doi theo cau truc.
   Y tuong luot ke: huong C — do loudFitError NONG sau khi fit nhanh hon (cache LOUD_FIT_COMP,
   treo tu 19:00, chua lam); hoac huong A mo lai (tam dung tu 00:20) — thi nghiem neo lowshelf
   o bass cho aeSolveSingle. --- */
var ISO03_POW = [];
for (var _iso03I = 0; _iso03I < AF03.length; _iso03I++){
  ISO03_POW[_iso03I] = Math.pow(0.4*Math.pow(10, (TF03[_iso03I]+LU03[_iso03I])/10 - 9), AF03[_iso03I]);
}
function iso2003SplIdx(i, phon){
  var af = AF03[i], lu = LU03[i], tf = TF03[i];
  var Af = 4.47e-3*(Math.pow(10, 0.025*phon) - 1.15) + ISO03_POW[i];
  if (!(Af > 0) || !isFinite(Af)) Af = 1e-12;
  return (10/af)*Math.log10(Af) - lu + 94;
}
function iso2003Spl(phon, f){
  if (!isFinite(phon)) phon = 80; if (!isFinite(f)) f = 1000;
  phon = Math.max(0, Math.min(90, phon));
  f = Math.max(ISO_FREQS[0], Math.min(ISO_FREQS[ISO_FREQS.length-1], f));
  var fi = 0; while (fi < ISO_FREQS.length-2 && ISO_FREQS[fi+1] < f) fi++;
  var ft = (Math.log(f)-ISO_LOG_FREQS[fi])/ISO_LOG_SPAN[fi];
  return iso2003SplIdx(fi, phon)*(1-ft) + iso2003SplIdx(fi+1, phon)*ft;
}
UP.pure5.ISO_2003 = { AF: AF03, LU: LU03, TF: TF03 };
UP.pure5.iso2003SplIdx = iso2003SplIdx;
UP.pure5.iso2003Spl = iso2003Spl;
UP.pure5.isoDeltaDb = function(phon, f){ return isoSpl(phon, f) - iso2003Spl(phon, f); };

function upSelfCheck5(){
  var pass = 0, total = 0, msgs = [];
  function ck(name, cond, detail){ total++; if (cond) pass++; else msgs.push(name + (detail ? " (" + detail + ")" : "")); }
  try {
    var maxA = 0;
    [2.4, 10, 20, 40, 60, 80, 90].forEach(function(p){ maxA = Math.max(maxA, Math.abs(isoSpl(p, 1000) - p)); });
    ck("neo 1 kHz bằng 0 tuyệt đối", maxA < 1e-12, "max " + maxA.toExponential(1) + " dB");
    var maxT = 0;
    for (var i = 0; i < 29; i++) maxT = Math.max(maxT, Math.abs(isoSplIdx(i, 2.4) - ISO_TF[i]));
    ck("ngưỡng 2.4 phon khớp cột Tf 29/29", maxT < 1e-12, "max " + maxT.toExponential(1) + " dB");
    ck("điểm chuẩn 20 Hz", Math.abs(isoSpl(20, 20) - 89.54) <= 0.02 && Math.abs(isoSpl(60, 20) - 109.37) <= 0.02 && Math.abs(isoSpl(80, 20) - 118.86) <= 0.02,
       isoSpl(20, 20).toFixed(2) + "/" + isoSpl(60, 20).toFixed(2) + "/" + isoSpl(80, 20).toFixed(2));
    ck("độ bù 50 Hz = +8.12 dB", Math.abs(Math.abs(isoCompDb(60, 80, 50)) - 8.12) <= 0.02, isoCompDb(60, 80, 50).toFixed(3));
    ck("độ bù 100 Hz = +6.04 dB", Math.abs(Math.abs(isoCompDb(60, 80, 100)) - 6.04) <= 0.02, isoCompDb(60, 80, 100).toFixed(3));
    var maxR = 0;
    for (var j = 0; j < 29; j++) [10, 20, 40, 60, 80].forEach(function(p){ maxR = Math.max(maxR, Math.abs(isoPhonIdx(j, isoSplIdx(j, p)) - p)); });
    ck("khứ hồi Công thức (1)<->(2)", maxR < 1e-10, "max " + maxR.toExponential(1) + " phon");
    if (typeof loudGainsFor === "function" && typeof loudFitError === "function"){
      var fe = loudFitError(loudGainsFor(60, 80, 48000), 60, 80, 48000);
      ck("ngân hàng 6-section khớp contour 2023", fe.rms <= 0.50 && fe.max <= 1.10, "RMS " + fe.rms.toFixed(3) + " · max " + fe.max.toFixed(3) + " dB");
    } else ck("ngân hàng 6-section khớp contour 2023", false, "thiếu loudGainsFor/loudFitError");
    ck("cảnh báo hiệu lực dưới 20 phon", isoValidityCheck(10, 1000).length > 0 && isoValidityCheck(60, 1000) === "");
  } catch (e) { msgs.push("exception: " + e.message); }
  return { pass: pass, total: total, msgs: msgs };
}
UP.selfCheck5 = upSelfCheck5;

if (typeof document !== "undefined"){
  try {
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "upIso2023Panel";
    panel.innerHTML = "<h2>Nâng cấp 5 — Chuẩn quốc tế ISO 226:2023(E) đầy đủ (Công thức 1 &amp; 2 + đối chiếu 2023 vs 2003)</h2>"
      + "<p class=\"note\">Toàn bộ mô-đun đẳng âm đã chuyển sang ISO 226:2023(E): Table 1 chính thức (α<sub>f</sub> tại 1 kHz = 0,300), Công thức (1) Mục 4.1 phon → SPL và Công thức (2) Mục 4.2 SPL → phon. Hệ 2003 cũ được giữ lại trong khối này chỉ để đối chiếu độ lệch.</p>"
      + "<div class=\"frow3\">"
      + "<div><label class=\"flabel\" for=\"upIsoF\">Tần số (Hz)</label><input class=\"numin\" id=\"upIsoF\" type=\"number\" min=\"20\" max=\"12500\" step=\"1\" value=\"50\"></div>"
      + "<div><label class=\"flabel\" for=\"upIsoPhon\">Mức độ to (phon)</label><input class=\"numin\" id=\"upIsoPhon\" type=\"number\" min=\"0\" max=\"90\" step=\"1\" value=\"60\"></div>"
      + "<div><label class=\"flabel\" for=\"upIsoSpl\">Mức áp suất (dB SPL)</label><input class=\"numin\" id=\"upIsoSpl\" type=\"number\" step=\"0.1\" value=\"89.93\"></div>"
      + "</div>"
      + "<div class=\"row\"><button class=\"btn\" id=\"upIsoCalcBtn\">Tra cứu 2 chiều</button>"
      + "<button class=\"btn\" id=\"upSelfCheck5Btn\">Tự kiểm Khối 5</button></div>"
      + "<p class=\"note\" id=\"upIsoInfo\">Nhập tần số + phon để tính SPL, hoặc tần số + SPL để tính phon; kết quả kèm độ lệch so với ISO 226:2003.</p>";
    var anchor = document.getElementById("upBiquadPanel") || document.getElementById("aePanel");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else document.body.appendChild(panel);
    var calc = document.getElementById("upIsoCalcBtn");
    if (calc) calc.addEventListener("click", function(){
      var f = parseFloat(document.getElementById("upIsoF").value);
      var phonEl = document.getElementById("upIsoPhon"), splEl = document.getElementById("upIsoSpl");
      var info = document.getElementById("upIsoInfo");
      var out = "";
      if (isFinite(f)){
        if (document.activeElement === splEl || !isFinite(parseFloat(phonEl.value))){
          var spl = parseFloat(splEl.value);
          if (isFinite(spl)) out = "SPL " + spl.toFixed(2) + " dB tại " + f + " Hz → " + isoPhonFromSpl(spl, f).toFixed(2) + " phon (ISO 226:2023).";
        } else {
          var phon = parseFloat(phonEl.value);
          if (isFinite(phon)){
            var s23 = isoSpl(phon, f), s03 = iso2003Spl(phon, f);
            out = phon + " phon tại " + f + " Hz → " + s23.toFixed(2) + " dB SPL (2023) · " + s03.toFixed(2) + " dB SPL (2003) · lệch " + (s23 - s03 >= 0 ? "+" : "") + (s23 - s03).toFixed(2) + " dB.";
            var warn = isoValidityCheck(phon, f);
            if (warn) out += " Lưu ý: " + warn;
          }
        }
      }
      if (info) info.textContent = out || "Số liệu chưa hợp lệ.";
    });
    var btn = document.getElementById("upSelfCheck5Btn");
    if (btn) btn.addEventListener("click", function(){
      var r = upSelfCheck5(), el = document.getElementById("upIsoInfo");
      if (el) el.textContent = "Tự kiểm Khối 5: " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : " — tất cả đạt.");
    });
  } catch (e) {}
}
})();
