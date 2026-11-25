/* Web AutoEQ split module: 05-studio-ui.js (nguon: khoi script L16137 cua ban 1 file) */

"use strict";
/* ================================================================
   Web AutoEQ — Giai đoạn 4: Studio UI 60fps & Blind A/B/X
   - Bố cục studio: preset/target trái · đồ thị giữa · band + điều
     khiển chính xác phải · transport + A/B/X ở thanh dưới.
   - Đồ thị Canvas 2D tương tác: kéo node (Fc/Gain), wheel = Q,
     Shift/Alt khóa trục, nhấp đúp bật/tắt + tạo band, Solo Band,
     undo/redo, bàn phím đầy đủ, các lớp hiển thị bật/tắt riêng.
   - Mọi thao tác đi qua API Giai đoạn 1 (pushCoeffs/pushConfig);
     worklet nội suy mượt hệ số + pre-amp nên không click.
   - Blind A/B/X: cân loudness tích hợp LUFS theo ITU-R BS.1770
     (K-weighting) trên phổ đo từ analyser hoặc mô hình pink noise.
   ================================================================ */
var LYR = { filter:true, fft:true };
var SOLO = { on:false };
function clampN(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

/* ---------------- Bố cục Studio (di chuyển panel có sẵn, giữ nguyên ID & listener) ---------------- */
function buildStudioLayout(){
  var wrap = document.querySelector(".wrap"), grid = document.querySelector(".grid");
  if (!wrap || !grid) return;
  var studio = document.createElement("div"); studio.className = "studio";
  var left = document.createElement("div"); left.className = "st-col st-left";
  var center = document.createElement("div"); center.className = "st-col st-center";
  var right = document.createElement("div"); right.className = "st-col st-right";
  var bottom = document.createElement("div"); bottom.className = "st-bottom";
  left.appendChild(document.querySelector(".preset").closest(".panel"));   /* Preset nhanh */
  var aeColsEl = $("btnAutoEq").closest(".cols");
  aeColsEl.style.marginTop = "0";
  aeColsEl.id = "aePanel";
  /* AutoEQ + Target KHÔNG nằm trong cột trái hẹp của studio nữa: trước đây nó bị
     chôn ở cột 292px dưới panel Preset (trên mobile còn nằm dưới cả đồ thị) nên
     người dùng mở trang không nhìn thấy ô chọn tai nghe/target. Nay panel AutoEQ
     nằm toàn chiều rộng ngay dưới thanh trạng thái, trên cùng của trang — mở
     trang là thấy ngay Bước 1 (tai nghe) và Bước 2 (target), ở mọi kích thước. */
  center.appendChild($("graph").closest(".panel"));                          /* Đồ thị */
  right.appendChild($("precPanel"));                                         /* Điều khiển chính xác */
  right.appendChild($("bands"));                                             /* Danh sách band */
  right.appendChild($("mPeakOut").closest(".panel"));                        /* Meters */
  right.appendChild($("extraHead").closest(".panel"));                       /* Pre-amp */
  bottom.appendChild($("btnPlay").closest(".panel"));                        /* Transport */
  bottom.appendChild($("abxPanel"));                                         /* Blind A/B/X */
  studio.appendChild(left); studio.appendChild(center); studio.appendChild(right);
  wrap.insertBefore(aeColsEl, grid);
  wrap.insertBefore(studio, grid);
  wrap.insertBefore(bottom, grid);
  grid.remove();
  drawGraph();
}

/* ---------------- Lớp hiển thị ---------------- */
function syncLayerChips(){
  $("chipFilter").classList.toggle("on", LYR.filter);
  $("chipFft").classList.toggle("on", LYR.fft);
  var lg = $("lgFft"); if (lg) lg.style.display = LYR.fft ? "" : "none";
}
$("chipFilter").addEventListener("click", function(){ LYR.filter = !LYR.filter; syncLayerChips(); drawGraph(); });
$("chipFft").addEventListener("click", function(){ LYR.fft = !LYR.fft; syncLayerChips(); drawGraph(); });

/* ---------------- Node EQ trên đồ thị ---------------- */
function drawEqNodes(g, X, Y){
  g.save();
  for (var i=0;i<bands.length;i++){
    var b = bands[i];
    var x = X(clampN(b.freq, 20, 20000)), y = Y(clampN(b.gain, -16, 16));
    var sel = (i === selBand);
    g.beginPath(); g.arc(x, y, sel ? 10.5 : 8.5, 0, 7);
    if (b.on){
      g.fillStyle = sel ? "#ffb224" : "#0e2b2e"; g.fill();
      g.lineWidth = sel ? 2.4 : 1.8; g.strokeStyle = sel ? "#ffd97a" : "#3fd2dc"; g.stroke();
    } else {
      g.fillStyle = "rgba(18,22,28,.9)"; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = "#5f6a78"; g.stroke();
    }
    g.fillStyle = b.on ? (sel ? "#191104" : "#aef3f7") : "#6b7582";
    g.font = "600 9.5px 'IBM Plex Mono', monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(i+1), x, y + 0.5);
    if (sel){
      g.font = "11px 'IBM Plex Mono', monospace"; g.fillStyle = "#ffb224";
      var lbl = fmtFreq(b.freq)+" · "+fmtDb(b.gain,1)+" dB · Q "+b.q.toFixed(2)+(b.on ? "" : " · ĐANG TẮT");
      var lx = clampN(x, 74, Math.max(74, cvSize(graph).w - 74));
      g.fillText(lbl, lx, Math.max(11, y - 21));
    }
  }
  g.restore();
}
function evtPos(e){ var r = graph.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hitNode(x, y){
  if (!graph._X || !graph._Y) return -1;
  var best = -1, bd = 17*17;
  for (var i=0;i<bands.length;i++){
    var nx = graph._X(clampN(bands[i].freq, 20, 20000));
    var ny = graph._Y(clampN(bands[i].gain, -16, 16));
    var dx = x - nx, dy = y - ny, d2 = dx*dx + dy*dy;
    if (d2 < bd){ bd = d2; best = i; }
  }
  return best;
}

/* ---------------- Lịch sử undo/redo cho thao tác đồ thị ---------------- */
var undoStack = [], redoStack = [];
function snapBandsOnly(){ return bands.map(function(b){ return { freq:b.freq, type:b.type, gain:b.gain, q:b.q, on:b.on }; }); }
function snapState(){ return { bands: snapBandsOnly(), sel: selBand }; }
function applyBandArr(arr){ arr.forEach(function(sb, i){ var b = bands[i]; if (!b || !sb) return; b.freq = sb.freq; b.type = sb.type; b.gain = sb.gain; b.q = sb.q; b.on = sb.on; }); }
function applyState(s){ applyBandArr(s.bands); selBand = clampN(s.sel|0, 0, bands.length - 1); updateAll(true); }
function histRecord(pre){
  if (JSON.stringify(pre.bands) !== JSON.stringify(snapBandsOnly())){
    undoStack.push(pre); if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    abxDetach();
  }
  syncHistUI();
}
function syncHistUI(){
  $("btnUndo").disabled = !undoStack.length;
  $("btnRedo").disabled = !redoStack.length;
  $("btnUndo").textContent = "↩ Hoàn tác" + (undoStack.length ? " ("+undoStack.length+")" : "");
  $("btnRedo").textContent = "↪ Làm lại" + (redoStack.length ? " ("+redoStack.length+")" : "");
}
function doUndo(){ if (!undoStack.length) return; redoStack.push(snapState()); applyState(undoStack.pop()); abxDetach(); syncHistUI(); }
function doRedo(){ if (!redoStack.length) return; undoStack.push(snapState()); applyState(redoStack.pop()); abxDetach(); syncHistUI(); }
$("btnUndo").addEventListener("click", doUndo);
$("btnRedo").addEventListener("click", doRedo);
document.addEventListener("keydown", function(e){
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  var tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  var k = (e.key || "").toLowerCase();
  if (k === "z" && !e.shiftKey){ e.preventDefault(); doUndo(); }
  else if ((k === "z" && e.shiftKey) || k === "y"){ e.preventDefault(); doRedo(); }
});

/* ---------------- Kéo node / wheel Q / nhấp đúp ---------------- */
var drag = null, dragPre = null, dragStats = { last:0, max:0 };
graph.addEventListener("pointerdown", function(e){
  try { graph.focus({ preventScroll:true }); } catch(err) { graph.focus(); }
  var p = evtPos(e), hit = hitNode(p.x, p.y);
  if (hit >= 0){
    selBand = hit;
    drag = { i: hit, sx: p.x, sy: p.y, active: false };
    dragEvt = null; if (dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; }
    dragPre = snapState();
    try { graph.setPointerCapture(e.pointerId); } catch(err) {}
    updateAll(false);
  }
});
var dragEvt = null, dragRaf = 0;
graph.addEventListener("pointermove", function(e){
  if (drag){
    /* Gộp cập nhật theo khung hình: pointermove có thể bắn dày hơn nhịp
       khung hình rất nhiều lần. Chỉ giữ vị trí MỚI NHẤT và áp tối đa một
       lần updateAll mỗi khung hình — hệ số + đồ thị luôn khớp vị trí con
       trỏ cuối cùng, nhưng không còn tính lại toàn bộ đáp tuyến cho những
       vị trí trung gian không bao giờ được hiển thị. pointerup xả nốt vị
       trí đang chờ ngay lập tức (đồng bộ, xem endDrag) trước khi ghi lịch
       sử, nên trạng thái cuối và undo/redo không thay đổi. */
    dragEvt = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey };
    if (!dragRaf) dragRaf = requestAnimationFrame(flushDrag);
  }
  else { var p = evtPos(e); graph.style.cursor = hitNode(p.x, p.y) >= 0 ? "grab" : "crosshair"; }
});
function flushDrag(){
  dragRaf = 0;
  if (drag && dragEvt){ var ev = dragEvt; dragEvt = null; applyDragPos(ev); }
}
function applyDragPos(e){
  var d = graph._dims; if (!d || !drag) return;
  var p = evtPos(e);
  if (!drag.active){
    if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) < 4) return;
    drag.active = true; graph.style.cursor = "grabbing";
  }
  var b = bands[drag.i];
  var t = clampN((p.x - d.padL)/d.gw, 0, 1);
  var f = d.fMin * Math.pow(d.fMax/d.fMin, t);
  var db = d.dbMax - (p.y - d.padT)/d.gh * (d.dbMax - d.dbMin);
  if (!e.shiftKey) b.freq = Math.round(clampN(f, 20, 20000)*10)/10;   /* Shift+kéo: khóa Fc */
  if (!e.altKey)  b.gain = Math.round(clampN(db, -12, 12)*100)/100;   /* Alt+kéo: khóa Gain */
  var t0 = performance.now();
  updateAll(true);
  var dt = performance.now() - t0;
  dragStats.last = dt; if (dt > dragStats.max) dragStats.max = dt;
  $("dragMs").textContent = "kéo node: " + dt.toFixed(1) + " ms";
}
function endDrag(){
  if (!drag) return;
  if (dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; }
  if (dragEvt){ var ev = dragEvt; dragEvt = null; applyDragPos(ev); } /* xả vị trí cuối trước khi chốt lịch sử */
  drag = null; graph.style.cursor = "crosshair";
  if (dragPre) histRecord(dragPre);
  dragPre = null;
}
graph.addEventListener("pointerup", endDrag);
graph.addEventListener("pointercancel", endDrag);

var wheelPre = null, wheelT = null;
graph.addEventListener("wheel", function(e){
  var p = evtPos(e), hit = hitNode(p.x, p.y);
  if (hit < 0) return;
  e.preventDefault();
  selBand = hit;
  if (!wheelPre) wheelPre = snapState();
  clearTimeout(wheelT);
  wheelT = setTimeout(function(){ if (wheelPre){ histRecord(wheelPre); wheelPre = null; } }, 500);
  var b = bands[hit];
  b.q = Math.round(clampN(b.q * (e.deltaY < 0 ? 1.12 : 1/1.12), 0.4, 10)*100)/100;
  updateAll(true);
}, { passive:false });

graph.addEventListener("dblclick", function(e){
  var p = evtPos(e), hit = hitNode(p.x, p.y), pre = snapState();
  if (hit >= 0){
    selBand = hit; bands[hit].on = !bands[hit].on;
  } else {
    var d = graph._dims; if (!d) return;
    var t = clampN((p.x - d.padL)/d.gw, 0, 1);
    var f = d.fMin * Math.pow(d.fMax/d.fMin, t);
    var db = d.dbMax - (p.y - d.padT)/d.gh * (d.dbMax - d.dbMin);
    var idx = -1, i;
    for (i = 0; i < bands.length; i++) if (!bands[i].on){ idx = i; break; }
    if (idx < 0){ var mg = 1e9; for (i = 0; i < bands.length; i++) if (Math.abs(bands[i].gain) < mg){ mg = Math.abs(bands[i].gain); idx = i; } }
    var b = bands[idx];
    b.freq = Math.round(clampN(f, 20, 20000)*10)/10;
    b.gain = Math.round(clampN(db, -12, 12)*100)/100;
    b.type = b.freq <= 120 ? "lowshelf" : (b.freq >= 9000 ? "highshelf" : "peaking");
    b.q = (b.type === "peaking") ? 1.0 : 0.707;
    b.on = true; selBand = idx;
  }
  updateAll(true);
  histRecord(pre);
});

/* ---------------- Bàn phím trên đồ thị ---------------- */
var kbPre = null, kbT = null, kbDirty = false;
graph.addEventListener("keydown", function(e){
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  var b = bands[selBand], used = true, coarse = e.shiftKey;
  if (!kbPre){ kbPre = snapState(); kbDirty = false; }
  switch (e.key){
    case "ArrowUp":    b.gain = clampN(b.gain + (coarse ? 1 : 0.1), -12, 12); break;
    case "ArrowDown":  b.gain = clampN(b.gain - (coarse ? 1 : 0.1), -12, 12); break;
    case "ArrowRight": b.freq = coarse ? clampN(b.freq * Math.pow(2, 1/24), 20, 20000) : clampN(b.freq + 1, 20, 20000); break;
    case "ArrowLeft":  b.freq = coarse ? clampN(b.freq / Math.pow(2, 1/24), 20, 20000) : clampN(b.freq - 1, 20, 20000); break;
    case "PageUp":     b.q = clampN(b.q * (coarse ? 1.5 : 1.1), 0.4, 10); break;
    case "PageDown":   b.q = clampN(b.q / (coarse ? 1.5 : 1.1), 0.4, 10); break;
    case "[": selBand = (selBand + bands.length - 1) % bands.length; break;
    case "]": selBand = (selBand + 1) % bands.length; break;
    case "b": case "B": b.on = !b.on; break;
    case "s": case "S": toggleSolo(); break;
    default:
      if (/^[0-9]$/.test(e.key)) selBand = Math.min((e.key === "0") ? 9 : parseInt(e.key, 10) - 1, bands.length - 1);
      else used = false;
  }
  if (used){
    e.preventDefault(); kbDirty = true;
    b.gain = Math.round(b.gain*100)/100; b.q = Math.round(b.q*100)/100; b.freq = Math.round(b.freq*10)/10;
    updateAll(true);
    clearTimeout(kbT);
    kbT = setTimeout(function(){ if (kbPre){ histRecord(kbPre); kbPre = null; } }, 700);
  } else if (!kbDirty) kbPre = null;
});

/* ---------------- Solo Band ---------------- */
function soloCoeffs(fs){
  if (!SOLO.on) return null;
  var out = [];
  for (var i = 0; i < bands.length; i++){
    if (i === selBand && typeof bandpassCoeffs === "function")
      out.push(bandpassCoeffs(bands[i].freq, Math.max(0.8, bands[i].q), fs));
    else out.push({ b0:1, b1:0, b2:0, a1:0, a2:0 });
  }
  return out;
}
function syncSoloUI(){
  $("btnSolo").textContent = SOLO.on ? ("Solo Band: BẬT · Band " + (selBand+1)) : "Solo Band: Tắt";
  $("btnSolo").classList.toggle("active", SOLO.on);
  $("precSolo").textContent = SOLO.on ? "Tắt Solo" : "Solo band này";
  $("precSolo").classList.toggle("active", SOLO.on);
}
function toggleSolo(){ SOLO.on = !SOLO.on; syncSoloUI(); pushCoeffs(); pushConfig(); }
$("btnSolo").addEventListener("click", toggleSolo);
$("precSolo").addEventListener("click", toggleSolo);

/* ---------------- Panel điều khiển chính xác ---------------- */
function syncPrecise(){
  var b = bands[selBand]; if (!b) return;
  $("precTitle").textContent = "Band " + (selBand+1) + " · " + fmtFreq(b.freq);
  if (document.activeElement !== $("precFc"))   $("precFc").value = Math.round(b.freq*10)/10;
  if (document.activeElement !== $("precGain")) $("precGain").value = Math.round(b.gain*100)/100;
  if (document.activeElement !== $("precQ"))    $("precQ").value = Math.round(b.q*100)/100;
  if (document.activeElement !== $("precType")) $("precType").value = b.type;
  $("precToggle").textContent = b.on ? "Tắt band" : "Bật band";
  syncSoloUI();
  if (SOLO.on) pushCoeffs();
}
function precApply(key){
  var pre = snapState(), b = bands[selBand], v;
  if (key === "fc"){ v = parseFloat($("precFc").value);   if (isFinite(v)) b.freq = Math.round(clampN(v, 20, 20000)*10)/10; }
  if (key === "gain"){ v = parseFloat($("precGain").value); if (isFinite(v)) b.gain = Math.round(clampN(v, -12, 12)*100)/100; }
  if (key === "q"){ v = parseFloat($("precQ").value);    if (isFinite(v)) b.q = Math.round(clampN(v, 0.4, 10)*100)/100; }
  if (key === "type"){ b.type = $("precType").value; }
  updateAll(true);
  histRecord(pre);
}
$("precFc").addEventListener("change", function(){ precApply("fc"); });
$("precGain").addEventListener("change", function(){ precApply("gain"); });
$("precQ").addEventListener("change", function(){ precApply("q"); });
$("precType").addEventListener("change", function(){ precApply("type"); });
$("precToggle").addEventListener("click", function(){
  var pre = snapState();
  bands[selBand].on = !bands[selBand].on;
  updateAll(true);
  histRecord(pre);
});

/* ================================================================
   BLIND A/B/X — cân loudness LUFS theo ITU-R BS.1770 (K-weighting)
   ================================================================ */
var ABX = { A:null, B:null, active:"cur", hidden:null,
            trims:{ off:0, A:0, B:0 }, lufs:{ off:null, A:null, B:null },
            spec:null, score:{ n:0, ok:0 } };
function abxMsg(t){ $("abxMsg").textContent = t; }
function abxTrimDb(){
  if (ABX.active === "off") return ABX.trims.off;
  if (ABX.active === "A") return ABX.trims.A;
  if (ABX.active === "B") return ABX.trims.B;
  if (ABX.active === "X") return ABX.hidden === "A" ? ABX.trims.A : ABX.trims.B;
  if (typeof blindTrimDb === "function"){ var bt = blindTrimDb(); if (bt) return bt; }
  return 0;
}
function abxTrimLin(){ return Math.pow(10, abxTrimDb()/20); }
function abxDetach(){
  if (ABX.active === "A" || ABX.active === "B" || ABX.active === "X"){
    ABX.active = "cur"; ABX.hidden = null; syncAbxUI(); pushConfig();
  }
}
function setBypassSlot(v){
  bypass = v;
  var btn = $("btnBypass");
  btn.textContent = "Bypass: " + (v ? "BẬT — EQ bị vòng qua" : "Tắt");
  btn.classList.toggle("active", v);
  pushConfig(); drawGraph();
}
function applySlot(name){
  if (typeof blind !== "undefined" && blind && blind.started){ abxMsg("Đang chấm mù — bấm “Dừng / khôi phục” trong phần chấm mù trước khi nghe slot A/B/X, để không thay mẫu đang chấm và không cướp trim LUFS đã cân."); return; }
  if (name === "off"){ ABX.active = "off"; ABX.hidden = null; setBypassSlot(true); syncAbxUI(); return; }
  if (!ABX[name]){ abxMsg("Slot " + name + " chưa có preset — hãy chỉnh EQ rồi bấm “Lưu EQ hiện tại → " + name + "” trước."); return; }
  setBypassSlot(false);
  applyBandArr(ABX[name]);
  ABX.active = name; ABX.hidden = null;
  updateAll(true);
  syncAbxUI();
}
/* K-weighting BS.1770: pre-filter (shelf) + RLB high-pass, hệ số chuẩn tại 48 kHz */
var KW_PRE = { b0:1.53512485958697, b1:-2.69169618940638, b2:1.19839281085285, a1:-1.69065929318241, a2:0.73248077421585 };
var KW_RLB = { b0:1, b1:-2, b2:1, a1:-1.99004745483398, a2:0.99007225036621 };
function kwDb(f){ return biquadMagDb(KW_PRE, f, 48000) + biquadMagDb(KW_RLB, f, 48000); }
function hFor(arr, f){
  var s = 0;
  for (var i = 0; i < arr.length; i++){
    var b = arr[i];
    if (b.on && b.gain !== 0) s += biquadMagDb(rbjCoeffs(b.type, b.freq, b.gain, b.q, 48000), f, 48000);
  }
  return s;
}
function preFor(arr){
  var grid = aeGridFreqs(), mx = 0;
  /* (vòng tự động 02:26, hướng B — H2): hoist rbjCoeffs ra khỏi vòng lưới 240 điểm — hệ số chỉ phụ thuộc (type,freq,gain,q,fs=48000) nên tính MỘT lần/band rồi dùng lại biquadMagDb cho mọi điểm lưới, thay vì tính lại 240 lần/band qua hFor; điều kiện bỏ qua là đúng biểu thức của hFor (b.on && b.gain !== 0); thứ tự cộng i=0..n-1 không đổi nên pre-amp giống từng bit. Lab 2 lần chạy: 12/12 ca giống từng bit (kể cả band tắt/gain 0/NaN/thiếu khóa on, mảng rỗng, null ném đúng TypeError cũ); lufsFor 10 band 28,2 ms -> 8,9 ms (3,17x-3,22x), preFor riêng 13,5 ms -> 3,8 ms (3,51x-3,59x). */
  var cc = [], i, j;
  for (i = 0; i < arr.length; i++){ var b = arr[i]; cc.push((b.on && b.gain !== 0) ? rbjCoeffs(b.type, b.freq, b.gain, b.q, 48000) : null); }
  for (i = 0; i < grid.length; i++){
    var s = 0;
    for (j = 0; j < cc.length; j++){ if (cc[j]) s += biquadMagDb(cc[j], grid[i], 48000); }
    if (s > mx) mx = s;
  }
  return mx > 0 ? -(mx + 1.0) : 0;
}
function specPowAt(f){
  if (ABX.spec && ABX.spec.pow){
    var binHz = ABX.spec.fs / ABX.spec.fft;
    var idx = Math.round(f / binHz);
    idx = clampN(idx, 0, ABX.spec.pow.length - 1);
    var p = ABX.spec.pow[idx] || 0;
    return Math.max(1e-9, p) * (f * Math.LN2 / 24) / binHz;
  }
  return 1; /* pink noise: công suất bằng nhau trên mỗi khoảng log bằng nhau */
}
function lufsFor(arr){
  var grid = aeGridFreqs(), pre = arr ? preFor(arr) : 0, sum = 0;
  /* (vòng tự động 02:26, hướng B — H2, cùng vá với preFor): hoist rbjCoeffs cho vòng lưới chính — dùng chung một mảng cc tính MỘT lần/band (cùng điều kiện bỏ qua của hFor, cùng thứ tự cộng) thay vì hFor tính lại 240 lần/band; pre vẫn qua preFor đã hoist nên tổng số lần gọi rbjCoeffs mỗi lufsFor giảm 2×240×band -> 2×band. */
  var cc = null, i, j;
  if (arr){
    cc = [];
    for (i = 0; i < arr.length; i++){ var b = arr[i]; cc.push((b.on && b.gain !== 0) ? rbjCoeffs(b.type, b.freq, b.gain, b.q, 48000) : null); }
  }
  for (i = 0; i < grid.length; i++){
    var f = grid[i], H = 0;
    if (cc){ for (j = 0; j < cc.length; j++){ if (cc[j]) H += biquadMagDb(cc[j], f, 48000); } }
    sum += specPowAt(f) * Math.pow(10, (kwDb(f) + H + pre)/10);
  }
  return 10*Math.log10(Math.max(1e-12, sum)) - 0.691;
}
function matchLoudness(){
  ABX.lufs = { off: lufsFor(null), A: ABX.A ? lufsFor(ABX.A) : null, B: ABX.B ? lufsFor(ABX.B) : null };
  var vals = [ABX.lufs.off];
  if (ABX.lufs.A != null) vals.push(ABX.lufs.A);
  if (ABX.lufs.B != null) vals.push(ABX.lufs.B);
  var target = Math.min.apply(null, vals);
  ABX.trims = { off: target - ABX.lufs.off,
                A: ABX.lufs.A != null ? target - ABX.lufs.A : 0,
                B: ABX.lufs.B != null ? target - ABX.lufs.B : 0 };
  pushConfig();
}
function syncAbxUI(){
  var st = { off:"đang nghe: Bypass", A:"đang nghe: Preset A", B:"đang nghe: Preset B",
             X:"đang nghe: X — đáp án đã giấu", cur:"đang nghe: EQ trực tiếp (chưa chọn slot)" };
  $("abxState").textContent = st[ABX.active] || st.cur;
  $("abxOff").classList.toggle("active", ABX.active === "off");
  $("abxA").classList.toggle("active", ABX.active === "A");
  $("abxB").classList.toggle("active", ABX.active === "B");
  $("abxX").classList.toggle("active", ABX.active === "X");
  $("abxGuessA").disabled = ABX.active !== "X";
  $("abxGuessB").disabled = ABX.active !== "X";
  $("abxLufsOff").textContent = (ABX.lufs.off != null ? ABX.lufs.off.toFixed(2) + " LUFS" : "—") + " / trim " + fmtDb(ABX.trims.off) + " dB";
  $("abxLufsA").textContent = ABX.A ? ((ABX.lufs.A != null ? ABX.lufs.A.toFixed(2) + " LUFS" : "—") + " / trim " + fmtDb(ABX.trims.A) + " dB") : "chưa lưu preset";
  $("abxLufsB").textContent = ABX.B ? ((ABX.lufs.B != null ? ABX.lufs.B.toFixed(2) + " LUFS" : "—") + " / trim " + fmtDb(ABX.trims.B) + " dB") : "chưa lưu preset";
  var sc = ABX.score;
  $("abxScore").textContent = "Điểm X: " + sc.n + " lượt thử · đúng " + sc.ok + " · " + (sc.n ? Math.round(sc.ok/sc.n*100) : 0) + "%";
}
$("abxOff").addEventListener("click", function(){ applySlot("off"); });
$("abxA").addEventListener("click", function(){ applySlot("A"); });
$("abxB").addEventListener("click", function(){ applySlot("B"); });
$("abxSaveA").addEventListener("click", function(){ ABX.A = snapBandsOnly(); matchLoudness(); syncAbxUI(); abxMsg("Đã lưu EQ hiện tại vào slot A và cân lại loudness. Trim A hiện tại: " + fmtDb(ABX.trims.A) + " dB."); });
$("abxSaveB").addEventListener("click", function(){ ABX.B = snapBandsOnly(); matchLoudness(); syncAbxUI(); abxMsg("Đã lưu EQ hiện tại vào slot B và cân lại loudness. Trim B hiện tại: " + fmtDb(ABX.trims.B) + " dB."); });
$("abxMatch").addEventListener("click", function(){
  matchLoudness(); syncAbxUI();
  abxMsg("Đã đo & cân loudness: Bypass " + (ABX.lufs.off != null ? ABX.lufs.off.toFixed(2) : "—") + " LUFS · A " +
    (ABX.lufs.A != null ? ABX.lufs.A.toFixed(2) + " LUFS (trim " + fmtDb(ABX.trims.A) + " dB)" : "chưa lưu") + " · B " +
    (ABX.lufs.B != null ? ABX.lufs.B.toFixed(2) + " LUFS (trim " + fmtDb(ABX.trims.B) + " dB)" : "chưa lưu") + ".");
});
/* Pha B (2026-11-07): pho do dung de can LUFS phai la pho NGUON (truoc EQ).
   Analyser noi SAU worklet (workletNode.connect(analyser)) nen do truc tiep
   se do pho da qua EQ dang nghe; lufsFor lai cong H(slot) len tren -> EQ bi
   dem 2 lan, trim lech toi 1,42 dB (lab lab_abxspec_2026-11-07: do luc nghe
   B lech trim B -1,21 dB, do luc nghe C lech trim C -1,42 dB; do luc Bypass
   khoi phuc dung trim trong 0,12 dB). Vi vay khi do, tam chuyen sang Bypass
   trong 1 giay do roi khoi phuc dung slot truoc do (ke ca X giu nguyen dap
   an da giau; neu giua chung nguoi dung tu doi slot thi giu lua chon moi).
   ABX.spec khong tu xoa: nut reset tra ve pho pink mo hinh. */
var abxSpecBusy = false;
function abxRestoreSlot(prev){
  if (!prev) return;
  if (prev.active === "off"){ applySlot("off"); return; }
  if (prev.active === "A" || prev.active === "B"){ applySlot(prev.active); return; }
  if (prev.active === "X" && prev.hidden && ABX[prev.hidden]){
    setBypassSlot(false);
    applyBandArr(ABX[prev.hidden]);
    ABX.active = "X"; ABX.hidden = prev.hidden;
    updateAll(true);
    syncAbxUI();
    return;
  }
  /* "cur": EQ truc tiep — dai band khong doi khi chuyen bypass, chi tra lai co bypass + active */
  ABX.active = "cur"; ABX.hidden = null;
  setBypassSlot(!!prev.bypass);
  syncAbxUI();
}
$("abxSpec").addEventListener("click", function(){
  if (!analyser || !engineReady || typeof analyser.getFloatFrequencyData !== "function"){
    abxMsg("Chưa đo được phổ: hãy khởi tạo engine và phát tín hiệu trước (nút Phát / Pink noise), rồi bấm lại.");
    return;
  }
  if (abxSpecBusy){ abxMsg("Đang đo phổ — chờ xong lần đo này rồi bấm lại."); return; }
  if (typeof blind !== "undefined" && blind && blind.started){ abxMsg("Đang chấm mù — hãy dừng / khôi phục chấm mù rồi đo phổ."); return; }
  var prevSlot = { active: ABX.active, hidden: ABX.hidden, bypass: bypass };
  if (ABX.active !== "off") applySlot("off"); /* tam Bypass de do dung pho nguon */
  abxSpecBusy = true;
  var n = analyser.frequencyBinCount, acc = new Float32Array(n), tmp = new Float32Array(n), cnt = 0;
  abxMsg("Đang đo phổ từ analyser trong 1 giây (tạm nghe Bypass để đo đúng phổ nguồn)…");
  var iv = setInterval(function(){
    try {
      analyser.getFloatFrequencyData(tmp);
      for (var i = 0; i < n; i++) acc[i] += Math.pow(10, (isFinite(tmp[i]) ? tmp[i] : -100)/10);
      cnt++;
      if (cnt >= 10){
        clearInterval(iv);
        abxSpecBusy = false;
        var pow = new Float32Array(n);
        for (var j = 0; j < n; j++) pow[j] = acc[j]/cnt;
        ABX.spec = { pow: pow, fs: displayFs, fft: analyser.fftSize };
        var nm = "phổ đo từ tín hiệu đang phát (analyser, trung bình 1 s · " + new Date().toLocaleTimeString("vi-VN") + ")";
        $("abxSpecName").textContent = nm;
        if (ABX.active === "off") abxRestoreSlot(prevSlot); /* nguoi dung doi slot giua chung -> giu lua chon moi */
        matchLoudness(); syncAbxUI();
        abxMsg("Đã đo xong phổ thật từ tín hiệu đang phát (đo lúc Bypass) và cân lại loudness theo phổ này; đã khôi phục đúng slot bạn đang nghe.");
      }
    } catch (e) {
      clearInterval(iv);
      abxSpecBusy = false;
      if (ABX.active === "off") abxRestoreSlot(prevSlot);
      abxMsg("Đo phổ lỗi: " + (e && e.message ? e.message : e));
    }
  }, 100);
});
$("abxSpecReset").addEventListener("click", function(){
  ABX.spec = null;
  $("abxSpecName").textContent = "mô hình pink noise (mặc định)";
  matchLoudness(); syncAbxUI();
  abxMsg("Đã quay lại phổ mô hình pink noise và cân lại loudness theo phổ này (dùng khi đổi nguồn phát sau khi đã đo phổ).");
});
$("abxX").addEventListener("click", function(){
  if (typeof blind !== "undefined" && blind && blind.started){ abxMsg("Đang chấm mù — bấm “Dừng / khôi phục” trong phần chấm mù trước khi bật chế độ X, để không cướp trim LUFS đã cân."); return; }
  if (!ABX.A || !ABX.B){ abxMsg("Cần lưu cả hai slot A và B trước khi bật chế độ X."); return; }
  ABX.hidden = Math.random() < 0.5 ? "A" : "B";
  setBypassSlot(false);
  applyBandArr(ABX[ABX.hidden]);
  ABX.active = "X";
  updateAll(true);
  syncAbxUI();
  abxMsg("Đang phát X — đáp án đã giấu. Nghe kỹ rồi đoán: “X là A” hay “X là B”.");
});
function guessX(g){
  if (ABX.active !== "X" || !ABX.hidden) return;
  ABX.score.n++;
  var right = (g === ABX.hidden);
  if (right) ABX.score.ok++;
  var was = ABX.hidden;
  ABX.active = was; ABX.hidden = null;
  syncAbxUI(); pushConfig();
  abxMsg(right ? ("Đúng — X chính là Preset " + was + ". Bấm “Chế độ X” để chơi lượt mới.")
               : ("Chưa đúng — X là Preset " + was + ". Bấm “Chế độ X” để chơi lượt mới."));
}
$("abxGuessA").addEventListener("click", function(){ guessX("A"); });
$("abxGuessB").addEventListener("click", function(){ guessX("B"); });

/* ---------------- Đồng hồ FPS trong app ----------------
   Điều kiện lấy mẫu hợp lệ: tab đang hiển thị và được focus. Khi tab ẩn,
   trình duyệt DỪNG requestAnimationFrame; khi tab không focus / chạy
   headless, rAF bị bóp xuống (đã từng đo 16–41 fps trong ảnh chụp kiểm tra
   dù chi phí vẽ mỗi khung chưa tới 1 ms) — những mẫu đó phản ánh lịch trình
   của môi trường, không phải khả năng vẽ của app, nên đồng hồ ghi rõ trạng
   thái "chưa đủ điều kiện" thay vì trưng một con số gây hiểu nhầm là lỗi. */
var FPSM = { frames:0, lastT: performance.now(), cur:0, min:0 };
function fpsTick(t){
  FPSM.frames++;
  if (t - FPSM.lastT >= 1000){
    FPSM.cur = Math.round(FPSM.frames * 1000 / (t - FPSM.lastT));
    if (engineReady && isPlaying() && (!FPSM.min || FPSM.cur < FPSM.min)) FPSM.min = FPSM.cur;
    FPSM.frames = 0; FPSM.lastT = t;
    var el = $("p4FpsLive");
    if (el){
      if (!document.hasFocus()){
        el.textContent = FPSM.cur + " fps (mẫu tham khảo — tab chưa được focus nên rAF có thể bị môi trường bóp khung; focus vào tab rồi chờ 1–2 giây để lấy mẫu đúng điều kiện)" + (FPSM.min ? " · thấp nhất trong lúc đang phát: " + FPSM.min + " fps" : "");
      } else {
        el.textContent = FPSM.cur + " fps" + (FPSM.min ? " · thấp nhất trong lúc đang phát: " + FPSM.min + " fps" : " · (chưa phát nhạc để lấy mốc tối thiểu)");
      }
    }
  }
  if (LYR.fft && engineReady) drawGraph();
  requestAnimationFrame(fpsTick);
}
document.addEventListener("visibilitychange", function(){
  var el = $("p4FpsLive");
  if (el && document.hidden) el.textContent = "tạm dừng — tab đang ẩn: trình duyệt dừng requestAnimationFrame nên không có mẫu khung hình hợp lệ";
});
function measureFps(done){
  var prevFft = LYR.fft; LYR.fft = true; syncLayerChips();
  var frames = 0, t0 = null, last = 0, worst = 0, drawMs = 0, hiddenSeen = !!document.hidden, wall0 = performance.now(), finished = false;
  function finish(){
    if (finished) return; finished = true;
    LYR.fft = prevFft; syncLayerChips(); drawGraph();
    var dur = (t0 !== null && last > t0) ? (last - t0)/1000 : Math.max(0.001, (performance.now() - wall0)/1000);
    done(frames/Math.max(0.001, dur), worst, frames ? drawMs/frames : 0, hiddenSeen || document.hidden);
  }
  function step(t){
    if (finished) return;
    if (document.hidden) hiddenSeen = true;
    if (t0 === null){ t0 = t; last = t; requestAnimationFrame(step); return; } /* đồng hồ bắt đầu từ khung rAF đầu tiên thực sự chạy */
    frames++;
    var gap = t - last; last = t; if (gap > worst) worst = gap;
    var d0 = performance.now(); drawGraph(); drawMs += performance.now() - d0;
    if (t - t0 < 1500 && performance.now() - wall0 < 4500) requestAnimationFrame(step);
    else finish();
  }
  requestAnimationFrame(step);
  setTimeout(finish, 5000); /* tab ẩn: rAF không chạy — vẫn phải ra phán quyết "chưa đủ điều kiện" thay vì treo mãi ở "đang đo…" */
}

/* ---------------- Cổng tiền điều kiện của test FPS (V2) ----------------
   Test này có định nghĩa tự thân là "≥ 55 fps KHI ĐANG PHÁT + hiển thị
   FFT", nên một phép đo chỉ có ý nghĩa khi đủ cả ba tiền điều kiện:
   (1) engine đang chạy VÀ đang phát thật — AudioContext đã khởi tạo,
       ở trạng thái "running" và nguồn đang phát; engine chưa chạy thì
       không có tín hiệu, lớp FFT không có gì để hiển thị và con số fps
       đo được không nói lên điều gì về điều kiện "đang phát";
   (2) document đang hiển thị VÀ được focus — tab ẩn bị trình duyệt dừng
       hẳn rAF, tab không focus / headless bị bóp khung;
   (3) rAF không bị môi trường bóp — kiểm chứng bằng probe rAF trần
       (không vẽ gì): nếu nhịp rAF trần đã dưới 55 fps thì môi trường
       không giao đủ khung, lỗi không nằm ở chi phí vẽ của app.
   Thiếu bất kỳ tiền điều kiện nào -> test báo "CHƯA ĐỦ ĐIỀU KIỆN ĐO"
   (không PASS, không FAIL thật) và KHÔNG khóa xuất file vì lý do này.
   Chỉ khi đủ điều kiện mới chạy phép đo 1.5 giây như cũ và phán quyết
   theo đúng ngưỡng 55 fps không đổi. */
function fpsPrecheckSync(){
  var reasons = [], playing = false;
  try { playing = isPlaying(); } catch (e) {}
  if (!engineReady || !AC){
    reasons.push("engine chưa chạy — AudioContext chưa khởi tạo nên chưa có tín hiệu phát và lớp FFT chưa có phổ thật để hiển thị");
  } else if (AC.state !== "running"){
    reasons.push("AudioContext đang ở trạng thái “" + AC.state + "” chứ chưa “running” — chưa có tín hiệu phát");
  } else if (!playing){
    reasons.push("engine đã khởi tạo nhưng đang không phát — test này yêu cầu đo trong lúc đang phát + hiển thị FFT");
  }
  if (document.hidden || document.visibilityState === "hidden")
    reasons.push("tab đang ẩn (document.hidden) — trình duyệt dừng hẳn requestAnimationFrame");
  if (!document.hasFocus())
    reasons.push("tab chưa được focus — trình duyệt/headless bóp khung hình của trang không focus");
  return { ok: reasons.length === 0, reasons: reasons };
}
function fpsMarkConditional(detail){
  $("p4V2").textContent = "CHƯA ĐỦ ĐIỀU KIỆN ĐO — " + detail +
    " Trạng thái này không tính PASS, không tính FAIL thật và không khóa xuất file; hãy cho engine chạy và đang phát (bấm một nguồn phát), hiển thị + focus vào tab này rồi chạy lại kiểm chứng để lấy phán quyết ĐẠT/FAIL thật theo ngưỡng 55 fps.";
  $("p4V2Ok").innerHTML = '<span class="skip">CHƯA ĐỦ ĐIỀU KIỆN ĐO</span>';
}
function probeRafCadence(done){
  /* Probe nhịp rAF trần trong 600 ms: callback không vẽ, không tính gì —
     đo thuần nhịp khung mà môi trường giao cho trang. */
  var frames = 0, t0 = null, last = 0, worst = 0, hiddenSeen = !!document.hidden, wall0 = performance.now(), finished = false;
  function finish(){
    if (finished) return; finished = true;
    var dur = (t0 !== null && last > t0) ? (last - t0)/1000 : 0;
    done({ fps: dur > 0 ? frames/dur : 0, worst: worst, frames: frames, dur: dur, hiddenSeen: hiddenSeen || document.hidden });
  }
  function step(t){
    if (finished) return;
    if (document.hidden) hiddenSeen = true;
    if (t0 === null){ t0 = t; last = t; requestAnimationFrame(step); return; }
    frames++;
    var gap = t - last; last = t; if (gap > worst) worst = gap;
    if (t - t0 < 600 && performance.now() - wall0 < 2500) requestAnimationFrame(step);
    else finish();
  }
  requestAnimationFrame(step);
  setTimeout(finish, 3000); /* rAF bị dừng hẳn (tab ẩn): vẫn phải kết luận thay vì treo */
}

/* ---------------- Kiểm chứng nghiệm thu Prompt 4 ---------------- */
$("btnP4Verify").addEventListener("click", function(){
  /* V1 — độ trễ kéo node: đi qua đúng hàm cập nhật của thao tác kéo thật.
     1 lần chạy làm ấm (warm-up) trước khi bấm giờ để loại chi phí biên dịch
     JIT của lần gọi đầu tiên — thao tác kéo thật không bao giờ là lần gọi đầu
     tiên của phiên; ngưỡng ≤ 16 ms trên 5 lần đo ổn định giữ nguyên. */
  var saved = snapState(), times = [], r;
  bands[5].freq = 880; bands[5].gain = 1.2; bands[5].on = true;
  updateAll(true);
  for (r = 0; r < 5; r++){
    bands[5].freq = 900 + r*60; bands[5].gain = 1.5 + r*0.5; bands[5].on = true;
    var t0 = performance.now();
    updateAll(true);
    times.push(performance.now() - t0);
  }
  applyState(saved);
  var avg = times.reduce(function(a, b){ return a + b; }, 0)/times.length;
  var mx = Math.max.apply(null, times);
  $("p4V1").textContent = "TB " + avg.toFixed(2) + " ms · max " + mx.toFixed(2) + " ms (5 lần kéo mô phỏng qua updateAll sau 1 lần làm ấm JIT: tính pre-amp + vẽ lại + đẩy hệ số worklet)" +
    (dragStats.last ? " · lần kéo chuột thật gần nhất: " + dragStats.last.toFixed(2) + " ms" : " · chưa có lần kéo chuột thật nào");
  $("p4V1Ok").innerHTML = mx <= 16 ? '<span class="pass">ĐẠT ≤ 16 ms</span>' : '<span class="fail">VƯỢT 16 ms</span>';
  /* Chuẩn bị slot demo nếu người dùng chưa lưu */
  if (!ABX.A) ABX.A = snapBandsOnly();
  if (!ABX.B) ABX.B = FREQS.map(function(f, i){ return { freq:f, type:TYPES[i], gain:PRESETS.bass[i], q:DEFQ[i], on:true }; });
  matchLoudness(); syncAbxUI();
  /* V3 — chuyển slot: đo thời gian áp dụng + khẳng định cơ chế crossfade trong worklet */
  var prevActive = ABX.active, prevBypass = bypass, prevHidden = ABX.hidden;
  var t1 = performance.now();
  applySlot("A"); applySlot("B"); applySlot("off");
  var perSwitch = (performance.now() - t1)/3;
  applyState(saved);
  ABX.active = prevActive; ABX.hidden = prevHidden;
  setBypassSlot(prevBypass);
  syncAbxUI();
  $("p4V3").textContent = "áp 1 slot TB " + perSwitch.toFixed(2) + " ms (đổi toàn bộ " + bands.length + " band + pre-amp + trim, không reload/không ngắt AudioContext) · không click nhờ worklet nội suy hệ số biquad 0.35/block 128 mẫu + ramp pre-amp 0.30/block (~8 ms)";
  $("p4V3Ok").innerHTML = perSwitch < 50 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHẬM</span>';
  /* V4 — chênh loudness sau cân giữa các slot đã lưu */
  var matched = [ABX.lufs.off + ABX.trims.off];
  if (ABX.lufs.A != null) matched.push(ABX.lufs.A + ABX.trims.A);
  if (ABX.lufs.B != null) matched.push(ABX.lufs.B + ABX.trims.B);
  var resid = Math.max.apply(null, matched) - Math.min.apply(null, matched);
  $("p4V4").textContent = "LUFS sau cân — Bypass " + (ABX.lufs.off + ABX.trims.off).toFixed(2) + " (gốc " + ABX.lufs.off.toFixed(2) + " + trim " + fmtDb(ABX.trims.off) + ", áp qua tầng slot-gain riêng trong worklet nên bypass cũng được cân) · A " + (ABX.lufs.A + ABX.trims.A).toFixed(2) + " (gốc " + ABX.lufs.A.toFixed(2) + " + trim " + fmtDb(ABX.trims.A) + ") · B " + (ABX.lufs.B + ABX.trims.B).toFixed(2) + " (gốc " + ABX.lufs.B.toFixed(2) + " + trim " + fmtDb(ABX.trims.B) + ") → chênh tối đa " + resid.toFixed(3) + " LU trên phổ: " + $("abxSpecName").textContent;
  $("p4V4Ok").innerHTML = resid <= 0.3 ? '<span class="pass">ĐẠT ≤ 0.3 LU</span>' : '<span class="fail">VƯỢT 0.3 LU</span>';
  /* V2 — FPS khi đang phát + vẽ lại đồ thị mỗi khung với lớp FFT bật.
     Chặn ở tầng gốc bằng CỔNG TIỀN ĐIỀU KIỆN trước khi đo (xem
     fpsPrecheckSync / probeRafCadence ở trên): engine đang chạy và đang
     phát + document visible/focused + rAF không bị bóp. Thiếu bất kỳ
     tiền điều kiện nào -> "CHƯA ĐỦ ĐIỀU KIỆN ĐO" ngay, không chạy phép
     đo, không PASS, không FAIL thật, không khóa xuất file. Đủ điều
     kiện mới đo 1.5 giây bằng đúng phép đo cũ và phán quyết theo đúng
     ngưỡng 55 fps KHÔNG đổi:
     - ĐẠT ≥ 55 fps: PASS.   - Dưới 55 fps trong điều kiện hợp lệ: FAIL
       thật (lỗi hiệu năng của app, khóa xuất file như mọi FAIL thật). */
  $("p4V2").textContent = "đang kiểm tra tiền điều kiện đo…";
  $("p4V2Ok").textContent = "…";
  var pre = fpsPrecheckSync();
  if (!pre.ok){
    fpsMarkConditional("phép đo FPS không được thực hiện vì tiền điều kiện của chính test này chưa đạt: " + pre.reasons.join("; ") + ".");
    return;
  }
  probeRafCadence(function(pr){
    var pre2 = fpsPrecheckSync();
    if (!pre2.ok || pr.hiddenSeen){
      fpsMarkConditional("tiền điều kiện mất trong lúc thăm dò rAF: " +
        (pre2.reasons.length ? pre2.reasons.join("; ") : "tab bị ẩn trong lúc thăm dò (rAF bị dừng hẳn)") +
        " (probe rAF trần giao " + pr.frames + " khung trong " + pr.dur.toFixed(2) + " s).");
      return;
    }
    if (!(pr.fps >= 55)){
      fpsMarkConditional("nhịp rAF trần (không vẽ gì) của môi trường chỉ đạt " + pr.fps.toFixed(1) + " fps trong 600 ms thăm dò · khoảng khung dài nhất " + pr.worst.toFixed(1) + " ms — môi trường đang bóp requestAnimationFrame dưới ngưỡng 55 fps ngay cả khi app không vẽ, nên mọi con số fps đo lúc này đều phản ánh lịch trình của môi trường chứ không phải hiệu năng của app.");
      return;
    }
    $("p4V2").textContent = "đang đo 1.5 giây…";
    measureFps(function(fps, worst, avgDraw, hiddenSeen){
      var pre3 = fpsPrecheckSync();
      if (!pre3.ok || hiddenSeen){
        fpsMarkConditional("tiền điều kiện mất trong lúc đang đo: " +
          (pre3.reasons.length ? pre3.reasons.join("; ") : "tab bị ẩn trong lúc đo (rAF bị dừng hẳn)") +
          " (số thô trong cửa sổ đo dở dang: " + fps.toFixed(1) + " fps — không dùng để phán quyết).");
        return;
      }
      var cond = " (đang phát thật, đồ thị vẽ lại mỗi khung, lớp FFT bật với phổ thật từ analyser · nhịp rAF trần trước đo " + pr.fps.toFixed(1) + " fps) · khoảng khung dài nhất " + worst.toFixed(1) + " ms · chi phí vẽ + cập nhật TB " + avgDraw.toFixed(2) + " ms/khung (ngân sách 16.7 ms) · đồng hồ rAF trực tiếp ở hàng trên";
      if (fps >= 55){
        $("p4V2").textContent = fps.toFixed(1) + " fps trung bình trong 1.5 s" + cond;
        $("p4V2Ok").innerHTML = '<span class="pass">ĐẠT ≥ 55 fps</span>';
      } else {
        $("p4V2").textContent = fps.toFixed(1) + " fps trung bình trong 1.5 s" + cond;
        $("p4V2Ok").innerHTML = '<span class="fail">DƯỚI 55 fps</span>';
      }
    });
  });
});

/* ---------------- Khởi tạo Giai đoạn 4 ---------------- */
buildStudioLayout();
ABX.A = snapBandsOnly();
matchLoudness();
syncAbxUI();
syncHistUI();
syncLayerChips();
syncPrecise();
drawGraph();
requestAnimationFrame(fpsTick);
