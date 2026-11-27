/* Web AutoEQ split module: 02-ui-core.js (nguon: khoi script L4489 cua ban 1 file) */

"use strict";
/* ================================================================
   UI: band strips, đồ thị, meters, sự kiện
   (dùng lại các hàm/state đã khai báo ở khối trước)
   ================================================================ */
/* Ghi text chỉ khi thật sự đổi: ghi lại cùng một chuỗi vẫn thay nút text và
   làm bẩn layout/style của trang, buộc lần đọc kích thước canvas kế tiếp
   phải tính lại — chi phí thừa trong đường cập nhật khi kéo node. */
function setTxt(id, v){ var el = $(id); if (el.textContent !== v) el.textContent = v; }
function refreshDerived(){
  computeAutoPre(displayFs);
  setTxt("kvMaxPos", fmtDb(maxPosDb)+" dB");
  setTxt("kvMaxFreq", fmtFreq(Math.round(maxPosFreq)));
  setTxt("kvPreamp", fmtDb(appliedPreDb())+" dB");
  var r1k = totalDbAt(1000, displayFs);
  setTxt("readout1k", "tại 1 kHz: "+fmtDb(r1k)+" dB");
  setTxt("r31",  fmtDb(totalDbAt(31,displayFs)));
  setTxt("r250", fmtDb(totalDbAt(250,displayFs)));
  setTxt("r1k",  fmtDb(r1k));
  setTxt("r4k",  fmtDb(totalDbAt(4000,displayFs)));
  setTxt("r16k", fmtDb(totalDbAt(16000,displayFs)));
  updateVerify(false);
  updateCoeffPanel();
}
function updateAll(pushAudio){
  refreshDerived();
  drawGraph();
  syncBandUI();
  syncAeBandTable();
  if (pushAudio){ pushCoeffs(); pushFir(); pushConfig(); updateLatency(); }
}
/* Dong bo bang ket qua AutoEQ (aeBandTable) voi band live: bang chi duoc viet
   1 lan luc solve, nen sau khi keo node tren do thi / chinh tay band, bang van
   giu gia tri solver cu trong khi dai band + do thi da doi. Dung lai hang bang
   tu bands hien tai theo anh xa Band->Engine da luu luc solve (AE.lastIdx);
   doi so band 10<->20 (do dai khac nhau) thi dung anh xa dong nhat. Chi ghi
   DOM khi chu ky gia tri doi (keo 1 band khong viet lai ca bang moi khung hinh
   neu khong doi). Khong co ket qua solve nao (AE.lastIdx chua co) thi giu nguyen
   placeholder. */
var AE_BAND_SIG = "";
/* --- vòng tự động 14:24 nhóm D (bản đa file): so sánh chữ ký dạng mảng phẳng trong syncAeBandTable — ÁP DỤNG, vá code. Trước đây syncAeBandTable dựng toàn bộ HTML (fmtFreq/fmtDb/toFixed cho mọi band) rồi mới so sánh chữ ký chuỗi, nên mỗi lần updateAll đều tốn công dựng bảng dù bảng không đổi. Nay chữ ký lưu dạng mảng phẳng [n, type0,freq0,gain0,q0, ...] và so sánh từng trường (===, NaN coi bằng NaN) trước khi dựng HTML: khi không đổi return ngay, khi đổi dựng HTML đúng biểu thức gốc từng toán hạng nên DOM và số lần ghi GIỐNG TỪNG BIT với bản cũ cho mọi giá trị thực tế (kể cả NaN/±Infinity/-0: String(-0)===String(0) và -0===0, NaN được xử lý riêng). Lab (hidden_files/run_20261127_1424_D/lab/, hàm trích verbatim + harness, 2 lần bench độc lập): parity 327/327 GIỐNG TỪNG BIT (gồm đổi band/số band/lastIdx null, NaN/±Inf/-0, 300 fuzz); tốc độ paired-median xen kẽ 9 vòng × 5000 lần — lần 1 không đổi 8,69× / đổi mỗi lần 1,167× / hỗn hợp 5,29× (thắng 9/9 mọi workload), lần 2 không đổi 8,16× / đổi 1,135× (thắng 8/9) / hỗn hợp 4,65×. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function syncAeBandTable(){
  var t = $("aeBandTable");
  if (!t || !AE.lastIdx) return;
  var n = bands.length;
  var vals = AE_BAND_SIG;
  var same = vals && vals.length === 1 + n*4;
  if (same){
    for (var k=0;k<n;k++){
      var b = bands[k];
      var o = 1 + k*4;
      var v;
      v = vals[o]; if (v !== b.type && !(v !== v && b.type !== b.type)){ same = false; break; }
      v = vals[o+1]; if (v !== b.freq && !(v !== v && b.freq !== b.freq)){ same = false; break; }
      v = vals[o+2]; if (v !== b.gain && !(v !== v && b.gain !== b.gain)){ same = false; break; }
      v = vals[o+3]; if (v !== b.q && !(v !== v && b.q !== b.q)){ same = false; break; }
    }
  }
  if (same) return;
  var idx = AE.lastIdx, sameLen = (bands.length === idx.length);
  var rows = '<tr><th>Band → Engine</th><th>Loại</th><th>Fc</th><th>Gain</th><th>Q</th></tr>';
  var newVals = new Array(1 + n*4);
  newVals[0] = n;
  for (var k2=0;k2<bands.length;k2++){
    var b2 = bands[k2];
    var ek = sameLen ? idx[k2] : k2;
    rows += "<tr><td>Band "+(k2+1)+" → #"+(ek+1)+"</td><td>"+AE_TYPLBL[b2.type]+"</td><td>"+fmtFreq(b2.freq)+"</td><td>"+fmtDb(b2.gain)+" dB</td><td>"+b2.q.toFixed(2)+"</td></tr>";
    var o2 = 1 + k2*4;
    newVals[o2] = b2.type; newVals[o2+1] = b2.freq; newVals[o2+2] = b2.gain; newVals[o2+3] = b2.q;
  }
  AE_BAND_SIG = newVals;
  t.innerHTML = rows;
}
/* --- Tối ưu độ mượt khi kéo slider (2026-10-31): các sự kiện "input" của
   slider gain/Q bắn ra nhiều lần trong cùng một khung hình, mỗi lần lại chạy
   toàn bộ updateAll (quét pre-amp 960 điểm + vẽ đồ thị + đồng bộ DOM + đẩy
   hệ số xuống worklet) gây giật. scheduleUpdateAll gộp mọi sự kiện trong
   cùng một khung hình thành ĐÚNG MỘT lần updateAll ở khung hình kế tiếp
   (requestAnimationFrame); giá trị band đã được ghi ngay khi kéo nên kết
   quả cuối không đổi. flushScheduleUpdateAll chạy ngay lập tức khi kết
   thúc kéo (sự kiện "change") để trạng thái chốt đúng tức thì. --- */
var _updRaf = 0, _updPush = false;
function scheduleUpdateAll(pushAudio){
  if (pushAudio) _updPush = true;
  if (_updRaf) return;
  _updRaf = requestAnimationFrame(function(){
    _updRaf = 0;
    var p = _updPush; _updPush = false;
    updateAll(p);
  });
}
function flushScheduleUpdateAll(){
  if (_updRaf){ cancelAnimationFrame(_updRaf); _updRaf = 0; }
  if (_updPush){ _updPush = false; updateAll(true); return true; }
  return false;
}
/* --- Trinh toi uu AEOPT v1 (2026-11-05), rebase len nen Pha B: gop ve target
   khi keo slider — cung mau scheduleUpdateAll; so hien tren slider van cap
   nhat ngay, gia tri cuoi cung khong doi. --- */
var _aeTgtRaf = 0;
function scheduleAeTarget(){
  if (_aeTgtRaf){
    try { if (typeof AEOPT !== "undefined" && AEOPT) AEOPT.targetSkipped++; } catch (e) {}
    return;
  }
  _aeTgtRaf = requestAnimationFrame(function(){ _aeTgtRaf = 0; aeUpdateTarget(); });
}

/* ---------------- Band strips ---------------- */
var bandEls = [];
function buildBandStrips(){
  var host = $("bands");
  host.innerHTML = "";
  bandEls = [];
  bands.forEach(function(b, i){
    var d = document.createElement("div");
    d.className = "band"+(i===selBand?" sel":"");
    d.innerHTML =
      '<div class="freq">'+fmtFreqFull(b.freq)+'</div>'+
      '<div class="type">'+TYPELBL[b.type]+'</div>'+
      '<input class="vgain" type="range" min="-12" max="12" step="0.1" value="0" aria-label="Gain '+fmtFreqFull(b.freq)+'"/>'+
      '<div class="gval"><input type="number" min="-12" max="12" step="0.1" value="0"/><span>dB</span></div>'+
      '<div class="qrow"><label><span>Q</span><span class="qv">1.00</span></label>'+
      '<input class="qslider" type="range" min="0.4" max="8" step="0.01" value="'+b.q+'"/></div>'+
      '<button class="onoff on">BẬT</button>'+
      '<button class="dbl">nhấp đôi slider: về 0 dB</button>';
    host.appendChild(d);
    var vg = d.querySelector(".vgain"), gn = d.querySelector(".gval input"),
        qs = d.querySelector(".qslider"), qv = d.querySelector(".qv"),
        tg = d.querySelector(".onoff");
    vg.addEventListener("input", function(){ bands[i].gain = parseFloat(vg.value); scheduleUpdateAll(true); });
    vg.addEventListener("change", function(){ bands[i].gain = parseFloat(vg.value); if (!flushScheduleUpdateAll()) updateAll(true); });
    vg.addEventListener("dblclick", function(){ bands[i].gain = 0; updateAll(true); });
    gn.addEventListener("change", function(){
      var v = Math.max(-12, Math.min(12, parseFloat(gn.value)||0));
      bands[i].gain = v; updateAll(true);
    });
    qs.addEventListener("input", function(){ bands[i].q = parseFloat(qs.value); scheduleUpdateAll(true); });
    qs.addEventListener("change", function(){ bands[i].q = parseFloat(qs.value); if (!flushScheduleUpdateAll()) updateAll(true); });
    tg.addEventListener("click", function(ev){ ev.stopPropagation(); bands[i].on = !bands[i].on; updateAll(true); });
    d.addEventListener("click", function(){ selBand = i; updateAll(false); });
    bandEls.push({ root:d, vg:vg, gn:gn, qs:qs, qv:qv, tg:tg, fq:d.querySelector(".freq"), tp:d.querySelector(".type") });
  });
}
buildBandStrips();

/* ---------------- Chuyển chế độ số band: 10 <-> 20 ----------------
   `bands` trỏ sang bộ band của chế độ mới (bộ cũ giữ nguyên trong
   BAND_STORE), cache hệ số được xoá, dải điều khiển dựng lại đúng số band,
   rồi updateAll đẩy bộ hệ số mới xuống worklet (worklet tự đổi kích thước
   đệm theo độ dài bộ hệ số). Không đụng vào preset, slot A/B/X hay psycho —
   các cấu trúc đó áp theo chỉ số band nên vẫn hợp lệ ở cả hai chế độ. */
function syncBandCountUI(){
  $("bc10").classList.toggle("on", bandCount === 10);
  $("bc20").classList.toggle("on", bandCount === 20);
  $("bands").classList.toggle("n20", bandCount === 20);
}
function setBandCount(n){
  if (typeof LR_MODE!=="undefined" && LR_MODE!=="linked"){ if (typeof lrSetInfo==="function") lrSetInfo("Đang tách kênh L/R ở " + bandCount + " band — về Liên kết trước khi đổi số band."); return; }
  if (typeof MS_MODE!=="undefined" && MS_MODE!=="linked"){ if (typeof lrSetInfo==="function") lrSetInfo("Đang tách kênh Mid/Side ở " + bandCount + " band — về Liên kết trước khi đổi số band."); return; }
  if (n !== 10 && n !== 20) return;
  if (n === bandCount){ syncBandCountUI(); return; }
  bandCount = n;
  bands = BAND_STORE[n];
  BAND_CC = [];
  GRID_TOT = {};
  if (selBand >= bands.length) selBand = bands.length - 1;
  buildBandStrips();
  syncBandCountUI();
  updateAll(true);
}
$("bc10").addEventListener("click", function(){ setBandCount(10); });
$("bc20").addEventListener("click", function(){ setBandCount(20); });

function syncBandUI(){
  bandEls.forEach(function(e, i){
    var b = bands[i];
    /* Chỉ ghi khi giá trị thật sự đổi (kéo 1 band không còn chạm vào DOM của
       9 band còn lại) — tránh làm bẩn layout/style thừa mỗi lần cập nhật. */
    var fqs = fmtFreqFull(b.freq); if (e.fq.textContent !== fqs) e.fq.textContent = fqs;
    var tps = TYPELBL[b.type]; if (e.tp.textContent !== tps) e.tp.textContent = tps;
    if (parseFloat(e.vg.value) !== b.gain) e.vg.value = b.gain;
    if (document.activeElement !== e.gn && e.gn.value !== b.gain.toFixed(1)) e.gn.value = b.gain.toFixed(1);
    if (parseFloat(e.qs.value) !== b.q) e.qs.value = b.q;
    var qvs = b.q.toFixed(2); if (e.qv.textContent !== qvs) e.qv.textContent = qvs;
    var tgs = b.on ? "BẬT" : "TẮT"; if (e.tg.textContent !== tgs) e.tg.textContent = tgs;
    var tgc = "onoff"+(b.on?" on":""); if (e.tg.className !== tgc) e.tg.className = tgc;
    /* (vòng tự động 16:54 nhóm D): gác classList.toggle trong syncBandUI bằng trạng thái cache theo từng phần tử band (e._off/e._sel) — toggle(token, force) với force đã đúng trạng thái hiện tại là no-op theo spec DOM (không đột biến), nên chỉ gọi khi trạng thái thật sự đổi; trạng thái class cuối giống hệt bản cũ cho mọi dãy thao tác (kiểm chứng lab: parity DOM 400/400 bước, đột biến thật 162/162, số lần gọi toggle 8000→463/555 trên 200 khung hình). Khác hướng đã bác: inline Y/bỏ specPts trong vòng phổ FFT (23:49), hoist W/bars trong meterLoop (17:54) — lượt này không đụng các hàm đó. */
    var _off = !b.on;
    if (e._off !== _off){ e.root.classList.toggle("off", _off); e._off = _off; }
    var _sel = (i===selBand);
    if (e._sel !== _sel){ e.root.classList.toggle("sel", _sel); e._sel = _sel; }
  });
  /* Giai đoạn 4: đồng bộ panel điều khiển chính xác + Dynamic EQ theo band đang chọn */
  if (typeof syncPrecise==="function") syncPrecise();
  if (typeof refreshDynPanel==="function") refreshDynPanel();
}

/* ---------------- Coefficient panel ---------------- */
var COEF_SIG = "";
function updateCoeffPanel(){
  var b = bands[selBand];
  if (!b) return; /* Pha C 2026-11-05: phong khi selBand ngoai khoang (band ngan) — truoc day b.freq nem TypeError (lab 1555) */
  /* Panel chỉ phụ thuộc (band đang chọn, tham số của nó, fs): khi chữ ký
     không đổi (kéo band khác, đổi band không chọn…) bỏ qua việc dựng lại
     innerHTML — nội dung sẽ y hệt. */
  var sig = selBand+"|"+b.freq+"|"+b.type+"|"+b.gain+"|"+b.q+"|"+b.on+"|"+displayFs;
  if (sig === COEF_SIG) return;
  COEF_SIG = sig;
  var c = bandCoeffs(selBand, displayFs);
  $("coefTitle").textContent = "Band "+(selBand+1)+" · "+fmtFreq(b.freq)+" · "+TYPELBL[b.type]+" · "+fmtDb(b.gain,1)+" dB · Q "+b.q.toFixed(2);
  $("hzLine").innerHTML = "H(z) = ( <b>"+c.b0.toFixed(6)+"</b> "+(c.b1<0?"−":"+")+" <b>"+Math.abs(c.b1).toFixed(6)+"</b>·z⁻¹ "+(c.b2<0?"−":"+")+" <b>"+Math.abs(c.b2).toFixed(6)+"</b>·z⁻² ) / ( 1 "+(c.a1<0?"−":"+")+" <b>"+Math.abs(c.a1).toFixed(6)+"</b>·z⁻¹ "+(c.a2<0?"−":"+")+" <b>"+Math.abs(c.a2).toFixed(6)+"</b>·z⁻² ) · fs = "+displayFs+" Hz";
  $("cB0").textContent = c.b0.toFixed(10);
  $("cB1").textContent = c.b1.toFixed(10);
  $("cB2").textContent = c.b2.toFixed(10);
  $("cA1").textContent = c.a1.toFixed(10);
  $("cA2").textContent = c.a2.toFixed(10);
}

/* ---------------- Verification ---------------- */
/* Kết quả lần đo kiểm chứng gần nhất được GIỮ LẠI: trước đây mỗi lần EQ rời
   cấu hình kiểm chứng, updateVerify ghi đè panel về "—" — kể cả ngay sau khi
   chạy QA xong và trạng thái được khôi phục — nên panel trông như chưa từng đo. */
var VERIFY1_LAST = null;
function updateVerify(fromButton){
  var r = totalDbAt(1000, displayFs);
  /* Band kiểm chứng là band đang nằm đúng tại 1 kHz (chế độ 10 band: band 6;
     chế độ 20 band: band được nút kiểm chứng đặt về đúng 1 kHz). */
  var ti = -1;
  bands.forEach(function(b, i){ if (Math.abs(b.freq-1000) < 0.6) ti = i; });
  var isTest = ti >= 0 && Math.abs(bands[ti].gain-6)<0.001 && Math.abs(bands[ti].q-1.41)<0.001 &&
    bands.every(function(b,i){ return i===ti || Math.abs(b.gain)<0.001; });
  if (isTest){
    var err = Math.abs(r-6);
    VERIFY1_LAST = { resp:r, err:err, pre:autoPreDb, at:new Date() };
    $("vResp").textContent = fmtDb(r)+" dB (sai số "+err.toFixed(3)+" dB)";
    $("vRespOk").innerHTML = err<=0.1 ? '<span class="pass">ĐẠT ±0.1 dB</span>' : '<span class="fail">CHƯA ĐẠT</span>';
    $("vPre").textContent = fmtDb(autoPreDb)+" dB";
    $("vPreOk").innerHTML = Math.abs(autoPreDb-(-7))<=0.15 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">KIỂM TRA LẠI</span>';
  } else if (VERIFY1_LAST){
    var L = VERIFY1_LAST;
    $("vResp").textContent = "lần đo kiểm chứng gần nhất ("+L.at.toLocaleTimeString("vi-VN")+"): "+fmtDb(L.resp)+" dB (sai số "+L.err.toFixed(3)+" dB) · đáp tuyến 1 kHz hiện tại: "+fmtDb(r)+" dB";
    $("vRespOk").innerHTML = (L.err<=0.1 ? '<span class="pass">ĐẠT ±0.1 dB</span>' : '<span class="fail">CHƯA ĐẠT</span>')+' <span style="color:var(--dim);font-weight:400">(lần đo gần nhất)</span>';
    $("vPre").textContent = "lần đo kiểm chứng gần nhất: "+fmtDb(L.pre)+" dB · pre-amp theo đáp tuyến hiện tại: "+fmtDb(autoPreDb)+" dB";
    $("vPreOk").innerHTML = (Math.abs(L.pre-(-7))<=0.15 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">KIỂM TRA LẠI</span>')+' <span style="color:var(--dim);font-weight:400">(lần đo gần nhất)</span>';
  } else {
    $("vResp").textContent = "chưa ở cấu hình kiểm chứng — đáp tuyến 1 kHz hiện tại: "+fmtDb(r)+" dB";
    $("vRespOk").textContent = "—";
    $("vPre").textContent = fmtDb(autoPreDb)+" dB (theo đáp tuyến hiện tại)";
    $("vPreOk").textContent = "—";
  }
  try {
    var wc = (typeof wasmSelfCheck === "function") ? wasmSelfCheck() : null;
    if (wc && $("wasmV1")){
      $("wasmV1").textContent = wc.enabled ? ("WASM SIMD đang bật · lệch tối đa " + wc.maxDev.toFixed(5) + " dB (ngưỡng 0,05 dB)") : ("JS dự phòng (WASM không khả dụng hoặc tự kiểm không đạt: " + (wc.reason || "?") + ")");
      $("wasmV1Ok").innerHTML = (wc.enabled && wc.maxDev <= 0.05) ? '<span class="pass">ĐẠT</span>' : (wc.enabled ? '<span class="fail">VƯỢT NGƯỠNG</span>' : '<span class="pass">DỰ PHÒNG</span>');
    }
  } catch (e) { if ($("wasmV1")) $("wasmV1").textContent = "lỗi tự kiểm: " + e.message; }
}
$("btnVerify").addEventListener("click", function(){
  var BS = bandSet(), ti = 0, bd = 1e9;
  bands.forEach(function(b,i){
    b.gain = 0; b.on = true; b.freq = BS.freqs[i]; b.type = BS.types[i]; b.q = BS.defq[i];
    var d = Math.abs(Math.log(BS.freqs[i]/1000)); if (d < bd){ bd = d; ti = i; }
  });
  /* band gần 1 kHz nhất của bộ hiện hành được đặt về đúng 1 kHz, +6 dB, Q 1.41
     (ở chế độ 10 band đó chính là band 6 · 1 kHz như trước) */
  bands[ti].freq = 1000; bands[ti].gain = 6; bands[ti].q = 1.41;
  selBand = ti;
  updateAll(true);
  updateVerify(true);
});

/* ---------------- Mode / bypass / reset / presets ---------------- */
function setMode(m){
  if (m==="fir" && typeof LR_MODE!=="undefined" && LR_MODE!=="linked"){ if (typeof lrSetInfo==="function") lrSetInfo("Đang tách kênh L/R — về Liên kết trước khi chuyển sang chế độ FIR (FIR dùng một bộ taps chung)."); return; }
  if (m==="fir" && typeof MS_MODE!=="undefined" && MS_MODE!=="linked"){ if (typeof lrSetInfo==="function") lrSetInfo("Đang tách kênh Mid/Side — về Liên kết trước khi chuyển sang chế độ FIR (FIR dùng một bộ taps chung)."); return; }
  mode = m;
  $("modeIir").classList.toggle("on", m==="iir");
  $("modeFir").classList.toggle("on", m==="fir");
  $("firCtl").style.display = (m==="fir") ? "block" : "none";
  $("stMode").textContent = (m==="iir") ? "Minimum Phase · IIR" : "Linear Phase · FIR";
  var gd = (firLen-1)/2;
  $("firInfo").innerHTML = "Group delay = (N−1)/2 = <b>"+gd+" samples</b> ≈ "+(gd/displayFs*1000).toFixed(2)+" ms @ "+displayFs+" Hz — hằng số ở mọi tần số (pha tuyến tính). IR được suy ra từ đáp tuyến EQ: lấy mẫu biên độ → IFFT 4096 → cửa sổ Hann → FIR đối xứng." + " Chập bằng Partitioned FFT Convolution (Overlap-Add, block 128 mẫu, FFT 256, " + Math.ceil(firLen/128) + " partition) — chập trực tiếp chỉ là dự phòng khi quantum khác 128 mẫu.";
  pushConfig(); updateLatency(); drawGraph();
}
$("modeIir").addEventListener("click", function(){ setMode("iir"); });
$("modeFir").addEventListener("click", function(){ setMode("fir"); });
$("firLenSeg").addEventListener("click", function(e){
  var btn = e.target.closest("button"); if(!btn) return;
  firLen = parseInt(btn.dataset.n, 10);
  Array.prototype.forEach.call($("firLenSeg").children, function(x){ x.classList.toggle("on", x===btn); });
  $("firLenOut").textContent = firLen+" tap";
  pushFir(); setMode("fir");
});
$("btnBypass").addEventListener("click", function(){
  /* Pha B 2026-11-07: dong huong dan khi tu choi Bypass nam o panel cham mu
     cuoi trang (ngoai viewport khi bam Bypass o dau trang) nen cuon toi no
     (block:"nearest": khong cuon neu da thay, cuon toi thieu neu chua thay). */
  if (typeof blind !== "undefined" && blind && blind.started){ blindInfo("Đang chấm mù — bấm “Dừng / khôi phục” trước khi bật/tắt Bypass, để các mẫu không nghe giống nhau (phẳng)."); $("blindInfo").scrollIntoView({block:"nearest"}); return; }
  bypass = !bypass;
  this.textContent = "Bypass: "+(bypass?"BẬT — EQ bị vòng qua":"Tắt");
  this.classList.toggle("active", bypass);
  pushConfig(); drawGraph();
});
function resetEq(){
  var BS = bandSet();
  bands.forEach(function(b,i){ b.gain=0; b.q=BS.defq[i]; b.on=true; b.freq=BS.freqs[i]; b.type=BS.types[i]; });
  selBand=5; updateAll(true);
}
$("btnReset").addEventListener("click", resetEq);
var PRESETS = {
  flat:   [0,0,0,0,0,0,0,0,0,0],
  bass:   [5,4.5,3.5,2,0.5,0,0,0,0,0],
  vocal:  [-2,-1,0,1,2.5,3,2.5,1.5,0.5,0],
  treble: [0,0,0,0,0,0.5,1.5,3,4.5,5.5],
  loud:   [4,3,1.5,0,0,0,0,1,2.5,4]
};
Array.prototype.forEach.call(document.querySelectorAll(".preset"), function(btn){
  btn.addEventListener("click", function(){
    var p = PRESETS[btn.dataset.p], BS = bandSet();
    /* preset mẫu có 10 giá trị gain: ở chế độ 20 band, 10 band đầu nhận gain
       của preset, các band còn lại giữ phẳng 0 dB */
    bands.forEach(function(b,i){ b.gain = i < p.length ? p[i] : 0; b.on = true; b.freq=BS.freqs[i]; b.type=BS.types[i]; });
    updateAll(true);
  });
});

/* ---------------- Pre-amp controls ---------------- */
/* CHAIN TASK #3 (2026-11-13, truc B): gop ve lai khi keo slider pre-amp sang rAF theo mau scheduleUpdateAll cua slider gain/Q — cac su kien "input" ban nhieu lan trong cung mot khung hinh; truoc day moi su kien chay dong bo refreshDerived()+pushConfig()+drawGraph(). Gia tri slider + nhan dB van cap nhat ngay trong handler; chi phan nang (refreshDerived/pushConfig/drawGraph) duoc gop thanh DUNG MOT lan o khung hinh ke tiep. Dung bo gop rieng (khong di qua updateAll) vi keo pre-amp khong doi he so band nen khong can pushCoeffs/pushFir/syncBandUI moi khung. Trang thai cuoi giong het ban goc: bo ba doc gia tri hien tai cua extraHeadDb/manualPreDb (khong doc gia tri su kien) nen chay 1 lan voi gia tri cuoi = chay N lan voi cac gia tri trung gian; "change" flush ngay lap tuc khi ket thuc keo nhu slider gain/Q. */
var _preRaf = 0;
function schedulePreUpdate(){
  if (_preRaf) return;
  _preRaf = requestAnimationFrame(function(){ _preRaf = 0; refreshDerived(); pushConfig(); drawGraph(); });
}
function flushSchedulePreUpdate(){
  if (_preRaf){ cancelAnimationFrame(_preRaf); _preRaf = 0; refreshDerived(); pushConfig(); drawGraph(); return true; }
  return false;
}
$("extraHead").addEventListener("input", function(){
  extraHeadDb = parseFloat(this.value);
  $("extraOut").textContent = extraHeadDb.toFixed(1)+" dB";
  schedulePreUpdate();
});
$("extraHead").addEventListener("change", function(){ if (!flushSchedulePreUpdate()){ refreshDerived(); pushConfig(); drawGraph(); } });
$("preAuto").addEventListener("click", function(){
  preMode="auto"; $("preModeOut").textContent="Tự động";
  $("preAuto").classList.add("on"); $("preManual").classList.remove("on");
  $("manualWrap").style.display="none";
  refreshDerived(); pushConfig(); drawGraph();
});
$("preManual").addEventListener("click", function(){
  preMode="manual"; $("preModeOut").textContent="Thủ công";
  $("preManual").classList.add("on"); $("preAuto").classList.remove("on");
  $("manualWrap").style.display="block";
  refreshDerived(); pushConfig(); drawGraph();
});
$("manualPre").addEventListener("input", function(){
  manualPreDb = parseFloat(this.value);
  $("manualOut").textContent = manualPreDb.toFixed(1)+" dB";
  schedulePreUpdate(); /* CHAIN TASK #3: gop ve lai sang rAF, xem ghi chu o schedulePreUpdate */
});
$("manualPre").addEventListener("change", function(){ if (!flushSchedulePreUpdate()){ refreshDerived(); pushConfig(); drawGraph(); } });
$("btnLimiter").addEventListener("click", function(){
  limiterOn = !limiterOn;
  this.textContent = limiterOn ? "Tắt limiter" : "Bật limiter";
  $("kvLimState").textContent = limiterOn ? "Bật" : "Tắt";
  pushConfig();
});

/* ---------------- Graph ---------------- */
var graph = $("graph"), gtx = graph.getContext("2d");
var hoverF = null;
/* Cache kích thước CSS của canvas qua ResizeObserver: đọc clientWidth/
   clientHeight GIỮA lúc DOM đang bẩn (ngay sau khi refreshDerived/syncBandUI
   ghi text) ép trình duyệt chạy layout đồng bộ trên toàn trang — một chi phí
   lớn trong đường cập nhật khi kéo node, nhất là ở môi trường CPU yếu.
   Kích thước thật vẫn được theo dõi chính xác: ResizeObserver bắn mỗi khi
   hộp của canvas đổi cỡ vì bất kỳ lý do gì; lần vẽ đầu tiên (chưa có cache)
   đọc trực tiếp một lần rồi đăng ký quan sát. */
var CV_SIZE = new Map();
var CV_RO = ("ResizeObserver" in window) ? new ResizeObserver(function(entries){
  entries.forEach(function(en){ CV_SIZE.set(en.target, { w: Math.round(en.contentRect.width), h: Math.round(en.contentRect.height) }); });
}) : null;
function cvSize(el){
  var s = CV_SIZE.get(el);
  if (!s){
    s = { w: el.clientWidth, h: el.clientHeight };
    CV_SIZE.set(el, s);
    if (CV_RO) CV_RO.observe(el);
  }
  return s;
}
/* Pha B/C 2026-11-07: lưới đồ thị GRAPH_N = 880 đoạn (881 điểm), thay 220 cũ.
   Lab Node trên hàm thật (lab_grid_2026-11-07): lưới 220 hiển thị thiếu đỉnh hẹp
   tới 6,09 dB (+12 dB Q=10 @~17,9 kHz, vị trí xấu nhất), 3,56 dB trong không gian
   solver (Q=6 @18 kHz), dip fixture 10 band thực tế thiếu 0,049 dB; lưới 880 còn
   0,73 dB / 0,28 dB, dip còn 0,007 dB; vẽ nóng 6 lớp 0,43 ms/khung (ngân sách
   16,7 ms), tính lạnh toàn lưới JS 20 band 31 ms (trình duyệt có WASM ~4× nhanh
   hơn; khi kéo chỉ 1 band đổi). Pre-amp/solver không động tới (pre-amp quét
   960 điểm + golden-section riêng; solver không dùng gridTotalDb). */
var GRAPH_N = 880;
var AE_GRID_CACHE = null;
var _fftSpecGrid=null; /* cache luoi pho FFT cua drawGraph (vong tu dong 14:34, huong D) */
/* --- Cache luoi do thi qua cac lan ve (vong tu dong 15:37, huong D):
   _gridF chi phu thuoc hang so (fMin=20, fMax=20000, GRAPH_N=880) nen
   tinh MOT lan cho ca phien; _gridX = X(_gridF) chi phu thuoc W (padL/
   padR hang so, gw=W-padL-padR) nen chi tinh lai khi W doi (resize).
   Vong 13:18 da tinh luoi 1 lan moi lan ve (881 pow + 1762 log10);
   nay moi lan ve nong con 0 pow + 20 log10 (chi ticks/marker), lan ve
   dau sau resize tinh lai _gridX dung 1 lan nhu cu. Cung bieu thuc,
   cung thu tu, cung so double nen log lenh canvas giong het tung bit.
   Lab Node tren ham that (luot 15:37, chay 2 lan, 6 kich ban: nong/lanh
   @800, resize 800->1000, nong @1000, resize ve 800, nong lai @800):
   log canvas giong het ban goc o ca 6 kich ban x 2 lan (md5 0bcac6ba
   @800, e759a244 @1000, 6357 lenh); Math.pow 881->0/lan ve nong,
   Math.log10 1782->20/lan ve nong (lanh 2663->901, phan con lai la
   tgtFn khi dung lai AE_GRID_CACHE); thoi gian trong lab mock (Proxy
   ghi log tung lenh chiem phan lon) 2,68/2,67->2,49/2,53 ms (nong @800),
   2,23/2,26->2,12/2,25 ms (nong @1000) - nhieu lon, so phep tinh giam
   moi la chi so chac chan. Khong cham solver/WASM/FIR/QA. Y tuong luot
   ke: huong A - ra soat aeSolveSingle tren duong 20 band voi phuong phap
   do hoi tu (y tuong luot 15:02); hoac huong C - ra soat loudFitError
   tren luoi phon. --- */
var _drawGridF=null, _drawGridX=null, _drawGridW=-1;
/* --- Mở rộng 2026-11-09 (vòng tự động 18:10, hướng D): thử 2 ứng viên tốc độ drawGraph, CẢ HAI BỊ BÁC (không áp vá code) —
   C1: curve() chỉ cấp phát mảng pts khi fill truthy (5/6 đường cong gọi fill=null nên bỏ 881 cặp [x,y]/đường);
   C2: hoist Math.log10(fMax/fMin) trong X(f) thành _logSpan (cùng 1 double nên tọa độ giống từng bit).
   Lab Node trên hàm thật (lượt 18:10, mock canvas Proxy ghi log, 4 kịch bản: nóng FFT-on AE-đủ notch+dyn / lạnh FFT-on / nóng FFT-off hover=1k / nóng resize 1000):
   log lệnh canvas GIỐNG HỆT ở cả 4 kịch bản cho cả C1, C2, cả hai (md5 d444a945…:6749 lệnh, 54354395…:6461, 1abb7633…:6749);
   số Math.log10 giảm thật: nóng 54→28, lạnh 2979→1931 (−35%), Math.pow không đổi (đã hoist từ vòng 13:18).
   NHƯNG thời gian không cải thiện ổn định: lần 1 (median 31 lần xen kẽ) C1 0,95–0,99×, C2 0,89–0,98×, cả hai 0,84–0,98× (chậm hơn ở cả 4 kịch bản);
   lần 2 chỉ kịch bản nóng FFT-on cho 1,68–1,86× do gốc vọt ngoại lệ 4,93 ms (so với 2,35 ms lần 1), 3 kịch bản còn lại 0,84–1,02×.
   Kết luận: tiết kiệm cấp phát/log10 bị nuốt bởi nhánh if(pts) mỗi điểm + chi phí mock/Proxy chiếm ưu thế; hiệu quả thực trong trình duyệt không chứng minh được nên KHÔNG ÁP.
   Lượt sau không lặp lại 2 ứng viên này trên drawGraph. Ý tưởng lượt kế: hướng A — rà soát aeSolveSingle trên tai nghe thực tế trong DB;
   hoặc hướng C — đo loudGainsFor trên lưới phon rộng hơn với trần vòng mới (vòng 17:54). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 19:35, hướng D): đo lại tốc độ dựng đồ
   thị (drawGraph) sau khi biquadMagDb nhanh hơn (vòng 18:22, ý tưởng treo từ
   19:20) — KHÔNG ÁP VÁ, không có vá mới.
   Lab Node trên hàm thật (lượt 19:35, A/B biquadMagDb CŨ có sqrt vs MỚI không
   sqrt trong cùng 1 process, drawGraph + gridTotalDb + psycho thật trích từ
   file, psycho loud/notch bật, WASM tắt để cô lập đúng thay đổi 18:22; canvas
   mock Proxy ghi log như lab 18:10; 2 lần chạy độc lập, median 31 lần xen kẽ):
   đúng — log lệnh canvas giống trong dung sai 1e-9 ở cả 4 kịch bản (maxDiff
   1,14e-13, 6749 lệnh lạnh/nóng, 6461 lệnh hover; nDiff > 1e-9 = 0); số lần gọi
   biquadMagDb giống hệt hai bản (lạnh 13.215, nóng 881, hover 895).
   Tốc độ: gridTotalDb(880) lạnh 1,054× (lần 2: 1,041×) — khớp 1,06–1,07× vòng
   18:22, lợi ích 18:22 được xác nhận đúng chỗ nó sống; nhưng drawGraph đầu–
   cuối KHÔNG đo được thay đổi: lạnh 0,937× (lần 2: 0,962×), nóng 0,98–1,02×.
   Chênh lạnh là nhiễu, không phải hồi quy: chính bản cũ drift +0,45 ms giữa
   2 lần chạy (4,591→5,044 ms), lớn hơn chênh cũ→mới (+0,20–0,31 ms), và phần
   duy nhất khác nhau (grid lạnh) thì bản mới nhanh hơn ở cả 2 lần; phần còn
   lại của lần vẽ lạnh (AE cache, lưới FFT, lệnh canvas mock) là code giống hệt.
   Đường nóng chỉ còn 881 lần gọi biquadMagDb (đường cong band đang chọn qua
   bandDbAt) ≈ 0,07 ms/lần vẽ — ứng viên cache đường cong band chọn dùng lại
   mảng GRID_TOT chỉ tiết kiệm ngần ấy, trong nhiễu đo, lại thêm ràng buộc
   cache nên KHÔNG làm. Không chạm solver/WASM/FIR/QA.
   Ý tưởng lượt kế: hướng A — rà soát aeSolveSingle trên tai nghe thực tế trong
   DB (ý tưởng treo lâu nhất, từ 14:22); hoặc hướng C — rà soát isoPhonFromSpl
   trên lưới phon. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:57, hướng D): tra đáp tuyến bằng
   chỉ số lưới thay Map.get trong drawGraph — ÁP DỤNG, có cải thiện.
   curve() truyền chỉ số lưới k vào fn(f, k); totalOnGrid(f, k) trả
   totalArr[k] khi k hợp lệ (totalMap dựng từ đúng _gridF/totalArr nên
   giống từng bit), các closure AE (raw/target/eq) dùng _gc.raw/tgt/sm[k];
   đường Map.get giữ làm dự phòng khi k không phải chỉ số hợp lệ.
   Lab Node trên hàm thật (lượt 20:57, 3 lần chạy độc lập, 4 kịch bản như
   lab 18:10, median 31 lần xen kẽ xoay thứ tự, canvas mock no-op +
   Proxy ghi log; lần 3 định bỏ wrapper đếm nhưng regex thay prelude
   không khớp nên vẫn đếm — kết quả vẫn khớp 2 lần trước): log lệnh canvas
   GIỐNG HỆT ở cả 4 kịch bản cả 3 lần (md5 652d3a91… S1/S2/S4 4223 lệnh,
   52889975… S3 3935 lệnh); Map.get/lần vẽ nóng 3526 -> 2. Tốc độ lab
   chính: nóng 1,62–1,79× (S1 22,13->12,48 ms, S3 22,09->12,37, S4
   21,59->12,98), lạnh 1,11–1,14× (97,80->88,11 ms) — NHƯNG tỉ lệ này
   PHỒNG do tạo tác đo: wrapper đếm Map.prototype.get đọc global
   __countMaps/__mapGets của vm context mỗi lần gọi; chẩn đoán riêng cho
   thấy truy cập global trong vm context chậm hơn biến cục bộ ~500× (cùng
   vòng lặp 200k lần: cục bộ 0,97 ms, global 508,51 ms), và microbench
   KHÔNG đo đếm (main context) cho Map.get ~93 ns so với chỉ số mảng
   ~19 ns — mức tiết kiệm đáng tin là ~0,26 ms/lần vẽ nóng (3526 lần
   tra), không phải 1,7×. Vẫn áp vì chiều cải thiện được microbench không
   đo đếm xác nhận, đầu ra giống từng bit, rủi ro thấp (đường dự phòng giữ
   nguyên). V2 (bỏ mảng specPts ở lớp phổ FFT, vẽ trực tiếp 2 lượt) BỊ
   BÁC: 0,96–1,05×, không lợi ích (S4 lần 1 0,67× là ngoại lệ nhiễu, lần 2
   0,98×). Bài học cho lab sau: đừng vá Map.prototype.get trong vm context
   khi đo thời gian — đếm tra cứu ở lượt chạy riêng không đo thời gian.
   Không chạm solver/WASM/FIR/QA — chỉ đổi cách tra đáp tuyến trong
   drawGraph; aeV1/aeV2/aeV3 không đổi theo cấu trúc. Ý tưởng lượt kế:
   hướng C — rà soát loudFitError trên lưới phon rộng (10–100 phon, ý
   tưởng từ 19:20); hoặc hướng D — đo measureFps trên phổ thật. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 21:46, hướng D): đường band đang chọn
   dùng lại mảng đáp tuyến từng band của gridTotalDb — ÁP DỤNG, có cải thiện.
   Profile lượt này (lab Node, 2 lần): pha curveBand 6,27–6,84 ms = 48–49%
   tổng vẽ nóng 13,1–14,1 ms; microbench 881 lần biquadMagDb = 8,14 ms —
   tiền đề vòng 19:35 ("881 lần gọi ≈ 0,07 ms", bác ý tưởng cache đường band
   chọn) không tái hiện được nên thử lại. P1 (cache riêng từ bandDbAt) vẽ nóng
   1,58× nhưng kéo band chậm 0,82× (tính trùng 881 điểm gridTotalDb vừa tính)
   nên BÁC P1; P2 dùng lại đúng mảng GRID_TOT[GRAPH_N].arrs[selBand] (đã gọi
   gridTotalDb ngay trước đó, khóa theo tham số band) nên không tính trùng.
   Lab Node trên hàm thật (lượt 21:46, 2 lần chạy độc lập, median 31 lần xen kẽ,
   5 kịch bản): log lệnh canvas GIỐNG HỆT ở cả 5 kịch bản cả 2 lần (S1
   652d3a91…, S3 52889975…, S5 91141a49…); vẽ nóng S1 12,25→7,70 ms (1,59×) /
   12,90→7,85 ms (1,64×), S3 1,64–1,67×, S4 1,55–1,67×, lạnh S2 1,06–1,20×,
   kéo band S5 1,20× / 1,04× (không hồi quy). Đường JS cho đúng từng bit như
   bandDbAt; khi WASM SIMD bật, mảng dùng f32 (lệch ≤ 0,05 dB theo ngưỡng
   wasmV1, thường 0,0025 dB ~ 0,02 px) — trong dung sai hiển thị đã chấp nhận
   cho các đường tổng; solver/WASM/FIR/QA không chạm, aeV1/aeV2/aeV3 không đổi
   theo cấu trúc. Giới hạn: lab dùng canvas mock no-op nên số tuyệt đối trong
   trình duyệt thật sẽ khác; đường cong filter (LYR.filter) không nằm trong
   fixture lab (như lab 20:57). Ý tưởng lượt kế: hướng C — rà soát loudFitError
   trên lưới phon rộng (10–100 phon, ý tưởng từ 19:20); hoặc hướng D — đo
   measureFps trên phổ thật. --- */
function drawGraph(){
  var dpr = window.devicePixelRatio||1;
  var gs = cvSize(graph), W = gs.w, H = gs.h;
  if (graph.width !== W*dpr){ graph.width=W*dpr; graph.height=H*dpr; }
  gtx.setTransform(dpr,0,0,dpr,0,0);
  gtx.clearRect(0,0,W,H);
  var padL=44, padR=12, padT=12, padB=24;
  var gw=W-padL-padR, gh=H-padT-padB;
  var fMin=20, fMax=20000, dbMax=16, dbMin=-16;
  function X(f){ return padL + gw*(Math.log10(f/fMin)/Math.log10(fMax/fMin)); }
  function Y(db){ return padT + gh*((dbMax-db)/(dbMax-dbMin)); }
  /* Lưới tần log + tọa độ X tính MỘT lần mỗi lần vẽ (vòng tự động 13:18, hướng D):
     curve() trước đây tính lại fMin*Math.pow(...) và X(f) (2x Math.log10) cho
     mỗi điểm của mỗi đường cong; totalOnGrid và AE_GRID_CACHE cũng tính lại
     lưới riêng. Nay tính 1 lần vào _gridF/_gridX rồi dùng lại — cùng biểu
     thức, cùng số double nên tọa độ vẽ giống hệt từng bit. Lab Node trên hàm
     thật (lượt 13:18, chạy 2 lần): log lệnh canvas giống hệt (md5
     0bcac6baa52e15c46c250670d3ec54bf, 6357 lệnh) ở cả trạng thái cache AE nóng
     và lạnh; Math.pow 6167→881/cuộc vẽ (nóng), 7048→881 (lạnh); Math.log10
     10592→1782 (nóng), 11473→2663 (lạnh); thời gian 8,54→6,69 ms (nóng),
     8,55→6,76 ms (lạnh) — lần 2: 8,57→6,81 ms và 8,66→7,50 ms. Không chạm
     solver/QA. Ý tưởng lượt kế: hướng A — rà soát aeSolveSingle trên mẫu
     tai nghe thực tế; hoặc hướng C — rà soát isoPhonFromSpl trên lưới phon. */
  if (!_drawGridF){ _drawGridF=[]; for (var _qk=0; _qk<=GRAPH_N; _qk++) _drawGridF.push(fMin*Math.pow(fMax/fMin, _qk/GRAPH_N)); }
  if (_drawGridW!==W || !_drawGridX){ _drawGridX=[]; for (var _qk=0; _qk<=GRAPH_N; _qk++) _drawGridX.push(X(_drawGridF[_qk])); _drawGridW=W; }
  var _gridF=_drawGridF, _gridX=_drawGridX;
  /* grid tần số */
  var ticks=[20,50,100,200,500,1000,2000,5000,10000,20000];
  gtx.font="10.5px 'IBM Plex Mono', monospace"; gtx.textAlign="center";
  ticks.forEach(function(f){
    var x=X(f);
    gtx.strokeStyle = (f===1000)?"#2e3745":"#1b212a";
    gtx.beginPath(); gtx.moveTo(x,padT); gtx.lineTo(x,padT+gh); gtx.stroke();
    gtx.fillStyle="#5f6a78"; gtx.fillText(f>=1000?(f/1000)+"k":String(f), x, H-8);
  });
  /* grid dB */
  gtx.textAlign="right";
  for (var db=-12; db<=12; db+=3){
    var y=Y(db);
    gtx.strokeStyle = db===0 ? "#39434f" : "#1b212a";
    gtx.beginPath(); gtx.moveTo(padL,y); gtx.lineTo(padL+gw,y); gtx.stroke();
    gtx.fillStyle="#5f6a78"; gtx.fillText((db>0?"+":"")+db, padL-6, y+3.5);
  }
  gtx.fillStyle="#5f6a78"; gtx.textAlign="left"; gtx.fillText("dB", 6, padT+4);
  var pre = appliedPreDb() + (typeof abxTrimDb==="function" ? abxTrimDb() : 0);
  /* Đáp tuyến tổng trên đúng lưới GRAPH_N đoạn mà curve() dùng: tính MỘT lần rồi
     dùng lại cho cả 3 lớp cần tới nó (kết quả sau EQ của AutoEQ, EQ + pre-amp,
     EQ thuần) thay vì đánh giá lại toàn bộ cascade tại từng điểm cho từng lớp. */
  var totalArr = gridTotalDb(GRAPH_N, displayFs), totalMap = null;
  function totalOnGrid(f, k){
    if (typeof k==="number" && k>=0 && k<=GRAPH_N) return totalArr[k];
    if (!totalMap){
      totalMap = new Map();
      for (var tk=0; tk<=GRAPH_N; tk++){ totalMap.set(_gridF[tk], totalArr[tk]); }
    }
    var v = totalMap.get(f);
    return v === undefined ? totalDbAt(f, displayFs) : v;
  }
/* --- Mở rộng 2026-11-09 (vòng tự động 22:12, hướng D): curve() chỉ cấp phát
   mảng pts khi fill — ÁP DỤNG, có cải thiện nhỏ. pts (881 cặp [x,y]) chỉ dùng
   lại trong nhánh fill (vẽ lại path sau khi tô); chỉ 1 đường dùng fill (tổng
   #3fd2dc), 5 đường còn lại (band chọn, raw, target, eq, tổng+pre) cấp phát
   ~4405 mảng nhỏ vô ích mỗi lần vẽ. P3: pts=fill?[]:null, push có điều kiện;
   nhánh fill không đổi. Lab Node trên hàm thật (lượt 22:12, 3 lần chạy độc lập,
   median 31 lần xen kẽ, 5 kịch bản như 21:46): log lệnh canvas GIỐNG HỆT ở cả
   5 kịch bản cả 3 lần (S1 652d3a91…, S3 52889975…, S5 91141a49… — đúng md5 của
   21:46); tốc độ lần 2: S1 1,232×, S2 1,112×, S3 1,037×, S4 1,034×, S5 1,073×;
   lần 3: 1,076×/1,028×/1,099×/1,082×/1,196×; lần 1: 1,048×/0,923×/0,967×/
   0,989×/1,007× (3 kịch bản hơi chậm — trong nhiễu đo median của VM, base S1
   dao động 8,42–10,09 ms giữa các lần; hiệu quả ~3–8% nằm gần sàn nhiễu, nhưng
   giảm cấp phát là xác định: 4405 mảng/lần vẽ, và 13/15 phép đo median ≥ 1,0×).
   Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi theo cấu trúc.
   Giới hạn: như 21:46 — lab dùng canvas mock no-op nên số tuyệt đối trong
   trình duyệt thật sẽ khác; lợi ích thực nhỏ hơn vì lệnh canvas chiếm phần lớn
   chi phí khung. Ý tưởng lượt kế: hướng B — đo lại profile buildFirTaps (pha
   FFT 25–39%) sau khi P4a/twiddle đều bị bác; hoặc hướng C — rà soát
   isoPhonFromSpl trên lưới phon. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 22:37, hướng D): inline Y() + clamp
   vào vòng curve() của drawGraph — ÁP DỤNG, có cải thiện lớn trên lab.
   Trước đây mỗi điểm (881 điểm × 6 đường = 5286 lần/lần vẽ) tính
   y=Y(Math.max(dbMin,Math.min(dbMax,fn(f,k)))): 1 lần gọi closure Y + 2 lần
   Math.max/min. Nay clamp bằng if/else rồi inline đúng thân Y
   (padT + gh*((dbMax-v)/(dbMax-dbMin))) — cùng biểu thức, cùng thứ tự phép
   tính nên y giống từng bit; clamp if/else == Math.max/min với mọi double
   kể cả NaN (so sánh với NaN đều false nên giữ NaN), +-0, +-Inf (đã kiểm
   riêng: 0 lệch trên 19 giá trị biên + 200.000 giá trị ngẫu nhiên).
   Lab Node trên hàm thật (lượt 22:37, 3 lần chạy độc lập, median 31 lần xen
   kẽ xoay thứ tự, 5 kịch bản như 21:46/22:12): log lệnh canvas GIỐNG HỆT ở
   cả 5 kịch bản cả 3 lần (S1/S2/S4 md5 652d3a91… 4223 lệnh, S3 52889975…
   3935 lệnh, S5 91141a49… 4223 lệnh — đúng md5 của 21:46/22:12); tốc độ
   nóng S1 3,21→1,60 ms (1,94–2,01×), S3 3,05→1,42 ms (2,02–2,09×),
   S4 3,28→1,63 ms (1,94–1,95×), S5 kéo band 6,33→4,54 ms (1,34–1,35×),
   lạnh S2 22,13→19,98 ms (1,08–1,09× — loãng vì gridTotalDb tính lại
   ~20 ms chiếm phần lớn). Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3
   không đổi theo cấu trúc (chỉ đổi cách tính tọa độ y khi vẽ).
   Giới hạn: như các vòng D trước — lab dùng canvas mock no-op nên trong
   trình duyệt thật, nơi lệnh canvas chiếm phần lớn chi phí khung, lợi ích
   thực sẽ nhỏ hơn con số lab (phần vẽ JS vẫn giảm đúng ngần ấy).
   Ý tưởng lượt kế: hướng D — bỏ clamp thừa Math.max(0,Math.min(1,sv))
   trong vòng phổ FFT của drawGraph (sv=(specData[]||0)/255 với specData là
   Uint8Array nên luôn trong [0,1]); hoặc hướng C — rà soát isoPhonFromSpl
   trên lưới phon (ý tưởng treo từ 13:08/20:19). --- */
  function curve(fn, color, width, dash, fill){
    gtx.beginPath();
    var N=GRAPH_N, pts=null;
    if (fill){ if (!curve._pts || curve._pts.length < 2*(N+1)) curve._pts = new Float64Array(2*(N+1)); pts = curve._pts; }
    for (var k=0;k<=N;k++){
      var f=_gridF[k];
      var _v=fn(f, k);
      if (_v<dbMin) _v=dbMin; else if (_v>dbMax) _v=dbMax;
      var x=_gridX[k], y=padT + gh*((dbMax-_v)/(dbMax-dbMin));
      if (pts){ pts[2*k]=x; pts[2*k+1]=y; }
      if (k===0) gtx.moveTo(x,y); else gtx.lineTo(x,y);
    }
    if (fill){
      gtx.save(); gtx.lineTo(padL+gw, Y(0)); gtx.lineTo(padL, Y(0)); gtx.closePath();
      gtx.fillStyle=fill; gtx.fill(); gtx.restore();
      gtx.beginPath(); for (var _pi=0; _pi<=N; _pi++){ if (_pi) gtx.lineTo(pts[2*_pi],pts[2*_pi+1]); else gtx.moveTo(pts[2*_pi],pts[2*_pi+1]); }
    }
    gtx.setLineDash(dash||[]);
    gtx.strokeStyle=color; gtx.lineWidth=width; gtx.stroke();
    gtx.setLineDash([]);
  }
  /* ===== Lớp phổ FFT thời gian thực (Giai đoạn 4) — vẽ dưới các đường cong ===== */
  if (typeof LYR!=="undefined" && LYR.fft){
    gtx.save();
    gtx.beginPath(); gtx.rect(padL, padT, gw, gh); gtx.clip();
    var hasSpec = !!(analyser && engineReady && typeof specData!=="undefined" && specData);
    if (hasSpec){
      /* Lưới phổ FFT tính MỘT lần (vòng tự động 14:34, hướng D): sf, X(sf) và bin
         chỉ phụ thuộc (W, displayFs, analyser.fftSize) — W đổi khi resize, fs/
         fftSize đổi khi đổi engine — nên cache theo đúng 3 khóa đó; specData
         đổi theo khung nên sv vẫn tính lại mỗi lần vẽ. Cùng biểu thức, cùng số
         double nên tọa độ vẽ giống hệt từng bit. Lab Node trên hàm thật (lượt
         14:34, chạy 2 lần, lớp FFT bật): log lệnh canvas giống hệt ở cả 3 kịch
         bản (nóng 800/2048, resize 1000, fftSize 4096), 6654 lệnh; Math.pow
         1022→881/cuộc vẽ, Math.log10 2064→1782 (−14%); thời gian trong lab
         mock (Proxy ghi log từng lệnh) dao động 2,36–3,08 ms so với 2,43–
         2,93 ms bản cũ — nhiễu lớn, số phép tính giảm mới là chỉ số chắc
         chắn. Không chạm solver/QA. Ý tưởng
         lượt kế: hướng C — bảng tra log cho ISO_FREQS trong isoSpl/
         isoPhonFromSpl; hoặc hướng A — rà soát aeSolveSingle trên mẫu tai nghe
         thực tế. */
      if (!_fftSpecGrid || _fftSpecGrid.W!==W || _fftSpecGrid.fs!==displayFs || _fftSpecGrid.n!==analyser.fftSize){
        var _fg=[];
        for (var _fk=0;_fk<=140;_fk++){
          var _fsf=fMin*Math.pow(fMax/fMin, _fk/140);
          _fg.push([_fsf, X(_fsf), Math.floor(_fsf/displayFs*analyser.fftSize)]);
        }
        _fftSpecGrid={W:W, fs:displayFs, n:analyser.fftSize, pts:_fg};
      }
/* --- Mở rộng 2026-11-09 (vòng tự động 23:49, hướng D): đo drawGraph FFT-on
   trên PHỔ THẬT + THỬ inline Y / bỏ mảng specPts trong vòng phổ — BỊ BÁC, không
   áp vá code. Phổ thật mkReal (pink falloff + kick ~55 Hz / bass ~160 Hz /
   vocal ~2,5 kHz / air ~12 kHz + ripple, Uint8Array 1024 bin như
   getByteFrequencyData) thay pattern tổng hợp (%200) của các vòng trước — phần
   còn lại của ý tưởng đo measureFps từ 20:30/20:57; drawGraph ms/khung chính là
   avgDraw mà measureFps báo (p4V2). Lab Node trên hàm thật trích verbatim
   (lượt 23:49, 3 lần chạy độc lập, 5 kịch bản như 21:46/22:12/22:37, median 31
   lần xen kẽ xoay thứ tự): log lệnh canvas GIỐNG HỆT ở cả 5 kịch bản cả 3 lần
   (S1/S2/S4 md5 2f82f354…, S3 52889975…, S5 a70dee9e… — S1/S2/S4/S5 4223 lệnh,
   S3 3935 lệnh). Base trên phổ thật: S1 nóng FFT-on 1,58–1,61 ms/khung, S2 lạnh
   20,2–20,7 ms (loãng vì gridTotalDb tính lại ~20 ms), S4 resize 1,63–1,73 ms,
   S5 kéo band ~4,4–4,5 ms (cache miss) — khung nóng nằm sâu trong ngân sách
   16,7 ms của measureFps.
   V1 inline Y: _sv=-26+sv*34 rồi padT+gh*((dbMax-_sv)/(dbMax-dbMin)) — đúng thân
   Y, cùng thứ tự phép tính nên y giống từng bit; tốc độ 0,981–1,013× qua 3 lần
   (S1 0,992/1,000/1,007; S4 0,982/1,011/1,010) — trong nhiễu, không cải thiện.
   V2 (V1 + bỏ mảng specPts 141 cặp [x,y] + 2 forEach, vẽ trực tiếp moveTo/
   lineTo 2 vòng): 0,914–1,000×, CHẬM HƠN ổn định ở FFT-on nóng S1 0,927/0,948/
   0,941 và S4 0,924/0,956/0,914 — tính lại vòng phổ lần 2 (tra specData + nhân
   chia) đắt hơn cấp phát mảng + forEach mà V8 đã tối ưu tốt.
   Chẩn đoán: vòng phổ chỉ 141 điểm, chiếm phần nhỏ của khung; khung bị chi phối
   bởi gridTotalDb + 6 đường curve (881 điểm/đường) — cùng kết luận như vòng
   specDraw 23:18. Lượt sau KHÔNG thử lại inline Y hay bỏ mảng specPts trong vòng
   phổ FFT này. Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi.
   Nhánh D: 2 lượt không vá liên tiếp (23:18, 23:49) — nếu lượt D kế cũng không
   vá thì tạm dừng nhánh D theo luật 3 lượt.
   Ý tưởng lượt kế: hướng B — đo lại buildFirTaps sau vá truy hồi lượng giác
   (ý tưởng treo từ 23:06); hoặc hướng C — rà soát loudFitError trên lưới phon
   rộng (10–100 phon, ý tưởng từ 19:20). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 22:47, hướng D): bỏ clamp thừa
   Math.max(0,Math.min(1,sv)) trong vòng phổ FFT của drawGraph — ÁP DỤNG, có
   cải thiện nhỏ nhưng ổn định trên lab. sv=(specData[]||0)/255; specData CHỈ
   được tạo ở dạng Uint8Array (getByteFrequencyData) và không nơi nào gán lại
   nên sv luôn trong [0,1] — Math.max(0,Math.min(1,sv)) là đồng nhất thức, bỏ
   đi cho y giống từng bit (Y(-26+sv*34) cùng biểu thức, cùng thứ tự phép tính).
   Lab Node trên hàm thật (lượt 22:47, 3 lần chạy độc lập): micro-benchmark
   vòng phổ tách riêng (thân vòng lấy verbatim từ file, 2000 rep xen kẽ, 3 kiểu
   specData pattern/0/255): y GIỐNG HỆT (md5 bằng nhau cả 3 kiểu), tốc độ
   1,107×/1,110×/1,104×, tiết kiệm ~67–72 µs/vòng 141 điểm; lab drawGraph đầy
   đủ (median 31 lần xen kẽ, 5 kịch bản như 21:46/22:12/22:37): log lệnh canvas
   GIỐNG HỆT ở cả 5 kịch bản cả 3 lần (S1/S2/S4 md5 652d3a91… 4223 lệnh, S3
   52889975… 3935 lệnh, S5 91141a49… 4223 lệnh — đúng md5 các vòng trước);
   tốc độ S1 nóng FFT-on 1,099×/1,050×/1,049×, S4 resize 1,062×/1,037×/
   1,068×, S5 kéo band 1,037×/1,011×/1,028×; S2 lạnh ~1,0× (loãng vì
   gridTotalDb tính lại ~20 ms) và S3 FFT-off 1,018×/0,998×/0,988× (vòng phổ
   không chạy ở S3 nên dao động quanh 1,0× là đúng kỳ vọng — không hồi quy).
   Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi theo cấu trúc (chỉ
   đổi cách tính tọa độ y của lớp phổ khi vẽ).
   Giới hạn: như các vòng D trước — lab dùng canvas mock no-op nên trong
   trình duyệt thật lợi ích thực nhỏ hơn con số lab (phần vẽ JS vẫn giảm đúng
   ngần ấy, ~70 µs/khung ở FFT-on).
   Ý tưởng lượt kế: hướng C — rà soát isoPhonFromSpl trên lưới phon (ý tưởng
   treo từ 13:08/20:19; nhánh C đang có 2 lượt không vá liên tiếp 19:31/20:19
   nên nếu lượt C kế cũng không vá thì nhánh C tạm dừng theo luật 3 lượt);
   hoặc hướng D — đo measureFps/specDraw trên phổ thật. --- */
      if (!drawGraph._specPts || drawGraph._specPts.length < 282) drawGraph._specPts = new Float64Array(282);
      var specPts = drawGraph._specPts;
      for (var sk=0; sk<=140; sk++){
        var _gp=_fftSpecGrid.pts[sk];
        var sv=(specData[Math.min(_gp[2],specData.length-1)]||0)/255;
        specPts[2*sk]=_gp[1]; specPts[2*sk+1]=Y(-26 + sv*34);
      }
      gtx.beginPath(); for (var _spi=0; _spi<=140; _spi++){ if (_spi) gtx.lineTo(specPts[2*_spi], specPts[2*_spi+1]); else gtx.moveTo(specPts[2*_spi], specPts[2*_spi+1]); }
      gtx.lineTo(padL+gw,padT+gh); gtx.lineTo(padL,padT+gh); gtx.closePath();
      gtx.fillStyle="rgba(240,228,66,0.10)"; gtx.fill();
      gtx.beginPath(); for (var _spi2=0; _spi2<=140; _spi2++){ if (_spi2) gtx.lineTo(specPts[2*_spi2], specPts[2*_spi2+1]); else gtx.moveTo(specPts[2*_spi2], specPts[2*_spi2+1]); }
      gtx.strokeStyle="rgba(240,228,66,0.55)"; gtx.lineWidth=1.2; gtx.stroke();
    } else {
      gtx.strokeStyle="rgba(240,228,66,0.35)"; gtx.setLineDash([3,5]);
      gtx.beginPath(); gtx.moveTo(padL, Y(-26)); gtx.lineTo(padL+gw, Y(-26)); gtx.stroke(); gtx.setLineDash([]);
      gtx.fillStyle="rgba(240,228,66,0.6)"; gtx.font="10.5px 'IBM Plex Mono', monospace"; gtx.textAlign="left";
      gtx.fillText("Phổ FFT: chưa có tín hiệu — khởi tạo engine & phát nhạc để xem phổ trực tiếp", padL+8, Y(-26)-6);
    }
    gtx.restore();
  }
  var dim = bypass ? 0.25 : 1;
  /* band đang chọn (nét đứt) */
  gtx.globalAlpha = 0.8*dim;
  /* Đường band đang chọn dùng lại mảng đáp tuyến từng band của gridTotalDb
     (vòng tự động 21:46, hướng D): drawGraph đã gọi gridTotalDb(GRAPH_N, fs)
     ngay trước đó nên GRID_TOT[GRAPH_N].arrs[selBand] luôn khớp band hiện tại
     (khóa theo đúng tham số band; đổi band/fs/tham số -> gridTotalDb tính lại).
     Đường JS cho đúng từng bit như bandDbAt; khi WASM SIMD bật, mảng dùng f32
     (lệch <= 0,05 dB theo ngưỡng wasmV1, thường 0,0025 dB) — trong dung sai
     hiển thị đã chấp nhận cho các đường tổng. Thiếu mảng -> bandDbAt như cũ. */
  var _bArr = (selBand >= 0 && selBand < bands.length && typeof GRID_TOT !== "undefined" && GRID_TOT[GRAPH_N] && GRID_TOT[GRAPH_N].arrs) ? GRID_TOT[GRAPH_N].arrs[selBand] : null;
  curve(function(f, k){ var ix = (typeof k === "number" && k >= 0 && k <= GRAPH_N) ? k : -1; return (ix >= 0 && _bArr) ? _bArr[ix] : bandDbAt(selBand, f, displayFs); }, "#8b95a3", 1.2, [5,4], null);
  /* ===== Lớp AutoEQ (Giai đoạn 2): Đáp tuyến tai nghe / Target / Tai nghe sau EQ — chuẩn hoá 0 dB @ 1 kHz ===== */
  if (typeof AE!=="undefined" && AE && AE.rawFn){
    gtx.globalAlpha = 1;
    /* Chặng 5.5: cache giá trị AE.rawFn/smFn/tgtFn trên đúng lưới 881 điểm của
       curve() (fMin..fMax, N=GRAPH_N); khóa bằng đồng nhất hàm — đổi tai nghe hay
       target tạo closure mới nên cache tự dựng lại. curve() luôn truyền chỉ số lưới k nên 3 closure đọc trực tiếp _gc.raw[k]/tgt[k]/sm[k] (vòng tự động 07:24, hướng D): nhánh tra Map/fallback cũ không bao giờ kích hoạt từ curve() nên đã bỏ cùng _gMap — cùng giá trị từng bit với bản cũ cho mọi k=0..880. */
/* --- Mở rộng 2026-11-23 (vòng tự động 11:20, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 11:15, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 11:15:48+07, 6.097.727 byte / 24.997 dòng, md5 e18a77785ab9e0919ad5c250dd052f43, version 116) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-insert lưu tại ~/workspace/autoeq/backups/*2026-11-23_1119*. Ứng viên D duy nhất: dựng AE_GRID_CACHE bằng mảng tiền cấp phát new Array(GRAPH_N+1) + ghi theo chỉ số thay vì push — cùng thứ tự ghi 0..880 nên raw/sm/tgt giống từng bit (mảng thường giữ nguyên mọi giá trị kể cả undefined/NaN/-0/±Inf như push); 3 closure đọc _gc.raw[k]/tgt[k]/sm[k] không đổi. Lab Node trên khối trích verbatim (harness.js + verify_patched.js trong hidden_files/run_20261123_1119/, 2 lần chạy độc lập): parity 2.643 kiểm tra GIỐNG TỪNG BIT cả 2 lần (Object.is, 0 lệch; gồm biên undefined/NaN/-0/±Inf và kiểm chứng lại trên file ĐÃ VÁ 2.643/2.643); tốc độ dựng cache paired-median xen kẽ 15 vòng × 2000 rep: lần 1 1,5460× (thắng 15/15), lần 2 1,5490× (thắng 15/15) — ~170 µs → ~94 µs mỗi lần dựng với fn nội suy mẫu; lợi ích thực trên đường cache-miss (đổi tai nghe/target) nhỏ hơn vì fn thật đắt hơn fn mẫu. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, thẻ HTML như backup pre-insert, diff đúng 1 hunk (2 dòng code), H1-H17 còn nguyên. Lượt kế: nhóm A. --- */
    if (!AE_GRID_CACHE || AE_GRID_CACHE.rawFn !== AE.rawFn || AE_GRID_CACHE.smFn !== AE.smFn || AE_GRID_CACHE.tgtFn !== AE.tgtFn){
      var _gRaw = new Array(GRAPH_N+1), _gSm = new Array(GRAPH_N+1), _gTgt = new Array(GRAPH_N+1);
      for (var _gk = 0; _gk <= GRAPH_N; _gk++){
        var _gf = _gridF[_gk];
        _gRaw[_gk] = AE.rawFn(_gf); _gSm[_gk] = AE.smFn ? AE.smFn(_gf) : 0; _gTgt[_gk] = AE.tgtFn ? AE.tgtFn(_gf) : 0;
      }
      AE_GRID_CACHE = { rawFn: AE.rawFn, smFn: AE.smFn, tgtFn: AE.tgtFn, raw: _gRaw, sm: _gSm, tgt: _gTgt };
    }
    var _gc = AE_GRID_CACHE;
    if (AE.show.raw) curve(function(f, k){ return _gc.raw[k]; }, "#d7dee8", 1.3, [2,3], null);
    if (AE.show.target && AE.tgtFn) curve(function(f, k){ return _gc.tgt[k]; }, "#3ddc84", 1.8, [7,4], null);
    if (AE.show.eq && AE.tgtFn) curve(function(f, k){ return _gc.sm[k] + (bypass ? 0 : totalArr[k]); }, "#ff8c42", 2.0, null, null);
  }
  /* Lớp đường lọc EQ (Giai đoạn 4: bật/tắt riêng) — EQ tổng + EQ kèm pre-amp/trim */
  if (typeof LYR==="undefined" || LYR.filter){
    gtx.globalAlpha = 0.75*dim;
    curve(function(f, k){ return totalArr[k]+pre; }, "#ffb224", 1.3, null, null);
    gtx.globalAlpha = dim;
    curve(function(f, k){ return totalArr[k]; }, "#3fd2dc", 2.4, null, "rgba(63,210,220,0.10)");
  }
  gtx.globalAlpha = 1;
  /* marker đỉnh dương */
  if (maxPosDb>0.05 && !bypass){
    var mx=X(Math.max(fMin,Math.min(fMax,maxPosFreq))), my=Y(maxPosDb);
    gtx.fillStyle="#ffb224"; gtx.beginPath(); gtx.arc(mx,my,3.5,0,7); gtx.fill();
  }
  /* hover */
  if (hoverF){
    var hx=X(hoverF);
    gtx.strokeStyle="#4a5566"; gtx.beginPath(); gtx.moveTo(hx,padT); gtx.lineTo(hx,padT+gh); gtx.stroke();
    var hv=totalDbAt(hoverF, displayFs);
    gtx.fillStyle="#3fd2dc"; gtx.beginPath(); gtx.arc(hx,Y(hv),4,0,7); gtx.fill();
  }
  /* marker notch cá nhân (Giai đoạn 3) */
  if (typeof PSY!=="undefined" && PSY && PSY.notch.on && !PSY.bypassAll){
    var nx=X(Math.max(fMin,Math.min(fMax,PSY.notch.freq)));
    gtx.strokeStyle="rgba(255,93,93,.6)"; gtx.setLineDash([3,4]);
    gtx.beginPath(); gtx.moveTo(nx,padT); gtx.lineTo(nx,padT+gh); gtx.stroke(); gtx.setLineDash([]);
    gtx.fillStyle="#ff5d5d"; gtx.font="10.5px 'IBM Plex Mono', monospace"; gtx.textAlign="center";
    gtx.fillText("notch cá nhân "+Math.round(PSY.notch.freq)+" Hz", nx, padT+11);
  }
  /* ===== Duong bao Dynamic EQ realtime (Lo trinh v2 · Nhom 1): offset tu
     worklet (dynMeter, moi 24 block) ve tai tan so band: doan noi gain tinh
     toi gain tinh + offset, cham tai dau offset; chi khi engine chay, IIR,
     khong bypass. Khi chua co du lieu worklet thi khong ve gi (khong bia). */
  if (typeof dynMeter !== "undefined" && dynMeter && dynMeter.off && typeof PSY !== "undefined" && PSY && !PSY.bypassAll && !bypass){
    for (var di2=0; di2<bands.length; di2++){
      var dd = PSY.dyn[di2];
      if (!dd || !dd.on || !bands[di2].on) continue;
      var off2 = dynMeter.off[di2];
      if (!isFinite(off2)) continue;
      var bf = Math.max(fMin, Math.min(fMax, bands[di2].freq));
      var bx = X(bf), yStatic = Y(Math.max(dbMin, Math.min(dbMax, bands[di2].gain))), yOff = Y(Math.max(dbMin, Math.min(dbMax, bands[di2].gain + off2)));
      gtx.strokeStyle = "rgba(244,114,182,0.9)"; gtx.lineWidth = 1.5;
      gtx.beginPath(); gtx.moveTo(bx, yStatic); gtx.lineTo(bx, yOff); gtx.stroke();
      gtx.fillStyle = "#f472b6"; gtx.beginPath(); gtx.arc(bx, yOff, 3.5, 0, 7); gtx.fill();
      if (di2 === selBand){
        gtx.fillStyle = "#f472b6"; gtx.font = "10.5px 'IBM Plex Mono', monospace"; gtx.textAlign = "center";
        gtx.fillText("dyn " + (off2 >= 0 ? "+" : "") + off2.toFixed(1) + " dB", bx, yOff - 8);
      }
    }
  }
  /* ===== Node EQ kéo-thả (Giai đoạn 4) ===== */
  if (typeof drawEqNodes==="function") drawEqNodes(gtx, X, Y);
  graph._X=X; graph._Y=Y; graph._dims={padL:padL,padT:padT,gw:gw,gh:gh,fMin:fMin,fMax:fMax,dbMin:dbMin,dbMax:dbMax};
}
graph.addEventListener("mousemove", function(e){
  var r=graph.getBoundingClientRect(), d=graph._dims; if(!d) return;
  var x=e.clientX-r.left;
  var t=(x-d.padL)/d.gw;
  if (t<0||t>1){ hoverF=null; $("gtip").style.display="none"; $("hoverRead").textContent=""; drawGraph(); return; }
  var f=d.fMin*Math.pow(d.fMax/d.fMin, t);
  hoverF=f;
  var v=totalDbAt(f, displayFs);
  var tip=$("gtip");
  tip.style.display="block";
  tip.style.left=Math.min(r.width-140, x+14)+"px"; tip.style.top="10px";
  tip.innerHTML='<span class="f">'+fmtFreq(Math.round(f))+'</span> · '+fmtDb(v)+' dB';
  $("hoverRead").textContent = "Con trỏ: "+fmtFreq(Math.round(f))+" → "+fmtDb(v)+" dB";
  drawGraph();
});
graph.addEventListener("mouseleave", function(){ hoverF=null; $("gtip").style.display="none"; $("hoverRead").textContent=""; drawGraph(); });
window.addEventListener("resize", drawGraph);

/* ---------------- Meters + spectrum loop ---------------- */
$("ceilMark").style.left = "calc("+(( (0-(-18))/18 )*0 + 91.7)+"%)"; /* vị trí tương đối của -1 dB trên thang -18..0 */
function dbBar(v){ /* thang hiển thị -60..+3 dB */
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, (v+60)/63*100));
}
var specData = null;
var meterRunning = false;
function startMeterLoop(){
  if (meterRunning) return;
  meterRunning = true;
  requestAnimationFrame(meterLoop);
}
function meterLoop(){
  var po = meter.peakOut>0 ? 20*Math.log10(meter.peakOut) : -Infinity;
  var tp = meter.tp>0 ? 20*Math.log10(meter.tp) : -Infinity;
  /* Tối ưu độ mượt (2026-10-31): cache phần tử DOM và chỉ ghi khi giá trị
     thật sự đổi — trước đây mỗi khung hình ghi lại toàn bộ text/class dù
     trang đang idle, buộc trình duyệt tính lại style liên tục. */
  if (!meterLoop._els) meterLoop._els = { po:$("mPeakOut"), tp:$("mTp"), pb:$("mPeakBar"), tb:$("mTpBar"), b:$("limBadge"), gr:$("kvGr"), last:{} };
  var _me = meterLoop._els, _ml = _me.last;
  var _poT = (isFinite(po)? po.toFixed(1):"−∞")+" dBFS"; if (_ml.poT!==_poT){ _ml.poT=_poT; _me.po.textContent=_poT; }
  var _tpT = (isFinite(tp)? tp.toFixed(1):"−∞")+" dBTP"; if (_ml.tpT!==_tpT){ _ml.tpT=_tpT; _me.tp.textContent=_tpT; }
  var _pbW = dbBar(po)+"%"; if (_ml.pbW!==_pbW){ _ml.pbW=_pbW; _me.pb.style.width=_pbW; }
  var _tbW = dbBar(tp)+"%"; if (_ml.tbW!==_tbW){ _ml.tbW=_tbW; _me.tb.style.width=_tbW; }
  var b=_me.b, _bS = !limiterOn ? 0 : (meter.active ? 1 : 2);
  if (_ml.bS!==_bS){ _ml.bS=_bS;
    if (_bS===0){ b.textContent="ĐÃ TẮT"; b.className="limbadge"; }
    else if (_bS===1){ b.textContent="ĐANG GIẢM GAIN"; b.className="limbadge on"; }
    else { b.textContent="ĐANG NGHỈ"; b.className="limbadge"; }
  }
  var _grT = (limiterOn? meter.grDb.toFixed(1):"0.0")+" dB"; if (_ml.grT!==_grT){ _ml.grT=_grT; _me.gr.textContent=_grT; }
  /* Dynamic EQ realtime: readout band dang chon + ve lai do thi toi da
     ~8 lan/giay de thay duong bao offset ma khong keo do thi xuong duoi 60fps. */
  if (typeof dynMeter !== "undefined" && dynMeter && dynMeter.off){
    var dSel = (typeof PSY !== "undefined" && PSY && PSY.dyn) ? PSY.dyn[selBand] : null;
    if (dSel && dSel.on && bands[selBand] && bands[selBand].on && isFinite(dynMeter.off[selBand]) && isFinite(dynMeter.lvl[selBand])){
      $("psDynLive").textContent = "offset " + fmtDb(dynMeter.off[selBand], 1) + " dB · detector " + fmtDb(dynMeter.lvl[selBand], 1) + " dBFS";
    } else {
      $("psDynLive").textContent = "—";
    }
    var nowDyn = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    if (dSel && dSel.on && (!meterLoop._lastDynDraw || nowDyn - meterLoop._lastDynDraw > 120)){
      meterLoop._lastDynDraw = nowDyn;
      if (typeof drawGraph === "function") drawGraph();
    }
  }
  /* spectrum */
  var sc=$("spec"), sx=sc.getContext("2d");
  var dpr=window.devicePixelRatio||1;
  if (sc.width !== sc.clientWidth*dpr){ sc.width=sc.clientWidth*dpr; sc.height=74*dpr; }
  sx.setTransform(dpr,0,0,dpr,0,0);
  var W=sc.clientWidth, H=74;
  sx.clearRect(0,0,W,H);
  if (analyser && engineReady){
    if (!specData) specData=new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(specData);
    var bars=56;
    /* (vòng tự động 05:24, hướng D — ÁP DỤNG, vá code): cache bin phổ 56 cột của meterLoop — bin chỉ phụ thuộc (displayFs, analyser.fftSize) nên tính MỘT lần theo đúng 2 khóa đó (cache meterLoop._specBins, khóa fs + fftSize) thay vì 56× Math.pow + Math.floor mỗi khung; thân vòng còn lại (Math.min theo specData.length, /255, Math.max, fillStyle, fillRect) giữ nguyên từng ký tự nên lệnh vẽ giống từng bit. Lab Node 3 lần chạy: 40/40 cấu hình giống từng bit (6 fixture phổ × 5 cấu hình fs/fftSize + rỗng/độ dài 1, cả cache lạnh và nóng; kiểm chứng lại trên chính đoạn trích từ file đã vá: 40/40, gồm cả đổi fs giữa chừng); vòng thuần 14,9–16,1× (15/15 vòng), vòng đầy đủ mock canvas 1,11–1,37× (11–12/15 vòng). QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, thẻ HTML như backup pre-insert, diff đúng 1 hunk, H1–H17 còn nguyên; Headless Chrome vẫn bị chặn (Hatch WebGL) nên QA trình duyệt đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms); aeV3 không đo lại (vá không chạm solver). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm A. */
    if (!meterLoop._specBins || meterLoop._specBins.fs!==displayFs || meterLoop._specBins.n!==analyser.fftSize){
      var _sb=new Int32Array(bars);
      for (var _si=0;_si<bars;_si++){ var _sf=20*Math.pow(1000,_si/bars); _sb[_si]=Math.floor(_sf/displayFs*analyser.fftSize); }
      meterLoop._specBins={fs:displayFs,n:analyser.fftSize,bins:_sb};
    }
    var _sbins=meterLoop._specBins.bins;
    var _lastFill=null;
    for (var i=0;i<bars;i++){
      var bin=_sbins[i];
      var v=(specData[Math.min(bin,specData.length-1)]||0)/255;
      var bh=Math.max(2, v*(H-8));
      var _fc = v>0.85 ? "#ff5d5d" : (v>0.6 ? "#ffb224" : "#2f7f86");
      if (_fc!==_lastFill){ sx.fillStyle=_fc; _lastFill=_fc; }
      sx.fillRect(i*(W/bars)+1, H-bh, W/bars-2, bh);
    }
  } else {
    sx.fillStyle="#3a4350"; sx.font="11px 'IBM Plex Mono',monospace";
    sx.fillText("Phổ tín hiệu — khởi tạo engine để xem", 10, H/2);
  }
  /* Chỉ chạy vòng lặp liên tục khi engine đang hoạt động;
     lúc idle trang đứng yên hoàn toàn. */
  if (engineReady) requestAnimationFrame(meterLoop);
  else meterRunning = false;
}

/* ---------------- Init UI ---------------- */
refreshDerived();
syncBandUI();
drawGraph();
updateLatency();
meterLoop(); /* vẽ meter/phổ placeholder một lần; vòng lặp chỉ chạy khi engine bật */
setTimeout(function(){ drawGraph(); }, 350); /* sau khi font tải xong */
