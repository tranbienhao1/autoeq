"use strict";
/* ================================================================
   Web AutoEQ — Giai đoạn 6: QA Suite & Tổng hợp cuối
   - Phase Response + Group Delay giải tích từ hệ số đang hoạt động,
     vẽ đồng bộ trục tần số với đồ thị chính (hook vào drawGraph).
   - Acoustic QA Suite: bản sao ngoại tuyến chính xác của chuỗi DSP
     (cùng RBJ float64, cùng thuật toán crossfeed/limiter như worklet)
     để ĐO THD+N, null test, IR — số đo thật, không ghi cứng mục tiêu.
   - Dashboard + cổng khóa xuất file khi FAIL + mutation test
     + báo cáo tổng hợp (tương đương cổng `pnpm qa`).
   ================================================================ */
var QA6 = { unwrapped:false, gdMaxLow:null, gdAt1k:null, phase1k:null, results:[], ack:false, ranAt:null, report:null, mutationInfo:null, ir:null };

/* ---------------- Phase & Group Delay giải tích ---------------- */
function qaWrapDeg(d){ d = ((d + 180) % 360 + 360) % 360 - 180; return d; }
function qaBiquadPhaseRad(c, f, fs){
  var w = 2*Math.PI*f/fs, cw = Math.cos(w), sw = Math.sin(w), cw2 = 2*cw*cw - 1, sw2 = 2*sw*cw; /* góc đôi: cùng kết quả, bớt 2 hàm lượng giác mỗi lần đánh giá */
  var nr = c.b0 + c.b1*cw + c.b2*cw2, ni = -(c.b1*sw + c.b2*sw2);
  var dr = 1 + c.a1*cw + c.a2*cw2, di = -(c.a1*sw + c.a2*sw2);
  return Math.atan2(ni, nr) - Math.atan2(di, dr);
}
function qaActiveCoeffs(fs){
  var out = [];
  /* Hệ số đồng nhất (band tắt / gain 0 / section psycho tắt) có pha đúng
     bằng 0 tại mọi tần số — lọc bỏ không đổi tổng pha, chỉ tránh hàng nghìn
     lần atan2 thừa trong đường vẽ lại khi kéo node. */
  function pushNZ(c){ if (!(c.b0 === 1 && c.b1 === 0 && c.b2 === 0 && c.a1 === 0 && c.a2 === 0)) out.push(c); }
  for (var i = 0; i < bands.length; i++) pushNZ(bandCoeffs(i, fs));
  if (typeof psychoCoeffs === "function") psychoCoeffs(fs).forEach(pushNZ);
  return out;
}
var QA_PHASE_CACHE = {};
var QA_GD_GRID = {};
function qaPhaseGdData(fs){
  var N = 240, phU = [], i, k;
  /* (vòng tự động 07:54, hướng B — H7): lưới tần số + mẫu số dw chỉ phụ thuộc
     (N cố định, fs) nên tính MỘT lần/fs rồi dùng chung cho mọi lần gọi, thay vì
     241 Math.pow + 241 lần tính dw mỗi lần gọi; cùng biểu thức 20*Math.pow(1000,k/N)
     và 2*Math.PI*(freqs[b]-freqs[a])/fs nên freqs/dw giống từng bit, gdMs không đổi. */
  var grid = QA_GD_GRID[fs];
  if (!grid){
    var freqs0 = [];
    for (k = 0; k <= N; k++) freqs0.push(20*Math.pow(1000, k/N));
    var dw0 = new Float64Array(N + 1);
    for (k = 0; k <= N; k++){
      var a0 = Math.max(0, k-1), b0 = Math.min(N, k+1);
      dw0[k] = 2*Math.PI*(freqs0[b0] - freqs0[a0])/fs;
    }
    grid = { freqs: freqs0, dw: dw0 };
    if (Object.keys(QA_GD_GRID).length > 8) QA_GD_GRID = {};
    QA_GD_GRID[fs] = grid;
  }
  var freqs = grid.freqs;
  if (mode === "fir"){
    var D = (firLen - 1)/2;
    for (k = 0; k <= N; k++) phU.push(-2*Math.PI*freqs[k]/fs*D);
    var gdF = freqs.map(function(){ return D/fs*1000; });
    return { freqs: freqs, phU: phU, gdMs: gdF, fir: true };
  }
  var coeffs = qaActiveCoeffs(fs), raw = [];
  /* Chặng 5.5: cache pha theo từng band — kéo 1 band chỉ tính lại đúng band đó,
     các band còn lại lấy từ cache (khóa = toàn bộ hệ số + fs; -0 và 0 khác khóa
     nên không dùng chung sai). Cộng theo đúng thứ tự cũ nên tổng pha không đổi. */
  /* --- Lượng giác theo tần số tính MỘT lần (vòng tự động 14:11, hướng B):
     cos/sin của một tần số chỉ phụ thuộc (freqs[k], fs) nên giống hệt cho
     mọi band — tính 1 lần rồi dùng chung thay vì qaBiquadPhaseRad tính lại
     cos/sin cho từng band tại cùng 1 tần số. Chỉ xây từ band trượt cache
     THỨ 2 trở đi: 1 band trượt (kéo 1 node — trường hợp thường gặp) đi y
     hệt bản gốc, không tốn thêm cấp phát; nhiều band cùng trượt (đổi preset/
     solve/guard) mới hưởng lợi. Cùng biểu thức 2*Math.PI*freqs[k]/fs,
     2*cw*cw-1, 2*sw*cw và cùng thứ tự cộng trong atan2 nên pha từng band
     giống từng bit với bản gốc. Lab Node trên hàm thật (lượt 14:11, 2000
     lần gọi/kịch bản, chạy 2 lần, đo tách process): phU/gdMs giống từng bit
     ở 6/6 fixture (10/20 band, +psycho, phẳng, band tắt, FIR); full-
     recompute 20 band 0,86→0,60/0,65 ms (1,33–1,45×), 20 band+psycho
     1,17→0,77 ms (1,50–1,53×); 1 band trượt 0,095→0,099 ms và fully-cached
     không đổi (trong nhiễu). Không chạm solver/QA. Ý tưởng lượt kế: hướng
     C — rà soát isoPhonFromSpl/isoSplIdx trên lưới phon (gập hằng số pow
     theo chỉ số i). --- */
  var trig = null, missCount = 0;
  var bandPh = [];
  for (i = 0; i < coeffs.length; i++){
    var cc = coeffs[i];
    var pKey = fs + "|" + cc.b0 + "|" + cc.b1 + "|" + cc.b2 + "|" + cc.a1 + "|" + cc.a2;
    var pArr = QA_PHASE_CACHE[pKey];
    if (!pArr){
      missCount++;
      if (missCount === 2){
        var cwA = new Float64Array(N + 1), swA = new Float64Array(N + 1),
            cw2A = new Float64Array(N + 1), sw2A = new Float64Array(N + 1);
        for (k = 0; k <= N; k++){
          var w = 2*Math.PI*freqs[k]/fs;
          cwA[k] = Math.cos(w); swA[k] = Math.sin(w);
          cw2A[k] = 2*cwA[k]*cwA[k] - 1; sw2A[k] = 2*swA[k]*cwA[k];
        }
        trig = [cwA, swA, cw2A, sw2A];
      }
      pArr = new Float64Array(N + 1);
      if (trig){
        for (k = 0; k <= N; k++) pArr[k] = Math.atan2(-(cc.b1*trig[1][k] + cc.b2*trig[3][k]), cc.b0 + cc.b1*trig[0][k] + cc.b2*trig[2][k]) - Math.atan2(-(cc.a1*trig[1][k] + cc.a2*trig[3][k]), 1 + cc.a1*trig[0][k] + cc.a2*trig[2][k]);
      } else {
        for (k = 0; k <= N; k++) pArr[k] = qaBiquadPhaseRad(cc, freqs[k], fs);
      }
      if (Object.keys(QA_PHASE_CACHE).length > 400) QA_PHASE_CACHE = {};
      QA_PHASE_CACHE[pKey] = pArr;
    }
    bandPh.push(pArr);
  }
  for (k = 0; k <= N; k++){
    var s = 0;
    for (i = 0; i < coeffs.length; i++) s += bandPh[i][k];
    raw.push(s);
  }
  var off = 0; phU.push(raw[0]);
  for (k = 1; k <= N; k++){
    var d = raw[k] - raw[k-1];
    if (d > Math.PI) off -= 2*Math.PI; else if (d < -Math.PI) off += 2*Math.PI;
    phU.push(raw[k] + off);
  }
  var gd = [];
  for (k = 0; k <= N; k++){
    var a = Math.max(0, k-1), b = Math.min(N, k+1);
    gd.push(-(phU[b] - phU[a])/grid.dw[k]/fs*1000);
  }
  return { freqs: freqs, phU: phU, gdMs: gd, fir: false };
}
function qaDrawSmall(cv, freqs, vals, opt){
  var dpr = window.devicePixelRatio || 1;
  var cs = cvSize(cv), W = cs.w, H = cs.h;
  if (!W) return;
  if (cv.width !== Math.round(W*dpr)){ cv.width = W*dpr; cv.height = H*dpr; }
  var g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  var padL = 44, padR = 12, padT = 8, padB = 18, gw = W - padL - padR, gh = H - padT - padB;
  function X(f){ return padL + gw*(Math.log10(f/20)/Math.log10(1000)); }
  function Y(v){ return padT + gh*((opt.yMax - v)/(opt.yMax - opt.yMin)); }
  g.font = "10px 'IBM Plex Mono', monospace"; g.textAlign = "center";
  [20, 100, 1000, 10000, 20000].forEach(function(f){
    var x = X(f);
    g.strokeStyle = "#1b212a"; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + gh); g.stroke();
    g.fillStyle = "#5f6a78"; g.fillText(f >= 1000 ? (f/1000) + "k" : String(f), x, H - 5);
  });
  g.textAlign = "right";
  opt.yTicks.forEach(function(v){
    var y = Y(v);
    g.strokeStyle = v === opt.zero ? "#39434f" : "#1b212a";
    g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + gw, y); g.stroke();
    g.fillStyle = "#5f6a78"; g.fillText(opt.yFmt(v), padL - 5, y + 3);
  });
  if (opt.thresh != null && opt.thresh >= opt.yMin && opt.thresh <= opt.yMax){
    var ty = Y(opt.thresh);
    g.strokeStyle = "rgba(255,93,93,.75)"; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(padL, ty); g.lineTo(padL + gw, ty); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#ff5d5d"; g.textAlign = "left"; g.fillText(opt.threshLbl || "", padL + 6, ty - 4);
  }
  g.beginPath();
  freqs.forEach(function(f, i){
    var x = X(f), y = Y(Math.max(opt.yMin, Math.min(opt.yMax, vals[i])));
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = opt.color; g.lineWidth = 1.8; g.stroke();
  g.fillStyle = opt.color; g.textAlign = "left"; g.fillText(opt.title, padL + 2, padT + 10);
}
function qaDrawPhaseGd(){
  try {
    var fs = displayFs || 48000;
    var d = qaPhaseGdData(fs);
    QA6.gdMaxLow = null; QA6.gdAt1k = null;
    d.freqs.forEach(function(f, i){
      if (f <= 100 && (QA6.gdMaxLow === null || d.gdMs[i] > QA6.gdMaxLow)) QA6.gdMaxLow = d.gdMs[i];
      if (QA6.gdAt1k === null && f >= 1000) QA6.gdAt1k = d.gdMs[i];
    });
    var coeffs = qaActiveCoeffs(fs), ph1 = 0, i;
    if (mode === "fir") ph1 = -360*1000/fs*(firLen - 1)/2;
    else for (i = 0; i < coeffs.length; i++) ph1 += qaBiquadPhaseRad(coeffs[i], 1000, fs)*180/Math.PI;
    QA6.phase1k = ph1;
    $("qaPhaseRead").textContent = "pha tại 1 kHz: " + qaWrapDeg(ph1).toFixed(1) + "°" + (mode === "fir" ? " (wrapped) · trễ FIR hằng số " + ((firLen - 1)/2) + " mẫu" : "");
    $("qaGdRead").textContent = "tối đa dưới 100 Hz: " + (QA6.gdMaxLow === null ? "—" : QA6.gdMaxLow.toFixed(2) + " ms") + " · tại 1 kHz: " + (QA6.gdAt1k === null ? "—" : QA6.gdAt1k.toFixed(2) + " ms") + (mode === "fir" ? " · hằng số ở mọi tần số (pha tuyến tính)" : "");
    var phVals, pMin, pMax, pTicks;
    if (QA6.unwrapped){
      phVals = d.phU.map(function(r){ return r*180/Math.PI; });
      pMin = Math.min.apply(null, phVals.concat([0])); pMax = Math.max.apply(null, phVals.concat([0]));
      var span = Math.max(90, pMax - pMin); pMin -= span*0.06; pMax += span*0.06;
      pTicks = [pMax - (pMax - pMin)*0.25, (pMax + pMin)/2, pMin + (pMax - pMin)*0.25];
    } else {
      phVals = d.phU.map(function(r){ return qaWrapDeg(r*180/Math.PI); });
      pMin = -180; pMax = 180; pTicks = [180, 90, 0, -90, -180];
    }
    qaDrawSmall($("qaPhaseCv"), d.freqs, phVals, { yMin: pMin, yMax: pMax, yTicks: pTicks, zero: 0,
      yFmt: function(v){ return Math.round(v) + "°"; }, color: "#3fd2dc", title: QA6.unwrapped ? "Phase (unwrapped)" : "Phase (wrapped)" });
    var gMax = Math.max(1.2, Math.max.apply(null, d.gdMs)*1.15);
    qaDrawSmall($("qaGdCv"), d.freqs, d.gdMs, { yMin: 0, yMax: gMax, yTicks: [gMax*0.98, gMax/2, 0], zero: 0,
      yFmt: function(v){ return v.toFixed(1); }, color: "#ffb224", title: "Group Delay (ms)",
      thresh: (mode === "iir" && gMax > 5) ? 5 : null, threshLbl: "ngưỡng cảnh báo 5 ms" });
    var warn = $("qaGdWarn");
    if (mode === "iir" && QA6.gdMaxLow !== null && QA6.gdMaxLow > 5){
      warn.style.display = "block";
      warn.innerHTML = "<b>Cảnh báo group delay:</b> ở chế độ Minimum-Phase, group delay đo được dưới 100 Hz đạt <b>" + QA6.gdMaxLow.toFixed(2) + " ms</b> (vượt ngưỡng 5 ms). Nguyên nhân: bộ lọc minimum-phase gắn liền độ lệch pha với đáp tuyến biên độ — boost/cắt bass mạnh ở tần số thấp (shelf/peaking Q cao) tạo trễ nhóm lớn ngay quanh tần số lọc. Hệ quả thực tế: tiếng bass “trễ nhịp” nhẹ và smearing thoáng qua ở dải trầm; đổi sang chế độ Linear-Phase FIR sẽ cho group delay hằng số " + (((firLen - 1)/2)/(fs)*1000).toFixed(2) + " ms ở mọi tần số (đổi lại là độ trễ tổng lớn hơn và có thể có pre-ringing), hoặc giảm gain/Q của band thấp nhất.";
    } else warn.style.display = "none";
  } catch (e) { /* đồ thị phụ không được phép làm hỏng đồ thị chính */ }
}
$("qaPhaseW").addEventListener("click", function(){ QA6.unwrapped = false; this.classList.add("on"); $("qaPhaseU").classList.remove("on"); qaDrawPhaseGd(); });
$("qaPhaseU").addEventListener("click", function(){ QA6.unwrapped = true; this.classList.add("on"); $("qaPhaseW").classList.remove("on"); qaDrawPhaseGd(); });
var qaOrigDrawGraph = drawGraph;
drawGraph = function(){ qaOrigDrawGraph(); qaDrawPhaseGd(); };

/* ---------------- Bản sao ngoại tuyến của chuỗi DSP (đo QA) ---------------- */
var QA_ID = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
function qaCoeffsFor(bandList, fs, opts){
  opts = opts || {};
  var list = bandList.map(function(b){
    return (!b.on || b.gain === 0) ? QA_ID : rbjCoeffs(b.type, b.freq, b.gain, b.q, fs);
  });
  if (opts.mutate){ var m = list[5], s = Math.pow(10, 0.5/20); list[5] = { b0: m.b0*s, b1: m.b1*s, b2: m.b2*s, a1: m.a1, a2: m.a2 }; }
  if (opts.psycho && typeof psychoCoeffs === "function") psychoCoeffs(fs).forEach(function(c){ list.push(c); });
  return list;
}
function qaCascade(xL, xR, coeffs){
  var nF = coeffs.length, N = xL.length;
  var yL = new Float64Array(N), yR = new Float64Array(N);
  var s1L = new Float64Array(nF), s2L = new Float64Array(nF), s1R = new Float64Array(nF), s2R = new Float64Array(nF);
  for (var n = 0; n < N; n++){
    var x = xL[n], y, b, c;
    for (b = 0; b < nF; b++){ c = coeffs[b]; y = c.b0*x + s1L[b]; s1L[b] = c.b1*x - c.a1*y + s2L[b]; s2L[b] = c.b2*x - c.a2*y; x = y; }
    yL[n] = x;
    x = xR[n];
    for (b = 0; b < nF; b++){ c = coeffs[b]; y = c.b0*x + s1R[b]; s1R[b] = c.b1*x - c.a1*y + s2R[b]; s2R[b] = c.b2*x - c.a2*y; x = y; }
    yR[n] = x;
  }
  return [yL, yR];
}
function qaCrossfeed(xL, xR, fs, mix, itdMs){
  var N = xL.length, yL = new Float64Array(N), yR = new Float64Array(N);
  var bufL = new Float64Array(256), bufR = new Float64Array(256), pos = 0, lpL = 0, lpR = 0;
  var itd = Math.max(1, Math.round(itdMs*fs/1000)), lpA = 1 - Math.exp(-2*Math.PI*6500/fs);
  for (var n = 0; n < N; n++){
    var xl = xL[n], xr = xR[n];
    var rIdx = (pos - itd + 256) % 256;
    var dR = bufR[rIdx], dL = bufL[rIdx];
    lpR += lpA*(dR - lpR); lpL += lpA*(dL - lpL);
    bufL[pos] = xl; bufR[pos] = xr; pos = (pos + 1) % 256;
    yL[n] = xl*(1 - 0.25*mix) + lpR*mix*0.85;
    yR[n] = xr*(1 - 0.25*mix) + lpL*mix*0.85;
  }
  return [yL, yR];
}
/* Bảng hệ số nội suy windowed-sinc x16 cho bản sao ngoại tuyến — cùng công
   thức với limCoefTable() trong worklet (bảng trong worklet không truy cập
   được từ main thread nên nhân bản tại đây; harness đối chiếu worklet với
   bản sao này trên cùng tín hiệu để bắt mọi lệch nhau). */
function limCoefTableMain(){
  var tab = [], p, b, d, sinc, u, w;
  for (p = 0; p < 16; p++){
    var row = [];
    for (b = 0; b <= 33; b++){
      d = b - 17 + p/16;
      sinc = (d === 0) ? 1 : Math.sin(Math.PI*d)/(Math.PI*d);
      u = d/16;
      w = (Math.abs(u) >= 1) ? 0 : (0.42 - 0.5*Math.cos(Math.PI*(u + 1)) + 0.08*Math.cos(2*Math.PI*(u + 1)));
      row.push(sinc*w);
    }
    tab.push(row);
  }
  return tab;
}
/* Bản sao ngoại tuyến của limiter trong worklet — cùng thuật toán từng bước:
   windowed-sinc x16, lookahead 128 mẫu, envelope mượt (cửa sổ 111 mẫu, dốc
   tối đa 0.005 dB/mẫu, release 0.0002/mẫu) luôn kẹp bởi đích của chính mẫu
   ra, chống tràn số ở đầu tầng. */
function qaLimiter(xL, xR){
  var LA = 128, N = xL.length, yL = new Float64Array(N), yR = new Float64Array(N);
  var dL = new Float64Array(LA), dR = new Float64Array(LA), tgt = new Float64Array(LA), pos = 0, i;
  for (i = 0; i < LA; i++) tgt[i] = 1;
  var coef = limCoefTableMain();
  var bufL = new Float64Array(64), bufR = new Float64Array(64), tpPos = 0, count = 0, gr = 1;
  var SLOPE = Math.pow(10, 0.005/20);
  var cRing = new Float64Array(256), rPow = new Float64Array(112), cr, rp;
  for (cr = 0; cr < 256; cr++) cRing[cr] = 1;
  rPow[0] = 1; for (rp = 1; rp < 112; rp++) rPow[rp] = rPow[rp - 1]*SLOPE;
  function sample(buf, back){ return buf[(tpPos - 1 - back + 128) % 64]; }
  for (var n = 0; n < N; n++){
    var xl = xL[n], xr = xR[n];
    if (!isFinite(xl)) xl = 0; else if (Math.abs(xl) < 1e-30) xl = 0;
    if (!isFinite(xr)) xr = 0; else if (Math.abs(xr) < 1e-30) xr = 0;
    bufL[tpPos] = xl; bufR[tpPos] = xr; tpPos = (tpPos + 1) % 64; count++;
    if (count >= 17){
      var tp = 0;
      for (var p = 0; p < 16; p++){
        var vL = 0, vR = 0, cf = coef[p];
        for (var b = 0; b <= 33; b++){
          var c = cf[b];
          if (c !== 0){ vL += c*sample(bufL, b); vR += c*sample(bufR, b); }
        }
        if (Math.abs(vL) > tp) tp = Math.abs(vL);
        if (Math.abs(vR) > tp) tp = Math.abs(vR);
      }
      var a0 = Math.abs(sample(bufL, 17)), a1 = Math.abs(sample(bufR, 17));
      var a2 = Math.abs(sample(bufL, 16)), a3 = Math.abs(sample(bufR, 16));
      if (a0 > tp) tp = a0; if (a1 > tp) tp = a1; if (a2 > tp) tp = a2; if (a3 > tp) tp = a3;
      var tg = (tp > CEIL_LIN) ? CEIL_LIN/tp : 1;
      if (tg < 0) tg = 0; if (tg > 1) tg = 1;
      tgt[(pos - 16 + LA) % LA] = tg;
    }
    if (count >= 18){
      var cT = Math.min(tgt[(pos - 17 + LA) % LA], tgt[(pos - 16 + LA) % LA]);
      cRing[(count - 18 + 256) % 256] = cT;
    }
    var oPos = pos;
    var oL = dL[oPos], oR = dR[oPos];
    dL[oPos] = xl; dR[oPos] = xr; pos = (oPos + 1) % LA;
    var oIdx = n - LA;
    var capC = cRing[((oIdx % 256) + 256) % 256];
    var aEnv = 1, ek, ecv;
    for (ek = 0; ek < 112; ek++){
      ecv = cRing[((oIdx + ek) % 256 + 256) % 256]*rPow[ek];
      if (ecv < aEnv) aEnv = ecv;
    }
    if (aEnv < gr) gr = aEnv; /* hạ: bám đúng aEnv (đã tự giới hạn dốc) */
    else gr += (aEnv - gr)*0.0002; /* lên: release chậm */
    if (gr > capC) gr = capC;
    yL[n] = oL*gr; yR[n] = oR*gr;
  }
  return [yL, yR];
}
/* Chuỗi đầy đủ: pre-amp → cascade EQ(+psycho) → crossfeed → limiter (đúng thứ tự worklet) */
function qaChain(xL, xR, fs, o){
  var pre = Math.pow(10, (o.preampDb || 0)/20), N = xL.length, i;
  var aL = new Float64Array(N), aR = new Float64Array(N);
  for (i = 0; i < N; i++){ aL[i] = xL[i]*pre; aR[i] = xR[i]*pre; }
  var out = qaCascade(aL, aR, qaCoeffsFor(o.bandList, fs, o));
  if (o.xf) out = qaCrossfeed(out[0], out[1], fs, o.xf.mix, o.xf.itdMs);
  if (o.limiter) out = qaLimiter(out[0], out[1]);
  return out;
}
function qaNoise(N, amp, seed){
  var x = new Float64Array(N), s = seed || 987654321;
  for (var i = 0; i < N; i++){ s = (s*1103515245 + 12345) % 2147483648; x[i] = (s/2147483648*2 - 1)*amp; }
  return x;
}
function qaRmsDbfs(x, a, b){
  var s = 0, n = 0;
  for (var i = a; i < b && i < x.length; i++){ s += x[i]*x[i]; n++; }
  if (!n || s === 0) return -Infinity;
  return 10*Math.log10(s/n);
}
function qaFlatBands(){ return FREQS.map(function(f, i){ return { freq: f, type: TYPES[i], gain: 0, q: DEFQ[i], on: true }; }); }
function qaCurBands(){ return bands.map(function(b){ return { freq: b.freq, type: b.type, gain: b.gain, q: b.q, on: b.on }; }); }
var QA_TEST_BANDS = [
  { freq: 105, type: "lowshelf", gain: 4, q: 0.707, on: true },
  { freq: 250, type: "peaking", gain: 0, q: 1, on: true },
  { freq: 500, type: "peaking", gain: -3, q: 1, on: true },
  { freq: 1000, type: "peaking", gain: 0, q: 1.41, on: true },
  { freq: 2000, type: "peaking", gain: 0, q: 1, on: true },
  { freq: 3000, type: "peaking", gain: 5, q: 1.2, on: true },
  { freq: 6000, type: "peaking", gain: 0, q: 1, on: true },
  { freq: 8000, type: "peaking", gain: 0, q: 1, on: true },
  { freq: 12000, type: "peaking", gain: 0, q: 1, on: true },
  { freq: 10000, type: "highshelf", gain: -2.5, q: 0.707, on: true }
];
