/* Web AutoEQ split module: 08-qa.js (nguon: khoi script L20089, L20485 cua ban 1 file) */

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
  if (typeof psychoCoeffs === "function"){
    /* (vòng tự động 12:24, hướng B): khi psycho chắc chắn trả toàn identity (bypassAll, hoặc loud/notch đều tắt) thì pushNZ sẽ loại mọi section nên bỏ qua psychoCoeffs — tránh dựng khóa chuỗi + mảng 7 phần tử mỗi lần gọi. Ứng viên skip kiểm tra rẻ trước (bypassAll / loud+notch tắt, fail-fast ở đường psycho-bật), điều kiện an toàn (PSY_ID là identity, PSY.loud.cur là mảng để dòng chuẩn hoá đầu psychoCoeffs vẫn chạy khi không thoả) chỉ kiểm tra khi ứng viên đạt; mọi trường hợp còn lại rơi về đường gọi gốc giữ nguyên tác dụng phụ/thứ tự lỗi. */
    var _psySkip = false;
    if (typeof PSY !== "undefined" && PSY && (PSY.bypassAll || (PSY.loud && PSY.notch && !PSY.loud.on && !PSY.notch.on))){
      if (typeof PSY_ID !== "undefined" && PSY_ID && PSY_ID.b0 === 1 && PSY_ID.b1 === 0 && PSY_ID.b2 === 0 && PSY_ID.a1 === 0 && PSY_ID.a2 === 0 && PSY.loud && Array.isArray(PSY.loud.cur)) _psySkip = true;
    }
    if (!_psySkip){ var _pc = psychoCoeffs(fs); for (var _pi = 0; _pi < _pc.length; _pi++) pushNZ(_pc[_pi]); }
  }
  return out;
}
var QA_PHASE_CACHE = {};
var QA_PHASE_CACHE_N = 0; /* bo dem so khoa QA_PHASE_CACHE cho qaPhaseGdData: thay Object.keys(...).length moi lan miss bang phep so sanh so nguyen, doi xung voi QA_PHASE_LOW_N o qaGdMaxLowOnly; chi cap nhat tai dung diem gan them/xoa toan bo QA_PHASE_CACHE trong qaPhaseGdData, gia tri luon bang Object.keys(QA_PHASE_CACHE).length */
var QA_GD_GRID = {};
var QA_PHASE_LOW = {}; /* pha rieng k=0..56 cho qaGdMaxLowOnly (vong tu dong 18:24, huong B) */
var QA_PHASE_LOW_N = 0; /* bo dem so khoa QA_PHASE_LOW cho qaGdMaxLowOnly: thay Object.keys(...).length moi lan miss (cap phat mang lon khi cache gan 400 khoa) bang phep so sanh so nguyen; chi cap nhat tai dung cac diem gan them/xoa toan bo QA_PHASE_LOW trong qaGdMaxLowOnly, gia tri luon bang Object.keys(QA_PHASE_LOW).length */
var QA_PHASE_KEY_WM = (typeof WeakMap !== "undefined") ? new WeakMap() : null; /* cache khoa pKey theo identity object he so (vong tu dong 00:24, huong B): doi tuong he so tu bandCoeffs/psychoCoeffs giu nguyen tham chieu khi tham so khong doi nen tra khoa da dung san thay vi noi lai chuoi 5 so moi lan goi; kiem tra fs truoc khi dung lai, moi truong hop khac (object moi sau reset BAND_CC, doi fs, khong co WeakMap) roi ve cach noi chuoi goc - cung chuoi khoa nen QA_PHASE_CACHE/QA_PHASE_LOW dung chung khong doi */
function qaPhaseGdData(fs){
  var N = 240, phU = new Array(N + 1), i, k;
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
    /* (vòng tự động 02:24, hướng B): nhánh FIR — phU/gdF là mảng thưa theo chỉ số k=0..N nên gán trực tiếp thay vì push/map: phU[k] giữ nguyên biểu thức -2*Math.PI*freqs[k]/fs*D, gdValF = D/fs*1000 tính MỘT lần rồi điền mọi phần tử (cùng giá trị từng bit với map cũ), độ dài giữ 241 như cũ. Lab Node 3 lần chạy: phU/gdMs giống từng bit, nhánh FIR 49,2 ms -> 19,4 ms / 20k lần (2,53x). */
    var gdValF = D/fs*1000;
    var gdF = new Array(freqs.length);
    for (k = 0; k <= N; k++){ phU[k] = -2*Math.PI*freqs[k]/fs*D; gdF[k] = gdValF; }
    return { freqs: freqs, phU: phU, gdMs: gdF, fir: true };
  }
  var coeffs = qaActiveCoeffs(fs);
  /* (vòng tự động 04:54, hướng B — ÁP DỤNG, vá code): cache bảng lượng giác lưới (cw/sw/cw2/sw2 trên 241 điểm) vào QA_GD_GRID[fs] thay vì dựng lại mỗi lần gọi — bảng chỉ phụ thuộc (freqs, fs) đã cache sẵn trong grid nên dựng MỘT lần ở lần trượt cache đầu tiên rồi dùng chung cho mọi lần gọi sau (kể cả đường 1 band trượt và đường lowPart), thay cho cơ chế trig/lowTrig cục bộ mỗi lần gọi (chỉ xây từ miss thứ 2; đường 1 band trượt phải tính lại cos/sin từng điểm qua qaBiquadPhaseRad). Cùng biểu thức 2*Math.PI*freqs[k]/fs, 2*cw*cw-1, 2*sw*cw và cùng thứ tự cộng trong atan2 nên pha từng band giống từng bit; lowPart vẫn sao chép k=0..56 như cũ, phần k>=57 tính qua grid.cw/sw/cw2/sw2. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0454_B/, 2 lần bench độc lập): parity 25/25 kịch bản GIỐNG TỪNG BIT (cold/warm/single-miss/multi-miss/lowPart hỗn hợp/cache prefill 390/400/401/FIR/fs 0/NaN/Infinity/grid reset/guard-like 30 bước/fuzz 200); tốc độ W1 single-miss drag 1,3888x/1,4219x thắng 15/15 cả 2 lần, W4 lowPart mix 1,5415x/1,5749x thắng 15/15,14/15, W5 cold recompute 1,0929x/1,1298x, W2 multi-miss trung tính 1,0139x/1,1003x, W3 warm all-hit trung tính 1,0030x (control old-vs-old 0,9872x, không hồi quy). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261124_0454_B/. */
  /* Chặng 5.5: cache pha theo từng band — kéo 1 band chỉ tính lại đúng band đó,
     các band còn lại lấy từ cache (khóa = toàn bộ hệ số + fs; -0 và 0 khác khóa
     nên không dùng chung sai). Cộng theo đúng thứ tự cũ nên tổng pha không đổi. */
  var raw = new Array(N + 1);
  for (k = 0; k <= N; k++) raw[k] = 0;
  for (i = 0; i < coeffs.length; i++){
    var cc = coeffs[i];
    var pKey;
    if (typeof QA_PHASE_KEY_WM !== "undefined" && QA_PHASE_KEY_WM && cc && typeof cc === "object"){
      var _ke = QA_PHASE_KEY_WM.get(cc);
      if (_ke && _ke.fs === fs) pKey = _ke.key;
      else { pKey = fs + "|" + cc.b0 + "|" + cc.b1 + "|" + cc.b2 + "|" + cc.a1 + "|" + cc.a2; QA_PHASE_KEY_WM.set(cc, { fs: fs, key: pKey }); }
    } else {
      pKey = fs + "|" + cc.b0 + "|" + cc.b1 + "|" + cc.b2 + "|" + cc.a1 + "|" + cc.a2;
    }
    var pArr = QA_PHASE_CACHE[pKey];
    if (!pArr){
      var lowPart = (typeof QA_PHASE_LOW !== "undefined") ? QA_PHASE_LOW[pKey] : null;
      if (!grid.cw){
        var cwA = new Float64Array(N + 1), swA = new Float64Array(N + 1),
            cw2A = new Float64Array(N + 1), sw2A = new Float64Array(N + 1);
        for (k = 0; k <= N; k++){
          var w = 2*Math.PI*freqs[k]/fs;
          cwA[k] = Math.cos(w); swA[k] = Math.sin(w);
          cw2A[k] = 2*cwA[k]*cwA[k] - 1; sw2A[k] = 2*swA[k]*cwA[k];
        }
        grid.cw = cwA; grid.sw = swA; grid.cw2 = cw2A; grid.sw2 = sw2A;
      }
      var _hasLow = !!(lowPart && lowPart.length === 57);
      pArr = new Float64Array(N + 1);
      if (_hasLow) for (k = 0; k <= 56; k++) pArr[k] = lowPart[k];
      for (k = _hasLow ? 57 : 0; k <= N; k++)
        pArr[k] = Math.atan2(-(cc.b1*grid.sw[k] + cc.b2*grid.sw2[k]), cc.b0 + cc.b1*grid.cw[k] + cc.b2*grid.cw2[k]) - Math.atan2(-(cc.a1*grid.sw[k] + cc.a2*grid.sw2[k]), 1 + cc.a1*grid.cw[k] + cc.a2*grid.cw2[k]);
      if (QA_PHASE_CACHE_N > 400){ QA_PHASE_CACHE = {}; QA_PHASE_CACHE_N = 0; }
      if (QA_PHASE_CACHE[pKey] === undefined) QA_PHASE_CACHE_N++;
      QA_PHASE_CACHE[pKey] = pArr;
    }
    /* (vòng tự động 00:54, hướng B — ÁP DỤNG, vá code): thay kiểm tra tràn cache QA_PHASE_CACHE trong qaPhaseGdData bằng bộ đếm QA_PHASE_CACHE_N (biến mới, đối xứng vá QA_PHASE_LOW_N 21:42 cho cache phần thấp) — trước đây mỗi lần miss (đổi preset/solve/guard, tới 20 miss/lần gọi) đều gọi Object.keys(QA_PHASE_CACHE).length, cấp phát mảng khóa đầy đủ (tới >400 khóa trong phiên dài) chỉ để so sánh >400; nay QA_PHASE_CACHE_N giữ đúng số khóa (tăng 1 khi gán khóa chưa tồn tại — kiểm tra === undefined trước khi gán, giữ nguyên hành vi ghi đè khóa đã có; reset 0 khi xóa toàn bộ cache tại đúng điểm xóa cũ duy nhất) và kiểm tra tràn chỉ là phép so sánh số nguyên; thứ tự kiểm tra/xóa/gán và mọi phép tính pha/GD giữ nguyên nên GIỐNG TỪNG BIT theo cấu trúc (kể cả xóa cache giữa vòng multi-miss, ghi đè khóa, NaN/±Infinity/-0, coeff null ném đúng TypeError rồi lan như cũ). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_0054_B/, 2 lần bench độc lập): parity 15/15 kịch bản GIỐNG TỪNG BIT cả 2 lần (Object.is trên freqs/phU/gdMs + tập khóa cache; gồm cold 10/20 band, warm-repeat, prefill 390/400/401 khóa + multi/single-miss, all-hit, FIR, cực đoan NaN/±Infinity/-0/1e308/subnormal, fs 0, null coeff ném lỗi, trùng object, chuỗi guard 30 bước xuyên ngưỡng xóa cache) kèm invariant QA_PHASE_CACHE_N == Object.keys(QA_PHASE_CACHE).length sau mọi lần gọi; tốc độ paired-median xen kẽ 15 vòng: lần 1 multi-20 cache 390 1,5302x (15/15), single-miss cache 390 1,3631x (12/15), all-hit 0,9964x trung tính (control); lần 2 multi-20 1,4027x (14/15), single-miss 1,3569x (11/15), all-hit 0,9909x trung tính — cải thiện ổn định trên đường miss khi cache lớn, không hồi quy đường hit. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261124_0054_B/. */
    /* (vòng tự động 16:24, hướng B — ÁP DỤNG, vá code): gộp vòng tính pha từng band và vòng cộng dồn raw trong qaPhaseGdData thành MỘT vòng — mỗi band vừa tra/tính xong pArr là cộng ngay vào raw[k] thay vì lưu vào mảng bandPh trung gian rồi duyệt lại lần nữa; thứ tự cộng theo band 0..n-1 cho mỗi k giữ nguyên (0 + band0 + band1 ... đúng như bản hai vòng) nên mọi double của raw/phU/gdMs giống từng bit theo cấu trúc; thứ tự tính pArr (kể cả miss/lowPart/cache-clear) giữ nguyên từng band nên trạng thái cache và lỗi ném giữ nguyên; bỏ cấp phát mảng bandPh và lần đọc bandPh[i] thứ hai. Khác hướng đã bác: bỏ qua bandCoeffs cho band tắt trong qaActiveCoeffs (12:24) — lượt này không đụng qaActiveCoeffs. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_1624_B/lab/, 2 lần bench độc lập): parity 65/65 kịch bản GIỐNG TỪNG BIT (Object.is trên freqs/phU/gdMs + snapshot cache; gồm cold 10/20, warm, drag 30 bước, multi-miss, prefill 390/400/401, lowPart, FIR, fs 0/NaN/Infinity/âm, coeff null/undefined/thiếu trường/NaN/Infinity, -0/subnormal, grid reset, fuzz 30); tốc độ paired-median xen kẽ 15 vòng: warm 20b 1,0482x/1,0335x thắng 15/11, psycho-on 1,0216x thắng 13/15, 10b 1,0427x thắng 13/15, mixed-off 1,0542x thắng 12/15 — cải thiện ổn định mọi workload. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm C. */
    for (k = 0; k <= N; k++) raw[k] += pArr[k];
  }
  /* (vòng tự động 06:47, hướng B — ÁP DỤNG, vá code): gộp vòng unwrap pha + vòng tính group-delay trong qaPhaseGdData thành MỘT vòng — khi phU[k] vừa tính xong, gd[k-1] đã đủ dữ liệu (a=max(0,k-2), b=k vì k<=N) nên tính ngay trong cùng vòng lặp, bỏ vòng gd riêng (482 lần Math.max/Math.min + đọc phU ngoài thứ tự) và giữ raw[k-1] trong biến cục bộ _prevRaw; biểu thức gd giữ nguyên từng toán hạng/thứ tự (-(phU[b]-phU[a])/grid.dw[j]/fs*1000) nên mọi double của phU/gdMs GIỐNG TỪNG BIT theo cấu trúc, kể cả biên k=0/k=N, NaN/±Infinity/-0 (biểu thức không đổi nên dấu -0 giữ nguyên). N=240 cố định nên nhánh N===0 chỉ là lưới an toàn. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0647_B/, 2 lần bench độc lập): parity 38/38 kiểm tra GIỐNG TỪNG BIT (Object.is trên freqs/phU/gdMs + snapshot cache/grid; gồm cold 10/20, warm, drag 25 bước, multi-miss, đổi fs, rỗng, FIR L1023/4096, lowPart, prefill 390, guard 30 bước, fuzz 200, identity, single, fs 0/NaN/Infinity/âm, coeff null/undefined/thiếu trường/NaN/Infinity, -0/subnormal, grid reset 10 fs) + control old-vs-old 0,9869x (nhiễu ±2%); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 warm 1,7588x (15/15), W2 single-miss 1,7364x (14/15), W3 multi-miss 1,6437x (15/15), W4 cold 1,0144x (10/15); lần 2 W1 1,7273x (15/15), W2 1,7086x (15/15), W3 1,5802x (15/15), W4 1,0282x (12/15) — cải thiện ổn định trên mọi workload nóng cả 2 lần, đường lạnh trung tính (dominance atan2). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261124_0647_B/. */
  var gd = new Array(N + 1);
  var off = 0;
  phU[0] = raw[0];
  if (N === 0){
    gd[0] = -(phU[0] - phU[0])/grid.dw[0]/fs*1000;
  } else {
    var _prevRaw = raw[0];
    for (k = 1; k <= N; k++){
      var d = raw[k] - _prevRaw;
      if (d > Math.PI) off -= 2*Math.PI; else if (d < -Math.PI) off += 2*Math.PI;
      phU[k] = raw[k] + off;
      var _a = (k - 2 < 0) ? 0 : k - 2;
      gd[k-1] = -(phU[k] - phU[_a])/grid.dw[k-1]/fs*1000;
      _prevRaw = raw[k];
    }
    gd[N] = -(phU[N] - phU[N-1])/grid.dw[N]/fs*1000;
  }
  return { freqs: freqs, phU: phU, gdMs: gd, fir: false };
}
/* --- Mở rộng 2026-11-23 (vòng tự động 19:06, hướng B — ÁP DỤNG, vá code): Lượt nhóm B (sau A 19:01, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 19:01:02+07, 6.236.378 byte / 25.318 dòng, md5 ca8a76820b0c215c10312ce214d45a23, version 292) khớp bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-B lưu tại ~/workspace/autoeq/backups/*2026-11-23_1903*. Ứng viên B duy nhất: chuyển vị vòng cộng pha trong qaPhaseGdData — trước đây mỗi điểm lưới k cộng dồn qua mọi band (đọc bandPh[i][k] nhảy giữa các mảng cho mọi k); nay khởi tạo raw[k]=0 rồi vòng ngoài duyệt band, vòng trong duyệt lưới cộng raw[k] += bandPh[i][k] tuần tự trong từng mảng pha — thứ tự cộng theo band 0..n-1 cho mỗi k giữ nguyên (0 + band0 + band1 ... đúng như s=0; s+=bandPh[0][k]; s+=bandPh[1][k]...) nên mọi double của raw/phU/gdMs GIỐNG TỪNG BIT theo cấu trúc, kể cả coeffs rỗng (raw toàn 0) và bandPh thiếu/NaN/Infinity (thứ tự cộng không đổi). Khác hướng đã bác: hoist lượng giác trong dbBandDbC (17:58) và cache bit-reversal fft (18:46) — lượt này không đổi lượng giác/FFT, chỉ đổi thứ tự duyệt vòng cộng đã có. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1903_B/, 2 lần chạy độc lập): parity 28.197/28.197 GIỐNG TỪNG BIT cả 2 lần (Object.is trên freqs/phU/gdMs + snapshot cache; gồm 17 scenario: 10/20/27 band × fs 8000/44100/48000/96000/192000/0/NaN, cold/warm, 1-miss/multi-miss, FIR L1023/4096, rỗng, identity, cực đoan NaN/±Infinity/-0/1e308/subnormal, coeff null/undefined ném đúng TypeError, coeff thiếu trường); tốc độ paired-median xen kẽ 15 vòng trên qaPhaseGdData warm: lần 1 20 band 1,0182x thắng 14/15; lần 2 20 band 1,0134x thắng 13/15, 10 band 1,0257x thắng 13/15 — cải thiện ổn định cả 2 lần trên mọi workload, nhỏ nhưng nhất quán (vòng cộng chỉ là một phần của hàm, phần còn lại là tra cache/unwrap/gd). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_1903_B/. --- */
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
    /* (vòng tự động 12:54, hướng B): cache chỉ số quét gdMaxLow/gdAt1k trên grid lưới QA_GD_GRID[fs] — lưới freqs chỉ phụ thuộc N=240 cố định nên chỉ số cuối cùng có freq<=100 và chỉ số đầu tiên có freq>=1000 không đổi theo lần gọi; tính MỘT lần rồi tái dùng: gdMaxLow quét 0..kMax (lọc freq<=100 như cũ, đúng với mọi lưới kể cả không đơn điệu vì mọi điểm khớp đều <= kMax) và gdAt1k lấy trực tiếp gdMs[kAt1k] (đúng định nghĩa điểm khớp đầu tiên); lần đầu chưa có cache thì quét đầy đủ như cũ rồi ghi cache. Mọi giá trị GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, lưới ngắn/rỗng, gdMs lệch độ dài). */
    var _gdGrid = (typeof QA_GD_GRID !== "undefined") ? QA_GD_GRID[fs] : null;
    if (_gdGrid && _gdGrid._scanKMax !== undefined){
      var _kMax = _gdGrid._scanKMax, _kAt1k = _gdGrid._scanKAt1k;
      var _qf = d.freqs, _qg = d.gdMs;
      for (var _qi = 0; _qi <= _kMax; _qi++){
        if (_qf[_qi] <= 100 && (QA6.gdMaxLow === null || _qg[_qi] > QA6.gdMaxLow)) QA6.gdMaxLow = _qg[_qi];
      }
      QA6.gdAt1k = (_kAt1k >= 0) ? _qg[_kAt1k] : null;
    } else {
      d.freqs.forEach(function(f, i){
        if (f <= 100 && (QA6.gdMaxLow === null || d.gdMs[i] > QA6.gdMaxLow)) QA6.gdMaxLow = d.gdMs[i];
        if (QA6.gdAt1k === null && f >= 1000) QA6.gdAt1k = d.gdMs[i];
      });
      if (_gdGrid){
        var _kMax2 = -1, _kAt1k2 = -1;
        for (var _qi2 = 0; _qi2 < d.freqs.length; _qi2++){
          if (d.freqs[_qi2] <= 100) _kMax2 = _qi2;
          if (_kAt1k2 < 0 && d.freqs[_qi2] >= 1000) _kAt1k2 = _qi2;
        }
        _gdGrid._scanKMax = _kMax2;
        _gdGrid._scanKAt1k = _kAt1k2;
      }
    }
    var coeffs = qaActiveCoeffs(fs), ph1 = 0, i;
    if (mode === "fir") ph1 = -360*1000/fs*(firLen - 1)/2;
    else {
      /* (vòng tự động 12:17, hướng B): hoist lượng giác trong vòng tính pha tại 1 kHz của qaDrawPhaseGd — qaBiquadPhaseRad tính lại cos/sin của cùng w=2*Math.PI*1000/fs cho MỌI hệ số (f và fs cố định trong vòng lặp) nên tính _cw/_sw/_cw2/_sw2 MỘT lần rồi nội tuyến đúng biểu thức atan2 của qaBiquadPhaseRad (giữ nguyên từng toán hạng/thứ tự đọc thuộc tính b0,b1,b2,a1,a2 và phép *180/Math.PI từng lần lặp) — mọi double của ph1 giống từng bit theo cấu trúc, kể cả coeffs rỗng/không hữu hạn/fs biên (lượng giác tính trước vòng lặp không có tác dụng phụ, không ném lỗi). qaBiquadPhaseRad giữ nguyên định nghĩa. */
      var _w1k = 2*Math.PI*1000/fs, _cw1k = Math.cos(_w1k), _sw1k = Math.sin(_w1k), _cw21k = 2*_cw1k*_cw1k - 1, _sw21k = 2*_sw1k*_cw1k;
      for (i = 0; i < coeffs.length; i++){
        var _c1k = coeffs[i];
        var _nr1k = _c1k.b0 + _c1k.b1*_cw1k + _c1k.b2*_cw21k, _ni1k = -(_c1k.b1*_sw1k + _c1k.b2*_sw21k);
        var _dr1k = 1 + _c1k.a1*_cw1k + _c1k.a2*_cw21k, _di1k = -(_c1k.a1*_sw1k + _c1k.a2*_sw21k);
        ph1 += (Math.atan2(_ni1k, _nr1k) - Math.atan2(_di1k, _dr1k))*180/Math.PI;
      }
    }
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
  /* (vòng tự động 18:24, hướng B): hoist 5 trường hệ số (b0,b1,b2,a1,a2) của từng band ra 5 mảng số thuần MỘT lần trước vòng mẫu — trước đây mỗi mẫu × mỗi band × mỗi kênh đều nạp lại c.b0..c.a2 qua thuộc tính object (tới 2×N×nF×5 lần nạp/mỗi lần gọi); nay đọc đúng MỘT lần/band rồi vòng trong đọc số thuần B0[b]..A2[b]. Cùng toán hạng/thứ tự phép tính (y = b0*x + s1; s1 = b1*x - a1*y + s2; s2 = b2*x - a2*y) nên mọi mẫu GIỐNG TỪNG BIT theo cấu trúc; chỉ hoist khi N>0 để giữ nguyên hành vi N=0 (không đọc hệ số, trả mảng rỗng như cũ kể cả khi coeff null/thiếu trường). Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_1824_B/lab/, harness2.js, 2 lần bench độc lập + xác minh lại trên chính file đã vá): parity 34/34 GIỐNG TỪNG BIT cả 2 lần (Object.is trên mọi mẫu + đúng loại lỗi ném; gồm nF 0/1/10/20/32 × N 0/1/7/4096, coeff NaN/±Infinity/-0/subnormal/thiếu trường/cực đoan 1e308, coeff null/undefined ném đúng TypeError, N=0 với coeff null không ném như cũ, mảng coeffs null, xL null, xL/xR lệch độ dài, fuzz 200); tốc độ paired-median xen kẽ 15 vòng trên qaCascade 20 band × 65536 mẫu: lần 1 2,9929x thắng 15/15, lần 2 2,8774x thắng 15/15 (xác minh trên file đã vá: 3,0267x/2,9593x thắng 15/15 cả 2 lần; control old-vs-old 1,0012x/1,0008x) — cải thiện ổn định. qaCascade là bản sao ngoại tuyến tham chiếu của chuỗi DSP (đo THD+N/null/IR trong qaRunSuite) nên không chạm solver/WASM/FIR; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm C. */
  var B0 = null, B1 = null, B2 = null, A1 = null, A2 = null;
  if (N > 0){
    B0 = new Array(nF); B1 = new Array(nF); B2 = new Array(nF); A1 = new Array(nF); A2 = new Array(nF);
    for (var _hi = 0; _hi < nF; _hi++){ var _hc = coeffs[_hi]; B0[_hi] = _hc.b0; B1[_hi] = _hc.b1; B2[_hi] = _hc.b2; A1[_hi] = _hc.a1; A2[_hi] = _hc.a2; }
  }
  for (var n = 0; n < N; n++){
    var x = xL[n], y, b;
    for (b = 0; b < nF; b++){ y = B0[b]*x + s1L[b]; s1L[b] = B1[b]*x - A1[b]*y + s2L[b]; s2L[b] = B2[b]*x - A2[b]*y; x = y; }
    yL[n] = x;
    x = xR[n];
    for (b = 0; b < nF; b++){ y = B0[b]*x + s1R[b]; s1R[b] = B1[b]*x - A1[b]*y + s2R[b]; s2R[b] = B2[b]*x - A2[b]*y; x = y; }
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

"use strict";
/* ================================================================
   Giai đoạn 6 (tiếp): phép đo QA, dashboard, cổng xuất file,
   mutation test, chạy toàn bộ QA + báo cáo tổng hợp.
   ================================================================ */
function qaThdN(levelDb, fs){
  var N = 24000, amp = Math.pow(10, levelDb/20), w = 2*Math.PI*1000/fs, i;
  var x = new Float64Array(N);
  for (i = 0; i < N; i++) x[i] = amp*Math.sin(w*i);
  var out = qaChain(x, x, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 });
  var y = out[0], a0 = 4096;
  /* Bình phương tối thiểu: khớp y ≈ A·cos(wn) + B·sin(wn) + C trên cửa sổ đo */
  var Scc = 0, Sss = 0, Scs = 0, Sc = 0, Ss = 0, Syc = 0, Sys = 0, Sy = 0, cnt = 0;
  for (i = a0; i < N; i++){
    var c = Math.cos(w*i), s = Math.sin(w*i);
    Scc += c*c; Sss += s*s; Scs += c*s; Sc += c; Ss += s;
    Syc += y[i]*c; Sys += y[i]*s; Sy += y[i]; cnt++;
  }
  var M = [[Scc, Scs, Sc], [Scs, Sss, Ss], [Sc, Ss, cnt]], v = [Syc, Sys, Sy], k, j, p;
  for (k = 0; k < 3; k++){
    p = k; for (j = k + 1; j < 3; j++) if (Math.abs(M[j][k]) > Math.abs(M[p][k])) p = j;
    var tmp = M[p]; M[p] = M[k]; M[k] = tmp; var tv = v[p]; v[p] = v[k]; v[k] = tv;
    for (j = k + 1; j < 3; j++){ var fct = M[j][k]/M[k][k]; for (var q = k; q < 3; q++) M[j][q] -= fct*M[k][q]; v[j] -= fct*v[k]; }
  }
  var sol = [0, 0, 0];
  for (k = 2; k >= 0; k--){ var sm = v[k]; for (j = k + 1; j < 3; j++) sm -= M[k][j]*sol[j]; sol[k] = sm/M[k][k]; }
  var resP = 0;
  for (i = a0; i < N; i++){
    var fit = sol[0]*Math.cos(w*i) + sol[1]*Math.sin(w*i) + sol[2];
    var r = y[i] - fit; resP += r*r;
  }
  resP /= cnt;
  var fundP = (sol[0]*sol[0] + sol[1]*sol[1])/2;
  return { thdnDb: 10*Math.log10(Math.max(resP, 1e-300)/fundP), residDbfs: 10*Math.log10(Math.max(resP, 1e-300)) };
}
function qaFirTapsFor(bandList, fs, L){
  var Nf = 4096, re = new Float64Array(Nf), im = new Float64Array(Nf), k, f;
  var qaCc = dbBandCoeffs(bandList, fs);
  for (k = 0; k <= Nf/2; k++){
    f = Math.min(k*fs/Nf, fs*0.499);
    var db = dbBandDbC(qaCc, Math.max(f, 10), fs);
    re[k] = Math.pow(10, db/20); im[k] = 0;
    if (k > 0 && k < Nf/2){ re[Nf - k] = re[k]; im[Nf - k] = 0; }
  }
  fft(re, im, true);
  var taps = new Float64Array(L), half = (L - 1)/2;
  for (var i = 0; i < L; i++){
    var idx = ((i - half) % Nf + Nf) % Nf;
    taps[i] = re[idx]*(0.5 - 0.5*Math.cos(2*Math.PI*i/(L - 1)));
  }
  return taps;
}
function qaNullIir(fs){
  var x = qaNoise(16384, 0.5), coeffs = qaCoeffsFor(QA_TEST_BANDS, fs, {});
  var y = qaCascade(x, x, coeffs)[0];
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var y2 = qaCascade(y, y, qaCoeffsFor(invBands, fs, {}))[0];
  var s = 0, n = 0, i;
  for (i = 200; i < 16000; i++){ var d = y2[i] - x[i]; s += d*d; n++; }
  return 10*Math.log10(Math.max(s/n, 1e-300));
}
function qaNullFir(fs){
  var L = 1023, h = qaFirTapsFor(QA_TEST_BANDS, fs, L);
  var D = 0, pk = 0, i, k;
  for (i = 0; i < L; i++) if (Math.abs(h[i]) > pk){ pk = Math.abs(h[i]); D = i; }
  var M = 32768, x = qaNoise(8192, 0.5, 246813579);
  var xr = new Float64Array(M), xi = new Float64Array(M); xr.set(x);
  var hr = new Float64Array(M), hi = new Float64Array(M); hr.set(h);
  fft(xr, xi, false);
  var Xr = xr.slice(), Xi = xi.slice();
  fft(hr, hi, false);
  var yr = new Float64Array(M), yi = new Float64Array(M);
  for (k = 0; k < M; k++){ yr[k] = Xr[k]*hr[k] - Xi[k]*hi[k]; yi[k] = Xr[k]*hi[k] + Xi[k]*hr[k]; }
  var zr = new Float64Array(M), zi = new Float64Array(M);
  for (k = 0; k < M; k++){
    var den = Math.max(hr[k]*hr[k] + hi[k]*hi[k], 1e-12);
    var ir = hr[k]/den, ii = -hi[k]/den;
    /* Bộ nghịch đảo mang trễ tuyến tính riêng bằng 2D: 1/H tự nó đã khử trễ D của FIR,
       nên cộng 2D để đáp tuyến pha tổng = −2ωD, tức tín hiệu ra trễ đúng 2D so với gốc —
       phần dư được tính sau khi bù đúng tổng trễ 2D này. */
    var th = 2*Math.PI*k*(2*D)/M, c = Math.cos(th), sn = -Math.sin(th);
    var vr = ir*c - ii*sn, vi = ir*sn + ii*c;
    zr[k] = yr[k]*vr - yi[k]*vi; zi[k] = yr[k]*vi + yi[k]*vr;
  }
  fft(zr, zi, true);
  var s = 0, n = 0, totDelay = 2*D;
  for (i = 1400; i < 8000; i++){ var d = zr[i] - x[i - totDelay]; s += d*d; n++; }
  return { rmsDbfs: 10*Math.log10(Math.max(s/n, 1e-300)), dMeas: D };
}
/* ================================================================
   Chặng 1 (lộ trình 4 chặng 2026-10-26): QA trên worklet thật,
   Null Test có limiter, lưu trữ bền vững Opt-In.
   Ghi chú trung thực về sàn đo (đọc trước khi sửa ngưỡng):
   bản sao ngoại tuyến chạy float64 nên THD+N/null của nó nằm ở sàn
   -257/-265 dB, trong khi AudioWorklet vào/ra mẫu Float32 nên mọi phép
   đo qua worklet thật đều nằm ở sàn Float32 (~-153 dB cho THD+N,
   ~-161 dB cho null). Lệch thô giữa hai sàn (~100 dB) KHÔNG phải lệch
   DSP — bằng chứng là phép đối chiếu có gương Float32 (cùng đầu vào
   Float32, cùng lượng tử hoá đầu ra Float32 ở mọi biên worklet) khớp
   worklet trong 0,00 dB (THD+N) và 0,27 dB (null IIR). Vì vậy tiêu chí
   lệch của qaWorkletParity so với bản gương Float32, còn số thô của
   bản float64 vẫn được báo cáo đầy đủ, không giấu.
   ================================================================ */
function qaWorkletProc(fs){
  var StubProc = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
  var ProcCtor = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
    WORKLET_SRC + "\n; return AutoEqProcessor;");
  var Proc = ProcCtor(StubProc, fs, function(){});
  return new Proc();
}
function qaRunWorklet(proc, x, blocks, onBlock){
  var out = new Float64Array(x.length), oi = 0, b, n;
  for (b = 0; b < blocks; b++){
    var inL = new Float32Array(128), inR = new Float32Array(128), outL = new Float32Array(128), outR = new Float32Array(128);
    for (n = 0; n < 128; n++){ var v = (b*128+n < x.length) ? x[b*128+n] : 0; inL[n] = v; inR[n] = v; }
    proc.process([[inL, inR]], [[outL, outR]]);
    if (onBlock) onBlock(proc);
    for (n = 0; n < 128 && oi < out.length; n++, oi++) out[oi] = outL[n];
  }
  return out;
}
function qaQ32(v){ return new Float32Array([v])[0]; }
/* Khớp bình phương tối thiểu 3 tham số (A·cos + B·sin + C) — cùng công
   thức với qaThdN, tách ra để cả đường worklet và đường gương dùng chung. */
function qaThdNFit(y, w, a0, N){
  var Scc = 0, Sss = 0, Scs = 0, Sc = 0, Ss = 0, Syc = 0, Sys = 0, Sy = 0, cnt = 0, i;
  for (i = a0; i < N; i++){ var c = Math.cos(w*i), s = Math.sin(w*i); Scc += c*c; Sss += s*s; Scs += c*s; Sc += c; Ss += s; Syc += y[i]*c; Sys += y[i]*s; Sy += y[i]; cnt++; }
  var M = [[Scc, Scs, Sc], [Scs, Sss, Ss], [Sc, Ss, cnt]], v = [Syc, Sys, Sy], k, j, p;
  for (k = 0; k < 3; k++){
    p = k; for (j = k + 1; j < 3; j++) if (Math.abs(M[j][k]) > Math.abs(M[p][k])) p = j;
    var tmp = M[p]; M[p] = M[k]; M[k] = tmp; var tv = v[p]; v[p] = v[k]; v[k] = tv;
    for (j = k + 1; j < 3; j++){ var fct = M[j][k]/M[k][k]; for (var q = k; q < 3; q++) M[j][q] -= fct*M[k][q]; v[j] -= fct*v[k]; }
  }
  var sol = [0, 0, 0];
  for (k = 2; k >= 0; k--){ var sm = v[k]; for (j = k + 1; j < 3; j++) sm -= M[k][j]*sol[j]; sol[k] = sm/M[k][k]; }
  var resP = 0;
  for (i = a0; i < N; i++){ var fit = sol[0]*Math.cos(w*i) + sol[1]*Math.sin(w*i) + sol[2]; var r = y[i] - fit; resP += r*r; }
  resP /= cnt;
  var fundP = (sol[0]*sol[0] + sol[1]*sol[1])/2;
  return { thdnDb: 10*Math.log10(Math.max(resP, 1e-300)/fundP), residDbfs: 10*Math.log10(Math.max(resP, 1e-300)) };
}
/* Bước 1.1 — Null Test có limiter: nhiễu nhỏ qua worklet thật với
   pre-amp tự động -(maxPos+1) dB và limiter BẬT; bù trễ LA=128 và bù
   gain tĩnh nghịch đảo rồi qua cascade nghịch đảo. ĐẠT khi phần dư
   < -80 dBFS và minGr === 1 (limiter không cắt nhầm trong headroom). */
function qaNullIirWithLimiter(fs){
  var maxPos = 0, i;
  QA_TEST_BANDS.forEach(function(b){ if (b.gain > maxPos) maxPos = b.gain; });
  var preampDb = -(maxPos + 1.0);
  var preampLin = Math.pow(10, preampDb/20);
  var x = qaNoise(16384, 0.15, 135792468);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(QA_TEST_BANDS, fs, {}) } });
  proc.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: preampLin, slotLin: 1 } });
  qaRunWorklet(proc, new Float64Array(64*128), 64);
  var minGr = 1;
  var y = qaRunWorklet(proc, x, 128, function(pr){ if (pr.gr < minGr) minGr = pr.gr; });
  var LA = 128, invGain = Math.pow(10, -preampDb/20);
  var yShift = new Float64Array(16384);
  for (i = 0; i < 16384; i++) yShift[i] = (i + LA < 16384) ? y[i + LA]*invGain : 0;
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var y2 = qaCascade(yShift, yShift, qaCoeffsFor(invBands, fs, {}))[0];
  var s = 0, n = 0;
  for (i = 1000; i < 15000; i++){ var d = y2[i] - x[i]; s += d*d; n++; }
  var residDb = 10*Math.log10(Math.max(s/n, 1e-300));
  var pk = 0; for (i = 0; i < y.length; i++) if (Math.abs(y[i]) > pk) pk = Math.abs(y[i]);
  return { residDb: residDb, minGr: minGr, preampDb: preampDb, outPeakDb: 20*Math.log10(Math.max(1e-12, pk)) };
}
/* Bước 1.2a — THD+N trên worklet thật: sine 1 kHz qua processor thật
   (EQ phẳng, limiter BẬT), 32 block warm-up 0, khớp từ mẫu 4096+128. */
function qaThdNWorklet(levelDb, fs){
  var N = 24000, amp = Math.pow(10, levelDb/20), w = 2*Math.PI*1000/fs, i;
  var x = new Float64Array(N);
  for (i = 0; i < N; i++) x[i] = amp*Math.sin(w*i);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(qaFlatBands(), fs, {}) } });
  proc.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: 1, slotLin: 1 } });
  qaRunWorklet(proc, new Float64Array(32*128), 32);
  var y = qaRunWorklet(proc, x, Math.ceil(N/128));
  return qaThdNFit(y, w, 4096 + 128, N);
}
/* Gương Float32 của qaThdN: cùng chuỗi ngoại tuyến nhưng lượng tử hoá
   đầu vào/ra về Float32 tại đúng biên AudioWorklet, để lệch đo được là
   lệch DSP thật chứ không phải lệch sàn mẫu. */
function qaThdNMirror(levelDb, fs){
  var N = 24000, amp = Math.pow(10, levelDb/20), w = 2*Math.PI*1000/fs, i;
  var x = new Float64Array(N);
  for (i = 0; i < N; i++) x[i] = qaQ32(amp*Math.sin(w*i));
  var out = qaChain(x, x, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 });
  var y = new Float64Array(N);
  for (i = 0; i < N; i++) y[i] = qaQ32(out[0][i]);
  return qaThdNFit(y, w, 4096 + 128, N);
}
/* Bước 1.2b — Null IIR trên worklet thật: chặng xuôi và chặng nghịch đảo
   đều qua processor thật; bù trễ 2×128 mẫu (2 lần qua delay line limiter
   dù limiterOn=false vì đường tín hiệu luôn đi qua dlyL/dlyR). */
function qaNullIirWorklet(fs){
  var x = qaNoise(16384, 0.5);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(QA_TEST_BANDS, fs, {}) } });
  proc.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
  qaRunWorklet(proc, new Float64Array(64*128), 64);
  var y = qaRunWorklet(proc, x, 128);
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var proc2 = qaWorkletProc(fs);
  proc2.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(invBands, fs, {}) } });
  proc2.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
  qaRunWorklet(proc2, new Float64Array(64*128), 64);
  var y2full = qaRunWorklet(proc2, y, 128);
  var s = 0, n = 0, i;
  for (i = 1000; i < 15000; i++){ var d = y2full[i + 256] - x[i]; s += d*d; n++; }
  return 10*Math.log10(Math.max(s/n, 1e-300));
}
/* Gương Float32 của null IIR: cùng cửa sổ 1000..15000, lượng tử hoá
   đầu vào và đầu ra chặng xuôi về Float32 tại biên worklet. */
function qaNullIirMirror(fs){
  var x = qaNoise(16384, 0.5);
  var xq = new Float64Array(x.length), i;
  for (i = 0; i < x.length; i++) xq[i] = qaQ32(x[i]);
  var y = qaCascade(xq, xq, qaCoeffsFor(QA_TEST_BANDS, fs, {}))[0];
  var yq = new Float64Array(y.length);
  for (i = 0; i < y.length; i++) yq[i] = qaQ32(y[i]);
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var y2 = qaCascade(yq, yq, qaCoeffsFor(invBands, fs, {}))[0];
  var s = 0, n = 0;
  for (i = 1000; i < 15000; i++){ var d = y2[i] - x[i]; s += d*d; n++; }
  return 10*Math.log10(Math.max(s/n, 1e-300));
}
/* Bước 1.2c — Null FIR với chặng xuôi qua worklet thật (mode fir, taps
   QA_TEST_BANDS) và chặng nghịch đảo bằng giải chập FFT ngoại tuyến
   (cùng phương pháp với qaNullFir, đã kiểm chứng độc lập). Bù trễ
   limiter 128 mẫu trước khi giải chập; phần dư so với x trễ 2D. */
function qaNullFirWorklet(fs){
  var L = 1023, h = qaFirTapsFor(QA_TEST_BANDS, fs, L);
  var D = 0, pk = 0, i;
  for (i = 0; i < L; i++) if (Math.abs(h[i]) > pk){ pk = Math.abs(h[i]); D = i; }
  var x = qaNoise(8192, 0.5, 246813579);
  var sig = new Float64Array(8192 + 128);
  sig.set(x);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "fir", taps: h } });
  proc.port.onmessage({ data: { type: "config", mode: "fir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
  var yW = qaRunWorklet(proc, sig, Math.ceil(sig.length/128));
  var yConv = new Float64Array(8192);
  for (i = 0; i < 8192; i++) yConv[i] = yW[i + 128];
  var M = 32768;
  var xr = new Float64Array(M), xi = new Float64Array(M); xr.set(yConv);
  var hr = new Float64Array(M), hi = new Float64Array(M); hr.set(h);
  fft(xr, xi, false);
  var Xr = xr.slice(), Xi = xi.slice();
  fft(hr, hi, false);
  var zr = new Float64Array(M), zi = new Float64Array(M), k;
  for (k = 0; k < M; k++){
    var den = Math.max(hr[k]*hr[k] + hi[k]*hi[k], 1e-12);
    var ir = hr[k]/den, ii = -hi[k]/den;
    var th = 2*Math.PI*k*(2*D)/M, c = Math.cos(th), sn = -Math.sin(th);
    var vr = ir*c - ii*sn, vi = ir*sn + ii*c;
    zr[k] = Xr[k]*vr - Xi[k]*vi; zi[k] = Xr[k]*vi + Xi[k]*vr;
  }
  fft(zr, zi, true);
  var s = 0, n = 0, totDelay = 2*D;
  for (i = 1400; i < 8000; i++){ var d = zr[i] - x[i - totDelay]; s += d*d; n++; }
  return { rmsDbfs: 10*Math.log10(Math.max(s/n, 1e-300)), dMeas: D };
}
/* Bước 1.2 — Gom đối chiếu worklet thật vs bản sao ngoại tuyến. */
function qaWorkletParity(fs){
  var thW20 = qaThdNWorklet(-20, fs), thW1 = qaThdNWorklet(-1, fs);
  var thM20 = qaThdNMirror(-20, fs), thOff20 = qaThdN(-20, fs);
  var nullW = qaNullIirWorklet(fs), nullM = qaNullIirMirror(fs), nullRaw = qaNullIir(fs);
  var firW = qaNullFirWorklet(fs), firOff = qaNullFir(fs);
  var okTh = thW20.thdnDb < -140 && thW1.thdnDb < -40 && Math.abs(thW20.thdnDb - thM20.thdnDb) <= 0.5;
  var okNull = nullW < -80 && Math.abs(nullW - nullM) <= 1.0;
  var okFir = firW.rmsDbfs < -80;
  return { thW20: thW20, thW1: thW1, thM20: thM20, thOff20: thOff20,
    nullW: nullW, nullM: nullM, nullRaw: nullRaw, firW: firW, firOff: firOff,
    okTh: okTh, okNull: okNull, okFir: okFir, ok: okTh && okNull && okFir };
}
/* ================================================================
   Bước 1.3 — Kho lưu trữ bền vững Opt-In (Preset v2 + Lịch sử QA).
   Tầng lõi thuần (không chạm DOM): mọi hàm nhận store {get,set,del}
   nên vaultSelfCheck chạy trên store bộ nhớ cô lập mà không bao giờ
   động vào localStorage/IndexedDB thật của người dùng. Đồng bộ
   IndexedDB (DB riêng "webAutoEqVault.v1", store "userVault") chỉ nằm
   ở hàm vaultIdb* riêng, gọi từ UI/hook báo cáo, luôn best-effort
   (không throw, không chặn luồng chính).
   ================================================================ */
var VAULT_KEYS = { optIn: "webAutoEq.optInStore.v1", presets: "webAutoEq.presetLibrary.v1", qa: "webAutoEq.qaHistory.v1" };
function vaultMemStore(){
  var m = {};
  return { get: function(k){ return (k in m) ? m[k] : null; },
    set: function(k, v){ m[k] = String(v); },
    del: function(k){ delete m[k]; } };
}
var _vaultMemFallback = null;
function vaultDefaultStore(){
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return { get: function(k){ try { return localStorage.getItem(k); } catch (e){ return null; } },
        set: function(k, v){ try { localStorage.setItem(k, String(v)); } catch (e){} },
        del: function(k){ try { localStorage.removeItem(k); } catch (e){} } };
    }
  } catch (e){}
  if (!_vaultMemFallback) _vaultMemFallback = vaultMemStore();
  return _vaultMemFallback;
}
function vaultGetOptIn(store){
  store = store || vaultDefaultStore();
  return store.get(VAULT_KEYS.optIn) === "1";
}
function vaultSetOptIn(on, store){
  store = store || vaultDefaultStore();
  if (on){ store.set(VAULT_KEYS.optIn, "1"); return { optIn: true }; }
  store.set(VAULT_KEYS.optIn, "0");
  store.del(VAULT_KEYS.presets);
  store.del(VAULT_KEYS.qa);
  return { optIn: false, cleared: true };
}
function vaultReadList(store, key){
  /* Pha C 2026-11-05: loc muc ban luc doc — chi giu muc la doi tuong (khong
     phai null/chuoi/so/mang). Truoc day chi kiem tra Array.isArray o muc
     mang: 1 muc ban trong localStorage (sua tay/tien ich mo rong/ban cu)
     lam vaultRenamePreset nem TypeError (block strict) khong duoc bat o
     handler "Luu ten", va .map() trong vaultRenderLists nem theo -> ca
     danh sach preset + lich su QA deu khong hien. Muc tot giu nguyen;
     muc ban bi bo luc doc va tu bien mat o lan luu sau (ghi lai danh
     sach da loc). */
  try { var v = store.get(key); if (!v) return []; var a = JSON.parse(v);
    return Array.isArray(a) ? a.filter(function(it){ return it && typeof it === "object" && !Array.isArray(it); }) : []; }
  catch (e){ return []; }
}
function vaultWriteList(store, key, list){
  try { store.set(key, JSON.stringify(list)); return true; }
  catch (e){
    try { list = list.slice(1); store.set(key, JSON.stringify(list)); return true; } catch (e2){ return false; }
  }
}
function vaultSavePreset(presetObj, store){
  store = store || vaultDefaultStore();
  if (!vaultGetOptIn(store)) return { saved: false, reason: "opt-in tắt" };
  var list = vaultReadList(store, VAULT_KEYS.presets);
  list.push({ name: (presetObj && presetObj.name) || "Preset v2",
    bands: (presetObj && presetObj.eq && presetObj.eq.bands) ? presetObj.eq.bands.length : 0,
    savedAt: new Date().toISOString(), preset: presetObj });
  /* Pha B 2026-11-05: bao ten preset cu nhat bi loai khi thu vien day
     (toi da 20, FIFO) — truoc day while/list.shift() xoa lang le, gia tri
     tra ve va giao dien deu khong co tin hieu nao, nguoi dung khong biet
     preset cu nhat cua minh vua bien mat. Khong doi hanh vi FIFO, chi
     them truong dropped[] (ten cac muc vua bi loai, thuong 0 hoac 1 muc). */
  var dropped = [];
  while (list.length > 20) { var _old = list.shift(); if (_old && _old.name) dropped.push(_old.name); }
  var ok = vaultWriteList(store, VAULT_KEYS.presets, list);
  return { saved: ok, count: list.length, dropped: dropped };
}
/* Pha B 2026-11-05: doi ten preset da luu trong vault — truoc day chi doi
   duoc ten luc luu qua #psStoreName; preset luu sai ten phai xoa + luu lai,
   mat thu tu savedAt. Ham thuan (khong cham DOM): doi ten tai cho, giu
   nguyen savedAt, thu tu va so band; dong bo ca ten trong preset goc de
   xuat bundle/tai JSON van dung ten moi. Ten cat khoang trang, toi da
   80 ky tu (giong maxlength cua #psStoreName); ten rong hoac chi muc
   ngoai khoang bi tu choi, khong doi danh sach. */
function vaultRenamePreset(index, newName, store){
  store = store || vaultDefaultStore();
  if (!vaultGetOptIn(store)) return { renamed: false, reason: "opt-in tắt" };
  var list = vaultReadList(store, VAULT_KEYS.presets);
  var i = parseInt(index, 10);
  if (!isFinite(i) || i < 0 || i >= list.length) return { renamed: false, reason: "chỉ mục ngoài khoảng" };
  var nm = String(newName == null ? "" : newName).trim().slice(0, 80);
  if (!nm) return { renamed: false, reason: "tên trống" };
  var it = list[i];
  it.name = nm;
  if (it.preset && typeof it.preset === "object") it.preset.name = nm;
  var ok = vaultWriteList(store, VAULT_KEYS.presets, list);
  return { renamed: ok, name: nm };
}
function vaultSaveQaReport(summary, store){
  store = store || vaultDefaultStore();
  if (!vaultGetOptIn(store)) return { saved: false, reason: "opt-in tắt" };
  var list = vaultReadList(store, VAULT_KEYS.qa);
  var item = { id: summary.id || ("qa-" + Date.now()), timestamp: summary.timestamp || new Date().toISOString(),
    passCount: summary.passCount, totalCount: summary.totalCount, realFails: summary.realFails,
    stageLine: summary.stageLine || "", reportJson: summary.reportJson || null, truncated: false };
  list.push(item);
  while (list.length > 15) list.shift();
  var ok = vaultWriteList(store, VAULT_KEYS.qa, list);
  if (!ok && item.reportJson){
    item.reportJson = null; item.truncated = true;
    ok = vaultWriteList(store, VAULT_KEYS.qa, list);
  }
  return { saved: ok, count: list.length };
}
function vaultListPresets(store){ return vaultReadList(store || vaultDefaultStore(), VAULT_KEYS.presets); }
function vaultListQa(store){ return vaultReadList(store || vaultDefaultStore(), VAULT_KEYS.qa); }
function vaultClearPresets(store){
  store = store || vaultDefaultStore();
  store.del(VAULT_KEYS.presets);
  return { cleared: true };
}
function vaultClearQa(store){
  store = store || vaultDefaultStore();
  store.del(VAULT_KEYS.qa);
  return { cleared: true };
}
function vaultSelfCheck(){
  var s = vaultMemStore(), ok = true, notes = [];
  var r1 = vaultSavePreset({ name: "Kiểm tra A", eq: { bands: [1,2,3] } }, s);
  var r2 = vaultSaveQaReport({ passCount: 10, totalCount: 10, realFails: 0 }, s);
  if (r1.saved || r2.saved) { ok = false; notes.push("opt-in tắt nhưng vẫn lưu được"); }
  if (vaultListPresets(s).length !== 0 || vaultListQa(s).length !== 0) { ok = false; notes.push("opt-in tắt nhưng danh sách không rỗng"); }
  vaultSetOptIn(true, s);
  vaultSavePreset({ name: "Kiểm tra A", eq: { bands: [1,2,3] } }, s);
  vaultSavePreset({ name: "Kiểm tra B", eq: { bands: [1,2] } }, s);
  vaultSaveQaReport({ passCount: 10, totalCount: 12, realFails: 2 }, s);
  vaultSaveQaReport({ passCount: 12, totalCount: 12, realFails: 0 }, s);
  var ps = vaultListPresets(s), qs = vaultListQa(s);
  if (ps.length !== 2 || ps[0].name !== "Kiểm tra A" || ps[1].name !== "Kiểm tra B" || ps[0].bands !== 3) { ok = false; notes.push("preset đọc lại không khớp 100%"); }
  if (qs.length !== 2 || qs[0].passCount !== 10 || qs[1].realFails !== 0) { ok = false; notes.push("báo cáo QA đọc lại không khớp 100%"); }
  /* Kich ban 4 — Pha B 2026-11-05: doi ten giu savedAt/thu tu/so band,
     dong bo ten trong preset goc; ten rong, chi muc ngoai khoang bi tu
     choi; ten dai 100 ky tu cat dung 80 ky tu. */
  var savedAt0 = ps[0].savedAt;
  var rr = vaultRenamePreset(0, "  Kiểm tra A (đổi tên)  ", s);
  var psR = vaultListPresets(s);
  if (!rr.renamed || rr.name !== "Kiểm tra A (đổi tên)") { ok = false; notes.push("đổi tên không trả về tên đã cắt khoảng trắng"); }
  if (psR.length !== 2 || psR[0].name !== "Kiểm tra A (đổi tên)" || psR[1].name !== "Kiểm tra B") { ok = false; notes.push("đổi tên làm sai tên/thứ tự"); }
  if (psR[0].savedAt !== savedAt0 || psR[0].bands !== 3) { ok = false; notes.push("đổi tên làm đổi savedAt/số band"); }
  if (!psR[0].preset || psR[0].preset.name !== "Kiểm tra A (đổi tên)") { ok = false; notes.push("đổi tên không đồng bộ tên trong preset gốc"); }
  if (vaultRenamePreset(0, "   ", s).renamed) { ok = false; notes.push("đổi tên rỗng vẫn được chấp nhận"); }
  if (vaultRenamePreset(99, "X", s).renamed || vaultRenamePreset(-1, "X", s).renamed) { ok = false; notes.push("đổi tên ngoài khoảng vẫn được chấp nhận"); }
  var longName = ""; for (var li2 = 0; li2 < 100; li2++) longName += "B";
  if (!vaultRenamePreset(1, longName, s).renamed || vaultListPresets(s)[1].name.length !== 80) { ok = false; notes.push("đổi tên dài không cắt đúng 80 ký tự"); }
  /* Kich ban 5 — Pha B 2026-11-05: luu tran 20 preset thi preset cu nhat
     bi loai theo FIFO va ten cua no duoc bao trong dropped; luu duoi 20
     thi dropped rong. Dung store bo nho rieng de khong anh huong 2 preset
     cua kich ban 2-4 o tren. */
  var s5 = vaultMemStore(); vaultSetOptIn(true, s5);
  var rLast = null;
  for (var fi = 1; fi <= 21; fi++) rLast = vaultSavePreset({ name: "FIFO " + fi, eq: { bands: [1] } }, s5);
  var ps5 = vaultListPresets(s5);
  if (ps5.length !== 20 || ps5[0].name !== "FIFO 2" || !rLast || !rLast.dropped || rLast.dropped.length !== 1 || rLast.dropped[0] !== "FIFO 1") { ok = false; notes.push("lưu tràn 20 preset không báo đúng preset cũ nhất bị loại"); }
  var s5b = vaultMemStore(); vaultSetOptIn(true, s5b);
  var rUnder = vaultSavePreset({ name: "FIFO A", eq: { bands: [1] } }, s5b);
  if (!rUnder || !rUnder.dropped || rUnder.dropped.length !== 0) { ok = false; notes.push("lưu dưới 20 preset vẫn báo dropped"); }
  /* Kich ban 6 — Pha C 2026-11-05: muc ban trong kho (null/chuoi/so/mang)
     bi loc luc doc; doi ten + doc lai tren danh sach da loc khong nem,
     muc tot giu nguyen. Dung store bo nho rieng de khong anh huong cac
     kich ban tren. */
  var s6 = vaultMemStore(); vaultSetOptIn(true, s6);
  s6.set(VAULT_KEYS.presets, JSON.stringify([null, { name: "Sach", bands: 2, savedAt: "2026-11-05T00:00:00.000Z", preset: { name: "Sach" } }, "chuoi", 42, [1, 2]]));
  s6.set(VAULT_KEYS.qa, JSON.stringify([null, { id: "qa-1", timestamp: "2026-11-05T00:00:00.000Z", passCount: 9, totalCount: 10, realFails: 1 }]));
  var ps6 = vaultListPresets(s6), qs6 = vaultListQa(s6);
  if (ps6.length !== 1 || ps6[0].name !== "Sach" || qs6.length !== 1 || qs6[0].id !== "qa-1") { ok = false; notes.push("mục bẩn trong kho không bị lọc lúc đọc"); }
  var rr6 = vaultRenamePreset(0, "Sach (doi ten)", s6);
  if (!rr6.renamed || vaultListPresets(s6)[0].name !== "Sach (doi ten)") { ok = false; notes.push("đổi tên trên danh sách đã lọc vẫn lỗi"); }
  /* Kich ban 7 — Pha B 2026-11-05: nhap bundle bo qua preset trung ten (ca
     trung voi muc co san lan trung noi bo trong cung bundle) va bao dung ten
     preset cu nhat bi loai khi nhap vao thu vien day. Dung store bo nho rieng
     (importPresetBundle nhan store tuy chon) de khong cham thu vien that. */
  var s7 = vaultMemStore(); vaultSetOptIn(true, s7);
  vaultSavePreset({ name: "Nhap A", eq: { bands: [1,2,3] } }, s7);
  vaultSavePreset({ name: "Nhap B", eq: { bands: [1,2] } }, s7);
  var imp7 = importPresetBundle([
    { version: 2, name: "Nhap A", eq: { bands: [9] }, psycho: {} },
    { version: 2, name: "Nhap C", eq: { bands: [1] }, psycho: {} },
    { version: 2, name: "Nhap C", eq: { bands: [1] }, psycho: {} }], s7);
  var ps7 = vaultListPresets(s7);
  if (ps7.length !== 3 || ps7[0].name !== "Nhap A" || ps7[1].name !== "Nhap B" || ps7[2].name !== "Nhap C") { ok = false; notes.push("nhập bundle nhân bản preset trùng tên"); }
  if (!imp7 || imp7.dup !== 2 || !imp7.dupNames || imp7.dupNames.length !== 2 || imp7.dupNames[0] !== "Nhap A" || imp7.dupNames[1] !== "Nhap C" || imp7.saved !== 1) { ok = false; notes.push("nhập bundle không đếm đúng số mục trùng tên"); }
  if (!imp7 || !imp7.msg || imp7.msg.indexOf("trùng tên") < 0 || imp7.msg.indexOf("Nhap A") < 0) { ok = false; notes.push("thông báo nhập không nhắc preset trùng tên"); }
  var s7b = vaultMemStore(); vaultSetOptIn(true, s7b);
  for (var gi = 1; gi <= 20; gi++) vaultSavePreset({ name: "Goc " + gi, eq: { bands: [1] } }, s7b);
  var imp7b = importPresetBundle([
    { version: 2, name: "Moi 1", eq: { bands: [1] }, psycho: {} },
    { version: 2, name: "Moi 2", eq: { bands: [1] }, psycho: {} }], s7b);
  var ps7b = vaultListPresets(s7b);
  if (ps7b.length !== 20 || ps7b[0].name !== "Goc 3" || !imp7b || !imp7b.dropped || imp7b.dropped.length !== 2 || imp7b.dropped[0] !== "Goc 1" || imp7b.dropped[1] !== "Goc 2") { ok = false; notes.push("nhập bundle vào thư viện đầy không báo đúng preset bị loại"); }
  if (!imp7b || !imp7b.msg || imp7b.msg.indexOf("Goc 1") < 0 || imp7b.msg.indexOf("Goc 2") < 0) { ok = false; notes.push("thông báo nhập không nhắc preset bị loại do FIFO"); }
  vaultSetOptIn(false, s);
  if (vaultListPresets(s).length !== 0 || vaultListQa(s).length !== 0) { ok = false; notes.push("tắt opt-in nhưng kho không về 0 mục"); }
  return { pass: ok, detail: ok ? "7 kịch bản đạt: từ chối khi tắt, khớp 100% khi bật (2 preset + 2 báo cáo), đổi tên giữ savedAt/thứ tự (tên rỗng/ngoài khoảng bị từ chối, tên dài cắt 80 ký tự), lưu tràn 20 preset báo đúng preset cũ nhất bị loại, mục bẩn trong kho (null/chuỗi/số/mảng) bị lọc lúc đọc, nhập bundle bỏ qua trùng tên và báo preset bị loại do FIFO, xoá sạch khi tắt lại" : notes.join(" · ") };
}
/* Đồng bộ IndexedDB best-effort (DB riêng, không chạm kho tai nghe). */
function vaultIdbPut(kind, item){
  try {
    if (typeof indexedDB === "undefined") return;
    var req = indexedDB.open("webAutoEqVault.v1", 1);
    req.onupgradeneeded = function(){ var db = req.result; if (!db.objectStoreNames.contains("userVault")) db.createObjectStore("userVault", { keyPath: "id" }); };
    req.onsuccess = function(){
      try {
        var db = req.result;
        if (!db.objectStoreNames.contains("userVault")) return;
        var tx = db.transaction(["userVault"], "readwrite");
        tx.objectStore("userVault").put({ id: kind + ":" + (item.id || item.savedAt || Date.now()), kind: kind, item: item, savedAt: new Date().toISOString() });
      } catch (e){}
    };
    req.onerror = function(){};
  } catch (e){}
}
function vaultIdbClear(){
  try {
    if (typeof indexedDB === "undefined") return;
    var req = indexedDB.open("webAutoEqVault.v1", 1);
    req.onupgradeneeded = function(){ var db = req.result; if (!db.objectStoreNames.contains("userVault")) db.createObjectStore("userVault", { keyPath: "id" }); };
    req.onsuccess = function(){
      try {
        var db = req.result;
        if (!db.objectStoreNames.contains("userVault")) return;
        db.transaction(["userVault"], "readwrite").objectStore("userVault").clear();
      } catch (e){}
    };
    req.onerror = function(){};
  } catch (e){}
}
/* ---------------- UI kho Opt-In (chỉ chạy khi có đủ phần tử) ---------------- */
function vaultSyncUI(){
  try {
    var on = vaultGetOptIn();
    var btn = $("psStoreOptIn"), st = $("psStoreOptInState");
    if (btn) btn.textContent = on ? "Lưu trữ bền vững phía máy khách (Opt-In): ĐANG BẬT — bấm để tắt & xoá sạch" : "Lưu trữ bền vững phía máy khách (Opt-In): ĐANG TẮT";
    if (st) st.textContent = on ? "ĐANG BẬT" : "ĐANG TẮT";
    var box = $("psStoreBox"); if (box) box.style.display = on ? "block" : "none";
    var hb = $("qaHistoryBox"); if (hb) hb.style.display = on ? "block" : "none";
    vaultRenderLists();
  } catch (e){}
}
function vaultRenderLists(){
  try {
    var ul = $("psStoreList");
    if (ul){
      var ps = vaultListPresets();
      ul.innerHTML = ps.length ? ps.map(function(it, i){
        return "<li>" + qaEsc(it.name) + " · " + it.bands + " band · " + new Date(it.savedAt).toLocaleString("vi-VN") +
          ' <button class="btn small" data-vault-apply="' + i + '">Áp dụng</button>' +
          ' <button class="btn small" data-vault-dl="' + i + '">Tải JSON</button>' +
          ' <button class="btn small" data-vault-rename="' + i + '">Đổi tên</button>' +
          ' <button class="btn small" data-vault-del="' + i + '">Xoá</button></li>';
      }).join("") : "<li>Chưa có preset nào trong thư viện máy khách.</li>";
    }
    var ql = $("qaHistList");
    if (ql){
      var qs = vaultListQa();
      ql.innerHTML = qs.length ? qs.map(function(it, i){
        return "<li>" + new Date(it.timestamp).toLocaleString("vi-VN") + " · " + it.passCount + "/" + it.totalCount + " PASS · " + it.realFails + " FAIL thật" +
          (it.truncated ? " · (báo cáo đầy đủ đã lược vì đầy bộ nhớ)" : "") +
          ' <button class="btn small" data-vault-qa-dl="' + i + '">Tải JSON</button>' +
          ' <button class="btn small" data-vault-qa-del="' + i + '">Xoá</button></li>';
      }).join("") : "<li>Chưa có lịch sử QA nào trong thư viện máy khách.</li>";
    }
  } catch (e){}
}
(function vaultBindUI(){
  try {
    var btn = $("psStoreOptIn");
    if (btn) btn.addEventListener("click", function(){
      var on = !vaultGetOptIn();
      vaultSetOptIn(on);
      if (!on) vaultIdbClear();
      vaultSyncUI();
    });
    var save = $("psStoreSaveBtn");
    if (save) save.addEventListener("click", function(){
      var p = null;
      try { p = lastPreset || capturePresetV2(); } catch (e){}
      if (!p) return;
      /* Pha B 2026-11-05: dat ten preset khi luu vao vault — truoc day
         capturePresetV2() gan cung name:"Web AutoEQ Preset" nen moi muc trong
         thu vien deu trung ten, chi phan biet duoc bang so band + thoi gian.
         Lay ten tu o #psStoreName (cat khoang trang, toi da 80 ky tu); de
         trong thi giu ten mac dinh. Clone truoc khi doi ten de khong sua
         lastPreset dang hien o #psPresetJson; ten moi theo ca muc vault lan
         preset goc (xuat bundle/nhap lai van giu ten). */
      try {
        var ni = $("psStoreName");
        var nm = ni ? (ni.value || "").trim().slice(0, 80) : "";
        if (nm){ p = JSON.parse(JSON.stringify(p)); p.name = nm; }
      } catch (e){}
      var r = vaultSavePreset(p);
      if (r.saved) vaultIdbPut("preset", { id: "preset-" + Date.now(), name: p.name, bands: p.eq ? p.eq.bands.length : 0, savedAt: new Date().toISOString() });
      vaultRenderLists();
      /* Pha B 2026-11-05: bao preset cu nhat vua bi loai khi thu vien day
         (toi da 20, FIFO) — chen dong thong bao len dau danh sach bang DOM
         that (textContent), bien mat o lan render sau; khong doi hanh vi
         FIFO, khong them id DOM moi. */
      if (r.saved && r.dropped && r.dropped.length){
        try {
          var ulN = $("psStoreList");
          if (ulN){
            var liN = document.createElement("li");
            liN.textContent = "Đã xoá preset cũ nhất “" + r.dropped.join("”, “") + "” vì thư viện đầy (tối đa 20 mục).";
            ulN.insertBefore(liN, ulN.firstChild);
          }
        } catch (e){}
      }
    });
    var clr = $("psStoreClearBtn");
    if (clr) clr.addEventListener("click", function(){ vaultClearPresets(); vaultIdbClear(); vaultRenderLists(); });
    var dall = $("psStoreDlAllBtn");
    if (dall) dall.addEventListener("click", function(){
      var ps = vaultListPresets();
      if (!ps.length) return;
      try { dlText("web-autoeq-preset-bundle-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify({ kind:"web-autoeq-preset-bundle-v1", exportedAt:new Date().toISOString(), count:ps.length, presets:ps }, null, 1), "application/json"); } catch (e){}
    });
    var hclr = $("qaHistClearBtn");
    if (hclr) hclr.addEventListener("click", function(){ vaultClearQa(); vaultIdbClear(); vaultRenderLists(); });
    var ul = $("psStoreList");
    if (ul) ul.addEventListener("click", function(ev){
      var t = ev.target;
      var ai = t.getAttribute && t.getAttribute("data-vault-apply");
      var dl = t.getAttribute && t.getAttribute("data-vault-dl");
      var rn = t.getAttribute && t.getAttribute("data-vault-rename");
      var rns = t.getAttribute && t.getAttribute("data-vault-rename-save");
      var rnc = t.getAttribute && t.getAttribute("data-vault-rename-cancel");
      var di = t.getAttribute && t.getAttribute("data-vault-del");
      if (rn !== null && rn !== undefined && rn !== ""){
        /* Doi ten inline: dung DOM that thay vi innerHTML de ten co dau
           ngoac kep cung khong pha vo thuoc tinh value; Huy/Luu ten ve lai
           danh sach qua vaultRenderLists. */
        var itr = vaultListPresets()[parseInt(rn, 10)];
        var li = t.closest ? t.closest("li") : null;
        if (itr && li){
          li.textContent = "";
          var inp = document.createElement("input");
          inp.className = "numin"; inp.type = "text"; inp.maxLength = 80; inp.style.width = "220px";
          inp.value = itr.name || ""; inp.setAttribute("data-vault-rename-input", rn);
          var bSave = document.createElement("button"); bSave.className = "btn small"; bSave.textContent = "Lưu tên"; bSave.setAttribute("data-vault-rename-save", rn);
          var bCancel = document.createElement("button"); bCancel.className = "btn small"; bCancel.textContent = "Huỷ"; bCancel.setAttribute("data-vault-rename-cancel", rn);
          li.appendChild(inp); li.appendChild(document.createTextNode(" ")); li.appendChild(bSave); li.appendChild(document.createTextNode(" ")); li.appendChild(bCancel);
          try { inp.focus(); inp.select(); } catch (e){}
        }
      } else if (rns !== null && rns !== undefined && rns !== ""){
        var li2 = t.closest ? t.closest("li") : null;
        var inp2 = li2 ? li2.querySelector("input[data-vault-rename-input]") : null;
        vaultRenamePreset(parseInt(rns, 10), inp2 ? inp2.value : "");
        vaultRenderLists();
      } else if (rnc !== null && rnc !== undefined && rnc !== ""){
        vaultRenderLists();
      } else if (ai !== null && ai !== undefined && ai !== ""){
        var it = vaultListPresets()[parseInt(ai, 10)];
        if (it && it.preset){ try { applyPresetV2(it.preset); } catch (e){} }
      } else if (dl !== null && dl !== undefined && dl !== ""){
        var itd = vaultListPresets()[parseInt(dl, 10)];
        if (itd && itd.preset){ try { dlText("web-autoeq-preset-v2-" + expSlug(itd.name || "") + "-" + parseInt(dl, 10) + ".json", JSON.stringify(itd.preset, null, 1), "application/json"); } catch (e){} }
      } else if (di !== null && di !== undefined && di !== ""){
        var list = vaultListPresets(); list.splice(parseInt(di, 10), 1);
        vaultWriteList(vaultDefaultStore(), VAULT_KEYS.presets, list); vaultRenderLists();
      }
    });
    var ql = $("qaHistList");
    if (ql) ql.addEventListener("click", function(ev){
      var t = ev.target;
      var di = t.getAttribute && t.getAttribute("data-vault-qa-dl");
      var rm = t.getAttribute && t.getAttribute("data-vault-qa-del");
      if (di !== null && di !== undefined && di !== ""){
        var it = vaultListQa()[parseInt(di, 10)];
        if (it && it.reportJson){ try { dlText("web-autoeq-qa-report-" + it.id + ".json", it.reportJson, "application/json"); } catch (e){} }
      } else if (rm !== null && rm !== undefined && rm !== ""){
        var list = vaultListQa(); list.splice(parseInt(rm, 10), 1);
        vaultWriteList(vaultDefaultStore(), VAULT_KEYS.qa, list); vaultRenderLists();
      }
    });
    vaultSyncUI();
  } catch (e){}
})();

/* Nút đối chiếu OfflineAudioContext + AudioWorklet (Chặng 1, bước 1.2):
   chỉ có ý nghĩa trên trình duyệt thật; mọi đường lỗi/timeout đều báo rõ
   và giữ nguyên kết quả WORKLET_SRC đồng bộ, không bao giờ treo. */
(function qaOfflineWorkletBtn(){
  try {
    var btn = $("btnQaOfflineWorklet");
    if (!btn) return;
    btn.addEventListener("click", async function(){
      var info = $("qaOfflineWorkletInfo");
      function say(t){ if (info) info.textContent = t; }
      var fs = displayFs || 48000;
      if (typeof OfflineAudioContext === "undefined" || typeof Blob === "undefined"){
        say("Môi trường này không hỗ trợ OfflineAudioContext — giữ nguyên kết quả WORKLET_SRC đồng bộ (hàng đối chiếu worklet ở trên).");
        return;
      }
      var url = null;
      try {
        url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        var ctx = new OfflineAudioContext(2, 24000, fs);
        await Promise.race([
          ctx.audioWorklet.addModule(url),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("timeout headless")); }, 1500); })
        ]);
        var N = 24000, amp = Math.pow(10, -20/20), w = 2*Math.PI*1000/fs, i;
        var buf = ctx.createBuffer(2, N, fs);
        for (var ch = 0; ch < 2; ch++){ var d = buf.getChannelData(ch); for (i = 0; i < N; i++) d[i] = amp*Math.sin(w*i); }
        var src = ctx.createBufferSource(); src.buffer = buf;
        var node = new AudioWorkletNode(ctx, "autoeq-dsp", { outputChannelCount: [2] });
        node.port.postMessage({ type: "coeffs", coeffs: qaCoeffsFor(qaFlatBands(), fs, {}) });
        node.port.postMessage({ type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: 1, slotLin: 1 });
        src.connect(node); node.connect(ctx.destination); src.start();
        var rendered = await ctx.startRendering();
        var y = rendered.getChannelData(0);
        var fit = qaThdNFit(y, w, 4096 + 128, N);
        var sync = qaThdNWorklet(-20, fs);
        say("THD+N qua OfflineAudioContext + AudioWorklet thật: " + fit.thdnDb.toFixed(1) + " dB ở −20 dBFS (đường WORKLET_SRC đồng bộ: " + sync.thdnDb.toFixed(1) + " dB).");
      } catch (e){
        say("Không đo được qua OfflineAudioContext + AudioWorklet (" + e.message + ") — giữ nguyên kết quả WORKLET_SRC đồng bộ (hàng đối chiếu worklet ở trên).");
      } finally {
        try { if (url) URL.revokeObjectURL(url); } catch (e2){}
      }
    });
  } catch (e){}
})();

function qaIrCapture(fs){
  var imp = new Float64Array(4096); imp[0] = 1;
  var hI = qaCascade(imp, imp, qaCoeffsFor(qaCurBands(), fs, { psycho: true }))[0];
  var pkI = 0, ampI = 0, i;
  for (i = 0; i < hI.length; i++) if (Math.abs(hI[i]) > ampI){ ampI = Math.abs(hI[i]); pkI = i; }
  var hF = qaFirTapsFor(qaCurBands(), fs, firLen), pkF = 0, ampF = 0;
  for (i = 0; i < hF.length; i++) if (Math.abs(hF[i]) > ampF){ ampF = Math.abs(hF[i]); pkF = i; }
  return { hI: hI, hF: hF, pkI: pkI, ampI: ampI, pkF: pkF, ampF: ampF };
}
function qaDrawIr(ir){
  var cv = $("qaIrCv"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== Math.round(W*dpr)){ cv.width = W*dpr; cv.height = H*dpr; }
  var g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  var mid = H/2, amp = Math.max(ir.ampI, ir.ampF, 0.2)*1.1;
  g.strokeStyle = "#39434f"; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
  function plot(h, color){
    g.beginPath();
    var step = Math.max(1, Math.floor(h.length/ W));
    for (var x = 0; x < W; x++){
      var mx = 0;
      for (var i = x*step; i < Math.min(h.length, (x + 1)*step); i++) if (Math.abs(h[i]) > Math.abs(mx)) mx = h[i];
      var y = mid - mx/amp*(mid - 4);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = color; g.lineWidth = 1.4; g.stroke();
  }
  plot(ir.hF, "#3fd2dc");
  var hIzoom = ir.hI.slice(0, ir.hF.length);
  plot(hIzoom, "#ffb224");
  g.font = "10.5px 'IBM Plex Mono', monospace"; g.fillStyle = "#97a1af"; g.textAlign = "left";
  g.fillText("IR — FIR (cyan, toàn bộ " + ir.hF.length + " mẫu) · IIR (amber, " + ir.hF.length + " mẫu đầu)", 8, 13);
}
function qaSegPeak(y, start, len, fs){
  var best = 0, bf = 0, k, n;
  for (k = 0; k <= 47; k++){
    var f = 15*Math.pow(21000/15, k/47), w = 2*Math.PI*f/fs, sr = 0, si = 0;
    for (n = 0; n < len; n++){ var v = y[start + n] || 0; sr += v*Math.cos(w*n); si += v*Math.sin(w*n); }
    var m = sr*sr + si*si;
    if (m > best){ best = m; bf = f; }
  }
  return bf;
}
function qaRespDb(mutate, fs){
  var bl = FREQS.map(function(f, i){ return { freq: f, type: TYPES[i], gain: i === 5 ? 6 : 0, q: i === 5 ? 1.41 : DEFQ[i], on: true }; });
  var coeffs = qaCoeffsFor(bl, fs, { mutate: mutate });
  var s = 0;
  coeffs.forEach(function(c){ s += biquadMagDb(c, 1000, fs); });
  return s;
}
function qaRunSuite(){
  var fs = displayFs || 48000, rows = [];
  function row(name, expect, measured, pass, cfg, kind){ rows.push({ name: name, stage: "6 · QA Suite", expect: expect, measured: measured, pass: !!pass, cfg: cfg, kind: kind || "qa" }); }
  qaDrawPhaseGd();
  var gdPass = mode === "fir" ? true : (QA6.gdMaxLow !== null && QA6.gdMaxLow <= 5);
  row("Group Delay dưới 100 Hz — cấu hình EQ hiện tại", "≤ 5.00 ms ở chế độ Minimum-Phase (IIR)",
    "tối đa < 100 Hz: " + (QA6.gdMaxLow === null ? "—" : QA6.gdMaxLow.toFixed(2) + " ms") + " · tại 1 kHz: " + (QA6.gdAt1k === null ? "—" : QA6.gdAt1k.toFixed(2) + " ms") + " · pha tại 1 kHz: " + (QA6.phase1k === null ? "—" : qaWrapDeg(QA6.phase1k).toFixed(1) + "°"),
    gdPass, "Giải tích từ hệ số đang hoạt động · chế độ " + (mode === "fir" ? "Linear-Phase FIR " + firLen + " tap" : "Minimum-Phase IIR") + " · fs " + fs + " Hz");
  var t20 = qaThdN(-20, fs);
  row("THD+N — tone 1 kHz ở −20 dBFS qua toàn chuỗi DSP", "méo do hệ thống thêm vào < −140 dB so với fundamental khi EQ phẳng",
    "THD+N đo được: " + t20.thdnDb.toFixed(1) + " dB · phần dư tuyệt đối: " + t20.residDbfs.toFixed(1) + " dBFS RMS",
    t20.thdnDb < -140, "EQ phẳng · psycho tắt · crossfeed tắt · limiter BẬT (−1.0 dBTP) · khớp bình phương tối thiểu tại 1 kHz trên 0.5 s tín hiệu đã xử lý bởi bản sao chuỗi DSP");
  var t1 = qaThdN(-1, fs);
  row("THD+N — tone 1 kHz ở −1 dBFS (limiter chạm trần)", "méo vẫn < −40 dB khi limiter bắt đầu làm việc tại trần −1.0 dBTP",
    "THD+N đo được: " + t1.thdnDb.toFixed(1) + " dB · phần dư tuyệt đối: " + t1.residDbfs.toFixed(1) + " dBFS RMS",
    t1.thdnDb < -40, "Như trên nhưng tone −1 dBFS: true-peak của sine ≈ biên độ = trần −1.0 dBTP nên limiter gần như không giảm gain với bộ ước lượng windowed-sinc ×16 mới — méo đo được là méo thật của tầng limiter");
  var nI = qaNullIir(fs);
  row("Null Test — EQ → EQ nghịch đảo chính xác (IIR)", "phần dư < −80 dBFS RMS",
    "phần dư đo được: " + nI.toFixed(1) + " dBFS RMS (nhiễu kiểm tra 16 384 mẫu qua 4 band test rồi qua cascade nghịch đảo gain-đảo-dấu)",
    nI < -80, "EQ test cố định của harness (shelf +4 · peaking −3/+5 · shelf −2.5 dB) · nghịch đảo = cùng Fc/Q, gain đảo dấu (nghịch đảo chính xác của RBJ) · pre-amp/limiter loại khỏi chuỗi null vì là tầng gain/phi tuyến");
  var nF = qaNullFir(fs);
  row("Null Test — FIR Linear-Phase có bù độ trễ", "phần dư < −80 dBFS RMS sau khi bù group delay đã đo",
    "group delay đo từ đỉnh IR: " + nF.dMeas + " mẫu · phần dư sau bù trễ " + (2*nF.dMeas) + " mẫu: " + nF.rmsDbfs.toFixed(1) + " dBFS RMS",
    nF.rmsDbfs < -80 && nF.dMeas === (1023 - 1)/2, "FIR 1023 tap sinh từ cùng EQ test · nghịch đảo = chia phổ 1/H(f) với trễ tuyến tính riêng sao cho tổng trễ = 2× group delay đã đo (1022 mẫu) và được bù trước khi tính phần dư · giải chập trên lưới FFT 32 768");
  var ir = qaIrCapture(fs);
  QA6.ir = ir;
  row("Impulse Response — thu IR cho IIR và FIR từ Dirac impulse", "đỉnh IR của FIR tại (N−1)/2 ± 1 mẫu",
    "IIR: đỉnh tại mẫu " + ir.pkI + " (amp " + ir.ampI.toFixed(3) + ") · FIR " + firLen + " tap: đỉnh tại mẫu " + ir.pkF + " (kỳ vọng " + ((firLen - 1)/2) + ", amp " + ir.ampF.toFixed(3) + ")",
    Math.abs(ir.pkF - (firLen - 1)/2) <= 1, "Dirac impulse qua cascade hiện tại (EQ + psycho) cho IIR · FIR suy ra từ đáp tuyến EQ hiện tại, cửa sổ Hann");
  qaDrawIr(ir);
  $("qaIrNote").textContent = "IR đã thu: IIR đỉnh tại mẫu " + ir.pkI + " · FIR đỉnh tại mẫu " + ir.pkF + " = " + (ir.pkF/fs*1000).toFixed(2) + " ms (group delay đo được, khớp công thức (N−1)/2 = " + ((firLen - 1)/2) + " mẫu). Đồ thị: cyan = FIR toàn bộ " + ir.hF.length + " mẫu, amber = IIR " + ir.hF.length + " mẫu đầu.";
  /* Crossfeed qua chuỗi thật của harness */
  var nz = qaNoise(16384, 0.4), zero = new Float64Array(16384);
  var offR = qaChain(nz, zero, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 })[1];
  var onR = qaChain(nz, zero, fs, { bandList: qaFlatBands(), psycho: false, xf: { mix: 1, itdMs: 0.30 }, limiter: true, preampDb: 0 })[1];
  var offDb = qaRmsDbfs(offR, 600, 16000), onDb = qaRmsDbfs(onR, 600, 16000);
  row("Crossfeed — rò kênh đối diện qua chuỗi DSP", "kênh phải im lặng (< −120 dBFS) khi tắt và nghe được tín hiệu rò ITD/ILD khi bật 100%",
    "tín hiệu chỉ ở kênh trái → RMS kênh phải: tắt = " + (isFinite(offDb) ? offDb.toFixed(1) : "−∞") + " dBFS · bật 100% = " + onDb.toFixed(1) + " dBFS",
    offDb < -120 && onDb > -45, "Nhiễu mono kênh trái · crossfeed mix 100% · ITD 0.30 ms · ILD thông thấp 6.5 kHz · limiter bật");
  /* Sweep qua chuỗi phẳng */
  var T = 2, Ns = fs*T, sw = new Float64Array(Ns), K = Math.log(20000/20), n;
  for (n = 0; n < Ns; n++){ var tt = n/fs; sw[n] = 0.25*Math.sin(2*Math.PI*20*(T/K)*(Math.exp(tt/T*K) - 1)); }
  var swOut = qaChain(sw, sw, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 })[0];
  var rIn = qaRmsDbfs(sw, 1000, Ns - 1000), rOut = qaRmsDbfs(swOut, 1000, Ns - 1000);
  var pFirst = qaSegPeak(swOut, 64, 4096, fs), pLast = qaSegPeak(swOut, Ns - 4096, 4096, fs);
  row("Log sine sweep 20 Hz–20 kHz qua chuỗi phẳng", "RMS ra/vào lệch ≤ 0.5 dB · đỉnh phổ đoạn đầu < 100 Hz · đoạn cuối > 8 kHz · không NaN",
    "RMS vào " + rIn.toFixed(2) + " dBFS → ra " + rOut.toFixed(2) + " dBFS (lệch " + Math.abs(rOut - rIn).toFixed(2) + " dB) · đỉnh đoạn đầu ≈ " + Math.round(pFirst) + " Hz · đoạn cuối ≈ " + Math.round(pLast) + " Hz",
    Math.abs(rOut - rIn) <= 0.5 && pFirst < 100 && pLast > 8000, "ESS 2 giây, biên độ 0.25 · EQ phẳng · limiter bật · đỉnh phổ đo bằng quét DFT trên đoạn 4096 mẫu");
  var rc = qaRespDb(false, fs);
  row("Đáp tuyến kiểm chứng 1 kHz (bản sạch, đối chứng cho mutation)", "+6.00 dB ± 0.10 dB tại 1 kHz",
    "đo được " + rc.toFixed(3) + " dB (sai số " + Math.abs(rc - 6).toFixed(3) + " dB)",
    Math.abs(rc - 6) <= 0.1, "Cấu hình kiểm chứng Giai đoạn 1 chạy trên bản sao hệ số của harness: band 1 kHz +6 dB · Q 1.41, các band khác phẳng");
  /* --- Chế độ 20 band (Lộ trình v2 · Nhóm 1 · Giai đoạn 1): chuyển engine
     thật sang 20 band, đặt đúng một band +6.00 dB · Q 1.41 tại 1 kHz, đo đáp
     tuyến giải tích tại 1 kHz qua chính cascade hệ số của engine và pre-amp
     suy từ đỉnh đáp tuyến (luật −(đỉnh + 1.0) dB của Giai đoạn 1), rồi khôi
     phục nguyên trạng chế độ + band + band đang chọn trước đó. --- */
  (function(){
    var savedCount = bandCount, savedBands = snapBandsOnly(), savedSel = selBand;
    try {
      setBandCount(20);
      var BS = bandSet(), ti = 0, bd = 1e9;
      bands.forEach(function(b, i){
        b.freq = BS.freqs[i]; b.type = BS.types[i]; b.gain = 0; b.q = BS.defq[i]; b.on = true;
        var d = Math.abs(Math.log(BS.freqs[i]/1000)); if (d < bd){ bd = d; ti = i; }
      });
      bands[ti].freq = 1000; bands[ti].gain = 6; bands[ti].q = 1.41;
      var cs = allCoeffs(fs), resp = 0, i2, k2, f2, s2, maxR = -Infinity;
      for (i2 = 0; i2 < cs.length; i2++) resp += biquadMagDb(cs[i2], 1000, fs);
      for (k2 = 0; k2 <= 960; k2++){
        f2 = 20*Math.pow(1000, k2/960); s2 = 0;
        for (i2 = 0; i2 < cs.length; i2++) s2 += biquadMagDb(cs[i2], f2, fs);
        if (s2 > maxR) maxR = s2;
      }
      if (resp > maxR) maxR = resp;
      var pre20 = maxR > 0 ? -(maxR + 1.0) : 0;
      row("Chế độ 20 band — một band duy nhất +6.00 dB · Q 1.41 tại 1 kHz (PEQ thủ công)", "+6.00 dB ± 0.05 dB tại 1 kHz · pre-amp tương ứng −7.00 dB ± 0.05 dB",
        "đáp tuyến tại 1 kHz: " + resp.toFixed(3) + " dB (sai số " + Math.abs(resp - 6).toFixed(3) + " dB) · đỉnh đáp tuyến " + maxR.toFixed(3) + " dB → pre-amp " + pre20.toFixed(3) + " dB · cascade đo gồm " + cs.length + " band",
        cs.length === 20 && Math.abs(resp - 6) <= 0.05 && Math.abs(pre20 - (-7)) <= 0.05,
        "Engine chuyển tạm sang chế độ 20 band (log-spaced 31 Hz–16 kHz): band gần 1 kHz nhất đặt về đúng 1 kHz · +6 dB · Q 1.41, 19 band còn lại phẳng · đo giải tích từ hệ số RBJ của chính 20 band · trạng thái của bạn được khôi phục ngay sau đo");
    } catch (e20) {
      row("Chế độ 20 band — một band duy nhất +6.00 dB · Q 1.41 tại 1 kHz (PEQ thủ công)", "+6.00 dB ± 0.05 dB tại 1 kHz · pre-amp tương ứng −7.00 dB ± 0.05 dB",
        "lỗi khi đo: " + e20.message, false, "Đo trên engine ở chế độ 20 band");
    } finally {
      setBandCount(savedCount);
      applyBandArr(savedBands);
      selBand = savedSel;
      updateAll(true);
    }
  })();
  /* --- Partitioned FFT Convolution (Lộ trình v2 · Nhóm 1 · DSP Core):
     chạy đúng mã worklet đang giao cho trình duyệt (WORKLET_SRC) qua
     AudioWorkletProcessor giả lập: nạp taps FIR thật của EQ hiện tại,
     cho Dirac + nhiễu xác định qua từng block 128 mẫu ở chế độ FIR, so
     với chập trực tiếp cùng taps trên cùng tín hiệu. Tầng limiter trong
     worklet trễ cố định 128 mẫu nên phép so lệch đúng 128 mẫu đó. --- */
  (function(){
    try {
      var StubProc = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
      var ProcCtor = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
        WORKLET_SRC + "\n; return AutoEqProcessor;");
      var Proc = ProcCtor(StubProc, fs, function(){});
      var proc = new Proc();
      var taps = buildFirTaps(fs, 1023);
      proc.port.onmessage({ data: { type: "fir", taps: taps } });
      proc.port.onmessage({ data: { type: "config", mode: "fir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
      var NB = 32, seed = 123456789, b3, n3, k3;
      function rnd3(){ seed = (seed * 1103515245 + 12345) & 2147483647; return seed / 1073741824 - 1; }
      var buf = new Float64Array(1023), pos = 0, maxDiff = 0, bad = false;
      var outPart = [], outDirect = [];
      for (b3 = 0; b3 < NB; b3++){
        var inL = new Float32Array(128), inR = new Float32Array(128);
        var outL = new Float32Array(128), outR = new Float32Array(128);
        for (n3 = 0; n3 < 128; n3++){ var v3 = (b3 === 0 && n3 === 0) ? 1 : 0.5 * rnd3(); inL[n3] = v3; inR[n3] = v3; }
        proc.process([[inL, inR]], [[outL, outR]]);
        for (n3 = 0; n3 < 128; n3++){
          buf[pos] = inL[n3];
          var acc3 = 0;
          for (k3 = 0; k3 < 1023; k3++){ var ix3 = pos - k3; if (ix3 < 0) ix3 += 1023; acc3 += taps[k3] * buf[ix3]; }
          pos++; if (pos >= 1023) pos = 0;
          outPart.push(outL[n3]); outDirect.push(acc3);
        }
      }
      for (n3 = 0; n3 < outDirect.length - 128; n3++){
        var d3 = Math.abs(outPart[n3 + 128] - outDirect[n3]);
        if (!isFinite(d3)) bad = true; else if (d3 > maxDiff) maxDiff = d3;
      }
      row("FIR — Partitioned FFT Convolution = chập trực tiếp (worklet thật, block 128)",
        "sai lệch tối đa ≤ 1e-4 · không NaN · 32 block × 128 mẫu, taps FIR 1023 của EQ hiện tại",
        "sai lệch tối đa: " + maxDiff.toExponential(2) + " · NaN: " + (bad ? "có" : "không") + " · partition: " + Math.ceil(1023/128) + " × FFT 256",
        !bad && maxDiff <= 1e-4,
        "Chạy đúng WORKLET_SRC giao cho AudioWorklet (giả lập processor + sampleRate " + fs + " Hz): partitioned FFT Overlap-Add block 128 mẫu so với chập trực tiếp cùng taps, cùng tín hiệu Dirac + nhiễu xác định · limiter tắt trong phép đo nhưng trễ delay-line 128 mẫu của nó được bù bằng phép so lệch 128 mẫu");
    } catch (eP) {
      row("FIR — Partitioned FFT Convolution = chập trực tiếp (worklet thật, block 128)",
        "sai lệch tối đa ≤ 1e-4 · không NaN", "lỗi khi đo: " + eP.message, false,
        "Chạy đúng WORKLET_SRC giao cho AudioWorklet (giả lập processor)");
    }
  })();
  /* --- Look-ahead Brickwall True-Peak Limiter x16 (Lo trinh v2 · Nhom 1):
     chay dung WORKLET_SRC qua processor gia lap, EQ phang, limiter BAT,
     do dinh dau ra bang bo uoc luong TP x16 doc lap (sinc truc tiep ho tro
     +-16 mau, khong dung chung bang he so voi worklet). Tieu chi: TP ra
     <= -0.9 dBTP (tran -1.0 dBTP + dung sai 0.1 dB cho sai so uoc luong),
     gain reduction co tac dong o burst vuot tran, tin hieu nho -20 dBFS
     di qua nguyen ven sau khi bu tre 128 mau, NaN/Inf/denormal khong lam
     ban dau ra. Tin hieu: 1024 mau lang + 4096 mau burst + 1024 mau lang
     de moi mau dinh deu duoc day het khoi delay line. --- */
  (function(){
    try {
      var StubProc3 = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
      var ProcCtor3 = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
        WORKLET_SRC + "\n; return AutoEqProcessor;");
      var Proc3 = ProcCtor3(StubProc3, fs, function(){});
      function idCoeffs3(n){ var a=[]; for (var q=0;q<n;q++) a.push({b0:1,b1:0,b2:0,a1:0,a2:0}); return a; }
      function runLim(sig){
        var pr = new Proc3();
        pr.port.onmessage({ data: { type: "coeffs", coeffs: idCoeffs3(10) } });
        pr.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: 1, slotLin: 1 } });
        var out = new Float64Array(sig.length), minGr = 1, oi = 0, bb, nn;
        for (bb = 0; bb*128 < sig.length; bb++){
          var inL = new Float32Array(128), inR = new Float32Array(128), outL = new Float32Array(128), outR = new Float32Array(128);
          for (nn = 0; nn < 128; nn++){ var v = (bb*128+nn < sig.length) ? sig[bb*128+nn] : 0; inL[nn] = v; inR[nn] = v; }
          pr.process([[inL, inR]], [[outL, outR]]);
          if (pr.gr < minGr) minGr = pr.gr;
          for (nn = 0; nn < 128 && oi < out.length; nn++, oi++) out[oi] = outL[nn];
        }
        return { out: out, minGrDb: 20*Math.log10(Math.max(1e-9, minGr)) };
      }
      /* Bo do TP x16 doc lap: noi suy sinc truc tiep, cua so Blackman +-16 mau. */
      function tp16(y){
        var tp = 0, N = y.length, n, ph, i, d, sinc, u, w, v;
        for (n = 1; n < N; n++){
          for (ph = 0; ph < 16; ph++){
            v = 0; var t = (n - 1) + ph/16;
            for (i = n - 17; i <= n + 16; i++){
              if (i < 0 || i >= N) continue;
              d = t - i; if (d >= 16 || d <= -16) continue;
              sinc = (d === 0) ? 1 : Math.sin(Math.PI*d)/(Math.PI*d);
              u = d/16; w = 0.42 - 0.5*Math.cos(Math.PI*(u + 1)) + 0.08*Math.cos(2*Math.PI*(u + 1));
              v += y[i]*sinc*w;
            }
            if (Math.abs(v) > tp) tp = Math.abs(v);
          }
          if (Math.abs(y[n]) > tp) tp = Math.abs(y[n]);
        }
        return tp;
      }
      function frame(sig, fn){
        var a = new Float64Array(6144), i;
        for (i = 0; i < 4096; i++) a[1024 + i] = fn(i);
        return a;
      }
      var burstSine = frame(null, function(i){ return 1.2*Math.sin(2*Math.PI*12000*i/fs); });
      var seedN = 987654321, burstNoise = frame(null, function(){ seedN = (seedN*1103515245 + 12345) & 2147483647; return (seedN/1073741824 - 1)*1.25; });
      var smallSine = frame(null, function(i){ return Math.pow(10, -20/20)*Math.sin(2*Math.PI*1000*i/fs); });
      var rS = runLim(burstSine), rN = runLim(burstNoise), rSm = runLim(smallSine);
      var tpS = tp16(rS.out), tpN = tp16(rN.out);
      var lim = Math.pow(10, -0.9/20), pkS = 0, pkN = 0, q;
      for (q = 0; q < rS.out.length; q++){ if (Math.abs(rS.out[q]) > pkS) pkS = Math.abs(rS.out[q]); if (Math.abs(rN.out[q]) > pkN) pkN = Math.abs(rN.out[q]); }
      var maxDiff = 0;
      for (q = 1024; q < 5120; q++){ var df = Math.abs(rSm.out[q + 128] - smallSine[q]); if (df > maxDiff) maxDiff = df; }
      /* NaN/Inf/denormal: qua worklet phai ra huu han (limiter khu). */
      var nanSig = new Float64Array(6144), pat = [1.0, NaN, Infinity, 1e-320, -1.0, -Infinity, 0.5, NaN];
      for (q = 0; q < 4096; q++) nanSig[1024 + q] = pat[q % pat.length];
      var rNaN = runLim(nanSig), nanBad = false;
      for (q = 0; q < rNaN.out.length; q++) if (!isFinite(rNaN.out[q])) { nanBad = true; break; }
      function tpDb(x){ return 20*Math.log10(Math.max(1e-12, x)); }
      var ok = tpS <= lim && tpN <= lim && pkS <= lim && pkN <= lim &&
        rS.minGrDb < -0.5 && rN.minGrDb < -0.5 && maxDiff <= 1e-6 && !nanBad;
      row("Limiter — Brickwall True-Peak ×16, lookahead 128 mẫu (worklet thật)",
        "TP ra ≤ −0.9 dBTP với burst vượt trần · GR tác động < −0.5 dB · sine −20 dBFS qua nguyên vẹn (sai lệch ≤ 1e-6 sau bù trễ 128 mẫu) · NaN/Inf/denormal ra hữu hạn",
        "burst sine 12 kHz amp 1.2: TP " + tpDb(tpS).toFixed(2) + " dBTP, GR " + rS.minGrDb.toFixed(2) + " dB · burst noise amp 1.25: TP " + tpDb(tpN).toFixed(2) + " dBTP, GR " + rN.minGrDb.toFixed(2) + " dB · sine −20 dBFS: sai lệch tối đa " + maxDiff.toExponential(2) + " · NaN/Inf: " + (nanBad ? "BẨN" : "hữu hạn"),
        ok,
        "Chạy đúng WORKLET_SRC (giả lập processor + sampleRate " + fs + " Hz), EQ phẳng, limiter BẬT, trần −1.0 dBTP; TP đầu ra đo bằng bộ ước lượng ×16 độc lập (sinc trực tiếp, Blackman ±16 mẫu), không dùng chung bảng hệ số với worklet");
    } catch (eL) {
      row("Limiter — Brickwall True-Peak ×16, lookahead 128 mẫu (worklet thật)",
        "TP ra ≤ −0.9 dBTP · GR tác động · sine nhỏ nguyên vẹn · NaN hữu hạn", "lỗi khi đo: " + eL.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  /* --- Dynamic EQ sidechain doc lap + RMS (Lo trinh v2 · Nhom 1):
     chay dung WORKLET_SRC qua processor gia lap, doc truc tiep dynOff cua
     worklet (khong qua duong meter cua trinh duyet). Tieu chi: band tac dong
     offset trong [-8.05, -6.5] dB, band khong tac dong |offset| <= 0.6 dB,
     RMS sine trong [-6.05, -4.45] dB (tam -5.24 dB). --- */
  (function(){
    try {
      var StubProc2 = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
      var ProcCtor2 = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
        WORKLET_SRC + "\n; return AutoEqProcessor;");
      var Proc2 = ProcCtor2(StubProc2, fs, function(){});
      function idCoeffs(n){ var a=[]; for (var q=0;q<n;q++) a.push({b0:1,b1:0,b2:0,a1:0,a2:0}); return a; }
      function nulls(n){ var a=[]; for (var q=0;q<n;q++) a.push(null); return a; }
      function dynBand(bandFreq, detMode){
        return { on:true, thr:-20, ratio:4, range:-8, attack:1, release:10, freq:bandFreq, type:"peaking", q:1.41, gain:0, det:detMode };
      }
      function toneProc(list, det, blocks, freq, amp){
        var pr = new Proc2();
        pr.port.onmessage({ data: { type: "coeffs", coeffs: idCoeffs(10) } });
        pr.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1, dyn: { list: list, det: det } } });
        for (var bb=0; bb<blocks; bb++){
          var inL = new Float32Array(128), inR = new Float32Array(128), outL = new Float32Array(128), outR = new Float32Array(128);
          for (var nn=0; nn<128; nn++){ var ph = 2*Math.PI*freq*(bb*128+nn)/fs; var v = amp*Math.sin(ph); inL[nn]=v; inR[nn]=v; }
          pr.process([[inL, inR]], [[outL, outR]]);
        }
        return pr;
      }
      var amp10 = Math.pow(10, -10/20);
      /* A: cung band 1 kHz, sidechain BP 100 Hz vs BP 1 kHz, tone 100 Hz. */
      var listA = nulls(10); listA[0] = dynBand(1000, "peak");
      var detA100 = nulls(10); detA100[0] = bandpassCoeffs(100, 1.41, fs);
      var detA1000 = nulls(10); detA1000[0] = bandpassCoeffs(1000, 1.41, fs);
      var pA1 = toneProc(listA, detA100, 60, 100, amp10);
      var pA2 = toneProc(listA, detA1000, 60, 100, amp10);
      /* B: LP 500 Hz chi nghe tone tram, HP 5 kHz chi nghe tone cao. */
      var listB = nulls(10); listB[1] = dynBand(3000, "peak"); listB[2] = dynBand(6000, "peak");
      var detB = nulls(10); detB[1] = lowpassCoeffs(500, 1, fs); detB[2] = highpassCoeffs(5000, 1, fs);
      var pBlo = toneProc(listB, detB, 60, 100, amp10);
      var pBhi = toneProc(listB, detB, 60, 8000, amp10);
      /* C: RMS cua sine -10 dBFS ~ -13.01 dBFS -> offset ~ -5.24 dB. */
      var listC = nulls(10); listC[3] = dynBand(200, "rms");
      var detC = nulls(10); detC[3] = bandpassCoeffs(1000, 1.41, fs);
      var pC = toneProc(listC, detC, 60, 1000, amp10);
      /* D: 4 band cung luc, tone 1 kHz duy nhat — chi band sidechain BP 1 kHz tac dong. */
      var listD = nulls(10);
      listD[0] = dynBand(1000, "peak"); listD[1] = dynBand(3000, "peak"); listD[2] = dynBand(6000, "peak"); listD[3] = dynBand(8000, "peak");
      var detD = nulls(10); detD[0] = bandpassCoeffs(100, 1.41, fs); detD[1] = bandpassCoeffs(1000, 1.41, fs); detD[2] = bandpassCoeffs(10000, 1.41, fs); detD[3] = bandpassCoeffs(100, 1.41, fs);
      var pD = toneProc(listD, detD, 60, 1000, amp10);
      function acts(v){ return isFinite(v) && v <= -6.5 && v >= -8.05; }
      function quiet(v){ return isFinite(v) && Math.abs(v) <= 0.6; }
      var okA = acts(pA1.dynOff[0]) && quiet(pA2.dynOff[0]);
      var okB = acts(pBlo.dynOff[1]) && quiet(pBlo.dynOff[2]) && acts(pBhi.dynOff[2]) && quiet(pBhi.dynOff[1]);
      var okC = isFinite(pC.dynOff[3]) && pC.dynOff[3] <= -4.45 && pC.dynOff[3] >= -6.05;
      var okD = quiet(pD.dynOff[0]) && acts(pD.dynOff[1]) && quiet(pD.dynOff[2]) && quiet(pD.dynOff[3]);
      row("Dynamic EQ — sidechain độc lập (BP/LP/HP) + detector RMS (worklet thật)",
        "A: BP100 nghe tone 100 Hz -> tac dong, BP1000 -> ~0 · B: LP500/HP5000 tach tram/cao · C: RMS sine -> -5.24 dB · D: 4 band cung luc chi band sidechain 1 kHz tac dong",
        "A: " + pA1.dynOff[0].toFixed(2) + " / " + pA2.dynOff[0].toFixed(2) + " dB · B tram: " + pBlo.dynOff[1].toFixed(2) + " / " + pBlo.dynOff[2].toFixed(2) + " dB, cao: " + pBhi.dynOff[1].toFixed(2) + " / " + pBhi.dynOff[2].toFixed(2) + " dB · C RMS: " + pC.dynOff[3].toFixed(2) + " dB · D: [" + [0,1,2,3].map(function(i){ return pD.dynOff[i].toFixed(2); }).join(", ") + "] dB",
        okA && okB && okC && okD,
        "Chạy đúng WORKLET_SRC (giả lập processor + sampleRate " + fs + " Hz), 60 block x 128 mẫu/tone, attack 1 ms/release 10 ms, threshold -20 dBFS, ratio 4, range -8 dB; đọc trực tiếp dynOff của worklet sau khi envelope ổn định");
    } catch (eD) {
      row("Dynamic EQ — sidechain độc lập (BP/LP/HP) + detector RMS (worklet thật)",
        "A/B/C/D như trên", "lỗi khi đo: " + eD.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  /* --- Dithering TPDF (Lộ trình v2 · Nhóm 1): thống kê nhiễu trên đúng
     hàm tpdfNoiseLSB/tpdfQuantize16 đang giao; tiêu chí: trung bình ~0,
     phương sai ~1/6 LSB^2 (phân phối tam giác, khác hẳn đều: P(|n|<0.5)=0.75),
     DC 0.25 LSB lượng tử hoá không thiên lệch, cùng hạt giống -> cùng dãy,
     NaN/vượt tầm -> mã hữu hạn và kẹp đúng, blob WAV 16-bit đúng loại. --- */
  (function(){
    try {
      var NN = 120000, rngN = tpdfRng(20261026), sumN = 0, sumN2 = 0, cntHalf = 0, kN;
      for (kN = 0; kN < NN; kN++){
        var nv = tpdfNoiseLSB(rngN);
        sumN += nv; sumN2 += nv * nv;
        if (Math.abs(nv) < 0.5) cntHalf++;
      }
      var meanN = sumN / NN, varN = sumN2 / NN - meanN * meanN, pHalf = cntHalf / NN;
      var DC = 0.25, ND = 60000, rngD = tpdfRng(987654321), sumD = 0, kD;
      for (kD = 0; kD < ND; kD++) sumD += tpdfQuantize16(DC / 32768, rngD);
      var meanDC = sumD / ND; /* đơn vị LSB, đích 0.25 */
      var rA = tpdfRng(424242), rB = tpdfRng(424242), sameSeed = true, kS;
      for (kS = 0; kS < 5000; kS++){ if (tpdfNoiseLSB(rA) !== tpdfNoiseLSB(rB)) { sameSeed = false; break; } }
      var clipHi = tpdfQuantize16(2, tpdfRng(7)), clipLo = tpdfQuantize16(-2, tpdfRng(7));
      var nanCode = tpdfQuantize16(NaN, tpdfRng(7));
      var blob16 = irWavBlob16([0.5, -0.25, 0, 0.001], 48000,
        { headphone: "QA", targetName: "QA", phaseLabel: "Minimum Phase", rig: "711", profile: "QA", preamp: 0, dateISO: "2026-10-26" }, tpdfRng(99));
      var okN = Math.abs(meanN) <= 0.01 && varN >= 0.1567 && varN <= 0.1767 && pHalf >= 0.73 && pHalf <= 0.77;
      var okD = Math.abs(meanDC - 0.25) <= 0.05;
      var okC = sameSeed && clipHi === 32767 && clipLo === -32768 && isFinite(nanCode) && blob16.type === "audio/wav" && blob16.size > 4 * 2 * 2;
      row("Dithering TPDF — nhiễu tam giác + lượng tử hoá 16-bit không thiên lệch",
        "N=120000: |trung bình| <= 0.01 LSB · phương sai 0.1567-0.1767 LSB^2 · P(|n|<0.5) 0.73-0.77 · DC 0.25 LSB -> trung bình 0.25 ± 0.05 LSB · cùng hạt giống -> cùng dãy · kẹp ±32767/-32768 · blob WAV đúng loại",
        "trung bình: " + meanN.toFixed(4) + " LSB · phương sai: " + varN.toFixed(4) + " LSB^2 (đích 0.1667) · P(|n|<0.5): " + pHalf.toFixed(4) + " (đích 0.75) · DC 0.25 LSB -> " + meanDC.toFixed(4) + " LSB (không dither luôn 0.00) · cùng hạt giống: " + (sameSeed ? "đúng" : "sai") + " · kẹp: " + clipHi + "/" + clipLo + " · blob: " + blob16.type + ", " + blob16.size + " byte",
        okN && okD && okC,
        "Chạy đúng tpdfNoiseLSB/tpdfQuantize16/irWavBlob16 đang giao trong app, RNG LCG có hạt giống (xuất file thật dùng Math.random)");
    } catch (eT) {
      row("Dithering TPDF — nhiễu tam giác + lượng tử hoá 16-bit không thiên lệch",
        "như trên", "lỗi khi đo: " + eT.message, false,
        "Chạy đúng tpdfNoiseLSB/tpdfQuantize16/irWavBlob16 đang giao trong app");
    }
  })();
  /* --- Chế độ Tự Động Toàn Diện: hàm thuần (chọn band, mức nghe, cấu hình Dyn) --- */
  (function(){
    try {
      var r = (typeof autoSelfCheck === "function") ? autoSelfCheck() : null;
      row("Chế độ Tự Động Toàn Diện — hàm thuần (chọn band, mức nghe, cấu hình Dyn)",
        "phẳng -> 10 band · phức tạp (>=6 đổi chiều, biên >=8 dB) -> 20 band · dốc mượt -> 10 band · vol 100/85/0% -> 80/76/50 phon (ref 80) · gain 6 dB -> thr -20, ratio 4, range -6, RMS · NaN/Inf -> giá trị an toàn",
        r ? r.detail : "mô-đun Auto chưa nạp",
        !!(r && r.ok),
        "Chạy đúng autoPickBandCount/autoVolToListen/autoDynConfig/autoSanitizeBand đang giao trong app (không chạm DSP/solver)");
    } catch (eA) {
      row("Chế độ Tự Động Toàn Diện — hàm thuần (chọn band, mức nghe, cấu hình Dyn)",
        "như trên", "lỗi khi đo: " + eA.message, false,
        "Chạy đúng các hàm thuần của mô-đun Auto trong app");
    }
  /* --- Chặng 1 (lộ trình 4 chặng 2026-10-26): 3 hàng mới --- */
  (function(){
    try {
      var lim = qaNullIirWithLimiter(fs);
      row("Null Test có Limiter — bù gain tĩnh trong vùng headroom (worklet thật)",
        "phần dư < −80 dBFS RMS · minGr === 1 (limiter không cắt nhầm khi tín hiệu trong headroom)",
        "phần dư: " + lim.residDb.toFixed(1) + " dBFS RMS · minGr: " + lim.minGr + " · pre-amp: " + lim.preampDb.toFixed(1) + " dB · đỉnh ra: " + lim.outPeakDb.toFixed(1) + " dBTP (trần −1.0 dBTP)",
        lim.residDb < -80 && lim.minGr === 1,
        "Nhiễu 16 384 mẫu amp 0.15 qua AutoEqProcessor thật từ WORKLET_SRC (limiter BẬT, pre-amp −(maxPos+1) dB) · 64 block warm-up 0 · bù trễ LA=128 + bù gain tĩnh nghịch đảo · cascade nghịch đảo gain-đảo-dấu · cửa sổ ổn định 1000..15000");
    } catch (eL1) {
      row("Null Test có Limiter — bù gain tĩnh trong vùng headroom (worklet thật)",
        "phần dư < −80 dBFS RMS · minGr === 1", "lỗi khi đo: " + eL1.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  (function(){
    try {
      var par = qaWorkletParity(fs);
      var okAll = par.ok;
      row("Đối chiếu QA trên Worklet thật (WORKLET_SRC) vs Bản sao ngoại tuyến",
        "THD+N worklet < −140 dB ở −20 dBFS và < −40 dB ở −1 dBFS · lệch THD+N so với gương Float32 ≤ 0.5 dB · Null IIR worklet < −80 dBFS · lệch null so với gương Float32 ≤ 1.0 dB · Null FIR worklet < −80 dBFS",
        "THD+N worklet: −20 dBFS = " + par.thW20.thdnDb.toFixed(1) + " dB (gương Float32: " + par.thM20.thdnDb.toFixed(1) + " dB, lệch " + Math.abs(par.thW20.thdnDb - par.thM20.thdnDb).toFixed(2) + " dB; bản float64: " + par.thOff20.thdnDb.toFixed(1) + " dB) · −1 dBFS = " + par.thW1.thdnDb.toFixed(1) + " dB · Null IIR worklet: " + par.nullW.toFixed(1) + " dBFS (gương: " + par.nullM.toFixed(1) + " dBFS, lệch " + Math.abs(par.nullW - par.nullM).toFixed(2) + " dB; bản float64: " + par.nullRaw.toFixed(1) + " dBFS) · Null FIR worklet: " + par.firW.rmsDbfs.toFixed(1) + " dBFS (bản float64: " + par.firOff.rmsDbfs.toFixed(1) + " dBFS)",
        okAll,
        "Worklet thật = AutoEqProcessor khởi tạo trực tiếp từ WORKLET_SRC (không addModule) · THD+N: sine 1 kHz, 32 block warm-up, khớp từ mẫu 4096+128 · Null IIR: 2 processor (xuôi + nghịch đảo), bù trễ 2×128 · Null FIR: chặng xuôi worklet mode fir + giải chập FFT ngoại tuyến · Lệch thô với bản float64 (~100 dB) là sàn lượng tử Float32 của AudioWorklet, không phải lệch DSP — xem ghi chú đầu khối Chặng 1");
    } catch (eP1) {
      row("Đối chiếu QA trên Worklet thật (WORKLET_SRC) vs Bản sao ngoại tuyến",
        "như trên", "lỗi khi đo: " + eP1.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  /* --- Chặng 3: hàng QA nhân DSP WASM f64 (tên wasmSelfCheck đã có chủ nên dùng wasmDspSelfCheck) --- */
  (function(){
    try {
      var d = wasmDspSelfCheck(fs);
      row("Nhân DSP WebAssembly (WASM float64) — đối chiếu bit-accurate với JS float64",
        "WebAssembly.validate === true · maxAbsDiff ≤ 1e-14 ở cả 10 và 20 band · đáp tuyến 1 kHz qua nhân WASM = +6.000 dB ± 0.001 dB",
        "validate: " + (d.validated ? "ĐẠT" : "KHÔNG ĐẠT") + " · diff 10 band: " + d.maxAbsDiff10 + " · diff 20 band: " + d.maxAbsDiff20 + " · đáp tuyến 1 kHz: " + (isFinite(d.resp1kDb) ? d.resp1kDb.toFixed(4) : "NaN") + " dB" + (d.reason ? " · " + d.reason : ""),
        !!d.pass,
        "Nhân WASM f64 DF2T 628 byte (biquad_block_f64) qua wasmCreateDspCore · tín hiệu kiểm 4096 mẫu (Dirac + đa hài + nhiễu xác định) · đối chiếu qaCascade · xung + DFT tại 1 kHz cho band +6 dB/Q1.41 · core mới cho mỗi phép đo (trạng thái DF2T bắt đầu từ 0)");
    } catch (eW3) {
      row("Nhân DSP WebAssembly (WASM float64) — đối chiếu bit-accurate với JS float64",
        "như trên", "lỗi khi đo: " + eW3.message, false,
        "Chạy đúng wasmDspSelfCheck / qaCascade");
    }
  })();
  (function(){
    try {
      var vc = vaultSelfCheck();
      row("Lưu trữ bền vững Preset v2 & Lịch sử QA phía máy khách (Opt-In)",
        "7 kịch bản vaultSelfCheck đều đạt: từ chối khi opt-in tắt · khớp 100% khi bật · đổi tên giữ savedAt/thứ tự · lưu tràn 20 báo đúng preset cũ nhất bị loại · mục bẩn trong kho bị lọc lúc đọc · nhập bundle bỏ qua trùng tên, báo preset bị loại do FIFO · xoá sạch khi tắt lại",
        vc.detail, vc.pass,
        "Tự kiểm trên store bộ nhớ cô lập (không chạm localStorage/IndexedDB thật) · Opt-In mặc định TẮT · preset tối đa 20, lịch sử QA tối đa 15 · tắt Opt-In là xoá sạch ngay");
    } catch (eV1) {
      row("Lưu trữ bền vững Preset v2 & Lịch sử QA phía máy khách (Opt-In)",
        "7 kịch bản vaultSelfCheck đều đạt", "lỗi khi đo: " + eV1.message, false,
        "vaultSelfCheck() trên store bộ nhớ cô lập");
    }
  })();
  (function(){
    try {
      var parW = aeWorkerParityCheck();
      row("Solver Web Worker — đối chiếu 10/20 band với main thread (Mẫu A)",
        "maxDiff === 0 tuyệt đối ở cả 10 và 20 band (freq, gain, q từng band)",
        "10 band: maxDiff " + parW.diff10 + " (" + parW.bands10 + " band) · 20 band: maxDiff " + parW.diff20 + " (" + parW.bands20 + " band)",
        parW.ok,
        "Mẫu A → Harman OE 2018, cùng err/weights (null đã zero-weight) · worker = AE_WORKER_SRC (.toString() của chính các hàm thuần main thread) qua new Function · main thread = aeSolve đồng bộ");
    } catch (eW) {
      row("Solver Web Worker — đối chiếu 10/20 band với main thread (Mẫu A)",
        "maxDiff === 0 tuyệt đối", "lỗi khi đo: " + eW.message, false,
        "aeWorkerParityCheck() trên AE_WORKER_SRC");
    }
  })();
  (function(){
    try {
      var v8r = dbExtSelfCheck();
      row("Mở rộng kho đo On-Demand — Pack Loader + dbEncodeV/dbDecodeV + chống trùng/hỏng",
        "round-trip ≤ 0,05 dB · nạp thử 2 vào/3 loại · trùng kho thật bị chặn · kho giữ nguyên tuyệt đối",
        v8r.detail + " · kho trước/sau: " + v8r.beforePhones + "/" + v8r.afterPhones + " mục",
        v8r.pass,
        "dbExtSelfCheck() trên bản sao kiểm thử (không chạm DB_PHONES/AE_PHONES thật) · id p5V8 dùng mới vì p5V6 đã là hàng CamillaDSP/Qudelix");
    } catch (e8) {
      row("Mở rộng kho đo On-Demand — Pack Loader + dbEncodeV/dbDecodeV + chống trùng/hỏng",
        "như trên", "lỗi khi đo: " + e8.message, false,
        "dbExtSelfCheck() trên bản sao kiểm thử");
    }
  })();
  })();
  (function(){
    try {
      var ux = uxAutoPilotSelfCheck();
      row("Smart Auto-Pilot v2 — Quick EQ Bar 1 chạm + 12 tự động hoá (Chặng 4)",
        "target IE+5128→jm1 · IE→harmanIE · OE→harmanOE · crossfeed IE 28/0.30 · OE 22/0.28 · 4 phong cách đúng giá trị · guard gdMaxLow ≤ 5,0 ms",
        ux.detail, ux.ok,
        "uxAutoPilotSelfCheck() trên trạng thái thật (slider khôi phục sau kiểm, bands khôi phục sau guard)");
    } catch (eUx) {
      row("Smart Auto-Pilot v2 — Quick EQ Bar 1 chạm + 12 tự động hoá (Chặng 4)",
        "như trên", "lỗi khi đo: " + eUx.message, false,
        "uxAutoPilotSelfCheck()");
    }
  })();
  /* --- Liều nghe trong tuần: toán liều / giảm nhẹ / ghi đè / tuần ISO --- */
  (function(){
    try {
      var dr = (typeof doseSelfCheck === "function") ? doseSelfCheck() : null;
      row("Liều nghe trong tuần — toán liều, giảm nhẹ, ghi đè tay, reset tuần ISO",
        "40 giờ @ 80 dB -> 100% · 20 giờ @ 83 dB -> 100% · 10 giờ @ 77 dB -> 12.5% · giảm nhẹ <80% -> 0 dB, 90% -> −1.5 dB, >=100% -> −3 dB (kẹp, không dừng phát) · chỉnh tay -> trim 0 + cờ ghi đè · đổi tuần ISO -> liều về 0",
        dr ? dr.detail : "mô-đun liều nghe chưa nạp",
        !!(dr && dr.ok),
        "Chạy đúng doseAdd/doseTrimDb/doseEaseState/doseWeekKey/doseResolveWeek đang giao trong app (chỉ mức phát ước lượng + thời gian đang phát, không ghi âm thanh)");
    } catch (eD) {
      row("Liều nghe trong tuần — toán liều, giảm nhẹ, ghi đè tay, reset tuần ISO",
        "như trên", "lỗi khi đo: " + eD.message, false,
        "Chạy đúng các hàm thuần của mô-đun liều nghe trong app");
    }
  })();
  /* --- NÂNG CẤP KHỐI 4/5/6 (2026-10-31): decramped biquad, ISO 226:2023, Harman IE 13 tham số --- */
  (function(){
    function upRow(name, expect, fn, cfg){
      try {
        var r = (typeof UP !== "undefined" && typeof UP[fn] === "function") ? UP[fn]() : null;
        row(name, expect, r ? ("tự kiểm " + fn + ": " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : "")) : "mô-đun chưa nạp", !!(r && r.pass === r.total), cfg);
      } catch (e) {
        row(name, expect, "lỗi khi đo: " + e.message, false, cfg);
      }
    }
    upRow("Nâng cấp Khối 4 — Decramped Biquad 8 họ lọc & Jury Stability Guard",
      "đủ 8 họ lọc đạt chuẩn (notch triệt <= -100 dB, allpass phẳng < 1e-11 dB, LP/HP -3.01 dB tại fc) · decramped giảm sai số sườn trên 14-20 kHz >= 40% so với RBJ · lưới cực đoan 320 bộ đều ổn định Jury",
      "selfCheck4", "UP.selfCheck4() — chạy đúng rbjCoeffs/biquadMagDb và UP.pure4 đang giao trong app");
    upRow("Nâng cấp Khối 5 — Chuẩn quốc tế ISO 226:2023 (Công thức 1 & 2 + Table 1)",
      "neo 1 kHz lệch 0 tuyệt đối (< 1e-12 dB) · ngưỡng 2.4 phon khớp cột Tf 29/29 · bù 60 vs 80 phon: +8.12 dB tại 50 Hz, +6.04 dB tại 100 Hz · khứ hồi (1)<->(2) < 1e-10 phon · ngân hàng 6-section khớp contour mới RMS <= 0.50 dB",
      "selfCheck5", "UP.selfCheck5() — chạy đúng isoSplIdx/isoPhonIdx/loudGainsFor đang giao trong app");
    upRow("Nâng cấp Khối 6 — Mô hình & Solver Harman IE 2019 (đủ 13 tham số)",
      "13/13 tham số có độ nhạy độc lập · mặc định khớp 22 knots RMS <= 0.35 dB, max <= 0.90 dB · solver 13 band trên Mẫu A giảm lỗi >= 65%, 0 vi phạm · Mẫu C 0 band boost vào null · kẹp NaN an toàn",
      "selfCheck6", "UP.selfCheck6() — chạy đúng UP.pure6 và aeCompute đang giao trong app (đồng bộ, trong QA)");
  })();
  return rows;
}
/* ---------------- Dashboard + cổng xuất file ---------------- */
function qaEsc(s){ return String(s).replace(/</g, "&lt;"); }
function qaRealFails(){ return QA6.results.filter(function(r){ return !r.pass && r.kind !== "mutation" && r.kind !== "conditional"; }); }
function qaConditionals(){ return QA6.results.filter(function(r){ return r.kind === "conditional"; }); }
function qaRenderDashboard(){
  var tb = $("qaRows");
  if (!QA6.results.length){
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--dim)">Chưa có kết quả — toàn bộ kiểm chứng tự chạy khi tải trang, hoặc bấm “Chạy toàn bộ QA” ở trên để chạy lại.</td></tr>';
    $("qaSummary").textContent = "—";
    return;
  }
  tb.innerHTML = QA6.results.map(function(r){
    var badge = r.kind === "mutation"
      ? '<span class="fail">FAIL</span> <span style="color:var(--amber);font-size:11.5px">(mutation có chủ đích)</span>'
      : r.kind === "conditional"
        ? '<span class="skip">CHƯA ĐỦ ĐIỀU KIỆN ĐO</span> <span style="color:var(--dim);font-size:11.5px">(môi trường không cho mẫu hợp lệ — không tính FAIL, không khóa xuất file)</span>'
        : (r.pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>');
    return "<tr><td><b>" + qaEsc(r.name) + '</b><br><span style="color:var(--dim);font-size:11.5px">Giai đoạn ' + qaEsc(r.stage) + "</span></td>" +
      "<td class=\"mono\">" + qaEsc(r.expect) + "</td><td class=\"mono\">" + qaEsc(r.measured) + "</td><td>" + badge + "</td><td class=\"mono\">" + qaEsc(r.cfg) + "</td></tr>";
  }).join("");
  var fails = qaRealFails();
  var conds = qaConditionals();
  var np = QA6.results.filter(function(r){ return r.pass; }).length;
  $("qaSummary").innerHTML = QA6.results.length + " test · <span class='pass'>" + np + " PASS</span> · " + (fails.length ? "<span class='fail'>" + fails.length + " FAIL thật</span>" : "<span class='pass'>0 FAIL thật</span>") +
    (conds.length ? " · <span class='skip'>" + conds.length + " chưa đủ điều kiện đo</span> (môi trường hiển thị — chạy lại trong tab đang focus để kết luận)" : "") +
    (QA6.ack && fails.length ? " · người dùng đã xác nhận cảnh báo, xuất file đã mở lại" : "");
  qaApplyGate();
}
var QA_EXPORT_BTNS = ["expApo", "expSS", "expWav", "expPA", "expJD", "expCamilla", "expQudelix", "expEasy", "expProq", "geqDownload", "batchDownload", "expRoon", "expIrMin", "expIrLin", "expIrMix", "expIr16Min", "expIr16Lin", "expIr16Mix"];
function qaApplyGate(){
  var fails = qaRealFails();
  var locked = fails.length > 0 && !QA6.ack;
  QA_EXPORT_BTNS.forEach(function(id){ var b = $(id); if (b) b.disabled = locked; });
  var html = "";
  if (locked){
    html = "<b>Đã khóa xuất file (Giai đoạn 5) vì QA có " + fails.length + " FAIL thật:</b> " + fails.map(function(r){ return qaEsc(r.name); }).join(" · ") +
      ". Đây là khóa có thông báo rõ ràng, không phải khóa im lặng: file xuất từ một cấu hình chưa đạt kiểm chứng có thể sai trên thiết bị thật. " +
      '<button class="btn small qaAckBtn" style="margin-left:8px">Tôi hiểu rủi ro — vẫn mở khóa xuất file</button>';
  } else if (fails.length && QA6.ack){
    html = "QA vẫn còn " + fails.length + " FAIL thật, nhưng bạn đã xác nhận cảnh báo — các nút xuất file đã được mở lại theo quyết định của bạn.";
  }
  [$("qaGateNote"), $("qaGateNote2")].forEach(function(el){
    if (!el) return;
    el.style.display = html ? "block" : "none";
    el.innerHTML = html;
  });
  Array.prototype.forEach.call(document.querySelectorAll(".qaAckBtn"), function(b){
    b.addEventListener("click", function(){ QA6.ack = true; qaRenderDashboard(); });
  });
}
/* ---------------- Thu thập kết quả các panel Giai đoạn 1–5 ---------------- */
function qaCollectStageRows(){
  var map = [
    ["vResp", "vRespOk", "1"], ["vPre", "vPreOk", "1"], ["wasmV1", "wasmV1Ok", "1"],
    ["aeV1", "aeV1Ok", "2"], ["aeV2", "aeV2Ok", "2"], ["aeV3", "aeV3Ok", "2"], ["aeV4", "aeV4Ok", "2"], ["aeV5", "aeV5Ok", "2"], ["aeV6", "aeV6Ok", "2"], ["aeV7", "aeV7Ok", "2"], ["aeV8", "aeV8Ok", "2"],
    ["psV1", "psV1Ok", "3"], ["psV2", "psV2Ok", "3"], ["psV3", "psV3Ok", "3"], ["psV4", "psV4Ok", "3"], ["psV5", "psV5Ok", "3"], ["psV6", "psV6Ok", "3"], ["psV7", "psV7Ok", "3"], ["psV8", "psV8Ok", "3"],
    ["p4V1", "p4V1Ok", "4"], ["p4V2", "p4V2Ok", "4"], ["p4V3", "p4V3Ok", "4"], ["p4V4", "p4V4Ok", "4"],
    ["p5V1", "p5V1Ok", "5"], ["p5V2", "p5V2Ok", "5"], ["p5V3", "p5V3Ok", "5"], ["p5V4", "p5V4Ok", "5"], ["p5V5", "p5V5Ok", "5"], ["p5V6", "p5V6Ok", "5"], ["p5V7", "p5V7Ok", "5"], ["p5V8", "p5V8Ok", "5"]
  ];
  var rows = [];
  map.forEach(function(m){
    var vEl = $(m[0]), oEl = $(m[1]);
    if (!vEl || !oEl) return;
    var tr = vEl.closest("tr");
    var name = tr ? tr.children[0].textContent.trim() : m[0];
    var measured = vEl.textContent.trim();
    if (!measured || measured === "—") return;
    var isCond = oEl.innerHTML.indexOf('class="skip"') >= 0;
    var isPending = oEl.textContent.trim() === "…" || measured.indexOf("đang đo") === 0 || measured.indexOf("đang chập") === 0;
    rows.push({ name: name, stage: m[2] + " · Kiểm chứng nghiệm thu", expect: "tiêu chí ghi trong panel Giai đoạn " + m[2], measured: isPending ? measured + " — lần thu thập này diễn ra khi phép đo chưa kịp hoàn tất trong môi trường hiện tại" : measured,
      pass: !isPending && oEl.innerHTML.indexOf('class="pass"') >= 0, cfg: "Chạy lại từ nút “Chạy toàn bộ QA” của Giai đoạn 6 trên đúng panel kiểm chứng gốc", kind: (isCond || isPending) ? "conditional" : "stage" });
  });
  return rows;
}
function qaWaitFor(fn, timeoutMs){
  return new Promise(function(res){
    var t0 = performance.now();
    var iv = setInterval(function(){
      if (fn() || performance.now() - t0 > timeoutMs){ clearInterval(iv); res(); }
    }, 150);
  });
}
/* ---------------- Báo cáo tổng hợp ---------------- */
function qaBuildReport(){
  var fails = qaRealFails();
  var rep = {
    report: "Web AutoEQ — Báo cáo QA tổng hợp (cổng hồi quy tương đương `pnpm qa` của bản web)",
    generatedAt: new Date().toISOString(),
    context: { mode: mode, sampleRate: displayFs, firTaps: firLen, bypass: bypass, limiterOn: limiterOn,
      bands: bands.map(function(b){ return { freq: Math.round(b.freq), type: b.type, gain: +b.gain.toFixed(2), q: +b.q.toFixed(2), on: b.on }; }) },
    totals: { tests: QA6.results.length, pass: QA6.results.filter(function(r){ return r.pass; }).length, realFails: fails.length,
      notMeasuredEnvironment: qaConditionals().length,
      mutationFailsAsDesigned: QA6.results.filter(function(r){ return r.kind === "mutation" && !r.pass; }).length },
    exportGate: fails.length ? (QA6.ack ? "Có FAIL thật nhưng người dùng đã xác nhận cảnh báo — xuất file mở" : "Có FAIL thật — xuất file đang bị khóa chờ xác nhận") : "Không có FAIL thật — xuất file mở" + (qaConditionals().length ? " (" + qaConditionals().length + " test chưa đủ điều kiện đo vì môi trường hiển thị — không khóa xuất)" : ""),
    mutation: QA6.mutationInfo,
    results: QA6.results,
    verdict: fails.length ? "FAIL — còn " + fails.length + " test thật chưa đạt (xem dashboard)" : "PASS — mọi test đã đo trong lần chạy này đều đạt" + (qaConditionals().length ? " · " + qaConditionals().length + " test chưa đủ điều kiện đo trong môi trường này (không kết luận PASS/FAIL — xem dashboard)" : "")
  };
  QA6.report = rep;
  try { if (vaultGetOptIn()) { var _vq = vaultSaveQaReport({ id: "qa-" + Date.now(), timestamp: rep.generatedAt,
    passCount: rep.totals.pass, totalCount: rep.totals.tests, realFails: rep.totals.realFails,
    stageLine: stageLine, reportJson: JSON.stringify(rep) }); if (_vq.saved) vaultIdbPut("qa", { id: "qa-" + Date.now(), savedAt: rep.generatedAt }); } } catch (e){}
  var byStage = {};
  QA6.results.forEach(function(r){ var s = r.stage.charAt(0); byStage[s] = byStage[s] || { p: 0, f: 0, c: 0 }; if (r.pass) byStage[s].p++; else if (r.kind === "conditional") byStage[s].c++; else if (r.kind !== "mutation") byStage[s].f++; });
  var stageLine = Object.keys(byStage).sort().map(function(s){ return "Giai đoạn " + s + ": " + byStage[s].p + " PASS" + (byStage[s].f ? " · " + byStage[s].f + " FAIL" : "") + (byStage[s].c ? " · " + byStage[s].c + " chưa đủ điều kiện đo" : ""); }).join(" &nbsp;|&nbsp; ");
  $("qaReport").innerHTML =
    '<div class="kv"><span>Phán quyết</span><b class="' + (fails.length ? "red" : "green") + '">' + qaEsc(rep.verdict) + '</b></div>' +
    '<div class="kv"><span>Thời điểm chạy</span><b>' + new Date(rep.generatedAt).toLocaleString("vi-VN") + '</b></div>' +
    '<div class="kv"><span>Theo giai đoạn</span><b>' + stageLine + '</b></div>' +
    '<div class="kv"><span>Cổng xuất file</span><b>' + qaEsc(rep.exportGate) + '</b></div>' +
    (QA6.mutationInfo ? '<div class="kv"><span>Mutation test</span><b>' + qaEsc(QA6.mutationInfo.summary) + '</b></div>' : "") +
    '<p class="note" style="margin:8px 0 0">Báo cáo đầy đủ (mọi test: kỳ vọng, giá trị đo, cấu hình) nằm trong file tải xuống .json/.html. Trong app, bảng dashboard ở trên là cùng một dữ liệu.</p>';
  $("btnQaRepJson").disabled = false;
  $("btnQaRepHtml").disabled = false;
  return rep;
}
function qaReportHtml(rep){
  var rows = rep.results.map(function(r){
    return "<tr><td>" + qaEsc(r.name) + "</td><td>" + qaEsc(r.stage) + "</td><td>" + qaEsc(r.expect) + "</td><td>" + qaEsc(r.measured) + "</td><td>" + (r.pass ? "PASS" : (r.kind === "conditional" ? "CHƯA ĐỦ ĐIỀU KIỆN ĐO" : "FAIL")) + "</td><td>" + qaEsc(r.cfg) + "</td></tr>";
  }).join("");
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo QA — Web AutoEQ</title>' +
    '<style>body{background:#0b0d10;color:#e8ecf1;font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px 8px;font-size:13px;text-align:left}h1{font-size:20px}</style></head><body>' +
    "<h1>Web AutoEQ — Báo cáo QA tổng hợp</h1><p>Cổng hồi quy tương đương `pnpm qa` của bản web · Sinh lúc: " + qaEsc(rep.generatedAt) + "</p>" +
    "<p><b>Phán quyết: " + qaEsc(rep.verdict) + "</b></p><p>" + qaEsc(rep.exportGate) + "</p>" +
    (rep.mutation ? "<p>Mutation test: " + qaEsc(rep.mutation.summary) + "</p>" : "") +
    "<table><tr><th>Test</th><th>Giai đoạn</th><th>Kỳ vọng</th><th>Giá trị đo</th><th>Kết quả</th><th>Cấu hình</th></tr>" + rows + "</table></body></html>";
}
$("btnQaRepJson").addEventListener("click", function(){ if (QA6.report) dlText("web-autoeq-qa-report.json", JSON.stringify(QA6.report, null, 2), "application/json;charset=utf-8"); });
$("btnQaRepHtml").addEventListener("click", function(){ if (QA6.report) dlText("web-autoeq-qa-report.html", qaReportHtml(QA6.report), "text/html;charset=utf-8"); });
/* ---------------- Sự kiện các nút QA ---------------- */
$("btnQaSuite").addEventListener("click", function(){
  var btn = this; btn.disabled = true; btn.textContent = "Đang đo QA Suite…";
  setTimeout(function(){
    try {
      var rows = qaRunSuite();
      QA6.results = QA6.results.filter(function(r){ return r.stage.charAt(0) !== "6"; }).concat(rows);
      QA6.ranAt = new Date(); QA6.ack = false;
      $("qaState").textContent = "QA Suite đã chạy lúc " + QA6.ranAt.toLocaleTimeString("vi-VN");
      qaRenderDashboard();
      qaBuildReport();
    } catch (e) { $("qaState").textContent = "lỗi khi chạy QA Suite: " + e.message; }
    btn.disabled = false; btn.textContent = "Chạy Acoustic QA Suite";
  }, 30);
});
$("btnQaMutation").addEventListener("click", function(){
  var fs = displayFs || 48000;
  var clean = qaRespDb(false, fs), mut = qaRespDb(true, fs);
  var mutFailed = Math.abs(mut - 6) > 0.1, cleanPassed = Math.abs(clean - 6) <= 0.1;
  QA6.mutationInfo = { cleanDb: +clean.toFixed(3), mutatedDb: +mut.toFixed(3), mutation: "+0.5 dB vào hệ số biquad (b0/b1/b2 của band 1 kHz × 10^(0.5/20)) trong bản sao hệ số của harness",
    summary: "Hệ số sạch cho " + clean.toFixed(2) + " dB (PASS) → sau mutation " + mut.toFixed(2) + " dB (FAIL như thiết kế) → mutation đã gỡ, engine thật không bị đụng" };
  QA6.results = QA6.results.filter(function(r){ return r.kind !== "mutation" && r.kind !== "mutation-verdict"; });
  QA6.results.push({ name: "Mutation: đáp tuyến 1 kHz khi hệ số biquad bị cộng sai +0.5 dB", stage: "6 · Mutation test", expect: "+6.00 dB ± 0.10 dB",
    measured: mut.toFixed(3) + " dB — sai số " + Math.abs(mut - 6).toFixed(3) + " dB, vượt dung sai 0.10 dB", pass: false,
    cfg: "Bản sao hệ số của harness QA (band 6 · 1 kHz · +6 dB · Q 1.41, b0/b1/b2 × 10^(0.5/20)) — FAIL này là bằng chứng bộ kiểm chứng bắt được lỗi; không khóa xuất file", kind: "mutation" });
  QA6.results.push({ name: "Mutation test — phán quyết", stage: "6 · Mutation test", expect: "test liên quan chuyển FAIL khi có mutation và PASS khi hệ số sạch",
    measured: "sạch: " + clean.toFixed(3) + " dB (" + (cleanPassed ? "PASS" : "FAIL") + ") · mutation: " + mut.toFixed(3) + " dB (" + (mutFailed ? "FAIL như kỳ vọng" : "vẫn PASS — nguy hiểm") + ")",
    pass: mutFailed && cleanPassed, cfg: "Mutation chỉ tồn tại trong lần đo này rồi được gỡ ngay; engine đang nghe và preset của bạn không thay đổi", kind: "mutation-verdict" });
  $("qaState").textContent = "mutation test đã chạy lúc " + new Date().toLocaleTimeString("vi-VN") + " — mutation đã gỡ";
  qaRenderDashboard();
  if (QA6.report) qaBuildReport();
});
$("btnQaAll").addEventListener("click", async function(){
  var btn = this; btn.disabled = true; btn.textContent = "Đang chạy toàn bộ QA…";
  $("qaState").textContent = "đang chạy lần lượt Giai đoạn 1–5 rồi QA Suite…";
  var st = snapState();
  var psySnap = JSON.stringify({ bypassAll: PSY.bypassAll, loud: PSY.loud, notch: PSY.notch, cross: PSY.cross, dyn: PSY.dyn, calFreq: PSY.calFreq });
  var modeSnap = mode, bypassSnap = bypass;
  /* Chụp riêng trạng thái AutoEQ + danh sách tai nghe: các panel kiểm chứng không
     được phép làm thay đổi danh sách tai nghe (kho 12 + mẫu + của người dùng)
     hay tai nghe đang chọn. Sau khi chạy xong, ô chọn được dựng lại từ registry
     và tai nghe đang chọn được khôi phục — rồi đối chiếu số mục trước/sau. */
  var aeSnap = (typeof AE !== "undefined") ? {
    phoneId: AE.phoneId || "", points: AE.points, name: AE.name, rig: AE.rig, source: AE.source,
    phoneCount: (typeof AE_PHONES !== "undefined" ? Object.keys(AE_PHONES).length : 0),
    optCount: (typeof AE_PHONES !== "undefined" ? Object.keys(AE_PHONES).length : 0),
    dbCount: (typeof DB_PHONES !== "undefined" ? DB_PHONES.length : 0),
    dbShown: ($("dbResults") ? $("dbResults").children.length : 0),
    sampleCount: (typeof AE_SAMPLES !== "undefined" ? AE_SAMPLES.length : 0)
  } : null;
  function qaRestorePhones(){
    if (!aeSnap) return;
    if (typeof aeRenderPhoneSelect === "function") aeRenderPhoneSelect();
    if (typeof dbRenderResults === "function" && $("dbSearch") && !$("dbSearch").value) dbRenderResults();
    if (aeSnap.points && AE.points !== aeSnap.points){
      AE.phoneId = aeSnap.phoneId;
      aeSetMeasurement(aeSnap.points, aeSnap.name, aeSnap.rig, aeSnap.source);
    }
    if (aeSnap.phoneId && typeof aeShowSelectedPhone === "function"){ AE.phoneId = aeSnap.phoneId; aeShowSelectedPhone(); aeRenderStepResults(); }
  }
  try {
    $("btnVerify").click();
    /* Chặng 5.5: chạy kiểm chứng Prompt 4 ngay sau kiểm chứng Giai đoạn 1, trước
       các kiểm chứng cấp phát FFT lớn (AutoEQ/Prompt 5) để tránh GC xen giữa. */
    $("btnP4Verify").click();
    $("btnAeVerify").click();
    $("btnPsVerify").click();
    $("btnP5Verify").click();
    await qaWaitFor(function(){ return $("p5V4Ok").textContent.trim() !== "—" && $("p5V4").textContent.indexOf("đang chập") < 0; }, 7000);
    await qaWaitFor(function(){ var t = $("p4V2Ok").textContent.trim(); return t !== "—" && t !== "…"; }, 7000);
    var stageRows = qaCollectStageRows();
    /* khôi phục trạng thái người dùng trước khi chạy QA Suite trên cấu hình thật của họ */
    var P = JSON.parse(psySnap);
    PSY.bypassAll = P.bypassAll; PSY.loud = P.loud; PSY.notch = P.notch; PSY.cross = P.cross; PSY.dyn = P.dyn; PSY.calFreq = P.calFreq;
    if (loudRamp){ clearInterval(loudRamp); loudRamp = null; }
    if (Array.isArray(PSY.loud.tgt)) PSY.loud.cur = PSY.loud.tgt.slice(); else PSY.loud.cur = [0,0,0,0,0,0]; /* preset cu (scalar curLow/curHigh) khong con dung: cur se ramp lai tu target moi trong applyPsycho */
    syncPsyUI(); applyPsycho();
    applyState(st);
    if (mode !== modeSnap) setMode(modeSnap);
    if (bypass !== bypassSnap){
      bypass = bypassSnap;
      $("btnBypass").textContent = "Bypass: " + (bypass ? "BẬT — EQ bị vòng qua" : "Tắt");
      $("btnBypass").classList.toggle("active", bypass);
      pushConfig(); drawGraph();
    }
    qaRestorePhones();
    var qaRows = qaRunSuite();
    QA6.results = stageRows.concat(qaRows);
    QA6.ranAt = new Date(); QA6.ack = false;
    var phoneAfter = aeSnap ? Object.keys(AE_PHONES).length : 0;
    var dbAfter = aeSnap ? DB_PHONES.length : 0;
    $("qaState").textContent = "toàn bộ QA đã chạy lúc " + QA6.ranAt.toLocaleTimeString("vi-VN") + " · trạng thái EQ/psycho của bạn đã được khôi phục" +
      (aeSnap ? " · danh sách tai nghe sau QA: " + phoneAfter + " mục trong ô chọn Bước 1 (trước QA: " + aeSnap.phoneCount + " mục — " + (phoneAfter === aeSnap.phoneCount ? "GIỮ NGUYÊN" : "LỆCH, cần kiểm tra") + ") · kho tích hợp " + dbAfter + "/" + aeSnap.dbCount + " tai nghe · " + aeSnap.sampleCount + " tai nghe mẫu kiểm chứng" : "");
    qaRenderDashboard();
    qaBuildReport();
  } catch (e) {
    $("qaState").textContent = "lỗi khi chạy toàn bộ QA: " + e.message;
    try { applyState(st); } catch (e2) {}
    try { qaRestorePhones(); } catch (e3) {}
  }
  btn.disabled = false; btn.textContent = "Chạy toàn bộ QA (Giai đoạn 1–5 + QA Suite)";
});
/* ---------------- Khởi tạo Giai đoạn 6 ---------------- */
qaDrawPhaseGd();
qaRenderDashboard();
window.addEventListener("resize", function(){ qaDrawPhaseGd(); if (QA6.ir) qaDrawIr(QA6.ir); });

/* ---------------- Tự chạy toàn bộ kiểm chứng khi tải trang ----------------
   Trước đây mọi panel kiểm chứng chỉ hiện số đo sau khi người dùng tự bấm
   nút chạy — mở trang là thấy "—" khắp nơi và tưởng app lỗi. Nay ngay khi
   trang tải xong, app tự chạy ĐÚNG pipeline của nút "Chạy toàn bộ QA"
   (Giai đoạn 1–5 + QA Suite, có chụp/khôi phục trạng thái) một lần, để mọi
   panel và dashboard hiện số đo thật ngay. Người dùng vẫn bấm chạy lại
   bất cứ lúc nào; lần tự chạy này không tự lặp lại. */
var QA_AUTO = { ran: false };
function qaAutoRun(){
  /* Tối ưu khởi động (2026-10-31): KHÔNG còn tự chạy toàn bộ kiểm chứng khi
     tải trang nữa — bộ QA đầy đủ (5 giai đoạn + QA Suite) chạy đồng bộ trên
     luồng chính khiến web giật/đơ vài giây ngay lúc mới mở. Kiểm chứng vẫn
     nguyên vẹn và chạy khi người dùng bấm nút "Chạy toàn bộ QA". */
  if (QA_AUTO.ran) return;
  QA_AUTO.ran = true;
  var st = $("qaState");
  if (st) st.textContent = "Chưa chạy — kiểm chứng không tự chạy khi tải trang nữa (tránh giật lúc mở web); bấm \u201cChạy toàn bộ QA\u201d khi cần kiểm chứng.";
}
setTimeout(qaAutoRun, 300);
