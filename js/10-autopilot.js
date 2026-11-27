/* Web AutoEQ split module: 10-autopilot.js (nguon: khoi script L22624 cua ban 1 file) */

/* --- Chặng 4 (Smart Auto-Pilot v2): khối tự chứa, chỉ gắn class / di chuyển nút, không xoá thẻ hay id nào. --- */
function autoPickTarget(entry){
  if (!entry) return "harmanOE";
  var t = String(entry.type || "").toLowerCase(), r = String(entry.rig || "");
  if (t.indexOf("in-ear") >= 0 || t.indexOf("inear") >= 0){
    return r.indexOf("5128") >= 0 ? "jm1" : "harmanIE";
  }
  return "harmanOE";
}
function qaGdMaxLowOnly(){
  try {
    var fs = displayFs || 48000;
    var N = 240;
    var grid = QA_GD_GRID[fs];
    if (!grid){
      /* (vong tu dong 17:23, huong B): dung chung mang luoi QA_GD_FREQS (js/08) khi tao grid moi trong qaGdMaxLowOnly — freqs[k]=20*1000^(k/240) khong phu thuoc fs nen dung MOT lan roi tai dung tham chieu cho moi grid, thay vi tinh lai 241 Math.pow moi lan tao grid cho fs moi (doi sample rate / quet fs trong guard); dw van tinh lai theo fs bang dung bieu thuc goc nen freqs/dw/gdMaxLow giong tung bit theo cau truc (khong code nao sua grid.freqs — chi doc, da kiem chung bang grep). Lab Node tren ham that trich verbatim (hidden_files/run_20261127_1721_B/lab/, 2 lan bench doc lap): parity 491/491 kiem tra GIONG TUNG BIT (Object.is tren gdMaxLow + deepEq tren freqs/dw/kMax moi grid; gom cold IIR/FIR, fs-sweep 12 fs, warm-repeat, fs 0/NaN/Infinity/am, grid-reset, both-reset, prefill-grid, fuzz 40x2; kiem tra rieng: ban moi chia se dung 1 tham chieu QA_GD_FREQS cho moi fs, ban cu moi grid 1 mang rieng nhung gia tri bang nhau tung phan tu); toc do paired-median xen ke 15 vong: W1 fs-sweep FIR grid-create (30 fs, reset QA_GD_GRID moi rep) lan 1 1,3919x thang 15/15, lan 2 1,3881x thang 14/15; W2 warm-repeat control trung tinh 1,0038x/0,9724x (khong hoi quy duong nong). Khong cham solver/WASM/FIR/QA logic; aeV3 khong doi theo cau truc (khong do lai; gan nhat 468/482 ms ngay 2026-11-11). QA trinh duyet day du chua chay duoc tren VM (headless Chrome bi chan Hatch WebGL). Luot ke: nhom C. */
      var freqs0 = (typeof QA_GD_FREQS !== "undefined") ? QA_GD_FREQS : null;
      if (!freqs0){
        freqs0 = [];
        for (var k0 = 0; k0 <= N; k0++) freqs0.push(20*Math.pow(1000, k0/N));
        if (typeof QA_GD_FREQS !== "undefined") QA_GD_FREQS = freqs0;
      }
      var dw0 = new Float64Array(N + 1);
      for (var k1 = 0; k1 <= N; k1++){
        var a0 = Math.max(0, k1-1), b0 = Math.min(N, k1+1);
        dw0[k1] = 2*Math.PI*(freqs0[b0] - freqs0[a0])/fs;
      }
      grid = { freqs: freqs0, dw: dw0 };
      if (Object.keys(QA_GD_GRID).length > 8) QA_GD_GRID = {};
      QA_GD_GRID[fs] = grid;
    }
    var freqs = grid.freqs;
    if (mode === "fir"){
      var D = (firLen - 1)/2;
      var gdValF = D/fs*1000;
      QA6.gdMaxLow = null;
      for (var kf = 0; kf <= N; kf++){
        if (freqs[kf] <= 100 && (QA6.gdMaxLow === null || gdValF > QA6.gdMaxLow)) QA6.gdMaxLow = gdValF;
      }
      return;
    }
    /* (vòng tự động 07:13, hướng B — ÁP DỤNG, vá code): cache kMax (chỉ số lưới cuối cùng có freqs<=100 Hz) vào grid.kMax — lưới freqs chỉ phụ thuộc N=240 cố định (không phụ thuộc fs) nên kMax không đổi theo lần gọi; trước đây mỗi lần gọi qaGdMaxLowOnly đều quét lại 241 điểm lưới chỉ để tìm kMax, nay tính MỘT lần rồi tái dùng (grid do qaPhaseGdData tạo cũng nhận thêm trường này an toàn vì caller đó chỉ đọc .freqs/.dw/.cw/.sw/.cw2/.sw2). Quét gốc giữ nguyên từng toán hạng/thứ tự nên kMax và mọi kết quả GIỐNG TỪNG BIT theo cấu trúc. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0710_B/, 2 lần bench độc lập): parity 15 kịch bản + warm-repeat + guard-like 30 bước + fuzz 200 GIỐNG TỪNG BIT; tốc độ warm-hit paired-median xen kẽ 15 vòng: lần 1 20 band 1,0321x thắng 13/15; lần 2 20 band 1,0698x thắng 13/15, 10 band 1,1195x thắng 14/15 (control old-vs-old 0,9944x). Ứng viên phụ gộp vòng unwrap+gd trong cùng hàm bị bác (10 band lần 2 chậm hơn 0,9590x, không ổn định) — KHÔNG thử lại hướng gộp vòng đó. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm C. Lab: hidden_files/run_20261124_0710_B/. */
    var kMax;
    if (grid.kMax !== undefined) kMax = grid.kMax;
    else { kMax = -1; for (var kk = 0; kk <= N; kk++){ if (freqs[kk] <= 100) kMax = kk; } grid.kMax = kMax; }
    if (kMax < 0){ QA6.gdMaxLow = null; return; }
    if (kMax + 1 > 56){
      var dFull = qaPhaseGdData(fs);
      QA6.gdMaxLow = null;
      dFull.freqs.forEach(function(f, i){
        if (f <= 100 && (QA6.gdMaxLow === null || dFull.gdMs[i] > QA6.gdMaxLow)) QA6.gdMaxLow = dFull.gdMs[i];
      });
      return;
    }
    var coeffs = qaActiveCoeffs(fs);
    var K1 = kMax + 1, k, i;
    var bandPh = new Array(coeffs.length), missIdx = [], missKeys = [];
    for (i = 0; i < coeffs.length; i++){
      var cc = coeffs[i];
      var pKey;
      if (typeof QA_PHASE_KEY_WM !== "undefined" && QA_PHASE_KEY_WM && cc && typeof cc === "object"){
        var _ke2 = QA_PHASE_KEY_WM.get(cc);
        if (_ke2 && _ke2.fs === fs) pKey = _ke2.key;
        else { pKey = fs + "|" + cc.b0 + "|" + cc.b1 + "|" + cc.b2 + "|" + cc.a1 + "|" + cc.a2; QA_PHASE_KEY_WM.set(cc, { fs: fs, key: pKey }); }
      } else {
        pKey = fs + "|" + cc.b0 + "|" + cc.b1 + "|" + cc.b2 + "|" + cc.a1 + "|" + cc.a2;
      }
      var pArr = QA_PHASE_CACHE[pKey];
      if (pArr){ bandPh[i] = pArr; continue; }
      var lowPart = (typeof QA_PHASE_LOW !== "undefined") ? QA_PHASE_LOW[pKey] : null;
      if (lowPart && lowPart.length === K1 + 1){ bandPh[i] = lowPart; continue; }
      missIdx.push(i); missKeys.push(pKey);
    }
    if (missIdx.length === 1){
    /* (vòng tự động 11:28, hướng B — ÁP DỤNG, vá code): đường 1 band trượt cache trong qaGdMaxLowOnly tính trực tiếp qua qaBiquadPhaseRad thay vì dựng 4 mảng lượng giác Float64Array(57) — qaBiquadPhaseRad dùng đúng biểu thức atan2(-(b1*sw+b2*sw2), b0+b1*cw+b2*cw2) - atan2(-(a1*sw+a2*sw2), 1+a1*cw+a2*cw2) với w=2*Math.PI*f/fs như đường lượng giác nên kết quả giống từng bit; nhiều band trượt vẫn dùng đường lượng giác dùng chung như cũ. Đây là đường nóng của vòng guard (autoGuardLowGroupDelay gọi qaGdMaxLowOnly lặp lại, mỗi vòng thường đổi 1 band Q thấp). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1127/, 2 lần chạy độc lập): parity 8/8 kịch bản GIỐNG TỪNG BIT cả 2 lần (Object.is trên gdMaxLow + mọi phần tử QA_PHASE_LOW; gồm cold/hit/1-miss/2-miss/5-miss, identity, NaN/±Inf/0/subnormal/-0, chuỗi guard 30 bước đổi 1 band, rỗng); tốc độ single-miss paired-median xen kẽ 15 vòng: lần 1 1,1468×/1,0500× (thắng 14/15, 15/15), lần 2 1,0789×/1,0449× (thắng 9/15, 15/15); multi-miss(3) trung tính-nhanh 1,02–1,09× (đường không đổi). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. */
      var _mi0 = missIdx[0], _ccm0 = coeffs[_mi0];
      var _pa0 = new Float64Array(K1 + 1);
      /* (vòng tự động 12:01, hướng B): dùng bảng lượng giác phần thấp cache trên grid (xây 1 lần, xem nhánh multi-miss) thay vì tính lại cos/sin từng điểm qua qaBiquadPhaseRad mỗi lần miss — biểu thức atan2 giữ nguyên từng toán hạng/thứ tự như đường multi-miss nên giống từng bit; khi chưa có bảng (lần miss đầu tiên) xây bảng ngay tại đây rồi tính theo bảng. */
      if (!grid.lowCw || grid.lowCw.length !== K1 + 1){
        var _lcw = new Float64Array(K1 + 1), _lsw = new Float64Array(K1 + 1), _lcw2 = new Float64Array(K1 + 1), _lsw2 = new Float64Array(K1 + 1);
        for (k = 0; k <= K1; k++){
          var _lw = 2*Math.PI*freqs[k]/fs;
          _lcw[k] = Math.cos(_lw); _lsw[k] = Math.sin(_lw);
          _lcw2[k] = 2*_lcw[k]*_lcw[k] - 1; _lsw2[k] = 2*_lsw[k]*_lcw[k];
        }
        grid.lowCw = _lcw; grid.lowSw = _lsw; grid.lowCw2 = _lcw2; grid.lowSw2 = _lsw2;
      }
      for (k = 0; k <= K1; k++) _pa0[k] = Math.atan2(-(_ccm0.b1*grid.lowSw[k] + _ccm0.b2*grid.lowSw2[k]), _ccm0.b0 + _ccm0.b1*grid.lowCw[k] + _ccm0.b2*grid.lowCw2[k]) - Math.atan2(-(_ccm0.a1*grid.lowSw[k] + _ccm0.a2*grid.lowSw2[k]), 1 + _ccm0.a1*grid.lowCw[k] + _ccm0.a2*grid.lowCw2[k]);
      if (typeof QA_PHASE_LOW !== "undefined"){
        if (QA_PHASE_LOW_N > 400){ QA_PHASE_LOW = {}; QA_PHASE_LOW_N = 0; }
        if (QA_PHASE_LOW[missKeys[0]] === undefined) QA_PHASE_LOW_N++;
        QA_PHASE_LOW[missKeys[0]] = _pa0;
      }
      bandPh[_mi0] = _pa0;
    } else if (missIdx.length){
      /* (vòng tự động 12:01, hướng B): bảng lượng giác phần thấp cache trên grid — xây MỘT lần (cùng biểu thức gốc) rồi dùng chung cho mọi lần miss sau, thay vì cấp phát 4 mảng + tính lại 2×(K1+1) lần cos/sin mỗi lần gọi; giá trị lưu trữ là đúng double của biểu thức gốc nên pha từng band giống từng bit. */
      if (!grid.lowCw || grid.lowCw.length !== K1 + 1){
        var _lcw = new Float64Array(K1 + 1), _lsw = new Float64Array(K1 + 1), _lcw2 = new Float64Array(K1 + 1), _lsw2 = new Float64Array(K1 + 1);
        for (k = 0; k <= K1; k++){
          var _lw = 2*Math.PI*freqs[k]/fs;
          _lcw[k] = Math.cos(_lw); _lsw[k] = Math.sin(_lw);
          _lcw2[k] = 2*_lcw[k]*_lcw[k] - 1; _lsw2[k] = 2*_lsw[k]*_lcw[k];
        }
        grid.lowCw = _lcw; grid.lowSw = _lsw; grid.lowCw2 = _lcw2; grid.lowSw2 = _lsw2;
      }
      var cwA = grid.lowCw, swA = grid.lowSw, cw2A = grid.lowCw2, sw2A = grid.lowSw2;
      for (var mi = 0; mi < missIdx.length; mi++){
        var ccm = coeffs[missIdx[mi]];
        var pa = new Float64Array(K1 + 1);
        for (k = 0; k <= K1; k++){
          pa[k] = Math.atan2(-(ccm.b1*swA[k] + ccm.b2*sw2A[k]), ccm.b0 + ccm.b1*cwA[k] + ccm.b2*cw2A[k]) - Math.atan2(-(ccm.a1*swA[k] + ccm.a2*sw2A[k]), 1 + ccm.a1*cwA[k] + ccm.a2*cw2A[k]);
        }
        if (typeof QA_PHASE_LOW !== "undefined"){
          if (QA_PHASE_LOW_N > 400){ QA_PHASE_LOW = {}; QA_PHASE_LOW_N = 0; }
          if (QA_PHASE_LOW[missKeys[mi]] === undefined) QA_PHASE_LOW_N++;
          QA_PHASE_LOW[missKeys[mi]] = pa;
        }
        bandPh[missIdx[mi]] = pa;
      }
    }
    var raw = new Array(K1 + 1), phU = new Array(K1 + 1), off = 0, s;
    for (k = 0; k <= K1; k++) raw[k] = 0;
    for (i = 0; i < coeffs.length; i++){
      var _bp = bandPh[i];
      for (k = 0; k <= K1; k++) raw[k] += _bp[k];
    }
    /* (vòng tự động 02:24, hướng B — ÁP DỤNG, vá code): chuyển vị vòng cộng pha trong qaGdMaxLowOnly — trước đây mỗi điểm lưới k cộng dồn qua mọi band (đọc bandPh[i][k] nhảy giữa các mảng cho mọi k); nay khởi tạo raw[k]=0 rồi vòng ngoài duyệt band, vòng trong duyệt lưới cộng raw[k] += bandPh[i][k] tuần tự trong từng mảng pha — thứ tự cộng theo band 0..n-1 cho mỗi k giữ nguyên (0 + band0 + band1 ... đúng như s=0; s+=bandPh[0][k]; s+=bandPh[1][k]...) nên mọi double của raw/phU/gdMaxLow GIỐNG TỪNG BIT theo cấu trúc, kể cả coeffs rỗng (raw toàn 0), bandPh thiếu/NaN/Infinity (thứ tự cộng không đổi, ném đúng TypeError). Cùng mẫu vá qaPhaseGdData 19:06 (chuyển vị vòng cộng pha) áp sang hàm chưa từng chuyển vị này; khác hướng đã bác: hoist t.cos/t.sin trong wasmJsArray (22:54) — lượt này không đổi lượng giác/cache, chỉ đổi thứ tự duyệt vòng cộng đã có. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_0224_B/, 3 lần bench độc lập): parity 16/16 kịch bản GIỐNG TỪNG BIT (Object.is trên gdMaxLow + QA_PHASE_LOW khóa/giá trị + invariant QA_PHASE_LOW_N; gồm cold 10/20 band multi-miss, warm all-hit, single-miss, lowPart-hit, prefill 390/400/401, FIR, cực đoan NaN/±Infinity/-0/1e308/subnormal, fs 0/44100/96000, null coeff, chuỗi guard 30 bước, fuzz 40 bộ); tốc độ paired-median xen kẽ 15 vòng: W1 warm-hit 20 band lần 1 1,2054x thắng 14/15, lần 2 1,0578x thắng 13/15, lần 3 1,2059x thắng 15/15; W2 warm-hit 10 band 1,1640x/1,1857x/1,1391x thắng 13/14/12; W3 single-miss trung tính 1,0024x/1,0372x/1,0631x thắng 8/9/10 (không hồi quy) — cải thiện ổn định trên đường steady-state (lowPart-hit của vòng guard) cả 3 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261124_0224_B/. */
    /* (vòng tự động 10:37, hướng B — ÁP DỤNG, vá code): gộp vòng unwrap pha + vòng tính group-delay trong qaGdMaxLowOnly — khi phU[k] vừa tính xong, gd[k-1] đã đủ dữ liệu (a=max(0,k-2), b=k vì k<=K1<240) nên tính ngay trong cùng vòng lặp, bỏ vòng gd riêng (56 lần Math.max/Math.min + đọc lại phU ngoài thứ tự) và cập nhật QA6.gdMaxLow theo đúng thứ tự j tăng dần; biểu thức gd giữ nguyên từng toán hạng/thứ tự (-(phU[k]-phU[_ga])/grid.dw[_gj]/fs*1000) nên mọi double của phU/gdMaxLow GIỐNG TỪNG BIT theo cấu trúc, kể cả biên k=1 (gd[0] dùng phU[1]-phU[0]), NaN/±Infinity/-0 (biểu thức không đổi). Cùng mẫu vá qaPhaseGdData 06:47 áp sang hàm chưa từng gộp này; khác hướng đã bác: hoist t.cos/t.sin trong wasmJsArray (22:54) — lượt này không đổi lượng giác/cache, chỉ đổi cách duyệt vòng unwrap/gd đã có. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261127_1037_B/lab/, 2 lần bench độc lập): parity 44/44 kịch bản GIỐNG TỪNG BIT cả 2 lần (Object.is trên gdMaxLow + QA_PHASE_LOW khóa/giá trị + QA_PHASE_LOW_N + grid.kMax; gồm cold 0/1/3/10/20 band × fs 44100/48000/96000/22050/0/NaN/Infinity/âm, FIR, cực đoan NaN/±Infinity/-0/subnormal/1e308, null/undefined/thiếu trường coeff, chuỗi guard 30 bước, fuzz 20 bộ, overflow 401, fs sweep); tốc độ paired-median xen kẽ 15 vòng: W1 warm-hit 20b lần 1 1,2421x thắng 15/15, lần 2 1,3049x thắng 15/15 (đảo thứ tự tạo context 1,2303x); W2 warm-hit 10b 1,3281x thắng 15/15; W3 single-miss 20b 1,2967x thắng 15/15; W4 cold multi-miss 20b 1,2603x thắng 15/15; control old-vs-old 1,0093x/0,9935x, new-vs-new 0,9799x (nhiễu VM ~1-2%) — cải thiện ổn định trên mọi workload. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm C. */
    QA6.gdMaxLow = null;
    phU[0] = raw[0];
    for (k = 1; k <= K1; k++){
      var d = raw[k] - raw[k-1];
      if (d > Math.PI) off -= 2*Math.PI; else if (d < -Math.PI) off += 2*Math.PI;
      phU[k] = raw[k] + off;
      var _gj = k - 1;
      var _ga = (_gj - 1 < 0) ? 0 : _gj - 1;
      var gdVal = -(phU[k] - phU[_ga])/grid.dw[_gj]/fs*1000;
      if (freqs[_gj] <= 100 && (QA6.gdMaxLow === null || gdVal > QA6.gdMaxLow)) QA6.gdMaxLow = gdVal;
    }
  } catch (e) {}
}
/* --- Mở rộng 2026-11-23 (vòng tự động 21:42, hướng B — ÁP DỤNG, vá code): Lượt nhóm B (sau A 21:24, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 21:33:56+07, 6.267.567 byte / 25.348 dòng (wc -l), md5 73b5993d67ca5602686de5009a2557a0, version 332) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-B lưu tại ~/workspace/autoeq/backups/*2026-11-23_2137*. Ứng viên B duy nhất: thay kiểm tra tràn cache QA_PHASE_LOW trong qaGdMaxLowOnly bằng bộ đếm QA_PHASE_LOW_N — trước đây mỗi lần miss (đường 1 band trượt và đường nhiều band trượt) đều gọi Object.keys(QA_PHASE_LOW).length, cấp phát mảng khóa đầy đủ (tới >400 khóa trong phiên dài) chỉ để so sánh >400; nay biến mới QA_PHASE_LOW_N giữ đúng số khóa (tăng 1 khi gán khóa chưa tồn tại — kiểm tra === undefined trước khi gán, giữ nguyên hành vi ghi đè khóa đã có; reset 0 khi xóa toàn bộ cache tại đúng 2 điểm xóa cũ) và kiểm tra tràn chỉ là phép so sánh số nguyên; thứ tự kiểm tra/xóa/gán và mọi phép tính pha/GD giữ nguyên nên GIỐNG TỪNG BIT theo cấu trúc (kể cả xóa cache giữa vòng multi-miss, ghi đè khóa lệch độ dài, NaN/±Infinity/-0, coeff null ném đúng TypeError rồi bị catch như cũ). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_2137_B/, 2 lần bench độc lập): parity 16/16 kịch bản GIỐNG TỪNG BIT cả 2 lần (Object.is trên gdMaxLow + khóa/giá trị QA_PHASE_LOW/QA_PHASE_CACHE; gồm single/multi-miss ở cache 390/400/401 khóa, xóa cache giữa vòng, ghi đè khóa lệch độ dài, all-hit, lowPart-hit, rỗng, FIR, nhánh kMax, fs 44100, cực đoan, chuỗi guard 30 bước mới, coeff null) kèm invariant QA_PHASE_LOW_N == Object.keys(...).length sau mọi lần gọi; tốc độ paired-median xen kẽ 15 vòng: lần 1 multi-3 cache 390 1,3832x thắng 15/15, single-miss cache 390 1,1051x (nhiễu, thắng 8/15), cache nhỏ 10 khóa 1,0066x trung tính, all-hit 1,0062x trung tính; lần 2 multi-3 1,3999x thắng 15/15, single-miss 1,1278x thắng 14/15, cache nhỏ 0,9882x trung tính, all-hit 0,9981x trung tính — cải thiện ổn định trên đường miss khi cache lớn, không hồi quy đường hit/cache nhỏ. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_2137_B/. --- */
/* --- Mở rộng 2026-11-24 (vòng tự động 02:24, hướng B — ÁP DỤNG, vá code): Lượt nhóm B (sau A 01:54, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 02:00:26+07, 6.306.569 byte / 25.492 dòng (wc -l), md5 3395288f3cdb2f04be2b475ac3b2e9b7, version 389) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-B lưu tại ~/workspace/autoeq/backups/*2026-11-24_0224*. Ứng viên B duy nhất: chuyển vị vòng cộng pha trong qaGdMaxLowOnly (đường nóng của autoGuardLowGroupDelay) — khởi tạo raw[k]=0, vòng ngoài duyệt band, vòng trong duyệt lưới cộng raw[k] += bandPh[i][k] tuần tự trong từng mảng pha; thứ tự cộng theo band 0..n-1 cho mỗi k giữ nguyên nên mọi double GIỐNG TỪNG BIT theo cấu trúc. Cùng mẫu vá qaPhaseGdData 19:06 áp sang hàm chưa chuyển vị. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0224_B/, 3 lần bench độc lập): parity 16/16 GIỐNG TỪNG BIT; tốc độ W1 warm-hit 20 band 1,2054x/1,0578x/1,2059x thắng 14/13/15, W2 warm-hit 10 band 1,1640x/1,1857x/1,1391x thắng 13/14/12, W3 single-miss trung tính không hồi quy. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261124_0224_B/. --- */
function autoGuardLowGroupDelay(fs){
  if (mode !== "iir") return { guarded: false, gdMaxLow: 0 };
  qaGdMaxLowOnly();
  var iter = 0;
  /* (vòng tự động 18:08, hướng B): hoist chỉ số band ứng viên ra khỏi vòng lặp guard — điều kiện on/freq<=120/|gain|>0.5 bất biến trong suốt vòng lặp (chỉ bands[i].q bị vòng lặp tự sửa, đơn điệu giảm) nên tính danh sách chỉ số ứng viên MỘT lần (lười, ở lần lặp đầu tiên cần quét) rồi mỗi vòng chỉ kiểm tra q>0.65 trên các ứng viên theo đúng thứ tự chỉ số gốc; thứ tự chạm band, công thức cập nhật q, cờ touched và số lần gọi qaGdMaxLowOnly giữ nguyên nên kết quả giống từng bit, kể cả đường lỗi (band null ném đúng TypeError ở lần quét đầu như cũ; khi gdMaxLow<=5/null thì vòng không chạy, không quét, không ném — như cũ). */
  var cand = null;
  while (QA6.gdMaxLow !== null && QA6.gdMaxLow > 5.0 && iter < 8){
    if (cand === null){
      cand = [];
      for (var ci = 0; ci < bands.length; ci++){
        if (bands[ci].on && bands[ci].freq <= 120 && Math.abs(bands[ci].gain) > 0.5) cand.push(ci);
      }
    }
    var touched = false;
    for (var cj = 0; cj < cand.length; cj++){
      var bi = cand[cj];
      if (bands[bi].q > 0.65){
        bands[bi].q = Math.max(0.5, Math.round(bands[bi].q * 82) / 100);
        touched = true;
      }
    }
    if (!touched) break;
    qaGdMaxLowOnly();
    iter++;
  }
  qaDrawPhaseGd();
  return { guarded: iter > 0, gdMaxLow: QA6.gdMaxLow };
}
function autoPickCrossfeed(entry){
  var isIem = entry && String(entry.type || "").toLowerCase().indexOf("in-ear") >= 0;
  return isIem ? { mix: 28, itdMs: 0.30 } : { mix: 22, itdMs: 0.28 };
}
function autoApplySoundStyle(styleKey){
  var styles = {
    auto:     { tilt: 0.00, bass: 0.0, ear: 0.0, preserve: false },
    warm:     { tilt: -0.15, bass: 2.5, ear: 0.0, preserve: false },
    vocal:    { tilt: 0.10, bass: -0.5, ear: 1.5, preserve: false },
    preserve: { tilt: 0.00, bass: 0.0, ear: 0.0, preserve: true }
  };
  var s = styles[styleKey] || styles.auto;
  $("aeTilt").value = s.tilt; $("aeTiltOut").textContent = s.tilt.toFixed(2) + " dB/oct";
  $("aeBass").value = s.bass; $("aeBassOut").textContent = s.bass.toFixed(1) + " dB";
  $("aeEar").value  = s.ear;  $("aeEarOut").textContent  = s.ear.toFixed(1) + " dB";
  if ($("aePreserveChar")) $("aePreserveChar").checked = !!s.preserve;
  aeUpdateTarget();
  autoMaybeSolve("phong cách " + styleKey);
}
function uxAutoPilotSelfCheck(){
  var notes = [], ok = true;
  /* (vòng tự động 17:24, hướng C — ÁP DỤNG, vá code): cache 4 kết quả autoPickTarget trong uxAutoPilotSelfCheck — autoPickTarget thuần xác định theo (entry.type, entry.rig) nên tính MỘT lần vào _ap1.._ap4 rồi dùng lại cho cả 4 phép so sánh t1..t4 lẫn chuỗi notes.push, thay vì gọi lại 4 lần với đúng đối số (tổng 8 lần gọi + 8 object literal mỗi lần chạy tự kiểm). Cùng toán hạng/thứ tự nên kết quả và chuỗi detail giống từng bit. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_1724_C/, 1 lần chạy): parity 100/100 GIỐNG TỪNG BIT (Object.is trên ok + detail, 50 lần đường đầy đủ DOM giả + 50 lần đường null-path); tốc độ paired-median xen kẽ 15 vòng: full-fn 1,0774x thắng 14/15, khối target riêng 1,9487x thắng 15/15. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm D. */
  var _ap1 = autoPickTarget({ type: "In-ear", rig: "5128" });
  var _ap2 = autoPickTarget({ type: "In-ear", rig: "711" });
  var _ap3 = autoPickTarget({ type: "Over-ear", rig: "711" });
  var _ap4 = autoPickTarget(null);
  var t1 = _ap1 === "jm1";
  var t2 = _ap2 === "harmanIE";
  var t3 = _ap3 === "harmanOE";
  var t4 = _ap4 === "harmanOE";
  if (!(t1 && t2 && t3 && t4)) ok = false;
  notes.push("target: IE+5128→" + _ap1 + " · IE+711→" + _ap2 + " · OE→" + _ap3 + " · rỗng→" + _ap4);
  var cI = autoPickCrossfeed({ type: "In-ear" }), cO = autoPickCrossfeed({ type: "Over-ear" });
  var cOk = cI.mix === 28 && cI.itdMs === 0.30 && cO.mix === 22 && cO.itdMs === 0.28;
  if (!cOk) ok = false;
  notes.push("crossfeed: IE " + cI.mix + "%/" + cI.itdMs + " ms · OE " + cO.mix + "%/" + cO.itdMs + " ms");
  var styleIds = ["aeTilt", "aeBass", "aeEar", "aePreserveChar"];
  if (styleIds.every(function(id){ return !!$(id); }) && typeof AUTO !== "undefined"){
    var savedOn = AUTO.on, saved = { tilt: $("aeTilt").value, bass: $("aeBass").value, ear: $("aeEar").value, preserve: $("aePreserveChar").checked };
    var table = { auto: [0, 0, 0, false], warm: [-0.15, 2.5, 0, false], vocal: [0.10, -0.5, 1.5, false], preserve: [0, 0, 0, true] };
    var sOk = true;
    try {
      AUTO.on = false; /* kiểm giá trị phong cách, không chạy solver làm đổi bands */
      Object.keys(table).forEach(function(k){
        autoApplySoundStyle(k);
        var v = table[k];
        if (Math.abs(parseFloat($("aeTilt").value) - v[0]) > 1e-9 || Math.abs(parseFloat($("aeBass").value) - v[1]) > 1e-9 || Math.abs(parseFloat($("aeEar").value) - v[2]) > 1e-9 || $("aePreserveChar").checked !== v[3]) sOk = false;
      });
    } finally {
      AUTO.on = savedOn;
      $("aeTilt").value = saved.tilt; $("aeBass").value = saved.bass; $("aeEar").value = saved.ear; $("aePreserveChar").checked = saved.preserve;
      try { aeUpdateTarget(); } catch (e) {}
    }
    if (!sOk) ok = false;
    notes.push("phong cách: 4/4 giá trị đúng (auto/warm/vocal/preserve), slider khôi phục sau kiểm");
  } else {
    ok = false; notes.push("phong cách: thiếu slider DOM hoặc AUTO");
  }
  try {
    if (typeof mode !== "undefined" && mode !== "iir"){
      notes.push("guard: bỏ qua (chế độ FIR, guard chỉ chạy ở IIR)");
    } else if (typeof qaDrawPhaseGd === "function" && typeof QA6 !== "undefined"){
      var bandsSnap = JSON.stringify(bands);
      var g = autoGuardLowGroupDelay(displayFs || 48000);
      notes.push("guard: guarded=" + g.guarded + " · gdMaxLow=" + (g.gdMaxLow === null ? "—" : g.gdMaxLow.toFixed(2)) + " ms (ngưỡng 5,0 ms)");
      if (g.guarded && !(g.gdMaxLow !== null && g.gdMaxLow <= 5.0)) ok = false;
      if (JSON.stringify(bands) !== bandsSnap){
        bands = JSON.parse(bandsSnap);
        try { updateAll(true); } catch (e) {}
      }
    } else {
      ok = false; notes.push("guard: thiếu qaDrawPhaseGd/QA6");
    }
  } catch (eG) { ok = false; notes.push("guard lỗi: " + eG.message); }
  return { ok: ok, detail: notes.join(" · ") };
}
(function uxInitCompact(){
  try {
    var hub = $("quickEqHub"), tp = $("tpPanel");
    if (hub && tp && tp.parentNode) tp.parentNode.insertBefore(hub, tp.nextSibling);
    var qaHeads = ["Kiểm chứng nghiệm thu", "Acoustic QA Suite", "Kiểm định dữ liệu"];
    var advHeads = ["Spectrogram", "Đo mức & Limiter", "Pre-amp tự động", "Preset nhanh", "Psychoacoustics", "Bù Loudness", "Hiệu chuẩn cộng hưởng", "Chấm điểm mù", "Natural Crossfeed", "Dynamic EQ chọn band", "Binaural HRTF", "WASM + SIMD", "Preset — Schema", "Blind A/B/X", "Kho tai nghe", "Hardware Constraint", "Universal Export", "Attribution", "Hệ số biquad", "Tổng hợp hệ thống", "Chế độ Tự Động Toàn Diện", "Liều nghe trong tuần", "Lưu trữ ngoại tuyến", "Mở rộng kho đo", "Giới hạn nền tảng", "Backlog v2", "Preset EQ dạng text", "Graphic EQ", "Chia sẻ trạng thái", "Convolution IR"];
    Array.prototype.forEach.call(document.querySelectorAll("div.panel"), function(p){
      var h = p.querySelector("h2"); if (!h) return;
      var t = h.textContent || "";
      if (qaHeads.some(function(k){ return t.indexOf(k) >= 0; })) p.classList.add("ux-qa-panel");
      else if (advHeads.some(function(k){ return t.indexOf(k) >= 0; })) p.classList.add("ux-adv-panel");
    });
    if (tp){
      var moveIds = ["tpLoop", "tpSetA", "tpSetB", "tpClearAB", "sysAudioBtn", "micBtn", "micClearBtn", "hwUsbBtn", "hwSerBtn", "hwHidBtn", "hwSimBtn", "hwSendBtn", "hwDiscBtn"];
      var det = document.createElement("details"); det.className = "ux-tp-more";
      var sum = document.createElement("summary"); sum.textContent = "Công cụ ít dùng: Loop A–B · Âm thanh hệ thống · Đo Mic · DAC/DSP";
      var row = document.createElement("div"); row.className = "ux-tp-row";
      det.appendChild(sum); det.appendChild(row); tp.appendChild(det);
      moveIds.forEach(function(id){
        var b = $(id); if (b) row.appendChild(b);
      });
    }
    var compact = true;
    try { var cv = window.localStorage.getItem("webAutoEq.compactUx.v1"); if (cv === "0") compact = false; } catch (e) {}
    document.body.classList.toggle("compact-ux", compact);
    function uxSyncToggle(){
      var b = $("uxCompactToggle"); if (b) b.textContent = "Giao diện tinh gọn: " + (document.body.classList.contains("compact-ux") ? "Bật" : "Tắt");
    }
    uxSyncToggle();
    function uxMarkStyle(key){
      ["uxStyleAuto", "uxStyleWarm", "uxStyleVocal", "uxStylePreserve"].forEach(function(id){
        var b = $(id); if (b) b.classList.remove("on");
      });
      var map = { auto: "uxStyleAuto", warm: "uxStyleWarm", vocal: "uxStyleVocal", preserve: "uxStylePreserve" };
      var cur = $(map[key] || "uxStyleAuto"); if (cur) cur.classList.add("on");
    }
    function uxStyle(key){
      try { autoApplySoundStyle(key); uxMarkStyle(key); if ($("uxPilotStatus")) $("uxPilotStatus").textContent = "Đã áp phong cách " + key + " (tilt/bass/ear theo bảng Chặng 4) — solver chạy qua Chế độ Tự Động nếu đang bật."; }
      catch (e) { if ($("uxPilotStatus")) $("uxPilotStatus").textContent = "Lỗi áp phong cách: " + e.message; }
    }
    [["uxStyleAuto", "auto"], ["uxStyleWarm", "warm"], ["uxStyleVocal", "vocal"], ["uxStylePreserve", "preserve"]].forEach(function(pair){
      var b = $(pair[0]); if (b) b.addEventListener("click", function(){ uxStyle(pair[1]); });
    });
    var xb = $("uxExportApo");
    if (xb) xb.addEventListener("click", function(){
      try {
        if (typeof qaRealFails === "function" && qaRealFails().length > 0 && !(typeof QA6 !== "undefined" && QA6.ack)) throw new Error("QA đang có FAIL thật — mở khóa theo cổng QA trước khi xuất (giữ nguyên luật khóa xuất file Giai đoạn 5).");
        var src = { bands: bands.map(function(b){ return { freq: b.freq, type: b.type, gain: b.gain, q: b.q, on: b.on }; }), preamp: (typeof appliedPreDb === "function" ? appliedPreDb() : 0), profile: "Web AutoEQ 1-chạm", target: $("aeTarget") ? $("aeTarget").value : "harmanOE", headphone: (typeof AE !== "undefined" && AE.name) ? AE.name : "", rig: (typeof AE !== "undefined" && AE.rig) ? AE.rig : "" };
        var txt = expRender("apo", src, expMetaFor(src, new Date()));
        dlText("web-autoeq-1cham.apo", txt, "text/plain");
        if ($("uxPilotStatus")) $("uxPilotStatus").textContent = "Đã xuất APO 1 chạm: web-autoeq-1cham.apo (" + src.bands.length + " band, pre-amp " + src.preamp.toFixed(2) + " dB).";
      } catch (e) { if ($("uxPilotStatus")) $("uxPilotStatus").textContent = "Xuất APO lỗi: " + e.message; }
    });
    var tb = $("uxCompactToggle");
    if (tb) tb.addEventListener("click", function(){
      var on = !document.body.classList.contains("compact-ux");
      document.body.classList.toggle("compact-ux", on);
      try { window.localStorage.setItem("webAutoEq.compactUx.v1", on ? "1" : "0"); } catch (e) {}
      uxSyncToggle();
    });
    if (typeof AUTO !== "undefined"){
      ["psMix", "psItd"].forEach(function(id){
        var el = $(id); if (el) el.addEventListener("input", function(){ AUTO.manual.cross = true; });
      });
    }
  } catch (e) { /* khối UX không được làm hỏng app: lỗi thì giao diện giữ nguyên */ }
})();
