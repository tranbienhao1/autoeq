/* Web AutoEQ split module: 07-database.js (nguon: khoi script L16890 cua ban 1 file) */

"use strict";
/* ================================================================
   Web AutoEQ — Giai đoạn 5: Database & Universal Export
   - Parser đo hợp nhất: AutoEQ CSV · Squig.link CSV · REW TXT
     -> Measurement { headphone, rig, source, attribution, points }
   - Kho dữ liệu đo THẬT từ AutoEq (data:application/javascript;base64,[DA XOA BAN SAO BASE64 TRUNG LAP TRONG CHU THICH DE GIAM DUNG LUONG FILE - DU LIEU THAT NAM O THE SCRIPT DATA: O TREN]) + kiểm định lúc nạp + fuzzy search
   - Hardware Constraint Solver: chạy LẠI bộ tối ưu Giai đoạn 2 theo
     ràng buộc profile thiết bị (không cắt cụt band), báo delta RMS
   - Exporters: APO/Peace, SoundSource, Wavelet, Poweramp, JamesDSP DDC,
     Convolution IR WAV 32-bit float (Minimum-Phase & Linear-Phase)
   Phụ thuộc toàn bộ API các giai đoạn 1-4 (bands, AE, aeSolve...).
   ================================================================ */
var APP5_NAME = "Web AutoEQ — Giai đoạn 5/6 (Database & Universal Export)";

function dlText(name, text, mime){
  var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function dlBlob(name, blob){
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function dbNormStr(s){
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}
function expSlug(s){ var r = dbNormStr(s).replace(/ /g, "-").slice(0, 42); return r || "web-autoeq-preset"; }
function dbBandDb(bandList, f, fs){
  var s = 0;
  for (var i = 0; i < bandList.length; i++){
    var b = bandList[i];
    if (b.on === false) continue;
    s += biquadMagDb(rbjCoeffs(b.type, b.freq, b.gain, b.q, fs), f, fs);
  }
  return s;
}
/* (vòng tự động 07:15, hướng B — H6): hoist rbjCoeffs ra khỏi 4 vòng xuất — hệ số chỉ phụ thuộc (type,freq,gain,q,fs) nên dbBandCoeffs tính MỘT lần/bandList rồi dbBandDbC dùng lại biquadMagDb cho mọi tần số; điều kiện bỏ qua đúng biểu thức của dbBandDb (b.on === false); thứ tự cộng i=0..n-1 không đổi nên giống từng bit. Dùng ở: JamesDSP (jdCc), irBuild (irCc), p5IrMaxErr (p5Cc), qaFirTapsFor (qaCc). dbBandDb giữ nguyên. */
function dbBandCoeffs(bandList, fs){
  var cc = [];
  for (var i = 0; i < bandList.length; i++){
    var b = bandList[i];
    if (b.on === false) continue;
    cc.push(rbjCoeffs(b.type, b.freq, b.gain, b.q, fs));
  }
  return cc;
}
function dbBandDbC(cc, f, fs){
  var s = 0;
  for (var i = 0; i < cc.length; i++) s += biquadMagDb(cc[i], f, fs);
  return s;
}
/* (vòng tự động 17:58, hướng B — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên hoist lượng giác (cw/sw/cw2/sw2) ra khỏi vòng band trong dbBandDbC — trước đây mỗi band gọi biquadMagDb(cc[i], f, fs) tính lại cos/sin cho cùng (f, fs), nay tính MỘT lần (lười ở band đầu tiên) rồi dùng lại, biểu thức nr/ni/dr/di và phép log giữ nguyên từng toán hạng như biquadMagDb nên giống từng bit theo cấu trúc; biến thể tính lượng giác vô điều kiện trước vòng cũng đã thử. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench_sep.js/bench_sep2.js/bench_sep3.js trong hidden_files/run_20261123_1757_B/, 2 lần chạy độc lập + bench tách process): parity 6.198/6.198 GIỐNG TỪNG BIT cả 2 lần (Object.is; gồm 7 kích thước mảng × 3 loại hệ số × 21 tần số × 9 fs, biên 0/âm/NaN/±Infinity/subnormal, cc null/undefined/sparse/phần tử null ném đúng TypeError, lặp lại 50 lần, lưới 2049 điểm); tốc độ bench tách process: 10 band × lưới 241 điểm 3 lần old 180,0/171,7/199,5 ms vs new 178,0/177,0/176,8 ms (~1,00×, trong nhiễu); single-freq 20 band old 430–791 ns/call vs new 435–1096 ns/call, biến thể vô điều kiện 477–505 ns/call — không cải thiện ổn định ở mọi workload (trig rẻ so với log + truy cập thuộc tính, V8 đã tối ưu đường gọi) → BÁC, không vá code. KHÔNG thử lại hướng hoist lượng giác trong dbBandDbC. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_1757_B/. */

/* ================================================================
   5.1 — PARSER HỢP NHẤT 3 ĐỊNH DẠNG
   Chịu được: delimiter phẩy / chấm phẩy / tab / khoảng trắng, số thập
   phân kiểu châu Âu (khi delimiter là ; hoặc tab), header chữ, dòng
   comment * # ;, cột thứ 3 (phase của REW). Dòng bắt đầu bằng số mà
   đọc không được -> lỗi kèm số dòng, không bỏ qua âm thầm.
   ================================================================ */
var DB_FMTLBL = { rew:"REW TXT", squiglink:"Squig.link CSV", autoeq:"AutoEQ CSV", generic:"CSV/TXT 2 cột (freq, SPL)" };
var DB_FMTATTR = {
  rew:"Định dạng xuất của REW (Room EQ Wizard) — file do người dùng cung cấp, attribution thuộc về người đo.",
  squiglink:"Định dạng CSV của Squig.link — file do người dùng cung cấp, attribution thuộc về người đo trên Squig.link.",
  autoeq:"Định dạng CSV kiểu AutoEQ (Frequency, Raw) — file do người dùng cung cấp, attribution thuộc về người đo.",
  generic:"File đo 2 cột freq/SPL do người dùng cung cấp, attribution thuộc về người đo."
};
function dbParseMeasurement(text, filename){
  var lines = String(text == null ? "" : text).split(/\r?\n/);
  var pts = [], bad = [], skipped = 0;
  var sawStar = false, headerKind = null, nameGuess = null, headText = [];
  for (var li = 0; li < lines.length; li++){
    var raw = lines[li].trim();
    if (!raw) continue;
    if (li < 60) headText.push(raw);
    var first = raw.charAt(0);
    if (first === "*" || first === "#" || first === ";"){
      skipped++;
      if (first === "*") sawStar = true;
      var mm = raw.match(/(?:measurement|headphone|model|name)\s*:\s*(.+)$/i);
      if (mm && !nameGuess && !/exported|data/i.test(mm[1])) nameGuess = mm[1].trim();
      continue;
    }
    var delim = raw.indexOf("\t") >= 0 ? "\t" : (raw.indexOf(";") >= 0 ? ";" : (raw.indexOf(",") >= 0 ? "," : " "));
    var toks = (delim === " " ? raw.split(/\s+/) : raw.split(delim)).map(function(t){ return t.replace(/^"+|"+$/g, "").trim(); }).filter(function(t){ return t.length > 0; });
    function isMalformedNumericToken(t){
      return /^[+-]?(?:nan|inf(?:inity)?)$/i.test(t) || /^[+-]?(?:\d|\.\d)/.test(t);
    }
    if (toks.length < 2){ if (toks.length === 1 && isMalformedNumericToken(toks[0])) bad.push(li + 1); else skipped++; continue; }
    function num(t){
      if ((delim === ";" || delim === "\t" || delim === " ") && /^[+-]?\d+,\d+(?:[eE][+-]?\d+)?$/.test(t)) t = t.replace(",", ".");
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return NaN;
      return Number(t);
    }
    var f = num(toks[0]), v = num(toks[1]);
    if (isFinite(f) && isFinite(v)){
      if (f >= 10 && f <= 24000 && v > -100 && v < 200){ pts.push([f, v]); continue; }
      bad.push(li + 1); continue;
    }
    var low = raw.toLowerCase();
    if (low.indexOf("frequenc") >= 0 || low.indexOf("freq") >= 0 || low.indexOf("spl") >= 0){
      if (low.indexOf("raw") >= 0) headerKind = "autoeq";
      else if (low.indexOf("spl") >= 0) headerKind = "squiglink";
      skipped++; continue;
    }
    if (isMalformedNumericToken(toks[0]) || /^[+-]?(?:nan|inf(?:inity)?)$/i.test(toks[1])) bad.push(li + 1); else skipped++;
  }
  if (bad.length) throw new Error("Dòng dữ liệu không đọc được ở dòng: " + bad.slice(0, 8).join(", ") + (bad.length > 8 ? "…" : "") + " — file đo phải có 2 cột đầu là tần số (Hz) và SPL (dB).");
  if (pts.length < 8) throw new Error("Chỉ tìm thấy " + pts.length + " điểm đo hợp lệ (cần tối thiểu 8) — không nhận diện được dữ liệu đo trong file này.");
  pts.sort(function(a, b){ return a[0] - b[0]; });
  var ded = [];
  for (var i = 0; i < pts.length; i++){
    if (ded.length && Math.abs(ded[ded.length - 1][0] - pts[i][0]) < 1e-9){ var d = ded[ded.length - 1]; d[1] = (d[1] * d[2] + pts[i][1]) / (d[2] + 1); d[2]++; }
    else ded.push([pts[i][0], pts[i][1], 1]);
  }
  var format = sawStar ? "rew" : (headerKind || ((filename || "").toLowerCase().slice(-4) === ".txt" ? "rew" : "generic"));
  var head = headText.join(" ");
  var rigGuess = /5128/.test(head) ? "5128" : (/\b711\b|60318|gras/i.test(head) ? "711" : null);
  return { points: ded.map(function(x){ return [x[0], x[1]]; }), format: format, rigGuess: rigGuess, nameGuess: nameGuess, skipped: skipped };
}

/* ================================================================
   5.2 — 3 FILE MẪU CÙNG MỘT ĐƯỜNG CONG Ở 3 ĐỊNH DẠNG
   Sinh từ cùng một đường cong tham chiếu, nhưng khác lưới tần, delimiter, header
   và độ làm tròn theo đúng đặc trưng từng định dạng — dùng cho nút
   tải mẫu và cho kiểm chứng Prompt 5.
   ================================================================ */
/* Đường cong tham chiếu trơn (tổng các bell Gaussian theo log-f + rolloff logistic):
   trơn để sai số nội suy giữa các lưới tần khác nhau thuần tuý do định dạng/làm tròn. */
function p5FixVal(f){
  var x = Math.log2(f / 1000);
  function g(c, w, a){ var d = (x - c) / w; return a * Math.exp(-0.5 * d * d); }
  return 74
    + g(-3.3, 1.25, 7.5)    /* bass ấm quanh 100 Hz */
    + g(-0.75, 0.9, -2.2)   /* dip nhẹ quanh 600 Hz */
    + g(1.68, 0.60, 11.0)   /* đỉnh ear-gain quanh 3.2 kHz */
    + g(3.0, 0.45, 3.2)     /* bump presence 8 kHz */
    + g(3.55, 0.5, -4.5)    /* dip quanh 11.7 kHz */
    - 9.0 / (1 + Math.exp(-(x - 4.15) / 0.30)); /* rolloff trên ~17 kHz */
}
function p5FixtureRew(){
  var L = ["* Measurement data exported by REW V5.20.14", "* Measurement: Web AutoEQ P5 Fixture", "* Source: generated fixture (Prompt 5)", "*"];
  for (var k = 0; k <= 120; k++){
    var f = 20 * Math.pow(2, k / 12); if (f > 20000) break;
    L.push(f.toFixed(2) + " " + p5FixVal(f).toFixed(2) + " " + (-((f / 37) % 160)).toFixed(1));
  }
  return L.join("\n") + "\n";
}
function p5FixtureSquig(){
  var L = ['"Frequency","SPL"'];
  for (var k = 0; k <= 240; k++){
    var f = 20 * Math.pow(2, (k + 0.5) / 24); if (f > 20000) break;
    L.push(f.toFixed(1) + "," + p5FixVal(f).toFixed(1));
  }
  return L.join("\n") + "\n";
}
function p5FixtureAutoeq(){
  var L = ["Frequency, Raw"];
  for (var k = 0; k <= 120; k++){
    var f = 20 * Math.pow(2, (k + 0.5) / 12); if (f > 20000) break;
    L.push(f.toFixed(2) + ", " + p5FixVal(f).toFixed(2));
  }
  return L.join("\n") + "\n";
}
$("dbFxRew").addEventListener("click", function(){ dlText("web-autoeq-fixture-rew.txt", p5FixtureRew()); });
$("dbFxSquig").addEventListener("click", function(){ dlText("web-autoeq-fixture-squiglink.csv", p5FixtureSquig(), "text/csv;charset=utf-8"); });
$("dbFxAutoeq").addEventListener("click", function(){ dlText("web-autoeq-fixture-autoeq.csv", p5FixtureAutoeq(), "text/csv;charset=utf-8"); });

/* ================================================================
   5.3 — KHO DỮ LIỆU ĐO THẬT (AutoEq) + KIỂM ĐỊNH LÚC NẠP + FUZZY SEARCH
   Dữ liệu nằm ở data:application/javascript;base64,[DA XOA BAN SAO BASE64 TRUNG LAP TRONG CHU THICH DE GIAM DUNG LUONG FILE - DU LIEU THAT NAM O THE SCRIPT DATA: O TREN] (DB_RAW + DB_BUILD), đóng gói lúc build
   từ thư mục results/ của dự án AutoEq: đường cong ĐO GỐC của các nguồn
   (oratory1990, Innerfidelity, Rtings, Super Review...), resample về lưới
   1/12 octave khi đóng gói. Ngay khi nạp trang, app chạy LẠI kiểm định
   trên dữ liệu đã giải mã (đủ 121 điểm đúng lưới, mọi giá trị hữu hạn,
   dải động hợp lý, không trùng tên+nguồn); mục rớt bị loại vào
   DB_RUNTIME_REJECTED. Panel "Kiểm định dữ liệu" hiển thị số đếm thật
   của cả hai lớp kiểm định (lúc đóng gói + lúc nạp).
   ================================================================ */
var DB_GRID = [];
for (var _gk = 0; _gk < 120; _gk++) DB_GRID.push(20 * Math.pow(2, _gk / 12));
DB_GRID.push(20000);
/* (vòng tự động 07:26 ngày 2026-11-24, hướng D — ÁP DỤNG, vá code, bản đa file): dbDecodeV giải mã 605.000 cặp ký tự mỗi lần nạp kho (5.000 mục × 121 điểm) bằng parseInt(s.substr(i,2),36) — mỗi cặp tốn 1 lần substr + parseInt. Nay đường nhanh tính số base36 bằng charCode (cặp [0-9a-z] hợp lệ: d1*36+d2, số nguyên nhỏ chính xác tuyệt đối trong double) rồi áp đúng biểu thức (code-600)/10; mọi cặp chứa ký tự ngoài [0-9a-z] (chữ hoa, dấu, khoảng trắng, ký tự lạ) rơi về đúng biểu thức gốc parseInt(s.substr(i,2),36) nên hành vi với dữ liệu lệch chuẩn giữ nguyên từng bit, kể cả NaN; đầu vào không phải chuỗi đi nguyên đường gốc. Lab (hidden_files/run_20261124_0726_D/, extract verbatim + harness2.js, 2 lần bench độc lập): parity 30.943/30.943 GIỐNG TỪNG BIT cả 2 lần (toàn bộ 5.000 mục DB_RAW thật — 605.000/605.000 cặp đều thuộc đường nhanh — + liệt kê đầy đủ mọi cặp 2 ký tự trên bảng chữ 77 ký tự + 20.000 fuzz + biên non-string ném lỗi đúng loại/thông điệp); decode 5.000 mục paired-median xen kẽ 15 vòng: lần 1 3,3835× (thắng 13/15), lần 2 3,2429× (thắng 15/15). Ứng viên knot-freq tiền tính trong cùng lượt bị BÁC (0,9637×, thắng 9/15 — không ổn định), không áp. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
/* --- vòng tự động 19:54 nhóm D (bản đa file): tiền cấp phát mảng trong dbDecodeV — ÁP DỤNG, vá code. dbBuildPhones giải mã 5.000 mục x 121 điểm (605.000 điểm) mỗi lần mở trang; trước đây out.push() cấp phát + tăng trưởng mảng dần. Nay new Array(Math.max(0, s.length >> 1)) + gán theo chỉ số — số phần tử đúng floor(len/2) như vòng cũ (kể cả độ dài lẻ/length phân số/âm/NaN: Math.max(0, ...) giữ hành vi trả [] như cũ, không ném RangeError); mọi biểu thức tính _code giữ nguyên từng toán hạng nên giá trị GIỐNG TỪNG BIT theo cấu trúc. Lab (hidden_files/run_20261124_1954_D/lab/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 11.538/11.538 GIỐNG TỪNG BIT (5.000 mục thực tế 121 điểm + biên rỗng/lẻ/unicode/emoji + non-string null/undefined/số/object/array-like length âm/NaN/phân số/chuỗi + 6.000 fuzz + 500 fuzz length); bench paired-median xen kẽ 15 vòng trên decode 5.000 mục — lần 1 1,1558x (thắng 14/15), lần 2 1,2052x (thắng 15/15), acc khớp tuyệt đối. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function dbDecodeV(s){
  var out = new Array(Math.max(0, s.length >> 1));
  var _isStr = typeof s === "string";
  var _oi = 0;
  for (var i = 0; i + 1 < s.length; i += 2){
    var _code;
    if (_isStr){
      var _c1 = s.charCodeAt(i), _c2 = s.charCodeAt(i + 1);
      var _d1 = _c1 >= 48 && _c1 <= 57 ? _c1 - 48 : (_c1 >= 97 && _c1 <= 122 ? _c1 - 87 : -1);
      var _d2 = _c2 >= 48 && _c2 <= 57 ? _c2 - 48 : (_c2 >= 97 && _c2 <= 122 ? _c2 - 87 : -1);
      _code = (_d1 >= 0 && _d2 >= 0) ? (_d1 * 36 + _d2 - 600) / 10 : (parseInt(s.substr(i, 2), 36) - 600) / 10;
    } else {
      _code = (parseInt(s.substr(i, 2), 36) - 600) / 10;
    }
    out[_oi++] = _code;
  }
  return out;
}
function dbValidateEntry(e){
  if (!e || !e.n || typeof e.v !== "string") return "thiếu trường dữ liệu";
  return dbValidateVals(dbDecodeV(e.v));
}
/* (vòng tự động 07:01 ngày 2026-11-24, hướng D — ÁP DỤNG, vá code, bản đa file): dbBuildPhones trước đây giải mã e.v HAI lần cho mỗi mục (dbValidateEntry tự decode, rồi dbBuildPhones lại decode để dựng knots) — 5.000 mục × 121 điểm = 605.000 lần parseInt/substr thừa mỗi lần mở trang. Nay tách phần kiểm tra trên mảng đã giải mã thành dbValidateVals(vals) (giữ nguyên từng thông điệp lỗi/thứ tự kiểm tra; min/max tính bằng vòng lặp thay Math.min.apply — mọi giá trị đã qua kiểm tra hữu hạn nên kết quả giống hệt, kể cả chuỗi thông báo toFixed), dbValidateEntry giữ nguyên chữ ký/hành vi bằng cách decode rồi ủy quyền, và dbBuildPhones giải mã MỘT lần rồi dùng chung vals cho cả kiểm tra lẫn dựng knots. Lab (hidden_files/run_20261124_0701_D/, extract verbatim + harness.js + bench.js, 2 lần bench độc lập): parity 16.075/16.075 GIỐNG TỪNG BIT cả 2 lần (toàn bộ 5.000 mục DB_RAW thật + biên null/undefined/non-object, v không phải chuỗi, chuỗi lệch độ dài/lẻ ký tự, ký tự không hợp lệ base36 gây NaN, cực trị ±69,5/-60 dB, 3.000 fuzz, quét đặc biệt 0/-0/NaN/±Infinity/1e308/subnormal); tốc độ paired-median xen kẽ 15 vòng trên 5.000 mục thật: lần 1 W1 validate+decode 1,9708x (15/15), W2 vòng dựng kho đầy đủ 1,9557x (15/15); lần 2 W1 2,0004x (15/15), W2 1,5017x (14/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
/* (vòng tự động 15:24, hướng D — ÁP DỤNG, vá code, bản đa file): gộp hai vòng trong dbValidateVals thành MỘT vòng — trước đây vòng 1 kiểm tra isFinite toàn mảng rồi vòng 2 mới tính min/max (2 lần quét 121 điểm cho mỗi mục, 5.000 mục lúc khởi động); nay một vòng duy nhất kiểm tra isFinite (trả lỗi đúng chỉ số đầu tiên như cũ) rồi cập nhật min/max ngay trong cùng lần đọc vals[i]. Thứ tự đọc vals[i] và thứ tự trả lỗi giữ nguyên (kể cả lỗi ném khi truy cập phần tử), mn/mx khởi tạo bằng vals[0] như cũ nên kết quả giống từng bit với dữ liệu thường; đường hợp lệ quét hết mảng như cũ. Lab (hidden_files/run_20261125_1524_D/lab/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 5078/5078 GIỐNG TỪNG BIT cả 2 lần (biên -70/40, NaN/±Inf ở đầu/giữa/cuối, mảng thưa, độ dài lệch, non-array, getter ném lỗi đúng loại/thông điệp, 5000 fuzz); bench validate-only paired-median 15 vòng trên 5000 mảng 121 điểm — lần 1 valid 1,4567x (14/15), range-viol 1,4956x (15/15); lần 2 valid 1,4254x (15/15), range-viol 1,4163x (15/15); bench kết hợp decode+validate (proxy khởi động 5000 mục) lần 1 1,0732x (13/15), lần 2 1,0760x (13/15). Lưu ý: workload nhân tạo toàn mục NaN-giữa chậm hơn (0,50-0,54x) do chuỗi phụ thuộc min/max — chi phí tuyệt đối ~1-2 us/mục hỏng, không ảnh hưởng đường hợp lệ chiếm 100% lúc khởi động. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function dbValidateVals(vals){
  if (vals.length !== DB_GRID.length) return "lệch lưới tần (" + vals.length + " điểm ≠ " + DB_GRID.length + " điểm của lưới 1/12 octave)";
  var mn = vals[0], mx = vals[0];
  for (var i = 0; i < vals.length; i++){
    var _v = vals[i];
    if (!isFinite(_v)) return "chứa NaN/Infinity tại điểm " + i;
    if (_v < mn) mn = _v;
    if (_v > mx) mx = _v;
  }
  if (mn < -70 || mx > 40) return "dải động bất thường (" + mn.toFixed(1) + ".." + mx.toFixed(1) + " dB)";
  return null;
}

/* ================================================================
   Chặng 2 bước 2.2 — Mở rộng kho đo On-Demand (Pack Loader + GitHub
   AutoEq Fetcher) + mã hoá dbEncodeV ↔ dbDecodeV.
   TRUNG THỰC DỮ LIỆU: app KHÔNG nhúng sẵn bất kỳ đường cong đo mới
   nào trong bước này (nhúng số đo bịa sẽ vi phạm quy tắc dữ liệu).
   DB_EXT_SOURCES chỉ là danh mục tên nguồn phụ trợ của AutoEq (theo
   lộ trình) để người dùng biết có thể tải từ đâu; dữ liệu thật chỉ
   vào kho qua (a) tải trực tiếp từ GitHub AutoEq, (b) nhập file pack
   của người dùng, (c) nạp lại các gói đã nhập trước đó từ localStorage.
   Mọi mục nạp đều qua dbValidateEntry + chống trùng tên+nguồn, và
   dbExtSelfCheck chỉ dùng bản sao kiểm thử nên không bao giờ lệch
   snapshot số lượng kho mặc định.
   ================================================================ */
function dbEncodeV(vals){
  /* Codec base36 2 ký tự chỉ biểu diễn được [-60, 69,5] dB ở bước 0,1 dB
     (code = round(v*10+600) phải nằm trong [0, 1295]). Trước 2026-10-27 hàm
     này kẹp lặng giá trị ngoài dải, và biến NaN thành chuỗi "NaN" dài 3 ký
     tự làm lệch toàn bộ các cặp sau — trong khi pack/GitHub import mã hoá
     TRƯỚC khi dbValidateEntry chạy nên kẹp lặng không bao giờ bị phát hiện.
     Từ nay giá trị không hữu hạn hoặc cho code ngoài [0, 1295] sẽ throw để
     caller (đều nằm trong try/catch ở UI import) báo lỗi rõ thay vì nhập
     dữ liệu đã sai lệch. Dữ liệu nhúng sẵn (1600 mục, -59,0..+23,6 dB) và
     mọi fixture self-check đều nằm trong dải nên không đổi hành vi. */
  var s = "", i, code, s2;
  for (i = 0; i < vals.length; i++){
    code = Math.round(vals[i]*10 + 600);
    if (!isFinite(code) || code < 0 || code > 1295) throw new Error("dbEncodeV: giá trị ngoài dải codec [-60, 69,5] dB tại điểm " + i + ": " + vals[i]);
    s2 = code.toString(36);
    if (s2.length < 2) s2 = "0" + s2;
    s += s2;
  }
  return s;
}
/* Danh mục nguồn phụ trợ của AutoEq (tên nguồn theo lộ trình — chỉ là
   danh mục tham khảo, không phải dữ liệu đo nhúng sẵn). */
var DB_EXT_SOURCES = [
  { key: "hi-end-portable", label: "Hi End Portable" },
  { key: "fahryst", label: "Fahryst" },
  { key: "filk", label: "Filk" },
  { key: "harpo", label: "Harpo" },
  { key: "dhrme", label: "DHRME" },
  { key: "auriculares-argentina", label: "Auriculares Argentina" },
  { key: "crinacle", label: "Crinacle (chỉ khi nguồn công bố file đáp tuyến thô kèm attribution)" }
];
var DB_EXT_STORE_KEY = "webAutoEq.extPacks.v1";
function dbExtReadStore(){
  try {
    if (typeof localStorage === "undefined") return [];
    var v = localStorage.getItem(DB_EXT_STORE_KEY);
    if (!v) return [];
    var a = JSON.parse(v);
    if (!Array.isArray(a)) return [];
    /* Pha C 2026-11-05: loc muc ban luc doc (nhu vaultReadList 18:19) —
       1 muc null trong kho lam dbExtLoadCached nem o rejected.push(e.n)
       va dbExtSaveImported nem o seen(e.n); 1 muc v=array/object-co-length
       lam dbDecodeV nem trong dbValidateEntry — nut "Nap goi da luu" chet
       va pack moi khong luu duoc. Chi giu doi tuong thuong co v dang chuoi
       (dang duy nhat dbExtSaveImported ghi); muc ban tu bien mat o lan luu sau. */
    return a.filter(function(it){ return it && typeof it === "object" && !Array.isArray(it) && typeof it.v === "string"; });
  } catch (e){ return []; }
}
function dbExtWriteStore(list){
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(DB_EXT_STORE_KEY, JSON.stringify(list));
    return true;
  } catch (e){ return false; }
}
/* (vòng tự động 23:24, hướng D — ÁP DỤNG, vá code, bản đa file): dbExtAddEntries trước đây giải mã e.v HAI lần cho mỗi mục nhập (dbValidateEntry tự decode, rồi dbExtEntryToPhone lại decode) — mỗi pack/GitHub import tốn 121 lần parseInt thừa/mục. Nay dbExtAddEntries giải mã MỘT lần (cùng biểu thức kiểm tra như dbValidateEntry/dbBuildPhones: thiếu trường -> "thiếu trường dữ liệu", ngược lại decode rồi dbValidateVals) rồi dùng chung vals cho cả kiểm tra lẫn dựng phone qua dbExtEntryToPhoneVals (cùng object literal, cùng biểu thức knots từng toán hạng); dbExtEntryToPhone giữ nguyên chữ ký/hành vi bằng cách ủy quyền với dbDecodeV(e.v). Đối xứng với vá giải mã-một-lần ở dbBuildPhones (07:01 ngày 24/11). Lab (hidden_files/run_20261125_2324_D/lab2/, hàm trích verbatim + harness, 5 lần bench độc lập): parity 22/22 GIỐNG TỪNG BIT mọi lần (biên null/thiếu trường/v không phải chuỗi/chuỗi ngắn/lệch lưới/dải động/dup không phân biệt hoa thường/fuzz 500 mục + register:true); bench paired-median xen kẽ 21 vòng x 5 lượt gộp trên import 2.000 mục — 2 lần đo sạch cuối 1,1886x (thắng 14/21) và 1,1365x (thắng 13/21); 5 lần đo gộp median ratio 1,10–1,27x. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function dbExtEntryToPhoneVals(e, vals){
  return { name: e.n, brand: e.b || "", type: e.t || "", rig: e.r || "other", rigLabel: e.rl || "Rig khác / chưa xác định",
    source: "AutoEq · " + e.s, srcKey: e.s,
    knots: DB_GRID.map(function(f, i){ return [Math.round(f*10)/10, vals[i]]; }),
    attribution: dbAttribution(e) };
}
function dbExtEntryToPhone(e){
  return dbExtEntryToPhoneVals(e, dbDecodeV(e.v));
}
/* Thêm mục vào danh sách đích. targetList/seen do caller cấp để
   self-check chạy trên bản sao mà không chạm kho thật. opts.register
   = true chỉ khi thêm thật vào DB_PHONES (đăng ký vào AE_PHONES và
   dựng lại danh sách Bước 1 một lần duy nhất). */
function dbExtAddEntries(entries, targetList, seen, opts){
  var added = [], rejected = [];
  var bulk = !!(opts && opts.register);
  if (bulk) AE_REG_BULK = true;
  try {
    entries.forEach(function(e){
      var err, vals;
      if (!e || !e.n || typeof e.v !== "string") err = "thiếu trường dữ liệu";
      else { vals = dbDecodeV(e.v); err = dbValidateVals(vals); }
      if (err){ rejected.push({ n: (e && e.n) || "(không tên)", s: (e && e.s) || "?", r: err }); return; }
      var key = ((e.n || "") + "|" + (e.s || "")).toLowerCase();
      if (seen[key]){ rejected.push({ n: e.n, s: e.s, r: "trùng tên + nguồn" }); return; }
      seen[key] = 1;
      var p = dbExtEntryToPhoneVals(e, vals);
      targetList.push(p);
      added.push(p);
      if (opts && opts.register && typeof aeRegisterPhone === "function"){
        aeRegisterPhone({ id: "db:" + p.srcKey + "|" + p.name, name: p.name, rig: p.rig, group: "db", entry: p });
      }
    });
  } finally {
    if (bulk){
      AE_REG_BULK = false;
      try { if (typeof aeRenderPhoneSelect === "function") aeRenderPhoneSelect(); } catch (e2){}
      try { if (typeof dbRenderResults === "function") dbRenderResults(); } catch (e3){}
    }
  }
  return { added: added, rejected: rejected };
}
function dbExtSeenFromPhones(list){
  var seen = {};
  list.forEach(function(p){ seen[((p.name || "") + "|" + (p.srcKey || "")).toLowerCase()] = 1; });
  return seen;
}
/* Ly do cu the cho tung diem pack xau (Pha C 2026-11-07): truoc day moi diem
   xau deu chung 1 thong diep "khong phai [tan so > 0, dB] bang so huu han"
   nen 2 muc xau trong cung goi (null @4kHz, Infinity 1e999) hien cung 1 ly do,
   nguoi dung khong phan biet duoc loi nao. Ham thuan, tra "" neu diem hop le. */
function dbExtPointWhy(pt, i){
  if (!Array.isArray(pt)) return "Pack points: điểm " + i + " không phải cặp [tần số, dB].";
  var f = pt[0], v = pt[1];
  if (typeof f !== "number") return "Pack points: điểm " + i + " tần số không phải số (" + (f === null ? "null" : (f === undefined ? "thiếu" : "loại " + typeof f)) + ").";
  if (f !== f) return "Pack points: điểm " + i + " tần số là NaN.";
  if (!isFinite(f)) return "Pack points: điểm " + i + " tần số vô hạn (" + f + ").";
  if (f <= 0) return "Pack points: điểm " + i + " tần số phải > 0 (nhận " + f + ").";
  if (typeof v !== "number") return "Pack points: điểm " + i + " dB không phải số (" + (v === null ? "null" : (v === undefined ? "thiếu" : "loại " + typeof v)) + ").";
  if (v !== v) return "Pack points: điểm " + i + " dB là NaN.";
  if (!isFinite(v)) return "Pack points: điểm " + i + " dB vô hạn (" + v + ").";
  return "";
}
function dbExtNormalizePoints(points){
  /* Pha C 2026-11-07 (guard pack): moi diem phai la cap [tan so, dB] bang so
     huu han, tan so > 0 — JSON null/chuoi/Infinity (1e999) truoc day bi
     aeInterp ep kieu am tham (null -> 0 dB, lech toi ~11 dB ma van qua
     dbValidateEntry) hoac gay throw giua .map() cua dbExtPackFromJson lam
     mat ca goi. Nem loi ro de caller loai rieng tung muc. */
  if (!Array.isArray(points) || points.length < 2) throw new Error("Pack points cần ít nhất 2 điểm [tần số, dB].");
  points.forEach(function(pt, i){
    var why = dbExtPointWhy(pt, i);
    if (why) throw new Error(why);
  });
  var pts = points.slice().sort(function(a, b){ return a[0] - b[0]; });
  var at1k = aeInterp(pts, 1000);
  return DB_GRID.map(function(f){ return aeInterp(pts, f) - at1k; });
}
function dbExtParseCsv(text){
  /* Pha C 2026-11-07: nhan dien delimiter theo tung dong giong dbParseMeasurement
     (tab > ";" > "," > khoang trang) thay vi tach moi dong bang [,;\t].
     Ban cu tach "1000,5;74,2" thanh [1000, 5] — SPL that 74,2 dB bien mat,
     phan thap phan cua tan so (5) thanh SPL, duong cong nhap vao lech toi
     13,8 dB ma van luu kho am tham; dong co ngoac kep ("1000","74.5") va
     dong cach nhau bang khoang trang (REW kem cot phase) bi bo het. Ban nay
     xu ly so kieu chau Au (dau phay thap phan khi delimiter la ;/tab/space),
     boc dau ngoac kep va bo dong comment (*, #, ;) nhu duong dbParseMeasurement.
     Gioi han chap nhan (f > 0, f <= 100000) va sap xep tang dan giu nguyen. */
  var pts = [];
  text.split(/\r?\n/).forEach(function(line){
    var raw = line.trim();
    if (!raw) return;
    var first = raw.charAt(0);
    if (first === "*" || first === "#" || first === ";") return;
    var delim = raw.indexOf("\t") >= 0 ? "\t" : (raw.indexOf(";") >= 0 ? ";" : (raw.indexOf(",") >= 0 ? "," : " "));
    var toks = (delim === " " ? raw.split(/\s+/) : raw.split(delim)).map(function(t){ return t.replace(/^"+|"+$/g, "").trim(); }).filter(function(t){ return t.length > 0; });
    if (toks.length < 2) return;
    function num(t){
      if ((delim === ";" || delim === "\t" || delim === " ") && /^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
      return parseFloat(t);
    }
    var f = num(toks[0]), v = num(toks[1]);
    if (isFinite(f) && isFinite(v) && f > 0 && f <= 100000) pts.push([f, v]);
  });
  pts.sort(function(a, b){ return a[0] - b[0]; });
  return pts;
}
function dbExtPackFromJson(obj){
  /* Pha C 2026-11-07 (guard pack): loai rieng tung muc xau thay vi .map()
     throw giua chung lam mat ca goi — lab packguard 10/10: 1 muc co diem
     Infinity/500 dB/thieu points (ke ca chuoi so) deu throw, keo theo 2 muc
     hop le cung goi; null o diem do con nhap am tham lech 11 dB. Tra ve
     { entries, rejected } de caller bao dung muc bi loai. */
  var raw = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.entries) ? obj.entries : null);
  if (!raw) throw new Error("Pack JSON cần là mảng entries hoặc { entries: [...] }.");
  var out = [], rejected = [];
  raw.forEach(function(e){
    try {
      var name = (e && (e.n || e.name)) || "(không tên)";
      if (e && e.v && typeof e.v === "string"){
        out.push({ n: e.n || e.name, b: e.b || e.brand || "", t: e.t || e.type || "",
          r: e.r || e.rig || "other", rl: e.rl || e.rigLabel || "Rig khác / chưa xác định",
          s: e.s || e.source || "pack", v: e.v });
        return;
      }
      var vals = null;
      if (e && e.points && e.points.length >= 2) vals = dbExtNormalizePoints(e.points);
      else if (e && e.values && e.values.length === DB_GRID.length){
        vals = e.values.slice();
        /* null trong values truoc day ep kieu thanh 0 dB am tham
           (null*10+600 = 600 -> ma hop le): kiem tra so huu han. */
        vals.forEach(function(v, i){
          if (typeof v !== "number" || !isFinite(v)) throw new Error("Pack values: điểm " + i + " không phải số dB hữu hạn.");
        });
      }
      if (!vals) throw new Error("Mục pack thiếu v / points / values (121 điểm): " + name);
      out.push({ n: e.n || e.name, b: e.b || e.brand || "", t: e.t || e.type || "",
        r: e.r || e.rig || "other", rl: e.rl || e.rigLabel || "Rig khác / chưa xác định",
        s: e.s || e.source || "pack", v: dbEncodeV(vals) });
    } catch (err){
      rejected.push({ n: (e && (e.n || e.name)) || "(không tên)", s: (e && e.s) || "?", r: err && err.message ? err.message : String(err) });
    }
  });
  return { entries: out, rejected: rejected };
}
function dbExtSaveImported(entries){
  var store = dbExtReadStore();
  var seen = {};
  store.forEach(function(e){ seen[((e.n || "") + "|" + (e.s || "")).toLowerCase()] = 1; });
  entries.forEach(function(e){
    var key = ((e.n || "") + "|" + (e.s || "")).toLowerCase();
    if (!seen[key]){ seen[key] = 1; store.push(e); }
  });
  dbExtWriteStore(store);
  return store.length;
}
function dbExtLoadCached(){
  var store = dbExtReadStore();
  if (!store.length) return { added: [], rejected: [], stored: 0, note: "empty" };
  var res = dbExtAddEntries(store, DB_PHONES, dbExtSeenFromPhones(DB_PHONES), { register: true });
  return { added: res.added, rejected: res.rejected, stored: store.length, note: "loaded" };
}
/* Dinh dang danh sach muc bi loai thanh "Ten (nguon): ly do; ..." de thong bao
   nhap pack / nap goi da luu ghi ro muc nao bi loai. Pha C 2026-11-07: truoc day
   handler nhap file chi render r.r (2 muc xau cung ly do thi khong phan biet
   duoc muc nao) va handler nap goi da luu chi bao so luong "loai N muc hong".
   Ham thuan, khong cham DOM/kho; muc thieu ten/nguon/ly do ve chuoi du phong. */
function dbExtRejText(rejected){
  if (!Array.isArray(rejected) || !rejected.length) return "";
  return rejected.map(function(r){
    var n = (r && r.n) || "(không tên)";
    var s = (r && r.s) || "?";
    var why = (r && r.r) || "?";
    return n + " (" + s + "): " + why;
  }).join("; ");
}
function dbExtSelfCheck(){
  var notes = [], ok = true;
  var beforePhones = DB_PHONES.length;
  var beforeAe = (typeof AE_PHONES !== "undefined") ? Object.keys(AE_PHONES).length : 0;
  /* 1. Round-trip dbEncodeV ↔ dbDecodeV trên HD 600 (hoặc mục đầu kho). */
  var hd = null;
  for (var hi = 0; hi < DB_PHONES.length; hi++) if (DB_PHONES[hi].name === "Sennheiser HD 600"){ hd = DB_PHONES[hi]; break; }
  if (!hd) hd = DB_PHONES[0];
  var vals = hd.knots.map(function(k){ return k[1]; });
  var enc = dbEncodeV(vals), dec = dbDecodeV(enc), maxErr = 0, i;
  for (i = 0; i < vals.length; i++){ var d = Math.abs(dec[i] - vals[i]); if (d > maxErr) maxErr = d; }
  if (dec.length !== DB_GRID.length || maxErr > 0.05){ ok = false; notes.push("round-trip HD 600 lệch " + maxErr.toFixed(3) + " dB (ngưỡng 0,05)"); }
  /* 1b. Codec nghiêm ngặt (sửa 2026-10-27): ngoài dải hoặc NaN phải throw. */
  try { dbEncodeV([-65]); ok = false; notes.push("dbEncodeV(-65) không throw"); } catch (e) {}
  try { dbEncodeV([NaN]); ok = false; notes.push("dbEncodeV(NaN) không throw"); } catch (e) {}
  try { dbEncodeV([69.5]); } catch (e) { ok = false; notes.push("dbEncodeV(69,5) throw sai: " + e.message); }
  /* 2. Nạp thử vào bản sao: 2 hợp lệ, 3 hỏng (lệch lưới, NaN, trùng). */
  var testList = [], testSeen = {};
  var validA = { n: "Kiểm tra On-Demand A", b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "selfcheck", v: enc };
  var validB = { n: "Kiểm tra On-Demand B", b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "selfcheck", v: dbEncodeV(vals.map(function(v){ return v + 1; })) };
  var badGrid = { n: "Hỏng lưới", b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "selfcheck", v: dbEncodeV(vals.slice(0, 100)) };
  var badNaN = { n: "Hỏng NaN", b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "selfcheck", v: new Array(121 + 1).join("!!") };
  var dup = { n: "Kiểm tra On-Demand A", b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "selfcheck", v: enc };
  var trial = dbExtAddEntries([validA, validB, badGrid, badNaN, dup], testList, testSeen, {});
  if (trial.added.length !== 2 || trial.rejected.length !== 3){ ok = false; notes.push("nạp thử: thêm " + trial.added.length + " (cần 2), loại " + trial.rejected.length + " (cần 3)"); }
  /* 2d. Pha C 2026-11-07: thong bao loai muc phai ghi ro ten + ly do tung muc. */
  var rejText = dbExtRejText(trial.rejected);
  if (rejText.indexOf("Hỏng lưới") < 0 || rejText.indexOf("Hỏng NaN") < 0 || rejText.indexOf("trùng tên + nguồn") < 0){ ok = false; notes.push("dbExtRejText thiếu tên/lý do mục loại: " + rejText); }
  if (dbExtRejText([]) !== ""){ ok = false; notes.push("dbExtRejText([]) phải trả chuỗi rỗng"); }
  /* 2e. Pha C 2026-11-07: ly do loai diem phan biet theo loai gia tri. */
  var whyNull = dbExtPointWhy([4000, null], 2), whyInf = dbExtPointWhy([4000, Infinity], 2);
  if (whyNull.indexOf("null") < 0 || whyInf.indexOf("vô hạn") < 0 || whyNull === whyInf){ ok = false; notes.push("dbExtPointWhy chưa phân biệt null/Infinity: " + whyNull + " / " + whyInf); }
  if (dbExtPointWhy([4000, -4], 2) !== ""){ ok = false; notes.push("dbExtPointWhy([4000,-4]) phải trả chuỗi rỗng"); }
  /* 2c. Pha C 2026-11-05: muc ban kho pack (null, v=array, v={length}) bi loai
     khong nem — tren ban sao kiem thu, khong cham localStorage that. */
  var dirtyList = [], dirtySeen = {};
  var arrV = []; for (var avi = 0; avi < 242; avi++) arrV.push("aa");
  var trialD = dbExtAddEntries([null, { n: "Ban mang", b: "", t: "", r: "other", rl: "", s: "selfcheck", v: arrV },
    { n: "Ban object", b: "", t: "", r: "other", rl: "", s: "selfcheck", v: { length: 242 } },
    { n: "Kiểm tra On-Demand C", b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "selfcheck", v: enc }], dirtyList, dirtySeen, {});
  if (trialD.added.length !== 1 || trialD.rejected.length !== 3){ ok = false; notes.push("muc ban kho pack: thêm " + trialD.added.length + " (cần 1), loại " + trialD.rejected.length + " (cần 3)"); }
  /* 2b. Trùng với kho thật bị chặn (trên bản sao của seen, không chạm kho). */
  var seenCopy = dbExtSeenFromPhones(DB_PHONES);
  var realDup = { n: DB_PHONES[0].name, b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: DB_PHONES[0].srcKey, v: enc };
  var trial2 = dbExtAddEntries([realDup], [], seenCopy, {});
  if (trial2.added.length !== 0 || trial2.rejected.length !== 1){ ok = false; notes.push("trùng kho thật không bị chặn"); }
  /* 3. Số lượng kho mặc định giữ nguyên tuyệt đối sau self-check. */
  var afterPhones = DB_PHONES.length;
  var afterAe = (typeof AE_PHONES !== "undefined") ? Object.keys(AE_PHONES).length : 0;
  if (afterPhones !== beforePhones || afterAe !== beforeAe){ ok = false; notes.push("số lượng kho lệch sau self-check"); }
  return { pass: ok, maxErr: maxErr, hdName: hd.name, added: trial.added.length, rejected: trial.rejected.length,
    beforePhones: beforePhones, afterPhones: afterPhones,
    detail: ok ? ("round-trip " + hd.name + ": sai số " + maxErr.toFixed(3) + " dB trên 121 điểm · nạp thử: 2 hợp lệ vào, 3 hỏng bị loại (lệch lưới/NaN/trùng) · trùng kho thật bị chặn · kho giữ nguyên " + beforePhones + " mục · mục bẩn (null/v-mảng) bị loại không ném")
      : notes.join(" · ") };
}
/* ---------------- UI mở rộng kho đo On-Demand ---------------- */
function dbExtSetInfo(t){ try { var el = $("dbExtInfo"); if (el) el.textContent = t; } catch (e){} }
(function dbExtBindUI(){
  try {
    var loadBtn = $("dbLoadExtBtn");
    if (loadBtn) loadBtn.addEventListener("click", function(){
      var r = dbExtLoadCached();
      if (r.note === "empty") dbExtSetInfo("Chưa có gói nào được lưu — nhập file pack hoặc tải từ GitHub rồi bấm lại (gói sẽ được lưu vào localStorage của trình duyệt này, không gửi máy chủ).");
      else dbExtSetInfo("Đã nạp gói mở rộng từ bộ nhớ máy khách: thêm " + r.added.length + " tai nghe mới vào kho (" + r.added.map(function(p){ return p.name; }).join(", ") + ") · bỏ qua " + (r.stored - r.added.length - r.rejected.length) + " mục đã có · loại " + r.rejected.length + " mục hỏng." + (r.rejected.length ? " (" + dbExtRejText(r.rejected) + ")" : ""));
    });
    var fileInput = $("dbPackFileInput");
    if (fileInput) fileInput.addEventListener("change", function(){
      var files = this.files || [];
      if (!files.length) return;
      var pending = files.length, addedAll = 0, rejAll = 0, msgs = [];
      Array.prototype.forEach.call(files, function(f){
        var rd = new FileReader();
        rd.onload = function(){
          try {
            var text = String(rd.result || "");
            var entries, packRejected = [];
            if (text.trim().charAt(0) === "{" || text.trim().charAt(0) === "["){
              var pack = dbExtPackFromJson(JSON.parse(text));
              entries = pack.entries; packRejected = pack.rejected;
            }
            else {
              var pts = dbExtParseCsv(text);
              if (pts.length < 2) throw new Error("CSV không đọc được điểm đo (cần ít nhất 2 dòng tần số, dB).");
              var vals = dbExtNormalizePoints(pts);
              entries = [{ n: f.name.replace(/\.(csv|txt|json)$/i, ""), b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "pack-file", v: dbEncodeV(vals) }];
            }
            var res = dbExtAddEntries(entries, DB_PHONES, dbExtSeenFromPhones(DB_PHONES), { register: true });
            dbExtSaveImported(entries.filter(function(e){ return dbValidateEntry(e) === null; }));
            addedAll += res.added.length; rejAll += res.rejected.length + packRejected.length;
            var allRej = res.rejected.concat(packRejected);
            if (allRej.length) msgs.push(f.name + ": loại " + allRej.length + " (" + dbExtRejText(allRej) + ")");
          } catch (e){ msgs.push(f.name + ": lỗi " + e.message); }
          if (--pending === 0) dbExtSetInfo("Nhập gói mở rộng: thêm " + addedAll + " tai nghe mới · loại " + rejAll + " mục." + (msgs.length ? " " + msgs.join(" ") : ""));
        };
        rd.readAsText(f);
      });
    });
    var fetchBtn = $("dbFetchGhBtn");
    if (fetchBtn) fetchBtn.addEventListener("click", async function(){
      var pathEl = $("dbFetchGhPath");
      var path = pathEl ? pathEl.value.trim() : "";
      if (!path){ dbExtSetInfo("Nhập đường dẫn results/... của file CSV trên GitHub AutoEq trước (ví dụ: results/<nguồn>/<target>/<tên>.csv — xem cấu trúc trong repo AutoEq)."); return; }
      var url = path;
      if (url.indexOf("https://raw.githubusercontent.com/") !== 0){
        url = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/" + url.replace(/^\/+/, "");
      }
      dbExtSetInfo("Đang tải " + url + " …");
      try {
        var resp = await fetch(url);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        var text = await resp.text();
        var pts = dbExtParseCsv(text);
        if (pts.length < 2) throw new Error("CSV tải về không đọc được điểm đo.");
        var vals = dbExtNormalizePoints(pts);
        var base = url.split("/").pop().replace(/\.(csv|txt)$/i, "");
        var entry = { n: decodeURIComponent(base), b: "", t: "", r: "other", rl: "Rig khác / chưa xác định", s: "github-autoeq", v: dbEncodeV(vals) };
        var res = dbExtAddEntries([entry], DB_PHONES, dbExtSeenFromPhones(DB_PHONES), { register: true });
        if (res.added.length) dbExtSaveImported([entry]);
        dbExtSetInfo(res.added.length ? ("Đã tải từ GitHub AutoEq: thêm “" + entry.n + "” vào kho (chuẩn hoá 0 dB @ 1 kHz, nội suy lên lưới 121 điểm, đã qua dbValidateEntry).")
          : ("Không thêm được “" + entry.n + "”: " + res.rejected.map(function(r){ return r.r; }).join("; ")));
      } catch (e){
        dbExtSetInfo("Tải từ GitHub thất bại (" + e.message + ") — kiểm tra lại đường dẫn results/... hoặc mạng/CORS, kho không đổi.");
      }
    });
  } catch (e){}
})();

function dbAttribution(e){
  if (e && e.src === "Squiglink") return "Đường cong đáp tuyến từ cơ sở dữ liệu Squiglink của " + e.s + ", rig " + e.rl + ". Lấy dữ liệu ngày 2026-10-28 từ mạng Squiglink (squig.link); đã resample về lưới 1/12 octave (121 điểm, chuẩn hoá 0 dB @ 1 kHz) khi đóng gói app. Dữ liệu thuộc về nguồn đo.";
  return "Đường cong đáp tuyến GỐC từ dự án AutoEq (github.com/jaakkopasanen/AutoEq, thư mục results/), nguồn đo: " + e.s + ", rig " + e.rl + ". Lấy dữ liệu ngày " + (typeof DB_BUILD !== "undefined" ? DB_BUILD.date : "—") + "; đã resample về lưới 1/12 octave (121 điểm, chuẩn hoá 0 dB @ 1 kHz) khi đóng gói app. Dữ liệu thuộc về nguồn đo và dự án AutoEq (MIT).";
}
var DB_PHONES = [];
var DB_RUNTIME_REJECTED = [];
(function dbBuildPhones(){
  var raw = (typeof DB_RAW !== "undefined") ? DB_RAW : [];
  var seen = {};
  raw.forEach(function(e){
    var err, vals;
    if (!e || !e.n || typeof e.v !== "string") err = "thiếu trường dữ liệu";
    else { vals = dbDecodeV(e.v); err = dbValidateVals(vals); }
    if (err){ DB_RUNTIME_REJECTED.push({ n: e.n || "(không tên)", s: e.s || "?", r: err }); return; }
    var key = (e.n + "|" + e.s).toLowerCase();
    if (seen[key]){ DB_RUNTIME_REJECTED.push({ n: e.n, s: e.s, r: "trùng tên + nguồn trong dữ liệu đã nhúng" }); return; }
    seen[key] = 1;
    DB_PHONES.push({ name: e.n, brand: e.b, type: e.t, rig: e.r, rigLabel: e.rl,
      source: (e.src === "Squiglink" ? "Squiglink · " : "AutoEq · ") + e.s, srcKey: e.s,
      knots: DB_GRID.map(function(f, i){ return [Math.round(f * 10) / 10, vals[i]]; }),
      attribution: dbAttribution(e) });
  });
})();
var DB = { cur: null };
function dbLev(a, b){
  var m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++){
    cur[0] = i;
    for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    var t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
/* --- Mở rộng 2026-11-24 (vòng tự động 04:18, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 04:12, ÁP DỤNG). Ứng viên D duy nhất: dbLevCap8 — Levenshtein giới hạn (banded, ngưỡng 8) thay cho dbLev đầy đủ trong dbScore. dbScore chỉ dùng dbLev qua Math.max(0, 24 - dbLev*3), nên chỉ khoảng cách 0..7 mới cho đóng góp > 0; dbLevCap8 tính đúng khoảng cách khi <= 7 và trả 8 khi > 7 (đóng góp 0, giống hệt), bằng DP dải |i-j| <= 7 với giá trị kẹp ở 8 — mọi điểm dbScore GIỐNG TỪNG BIT theo cấu trúc. dbLev gốc giữ nguyên không đổi. Lab (hidden_files/run_20261124_0418_D/, extract verbatim + harness + bench, 2 lần bench độc lập): parity dbScore 102.651/102.651 + dbLev exhaustive 261.121/261.121 GIỐNG TỪNG BIT; bench quét 5.000 tên thật paired-median 15 vòng — lần 1 W1 1,2164x/W2 1,2807x/W3 1,0579x/W4 1,1734x/W5 1,1861x, lần 2 W1 1,5071x/W2 1,4817x/W3 1,2518x/W4 1,0250x/W5 1,2160x, acc khớp tuyệt đối. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
/* --- Mở rộng 2026-11-24 (vòng tự động 05:20, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 05:06, ÁP DỤNG). Ứng viên D duy nhất: tái sử dụng mảng nháp trong dbLevCap8 (_levPrev/_levCur) thay vì cấp phát new Array(n+1) hai lần mỗi lần gọi — dbScore gọi dbLevCap8 cho tới ~5.000 tai nghe mỗi lần gõ tìm kiếm, mỗi lần cấp phát 2 mảng vô ích; dbLevCap8 không đệ quy và không gọi hàm nào khác nên dùng chung mảng nháp an toàn: mọi ô prev[0..n] được ghi trong vòng khởi tạo và mọi ô cur[0..n] được ghi INF ở đầu mỗi hàng trước khi đọc, nên kết quả GIỐNG TỪNG BIT theo cấu trúc (mảng nháp chỉ nới dài khi n lớn hơn, nội dung cũ không bao giờ được đọc). dbLev/dbLevCap8 gốc giữ nguyên logic tính toán từng toán hạng. Lab (hidden_files/run_20261124_0520_D/, extract verbatim + harness + bench, 2 lần độc lập): parity 208.294/208.294 GIỐNG TỪNG BIT cả 2 lần (dbScore trên 5.020 tên thật × 33 truy vấn + biên/non-string/fuzz 6.000 + dbLevCap8 exhaustive chuỗi nhị phân tới độ dài 6 + 25.000 fuzz + tăng dần độ dài); bench paired-median xen kẽ 15 vòng trên quét 5.020 tên — lần 1 W1 1,0231x/W2 1,0256x/W3 1,0192x/W4 1,0327x/W5 1,0270x/W6 1,0254x, lần 2 W1 1,0581x/W2 1,0388x/W3 1,0257x/W4 1,0311x/W5 1,0213x/W6 1,0454x, acc khớp tuyệt đối. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
var _levPrev = [], _levCur = [];
function dbLevCap8(a, b){
  var m = a.length, n = b.length;
  if (!m) return n > 8 ? 8 : n;
  if (!n) return m > 8 ? 8 : m;
  var K = 7, INF = 8;
  var prev = _levPrev, cur = _levCur, i, j;
  if (prev.length < n + 1){ prev.length = n + 1; cur.length = n + 1; }
  for (j = 0; j <= n; j++) prev[j] = j <= K ? j : INF;
  for (i = 1; i <= m; i++){
    var jLow = Math.max(0, i - K), jHigh = Math.min(n, i + K);
    for (j = 0; j <= n; j++) cur[j] = INF;
    cur[jLow === 0 ? 0 : jLow - 1] = jLow === 0 ? (i <= K ? i : INF) : INF;
    for (j = Math.max(1, jLow); j <= jHigh; j++){
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      var del = prev[j] + 1; if (del > INF) del = INF;
      var ins = cur[j - 1] + 1; if (ins > INF) ins = INF;
      var sub = prev[j - 1] + cost; if (sub > INF) sub = INF;
      var v = del < ins ? del : ins; if (sub < v) v = sub;
      cur[j] = v;
    }
    var t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
/* --- Mở rộng 2026-11-23 (vòng tự động 23:54, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 23:24, BÁC BỎ). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 23:27:48+07, 6.288.467 byte / 25.450 dòng (wc -l), md5 bfceb85861aa4d29584631069119bebc, version 367) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-D lưu tại ~/workspace/autoeq/backups/*2026-11-23_2356*. Ứng viên D duy nhất: cache điểm chuẩn hoá tên trong dbScore (_dbScoreCache Map, khóa theo String(name || "")) — trước đây dbRenderResults gọi dbScore cho MỌI tai nghe trong DB_PHONES (tới 5.000 mục) mỗi lần gõ tìm kiếm (debounce 80 ms), mỗi lần đều tính lại dbNormStr(name) (toLowerCase + normalize NFD + 3 lần replace regex), N.replace(/ /g,"") và N.split(" ") cho từng tên dù tên không đổi giữa các lần tìm; nay tính MỘT lần (N, nc, toks) theo tên rồi dùng lại, biểu thức tính điểm (+100/+80/+30/+18/+8, thứ tự cộng, điều kiện if (!Q) return 1 sau khi đã tính N như cũ, dbLev(qc, nc) giữ nguyên) giữ nguyên từng toán hạng nên mọi điểm GIỐNG TỪNG BIT theo cấu trúc (khóa là giá trị chuỗi nên tên đổi tạo khóa mới, tên trùng/khác dạng cùng chuỗi chuẩn hoá dùng chung mục cache đúng). Đối xứng với vá aeStepScore đã áp dụng 22:02 (cache aeNormQ theo tên trong AE_PHONES) — lượt này áp cùng kỹ thuật cho kho DB_PHONES, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261123_2354_D/, 2 lần chạy độc lập): parity 56.617/56.617 GIỐNG TỪNG BIT (Object.is trên điểm + loại/thông điệp lỗi; gồm 600 tên × 39 truy vấn × 2 lượt cache lạnh/ấm, tên xen kẽ cùng dạng chuẩn hoá, biên rỗng/khoảng trắng/dấu câu/dấu tiếng Việt/đ/№/tab/newline/NBSP, chuỗi dài, non-string null/undefined/số/NaN/±Inf/bool/mảng/object/Symbol/BigInt/toString ném lỗi, fuzz 6.000 ca); tốc độ paired-median xen kẽ 15 vòng trên quét 5.000 tên/truy vấn (mô phỏng dbRenderResults): lần 1 W1 lặp 1 truy vấn 1,0933× (14/15), W2 xoay 20 truy vấn 1,0770× (15/15), W3 gõ sai 1,0505× (14/15), W4 truy vấn rỗng 2,1324× (15/15), W5 khớp chuỗi con 1,1020× (15/15); lần 2 W1 1,1196× (13/15), W2 1,1056× (15/15), W3 1,0831× (14/15), W4 2,1022× (15/15), W5 1,1326× (15/15) — cải thiện ổn định mọi workload cả 2 lần (lợi ích vừa phải vì dbLev Levenshtein chiếm phần lớn chi phí điểm, phần chuẩn hoá tên là phần bỏ được). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_2354_D/. --- */
/* --- Mở rộng 2026-11-24 (vòng tự động 01:47, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 01:24, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 01:32:28+07, 6.299.348 byte / 25.468 dòng (wc -l), md5 b0dc08dade994f996a6696188f74ef32, version 383) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-D lưu tại ~/workspace/autoeq/backups/2026-11-24_0144_before.html và Web AutoEQ - DSP Core_2026-11-24_0144_pre-D.html. Ứng viên D duy nhất: bỏ tính Levenshtein trong dbScore khi |len(qc)-len(nc)| >= 8 — dbRenderResults gọi dbScore cho MỌI tai nghe trong DB_PHONES (tới 5.000 mục) mỗi lần gõ tìm kiếm, và dbLev(qc,nc) chiếm phần lớn chi phí điểm (ghi nhận ở lượt 23:54); vì dbLev >= |len(qc)-len(nc)| (kiểm chứng thực nghiệm 20.000/20.000 cặp ngẫu nhiên) nên khi hiệu độ dài >= 8 thì dbLev >= 8 và đóng góp Math.max(0, 24 - dbLev*3) = 0, nay bỏ qua phép tính dbLev và cộng 0 — mọi điểm GIỐNG TỪNG BIT theo cấu trúc (qc/nc luôn là chuỗi, dbLev thuần không ném lỗi); khi hiệu độ dài < 8 giữ nguyên biểu thức gốc từng toán hạng. Khác hướng đã bác: thay khóa chuỗi trong gridTotalDb (21:15) và hoist log2/shelf trong aePreservedTarget (01:24) — lượt này cắt hẳn nhánh Levenshtein vô ích theo chặn dưới độ dài, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + harness2.js + bench_quick.js trong hidden_files/run_20261124_0144_D/, 2 lần chạy độc lập): parity 56.617/56.617 GIỐNG TỪNG BIT (Object.is trên điểm + loại/thông điệp lỗi; gồm 600 tên × 39 truy vấn × 2 lượt cache lạnh/ấm, biên rỗng/khoảng trắng/dấu câu/dấu tiếng Việt/đ/№/tab/newline/NBSP, chuỗi dài, non-string null/undefined/số/NaN/±Inf/bool/mảng/object/Symbol/BigInt/toString ném lỗi, fuzz 6.000 ca) + harness2 biên 85.159/85.159 (hiệu độ dài -12..+12 quanh ngưỡng 8, liệt kê đầy đủ chuỗi nhị phân, fuzz 20.000 ca, kiểm chứng chặn dưới dbLev 20.000/20.000) + verify trên file ĐÃ VÁ 16.600/16.600; tốc độ paired-median xen kẽ 9 vòng trên quét 5.000 tên/truy vấn (mô phỏng dbRenderResults): lần 1 W1 lặp 1 truy vấn 9,6597× (9/9), W2 xoay 5 truy vấn 7,2368× (9/9), W3 gõ sai 5,9587× (9/9), W4 truy vấn rỗng 1,0907× (8/9), W5 độ dài sát 0,9682× (1/9, trung tính trong nhiễu); lần 2 W1 10,4976× (9/9), W2 7,4310× (9/9), W3 6,3294× (9/9), W4 0,9912× (3/9), W5 0,9986× (5/9) — cải thiện ổn định mọi workload thực tế cả 2 lần, acc khớp tuyệt đối; W5 sát độ dài (trường hợp xấu nhất, dbLev vẫn chạy) trung tính ~1,00×. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA tĩnh: 44/44 hàm bảo vệ, 62/62 ID DOM, 21/21 script node --check PASS, kết thúc đúng </html>, diff đúng 1 hunk (1 dòng code + comment này). QA trình duyệt đầy đủ chưa chạy được trong lượt này (headless Chrome bị chặn bởi chính sách Hatch WebGL). Lượt kế: nhóm A. Lab: hidden_files/run_20261124_0144_D/. --- */
var _dbScoreCache = new Map();
/* --- Mở rộng 2026-11-24 (vòng tự động 03:25, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D đầu tiên trên pipeline đa file (zip Drive fileId 1wxh8UvW6qUhZLE2qjJbhZtDQd691dBak, sau C 02:54 trên bản 1 file). Ứng viên D duy nhất: cache phía truy vấn trong dbScore (_dbScoreQCache Map, khóa theo chuỗi truy vấn thô khi typeof q === "string") — trước đây mỗi lần gõ tìm kiếm, dbRenderResults gọi dbScore cho MỌI tai nghe trong DB_PHONES (tới 5.000 mục) và mỗi lần đều tính lại dbNormStr(q) (toLowerCase + normalize NFD + 3 lần replace regex), Q.replace(/ /g,"") và Q.split(" ") dù truy vấn không đổi trong suốt một lần quét; nay tính MỘT lần (Q, qc, qtoks) theo truy vấn rồi dùng lại cho mọi tên — biểu thức tính điểm (+100/+80/+30/+18/+8, thứ tự cộng, điều kiện if (!Q) return 1 sau khi đã tính N như cũ, dbLev giữ nguyên) giữ nguyên từng toán hạng nên mọi điểm GIỐNG TỪNG BIT theo cấu trúc (dbNormStr thuần xác định trên chuỗi; truy vấn không phải chuỗi đi đường không cache, hành vi ném lỗi giữ nguyên). Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0325_D/, 2 lần chạy độc lập): parity 75.520/75.520 GIỐNG TỪNG BIT; tốc độ paired-median xen kẽ 15 vòng trên quét 5.000 tên/truy vấn — xem nhật ký ngày cho số liệu. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Lượt kế: nhóm A. --- */
var _dbScoreQCache = new Map();
/* --- Mở rộng 2026-11-24 (vòng tự động 09:27, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 08:54, BÁC BỎ). Ứng viên D duy nhất: thay _qe.qtoks.forEach(callback) bằng vòng for thường trong dbScore (js/07-database.js) — dbRenderResults gọi dbScore cho MỌI tai nghe trong DB_PHONES (tới 5.000 mục) mỗi lần gõ tìm kiếm, và forEach cấp phát 1 closure mỗi lần gọi (5.000 closure/lần quét) kèm chi phí gọi hàm; vòng for đọc trực tiếp _qe.qtoks[_ti] theo đúng thứ tự 0..n-1, giữ nguyên từng toán hạng/thứ tự cộng (+30/+18/+8, điều kiện if (!tok) continue tương đương return trong callback forEach) nên mọi điểm GIỐNG TỪNG BIT theo cấu trúc. Lab (hidden_files/run_20261124_0924_D/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 49.967/49.967 GIỐNG TỪNG BIT (ma trận truy vấn × tên, biên rỗng/dấu tiếng Việt, non-string q/name, tên ném lỗi, 4.000 fuzz); bench paired-median xen kẽ 15 vòng trên quét 5.000 tên — lần 1 W1 1,0798x/W2 1,0585x/W3 1,0327x/W4 1,0958x/W5 1,0654x/W6 1,0333x (thắng 13–15/15), lần 2 W1 1,0523x/W2 1,0368x/W3 1,0090x/W4 1,1383x/W5 1,0260x/W6 1,0188x (thắng 12–15/15), acc khớp tuyệt đối. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function dbScore(q, name){
  var _qe;
  if (typeof q === "string"){
    _qe = _dbScoreQCache.get(q);
    if (!_qe){
      var _Q0 = dbNormStr(q);
      _qe = { Q: _Q0, qc: _Q0.replace(/ /g, ""), qtoks: _Q0.split(" ") };
      _dbScoreQCache.set(q, _qe);
    }
  } else {
    var _Qn = dbNormStr(q);
    _qe = { Q: _Qn, qc: _Qn.replace(/ /g, ""), qtoks: _Qn.split(" ") };
  }
  var Q = _qe.Q;
  var _nk = String(name || "");
  var _ce = _dbScoreCache.get(_nk);
  if (!_ce){
    var _N0 = dbNormStr(name);
    _ce = { N: _N0, nc: _N0.replace(/ /g, ""), toks: _N0.split(" ") };
    _dbScoreCache.set(_nk, _ce);
  }
  var N = _ce.N, nc = _ce.nc;
  if (!Q) return 1;
  var qc = _qe.qc, score = 0;
  if (N.indexOf(Q) >= 0) score += 100;
  if (nc.indexOf(qc) >= 0) score += 80;
  for (var _ti = 0; _ti < _qe.qtoks.length; _ti++){
    var tok = _qe.qtoks[_ti];
    if (!tok) continue;
    if (_ce.toks.indexOf(tok) >= 0) score += 30;
    else if (nc.indexOf(tok) >= 0) score += 18;
    else {
      var i = 0;
      for (var j = 0; j < nc.length && i < tok.length; j++) if (nc.charCodeAt(j) === tok.charCodeAt(i)) i++; /* vòng tự động 13:54 nhóm D: charCodeAt thay charAt trong vòng subsequence của dbScore — so sánh mã ký tự (số) thay vì cấp phát chuỗi 1 ký tự mỗi ô; nc/tok đã chuẩn hoá về [a-z0-9 ] nên tương đương từng bit */
      if (i === tok.length) score += 8;
    }
  }
  if (Math.abs(qc.length - nc.length) < 8) score += Math.max(0, 24 - dbLevCap8(qc, nc) * 3);
  return score;
}
function dbRenderResults(){
  var q = $("dbSearch").value;
  /* (vòng tự động 03:47, hướng D): truy vấn chuẩn hoá rỗng (trống/khoảng trắng/chỉ dấu câu) -> mọi dbScore đều trả 1 (nhánh if (!Q) return 1), sort ổn định giữ nguyên thứ tự DB_PHONES nên list cũ luôn là [] (khi q.trim() khác rỗng, vì lọc s>10) hoặc 24 mục đầu (khi q trống) — tính trực tiếp, bỏ chấm điểm + sắp xếp 5.000 mục vô ích mỗi lần tải trang/xoá ô tìm. */
  var list;
  if (!dbNormStr(q)){
    list = q.trim() ? [] : DB_PHONES.slice(0, 24).map(function(p){ return { p: p, s: 1 }; });
  } else {
    /* (vòng tự động 12:13, hướng D): gộp vòng lọc s>10 vào vòng chấm điểm — trước đây map toàn bộ DB_PHONES (tới 5.000 mục) thành wrapper {p,s} rồi sort 5.000 mục mới filter; nay chỉ push wrapper khi s>10 rồi sort/slice như cũ. Sort ổn định + filter bảo toàn thứ tự tương đối nên đầu ra GIỐNG TỪNG BIT (kể cả mảng thưa: vòng for + kiểm tra (_di in DB_PHONES) mô phỏng đúng ngữ nghĩa bỏ qua lỗ của map). Đối xứng với vá aeRenderStepResults 08:24 ở js/03-solver.js, áp cho nhánh DB_PHONES chưa từng làm. */
    var scored = [];
    var _n = DB_PHONES.length;
    for (var _di = 0; _di < _n; _di++){
      if (!(_di in DB_PHONES)) continue;
      var _dp = DB_PHONES[_di];
      var _ds = dbScore(q, _dp.name);
      if (_ds > 10) scored.push({ p: _dp, s: _ds });
    }
    scored.sort(function(a, b){ return b.s - a.s; });
    list = q.trim() ? scored.slice(0, 8) : scored.slice(0, 24);
  }
  var cnt = $("dbCount");
  if (cnt) cnt.textContent = q.trim()
    ? "Tìm thấy "+list.length+" tai nghe khớp trong kho dữ liệu thật ("+DB_PHONES.length+" tai nghe — toàn bộ cũng có sẵn ở ô tìm kiếm Bước 1 của AutoEQ)."
    : "Kho dữ liệu thật: "+DB_PHONES.length+" tai nghe — hiển thị "+list.length+"/"+DB_PHONES.length+" đầu tiên (gõ để tìm nhanh trong toàn bộ kho; mọi tai nghe cũng có sẵn ở ô tìm kiếm Bước 1 của AutoEQ).";
  var box = $("dbResults");
  box.innerHTML = "";
  if (!list.length){
    box.innerHTML = '<p class="note" style="margin:4px 0">Không thấy tai nghe khớp “' + q.replace(/</g, "&lt;") + '” trong kho tích hợp — hãy import file đo của bạn ở mục dưới.</p>';
    return;
  }
  list.forEach(function(x){
    var b = document.createElement("button");
    b.className = "dbitem"; b.type = "button";
    b.innerHTML = '<span><span class="nm">' + x.p.name + '</span><span class="mt">' + x.p.brand + " · " + x.p.type + " · " + x.p.source + " · rig " + x.p.rigLabel + '</span></span><span class="rigbadge">' + (x.p.rig === "5128" ? "B&K 5128" : x.p.rig === "711" ? "711" : "rig khác") + '</span>';
    b.addEventListener("click", function(){ dbLoadPhone(x.p); });
    box.appendChild(b);
  });
}
function dbLoadMeasurement(m){
  DB.cur = m;
  aeSetMeasurement(m.points, m.headphone, m.rig, "db5");
  /* Tai nghe vừa nạp trở thành một mục trong danh sách tai nghe Bước 1 của AutoEQ
     và được chọn ngay ở đó — cùng một danh sách với tai nghe tích hợp và mẫu. */
  if (typeof aeRegisterPhone === "function"){
    var isDb = m.format === "database";
    var pid = isDb ? ("db:" + (m.srcKey || "?") + "|" + m.headphone) : ("user:" + m.headphone);
    aeRegisterPhone({ id: pid, name: m.headphone, rig: m.rig, group: isDb ? "db" : "user", points: m.points });
    AE.phoneId = pid;
    if (typeof aeShowSelectedPhone === "function") aeShowSelectedPhone();
    if (typeof aeRenderStepResults === "function") aeRenderStepResults();
  }
  $("dbErr").style.display = "none";
  $("dbInfo").innerHTML = "Đã chọn tai nghe cho AutoEQ: <b>" + String(m.headphone).replace(/</g, "&lt;") + "</b> · rig <b>" + (AE_RIGLBL[m.rig] || m.rig) + "</b> · " + m.points.length + " điểm đo" +
    (m.format ? " · định dạng: <b>" + (DB_FMTLBL[m.format] || m.format) + "</b>" : "") +
    "<br>Nguồn: " + String(m.source).replace(/</g, "&lt;") +
    "<br>Attribution: " + String(m.attribution || "—").replace(/</g, "&lt;") +
    "<br>Tai nghe này đã xuất hiện và đang được chọn trong danh sách Bước 1 của panel AutoEQ. Giờ bạn có thể bấm “Bước 3 — Chạy AutoEQ” ở panel AutoEQ, chạy Hardware Constraint Solver, hoặc xuất file ở panel Universal Export.";
  expMetaLine();
}
function dbLoadPhone(entry){
  var m = { headphone: entry.name, rig: entry.rig, source: entry.source, attribution: entry.attribution, points: aeSamplePoints(entry), format: "database", srcKey: entry.srcKey };
  dbLoadMeasurement(m);
}
/* Đăng ký toàn bộ kho dữ liệu thật vào danh sách tai nghe Bước 1 của AutoEQ
   (Giai đoạn 2) — tìm được ngay ở ô tìm kiếm khi mở trang. AE_REG_BULK chặn
   việc dựng lại danh sách sau từng mục (hơn nghìn mục); dựng một lần ở cuối. */
if (typeof aeRegisterPhone === "function"){
  AE_REG_BULK = true;
  DB_PHONES.forEach(function(p){
    aeRegisterPhone({ id: "db:" + p.srcKey + "|" + p.name, name: p.name, rig: p.rig, group: "db", entry: p });
  });
  AE_REG_BULK = false;
  aeRenderPhoneSelect();
}
/* Lựa chọn mặc định ngay khi mở trang (chạy đồng bộ trong lúc nạp trang, TRƯỚC
   mọi kiểm chứng tự chạy của Giai đoạn 6): chọn sẵn Sennheiser HD 600 + target
   Harman Over-Ear 2018 (đã đặt sẵn trong HTML tĩnh) và nạp đáp tuyến của HD 600
   để đường tai nghe + đường target vẽ ngay lên đồ thị — người dùng không cần
   bấm/chọn gì cũng nhìn thấy tai nghe và target. Chỉ đặt khi chưa có lựa chọn
   nào, không ghi đè lựa chọn người dùng đã đổi trong phiên. */
if (typeof aeSelectPhone === "function" && typeof AE !== "undefined" && !AE.phoneId){
  aeSelectPhone("db:oratory1990|Sennheiser HD 600");
}
/* ---------- Lưu trữ ngoại tuyến: IndexedDB + Service Worker/PWA (Nhóm 5 v2) ----------
   Nguyên tắc: đường nạp kho hiện tại (dbBuildPhones -> DB_PHONES -> AE_PHONES)
   KHÔNG ĐỔI và không chờ IndexedDB — module này chỉ thêm một lớp cache đã
   kiểm chứng bên cạnh: chia kho thành chunk -> ghi IndexedDB -> đọc lại ->
   khôi phục -> đối chiếu chữ ký (số lượng + tên đầu/cuối) với kho nhúng.
   Cache lệch thì báo lệch, không bao giờ ghi đè kho nhúng. Service Worker và
   manifest được SINH RA THẬT từ code (không phải placeholder): sw.js là code
   cache-first hợp lệ, manifest.json là JSON hợp lệ; việc đăng ký SW chỉ có
   thể thành công khi app được phục vụ qua http(s) cùng sw.js — app tự thử
   đúng trong trường hợp đó và báo rõ khi không đủ điều kiện. */
var DB_IDB_NAME = "webAutoEqDb";
var DB_IDB_VER = 1;
var DB_IDB_CHUNK = 200;
var DB_IDB_META_ID = "headphones-v1";
function dbIdbSig(phones){
  if (!phones || !phones.length) return null;
  var first = phones[0] && phones[0].name, last = phones[phones.length - 1] && phones[phones.length - 1].name;
  if (typeof first !== "string" || typeof last !== "string" || !first || !last) return null;
  return { count: phones.length, first: first, last: last };
}
/* --- Mở rộng 2026-11-24 (vòng tự động 22:54, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 22:24, ÁP DỤNG). Ứng viên D duy nhất: bỏ ~605.000 closure map trong dbIdbChunkPhones (js/07-database.js) — trước đây mỗi lần lưu cache IndexedDB, hàm sao chép knots của 5.000 tai nghe (5.000 x 121 diem) bang p.knots.map(function(k){...}) cap phat 605.000 closure moi lan goi; nay mang knots la Array thuong thi sao chep bang vong for + tien cap phat new Array(length) voi gac "ki in knots" giu dung lo mang thua (hole) nhu map, moi phan tu van la [k[0], k[1]] dung tung toan hang; knots khong phai Array (chuoi/array-like khong co map) van di duong p.knots.map goc nen loai/thong diep loi GIONG TUNG BIT. Thu tu lap, dieu kien loc, hinh dang object va vong chunk giu nguyen. Lab (hidden_files/run_20261124_2254_D/lab/, extract verbatim + harness.js + bench3.js): parity 3029/3029 GIONG TUNG BIT (5000 muc that 121 diem, size bien the, phones/knots bien dang, mang thua, 3000 fuzz, so sanh ca thong diep loi); bench paired-median xen ke min-of-5, 21 vong x 3 lan doc lap: 1,1551x/1,4760x/1,8063x (thang 19-20/21), acc khop tuyet doi. Khong cham solver/WASM/FIR/QA logic; aeV3 khong doi theo cau truc (khong do lai; gan nhat 468/482 ms ngay 2026-11-11). QA trinh duyet day du chua chay duoc tren VM (headless Chrome bi chan Hatch WebGL). Luot ke: nhom A. --- */
function dbIdbChunkPhones(phones, size){
  var sz = Math.floor(size);
  if (!isFinite(sz) || sz < 1) sz = DB_IDB_CHUNK;
  if (sz > 1000) sz = 1000;
  var items = [];
  (phones || []).forEach(function(p){
    if (!p || typeof p.name !== "string" || !p.name) return;
    if (!p.knots || !p.knots.length) return;
    var _knots = p.knots, _nk;
    if (Array.isArray(_knots)){
      _nk = new Array(_knots.length);
      for (var _ki = 0; _ki < _knots.length; _ki++){
        if (_ki in _knots){ var _k = _knots[_ki]; _nk[_ki] = [_k[0], _k[1]]; }
      }
    } else {
      _nk = p.knots.map(function(k){ return [k[0], k[1]]; });
    }
    items.push({ name: p.name, brand: p.brand || "", type: p.type || "", rig: p.rig || "",
      rigLabel: p.rigLabel || "", source: p.source || "", srcKey: p.srcKey || "",
      knots: _nk, attribution: p.attribution || "" });
  });
  var chunks = [];
  for (var i = 0; i < items.length; i += sz) chunks.push({ i: chunks.length, items: items.slice(i, i + sz) });
  return chunks;
}
function dbIdbRestorePhones(chunks, meta){
  var gridLen = (typeof DB_GRID !== "undefined" && DB_GRID.length) ? DB_GRID.length : 121;
  var phones = [], rejected = 0;
  if (!chunks || !chunks.length) return { phones: phones, rejected: rejected };
  var sorted = chunks.slice().sort(function(a, b){ return a.i - b.i; });
  sorted.forEach(function(ch){
    (ch.items || []).forEach(function(it){
      var ok = it && typeof it.name === "string" && it.name && it.knots && it.knots.length === gridLen;
      if (ok) for (var k = 0; k < it.knots.length; k++){
        var kp = it.knots[k];
        if (!kp || kp.length !== 2 || !isFinite(kp[0]) || !isFinite(kp[1])){ ok = false; break; }
      }
      if (ok) phones.push(it); else rejected++;
    });
  });
  return { phones: phones, rejected: rejected };
}
function dbIdbVerifyCache(meta, phones){
  if (!meta) return { ok: false, why: "chưa có cache" };
  var sig = dbIdbSig(phones);
  if (!sig) return { ok: false, why: "kho hiện tại rỗng" };
  if (meta.count !== sig.count) return { ok: false, why: "số lượng lệch (cache " + meta.count + " ≠ kho " + sig.count + ")" };
  if (meta.first !== sig.first || meta.last !== sig.last) return { ok: false, why: "tên đầu/cuối lệch" };
  if (!meta.chunks || meta.chunks < 1) return { ok: false, why: "cache không có chunk" };
  return { ok: true, why: "khớp " + sig.count + " tai nghe" };
}
function dbIdbManifest(){
  return { name: "Web AutoEQ — DSP Core", short_name: "Web AutoEQ", start_url: ".", scope: ".",
    display: "standalone", background_color: "#0b0e13", theme_color: "#0b0e13",
    description: "Web AutoEQ — DSP Core: PEQ 10/20 band, AutoEQ, psychoacoustics, database tai nghe và export.",
    icons: [] };
}
function dbIdbSwSource(){
  return ["/* Web AutoEQ — Service Worker (sinh từ app, Nhóm 5 v2) */",
    "var CACHE = 'web-autoeq-v1';",
    "self.addEventListener('install', function(e){",
    "  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(['./', './manifest.json']); }).catch(function(){ }));",
    "  self.skipWaiting();",
    "});",
    "self.addEventListener('activate', function(e){",
    "  e.waitUntil(caches.keys().then(function(keys){ return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); })); }));",
    "  self.clients.claim();",
    "});",
    "self.addEventListener('fetch', function(e){",
    "  if (e.request.method !== 'GET') return;",
    "  try { if (new URL(e.request.url).origin !== self.location.origin) return; } catch (err) { return; }",
    "  e.respondWith(caches.match(e.request).then(function(r){ return r || fetch(e.request); }));",
    "});"].join("\n");
}
function dbIdbOpen(cb, eb){
  if (typeof indexedDB === "undefined"){ eb(new Error("trình duyệt không hỗ trợ IndexedDB")); return; }
  var req;
  try { req = indexedDB.open(DB_IDB_NAME, DB_IDB_VER); }
  catch (e){ eb(e); return; }
  req.onupgradeneeded = function(){
    var db = req.result;
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
    if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: "i" });
  };
  req.onsuccess = function(){ cb(req.result); };
  req.onerror = function(){ eb(req.error || new Error("không mở được IndexedDB")); };
}
function dbIdbSave(phones, cb, eb){
  var chunks = dbIdbChunkPhones(phones, DB_IDB_CHUNK);
  var sig = dbIdbSig(phones);
  if (!sig){ eb(new Error("kho hiện tại rỗng, không lưu cache")); return; }
  dbIdbOpen(function(db){
    var tx;
    try { tx = db.transaction(["meta", "chunks"], "readwrite"); }
    catch (e){ eb(e); return; }
    tx.objectStore("meta").put({ id: DB_IDB_META_ID, count: sig.count, first: sig.first, last: sig.last,
      chunks: chunks.length, savedAt: new Date().toISOString() });
    var cs = tx.objectStore("chunks");
    cs.clear();
    chunks.forEach(function(ch){ cs.put(ch); });
    tx.oncomplete = function(){ cb({ count: sig.count, chunks: chunks.length }); };
    tx.onerror = function(){ eb(tx.error || new Error("ghi cache thất bại")); };
  }, eb);
}
function dbIdbLoad(cb, eb){
  dbIdbOpen(function(db){
    var tx;
    try { tx = db.transaction(["meta", "chunks"], "readonly"); }
    catch (e){ eb(e); return; }
    var metaReq = tx.objectStore("meta").get(DB_IDB_META_ID);
    var chunkReq = tx.objectStore("chunks").getAll();
    tx.oncomplete = function(){
      var meta = metaReq.result || null;
      if (!meta){ cb({ meta: null, phones: [], rejected: 0 }); return; }
      var restored = dbIdbRestorePhones(chunkReq.result || [], meta);
      cb({ meta: meta, phones: restored.phones, rejected: restored.rejected });
    };
    tx.onerror = function(){ eb(tx.error || new Error("đọc cache thất bại")); };
  }, eb);
}
function dbIdbClear(cb, eb){
  dbIdbOpen(function(db){
    var tx;
    try { tx = db.transaction(["meta", "chunks"], "readwrite"); }
    catch (e){ eb(e); return; }
    tx.objectStore("meta").clear();
    tx.objectStore("chunks").clear();
    tx.oncomplete = function(){ cb(); };
    tx.onerror = function(){ eb(tx.error || new Error("xoá cache thất bại")); };
  }, eb);
}
function dbIdbSetStatus(t){
  var el = $("dbIdbStatus"); if (el) el.textContent = t;
}
function dbIdbSetSwStatus(t){
  var el = $("dbIdbSwStatus"); if (el) el.textContent = t;
}
function dbIdbSelfCheck(){
  var gridLen = (typeof DB_GRID !== "undefined" && DB_GRID.length) ? DB_GRID.length : 121;
  var mk = function(name, base){
    var ks = [];
    for (var i = 0; i < gridLen; i++) ks.push([20 * Math.pow(2, i / 12), base + Math.sin(i) * 0.5]);
    return { name: name, brand: "Test", type: "Over-ear", rig: "711", rigLabel: "711",
      source: "test", srcKey: "test", knots: ks, attribution: "test" };
  };
  var syn = [mk("A", 0), mk("B", 1), mk("C", -1), mk("D", 2), mk("E", 0.5)];
  var ch = dbIdbChunkPhones(syn, 2);
  if (ch.length !== 3) return { ok: false, text: "chunk 5 mục/size 2 phải ra 3 chunk, được " + ch.length };
  var rs = dbIdbRestorePhones(ch, null);
  if (rs.phones.length !== 5 || rs.rejected !== 0) return { ok: false, text: "khôi phục tổng hợp phải đủ 5 mục, 0 loại — được " + rs.phones.length + " mục, loại " + rs.rejected };
  var maxD = 0;
  for (var i = 0; i < 5; i++){
    if (rs.phones[i].name !== syn[i].name) return { ok: false, text: "thứ tự tên sau khôi phục lệch tại mục " + i };
    for (var k = 0; k < gridLen; k++) maxD = Math.max(maxD, Math.abs(rs.phones[i].knots[k][1] - syn[i].knots[k][1]));
  }
  if (maxD !== 0) return { ok: false, text: "knots sau khôi phục lệch tối đa " + maxD + " dB, phải bằng 0" };
  var sig = dbIdbSig(syn);
  var meta = { count: sig.count, first: sig.first, last: sig.last, chunks: 3 };
  if (!dbIdbVerifyCache(meta, syn).ok) return { ok: false, text: "verify phải ĐẠT với meta khớp" };
  var bad = { count: sig.count + 1, first: sig.first, last: sig.last, chunks: 3 };
  if (dbIdbVerifyCache(bad, syn).ok) return { ok: false, text: "verify phải BẮT được meta lệch số lượng" };
  var realTxt = "";
  if (typeof DB_PHONES !== "undefined" && DB_PHONES.length){
    var real = DB_PHONES.slice(0, 300);
    var chR = dbIdbChunkPhones(real, 200);
    var rsR = dbIdbRestorePhones(chR, null);
    if (rsR.phones.length !== real.length || rsR.phones[0].name !== real[0].name || rsR.phones[real.length - 1].name !== real[real.length - 1].name)
      return { ok: false, text: "kho thật: khôi phục " + rsR.phones.length + "/" + real.length + " mục, tên đầu/cuối lệch" };
    realTxt = " · kho thật: " + real.length + " mục qua " + chR.length + " chunk, khôi phục đủ, tên đầu/cuối khớp";
  }
  var man = dbIdbManifest();
  try { if (JSON.parse(JSON.stringify(man)).name !== man.name) return { ok: false, text: "manifest JSON round-trip lệch" }; }
  catch (e){ return { ok: false, text: "manifest JSON không hợp lệ: " + e.message }; }
  var sw = dbIdbSwSource();
  if (sw.indexOf("install") < 0 || sw.indexOf("fetch") < 0 || sw.indexOf("web-autoeq-v1") < 0)
    return { ok: false, text: "sw.js thiếu install/fetch/cache web-autoeq-v1" };
  return { ok: true, text: "chunk/restore tổng hợp 5 mục qua 3 chunk, lệch knots tối đa 0 dB, verify bắt được meta lệch" + realTxt + " · manifest JSON hợp lệ · sw.js chứa install/fetch/cache web-autoeq-v1" };
}
/* --- Dây nối UI + hành vi tự động (không chặn đường nạp kho) --- */
(function dbIdbWire(){
  var saveBtn = $("dbIdbSaveBtn"), verBtn = $("dbIdbVerifyBtn"), clrBtn = $("dbIdbClearBtn"),
      swBtn = $("dbSwBtn"), manBtn = $("dbManifestBtn");
  if (saveBtn) saveBtn.addEventListener("click", function(){
    dbIdbSave(DB_PHONES, function(r){ dbIdbSetStatus("Đã lưu cache IndexedDB: " + r.count + " tai nghe qua " + r.chunks + " chunk."); },
      function(e){ dbIdbSetStatus("Lưu cache thất bại: " + e.message); });
  });
  if (verBtn) verBtn.addEventListener("click", function(){
    dbIdbLoad(function(r){
      if (!r.meta){ dbIdbSetStatus("Chưa có cache IndexedDB — bấm “Lưu kho vào IndexedDB” để tạo."); return; }
      var v = dbIdbVerifyCache(r.meta, DB_PHONES);
      dbIdbSetStatus(v.ok ? ("Cache IndexedDB khớp: " + v.why + " · khôi phục được " + r.phones.length + " mục, loại " + r.rejected + " mục hỏng.")
        : ("Cache IndexedDB LỆCH: " + v.why + " — bấm “Lưu kho vào IndexedDB” để cập nhật (kho nhúng trong file vẫn là nguồn chính, không bị ảnh hưởng)."));
    }, function(e){ dbIdbSetStatus("Kiểm tra cache thất bại: " + e.message); });
  });
  if (clrBtn) clrBtn.addEventListener("click", function(){
    dbIdbClear(function(){ dbIdbSetStatus("Đã xoá cache IndexedDB (kho nhúng trong file không đổi)."); },
      function(e){ dbIdbSetStatus("Xoá cache thất bại: " + e.message); });
  });
  if (swBtn) swBtn.addEventListener("click", function(){
    dlText("sw.js", dbIdbSwSource(), "application/javascript");
    dbIdbSetSwStatus("Đã tải sw.js — đặt file này cạnh file app và mở app qua https, Service Worker mới đăng ký được (file:// và xem trước Drive không cho đăng ký SW).");
  });
  if (manBtn) manBtn.addEventListener("click", function(){
    dlText("manifest.json", JSON.stringify(dbIdbManifest(), null, 2), "application/json");
    dbIdbSetSwStatus("Đã tải manifest.json — đặt cạnh file app; manifest chưa có icon nên trình duyệt có thể chưa đề xuất cài đặt cho tới khi thêm icon 192/512 px.");
  });
  /* Tự động khi mở app: kiểm tra cache rồi tự lưu nếu chưa có/lệch; thử đăng
     ký SW chỉ khi đang ở http(s). Toàn bộ bọc try/catch, không bao giờ động
     tới DB_PHONES hay AE_PHONES. */
  setTimeout(function(){
    try {
      if (typeof indexedDB === "undefined"){
        dbIdbSetStatus("IndexedDB không khả dụng trên trình duyệt này — kho vẫn dùng bản nhúng trong file (không đổi hành vi).");
      } else {
        dbIdbLoad(function(r){
          if (!r.meta){
            dbIdbSave(DB_PHONES, function(s){ dbIdbSetStatus("Đã tự lưu cache IndexedDB: " + s.count + " tai nghe qua " + s.chunks + " chunk."); },
              function(e){ dbIdbSetStatus("Tự lưu cache thất bại: " + e.message); });
          } else {
            var v = dbIdbVerifyCache(r.meta, DB_PHONES);
            dbIdbSetStatus(v.ok ? ("Cache IndexedDB khớp: " + v.why + " (tự kiểm tra khi mở app).")
              : ("Cache IndexedDB lệch (" + v.why + ") — đang tự lưu lại…"));
            if (!v.ok) dbIdbSave(DB_PHONES, function(s){ dbIdbSetStatus("Đã tự lưu lại cache IndexedDB: " + s.count + " tai nghe qua " + s.chunks + " chunk."); },
              function(e){ dbIdbSetStatus("Tự lưu lại cache thất bại: " + e.message); });
          }
        }, function(e){ dbIdbSetStatus("Tự kiểm tra cache thất bại: " + e.message); });
      }
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator && /^https?:/.test(location.protocol)){
        navigator.serviceWorker.register("sw.js").then(function(){
          dbIdbSetSwStatus("Service Worker đã đăng ký (sw.js cạnh app, qua https).");
        }, function(e){
          dbIdbSetSwStatus("Service Worker chưa đăng ký được (" + e.message + ") — tải sw.js và đặt cạnh file app rồi mở qua https.");
        });
      } else {
        dbIdbSetSwStatus("Service Worker chưa đăng ký: chỉ đăng ký được khi mở app qua http(s) với sw.js đặt cạnh file (file:// và xem trước Drive không cho đăng ký).");
      }
    } catch (e){ dbIdbSetStatus("Tự kiểm tra cache gặp lỗi: " + e.message); }
  }, 0);
})();

$("dbSearch").addEventListener("input", function(){ var el=this; clearTimeout(el._srT); el._srT=setTimeout(dbRenderResults, 80); });
$("dbFile").addEventListener("change", function(){
  var f = this.files && this.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function(){
    try {
      var parsed = dbParseMeasurement(String(rd.result || ""), f.name);
      var rigSel = $("dbRigSel").value;
      var rig = rigSel !== "auto" ? rigSel : (parsed.rigGuess || "other");
      var name = parsed.nameGuess || f.name.replace(/\.(csv|txt)$/i, "");
      dbLoadMeasurement({ headphone: name, rig: rig, source: "File import của người dùng: " + f.name + " (" + DB_FMTLBL[parsed.format] + ")", attribution: DB_FMTATTR[parsed.format], points: parsed.points, format: parsed.format });
    } catch (err) {
      var eb = $("dbErr"); eb.textContent = "Không đọc được file đo: " + err.message; eb.style.display = "block";
    }
  };
  rd.onerror = function(){ var eb = $("dbErr"); eb.textContent = "Không đọc được file đã chọn."; eb.style.display = "block"; };
  rd.readAsText(f);
});
dbRenderResults();
/* ---------- Panel Kiểm định dữ liệu: mọi con số đều đếm THẬT từ dữ liệu đã nhúng ---------- */
function dvRender(){
  var B = (typeof DB_BUILD !== "undefined") ? DB_BUILD : null;
  if (!B || !$("dvCand")) return;
  $("dvCand").textContent = B.candidates;
  $("dvPass").textContent = B.passed;
  $("dvRej").textContent = B.rejected;
  $("dvTargets").textContent = Object.keys(AE_TARGETS).length + " target";
  $("dvRuntime").textContent = DB_PHONES.length + " đạt / " + DB_RUNTIME_REJECTED.length + " bị loại thêm";
  var rows = "<tr><th>Nguồn đo (trong AutoEq)</th><th>Đạt &amp; đã nhúng</th><th>Bị loại lúc đóng gói</th></tr>";
  Object.keys(B.perSource).sort().forEach(function(k){
    rows += "<tr><td style=\"text-align:left\">" + k + "</td><td>" + B.perSource[k].pass + "</td><td>" + B.perSource[k].reject + "</td></tr>";
  });
  $("dvPerSource").innerHTML = rows;
  var rk = Object.keys(B.rejectReasons);
  var rj = "<b>Lý do loại lúc đóng gói:</b> " + (rk.length ? rk.map(function(k){ return k + ": " + B.rejectReasons[k] + " mục"; }).join(" · ") : "không có mục nào bị loại");
  if (B.quotaCut) rj += "<br>Ngoài ra " + B.quotaCut + " mục đã ĐẠT kiểm định nhưng không nhúng vì giới hạn dung lượng trang (quota 1.600 mục — ưu tiên toàn bộ oratory1990, các nguồn còn lại lấy dàn trải khắp danh mục của nguồn).";
  if (DB_RUNTIME_REJECTED.length) rj += "<br><b>Loại thêm khi app kiểm định lại lúc nạp:</b> " + DB_RUNTIME_REJECTED.slice(0, 8).map(function(x){ return x.n + " (" + x.r + ")"; }).join(" · ");
  rj += "<br><b>Ví dụ mục bị loại:</b> " + B.rejectExamples.slice(0, 10).map(function(x){ return x.n + " — " + x.s + ": " + x.r; }).join(" · ");
  $("dvRejects").innerHTML = rj;
  $("dvNote").innerHTML = "Nguồn dữ liệu: <b>" + B.repo + "</b> · ngày lấy dữ liệu: <b>" + B.date + "</b> · " + B.gridNote + ". Đây là <b>toàn bộ phần dữ liệu đo công khai mà app đã lấy được từ các nguồn trên</b> tại ngày lấy (sau kiểm định và quota dung lượng) — <b>không phải mọi tai nghe từng sản xuất trên thị trường</b>: nhiều mẫu không có dữ liệu đo công khai, và thư mục crinacle trong repo AutoEq không kèm file đáp tuyến thô (chỉ có preset EQ / IR) nên dữ liệu đo của Crinacle không nằm trong kho này.";
}
dvRender();
/* ================================================================
   5.4 — HARDWARE CONSTRAINT SOLVER (registry dữ liệu)
   Thêm thiết bị = thêm một mục vào HW_PROFILES. Khi xuất cho thiết
   bị bị giới hạn, solver Giai đoạn 2 chạy LẠI với ràng buộc profile
   (giao của ràng buộc profile với safety Giai đoạn 2) — không cắt band.
   ================================================================ */
var HW_PROFILES = {
  generic: { name:"Generic — Không giới hạn", maxBands:32, types:["lowshelf","peaking","highshelf"], fcMin:10, fcMax:24000, fcStep:null, gainMin:-24, gainMax:24, gainStep:null, qMin:0.10, qMax:20, qStep:null,
    note:"Không ràng buộc phần cứng — dùng làm mốc đối chiếu delta error." },
  qudelix5k: { name:"Qudelix-5K", maxBands:20, types:["lowshelf","peaking","highshelf"], fcMin:10, fcMax:20000, fcStep:1, gainMin:-12, gainMax:12, gainStep:0.1, qMin:0.25, qMax:15, qStep:null,
    note:"PEQ 20 band của Qudelix-5K (khai báo trong registry của app). 20 band xử lý ở tầng preset/xuất file; nghe thử trong app áp đủ 20 band khi engine ở chế độ 20 band, hoặc 10 band đầu ở chế độ 10 band mặc định." },
  fioBtr15: { name:"FiiO BTR15", maxBands:10, types:["lowshelf","peaking","highshelf"], fcMin:20, fcMax:20000, fcStep:1, gainMin:-12, gainMax:12, gainStep:0.1, qMin:0.5, qMax:10, qStep:null,
    note:"PEQ 10 band của FiiO BTR15 qua FiiO Control (khai báo trong registry của app) — cùng số band với engine nên nghe thử khớp 1:1." },
  moondropDsp: { name:"Moondrop DSP", maxBands:8, types:["peaking"], fcMin:20, fcMax:20000, fcStep:1, gainMin:-12, gainMax:12, gainStep:0.1, qMin:0.5, qMax:8, qStep:null,
    note:"Moondrop DSP chỉ chấp nhận filter peaking, tối đa 8 band (khai báo trong registry của app) — shelf của bản gốc được solver tối ưu lại thành peaking, không bị cắt bỏ." }
};
var HW = { last: null };
function hwClampBand(b, P){
  if (P.types.indexOf(b.type) < 0) b.type = P.types.indexOf("peaking") >= 0 ? "peaking" : P.types[0];
  var fLo = Math.max(AE_FMIN, P.fcMin), fHi = Math.min(AE_FMAX, P.fcMax);
  b.freq = Math.min(fHi, Math.max(fLo, b.freq));
  b.gain = Math.min(P.gainMax, Math.max(P.gainMin, b.gain));
  b.q = Math.min(P.qMax, Math.max(P.qMin, b.q));
  aeClampBand(b); /* safety Giai đoạn 2: gain ±12 toàn cục, >6 kHz gain ±8 & Q ≤ 6 */
  if (P.fcStep) b.freq = Math.round(b.freq / P.fcStep) * P.fcStep;
  if (P.gainStep) b.gain = Math.round(b.gain / P.gainStep) * P.gainStep;
  if (P.qStep) b.q = Math.round(b.q / P.qStep) * P.qStep;
  b.freq = Math.min(fHi, Math.max(fLo, b.freq));
  b.gain = Math.min(P.gainMax, Math.max(P.gainMin, b.gain));
  b.q = Math.min(P.qMax, Math.max(P.qMin, b.q));
  return b;
}
function hwInitBands(P, nB){
  var out = [], hasLS = P.types.indexOf("lowshelf") >= 0, hasHS = P.types.indexOf("highshelf") >= 0, hasPK = P.types.indexOf("peaking") >= 0;
  var lo = hasLS && nB >= 2, hi = hasHS && nB >= 2;
  if (lo && hi && nB < 3) hi = false;
  var nMid = nB - (lo ? 1 : 0) - (hi ? 1 : 0), i;
  if (lo) out.push({ type:"lowshelf", freq:105, gain:0, q:0.707 });
  for (i = 0; i < nMid; i++){
    var ff = nMid === 1 ? 1000 : 150 * Math.pow(10000 / 150, i / (nMid - 1));
    out.push({ type: hasPK ? "peaking" : P.types[0], freq: ff, gain: 0, q: 1.1 });
  }
  if (hi) out.push({ type:"highshelf", freq:10000, gain:0, q:0.707 });
  if (!out.length) out.push({ type: P.types[0], freq:1000, gain:0, q:1 });
  out.forEach(function(b){ hwClampBand(b, P); });
  return out;
}
/* Cùng thuật toán với aeSolve (RLS + Nelder–Mead) nhưng clamp theo profile.
   Khác biệt cần thiết khi số band lớn (Qudelix 20 band): Nelder–Mead từng band
   (tìm kiếm theo tọa độ) có thể mắc kẹt ở cực trị cục bộ dạng "chồng band triệt
   tiêu nhau" ở vùng bass. Vì vậy giữa các vòng NM có bước tái cân bằng gain
   toàn cục bằng LS suy giảm (damped) — chỉ giữ lại nếu hàm mục tiêu thật giảm. */
/* (vòng tự động 12:57, hướng A — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên đổi 3 điểm 10*Math.log10 trong lsGainStep của hwSolve (Jm gain+1/gain gốc 2 điểm + tot cuối 1 điểm) sang Math.log(x)*4.342944819032518 — Lab Node trên hàm thật trích verbatim (hidden_files/run_20261123_1254/, 2 lần độc lập): parity 32 fixture (8 dạng err × 4 profile generic/qudelix5k/fioBtr15/moondropDsp) lệch RMS tối đa 2,44e-12 dB, lệch band tối đa 5,18e-10 (mức ulp), 25/32 giống từng bit (7 ca generic không lượng tử hoá lệch ulp, profile có bước lượng tử hoá giống hệt); bench toàn hwSolve paired-median 9 vòng: lần 1 (2 process) 1,0175×/1,0157× thắng 7/9 cả hai, lần 2 (2 process) 1,0059× thắng 7/9 và 0,9794× thắng 5/9 — không cải thiện ổn định → BÁC, không vá code. KHÔNG thử lại hướng đổi log10 trong lsGainStep. Lượt kế: nhóm B. */
/* (vòng tự động 14:24, hướng A — ÁP DỤNG, vá code): port objectiveS nửa lưới (chỉ số chẵn) từ aeSolveSingle sang vòng Nelder-Mead của hwSolve — trước đây mọi đánh giá NM dùng objective đủ lưới 240 điểm; nay các đánh giá trong vòng lặp NM (khởi tạo simplex, phản xạ/mở rộng/co/thu) dùng objectiveS (vòng k2+=2, chuẩn hoá bằng sumW2 = tổng trọng số chỉ số chẵn, cùng số hạng reg/qPen, cùng hwBase dùng chung), còn bước CHẤP NHẬN vẫn dùng objective đủ lưới (objective(bi,best) <= objective(bi,b)) như aeSolveSingle nên mỗi band chỉ được nhận khi hàm mục tiêu thật không tệ hơn — quỹ đạo NM đổi nhẹ (KHÔNG giống từng bit, cùng tiền lệ objectiveS của aeSolveSingle 2026-11-02). Lab Node trên hàm thật trích verbatim, file plain không vm (hidden_files/run_20261124_1424_A/, 2 lần bench độc lập): chất lượng trên 12 fixture (3 dạng err × 4 profile moondropDsp/qudelix5k/fioBtr15/generic, W có vùng null = 0) — RMS sau tối ưu trung bình tốt hơn -0,0022 dB, tệ nhất +0,0045 dB (s1_qudelix5k), viol 0/0 mọi fixture, all-peaking đúng cho moondropDsp, số band giữ nguyên; tốc độ toàn hwSolve paired-median 15 vòng: lần 1 tổng median 232,096 -> 140,291 ms (1,654x), lần 2 223,782 -> 141,061 ms (1,586x), từng fixture 1,46-1,98x cả 2 lần — cải thiện ổn định. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm B. Lab: hidden_files/run_20261124_1424_A/. --- */
function hwSolve(freqs, errDb, W, P){
  var t0 = performance.now();
  var nB = Math.min(P.maxBands, 24);
  var bands = hwInitBands(P, nB);
  var n = freqs.length, i, k, sumW = 0, sumW2 = 0;
  for (i = 0; i < n; i++) sumW += W[i];
  for (i = 0; i < n; i += 2) sumW2 += W[i];
  var tot = aeTotalCurve(bands, freqs);
  /* Ridge λ phải tỉ lệ với độ lớn của JᵀWJ (λ tương đối × trung bình đường chéo):
     λ tuyệt đối 0.35 của aeSolve chỉ đủ khi band ít và thưa; với 18-20 band sát
     nhau, JᵀWJ gần suy biến và nghiệm LS phát nổ thành chồng band triệt tiêu. */
  function lsGainStep(relLambda){
    var m = bands.length;
    /* --- Tối ưu tốc độ Jm của lsGainStep trong hwSolve (vòng tự động 13:48,
         hướng A; port cùng kỹ thuật inline 12:24/13:20): trước đây mỗi band
         gọi aeBandCurve 2 lần (gain+1 và gain gốc), mỗi lần cấp phát 1 mảng
         240 điểm rồi mới trừ từng cặp qua .map. Nay tính trực tiếp trong 1
         vòng: 2 bộ hệ số rbjCoeffs (gain+1 / gain gốc, đúng fs AE_FS mặc
         định của aeBandCurve) rồi cùng công thức biquadMagDb của aeBandCurve
         (cùng thứ tự b0+b1*C1+b2*C2, cùng num/max(1e-30,den), cùng
         10*Math.log10) trên cùng cache lượng giác freqs._cw — cache vẫn do
         1 lần gọi aeBandCurve xây khi chưa có (như 13:20). Mọi số double
         của Jm giống hệt bản gốc nên A/rhs, bước LS, gains và RMS sau giống
         hệt; chỉ bớt cấp phát 2m mảng + 2m lần gọi hàm + m closure .map.
         Lab Node trên hàm thật (lượt 13:48, 2 lần): 42 ô (7 tai nghe x 3
         profile x 2 target) RMS sau giống hệt tới 4 chữ số thập phân,
         maxBandDiff = 0, viol 0; aeBandCurve/lần giải 460 -> 260 (-43%);
         throughput 20 lần giải liên tiếp 76,7 -> 72,8 ms (lần 1) và
         73,2 -> 72,2 ms (lần 2), mới nhanh hơn ở 5/6 vòng đo (~1,03x).
         Ý tưởng lượt kế: hướng B — rà soát buildFirTaps/bù pha sau khi
         hwSolve nhanh hơn; hoặc hướng A — inline tot = aeTotalCurve cuối
         lsGainStep / hợp nhất vòng tính Jm vào vòng cộng dồn A/rhs.
         (Thí nghiệm 14:05 — ĐÃ THỬ, KHÔNG ÁP: hợp nhất vòng Jm vào vòng
         A/rhs, bỏ mảng Jm m×n, tính Jk[m] theo từng điểm k rồi cộng dồn
         ngay. Lab Node 2 lần: 42 ô RMS sau giống hệt tới 4 chữ số thập
         phân, maxBandDiff = 0, viol 0 — nhưng throughput không cải thiện:
         72,3 → 72,5 ms/lần giải trung bình 2 lần đo, mới nhanh hơn 3/6
         vòng đo (trong nhiễu); phần lớn thời gian còn nằm ở log10 và
         objective NM, không ở cấp phát Jm. Không lặp lại nhánh này.) --- */
    if (m && (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== AE_FS)) aeBandCurve(bands[0], freqs);
    var C1 = freqs._cw, S1 = freqs._sw, C2 = freqs._cw2, S2 = freqs._sw2;
    /* (vong tu dong 10:54, huong A): bo tinh cvb khi band co gain 0 trong vong Jm cua lsGainStep trong hwSolve (port ky thuat aeSolveSingle 09:54 sang hwSolve) - rbjCoeffs tra identity {1,0,0,0,0} cho gain 0 o peaking/lowshelf/highshelf (fast-path san co, ke ca khi freq/Q/fs khong huu han vi nhanh identity dau ham) nen cvb = 10*log10(1) = +0 chinh xac tung diem va Jm = cvp - 0 = cvp; nay khi b.gain===0 va type thuoc 3 ho do (va 4 mang trig huu han - chi kiem tra khi ton tai band gain 0, de duong gain khac 0 khong ton gi them; NaN/Infinity trong freqs/trig van roi ve duong goc tinh cvb nhu cu) chi tinh cvp, ghi row = cvp - cung tung double voi ban goc (x-0===x ke ca -0/NaN/Infinity); band gain khac 0 hoac type khac giu nguyen vong goc tung ky tu. Khong tham chieu bien ngoai moi (chi rbjCoeffs/AE_FS da co) nen parity Worker giu nguyen. */
    var _anyZero = false;
    for (var _bi0 = 0; _bi0 < m; _bi0++){ var _b0 = bands[_bi0]; if (_b0 && _b0.gain === 0 && (_b0.type === "peaking" || _b0.type === "lowshelf" || _b0.type === "highshelf")){ _anyZero = true; break; } }
    var _rFin = !_anyZero || !!C1;
    for (var _fi2 = 0; _anyZero && _rFin && _fi2 < n; _fi2++){ if (!isFinite(C1[_fi2]) || !isFinite(S1[_fi2]) || !isFinite(C2[_fi2]) || !isFinite(S2[_fi2])){ _rFin = false; break; } }
    var Jm = new Array(m);
    for (var bi = 0; bi < m; bi++){
      var b = bands[bi];
      var cp = rbjCoeffs(b.type, b.freq, b.gain + 1, b.q, AE_FS);
      var cb = rbjCoeffs(b.type, b.freq, b.gain, b.q, AE_FS);
      var _zero = _anyZero && _rFin && b.gain === 0 && (b.type === "peaking" || b.type === "lowshelf" || b.type === "highshelf");
      var row = new Array(n);
      if (_zero){
        for (var k = 0; k < n; k++){
          var nrp = cp.b0 + cp.b1*C1[k] + cp.b2*C2[k], nip = cp.b1*S1[k] + cp.b2*S2[k];
          var drp = 1 + cp.a1*C1[k] + cp.a2*C2[k], dip = cp.a1*S1[k] + cp.a2*S2[k];
          var cvp = 10*Math.log10((nrp*nrp+nip*nip)/Math.max(1e-30, drp*drp+dip*dip));
          row[k] = cvp;
        }
      } else {
        for (var k = 0; k < n; k++){
          var nrp = cp.b0 + cp.b1*C1[k] + cp.b2*C2[k], nip = cp.b1*S1[k] + cp.b2*S2[k];
          var drp = 1 + cp.a1*C1[k] + cp.a2*C2[k], dip = cp.a1*S1[k] + cp.a2*S2[k];
          var cvp = 10*Math.log10((nrp*nrp+nip*nip)/Math.max(1e-30, drp*drp+dip*dip));
          var nrb = cb.b0 + cb.b1*C1[k] + cb.b2*C2[k], nib = cb.b1*S1[k] + cb.b2*S2[k];
          var drb = 1 + cb.a1*C1[k] + cb.a2*C2[k], dib = cb.a1*S1[k] + cb.a2*S2[k];
          var cvb = 10*Math.log10((nrb*nrb+nib*nib)/Math.max(1e-30, drb*drb+dib*dib));
          row[k] = cvp - cvb;
        }
      }
      Jm[bi] = row;
    }
    var A = [], rhs = new Array(m).fill(0);
    for (i = 0; i < m; i++) A.push(new Array(m).fill(0));
    /* (vòng tự động 19:01, hướng A — ÁP DỤNG, vá code): chuyển vị Jm trước vòng dựng ma trận chuẩn của lsGainStep trong hwSolve khi m>=8 (port kỹ thuật aeSolveSingle 18:33 sang hwSolve) — trước đây vòng A/rhs đọc Jm[i][k] và Jm[j2][k] theo cột (bước nhảy giữa các hàng Jm) cho mọi điểm lưới; nay khi m>=8 (đường hwSolve thật tới 20-24 band) tính MỘT lần mảng chuyển vị _Jt (n hàng × m cột, _Jt[k][i]=Jm[i][k] — phép gán sao chép đúng từng double) rồi vòng A/rhs đọc _Jt[k][i]/_Jt[k][j2] tuần tự trong cùng hàng; thứ tự vòng k/i/j2, biểu thức _wji=wk*Jm[i][k], rhs[i]+=_wji*r và A[i][j2]+=_wji*Jm[j2][k] giữ nguyên từng toán hạng/thứ tự nên A/rhs GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, mảng thưa); m<8 giữ nguyên vòng gốc. Không tham chiếu biến ngoài mới. Lab Node trên khối trích verbatim (harness.js + bench2.js trong hidden_files/run_20261123_1859_A/, 2 lần chạy độc lập): parity 256 ca / 25.104 kiểm tra GIỐNG TỪNG BIT cả 2 lần (Object.is trên A/rhs; gồm m=0/1/2/3/5/8/10/13/20 × n=0/1/3/9/64/240, W=0/âm/NaN/Infinity, Jm/tot/errDb NaN/±Infinity/-0/1e308/subnormal, mảng thưa, 40 fuzz); tốc độ paired-median xen kẽ 15 vòng (bench2, warmup 30): lần 1 W10 1,0718x (10/15), W20 1,2119x (13/15), W10z 1,0588x (14/15), W12 1,1313x (15/15), W8 1,0429x (14/15); lần 2 (flip thứ tự) W10 1,0446x (12/15), W20 1,2095x (15/15), W10z 1,0593x (14/15), W12 1,1062x (15/15), W8 1,0473x (15/15) — cải thiện ổn định mọi workload m>=8 cả 2 lần; m<8 giữ nguyên vòng gốc nên không áp chuyển vị (bench2 chuyển vị vô điều kiện cho m=5/6 chậm 0,93-0,97x như kỳ vọng). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
    if (m >= 8) {
      var _Jt = new Array(n);
      for (var _tk = 0; _tk < n; _tk++) {
        var _trow = new Array(m);
        for (var _ti = 0; _ti < m; _ti++) _trow[_ti] = Jm[_ti][_tk];
        _Jt[_tk] = _trow;
      }
      for (k = 0; k < n; k++){
        var r = errDb[k] - tot[k], wk = W[k]; if (wk <= 0) continue;
        var _Jk = _Jt[k];
        for (i = 0; i < m; i++){
          var _wji = wk * _Jk[i];
          rhs[i] += _wji * r;
          for (var j2 = i; j2 < m; j2++) A[i][j2] += _wji * _Jk[j2];
        }
      }
    } else {
      for (k = 0; k < n; k++){
        var r = errDb[k] - tot[k], wk = W[k]; if (wk <= 0) continue;
        for (i = 0; i < m; i++){
          var _wji = wk * Jm[i][k];
          rhs[i] += _wji * r;
          for (var j2 = i; j2 < m; j2++) A[i][j2] += _wji * Jm[j2][k];
        }
      }
    }
    /* (vòng tự động 17:24, hướng A — ÁP DỤNG, vá code): hoist tích wk*Jm[i][k] trong vòng dựng ma trận chuẩn của lsGainStep trong hwSolve (port kỹ thuật aeSolveSingle 16:13 sang hwSolve) — trước đây mỗi điểm lưới k và mỗi band i tính lại wk*Jm[i][k] cho rhs và cho MỌI j2 trong vòng trong; nay tính MỘT lần thành _wji rồi dùng lại: rhs[i]+=_wji*r và A[i][j2]+=_wji*Jm[j2][k] — cùng thứ tự kết hợp trái (wk*Jm[i][k])*r và (wk*Jm[i][k])*Jm[j2][k] nên mọi số double của A/rhs giống hệt bản gốc từng bit, kể cả NaN/Infinity/-0; khác hướng hợp nhất vòng Jm vào vòng A/rhs đã thử 14:05 (bỏ mảng Jm, throughput không cải thiện) — lượt này chỉ hoist tích thừa, giữ nguyên mảng Jm và thứ tự cộng. Lab Node trên khối trích verbatim (extract.py + harness.js trong hidden_files/run_20261123_1724_A/, 2 lần chạy độc lập): parity 50/50 ca GIỐNG TỪNG BIT cả 2 lần (Object.is trên A/rhs, 5.154 kiểm tra phần tử; gồm m=0/1/2/10/20, n=0/1/3/240, W=0/âm/NaN/Infinity, Jm/tot/errDb NaN/±Infinity/-0/1e308/subnormal, 40 fuzz); tốc độ paired-median xen kẽ 15 vòng: lần 1 W10 1,2083x (15/15), W20 1,0184x (15/15), W10z 1,0599x (13/15); lần 2 W10 1,1946x (14/15), W20 1,0464x (15/15), W10z 1,0784x (15/15) — cải thiện ổn định mọi workload cả 2 lần (W20 lợi ích nhỏ hơn do vòng trong dài). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
    var meanDiag = 0;
    for (i = 0; i < m; i++){ for (var j3 = 0; j3 < i; j3++) A[i][j3] = A[j3][i]; meanDiag += A[i][i]; }
    meanDiag /= Math.max(1, m);
    var lambda = Math.max(0.35, relLambda * meanDiag);
    for (i = 0; i < m; i++) A[i][i] += lambda;
    var x = new Array(m).fill(0), aug = A.map(function(row, i2){ return row.concat([rhs[i2]]); });
    for (var col = 0, row2 = 0; col < m && row2 < m; col++, row2++){
      var piv = row2; for (var r2 = row2 + 1; r2 < m; r2++) if (Math.abs(aug[r2][col]) > Math.abs(aug[piv][col])) piv = r2;
      var tmp = aug[piv]; aug[piv] = aug[row2]; aug[row2] = tmp;
      var d0 = aug[row2][col]; if (Math.abs(d0) < 1e-12) continue;
      var _prow = aug[row2];
      for (var r3 = 0; r3 < m; r3++){ if (r3 !== row2){ var _rrow = aug[r3]; var fac = _rrow[col] / d0; for (var c2 = col + 1; c2 <= m; c2++) _rrow[c2] -= fac * _prow[c2]; _rrow[col] = 0; } }
      x[col] = _prow[m] / d0;
    }
    /* (vong tu dong 12:15, huong A - AP DUNG, va code): bo ghi cot chet trong vong khu Gauss cua lsGainStep trong hwSolve (port ky thuat aeSolveSingle 11:54 sang hwSolve, chua tung thu o hwSolve) - sau buoc khu cot col, moi muc aug[r3][col] (r3 khac hang pivot) khong bao gio duoc doc lai: tim pivot cac buoc sau chi doc cot col'>col, vong khu cac buoc sau chi doc c2>=col'>col, x[col] lay tu _prow[m]/d0 (cot tang cuong van duoc cap nhat vi vong trong chay toi c2=m); nay vong trong bat dau tu c2=col+1 va gan _rrow[col]=0 tuong minh (giu dung diem ghi; fac van doc _rrow[col] truoc nen duong nem loi khong doi) - moi x GIONG TUNG BIT theo cau truc (ke ca NaN/Infinity/-0, ma tran suy bien, mang thua, nhanh |d0|<1e-12 continue, khong mutate A/rhs). Lab Node tren khoi trich verbatim (extract.py + make_new.py + harness.js + bench3.js trong hidden_files/run_20261124_1215_A/, ham khai bao thuong khong eval): parity 378/378 GIONG TUNG BIT (Object.is tren x + loai loi; gom m=0/1/2/3/5/8/10/13/20/24 doi xung/tong quat/suy bien/le/don vi, NaN/Infinity/-0/cuc doan/subnormal, mang thua/hang null/ngan/dai, hang aliased, rhs thua/NaN/Infinity, A null, rhs null, nhanh |d0|<1e-12, pivot-swap, 300 fuzz, kiem tra khong mutate A/rhs); toc do khoi Gauss paired-median xen ke 15 vong min-of-3: lan 1 W10 1,0337x (14/15)/W20 1,0742x (15/15)/W24 1,0754x (15/15), lan 2 W10 1,0376x (15/15)/W20 1,0764x (15/15)/W24 1,0868x (15/15) - cai thien on dinh moi workload ca 2 lan. Khong cham solver/WASM/FIR/QA logic; aeV3 khong doi theo cau truc (khong do lai; gan nhat 468/482 ms ngay 2026-11-11). Bo dem lab-only van 12. Luot ke: nhom B. Lab: hidden_files/run_20261124_1215_A/. */
    /* (vòng tự động 00:24, hướng A — ÁP DỤNG, vá code): hoist hàng pivot/trục trong vòng khử Gauss của lsGainStep trong hwSolve (port kỹ thuật aeSolveSingle 21:24 và geqSolveGauss 22:24 sang hwSolve, chưa từng thử ở hwSolve) — trước đây vòng trong truy cập aug[r3][c2] và aug[row2][c2] bằng chỉ số kép cho MỌI phần tử (mỗi phần tử 2 lần tra mảng + 2 lần tra chỉ số); nay lấy _prow=aug[row2] MỘT lần sau kiểm tra d0 và _rrow=aug[r3] MỘT lần mỗi hàng r3 rồi dùng _rrow[c2]-=fac*_prow[c2] — cùng toán hạng, cùng thứ tự phép tính từng phần tử; hàng pivot không bị sửa trong vòng khử (r3!==row2) nên _prow giữ nguyên giá trị và x[col]=_prow[m]/d0 đúng như aug[row2][m]/d0; nhánh |d0|<1e-12 continue và thứ tự pivot/hoán vị giữ nguyên nên GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, ma trận suy biến, mảng thưa/ném lỗi đúng TypeError). Lab Node trên khối trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_0024_A/, 2 lần bench độc lập bằng hàm khai báo trực tiếp như trong file): parity 86/86 GIỐNG TỪNG BIT (Object.is trên x; gồm m=1/2/3/5/10/20 đối xứng/tổng quát, lặp lại, suy biến, pivot-swap, NaN/Infinity/-0/cực đoan/subnormal, nhánh |d0|<1e-12, mảng thưa/hàng ngắn/dài, rhs thưa, A null/hàng null ném đúng TypeError, 40 fuzz, kiểm tra không mutate A/rhs); tốc độ paired-median xen kẽ 15 vòng: lần 1 W10 sym 1,4614x (15/15), W20 sym 2,2177x (15/15), W10 gen 1,5304x (15/15), W20 gen 2,2098x (15/15), W24 gen 2,2845x (15/15); lần 2 W10 sym 1,4888x (15/15), W20 sym 2,2337x (15/15), W10 gen 1,5163x (14/15), W20 gen 2,2512x (15/15), W24 gen 2,4117x (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261124_0024_A/. */
    var changed = false;
    bands.forEach(function(b, bi){ var ng = b.gain + Math.max(-6, Math.min(6, x[bi] || 0)); if (Math.abs(ng - b.gain) > 0.01) changed = true; b.gain = ng; hwClampBand(b, P); });
    /* --- Inline tot cuối lsGainStep (vòng tự động 13:57, hướng A; port kỹ
         thuật 12:24/13:20/13:48): trước đây mỗi vòng LS gọi aeTotalCurve =
         m lần aeBandCurve, mỗi lần cấp phát 1 mảng n điểm rồi mới cộng vào
         tot. Nay cộng dồn trực tiếp: mỗi band 1 bộ hệ số rbjCoeffs (đúng
         fs AE_FS mặc định của aeBandCurve) rồi cùng công thức biquadMagDb
         của aeBandCurve (cùng thứ tự b0+b1*C1+b2*C2, cùng num/max(1e-30,den),
         cùng 10*Math.log10) trên cùng cache lượng giác freqs._cw — cache đã
         do guard đầu lsGainStep xây khi m>0 (như 13:48). Thứ tự cộng band
         0→m-1 vào tot[k] giữ nguyên như aeTotalCurve nên mọi số double của
         tot giống hệt bản gốc; chỉ bớt 3m lần gọi aeBandCurve + 3m mảng n
         điểm mỗi lần giải (tối đa 3 vòng LS). Khi m=0 vòng không chạy, tot
         toàn 0 như aeTotalCurve trên danh sách rỗng. Lab Node trên hàm thật
         (lượt 13:57, 2 lần): 42 ô (7 tai nghe x 3 profile x 2 target) RMS
         sau giống hệt tới 4 chữ số thập phân, maxBandDiff = 0, viol 0;
         aeBandCurve/lần giải 260 -> 160 (-38%); throughput 20 lần giải liên
         tiếp 79,8 -> 74,1 ms trung bình 2 lần đo (~1,08x), mới nhanh hơn ở
         5/6 vòng đo. Ô p5V3 không đổi (RMS 0,1896). Không chạm aeSolve nên
         aeV1/aeV2/aeV3 không đổi theo cấu trúc. Ý tưởng lượt kế: hướng A —
         hợp nhất vòng tính Jm vào vòng cộng dồn A/rhs (bỏ hẳn mảng Jm m×n);
         hoặc hướng B — rà soát buildFirTaps/bù pha (qaPhaseGdData,
         autoGuardLowGroupDelay). --- */
    tot = new Array(n).fill(0);
    for (var ti = 0; ti < m; ti++){
      var bt = bands[ti];
      var ct = rbjCoeffs(bt.type, bt.freq, bt.gain, bt.q, AE_FS);
      for (var tk = 0; tk < n; tk++){
        var tnr = ct.b0 + ct.b1*C1[tk] + ct.b2*C2[tk], tni = ct.b1*S1[tk] + ct.b2*S2[tk];
        var tdr = 1 + ct.a1*C1[tk] + ct.a2*C2[tk], tdi = ct.a1*S1[tk] + ct.a2*S2[tk];
        tot[tk] += 10*Math.log10((tnr*tnr+tni*tni)/Math.max(1e-30, tdr*tdr+tdi*tdi));
      }
    }
    return changed;
  }
  for (var iter = 0; iter < 3; iter++){ if (!lsGainStep(0.3)) break; }
  var curves = bands.map(function(b){ return aeBandCurve(b, freqs); });
  /* --- Tối ưu tốc độ objective NM của hwSolve (vòng tự động 13:20, hướng A):
       Port đúng tối ưu 12:24 của aeSolveSingle sang hwSolve (trước đây
       objective này vẫn gọi aeBandCurve(trial) mỗi lần đánh giá, cấp phát
       một mảng 240 điểm rồi mới cộng sai số). Giữ nguyên mọi phép toán:
       (1) hwBase[k] = tot[k]-curves[bi][k] tính trước một lần mỗi band
       (chính là số hạng trung gian trong biểu thức gốc); (2) đường cong
       của trial tính trực tiếp trong cùng vòng cộng sai số bằng đúng công
       thức của aeBandCurve (cùng thứ tự b0+b1*C1+b2*C2, cùng
       num/max(1e-30,den)), không cấp phát mảng cv mỗi lần đánh giá.
       hwSolve không nhận fs nên dùng AE_FS (đúng mặc định của aeBandCurve
       khi không truyền fs); cache lượng giác freqs._cw vẫn do aeBandCurve
       xây như trước. hwBase vô hiệu ở đầu mỗi nmBand vì tot thay đổi sau
       mỗi band (kể cả sau lsRebalance giữa các vòng). Ngoại lệ duy nhất,
       như 12:24: logarit dùng Math.log(x)*(10/ln10) thay cho Math.log10(x)
       (nhanh hơn ~30% trên trình duyệt thật); hai cách khác nhau tối đa
       ~1-2 ulp (~1e-13 dB) và RMS báo cáo vẫn tính từ đường tổng của
       aeBandCurve/log10 gốc. Lab Node trên hàm thật (lượt 13:20, 2 lần):
       42 ô (7 tai nghe x 3 profile x 2 target) RMS sau giống hệt tới 4 chữ
       số thập phân, maxBandDiff = 0, viol 0; aeBandCurve/lần giải 3280 ->
       460 (-86%); throughput 20 lần giải liên tiếp 88,2 -> 79,4 ms
       (nhanh hơn ~1,11x, mới nhanh hơn ở cả 6 vòng đo). --- */
  var hwBase = null, hwBi = -1;
  function objective(bi, trial){
    if (hwBi !== bi || !hwBase){
      hwBase = new Array(n);
      for (var kb=0;kb<n;kb++) hwBase[kb] = tot[kb]-curves[bi][kb];
      hwBi = bi;
    }
    if (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== AE_FS) aeBandCurve(trial, freqs);
    var cc = rbjCoeffs(trial.type, trial.freq, trial.gain, trial.q, AE_FS);
    var b0=cc.b0, b1=cc.b1, b2=cc.b2, a1=cc.a1, a2=cc.a2;
    var C1=freqs._cw, S1=freqs._sw, C2=freqs._cw2, S2=freqs._sw2;
    var s = 0;
    for (var k2 = 0; k2 < n; k2++){
      var nr = b0 + b1*C1[k2] + b2*C2[k2], ni = b1*S1[k2] + b2*S2[k2];
      var dr = 1 + a1*C1[k2] + a2*C2[k2], di = a1*S1[k2] + a2*S2[k2];
      var cv = Math.log((nr*nr+ni*ni)/Math.max(1e-30, dr*dr+di*di))*4.342944819032518;
      var e = errDb[k2] - (hwBase[k2] + cv); s += W[k2] * e * e;
    }
    var reg = 0;
    for (var bj = 0; bj < bands.length; bj++){ var g = (bj === bi) ? trial.gain : bands[bj].gain; reg += (g / 12) * (g / 12); }
    var qPen = Math.max(0, trial.q - 4); reg += 0.15 * qPen * qPen;
    return s / Math.max(1e-9, sumW) + 0.02 * reg;
  }
function objectiveS(bi, trial){
    if (hwBi !== bi || !hwBase){
      hwBase = new Array(n);
      for (var kb=0;kb<n;kb++) hwBase[kb] = tot[kb]-curves[bi][kb];
      hwBi = bi;
    }
    if (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== AE_FS) aeBandCurve(trial, freqs);
    var cc = rbjCoeffs(trial.type, trial.freq, trial.gain, trial.q, AE_FS);
    var b0=cc.b0, b1=cc.b1, b2=cc.b2, a1=cc.a1, a2=cc.a2;
    var C1=freqs._cw, S1=freqs._sw, C2=freqs._cw2, S2=freqs._sw2;
    var s = 0;
    for (var k2 = 0; k2 < n; k2 += 2){
      var nr = b0 + b1*C1[k2] + b2*C2[k2], ni = b1*S1[k2] + b2*S2[k2];
      var dr = 1 + a1*C1[k2] + a2*C2[k2], di = a1*S1[k2] + a2*S2[k2];
      var cv = Math.log((nr*nr+ni*ni)/Math.max(1e-30, dr*dr+di*di))*4.342944819032518;
      var e = errDb[k2] - (hwBase[k2] + cv); s += W[k2] * e * e;
    }
    var reg = 0;
    for (var bj = 0; bj < bands.length; bj++){ var g = (bj === bi) ? trial.gain : bands[bj].gain; reg += (g / 12) * (g / 12); }
    var qPen = Math.max(0, trial.q - 4); reg += 0.15 * qPen * qPen;
    return s / Math.max(1e-9, sumW2) + 0.02 * reg;
  }
  function nmBand(bi){
    hwBase = null; hwBi = -1;
    var b = bands[bi];
    function toBand(xx){ var t = { type: b.type, freq: Math.pow(2, xx[0]), gain: xx[1], q: Math.pow(2, xx[2]) }; hwClampBand(t, P); return t; }
    function fromBand(t){ return [Math.log2(t.freq), t.gain, Math.log2(t.q)]; }
    var x0 = fromBand(b), steps = [0.35, 1.5, 0.30];
    var simp = [x0, [x0[0] + steps[0], x0[1], x0[2]], [x0[0], x0[1] + steps[1], x0[2]], [x0[0], x0[1], x0[2] + steps[2]]];
    var vals = new Array(simp.length); for (var vi0 = 0; vi0 < simp.length; vi0++) vals[vi0] = objectiveS(bi, toBand(simp[vi0]));
    for (var it = 0; it < 110; it++){
      var idx=[0,1,2,3];
      /* (vong tu dong 23:54, huong A): port binary-insertion TimSort tu aeSolveSingle 15:54 sang hwSolve nmBand - thay [0,1,2,3].sort(...) + cap phat _ns/_nv moi vong NM bang tai hien thuat toan TimSort cua V8 (run detection + binary insertion, comparator NaN->0) va sap xep tai cho simp/vals; moi ket qua GIONG TUNG BIT theo cau truc (kiem chung fuzz sort 656976 ca + parity hwSolve 40/40 + edge 10/10; bench paired-median 2 lan: moi workload 1.01-1.05x, thang da so vong). */
      var _srtRun = 2;
      var _srtD = vals[1]-vals[0]; if (_srtD !== _srtD) _srtD = 0;
      if (_srtD < 0){
        while (_srtRun < 4){ _srtD = vals[idx[_srtRun]]-vals[idx[_srtRun-1]]; if (_srtD !== _srtD) _srtD = 0; if (_srtD < 0) _srtRun++; else break; }
        var _srtLo = 0, _srtHi = _srtRun-1;
        while (_srtLo < _srtHi){ var _srtT = idx[_srtLo]; idx[_srtLo] = idx[_srtHi]; idx[_srtHi] = _srtT; _srtLo++; _srtHi--; }
      } else {
        while (_srtRun < 4){ _srtD = vals[idx[_srtRun]]-vals[idx[_srtRun-1]]; if (_srtD !== _srtD) _srtD = 0; if (_srtD >= 0) _srtRun++; else break; }
      }
      if (_srtRun < 4){
        for (var _srtI = _srtRun; _srtI < 4; _srtI++){
          var _srtPiv = idx[_srtI], _srtLeft = 0, _srtRight = _srtI;
          while (_srtLeft < _srtRight){
            var _srtMid = (_srtLeft+_srtRight)>>>1;
            _srtD = vals[_srtPiv]-vals[idx[_srtMid]]; if (_srtD !== _srtD) _srtD = 0;
            if (_srtD < 0) _srtRight = _srtMid; else _srtLeft = _srtMid+1;
          }
          for (var _srtJ = _srtI; _srtJ > _srtLeft; _srtJ--) idx[_srtJ] = idx[_srtJ-1];
          idx[_srtLeft] = _srtPiv;
        }
      }
      var tS0=simp[idx[0]], tS1=simp[idx[1]], tS2=simp[idx[2]], tS3=simp[idx[3]];
      var tV0=vals[idx[0]], tV1=vals[idx[1]], tV2=vals[idx[2]], tV3=vals[idx[3]];
      simp[0]=tS0; simp[1]=tS1; simp[2]=tS2; simp[3]=tS3;
      vals[0]=tV0; vals[1]=tV1; vals[2]=tV2; vals[3]=tV3;
      if (Math.abs(vals[3] - vals[0]) < 1e-5) break;
      var cen = [(simp[0][0] + simp[1][0] + simp[2][0]) / 3, (simp[0][1] + simp[1][1] + simp[2][1]) / 3, (simp[0][2] + simp[1][2] + simp[2][2]) / 3];
      var xr = new Array(3); for (var d1 = 0; d1 < 3; d1++){ var c1 = cen[d1]; xr[d1] = c1 + (c1 - simp[3][d1]); } var vr = objectiveS(bi, toBand(xr));
      if (vr < vals[0]){
        var xe = new Array(3); for (var d2 = 0; d2 < 3; d2++){ var c2 = cen[d2]; xe[d2] = c2 + 2 * (c2 - simp[3][d2]); } var ve = objectiveS(bi, toBand(xe));
        if (ve < vr){ simp[3] = xe; vals[3] = ve; } else { simp[3] = xr; vals[3] = vr; }
      } else if (vr < vals[2]){ simp[3] = xr; vals[3] = vr; }
      else {
        var xc = new Array(3); for (var d3 = 0; d3 < 3; d3++){ var c3 = cen[d3]; xc[d3] = c3 + 0.5 * (simp[3][d3] - c3); } var vc = objectiveS(bi, toBand(xc));
        if (vc < vals[3]){ simp[3] = xc; vals[3] = vc; }
        else { for (var si = 1; si < 4; si++){ var _sr = simp[si], _s0 = simp[0], _sn = new Array(_sr.length); for (var d4 = 0; d4 < _sr.length; d4++) _sn[d4] = _s0[d4] + 0.5 * (_sr[d4] - _s0[d4]); simp[si] = _sn; vals[si] = objectiveS(bi, toBand(simp[si])); } }
      }
    }
    var bi2 = 0; for (var vi = 1; vi < 4; vi++) if (vals[vi] < vals[bi2]) bi2 = vi;
    var best = toBand(simp[bi2]);
    if (objective(bi, best) <= objective(bi, b) + 1e-9){ bands[bi] = best; curves[bi] = aeBandCurve(best, freqs); }
    tot = new Array(n); for (var k0 = 0; k0 < n; k0++) tot[k0] = 0; for (var ci = 0; ci < curves.length; ci++){ var cv = curves[ci]; for (var k3 = 0; k3 < n; k3++) tot[k3] += cv[k3]; }
  }
  function totalObjective(){
    var s = 0;
    for (var k4 = 0; k4 < n; k4++){ var e4 = errDb[k4] - tot[k4]; s += W[k4] * e4 * e4; }
    var reg = 0;
    bands.forEach(function(b){ reg += (b.gain / 12) * (b.gain / 12); var qp = Math.max(0, b.q - 4); reg += 0.15 * qp * qp; });
    return s / Math.max(1e-9, sumW) + 0.02 * reg;
  }
  function lsRebalance(){
    var before = totalObjective();
    var saved = bands.map(function(b){ return { type: b.type, freq: b.freq, gain: b.gain, q: b.q }; });
    lsGainStep(0.6);
    if (totalObjective() <= before + 1e-12){
      curves = bands.map(function(b){ return aeBandCurve(b, freqs); });
      return true;
    }
    bands.forEach(function(b, bi){ b.type = saved[bi].type; b.freq = saved[bi].freq; b.gain = saved[bi].gain; b.q = saved[bi].q; });
    tot = aeTotalCurve(bands, freqs);
    curves = bands.map(function(b){ return aeBandCurve(b, freqs); });
    return false;
  }
  for (var pass = 0; pass < 3; pass++){
    for (var bi3 = 0; bi3 < bands.length; bi3++) nmBand(bi3);
    if (pass < 2) lsRebalance();
  }
  bands.forEach(function(b){ hwClampBand(b, P); });
  tot = aeTotalCurve(bands, freqs);
  return { bands: bands, total: tot, ms: performance.now() - t0 };
}
function hwPreamp(bandList){
  var tot = aeTotalCurve(bandList, AE.freqs), mx = 0;
  for (var i = 0; i < tot.length; i++) if (tot[i] > mx) mx = tot[i];
  return mx > 0 ? -(mx + 1.0) : 0;
}
function hwValidate(bandList, P){
  var v = [];
  if (bandList.length > P.maxBands) v.push("Số band " + bandList.length + " vượt tối đa " + P.maxBands + " của profile.");
  bandList.forEach(function(b, i){
    var tag = "Band " + (i + 1);
    if (P.types.indexOf(b.type) < 0) v.push(tag + ": loại filter “" + b.type + "” không được profile cho phép.");
    if (b.freq < P.fcMin - 1e-9 || b.freq > P.fcMax + 1e-9) v.push(tag + ": Fc " + Math.round(b.freq) + " Hz ngoài khoảng [" + P.fcMin + ", " + P.fcMax + "].");
    if (P.fcStep && Math.abs(b.freq / P.fcStep - Math.round(b.freq / P.fcStep)) > 1e-6) v.push(tag + ": Fc lệch bước " + P.fcStep + " Hz.");
    if (b.gain < P.gainMin - 1e-9 || b.gain > P.gainMax + 1e-9) v.push(tag + ": gain " + b.gain.toFixed(2) + " dB ngoài [" + P.gainMin + ", " + P.gainMax + "].");
    if (P.gainStep && Math.abs(b.gain / P.gainStep - Math.round(b.gain / P.gainStep)) > 1e-6) v.push(tag + ": gain lệch bước " + P.gainStep + " dB.");
    if (b.q < P.qMin - 1e-9 || b.q > P.qMax + 1e-9) v.push(tag + ": Q " + b.q.toFixed(2) + " ngoài [" + P.qMin + ", " + P.qMax + "].");
    if (P.qStep && Math.abs(b.q / P.qStep - Math.round(b.q / P.qStep)) > 1e-6) v.push(tag + ": Q lệch bước " + P.qStep + ".");
  });
  return v;
}
function hwErrAndWeights(prep, targetId, adj){
  var tf = aeTargetCurve(targetId, adj.tilt, adj.bass, adj.ear);
  var err = AE.freqs.map(function(f, i){ return tf(f) - prep.sm[i]; });
  var W = AE.freqs.map(function(f){ return aeWeight(f); });
  prep.nulls.forEach(function(nl){
    for (var i = 0; i < AE.freqs.length; i++) if (AE.freqs[i] >= nl.fLo && AE.freqs[i] <= nl.fHi) W[i] = 0;
  });
  return { err: err, W: W };
}
function hwRenderSpec(){
  var P = HW_PROFILES[$("hwProfile").value];
  function step(v, unit){ return v ? " · bước " + v + " " + unit : " · liên tục"; }
  $("hwSpec").innerHTML =
    '<div class="kv"><span>Số band tối đa</span><b>' + P.maxBands + '</b></div>' +
    '<div class="kv"><span>Loại filter cho phép</span><b>' + P.types.map(function(t){ return AE_TYPLBL[t] || t; }).join(", ") + '</b></div>' +
    '<div class="kv"><span>Fc</span><b>' + P.fcMin + " – " + P.fcMax + " Hz" + step(P.fcStep, "Hz") + '</b></div>' +
    '<div class="kv"><span>Gain</span><b>' + P.gainMin + " … +" + P.gainMax + " dB" + step(P.gainStep, "dB") + '</b></div>' +
    '<div class="kv"><span>Q</span><b>' + P.qMin + " – " + P.qMax + step(P.qStep, "") + '</b></div>' +
    '<p class="note" style="margin:8px 0 0">' + P.note + '</p>';
}
(function hwInit(){
  var sel = $("hwProfile");
  Object.keys(HW_PROFILES).forEach(function(k){
    var o = document.createElement("option"); o.value = k; o.textContent = HW_PROFILES[k].name + " — tối đa " + HW_PROFILES[k].maxBands + " band";
    sel.appendChild(o);
  });
  sel.value = "moondropDsp";
  sel.addEventListener("change", hwRenderSpec);
  hwRenderSpec();
  $("btnHwSolve").disabled = false;
})();
$("btnHwSolve").addEventListener("click", function(){
  var wl = $("hwWarn"), out = $("hwOut");
  if (!AE.points){
    out.innerHTML = "";
    wl.innerHTML = "<li>Hãy chọn tai nghe trước ở Bước 1 của panel AutoEQ (tai nghe tích hợp, tai nghe mẫu kiểm chứng, hoặc tai nghe bạn thêm qua file đo) — rồi mới chạy Hardware Solver.</li>";
    return;
  }
  var P = HW_PROFILES[$("hwProfile").value];
  var btn = this; btn.disabled = true; btn.textContent = "Đang chạy lại bộ tối ưu với ràng buộc " + P.name + "…";
  setTimeout(function(){
    try {
      var prep = { ptsN: AE.ptsN, rawG: AE.rawG, sm: AE.sm, nulls: AE.nulls };
      var adj = aeAdj(), targetId = $("aeTarget").value;
      aeComputeAsync(prep, targetId, adj, 10, false, false, undefined, function(unc){
      try {
      var ew = hwErrAndWeights(prep, targetId, adj);
      var sol = hwSolve(AE.freqs, ew.err, ew.W, P);
      var errAfterArr = ew.err.map(function(e, i){ return e - sol.total[i]; });
      var rmsAfter = aeRms(errAfterArr, AE.freqs);
      var delta = rmsAfter - unc.errAfter;
      var pre = hwPreamp(sol.bands);
      var viol = hwValidate(sol.bands, P);
      HW.last = { profileId: $("hwProfile").value, profile: P, bands: sol.bands, preamp: pre,
                  rmsBefore: unc.errBefore, rmsUnc: unc.errAfter, rmsAfter: rmsAfter, delta: delta,
                  ms: sol.ms, target: targetId, headphone: AE.name, rig: AE.rig };
      out.innerHTML =
        '<div class="kv" style="margin-top:8px"><span>RMS error gốc (đường đo vs target)</span><b>' + unc.errBefore.toFixed(2) + ' dB</b></div>' +
        '<div class="kv"><span>RMS sau tối ưu không giới hạn (10 band, Giai đoạn 2)</span><b class="green">' + unc.errAfter.toFixed(2) + ' dB</b></div>' +
        '<div class="kv"><span>RMS sau tối ưu theo ' + P.name + ' (' + sol.bands.length + ' band)</span><b class="cyan">' + rmsAfter.toFixed(2) + ' dB</b></div>' +
        '<div class="kv"><span>Delta RMS so với bản không giới hạn (âm = bản theo profile còn khớp hơn)</span><b class="' + (delta > 0.05 ? "amber" : "green") + '">' + (delta >= 0 ? "+" : "") + delta.toFixed(2) + ' dB</b></div>' +
        '<div class="kv"><span>Pre-amp của preset theo profile (luật Giai đoạn 1)</span><b class="amber">' + fmtDb(pre) + ' dB</b></div>' +
        '<div class="kv"><span>Thời gian chạy lại solver</span><b>' + Math.round(sol.ms) + ' ms</b></div>' +
        '<div class="kv"><span>Validator của profile</span><b class="' + (viol.length ? "red" : "green") + '">' + (viol.length ? viol.length + " vi phạm" : "HỢP LỆ — 0 vi phạm") + '</b></div>';
      wl.innerHTML = viol.length
        ? viol.map(function(s){ return "<li>" + s.replace(/</g, "&lt;") + "</li>"; }).join("")
        : '<li class="ok">Preset ' + sol.bands.length + ' band cho ' + P.name + ' hợp lệ 100% qua validator: đúng số band, đúng loại filter, Fc/gain/Q trong khoảng và đúng bước của profile. Nguồn band để xuất đã tự chuyển sang kết quả solver này.</li>';
      $("btnHwPreview").disabled = false;
      $("expSrc").value = "hw";
      expMetaLine();
      } catch (err) {
        wl.innerHTML = "<li>Lỗi khi chạy Hardware Solver: " + String(err.message || err).replace(/</g, "&lt;") + "</li>";
      }
      btn.disabled = false; btn.textContent = "Chạy lại bộ tối ưu với ràng buộc của thiết bị này";
      });
    } catch (err) {
      wl.innerHTML = "<li>Lỗi khi chạy Hardware Solver: " + String(err.message || err).replace(/</g, "&lt;") + "</li>";
      btn.disabled = false; btn.textContent = "Chạy lại bộ tối ưu với ràng buộc của thiết bị này";
    }
  }, 30);
});
$("btnHwPreview").addEventListener("click", function(){
  if (!HW.last) return;
  var srcB = HW.last.bands, BS = bandSet();
  bands.forEach(function(b, i){
    var sb = srcB[i];
    if (sb){ b.type = sb.type; b.freq = sb.freq; b.gain = sb.gain; b.q = sb.q; b.on = true; }
    else { b.freq = BS.freqs[i]; b.type = BS.types[i]; b.gain = 0; b.q = BS.defq[i]; b.on = true; }
  });
  selBand = 0;
  updateAll(true);
  $("hwWarn").innerHTML = '<li class="ok">Đã áp ' + Math.min(bands.length, srcB.length) + ' band đầu của kết quả ' + HW.last.profile.name + ' vào engine (' + bands.length + ' band) để nghe thử' + (srcB.length > bands.length ? ' — preset đầy đủ ' + srcB.length + ' band nằm trong file xuất (panel Universal Export, nguồn “Kết quả Hardware Solver”); muốn nghe thử đủ ' + srcB.length + ' band, chuyển engine sang chế độ 20 band ở khu vực EQ rồi áp lại.' : '.') + '</li>';
});

/* ================================================================
   5.5 — UNIVERSAL EXPORTERS
   Mọi file nhúng metadata: tai nghe, rig, target, ngày, phiên bản
   app, pre-amp. expRender(kind, src, meta) là hàm thuần để kiểm
   chứng golden dùng lại được với preset cố định.
   ================================================================ */
function expSource(){
  if ($("expSrc").value === "hw"){
    if (!HW.last) return null;
    return { bands: HW.last.bands.map(function(b){ return { type: b.type, freq: b.freq, gain: b.gain, q: b.q, on: true }; }),
             preamp: HW.last.preamp, profile: HW.last.profile.name, target: HW.last.target, headphone: HW.last.headphone, rig: HW.last.rig };
  }
  return { bands: bands.map(function(b){ return { type: b.type, freq: b.freq, gain: b.gain, q: b.q, on: b.on }; }),
           preamp: appliedPreDb(), profile: "Engine trực tiếp — " + bands.length + " band, không qua Hardware Solver",
           target: $("aeTarget").value, headphone: AE.name || (DB.cur ? DB.cur.headphone : ""), rig: AE.rig || "other" };
}
function expMetaFor(src, date){
  return { headphone: src.headphone || "Preset EQ hiện tại (chưa gắn đường đo)", rig: src.rig || "other",
    targetName: (AE_TARGETS[src.target] ? AE_TARGETS[src.target].name : String(src.target || "—")),
    profile: src.profile, dateISO: (date || new Date()).toISOString(), app: APP5_NAME, preamp: src.preamp };
}
function expMetaLine(){
  var s = expSource(), el = $("expMeta");
  if (!s){ el.textContent = "Chưa có kết quả Hardware Solver — hãy chạy solver ở panel trên, hoặc đổi nguồn về “EQ hiện tại của engine”."; return; }
  var m = expMetaFor(s);
  el.textContent = m.headphone + " · rig " + (AE_RIGLBL[m.rig] || m.rig) + " · target " + m.targetName + " · pre-amp " + fmtDb(s.preamp) + " dB · " + s.bands.length + " band · " + m.profile;
}
/* --- Graphic EQ tan so co dinh (vong tu dong 19:24, huong B muc 1) ---
   Chuyen ket qua parametric hien tai (nguon expSource) thanh EQ do hoa
   tan so co dinh: bo 10 band 1 octave va bo 31 band ISO 1/3 octave.
   Cach khop: dap tuyen parametric nguon tinh dung bang rbjCoeffs +
   biquadMagDb tren luoi solver aeGridFreqs (1/24 octave, 20 Hz-20 kHz);
   cac gain Graphic EQ la nghiem binh phuong toi thieu cua dap tuyen do
   theo mo hinh noi suy log-tuyen tinh giua cac diem co dinh (ngoai dai
   giu gain diem bien). He phuong trinh chuan giai bang khu Gauss co
   chon tru cot chinh; them ridge 1e-12 chi de tranh suy bien so hoc.
   Sai so RMS/max hien thi do theo dung mo hinh noi suy nay — APO tong
   hop dap tuyen tu cac diem GraphicEQ: bang convolution rieng cua no
   nen ket qua tren thiet bi co the lech them mot chut so voi so hien thi. */
var GEQ_SETS = {
  "10": [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
  "31": [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
         630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
         8000, 10000, 12500, 16000, 20000]
};
function geqBandDbAt(b, freq, fs){
  if (!b || b.on === false || !b.gain) return 0;
  return biquadMagDb(rbjCoeffs(b.type, b.freq, b.gain, b.q, fs), freq, fs);
}
function geqTargetDb(bands, freq, fs){
  var s = 0, i;
  for (i = 0; i < bands.length; i++) s += geqBandDbAt(bands[i], freq, fs);
  return s;
}
function geqWeights(freqs, freq){
  var m = freqs.length, w = new Array(m), i;
  for (i = 0; i < m; i++) w[i] = 0;
  if (freq <= freqs[0]){ w[0] = 1; return w; }
  if (freq >= freqs[m - 1]){ w[m - 1] = 1; return w; }
  for (i = 0; i < m - 1; i++){
    if (freq >= freqs[i] && freq <= freqs[i + 1]){
      var t = (Math.log2(freq) - Math.log2(freqs[i])) / (Math.log2(freqs[i + 1]) - Math.log2(freqs[i]));
      w[i] = 1 - t; w[i + 1] = t; return w;
    }
  }
  return w;
}
var GEQ_WS = [0, 0, 0, 0]; /* CHAIN TASK #14 (2026-11-13, truc A): scratch dung chung cho geqWeightsSparse — trong so chi co toi da 2 muc khac 0 (cap ke hoac 1 muc o bien) nen khong can cap phat mang m phan tu moi lan goi; chi dung noi bo trong geqFit/geqInterp, khong giu ket qua qua lan goi khac. */
/* (vòng tự động 13:23, hướng A — H12 / CHAIN TASK #14): trong so thua — geqWeightsSparse tra ve so muc khac 0 (0/1/2) va ghi [chi so, trong so] vao GEQ_WS thay vi cap phat new Array(m) + dien 0; cung bieu thuc quet bracket/log2 nhu geqWeights (t===0/t===1 ve 1 muc nhu dieu kien !w[i] cua caller cu; t NaN — fixedFreqs trung — giu 2 muc NaN nhu ban cu de geqFit bo qua va geqInterp tra NaN). geqWeights giu nguyen (khong xoa ham) cho tuong thich. */
function geqWeightsSparse(freqs, freq){
  var m = freqs.length, i, t;
  if (freq <= freqs[0]){ GEQ_WS[0] = 0; GEQ_WS[1] = 1; return 1; }
  if (freq >= freqs[m - 1]){ GEQ_WS[0] = m - 1; GEQ_WS[1] = 1; return 1; }
  for (i = 0; i < m - 1; i++){
    if (freq >= freqs[i] && freq <= freqs[i + 1]){
      t = (Math.log2(freq) - Math.log2(freqs[i])) / (Math.log2(freqs[i + 1]) - Math.log2(freqs[i]));
      if (t === 0){ GEQ_WS[0] = i; GEQ_WS[1] = 1; return 1; }
      if (t === 1){ GEQ_WS[0] = i + 1; GEQ_WS[1] = 1; return 1; }
      GEQ_WS[0] = i; GEQ_WS[1] = 1 - t; GEQ_WS[2] = i + 1; GEQ_WS[3] = t; return 2;
    }
  }
  return 0;
}
function geqInterp(freqs, gains, freq){
  if (gains.length > freqs.length) return NaN; /* giong ban cu: vong tong chay toi gains.length nen w[i] la undefined khi i >= freqs.length -> NaN */
  var n = geqWeightsSparse(freqs, freq), s = 0, k;
  for (k = 0; k < n; k++) if (GEQ_WS[2*k] < gains.length) s += GEQ_WS[2*k+1] * gains[GEQ_WS[2*k]]; /* gains ngan hon: ban cu chi tong toi gains.length, muc thua chi so vuot qua bi bo */
  return s;
}
/* (vòng tự động 22:24, hướng A — ÁP DỤNG, vá code): hoist hàng pivot/trục trong vòng khử Gauss của geqSolveGauss (đường giải hệ chuẩn của geqFit) — trước đây vòng trong truy cập M[i][j] và M[k][j] bằng chỉ số kép cho MỌI phần tử (mỗi phần tử 2 lần tra mảng + 2 lần tra chỉ số); nay lấy _prow=M[k] MỘT lần sau kiểm tra pivot và _rrow=M[i] MỘT lần mỗi hàng i rồi dùng _rrow[j]-=f*_prow[j] — cùng toán hạng, cùng thứ tự phép tính từng phần tử; hàng pivot không bị sửa trong vòng khử (i>k) nên _prow giữ nguyên giá trị và f=_rrow[k]/_prow[k] đúng như M[i][k]/M[k][k]; thứ tự pivot/hoán vị và nhánh |M[piv][k]|<1e-14 return null giữ nguyên nên GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, ma trận suy biến, mảng thưa). geqSolveGauss không nằm trong AE_WORKER_SRC nên parity Worker giữ nguyên. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_2224_A/, 2 lần chạy độc lập): parity 483/483 GIỐNG TỪNG BIT cả 2 lần (Object.is trên x; gồm n=0..33 × 8 seed, ma trận suy biến/không, pivot-swap, NaN/Infinity/-0/cực đoan, 200 fuzz, kiểm tra không mutate A/y); tốc độ paired-median xen kẽ 15 vòng: lần 1 n10 1,2526x (14/15), n20 1,6523x (13/15), n31 1,8318x (15/15); lần 2 n10 1,2815x (14/15), n20 1,6920x (15/15), n31 1,9003x (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261123_2224_A/. */
function geqSolveGauss(A, y){
  var n = y.length, M = [], i, j, k, piv, tmp, f;
  for (i = 0; i < n; i++){ M.push(A[i].slice()); M[i].push(y[i]); }
  for (k = 0; k < n; k++){
    piv = k;
    for (i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[piv][k])) piv = i;
    if (Math.abs(M[piv][k]) < 1e-14) return null;
    if (piv !== k){ tmp = M[k]; M[k] = M[piv]; M[piv] = tmp; }
    var _prow = M[k];
    for (i = k + 1; i < n; i++){
      var _rrow = M[i];
      f = _rrow[k] / _prow[k];
      /* (vòng tự động 12:46, hướng A — ÁP DỤNG, vá code): bỏ ghi cột chết trong vòng khử của geqSolveGauss (port kỹ thuật aeSolveSingle 11:54 / hwSolve 12:15 sang hàm Gauss thứ ba) — sau bước khử cột k, mọi mục M[i][k] (i>k) không bao giờ được đọc lại: tìm pivot các bước sau chỉ đọc cột k'>k, phép thế ngược chỉ đọc M[i][j] với j>=i (cột k<i không chạm); nay vòng trong bắt đầu từ j=k+1, bỏ phép trừ thừa ở cột k mỗi hàng — mọi x GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, ma trận suy biến, mảng thưa, nhánh |pivot|<1e-14 return null, không mutate A/y). Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_1246_A/, 2 lần bench độc lập): parity 643/643 GIỐNG TỪNG BIT (Object.is trên x + loại lỗi; gồm n=0/1/2/3/5/8/10/13/20/24/31 tổng quát/SPD/suy biến/hạng 1/trùng hàng/anti-identity/pivot-swap, NaN/±Infinity/-0/cực đoan/subnormal, mảng thưa/hàng null/ngắn/dài, A null/y null, 500 fuzz); tốc độ khối Gauss đầy đủ paired-median xen kẽ 15 vòng min-of-3: W10 SPD 1,0084x/1,0081x (12/15 cả 2 lần), W31 SPD 1,0057x/1,0105x (11/15, 12/15), W20 gen 1,0042x/1,0093x (11/15, 14/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261124_1246_A/. */
      for (j = k + 1; j <= n; j++) _rrow[j] -= f * _prow[j];
    }
  }
  var x = new Array(n);
  for (i = n - 1; i >= 0; i--){
    var s = M[i][n];
    for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
/* (vòng tự động 15:26, hướng A — ÁP DỤNG, vá code): chuyển vị vòng tính targets trong geqFit — trước đây mỗi điểm lưới tính lượng giác rồi cộng dồn qua mọi band (đọc lại hệ số 5 trường của từng band cho MỌI điểm lưới); nay tính lượng giác MỘT lần cho cả lưới vào 4 mảng Float64Array (_tgCw/_tgSw/_tgCw2/_tgSw2, đúng biểu thức gốc), rồi vòng ngoài duyệt band (đọc hệ số _b0.._a2 MỘT lần/band) và vòng trong duyệt lưới cộng dồn targets[g] theo đúng thứ tự band 0..n-1 như cũ (0 + band0 + band1 ...), sau đó vòng trọng số/AtA duyệt lại lưới theo đúng thứ tự g như cũ nên AtY/AtA cộng dồn giống hệt; biểu thức nr/ni/dr/di và 4.342944819032518*Math.log(Math.max(...)) giữ nguyên từng toán hạng nên targets và mọi kết quả sau đó GIỐNG TỪNG BIT. Lab Node trên hàm thật trích verbatim (make_geq.py + probe_geq.js trong hidden_files/run_20261123_1524_A/, 2 lần chạy độc lập): parity 8/8 cấu hình GIỐNG TỪNG BIT cả 2 lần (Object.is trên gains/rms/max/maxFreq/points; gồm 10/20 band × GEQ 10/31 × fs 44100/48000/96000, band tắt/gain 0/null/NaN, mảng rỗng, 1 band, cực đoan gain ±45/freq 5–25000 Hz/Q 0,01–50, fixedFreqs trùng); tốc độ paired-median xen kẽ 15 vòng × 100 rep: lần 1 F1 1,0138× thắng 11/15, F2 1,0067× thắng 11/15, F3 1,0226× thắng 13/15; lần 2 F1 1,0289× thắng 13/15, F2 1,0148× thắng 11/15, F3 1,0251× thắng 14/15 — cải thiện ổn định cả 2 lần trên mọi workload. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
function geqFit(bands, fixedFreqs, fs){
  var grid = aeGridFreqs(), m = fixedFreqs.length, i, j, g;
  var AtA = [], AtY = [];
  for (i = 0; i < m; i++){ AtA.push(new Array(m).fill(0)); AtY.push(0); }
  /* (vòng tự động 01:54, hướng A - H1): hoist rbjCoeffs ra khỏi vòng lưới — hệ số chỉ phụ thuộc (type,freq,gain,q,fs), không phụ thuộc tần số lưới; điều kiện bỏ qua là đúng biểu thức của geqBandDbAt (!b || b.on===false || !b.gain); thứ tự cộng i=0..n-1 không đổi nên targets giống từng bit. Lab 2 lần chạy: 8/8 cấu hình giống từng bit, nhanh hơn 1,63x-3,12x. */
  var co = new Array(bands.length);
  for (i = 0; i < bands.length; i++){
    var _b = bands[i];
    co[i] = (!_b || _b.on === false || !_b.gain) ? null : rbjCoeffs(_b.type, _b.freq, _b.gain, _b.q, fs);
  }
  var targets = new Array(grid.length).fill(0);
  var _gwFast = fixedFreqs.length >= 2 && grid.length > 0 && fixedFreqs[0] > 0;
  if (_gwFast){
    for (var _wfi = 0; _wfi < fixedFreqs.length; _wfi++){
      if (!isFinite(fixedFreqs[_wfi]) || (_wfi > 0 && !(fixedFreqs[_wfi] > fixedFreqs[_wfi-1]))){ _gwFast = false; break; }
    }
  }
  if (_gwFast){
    for (var _wgi = 0; _wgi < grid.length; _wgi++){
      if (!isFinite(grid[_wgi]) || (_wgi > 0 && !(grid[_wgi] >= grid[_wgi-1]))){ _gwFast = false; break; }
    }
  }
  var _gwLogF = _gwFast ? fixedFreqs.map(function(_f){ return Math.log2(_f); }) : null;
  var _gwP = 0, _gwM = fixedFreqs.length;
  var _tgCw = new Float64Array(grid.length), _tgSw = new Float64Array(grid.length), _tgCw2 = new Float64Array(grid.length), _tgSw2 = new Float64Array(grid.length);
  for (g = 0; g < grid.length; g++){
    var _tw = 2*Math.PI*grid[g]/fs, _tcw = Math.cos(_tw), _tsw = Math.sin(_tw);
    _tgCw[g] = _tcw; _tgSw[g] = _tsw; _tgCw2[g] = 2*_tcw*_tcw - 1; _tgSw2[g] = 2*_tsw*_tcw;
  }
  for (i = 0; i < bands.length; i++) if (co[i]) {
    var _c = co[i];
    var _b0 = _c.b0, _b1 = _c.b1, _b2 = _c.b2, _a1 = _c.a1, _a2 = _c.a2;
    for (g = 0; g < grid.length; g++){
      var _cw = _tgCw[g], _sw = _tgSw[g], _cw2 = _tgCw2[g], _sw2 = _tgSw2[g];
      var _nr = _b0 + _b1*_cw + _b2*_cw2, _ni = -(_b1*_sw + _b2*_sw2);
      var _dr = 1 + _a1*_cw + _a2*_cw2, _di = -(_a1*_sw + _a2*_sw2);
      targets[g] += 4.342944819032518*Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di))));
    }
  }
  for (g = 0; g < grid.length; g++){
    var t = targets[g];
    var nw;
    if (_gwFast){
      var _fg2 = grid[g];
      if (_fg2 <= fixedFreqs[0]){ GEQ_WS[0] = 0; GEQ_WS[1] = 1; nw = 1; }
      else if (_fg2 >= fixedFreqs[_gwM-1]){ GEQ_WS[0] = _gwM-1; GEQ_WS[1] = 1; nw = 1; }
      else {
        while (_gwP < _gwM - 2 && _fg2 > fixedFreqs[_gwP+1]) _gwP++;
        var _t2 = (Math.log2(_fg2) - _gwLogF[_gwP]) / (_gwLogF[_gwP+1] - _gwLogF[_gwP]);
        if (_t2 === 0){ GEQ_WS[0] = _gwP; GEQ_WS[1] = 1; nw = 1; }
        else if (_t2 === 1){ GEQ_WS[0] = _gwP+1; GEQ_WS[1] = 1; nw = 1; }
        else { GEQ_WS[0] = _gwP; GEQ_WS[1] = 1-_t2; GEQ_WS[2] = _gwP+1; GEQ_WS[3] = _t2; nw = 2; }
      }
    } else {
      nw = geqWeightsSparse(fixedFreqs, grid[g]);
    }
    if (nw === 1){
      var _w1 = GEQ_WS[1];
      if (_w1){
        var _i1 = GEQ_WS[0];
        AtY[_i1] += _w1 * t;
        AtA[_i1][_i1] += _w1 * _w1;
      }
    } else if (nw === 2){
      var _w0 = GEQ_WS[1], _w2 = GEQ_WS[3];
      var _i0 = GEQ_WS[0], _i2 = GEQ_WS[2];
      if (_w0){
        AtY[_i0] += _w0 * t;
        if (_w0) AtA[_i0][_i0] += _w0 * _w0;
        if (_w2) AtA[_i0][_i2] += _w0 * _w2;
      }
      if (_w2){
        AtY[_i2] += _w2 * t;
        if (_w0) AtA[_i2][_i0] += _w2 * _w0;
        if (_w2) AtA[_i2][_i2] += _w2 * _w2;
      }
    } else {
      for (var k = 0; k < nw; k++){
        var wi = GEQ_WS[2*k+1];
        if (!wi) continue;
        var ii = GEQ_WS[2*k];
        AtY[ii] += wi * t;
        for (var k2 = 0; k2 < nw; k2++){
          var wj = GEQ_WS[2*k2+1];
          if (!wj) continue;
          AtA[ii][GEQ_WS[2*k2]] += wi * wj;
        }
      }
    }
  }
/* --- Mở rộng 2026-11-24 (vòng tự động 01:54, hướng A — ÁP DỤNG, vá code): Lượt nhóm A (sau D 01:47, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 01:47:17+07, 6.302.844 byte / 25.469 dòng (wc -l), md5 bf64a5b9b5081e24e444dc8fb57d5f0e, version 386) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-A lưu tại ~/workspace/autoeq/backups/2026-11-24_0154_before.html và 2026-11-24_0154_pre-download.html. Ứng viên A duy nhất: chuyên biệt hoá (unroll) vòng tích luỹ AtA/AtY trong geqFit theo số mục thưa nw — geqWeightsSparse và đường nhanh trong geqFit chỉ trả nw 0/1/2 nên vòng k/k2 lồng nhau (mỗi điểm lưới truy cập GEQ_WS[2*k]/[2*k+1] và kiểm tra !w cho từng cặp) được viết lại thành 3 nhánh thẳng: nw===1 (1 mục), nw===2 (2 mục, đúng thứ tự cộng AtY[0], AtA[0][0], AtA[0][1], AtY[1], AtA[1][0], AtA[1][1] như vòng gốc), còn lại (nw 0 hoặc >2) giữ nguyên vòng gốc; mọi kiểm tra !w giữ nguyên nên kể cả trọng số 0/-0/NaN, chỉ số ngoài mảng và ném lỗi đều giống hệt — AtA/AtY GIỐNG TỪNG BIT theo cấu trúc. Khác hướng đã bác: prefix-sum reg trong objective (14:24), đổi log10 trong RLS (13:36) — lượt này không đổi thứ tự số học, chỉ bỏ vòng lặp/chỉ số thừa trên đường thưa. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261124_0154_A/, 2 lần chạy độc lập): parity khối AtA 14.250/14.250 GIỐNG TỪNG BIT (Object.is sâu trên AtA/AtY + loại lỗi; gồm nw 0–4, trọng số 0/-0/NaN/±Infinity/subnormal, chỉ số ngoài mảng/phân số, t NaN/±Infinity/-0/1e308, AtA/AtY khởi tạo NaN/-0/±Infinity, m 1/3/5) + geqFit đầy đủ 48/48 GIỐNG TỪNG BIT (Object.is trên freqs/gains/rms/max/maxFreq/points hoặc null/lỗi; gồm 0/1/2/10/20 band × GEQ 10/31 × fs 44100/48000/96000, fixedFreqs rỗng/1 điểm/chưa sắp/trùng/NaN/âm, band null/off/gain 0/NaN, freq NaN, gain ±45, fs 0/NaN/âm/undefined); tốc độ geqFit đầy đủ paired-median xen kẽ 15 vòng: lần 1 F1 (10 band×GEQ10) 1,1262× thắng 15/15, F2 (20×GEQ31) 1,0866× 15/15, F3 (20×GEQ10) 1,0846× 12/15, F4 (10×GEQ31) 1,1188× 14/15; lần 2 F1 1,1308× 15/15, F2 1,0974× 15/15, F3 1,0970× 13/15, F4 1,1401× 15/15 — cải thiện ổn định mọi workload cả 2 lần, acc khớp tuyệt đối. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA tĩnh: 44/44 hàm bảo vệ, 62/62 ID DOM, 21/21 script node --check PASS, kết thúc đúng </html>, diff đúng 1 hunk code + comment này. QA trình duyệt đầy đủ chưa chạy được trong lượt này (headless Chrome bị chặn bởi chính sách Hatch WebGL). Lượt kế: nhóm B. Lab: hidden_files/run_20261124_0154_A/. --- */
  for (i = 0; i < m; i++) AtA[i][i] += 1e-12;
  var gains = geqSolveGauss(AtA, AtY);
  if (!gains) return null;
  var se = 0, mx = 0, mxF = grid[0];
  /* (vong tu dong 21:54, huong A): con tro don dieu cho vong RMS cuoi - luoi aeGridFreqs tang dan va fixedFreqs cua GEQ_SETS tang nghiem ngat nen moi diem luoi chi can tien con tro qua cac knot da vuot (thay vi quet tuyen tinh tu dau + tinh lai log2 moi doan trong geqWeightsSparse/geqInterp cho tung diem); log2(fixedFreqs) tinh MOT lan, bieu thuc t va thu tu cong s (0 + (1-t)*gains[p] roi + t*gains[p+1], cung nhanh t===0/t===1 va nhanh bien <=first/>=last) giu nguyen nhu geqInterp nen e/se/mx giong tung bit. Moi truong hop khac (gains dai hon fixedFreqs, fixedFreqs khong tang nghiem ngat/khong huu han/khong duong, luoi khong tang/khong huu han) roi ve vong goc goi geqInterp nguyen ven. */
  var _geqFast = gains.length <= fixedFreqs.length && fixedFreqs.length >= 1 && grid.length > 0 && fixedFreqs[0] > 0;
  if (_geqFast){
    for (var _fi = 0; _fi < fixedFreqs.length; _fi++){
      if (!isFinite(fixedFreqs[_fi]) || (_fi > 0 && !(fixedFreqs[_fi] > fixedFreqs[_fi-1]))){ _geqFast = false; break; }
    }
  }
  if (_geqFast){
    for (var _gi = 0; _gi < grid.length; _gi++){
      if (!isFinite(grid[_gi]) || (_gi > 0 && !(grid[_gi] >= grid[_gi-1]))){ _geqFast = false; break; }
    }
  }
  if (_geqFast){
    var _logF = fixedFreqs.map(function(_f){ return Math.log2(_f); });
    var _p = 0, _m = fixedFreqs.length;
    for (g = 0; g < grid.length; g++){
      var _fg = grid[g], _interp;
      if (_fg <= fixedFreqs[0]){
        _interp = 0; if (0 < gains.length) _interp += gains[0];
      } else if (_fg >= fixedFreqs[_m-1]){
        _interp = 0; if ((_m-1) < gains.length) _interp += gains[_m-1];
      } else {
        while (_p < _m - 2 && _fg > fixedFreqs[_p+1]) _p++;
        var _t = (Math.log2(_fg) - _logF[_p]) / (_logF[_p+1] - _logF[_p]);
        if (_t === 0){ _interp = 0; if (_p < gains.length) _interp += gains[_p]; }
        else if (_t === 1){ _interp = 0; if ((_p+1) < gains.length) _interp += gains[_p+1]; }
        else { _interp = 0; if (_p < gains.length) _interp += (1 - _t) * gains[_p]; if ((_p+1) < gains.length) _interp += _t * gains[_p+1]; }
      }
      var e = _interp - targets[g];
      se += e * e;
      if (Math.abs(e) > mx){ mx = Math.abs(e); mxF = grid[g]; }
    }
  } else {
    for (g = 0; g < grid.length; g++){
      var e = geqInterp(fixedFreqs, gains, grid[g]) - targets[g];
      se += e * e;
      if (Math.abs(e) > mx){ mx = Math.abs(e); mxF = grid[g]; }
    }
  }
  return { freqs: fixedFreqs.slice(), gains: gains,
           rms: Math.sqrt(se / grid.length), max: mx, maxFreq: mxF, points: grid.length };
}
function geqText(fit, meta, preamp){
  /* Graphic EQ (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep gain
     [-30, 30] dB chi trong ham nay, guong mau guard APO/Qudelix/Pro-Q/
     JamesDSP (Pha C 2026-11-05). Ly do: toFixed(NaN/Infinity) ghi nguyen
     chu "NaN"/"Infinity" ra file text, ca o dong header "# Preamp:" cua
     expHead (vi meta.preamp = src.preamp trong app that) lan dong
     "Preamp:" chinh, cung nhu o dong sai so khop va dong GraphicEQ neu
     fit tra ve khong huu han. Preamp khong huu han ve 0 qua ban sao meta
     da ve sinh (geqMeta) nhu jdMeta/apoMeta de bit ca hai cho; rms/max
     khong huu han ve 0, maxFreq khong huu han ve 0 Hz, gain khong huu
     han ve 0, gain huu han ngoai dai kep ve [-30, 30] dB, denormal
     < 1e-30 ve 0. Tan so co dinh lay tu GEQ_SETS nen luon huu han, van
     ve sinh phong thu ve 0 neu khong huu han. Moi gia tri hop le trong
     dai deu cho file byte-identical voi ban cu. */
  function geqClampGain(g){ if (!isFinite(g)) return 0; if (Math.abs(g) < 1e-30) return 0; return Math.max(-30, Math.min(30, g)); }
  var geqPre = isFinite(preamp) ? preamp : 0;
  if (Math.abs(geqPre) < 1e-30) geqPre = 0;
  var geqMeta = { headphone: meta.headphone, rig: meta.rig, targetName: meta.targetName, profile: meta.profile, dateISO: meta.dateISO, app: meta.app, preamp: geqPre };
  var geqRms = isFinite(fit.rms) ? fit.rms : 0;
  var geqMax = isFinite(fit.max) ? fit.max : 0;
  var geqMaxFreq = isFinite(fit.maxFreq) ? Math.round(fit.maxFreq) : 0;
  var geqGains = fit.gains.map(geqClampGain);
  var lines = [expHead(geqMeta, "#"),
    "# Graphic EQ — tan so co dinh, khop binh phuong toi thieu tu dap tuyen parametric nguon.",
    "# Mo hinh khop: noi suy log-tuyen tinh giua cac diem co dinh, tren luoi solver 1/24 octave.",
    "# Sai so khop: RMS " + geqRms.toFixed(3) + " dB · lech lon nhat " + geqMax.toFixed(3) + " dB tai " + geqMaxFreq + " Hz.",
    "Preamp: " + geqPre.toFixed(2) + " dB",
    "GraphicEQ: " + fit.freqs.map(function(f, k){ return (isFinite(f) ? f : 0) + " " + geqGains[k].toFixed(2); }).join("; ")];
  return lines.join("\n") + "\n";
}
var GEQ_LAST = null;
function geqBuild(){
  var src = expSource();
  if (!src){
    GEQ_LAST = null;
    $("geqInfo").textContent = "Chưa có nguồn band để xuất — hãy chạy Hardware Solver trước, hoặc đổi nguồn về “EQ hiện tại của engine”.";
    $("geqText").value = "";
    return;
  }
  var key = $("geqSel").value;
  try { localStorage.setItem("webAutoEq.geqset.v1", key); } catch (e) {}
  var fs = (typeof displayFs !== "undefined" && displayFs) ? displayFs : 48000;
  var fit = geqFit(src.bands, GEQ_SETS[key], fs);
  if (!fit){
    GEQ_LAST = null;
    $("geqInfo").textContent = "Không giải được hệ khớp Graphic EQ — thử đổi bộ band.";
    $("geqText").value = "";
    return;
  }
  var meta = expMetaFor(src);
  GEQ_LAST = { fit: fit, meta: meta, preamp: src.preamp, key: key };
  $("geqText").value = geqText(fit, meta, src.preamp);
  $("geqInfo").textContent = "Đã khớp " + fit.freqs.length + " band cố định từ " + src.bands.length + " band parametric · RMS " + fit.rms.toFixed(3) + " dB · lệch lớn nhất " + fit.max.toFixed(3) + " dB tại " + Math.round(fit.maxFreq) + " Hz · lưới solver 1/24 octave (" + fit.points + " điểm, 20 Hz–20 kHz).";
}
function geqDownload(){
  geqBuild();
  if (!GEQ_LAST) return;
  dlText(expSlug(GEQ_LAST.meta.headphone) + "_graphiceq-" + GEQ_LAST.key + ".txt", $("geqText").value);
  $("geqInfo").textContent += " Đã tải file.";
}

function expHead(meta, prefix){
  return [prefix + " Web AutoEQ — Universal Export",
    prefix + " Headphone: " + meta.headphone,
    prefix + " Rig: " + (AE_RIGLBL[meta.rig] || meta.rig),
    prefix + " Target: " + meta.targetName,
    prefix + " Profile: " + meta.profile,
    prefix + " Date: " + meta.dateISO,
    prefix + " App: " + meta.app,
    prefix + " Preamp: " + meta.preamp.toFixed(2) + " dB"].join("\n");
}
function expRender(kind, src, meta){
  var B = src.bands, pre = src.preamp, i;
  function r2(v){ return Math.round(v * 100) / 100; }
  if (kind === "apo"){
    /* APO (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard Wavelet/Poweramp/SoundSource/EasyEffects/
       CamillaDSP (Pha C 2026-11-05). Ly do: toFixed(NaN/Infinity) ghi
       nguyen chu "NaN"/"Infinity" ra file text, Equalizer APO co the hieu
       sai hoac loi khi nap; gia tri huu han ngoai dai thi xuat nguyen xi,
       khac dap tuyen RBJ da kep ma app dang phat. Band khong huu han thi
       bo (tuong duong identity) va ghi rieng mot dong comment (chi khi
       > 0, khong ghi chu NaN/Infinity vao file de file sach hoan toan);
       band huu han ngoai dai thi kep ve dai RBJ; preamp khong huu han ve
       0. Khac CamillaDSP/Wavelet/Poweramp: APO co khai niem OFF nen band
       OFF huu han van giu nguyen dong OFF; nhung band OFF khong huu han
       cung phai bo vi dong OFF van mang gia tri, va dem vao so band khong
       hop le (khong phai OFF hop le). So Filter danh lai lien tuc theo
       cac band con lai. Moi gia tri hop le trong dai RBJ va truong hop
       chi co band OFF huu han deu cho file byte-identical voi ban cu. */
    function apoClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var APO_T = { peaking: "PK", lowshelf: "LSC", highshelf: "HSC" };
    var apoPre = isFinite(pre) ? pre : 0;
    /* expHead in meta.preamp nen phai truyen ban sao meta da ve sinh preamp:
       trong app that expMetaFor dat meta.preamp = src.preamp, neu khong dong
       header "# Preamp: ..." van ghi NaN/Infinity du dong Preamp chinh da ve 0. */
    var apoMeta = { headphone: meta.headphone, rig: meta.rig, targetName: meta.targetName, profile: meta.profile, dateISO: meta.dateISO, app: meta.app, preamp: apoPre };
    var lines = [expHead(apoMeta, "#"), "Preamp: " + apoPre.toFixed(2) + " dB"];
    var apoInvalid = 0, apoN = 0;
    B.forEach(function(b){
      var f = apoClamp(b.freq, 10, 22000), g = apoClamp(b.gain, -30, 30), q = apoClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ apoInvalid++; return; }
      apoN++;
      lines.push("Filter " + apoN + ": " + (b.on === false ? "OFF" : "ON") + " " + (APO_T[b.type] || "PK") + " Fc " + Math.round(f) + " Hz Gain " + g.toFixed(2) + " dB Q " + q.toFixed(2));
    });
    if (apoInvalid) lines.push("# Da bo " + apoInvalid + " band khong hop le.");
    return lines.join("\n") + "\n";
  }
  if (kind === "soundsource"){
    /* SoundSource (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard Wavelet/Poweramp (Pha C 2026-11-05). Ly do:
       JSON.stringify bien NaN/Infinity thanh null, ben nhan hieu nham
       freq null thanh 0 Hz va Q null thanh 0; gia tri huu han ngoai dai
       thi xuat nguyen xi, khac dap tuyen RBJ da kep ma app dang phat.
       Band khong huu han thi bo (tuong duong identity, ke ca band OFF
       vi OFF cung la identity) va ghi skippedInvalidBands rieng;
       band huu han ngoai dai thi kep ve dai RBJ; preamp khong huu han
       ve 0. Band OFF huu han van giu enabled=false (SoundSource co khai
       niem enabled, khac Wavelet/Poweramp). Moi gia tri hop le trong dai
       RBJ va truong hop chi co band OFF deu cho file byte-identical
       voi ban cu. */
    function ssClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var ssInvalid = 0;
    var ssFilters = [];
    B.forEach(function(b){
      var f = ssClamp(b.freq, 10, 22000), g = ssClamp(b.gain, -30, 30), q = ssClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ ssInvalid++; return; }
      ssFilters.push({ type: b.type, frequency: Math.round(f * 10) / 10, gainDb: r2(g), q: r2(q), enabled: b.on !== false });
    });
    var ssMeta = { headphone: meta.headphone, rig: meta.rig, rigLabel: AE_RIGLBL[meta.rig] || meta.rig, target: meta.targetName, profile: meta.profile, date: meta.dateISO, app: meta.app };
    if (ssInvalid > 0) ssMeta.skippedInvalidBands = ssInvalid;
    return JSON.stringify({
      format: "SoundSource EQ Preset (JSON)", name: meta.headphone + " — " + meta.targetName, preampDb: isFinite(pre) ? r2(pre) : 0,
      filters: ssFilters,
      metadata: ssMeta
    }, null, 2) + "\n";
  }
  if (kind === "wavelet"){
    /* Wavelet (Pha B 2026-11-05): dinh dang Wavelet khong co khai niem band OFF
       (bands[] deu duoc ap dung) nen band OFF phai bi bo khoi file, giong
       cach CamillaDSP da lam o tren; giu nguyen so band OFF da bo trong
       meta (chi khi > 0) de file all-ON cho byte-identical voi ban cu. */
    var WAV_T = { peaking: "PEAKING", lowshelf: "LOW_SHELF", highshelf: "HIGH_SHELF" };
    /* Wavelet (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard Poweramp (Pha C 10:42). Ly do: r2()/JSON
       bien NaN/Infinity thanh null, ma ben nhan hieu nham freq null
       thanh 0 Hz va Q null thanh 0; gia tri huu han ngoai dai thi xuat
       nguyen xi, khac dap tuyen RBJ da kep ma app dang phat. Band khong
       huu han thi bo (tuong duong identity) va ghi skippedInvalidBands
       rieng, khong tron vao skippedOffBands; preamp khong huu han ve 0.
       Moi gia tri hop le trong dai RBJ va truong hop chi co band OFF deu
       cho file byte-identical voi ban cu. */
    function wvClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var wOn = B.filter(function(b){ return b.on !== false; });
    var wInvalid = 0;
    var wBands = [];
    wOn.forEach(function(b){
      var f = wvClamp(b.freq, 10, 22000), g = wvClamp(b.gain, -30, 30), q = wvClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ wInvalid++; return; }
      wBands.push({ type: WAV_T[b.type] || "PEAKING", frequency: Math.round(f * 10) / 10, gain: r2(g), Q: r2(q) });
    });
    var wMeta = { headphone: meta.headphone, rig: meta.rig, target: meta.targetName, profile: meta.profile, date: meta.dateISO, app: meta.app, variant: "Wavelet JSON export" };
    if (wOn.length < B.length) wMeta.skippedOffBands = B.length - wOn.length;
    if (wInvalid > 0) wMeta.skippedInvalidBands = wInvalid;
    return JSON.stringify({
      title: meta.headphone + " — " + meta.targetName, preamp: isFinite(pre) ? r2(pre) : 0,
      bands: wBands,
      meta: wMeta
    }, null, 2) + "\n";
  }
  if (kind === "poweramp"){
    /* Poweramp (Pha B 2026-11-05): dinh dang Poweramp trong app khong co
       khai niem band OFF (bands[] chi co freq/gain/q, moi band deu duoc
       ap dung) nen band OFF phai bi bo khoi file, giong cach Wavelet va
       CamillaDSP da lam; giu nguyen so band OFF da bo trong meta (chi
       khi > 0) de file all-ON cho byte-identical voi ban cu. */
    /* Poweramp (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay. Ly do: r2()/JSON.stringify bien NaN/Infinity thanh null,
       ma isFinite(null) lai la true nen ben nhan hieu nham freq null
       thanh 0 Hz (kep RBJ thanh 10 Hz) va q null thanh 0; gia tri huu han
       ngoai dai thi xuat nguyen xi, khac dap tuyen RBJ da kep ma app
       dang phat. Band khong huu han thi bo (tuong duong identity, giong
       rbjCoeffs tra identity) va ghi skippedInvalidBands rieng, khong
       tron vao skippedOffBands; band huu han thi kep ve dai RBJ; preamp
       khong huu han ve 0. Moi gia tri hop le trong dai RBJ va truong hop
       chi co band OFF deu cho file byte-identical voi ban cu. */
    function paClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var paOn = B.filter(function(b){ return b.on !== false; });
    var paInvalid = 0;
    var paBands = [];
    paOn.forEach(function(b){
      var f = paClamp(b.freq, 10, 22000), g = paClamp(b.gain, -30, 30), q = paClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ paInvalid++; return; }
      paBands.push({ type: b.type, freq: Math.round(f * 10) / 10, gain: r2(g), q: r2(q) });
    });
    var paMeta = { headphone: meta.headphone, rig: meta.rig, target: meta.targetName, profile: meta.profile, date: meta.dateISO, app: meta.app, variant: "Poweramp Equalizer JSON preset" };
    if (paOn.length < B.length) paMeta.skippedOffBands = B.length - paOn.length;
    if (paInvalid > 0) paMeta.skippedInvalidBands = paInvalid;
    return JSON.stringify({
      name: meta.headphone + " — " + meta.targetName, preamp: isFinite(pre) ? r2(pre) : 0,
      bands: paBands,
      meta: paMeta
    }, null, 2) + "\n";
  }
  if (kind === "jamesdsp"){
    /* JamesDSP (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard APO/Qudelix/Pro-Q (Pha C 2026-11-05) va la dinh
       dang cuoi cua chuoi guard. Ly do: bang DDC tinh qua dbBandDb + pre
       nen band khong huu han chi ve identity 0 dB nho rbjCoeffs, nhung
       preamp khong huu han thi (dbBandDb + pre).toFixed(2) ghi nguyen chu
       "NaN"/"Infinity" vao moi dong bang, va expHead(meta) cung ghi chu
       do vao dong "# Preamp:" o header vi meta.preamp = src.preamp trong
       app that. Band ON khong huu han thi bo truoc khi tinh bang (tuong
       duong identity) va ghi rieng mot dong comment (chi khi > 0, khong
       ghi chu NaN/Infinity vao file); band huu han ngoai dai thi kep ve
       dai RBJ truoc khi tinh bang (rbjCoeffs cung kep nhu vay nen bang
       hop le khong doi); preamp khong huu han ve 0, ke ca header qua ban
       sao meta nhu APO/Qudelix/Pro-Q. Band OFF von da bi dbBandDb bo qua
       nen khong dem vao so band khong hop le, giong cach CamillaDSP bo
       OFF truoc khi kiem tra gia tri. Moi gia tri hop le trong dai RBJ
       va truong hop chi co band OFF deu cho file byte-identical voi ban cu. */
    function jdClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var jdPre = isFinite(pre) ? pre : 0;
    var jdMeta = { headphone: meta.headphone, rig: meta.rig, targetName: meta.targetName, profile: meta.profile, dateISO: meta.dateISO, app: meta.app, preamp: jdPre };
    var jdInvalid = 0;
    var jdBands = [];
    B.forEach(function(b){
      if (b.on === false) return;
      var f = jdClamp(b.freq, 10, 22000), g = jdClamp(b.gain, -30, 30), q = jdClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ jdInvalid++; return; }
      jdBands.push({ type: b.type, freq: f, gain: g, q: q, on: true });
    });
    var out = [expHead(jdMeta, "#"), "# JamesDSP / ViPER DDC (.vdc) — bang tan so : do hieu chinh (dB), gom ca pre-amp"];
    [44100, 48000].forEach(function(sr){
      out.push("SR_" + sr + ":");
      var jdCc = dbBandCoeffs(jdBands, sr);
      for (var k = 0; k <= 60; k++){
        var f = 20 * Math.pow(2, k / 6); if (f > 20000) break;
        out.push(Math.round(f) + ": " + (dbBandDbC(jdCc, f, sr) + jdPre).toFixed(2));
      }
    });
    if (jdInvalid) out.push("# Da bo " + jdInvalid + " band khong hop le.");
    return out.join("\n") + "\n";
  }
  if (kind === "camilla"){
    /* CamillaDSP: filters = Biquad Peaking/Lowshelf/Highshelf + Gain pre-amp;
       pipeline áp cho cả hai kênh. Chỉ xuất band đang bật (OFF thì bỏ qua,
       và ghi rõ số band đã bỏ) — CamillaDSP không có khái niệm band OFF. */
    /* CamillaDSP (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard Wavelet/Poweramp/SoundSource/EasyEffects
       (Pha C 2026-11-05). Ly do: toFixed(NaN/Infinity) ghi nguyen chu
       "NaN"/"Infinity" ra YAML, ben nhan co the hieu sai hoac loi khi
       nap Biquad; gia tri huu han ngoai dai thi xuat nguyen xi, khac
       dap tuyen RBJ da kep ma app dang phat. Band khong huu han thi bo
       (tuong duong identity, giong cach bo band OFF vi CamillaDSP khong
       co band OFF) va ghi rieng mot dong comment (chi khi > 0, khong
       tron vao so band OFF); band huu han ngoai dai thi kep ve dai RBJ;
       preamp khong huu han ve 0. Moi gia tri hop le trong dai RBJ va
       truong hop chi co band OFF deu cho file byte-identical voi ban cu. */
    function camClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var CAM_T = { peaking: "Peaking", lowshelf: "Lowshelf", highshelf: "Highshelf" };
    var out = ["# Web AutoEQ — CamillaDSP export (Nhom 5 v2)",
      "# Headphone: " + meta.headphone,
      "# Target: " + meta.targetName,
      "# Profile: " + meta.profile,
      "# Date: " + meta.dateISO,
      "# Preamp: " + (isFinite(pre) ? pre.toFixed(2) : "0.00") + " dB (Gain filter 'preamp' ben duoi)",
      "# GHEP VAO FILE CAU HINH CUA BAN: doan nay chi co filters + pipeline;",
      "# muc devices (capture/playback) la cua rieng he thong ban, khong xuat o day."];
    var skipped = 0, camInvalid = 0;
    out.push("filters:");
    out.push("  preamp:");
    out.push("    type: Gain");
    out.push("    parameters:");
    out.push("      gain: " + (isFinite(pre) ? pre.toFixed(2) : "0.00"));
    out.push("      inverted: false");
    var names = ["preamp"], n = 0;
    B.forEach(function(b){
      if (b.on === false){ skipped++; return; }
      var cf = camClamp(b.freq, 10, 22000), cg = camClamp(b.gain, -30, 30), cq = camClamp(b.q, 0.1, 30);
      if (cf === null || cg === null || cq === null){ camInvalid++; return; }
      n++;
      var nm = "band_" + n;
      names.push(nm);
      out.push("  " + nm + ":");
      out.push("    type: Biquad");
      out.push("    parameters:");
      out.push("      type: " + (CAM_T[b.type] || "Peaking"));
      out.push("      freq: " + (Math.round(cf * 10) / 10));
      out.push("      gain: " + cg.toFixed(2));
      out.push("      q: " + cq.toFixed(2));
    });
    if (skipped) out.push("# Da bo " + skipped + " band OFF (CamillaDSP khong co band OFF).");
    if (camInvalid) out.push("# Da bo " + camInvalid + " band khong hop le (NaN/Infinity) (CamillaDSP khong co band OFF).");
    out.push("pipeline:");
    out.push("  - type: Filter");
    out.push("    channels: [0, 1]");
    out.push("    names:");
    names.forEach(function(nm){ out.push("      - " + nm); });
    return out.join("\n") + "\n";
  }
  if (kind === "qudelix"){
    /* Qudelix-5K: EQ 10 band, filter types PEAK/LSHELF/HSHELF. App Qudelix
       khong co dinh dang file preset nhap truc tiep — file nay dung dung
       dong Filter/Preamp cua Equalizer APO (dang gia tri app Qudelix nhan
       nhap tay), cat o 10 band dau theo thu tu tan so; vuot 10 band thi ghi
       ro canh bao o dau file thay vi lang le cat. */
    /* Qudelix (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard APO/CamillaDSP/EasyEffects (Pha C 2026-11-05).
       Ly do: toFixed(NaN/Infinity) ghi nguyen chu do ra file text, app
       Qudelix nhap tay co the hieu sai hoac loi khi nap; gia tri huu han
       ngoai dai thi xuat nguyen xi, khac dap tuyen RBJ da kep ma app
       dang phat; sap xep voi freq khong huu han cung khong xac dinh.
       Band khong huu han thi bo truoc khi sap xep/cat (tuong duong
       identity) va ghi rieng mot dong comment (chi khi > 0, khong ghi
       chu NaN/Infinity vao file de file sach hoan toan); band huu han
       ngoai dai thi kep ve dai RBJ; preamp khong huu han ve 0, ke ca
       header qua ban sao meta nhu APO. Qudelix co khai niem OFF nen band
       OFF huu han van giu nguyen dong OFF, nhung band OFF khong huu han
       cung phai bo vi dong OFF van mang gia tri. Moi gia tri hop le
       trong dai RBJ va truong hop chi co band OFF huu han deu cho file
       byte-identical voi ban cu; thu tu sap xep/cat 10 band khong doi. */
    function qudClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var Q_T = { peaking: "PK", lowshelf: "LSC", highshelf: "HSC" };
    var qudPre = isFinite(pre) ? pre : 0;
    var qudMeta = { headphone: meta.headphone, rig: meta.rig, targetName: meta.targetName, profile: meta.profile, dateISO: meta.dateISO, app: meta.app, preamp: qudPre };
    var lines = [expHead(qudMeta, "#"),
      "# Qudelix-5K (Nhom 5 v2): EQ 10 band — nhap tay cac gia tri nay vao app Qudelix.",
      "# App Qudelix khong co dinh dang file preset nhap truc tiep."];
    /* Qudelix (Pha B 2026-11-05): sap xep ban sao theo tan so tang dan
       truoc khi cat 10 band, dung nhu tai lieu ("10 band dau theo thu
       tu tan so"); khong doi mang goc, input da sap san cho ra file
       byte-identical voi ban cu. Pha C chi chen buoc loai band khong
       huu han truoc buoc sap xep nay. */
    var qudInvalid = 0;
    var qb = B.slice().filter(function(b){
      if (qudClamp(b.freq, 10, 22000) === null || qudClamp(b.gain, -30, 30) === null || qudClamp(b.q, 0.1, 30) === null){ qudInvalid++; return false; }
      return true;
    }).sort(function(a, b){ return a.freq - b.freq; }).slice(0, 10);
    if (B.length > 10) lines.push("# CANH BAO: nguon co " + B.length + " band, file nay chi chua 10 band dau theo thu tu tan so — KHONG tuong duong dap tuyen day du. Muon khop 1:1, chuyen engine sang 10 band truoc khi xuat.");
    lines.push("Preamp: " + qudPre.toFixed(2) + " dB");
    qb.forEach(function(b, k){
      var f = qudClamp(b.freq, 10, 22000), g = qudClamp(b.gain, -30, 30), q = qudClamp(b.q, 0.1, 30);
      lines.push("Filter " + (k + 1) + ": " + (b.on === false ? "OFF" : "ON") + " " + (Q_T[b.type] || "PK") + " Fc " + Math.round(f) + " Hz Gain " + g.toFixed(2) + " dB Q " + q.toFixed(2));
    });
    if (qudInvalid) lines.push("# Da bo " + qudInvalid + " band khong hop le.");
    return lines.join("\n") + "\n";
  }
  if (kind === "easyeffects"){
    /* EasyEffects: preset JSON thật của EasyEffects (đối chiếu preset mẫu
       công khai: output -> equalizer#0 -> left/right bandN, input-gain =
       pre-amp, num-bands, plugins_order). Chỉ chứa cấu trúc EasyEffects
       hiểu; tên file mang tên tai nghe/target (preset EasyEffects không
       có trường metadata). Band OFF -> type Off, giữ nguyên giá trị gốc
       (EasyEffects không áp band Off). */
    /* EasyEffects (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard Wavelet/Poweramp/SoundSource (Pha C 2026-11-05).
       Ly do: JSON.stringify bien NaN/Infinity thanh null, ben nhan hieu nham
       freq null thanh 0 Hz va Q null thanh 0; gia tri huu han ngoai dai thi
       xuat nguyen xi, khac dap tuyen RBJ da kep ma app dang phat. Band
       khong huu han thi bo (tuong duong identity, ke ca band OFF vi OFF
       cung la identity) va ghi skippedInvalidBands o cap preset (chi khi
       > 0; EasyEffects chi doc output/plugins_order); band huu han ngoai
       dai thi kep ve dai RBJ; preamp khong huu han ve 0. Band OFF huu han
       van giu type Off (EasyEffects co khai niem Off). Moi gia tri hop le
       trong dai RBJ va truong hop chi co band OFF deu cho file
       byte-identical voi ban cu. */
    var EE_T = { peaking: "Bell", lowshelf: "Lo-shelf", highshelf: "Hi-shelf" };
    function eeClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    function eeBand(b, f, g, q){
      var off = (b.on === false);
      return { frequency: Math.round(f * 10) / 10, gain: r2(g), mode: "APO (DR)",
        mute: false, q: r2(q), slope: "x1", solo: false,
        type: off ? "Off" : (EE_T[b.type] || "Bell"), width: 4.0 };
    }
    var eeLeft = {}, eeRight = {}, eeInvalid = 0, eeN = 0;
    B.forEach(function(b){
      var f = eeClamp(b.freq, 10, 22000), g = eeClamp(b.gain, -30, 30), q = eeClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ eeInvalid++; return; }
      eeLeft["band" + eeN] = eeBand(b, f, g, q);
      eeRight["band" + eeN] = JSON.parse(JSON.stringify(eeBand(b, f, g, q)));
      eeN++;
    });
    var eeOut = { output: { blocklist: [],
      "equalizer#0": { balance: 0.0, bypass: false, "input-gain": isFinite(pre) ? r2(pre) : 0,
        left: eeLeft, right: eeRight, mode: "IIR", "num-bands": eeN,
        "output-gain": 0.0, "pitch-left": 0.0, "pitch-right": 0.0 },
      plugins_order: ["equalizer#0"] } };
    if (eeInvalid > 0) eeOut.skippedInvalidBands = eeInvalid;
    return JSON.stringify(eeOut, null, 2) + "\n";
  }
  if (kind === "proq"){
    /* FabFilter Pro-Q: KHÔNG phải file .ffp gốc. Định dạng .ffp là nhị
       phân độc quyền của FabFilter, không có đặc tả text công khai nên
       không thể sinh file .ffp có thể kiểm chứng trong trình duyệt —
       file này là bảng band để nhập tay vào Pro-Q (Pro-Q hỗ trợ tới
       24 band nên 10/20 band đều vừa; Output Gain = pre-amp). */
    /* Pro-Q (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
       (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong
       khoi nay, giong guard APO/Qudelix (Pha C 2026-11-05). Ly do:
       toFixed(NaN/Infinity) ghi nguyen chu "NaN"/"Infinity" ra file text,
       nguoi nhap tay co the hieu sai hoac loi khi nhap; gia tri huu han
       ngoai dai thi xuat nguyen xi, khac dap tuyen RBJ da kep ma app
       dang phat. Band khong huu han thi bo (tuong duong identity) va
       ghi rieng mot dong comment (chi khi > 0, khong ghi chu
       NaN/Infinity vao file de file sach hoan toan); band huu han
       ngoai dai thi kep ve dai RBJ; preamp khong huu han ve 0, ke ca
       header qua ban sao meta nhu APO/Qudelix. Pro-Q co ghi chu OFF
       nen band OFF huu han van giu nguyen dong OFF, nhung band OFF
       khong huu han cung phai bo vi dong OFF van mang gia tri. So Band
       danh lai lien tuc theo cac band con lai. Moi gia tri hop le trong
       dai RBJ va truong hop chi co band OFF huu han deu cho file
       byte-identical voi ban cu. */
    function pqClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
    var PQ_T = { peaking: "Bell", lowshelf: "Low Shelf", highshelf: "High Shelf" };
    var pqPre = isFinite(pre) ? pre : 0;
    var pqMeta = { headphone: meta.headphone, rig: meta.rig, targetName: meta.targetName, profile: meta.profile, dateISO: meta.dateISO, app: meta.app, preamp: pqPre };
    var lines = [expHead(pqMeta, "#"),
      "# FabFilter Pro-Q — BANG BAND NHAP TAY (KHONG PHAI FILE .ffp GOC).",
      "# Dinh dang .ffp la nhi phan doc quyen cua FabFilter, khong co dac ta text cong khai;",
      "# file nay chi liet ke band de ban nhap tay vao Pro-Q. Pro-Q ho tro toi 24 band.",
      "# Output Gain (duoi day) = pre-amp.",
      "Pro-Q Output Gain: " + pqPre.toFixed(2) + " dB"];
    var pqInvalid = 0, pqN = 0;
    B.forEach(function(b){
      var f = pqClamp(b.freq, 10, 22000), g = pqClamp(b.gain, -30, 30), q = pqClamp(b.q, 0.1, 30);
      if (f === null || g === null || q === null){ pqInvalid++; return; }
      pqN++;
      lines.push("Band " + pqN + ": " + (PQ_T[b.type] || "Bell") + ", Freq " + Math.round(f * 10) / 10 + " Hz, Gain " + g.toFixed(2) + " dB, Q " + q.toFixed(2) + (b.on === false ? " (OFF — bo qua khi nhap)" : ""));
    });
    if (pqInvalid) lines.push("# Da bo " + pqInvalid + " band khong hop le.");
    return lines.join("\n") + "\n";
  }
  throw new Error("Exporter không tồn tại: " + kind);
}
function expDo(kind, filename, mime){
  var src = expSource();
  if (!src){ $("expMsg").textContent = "Chưa có nguồn band để xuất — hãy chạy Hardware Solver trước, hoặc đổi nguồn về “EQ hiện tại của engine”."; return; }
  var meta = expMetaFor(src);
  dlText(filename(expSlug(meta.headphone)), expRender(kind, src, meta), mime);
  $("expMsg").textContent = "Đã xuất " + filename(expSlug(meta.headphone)) + " — " + src.bands.length + " band · pre-amp " + fmtDb(src.preamp) + " dB · " + meta.profile + ".";
}
$("expSrc").addEventListener("change", expMetaLine);
$("expApo").addEventListener("click", function(){ expDo("apo", function(s){ return s + "_apo-peace.txt"; }); });
$("expSS").addEventListener("click", function(){ expDo("soundsource", function(s){ return s + "_soundsource.json"; }, "application/json;charset=utf-8"); });
$("expWav").addEventListener("click", function(){ expDo("wavelet", function(s){ return s + "_wavelet.json"; }, "application/json;charset=utf-8"); });
$("expPA").addEventListener("click", function(){ expDo("poweramp", function(s){ return s + "_poweramp.json"; }, "application/json;charset=utf-8"); });
$("expJD").addEventListener("click", function(){ expDo("jamesdsp", function(s){ return s + "_jamesdsp-ddc.vdc"; }); });
$("expCamilla").addEventListener("click", function(){ expDo("camilla", function(s){ return s + "_camilladsp.yml"; }, "text/yaml;charset=utf-8"); });
$("expQudelix").addEventListener("click", function(){ expDo("qudelix", function(s){ return s + "_qudelix-5k.txt"; }); });
$("expRoon").addEventListener("click", function(){ expRoon(); });
$("expEasy").addEventListener("click", function(){ expDo("easyeffects", function(s){ return s + "_easyeffects.json"; }, "application/json;charset=utf-8"); });
$("expProq").addEventListener("click", function(){ expDo("proq", function(s){ return s + "_proq-bands.txt"; }); });
try { var gk = localStorage.getItem("webAutoEq.geqset.v1"); if (gk && GEQ_SETS[gk]) $("geqSel").value = gk; } catch (e) {}
$("geqSel").addEventListener("change", function(){ try { localStorage.setItem("webAutoEq.geqset.v1", $("geqSel").value); } catch (e) {} });
$("geqBuild").addEventListener("click", geqBuild);
$("geqDownload").addEventListener("click", geqDownload);
/* --- AutoEQ hang loat (vong tu dong 19:44, huong B muc 2) ---
   Chon nhieu tai nghe trong kho AE_PHONES, chay aeCompute dong bo cho tung
   tai nghe voi dung target/cau hinh hien tai (aeTarget, aeBands, aeAdj,
   aePreserveChar), khong goi aeSelectPhone/aeApplyToEngine nen tai nghe
   dang chon va EQ engine khong doi. Moi muc xuat dung dinh dang APO cua
   expRender("apo") (Preamp + Filter PK/LSC/HSC), gop trong mot file text,
   kem bang tong ket tai nghe / RMS truoc / RMS sau / pre-amp. Lua chon
   luu localStorage khoa webAutoEq.batchsel.v1; gioi han 20 muc/lan chay. */
var BATCH_SEL = {};
var BATCH_LAST = null;
var BATCH_RESTORED = false;
function batchSaveSel(){ try { localStorage.setItem("webAutoEq.batchsel.v1", JSON.stringify(Object.keys(BATCH_SEL))); } catch (e) {} }
function batchRestoreSel(){
  if (BATCH_RESTORED) return; BATCH_RESTORED = true;
  try {
    var raw = localStorage.getItem("webAutoEq.batchsel.v1"); if (!raw) return;
    JSON.parse(raw).forEach(function(id){ if (AE_PHONES[id]) BATCH_SEL[id] = true; });
  } catch (e) {}
}
function batchSelCount(){ return Object.keys(BATCH_SEL).length; }
function batchSelInfo(){
  var el = $("batchSelInfo"); if (!el) return;
  el.textContent = batchSelCount()
    ? ("Đã chọn " + batchSelCount() + " tai nghe cho lần chạy hàng loạt — lựa chọn được lưu tự động, mở lại trang vẫn còn.")
    : "Chưa chọn tai nghe nào — gõ vào ô tìm kiếm rồi tích chọn, lựa chọn được lưu tự động.";
}
function batchCurrentList(){
  batchRestoreSel();
  var q = $("batchSearch") ? $("batchSearch").value.trim() : "";
  var keys = Object.keys(AE_PHONES);
  var list;
  if (q){
    /* (vòng tự động 10:54, hướng D): gộp vòng lọc s>10 vào vòng chấm điểm trong batchCurrentList (js/07-database.js) — trước đây map toàn bộ AE_PHONES (tới 5.000 mục) thành wrapper {p,s} rồi filter s>10, cấp phát ~5.000 wrapper thừa mỗi lần gõ tìm kiếm hàng loạt; nay một vòng duy nhất chỉ push wrapper khi s>10 rồi sort/slice/map như cũ. Cùng thứ tự all, cùng comparator, sort ổn định nên đầu ra GIỐNG TỪNG BIT (kể cả mảng thưa: kiểm tra (_bi in all) mô phỏng đúng ngữ nghĩa bỏ qua lỗ của map; lỗi ném khi phần tử null/getter ném lỗi giữ nguyên thứ tự gọi aeStepScore). Đối xứng với vá aeRenderStepResults 08:24 ở js/03-solver.js, áp cho nhánh hàng loạt chưa từng làm. */
    var _bscored = [];
    for (var _bi = 0; _bi < keys.length; _bi++){
      var _bp = AE_PHONES[keys[_bi]];
      var _bs = aeStepScore(q, _bp.name);
      if (_bs > 10) _bscored.push({ p: _bp, s: _bs });
    }
    _bscored.sort(function(a, b){ return b.s - a.s; });
    list = _bscored.slice(0, 60).map(function(x){ return x.p; });
  } else {
    /* (vòng tự động 17:24, hướng D — ÁP DỤNG, vá code, bản đa file): tái dùng cache danh sách đã sắp xếp _aeStepSortedList (js/03-solver.js, áp dụng 06:00 cho aeRenderStepResults) trong nhánh ô tìm trống của batchCurrentList thay vì sort lại toàn bộ AE_PHONES (tới 5.000 mục) mỗi lần render panel batch. Cùng thứ tự Object.keys + cùng comparator a.name<b.name?-1:1 + sort ổn định nên đầu ra GIỐNG TỪNG BIT; cache tự dựng lại khi AE_PHONES thêm/xoá/thay object/đổi tên (snapshot keys/phones/names trong _aeStepSortedList). Fallback sort cũ nếu 03-solver chưa nạp. Lab (hidden_files/run_20261125_1724_D/lab/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 314/314 GIỐNG TỪNG BIT cả 2 lần (5000 mục, cache lạnh/ấm, xen kẽ gọi trực tiếp cache, thêm/xoá/thay object/đổi tên tại chỗ/đổi rig/reorder, rỗng/1 mục/tên trùng, nhánh q, fuzz 300 mutation xen kẽ); bench paired-median xen kẽ 15 vòng trên nhánh ô trống 5000 mục — lần 1 warm 2,3764x (15/15), lần 2 warm 2,4265x (15/15); workload adversarial đổi tên mỗi lượt (rebuild mỗi lần) 0,82x cả 2 lần — không phải workload thực tế (AE_PHONES ổn định giữa các lần render batch, cache đã ấm từ aeRenderStepResults). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
    /* (vòng tự động 19:24, hướng D — ÁP DỤNG, vá code, bản đa file): dùng keys trực tiếp trong batchCurrentList (js/07-database.js) thay vì dựng mảng all = Object.keys(AE_PHONES).map(...) mỗi lần gọi — trước đây nhánh ô trống vẫn map toàn bộ AE_PHONES (tới 5.000 mục) chỉ để lấy all.length cho trường trả về, dù list đã lấy từ cache _aeStepSortedList; nay tính keys MỘT lần, nhánh q vòng trực tiếp trên keys (cùng thứ tự Object.keys, cùng comparator, sort ổn định nên đầu ra GIỐNG TỪNG BIT; all.length cũ luôn bằng keys.length vì map trên mảng dày), nhánh ô trống truyền chính keys cho _aeStepSortedList và trả all = keys.length, fallback giữ nguyên map+sort cũ trên keys. Lab (hidden_files/run_20261125_1924_D/lab/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 569/569 GIỐNG TỪNG BIT cả 2 lần (cỡ 0/1/3/100/5000, tên trùng/unicode, chuỗi mutation thêm/xoá/thay object/đổi tên tại chỗ/reorder xen kẽ, fuzz 300, entry null) + fallback 205/205; bench paired-median xen kẽ 15 vòng trên 5.000 mục — nhánh ô trống lần 1 1,7512x (15/15), lần 2 1,7225x (15/15); nhánh q trung tính trong nhiễu (điểm aeStepScore chiếm áp đảo). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
    list = (typeof _aeStepSortedList === "function" ? _aeStepSortedList(keys) : keys.map(function(id){ return AE_PHONES[id]; }).sort(function(a, b){ return a.name < b.name ? -1 : 1; })).slice(0, 60);
  }
  return { list: list, all: keys.length, q: q };
}
function batchRenderList(){
  var box = $("batchList"); if (!box) return;
  var cur = batchCurrentList(), list = cur.list;
  box.innerHTML = "";
  list.forEach(function(p){
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.08)";
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!BATCH_SEL[p.id]; cb.style.marginTop = "3px";
    cb.addEventListener("change", function(){ if (this.checked) BATCH_SEL[p.id] = true; else delete BATCH_SEL[p.id]; batchSaveSel(); batchSelInfo(); });
    var sp = document.createElement("span");
    sp.innerHTML = "<span class=\"nm\">" + p.name.replace(/</g, "&lt;") + "</span><span class=\"mt\">" + aePhoneMeta(p).replace(/</g, "&lt;") + "</span>";
    row.appendChild(cb); row.appendChild(sp); box.appendChild(row);
  });
  var hint = document.createElement("p");
  hint.className = "note"; hint.style.margin = "2px 0 0";
  hint.textContent = cur.q
    ? (list.length + " kết quả khớp nhất trong " + cur.all + " tai nghe — tích vào ô vuông để thêm vào danh sách hàng loạt.")
    : ("Hiển thị " + list.length + "/" + cur.all + " tai nghe (theo tên) — gõ vào ô tìm kiếm để lọc nhanh trong toàn bộ kho.");
  box.appendChild(hint);
  batchSelInfo();
}
function batchApoSection(name, rig, targetName, preamp, bands){
  /* APO hang loat (Pha C 2026-11-05): guard NaN/Infinity/denormal + kep RBJ
     (SOUL §3.3: freq [10, 22000], gain [-30, 30], Q [0.1, 30]) chi trong ham
     nay, guong mau guard APO don le trong expRender (Pha C 2026-11-05).
     Ly do: toFixed(NaN/Infinity) ghi nguyen chu "NaN"/"Infinity" ra file
     text, Equalizer APO co the hieu sai hoac loi khi nap; gia tri huu han
     ngoai dai thi xuat nguyen xi, khac dap tuyen RBJ da kep ma app dang
     phat. Ham nay khong dung apoClamp vi no nam ngoai expRender va nhan
     preamp/band truc tiep tu batchRun (pre tinh tu max cua out.res.total,
     band tu out.res.bands cua solver); aeComputeFinish khong co kiem tra
     isFinite nao cho band nen NaN song sot qua hau kiem. Band khong huu
     han thi bo (tuong duong identity) va ghi rieng mot dong comment (chi
     khi > 0, khong ghi chu NaN/Infinity vao file de file sach hoan toan);
     band huu han ngoai dai thi kep ve dai RBJ; preamp khong huu han ve 0,
     denormal < 1e-30 ve 0. So Filter danh lai lien tuc theo cac band con
     lai. Moi gia tri hop le trong dai RBJ deu cho section byte-identical
     voi ban cu (batch luon ghi ON, khong co khai niem OFF o day). */
  function batchApoClamp(v, lo, hi){ if (!isFinite(v)) return null; if (Math.abs(v) < 1e-30) v = 0; return Math.max(lo, Math.min(hi, v)); }
  var APO_T = { peaking: "PK", lowshelf: "LSC", highshelf: "HSC" };
  var batchApoPre = isFinite(preamp) ? preamp : 0;
  if (Math.abs(batchApoPre) < 1e-30) batchApoPre = 0;
  var lines = ["##### " + name, "# Rig: " + (AE_RIGLBL[rig] || rig), "# Target: " + targetName,
    "Preamp: " + batchApoPre.toFixed(2) + " dB"];
  var batchApoInvalid = 0, batchApoN = 0;
  bands.forEach(function(b){
    var f = batchApoClamp(b.freq, 10, 22000), g = batchApoClamp(b.gain, -30, 30), q = batchApoClamp(b.q, 0.1, 30);
    if (f === null || g === null || q === null){ batchApoInvalid++; return; }
    batchApoN++;
    lines.push("Filter " + batchApoN + ": ON " + (APO_T[b.type] || "PK") + " Fc " + Math.round(f) + " Hz Gain " + g.toFixed(2) + " dB Q " + q.toFixed(2));
  });
  if (batchApoInvalid) lines.push("# Da bo " + batchApoInvalid + " band khong hop le.");
  return lines.join("\n");
}
function batchRun(){
  batchRestoreSel();
  var ids = Object.keys(BATCH_SEL).filter(function(id){ return !!AE_PHONES[id]; });
  ids.sort(function(a, b){ return AE_PHONES[a].name < AE_PHONES[b].name ? -1 : 1; });
  var info = $("batchInfo");
  if (!ids.length){ if (info) info.textContent = "Chưa chọn tai nghe nào — gõ vào ô tìm kiếm rồi tích chọn ít nhất một tai nghe."; return; }
  var capped = ids.length > 20;
  if (capped) ids = ids.slice(0, 20);
  var targetId = $("aeTarget").value;
  var targetName = (AE_TARGETS[targetId] ? AE_TARGETS[targetId].name : targetId);
  var nB = parseInt($("aeBands").value, 10);
  var preserve = !!$("aePreserveChar").checked;
  var adj = aeAdj();
  var rows = [], sections = [], skipped = [];
  var batchBtn = $("batchRun");
  if (batchBtn) batchBtn.disabled = true;
  var bi = 0;
  function batchStep(){
    try {
      if (bi >= ids.length){ batchFinish(); return; }
      var id = ids[bi++];
      var p = AE_PHONES[id], pts = null;
      try { pts = aePhonePoints(p); } catch (e) { pts = null; }
      if (!pts){
        skipped.push(p.name);
        if (info) info.textContent = "Đang chạy hàng loạt: " + bi + "/" + ids.length + " tai nghe (bỏ qua " + p.name + ")…";
        setTimeout(batchStep, 0);
        return;
      }
      if (info) info.textContent = "Đang chạy hàng loạt: " + bi + "/" + ids.length + " tai nghe (" + p.name + ")…";
      aeComputeAsync(aePrepare(pts, aeCurrentSmoothMode()), targetId, adj, nB, preserve, false, undefined, function(out){
        try {
          var mx = -Infinity;
          out.res.total.forEach(function(v){ if (v > mx) mx = v; });
          var pre = (mx > 0) ? -(mx + 1.0) : 0;
          rows.push({ name: p.name, before: out.errBefore, after: out.errAfter, pre: pre });
          sections.push(batchApoSection(p.name, p.rig, targetName, pre, out.res.bands));
          batchStep();
        } catch (e) {
          if (batchBtn) batchBtn.disabled = false;
          if (info) info.textContent = "Lỗi khi chạy hàng loạt: " + String(e && e.message ? e.message : e);
        }
      });
    } catch (e) {
      if (batchBtn) batchBtn.disabled = false;
      if (info) info.textContent = "Lỗi khi chạy hàng loạt: " + String(e && e.message ? e.message : e);
    }
  }
  function batchFinish(){
  var head = ["# Web AutoEQ — AutoEQ hang loat (file gop)",
    "# Target: " + targetName, "# So band: " + nB + " · Bao toan dac tinh goc: " + (preserve ? "BAT" : "TAT") + " · Muc lam muot: " + AE_SMOOTH_LBL[aeCurrentSmoothMode()],
    "# Ngay: " + new Date().toISOString(),
    "# Ghi chu: moi muc la mot preset APO doc lap (Preamp + Filter) — chep tung muc vao Equalizer APO; tai nghe dang chon va EQ engine khong doi sau lan chay nay."].join("\n");
  BATCH_LAST = { text: head + "\n\n" + sections.join("\n\n") + "\n", rows: rows };
  $("batchText").value = BATCH_LAST.text;
  var html = "<tr><th>Tai nghe</th><th>RMS trước (dB)</th><th>RMS sau (dB)</th><th>Pre-amp (dB)</th></tr>";
  rows.forEach(function(r){
    html += "<tr><td>" + r.name.replace(/</g, "&lt;") + "</td><td>" + r.before.toFixed(2) + "</td><td>" + r.after.toFixed(2) + "</td><td>" + fmtDb(r.pre) + "</td></tr>";
  });
  $("batchTable").innerHTML = html;
  if (info) info.textContent = "Đã chạy " + rows.length + " tai nghe với target “" + targetName + "” (" + nB + " band)"
    + (capped ? " — chỉ xử lý 20 mục đầu theo tên, bỏ phần còn lại của lựa chọn;" : ";")
    + (skipped.length ? " bỏ qua " + skipped.length + " mục không đọc được đường đo;" : "")
    + " tai nghe đang chọn và EQ engine không đổi.";
    if (batchBtn) batchBtn.disabled = false;
  }
  batchStep();
}
function batchDownload(){
  if (!BATCH_LAST || !$("batchText").value){
    var info = $("batchInfo"); if (info) info.textContent = "Chưa có kết quả hàng loạt — bấm “Chạy AutoEQ hàng loạt” trước rồi mới tải file.";
    return;
  }
  dlText("web-autoeq-batch_" + expSlug($("aeTarget").value) + ".txt", BATCH_LAST.text);
}
$("batchSearch").addEventListener("input", batchRenderList);
$("batchSearch").addEventListener("focus", batchRenderList);
$("batchSelAll").addEventListener("click", function(){
  batchCurrentList().list.forEach(function(p){ BATCH_SEL[p.id] = true; });
  batchSaveSel(); batchRenderList();
});
$("batchSelNone").addEventListener("click", function(){
  BATCH_SEL = {}; batchSaveSel(); batchRenderList();
});
$("batchRun").addEventListener("click", batchRun);
$("batchDownload").addEventListener("click", batchDownload);
batchRenderList();

/* --- So sanh target (vong tu dong 20:44, huong B — sau hang doi 1-3) ---
   Chua co that truoc vong nay (grep tgtCmp/so-sanh-target = 0): panel
   AutoEQ chi chay mot target moi lan. Nut moi chay aeCompute dong bo
   (nhu hang loat) cho moi option trong o #aeTarget voi dung cau hinh
   hien tai (aeBands, aeAdj, aePreserveChar, duong lam muot AE.sm dang
   dung), khong goi aeSelectPhone/aeApplyToEngine nen tai nghe dang
   chon va EQ engine khong doi. Bang xep theo RMS sau tang dan, dong
   dau tien duoc danh dau khop sat nhat; nut "Chon target nay" chi doi
   o #aeTarget (qua aeUpdateTarget) — ap len engine van phai bam
   Buoc 3. Pre-amp moi dong theo dung luat Giai doan 1 nhu hang loat.
   Chi chay khi bam nut, khong cham solver/engine/bo cuc, khong them
   trang thai luu tru rieng (bang la tam thoi; target da chon dung co
   che luu trang thai san co cua app). */
var TGT_CMP_LAST = null;
function tgtCmpEsc(s){ return String(s).replace(/</g, "&lt;"); }
function tgtCmpChoose(tid){
  var sel = $("aeTarget");
  if (!sel || !AE_TARGETS[tid]) return;
  sel.value = tid;
  try { aeUpdateTarget(); } catch (e) {}
  var info = $("tgtCmpInfo");
  if (info) info.textContent = "Đã chọn target \u201c" + AE_TARGETS[tid].name + "\u201d — bấm \u201cBước 3 — Chạy AutoEQ\u201d để áp lên engine (EQ engine chưa đổi).";
}
function tgtCmpRun(){
  var info = $("tgtCmpInfo");
  if (!AE.points){
    if (info) info.textContent = "Chưa chọn tai nghe — chọn tai nghe ở Bước 1 rồi bấm lại.";
    return;
  }
  var sel = $("aeTarget");
  if (!sel) return;
  var prep = { ptsN: AE.ptsN, rawG: AE.rawG, sm: AE.sm, nulls: AE.nulls };
  var adj = aeAdj();
  var nB = parseInt($("aeBands").value, 10);
  var preserve = !!$("aePreserveChar").checked;
  var rows = [];
  var cmpBtn = $("tgtCmpRun");
  if (cmpBtn) cmpBtn.disabled = true;
  var ci = 0;
  function tgtCmpStep(){
    try {
      while (ci < sel.options.length && !AE_TARGETS[sel.options[ci].value]) ci++;
      if (ci >= sel.options.length){ tgtCmpFinish(); return; }
      var tid = sel.options[ci].value;
      ci++;
      if (info) info.textContent = "Đang so sánh target " + ci + "/" + sel.options.length + " (" + AE_TARGETS[tid].name + ")…";
      try {
        aeComputeAsync(prep, tid, adj, nB, preserve, false, undefined, function(out){
          try {
            var mx = -Infinity;
            out.res.total.forEach(function(v){ if (v > mx) mx = v; });
            rows.push({ id: tid, name: AE_TARGETS[tid].name, before: out.errBefore, after: out.errAfter, pre: (mx > 0 ? -(mx + 1.0) : 0), viol: out.viol, nullBoost: out.nullBoost });
          } catch (e) {
            rows.push({ id: tid, name: AE_TARGETS[tid].name, err: String(e && e.message ? e.message : e) });
          }
          tgtCmpStep();
        });
      } catch (e) {
        rows.push({ id: tid, name: AE_TARGETS[tid].name, err: String(e && e.message ? e.message : e) });
        tgtCmpStep();
      }
    } catch (e) {
      if (cmpBtn) cmpBtn.disabled = false;
      if (info) info.textContent = "Lỗi khi so sánh target: " + String(e && e.message ? e.message : e);
    }
  }
  function tgtCmpFinish(){
  rows.sort(function(a, b){
    var av = (a.after === undefined ? 1e9 : a.after), bv = (b.after === undefined ? 1e9 : b.after);
    return av - bv;
  });
  TGT_CMP_LAST = rows;
  var html = "<tr><th>Target</th><th>RMS trước (dB)</th><th>RMS sau (dB)</th><th>Pre-amp (dB)</th><th></th></tr>";
  rows.forEach(function(r, k){
    if (r.err !== undefined){
      html += "<tr><td>" + tgtCmpEsc(r.name) + "</td><td colspan=\"4\">Lỗi: " + tgtCmpEsc(r.err) + "</td></tr>";
      return;
    }
    var best = (k === 0) ? " \u2605 khớp sát nhất" : "";
    html += "<tr" + (k === 0 ? " style=\"font-weight:bold\"" : "") + "><td>" + tgtCmpEsc(r.name) + best + "</td><td>" + r.before.toFixed(2) + "</td><td>" + r.after.toFixed(2) + "</td><td>" + fmtDb(r.pre) + "</td><td><button class=\"btn small\" data-tgt=\"" + r.id + "\">Chọn target này</button></td></tr>";
  });
  $("tgtCmpTable").innerHTML = html;
  var btns = $("tgtCmpTable").querySelectorAll("button[data-tgt]");
  btns.forEach(function(b){
    b.addEventListener("click", function(){ tgtCmpChoose(this.getAttribute("data-tgt")); });
  });
  if (info){
    if (rows.length && rows[0].after !== undefined) info.textContent = "Đã so sánh " + rows.length + " target với " + nB + " band — khớp sát nhất: \u201c" + rows[0].name + "\u201d (RMS sau " + rows[0].after.toFixed(2) + " dB). Bấm \u201cChọn target này\u201d ở dòng muốn dùng, rồi bấm Bước 3 để chạy AutoEQ lên engine.";
    else info.textContent = "Không so sánh được target nào.";
  }
    if (cmpBtn) cmpBtn.disabled = false;
  }
  tgtCmpStep();
}
$("tgtCmpRun").addEventListener("click", function(){
  var info = $("tgtCmpInfo");
  if (info) info.textContent = "Đang chạy AutoEQ cho mọi target — chờ vài giây, bảng sẽ hiện khi xong…";
  setTimeout(tgtCmpRun, 30);
});

/* ================================================================
   v2 — CHIA SẺ URL + MÃ QR + XUẤT EASYEffects / PRO-Q
   EasyEffects: đối chiếu preset thật công khai (output ->
   equalizer#0 -> left/right bandN, input-gain = pre-amp, num-bands,
   plugins_order). Pro-Q: .ffp là nhị phân độc quyền, không có đặc
   tả text công khai — chỉ xuất bảng band nhập tay, ghi rõ giới hạn.
   QR: Model 2 tự chứa, byte mode, EC level L, version 1-20, không
   cần mạng. Link chia sẻ: trạng thái EQ chính -> tham số ?waeq=.
   ================================================================ */
var SHARE = { built: false, link: "", appliedFromUrl: false };
function shareFmt(v, dp){
  var n = parseFloat(v);
  if (!isFinite(n)) n = 0;
  var m = Math.pow(10, dp);
  return String(Math.round(n * m) / m);
}
function shareTypeChar(t){ return t === "lowshelf" ? "l" : (t === "highshelf" ? "h" : "p"); }
function shareBandStr(b){
  return shareFmt(b.freq, 1) + "," + shareFmt(b.gain, 2) + "," + shareFmt(b.q, 2) + "," + shareTypeChar(b.type) + "," + (b.on !== false ? "1" : "0");
}
function shareBandsStr(list){
  return list.map(function(b){
    var bb = (typeof autoSanitizeBand === "function") ? autoSanitizeBand(b) : b;
    return shareBandStr(bb);
  }).join(";");
}
function shareStateString(){
  var b10 = (typeof BAND_STORE !== "undefined" && BAND_STORE[10]) ? BAND_STORE[10] : [];
  var b20 = (typeof BAND_STORE !== "undefined" && BAND_STORE[20]) ? BAND_STORE[20] : [];
  var parts = ["1",
    encodeURIComponent((typeof AE !== "undefined" && AE.phoneId) ? AE.phoneId : ""),
    $("aeTarget").value,
    shareFmt($("aeTilt").value, 2), shareFmt($("aeBass").value, 1), shareFmt($("aeEar").value, 1),
    ($("aePreserveChar").checked ? "1" : "0"),
    String(parseInt($("aeBands").value, 10) || 10),
    String(bandCount),
    (mode === "fir" ? "fir" : "iir"),
    (preMode === "manual" ? "manual" : "auto"),
    shareFmt(manualPreDb, 1), shareFmt(extraHeadDb, 1),
    (limiterOn ? "1" : "0"),
    String(parseInt($("vol").value, 10) || 0),
    (PSY.loud.on ? "1" : "0"), shareFmt(PSY.loud.ref, 1), shareFmt(PSY.loud.listen, 1),
    shareBandsStr(b10), shareBandsStr(b20)];
  return parts.join("~");
}
function shareParseBands(txt, n){
  var arr = txt.split(";");
  if (arr.length !== n) return null;
  var out = [];
  for (var i = 0; i < arr.length; i++){
    var f = arr[i].split(",");
    if (f.length !== 5) return null;
    var fr = parseFloat(f[0]), gn = parseFloat(f[1]), q = parseFloat(f[2]);
    if (!isFinite(fr) || !isFinite(gn) || !isFinite(q)) return null;
    var t = f[3] === "l" ? "lowshelf" : (f[3] === "h" ? "highshelf" : (f[3] === "p" ? "peaking" : null));
    if (!t) return null;
    if (f[4] !== "0" && f[4] !== "1") return null;
    out.push({ freq: fr, type: t, gain: gn, q: q, on: f[4] === "1" });
  }
  return out;
}
function shareParseState(str){
  if (!str) return null;
  var p = str.split("~");
  if (p.length !== 20 || p[0] !== "1") return null;
  var phoneId = "";
  try { phoneId = decodeURIComponent(p[1]); } catch (e) { return null; }
  function num(i, dft){ var v = parseFloat(p[i]); return isFinite(v) ? v : dft; }
  var b10 = shareParseBands(p[18], 10), b20 = shareParseBands(p[19], 20);
  if (!b10 || !b20) return null;
  var aeB = parseInt(p[7], 10);
  if (!isFinite(aeB) || aeB < 5 || aeB > 20) aeB = 10;
  var bc = (p[8] === "20") ? 20 : 10;
  var vol = parseInt(p[14], 10);
  if (!isFinite(vol)) vol = 80;
  var s = { v: 1, phoneId: phoneId, target: p[2], tilt: num(3, 0), bass: num(4, 0), ear: num(5, 0),
    preserveChar: p[6] === "1", aeBands: aeB, bandCount: bc, mode: (p[9] === "fir" ? "fir" : "iir"),
    preMode: (p[10] === "manual" ? "manual" : "auto"), manualPreDb: num(11, 0), extraHeadDb: num(12, 0),
    limiterOn: p[13] === "1", vol: vol,
    loud: { on: p[15] === "1", ref: num(16, 80), listen: num(17, 80) },
    bands10: b10, bands20: b20 };
  if (typeof autoSanitizeBand === "function"){
    s.bands10 = s.bands10.map(autoSanitizeBand);
    s.bands20 = s.bands20.map(autoSanitizeBand);
  }
  return s;
}
function shareBuildLink(){
  var href = window.location.href.split("#")[0].split("?")[0];
  return href + "?waeq=" + shareStateString();
}
function waeqApplyFromUrl(){
  var m = window.location.search.match(/[?&]waeq=([^&#]*)/);
  if (!m) return false;
  var s = null;
  try { s = shareParseState(m[1]); } catch (e) { s = null; }
  if (!s){
    var el0 = $("shareMsg");
    if (el0) el0.textContent = "Link chia sẻ không hợp lệ — đã khôi phục từ bản lưu localStorage (nếu có).";
    return false;
  }
  try {
    var flag = null;
    try { flag = window.localStorage.getItem("webAutoEq.autoMode.v1"); } catch (e) {}
    s.autoMode = (flag !== "0");
  } catch (e) {}
  var ok = false;
  try { ok = autoApplySnapshot(s); } catch (e) { ok = false; }
  if (!ok) return false;
  SHARE.appliedFromUrl = true;
  var info = $("autoSavedInfo");
  if (info) info.textContent = "đã khôi phục từ link chia sẻ (?waeq) — bản lưu localStorage không ghi đè lên trạng thái này khi mở trang";
  var el = $("shareMsg");
  if (el) el.textContent = "Đã khôi phục trạng thái từ link chia sẻ (?waeq). Link này chỉ mang trạng thái EQ chính (tai nghe, target, tilt/bass/ear, band 10/20, mode, pre-amp, limiter, âm lượng, loudness); notch/crossfeed/Dynamic EQ và điểm chấm mù vẫn lấy theo máy này, không nằm trong link.";
  return true;
}
function shareBuild(){
  var link = shareBuildLink();
  SHARE.link = link; SHARE.built = true;
  var inp = $("shareLink");
  if (inp) inp.value = link;
  var qr = null;
  try { qr = qrEncode(link); } catch (e) { qr = null; }
  var cv = $("shareQr");
  if (qr && cv) qrDrawQr(cv, qr);
  var msg = $("shareMsg");
  if (msg){
    if (qr) msg.textContent = "Link đã tạo (" + link.length + " ký tự) · mã QR version " + qr.version + " (" + qr.size + "x" + qr.size + " module, EC level L, mask " + qr.mask + ") — quét mã để mở đúng link này. Lưu ý: link trỏ tới file HTML này (đường dẫn hiện tại của trình duyệt); người nhận cần có cùng file mới mở được trạng thái.";
    else msg.textContent = "Link đã tạo (" + link.length + " ký tự) nhưng quá dài cho mã QR (tối đa version 20, EC level L) — vẫn dùng được nút sao chép link. Rút ngắn bằng cách đặt file ở đường dẫn ngắn hơn.";
  }
}
function shareCopy(){
  if (!SHARE.link) shareBuild();
  var inp = $("shareLink");
  function done(ok){
    var msg = $("shareMsg");
    if (msg) msg.textContent = ok ? "Đã sao chép link vào clipboard." : "Không sao chép tự động được — hãy bôi đen link ở ô trên và sao chép thủ công (Ctrl+C).";
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(SHARE.link).then(function(){ done(true); }, function(){ done(false); });
      return;
    }
  } catch (e) {}
  try {
    if (inp){ inp.focus(); inp.select(); done(document.execCommand("copy")); }
    else done(false);
  } catch (e) { done(false); }
}
function shareRefreshIfBuilt(){ if (SHARE.built){ try { shareBuild(); } catch (e) {} } }

/* --- QR Model 2, byte mode, EC level L, version 1-20 (tự chứa) --- */
var QR_EC_L = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28];
var QR_BLK_L = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8];
var QR_TOT = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085];
var QR_ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
var QR_REM = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3];
var QR_GEXP = [], QR_GLOG = [];
(function qrInitGf(){
  var x = 1, i;
  for (i = 0; i < 255; i++){ QR_GEXP[i] = x; QR_GLOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (i = 255; i < 512; i++) QR_GEXP[i] = QR_GEXP[i - 255];
})();
function qrGfMul(a, b){ if (a === 0 || b === 0) return 0; return QR_GEXP[QR_GLOG[a] + QR_GLOG[b]]; }
function qrRsDivisor(deg){
  var g = [1], i, k, a, nxt;
  for (i = 0; i < deg; i++){
    a = QR_GEXP[i];
    nxt = new Array(g.length + 1);
    nxt[0] = g[0];
    for (k = 1; k < g.length; k++) nxt[k] = g[k] ^ qrGfMul(g[k - 1], a);
    nxt[g.length] = qrGfMul(g[g.length - 1], a);
    g = nxt;
  }
  return g;
}
function qrRsRemainder(data, deg){
  var gen = qrRsDivisor(deg), res = data.slice(), i, j, coef;
  for (i = 0; i < deg; i++) res.push(0);
  for (i = 0; i < data.length; i++){
    coef = res[i];
    if (coef !== 0){
      for (j = 0; j < gen.length; j++) res[i + j] ^= qrGfMul(gen[j], coef);
    }
  }
  return res.slice(data.length);
}
function qrFormatBits(mask){
  var data = (1 << 3) | mask, rem = data << 10, gen = 0x537, i;
  for (i = 14; i >= 10; i--){ if ((rem >> i) & 1) rem ^= (gen << (i - 10)); }
  return ((data << 10) | rem) ^ 0x5412;
}
function qrVersionBits(v){
  var rem = v << 12, gen = 0x1F25, i;
  for (i = 17; i >= 12; i--){ if ((rem >> i) & 1) rem ^= (gen << (i - 12)); }
  return (v << 12) | rem;
}
function qrMaskBit(mask, r, c){
  if (mask === 0) return (r + c) % 2 === 0;
  if (mask === 1) return r % 2 === 0;
  if (mask === 2) return c % 3 === 0;
  if (mask === 3) return (r + c) % 3 === 0;
  if (mask === 4) return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
  if (mask === 5) return (r * c) % 2 + (r * c) % 3 === 0;
  if (mask === 6) return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
  return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
}
function qrPenalty(M){
  var size = M.length, pen = 0, y, x, run, col, k, i, j, dark = 0, total = size * size;
  function runScore(arr){
    var s = 0, cur = arr[0], len = 1, t;
    for (t = 1; t < arr.length; t++){
      if (arr[t] === cur) len++;
      else { if (len >= 5) s += 3 + (len - 5); cur = arr[t]; len = 1; }
    }
    if (len >= 5) s += 3 + (len - 5);
    return s;
  }
  for (y = 0; y < size; y++) pen += runScore(M[y]);
  for (x = 0; x < size; x++){
    col = [];
    for (y = 0; y < size; y++) col.push(M[y][x]);
    pen += runScore(col);
  }
  for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++)
    if (M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) pen += 3;
  function finderLike(arr){
    var s = 0, t;
    for (t = 0; t + 11 <= arr.length; t++){
      var seg = arr.slice(t, t + 11).join("");
      if (seg === "10111010000" || seg === "00001011101") s += 40;
    }
    return s;
  }
  for (y = 0; y < size; y++) pen += finderLike(M[y]);
  for (x = 0; x < size; x++){
    col = [];
    for (y = 0; y < size; y++) col.push(M[y][x]);
    pen += finderLike(col);
  }
  for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (M[y][x] === 1) dark++;
  k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  if (k < 0) k = 0;
  pen += k * 10;
  return pen;
}
function qrEncode(text){
  var utf = unescape(encodeURIComponent(text)), bytes = [], i;
  for (i = 0; i < utf.length; i++) bytes.push(utf.charCodeAt(i));
  var ver = 0, dc = 0, ec = 0, blk = 0, v;
  for (v = 1; v <= 20; v++){
    var ecc = QR_EC_L[v - 1], nb = QR_BLK_L[v - 1];
    var d = QR_TOT[v - 1] - nb * ecc;
    var cb = (v <= 9) ? 8 : 16;
    if (4 + cb + 8 * bytes.length <= d * 8){ ver = v; dc = d; ec = ecc; blk = nb; break; }
  }
  if (!ver) return null;
  var size = 17 + 4 * ver, bits = [];
  function pushBits(val, len){ var t; for (t = len - 1; t >= 0; t--) bits.push((val >> t) & 1); }
  pushBits(4, 4);
  pushBits(bytes.length, (ver <= 9) ? 8 : 16);
  for (i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
  var cap = dc * 8, term = Math.min(4, cap - bits.length), t;
  for (t = 0; t < term; t++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  var dataCw = [], k, j, w;
  for (k = 0; k < bits.length; k += 8){
    w = 0;
    for (j = 0; j < 8; j++) w = (w << 1) | bits[k + j];
    dataCw.push(w);
  }
  var pad = [0xEC, 0x11], pi = 0;
  while (dataCw.length < dc){ dataCw.push(pad[pi % 2]); pi++; }
  var shortLen = Math.floor(dc / blk), numLong = dc % blk, blocks = [], off = 0, bi, len;
  for (bi = 0; bi < blk; bi++){
    len = shortLen + (bi >= blk - numLong ? 1 : 0);
    blocks.push(dataCw.slice(off, off + len));
    off += len;
  }
  var ecBlocks = blocks.map(function(bl){ return qrRsRemainder(bl, ec); });
  var finalCw = [], ci, bj;
  for (ci = 0; ci < shortLen + 1; ci++)
    for (bj = 0; bj < blocks.length; bj++)
      if (ci < blocks[bj].length) finalCw.push(blocks[bj][ci]);
  for (var ei = 0; ei < ec; ei++)
    for (bj = 0; bj < ecBlocks.length; bj++) finalCw.push(ecBlocks[bj][ei]);
  var finalBits = [];
  for (i = 0; i < finalCw.length; i++) for (j = 7; j >= 0; j--) finalBits.push((finalCw[i] >> j) & 1);
  var M = [], F = [], y, x;
  for (y = 0; y < size; y++){
    M.push(new Array(size));
    F.push(new Array(size));
    for (x = 0; x < size; x++){ M[y][x] = 0; F[y][x] = false; }
  }
  function setFn(xx, yy, val){
    if (xx >= 0 && xx < size && yy >= 0 && yy < size){ M[yy][xx] = val; F[yy][xx] = true; }
  }
  function finderAt(cx, cy){
    var dy, dx, d;
    for (dy = -4; dy <= 4; dy++) for (dx = -4; dx <= 4; dx++){
      if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3){
        d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, (d === 2) ? 0 : 1);
      } else if (Math.max(Math.abs(dx), Math.abs(dy)) === 4){
        setFn(cx + dx, cy + dy, 0);
      }
    }
  }
  finderAt(3, 3);
  finderAt(size - 4, 3);
  finderAt(3, size - 4);
  for (x = 8; x <= size - 9; x++){ setFn(x, 6, (x % 2 === 0) ? 1 : 0); setFn(6, x, (x % 2 === 0) ? 1 : 0); }
  var aligns = QR_ALIGN[ver - 1], ai, aj;
  for (ai = 0; ai < aligns.length; ai++) for (aj = 0; aj < aligns.length; aj++){
    var ax = aligns[ai], ay = aligns[aj];
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
    var ddy, ddx, dd;
    for (ddy = -2; ddy <= 2; ddy++) for (ddx = -2; ddx <= 2; ddx++){
      dd = Math.max(Math.abs(ddx), Math.abs(ddy));
      setFn(ax + ddx, ay + ddy, (dd === 1) ? 0 : 1);
    }
  }
  setFn(8, size - 8, 1);
  function markFormat(){
    var ii;
    for (ii = 0; ii <= 5; ii++) setFn(8, ii, 0);
    setFn(8, 7, 0); setFn(8, 8, 0); setFn(7, 8, 0);
    for (ii = 9; ii < 15; ii++) setFn(14 - ii, 8, 0);
    for (ii = 0; ii < 8; ii++) setFn(size - 1 - ii, 8, 0);
    for (ii = 8; ii < 15; ii++) setFn(8, size - 15 + ii, 0);
  }
  markFormat();
  if (ver >= 7){
    for (i = 0; i < 18; i++){
      var a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, 0); setFn(b, a, 0);
    }
  }
  var bitIdx = 0, right, vert, jj, xx, yy, upward;
  for (right = size - 1; right >= 1; right -= 2){
    if (right === 6) right = 5;
    for (vert = 0; vert < size; vert++){
      for (jj = 0; jj < 2; jj++){
        xx = right - jj;
        upward = ((right + 1) & 2) === 0;
        yy = upward ? size - 1 - vert : vert;
        if (!F[yy][xx] && bitIdx < finalBits.length){
          M[yy][xx] = finalBits[bitIdx];
          bitIdx++;
        }
      }
    }
  }
  var bestMask = 0, bestPen = Infinity, mask, trial, ry, rx;
  for (mask = 0; mask < 8; mask++){
    trial = [];
    for (ry = 0; ry < size; ry++){
      trial.push(M[ry].slice());
      for (rx = 0; rx < size; rx++)
        if (!F[ry][rx] && qrMaskBit(mask, ry, rx)) trial[ry][rx] ^= 1;
    }
    var pen = qrPenalty(trial);
    if (pen < bestPen){ bestPen = pen; bestMask = mask; }
  }
  for (y = 0; y < size; y++) for (x = 0; x < size; x++)
    if (!F[y][x] && qrMaskBit(bestMask, y, x)) M[y][x] ^= 1;
  var fb = qrFormatBits(bestMask);
  function bitAt(n){ return (fb >> n) & 1; }
  setFn(8, 0, bitAt(0)); setFn(8, 1, bitAt(1)); setFn(8, 2, bitAt(2)); setFn(8, 3, bitAt(3)); setFn(8, 4, bitAt(4)); setFn(8, 5, bitAt(5));
  setFn(8, 7, bitAt(6)); setFn(8, 8, bitAt(7)); setFn(7, 8, bitAt(8));
  for (i = 9; i < 15; i++) setFn(14 - i, 8, bitAt(i));
  for (i = 0; i < 8; i++) setFn(size - 1 - i, 8, bitAt(i));
  for (i = 8; i < 15; i++) setFn(8, size - 15 + i, bitAt(i));
  if (ver >= 7){
    var vb = qrVersionBits(ver);
    for (i = 0; i < 18; i++){
      var bit = (vb >> i) & 1;
      var aa = size - 11 + (i % 3), bb = Math.floor(i / 3);
      setFn(aa, bb, bit); setFn(bb, aa, bit);
    }
  }
  return { version: ver, size: size, mask: bestMask, modules: M };
}
function qrDrawQr(canvas, qr){
  var qz = 4, scale = Math.max(2, Math.floor(300 / (qr.size + qz * 2)));
  var px = (qr.size + qz * 2) * scale, x, y;
  canvas.width = px; canvas.height = px;
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000000";
  for (y = 0; y < qr.size; y++) for (x = 0; x < qr.size; x++)
    if (qr.modules[y][x] === 1) ctx.fillRect((x + qz) * scale, (y + qz) * scale, scale, scale);
  return px;
}
$("shareBuild").addEventListener("click", function(){ shareBuild(); });
$("shareCopy").addEventListener("click", function(){ shareCopy(); });


/* ================================================================
   5.6 — CONVOLUTION IR: WAV 32-bit float + LIST/INFO metadata
   Minimum-Phase: tái cấu trúc pha tối thiểu bằng cepstrum.
   Linear-Phase: IR đối xứng cửa sổ Hann, trễ = N/2 mẫu.
   ================================================================ */
function irMixAlpha(v){
  var a = (typeof v === "number") ? v : 0.5;
  if (!isFinite(a)) a = 0.5;
  if (a < 0) a = 0;
  if (a > 1) a = 1;
  return a;
}
function irBuild(bandList, pre, fs, N, phase, mixA){
  var mag = new Float64Array(N), k, i;
  var irCc = dbBandCoeffs(bandList, fs);
  for (k = 0; k <= N / 2; k++){
    var f = k * fs / N, fe = Math.max(f, 10);
    mag[k] = Math.pow(10, (dbBandDbC(irCc, fe, fs) + pre) / 20);
    if (k > 0 && k < N / 2) mag[N - k] = mag[k];
  }
  var taps;
  if (phase === "lin"){
    var re = Float64Array.from(mag), im = new Float64Array(N);
    fft(re, im, true);
    taps = new Float64Array(N);
    var half = N / 2;
    for (i = 0; i < N; i++){
      var idx = ((i - half) % N + N) % N;
      taps[i] = re[idx] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    }
  } else {
    var lr = new Float64Array(N), li = new Float64Array(N);
    for (i = 0; i < N; i++) lr[i] = Math.log(Math.max(mag[i], 1e-12));
    fft(lr, li, true);                       /* cepstrum thực */
    for (i = 1; i < N / 2; i++) lr[i] *= 2;  /* lifter: giữ nửa nhân quả, nhân đôi */
    for (i = N / 2 + 1; i < N; i++) lr[i] = 0;
    li = new Float64Array(N);
    fft(lr, li, false);                      /* -> log-phổ phức của hệ pha tối thiểu */
    if (phase === "mix"){
      /* Mixed Phase từ Excess Phase (Nhóm 2 v2): pha thừa = pha tuyến tính
         (trễ D = (N-1)/2, tức -2*pi*k*D/N) trừ pha tối thiểu li[k] — cả hai
         đều ở dạng chưa wrap (li là pha Hilbert từ cepstrum, không qua
         atan2) nên cộng tuyến tính theo alpha là đúng, không bị nhảy wrap.
         Phổ chỉ dựng nửa 0..N/2 rồi gương liên hợp để taps luôn thực:
         alpha = 0 cho đúng phổ pha tối thiểu (taps trùng bản "min"),
         alpha = 1 cho pha tuyến tính trễ D. Bin Nyquist ép pha 0 để taps
         thực — chỉ ảnh hưởng đúng tần số Nyquist, ngoài dải kiểm chứng
         20 Hz-16 kHz (bản "lin" đối xứng cũng không giữ được biên độ tại
         đúng Nyquist). Biên độ giữ nguyên ở mọi alpha vì chỉ xoay pha. */
      var a = irMixAlpha(mixA);
      var D = (N - 1) / 2;
      var mr = new Float64Array(N), mi = new Float64Array(N);
      for (k = 0; k <= N / 2; k++){
        var phiMin = li[k];
        var phiLin = -2 * Math.PI * k * D / N;
        var phi = phiMin + a * (phiLin - phiMin);
        var mm = Math.exp(lr[k]);
        mr[k] = mm * Math.cos(phi); mi[k] = mm * Math.sin(phi);
      }
      mr[N / 2] = Math.exp(lr[N / 2]); mi[N / 2] = 0;
      for (k = 1; k < N / 2; k++){ mr[N - k] = mr[k]; mi[N - k] = -mi[k]; }
      fft(mr, mi, true);
      taps = mr;
    } else {
      var hr = new Float64Array(N), hi = new Float64Array(N);
      for (i = 0; i < N; i++){ var e = Math.exp(lr[i]); hr[i] = e * Math.cos(li[i]); hi[i] = e * Math.sin(li[i]); }
      fft(hr, hi, true);
      taps = hr;
    }
  }
  var pk = 0; for (i = 0; i < N; i++) pk = Math.max(pk, Math.abs(taps[i]));
  var gainDb = 0;
  if (pk > 0.99){ var s = 0.99 / pk; for (i = 0; i < N; i++) taps[i] *= s; gainDb = 20 * Math.log10(s); }
  return { taps: taps, peak: pk, gainDb: gainDb };
}
function irAscii(s){
  return String(s).replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "?");
}
function irWavBlob(taps, fs, meta){
  var nCh = 2, n = taps.length, i;
  function sb(str){ var a = []; for (var j = 0; j < str.length; j++) a.push(str.charCodeAt(j) & 0xFF); return a; }
  function infoChunk(id, text){
    var b = sb(irAscii(text)), sz = b.length, pad = sz % 2;
    var out = new Uint8Array(8 + sz + pad), dvv = new DataView(out.buffer);
    out.set(sb(id), 0); dvv.setUint32(4, sz, true); out.set(b, 8);
    return out;
  }
  var infos = [
    infoChunk("INAM", meta.headphone + " - " + meta.targetName + " - " + meta.phaseLabel),
    infoChunk("ICMT", "Web AutoEQ convolution IR | Headphone: " + meta.headphone + " | Rig: " + (AE_RIGLBL[meta.rig] || meta.rig) + " | Target: " + meta.targetName + " | Profile: " + meta.profile + " | Preamp: " + meta.preamp.toFixed(2) + " dB | Phase: " + meta.phaseLabel + " | " + fs + " Hz | " + n + " taps | Date: " + meta.dateISO),
    infoChunk("ISFT", "Web AutoEQ - Giai doan 5/6 (Database & Universal Export)")
  ];
  var listSize = 4; infos.forEach(function(c){ listSize += c.length; });
  var dataBytes = n * nCh * 4;
  var total = 12 + (8 + 16) + (8 + 4) + (8 + dataBytes) + (8 + listSize); /* 12 = "RIFF"+size+"WAVE" */
  var buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf), off = 0;
  function wStr(s){ u8.set(sb(s), off); off += s.length; }
  function wU32(v){ dv.setUint32(off, v, true); off += 4; }
  function wU16(v){ dv.setUint16(off, v, true); off += 2; }
  wStr("RIFF"); wU32(total - 8); wStr("WAVE");
  wStr("fmt "); wU32(16); wU16(3); wU16(nCh); wU32(fs); wU32(fs * nCh * 4); wU16(nCh * 4); wU16(32);
  wStr("fact"); wU32(4); wU32(n);
  wStr("data"); wU32(dataBytes);
  for (i = 0; i < n; i++){ dv.setFloat32(off, taps[i], true); off += 4; dv.setFloat32(off, taps[i], true); off += 4; }
  wStr("LIST"); wU32(listSize); wStr("INFO");
  infos.forEach(function(c){ u8.set(c, off); off += c.length; });
  return new Blob([buf], { type: "audio/wav" });
}

/* ================================================================
   Dithering TPDF — Lộ trình v2 · Nhóm 1 (DSP Core)
   Dither chỉ có nghĩa tại bước lượng tử hoá xuống số nguyên: bản IR
   float 32-bit (irWavBlob) và đường phát realtime float trong worklet
   KHÔNG thêm dither. Nhiễu TPDF = tổng hai biến đều độc lập U1+U2-1,
   phân phối tam giác trên [-1, +1] LSB, phương sai LSB^2/6, trung bình 0.
   LSB của PCM 16-bit = 1/32768 (mã = round(x*32768), kẹp [-32768, 32767]).
   Chống tràn số: đầu vào không hữu hạn -> 0 trước khi cộng nhiễu; mã
   luôn được kẹp sau khi làm tròn; nhiễu không hữu hạn -> 0. RNG có hạt
   giống (tpdfRng, LCG) chỉ dùng cho kiểm chứng lặp lại được; xuất file
   thật dùng Math.random để nhiễu không lặp theo mẫu.
   ================================================================ */
function tpdfRng(seed){
  var s = (seed >>> 0) || 1;
  return function(){ s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function tpdfNoiseLSB(rng){
  var r = (typeof rng === "function") ? rng : Math.random;
  var u1 = r(), u2 = r();
  if (!isFinite(u1)) u1 = 0.5;
  if (!isFinite(u2)) u2 = 0.5;
  var n = u1 + u2 - 1;
  if (!isFinite(n)) n = 0;
  if (n < -1) n = -1;
  if (n > 1) n = 1;
  return n; /* đơn vị LSB, phân phối tam giác [-1, +1] */
}
function tpdfQuantize16(x, rng){
  if (typeof x !== "number" || !isFinite(x)) x = 0;
  var code = Math.round(x * 32768 + tpdfNoiseLSB(rng));
  if (code > 32767) code = 32767;
  if (code < -32768) code = -32768;
  return code;
}
function irWavBlob16(taps, fs, meta, rng){
  var nCh = 2, n = taps.length, i;
  function sb(str){ var a = []; for (var j = 0; j < str.length; j++) a.push(str.charCodeAt(j) & 0xFF); return a; }
  function infoChunk(id, text){
    var b = sb(irAscii(text)), sz = b.length, pad = sz % 2;
    var out = new Uint8Array(8 + sz + pad), dvv = new DataView(out.buffer);
    out.set(sb(id), 0); dvv.setUint32(4, sz, true); out.set(b, 8);
    return out;
  }
  var infos = [
    infoChunk("INAM", meta.headphone + " - " + meta.targetName + " - " + meta.phaseLabel + " - 16-bit PCM + TPDF"),
    infoChunk("ICMT", "Web AutoEQ convolution IR | Headphone: " + meta.headphone + " | Rig: " + (AE_RIGLBL[meta.rig] || meta.rig) + " | Target: " + meta.targetName + " | Profile: " + meta.profile + " | Preamp: " + meta.preamp.toFixed(2) + " dB | Phase: " + meta.phaseLabel + " | Format: 16-bit PCM + TPDF dither | " + fs + " Hz | " + n + " taps | Date: " + meta.dateISO),
    infoChunk("ISFT", "Web AutoEQ - Giai doan 5/6 (Database & Universal Export)")
  ];
  var listSize = 4; infos.forEach(function(c){ listSize += c.length; });
  var dataBytes = n * nCh * 2;
  var total = 12 + (8 + 16) + (8 + dataBytes) + (8 + listSize);
  var buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf), off = 0;
  function wStr(s){ u8.set(sb(s), off); off += s.length; }
  function wU32(v){ dv.setUint32(off, v, true); off += 4; }
  function wU16(v){ dv.setUint16(off, v, true); off += 2; }
  wStr("RIFF"); wU32(total - 8); wStr("WAVE");
  wStr("fmt "); wU32(16); wU16(1); wU16(nCh); wU32(fs); wU32(fs * nCh * 2); wU16(nCh * 2); wU16(16);
  wStr("data"); wU32(dataBytes);
  for (i = 0; i < n; i++){ var code = tpdfQuantize16(taps[i], rng); dv.setInt16(off, code, true); off += 2; dv.setInt16(off, code, true); off += 2; }
  wStr("LIST"); wU32(listSize); wStr("INFO");
  infos.forEach(function(c){ u8.set(c, off); off += c.length; });
  return new Blob([buf], { type: "audio/wav" });
}

function irMixPct(){
  var el = $("irMix");
  var v = el ? parseFloat(el.value) : 50;
  if (!isFinite(v)) v = 50;
  if (v < 0) v = 0;
  if (v > 100) v = 100;
  return Math.round(v);
}
function irMixSync(){
  var p = irMixPct();
  var o = $("irMixOut");
  if (o) o.textContent = p + "%" + (p === 0 ? " (= Minimum Phase)" : (p === 100 ? " (≈ Linear Phase)" : (p === 50 ? " (cân bằng)" : "")));
}
function expIr(phase){
  var src = expSource();
  if (!src){ $("expMsg").textContent = "Chưa có nguồn band để xuất IR — hãy chạy Hardware Solver trước, hoặc đổi nguồn về “EQ hiện tại của engine”."; return; }
  var fs = parseInt($("irFs").value, 10), N = parseInt($("irTaps").value, 10);
  var meta = expMetaFor(src);
  var mixPct = irMixPct();
  meta.phaseLabel = phase === "lin" ? "Linear Phase" : (phase === "mix" ? "Mixed Phase (excess " + mixPct + "%)" : "Minimum Phase");
  var built = irBuild(src.bands, src.preamp, fs, N, phase, mixPct / 100);
  var blob = irWavBlob(built.taps, fs, meta);
  var name = expSlug(meta.headphone) + "_ir-" + (phase === "lin" ? "linear-phase" : (phase === "mix" ? "mixed-phase-a" + mixPct : "minimum-phase")) + "_" + fs + "hz_" + N + "taps.wav";
  dlBlob(name, blob);
  $("expMsg").textContent = "Đã xuất IR " + meta.phaseLabel + ": " + name + " (" + fs.toLocaleString("vi-VN") + " Hz · " + N + " taps · 32-bit float stereo)" +
    (built.gainDb ? " · IR được hạ " + built.gainDb.toFixed(2) + " dB để đỉnh mẫu không vượt 0.99 (đáp tuyến dB dịch tương ứng)." : " · đỉnh mẫu " + built.peak.toFixed(3) + " (không cần chuẩn hoá).");
}
$("expIrMin").addEventListener("click", function(){ expIr("min"); });
$("expIrLin").addEventListener("click", function(){ expIr("lin"); });
$("expIrMix").addEventListener("click", function(){ expIr("mix"); });
if ($("irMix")){ $("irMix").addEventListener("input", irMixSync); irMixSync(); }
function expIr16(phase){
  var src = expSource();
  if (!src){ $("expMsg").textContent = "Chưa có nguồn band để xuất IR — hãy chạy Hardware Solver trước, hoặc đổi nguồn về “EQ hiện tại của engine”."; return; }
  var fs = parseInt($("irFs").value, 10), N = parseInt($("irTaps").value, 10);
  var meta = expMetaFor(src);
  var mixPct = irMixPct();
  meta.phaseLabel = phase === "lin" ? "Linear Phase" : (phase === "mix" ? "Mixed Phase (excess " + mixPct + "%)" : "Minimum Phase");
  var built = irBuild(src.bands, src.preamp, fs, N, phase, mixPct / 100);
  var blob = irWavBlob16(built.taps, fs, meta);
  var name = expSlug(meta.headphone) + "_ir-" + (phase === "lin" ? "linear-phase" : (phase === "mix" ? "mixed-phase-a" + mixPct : "minimum-phase")) + "_16bit-tpdf_" + fs + "hz_" + N + "taps.wav";
  dlBlob(name, blob);
  $("expMsg").textContent = "Đã xuất IR " + meta.phaseLabel + " 16-bit PCM + TPDF: " + name + " (" + fs.toLocaleString("vi-VN") + " Hz · " + N + " taps · 16-bit PCM stereo, dither TPDF trước lượng tử hoá)" +
    (built.gainDb ? " · IR được hạ " + built.gainDb.toFixed(2) + " dB để đỉnh mẫu không vượt 0.99 (đáp tuyến dB dịch tương ứng)." : " · đỉnh mẫu " + built.peak.toFixed(3) + " (không cần chuẩn hoá).");
}
$("expIr16Min").addEventListener("click", function(){ expIr16("min"); });
$("expIr16Lin").addEventListener("click", function(){ expIr16("lin"); });
$("expIr16Mix").addEventListener("click", function(){ expIr16("mix"); });
/* Roon (Nhom 5 v2): Roon khong co dinh dang file preset EQ nhap duoc —
   duong xuat chinh thuc la Convolution IR (Minimum Phase, theo sample
   rate/taps dang chon o muc IR). File WAV nay nap lam Convolution filter
   trong Roon DSP; chunk INFO ghi day du metadata nhu cac file IR khac. */
function expRoon(){
  var src = expSource();
  if (!src){ $("expMsg").textContent = "Chưa có nguồn band để xuất IR — hãy chạy Hardware Solver trước, hoặc đổi nguồn về “EQ hiện tại của engine”."; return; }
  var fs = parseInt($("irFs").value, 10), N = parseInt($("irTaps").value, 10);
  var meta = expMetaFor(src);
  meta.phaseLabel = "Minimum Phase";
  var built = irBuild(src.bands, src.preamp, fs, N, "min", 0);
  var blob = irWavBlob(built.taps, fs, meta);
  var name = expSlug(meta.headphone) + "_roon-convolution_" + fs + "hz_" + N + "taps.wav";
  dlBlob(name, blob);
  $("expMsg").textContent = "Đã xuất IR cho Roon (Convolution): " + name + " (" + fs.toLocaleString("vi-VN") + " Hz · " + N + " taps · Minimum Phase, 32-bit float stereo) — nạp file này làm Convolution filter trong Roon DSP (Roon không có định dạng preset text nhập được).";
}
expMetaLine();

/* ================================================================
   5.7 — KIỂM CHỨNG NGHIỆM THU PROMPT 5 (số đo thật, chạy trong app)
   ================================================================ */
var P5_GOLDEN = [
  { type: "lowshelf", freq: 105, gain: 2.5, q: 0.707, on: true },
  { type: "peaking", freq: 250, gain: -1.5, q: 1.0, on: true },
  { type: "peaking", freq: 1000, gain: 3.0, q: 1.41, on: true },
  { type: "peaking", freq: 4000, gain: -2.0, q: 2.0, on: true },
  { type: "highshelf", freq: 10000, gain: 1.5, q: 0.707, on: true }
];
function p5Hash(s){
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ("0000000" + h.toString(16)).slice(-8);
}
function p5StripDate(s){ return s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "DATE"); }
function p5IrMaxErr(bandList, pre, fs, N, phase, mixA){
  var built = irBuild(bandList, pre, fs, N, phase, mixA);
  var taps = built.taps, L = 65536, f0 = 10, f1 = 20000, T = L / fs, K = Math.log(f1 / f0), n;
  var x = new Float64Array(L);
  for (n = 0; n < L; n++){ var t = n / fs; x[n] = Math.sin(2 * Math.PI * f0 * (T / K) * (Math.exp(t / T * K) - 1)); }
  var M = 131072;
  var xr = new Float64Array(M), xi = new Float64Array(M); xr.set(x);
  var hr = new Float64Array(M), hi = new Float64Array(M);
  for (n = 0; n < N; n++) hr[n] = taps[n];
  fft(xr, xi, false); fft(hr, hi, false);
  var yr = new Float64Array(M), yi = new Float64Array(M);
  for (n = 0; n < M; n++){ yr[n] = xr[n] * hr[n] - xi[n] * hi[n]; yi[n] = xr[n] * hi[n] + xi[n] * hr[n]; }
  var maxE = 0;
  var p5Cc = dbBandCoeffs(bandList, fs);
  AE.freqs.forEach(function(f){
    if (f < 20 || f > 16000) return;
    var k = Math.round(f * M / fs); if (k < 1 || k >= M / 2) return;
    var den = xr[k] * xr[k] + xi[k] * xi[k]; if (den < 1e-10) return;
    var Hr = (yr[k] * xr[k] + yi[k] * xi[k]) / den, Hi = (yi[k] * xr[k] - yr[k] * xi[k]) / den;
    var magDb = 10 * Math.log10(Hr * Hr + Hi * Hi);
    var tgt = dbBandDbC(p5Cc, f, fs) + pre + built.gainDb;
    if (Math.abs(magDb - tgt) > maxE) maxE = Math.abs(magDb - tgt);
  });
  return maxE;
}
$("btnP5Verify").addEventListener("click", function(){
  var PASS = '<span class="pass">ĐẠT</span>', FAIL = '<span class="fail">CHƯA ĐẠT</span>';
  /* --- V1: 3 định dạng, cùng đường cong --- */
  try {
    var pR = dbParseMeasurement(p5FixtureRew(), "fixture.txt");
    var pS = dbParseMeasurement(p5FixtureSquig(), "fixture.csv");
    var pA = dbParseMeasurement(p5FixtureAutoeq(), "fixture.csv");
    var maxD = 0;
    AE.freqs.forEach(function(f){
      if (f > 16000) return;
      var a = aeInterp(pR.points, f), b = aeInterp(pS.points, f), c = aeInterp(pA.points, f);
      maxD = Math.max(maxD, Math.abs(a - b), Math.abs(a - c), Math.abs(b - c));
    });
    var fmtOk = pR.format === "rew" && pS.format === "squiglink" && pA.format === "autoeq";
    $("p5V1").textContent = "nhận diện: " + pR.format + " / " + pS.format + " / " + pA.format + " · điểm đọc: " + pR.points.length + " / " + pS.points.length + " / " + pA.points.length + " · lệch tối đa sau resample về lưới 1/24 oct: " + maxD.toFixed(3) + " dB";
    $("p5V1Ok").innerHTML = (fmtOk && maxD <= 0.2) ? PASS : FAIL;
  } catch (e) { $("p5V1").textContent = "lỗi: " + e.message; $("p5V1Ok").innerHTML = FAIL; }
  /* --- V2: golden export ổn định (hash trừ trường ngày) --- */
  try {
    var gsrc = { bands: P5_GOLDEN, preamp: -3.5, profile: "Golden fixture", target: "harmanOE", headphone: "Golden Fixture", rig: "711" };
    var hApo = [], hJson = [];
    [new Date("2026-01-01T00:00:00.000Z"), new Date("2026-10-25T15:04:05.000Z")].forEach(function(d){
      hApo.push(p5Hash(p5StripDate(expRender("apo", gsrc, expMetaFor(gsrc, d)))));
      hJson.push(p5Hash(p5StripDate(expRender("soundsource", gsrc, expMetaFor(gsrc, d)))));
    });
    var gOk = hApo[0] === hApo[1] && hJson[0] === hJson[1];
    $("p5V2").textContent = "APO .txt hash (trừ ngày): " + hApo[0] + " vs " + hApo[1] + " · SoundSource .json hash: " + hJson[0] + " vs " + hJson[1] + " — hai lần xuất ở hai thời điểm khác nhau cho nội dung giống hệt sau khi loại trường ngày";
    $("p5V2Ok").innerHTML = gOk ? PASS : FAIL;
  } catch (e) { $("p5V2").textContent = "lỗi: " + e.message; $("p5V2Ok").innerHTML = FAIL; }
  /* --- V3: solver -> profile bị giới hạn (Moondrop DSP) --- */
  try {
    var prepA = aePrepare(aeSamplePoints(AE_SAMPLES[0]));
    var unc = aeCompute(prepA, "harmanOE", { tilt: 0, bass: 0, ear: 0 }, 10);
    var ew = hwErrAndWeights(prepA, "harmanOE", { tilt: 0, bass: 0, ear: 0 });
    var P = HW_PROFILES.moondropDsp;
    var sol = hwSolve(AE.freqs, ew.err, ew.W, P);
    var rmsA = aeRms(ew.err.map(function(e, i){ return e - sol.total[i]; }), AE.freqs);
    var delta = rmsA - unc.errAfter;
    var viol = hwValidate(sol.bands, P);
    var allPk = sol.bands.every(function(b){ return b.type === "peaking"; });
    $("p5V3").textContent = "Mẫu A → Moondrop DSP (" + sol.bands.length + " band, peaking-only: " + (allPk ? "đúng" : "SAI") + ") · RMS không giới hạn " + unc.errAfter.toFixed(2) + " dB → theo profile " + rmsA.toFixed(2) + " dB · delta " + (delta >= 0 ? "+" : "") + delta.toFixed(2) + " dB · vi phạm validator: " + viol.length + (viol.length ? " (" + viol[0] + ")" : "");
    $("p5V3Ok").innerHTML = (viol.length === 0 && allPk && sol.bands.length <= P.maxBands) ? PASS : FAIL;
  } catch (e) { $("p5V3").textContent = "lỗi: " + e.message; $("p5V3Ok").innerHTML = FAIL; }
  /* --- V4: IR chập sweep --- */
  try {
    var tb = [
      { type: "lowshelf", freq: 105, gain: 3, q: 0.707, on: true },
      { type: "peaking", freq: 400, gain: -2, q: 1.0, on: true },
      { type: "peaking", freq: 3000, gain: -4, q: 1.2, on: true },
      { type: "peaking", freq: 8000, gain: 2.5, q: 2.0, on: true },
      { type: "highshelf", freq: 10000, gain: -2, q: 0.707, on: true }
    ];
    $("p5V4").textContent = "đang chập sweep & giải chập…";
    /* Chặng 5.6: chạy đồng bộ — thu thập QA sau click thấy ngay kết quả PASS/FAIL
       thay vì CONDITIONAL vì phép đo còn nằm trong setTimeout. */
    try {
      var eMin = p5IrMaxErr(tb, -2, 48000, 32768, "min");
      var eLin = p5IrMaxErr(tb, -2, 48000, 32768, "lin");
      var eMix = p5IrMaxErr(tb, -2, 48000, 32768, "mix", 0.5);
      $("p5V4").textContent = "lệch tối đa 20 Hz–16 kHz — Minimum-Phase: " + eMin.toFixed(3) + " dB · Linear-Phase: " + eLin.toFixed(3) + " dB · Mixed-Phase (α=50%): " + eMix.toFixed(3) + " dB (ESS 10 Hz–20 kHz, 65536 mẫu, giải chập bằng chia phổ FFT)";
      $("p5V4Ok").innerHTML = (eMin <= 0.5 && eLin <= 0.5 && eMix <= 0.5) ? PASS : FAIL;
    } catch (e2) { $("p5V4").textContent = "lỗi: " + e2.message; $("p5V4Ok").innerHTML = FAIL; }
  } catch (e) { $("p5V4").textContent = "lỗi: " + e.message; $("p5V4Ok").innerHTML = FAIL; }
  /* --- V5: IndexedDB + PWA (Nhóm 5 v2) --- */
  try {
    var v5 = dbIdbSelfCheck();
    $("p5V5").textContent = v5.text;
    $("p5V5Ok").innerHTML = v5.ok ? PASS : FAIL;
  } catch (e) { $("p5V5").textContent = "lỗi: " + e.message; $("p5V5Ok").innerHTML = FAIL; }
  /* --- V6: Roon / CamillaDSP / Qudelix-5K (Nhom 5 v2) --- */
  try {
    var gsrc6 = { bands: P5_GOLDEN, preamp: -3.5, profile: "Golden fixture", target: "harmanOE", headphone: "Golden Fixture", rig: "711" };
    var meta6 = expMetaFor(gsrc6, new Date("2026-01-01T00:00:00.000Z"));
    var cam = expRender("camilla", gsrc6, meta6);
    var camOk = cam.indexOf("filters:") >= 0 && cam.indexOf("pipeline:") >= 0 && cam.indexOf("type: Biquad") >= 0
      && cam.indexOf("type: Peaking") >= 0 && cam.indexOf("type: Gain") >= 0 && cam.indexOf("gain: -3.50") >= 0
      && ["band_1", "band_2", "band_3", "band_4", "band_5"].every(function(nm){ return cam.indexOf(nm) >= 0; });
    var q12 = { bands: P5_GOLDEN.concat(P5_GOLDEN).concat(P5_GOLDEN).slice(0, 12), preamp: -3.5, profile: "Golden fixture", target: "harmanOE", headphone: "Golden Fixture", rig: "711" };
    var qud = expRender("qudelix", q12, meta6);
    var qudFilters = (qud.match(/^Filter /gm) || []).length;
    var qudOk = qudFilters === 10 && qud.indexOf("CANH BAO") >= 0 && qud.indexOf("Preamp: -3.50 dB") >= 0;
    meta6.phaseLabel = "Minimum Phase";
    var built6 = irBuild(gsrc6.bands, gsrc6.preamp, 48000, 4096, "min", 0);
    var blob6 = irWavBlob(built6.taps, 48000, meta6);
    var roonOk = built6.taps.length === 4096 && built6.taps.every(function(t){ return isFinite(t); })
      && blob6.type === "audio/wav" && blob6.size > 4096 * 8;
    var ok6 = camOk && qudOk && roonOk;
    $("p5V6").textContent = "CamillaDSP: filters/pipeline/Biquad/Peaking/Gain pre-amp -3.50 dB, du 5 band (" + (camOk ? "dung" : "SAI") + ") · Qudelix 12 band -> " + qudFilters + " Filter + canh bao (" + (qudOk ? "dung" : "SAI") + ") · Roon IR: 4096 taps, finite, WAV " + blob6.size + " byte (" + (roonOk ? "dung" : "SAI") + ")";
    $("p5V6Ok").innerHTML = ok6 ? PASS : FAIL;
  } catch (e) { $("p5V6").textContent = "lỗi: " + e.message; $("p5V6Ok").innerHTML = FAIL; }
  /* --- V7: EasyEffects + Pro-Q + URL chia sẻ + QR (v2) --- */
  try {
    var gsrc7 = { bands: P5_GOLDEN, preamp: -3.5, profile: "Golden fixture", target: "harmanOE", headphone: "Golden Fixture", rig: "711" };
    var meta7 = expMetaFor(gsrc7, new Date("2026-01-01T00:00:00.000Z"));
    var ee = JSON.parse(expRender("easyeffects", gsrc7, meta7));
    var eq = ee.output["equalizer#0"];
    var eeOk = ee.output.plugins_order[0] === "equalizer#0" && eq["num-bands"] === 5 && eq["input-gain"] === -3.5
      && eq.left.band2.frequency === 1000 && eq.left.band2.gain === 3 && eq.left.band2.type === "Bell"
      && eq.left.band0.type === "Lo-shelf" && eq.right.band4.type === "Hi-shelf";
    var pq = expRender("proq", gsrc7, meta7);
    var pqOk = pq.indexOf("KHONG PHAI FILE .ffp GOC") >= 0 && pq.indexOf("Band 3: Bell, Freq 1000 Hz, Gain 3.00 dB, Q 1.41") >= 0
      && pq.indexOf("Pro-Q Output Gain: -3.50 dB") >= 0;
    var str7 = (function(){
      function bs(b){ return shareFmt(b.freq, 1) + "," + shareFmt(b.gain, 2) + "," + shareFmt(b.q, 2) + "," + shareTypeChar(b.type) + "," + (b.on !== false ? "1" : "0"); }
      function bl(l){ return l.map(bs).join(";"); }
      var b10 = P5_GOLDEN.concat(P5_GOLDEN).slice(0, 10);
      var b20 = P5_GOLDEN.concat(P5_GOLDEN).concat(P5_GOLDEN).concat(P5_GOLDEN).slice(0, 20);
      return ["1", "", "harmanOE", "0.5", "2", "0", "0", "20", "20", "iir", "auto", "0", "0", "1", "80", "0", "80", "80", bl(b10), bl(b20)].join("~");
    })();
    var back7 = shareParseState(str7);
    var urlOk = !!back7 && back7.bandCount === 20 && back7.bands20.length === 20 && back7.bands20[2].freq === 1000 && back7.bands20[2].gain === 3 && back7.aeBands === 20;
    var qr7 = qrEncode("HELLO");
    var qrOk = !!qr7 && qr7.version === 1 && qr7.size === 21 && qr7.modules[0][0] === 1 && qr7.modules[3][3] === 1 && qr7.modules[0][7] === 0;
    var ok7 = eeOk && pqOk && urlOk && qrOk;
    $("p5V7").textContent = "EasyEffects: num-bands/input-gain/Bell/Lo-shelf/Hi-shelf khớp (" + (eeOk ? "dung" : "SAI") + ") · Pro-Q: bảng band + cảnh báo không phải .ffp (" + (pqOk ? "dung" : "SAI") + ") · URL: vòng tròn compact 20 band (" + (urlOk ? "dung" : "SAI") + ") · QR: HELLO -> version 1, finder đúng (" + (qrOk ? "dung" : "SAI") + ")";
    $("p5V7Ok").innerHTML = ok7 ? PASS : FAIL;
  } catch (e) { $("p5V7").textContent = "lỗi: " + e.message; $("p5V7Ok").innerHTML = FAIL; }
  /* --- V8: On-Demand Pack Loader (Chặng 2 bước 2.2) --- */
  try {
    var v8 = dbExtSelfCheck();
    $("p5V8").textContent = v8.detail + " · kho trước/sau self-check: " + v8.beforePhones + "/" + v8.afterPhones + " mục";
    $("p5V8Ok").innerHTML = v8.pass ? PASS : FAIL;
  } catch (e) { $("p5V8").textContent = "lỗi: " + e.message; $("p5V8Ok").innerHTML = FAIL; }
});
