/* Web AutoEQ split module: 11-upgrades.js (nguon: khoi script L22905, L23310, L23642, L23958, L24110, L24254 cua ban 1 file) */

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
  var logF = new Array(n);
  for (j = 0; j < n; j++) logF[j] = Math.log(freqs[j]);
  /* (vòng tự động 16:54, hướng C — ÁP DỤNG, vá code): cửa sổ nhị phân trên lưới đã sắp — khi n >= 64, vals/freqs là mảng, freqs đủ dài và logF hữu hạn + tăng dần, tính halfEps MỘT lần/điểm (đúng số lần gọi widthFn như đường gốc) rồi tìm biên cửa sổ [L,R] bằng tìm kiếm nhị phân trên logF, hiệu chỉnh biên bằng đúng biểu thức Math.abs(logF[j]-li) <= halfEps của đường gốc; vòng cộng chỉ duyệt trong [L,R] theo thứ tự j tăng dần từ s=0 nên thứ tự cộng, phép chia s/c và kết quả giống từng bit với vòng O(n^2) gốc. Mọi trường hợp khác (lưới nhỏ/chưa sắp/NaN/vô cực, halfEps < 0 hoặc NaN cho out[i]=vals[i] như gốc, halfEps = Infinity lấy toàn lưới) rơi về đường gốc nguyên vẹn — hành vi ném lỗi và số lần gọi widthFn giữ nguyên. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench2.js, 2 lần chạy độc lập): 588/588 fixture GIỐNG TỪNG BIT (Object.is từng phần tử; gồm lưới 64..2000 điểm, ERB/1/3-oct/hằng/0/âm/NaN/Infinity/huge, chưa sắp, trùng tần số, biên 0/âm/NaN/Infinity, freqs ngắn, vals cực đoan NaN/±Inf/subnormal/1e308, cộng upErbSmooth/upGuardIntervals, số lần gọi widthFn 100/100, ném lỗi đúng TypeError/RangeError); tốc độ paired-median xen kẽ (bench2, 2 lần chạy độc lập, warmup 20 + 50 lần/timing): grid241-erb 3,61-3,83x, grid241-third 3,87-4,16x, grid481-erb 4,46-4,62x, grid2000-erb 6,10-6,25x, upErbSmooth 241 điểm 3,48-3,73x, 2000 điểm 6,23-6,34x — thắng 14-15/15 vòng mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. */
  if (n >= 64 && Array.isArray(vals) && Array.isArray(freqs) && freqs.length >= n){
    var _sorted = true, _k;
    for (_k = 0; _k < n; _k++){ if (!isFinite(logF[_k])){ _sorted = false; break; } if (_k > 0 && !(logF[_k-1] <= logF[_k])){ _sorted = false; break; } }
    if (_sorted){
      var _halves = new Array(n);
      for (_k = 0; _k < n; _k++) _halves[_k] = widthFn(freqs[_k]) / 2;
      for (i = 0; i < n; i++){
        var _halfEps = _halves[i] + 1e-12, _li = logF[i];
        if (!(_halfEps >= 0)){ out[i] = vals[i]; continue; }
        var _L, _R;
        if (_halfEps === Infinity){ _L = 0; _R = n - 1; }
        else {
          var _loB = _li - _halfEps, _hiB = _li + _halfEps, _a = 0, _b = n, _m;
          while (_a < _b){ _m = (_a + _b) >> 1; if (logF[_m] < _loB) _a = _m + 1; else _b = _m; }
          _L = _a; _a = 0; _b = n;
          while (_a < _b){ _m = (_a + _b) >> 1; if (logF[_m] <= _hiB) _a = _m + 1; else _b = _m; }
          _R = _a - 1;
          while (_L > 0 && Math.abs(logF[_L-1] - _li) <= _halfEps) _L--;
          while (_L <= i && !(Math.abs(logF[_L] - _li) <= _halfEps)) _L++;
          while (_R + 1 < n && Math.abs(logF[_R+1] - _li) <= _halfEps) _R++;
          while (_R >= i && !(Math.abs(logF[_R] - _li) <= _halfEps)) _R--;
        }
        var _s = 0, _c = 0, _kc = 0;
        for (j = _L; j <= _R; j++){ var _y = vals[j] - _kc; var _t = _s + _y; _kc = (_t - _s) - _y; _s = _t; _c++; } /* (vòng tự động 06:54, hướng C — ÁP DỤNG, vá code): tổng bù Kahan trong vòng cộng cửa sổ của upSmoothWidth (cả đường nhanh nhị phân và đường gốc) — trước đây cộng dồn ngây thơ theo thứ tự j tăng dần nên sai số tích lũy O(n·ε); nay dùng biến bù _kc/_kc2 (cùng mẫu Kahan đã áp cho se trong loudFitError) giữ nguyên thứ tự cộng và phép chia s/c, chỉ đổi cách tích lũy. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261127_0654_C/lab/, 2 lần chạy độc lập): sai số so với tham chiếu double-double trên fixture thực tế (lưới 1/24-oct, ERB/1/3-oct): meanAbsErr 7,87e-16 -> 1,90e-17 dB (41x), maxErr 5,33e-15 -> 3,55e-15 dB, thắng 1684/1700 điểm so kè (thua 16, hòa 782); fixture đối kháng (offset 1e16, triệt tiêu, dải động rộng): maxErr 1,0 -> 4,4e-16; tốc độ đường thực tế 0,961x/0,964x (chậm ~4%, hàm chỉ gọi khi bấm nút/smoothing). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Lượt kế: nhóm D. */ /* (vòng tự động 16:01, hướng C — ÁP DỤNG, vá code): bỏ kiểm tra thừa Math.abs(logF[j]-_li)<=_halfEps trong vòng cộng của đường nhanh upSmoothWidth — _L/_R đã được hiệu chỉnh bằng đúng biểu thức đó (vòng while L/R) nên mọi j trong [L,R] đều thỏa điều kiện (logF đã sắp tăng dần nên tập thỏa là khoảng liên tục chứa i; trường hợp cửa sổ rỗng L>R vòng không chạy; nhánh _halfEps=Infinity logF hữu hạn nên |diff|<=Infinity luôn đúng) — vòng cộng chỉ còn cộng trực tiếp, thứ tự cộng j tăng dần và phép chia s/c giữ nguyên nên giống từng bit theo cấu trúc. Lab Node trên hàm thật trích verbatim (extract_probe.py + harness_up.js + bench_main.js trong hidden_files/run_20261123_1554_C/, 2 lần chạy độc lập): parity 307/307 GIỐNG TỪNG BIT cả 2 lần (Object.is từng phần tử; gồm lưới 1..2000 điểm × 8 widthFn (ERB/1/3-oct/0/âm/-1e-13/NaN/Infinity/huge), chưa sắp/trùng tần số, NaN/Infinity ở tần số/giá trị, freqs ngắn, vals null/freqs null ném lỗi đúng loại cũ, 200 fuzz ngẫu nhiên, cộng upErbSmooth/upGuardIntervals); tốc độ main-context (JIT) paired-median xen kẽ 15 vòng: lần 1 erb241 1,1611x (14/15), third241 1,2017x (15/15), const01_241 1,0451x (14/15), erb481 1,2542x (15/15), third481 1,3521x (15/15), const01_481 1,1173x (15/15), erb2000 1,3736x (15/15), third2000 1,5540x (15/15), const01_2000 1,2300x (15/15); lần 2 erb241 1,1612x (14/15), third241 1,1868x (14/15), const01_241 1,0588x (15/15), erb481 1,2578x (15/15), third481 1,3497x (14/15), const01_481 1,1124x (15/15), erb2000 1,3587x (15/15), third2000 1,4269x (14/15), const01_2000 1,2946x (15/15) — cải thiện ổn định mọi workload cả 2 lần. Lưu ý: harness vm-context cho tỉ lệ phóng đại (interpreted) nên số liệu áp dụng lấy theo main-context JIT ở trên. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
        out[i] = _c ? _s / _c : vals[i];
      }
      return out;
    }
  }
  for (i = 0; i < n; i++){
    var half = widthFn(freqs[i]) / 2, s = 0, c = 0, li = logF[i], _kc2 = 0;
    var halfEps = half + 1e-12;
    for (j = 0; j < n; j++){
      if (Math.abs(logF[j] - li) <= halfEps){ var _ky2 = vals[j] - _kc2; var _kt2 = s + _ky2; _kc2 = (_kt2 - s) - _ky2; s = _kt2; c++; }
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
/* (vòng tự động 06:54, hướng C — ÁP DỤNG, vá code): hoist upInterp(calPts, 1000) ra khỏi vòng lặp — upMicCalAt tính lại upInterp(calPts, 1000) cho MỌI điểm đo dù giá trị này không đổi theo p (upInterp thuần xác định theo (calPts, 1000)); nay tính MỘT lần (lazy ở điểm đầu tiên để mảng rỗng giữ nguyên hành vi không gọi upInterp) rồi dùng lại trong p[1] - (upInterp(calPts, p[0]) - ref1000) — cùng toán hạng phép trừ nên giống từng bit. upMicCalAt giữ nguyên cho các caller khác. */
function upApplyMicCal(measPts, calPts){
  var ref1000, hasRef = false;
  /* (vòng tự động 08:54, hướng C — ÁP DỤNG, vá code): hai-con-trỏ cho lưới đo đã sắp xếp — khi measPts/calPts là mảng, measPts >= 128 điểm, calPts 2..2*measPts điểm và cả hai đã sắp tăng dần theo tần số, tính log tần số hiệu chuẩn MỘT lần (logCal) rồi duyệt measPts một lần với con trỏ p tiến đơn điệu qua calPts (largest index <= f, đúng định nghĩa lo của upInterp) thay vì tìm nhị phân + 4 lần Math.log cho MỖI điểm đo; nhánh biên f<=first / f>=last và biểu thức nội suy/tính hiệu chỉnh giữ nguyên từng toán hạng nên giống từng bit với upInterp. Mọi trường hợp khác (mảng ngắn, chưa sắp, NaN, cal rỗng/null, meas rỗng/null) rơi về đường map gốc nguyên vẹn — hành vi ném lỗi và lazy ref1000 giữ nguyên. Lab Node trên hàm thật trích verbatim (harness3.js, 2 lần chạy độc lập): 45/45 fixture GIỐNG TỪNG BIT (Object.is từng phần tử, gồm lưới 2000 điểm, cal 200 điểm, biên 0/âm/NaN/Infinity/1e308/subnormal, cal rỗng/null/undefined, 1 điểm, chưa sắp, NaN/Infinity/trùng tần số, mảng rỗng, meas null/undefined ném đúng TypeError cũ, cộng 22 fixture lớn kích hoạt nhanh: trùng tần số, NaN/Infinity ở giá trị, chưa sắp lớn, cal 2 điểm, biên cal, tần số cực nhỏ); khẳng định upSelfCheck1 (corr[1][1]=78) ĐẠT cả hai bản; tốc độ median 15 vòng xen kẽ: lần 1 W1 meas2000xcal200 1,919x, W2 meas2000xcal9 1,750x, W3 meas200xcal200 1,545x, W4 meas240xcal100 1,820x, W5 meas500xcal20 2,016x, W6 meas2000xcal2 1,488x; lần 2 W1 2,008x, W2 1,852x, W3 1,542x, W4 1,847x, W5 1,954x, W6 1,544x — thắng 13-15/15 vòng mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. */
  if (Array.isArray(measPts) && Array.isArray(calPts) && measPts.length >= 128 && calPts.length >= 2 && calPts.length <= measPts.length * 2){
    var _sorted = true, _si;
    for (_si = 1; _si < measPts.length; _si++) if (!(measPts[_si-1][0] <= measPts[_si][0])){ _sorted = false; break; }
    if (_sorted) for (_si = 1; _si < calPts.length; _si++) if (!(calPts[_si-1][0] <= calPts[_si][0])){ _sorted = false; break; }
    if (_sorted){
      var _logCal = new Array(calPts.length), _li2;
      for (_li2 = 0; _li2 < _logCal.length; _li2++) _logCal[_li2] = Math.log(calPts[_li2][0]);
      ref1000 = upInterp(calPts, 1000); hasRef = true;
      var _out = [], _p = 0, _mi;
      for (_mi = 0; _mi < measPts.length; _mi++){
        var _f = measPts[_mi][0], _v = measPts[_mi][1], _calAt;
        if (_f <= calPts[0][0]) _calAt = calPts[0][1];
        else if (_f >= calPts[calPts.length-1][0]) _calAt = calPts[calPts.length-1][1];
        else {
          while (_p + 1 < calPts.length && calPts[_p+1][0] <= _f) _p++;
          var _t = (Math.log(_f) - _logCal[_p]) / (_logCal[_p+1] - _logCal[_p]);
          _calAt = calPts[_p][1] + _t * (calPts[_p+1][1] - calPts[_p][1]);
        }
        _out.push([_f, _v - (_calAt - ref1000)]);
      }
      return _out;
    }
  }
  return measPts.map(function(p){ if (!hasRef){ ref1000 = upInterp(calPts, 1000); hasRef = true; } return [p[0], p[1] - (upInterp(calPts, p[0]) - ref1000)]; });
}
/* (vòng tự động 14:54, hướng C — ÁP DỤNG, vá code): hai-con-trỏ + log dùng chung cho lưới đo đã sắp xếp — khi lưới hợp nhất >= 64 tần số, tần số hợp nhất tăng dần và mọi lần đo không rỗng, đã sắp tăng dần, upAverageRunsFast tính log tần số hợp nhất MỘT lần (dùng chung cho mọi lần đo) và log tần số từng lần đo MỘT lần, rồi duyệt mỗi lần đo một lần với con trỏ tiến đơn điệu (largest index <= f, đúng định nghĩa lo của upInterp) thay vì tìm nhị phân + 3 lần Math.log cho MỖI cặp (tần số, lần đo); nhánh biên và biểu thức nội suy giữ nguyên từng toán hạng nên giống từng bit với upInterp. Mọi trường hợp khác (lưới nhỏ, chưa sắp, NaN, lần đo rỗng) rơi về đường gốc nguyên vẹn — hành vi ném lỗi giữ nguyên. Tách helper riêng để đường gốc không phình to (JIT). Lab Node trên hàm thật trích verbatim (extract.py + harness_final.js, 2 lần chạy độc lập): 44/44 fixture GIỐNG TỪNG BIT (Object.is sâu từng phần tử, gồm lưới 500/2000 điểm, jitter, phủ một phần, trùng tần số, biên 0/âm/NaN/Infinity/subnormal, giá trị 1e308, rỗng, 1 điểm, chưa sắp lớn, hỗn hợp sắp/chưa sắp); khẳng định upSelfCheck1 (trung bình năng lượng 81,1141) ĐẠT cả hai bản; tốc độ median 15 vòng xen kẽ: lần 1 big500x3 1,783x, jit500x4 2,408x, big2000x2 1,584x, big2000x4 1,850x, partial200x3 1,879x; lần 2 big500x3 1,754x, jit500x4 2,398x, big2000x2 1,570x, big2000x4 1,863x, partial200x3 1,866x — thắng 15/15 vòng mọi workload lớn cả 2 lần; input nhỏ 2 điểm parity (bench chuyên biệt có warmup 0,987x). Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. */
function upAverageRunsFast(runs, freqs, points, spreads){
  var _logF = new Array(freqs.length);
  for (var _fi = 0; _fi < freqs.length; _fi++) _logF[_fi] = Math.log(freqs[_fi]);
  var _runLog = new Array(runs.length);
  for (var _ri2 = 0; _ri2 < runs.length; _ri2++){
    var _rr = runs[_ri2], _lf = new Array(_rr.length);
    for (var _li = 0; _li < _lf.length; _li++) _lf[_li] = Math.log(_rr[_li][0]);
    _runLog[_ri2] = _lf;
  }
  var _valsByFreq = new Array(freqs.length);
  for (var _vi = 0; _vi < freqs.length; _vi++) _valsByFreq[_vi] = [];
  for (var _ri3 = 0; _ri3 < runs.length; _ri3++){
    var r = runs[_ri3], logR = _runLog[_ri3], p = 0;
    var r0 = r[0][0], rLast = r[r.length-1][0];
    for (var _fi2 = 0; _fi2 < freqs.length; _fi2++){
      var f = freqs[_fi2];
      if (f >= r0 && f <= rLast){
        if (f <= r0) _valsByFreq[_fi2].push(r[0][1]);
        else if (f >= rLast) _valsByFreq[_fi2].push(r[r.length-1][1]);
        else {
          while (p + 1 < r.length && r[p+1][0] <= f) p++;
          var t = (_logF[_fi2] - logR[p]) / (logR[p+1] - logR[p]);
          _valsByFreq[_fi2].push(r[p][1] + t * (r[p+1][1] - r[p][1]));
        }
      }
    }
  }
  for (var _fi3 = 0; _fi3 < freqs.length; _fi3++){
    var f = freqs[_fi3], vals = _valsByFreq[_fi3];
    if (!vals.length) continue;
    /* Trung bình NĂNG LƯỢNG (power-average) — nâng cấp 2026-10-31: trung
       bình số học trên dB luôn thấp hơn trung bình năng lượng khi các lần
       đo khác nhau (bất đẳng thức Jensen), và sai lệch lớn dần đúng ở
       vùng lệch nhiều nhất. Quy ước trung bình mức âm (như REW và các
       chuẩn đo SPL) là trung bình tuyến tính của 10^(dB/10) rồi đổi lại
       dB. Lệch 80/82 dB: số học cho 81,000 — năng lượng cho 81,115. */
    var s = 0; vals.forEach(function(v){ s += Math.pow(10, v / 10); });
    /* (vòng tự động 05:54, hướng C — ÁP DỤNG, vá code): chống tràn/tràn dưới trong trung bình năng lượng của upAverageRuns (đường nhanh upAverageRunsFast + đường gốc) — trước đây Math.pow(10, v/10) tràn về Infinity khi v > ~3080 dB (kể cả cặp 3080/3080 dB) cho mean=Infinity, tràn dưới về 0 khi v < ~-3080 dB cho mean=-Infinity, và vùng subnormal (~-3082 dB trở xuống) mất chính xác (vd [-3200,-3200] cho -3200,0000483 thay vì đúng -3200); nay chỉ khi tổng s rơi ngoài vùng chuẩn (s < 2,2250738585072014e-308 hoặc s === Infinity) và max hữu hạn mới tính lại bằng phép dịch theo max (mx + 10*log10(Σ10^((v-mx)/10)/n)) — mọi đầu vào thường và các ca NaN/±Infinity giữ nguyên từng bit theo cấu trúc. Lab (hidden_files/run_20261127_0554_C/lab/, hàm trích verbatim bằng extract.py + make_new.py, 2 lần chạy độc lập): parity 318/318 GIỐNG TỪNG BIT (gồm fixture upSelfCheck1, fuzz 300 ca, đường nhanh >=64 tần số, NaN/±Infinity/-0/subnormal/biên tràn); cực đoan 10/10 đúng giá trị hữu hạn (3080/3080: Infinity->3080; 4000/4002: ->4001,1141; 1e308/50: ->1e308; -3200 pair: -3200,0000483->-3200; -10000/-9990: -Infinity->-9992,5964; 3100/-3200: ->3096,9897; đường nhanh 4000/4002: ->4001,1141); tốc độ đường thường paired-median 0,9809x (trung tính trong nhiễu, hàm chỉ gọi khi bấm nút). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Lượt kế: nhóm D. */
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), mean;
    if (isFinite(s) && s >= 2.2250738585072014e-308) mean = 10 * Math.log10(s / vals.length);
    else if ((s < 2.2250738585072014e-308 || s === Infinity) && isFinite(mx)){ var _s2 = 0, _vi; for (_vi = 0; _vi < vals.length; _vi++) _s2 += Math.pow(10, (vals[_vi] - mx) / 10); mean = mx + 10 * Math.log10(_s2 / vals.length); }
    else mean = 10 * Math.log10(s / vals.length);
    points.push([f, mean]); spreads.push({ f: f, spread: mx - mn, n: vals.length });
  }
}
function upAverageRuns(runs){
  if (!runs || runs.length < 1) throw new Error("Cần ít nhất 1 lần đo.");
  var freqSet = {}, fi;
  runs.forEach(function(r){ r.forEach(function(p){ freqSet[p[0]] = true; }); });
  var freqs = Object.keys(freqSet).map(function(x){ return parseFloat(x); }).sort(function(a, b){ return a - b; });
  var points = [], spreads = [], warnings = [];
  var _fast = freqs.length >= 64;
  if (_fast){
    for (var _si = 1; _si < freqs.length; _si++) if (!(freqs[_si-1] <= freqs[_si])){ _fast = false; break; }
  }
  if (_fast){
    for (var _ri = 0; _ri < runs.length; _ri++){
      var _r = runs[_ri];
      if (!_r || !_r.length){ _fast = false; break; }
      for (var _k = 1; _k < _r.length; _k++) if (!(_r[_k-1][0] <= _r[_k][0])){ _fast = false; break; }
      if (!_fast) break;
    }
  }
  if (_fast) upAverageRunsFast(runs, freqs, points, spreads);
  else freqs.forEach(function(f){
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
    /* (vòng tự động 05:54, hướng C — ÁP DỤNG, vá code): chống tràn/tràn dưới trong trung bình năng lượng của upAverageRuns (đường nhanh upAverageRunsFast + đường gốc) — trước đây Math.pow(10, v/10) tràn về Infinity khi v > ~3080 dB (kể cả cặp 3080/3080 dB) cho mean=Infinity, tràn dưới về 0 khi v < ~-3080 dB cho mean=-Infinity, và vùng subnormal (~-3082 dB trở xuống) mất chính xác (vd [-3200,-3200] cho -3200,0000483 thay vì đúng -3200); nay chỉ khi tổng s rơi ngoài vùng chuẩn (s < 2,2250738585072014e-308 hoặc s === Infinity) và max hữu hạn mới tính lại bằng phép dịch theo max (mx + 10*log10(Σ10^((v-mx)/10)/n)) — mọi đầu vào thường và các ca NaN/±Infinity giữ nguyên từng bit theo cấu trúc. Lab (hidden_files/run_20261127_0554_C/lab/, hàm trích verbatim bằng extract.py + make_new.py, 2 lần chạy độc lập): parity 318/318 GIỐNG TỪNG BIT (gồm fixture upSelfCheck1, fuzz 300 ca, đường nhanh >=64 tần số, NaN/±Infinity/-0/subnormal/biên tràn); cực đoan 10/10 đúng giá trị hữu hạn (3080/3080: Infinity->3080; 4000/4002: ->4001,1141; 1e308/50: ->1e308; -3200 pair: -3200,0000483->-3200; -10000/-9990: -Infinity->-9992,5964; 3100/-3200: ->3096,9897; đường nhanh 4000/4002: ->4001,1141); tốc độ đường thường paired-median 0,9809x (trung tính trong nhiễu, hàm chỉ gọi khi bấm nút). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Lượt kế: nhóm D. */
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), mean;
    if (isFinite(s) && s >= 2.2250738585072014e-308) mean = 10 * Math.log10(s / vals.length);
    else if ((s < 2.2250738585072014e-308 || s === Infinity) && isFinite(mx)){ var _s2 = 0, _vi; for (_vi = 0; _vi < vals.length; _vi++) _s2 += Math.pow(10, (vals[_vi] - mx) / 10); mean = mx + 10 * Math.log10(_s2 / vals.length); }
    else mean = 10 * Math.log10(s / vals.length);
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
    var gi400 = 0, _best400 = Math.abs(Math.log(gf[0] / 400));
    for (var gj = 0; gj < gf.length; gj++){ var _cur400 = Math.abs(Math.log(gf[gj] / 400)); if (_cur400 < _best400){ _best400 = _cur400; gi400 = gj; } } /* (vòng tự động 12:06, hướng C — ÁP DỤNG, vá code): cache giá trị tốt nhất _best400 trong vòng tìm gi400 của upSelfCheck1 — Math.abs(Math.log(gf[gi400]/400)) chỉ đổi khi gi400 đổi nên tính MỘT lần rồi cập nhật khi gi400 đổi, thay vì tính lại mỗi vòng lặp; Math.log thuần xác định theo input double nên _best400 đúng giá trị tính lại từng bit, phép so sánh < và thứ tự duyệt giữ nguyên nên gi400 giống từng bit (kể cả lưới rỗng: gf[0]=undefined cho NaN, vòng không chạy, gi400=0 như gốc). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_1206_C/, 2 lần bench độc lập): parity 528/528 GIỐNG TỪNG BIT cả 2 lần (Object.is trên gi400 + upSelfCheck1 {pass,total,msgs} 7/7 PASS; gồm lưới thật 97 điểm, lưới đảo, ±epsilon, trùng/không sắp, rỗng/1 phần tử, NaN/±Infinity/-0/subnormal/1e308, 500 fuzz); tốc độ paired-median xen kẽ 15 vòng: upSelfCheck1 đầy đủ lần 1 1,0846x thắng 14/15, lần 2 1,0838x thắng 14/15; vòng gi400 riêng lần 1 1,5735x, lần 2 1,5952x thắng 15/15 cả 2 lần — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
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
  /* (vòng tự động 19:24, hướng C — ÁP DỤNG, vá code): gộp 3 lần quét trong upBandProfileGain thành MỘT lần quét — trước đây avgRegion được tạo và chạy 3 lần, mỗi lần quét toàn bộ bands, tạo closure và kiểm tra lại guard (!b || on===false || !isFinite(gain)) cho mọi band; nay một vòng forEach duy nhất tích lũy sB/sE/sT và đếm nB/nE/nT, mỗi vùng cộng gain theo đúng thứ tự band như vòng riêng tương ứng (thứ tự cộng từng vùng không đổi) và giữ nguyên đúng biểu thức điều kiện từng vùng (bass: freq<=250 || type==="lowshelf"; ear: 2000<=freq<=4000; treble: freq>=6000 || type==="highshelf") nên bass/treble/ear và counts GIỐNG TỪNG BIT theo cấu trúc; hình dạng object trả về và thứ tự khóa giữ nguyên. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_1924_C/lab/, 2 lần bench độc lập): parity 3013/3013 GIỐNG TỪNG BIT cả 2 lần (Object.is sâu gồm thứ tự khóa; null/undefined/rỗng/mảng thưa/frozen, band null/undefined/nguyên/chuỗi, on false/true/0, freq/gain biên NaN/Infinity/-0/1e308/chuỗi/null, 3000 fuzz); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 n20 5,7545x (15/15), W2 n200 6,0964x (15/15), W3 n2000 6,8049x (15/15), W4 6,4626x (15/15); lần 2 W1 5,6024x, W2 6,3252x, W3 6,4094x, W4 6,3509x (15/15 cả 4) — cải thiện ổn định mọi workload cả 2 lần, acc khớp tuyệt đối mọi vòng. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
  var sB = 0, nB = 0, sE = 0, nE = 0, sT = 0, nT = 0;
  (bands || []).forEach(function(b){
    if (!b || b.on === false || !isFinite(b.gain)) return;
    if (b.freq <= 250 || b.type === "lowshelf"){ sB += b.gain; nB++; }
    if (b.freq >= 2000 && b.freq <= 4000){ sE += b.gain; nE++; }
    if (b.freq >= 6000 || b.type === "highshelf"){ sT += b.gain; nT++; }
  });
  return { bass: nB ? sB / nB : 0, treble: nT ? sT / nT : 0, ear: nE ? sE / nE : 0, counts: { bass: nB, ear: nE, treble: nT } };
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
/* (vòng tự động 22:24, hướng C — ÁP DỤNG, vá code, bản đa file): gộp 6 lượt quét trong upPersonalFromRatings thành MỘT vòng — trước đây wmean/umean mỗi hàm quét toàn bộ list 3 lần (bass/treble/ear, tổng 6 vòng + 8 closure mỗi lần gọi); nay một vòng forEach duy nhất tích lũy 6 tổng (sWB/sWT/sWE/wSum/sUB/sUT/sUE), mỗi tổng cộng theo đúng thứ tự danh sách như vòng riêng tương ứng nên mọi giá trị weighted/unweighted/deltas GIỐNG TỪNG BIT theo cấu trúc; phép chia, kẹp up2Clamp, hình dạng và thứ tự khóa object trả về giữ nguyên. Lab (hidden_files/run_20261124_2224_C/lab/, extract verbatim + harness.js + bench.js, 2 lần bench độc lập): parity 3018/3018 GIỐNG TỪNG BIT (Object.is sâu; gồm fixture upSelfCheck2, null/undefined/rỗng/1 phần tử ném lỗi đúng loại cũ, rating ngoài 1–5/bỏ lọc, profile NaN/±Infinity/-0/subnormal/1e308/thiếu khóa/chuỗi/số, input không phải mảng, 3000 fuzz, n=20/200/2000); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 n2 2,9981x (15/15), W2 n20 3,7833x (15/15), W3 n200 3,5511x (15/15), W4 n2000 3,5523x (15/15); lần 2 W1 2,3384x (15/15), W2 3,6739x (15/15), W3 3,6300x (15/15), W4 3,5294x (15/15) — cải thiện ổn định mọi workload cả 2 lần, acc khớp tuyệt đối mọi vòng. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
function upPersonalFromRatings(items){
  var list = (items || []).filter(function(it){
    return it && it.profile && isFinite(it.rating) && it.rating >= 1 && it.rating <= 5;
  });
  if (list.length < 2) throw new Error("Cần ít nhất 2 ứng viên đã chấm điểm (1–5) mới suy ra được target cá nhân.");
  var sWB = 0, sWT = 0, sWE = 0, wSum = 0, sUB = 0, sUT = 0, sUE = 0;
  list.forEach(function(it){
    var r = it.rating, p = it.profile;
    sWB += r * p.bass; sWT += r * p.treble; sWE += r * p.ear; wSum += r;
    sUB += p.bass; sUT += p.treble; sUE += p.ear;
  });
  var weighted = { bass: sWB / wSum, treble: sWT / wSum, ear: sWE / wSum };
  var unweighted = { bass: sUB / list.length, treble: sUT / list.length, ear: sUE / list.length };
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
/* (vòng tự động 06:54 ngày 2026-11-24, hướng C — ÁP DỤNG, vá code, bản đa file): gộp 8 vòng lặp trong upSolverReport thành MỘT vòng — trước đây dựng mảng errB/errA (1 vòng) rồi gọi rms() 4 lần và maxAbs() 2 lần, mỗi lần quét lại toàn bộ lưới tần số (6 vòng nữa); nay vòng duy nhất tính eB=tgt[i]-sm[i] và eA=tgt[i]-(sm[i]+total[i]) đúng biểu thức/thứ tự gốc (kể cả trước phép kiểm tra >10000 Hz nên hành vi ném lỗi giữ nguyên), tích lũy 6 bộ tổng RMS (sB/sA/sWB/sWA + đếm cB + tổng trọng số wsB/wsA) và 2 cực đại tuyệt đối (mxB/mfB, mxA/mfA) theo thứ tự i tăng dần — mỗi bộ tổng giữ nguyên thứ tự cộng của vòng riêng tương ứng nên mọi trường rmsBefore/rmsAfter/wrmsBefore/wrmsAfter/maxBefore/maxAfter GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/±Infinity/-0, trọng số rỗng/ngắn, lưới rỗng/toàn >10 kHz, bands/guard/clamped giữ nguyên). Lab (hidden_files/run_20261124_0654_C/, extract verbatim + harness.js + bench.js, 2 lần bench độc lập): parity 3111/3111 GIỐNG TỪNG BIT cả 2 lần (Object.is sâu; gồm fixture upSelfCheck3, lưới 241/481/881/2000 điểm có/không trọng số, bands/guard/clamped, biên 10000 Hz, trọng số 0/NaN/rỗng/ngắn, mảng thưa, sm/tgt null ném lỗi đúng loại cũ, quét đặc biệt 0/-0/NaN/±Infinity/1e308/subnormal ở mọi trường, chuỗi ép kiểu, 3000 fuzz); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 grid241 5,5059x (15/15), W2 grid881 5,6106x (15/15), W3 grid241+w 5,8569x (15/15), W4 grid881+w 6,6009x (15/15); lần 2 W1 5,5378x (15/15), W2 5,4726x (15/15), W3 6,2586x (15/15), W4 6,2244x (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm D. --- */
function upSolverReport(args){
  args = args || {};
  var freqs = args.freqs || [], sm = args.sm || [], tgt = args.tgt || [], total = args.total || [];
  var weights = args.weights || null;
  var sB = 0, sA = 0, cB = 0, sWB = 0, wsB = 0, sWA = 0, wsA = 0, mxB = 0, mfB = 0, mxA = 0, mfA = 0;
  for (var i = 0; i < freqs.length; i++){
    var eB = tgt[i] - sm[i], eA = tgt[i] - (sm[i] + total[i]);
    if (freqs[i] > 10000) continue;
    sB += eB * eB; sA += eA * eA; cB++;
    if (weights){
      var wi = weights[i];
      sWB += wi * eB * eB; wsB += wi; sWA += wi * eA * eA; wsA += wi;
    }
    var aB = Math.abs(eB); if (aB > mxB){ mxB = aB; mfB = freqs[i]; }
    var aA = Math.abs(eA); if (aA > mxA){ mxA = aA; mfA = freqs[i]; }
  }
  var deep = [];
  (args.bands || []).forEach(function(b){
    if (!b || !(b.gain >= 6)) return;
    var inGuard = false;
    (args.guard || []).forEach(function(g){ if (b.freq >= g.fLo && b.freq <= g.fHi) inGuard = true; });
    if (inGuard) deep.push({ freq: b.freq, gain: b.gain, reason: "boost >= 6 dB trong vùng guard lõm sâu của đường thô" });
  });
  return { rmsBefore: cB ? Math.sqrt(sB / cB) : 0, rmsAfter: cB ? Math.sqrt(sA / cB) : 0,
    wrmsBefore: weights ? (cB ? Math.sqrt(sWB / wsB) : 0) : null, wrmsAfter: weights ? (cB ? Math.sqrt(sWA / wsA) : 0) : null,
    maxBefore: { v: mxB, f: mfB }, maxAfter: { v: mxA, f: mfA }, deepBoost: deep, clamped: args.clamped || [] };
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
  /* (vòng tự động 12:26, hướng C — ÁP DỤNG, vá code): cache kết quả các hàm thuần trong upSelfCheck3 — trước đây mỗi cặp điều kiện + chuỗi detail JSON.stringify gọi lại upNormalizeRig/upExtractDate/upTargetRig/upRigCheck/upNormalizeMeasurement với ĐÚNG đối số (21 lần gọi cho 10 giá trị phân biệt, gồm upTargetRig("harmanOE") 4 lần); nay tính MỘT lần vào biến cục bộ rồi dùng lại — các hàm này thuần xác định theo đối số (không đọc/ghi trạng thái ngoài, không mutate đối số) nên giá trị dùng lại giống từng bit với tính lại, kể cả chuỗi JSON.stringify của cùng object; thứ tự đánh giá các ck() và nội dung detail giữ nguyên. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_1226_C/, 2 lần bench độc lập): parity 200/200 GIỐNG TỪNG BIT ({pass,total,msgs} 12/12 PASS) + purity fuzz 106/106; tốc độ paired-median xen kẽ 15 vòng: lần 1 median 1,2619x thắng 13/15 (vòng 13-14 nhiễu VM), lần 2 median 1,2617x thắng 15/15 — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    var _nrA = upNormalizeRig("GRAS RA0045"), _nrB = upNormalizeRig("B&K 5128"), _nrC = upNormalizeRig("squiglink crinacle");
    var _dA = upExtractDate("đo ngày 2026-10-28"), _dB = upExtractDate("28/10/2026");
    var _trOE = upTargetRig("harmanOE"), _trJm = upTargetRig("jm1");
    var _rcA = upRigCheck("5128", "harmanOE"), _rcB = upRigCheck("711", "harmanOE");
    var _nm = upNormalizeMeasurement({ headphone: "HD 600", rig: "GRAS 711", source: "oratory1990 2026-10-28", points: [[1000, 80]] });
    ck("rig 711 từ RA0045", _nrA.code === "711", JSON.stringify(_nrA));
    ck("rig 5128", _nrB.code === "5128", JSON.stringify(_nrB));
    ck("rig không đoán từ Squig", _nrC.code === "other", JSON.stringify(_nrC));
    ck("ngày ISO", _dA === "2026-10-28", String(_dA));
    ck("ngày DD/MM/YYYY", _dB === "2026-10-28", String(_dB));
    ck("target rig harmanOE=711, jm1=5128", _trOE === "711" && _trJm === "5128", _trOE + "/" + _trJm);
    ck("phát hiện trộn rig", _rcA.status === "mismatch" && _rcA.suggestedTarget === "jm1", JSON.stringify(_rcA));
    ck("cùng rig OK", _rcB.status === "ok", JSON.stringify(_rcB));
    var rep = upSolverReport({ freqs: [100, 1000, 5000], sm: [0, 2, 0], tgt: [0, 0, 0], total: [0, -1, 0],
      weights: [1, 1, 1], bands: [{ freq: 3000, gain: 8, q: 1 }], guard: [{ fLo: 2500, fHi: 3500 }] });
    ck("báo cáo RMS trước/sau", Math.abs(rep.rmsBefore - Math.sqrt(4 / 3)) < 1e-9 && Math.abs(rep.rmsAfter - Math.sqrt(1 / 3)) < 1e-9, JSON.stringify(rep));
    ck("báo cáo lỗi lớn nhất", rep.maxBefore.v === 2 && rep.maxAfter.v === 1, JSON.stringify(rep.maxBefore) + "/" + JSON.stringify(rep.maxAfter));
    ck("phạt boost sâu", rep.deepBoost.length === 1, JSON.stringify(rep.deepBoost));
    ck("chuẩn hoá measurement", _nm.rig === "711" && _nm.date === "2026-10-28" && _nm.headphone === "HD 600", JSON.stringify(_nm));
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
/* (vòng tự động 16:56, hướng C — ÁP DỤNG, vá code): hoist cos(2w)/sin(2w) trong upBiquadPhaseRad (js/11-upgrades.js) — trước đây Math.cos(2*w) và Math.sin(2*w) tính 2 lần mỗi lần gọi (một lần cho nr/ni, một lần cho dr/di) dù đối số giống hệt; nay tính MỘT lần vào c2/s2 rồi dùng lại — Math.cos/sin thuần xác định theo input double nên giá trị dùng lại giống từng bit, thứ tự phép tính và biểu thức atan2 giữ nguyên từng toán hạng. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_1654_C/lab/, 2 lần bench độc lập): parity 50.113/50.113 GIỐNG TỪNG BIT cả 2 lần (Object.is; gồm 6 loại RBJ × gain/Q + coeff biên null/undefined/rỗng/NaN/±Infinity/±0/subnormal × 18 tần số × 9 fs); tốc độ paired-median xen kẽ 15 vòng: lần 1 1,1106x thắng 15/15, lần 2 1,0835x thắng 14/15 — cải thiện ổn định cả 2 lần. Phần hoist sqrt(G) trong upDecrampedPeakingCoeffs đo 2 lần đều trung tính (0,9983x/0,9996x, thắng 7/15) nên KHÔNG áp dụng. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
function upBiquadPhaseRad(c, f, fs){
  var w = 2 * Math.PI * f / fs, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  var nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2);
  var dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2);
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
    var _cnMag = biquadMagDb(cn, 1000, FS); /* (vòng tự động 14:54, hướng C — ÁP DỤNG, vá code): cache kết quả biquadMagDb(cn,1000,FS) trong upSelfCheck4 — trước đây giá trị này được tính 2 lần (một lần trong điều kiện ck "notch triệt sâu tại fc" và một lần nữa trong chuỗi detail .toFixed(1)); nay tính MỘT lần vào _cnMag rồi dùng lại cho cả điều kiện lẫn detail — biquadMagDb thuần xác định theo (c, freq, fs) (chỉ đọc trường hệ số, không đọc/ghi trạng thái, không mutate đối số) nên giá trị dùng lại giống từng bit với tính lại, toFixed trên cùng double cho cùng chuỗi, thứ tự đánh giá các ck() và nội dung detail giữ nguyên. Tương tự áp cho clp@4000 và chp@250 ở dưới. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261125_1454_C/lab/, 4 lần bench độc lập): parity 50/50 lần chạy GIỐNG TỪNG BIT (Object.is sâu {pass,total,msgs}, 11/11 PASS), số lần gọi biquadMagDb trong upSelfCheck4 137 -> 134 (bỏ 3 lần gọi trùng: cn@1000, clp@4000, chp@250); tốc độ paired-median xen kẽ 15 vòng trên upSelfCheck4 đầy đủ: lần 1 1,0167x thắng 11/15, lần 2 1,0146x thắng 12/15, lần 3 1,0293x/1,0210x, lần 4 1,0377x/0,9839x (VM nhiễu) — median cải thiện ổn định, không hồi quy có hệ thống. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    ck("notch triệt sâu tại fc", _cnMag <= -100, _cnMag.toFixed(1) + " dB");
    ck("notch trong suốt ngoài dải", Math.abs(biquadMagDb(cn, 100, FS)) < 0.05 && Math.abs(biquadMagDb(cn, 10000, FS)) < 0.05);
    var ca = rbjCoeffs("allpass", 1000, 0, 2, FS), mx = 0;
    [50, 500, 1000, 5000, 15000].forEach(function(f){ mx = Math.max(mx, Math.abs(biquadMagDb(ca, f, FS))); });
    ck("allpass phẳng tuyệt đối", mx < 1e-11, "max " + mx.toExponential(1) + " dB");
    ck("allpass pha -180 độ tại fc", Math.abs(upBiquadPhaseRad(ca, 1000, FS) + Math.PI) < 1e-9);
    var clp = rbjCoeffs("lowpass", 1000, 0, 0.7071, FS), chp = rbjCoeffs("highpass", 1000, 0, 0.7071, FS);
    var _clpMag = biquadMagDb(clp, 4000, FS), _chpMag = biquadMagDb(chp, 250, FS);
    ck("lowpass -3.01 dB tại fc, ~-24 dB tại 4 kHz", Math.abs(biquadMagDb(clp, 1000, FS) + 3.01) < 0.05 && Math.abs(_clpMag + 24) < 0.6,
       _clpMag.toFixed(2) + " dB");
    ck("highpass -3.01 dB tại fc, ~-24 dB tại 250 Hz", Math.abs(biquadMagDb(chp, 1000, FS) + 3.01) < 0.05 && Math.abs(_chpMag + 24) < 0.6,
       _chpMag.toFixed(2) + " dB");
    /* (vòng tự động 11:24, hướng C — ÁP DỤNG, vá code): tiền tính lưới tần số + giá trị tham chiếu analog MỘT lần theo (f0,g,q) trong rmsErr của upSelfCheck4 — trước đây mỗi lần gọi đều tính lại 61 tần số f=14000*pow(20000/14000, i/60) và 61 lần upAnalogPeakingMagDb(f0,g,q,f) dù hai lần gọi trong upSelfCheck4 dùng cùng (14000,8,1.5); nay cache _rmsRefCache khóa theo === từng thành phần (NaN luôn miss nên tính lại như gốc), biểu thức tính f và giá trị analog giữ nguyên từng toán hạng nên mọi e và phép tích lũy s GIỐNG TỪNG BIT theo cấu trúc; chữ ký rmsErr(c,f0,g,q) không đổi. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench2.js trong hidden_files/run_20261124_1124_C/, 3 lần bench độc lập): parity upSelfCheck4 5/5 GIỐNG TỪNG BIT + fuzz rmsErr 718/718 GIỐNG TỪNG BIT (Object.is; gồm biên NaN/Infinity/-0/1e308/subnormal, 300 fuzz ngẫu nhiên, gọi lặp để kích hoạt đường cache hit); tốc độ paired-median xen kẽ 15 vòng: lần 1 1,0485x thắng 10/15, lần 2 1,0583x thắng 13/15, lần 3 1,0543x thắng 12/15 — cải thiện ổn định ~5% cả 3 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    var _rmsRefCache = [];
    function rmsErr(c, f0, g, q){
      var _hit = null, _ci;
      for (_ci = 0; _ci < _rmsRefCache.length; _ci++){
        var _ce = _rmsRefCache[_ci];
        if (_ce.f0 === f0 && _ce.g === g && _ce.q === q){ _hit = _ce; break; }
      }
      if (!_hit){
        var _gf = [], _gr = [];
        for (var _gi = 0; _gi <= 60; _gi++){ var _f = 14000 * Math.pow(20000 / 14000, _gi / 60); _gf.push(_f); _gr.push(upAnalogPeakingMagDb(f0, g, q, _f)); }
        _hit = { f0: f0, g: g, q: q, gf: _gf, gr: _gr };
        _rmsRefCache.push(_hit);
      }
      var s = 0, n = 0;
      for (var i = 0; i <= 60; i++){ var e = biquadMagDb(c, _hit.gf[i], FS) - _hit.gr[i]; s += e * e; n++; }
      return Math.sqrt(s / n);
    }
    var eStd = rmsErr(rbjCoeffs("peaking", 14000, 8, 1.5, FS), 14000, 8, 1.5);
    var eDec = rmsErr(upDecrampedPeakingCoeffs(14000, 8, 1.5, FS), 14000, 8, 1.5);
    ck("decramped giảm sai số sườn trên >= 40%", eDec <= 0.6 * eStd, "RBJ " + eStd.toFixed(3) + " -> decramped " + eDec.toFixed(3) + " dB RMS");
    var bad = 0;
    /* (vòng tự động 10:24, hướng C — ÁP DỤNG, vá code): lưới Jury trong upSelfCheck4 tính rbjCoeffs 160 lần (8 họ × 5 tần số × 2 gain × 2 Q) dù 5 họ lowpass/highpass/bandpass/notch/allpass không dùng gainDb trong rbjCoeffs (các nhánh đó chỉ phụ thuộc freq/Q/fs) nên cặp gain ±12 dB cho cùng hệ số từng bit — 50/160 lần gọi là trùng lặp. Nay dò gain-free bằng phép thử trực tiếp (so sánh hệ số tại gain -12/+12 cho từng họ, chỉ bật khi khớp tuyệt đối từng trường — nếu rbjCoeffs đổi để dùng gain thì tự rơi về đường gốc) rồi tính hệ số MỘT lần cho mỗi (họ, tần số, Q) và kiểm tra Jury 2 lần (mỗi gain một lần như cũ, thứ tự đếm bad không đổi) cho các họ gain-free; họ peaking/lowshelf/highshelf giữ nguyên 2 lần tính. upIsBiquadStable thuần đọc nên dùng lại object hệ số không đổi kết quả. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_1024_C/lab/, 2 lần bench độc lập): parity upSelfCheck4 11/11 PASS giống từng bit cả 2 lần (Object.is sâu {pass,total,msgs}), bad Jury 0==0, kiểm chứng gain-independence trên toàn lưới 5 họ × 5 tần số × 2 Q: 0 vi phạm; tốc độ paired-median xen kẽ 15 vòng: upSelfCheck4 đầy đủ lần 1 1,1285x thắng 13/15, lần 2 1,1325x thắng 14/15; đoạn Jury riêng lần 1 1,4160x, lần 2 1,4165x thắng 15/15 cả 2 lần — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    /* (vòng tự động 12:54, hướng C — ÁP DỤNG, vá code): lưới Jury trong upSelfCheck4 kiểm tra Jury 2 lần trên cùng object hệ số _c cho các họ gain-free (mô phỏng cặp gain ±12 dB) — upIsBiquadStable thuần đọc nên lần gọi thứ hai trên cùng _c luôn trả cùng kết quả; nay gọi MỘT lần và cộng bad += 2 khi không ổn định (tương đương hai lần bad++), bỏ 50/160 lần gọi upIsBiquadStable thừa mỗi lần tự kiểm. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_1254_C/lab/, 2 lần bench độc lập, đo qua require để V8 tối ưu đúng): parity upSelfCheck4 11/11 PASS GIỐNG TỪNG BIT cả 2 lần (Object.is sâu {pass,total,msgs}), bad Jury 0==0, kiểm chứng logic bad+=2 tương đương hai lần bad++ trên cả nhánh ổn định/không ổn định (mock) và đếm số lần gọi ổn định 160→110; tốc độ paired-median xen kẽ 15 vòng: đoạn Jury riêng lần 1 1,0297x thắng 15/15, lần 2 1,0297x thắng 15/15 (đo lại 1,0776x/15-15 ở lần đo đầu qua eval bị V8 làm chậm rbjCoeffs 10x nên chỉ dùng làm đối chứng); upSelfCheck4 đầy đủ lần 1 1,0086x thắng 13/15, lần 2 1,0114x thắng 14/15 — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    var _juryGainFree = {}, _juryProbeA = {};
    ["lowpass","highpass","bandpass","notch","allpass"].forEach(function(_ty){
      var _a = rbjCoeffs(_ty, 1000, -12, 0.5, FS), _b = rbjCoeffs(_ty, 1000, 12, 0.5, FS);
      _juryGainFree[_ty] = (_a.b0 === _b.b0 && _a.b1 === _b.b1 && _a.b2 === _b.b2 && _a.a1 === _b.a1 && _a.a2 === _b.a2);
      _juryProbeA[_ty] = _a;
    }); /* (vòng tự động 20:54, hướng C — ÁP DỤNG, vá code): tái dùng hệ số dò gain-free trong lưới Jury của upSelfCheck4 — bước dò gain-free trước đây tính rbjCoeffs(ty,1000,±12,q=1) cho 5 họ rồi bỏ _a đi, trong khi lưới Jury lại tính lại rbjCoeffs(ty,1000,-12,q=0.5) cho đúng 5 họ gain-free đó; nay dò tại q=0.5 (đúng q của lưới tại fc=1000) và lưu _a vào _juryProbeA để vòng Jury dùng lại khi fc===1000 && q===0.5, bỏ 5/133 lần gọi rbjCoeffs mỗi lần tự kiểm. rbjCoeffs thuần xác định theo đối số nên object dùng lại có đúng trường/giá trị từng bit với object tính lại, upIsBiquadStable chỉ đọc nên bad và thứ tự đếm không đổi; phép dò gain-free tại q=0.5 cho cùng kết quả với q=1 cho cả 5 họ (đã kiểm chứng trong lab) vì các họ này không dùng gainDb ở bất kỳ q nào. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_2054_C/lab/, 3 lần bench độc lập): parity upSelfCheck4 5/5 GIỐNG TỪNG BIT (Object.is sâu {pass,total,msgs} 11/11 PASS), số lần gọi rbjCoeffs 133->128; tốc độ paired-median xen kẽ 15 vòng trên upSelfCheck4 đầy đủ: lần 1 1,0055x thắng 10/15, lần 2 1,0223x thắng 13/15, lần 3 1,0275x thắng 15/15 — median dương cả 3 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    types.forEach(function(ty){
      var _gf = _juryGainFree[ty];
      [20, 100, 1000, 16000, 20000].forEach(function(fc){ [0.5, 10].forEach(function(q){
        if (_gf){
          var _c = (fc === 1000 && q === 0.5) ? _juryProbeA[ty] : rbjCoeffs(ty, fc, -12, q, FS);
          if (!upIsBiquadStable(_c)) bad += 2;
        } else {
          if (!upIsBiquadStable(rbjCoeffs(ty, fc, -12, q, FS))) bad++;
          if (!upIsBiquadStable(rbjCoeffs(ty, fc, 12, q, FS))) bad++;
        }
      }); });
    });
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
function iso2003SplIdxX(i, X){
  var af = AF03[i], lu = LU03[i];
  var Af = 4.47e-3*(X - 1.15) + ISO03_POW[i];
  if (!(Af > 0) || !isFinite(Af)) Af = 1e-12;
  return (10/af)*Math.log10(Af) - lu + 94;
}
/* --- Mở rộng 2026-11-24 (vòng tự động 01:24, hướng C — ÁP DỤNG, vá code): Lượt nhóm C (sau B 00:54, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 00:58:36+07, 6.296.607 byte / 25.465 dòng (wc -l), md5 ae49a1f3fd1184414dd2a1c55fe5d7c3, version 376) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-C lưu tại ~/workspace/autoeq/backups/2026-11-24_0124_before.html và _pre-download.html. Ứng viên C duy nhất: nhánh ft===0/ft===1 trong iso2003Spl (cùng mẫu vá isoSpl 20:54 ngày 2026-11-22) — khi hệ số nội suy log-tần số đúng 0 hoặc 1 (tức f trùng điểm lưới ISO: ft tính bằng (log f − ISO_LOG_FREQS[fi])/ISO_LOG_SPAN[fi] cho đúng 0 khi f===ISO_FREQS[fi] và đúng 1 khi f===ISO_FREQS[fi+1] vì tử số bằng mẫu số cùng toán hạng) thì trả thẳng iso2003SplIdxX của điểm lưới tương ứng thay vì đánh giá cả 2 điểm rồi nhân (1−ft)/ft — bỏ 1 lần iso2003SplIdxX (log10) mỗi lần gọi tại các tần số lưới ISO; iso2003SplIdxX luôn hữu hạn trên toàn lưới (AF03 trong [0.242,0.532], Af kẹp 1e-12, log10 hữu hạn) nên v·0+v'·1 = v' từng bit. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_0124_C/, 2 lần chạy độc lập): parity 8605/8605 GIỐNG TỪNG BIT cả 2 lần (Object.is; gồm phon 0–90 bước 0,5 × 29 tần số ISO + biên ngoài miền/NaN/Infinity/cực đoan/subnormal, lưới 1/24-oct 20–12.500 Hz, tần số ISO ± epsilon, chuỗi/null/undefined, 500 fuzz; neo 60 phon @1kHz 60,011588 dB và 20 Hz 89,578083/109,511322/118,990011 dB không đổi); tốc độ paired-median xen kẽ 15 vòng: grid91x29 lần 1 1,2343x thắng 15/15, lần 2 1,2415x thắng 15/15; singleGrid lần 1 1,2244x thắng 15/15, lần 2 1,2197x thắng 15/15; đường nội suy trung tính ~1,00–1,01x cả 2 lần (đúng kỳ vọng, nhánh nhanh chỉ kích hoạt tại tần số lưới). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA tĩnh: 44/44 hàm bảo vệ, 62/62 ID DOM, 21/21 script node --check PASS, kết thúc đúng </html>, diff đúng 1 hunk (+2 dòng). QA trình duyệt đầy đủ chưa chạy được trong lượt này (headless Chrome bị chặn bởi chính sách Hatch WebGL). Lượt kế: nhóm D. Lab: hidden_files/run_20261124_0124_C/. --- */
function iso2003Spl(phon, f){
  if (!isFinite(phon)) phon = 80; if (!isFinite(f)) f = 1000;
  phon = Math.max(0, Math.min(90, phon));
  f = Math.max(ISO_FREQS[0], Math.min(ISO_FREQS[ISO_FREQS.length-1], f));
  var fi = 0;
  { var _lo = 0, _hi = ISO_FREQS.length - 1;
    while (_lo < _hi){ var _m = (_lo + _hi) >> 1; if (ISO_FREQS[_m] < f) _lo = _m + 1; else _hi = _m; }
    fi = _lo - 1; if (fi < 0) fi = 0; if (fi > ISO_FREQS.length - 2) fi = ISO_FREQS.length - 2; } /* (vòng tự động 11:51, hướng C — ÁP DỤNG, vá code): tìm nhị phân fi trên lưới ISO_FREQS 29 điểm thay vì quét tuyến tính — fi = (chỉ số đầu tiên có ISO_FREQS[idx] >= f) − 1, kẹp [0, len−2], cho đúng cùng fi với vòng while cũ (ISO_FREQS[fi+1] < f) ở mọi f đã kẹp [20, 12500] kể cả f trùng điểm lưới (ft===0/1 giữ nguyên); ft và mọi biểu thức sau đó không đổi nên kết quả giống từng bit. Áp dụng cho isoSpl, isoPhonFromSpl và iso2003Spl (cùng mẫu, cùng bảng). Lab Node trên hàm thật trích verbatim (extract.py + probe.js + probe2003.js + bench.js/bench2.js trong hidden_files/run_20261123_1151/, 2 lần chạy độc lập): parity 20.520/20.520 (isoSpl+isoPhonFromSpl) + 7.634/7.634 (iso2003Spl) GIỐNG TỪNG BIT (Object.is; gồm lưới 1/48-oct 20–12.500 Hz, 29 tần số ISO ± epsilon, biên kẹp/NaN/Infinity/cực đoan); khứ hồi max 4,26e-14 phon; tốc độ paired-median xen kẽ 15 vòng: isoSpl 1,46–1,71× thắng 14–15/15 cả 2 lần, isoPhonFromSpl tại tần số lưới 1,61–1,64× thắng 15/15, tại 440 Hz ~1,0–1,06× (chia đôi áp đảo, trung tính); không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
  var ft = (Math.log(f)-ISO_LOG_FREQS[fi])/ISO_LOG_SPAN[fi];
  var X03 = Math.pow(10, 0.025*phon);
  if (ft === 0) return iso2003SplIdxX(fi, X03);
  if (ft === 1) return iso2003SplIdxX(fi+1, X03);
  return iso2003SplIdxX(fi, X03)*(1-ft) + iso2003SplIdxX(fi+1, X03)*ft; /* (vòng tự động 13:29, hướng C — ÁP DỤNG, vá code): gập X03 = 10^(0.025*phon) tính MỘT lần trong iso2003Spl thay vì tính lại trong cả hai lần gọi iso2003SplIdx (cùng phon nên Math.pow thuần xác định cho đúng cùng một double); helper mới iso2003SplIdxX(i, X) giữ nguyên đúng biểu thức Af/log10/kẹp của iso2003SplIdx, chỉ nhận X đã tính sẵn — iso2003SplIdx giữ nguyên cho UP.pure5 và các caller khác. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + harness2.js trong hidden_files/run_20261123_1328/, 2 lần chạy độc lập): parity 19.980/19.980 GIỐNG TỪNG BIT cả 2 lần (Object.is; lưới phon biên/NaN/Infinity/cực đoan × tần số ISO ± epsilon, neo 60 phon @1kHz 60,011588 dB không đổi); tốc độ paired-median xen kẽ 15 vòng: lần 1 grid91x29 1,0433x (11/15) + grid91x200log 1,0502x (11/15), lần 2 xen kẽ thứ tự grid91x29 1,0432x (13/15) + grid91x200log 1,0356x (12/15) — ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
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
    var maxT = 0, _x24 = Math.pow(10, 0.03 * 2.4); /* (vòng tự động 15:24, hướng C — ÁP DỤNG, vá code): tiền tính X = 10^(0.03*phon) MỘT lần cho vòng cột Tf và vòng khứ hồi trong upSelfCheck5 — isoSplIdx(i, phon) tự tính đúng Math.pow(10, 0.03*phon) rồi áp cùng biểu thức Af/log10 nên gọi isoSplIdxX(i, X) với X đã tính sẵn cho GIÁ TRỊ GIỐNG TỪNG BIT; vòng Tf dùng 1 X cho 29 chỉ số i (bỏ 28 lần pow thừa), vòng khứ hồi dùng 5 X cho 5 phon [10,20,40,60,80] thay vì 145 lần pow (bỏ 140 lần pow thừa). Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_1524_C/, 2 lần bench độc lập): parity 5572/5572 GIỐNG TỪNG BIT (Object.is; upSelfCheck5 {pass,total,msgs} 8/8 PASS 3 lần lặp, lưới isoSpl/isoCompDb/isoSplIdx/isoPhonIdx 660 ca gồm biên/NaN/±Infinity/cực đoan, loudGainsFor/loudFitError 6 cặp phon, 2000 fuzz); tốc độ paired-median xen kẽ 15 vòng: upSelfCheck5 đầy đủ (cache ấm) lần 1 1,0906x thắng 15/15, lần 2 1,0795x thắng 15/15; đoạn vòng maxT+maxR lần 1 1,0843x thắng 15/15, lần 2 1,0726x thắng 14/15 — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    for (var i = 0; i < 29; i++) maxT = Math.max(maxT, Math.abs(isoSplIdxX(i, _x24) - ISO_TF[i]));
    ck("ngưỡng 2.4 phon khớp cột Tf 29/29", maxT < 1e-12, "max " + maxT.toExponential(1) + " dB");
    var _s20a = isoSpl(20, 20), _s20b = isoSpl(60, 20), _s20c = isoSpl(80, 20);
    ck("điểm chuẩn 20 Hz", Math.abs(_s20a - 89.54) <= 0.02 && Math.abs(_s20b - 109.37) <= 0.02 && Math.abs(_s20c - 118.86) <= 0.02,
       _s20a.toFixed(2) + "/" + _s20b.toFixed(2) + "/" + _s20c.toFixed(2));
    var _c50 = isoCompDb(60, 80, 50);
    ck("độ bù 50 Hz = +8.12 dB", Math.abs(Math.abs(_c50) - 8.12) <= 0.02, _c50.toFixed(3));
    var _c100 = isoCompDb(60, 80, 100);
    ck("độ bù 100 Hz = +6.04 dB", Math.abs(Math.abs(_c100) - 6.04) <= 0.02, _c100.toFixed(3)); /* (vòng tự động 13:24, hướng C — ÁP DỤNG, vá code): cache kết quả isoSpl/isoCompDb tính 2 lần trong upSelfCheck5 — mỗi giá trị (isoSpl 20/60/80 @20 Hz, isoCompDb 60/80 @50/100 Hz) trước đây được gọi 2 lần: một lần trong điều kiện ck() và một lần nữa trong chuỗi detail; nay tính MỘT lần vào biến cục bộ (_s20a/_s20b/_s20c/_c50/_c100) rồi dùng lại cho cả điều kiện lẫn detail — isoSpl/isoCompDb thuần xác định theo (phon, f) nên giá trị dùng lại giống từng bit với tính lại, toFixed trên cùng double cho cùng chuỗi, thứ tự đánh giá các ck() và nội dung detail giữ nguyên. Khác hướng đã bác: hoist Math.abs(e) trong vòng cuối loudFitError (bác 23:24 ngày 23/11) — lượt này không đụng loudFitError. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_1324_C/, 2 lần bench độc lập): parity 5572/5572 GIỐNG TỪNG BIT (Object.is; upSelfCheck5 {pass,total,msgs} 8/8 PASS 3 lần lặp, lưới isoSpl/isoCompDb/isoSplIdx/isoPhonIdx 660 ca gồm biên/NaN/±Infinity/cực đoan, loudGainsFor/loudFitError 6 cặp phon, 2000 fuzz); tốc độ paired-median xen kẽ 15 vòng: upSelfCheck5 đầy đủ (cache ấm) lần 1 1,0684x thắng 15/15, lần 2 1,0599x thắng 15/15; đoạn 20Hz+comp riêng lần 1 1,9667x, lần 2 2,0077x thắng 15/15 cả 2 lần — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
    var maxR = 0, _xPh = [10, 20, 40, 60, 80].map(function(p){ return Math.pow(10, 0.03 * p); });
    for (var j = 0; j < 29; j++) [10, 20, 40, 60, 80].forEach(function(p, pi){ maxR = Math.max(maxR, Math.abs(isoPhonIdx(j, isoSplIdxX(j, _xPh[pi])) - p)); });
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
  /* (vong tu dong 03:54, huong A): fast-path khi tham so da hop le — duong nong cua harmanIe13FitToCurve (onePass + h13NmPolish.toP + harmanIe13Sections trong h13RmsOnPts) goi clamp 2 lan/eval voi tham so da kep san; nay kiem tra 13 khoa (so huu han, trong [lo,hi] cua H13_BOUNDS) roi tra thang p thay vi cap phat object + forEach + Math.max/min moi lan. Moi truong hop khac (null/thieu khoa/NaN/Infinity/ngoai dai/khong phai so) roi ve vong clamp goc nguyen ven nen gia tri 13 khoa tra ve giong tung bit; cac caller chi doc 13 khoa (khong mutate ket qua clamp) nen tra p thang khong doi hanh vi. Lab Node tren ham that trich verbatim (extract.py + make_new.py + harness.js + bench2.js, 2 lan chay doc lap): parity 342/342 h13RmsOnPts + 19/19 clamp + 19/19 sections GIONG TUNG BIT (Object.is; gom null/undefined/rong/thieu khoa/thua khoa/NaN/Infinity/ngoai dai/bien dung lo/hi/justOut/-0/chuoi/bool/array/so/chuoi primitive, pts rong/thua/trung tan so/chua sap/cuc doan/nullElem); fit params/rms GIONG HET ca 2 lan; toc do median 21 vong xen kenh sau warmup: h13RmsOnPts knots22 1,0149x/1,0100x (thang 17/21 va 14/21 vong); harmanIe13FitToCurve knots22 steady-state 1,1074x/1,1350x (thang 7/9 va 8/9 vong, OLD ~105-113 ms -> NEW ~95-96 ms). Khong cham solver/WASM/FIR/QA; aeV3 khong doi theo cau truc (khong do lai; gan nhat 468/482 ms ngay 2026-11-11). Bo dem lab-only van 12. */
  if (p){
    var _ok = true;
    for (var _ci = 0; _ci < H13_KEYS.length; _ci++){
      var _k = H13_KEYS[_ci], _v = p[_k], _b = H13_BOUNDS[_k];
      if (typeof _v !== "number" || !isFinite(_v) || _v < _b[0] || _v > _b[1]){ _ok = false; break; }
    }
    if (_ok) return p;
  }
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
  /* (vong tu dong 05:54, huong A): hoist luong giac cua biquadMagDb ra khoi vong section - cos/sin/cos2/sin2 chi phu thuoc (f, fs) va (1000, fs) nen tinh MOT lan cho moi tan so roi dung lai cho ca 5 section, thay vi 10 lan biquadMagDb tinh lai moi lan; bieu thuc nr/ni/dr/di va 10*log10(max(...)) giu nguyen nhu biquadMagDb, thu tu cong s/b i=0..4 khong doi nen giong tung bit. Lab Node 2 lan chay: 1127/1127 cau hinh giong tung bit (7 bo tham so x 23 tan so x 7 fs, gom bien NaN/Infinity/0/fs la/param null/rong); EvalAt don 0,0347 ms -> 0,0301 ms (1,151x-1,154x, thang 14-15/15 vong), vong RMS 22 diem 0,7550 ms -> 0,6465 ms (1,162x-1,168x, thang 15/15 vong). Lượt kế: nhóm B. */
  var secs = harmanIe13Sections(p), s = 0, b = 0;
  var _w = 2*Math.PI*f/fs, _cw = Math.cos(_w), _sw = Math.sin(_w);
  var _cw2 = 2*_cw*_cw - 1, _sw2 = 2*_sw*_cw;
  var _wB = 2*Math.PI*1000/fs, _cwB = Math.cos(_wB), _swB = Math.sin(_wB);
  var _cw2B = 2*_cwB*_cwB - 1, _sw2B = 2*_swB*_cwB;
  for (var i = 0; i < secs.length; i++){
    var cc = rbjCoeffs(secs[i].type, secs[i].freq, secs[i].gain, secs[i].q, fs);
    var _nr = cc.b0 + cc.b1*_cw + cc.b2*_cw2, _ni = -(cc.b1*_sw + cc.b2*_sw2);
    var _dr = 1 + cc.a1*_cw + cc.a2*_cw2, _di = -(cc.a1*_sw + cc.a2*_sw2);
    s += Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di))))*4.342944819032518;
    var _nrB = cc.b0 + cc.b1*_cwB + cc.b2*_cw2B, _niB = -(cc.b1*_swB + cc.b2*_sw2B);
    var _drB = 1 + cc.a1*_cwB + cc.a2*_cw2B, _diB = -(cc.a1*_swB + cc.a2*_sw2B);
    b += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518;
  }
  return s - b;
}
function harmanIe13EvalGrid(p, freqs, fs){
  fs = fs || 48000;
  /* (vong tu dong 14:24, huong B - H17): hoist rbjCoeffs - he so chi phu thuoc (type,freq,gain,q,fs) cua 5 section nen tinh MOT lan roi dung lai cho ca luoi thay vi h13RawAt tinh lai moi diem (241 lan dung lai harmanIe13Sections + 241*5 lan rbjCoeffs); thu tu cong i=0..4 khong doi cho base va moi diem luoi nen giong tung bit. h13RawAt giu nguyen. */
  /* (vong tu dong 07:54, huong A): hoist luong giac cua biquadMagDb ra khoi vong section va vong luoi trong harmanIe13EvalGrid - cos/sin/cos2/sin2 chi phu thuoc (1000, fs) cho base va (f, fs) cho moi diem luoi nen tinh MOT lan cho base va MOT lan cho moi f roi dung lai cho ca 5 section, thay vi 5 lan tinh lai cho base + 5 lan cho moi diem luoi (241 diem x 5 section); bieu thuc nr/ni/dr/di va 10*log10(max(...)) giu nguyen nhu biquadMagDb, thu tu cong base i=0..4 va s j=0..4 khong doi nen giong tung bit. Luot ke: nhom B. */
  var secs = harmanIe13Sections(p), cc = [], i, base = 0;
  var _wB = 2*Math.PI*1000/fs, _cwB = Math.cos(_wB), _swB = Math.sin(_wB);
  var _cw2B = 2*_cwB*_cwB - 1, _sw2B = 2*_swB*_cwB;
  for (i = 0; i < secs.length; i++){
    cc.push(rbjCoeffs(secs[i].type, secs[i].freq, secs[i].gain, secs[i].q, fs));
    var _cB = cc[i];
    var _nrB = _cB.b0 + _cB.b1*_cwB + _cB.b2*_cw2B, _niB = -(_cB.b1*_swB + _cB.b2*_sw2B);
    var _drB = 1 + _cB.a1*_cwB + _cB.a2*_cw2B, _diB = -(_cB.a1*_swB + _cB.a2*_sw2B);
    base += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518;
  }
  return freqs.map(function(f){
    var _w = 2*Math.PI*f/fs, _cw = Math.cos(_w), _sw = Math.sin(_w);
    var _cw2 = 2*_cw*_cw - 1, _sw2 = 2*_sw*_cw;
    var s = 0;
    for (var j = 0; j < cc.length; j++){
      var _c = cc[j];
      var _nr = _c.b0 + _c.b1*_cw + _c.b2*_cw2, _ni = -(_c.b1*_sw + _c.b2*_sw2);
      var _dr = 1 + _c.a1*_cw + _c.a2*_cw2, _di = -(_c.a1*_sw + _c.a2*_sw2);
      s += Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di))))*4.342944819032518;
    }
    return s - base;
  });
}
function h13Fs(){ return (typeof displayFs !== "undefined" && displayFs > 0) ? displayFs : 48000; }
var H13_TRIG_WM = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
var H13_RBJ_CACHE = [
  { fs: 0, f: NaN, g: NaN, q: NaN, cc: null },
  { fs: 0, f: NaN, g: NaN, q: NaN, cc: null },
  { fs: 0, f: NaN, g: NaN, q: NaN, cc: null },
  { fs: 0, f: NaN, g: NaN, q: NaN, cc: null },
  { fs: 0, f: NaN, g: NaN, q: NaN, cc: null }
];
var H13_SEC_CACHE = [ { fs: 0, trig: null, n: 0, f: NaN, g: NaN, q: NaN, vals: null }, { fs: 0, trig: null, n: 0, f: NaN, g: NaN, q: NaN, vals: null }, { fs: 0, trig: null, n: 0, f: NaN, g: NaN, q: NaN, vals: null }, { fs: 0, trig: null, n: 0, f: NaN, g: NaN, q: NaN, vals: null }, { fs: 0, trig: null, n: 0, f: NaN, g: NaN, q: NaN, vals: null } ];
function h13RmsOnPts(p, pts){
  /* (vòng tự động 17:54, hướng A — ÁP DỤNG, vá code): cache rbjCoeffs theo từng section trong h13RmsOnPts (đường nóng của harmanIe13FitToCurve) — harmanIe13FitToCurve gọi h13RmsOnPts hàng nghìn lần, mỗi lần tính lại 5 bộ hệ số rbjCoeffs dù trong leo dốc từng tham số (onePass) mỗi trial chỉ đổi MỘT tham số nên 4/5 section không đổi; nay dùng H13_RBJ_CACHE (5 mục, mỗi mục {fs,f,g,q,cc} của một section) so sánh bằng === từng trường (fs + freq/gain/q đã kẹp của _q13, type là hằng số theo section) — trúng thì dùng lại hệ số đã tính (cùng object, chỉ đọc), trượt thì gọi rbjCoeffs với đúng đối số gốc rồi cập nhật mục; thứ tự gọi rbjCoeffs, biểu thức base/vòng điểm và thứ tự cộng se/mx giữ nguyên nên GIỐNG TỪNG BIT theo cấu trúc (rbjCoeffs thuần, hệ số chỉ đọc ở mọi caller). Lab Node trên hàm thật trích verbatim, file thường nối liền (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1750_A/, 2 lần chạy độc lập): parity 440/440 + 321/321 + 48/48 (Fit params/rms) GIỐNG TỪNG BIT cả 2 lần (Object.is; gồm lặp lại cùng tham số, đổi 1 tham số liên tiếp, xen kẽ A/B, đổi fs 44100/48000/96000, mutation tại chỗ, null/rỗng/NaN/Infinity, mảng thưa, ném lỗi đúng TypeError, Fit đầy đủ 3 target); tốc độ paired-median xen kẽ 15 vòng: W1 onePass-like lần 1 1,1602x (12/15), lần 2 1,2372x (10/15), lần 3 fresh 1,0840x (11/15); W3 lặp lại lần 1 1,1323x (15/15), lần 2 1,1420x (12/15); W5 Fit đầy đủ lần 1 1,0254x (9/9), lần 2 1,0496x (3/9), fresh 1,1265x (5/9) — cải thiện ổn định trên đường nóng; W2 ngẫu nhiên trung tính 0,99-1,07x. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
  /* (vòng tự động 12:40, hướng A — ÁP DỤNG, vá code): đổi 10*Math.log10(x) sang Math.log(x)*4.342944819032518 (10/ln10, cùng hằng số đã dùng trong objective aeSolveSingle/hwSolve và geqFit) trong 3 hàm của đường khớp 13 tham số — harmanIe13EvalAt (2 điểm), harmanIe13EvalGrid (2 điểm) và h13RmsOnPts (6 điểm: 5 base + vòng điểm) — biểu thức kẹp max(1e-18, num/max(1e-24, den)) và thứ tự cộng section/điểm giữ nguyên, chỉ đổi hàm log nên sai số ~1 ulp. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench.js trong hidden_files/run_20261123_1236/, 2 lần chạy độc lập): parity 58.472 kiểm tra, lệch tối đa 7,11e-15 dB (54,53% giống từng bit, còn lại mức ulp); tốc độ paired-median xen kẽ 15 vòng: lần 1 knots25 1,0166x (11/15), grid241 1,0107x (8/15), grid881 1,0227x (12/15), N8 1,0035x (10/15), EvalGrid241 1,0272x (14/15); lần 2 knots25 1,0096x (12/15), grid241 1,0224x (14/15), grid881 1,0223x (14/15), N8 1,0054x (10/15), EvalGrid241 1,0244x (13/15) — median >1 trên mọi workload cả 2 lần, cải thiện ổn định ở lưới lớn (đường nóng của harmanIe13FitToCurve). Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
  var se = 0, mx = 0, fs = h13Fs();
  /* (vong tu dong 09:54, huong A): rut gon RMS cua harmanIe13FitToCurve qua harmanIe13EvalGrid - voi >= 2 diem, tach tan so roi dung EvalGrid tinh MOT lan rbjCoeffs cho 5 section thay vi goi harmanIe13EvalAt tinh lai 5 lan rbjCoeffs cho MOI diem; bieu thuc s/base cua EvalGrid giong tung bit EvalAt (cung thu tu cong section, cung luong giac) nen vals[i] == EvalAt(p, pts[i][0]) tung bit, thu tu cong se/mx va pts.length giu nguyen; map/forEach giu nguyen ngu nghia bo qua lo cua mang thia; voi < 2 diem giu vong cu de tranh chi phi cap phat cua EvalGrid. Lab Node 2 lan chay: 952/952 cau hinh giong tung bit (Object.is, gom bien NaN/Infinity/0/1e308/subnormal, mang rong/thia, fs la), extra 7/7; toc do median 15 vong xen ke: knots25 6,34x, grid241 8,63x, N=2 1,81x, N=8 4,36x - thang 15/15 moi workload N>=2. */
  /* (vong tu dong 19:56, huong A): inline harmanIe13EvalGrid vao vong RMS - voi >= 2 diem, tinh base MOT lan (cung thu tu cong section i=0..4, cung luong giac cua EvalGrid) roi tinh truc tiep s-base trong cung vong duyet pts theo thu tu chi so, bo mang trung gian freqs/vals va 2 lan map/forEach moi lan danh gia cua harmanIe13FitToCurve; vong kiem tra truoc giu dung thu tu nem loi cua pts.map(pt=>pt[0]) (bo qua lo mang thia bang chi so in) truoc khi tinh section, vong chinh bo qua lo bang cung dieu kien; bieu thuc nr/ni/dr/di va 10*log10(max(...)) giu nguyen tung ky tu nhu EvalGrid, thu tu cong se/mx va pts.length khong doi nen giong tung bit. Voi < 2 diem giu vong cu. Lab Node tren ham that trich verbatim (extract_h13.py + harness_h13.js, 2 lan chay doc lap): 114/114 fixture GIONG TUNG BIT (Object.is tren rms/max, gom grid241/881/49/25, N=1/2/3/8, mang rong/thia, tan so trung/lech thu tu, bien NaN/Infinity/0/am/1e308/subnormal, phan tu null/undefined nem dung TypeError, param null/rong/NaN/Infinity); toc do median 15 vong xen ke: grid241 1,13x/1,11x, knots25 1,09x/1,06x, grid49 1,10x/1,04x, grid881 1,05x/1,04x, N=2 1,14x/1,13x, N=8 1,09x/1,09x - thang moi workload ca 2 lan. */
  /* (vong tu dong 01:54, huong A): cache luong giac theo identity mang pts cho duong nong cua harmanIe13FitToCurve - harmanIe13FitToCurve goi h13RmsOnPts hang nghin lan voi CUNG targetPts va cung fs nen cos/sin/cos2/sin2 cua tung diem bat bien giua cac lan goi; nay dung H13_TRIG_WM (WeakMap theo identity mang pts) luu {fs,n,fr,cw,sw,cw2,sw2} theo kieu lazy: lan goi dau chi dat marker warm (khong cap phat), lan goi hai moi dung cache day du trong khi tinh luong giac nhu cu, cac lan sau tra bang; vong kiem tra truoc giu dung thu tu nem loi cua ban cu (doc pt[0] theo chi so tang dan truoc khi tinh section), moi lan goi lai doi chieu tan so tung diem voi ban sao da luu (NaN/dich tan so/dot bien mang deu phat hien va dung lai), mang thua (hole) khong dung cache, fs khac thi dung lai; bieu thuc nr/ni/dr/di, 10*log10, thu tu cong se/mx va pts.length giu nguyen nen giong tung bit. Lab Node tren ham that trich verbatim (extract_h13.py + make_new2.py + harness_h13.js, 2 lan chay doc lap): 128/128 fixture GIONG TUNG BIT ca 2 lan (Object.is tren rms/max, gom grid241/881/49/25, N=1/2/3/8, mang rong/thua, tan so trung/lech thu tu, bien NaN/Infinity/0/am/1e308/subnormal, phan tu null/undefined nem dung TypeError, param null/rong/NaN/Infinity, mutation tan so/gia tri, doi fs); toc do median 15 vong xen kenh: grid241 1,15x-1,17x, knots25 1,08x-1,13x, grid49 1,09x-1,12x, grid881 1,17x-1,18x, N=8 1,03x-1,05x - thang 13-15/15 vong moi workload lap lai ca 2 lan; duong goi mot lan voi mang moi (distinct) 0,995x-0,999x (trung tinh). Khong cham solver/WASM/FIR/QA; aeV3 khong doi theo cau truc (khong do lai; gan nhat 468/482 ms ngay 2026-11-11). Bo dem lab-only van 12. */
  if (pts.length < 2){
    pts.forEach(function(pt){ var e = harmanIe13EvalAt(p, pt[0], fs) - pt[1]; se += e * e; mx = Math.max(mx, Math.abs(e)); });
    return { rms: Math.sqrt(se / pts.length), max: mx };
  }
  var _te = null;
  if (H13_TRIG_WM && pts !== null && (typeof pts === "object" || typeof pts === "function")){
    _te = H13_TRIG_WM.get(pts) || null;
  }
  var _dense = true, _freqMatch = !!(_te && _te.fs === fs && _te.n === pts.length);
  for (var vi = 0; vi < pts.length; vi++){
    if (vi in pts){
      var _pt0 = pts[vi]; var _f0 = _pt0[0];
      if (_freqMatch && _f0 !== _te.fr[vi]) _freqMatch = false;
    } else _dense = false;
  }
  var _tc = (_te && _freqMatch && _dense && _te.cw) ? _te : null;
  var _isWarm = !!(_te && _te.warm);
  var _build = (!_tc && (_isWarm || (_te && _te.cw)) && H13_TRIG_WM && pts !== null && (typeof pts === "object" || typeof pts === "function") && _dense) ? { fs: fs, n: pts.length, fr: new Array(pts.length), cw: new Float64Array(pts.length), sw: new Float64Array(pts.length), cw2: new Float64Array(pts.length), sw2: new Float64Array(pts.length) } : null;
  /* (vong tu dong 10:54, huong A): inline harmanIe13Sections vao vong RMS - h13RmsOnPts la duong nong cua harmanIe13FitToCurve (hang nghin lan danh gia voi cung targetPts) nen dung lai harmanIe13Sections cap phat 1 mang + 5 object moi lan goi; nay clamp MOT lan (cung h13ClampParams(p) nhu harmanIe13Sections) roi goi rbjCoeffs truc tiep voi (type hang so, q.f q.g q.q) cho 5 section theo dung thu tu i=0..4 - cung gia tri tung bit, cung thu tu cong base, chi bo cap phat trung gian. harmanIe13Sections giu nguyen cho h13RawAt/EvalAt/EvalGrid. */
  var _q13 = h13ClampParams(p), cc = [], base = 0;
  var _wB = 2*Math.PI*1000/fs, _cwB = Math.cos(_wB), _swB = Math.sin(_wB);
  var _cw2B = 2*_cwB*_cwB - 1, _sw2B = 2*_swB*_cwB;
  var _re0 = H13_RBJ_CACHE[0], _rf0 = _q13.f1_bassHz, _rg0 = _q13.g1_bassDb, _rq0 = _q13.q1_bassQ;
  if (_re0.fs === fs && _re0.f === _rf0 && _re0.g === _rg0 && _re0.q === _rq0) cc.push(_re0.cc);
  else { var _rc0 = rbjCoeffs("lowshelf", _rf0, _rg0, _rq0, fs); _re0.fs = fs; _re0.f = _rf0; _re0.g = _rg0; _re0.q = _rq0; _re0.cc = _rc0; cc.push(_rc0); }
  { var _cB = cc[0];
    var _nrB = _cB.b0 + _cB.b1*_cwB + _cB.b2*_cw2B, _niB = -(_cB.b1*_swB + _cB.b2*_sw2B);
    var _drB = 1 + _cB.a1*_cwB + _cB.a2*_cw2B, _diB = -(_cB.a1*_swB + _cB.a2*_sw2B);
    base += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518; }
  var _re1 = H13_RBJ_CACHE[1], _rf1 = _q13.f2_lowMidHz, _rg1 = _q13.g2_lowMidDb, _rq1 = _q13.q2_lowMidQ;
  if (_re1.fs === fs && _re1.f === _rf1 && _re1.g === _rg1 && _re1.q === _rq1) cc.push(_re1.cc);
  else { var _rc1 = rbjCoeffs("peaking", _rf1, _rg1, _rq1, fs); _re1.fs = fs; _re1.f = _rf1; _re1.g = _rg1; _re1.q = _rq1; _re1.cc = _rc1; cc.push(_rc1); }
  { var _cB = cc[1];
    var _nrB = _cB.b0 + _cB.b1*_cwB + _cB.b2*_cw2B, _niB = -(_cB.b1*_swB + _cB.b2*_sw2B);
    var _drB = 1 + _cB.a1*_cwB + _cB.a2*_cw2B, _diB = -(_cB.a1*_swB + _cB.a2*_sw2B);
    base += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518; }
  var _re2 = H13_RBJ_CACHE[2], _rf2 = _q13.f3_earGainHz, _rg2 = _q13.g3_earGainDb, _rq2 = _q13.q3_earGainQ;
  if (_re2.fs === fs && _re2.f === _rf2 && _re2.g === _rg2 && _re2.q === _rq2) cc.push(_re2.cc);
  else { var _rc2 = rbjCoeffs("peaking", _rf2, _rg2, _rq2, fs); _re2.fs = fs; _re2.f = _rf2; _re2.g = _rg2; _re2.q = _rq2; _re2.cc = _rc2; cc.push(_rc2); }
  { var _cB = cc[2];
    var _nrB = _cB.b0 + _cB.b1*_cwB + _cB.b2*_cw2B, _niB = -(_cB.b1*_swB + _cB.b2*_sw2B);
    var _drB = 1 + _cB.a1*_cwB + _cB.a2*_cw2B, _diB = -(_cB.a1*_swB + _cB.a2*_sw2B);
    base += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518; }
  var _re3 = H13_RBJ_CACHE[3], _rf3 = _q13.f4_couplerHz, _rg3 = _q13.g4_couplerDb, _rq3 = _q13.q4_couplerQ;
  if (_re3.fs === fs && _re3.f === _rf3 && _re3.g === _rg3 && _re3.q === _rq3) cc.push(_re3.cc);
  else { var _rc3 = rbjCoeffs("peaking", _rf3, _rg3, _rq3, fs); _re3.fs = fs; _re3.f = _rf3; _re3.g = _rg3; _re3.q = _rq3; _re3.cc = _rc3; cc.push(_rc3); }
  { var _cB = cc[3];
    var _nrB = _cB.b0 + _cB.b1*_cwB + _cB.b2*_cw2B, _niB = -(_cB.b1*_swB + _cB.b2*_sw2B);
    var _drB = 1 + _cB.a1*_cwB + _cB.a2*_cw2B, _diB = -(_cB.a1*_swB + _cB.a2*_sw2B);
    base += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518; }
  var _re4 = H13_RBJ_CACHE[4], _rf4 = 11000.0, _rg4 = _q13.g5_airShelfDb, _rq4 = 0.707;
  if (_re4.fs === fs && _re4.f === _rf4 && _re4.g === _rg4 && _re4.q === _rq4) cc.push(_re4.cc);
  else { var _rc4 = rbjCoeffs("highshelf", _rf4, _rg4, _rq4, fs); _re4.fs = fs; _re4.f = _rf4; _re4.g = _rg4; _re4.q = _rq4; _re4.cc = _rc4; cc.push(_rc4); }
  { var _cB = cc[4];
    var _nrB = _cB.b0 + _cB.b1*_cwB + _cB.b2*_cw2B, _niB = -(_cB.b1*_swB + _cB.b2*_sw2B);
    var _drB = 1 + _cB.a1*_cwB + _cB.a2*_cw2B, _diB = -(_cB.a1*_swB + _cB.a2*_sw2B);
    base += Math.log(Math.max(1e-18,(_nrB*_nrB+_niB*_niB)/Math.max(1e-24,(_drB*_drB+_diB*_diB))))*4.342944819032518; }
  /* (vong tu dong 08:31, huong A): cache duong cong tung section trong h13RmsOnPts - trong leo doc tung tham so (onePass) moi trial chi doi MOT tham so nen 4/5 section khong doi, nhung vong diem van tinh lai log cho ca 5 section moi lan goi. Nay cache mang gia tri log tung diem cua tung section (Float64Array, gia tri double giu nguyen tung bit) theo (fs, doi tuong trig da xac minh tan so khop, n, f/g/q da kep cua section); chi dung khi _tc ton tai (trig cache da doi chieu freqs tung diem va pts dense) nen mang thua/null/nan-freq roi ve duong goc. Tong tich luy _sAcc cong theo dung thu tu section 0..4 voi dung toan hang nen GIONG TUNG BIT. */
  var _secOk = !!(_tc && _dense);
  var _sAcc = null;
  if (_secOk){
    _sAcc = new Float64Array(pts.length);
    var _secF = [_rf0, _rf1, _rf2, _rf3, _rf4], _secG = [_rg0, _rg1, _rg2, _rg3, _rg4], _secQ = [_rq0, _rq1, _rq2, _rq3, _rq4];
    for (var _sj = 0; _sj < 5; _sj++){
      var _se = H13_SEC_CACHE[_sj];
      var _sv;
      if (_se.fs === fs && _se.trig === _tc && _se.n === pts.length && _se.f === _secF[_sj] && _se.g === _secG[_sj] && _se.q === _secQ[_sj] && _se.vals){ _sv = _se.vals; }
      else {
        _sv = new Float64Array(pts.length);
        var _cS = cc[_sj];
        var _b0S = _cS.b0, _b1S = _cS.b1, _b2S = _cS.b2, _a1S = _cS.a1, _a2S = _cS.a2;
        for (var _si = 0; _si < pts.length; _si++){
          var _cwS = _tc.cw[_si], _swS = _tc.sw[_si], _cw2S = _tc.cw2[_si], _sw2S = _tc.sw2[_si];
          var _nrS = _b0S + _b1S * _cwS + _b2S * _cw2S, _niS = -(_b1S * _swS + _b2S * _sw2S);
          var _drS = 1 + _a1S * _cwS + _a2S * _cw2S, _diS = -(_a1S * _swS + _a2S * _sw2S);
          _sv[_si] = Math.log(Math.max(1e-18, (_nrS * _nrS + _niS * _niS) / Math.max(1e-24, (_drS * _drS + _diS * _diS)))) * 4.342944819032518;
        }
        _se.fs = fs; _se.trig = _tc; _se.n = pts.length; _se.f = _secF[_sj]; _se.g = _secG[_sj]; _se.q = _secQ[_sj]; _se.vals = _sv;
      }
      for (var _sa = 0; _sa < pts.length; _sa++) _sAcc[_sa] += _sv[_sa];
    }
  }
  for (var idx = 0; idx < pts.length; idx++){
    if (!(idx in pts)) continue;
    var pt = pts[idx];
    var f = pt[0];
    var _cw, _sw, _cw2, _sw2;
    if (_tc){
      _cw = _tc.cw[idx]; _sw = _tc.sw[idx]; _cw2 = _tc.cw2[idx]; _sw2 = _tc.sw2[idx];
    } else {
      var _w = 2*Math.PI*f/fs, _cwT = Math.cos(_w), _swT = Math.sin(_w);
      _cw = _cwT; _sw = _swT; _cw2 = 2*_cw*_cw - 1; _sw2 = 2*_sw*_cw;
      if (_build){ _build.fr[idx] = f; _build.cw[idx] = _cw; _build.sw[idx] = _sw; _build.cw2[idx] = _cw2; _build.sw2[idx] = _sw2; }
    }
    var s;
    if (_sAcc){ s = _sAcc[idx]; }
    else {
      s = 0;
      for (var j = 0; j < cc.length; j++){
        var _c = cc[j];
        var _nr = _c.b0 + _c.b1*_cw + _c.b2*_cw2, _ni = -(_c.b1*_sw + _c.b2*_sw2);
        var _dr = 1 + _c.a1*_cw + _c.a2*_cw2, _di = -(_c.a1*_sw + _c.a2*_sw2);
        s += Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di))))*4.342944819032518;
      }
    }
    var e = (s - base) - pt[1]; se += e * e; mx = Math.max(mx, Math.abs(e));
  }
  if (_build) H13_TRIG_WM.set(pts, _build);
  else if (!_te && H13_TRIG_WM && pts !== null && (typeof pts === "object" || typeof pts === "function") && _dense) H13_TRIG_WM.set(pts, { warm: 1 });
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
/* --- Mở rộng 2026-11-23 (vòng tự động 19:59, hướng A — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm A (sau D 19:52, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 19:53:15+07, 6.244.324 byte / 25.321 dòng, md5 520c86a4c0f483accb74667473e61d43, version 302) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-A lưu tại ~/workspace/autoeq/backups/Web AutoEQ - DSP Core_2026-11-23_1955_pre-A.html. Ứng viên A duy nhất: mutate-in-place trong onePass của harmanIe13FitToCurve — thay Object.assign({},p) + trial[k]=... + clamp(trial) mỗi trial bằng lưu _opOld, gán p[k]=_opNv, clamp(p) rồi khôi phục p[k]=_opOld khi không cải thiện (giữ p=_opCl khi cải thiện) — cùng thứ tự số học, chỉ bỏ cấp phát object mỗi trial (26 trial/vòng sweep). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js/harness2.js + bench.js trong hidden_files/run_20261123_1954_A/, 3 lần bench độc lập): parity GIỐNG TỪNG BIT — Fit 4 ca (64 kiểm tra) + Edge 3 ca biên bounds (45 kiểm tra) + trial logic 3.380 kiểm tra (gồm NaN/Infinity/-0/1e308/subnormal, clamp slow-path) đều Object.is; tốc độ paired-median xen kẽ 15 vòng trên harmanIe13FitToCurve knots22: lần 1 1,0137x thắng 14/15, lần 2 1,0062x thắng 9/15, lần 3 1,0001x thắng 8/15 — không cải thiện ổn định, đảo chiều trong nhiễu máy chia sẻ (median ~51 ms, chênh <1 ms) → BÁC, không vá code. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261123_1954_A/. */
/* --- Mở rộng 2026-11-23 (vòng tự động 20:45, hướng A — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm A (sau D 20:41, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 20:41:14+07, 6.256.009 byte / 25.333 dòng (wc -l), md5 a7b41231a6568d8ee4a486f3ff969439, version 315) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-A lưu tại ~/workspace/autoeq/backups/2026-11-23_2045_pre-A.html. Ứng viên A duy nhất: cache đóng góp từng section theo tần số trong h13RmsOnPts (mở rộng H13_RBJ_CACHE thêm Map tần số→đóng góp, rồi biến thể cache theo chỉ số mảng Float64Array + kiểm tra tần số đã lưu) — trong onePass mỗi trial chỉ đổi 1 tham số nên 4/5 section không đổi, kỳ vọng bỏ ~80% phép log của vòng điểm. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py/make_new2.py + harness/harness2 + bench/bench2 + bench_fit trong hidden_files/run_20261123_2044_A/, 2 lần chạy độc lập): parity GIỐNG TỪNG BIT — h13RmsOnPts 1.065/1.065 kiểm tra cả 2 biến thể (Object.is trên rms/max; gồm lặp lại, onePass-like, xen kẽ A/B, ngẫu nhiên, đột biến tần số pts tại chỗ, đổi fs 22050–192000, mảng thưa, trùng tần số, NaN/±Infinity/-0, tham số cực đoan, pts null/rỗng/1 điểm) và full harmanIe13FitToCurve 4/4 target giống hệt (params/rms/max); tốc độ h13RmsOnPts cô lập biến thể mảng: onePass25 1,4917× thắng 15/15, repeat25 1,7812× thắng 15/15, dense241 1,4910× thắng 14/15 NHƯNG random25 (toàn-miss, giống NM polish) 0,5541× thắng 0/15 và full Fit 15 target 0,7234× thắng 0/7 (median 425,4 ms → 588,0 ms, acc RMS giống hệt) — biến thể Map còn chậm hơn (0,29–0,86× mọi workload). Nguyên nhân: h13NmPolish chiếm ưu thế thời gian Fit và mọi eval của nó đều trượt cache (đổi toàn bộ tham số), chi phí cấp phát/kiểm tra cache trên đường trượt nuốt hết lợi ích onePass → BÁC, không vá code. KHÔNG thử lại hướng cache đóng góp từng section theo tần số/chỉ số trong h13RmsOnPts. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261123_2044_A/. --- */
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
  function toU(p){ var u = new Array(H13_KEYS.length); for (var ui = 0; ui < H13_KEYS.length; ui++){ var uk = H13_KEYS[ui]; u[ui] = uk.indexOf("Hz") >= 0 ? Math.log10(p[uk]) : p[uk]; } return u; }
  function toP(u){ var p = {}; for (var pi = 0; pi < H13_KEYS.length; pi++){ var pk = H13_KEYS[pi]; p[pk] = pk.indexOf("Hz") >= 0 ? Math.pow(10, u[pi]) : u[pi]; } return h13ClampParams(p); }
  function obj(u){ return h13RmsOnPts(toP(u), targetPts).rms; }
  var u0 = toU(h13ClampParams(p0));
  var steps = new Array(H13_KEYS.length); for (var si = 0; si < H13_KEYS.length; si++){ var sk = H13_KEYS[si]; steps[si] = sk.indexOf("Hz") >= 0 ? Math.log10(1.10) : (sk.indexOf("Q") >= 0 || sk.indexOf("q") === 0) ? 0.15 : 0.7; }
  var simplex = [u0.slice()], vals = [obj(u0)], evals = 1;
  for (var i = 0; i < n; i++){ var u = u0.slice(); u[i] += steps[i]; simplex.push(u); vals.push(obj(u)); evals++; }
  /* (vong tu dong 05:16, huong A - AP DUNG, va code): thay sortS cua h13NmPolish bang insertion sort tai cho - truoc day moi vong NM cap phat mang idx + goi Array.sort voi comparator closure roi cap phat 2 mang _ns/_nv de sap xep lai simplex/vals (14 phan tu); nay sap xep truc tiep tren simplex/vals bang insertion sort on dinh (dich khi vals[j] > key, nghiem ngat nen giu thu tu cac phan tu bang nhau nhu stable sort cua V8). Duong vals chua NaN (comparator cua ban cu tra NaN->0 khong bac cau, V8 TimSort cho ket qua khac insertion sort) roi ve dung vong sort cu nguyen ven nen GIONG TUNG BIT voi moi dau vao huu han va ca khi co NaN; voi vals huu han, dau cua (vals[a]-vals[b]) luon khop dau so sanh truc tiep (a-b==0 chi khi a==b voi so double huu han) nen thu tu khop tung bit. Lab Node tren ham that trich verbatim (extract.py + harness.js + bench.js trong hidden_files/run_20261127_0516_A/lab/, 2 lan chay doc lap): parity sortS 47008/47008 GIONG TUNG BIT (Object.is tren thu tu hang + vals; gom NaN/Infinity/-0/subnormal/1e308, day bang nhau, gan sap xep, 20000 fuzz ngau nhien + 20000 fuzz nhieu bang nhau + 5000 fuzz gan sap xep) + tich hop h13NmPolish 12/12 GIONG HET (13 tham so Object.is; 3 target x 4 diem khoi tao); toc do khoi sortS paired-median xen ke 15 vong: 12,71x/14,23x thang 15/15 ca 2 lan; toan h13NmPolish trung tinh trong nhieu may chia se (0,9342x/1,0113x) dung ky vong vi sortS chi la phan nho cua thoi gian polish. Khong cham solver/WASM/FIR/QA logic; aeV3 khong doi theo cau truc (khong do lai; gan nhat 468/482 ms ngay 2026-11-11). Bo dem lab-only van 12. Luot ke: nhom B. */
  function sortS(){
    var _sNan = false;
    for (var _sN = 0; _sN < vals.length; _sN++){ if (vals[_sN] !== vals[_sN]){ _sNan = true; break; } }
    if (_sNan){
      var idx = new Array(vals.length); for (var sI = 0; sI < vals.length; sI++) idx[sI] = sI;
      idx.sort(function(a, b){ return vals[a] - vals[b]; });
      var _ns = new Array(idx.length), _nv = new Array(idx.length);
      for (var sK = 0; sK < idx.length; sK++){ _ns[sK] = simplex[idx[sK]]; _nv[sK] = vals[idx[sK]]; }
      simplex = _ns; vals = _nv;
    } else {
      for (var _sI = 1; _sI < vals.length; _sI++){
        var _sRow = simplex[_sI], _sVal = vals[_sI], _sJ = _sI - 1;
        while (_sJ >= 0 && vals[_sJ] > _sVal){ simplex[_sJ+1] = simplex[_sJ]; vals[_sJ+1] = vals[_sJ]; _sJ--; }
        simplex[_sJ+1] = _sRow; vals[_sJ+1] = _sVal;
      }
    }
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
    var xr = new Array(n); for (var j4 = 0; j4 < n; j4++){ var c4 = cen[j4]; xr[j4] = c4 + (c4 - simplex[n][j4]); }
    var fr = obj(xr); evals++;
    if (fr < vals[0]){
      var xe = new Array(n); for (var j5 = 0; j5 < n; j5++){ var c5 = cen[j5]; xe[j5] = c5 + 2 * (c5 - simplex[n][j5]); }
      var fe = obj(xe); evals++;
      if (fe < fr){ simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]){ simplex[n] = xr; vals[n] = fr; }
    else {
      var xc = new Array(n); for (var j6 = 0; j6 < n; j6++){ var c6 = cen[j6]; xc[j6] = c6 + 0.5 * (simplex[n][j6] - c6); }
      var fc = obj(xc); evals++;
      if (fc < vals[n]){ simplex[n] = xc; vals[n] = fc; }
      else {
        for (i3 = 1; i3 <= n; i3++){
          var _sr = simplex[i3], _s0 = simplex[0], _sn = new Array(_sr.length);
          for (var j7 = 0; j7 < _sr.length; j7++) _sn[j7] = _s0[j7] + 0.5 * (_sr[j7] - _s0[j7]);
          simplex[i3] = _sn;
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
        if (typeof fs === "function"){ cb = fs; fs = undefined; }
        if (!chkH.checked || targetId === "harmanIE13" || typeof AE_TARGETS === "undefined" || !AE_TARGETS[targetId] || !AE_TARGETS[targetId].knots){
          return origAeComputeAsync(prep, targetId, adj, nB, preserve, bestOf, fs, cb);
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
        if (!fitH) return origAeComputeAsync(prep, targetId, adj, nB, preserve, bestOf, fs, cb);
        return origAeComputeAsync(prep, "harmanIE13", adj, nB, preserve, bestOf, fs, function(out){
          out.h13Auto = { sourceId: srcId, sourceName: srcName, rms: fitH.rmsError, max: fitH.maxError };
          cb(out);
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
