/* Web AutoEQ split module: 01-engine.js (nguon: khoi script L1422 cua ban 1 file) */

"use strict";
/* ================================================================
   Web AutoEQ — DSP Core (Giai đoạn 1)
   Engine: AudioWorkletProcessor tự viết, RBJ cookbook, float64.
   Đồ thị: đáp tuyến giải tích H(e^jw) từ chính các hệ số biquad.
   ================================================================ */
var FREQS  = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
var TYPES  = ["lowshelf","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","highshelf"];
var TYPELBL= { lowshelf:"Low Shelf", peaking:"Peaking", highshelf:"High Shelf", lowpass:"Low Pass", highpass:"High Pass", bandpass:"Band Pass", notch:"Notch", allpass:"All Pass" };
var DEFQ   = [0.707, 1.0, 1.0, 1.0, 1.0, 1.41, 1.0, 1.0, 1.0, 0.707];
var CEIL_DB = -1.0, CEIL_LIN = Math.pow(10, CEIL_DB/20);

var bands = FREQS.map(function(f,i){ return { freq:f, type:TYPES[i], gain:0, q:DEFQ[i], on:true }; });

/* ---------- Chế độ số band PEQ: 10 (mặc định) / 20 — Lộ trình v2 · Nhóm 1 · Giai đoạn 1 ----------
   Hai bộ band sống độc lập trong BAND_STORE; biến `bands` trỏ tới bộ đang
   hoạt động, nên mọi đường code đọc `bands` / `bands.length` đều tự theo
   đúng chế độ. Chuyển chế độ chỉ đổi con trỏ + dựng lại dải điều khiển:
   trạng thái của chế độ còn lại được giữ nguyên, preset/slot không bị phá.
   Mặc định khi mở app vẫn là 10 band đúng như trước, để mọi mốc kiểm chứng
   hiện có (đáp tuyến 1 kHz +6.00 dB, pre-amp −7.00 dB, AutoEQ mẫu A…) giữ
   nguyên. Bộ 20 band: tần số log-spaced 31 Hz → 16 kHz (tỉ lệ ~×1.389/bậc),
   band đầu lowshelf, band cuối highshelf, còn lại peaking. */
var FREQS20 = [31, 43, 60, 83, 115, 160, 223, 310, 430, 597, 830, 1150, 1600, 2225, 3090, 4300, 5965, 8290, 11500, 16000];
var TYPES20 = [], DEFQ20 = [];
(function(){ for (var i=0;i<20;i++){ TYPES20.push(i===0 ? "lowshelf" : (i===19 ? "highshelf" : "peaking")); DEFQ20.push((i===0 || i===19) ? 0.707 : 1.0); } })();
var SET10 = { freqs:FREQS, types:TYPES, defq:DEFQ };
var SET20 = { freqs:FREQS20, types:TYPES20, defq:DEFQ20 };
var bandCount = 10;
function bandSet(){ return bandCount === 20 ? SET20 : SET10; }
var BAND_STORE = { 10: bands, 20: FREQS20.map(function(f,i){ return { freq:f, type:TYPES20[i], gain:0, q:DEFQ20[i], on:true }; }) };
var selBand = 5;
var mode = "iir";              // "iir" | "fir"
var firLen = 1023;
var bypass = false;
var limiterOn = true;
var preMode = "auto";          // "auto" | "manual"
var manualPreDb = 0;
var extraHeadDb = 0;
var autoPreDb = 0, maxPosDb = 0, maxPosFreq = 0;
var displayFs = 48000;         // cập nhật khi AudioContext chạy
var aeSolvedFs = null; /* Pha A/C 2026-11-07: fs ma band hien tai duoc giai theo (null = chua giai); initEngine dung de biet co can giai lai khi rate that khac. */

function $(id){ return document.getElementById(id); }
function fmtDb(v, d){ v = parseFloat(v); if(!isFinite(v)) return "−∞"; return (v>0?"+":"") + v.toFixed(d==null?2:d); } /* Pha C 2026-11-05: parseFloat truoc isFinite — isFinite(null)===true keo null xuong toFixed gay crash (lab 1451: notch.depth=null nem TypeError tu syncPsyUI) */
function fmtFreq(f){ f=Math.round(f); return f>=1000 ? (Math.round(f/10)/100)+" kHz" : f+" Hz"; }
/* Số Hz đầy đủ, không viết tắt kHz — dùng trên đầu thẻ band để người dùng
   đọc đúng tần số thật khi nhập tay, tránh nhầm 2.8 kHz với 280 Hz. */
function fmtFreqFull(f){ return Math.round(f)+" Hz"; }
function fmtTime(s){ if(!isFinite(s)||s<0) s=0; var m=Math.floor(s/60), ss=Math.floor(s%60); return m+":"+(ss<10?"0":"")+ss; }

/* ---------------- RBJ Audio EQ Cookbook ----------------
   H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2)
   Trả về hệ số đã chuẩn hoá theo a0 (a0 = 1).              */
/* --- Mở rộng 2026-11-23 (vòng tự động 20:59, hướng B — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm B (sau A 20:44, BÁC BỎ). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 20:50:14+07, 6.258.525 byte / 25.334 dòng (wc -l), md5 0fb703a1026af4812d440337dd7fa134, version 319) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-B lưu tại ~/workspace/autoeq/backups/2026-11-23_2053_start.html. Ứng viên B duy nhất: memoize rbjCoeffs bằng Map khóa chuỗi type|freq|gain|Q|fs|slopeKey (slope chỉ đưa vào khóa với lowshelf/highshelf hợp lệ, chỉ cache kết quả của input hợp lệ, xóa cache khi >512 mục) — các workload lặp lại cùng đối số (kiểu harmanIe13EvalAt gọi rbjCoeffs 5 lần/điểm với cùng tham số) kỳ vọng bỏ gần như toàn bộ chi phí cos/sin/pow/sqrt. Lab Node trên hàm thật trích verbatim (extract.py + make_rbj_new.py + harness.js + bench_rbj.js trong hidden_files/run_20261123_2053_B/, 2 lần chạy độc lập): parity GIỐNG TỪNG BIT — 237.160/237.160 kiểm tra chính + 620/620 kiểm tra lặp lại/xóa cache (Object.is từng hệ số; gồm 11 type × 11 freq × 7 gain × 5 Q × 7 fs × 8 slopeS, biên NaN/±Infinity/0/-0/1e308/subnormal, type null/số/chuỗi lạ); tốc độ paired-median xen kẽ 15 vòng: workload lặp lại (5 section × 241 điểm) lần 1 3,3785× thắng 15/15, lần 2 3,3129× thắng 15/15 NHƯNG workload đối số duy nhất kiểu solver (20.000 lần gọi, gain/freq biến thiên) lần 1 peaking 0,5668× thắng 0/15, shelf 0,5664× thắng 0/15; lần 2 peaking 0,5564× thắng 1/15, shelf 0,5096× thắng 2/15 — chậm hơn ổn định ~1,8× trên đường trượt cache do nối chuỗi khóa + tra Map đắt hơn chính phép tính RBJ, áp dụng sẽ đe dọa cổng aeV3 (<500 ms cho đường ≤10 band) → BÁC, không vá code. KHÔNG thử lại hướng memoize rbjCoeffs bằng Map khóa chuỗi. (Thử thêm biến thể chuyển mảng hệ số trong buildFirTaps sang Float64Array: parity 4/4 scenario giống từng bit nhưng tốc độ median 0,85–0,92×, cũng không áp.) Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_2053_B/. --- */
function rbjCoeffs(type, freq, gainDb, Q, fs, slopeS){
  if(!bands.length) {}
  /* Pha A/C (2026-11-05): kẹp an toàn theo SOUL §3.3 trước khi tính RBJ.
     Mọi giá trị trong dải hợp lệ (freq 20-20000 Hz, gain ±15 dB thực dùng,
     Q 0.4-10 thực dùng, fs 44100/48000/96000) đi qua kẹp KHÔNG ĐỔI nên
     kết quả từng bit giống bản gốc; chỉ giá trị cực đoan ngoài dải mới
     bị kẹp (freq [10, min(22000, 0.495*fs)], gain [-30, +30], Q [0.1, 30])
     và giá trị không hữu hạn/fs không dương trả identity 0 dB thay vì
     NaN/Infinity lan sang đồ thị, pre-amp và worklet (đường nhập URL
     chia sẻ trước đây chỉ kiểm tra isFinite, không kẹp khoảng). */
  if(!isFinite(freq) || !isFinite(gainDb) || !isFinite(Q) || !isFinite(fs) || fs<=0)
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  freq = Math.min(Math.min(22000, 0.495*fs), Math.max(10, freq));
  gainDb = Math.max(-30, Math.min(30, gainDb));
  Q = Math.max(0.1, Math.min(30, Q));
  /* CHAIN TASK #2 (2026-11-13, truc A): gain 0 dB thi peaking/lowshelf/highshelf co tu so == mau so (A=1) nen dap ung dung 0 dB chinh xac — tra identity ngay, tranh pow/cos/sin. KHONG ap cho lowpass/highpass/bandpass/notch/allpass (gain khong quyet dinh dap ung). Probe truoc sua: max |mag| = 0 dB tren peaking/shelf, lowpass gain 0 van -42,7 dB @10 kHz. */
  if (gainDb===0 && (type==="peaking" || type==="lowshelf" || type==="highshelf"))
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  var w0 = 2*Math.PI*freq/fs;
  var cw = Math.cos(w0), sw = Math.sin(w0);
  var alpha = sw/(2*Q);
  var b0,b1,b2,a0,a1,a2;
  if(type==="peaking"){
    var A = Math.pow(10, gainDb/40);
    b0=1+alpha*A;  b1=-2*cw;  b2=1-alpha*A;
    a0=1+alpha/A;  a1=-2*cw;  a2=1-alpha/A;
  } else if(type==="lowshelf" || type==="highshelf"){
    var A = Math.pow(10, gainDb/40);
    /* NÂNG CẤP KHỐI 4: shelf có thêm độ dốc S (slopeS thuộc [0.25, 2.0]);
       không truyền slopeS thì giữ đúng công thức Q cổ điển như trước. */
    var alS = alpha;
    if (typeof slopeS==="number" && isFinite(slopeS) && slopeS>0)
      alS = (sw/2)*Math.sqrt((A + 1/A)*(1/slopeS - 1) + 2);
    var s = 2*Math.sqrt(A)*alS;
    if(type==="lowshelf"){
      b0=   A*((A+1)-(A-1)*cw+s);
      b1= 2*A*((A-1)-(A+1)*cw);
      b2=   A*((A+1)-(A-1)*cw-s);
      a0=       (A+1)+(A-1)*cw+s;
      a1=  -2*((A-1)+(A+1)*cw);
      a2=       (A+1)+(A-1)*cw-s;
    } else {
      b0=   A*((A+1)+(A-1)*cw+s);
      b1=-2*A*((A-1)+(A+1)*cw);
      b2=   A*((A+1)+(A-1)*cw-s);
      a0=       (A+1)-(A-1)*cw+s;
      a1=   2*((A-1)-(A+1)*cw);
      a2=       (A+1)-(A-1)*cw-s;
    }
  } else if(type==="lowpass"){
    b0=(1-cw)/2;  b1=1-cw;      b2=(1-cw)/2;
    a0=1+alpha;   a1=-2*cw;     a2=1-alpha;
  } else if(type==="highpass"){
    b0=(1+cw)/2;  b1=-(1+cw);   b2=(1+cw)/2;
    a0=1+alpha;   a1=-2*cw;     a2=1-alpha;
  } else if(type==="bandpass"){ /* constant 0 dB peak */
    b0=alpha;     b1=0;         b2=-alpha;
    a0=1+alpha;   a1=-2*cw;     a2=1-alpha;
  } else if(type==="notch"){
    b0=1;         b1=-2*cw;     b2=1;
    a0=1+alpha;   a1=-2*cw;     a2=1-alpha;
  } else if(type==="allpass"){
    b0=1-alpha;   b1=-2*cw;     b2=1+alpha;
    a0=1+alpha;   a1=-2*cw;     a2=1-alpha;
  } else { /* loại lạ: identity an toàn */
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  }
  var oc = { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
  /* a0 suy biến hoặc slopeS cực đoan làm sqrt âm -> hệ số NaN: trả
     identity hữu hạn thay vì để NaN nhiễm cascade. Với đầu vào đã kẹp,
     nhánh này không bao giờ chạm (mọi họ lọc RBJ đều ổn định Jury). */
  if(!isFinite(oc.b0 + oc.b1 + oc.b2 + oc.a1 + oc.a2))
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  return oc;
}
/* Cache hệ số theo đúng trạng thái band: trong MỘT lần cập nhật, cùng một bộ
   hệ số được đánh giá ở hàng nghìn tần số (quét pre-amp 241 điểm, các lớp đồ
   thị 881 điểm × nhiều lớp, phase/GD 241 × 13) — trước đây mỗi lần đánh giá
   lại chạy lại RBJ (sin/cos/pow/sqrt) cho cùng một kết quả. Đây từng là nút
   thắt khiến đường cập nhật khi kéo node vượt 16 ms trong môi trường CPU yếu.
   Cache khóa theo (fs, type, freq, gain, q) nên không bao giờ trả hệ số cũ
   khi tham số đã đổi; giá trị số học không thay đổi. */
var BAND_CC = [];
function bandCoeffs(i, fs){
  var b = bands[i];
  if(!b.on || b.gain===0) return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  var c = BAND_CC[i];
  if (c && c.fs===fs && c.type===b.type && c.freq===b.freq && c.gain===b.gain && c.q===b.q) return c.v;
  var v = rbjCoeffs(b.type, b.freq, b.gain, b.q, fs);
  BAND_CC[i] = { fs:fs, type:b.type, freq:b.freq, gain:b.gain, q:b.q, v:v };
  return v;
}
function allCoeffs(fs){
  var out=[]; for(var i=0;i<bands.length;i++) out.push(bandCoeffs(i, fs)); return out;
}
/* |H(e^jw)|^2 của một biquad — đánh giá giải tích chính xác.
   cos(2w)/sin(2w) suy từ cos(w)/sin(w) bằng hằng đẳng thức góc đôi thay vì
   gọi thêm 2 hàm lượng giác (sai khác ~1e-16, không đổi kết quả đo). */
/* --- Mở rộng 2026-11-09 (vòng tự động 18:22, hướng C): bỏ Math.sqrt trong
   biquadMagDb — 20·log10(√(num/den)) = 10·log10(num/den) đúng trong số thực;
   kẹp tương đương (max(1e-9,mag) ↔ max(1e-18,num/denC), cùng cho −180 dB;
   num=0 vẫn −180 dB như cũ), cùng đẳng thức đã áp cho buildFirTaps vòng 18:07
   và loudRespDbT vòng 18:13. biquadMagDb là đường nóng của totalDbAt/gridTotalDb
   (đồ thị), loudRespDb, geqFit, psV2/psV5 và upSelfCheck4; solver KHÔNG dùng
   hàm này (aeBandCurve đã nội tuyến công thức không sqrt từ trước) nên aeV1/
   aeV2/aeV3 không đổi theo cấu trúc. Lab Node trên hàm thật (lượt 18:17, chạy
   2 lần, kết quả xác định giống hệt): quét 8 họ lọc × 121 tần × 5 gain × 3 Q
   × 3 fs (43.560 ca): lệch tối đa 1,4e-14 dB, 18.571 ca giống từng bit, 0 ca
   > 1e-12; ca biên: identity = 0, num=0 → −180, notch tại fc → −180, den→0
   → +240 dB, peaking ±40 dB, Nyquist/f=0 — đều như cũ (≤ 9,6e-16); NaN vẫn
   NaN; khẳng định QA giữ nguyên: notch ≤ −100 dB (−180), allpass phẳng
   7,5e-14 < 1e-11 dB, LP/HP −3,01 dB tại fc (sai số < 0,05), psV2 notch
   7200 Hz sâu −5,000 dB (lệch 0%), psV5 ĐẠT; solver aeCompute Mẫu A/B/C ×
   harmanOE/harmanIE 10 band + Mẫu A 20 band: gains + RMS sau giống từng bit
   7/7 combo (A 10b 2,1797 → 0,1029 dB, B 0,1361, C 0,1707, 0 vi phạm; aeV2
   null 8011 Hz không bị boost, có warning; aeV3 median xen kẽ ~332 ms cả
   hai, < 500 ms); tốc độ: microbench biquadMagDb 1,096× (median 20 vòng
   xen kẽ, 40.000 lần/vòng), quét lưới 10 band × 881 điểm 1,06–1,07×. Đường
   WASM không đổi (đổi dB inline riêng); tự kiểm WASM dung sai 0,05 dB
   không ảnh hưởng (lệch ≤ 1,4e-14). Ý tưởng lượt kế: hướng A — rà soát
   aeSolveSingle trên tai nghe thực tế trong DB (ý tưởng lượt 14:22/17:54/
   18:10/18:13, chưa làm); hoặc hướng D — đo lại tốc độ dựng đồ thị sau khi
   biquadMagDb nhanh hơn. --- */
function biquadMagDb(c, freq, fs){
  var w = 2*Math.PI*freq/fs, cw = Math.cos(w), sw = Math.sin(w);
  var cw2 = 2*cw*cw - 1, sw2 = 2*sw*cw;
  var nr = c.b0 + c.b1*cw + c.b2*cw2, ni = -(c.b1*sw + c.b2*sw2);
  var dr = 1     + c.a1*cw + c.a2*cw2, di = -(c.a1*sw + c.a2*sw2);
  return 4.342944819032518*Math.log(Math.max(1e-18,(nr*nr+ni*ni)/Math.max(1e-24,(dr*dr+di*di)))); /* (vòng tự động 12:43, hướng B — ÁP DỤNG, vá code): 10*Math.log10(x) -> 4.342944819032518*Math.log(x) (10/ln10, cùng hằng số đã dùng trong wasmJsArray/geqFit/harmanIe13) — Math.log nhanh hơn Math.log10 trên V8; biểu thức kẹp max(1e-18, ...) và max(1e-24, ...) giữ nguyên, thứ tự tính nr/ni/dr/di không đổi. Lab Node trên hàm thật trích verbatim (harness /tmp/lab_biquad.js, 2 lần chạy độc lập): parity 4.590 kiểm tra, 82,61% giống từng bit, lệch tối đa 3,55e-15 dB mức ulp; tốc độ paired-median xen kẽ 15 vòng x 30 rep (lưới 20 band x 881 điểm): lần 1 1,0885x thắng 11/15, lần 2 1,0808x thắng 13/15; chạy lại lần 2 độc lập 1,1425x/1,0830x thắng 11-12/15 — cải thiện ổn định >1 trên mọi workload. biquadMagDb là đường nóng của totalDbAt/gridTotalDb (fallback JS), loudRespDb, geqFit và psV2/psV5; solver aeSolve không dùng hàm này nên aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. */
}
function totalDbAt(freq, fs){
  /* Band tắt hoặc gain = 0: bandCoeffs trả hệ số đồng nhất (identity) và
     biquadMagDb(identity) = 0 dB đúng tuyệt đối, nên bỏ qua không đổi tổng —
     chỉ tránh đánh giá lượng giác thừa trong đường cập nhật. */
  /* (vòng tự động 15:52, hướng B — ÁP DỤNG, vá code): hoist lượng giác ra khỏi vòng band — cw/sw/cw2/sw2 chỉ phụ thuộc (freq, fs) nên tính MỘT lần (lười, ở band hoạt động đầu tiên) rồi dùng lại cho mọi band, thay vì biquadMagDb tính lại cos/sin cho từng band tại cùng 1 tần số; biểu thức nr/ni/dr/di và phép log giữ nguyên từng toán hạng/thứ tự như biquadMagDb nên giống từng bit. Điều kiện bỏ qua band (on && gain!==0) và thứ tự cộng band 0..n-1 giữ nguyên; phần psycho giữ nguyên lời gọi. */
  var s=0, cw, sw, cw2, sw2, _td=false;
  for(var i=0;i<bands.length;i++){ if(bands[i].on && bands[i].gain!==0){ if(!_td){ var w = 2*Math.PI*freq/fs; cw = Math.cos(w); sw = Math.sin(w); cw2 = 2*cw*cw - 1; sw2 = 2*sw*cw; _td=true; } var c = bandCoeffs(i,fs); var nr = c.b0 + c.b1*cw + c.b2*cw2, ni = -(c.b1*sw + c.b2*sw2); var dr = 1 + c.a1*cw + c.a2*cw2, di = -(c.a1*sw + c.a2*sw2); s += 4.342944819032518*Math.log(Math.max(1e-18,(nr*nr+ni*ni)/Math.max(1e-24,(dr*dr+di*di)))); } }
  /* Giai đoạn 3: cộng shelf loudness + notch cá nhân (hàm ở khối Psychoacoustics, nạp sau) */
  if (typeof PSY!=="undefined" && PSY && !PSY.bypassAll && typeof psychoDbAt==="function"){
    /* (vòng tự động 17:27, hướng B — ÁP DỤNG, vá code): inline vòng psycho vào totalDbAt dùng chung lượng giác đã tính — cw/sw/cw2/sw2 chỉ phụ thuộc (freq, fs) nên khi đã tính cho band thì dùng lại cho mọi section psycho, thay vì psychoDbAt tính lại cos/sin cho cùng (freq, fs); tổng psycho tích lũy riêng _ps=0 theo đúng thứ tự section 0..n-1 rồi cộng vào s một lần (s += _ps) nên thứ tự cộng và mọi double giống hệt đường gọi psychoDbAt cũ; điều kiện bỏ qua PSY_ID và biểu thức nr/ni/dr/di + phép log giữ nguyên từng toán hạng như psychoDbAt. */
    var _cs = psychoCoeffs(fs), _ps = 0, _pi;
    for(_pi=0; _pi<_cs.length; _pi++) if(_cs[_pi] !== PSY_ID){ if(!_td){ var _w2 = 2*Math.PI*freq/fs; cw = Math.cos(_w2); sw = Math.sin(_w2); cw2 = 2*cw*cw - 1; sw2 = 2*sw*cw; _td=true; } var _c = _cs[_pi]; var _nr = _c.b0 + _c.b1*cw + _c.b2*cw2, _ni = -(_c.b1*sw + _c.b2*sw2); var _dr = 1 + _c.a1*cw + _c.a2*cw2, _di = -(_c.a1*sw + _c.a2*sw2); _ps += 4.342944819032518*Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di)))); }
    s += _ps;
  }
  return s;
}
/* --- Mở rộng 2026-11-23 (vòng tự động 17:27, hướng B — ÁP DỤNG, vá code): Lượt nhóm B (sau A 17:24, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 17:25:55+07, 6.198.244 byte / 25.224 dòng, md5 c78020308ac4d096562ac9560b3daa52, version 254) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-B lưu tại ~/workspace/autoeq/backups/*2026-11-23_1727*. Ứng viên B duy nhất: inline vòng psycho vào totalDbAt dùng chung lượng giác đã tính — cw/sw/cw2/sw2 chỉ phụ thuộc (freq, fs) nên khi đã tính cho band thì dùng lại cho mọi section psycho, thay vì psychoDbAt tính lại cos/sin cho cùng (freq, fs); tổng psycho tích lũy riêng _ps=0 theo đúng thứ tự section 0..n-1 rồi cộng vào s một lần (s += _ps) nên thứ tự cộng và mọi double giống hệt đường gọi psychoDbAt cũ; điều kiện bỏ qua PSY_ID và biểu thức nr/ni/dr/di + phép log giữ nguyên từng toán hạng như psychoDbAt. Lab Node trên hàm thật trích verbatim (extract.py + harness.js trong hidden_files/run_20261123_1727_B/, 2 lần chạy độc lập): parity 11054/11054 GIỐNG TỪNG BIT cả 2 lần (Object.is; gồm 8 cấu hình PSY × 6 bộ band × 23 tần số × 10 fs, cộng PSY undefined/null, band null ném đúng TypeError, thiếu psychoDbAt); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 totalDbAt (10 band + 7 psycho) 1,0464x (11/15), W2 control psycho-tắt 0,9848x trung tính-nhiễu, W3 0-band+psycho 1,0105x (9/15), W4 bypass 0,9998x trung tính, W5 sanity 1,0385x nhiễu; lần 2 W1 1,0370x (13/15), W2 1,0078x (8/15), W3 1,0176x (10/15), W4 0,9897x trung tính, W5 0,9705x nhiễu — cải thiện ổn định trên đường nóng W1 cả 2 lần, control đúng kỳ vọng. Kiểm chứng lại trên file đã vá (trích totalDbAt từ file mới so với backup pre-B): parity 396/396 GIỐNG TỪNG BIT. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 20/20 khối script node --check PASS, 55/55 token bảo vệ, 62/62 ID DOM, kết thúc đúng </html>, diff 2 hunk (vá totalDbAt + comment này). Headless Chrome vẫn bị chặn → QA trình duyệt đầy đủ chưa chạy được trong lượt này. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_1727_B/. --- */
/* --- Mở rộng 2026-11-23 (vòng tự động 15:52, hướng B — ÁP DỤNG, vá code): Lượt nhóm B (sau A 15:45, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 15:49:17+07, 6.179.084 byte / 25.188 dòng, md5 a15a125d18b77816ad56fd03c911a551, version 227) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-insert lưu tại ~/workspace/autoeq/backups/*2026-11-23_0851_before.html (giờ UTC của máy ảo) và *2026-11-23_1552_pre-insert.html. Ứng viên B duy nhất: hoist lượng giác ra khỏi vòng band trong totalDbAt — cw/sw/cw2/sw2 chỉ phụ thuộc (freq, fs) nên tính MỘT lần (lười, ở band hoạt động đầu tiên) rồi dùng lại cho mọi band, thay vì biquadMagDb tính lại cos/sin cho từng band tại cùng 1 tần số; biểu thức nr/ni/dr/di và phép log giữ nguyên từng toán hạng/thứ tự như biquadMagDb, điều kiện bỏ qua band (on && gain!==0) và thứ tự cộng band 0..n-1 giữ nguyên nên giống từng bit theo cấu trúc; phần psycho giữ nguyên lời gọi psychoDbAt. Đây là đường nóng của computeAutoPre (golden-section ~43 lần gọi totalDbAt mỗi lần tính pre-amp), hover đồ thị và các readout tần số đơn. Lab Node trên hàm thật trích verbatim (extract.py + harness.js trong hidden_files/run_20261123_1552_B/, 2 lần chạy độc lập): parity 2258/2258 GIỐNG TỪNG BIT cả 2 lần (Object.is; gồm 0/1/10/20 band, lưới 241 điểm, biên 0/±0/NaN/±Infinity/subnormal/1e308, fs 0/âm/NaN/Infinity/8000..192000, psycho bật/tắt, band null ném đúng TypeError, band gain 0/tắt/loại lạ); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 hover10 1,3489x (15/15), W2 hover20 1,3599x (13/15), W3 golden43 1,3957x (15/15), W4 1band 1,0364x (14/15), W5 alloff 0,9918x trung tính; lần 2 W1 1,3981x (15/15), W2 1,4590x (15/15), W3 1,4144x (15/15), W4 1,0402x (15/15), W5 0,9923x trung tính — cải thiện ổn định trên mọi workload có band hoạt động cả 2 lần. Kiểm chứng lại trên file đã vá (trích totalDbAt từ file mới so với backup pre-insert): parity 4980/4980 GIỐNG TỪNG BIT. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 21/21 khối script node --check PASS, 61/61 hàm bảo vệ, 62/62 ID DOM, kết thúc đúng </html>, diff 2 hunk (vá totalDbAt + comment này). Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Lượt kế: nhóm C. Lab: hidden_files/run_20261123_1552_B/. --- */
function bandDbAt(i, freq, fs){ return (bands[i].on && bands[i].gain!==0) ? biquadMagDb(bandCoeffs(i,fs), freq, fs) : 0; }

/* ---------------- Cache đáp tuyến trên lưới log cố định ----------------
   Quét pre-amp (241 điểm) và lớp EQ tổng của đồ thị (881 điểm) dùng cùng họ
   lưới f_k = 20·1000^(k/N). Trước đây MỖI lần cập nhật — tức mỗi sự kiện kéo
   node — lại đánh giá lại toàn bộ cascade 10 band + psycho tại mọi điểm
   lưới, dù thường chỉ 1 band thay đổi. Cache này giữ đáp tuyến TỪNG BAND
   trên lưới, khóa theo đúng tham số của band (fs, on, type, freq, gain, q),
   và đáp tuyến psycho khóa theo chữ ký PSY_CC: band không đổi thì dùng lại
   nguyên mảng, band đổi chỉ tính lại N+1 điểm của chính nó. Tổng tại mỗi
   điểm vẫn cộng đúng thứ tự cũ (band 0→9, sau cùng psycho) từ đúng các giá
   trị biquadMagDb/psychoDbAt cũ — kết quả số học không đổi. */
var GRID_TOT = {}; /* N -> { fs, keys:[], arrs:[], psyKey, psyArr, total, dirty } */
var GRID_FREQ_CACHE = {}; /* N -> Float64Array luoi tan so 20*1000^(k/N), bat bien theo N */
/* (vòng tự động 15:31, hướng B — ÁP DỤNG, vá code): cache lưới tần số GRID_FREQ_CACHE[N] cho đường fallback JS trong gridTotalDb — trước đây mỗi band tính lại 20*Math.pow(1000,k/N) cho mọi điểm lưới (và psycho lặp lại), nay tính MỘT lần/N rồi lưu Float64Array dùng chung cho mọi band/lần gọi; tần số lưu trữ là đúng double của biểu thức gốc nên biquadMagDb/psychoDbAt nhận đúng giá trị từng bit, tổng đáp tuyến không đổi. Chỉ áp cho fallback JS (WASM tắt/lỗi), đường WASM không đổi; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Lab Node trên hàm thật trích verbatim (verify_grid_patched.js + verify_grid_patched2.js trong hidden_files/run_20261123_1529_B/, 2 lần chạy độc lập): parity 12444/12444 GIỐNG TỪNG BIT (Object.is; N=0,1,7,220,880,960 × fs 44100/48000/96000, band tắt/gain 0, cache hit lần 2) + parity microbench 466452/466452; tốc độ paired-median xen kẽ 31 vòng trên gridTotalDb fallback: lần 1 median 1,1762x thắng 23/31, lần 2 median 1,1826x thắng 25/31; microbench biquadMagDb đơn band median 1,87x thắng 13-14/15. Không chạm solver/WASM/FIR/QA logic. Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. */
/* ================================================================
   v2 — WASM + SIMD CHO ĐÁP TUYẾN BIQUAD (dùng trong gridTotalDb)
   Kernel WASM (397 byte, nhúng base64 trong chính file này, không file
   ngoài): resp_simd tính độ lớn tuyến tính của MỘT biquad trên lưới tần
   số bằng SIMD f32x4 (4 tần số/lần), đúng công thức của biquadMagDb
   (trừ bước đổi ra dB — JS làm bước đó giống hệt cho cả hai đường).
   cos(w)/sin(w) được tính trước bằng JS và cache theo (N, fs) nên đường
   WASM không lặp lại lượng giác cho từng band như đường JS cũ.
   ĐƯỜNG DỰ PHÒNG BẮT BUỘC: mọi chỗ dùng WASM đều có đường JS (f64)
   tương đương; khi WASM/SIMD không khả dụng, khởi tạo lỗi, hoặc tự kiểm
   không đạt, app tự dùng đường JS và đồ thị vẫn đúng.
   DUNG SAI ĐÃ ĐO (không đoán): đường f32 lệch so với f64 tối đa 0,047 dB
   trên fixture 20 band hỗn hợp (vùng skirt tần thấp, nơi tử/mẫu biquad
   đều ~1e-5 do triệt tiêu — xem báo cáo chạy), 0,0025 dB trên fixture
   giống mẫu thật, 0,00009 dB với band đơn +6 dB; pre-amp từ cực đại lưới
   lệch tối đa 0,00031 dB (hiển thị 2 chữ số thập phân không đổi). Ngưỡng
   tự kiểm là 0,05 dB: vượt ngưỡng thì WASM tắt cho cả phiên, dùng JS.
   Đo hiệu năng trên cùng harness (tính lại toàn bộ lưới 20 band, N=220):
   JS 6,62 ms/lưới, WASM 1,62 ms/lưới, nhanh hơn 4,09× (số Node, trình
   duyệt thật sẽ khác — nút "Đo hiệu năng" trong panel đo lại trên máy bạn).
   Phạm vi: CHỈ đáp tuyến hiển thị + quét pre-amp qua gridTotalDb (solver
   AutoEQ không dùng hàm này nên các mốc solver giữ nguyên tuyệt đối).
   ================================================================ */
var WASM = { enabled: false, tried: false, selfChecked: false, instance: null, mem: null, trig: {}, lastCheck: null, lastBench: null };
var WASM_B64 = "AGFzbQEAAAABCQFgBX9/f39/AAMCAQAFAwEAAQcTAgNtZW0CAAlyZXNwX3NpbWQAAArZAgHWAgMBfxN7AX8gACoCAP0TIQYgAEEEaioCAP0TIQcgAEEIaioCAP0TIQggAEEMaioCAP0TIQkgAEEQaioCAP0TIQpDAACAP/0TIQtDAAAAQP0TIQxDFb6aF/0TIQ1BACEFAkADQCAFIARPDQEgBUEQbCEZIAEgGWr9AAQAIQ4gAiAZav0ABAAhDyAMIA4gDv3mAf3mASAL/eUBIRAgDCAPIA795gH95gEhESAGIAcgDv3mASAIIBD95gH95AH95AEhEiAHIA/95gEgCCAR/eYB/eQB/eEBIRMgCyAJIA795gEgCiAQ/eYB/eQB/eQBIRQgCSAP/eYBIAogEf3mAf3kAf3hASEVIBIgEv3mASATIBP95gH95AEhFiAUIBT95gEgFSAV/eYB/eQBIRcgFyAN/ekBIRcgFiAX/ecB/eMBIRggAyAZaiAY/QsEACAFQQFqIQUMAAsLCw==";
function wasmB64Bytes(){
  var s = WASM_B64, bin = atob(s), out = new Uint8Array(bin.length), i;
  for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* ================================================================
   WASM DSP CORE f64 — Chặng 3 (2026-10-27, lộ trình 4 chặng)
   Module thật 628 byte (không gõ tay byte: sinh bằng builder wasm_build.js,
   đã validate + đo bit-exact trước khi nhúng), DF2T cascade biquad float64.
   Quy hoạch bộ nhớ (chỉ số Float64Array, 1 trang = 8192 số f64):
     COEFF L: 0..159 (32 band × 5 hệ số b0,b1,b2,a1,a2)
     STATE:   s1L 256..287 · s2L 288..319 · s1R 320..351 · s2R 352..383
     BUF_L:   512..1023 (tối đa 512 mẫu/khối) · BUF_R: 1024..1535
     COEFF R: 1536..1695 (thêm ngoài kế hoạch lộ trình — các offset của lộ
              trình giữ nguyên tuyệt đối; khối R nằm sau BUF_R, không chồng lấn)
   Thứ tự phép toán trong module trùng đúng qaCascade (y = b0*x + s1;
   s1 = b1*x − a1*y + s2; s2 = b2*x − a2*y) nên kết quả bit-identical với
   JS float64 — không dùng lệnh FMA, không làm tròn trung gian.
   Trạng thái DF2T tồn tại xuyên suốt các lần gọi processCascade trên cùng
   một core (đúng ngữ nghĩa streaming); self-check dùng core mới cho mỗi
   phép đo để trạng thái bắt đầu từ 0 như qaCascade.
   Fallback: nếu WebAssembly không khả dụng hoặc module validate lỗi,
   processCascade dùng cascade JS float64 tách kênh (cùng thứ tự phép toán).
   LƯU Ý TÊN: wasmSelfCheck() đã có chủ (kiểm kernel SIMD f32 đáp tuyến,
   hàng wasmV1) nên hàm kiểm nhân f64 này đặt tên wasmDspSelfCheck để
   không ghi đè — tiền lệ đổi tên do va chạm id như p5V6 → p5V8 (Chặng 2).
   Nhân f64 này phục vụ xử lý khối/offline + QA; engine realtime vẫn chạy
   worklet JS (worklet không thể dùng chung instance main-thread).
   ================================================================ */
var WASM_DSP_B64 = "AGFzbQEAAAABBgFgAn9/AAMCAQAFAwEAAQcdAgZtZW1vcnkCABBiaXF1YWRfYmxvY2tfZjY0AAAKuQQBtgQCAn8JfEEAIQICQANAIAIgAE8NAUGAICACQQhsaisDACEEQQAhAwJAA0AgAyABTw0BQQAgA0EFbEEAakEIbGorAwAhBkEAIANBBWxBAWpBCGxqKwMAIQdBACADQQVsQQJqQQhsaisDACEIQQAgA0EFbEEDakEIbGorAwAhCUEAIANBBWxBBGpBCGxqKwMAIQpBgBAgA0EIbGorAwAhC0GAEiADQQhsaisDACEMIAYgBKIgC6AhBSAHIASiIAkgBaKhIAygIQsgCCAEoiAKIAWioSEMQYAQIANBCGxqIAs5AwBBgBIgA0EIbGogDDkDACAFIQQgA0EBaiEDDAALC0GAICACQQhsaiAEOQMAIAJBAWohAgwACwtBACECAkADQCACIABPDQFBgMAAIAJBCGxqKwMAIQRBACEDAkADQCADIAFPDQFBgOAAIANBBWxBAGpBCGxqKwMAIQZBgOAAIANBBWxBAWpBCGxqKwMAIQdBgOAAIANBBWxBAmpBCGxqKwMAIQhBgOAAIANBBWxBA2pBCGxqKwMAIQlBgOAAIANBBWxBBGpBCGxqKwMAIQpBgBQgA0EIbGorAwAhC0GAFiADQQhsaisDACEMIAYgBKIgC6AhBSAHIASiIAkgBaKhIAygIQsgCCAEoiAKIAWioSEMQYAUIANBCGxqIAs5AwBBgBYgA0EIbGogDDkDACAFIQQgA0EBaiEDDAALC0GAwAAgAkEIbGogBDkDACACQQFqIQIMAAsLCw==";
function wasmDspBytes(){
  var s = WASM_DSP_B64, bin = atob(s), out = new Uint8Array(bin.length), i;
  for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
var WASM_DSP_BYTES = wasmDspBytes();
var WASM_DSP = { module: null };
function wasmDspJsCascade(xL, xR, coeffsL, coeffsR){
  var nB = Math.min(coeffsL.length, 32), N = Math.min(xL.length, xR.length);
  var s1L = new Float64Array(32), s2L = new Float64Array(32), s1R = new Float64Array(32), s2R = new Float64Array(32);
  var yL = new Float64Array(N), yR = new Float64Array(N), i, b, x, y, c;
  for (i = 0; i < N; i++){
    x = xL[i];
    for (b = 0; b < nB; b++){ c = coeffsL[b]; y = c.b0 * x + s1L[b]; s1L[b] = c.b1 * x - c.a1 * y + s2L[b]; s2L[b] = c.b2 * x - c.a2 * y; x = y; }
    yL[i] = x;
    x = xR[i];
    for (b = 0; b < nB; b++){ c = coeffsR[b]; y = c.b0 * x + s1R[b]; s1R[b] = c.b1 * x - c.a1 * y + s2R[b]; s2R[b] = c.b2 * x - c.a2 * y; x = y; }
    yR[i] = x;
  }
  return [yL, yR];
}
function wasmCreateDspCore(){
  if (typeof WebAssembly === "undefined") return { available: false, reason: "WebAssembly không khả dụng", processCascade: function (xL, xR, cL, cR){ return wasmDspJsCascade(xL, xR, cL, cR || cL); } };
  try {
    if (!WASM_DSP.module) WASM_DSP.module = new WebAssembly.Module(WASM_DSP_BYTES);
    if (!WebAssembly.validate(WASM_DSP_BYTES)) return { available: false, reason: "module WASM f64 validate không đạt", processCascade: function (xL, xR, cL, cR){ return wasmDspJsCascade(xL, xR, cL, cR || cL); } };
  } catch (e) {
    return { available: false, reason: "không biên dịch được module WASM f64: " + e.message, processCascade: function (xL, xR, cL, cR){ return wasmDspJsCascade(xL, xR, cL, cR || cL); } };
  }
  var inst = new WebAssembly.Instance(WASM_DSP.module, {});
  var mem = new Float64Array(inst.exports.memory.buffer);
  function processCascade(xL, xR, coeffsL, coeffsR){
    coeffsR = coeffsR || coeffsL;
    var nB = Math.min(coeffsL.length, 32), b;
    for (b = 0; b < nB; b++){
      mem[b * 5 + 0] = coeffsL[b].b0; mem[b * 5 + 1] = coeffsL[b].b1; mem[b * 5 + 2] = coeffsL[b].b2; mem[b * 5 + 3] = coeffsL[b].a1; mem[b * 5 + 4] = coeffsL[b].a2;
      mem[1536 + b * 5 + 0] = coeffsR[b].b0; mem[1536 + b * 5 + 1] = coeffsR[b].b1; mem[1536 + b * 5 + 2] = coeffsR[b].b2; mem[1536 + b * 5 + 3] = coeffsR[b].a1; mem[1536 + b * 5 + 4] = coeffsR[b].a2;
    }
    var N = Math.min(xL.length, xR.length);
    var yL = new Float64Array(N), yR = new Float64Array(N), off = 0, i;
    while (off < N){
      var chunk = Math.min(512, N - off);
      for (i = 0; i < chunk; i++){ mem[512 + i] = xL[off + i]; mem[1024 + i] = xR[off + i]; }
      inst.exports.biquad_block_f64(chunk, nB);
      for (i = 0; i < chunk; i++){ yL[off + i] = mem[512 + i]; yR[off + i] = mem[1024 + i]; }
      off += chunk;
    }
    return [yL, yR];
  }
  return { available: true, exports: inst.exports, memF64: mem, processCascade: processCascade };
}
function wasmDspSelfCheck(fs){
  var out = { pass: false, validated: false, available: false, maxAbsDiff10: NaN, maxAbsDiff20: NaN, resp1kDb: NaN, reason: "" };
  if (typeof WebAssembly === "undefined"){ out.reason = "WebAssembly không khả dụng"; return out; }
  try {
    out.validated = WebAssembly.validate(WASM_DSP_BYTES);
    if (!out.validated){ out.reason = "module WASM f64 validate không đạt"; return out; }
    var core = wasmCreateDspCore();
    out.available = core.available;
    if (!core.available){ out.reason = core.reason || "không tạo được core WASM f64"; return out; }
    function testSignal(N){
      var x = new Float64Array(N), s = 13579, i, v;
      x[0] = 1;
      for (i = 0; i < N; i++){
        v = 0.3 * Math.sin(2 * Math.PI * 100 * i / fs) + 0.2 * Math.sin(2 * Math.PI * 1000 * i / fs) + 0.1 * Math.sin(2 * Math.PI * 5000 * i / fs);
        s = (s * 1103515245 + 12345) % 2147483648; v += 0.05 * (s / 2147483648 * 2 - 1);
        x[i] += v;
      }
      return x;
    }
    function maxDiff(a, b){ var m = 0, i, d; for (i = 0; i < a.length; i++){ d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; }
    var x = testSignal(4096);
    var c10 = qaCoeffsFor(QA_TEST_BANDS, fs, {});
    var yW10 = wasmCreateDspCore().processCascade(x, x, c10, c10);
    var yJ10 = qaCascade(x, x, c10);
    out.maxAbsDiff10 = Math.max(maxDiff(yW10[0], yJ10[0]), maxDiff(yW10[1], yJ10[1]));
    var bands20 = FREQS20.map(function (f, i){ return { freq: f, type: TYPES20[i], gain: ((i * 7) % 5 - 2) * 1.5, q: DEFQ20[i], on: true }; });
    var c20 = qaCoeffsFor(bands20, fs, {});
    var yW20 = wasmCreateDspCore().processCascade(x, x, c20, c20);
    var yJ20 = qaCascade(x, x, c20);
    out.maxAbsDiff20 = Math.max(maxDiff(yW20[0], yJ20[0]), maxDiff(yW20[1], yJ20[1]));
    var imp = new Float64Array(4096); imp[0] = 1;
    var one = qaCoeffsFor([{ freq: 1000, type: "peaking", gain: 6, q: 1.41, on: true }], fs, {});
    var h = wasmCreateDspCore().processCascade(imp, imp, one, one)[0];
    var re = 0, im = 0, k, ph;
    for (k = 0; k < 4096; k++){ ph = -2 * Math.PI * 1000 * k / fs; re += h[k] * Math.cos(ph); im += h[k] * Math.sin(ph); }
    out.resp1kDb = 20 * Math.log10(Math.sqrt(re * re + im * im));
    out.pass = out.validated && out.available && out.maxAbsDiff10 <= 1e-14 && out.maxAbsDiff20 <= 1e-14 && Math.abs(out.resp1kDb - 6) <= 0.001;
    if (!out.pass) out.reason = "không đạt ngưỡng: diff10=" + out.maxAbsDiff10 + " diff20=" + out.maxAbsDiff20 + " resp1k=" + out.resp1kDb.toFixed(4) + " dB";
    return out;
  } catch (e) {
    out.reason = "lỗi tự kiểm: " + e.message;
    return out;
  }
}

function wasmTrig(N, fs){
  var key = N + "|" + fs, t = WASM.trig[key], k, f, w;
  if (t) return t;
  var padded = Math.ceil((N + 1) / 4) * 4;
  var cos = new Float32Array(padded), sin = new Float32Array(padded);
  /* (vòng tự động 13:57, hướng B — ÁP DỤNG, vá code): tần số lưới f_k = 20*1000^(min(k,N)/N) tính tăng lượng thay vì padded lần Math.pow — tỉ lệ bước _step = 1000^(1/N) tính MỘT lần rồi nhân dồn f *= _step (cùng kỹ thuật đã áp cho wasmTrigF64 lúc 13:26), tái tính chính xác bằng biểu thức gốc mỗi 64 bước trong vùng k<=N để chặn trôi làm tròn ở mức ulp, và k>=N (vùng đệm padded) gán đúng 20*1000 như biểu thức gốc; f_0 giữ đúng biểu thức gốc nên biên N=0 (0/0 = NaN) giữ nguyên hành vi; biểu thức w = 2*Math.PI*f/fs và mọi phép cos/sin không đổi. Lab Node trên hàm thật trích verbatim (sed + harness.js trong /tmp/lab_1354/, 2 lần chạy độc lập): parity 17.360 phần tử (N ∈ {0,1,2,7,220,240,880,960,2000} × fs ∈ {22050,44100,48000,96000}) 99,91% giống từng bit, lệch cos/sin tối đa 0 (Float32 hấp thụ hoàn toàn trôi ulp), NaN biên N=0 giữ nguyên, lệch đáp tuyến hạ nguồn tối đa 0 dB (ngưỡng tự kiểm WASM 0,05 dB); tốc độ dựng bảng lạnh paired-median xen kẽ 16 mẫu: N=220 1,67–1,70× thắng 16/16, N=880 1,70–1,72× thắng 15–16/16, N=2000 1,65–1,70× thắng 16/16 cả 2 lần — cải thiện ổn định. Đường ấm (cache hit) không đổi. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. */
  var _step = (N > 0) ? Math.pow(1000, 1 / N) : 1;
  f = 20 * Math.pow(1000, 0 / N);
  for (k = 0; k < padded; k++){
    if (k > 0 && k % 64 === 0 && k <= N) f = 20 * Math.pow(1000, k / N);
    else if (N > 0 && k >= N) f = 20 * Math.pow(1000, 1);
    w = 2 * Math.PI * f / fs;
    cos[k] = Math.cos(w); sin[k] = Math.sin(w);
    if (k < N) f *= _step;
  }
  t = { cos: cos, sin: sin, padded: padded };
  WASM.trig[key] = t;
  return t;
}
function wasmComputeArray(cc, N, fs){
  if (!WASM.instance || !WASM.mem) return null;
  var t = wasmTrig(N, fs);
  function align16(x){ return (x + 15) & ~15; }
  var cosp = 256, sinp = align16(cosp + t.padded * 4), outp = align16(sinp + t.padded * 4);
  var need = outp + t.padded * 4;
  if (WASM.mem.buffer.byteLength < need) WASM.mem.grow(Math.ceil((need - WASM.mem.buffer.byteLength) / 65536));
  var f32 = new Float32Array(WASM.mem.buffer);
  f32[0] = cc.b0; f32[1] = cc.b1; f32[2] = cc.b2; f32[3] = cc.a1; f32[4] = cc.a2;
  f32.set(t.cos, cosp / 4); f32.set(t.sin, sinp / 4);
  WASM.instance.exports.resp_simd(0, cosp, sinp, outp, t.padded / 4);
  var o = new Float32Array(WASM.mem.buffer, outp, t.padded);
  var a = new Float64Array(N + 1), k;
  /* (vòng tự động 11:05, hướng B — ÁP DỤNG, vá code): 20*Math.log10(x) -> 8.685889638065035*Math.log(x) (20/ln10, cùng hằng số J8-log đã áp ở loudRespDbT) — Math.log nhanh hơn Math.log10 trên V8; biểu thức kẹp max(1e-9, o[k]) giữ nguyên, sai số tối đa ~1,4e-14 dB trên mảng Float32 (xem lab), xa dưới ngưỡng tự kiểm WASM 0,05 dB. */
  for (k = 0; k <= N; k++) a[k] = 8.685889638065035 * Math.log(Math.max(1e-9, o[k]));
  return a;
}
var WASM_TRIG_F64 = {};
function wasmTrigF64(N, fs){
  var key = N + "|" + fs, t = WASM_TRIG_F64[key], k, f, w;
  if (t) return t;
  var cos = new Float64Array(N + 1), sin = new Float64Array(N + 1);
  /* (vòng tự động 13:26, hướng B — ÁP DỤNG, vá code): tần số lưới f_k = 20*1000^(k/N) tính tăng lượng thay vì N lần Math.pow — tỉ lệ bước _step = 1000^(1/N) tính MỘT lần rồi nhân dồn f *= _step, tái tính chính xác bằng biểu thức gốc mỗi 64 bước (k % 64 === 0) để chặn trôi làm tròn tích lũy ở mức ulp; f_0 giữ đúng biểu thức gốc nên trường hợp biên N=0 (0/0 = NaN) giữ nguyên hành vi; biểu thức w = 2*Math.PI*f/fs và mọi phép cos/sin không đổi. Lab Node trên hàm thật trích verbatim (extract.py + harness.js trong hidden_files/run_20261123_1324/, 2 lần chạy độc lập): parity 32 bảng (N ∈ {1,2,7,220,240,880,960,2000} × fs ∈ {22050,44100,48000,96000}) lệch cos/sin tối đa 2,31e-14, lệch đáp tuyến wasmJsArray tối đa 6,04e-13 dB (mức ulp, xa dưới ngưỡng tự kiểm WASM 0,05 dB), biên N=0 khớp NaN; tốc độ dựng bảng lạnh paired-median xen kẽ 15 vòng: N=880 lần 1 2,1050× (14/15) lần 2 2,2728× (11/15), N=220 1,9357×/1,8568× (15/15 cả 2 lần), N=2000 1,7477×/2,2998× (14/15 cả 2 lần); wasmJsArray lạnh N=880 1,5039×/1,3539× (12/15, 15/15); đường ấm (cache hit) không đổi 0,9995×/1,0015×. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. */
  var _step = (N > 0) ? Math.pow(1000, 1 / N) : 1;
  f = 20 * Math.pow(1000, 0 / N);
  for (k = 0; k <= N; k++){
    if (k > 0 && k % 64 === 0) f = 20 * Math.pow(1000, k / N);
    w = 2 * Math.PI * f / fs;
    cos[k] = Math.cos(w); sin[k] = Math.sin(w);
    f *= _step;
  }
  t = { cos: cos, sin: sin };
  WASM_TRIG_F64[key] = t;
  return t;
}
function wasmJsArray(cc, N, fs){
  var t = wasmTrigF64(N, fs), a = new Float64Array(N + 1), k;
  var b0 = cc.b0, b1 = cc.b1, b2 = cc.b2, a1 = cc.a1, a2 = cc.a2;
  for (k = 0; k <= N; k++){
    var cw = t.cos[k], sw = t.sin[k];
    var cw2 = 2 * cw * cw - 1, sw2 = 2 * sw * cw;
    var nr = b0 + b1 * cw + b2 * cw2, ni = -(b1 * sw + b2 * sw2);
    var dr = 1 + a1 * cw + a2 * cw2, di = -(a1 * sw + a2 * sw2);
    a[k] = 4.3429448190325175 * Math.log(Math.max(1e-18, (nr * nr + ni * ni) / Math.max(1e-24, (dr * dr + di * di)))); /* (vòng tự động 11:05, hướng B): 10*Math.log10(x) -> (10/ln10)*Math.log(x) = 4.3429448190325175*Math.log(x) — cùng đẳng thức J8-log, sai số tối đa 5,7e-14 dB trong lab, kẹp giữ nguyên. */
  }
  return a;
}
/* --- Mở rộng 2026-11-23 (vòng tự động 22:54, hướng B — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm B (sau A 22:24, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 22:26:42+07, 6.282.259 byte / 25.430 dòng (wc -l), md5 98f3da6edd81f0b6f83395807f960a95, version 349) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-B lưu tại ~/workspace/autoeq/backups/2026-11-23_2254_before.html. Ứng viên B duy nhất: hoist mảng lượng giác t.cos/t.sin ra biến cục bộ _cos/_sin trong wasmJsArray (đường JS dự phòng của wasmBandMagDbArray) — trước đây mỗi điểm lưới k đọc t.cos[k]/t.sin[k] (2 lần tra thuộc tính object + 2 lần tra chỉ số mảng mỗi điểm); nay lấy _cos=t.cos, _sin=t.sin MỘT lần trước vòng rồi đọc _cos[k]/_sin[k] — cùng mảng, cùng chỉ số, cùng biểu thức cw2/sw2/nr/ni/dr/di/log giữ nguyên từng toán hạng/thứ tự nên GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/±Infinity/-0, N biên, fs biên, cc null/thiếu trường ném đúng loại lỗi). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js/bench_direct.js trong hidden_files/run_20261123_2254_B/, 2 lần chạy độc lập): parity 754.101 kiểm tra GIỐNG TỪNG BIT (Object.is từng phần tử; gồm 18 dạng hệ số × 9 N × 10 fs + biên N âm/NaN/Infinity + lặp lại cache + 200 fuzz); tốc độ paired-median xen kẽ 15 vòng KHÔNG ổn định cả 2 lần: bench vm-context lần 1 W1 N220 1,0201× thắng 10/15, W2 N240 1,0167× thắng 12/15, W3 N960 0,9846× thắng 6/15, W4 1,0311× thắng 13/15; lần 2 W1 0,9936× thắng 4/15, W2 0,9942× thắng 4/15, W3 0,9983× thắng 6/15, W4 1,0099× thắng 10/15; bench direct (cùng realm) lần 1 W1 1,0621× thắng 12/15, W2 1,0192× thắng 9/15, W3 1,0023× thắng 9/15, W4 0,9990× thắng 7/15; lần 2 W1 1,0137× thắng 9/15, W2 0,9317× thắng 3/15, W3 0,9954× thắng 6/15, W4 0,9996× thắng 7/15 — W1/W2 đảo chiều giữa các lần chạy (lợi ích nằm trong nhiễu JIT/register allocation, không cải thiện ổn định trên mọi workload) → BÁC, không vá code. KHÔNG thử lại hướng hoist t.cos/t.sin trong wasmJsArray. (Thử thêm biến thể tiền tính cos2/sin2 trong bảng wasmTrigF64: parity bit-identical nhưng tốc độ không ổn định/chậm hơn ở N lớn, cũng không áp.) Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_2254_B/. --- */
function wasmSelfCheck(){
  if (WASM.selfChecked && WASM.lastCheck) return WASM.lastCheck;
  if (!WASM.tried){
    WASM.tried = true;
    try {
      var mod = new WebAssembly.Module(wasmB64Bytes());
      WASM.instance = new WebAssembly.Instance(mod, {});
      WASM.mem = WASM.instance.exports.mem;
      WASM.enabled = true;
    } catch (e) { WASM.enabled = false; WASM.lastCheck = { enabled: false, maxDev: Infinity, reason: "không khởi tạo được WASM: " + e.message }; return WASM.lastCheck; }
  }
  if (!WASM.enabled){ if (!WASM.lastCheck) WASM.lastCheck = { enabled: false, maxDev: Infinity, reason: "WASM đã tắt" }; return WASM.lastCheck; }
  try {
    var fs = (typeof displayFs !== "undefined" && displayFs) ? displayFs : 48000;
    var fixtures = [rbjCoeffs("peaking", 1000, 6, 1.41, fs)];
    var i;
    for (i = 0; i < 20; i++) fixtures.push(rbjCoeffs("peaking", 31 * Math.pow(2, i / 3), (i % 7) - 3, 1.2, fs));
    var maxDev = 0, k, wa, ja;
    for (i = 0; i < fixtures.length; i++){
      wa = wasmComputeArray(fixtures[i], 220, fs); ja = wasmJsArray(fixtures[i], 220, fs);
      if (!wa) throw new Error("kernel WASM trả null");
      for (k = 0; k <= 220; k++){ var d = Math.abs(wa[k] - ja[k]); if (d > maxDev) maxDev = d; }
    }
    WASM.enabled = (maxDev <= 0.05);
    WASM.lastCheck = { enabled: WASM.enabled, maxDev: maxDev, reason: WASM.enabled ? "" : "lệch " + maxDev.toFixed(5) + " dB vượt ngưỡng 0,05 dB" };
    WASM.selfChecked = true;
    return WASM.lastCheck;
  } catch (e) {
    WASM.enabled = false;
    WASM.lastCheck = { enabled: false, maxDev: Infinity, reason: "lỗi tự kiểm: " + e.message };
    return WASM.lastCheck;
  }
}
function wasmBandMagDbArray(cc, N, fs){
  if (typeof WebAssembly !== "undefined"){
    try {
      var chk = wasmSelfCheck();
      if (chk.enabled){
        var a = wasmComputeArray(cc, N, fs);
        if (a) return a;
      }
    } catch (e) { WASM.enabled = false; }
  }
  return wasmJsArray(cc, N, fs);
}
function wasmBenchmark(){
  try {
    var fs = (typeof displayFs !== "undefined" && displayFs) ? displayFs : 48000;
    var coeffs = [], i;
    for (i = 0; i < 20; i++) coeffs.push(rbjCoeffs("peaking", 31 * Math.pow(2, i / 3), (i % 7) - 3, 1.2, fs));
    var reps = 100, r, k, t0, tJs, tW, ja, wa, maxDev = 0;
    ja = null; wa = null;
    t0 = performance.now();
    for (r = 0; r < reps; r++){ ja = new Float64Array(221); for (i = 0; i < coeffs.length; i++){ var arr = wasmJsArray(coeffs[i], 220, fs); for (k = 0; k <= 220; k++) ja[k] += arr[k]; } }
    tJs = performance.now() - t0;
    var chk = wasmSelfCheck();
    if (!chk.enabled) return { enabled: false, reason: chk.reason };
    t0 = performance.now();
    for (r = 0; r < reps; r++){ wa = new Float64Array(221); for (i = 0; i < coeffs.length; i++){ var arr2 = wasmComputeArray(coeffs[i], 220, fs); for (k = 0; k <= 220; k++) wa[k] += arr2[k]; } }
    tW = performance.now() - t0;
    for (k = 0; k <= 220; k++){ var d = Math.abs(wa[k] - ja[k]); if (d > maxDev) maxDev = d; }
    WASM.lastBench = { jsMs: tJs / reps, wasmMs: tW / reps, speedup: tJs / tW, maxDev: maxDev, reps: reps };
    return WASM.lastBench;
  } catch (e) { return { enabled: false, reason: "lỗi đo: " + e.message }; }
}
function wasmRefreshPanel(){
  if ($("wasmState")) $("wasmState").textContent = (WASM.enabled ? "ĐANG BẬT (WASM+SIMD)" : (WASM.tried ? "DỰ PHÒNG JS (f64)" : "CHƯA KIỂM TRA"));
  if ($("wasmInfo")){
    var c = WASM.lastCheck, b = WASM.lastBench;
    var s = c ? ("tự kiểm: " + (c.enabled ? "ĐẠT, lệch tối đa " + c.maxDev.toFixed(5) + " dB (ngưỡng 0,05 dB)" : "KHÔNG ĐẠT — " + c.reason)) : "chưa tự kiểm";
    if (b && b.speedup) s += " · đo: JS " + b.jsMs.toFixed(3) + " ms/lưới, WASM " + b.wasmMs.toFixed(3) + " ms/lưới, nhanh hơn " + b.speedup.toFixed(2) + "×, lệch " + b.maxDev.toFixed(5) + " dB (" + b.reps + " lần, lưới 20 band N=220)";
    $("wasmInfo").textContent = s;
  }
}

if ($("wasmBench")) $("wasmBench").addEventListener("click", function(){
  var b = wasmBenchmark();
  if (b && b.speedup) { if ($("wasmInfo")) $("wasmInfo").textContent = "đo: JS " + b.jsMs.toFixed(3) + " ms/lưới, WASM " + b.wasmMs.toFixed(3) + " ms/lưới, nhanh hơn " + b.speedup.toFixed(2) + "×, lệch " + b.maxDev.toFixed(5) + " dB (" + b.reps + " lần, lưới 20 band N=220)"; }
  else if ($("wasmInfo")) $("wasmInfo").textContent = "không đo được WASM: " + (b.reason || "?");
  wasmRefreshPanel();
});

function gridTotalDb(N, fs){
  var c = GRID_TOT[N];
  if (!c || c.fs !== fs){
    /* psyArr khởi tạo bằng mảng 0 (không phải null) và psyKey để trống:
       drawGraph/computeAutoPre có thể được gọi trong lúc khối
       Psychoacoustics CHƯA nạp (vd aeInit gọi drawGraph ngay khi thực thi
       khối AutoEQ) — khi đó psycho chưa tồn tại và đóng góp đúng bằng 0,
       giống hệt totalDbAt bảo vệ bằng typeof PSY. Khi PSY nạp xong, psyKey
       chuyển null → chữ ký thật và mảng psycho được tính lại ngay. */
    c = GRID_TOT[N] = { fs: fs, keys: [], arrs: [], psyKey: undefined, psyArr: new Float64Array(N + 1), total: null, dirty: true };
  }
  var i, k, b, key;
  var _fbCw = null, _fbSw = null, _fbCw2 = null, _fbSw2 = null;
  for (i = 0; i < bands.length; i++){
    b = bands[i];
    key = (b.on ? 1 : 0) + "|" + b.type + "|" + b.freq + "|" + b.gain + "|" + b.q;
    if (c.keys[i] !== key){
      c.keys[i] = key;
      /* Pha C 2026-11-07: reset arr = null moi vong lap — truoc day `var arr`
         chi khai bao 1 lan (hoisted) nen band OFF/gain 0 (cc null) duoc tinh
         lai trong CUNG 1 lan goi sau 1 band ON se nhan NGUYEN mang dap tuyen
         cua band truoc (ghost): ap preset co band OFF sau band ON lam tong
         dap tuyen dem trung band ON, preamp tu dong sai toi -81 dB (gan cam
         tieng) thay vi -9 dB, do thi sai theo; nut tung band rieng thi dung
         vi moi lan goi chi tinh lai 1 band (lab 2026-11-07 B1/B3). Voi
         arr = null, band OFF/gain 0 luon nhan mang 0 moi; cac truong hop
         dung truoc day (band ON, band gain 0 o dau chuoi) bit-identical. */
      var arr = null, cc = (b.on && b.gain !== 0) ? bandCoeffs(i, fs) : null;
      if (cc && typeof wasmBandMagDbArray === "function"){ try { arr = wasmBandMagDbArray(cc, N, fs); } catch (e) { arr = null; } }
      if (!arr){
        var _gf = GRID_FREQ_CACHE[N];
        if (!_gf){ _gf = new Float64Array(N + 1); for (k = 0; k <= N; k++) _gf[k] = 20*Math.pow(1000, k/N); if (Object.keys(GRID_FREQ_CACHE).length > 16) GRID_FREQ_CACHE = {}; GRID_FREQ_CACHE[N] = _gf; }
        arr = new Float64Array(N + 1);
        if (cc){
          /* (vòng tự động 14:24, hướng B — ÁP DỤNG, vá code): bảng lượng giác dùng chung cho đường fallback JS trong gridTotalDb — trước đây mỗi band fallback gọi biquadMagDb tính lại cos/sin cho mọi điểm lưới (N+1 điểm × số band dirty); nay dựng bảng cw/sw/cw2/sw2 MỘT lần (lười, ở band fallback hoạt động đầu tiên, cùng biểu thức 2*Math.PI*_gf[k]/fs, Math.cos/sin và 2*cw*cw-1 / 2*sw*cw như biquadMagDb) rồi mỗi band đọc bảng thay vì tính lại lượng giác; biểu thức nr/ni/dr/di + phép log + kẹp giữ nguyên từng toán hạng/thứ tự như biquadMagDb nên mảng đáp tuyến từng band GIỐNG TỪNG BIT theo cấu trúc; thứ tự xử lý band, thời điểm tạo GRID_FREQ_CACHE và gán c.arrs[i]/c.dirty giữ nguyên như cũ (kể cả khi band null ném lỗi giữa vòng). Band tắt/gain 0 (cc null) vẫn nhận mảng 0 không dựng bảng. Đường WASM không đổi. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261125_1424_B/, 3 lần bench độc lập): parity 35/35 kịch bản GIỐNG TỪNG BIT (Object.is trên total + snapshot cache; gồm 10/20 band × N 0/1/7/220/240/880/960 × fs 44100/48000/96000/22050/0/NaN/Infinity/âm, band tắt/gain 0, WASM ok/throw, null/undefined band, gain/q/freq NaN/±Infinity/-0/1e308, type lạ/null/thiếu trường, N âm/NaN); tốc độ paired-median xen kẽ 15 vòng trên gridTotalDb fallback (WASM tắt): cold (mọi band dirty) B20 N880 1,67x/1,70x/1,77x thắng 15/14/14, B10 N880 1,56x/1,51x/1,57x thắng 15/14/15, B20 N220 1,55x/1,51x/1,57x thắng 13/11/14; drag 1 band trung tính 0,94-1,04x (control old-vs-old ~1,0x, môi trường VM nhiễu mạnh); không hồi quy đường drag. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm C. */
          if (!_fbCw){
            _fbCw = new Float64Array(N + 1); _fbSw = new Float64Array(N + 1); _fbCw2 = new Float64Array(N + 1); _fbSw2 = new Float64Array(N + 1);
            for (k = 0; k <= N; k++){ var _tw = 2*Math.PI*_gf[k]/fs; _fbCw[k] = Math.cos(_tw); _fbSw[k] = Math.sin(_tw); _fbCw2[k] = 2*_fbCw[k]*_fbCw[k] - 1; _fbSw2[k] = 2*_fbSw[k]*_fbCw[k]; }
          }
          for (k = 0; k <= N; k++){
            var _cw = _fbCw[k], _sw = _fbSw[k], _cw2 = _fbCw2[k], _sw2 = _fbSw2[k];
            var _nr = cc.b0 + cc.b1*_cw + cc.b2*_cw2, _ni = -(cc.b1*_sw + cc.b2*_sw2);
            var _dr = 1 + cc.a1*_cw + cc.a2*_cw2, _di = -(cc.a1*_sw + cc.a2*_sw2);
            arr[k] = 4.342944819032518*Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di))));
          }
        }
      }
      c.arrs[i] = arr; c.dirty = true;
    }
  }
  var psyKey = null;
  if (typeof PSY !== "undefined" && PSY && typeof psychoCoeffs === "function" && typeof PSY_CC !== "undefined"){
    psychoCoeffs(fs); /* bảo đảm PSY_CC.key là chữ ký hiện hành */
    psyKey = PSY_CC.key;
  }
  if (c.psyKey !== psyKey){
    c.psyKey = psyKey;
    var pa = new Float64Array(N + 1);
    if (psyKey !== null && typeof psychoDbAt === "function"){
      var _gf2 = GRID_FREQ_CACHE[N];
      if (!_gf2){ _gf2 = new Float64Array(N + 1); for (k = 0; k <= N; k++) _gf2[k] = 20*Math.pow(1000, k/N); if (Object.keys(GRID_FREQ_CACHE).length > 16) GRID_FREQ_CACHE = {}; GRID_FREQ_CACHE[N] = _gf2; }
      /* (vòng tự động 08:49, hướng B — ÁP DỤNG, vá code): inline psycho vào gridTotalDb — psychoCoeffs(fs) gọi MỘT lần trước vòng lưới thay vì mỗi điểm (psychoDbAt gọi lại mỗi lần, dựng chuỗi khóa + join mỗi điểm dù cache trúng); thân vòng sao chép nguyên văn psychoDbAt (lượng giác lười ở section hoạt động đầu tiên, biểu thức nr/ni/dr/di + log + kẹp giữ nguyên từng toán hạng/thứ tự, cộng dồn s=0 theo section 0..n-1) nên pa[k] giống từng bit. Guard typeof psychoDbAt giữ nguyên để hành vi khi thiếu khối Psychoacoustics không đổi. */
      var _pcs = psychoCoeffs(fs);
      for (k = 0; k <= N; k++){
        var _s = 0, _cw, _sw, _cw2, _sw2, _td = false, _pi;
        for (_pi = 0; _pi < _pcs.length; _pi++) if (_pcs[_pi] !== PSY_ID){
          if (!_td){ var _w = 2*Math.PI*_gf2[k]/fs; _cw = Math.cos(_w); _sw = Math.sin(_w); _cw2 = 2*_cw*_cw - 1; _sw2 = 2*_sw*_cw; _td = true; }
          var _c = _pcs[_pi];
          var _nr = _c.b0 + _c.b1*_cw + _c.b2*_cw2, _ni = -(_c.b1*_sw + _c.b2*_sw2);
          var _dr = 1 + _c.a1*_cw + _c.a2*_cw2, _di = -(_c.a1*_sw + _c.a2*_sw2);
          _s += 4.342944819032518*Math.log(Math.max(1e-18,(_nr*_nr+_ni*_ni)/Math.max(1e-24,(_dr*_dr+_di*_di))));
        }
        pa[k] = _s;
      }
    }
    c.psyArr = pa; c.dirty = true;
  }
  if (c.dirty || !c.total){
    var tot = new Float64Array(N + 1);
    for (i = 0; i < bands.length; i++){
      var _arr = c.arrs[i];
      for (k = 0; k <= N; k++) tot[k] += _arr[k];
    }
    for (k = 0; k <= N; k++) tot[k] += c.psyArr[k];
    c.total = tot; c.dirty = false;
  }
  return c.total;
}
/* --- Mở rộng 2026-11-23 (vòng tự động 21:15, hướng D — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm D (sau C 21:09, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 21:11:08+07, 6.262.376 byte / 25.345 dòng (wc -l), md5 a3a8c6039883b8b1339970bc378c364e, version 325) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-D lưu tại ~/workspace/autoeq/backups/*2026-11-23_2115*. Ứng viên D duy nhất: thay khóa chuỗi trong gridTotalDb — trước đây mỗi lần gọi dựng chuỗi khóa (b.on?1:0)+"|"+type+"|"+freq+"|"+gain+"|"+q cho mọi band để so với c.keys[i]; nay lưu tuple [on,type,freq,gain,q] và so từng trường bằng === (SameValueZero cho số: NaN khớp NaN, -0 khớp 0 như chuỗi) như mẫu bandCoeffs — cùng điều kiện trúng/trượt cache nên mảng total giống từng bit theo cấu trúc, chỉ bỏ phép nối chuỗi mỗi lần gọi. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_2115_D/, 2 lần chạy độc lập): parity 80/80 GIỐNG TỪNG BIT cả 2 lần (Object.is trên mọi phần tử total + đồng nhất đối tượng mảng khi trúng cache; gồm N=0/1/7/220/880 × 0/3/10/20 band × fs 44100/48000/96000, đổi từng tham số band, đổi fs/N, tăng/giảm số band, thay object cùng tham số, band tắt/gain 0, NaN/±Infinity/-0/subnormal/1e308, loại lạ/thiếu trường, PSY bật/tắt/bypass, đường WASM-mảng, band null ném đúng TypeError) — nhưng tốc độ paired-median xen kẽ 15 vòng không cải thiện ổn định trên đường cache-hit (đường nóng của drawGraph): lần 1 W1 hit10 1,0084x thắng 10/15, W2 hit20 0,9855x thắng 7/15, W3 hit10-N220 1,0005x thắng 8/15, W4 hit10-PSY 1,0262x thắng 14/15, W5 dirty 1,0040x thắng 9/15; lần 2 W1 0,9696x thắng 7/15, W2 1,0032x thắng 8/15, W3 0,9756x thắng 6/15, W4 0,9920x thắng 7/15, W5 1,0007x thắng 8/15 — W4 lần 1 không lặp lại lần 2, tỉ lệ dao động 0,5-2,0x trong nhiễu VM chia sẻ (đường cache-hit quá rẻ, chi phí nối chuỗi đã bị V8 tối ưu sẵn) → BÁC, không vá code. KHÔNG thử lại hướng thay khóa chuỗi trong gridTotalDb bằng tuple so sánh số. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff với backup pre-D chỉ thêm comment này (không đổi code). Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_2115_D/. --- */

/* --- Mở rộng 2026-11-23 (vòng tự động 19:52, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 19:47, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 19:46:39+07, 6.241.095 byte / 25.320 dòng, md5 b585b93bee6f1649636340119cde2177, version 299) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-D lưu tại ~/workspace/autoeq/backups/Web AutoEQ - DSP Core_2026-11-23_1949_pre-D.html. Ứng viên D duy nhất: chuyển vị vòng tổng trong gridTotalDb — trước đây vòng ngoài duyệt điểm lưới k và vòng trong cộng dồn qua mọi band (đọc c.arrs[i][k] nhảy giữa các mảng cho mọi k, rồi cộng psycho); nay khởi tạo tot toàn 0, vòng ngoài duyệt band (đọc mảng đáp tuyến _arr=c.arrs[i] MỘT lần/band) và vòng trong duyệt lưới cộng tot[k] += _arr[k] tuần tự, sau đó cộng psycho một lần — thứ tự cộng theo band 0..n-1 cho mỗi k giữ nguyên (0 + band0 + band1 ... + psycho, đúng như s=0; s+=band0; ...; tot=s+psyArr) nên mọi double của total GIỐNG TỪNG BIT theo cấu trúc, kể cả band rỗng (tot toàn psycho), band OFF/gain 0 (mảng 0), NaN/±Infinity (thứ tự cộng không đổi). Khác hướng đã bác: gộp hai vòng trong aePreserveMeasure (lượt này, parity 509/509 nhưng tốc độ chỉ 1,002-1,021x trong nhiễu → BÁC, không vá) và hoist log2/shelf trong aePreservedTarget (01:24, V8 đã CSE sẵn) — lượt này chỉ đổi thứ tự duyệt vòng tổng đã có trong gridTotalDb, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js/harness2.js/harness3.js + verify_patched.py/verify.js trong hidden_files/run_20261123_1949_D2/, 2 lần chạy độc lập): parity 52/52 GIỐNG TỪNG BIT (Object.is; gồm N=0/1/7/220/880/960 × 0/1/10/20 band × fs 44100/48000/96000, cache hit lần 2) + verify trên file ĐÃ VÁ 24/24; tốc độ paired-median xen kẽ 15 vòng trên gridTotalDb đường dirty (đổi gain 1 band, main-context): lần 1 1,1316x thắng 14/15, lần 2 1,1402x thắng 15/15; vòng tổng cô lập (plain Node, 2000 rep): lần 1 2,5433x thắng 15/15, lần 2 2,4220x thắng 15/15 — cải thiện ổn định cả 2 lần (lợi ích thực trên đường cache-hit của drawGraph nhỏ hơn vì vòng tổng chỉ chạy khi dirty). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 20/20 khối script inline node --check PASS, kết thúc đúng </html>, diff với backup pre-D đúng 1 hunk code + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1949_D2/. --- */
/* ---------------- Pre-amp tự động ---------------- */
function computeAutoPre(fs){
  /* Quét đỉnh trên lưới 960 điểm (2026-10-28): lưới 240 điểm cũ đánh giá thấp đỉnh
     thật tới ~0,009 dB (band test +6 dB/Q1.41 tại 1 kHz: đỉnh lưới 5,9911 dB so với
     đỉnh thật 6,0000 dB) nên pre-amp tính ra thiếu headroom đúng ngần ấy. Lưới 960
     điểm cho đỉnh 5,9997 dB; chi phí không đáng kể vì gridTotalDb cache theo band. */
  var tot = gridTotalDb(960, fs), max = -Infinity, mf = 0;
  for (var k = 0; k <= 960; k++){
    if (tot[k] > max){ max = tot[k]; mf = 20*Math.pow(1000, k/960); } /* 20 Hz → 20 kHz, log */
  }
  /* Tinh chỉnh đỉnh cục bộ (2026-10-31): đỉnh thật của một band hẹp có thể nằm
     giữa hai điểm lưới 960 (lưới hụt tối đa ~0,01 dB ở đỉnh nhọn) — chạy
     golden-section trên totalDbAt thật quanh điểm lưới cao nhất để maxPosDb
     và pre-amp bám đỉnh thật; chỉ nhận kết quả nếu cao hơn đỉnh lưới. */
  if (isFinite(max) && mf > 0){
    try {
      var stepR = Math.pow(1000, 1/960), ga = mf/stepR, gb = mf*stepR, gr = (Math.sqrt(5)-1)/2;
      var gc1 = gb - gr*(gb-ga), gc2 = ga + gr*(gb-ga);
      var gv1 = totalDbAt(gc1, fs), gv2 = totalDbAt(gc2, fs);
      for (var git = 0; git < 40; git++){
        if (gv1 < gv2){ ga = gc1; gc1 = gc2; gv1 = gv2; gc2 = ga + gr*(gb-ga); gv2 = totalDbAt(gc2, fs); }
        else { gb = gc2; gc2 = gc1; gv2 = gv1; gc1 = gb - gr*(gb-ga); gv1 = totalDbAt(gc1, fs); }
      }
      var rf2 = (ga+gb)/2, rv2 = totalDbAt(rf2, fs);
      if (rv2 > max){ max = rv2; mf = rf2; }
    } catch (e) {}
  }
  maxPosDb = max; maxPosFreq = mf;
  autoPreDb = (max>0) ? -(max + 1.0 + extraHeadDb) : 0;
}
function appliedPreDb(){ return preMode==="auto" ? autoPreDb : manualPreDb; }

/* ---------------- FFT (radix-2, cho FIR) ---------------- */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:50, hướng B): cache bảng twiddle cho
   fft() — THỬ T2 BỊ BÁC, không áp vá code. fft() hiện chỉ tốn 2 lần Math.cos/sin
   mỗi stage (truy hồi twiddle trong vòng trong), nên cache không tiết kiệm trig
   mà chỉ thay phép quay truy hồi (4 nhân+2 cộng/butterfly, chuỗi nối tiếp) bằng
   tra bảng Float64Array. Ứng viên T2: bảng nạp bằng ĐÚNG phép quay truy hồi cũ
   (cùng thứ tự số học, cùng double) nên giá trị tra bảng giống từng bit với
   truy hồi tại chỗ — thiết kế để kết quả giống từng bit theo cấu trúc.
   Lab Node trên hàm thật (lượt 20:50, chạy 2 lần độc lập, 9 fixture như 20:20/
   20:30, 150 rep xen kẽ xoay thứ tự + microbench fft riêng): T2 GIỐNG TỪNG BIT
   với gốc ở mọi phép kiểm — fft trực tiếp fwd/inv N=256/4096/131072 (nDiff=0,
   maxRel=0, cả lần cache lạnh lẫn ấm), taps buildFirTaps 9/9 fixture nDiff=0,
   đối xứng giữ nguyên — nhưng CHẬM HƠN ỔN ĐỊNH ở cả 2 lần: buildFirTaps đầy đủ
   0,94–0,98× ở 9/9 fixture cả 2 lần (F1 1,076→1,142 ms lần 1; 1,040→1,075 ms
   lần 2), microbench fft N=4096 inv 0,85–0,92×, N=131072 fwd 0,92–0,97×.
   Chẩn đoán: giá trị truy hồi nằm trong thanh ghi CPU, tra bảng Float64Array
   tốn nạp bộ nhớ + kiểm tra biên nên chậm hơn dù bớt phép nhân — cùng lớp
   như ứng viên mảng hệ số phẳng bị bác ở vòng 18:07. KHÔNG áp T2 và KHÔNG thử
   lại mọi biến thể bảng twiddle cho fft() (biến thể cos trực tiếp T1 cùng
   thân vòng nên chung kết quả chậm, lại thêm sai số làm tròn — không thử).
   FFT 25–61% tổng dựng nhưng đã gần tối ưu trên V8; dư địa còn lại nằm ở vòng
   bin (55–70%). Không chạm solver/WASM/FIR/QA — chỉ thêm comment này.
   Ý tưởng lượt kế: hướng D — đo measureFps/drawGraph trên phổ thật (ý tưởng
   treo từ 20:19); hoặc hướng C — rà soát loudFitError trên lưới phon rộng
   (10–100 phon, ý tưởng từ 19:20). --- */
/* (vòng tự động 14:57, hướng B — ÁP DỤNG, vá code): vòng chuẩn hoá IFFT của fft() — n là lũy thừa 2 trong mọi caller thực (4096/8192...) nên 1/n chính xác nhị phân và x*(1/n) giống từng bit với x/n (kể cả subnormal/NaN/Infinity, kiểm chứng scalar); nay tính invN=1/n MỘT lần rồi nhân thay vì 2n phép chia mỗi lần gọi. n không phải lũy thừa 2 rơi về vòng chia gốc nguyên vẹn. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench2.js trong hidden_files/run_20261123_1454_B/, 2 lần chạy độc lập): parity 221.868 giá trị 0 lệch (Object.is; gồm n=1..8192, rand/mag/extreme/impulse, fwd+inv, cộng n không lũy thừa 2 giữ đường chia); bench paired-median xen kẽ 31 vòng (đo từng lần gọi bằng hrtime, khôi phục buffer ngoài vùng đo): inv4096-mag lần 1 1,0927x thắng 28/31, lần 2 1,0913x thắng 27/31; inv4096-rand 1,0964x/1,0919x thắng 26-27/31; control fwd4096 1,0020x/1,0055x trung tính như kỳ vọng (đường fwd không đổi); microbench vòng chuẩn hoá riêng 3,07-3,09x. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. */
function fft(re, im, invert){
  var n = re.length, j=0, i, len, ang, wlenR, wlenI, uR,uI,vR,vI,tR,tI;
  for(i=1;i<n;i++){
    var bit = n>>1;
    for(; j & bit; bit>>=1) j ^= bit;
    j ^= bit;
    if(i<j){ tR=re[i];re[i]=re[j];re[j]=tR; tI=im[i];im[i]=im[j];im[j]=tI; }
  }
  for(len=2; len<=n; len<<=1){
    ang = 2*Math.PI/len*(invert?1:-1);
    wlenR=Math.cos(ang); wlenI=Math.sin(ang);
    /* (vòng tự động 16:54, hướng B — ÁP DỤNG, vá code): vòng bướm fft() — hoist halfLen=len/2 ra khỏi vòng k, chỉ số a tăng dần thay cho i+k (cùng dãy chỉ số nguyên chính xác), và đọc re[b]/im[b] MỘT lần vào _rb/_ib thay vì 2 lần mỗi điểm; cùng toán hạng/thứ tự phép tính nên GIỐNG TỪNG BIT theo cấu trúc. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_1654_B/, 2 lần bench độc lập): parity 343/343 GIỐNG TỪNG BIT; bench paired-median 15 vòng: n4096 inv mag 1,1005x/1,1050x thắng 13-15/15, n4096 inv rand 1,1271x/1,1118x thắng 15/15, n8192 inv 1,1386x/1,0874x thắng 13-15/15 — cải thiện ổn định mọi workload. Không chạm solver/WASM/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm C. */
    var halfLen = len/2;
    for(i=0;i<n;i+=len){
      var wR=1, wI=0, k;
      var a = i;
      for(k=0;k<halfLen;k++){
        var b = a + halfLen;
        uR=re[a]; uI=im[a];
        var _rb = re[b], _ib = im[b];
        vR=_rb*wR - _ib*wI; vI=_rb*wI + _ib*wR;
        re[a]=uR+vR; im[a]=uI+vI; re[b]=uR-vR; im[b]=uI-vI;
        tR=wR*wlenR - wI*wlenI; wI=wR*wlenI + wI*wlenR; wR=tR;
        a++;
      }
    }
  }
  if(invert){ if ((n & (n-1)) === 0){ var invN = 1/n; for(i=0;i<n;i++){ re[i]*=invN; im[i]*=invN; } } else { for(i=0;i<n;i++){ re[i]/=n; im[i]/=n; } } }
}
/* --- Mở rộng 2026-11-23 (vòng tự động 18:46, hướng B — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm B (sau A 18:33, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 18:36:23+07, 6.224.381 byte / 25.283 dòng, md5 68f903239d79685223532ab7fec7d9b9, version 280) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-B lưu tại ~/workspace/autoeq/backups/*2026-11-23_1139*. Ứng viên B duy nhất: cache hoán vị bit-reversal theo n cho fft() (FFT_REV_CACHE, Uint32Array) — vòng đảo bit tính lại chỉ số j bằng phép XOR mỗi lần gọi; nay tính hoán vị MỘT lần/n rồi áp dụng hoán vị có sẵn (cùng thứ tự đổi chỗ i<j, cùng dãy j theo đúng thuật toán gốc nên giống từng bit theo cấu trúc, kể cả n không lũy thừa 2). Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1839_B/, 2 lần chạy độc lập + probe tách vòng đảo bit): parity 382/382 GIỐNG TỪNG BIT cả 2 lần (Object.is sâu; gồm n=0..8192 (35 kích thước), 5 loại dữ liệu rand/impulse/mag/extreme/zeros × fwd/inv, mảng thưa, lặp lại cache hit, xóa cache >8 mục, đầu vào null/undefined/không phải mảng ném lỗi đúng loại cũ); probe tách vòng đảo bit cho thấy vòng riêng nhanh hơn 2,0× (0,0972→0,0483 ms) nhưng tốc độ paired-median xen kẽ 15 vòng trên fft() đầy đủ KHÔNG cải thiện ổn định cả 2 lần: lần 1 n=4096 inv 0,9856× (thắng 6/15), n=4096 fwd 0,9632× (3/15), n=8192 1,0031× (10/15), n=1024 1,0025× (10/15), n=256 0,9305× (7/15), n=16 0,9600× (5/15); lần 2 n=4096 inv 0,9924× (5/15), n=4096 fwd 1,0028× (8/15), n=8192 1,0066× (10/15), n=1024 1,0073× (9/15), n=256 0,9924× (7/15), n=16 0,9977× (7/15) — trong ngữ cảnh hàm đầy đủ, vòng tính j bằng số nguyên đã được V8 tối ưu sẵn và tra bảng + nhánh i<p không bù được chi phí tra cứu, n nhỏ còn chậm hơn ở lần 1 → BÁC, không vá code. KHÔNG thử lại hướng cache hoán vị bit-reversal cho fft() (cùng lớp với cache twiddle 20:50 đã bác). Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_1839_B/. --- */
/* FIR đối xứng suy ra từ đáp tuyến EQ: magnitude → IFFT → window → truncate */
/* --- Mở rộng 2026-11-09 (vòng tự động 12:50, hướng B; thí nghiệm chuẩn bị ở vòng 12:18): tính đáp tuyến trực tiếp trong vòng bin của buildFirTaps thay vì gọi totalDbAt cho từng bin — cos/sin của một bin chỉ tính 1 lần cho mọi band (trước đây totalDbAt tính lại cos/sin cho từng band tại cùng 1 bin) và hệ số band chỉ tra cache 1 lần thay vì 2049 lần. Cùng công thức biquadMagDb, cùng thứ tự cộng band 0→n-1 rồi psycho, cùng cách xử lý f<10 (dùng 10 Hz). Lab Node trên hàm thật (lượt 12:50, chạy 2 lần): taps giống từng bit với bản gốc ở 10/20 band, phẳng, có band tắt và có psycho (maxDiff=0, nDiff=0, tổng taps bằng nhau tới chữ số cuối); tốc độ 102,6→35,9 ms (10 band), 196,8→68,2 ms (20 band), 24,1→5,1 ms (phẳng), 62,3→19,7 ms (có band tắt) — nhanh hơn 2,85–4,76×. Chỉ áp cho FIR, không chạm solver. Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng đồ thị/dựng FIR sau khi buildFirTaps nhanh hơn; hoặc hướng C — rà soát isoPhonFromSpl/loudFitError trên lưới phon. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 16:41, hướng B/D): hoist đáp tuyến
   psycho trong buildFirTaps — trước đây mỗi bin (2049) gọi psychoDbAt(fq,fs),
   mỗi lần gọi lại dựng chuỗi khóa cache psychoCoeffs rồi tính lại cos/sin
   cho 7 section (loud 6 + notch) qua biquadMagDb. Nay psychoCoeffs(fs) chỉ
   gọi MỘT lần mỗi lần dựng FIR (psyCs) và đáp tuyến psycho tính inline
   bằng đúng lượng giác cw/sw/cw2/sw2 của bin (cùng double như biquadMagDb
   tính lại: w=2π·fq/fs giống hệt), cùng biểu thức nr/ni/dr/di/mag/log10,
   cùng thứ tự cộng section 0..6 và cộng sau tổng band (ps rồi s+=ps, đúng
   như s+=psychoDbAt). Khi PSY bypass thì psyCs=null, đường đi không đổi.
   Lab Node trên hàm thật (lượt 16:41, chạy 2 lần, 8 fixture 10/20 band,
   phẳng, loud/notch/bypass, 48/44,1/96 kHz): taps giống từng bit (nDiff=0,
   tổng taps bằng nhau tới chữ số cuối) ở cả 8 fixture × 2 lần; số phép
   tính mỗi lần dựng (loud+notch): cos 17427→3084, sin 16404→2061,
   log10/sqrt/pow không đổi; tốc độ 52,2→33,2 ms (10 band loud+notch),
   70,7→53,8 ms (20 band loud+notch), 35,6→18,2 ms (phẳng loud+notch),
   49,5→41,1 ms (notch-only), 51,6→33,1 ms (@44,1k) — nhanh hơn
   1,20–1,96× khi psycho bật (lần 2: 1,20–1,96×); psy-bypass không đổi
   (18,2→18,3 ms). Không chạm solver/WASM/QA — FIR chỉ dựng taps chập,
   aeV1/aeV2/aeV3 không đổi theo cấu trúc. Ý tưởng lượt kế: hướng A — đo tỉ
   lệ thắng/chi phí từng nhánh đệ quy (anchored/dual/rcDual) trên kho rộng
   hơn; hoặc hướng D — đo lại tốc độ dựng FIR sau vá này. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 18:07, hướng D): bỏ Math.sqrt trong
   buildFirTaps — 20·log10(√(num/den)) = 10·log10(num/den) đúng trong số thực;
   kẹp tương đương (max(1e-9,mag) ↔ max(1e-18,num/denC), cùng cho -180 dB;
   num=0 vẫn -180 dB như cũ), áp cho cả vòng band và vòng psycho inline.
   Lab Node trên hàm thật, file thường (lượt 18:07, chạy 2 lần check + 2 lần
   time, 8 fixture 10/20 band, phẳng, loud/notch/bypass, 48/44,1/96 kHz):
   taps giống từng bit ở cả 8 fixture (nDiff=0, tổng taps bằng nhau tới chữ
   số cuối), kể cả 3 fixture stress ±15 dB, Q 0,1/30, L=2047/4095; tốc độ
   1,40→1,28 ms (10 band loud+notch), 2,10→1,87 ms (20 band loud+notch),
   0,86→0,81 ms (psy-bypass), 2,08→1,85 ms (@96k) — nhanh hơn 1,05–1,12×
   (lần 2: 1,05–1,15×), ổn định 8/8 fixture cả 2 lần. Ứng viên mảng hệ số
   phẳng (Float64Array) bị bác: chậm hơn 0,92–0,96× ở 7/8 fixture (chi phí
   cấp phát + kiểm tra biên vượt lợi ích tra thuộc tính). Không chạm solver/
   WASM/QA — FIR chỉ dựng taps chập, taps giống từng bit nên aeV1/aeV2/aeV3
   không đổi theo cấu trúc. Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng
   đồ thị (drawGraph) sau khi specDraw đã có LUT; hoặc hướng C — rà soát
   loudFitError trên lưới phon. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 19:13, hướng D): lượng giác truy hồi
   trong vòng bin của buildFirTaps — ÁP DỤNG, có cải thiện. fq = k·fs/N tăng
   đều theo k (trừ k=0 bị kẹp f<10→10 Hz và k≥2044 bị chặn 0,499·fs) nên góc
   w = 2π·fq/fs tăng đều một bước Δw = 2π/N: cw/sw tại k=1 tính trực tiếp
   cos/sin(Δw), các k=2..2043 suy bằng truy hồi góc đôi
   (cos/sin((k+1)Δw) từ cos/sin(kΔw) — cùng cách fft() trong file đã dùng
   cho twiddle), chỉ khi k∈[1,2043] và f≥10 (không bị kẹp/chặn); k=0 và
   k≥2044 tính trực tiếp như cũ. cw2/sw2 dùng đúng biểu thức cũ trên cw/sw
   mới. Lab Node trên hàm thật, file thường nối liền (lượt 19:13, chạy 4 lần,
   6 fixture 10/20 band, phẳng, loud/notch/bypass, 48/44,1/96 kHz,
   L=1023/2047/4095, 150 rep xen kẽ xoay thứ tự/fixture): taps lệch tối đa
   1,9e-12 tương đối so với đỉnh (44,1 kHz; 2,3e-13 ở 48 kHz, 0 ở 96 kHz và
   phẳng — do góc truy hồi lệch tích lũy ~1e-13 rad sau 2043 bước), tối đa
   23/4095 taps khác (toàn ở rìa cửa sổ Hann, lệch ~1 ulp float32), 0 NaN,
   tính đối xứng taps giữ nguyên; số lần gọi cos/sin trong vòng bin
   4098 → 2 (còn lại là vòng window + rbjCoeffs); profile: vòng bin ~1,23 ms
   trong tổng ~1,42 ms (fft 4096 ~0,15 ms, window ~0,04 ms). Tốc độ
   1,04–1,12× ở 5 fixture có band (tối thiểu 1,035× ở 20 band qua 4 lần chạy)
   và 1,24–1,26× ở phẳng (không còn log10, trig chiếm phần lớn); nhanh hơn ở
   6/6 fixture trong cả 4 lần chạy. Ứng viên P1 (Math.pow(10,s/20) →
   Math.exp(s·LN10/20)) BỊ BÁC dù taps giống từng bit ở cả 6 fixture: tỉ lệ
   đảo dấu giữa các lần chạy (lần 2: 0,974–0,997×, chậm hơn gốc ở cả 6
   fixture; lần 1: 1,015–1,123×) — cùng lớp lỗi như Math.log vòng 18:56, nên
   không áp P1/P12, chỉ áp P2. Không chạm solver/WASM/QA — FIR chỉ dựng taps
   chập, kiểm chứng QA FIR so chập phân vùng với chập trực tiếp trên cùng taps
   nên tự nhất quán; aeV1/aeV2/aeV3 không đổi theo cấu trúc. Ý tưởng lượt kế:
   hướng A — rà soát aeSolveSingle trên tai nghe thực tế trong DB; hoặc hướng
   D — đo lại tốc độ dựng đồ thị (drawGraph) sau khi buildFirTaps nhanh hơn. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:20, hướng B): đáp tuyến vòng bin
   của buildFirTaps tính bằng TÍCH TUYẾN TÍNH thay tổng log — ÁP DỤNG, có cải thiện.
   Đẳng thức thực: re[k] = 10^(Σ 10·log10(c_i)/20) = √(Π c_i), c_i = max(1e-18, num_i/den_i)
   (mỗi c_i = |H_i|² tại bin, kẹp đúng như cũ). Nay mỗi band/section psycho nhân vào lin
   thay vì cộng 10·log10, cuối bin chỉ 1 sqrt: log10 34.833 → 0, pow 2.066 → 0 (F1),
   sqrt 4 → 2.049 mỗi lần dựng; không chạm solver/WASM/QA — FIR chỉ dựng taps chập.
   Lab Node trên hàm thật (lượt 20:20, chạy 2 lần độc lập, 8 fixture lần 1 + F9 cực đoan
   20 band thêm ở lần 2; 10/20 band, phẳng/loud+notch/stress ±15 Q0.1/30, 44,1/48/96 kHz,
   L=1023/2047/4095, cực đoan F7/F8/F9 10–20 band 20 Hz Q30 ±15 @96k): taps GIỐNG TỪNG BIT
   ở mọi fixture cả 2 lần (maxRel 0, nDiff 0, 0 NaN, đối xứng giữ nguyên); P3a nhanh hơn
   gốc ở mọi fixture cả 2 lần:
   lần 1: 3,34–4,35× (F1 4,389→1,169 ms, F2 6,557→1,507 ms), lần 2: 2,89–3,57×
   (F1 3,344→1,092 ms, F2 4,907→1,376 ms); F3 phẳng chỉ 1,11–1,13× (không band hoạt động,
   chỉ bớt 2.049 pow). P3b (tích sqrt từng band) cũng giống từng bit nhưng chậm hơn P3a ở
   mọi fixture cả 2 lần (1,65–1,80× lần 1; 2,65–3,19× lần 2) nên không chọn.
   An toàn tràn: mỗi c_i = |H_i|² ≤ ~31,6 (+15 dB/band, kẹp gain ±30) nên tích ≤ ~10^40 với
   tối đa 27 section (20 band + 7 psycho), xa 1e308; F9 20 band cực đoan hữu hạn, taps giống
   từng bit. Underflow chỉ khi đáp tuyến < ~1e-308 (suy hao > 6.160 dB) — dưới ulp float32,
   không ảnh hưởng taps. Thời gian tuyệt đối lần này cao do máy tải nặng (lượt quét kho chạy
   song song ~96% CPU) — tỉ lệ đo xen kẽ xoay thứ tự vẫn ổn định cả 2 lần.
   Ý tưởng lượt kế: hướng B — truy hồi lượng giác trong vòng window Hann (2.047 lần Math.cos)
   hoặc đo lại profile 3 pha sau P3a; hoặc hướng D — đo measureFps/specDraw trên phổ thật. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:30, hướng B): truy hồi lượng giác
   trong vòng window Hann của buildFirTaps — ÁP DỤNG, có cải thiện. Góc cửa sổ
   θ = 2π·i2/(L-1) tăng đều một bước Δ = 2π/(L-1) nên cos/sin truy hồi từ
   (1,0) bằng phép quay (cùng cách vá truy hồi vòng bin 19:13): Math.cos
   trong vòng window 2.047 → 2 lần mỗi lần dựng (F1: tổng cos 2.084 → 21,
   còn lại là vòng bin + rbjCoeffs; chênh pow/sin giữa các lượt đếm chỉ do
   cache BAND_CC/PSY_CC đã nạp ở lượt base, không phải chênh lệch thật).
   Lab Node trên hàm thật (lượt 20:30, chạy 2 lần độc lập, 9 fixture như
   20:20, 10/20 band, phẳng, loud+notch, stress ±15 Q0.1/30, 44,1/48/96 kHz,
   L=1023/2047/4095, 100 rep xen kẽ xoay thứ tự): taps giống từng bit ở F3
   phẳng, còn lại lệch tối đa 1,8e-15 tương đối so với đỉnh (1–2 taps ở rìa
   cửa sổ, ~1 ulp float32 do win cuối ≈1e-15 thay vì đúng 0), 0 NaN, đối xứng
   giữ nguyên (≤1,0e-15); microbench vòng window riêng nhanh hơn 4,4–6,4×
   (L2047: 0,132→0,024 ms; L4095: 0,265→0,048 ms); dựng FIR đầy đủ nhanh hơn
   ở 9/9 fixture cả 2 lần: lần 1: 1,06–1,29× (F1 1,236→1,085 ms, F3
   0,731→0,584 ms, F5 L4095 1,342→1,039 ms), lần 2: 1,05–1,25×. W2 (W1 +
   idx tăng dần thay modulo) không nhanh hơn W1 chắc chắn ở lần nào nên
   không áp — modulo không đáng kể so với cos. Không chạm solver/WASM/QA —
   FIR chỉ dựng taps chập; aeV1/aeV2/aeV3 không đổi theo cấu trúc.
   Ý tưởng lượt kế: hướng D — đo measureFps/specDraw trên phổ thật; hoặc
   hướng B — đo lại profile 3 pha sau khi vòng window nhanh hơn. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:42, hướng B): đo lại profile 3 pha
   của buildFirTaps sau vá 20:20/20:30 + THỬ P4a (|H|^2 dạng đa thức cos) — BỊ BÁC,
   không áp vá code. Profile (lab Node trên hàm thật, 9 fixture, 150 rep xen kẽ
   xoay thứ tự, chạy 2 lần; taps bản profile giống từng bit với base ở cả 9 fixture):
   vòng bin 55–70% khi band hoạt động (F1 55%, F2 64–65%, F9 69–70%; phẳng F3 chỉ
   19–20%), FFT 25–39% (phẳng F3 58–61%), window Hann 1–3%, setup 1–13%
   (0,011–0,076 ms tuyệt đối); tổng dựng 0,53–1,35 ms tùy fixture.
   P4a: |b0+b1 z^-1+b2 z^-2|^2 = K0+K1 cos w+K2 cos 2w, mẫu số D0+D1 cos w+D2 cos 2w,
   K/D tính 1 lần/band+section ở setup — vòng bin 12 nhân+6 cộng → 4 nhân+4 cộng+1 chia.
   Tốc độ chỉ 1,04–1,10× ở lần 1 và KHÔNG ổn định (lần 2: F1 0,92×, F3 1,01×).
   Sai số: taps lệch tới 9,3e-6 tương đối (F9 cực đoan), 3,1e-6 (F7), 1,5e-8 (F2),
   3,8e-9 (F1); taps float32 (dạng worklet nhận) khác ở ~99% taps ngay cả fixture
   thường (tuyệt đối ≤1,5e-8; F7/F9 tới 1,0e-4/3,0e-4). Nguyên nhân: triệt tiêu thảm
   khốc — peaking 20 Hz Q30 +15 @96k có điểm notch sâu (num≈1,9e-14, den≈9,5e-16
   tại f≈20,1 Hz) làm |H|^2 dạng cos-poly sai tương đối tới vô cùng, trong khi công
   thức trực tiếp (tổng bình phương, luôn ≥0) giữ đúng. Không đạt chuẩn taps gần
   như giống từng bit của dự án (≤1,8e-15 như vòng 20:30) nên bác, KHÔNG áp.
   Ý tưởng lượt kế: hướng B — cache bảng twiddle cho fft() (pha FFT chiếm 25–61%
   tổng dựng); hoặc hướng D — đo measureFps/drawGraph trên phổ thật. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 22:27, hướng B): THỬ P5 (|H|^2 dạng đa
   thức cos LAI GHÉP + rơi về công thức trực tiếp) — BỊ BÁC, không áp vá code.
   P4a (20:42) dùng cos-poly thuần bị triệt tiêu thảm khốc ở notch sâu; P5 giữ
   poly (num=N0+N1*cw+N2*cw2, den=D0+D1*cw+D2*cw2, hệ số tính 1 lần/band+section
   ở setup, mảng phẳng Float64Array) NHƯNG nếu num<1e-2*N0 hoặc den<1e-2*D0 thì
   tính lại bằng công thức trực tiếp (tổng bình phương, giống từng bit với base).
   Chặn sai số: |sai poly| ~vài ulp của hạng tử <=~2*N0 nên với num>=1e-2*N0 sai
   tương đối <=~2e-13, dưới ulp float32 ~5 bậc.
   Lab Node trên hàm thật (lượt 22:27, chạy 2 lần độc lập, 9 fixture như 20:20/
   20:30, 100 rep xen kẽ xoay thứ tự): CHÍNH XÁC ĐẠT — taps Float32Array GIỐNG
   HỆT ở cả 9 fixture cả 2 lần (maxRel=0, nDiff=0, 0 NaN; đối xứng giữ nguyên,
   vd F1 1,78e-15 cả hai). Nhưng TỐC ĐỘ THUA ỔN ĐỊNH ở 9/9 fixture cả 2 lần:
   lần 1: 0,73–0,97× (F1 0,397→0,488 ms; F2 0,479→0,651 ms; F9 0,467→0,639 ms),
   lần 2: 0,74–0,98× (F1 0,498→0,587 ms; F2 0,478→0,651 ms; F9 0,474→0,641 ms);
   cả F3 phẳng (không band, không psycho, fallback=0) cũng chậm hơn 0,97–0,98×.
   Chẩn đoán: (a) nạp mảng phẳng `_np[6*i+...]` + số học chỉ số tốn hơn nạp
   thuộc tính đơn hình `c.b0` của V8 — cùng lớp với twiddle-cache (20:50) và
   mảng hệ số phẳng (18:07) từng bị bác; (b) 2 so sánh/nhánh thêm mỗi band-bin;
   (c) fallback chạm NHIỀU hơn ước tính — 7.726–16.592 lần/dựng (~22–35% lượt
   đánh giá section), tức công thức trực tiếp vẫn phải trả thêm trên diện rộng;
   (d) 4 lần cấp phát Float64Array ở setup đã tốn ~8 µs ngay cả khi phẳng.
   Kết luận: chi phí mỗi band-bin nằm ở nạp dữ liệu/nhánh/chia, không phải số
   phép nhân — đa thức cos không cứu được trên V8. KHÔNG thử lại mọi biến thể
   cos-poly cho buildFirTaps (P4a thuần + P5 lai đều bị bác).
   NHÁNH B TẠM DỪNG sau 3 lượt không vá liên tiếp (20:42 P4a, 20:50 twiddle,
   22:27 P5) — chuyển sang nhánh C/D. Không chạm solver/WASM/FIR/QA.
   Ý tưởng lượt kế: hướng C — rà soát isoPhonFromSpl trên lưới phon (ý tưởng
   treo từ 13:08/20:19); hoặc hướng D — đo measureFps/specDraw trên phổ thật. --- */
/* (vòng tự động 18:54, hướng B — ÁP DỤNG, vá code): kẹp mẫu số/tỉ lệ trong vòng bin của buildFirTaps bằng Math.max thay cho ternary + kiểm tra NaN — _den>1e-24?_den:(_den===_den?1e-24:NaN) tương đương Math.max(1e-24,_den) và _r>1e-18?_r:(_r===_r?1e-18:NaN) tương đương Math.max(1e-18,_r) trên mọi double (kể cả NaN/±Infinity/-0/subnormal, kiểm chứng scalar + parity 301/301 trên buildFirTaps thật), áp cho cả vòng band và vòng psycho; thứ tự tính nr/ni/dr/di và phép nhân lin giữ nguyên từng toán hạng nên taps GIỐNG TỪNG BIT theo cấu trúc. Khác hướng đã bác: hoist fs/N (14:54, lệch bit ở fs cực đoan + nhiễu bench) — lượt này không đổi cách tính tần số bin, chỉ đổi dạng kẹp đã tương đương toán học. Lab: hidden_files/run_20261124_1854_B/. */
function buildFirTaps(fs, L){
  var N=4096, re=new Float64Array(N), im=new Float64Array(N), k, f, i;
  var nB=bands.length, cc=new Array(nB), act=new Array(nB);
  for (i=0;i<nB;i++){ act[i]=bands[i].on && bands[i].gain!==0; cc[i]=act[i]?bandCoeffs(i,fs):null; }
  var hasPsy=(typeof PSY!=="undefined" && PSY && !PSY.bypassAll && typeof psychoDbAt==="function");
  var psyCs = hasPsy ? psychoCoeffs(fs) : null; /* hoist: 1 lan/goi thay vi 2049 lan trong psychoDbAt */
  /* (vong tu dong 04:24, huong B): loc san mang he so dang hoat dong MOT lan truoc vong k (2049 diem) — actCc/psyAct giu nguyen thu tu band/section goc nen day nhan lin giong tung bit; vong trong khong con kiem tra act[i]/PSY_ID va doc cc[i] theo chi so thưa. */
  var actCc=[], _ai;
  for (_ai=0;_ai<nB;_ai++) if (act[_ai]) actCc.push(cc[_ai]);
  var psyAct=null;
  if (hasPsy){ psyAct=[]; for (var _pi=0;_pi<psyCs.length;_pi++) if (psyCs[_pi]!==PSY_ID) psyAct.push(psyCs[_pi]); }
  /* (vong tu dong 08:24, huong B): phang hoa he so thanh 5 mang so song song MOT lan truoc vong k — vong trong doc actB0[i]/... va psyB0[pi]/... (so thuan) thay vi nap 5 thuoc tinh object c.b0..a2 moi diem luoi x moi band; gia tri sao chep nguyen ven (number) va bieu thuc nr/ni/dr/di + thu tu nhan lin giu nguyen tung ky tu nen giong tung bit. actCc/psyAct giu nguyen cho tuong thich. */
  var actB0=[],actB1=[],actB2=[],actA1=[],actA2=[],_fi,_fc;
  for(_fi=0;_fi<actCc.length;_fi++){ _fc=actCc[_fi]; actB0.push(_fc.b0); actB1.push(_fc.b1); actB2.push(_fc.b2); actA1.push(_fc.a1); actA2.push(_fc.a2); }
  var psyB0=null,psyB1=null,psyB2=null,psyA1=null,psyA2=null;
  if (hasPsy){ psyB0=[];psyB1=[];psyB2=[];psyA1=[];psyA2=[]; for(_fi=0;_fi<psyAct.length;_fi++){ _fc=psyAct[_fi]; psyB0.push(_fc.b0); psyB1.push(_fc.b1); psyB2.push(_fc.b2); psyA1.push(_fc.a1); psyA2.push(_fc.a2); } }
  var _dw = 2*Math.PI/N, _cdw = Math.cos(_dw), _sdw = Math.sin(_dw);
  var _rcw = 0, _rsw = 0;
  var _fCap = fs*0.499;
  for(k=0;k<=N/2;k++){
    var _fRaw = k*fs/N;
    f = (_fRaw <= _fCap || _fRaw !== _fRaw) ? _fRaw : _fCap;
    var fq=(f<10)?10:f;
    var cw, sw;
    if (k >= 1 && k <= 2043 && f >= 10){
      if (k === 1){ cw = Math.cos(_dw); sw = Math.sin(_dw); }
      else { var _ncw = _rcw*_cdw - _rsw*_sdw; sw = _rsw*_cdw + _rcw*_sdw; cw = _ncw; }
      _rcw = cw; _rsw = sw;
    } else { var w=2*Math.PI*fq/fs; cw=Math.cos(w); sw=Math.sin(w); _rcw=cw; _rsw=sw; }
    var cw2=2*cw*cw-1, sw2=2*sw*cw, lin=1; /* P3a 20:20: tich tuyen tinh thay tong log — 10^(S 10*log10(c)/20) = sqrt(Pi c) */
    for (i=0;i<actCc.length;i++){
      var nr=actB0[i]+actB1[i]*cw+actB2[i]*cw2, ni=-(actB1[i]*sw+actB2[i]*sw2);
      var dr=1+actA1[i]*cw+actA2[i]*cw2, di=-(actA1[i]*sw+actA2[i]*sw2);
      var _num=nr*nr+ni*ni, _den=dr*dr+di*di; var _denC=Math.max(1e-24,_den); var _r=_num/_denC; lin*=Math.max(1e-18,_r);
    }
    if(hasPsy){
      for(var pi=0;pi<psyAct.length;pi++){
          var pnr=psyB0[pi]+psyB1[pi]*cw+psyB2[pi]*cw2, pni=-(psyB1[pi]*sw+psyB2[pi]*sw2);
          var pdr=1+psyA1[pi]*cw+psyA2[pi]*cw2, pdi=-(psyA1[pi]*sw+psyA2[pi]*sw2);
          var _pnum=pnr*pnr+pni*pni, _pden=pdr*pdr+pdi*pdi; var _pdenC=Math.max(1e-24,_pden); var _pr=_pnum/_pdenC; lin*=Math.max(1e-18,_pr);
      }
    }
    re[k]=Math.sqrt(lin); im[k]=0;
    if(k>0 && k<N/2){ re[N-k]=re[k]; im[N-k]=0; }
  }
  fft(re, im, true);
  var taps=new Float32Array(L), half=(L-1)/2;
  var _wd=2*Math.PI/(L-1), _cwd=Math.cos(_wd), _swd=Math.sin(_wd), _wcw=1, _wsw=0;
  for(var i2=0;i2<L;i2++){
    var idx=((i2-half)%N+N)%N;
    var win=0.5-0.5*_wcw; /* Hann, truy hoi luong giac 20:30 */
    taps[i2]=re[idx]*win;
    var _nwc=_wcw*_cwd-_wsw*_swd; _wsw=_wsw*_cwd+_wcw*_swd; _wcw=_nwc;
  }
  return taps;
}
/* --- Mở rộng 2026-11-23 (vòng tự động 20:07, hướng B — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm B (sau A 19:59, BÁC BỎ). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 20:00:27+07, 6.246.159 byte / 25.322 dòng, md5 d0b8338e6c23eaf691cc205a7ce18771, version 305) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-B lưu tại ~/workspace/autoeq/backups/*2026-11-23_2004*. Ứng viên B duy nhất: gộp vòng band+psycho trong buildFirTaps thành MỘT vòng duy nhất trên mảng hệ số phẳng nối tiếp (allB0..allA2 = actB.. nối tiếp psyB.., khi không có psycho tham chiếu thẳng actB..) — vòng trong k chỉ còn một vòng lặp thay vì vòng band + nhánh/vòng psycho, mỗi phần tử vẫn tính đúng biểu thức nr/ni/dr/di + kẹp _denC/_r + lin*= như cũ nên thứ tự nhân lin và mọi double giống hệt theo cấu trúc. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261123_2004_B/, 2 lần bench độc lập): parity 22/22 scenario GIỐNG TỪNG BIT cả 2 lần (so sánh Buffer taps; gồm 10/20 band, +psycho 7, bypass, 0 band, band tắt/gain 0, cực đoan NaN/±Inf/-0/subnormal/1e308, fs 8000/44100/48000/96000/192000/0/NaN/Inf, L 0/1/2/255/511/1023/4097, null coeff ném TypeError đúng loại cũ); tốc độ paired-median xen kẽ 15 vòng trên buildFirTaps 20 band + psycho, L=1023: lần 1 median 0,9311x thắng 0/15, lần 2 median 0,9308x thắng 3/15 — bản mới CHẬM HƠN ổn định cả 2 lần (chi phí concat mảng phẳng + vòng dài hơn không bù được việc bỏ một vòng lặp, ngược với mô phỏng vòng cô lập) → BÁC, không vá code. Không thử lại hướng gộp vòng band+psycho trong buildFirTaps. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm C. Lab: hidden_files/run_20261123_2004_B/. --- */

/* ================================================================
   MÃ NGUỒN AUDIOWORKLET — hiển thị cho người dùng xem & chạy thật
   ================================================================ */
var WORKLET_SRC = `
"use strict";
/* Web AutoEQ DSP Processor — Giai đoạn 1
   - IIR Minimum Phase: cascade 10 hoặc 20 biquad RBJ (theo chế độ số band
     của engine — bộ nhớ đệm tự đổi kích thước khi nhận bộ hệ số khác độ dài),
     Direct Form II Transposed, biến trạng thái float64 (JS number).
   - Giai đoạn 4: hệ số biquad đích được nội suy mượt theo block (lerp
     0.35/block về phía coeffsSm) và pre-amp/trim ramp 0.30/block (~8 ms):
     kéo node, đổi hệ số hay chuyển slot A/B/X đều không gây click.
   - FIR Linear Phase: Partitioned FFT Convolution (Overlap-Add) với FIR
     đối xứng, group delay = (N-1)/2 samples, hằng số: block 128 mẫu,
     FFT 256, phổ từng partition tính sẵn khi nhận taps mới; chập trực
     tiếp chỉ còn là đường dự phòng khi render quantum khác 128 mẫu.
   - Pre-amp + Look-ahead Brickwall True-Peak limiter: ước lượng đỉnh
     liên mẫu bằng nội suy windowed-sinc x16 (Blackman, hỗ trợ ±16 mẫu),
     lookahead 128 samples, envelope mượt (lookahead 111 mẫu, dốc tối đa
     0.005 dB/mẫu, release 0.0002/mẫu) luôn kẹp bởi đích của chính mẫu ra,
     trần -1.0 dBTP, linked stereo. */
var CEIL = Math.pow(10, -1.0/20);
var LA = 128; /* lookahead samples (brickwall TP limiter) */
/* Dốc gain tối đa của envelope limiter: +0.005 dB/mẫu (≈ 0.24 dB/ms ở
   48 kHz). aEnv = min(c[o+k]*R^k) đã tự giới hạn dốc theo cấu trúc (min
   trượt chiết khấu), nên nhánh hạ KHÔNG giới hạn dốc thêm: giới hạn phụ
   (max(aEnv, gr/R)) từng ngăn gain hạ kịp về aEnv trước đỉnh, gây bước
   nhảy gain ngay tại mẫu đỉnh (xem diag2). */
var LIM_SLOPE = Math.pow(10, 0.005/20);
/* Bảng hệ số nội suy windowed-sinc x16 cho bộ ước lượng true-peak:
   tpCoef[p][back], p = 0..15 (điểm con p/16 trong khoảng), back = 0..33
   (mẫu cách hiện tại back mẫu); hệ số tại khoảng kết thúc ở mẫu k là
   sinc(d)*Blackman(d/16) với d = back-17+p/16. Hai đầu bảng bằng 0 do
   cửa sổ Blackman triệt tiêu tại |d| = 16, giữ lại cho chỉ số đơn giản. */
function limCoefTable(){
  var tab=[], p, b, d, sinc, u, w;
  for (p=0;p<16;p++){
    var row=[];
    for (b=0;b<=33;b++){
      d=b-17+p/16;
      sinc=(d===0)?1:Math.sin(Math.PI*d)/(Math.PI*d);
      u=d/16;
      w=(Math.abs(u)>=1)?0:(0.42-0.5*Math.cos(Math.PI*(u+1))+0.08*Math.cos(2*Math.PI*(u+1)));
      row.push(sinc*w);
    }
    tab.push(row);
  }
  return tab;
}

class AutoEqProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.mode = "iir";
    this.bypass = false;
    this.limiterOn = true;
    this.preampLin = 1;
    this.nb = 10; /* số band PEQ hiện hành: 10 hoặc 20, theo bộ hệ số main thread gửi */
    this.coeffs = [];
    for (var i=0;i<this.nb;i++) this.coeffs.push({b0:1,b1:0,b2:0,a1:0,a2:0});
    /* hệ số đang áp thực tế (được nội suy mượt về phía this.coeffs mỗi block) */
    this.coeffsSm = [];
    for (var i2=0;i2<this.nb;i2++) this.coeffsSm.push({b0:1,b1:0,b2:0,a1:0,a2:0});
    this.coeffsR = null; /* L/R doc lap (Nhom 4 v2): bo he so kenh phai; null = lien ket */
    this.msOn = false; /* Mid/Side doc lap (2026-11-06): true = ma hoa L/R thanh M/S truoc tang IIR roi giai ma lai sau tang loc */
    this.coeffsSmR = [];
    for (var i3=0;i3<this.nb;i3++) this.coeffsSmR.push({b0:1,b1:0,b2:0,a1:0,a2:0});
    this.effCoeffsL = null; this.effCoeffsR = null;
    this.preampSm = 1;
    /* trim loudness của slot A/B/X (Giai đoạn 4): áp cho MỌI đường tín hiệu
       (kể cả bypass) sau tầng EQ, ramp mượt như pre-amp */
    this.slotLin = 1; this.slotSm = 1;
    /* trạng thái DF-II Transposed: 2 kênh x số band hiện hành x (s1,s2) — float64 */
    this.s1 = []; this.s2 = [];
    for (var c=0;c<2;c++){ this.s1.push(new Float64Array(this.nb)); this.s2.push(new Float64Array(this.nb)); }
    /* FIR: chập trực tiếp (dự phòng) + Partitioned FFT Convolution (chính) */
    this.fir = null; this.firBuf = null; this.firPos = 0;
    this.firPart = null; /* {nPart, specR, specI, tailL, tailR} — phổ từng partition, FFT 256 */
    /* limiter: delay line lookahead 128 mẫu + vòng đích gain brickwall */
    this.dlyL = new Float64Array(LA); this.dlyR = new Float64Array(LA);
    this.dlyPos = 0;
    this.tgt = new Float64Array(LA); /* đích gain của từng mẫu trong delay line */
    for (var d=0;d<LA;d++) this.tgt[d]=1;
    /* lịch sử true-peak: vòng 64 mẫu/kênh (đủ cho trễ ước lượng 16 mẫu) */
    this.tpBuf = [new Float64Array(64), new Float64Array(64)];
    this.tpPos = 0; this.tpCount = 0;
    this.tpCoef = limCoefTable();
    /* envelope limiter mượt: vòng đích khoảng c[m] = min(tgt[m], tgt[m+1])
       (256 ô, đủ cho cửa sổ lookahead 111 mẫu + trễ 128 mẫu), bảng lũy thừa
       dốc R^k, và bộ đếm mẫu ra để tra đúng cửa sổ của mẫu sắp ra. */
    this.cRing = new Float64Array(256);
    for (var cr=0;cr<256;cr++) this.cRing[cr]=1;
    this.rPow = new Float64Array(112); this.rPow[0]=1;
    for (var rp=1;rp<112;rp++) this.rPow[rp]=this.rPow[rp-1]*LIM_SLOPE;
    this.outCount = 0;
    this.gr = 1;            /* gain reduction hiện tại (linear) */
    this.peakIn = 0; this.peakOut = 0; this.tp = 0; this.grDb = 0;
    this.frame = 0;
    /* --- Giai đoạn 3: Psychoacoustics ---
       xcoeffs: [6 section loudness (LS90/P200/P600/P1500/P4000/HS9000) + notch cá nhân] */
    this.xcoeffs = [];
    for (var xi=0;xi<7;xi++) this.xcoeffs.push({b0:1,b1:0,b2:0,a1:0,a2:0});
    this.xs1 = []; this.xs2 = [];
    for (var xc=0;xc<2;xc++){ this.xs1.push(new Float64Array(7)); this.xs2.push(new Float64Array(7)); }
    /* crossfeed: delay line 256 mẫu/kênh + thông thấp 1 cực cho kênh chéo */
    this.xfOn = false; this.xfMix = 0; this.xfItd = 14; this.xfLpA = 0.57;
    this.xfBufL = new Float64Array(256); this.xfBufR = new Float64Array(256);
    this.xfPos = 0; this.xfLpL = 0; this.xfLpR = 0;
    /* dynamic EQ: detector sidechain doc lap + envelope theo block (peak/RMS).
       dynOff/dynLvl: offset va muc detector cua block gan nhat, gui ve main
       thread qua dynMeter de ve duong bao realtime len do thi chinh. */
    this.dyn = null; this.detCoeffs = null;
    this.dynEnv = new Float64Array(this.nb);
    this.detS1 = new Float64Array(this.nb); this.detS2 = new Float64Array(this.nb);
    this.dynOff = new Float64Array(this.nb);
    this.dynLvl = new Float64Array(this.nb);
    for (var di0=0;di0<this.nb;di0++) this.dynLvl[di0] = -120;
    this.effCoeffs = null;
    var self = this;
    this.port.onmessage = function(e){
      var m = e.data;
      if (m.type === "coeffs"){ if (m.coeffs.length !== self.nb) self.setNb(m.coeffs.length); self.coeffs = m.coeffs; self.coeffsR = (m.coeffsR && m.coeffsR.length===m.coeffs.length) ? m.coeffsR : null; if (!self.coeffsR) { self.effCoeffsL = null; self.effCoeffsR = null; } }
      else if (m.type === "xcoeffs"){ if (Array.isArray(m.coeffs) && m.coeffs.length===self.xcoeffs.length){ for (var xi=0;xi<m.coeffs.length;xi++){ var nc=m.coeffs[xi]; if (nc && isFinite(nc.b0) && isFinite(nc.b1) && isFinite(nc.b2) && isFinite(nc.a1) && isFinite(nc.a2)) self.xcoeffs[xi]=nc; } } } /* Pha C 2026-11-05: giu section cu khi he so xau — 1 section NaN lam cam toan bo ra (lab 1402: H/I rms 0.0000), giong guard crossfeed 13:44 */
      else if (m.type === "fir"){ var clTaps=[]; for (var ti=0;ti<m.taps.length;ti++){ var tv=m.taps[ti]; clTaps.push((!isFinite(tv)||Math.abs(tv)<1e-30)?0:tv); } self.fir = clTaps; self.firBuf = [new Float64Array(clTaps.length), new Float64Array(clTaps.length)]; self.firPos = 0; self.firPart = self.buildFirPartitions(clTaps); } /* Pha C 2026-11-05: ve sinh taps o day (giong buildFirPartitions) de duong chap truc tiep khong cam khi tap xau */
      else if (m.type === "config"){
        self.mode = m.mode; self.bypass = m.bypass;
        self.limiterOn = m.limiterOn; self.preampLin = m.preampLin;
        if (typeof m.msOn === "boolean") self.msOn = m.msOn; /* Mid/Side (2026-11-06): chi nhan boolean; khong phai boolean/gui thieu thi giu gia tri cu (giong guard crossfeed/dyn o bien message, Pha C) */
        if (m.slotLin !== undefined) self.slotLin = m.slotLin;
        if (m.crossfeed){ self.xfOn = m.crossfeed.on; var cfMix=m.crossfeed.mix; if (isFinite(cfMix)) self.xfMix=Math.min(1,Math.max(0,cfMix)); var cfItd=m.crossfeed.itd; if (isFinite(cfItd)) self.xfItd=Math.min(255,Math.max(1,Math.round(cfItd))); var cfLpA=m.crossfeed.lpA; if (isFinite(cfLpA)&&cfLpA>0&&cfLpA<1) self.xfLpA=cfLpA; } /* Pha C 2026-11-05: kep tham so crossfeed, giu gia tri cu khi khong hop le (itd [1,255], lpA (0,1), mix [0,1]) */
        if (m.dyn !== undefined){ var clDyn=null; if (m.dyn && Array.isArray(m.dyn.list)){ var clL=[], clD=[], anyD=false; for (var di=0;di<m.dyn.list.length;di++){ var de=m.dyn.list[di], dd=(m.dyn.det&&m.dyn.det[di])||null, okD=false; if (de && de.on && dd && isFinite(de.thr) && isFinite(de.ratio) && isFinite(de.range) && isFinite(de.attack) && isFinite(de.release) && isFinite(de.freq) && de.freq>=10 && de.freq<=22000 && isFinite(de.q) && de.q>0 && de.q<=30 && isFinite(de.gain) && isFinite(dd.b0) && isFinite(dd.b1) && isFinite(dd.b2) && isFinite(dd.a1) && isFinite(dd.a2)){ okD=true; if (de.fL!==undefined && (!isFinite(de.fL)||de.fL<10||de.fL>22000)) okD=false; if (de.fR!==undefined && (!isFinite(de.fR)||de.fR<10||de.fR>22000)) okD=false; if (de.qL!==undefined && (!isFinite(de.qL)||de.qL<=0||de.qL>30)) okD=false; if (de.qR!==undefined && (!isFinite(de.qR)||de.qR<=0||de.qR>30)) okD=false; if (de.gL!==undefined && !isFinite(de.gL)) okD=false; if (de.gR!==undefined && !isFinite(de.gR)) okD=false; } if (okD){ clL.push(de); clD.push(dd); anyD=true; } else { clL.push(null); clD.push(null); } } if (anyD) clDyn={list:clL, det:clD}; } self.dyn = clDyn ? clDyn.list : null; self.detCoeffs = clDyn ? clDyn.det : null; if (!self.dyn) { self.effCoeffs = null; self.effCoeffsL = null; self.effCoeffsR = null; } } /* Pha C 2026-11-05: ve sinh dyn o bien message — 1 band xau (thr/ratio NaN, q=0) lam cam toan bo ra (lab 1402: B/D/E/J rms 0.0000); band xau tat dyn (ve EQ tinh), band tot giu nguyen; det xau cung tat band do */
      }
    };
  }
  /* Đổi số band (10 <-> 20): dựng lại toàn bộ đệm theo band ở trạng thái
     phẳng (hệ số đồng nhất, trạng thái 0) — bộ hệ số thật được main thread
     gửi ngay sau đó; không giữ trạng thái lọc cũ vì ánh xạ band đã khác. */
  setNb(n){
    this.nb = n;
    this.coeffs = []; this.coeffsSm = []; this.coeffsR = null; this.coeffsSmR = [];
    for (var i=0;i<n;i++){ this.coeffs.push({b0:1,b1:0,b2:0,a1:0,a2:0}); this.coeffsSm.push({b0:1,b1:0,b2:0,a1:0,a2:0}); this.coeffsSmR.push({b0:1,b1:0,b2:0,a1:0,a2:0}); }
    this.s1 = []; this.s2 = [];
    for (var c=0;c<2;c++){ this.s1.push(new Float64Array(n)); this.s2.push(new Float64Array(n)); }
    this.dynEnv = new Float64Array(n); this.detS1 = new Float64Array(n); this.detS2 = new Float64Array(n);
    this.dynOff = new Float64Array(n); this.dynLvl = new Float64Array(n);
    for (var di1=0;di1<n;di1++) this.dynLvl[di1] = -120;
    this.effCoeffs = null; this.effCoeffsL = null; this.effCoeffsR = null;
  }
  /* Mẫu cách hiện tại 'back' mẫu trong vòng lịch sử true-peak (trước khi
     vòng quay đủ 64 mẫu, các ô chưa ghi vẫn là 0 = tín hiệu trước điểm bắt
     đầu — đúng với delay line khởi tạo 0 của limiter). */
  tpSample(ch, back){
    return this.tpBuf[ch][(this.tpPos-1-back+128)%64];
  }
  /* True-peak (linked stereo) của khoảng kết thúc tại mẫu n-16: 16 điểm con
     windowed-sinc + đỉnh của 2 mẫu kề khoảng (back 17 = mẫu k-1, back 16 =
     mẫu k). Chỉ gọi khi đã có ít nhất 17 mẫu (tpCount>=17) để khoảng k>=0. */
  tpInterval(){
    var tp=0, p, b, vL, vR, cf, c, aL, aR;
    for (p=0;p<16;p++){
      vL=0; vR=0; cf=this.tpCoef[p];
      for (b=0;b<=33;b++){
        c=cf[b];
        if (c!==0){ vL+=c*this.tpSample(0,b); vR+=c*this.tpSample(1,b); }
      }
      aL=Math.abs(vL); aR=Math.abs(vR);
      if (aL>tp) tp=aL; if (aR>tp) tp=aR;
    }
    var s0=Math.abs(this.tpSample(0,17)), s1=Math.abs(this.tpSample(1,17));
    var s2=Math.abs(this.tpSample(0,16)), s3=Math.abs(this.tpSample(1,16));
    if (s0>tp) tp=s0; if (s1>tp) tp=s1; if (s2>tp) tp=s2; if (s3>tp) tp=s3;
    return tp;
  }
  rbjW(type, freq, gainDb, Q){
    var fs = sampleRate;
    var A = Math.pow(10, gainDb/40);
    var w0 = 2*Math.PI*freq/fs, cw = Math.cos(w0), sw = Math.sin(w0);
    var alpha = sw/(2*Q), b0,b1,b2,a0,a1,a2;
    if (type==="peaking"){
      b0=1+alpha*A; b1=-2*cw; b2=1-alpha*A; a0=1+alpha/A; a1=-2*cw; a2=1-alpha/A;
    } else if (type==="lowshelf"){
      var s=2*Math.sqrt(A)*alpha;
      b0=A*((A+1)-(A-1)*cw+s); b1=2*A*((A-1)-(A+1)*cw); b2=A*((A+1)-(A-1)*cw-s);
      a0=(A+1)+(A-1)*cw+s; a1=-2*((A-1)+(A+1)*cw); a2=(A+1)+(A-1)*cw-s;
    } else {
      var s2=2*Math.sqrt(A)*alpha;
      b0=A*((A+1)+(A-1)*cw+s2); b1=-2*A*((A-1)+(A+1)*cw); b2=A*((A+1)+(A-1)*cw-s2);
      a0=(A+1)-(A-1)*cw+s2; a1=2*((A-1)-(A+1)*cw); a2=(A+1)-(A-1)*cw-s2;
    }
    return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
  }
  dynCurveW(levelDb, cfg){
    if (levelDb <= cfg.thr) return 0;
    var amt = (levelDb - cfg.thr) * (1 - 1/Math.max(1, cfg.ratio));
    var cap = Math.abs(cfg.range);
    if (amt > cap) amt = cap;
    return cfg.range < 0 ? -amt : amt;
  }
  updateDyn(input, frames){
    if (!this.dyn || !this.detCoeffs){
      this.effCoeffs = null; this.effCoeffsL = null; this.effCoeffsR = null;
      for (var z=0;z<this.nb;z++){ this.dynOff[z]=0; this.dynLvl[z]=-120; }
      return;
    }
    var inL = input[0], inR = input.length>1 ? input[1] : input[0];
    var any = false, eff = this.coeffsSm.slice(), effR = (this.coeffsSmR || this.coeffsSm).slice();
    var blockSec = frames/sampleRate;
    for (var b=0;b<this.nb;b++){
      var cfg = this.dyn[b], dc = this.detCoeffs[b];
      if (!cfg || !cfg.on || !dc){ this.dynOff[b]=0; this.dynLvl[b]=-120; continue; }
      any = true;
      var s1 = this.detS1[b], s2 = this.detS2[b], peak = 0, sumSq = 0;
      for (var n=0;n<frames;n++){
        var mono = (inL[n]+inR[n])*0.5;
        if (!isFinite(mono)) mono = 0;
        var y = dc.b0*mono + s1;
        if (!isFinite(y)) y = 0;
        s1 = dc.b1*mono - dc.a1*y + s2;
        s2 = dc.b2*mono - dc.a2*y;
        if (!isFinite(s1)) s1 = 0;
        if (!isFinite(s2)) s2 = 0;
        var ay = Math.abs(y); if (ay>peak) peak = ay;
        sumSq += y*y;
      }
      this.detS1[b]=s1; this.detS2[b]=s2;
      /* RMS: RMS theo block 128 mau roi moi qua envelope attack/release --
         cung hang so thoi gian voi Peak, chi khac dai luong do. Peak giu
         nguyen hanh vi cu (blkLvl = peak cua block). */
      var blkLvl = (cfg.det === "rms" && frames > 0) ? Math.sqrt(sumSq/frames) : peak;
      if (!isFinite(blkLvl)) blkLvl = 0;
      var tau = (blkLvl > this.dynEnv[b] ? cfg.attack : cfg.release)/1000;
      var coef = 1 - Math.exp(-blockSec/Math.max(0.001, tau));
      this.dynEnv[b] += (blkLvl - this.dynEnv[b])*coef;
      if (!isFinite(this.dynEnv[b]) || this.dynEnv[b] < 0) this.dynEnv[b] = 0;
      if (this.dynEnv[b] < 1e-12) this.dynEnv[b] = 0; /* triet denormal */
      var lvl = 20*Math.log10(Math.max(1e-6, this.dynEnv[b]));
      var off = this.dynCurveW(lvl, cfg);
      this.dynOff[b] = off; this.dynLvl[b] = lvl;
      if (cfg.gL !== undefined && cfg.gR !== undefined){
        var egL = Math.max(-12, Math.min(12, cfg.gL + off));
        var egR = Math.max(-12, Math.min(12, cfg.gR + off));
        eff[b] = this.rbjW(cfg.tL || cfg.type, cfg.fL || cfg.freq, egL, cfg.qL || cfg.q);
        effR[b] = this.rbjW(cfg.tR || cfg.type, cfg.fR || cfg.freq, egR, cfg.qR || cfg.q);
      } else {
        var eg = Math.max(-12, Math.min(12, cfg.gain + off));
        eff[b] = this.rbjW(cfg.type, cfg.freq, eg, cfg.q);
        effR[b] = eff[b];
      }
    }
    this.effCoeffs = any ? eff : null;
    this.effCoeffsL = any ? eff : null;
    this.effCoeffsR = any ? effR : null;
  }
  processIIR(input, output, frames){
    var inL=input[0], inR=input.length>1?input[1]:input[0];
    var outL=output[0], outR=output.length>1?output[1]:output[0];
    /* ---- Mid/Side doc lap (2026-11-06): ma hoa L/R thanh M/S truoc tang
       loc biquad (M=(L+R)/2, S=(L-R)/2), cascade M tren kenh 0 voi he so
       Mid (coeffsSm/effCoeffsL) va S tren kenh 1 voi he so Side
       (coeffsSmR/effCoeffsR), roi giai ma lai thanh L/R (L=M+S, R=M-S)
       TRUOC tang psycho — psycho, Dynamic EQ (detector doc tren mono L/R
       o updateDyn), crossfeed va limiter deu thay lai L/R binh thuong.
       Khi msOn=false nhanh nay khong chay nen duong mau giong het ban goc. */
    if (this.msOn){
      for (var mn=0;mn<frames;mn++){
        var mIn=(inL[mn]+inR[mn])*0.5*this.preampSm;
        var sIn=(inL[mn]-inR[mn])*0.5*this.preampSm;
        if (!isFinite(mIn)) mIn=0; else if (Math.abs(mIn)<1e-30) mIn=0;
        if (!isFinite(sIn)) sIn=0; else if (Math.abs(sIn)<1e-30) sIn=0;
        var mX=mIn, sX=sIn;
        var mc=(this.effCoeffsL || this.coeffsSm);
        var sc=(this.effCoeffsR || this.coeffsSmR || this.coeffsSm);
        var s1M=this.s1[0], s2M=this.s2[0], s1S=this.s1[1], s2S=this.s2[1];
        for (var mb=0;mb<this.nb;mb++){
          var cm=mc[mb];
          var ym=cm.b0*mX + s1M[mb];
          if (!isFinite(ym)) ym=0; else if (Math.abs(ym)<1e-30) ym=0;
          s1M[mb]=cm.b1*mX - cm.a1*ym + s2M[mb];
          if (!isFinite(s1M[mb])) s1M[mb]=0; else if (Math.abs(s1M[mb])<1e-30) s1M[mb]=0;
          s2M[mb]=cm.b2*mX - cm.a2*ym;
          if (!isFinite(s2M[mb])) s2M[mb]=0; else if (Math.abs(s2M[mb])<1e-30) s2M[mb]=0;
          mX=ym;
          var cs=sc[mb];
          var ys=cs.b0*sX + s1S[mb];
          if (!isFinite(ys)) ys=0; else if (Math.abs(ys)<1e-30) ys=0;
          s1S[mb]=cs.b1*sX - cs.a1*ys + s2S[mb];
          if (!isFinite(s1S[mb])) s1S[mb]=0; else if (Math.abs(s1S[mb])<1e-30) s1S[mb]=0;
          s2S[mb]=cs.b2*sX - cs.a2*ys;
          if (!isFinite(s2S[mb])) s2S[mb]=0; else if (Math.abs(s2S[mb])<1e-30) s2S[mb]=0;
          sX=ys;
        }
        var lO=mX+sX, rO=mX-sX;
        if (!isFinite(lO)) lO=0; else if (Math.abs(lO)<1e-30) lO=0;
        if (!isFinite(rO)) rO=0; else if (Math.abs(rO)<1e-30) rO=0;
        var xs1L=this.xs1[0], xs2L=this.xs2[0], xs1R=this.xs1[1], xs2R=this.xs2[1];
        for (var xb=0;xb<this.xcoeffs.length;xb++){
          var xc=this.xcoeffs[xb];
          if (xc.b0===1 && xc.b1===0 && xc.b2===0 && xc.a1===0 && xc.a2===0) continue;
          var xyL=xc.b0*lO + xs1L[xb];
          if (!isFinite(xyL)) xyL=0; else if (Math.abs(xyL)<1e-30) xyL=0;
          xs1L[xb]=xc.b1*lO - xc.a1*xyL + xs2L[xb];
          if (!isFinite(xs1L[xb])) xs1L[xb]=0; else if (Math.abs(xs1L[xb])<1e-30) xs1L[xb]=0;
          xs2L[xb]=xc.b2*lO - xc.a2*xyL;
          if (!isFinite(xs2L[xb])) xs2L[xb]=0; else if (Math.abs(xs2L[xb])<1e-30) xs2L[xb]=0;
          lO=xyL;
          var xyR=xc.b0*rO + xs1R[xb];
          if (!isFinite(xyR)) xyR=0; else if (Math.abs(xyR)<1e-30) xyR=0;
          xs1R[xb]=xc.b1*rO - xc.a1*xyR + xs2R[xb];
          if (!isFinite(xs1R[xb])) xs1R[xb]=0; else if (Math.abs(xs1R[xb])<1e-30) xs1R[xb]=0;
          xs2R[xb]=xc.b2*rO - xc.a2*xyR;
          if (!isFinite(xs2R[xb])) xs2R[xb]=0; else if (Math.abs(xs2R[xb])<1e-30) xs2R[xb]=0;
          rO=xyR;
        }
        outL[mn]=lO; outR[mn]=rO;
      }
      return;
    }
    for (var n=0;n<frames;n++){
      for (var ch=0;ch<2;ch++){
        var x = (ch===0?inL[n]:inR[n]) * this.preampSm;
        var coefs = (ch===0) ? (this.effCoeffsL || this.coeffsSm) : (this.effCoeffsR || this.coeffsSmR || this.coeffsSm);
        /* chống tràn số tại đầu tầng lọc: ±Inf làm trạng thái DF-II nhiễm
           NaN vĩnh viễn (0*Inf = NaN) nếu không khử trước khi vào vòng lọc. */
        if (!isFinite(x)) x=0; else if (Math.abs(x)<1e-30) x=0;
        var s1=this.s1[ch], s2=this.s2[ch];
        for (var b=0;b<this.nb;b++){
          var c=coefs[b];
          var y = c.b0*x + s1[b];
          /* Pha C 2026-11-05: trang thai DF-II tu hoi phuc — neu y/s1/s2
             nhiem NaN/Infinity (he so xau thoang qua), vong loc giu mai
             NaN du he so sau do da tot; ve 0 (va triet <1e-30 nhu dau vao)
             de tieng tro lai ngay block sau. Duong huu han khong doi. */
          if (!isFinite(y)) y = 0; else if (Math.abs(y) < 1e-30) y = 0;
          s1[b] = c.b1*x - c.a1*y + s2[b];
          if (!isFinite(s1[b])) s1[b] = 0; else if (Math.abs(s1[b]) < 1e-30) s1[b] = 0;
          s2[b] = c.b2*x - c.a2*y;
          if (!isFinite(s2[b])) s2[b] = 0; else if (Math.abs(s2[b]) < 1e-30) s2[b] = 0;
          x = y;
        }
        /* 7 biquad psycho: 6 section loudness + notch cá nhân (bỏ qua nếu identity) */
        var xs1=this.xs1[ch], xs2=this.xs2[ch];
        for (var xb=0;xb<this.xcoeffs.length;xb++){
          var xc=this.xcoeffs[xb];
          if (xc.b0===1 && xc.b1===0 && xc.b2===0 && xc.a1===0 && xc.a2===0) continue;
          var xy = xc.b0*x + xs1[xb];
          if (!isFinite(xy)) xy = 0; else if (Math.abs(xy) < 1e-30) xy = 0;
          xs1[xb] = xc.b1*x - xc.a1*xy + xs2[xb];
          if (!isFinite(xs1[xb])) xs1[xb] = 0; else if (Math.abs(xs1[xb]) < 1e-30) xs1[xb] = 0;
          xs2[xb] = xc.b2*x - xc.a2*xy;
          if (!isFinite(xs2[xb])) xs2[xb] = 0; else if (Math.abs(xs2[xb]) < 1e-30) xs2[xb] = 0;
          x = xy;
        }
        if (ch===0) outL[n]=x; else outR[n]=x;
      }
    }
  }
  /* FFT radix-2 dùng riêng trong worklet (bản sao của hàm fft() ở main thread):
     dùng cho cả phổ partition lẫn FFT block đầu vào của Partitioned Convolution. */
  fftW(re, im, invert){
    var n = re.length, j=0, i, len, ang, wlenR, wlenI, uR,uI,vR,vI,tR,tI;
    for(i=1;i<n;i++){
      var bit = n>>1;
      for(; j & bit; bit>>=1) j ^= bit;
      j ^= bit;
      if(i<j){ tR=re[i];re[i]=re[j];re[j]=tR; tI=im[i];im[i]=im[j];im[j]=tI; }
    }
    for(len=2; len<=n; len<<=1){
      ang = 2*Math.PI/len*(invert?1:-1);
      wlenR=Math.cos(ang); wlenI=Math.sin(ang);
      for(i=0;i<n;i+=len){
        var wR=1, wI=0, k;
        for(k=0;k<len/2;k++){
          var a=i+k, b=i+k+len/2;
          uR=re[a]; uI=im[a];
          vR=re[b]*wR - im[b]*wI; vI=re[b]*wI + im[b]*wR;
          re[a]=uR+vR; im[a]=uI+vI; re[b]=uR-vR; im[b]=uI-vI;
          tR=wR*wlenR - wI*wlenI; wI=wR*wlenI + wI*wlenR; wR=tR;
        }
      }
    }
    if(invert){ for(i=0;i<n;i++){ re[i]/=n; im[i]/=n; } }
  }
  /* Partitioned FFT Convolution (Overlap-Add) — Lộ trình v2 · Nhóm 1:
     chia taps thành các partition dài B = 128 mẫu, FFT 256 cho mỗi partition
     một lần khi nhận taps. Taps không hữu hạn (NaN/±Inf) bị thay bằng 0 và
     |tap| < 1e-30 bị triệt về 0 để không đưa denormal vào phổ partition. */
  buildFirPartitions(taps){
    var B=128, N=256, nPart=Math.ceil(taps.length/B);
    var specR=[], specI=[];
    for (var p=0;p<nPart;p++){
      var re=new Float64Array(N), im=new Float64Array(N);
      for (var i=0;i<B;i++){
        var idx=p*B+i, v=0;
        if (idx<taps.length){ v=taps[idx]; if (!isFinite(v)) v=0; else if (Math.abs(v)<1e-30) v=0; }
        re[i]=v;
      }
      this.fftW(re, im, false);
      specR.push(re); specI.push(im);
    }
    return { nPart:nPart, specR:specR, specI:specI, tailL:new Float64Array(B), tailR:new Float64Array(B), hist:[[],[]] };
  }
  /* Một block 128 mẫu qua Partitioned Convolution: FFT block đầu vào rồi
     giữ lịch sử phổ theo kênh — partition p (taps ở trễ p*128 mẫu) nhân với
     phổ của block vào cách p block trước, cộng dồn qua mọi partition, IFFT,
     cộng phần overlap (tail) của block trước vào 128 mẫu đầu và giữ 128 mẫu
     cuối làm tail block sau. Không thêm trễ block nào so với chập trực tiếp:
     block ra thứ n chỉ phụ thuộc các block vào tới n. */
  processFIRPartitioned(input, output, frames){
    var P=this.firPart, B=128, N=256;
    var inL=input[0], inR=input.length>1?input[1]:input[0];
    var outL=output[0], outR=output.length>1?output[1]:output[0];
    for (var ch=0; ch<2; ch++){
      var inp = (ch===0?inL:inR), outp=(ch===0?outL:outR);
      var tail = (ch===0?P.tailL:P.tailR);
      var hist = P.hist[ch];
      var re=new Float64Array(N), im=new Float64Array(N);
      for (var n=0;n<B;n++){ var pv=inp[n]*this.preampSm; if (!isFinite(pv)) pv=0; else if (Math.abs(pv)<1e-30) pv=0; re[n]=pv; }
      this.fftW(re, im, false);
      hist.unshift([re, im]);
      if (hist.length>P.nPart) hist.pop();
      var accR=new Float64Array(N), accI=new Float64Array(N);
      for (var p=0;p<hist.length;p++){
        var hR=hist[p][0], hI=hist[p][1], sR=P.specR[p], sI=P.specI[p];
        for (var k=0;k<N;k++){ accR[k]+=hR[k]*sR[k]-hI[k]*sI[k]; accI[k]+=hR[k]*sI[k]+hI[k]*sR[k]; }
      }
      this.fftW(accR, accI, true);
      for (var m=0;m<B;m++){ outp[m]=accR[m]+tail[m]; tail[m]=accR[B+m]; }
    }
  }
  processFIR(input, output, frames){
    /* Đường chính: Partitioned FFT khi quantum đúng 128 mẫu (chuẩn
       AudioWorklet); quantum khác thì về chập trực tiếp cho block đó. */
    if (this.firPart && frames===128){ this.processFIRPartitioned(input, output, frames); return; }
    var taps=this.fir, N=taps.length;
    var inL=input[0], inR=input.length>1?input[1]:input[0];
    var outL=output[0], outR=output.length>1?output[1]:output[0];
    for (var n=0;n<frames;n++){
      for (var ch=0;ch<2;ch++){
        var buf=this.firBuf[ch];
        var fv=(ch===0?inL[n]:inR[n])*this.preampSm; if (!isFinite(fv)) fv=0; else if (Math.abs(fv)<1e-30) fv=0; buf[this.firPos]=fv;
        var acc=0;
        for (var k=0;k<N;k++){
          var idx=this.firPos-k; if(idx<0) idx+=N;
          acc+=taps[k]*buf[idx];
        }
        if (ch===0) outL[n]=acc; else outR[n]=acc;
      }
      this.firPos++; if(this.firPos>=N) this.firPos=0;
    }
  }
  process(input, output){
    var inp = input[0], out = output[0];
    if (!inp || !inp.length) return true;
    var frames = inp[0].length;
    /* --- Giai đoạn 4: nội suy mượt hệ số + pre-amp theo block (chống click) --- */
    for (var si=0;si<this.nb;si++){
      var ct=this.coeffs[si], cs=this.coeffsSm[si];
      cs.b0+=(ct.b0-cs.b0)*0.35; cs.b1+=(ct.b1-cs.b1)*0.35; cs.b2+=(ct.b2-cs.b2)*0.35;
      cs.a1+=(ct.a1-cs.a1)*0.35; cs.a2+=(ct.a2-cs.a2)*0.35;
      if (this.coeffsR && this.coeffsR[si]){
        var ctr=this.coeffsR[si], csr=this.coeffsSmR[si];
        csr.b0+=(ctr.b0-csr.b0)*0.35; csr.b1+=(ctr.b1-csr.b1)*0.35; csr.b2+=(ctr.b2-csr.b2)*0.35;
        csr.a1+=(ctr.a1-csr.a1)*0.35; csr.a2+=(ctr.a2-csr.a2)*0.35;
      } else {
        var csl=this.coeffsSmR[si]; csl.b0=cs.b0; csl.b1=cs.b1; csl.b2=cs.b2; csl.a1=cs.a1; csl.a2=cs.a2;
      }
    }
    this.preampSm += (this.preampLin-this.preampSm)*0.30;
    /* Pha C 2026-11-05: he so noi suy tu hoi phuc — mot message he so xau
       lam coeffsSm nhiem NaN thi phep noi suy sau do giu mai NaN
       (huu han - NaN = NaN) nen tieng cam vinh vien du gui lai he so tot.
       Chi khi smoothed khong huu han moi dat lai ve muc tieu huu han
       (hoac identity); duong huu han khong doi 1 bit. */
    for (var si2=0;si2<this.nb;si2++){
      var ct2=this.coeffs[si2], cs2=this.coeffsSm[si2];
      if (ct2 && cs2 && !isFinite(cs2.b0+cs2.b1+cs2.b2+cs2.a1+cs2.a2)){
        cs2.b0=isFinite(ct2.b0)?ct2.b0:1; cs2.b1=isFinite(ct2.b1)?ct2.b1:0;
        cs2.b2=isFinite(ct2.b2)?ct2.b2:0; cs2.a1=isFinite(ct2.a1)?ct2.a1:0;
        cs2.a2=isFinite(ct2.a2)?ct2.a2:0;
      }
      var csr2=this.coeffsSmR[si2];
      if (csr2 && !isFinite(csr2.b0+csr2.b1+csr2.b2+csr2.a1+csr2.a2)){
        var ctr2=(this.coeffsR&&this.coeffsR[si2])?this.coeffsR[si2]:null;
        csr2.b0=(ctr2&&isFinite(ctr2.b0))?ctr2.b0:(cs2?cs2.b0:1);
        csr2.b1=(ctr2&&isFinite(ctr2.b1))?ctr2.b1:(cs2?cs2.b1:0);
        csr2.b2=(ctr2&&isFinite(ctr2.b2))?ctr2.b2:(cs2?cs2.b2:0);
        csr2.a1=(ctr2&&isFinite(ctr2.a1))?ctr2.a1:(cs2?cs2.a1:0);
        csr2.a2=(ctr2&&isFinite(ctr2.a2))?ctr2.a2:(cs2?cs2.a2:0);
      }
    }
    if (!isFinite(this.preampSm)) this.preampSm = isFinite(this.preampLin)?this.preampLin:1;
    if (this.bypass){
      for (var ch=0;ch<out.length;ch++) out[ch].set(inp[Math.min(ch,inp.length-1)]);
    } else if (this.mode==="fir" && this.fir && this.firBuf){
      for (var fz=0;fz<this.nb;fz++){ this.dynOff[fz]=0; this.dynLvl[fz]=-120; }
      this.processFIR(inp, out, frames);
    } else {
      this.updateDyn(inp, frames);
      this.processIIR(inp, out, frames);
    }
    /* ---- Trim loudness slot A/B/X (Giai đoạn 4): sau EQ, áp cả khi bypass ---- */
    this.slotSm += (this.slotLin - this.slotSm)*0.30;
    if (!isFinite(this.slotSm)) this.slotSm = isFinite(this.slotLin)?this.slotLin:1; /* Pha C 2026-11-05: cung hoi phuc nhu preampSm */
    if (Math.abs(this.slotSm - 1) > 1e-4 || this.slotLin !== 1){
      for (var sc2=0; sc2<out.length; sc2++){
        var oc = out[sc2];
        for (var sn=0; sn<frames; sn++) oc[sn] *= this.slotSm;
      }
    }
    /* ---- Crossfeed / binaural stage: SAU EQ, TRƯỚC limiter (Giai đoạn 3) ---- */
    if (!this.bypass && this.xfOn && this.xfMix>0){
      var cL=out[0], cR=out.length>1?out[1]:out[0], m=this.xfMix;
      for (var cn=0;cn<frames;cn++){
        var xl=cL[cn], xr=cR[cn];
        var rIdx=(this.xfPos - this.xfItd + 256)%256;
        var dR=this.xfBufR[rIdx], dL=this.xfBufL[rIdx];
        this.xfLpR += this.xfLpA*(dR - this.xfLpR);
        this.xfLpL += this.xfLpA*(dL - this.xfLpL);
        if (!isFinite(this.xfLpR)) this.xfLpR=0; else if (Math.abs(this.xfLpR)<1e-30) this.xfLpR=0; /* Pha C 2026-11-05: hoi phuc xfLp sau NaN (giong ve sinh processIIR 13:35) */
        if (!isFinite(this.xfLpL)) this.xfLpL=0; else if (Math.abs(this.xfLpL)<1e-30) this.xfLpL=0;
        this.xfBufL[this.xfPos]=xl; this.xfBufR[this.xfPos]=xr;
        this.xfPos=(this.xfPos+1)%256;
        cL[cn] = xl*(1-0.25*m) + this.xfLpR*m*0.85;
        if (cR!==cL) cR[cn] = xr*(1-0.25*m) + this.xfLpL*m*0.85;
      }
    }
    /* ---- Look-ahead Brickwall True-Peak limiter (linked stereo) ----
       Mỗi khoảng mẫu [k-1,k] được đo bằng nội suy windowed-sinc x16 khi
       mẫu k+16 đã tới (trễ ước lượng 16 mẫu, nằm gọn trong lookahead 128
       mẫu); đích gain của khoảng k được ghi vào vòng đích tại đúng ô
       delay line của mẫu k. Gain ra đi qua envelope mượt có lookahead
       (cửa sổ 111 mẫu, dốc tối đa 0.005 dB/mẫu, release 0.0002/mẫu) và
       luôn kẹp bởi đích của chính mẫu ra. Đỉnh liên mẫu đã đo vì vậy
       không vượt trần quá sai số của bộ ước lượng (tiêu chí đạt: đo độc lập
       bằng bộ ước lượng x16, dung sai +0.1 dB trên trần -1.0 dBTP; số x32
       chỉ mang tính tham chiếu, xem ghi chú backlog). */
    var inL=out[0], inR=out.length>1?out[1]:out[0];
    var pkIn=0, pkOut=0, tpBlk=0;
    for (var n=0;n<frames;n++){
      var xl=inL[n], xr=inR[n];
      /* chống tràn số ngay tại đầu tầng limiter */
      if (!isFinite(xl)) xl=0; else if (Math.abs(xl)<1e-30) xl=0;
      if (!isFinite(xr)) xr=0; else if (Math.abs(xr)<1e-30) xr=0;
      /* vòng lịch sử true-peak (64 mẫu/kênh) */
      this.tpBuf[0][this.tpPos]=xl; this.tpBuf[1][this.tpPos]=xr;
      this.tpPos=(this.tpPos+1)%64; this.tpCount++;
      /* đích gain cho khoảng kết thúc tại mẫu n-16 (cần mẫu tới n, đã có) */
      if (this.tpCount>=17){
        var tp = this.tpInterval();
        if (tp>tpBlk) tpBlk=tp;
        var tgt = (tp>CEIL) ? CEIL/tp : 1;
        if (tgt<0) tgt=0; if (tgt>1) tgt=1;
        this.tgt[(this.dlyPos-16+LA)%LA]=tgt;
      }
      /* đích khoảng c[t-17] = min(tgt[t-17], tgt[t-16]): cả hai đích đều đã
         có (tgt[t-16] vừa ghi ở trên, tgt[t-17] ghi ở mẫu trước). */
      if (this.tpCount>=18){
        var cT = Math.min(this.tgt[(this.dlyPos-17+LA)%LA], this.tgt[(this.dlyPos-16+LA)%LA]);
        this.cRing[(this.tpCount-18+256)%256]=cT;
      }
      /* delay line lookahead 128 mẫu; mẫu sắp ra có chỉ số o = outCount-128
         (các mẫu ra đầu tiên là silence trước điểm bắt đầu, c = 1). */
      var pos=this.dlyPos;
      var oldL=this.dlyL[pos], oldR=this.dlyR[pos];
      this.dlyL[pos]=xl; this.dlyR[pos]=xr;
      this.dlyPos=(pos+1)%LA;
      var oIdx = this.outCount-128; this.outCount++;
      /* envelope brickwall mượt: a[o] = min(c[o+k]*R^k, k=0..111) — gain đã hạ
         trước đỉnh với dốc tối đa 0.005 dB/mẫu; gain ra luôn ≤ c[o] (đích
         của chính mẫu đó) nên đỉnh liên mẫu đã đo không vượt trần. Khi hạ,
         gain bám đúng aEnv (aEnv đã tự giới hạn dốc theo cấu trúc min trượt
         chiết khấu, không giới hạn dốc phụ thêm); khi lên: release
         0.0002/mẫu (tau ~5000 mẫu ≈ 104 ms). */
      var capC = this.cRing[((oIdx%256)+256)%256];
      var aEnv = 1;
      for (var ek=0;ek<112;ek++){
        var ecv = this.cRing[((oIdx+ek)%256+256)%256]*this.rPow[ek];
        if (ecv<aEnv) aEnv=ecv;
      }
      if (aEnv<this.gr) this.gr = aEnv; /* hạ: bám đúng aEnv (đã tự giới hạn dốc) */
      else this.gr += (aEnv-this.gr)*0.0002; /* lên: release chậm */
      if (this.gr>capC) this.gr = capC; /* đai an toàn: không vượt đích mẫu hiện tại */
      var g = this.limiterOn ? this.gr : 1;
      var yl=oldL*g, yr=oldR*g;
      inL[n]=yl; if (inR!==inL) inR[n]=yr;
      var a=Math.abs(xl), b2=Math.abs(xr); if(a>pkIn)pkIn=a; if(b2>pkIn)pkIn=b2;
      var c2=Math.abs(yl), d2=Math.abs(yr); if(c2>pkOut)pkOut=c2; if(d2>pkOut)pkOut=d2;
      if(tp>tpBlk)tpBlk=tp;
    }
    if (pkIn>this.peakIn)this.peakIn=pkIn;
    if (pkOut>this.peakOut)this.peakOut=pkOut;
    if (tpBlk>this.tp)this.tp=tpBlk;
    this.grDb = 20*Math.log10(Math.max(1e-6,this.gr));
    this.frame++;
    if (this.frame%24===0){
      this.port.postMessage({ type:"meter",
        peakIn:this.peakIn, peakOut:this.peakOut, tp:this.tp,
        grDb:this.grDb, active:(this.limiterOn && this.grDb<-0.1) });
      this.peakIn=0; this.peakOut=0; this.tp=0;
      if (this.dyn){
        var offArr=[], lvlArr=[];
        for (var mi=0;mi<this.nb;mi++){ offArr.push(this.dynOff[mi]); lvlArr.push(this.dynLvl[mi]); }
        this.port.postMessage({ type:"dynMeter", off:offArr, lvl:lvlArr });
      }
    }
    return true;
  }
}
registerProcessor("autoeq-dsp", AutoEqProcessor);
`;
$("workletSrc").textContent = WORKLET_SRC;

/* ================================================================
   AUDIO ENGINE (main thread)
   ================================================================ */
var AC=null, workletNode=null, analyser=null, masterGain=null, inputBus=null;
var mediaSrc=null, engineReady=false, engineError=false;
var meter = { peakOut:0, tp:0, grDb:0, active:false };
var dynMeter = null; /* {off:[], lvl:[]} tu worklet, moi 24 block khi Dynamic EQ bat */
var bufSrc=null, bufPlaying=false, bufKind=null, fileDur=0;

function showErr(msg){ var e=$("errBox"); e.textContent=msg; e.style.display="block"; }
function hideErr(){ $("errBox").style.display="none"; }

var initBusy = false;
async function initEngine(){
  if (engineReady) { if (AC && AC.state==="suspended") { try{ await AC.resume(); }catch(e){} } return true; }
  if (initBusy) return false;
  initBusy = true;
  $("stEngine").textContent = "Đang khởi tạo…";
  $("dotEngine").className = "dot warn";
  try{
    if (!AC){
      AC = new (window.AudioContext||window.webkitAudioContext)({ latencyHint:"interactive" });
      displayFs = AC.sampleRate;
      $("stFs").textContent = displayFs.toLocaleString("vi-VN")+" Hz";
      inputBus = AC.createGain();
      mediaSrc = AC.createMediaElementSource($("audioEl"));
      mediaSrc.connect(inputBus);
    }
    if (!workletNode){
      var blob = new Blob([WORKLET_SRC], { type:"application/javascript" });
      var url = URL.createObjectURL(blob);
      try{
        await Promise.race([
          AC.audioWorklet.addModule(url),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("hết thời gian chờ nạp module AudioWorklet (> 8 giây) — thiết bị/trình duyệt hiện tại có thể không chạy được luồng worklet âm thanh")); }, 8000); })
        ]);
      } finally { URL.revokeObjectURL(url); }
      workletNode = new AudioWorkletNode(AC, "autoeq-dsp", { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2] });
      workletNode.port.onmessage = function(e){
        if (e.data && e.data.type==="meter"){ meter = e.data; }
        else if (e.data && e.data.type==="dynMeter"){ dynMeter = e.data; }
      };
      analyser = AC.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.75;
      masterGain = AC.createGain(); masterGain.gain.value = $("vol").value/100;
      /* Notch do ong tai (Nhom 2 v2): luon nam trong chuoi, gain 0 dB = dong nhat
         khi tat nen khong doi am thanh; khi quet, gain -12 dB tai tan so do. */
      if (typeof earProbeNode === "undefined" || !earProbeNode){
        earProbeNode = AC.createBiquadFilter(); earProbeNode.type = "peaking";
        earProbeNode.frequency.value = 5500; earProbeNode.Q.value = 8; earProbeNode.gain.value = 0;
      }
      inputBus.connect(earProbeNode);
      earProbeNode.connect(workletNode);
      workletNode.connect(analyser);
      analyser.connect(masterGain);
      masterGain.connect(AC.destination);
      if (typeof hrtfApplyGraph === "function") { try { hrtfApplyGraph(); } catch (e) {} }
    }
    engineReady = true;
    /* Pha A/C 2026-11-07: solver theo sample rate that — neu band hien tai duoc giai
       o rate khac (thuong 48000 mac dinh truoc khi engine chay), giai lai o rate that
       de dap tuyen nghe dung nhu solver toi uu (lab fsrate: lech toi 2,34 dB neu khong
       giai lai). Chi kich khi da co band duoc giai (aeSolvedFs !== null); nut dang mo
       (dang giai) thi co che sig o btnAutoEq tu chay lai khi xong vi sig gom displayFs. */
    if (typeof AE !== "undefined" && AE && AE.points && typeof aeSolvedFs === "number" && aeSolvedFs !== displayFs){
      try { var _fsBtn = $("btnAutoEq"); if (_fsBtn && !_fsBtn.disabled) _fsBtn.click(); } catch (e) {}
    }
    hideErr();
    $("dotEngine").className = "dot on";
    $("stEngine").textContent = "Đang chạy · AudioWorklet";
    $("btnPlay").disabled = false;
    $("btnBypass").disabled = false;
    pushConfig(); pushCoeffs(); pushXCoeffs(); pushFir();
    updateLatency();
    if (AC.state==="suspended") { try{ await AC.resume(); }catch(e){} }
    if (typeof refreshDerived==="function"){ refreshDerived(); drawGraph(); }
    if (typeof startMeterLoop==="function") startMeterLoop();
    return true;
  }catch(err){
    engineError = true;
    $("dotEngine").className = "dot warn";
    $("stEngine").textContent = "Lỗi khởi tạo — bấm nguồn phát để thử lại";
    showErr("Không khởi tạo được AudioWorklet ("+err.message+"). DSP Core cần trình duyệt hỗ trợ AudioWorklet (Chrome/Edge/Firefox/Safari bản mới) và ngữ cảnh bảo mật HTTPS. Đồ thị đáp tuyến vẫn xem/chỉnh được, nhưng không phát/xử lý âm thanh được. Bấm lại nút nguồn phát để thử lại.");
    return false;
  } finally {
    initBusy = false;
  }
}
function pushCoeffs(){
  if (!workletNode) return;
  var soloOn = (typeof SOLO!=="undefined" && SOLO.on);
  var base = (typeof soloCoeffs==="function" && soloCoeffs(displayFs)) || allCoeffs(displayFs);
  var msg = { type:"coeffs", coeffs: base };
  if (!soloOn && typeof LR_MODE!=="undefined" && LR_MODE!=="linked" && LR_L && LR_R){
    msg.coeffs = lrCoeffsFor(LR_L, displayFs);
    msg.coeffsR = lrCoeffsFor(LR_R, displayFs);
  } else if (!soloOn && typeof MS_MODE!=="undefined" && MS_MODE!=="linked" && MS_M && MS_S){
    msg.coeffs = lrCoeffsFor(MS_M, displayFs);
    msg.coeffsR = lrCoeffsFor(MS_S, displayFs);
  }
  workletNode.port.postMessage(msg);
}
var firTimer=null;
function pushFir(){
  if (!workletNode) return;
  clearTimeout(firTimer);
  firTimer = setTimeout(function(){
    /* AEOPT v1 (rebase): worklet chi dung taps khi mode==="fir"; o che do
       IIR mac dinh, buildFirTaps (2049 bin dap tuyen truc tiep + FFT 4096) tren moi
       lan updateAll la viec thua. Kiem tra mode LUC TIMER CHAY: nut FIR
       goi pushFir() roi moi setMode("fir") nen timer van thay mode fir. */
    if (typeof mode !== "undefined" && mode !== "fir") return;
    var taps = buildFirTaps(displayFs, firLen);
    workletNode.port.postMessage({ type:"fir", taps: taps });
  }, 40);
}
function pushConfig(){
  if (!workletNode) return;
  var msg = { type:"config", mode: ((typeof SOLO!=="undefined" && SOLO.on) ? "iir" : mode), bypass:bypass, limiterOn:limiterOn,
    msOn: (typeof MS_MODE!=="undefined" && MS_MODE!=="linked" && !(typeof SOLO!=="undefined" && SOLO.on)),
    slotLin: (typeof abxTrimLin==="function" ? abxTrimLin() : 1),
    preampLin: Math.pow(10, appliedPreDb()/20)
      * ((typeof SOLO!=="undefined" && SOLO.on) ? Math.pow(10, -appliedPreDb()/20) : 1) };
  /* Giai đoạn 3: crossfeed + dynamic EQ (state PSY khai báo ở khối Psychoacoustics) */
  if (typeof PSY!=="undefined" && PSY){
    msg.crossfeed = { on: PSY.cross.on && !PSY.bypassAll, mix: PSY.cross.mix/100,
      itd: Math.max(1, Math.round(PSY.cross.itdMs*displayFs/1000)),
      lpA: 1-Math.exp(-2*Math.PI*6500/displayFs) };
    msg.dyn = (typeof dynConfigForWorklet==="function") ? dynConfigForWorklet() : null;
    if (!msg.dyn) dynMeter = null;
  }
  workletNode.port.postMessage(msg);
}
function pushXCoeffs(){
  if (!workletNode || typeof psychoCoeffs!=="function") return;
  workletNode.port.postMessage({ type:"xcoeffs", coeffs: psychoCoeffs(displayFs) });
}
function dspLatencySamples(){
  var la = 128; /* limiter lookahead (brickwall TP limiter) */
  return mode==="fir" ? (firLen-1)/2 + la : la;
}
function updateLatency(){
  var s = dspLatencySamples();
  $("stLatency").textContent = engineReady ? (s+" samples ≈ "+(s/displayFs*1000).toFixed(2)+" ms") : "—";
  $("vGd").textContent = ((firLen-1)/2)+" samples ≈ "+(((firLen-1)/2)/displayFs*1000).toFixed(2)+" ms";
}

/* ---------------- Tín hiệu demo ---------------- */
function makePinkBuffer(){
  var len = AC.sampleRate*8, buf = AC.createBuffer(2, len, AC.sampleRate);
  for (var ch=0; ch<2; ch++){
    var d = buf.getChannelData(ch), b0=0,b1=0,b2=0;
    for (var i=0;i<len;i++){
      var w = Math.random()*2-1;
      b0 = 0.99765*b0 + w*0.0990460;
      b1 = 0.96300*b1 + w*0.2965164;
      b2 = 0.57000*b2 + w*1.0526913;
      d[i] = (b0+b1+b2+w*0.1848)*0.16;
    }
  }
  return buf;
}
function makeSweepBuffer(){
  var dur=8, len=AC.sampleRate*dur, buf=AC.createBuffer(2, len, AC.sampleRate);
  var f0=20, f1=20000;
  for (var ch=0; ch<2; ch++){
    var d = buf.getChannelData(ch);
    for (var i=0;i<len;i++){
      var t=i/AC.sampleRate, k=t/dur;
      var f=f0*Math.pow(f1/f0,k);
      var ph=2*Math.PI*f0*(Math.pow(f1/f0,k)-1)/(Math.log(f1/f0)/dur);
      d[i]=Math.sin(ph)*0.35*Math.min(1,t*4)*Math.min(1,(dur-t)*2);
    }
  }
  return buf;
}
function stopBuffer(){
  if (bufSrc){ try{ bufSrc.onended=null; bufSrc.stop(); }catch(e){} bufSrc=null; }
  bufPlaying=false;
}
function playBuffer(buf, kind, loop){
  stopBuffer();
  bufSrc = AC.createBufferSource();
  bufSrc.buffer = buf; bufSrc.loop = !!loop;
  bufSrc.connect(inputBus);
  bufSrc.onended = function(){ if (bufKind===kind){ bufPlaying=false; bufKind=null; syncPlayBtn(); } };
  bufSrc.start();
  bufPlaying = true; bufKind = kind;
  fileDur = buf.duration;
  $("srcKind").textContent = kind==="pink" ? "demo · pink noise (loop)" : "demo · quét sin log (8 giây)";
  $("trackName").innerHTML = kind==="pink"
    ? "<b>Pink noise tích hợp</b> — băng rộng, thay đổi gain bass/treble nghe rõ nhất."
    : "<b>Quét sin logarit 20 Hz → 20 kHz</b> trong 8 giây — nghe đáp tuyến trượt theo tần số.";
  syncPlayBtn();
}

/* ---------------- Transport ---------------- */
var sourceKind = null; /* "file" | "pink" | "sweep" */
$("fileInput").addEventListener("change", function(){ tpHandleFiles(this.files, { playNew:true }); this.value=""; });
$("btnDemo").addEventListener("click", async function(){
  var ok = await initEngine(); if (!ok) return;
  if (typeof tpStopBufferTrack==="function") tpStopBufferTrack();
  if (typeof sysStop==="function") sysStop();
  if (typeof micStop==="function") micStop();
  $("audioEl").pause(); sourceKind="pink"; tpMode=null;
  playBuffer(makePinkBuffer(), "pink", true);
});
$("btnSweep").addEventListener("click", async function(){
  var ok = await initEngine(); if (!ok) return;
  if (typeof tpStopBufferTrack==="function") tpStopBufferTrack();
  if (typeof sysStop==="function") sysStop();
  if (typeof micStop==="function") micStop();
  $("audioEl").pause(); sourceKind="sweep"; tpMode=null;
  playBuffer(makeSweepBuffer(), "sweep", false);
});
function isPlaying(){
  if (sourceKind==="sys") return (typeof sysPlaying!=="undefined") ? sysPlaying : false;
  if (sourceKind==="file") return (typeof tpMode!=="undefined" && tpMode==="buffer") ? tpIsPlaying() : !$("audioEl").paused;
  return bufPlaying;
}
function syncPlayBtn(){
  $("btnPlay").textContent = isPlaying() ? "⏸ Tạm dừng" : "▶ Phát";
  if (sourceKind==="file") $("tDur").textContent = fmtTime((typeof tpMode!=="undefined" && tpMode==="buffer") ? tpDurCurrent() : ($("audioEl").duration||0));
  else if (bufKind) $("tDur").textContent = fmtTime(fileDur);
}
$("btnPlay").addEventListener("click", async function(){
  var ok = await initEngine(); if (!ok) return;
  if (AC.state==="suspended") await AC.resume();
  var el = $("audioEl");
  if (sourceKind==="sys"){ await sysToggle(); syncPlayBtn(); return; }
  if (sourceKind==="mic"){ if (typeof micStop==="function") micStop(false); syncPlayBtn(); return; }
  if (sourceKind==="file"){
    if (typeof tpMode!=="undefined" && tpMode==="buffer") tpToggleBuffer();
    else if (el.paused) el.play(); else el.pause();
  } else if (sourceKind==="pink"){
    if (bufPlaying) stopBuffer(); else playBuffer(makePinkBuffer(), "pink", true);
  } else if (sourceKind==="sweep"){
    if (bufPlaying) stopBuffer(); else playBuffer(makeSweepBuffer(), "sweep", false);
  } else {
    sourceKind="pink"; playBuffer(makePinkBuffer(), "pink", true);
  }
  syncPlayBtn();
});
$("audioEl").addEventListener("play", syncPlayBtn);
$("audioEl").addEventListener("pause", syncPlayBtn);
$("seek").addEventListener("input", function(){
  if (sourceKind==="file" && typeof tpMode!=="undefined" && tpMode==="buffer" && tpIndex>=0) tpSeekBuffer(this.value/1000*tpDurCurrent());
  else if (sourceKind==="file" && fileDur) $("audioEl").currentTime = this.value/1000*fileDur;
});
$("vol").addEventListener("input", function(){ if (masterGain) masterGain.gain.value = this.value/100; });
setInterval(function(){
  if (sourceKind==="file" && typeof tpMode!=="undefined" && tpMode==="buffer" && tpIndex>=0){
    var pos = tpBufPos(), dur = tpDurCurrent();
    $("tCur").textContent = fmtTime(pos);
    if (dur) $("seek").value = Math.round(pos/dur*1000);
  } else if (sourceKind==="file"){
    var el=$("audioEl");
    $("tCur").textContent = fmtTime(el.currentTime);
    if (el.duration) $("seek").value = Math.round(el.currentTime/el.duration*1000);
    if (tpAB.loop && tpAB.a!==null && tpAB.b!==null && el.currentTime>=tpAB.b) el.currentTime = tpAB.a;
  } else if (bufPlaying && bufKind==="sweep"){
    /* sweep không seek được — hiển thị đếm tương đối */
  }
}, 250);
/* ---------------- Transport Nhom 3 v2: FLAC/WAV/MP3 + Playlist + Seek/Loop A-B ----------------
   Giai ma: decodeAudioData -> AudioBuffer (seek chinh xac, Loop A-B bang
   loopStart/loopEnd). Giai ma that bai -> duong <audio> cu (fallback: van phat qua inputBus -> worklet, Loop A-B bang tua lai). */
var tpTracks=[], tpIndex=-1, tpMode=null; /* "buffer" | "element" | null */
var tpAB={a:null,b:null,loop:false};
var tpBuf=null, tpBufToken=0, tpPausedPos=0, tpBufPlaying=false;
var tpElUrl=null; /* CHAIN TASK #1 (2026-11-13, truc C): URL blob hien tai cua <audio>, de thu hoi khi doi bai — truoc day moi lan goi tpPlayElementTrack tao 1 ObjectURL moi ma khong revoke URL cu. */
function tpRevokeElUrl(){ if(tpElUrl){ try{ URL.revokeObjectURL(tpElUrl); }catch(e){} tpElUrl=null; } }
function tpGuessFormat(name, mime){
  var n = String(name||"").toLowerCase(), m = String(mime||"").toLowerCase();
  var ext = n.indexOf(".")>=0 ? n.slice(n.lastIndexOf(".")+1) : "";
  if (ext==="wav" || ext==="wave") return "WAV";
  if (ext==="flac") return "FLAC";
  if (ext==="mp3") return "MP3";
  if (ext==="m4a" || ext==="aac") return "AAC";
  if (ext==="ogg" || ext==="oga") return "OGG";
  if (ext==="opus") return "Opus";
  if (m==="audio/wav" || m==="audio/x-wav") return "WAV";
  if (m==="audio/flac" || m==="audio/x-flac") return "FLAC";
  if (m==="audio/mpeg") return "MP3";
  if (m==="audio/mp4" || m==="audio/aac") return "AAC";
  if (m==="audio/ogg") return "OGG";
  return "Âm thanh";
}
function tpClampAB(a, b, dur){
  if (!isFinite(a) || !isFinite(b) || !isFinite(dur) || dur<=0) return { valid:false };
  a = Math.max(0, Math.min(dur, a)); b = Math.max(0, Math.min(dur, b));
  if (!(b>a)) return { valid:false };
  return { valid:true, a:a, b:b };
}
function tpWrapPos(raw, a, b){
  if (!isFinite(raw) || !isFinite(a) || !isFinite(b) || !(b>a)) return raw;
  if (raw<b) return raw;
  return a + (raw-a)%(b-a);
}
function tpNextIndex(i, n){ if (!isFinite(n) || n<=0) return -1; if (!isFinite(i) || i<0) return 0; return (i+1)%n; }
function tpPrevIndex(i, n){ if (!isFinite(n) || n<=0) return -1; if (!isFinite(i) || i<0) return 0; return (i-1+n)%n; }
function tpDurCurrent(){
  if (tpIndex>=0 && tpTracks[tpIndex] && isFinite(tpTracks[tpIndex].dur) && tpTracks[tpIndex].dur>0) return tpTracks[tpIndex].dur;
  return fileDur||0;
}
function tpBufPos(){
  if (!tpBuf || !tpBufPlaying) return tpPausedPos;
  var raw = tpBuf.offset + (AC.currentTime - tpBuf.ctx);
  if (tpAB.loop){ var c = tpClampAB(tpAB.a, tpAB.b, tpDurCurrent()); if (c.valid) raw = tpWrapPos(raw, c.a, c.b); }
  return Math.min(raw, tpDurCurrent());
}
function tpIsPlaying(){ return tpBufPlaying; }
function tpStopBufferTrack(){
  if (tpBuf && tpBuf.src){ try{ tpBuf.src.onended=null; tpBuf.src.stop(); }catch(e){} }
  tpBuf=null; tpBufPlaying=false; tpBufToken++;
}
function tpSetInfo(msg){ var el=$("tpInfo"); if (el) el.textContent = msg; }
function tpRenderAB(){
  var el=$("tpABInfo"); if (!el) return;
  var c = tpClampAB(tpAB.a, tpAB.b, tpDurCurrent());
  el.textContent = c.valid
    ? ("A–B: " + fmtTime(c.a) + " – " + fmtTime(c.b) + " · Loop " + (tpAB.loop ? "BẬT" : "TẮT"))
    : (tpAB.a!==null ? ("A–B: A=" + fmtTime(tpAB.a) + " (chưa có B hợp lệ)") : "A–B: chưa đặt");
  var lb=$("tpLoop"); if (lb){ lb.textContent = "Loop A–B: " + (tpAB.loop ? "Bật" : "Tắt"); lb.className = tpAB.loop ? "btn small tog on" : "btn small tog"; }
}
function tpRenderList(){
  var box=$("tpList"); if (!box) return;
  box.innerHTML="";
  for (var i=0;i<tpTracks.length;i++){
    (function(idx){
      var t=tpTracks[idx], b=document.createElement("button");
      b.className = "btn small"; b.textContent = (idx===tpIndex ? "▶ " : "") + (idx+1) + ". " + t.name + " · " + t.format + (t.decoded ? " · giải mã " + t.sr + " Hz/" + t.ch + "ch" : (t.dur ? "" : " · chờ giải mã"));
      if (idx===tpIndex) b.style.borderColor = "#e8b84b";
      b.addEventListener("click", function(){ tpPlayTrack(idx, 0, true); });
      box.appendChild(b);
    })(i);
  }
}
function tpStartBufferAt(offset){
  var t = tpTracks[tpIndex]; if (!t || !t.buffer || !AC) return;
  tpStopBufferTrack();
  var dur = tpDurCurrent();
  if (!isFinite(offset) || offset<0) offset=0; if (offset>dur) offset=dur;
  var c = tpClampAB(tpAB.a, tpAB.b, dur);
  if (tpAB.loop && c.valid && offset>=c.b) offset = c.a;
  var src = AC.createBufferSource(); src.buffer = t.buffer;
  if (tpAB.loop && c.valid){ src.loop=true; src.loopStart=c.a; src.loopEnd=c.b; }
  src.connect(inputBus);
  var tok = ++tpBufToken;
  src.onended = function(){
    if (tok!==tpBufToken) return;
    tpBufPlaying=false; tpBuf=null;
    if (tpAB.loop) return;
    tpNextTrack();
  };
  tpBuf = { src:src, offset:offset, ctx:AC.currentTime }; tpBufPlaying=true; tpPausedPos=offset;
  src.start(0, offset);
  tpRenderList(); syncPlayBtn();
}
function tpPlayElementTrack(t){
  /* CHAIN TASK #4 (2026-11-13, truc D): guard bien — t/file khong hop le thi return som truoc moi thay doi trang thai (khong dung buffer, khong revoke URL dang phat, khong gan src rong); el khong co thi return; el.play() catch promise bi tu choi (autoplay policy) thay vi de unhandled rejection. */
  if (!t || !t.file) return;
  tpStopBufferTrack(); stopBuffer();
  var el=$("audioEl");
  if (!el) return;
  tpRevokeElUrl(); /* CHAIN TASK #1: thu hoi URL blob cua bai truoc, toi da chi giu 1 URL dang phat */
  tpElUrl = URL.createObjectURL(t.file);
  el.src = tpElUrl;
  el.onloadedmetadata = function(){ t.dur = el.duration; fileDur = el.duration; $("tDur").textContent = fmtTime(fileDur); tpRenderList(); };
  el.onended = function(){ if (!tpAB.loop) tpNextTrack(); else syncPlayBtn(); };
  var _p = el.play();
  if (_p && typeof _p.catch === "function") _p.catch(function(){});
  tpMode="element"; syncPlayBtn();
}
function tpPlayTrack(i, offset, autoplay){
  if (i<0 || i>=tpTracks.length) return;
  if (typeof sysStop==="function") sysStop();
  if (typeof micStop==="function") micStop();
  tpIndex=i; var t=tpTracks[i];
  stopBuffer(); $("audioEl").pause(); sourceKind="file";
  $("srcKind").textContent = "file local · " + t.format;
  $("trackName").innerHTML = "<b>"+String(t.name).replace(/</g,"&lt;")+"</b> · "+(t.size/1048576).toFixed(1)+" MB · "+t.format+" — phát qua engine DSP theo thời gian thực.";
  if (t.buffer){
    tpMode="buffer"; tpPausedPos = offset||0; fileDur = t.dur||0;
    if (autoplay!==false) tpStartBufferAt(offset||0); else { tpBuf=null; tpBufPlaying=false; }
    tpSetInfo(t.format + " · đã giải mã " + t.sr + " Hz · " + t.ch + " kênh · " + fmtTime(t.dur) + " · đường AudioBuffer (seek + Loop A–B chính xác)");
  } else {
    tpMode="element"; fileDur = t.dur||0;
    tpSetInfo(t.format + " · đang chờ giải mã — phát tạm bằng đường <audio> (seek + Loop A–B bằng tua lại); khi giải mã xong, bài sẽ dùng đường AudioBuffer ở lần phát sau");
    if (autoplay!==false) tpPlayElementTrack(t);
  }
  tpRenderList(); tpRenderAB(); syncPlayBtn();
}
function tpNextTrack(){ if (!tpTracks.length) return; tpPlayTrack(tpNextIndex(tpIndex, tpTracks.length), 0, true); }
function tpPrevTrack(){ if (!tpTracks.length) return; tpPlayTrack(tpPrevIndex(tpIndex, tpTracks.length), 0, true); }
function tpToggleBuffer(){
  if (tpBufPlaying){
    tpPausedPos = tpBufPos(); tpStopBufferTrack(); syncPlayBtn();
  } else if (tpIndex>=0 && tpTracks[tpIndex] && tpTracks[tpIndex].buffer){
    tpStartBufferAt(tpPausedPos);
  }
  syncPlayBtn();
}
function tpSeekBuffer(t){
  var dur = tpDurCurrent(); if (!isFinite(t) || t<0) t=0; if (t>dur) t=dur;
  if (tpBufPlaying) tpStartBufferAt(t);
  else { tpPausedPos=t; $("tCur").textContent = fmtTime(t); if (dur) $("seek").value = Math.round(t/dur*1000); }
  syncPlayBtn();
}
function tpCurrentPos(){
  if (sourceKind==="file" && tpMode==="buffer") return tpBufPos();
  if (sourceKind==="file") return $("audioEl").currentTime||0;
  return 0;
}
async function tpDecodeTrack(tr, idx){
  if (!AC || !tr.file) return false;
  try{
    var ab = await tr.file.arrayBuffer();
    var buf = await AC.decodeAudioData(ab);
    tr.buffer=buf; tr.decoded=true; tr.dur=buf.duration; tr.sr=buf.sampleRate; tr.ch=buf.numberOfChannels;
    if (idx===tpIndex){ fileDur=buf.duration; $("tDur").textContent = fmtTime(fileDur); tpSetInfo(tr.format + " · đã giải mã " + tr.sr + " Hz · " + tr.ch + " kênh · " + fmtTime(tr.dur) + " · đường AudioBuffer (seek + Loop A–B chính xác)"); }
    tpRenderList(); return true;
  }catch(e){
    tr.decoded=false;
    if (idx===tpIndex && tpMode==="element") tpSetInfo(tr.format + " · trình duyệt không giải mã được bằng decodeAudioData — đang phát bằng đường <audio> (vẫn qua engine DSP)");
    tpRenderList(); return false;
  }
}
async function tpHandleFiles(fileList, opts){
  if (!fileList || !fileList.length) return;
  var ok = await initEngine(); if (!ok) return;
  var playNew = !!(opts && opts.playNew);
  var firstNew = tpTracks.length, added = 0;
  var list = [];
  for (var k=0;k<fileList.length;k++) list.push(fileList[k]);
  for (var j=0;j<list.length;j++){
    var f=list[j];
    var tr={ name:f.name, size:f.size, file:f, buffer:null, decoded:false, format:tpGuessFormat(f.name, f.type), dur:0, sr:0, ch:0 };
    tpTracks.push(tr); added++;
  }
  tpRenderList();
  if (playNew || tpIndex<0){
    await tpDecodeTrack(tpTracks[firstNew], firstNew);
    tpPlayTrack(firstNew, 0, true);
    for (var m=firstNew+1;m<tpTracks.length;m++) tpDecodeTrack(tpTracks[m], m);
  } else {
    for (var m2=firstNew;m2<tpTracks.length;m2++) tpDecodeTrack(tpTracks[m2], m2);
  }
}
$("tpPrev").addEventListener("click", function(){ tpPrevTrack(); });
$("tpNext").addEventListener("click", function(){ tpNextTrack(); });
$("tpSetA").addEventListener("click", function(){
  if (tpIndex<0){ tpSetInfo("Chưa có bài nào — chọn file trước rồi mới đặt điểm A."); return; }
  tpAB.a = tpCurrentPos();
  if (tpAB.b!==null && tpAB.b<=tpAB.a) tpAB.b=null;
  if (tpMode==="buffer" && tpBufPlaying) tpStartBufferAt(tpBufPos());
  tpRenderAB();
});
$("tpSetB").addEventListener("click", function(){
  if (tpIndex<0){ tpSetInfo("Chưa có bài nào — chọn file trước rồi mới đặt điểm B."); return; }
  if (tpAB.a===null){ tpSetInfo("Đặt điểm A trước rồi mới đặt điểm B."); return; }
  var pos = tpCurrentPos(), c = tpClampAB(tpAB.a, pos, tpDurCurrent());
  if (!c.valid){ tpSetInfo("Điểm B phải sau điểm A — vị trí hiện tại không hợp lệ, giữ nguyên A."); return; }
  tpAB.b = pos;
  if (tpMode==="buffer" && tpBufPlaying) tpStartBufferAt(tpBufPos());
  tpRenderAB();
});
$("tpLoop").addEventListener("click", function(){
  tpAB.loop = !tpAB.loop;
  if (tpMode==="buffer" && tpBufPlaying) tpStartBufferAt(tpBufPos());
  tpRenderAB();
});
$("tpClearAB").addEventListener("click", function(){
  var wasLoop = tpAB.loop; tpAB.a=null; tpAB.b=null; tpAB.loop=false;
  if (wasLoop && tpMode==="buffer" && tpBufPlaying) tpStartBufferAt(tpBufPos());
  tpRenderAB();
});
$("tpPanel").addEventListener("dragover", function(e){ e.preventDefault(); });
$("tpPanel").addEventListener("drop", function(e){
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) tpHandleFiles(e.dataTransfer.files, { playNew: tpTracks.length===0 });
});
function tpSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  ck(tpGuessFormat("song.flac","")==="FLAC");
  ck(tpGuessFormat("A.MP3","")==="MP3");
  ck(tpGuessFormat("x.wav","")==="WAV");
  ck(tpGuessFormat("x.m4a","")==="AAC");
  ck(tpGuessFormat("noext","audio/mpeg")==="MP3");
  ck(tpGuessFormat("noext","")==="Âm thanh");
  var c1=tpClampAB(10,50,120); ck(c1.valid && c1.a===10 && c1.b===50);
  var c2=tpClampAB(-5,200,120); ck(c2.valid && c2.a===0 && c2.b===120);
  ck(!tpClampAB(50,50,120).valid);
  ck(!tpClampAB(80,30,120).valid);
  ck(!tpClampAB(NaN,50,120).valid);
  ck(!tpClampAB(10,50,0).valid);
  ck(tpWrapPos(130,10,50)===10);
  ck(tpWrapPos(49,10,50)===49);
  ck(tpWrapPos(50,10,50)===10);
  ck(tpWrapPos(5,10,50)===5);
  ck(tpNextIndex(2,3)===0);
  ck(tpNextIndex(0,1)===0);
  ck(tpNextIndex(-1,0)===-1);
  ck(tpPrevIndex(0,3)===2);
  ck(tpPrevIndex(0,1)===0);
  ck(tpPrevIndex(-1,0)===-1);
  var el=$("tpCheck"); if (el) el.textContent = "PASS " + pass + "/" + total + " — đoán định dạng, kẹp A–B, wrap vị trí loop, chỉ số playlist";
  return { pass:pass, total:total };
}
tpSelfCheck();
/* ---------------- Nguon he thong Nhom 3 v2: getDisplayMedia ----------------
   Am thanh he thong/tab qua MediaStreamSource -> inputBus -> worklet (cung
   chuoi DSP nhu file nhac). Video cua luong chia se khong hien thi, khong
   dung cho DSP; chi lay audio track. Dung chia se tu trinh duyet cung tu
   ngat nguon trong app qua su kien ended cua audio track. */
var sysStream=null, sysSrc=null, sysPlaying=false;
function sysHasAudioTrack(kinds){
  if (!kinds || !kinds.length) return false;
  for (var i=0;i<kinds.length;i++) if (kinds[i]==="audio") return true;
  return false;
}
function sysCountAudioTracks(kinds){
  var n=0; if (!kinds) return 0;
  for (var i=0;i<kinds.length;i++) if (kinds[i]==="audio") n++;
  return n;
}
function sysSetInfo(msg){ var el=$("sysInfo"); if (el) el.textContent = msg; }
function sysStop(){
  if (sysSrc){ try{ sysSrc.disconnect(); }catch(e){} sysSrc=null; }
  if (sysStream){ var tr=sysStream.getTracks(); for (var i=0;i<tr.length;i++){ try{ tr[i].stop(); }catch(e){} } sysStream=null; }
  if (sysPlaying || sourceKind==="sys"){ sysPlaying=false; if (sourceKind==="sys") sourceKind=null; syncPlayBtn(); }
  sysSetInfo("Đã dừng âm thanh hệ thống.");
}
function sysOnEnded(){
  sysSrc=null; sysStream=null; sysPlaying=false;
  if (sourceKind==="sys") sourceKind=null;
  sysSetInfo("Trình duyệt đã dừng chia sẻ — nguồn hệ thống đã ngắt.");
  syncPlayBtn();
}
async function sysStart(){
  if (typeof navigator==="undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){
    sysSetInfo("Trình duyệt này không hỗ trợ getDisplayMedia — dùng Chrome trên máy tính để lấy âm thanh hệ thống/tab.");
    return false;
  }
  var ok = await initEngine(); if (!ok) return false;
  if (typeof tpStopBufferTrack==="function") tpStopBufferTrack();
  if (typeof micStop==="function") micStop();
  stopBuffer(); $("audioEl").pause();
  try{
    var stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true });
    var audioTracks = stream.getAudioTracks();
    if (!audioTracks || !audioTracks.length){
      var all = stream.getTracks(); for (var i=0;i<all.length;i++){ try{ all[i].stop(); }catch(e){} }
      sysSetInfo("Luồng chia sẻ không có track âm thanh — khi chọn, nhớ tick “Chia sẻ âm thanh” (tab audio / system audio tuỳ trình duyệt).");
      return false;
    }
    sysStream=stream;
    sysSrc=AC.createMediaStreamSource(stream);
    sysSrc.connect(inputBus);
    sysPlaying=true; sourceKind="sys";
    $("srcKind").textContent = "âm thanh hệ thống (getDisplayMedia)";
    $("trackName").innerHTML = "<b>Âm thanh hệ thống / tab đang chia sẻ</b> — chạy qua engine DSP theo thời gian thực (video của luồng chia sẻ không hiển thị).";
    var at = audioTracks[0];
    if (at && at.addEventListener) at.addEventListener("ended", sysOnEnded);
    sysSetInfo("Đang nhận âm thanh hệ thống · " + audioTracks.length + " track âm thanh · qua engine DSP.");
    syncPlayBtn(); return true;
  }catch(e){
    if (e && e.name==="NotAllowedError") sysSetInfo("Bạn đã huỷ hộp thoại chia sẻ — nguồn hệ thống chưa kết nối.");
    else sysSetInfo("Không lấy được âm thanh hệ thống (" + (e && e.message ? e.message : "lỗi không rõ") + ").");
    return false;
  }
}
async function sysToggle(){ if (sysPlaying) sysStop(); else await sysStart(); }
$("sysAudioBtn").addEventListener("click", function(){ sysToggle(); });
function sysSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  ck(sysHasAudioTrack(["video","audio"])===true);
  ck(sysHasAudioTrack(["video"])===false);
  ck(sysHasAudioTrack([])===false);
  ck(sysHasAudioTrack(null)===false);
  ck(sysCountAudioTracks(["audio","video","audio"])===2);
  ck(sysCountAudioTracks([])===0);
  var sup = (typeof navigator!=="undefined" && navigator.mediaDevices && !!navigator.mediaDevices.getDisplayMedia);
  sysSetInfo("Chưa kết nối · Tự kiểm: PASS " + pass + "/" + total + " · getDisplayMedia " + (sup ? "được hỗ trợ trong trình duyệt này" : "không được hỗ trợ trong trình duyệt này") + " · bấm nút để chọn tab/cửa sổ và tick chia sẻ âm thanh.");
  return { pass:pass, total:total, supported:sup };
}
sysSelfCheck();
/* ---------------- Do dap tuyen Nhom 3 v2: Microphone + Sine Sweep ----------------
   Sweep logarit 20 Hz -> 20 kHz (8 giay, dung makeSweepBuffer co san) phat
   THANG ra loa (khong qua EQ/worklet) de khong nhiem dap tuyen EQ; mic thu
   qua AnalyserNode, bat gia tri tai bin gan tan so quet nhat khi sweep vuot
   qua tung tan so chuan; ket qua chuan hoa ve 0 dB tai 1 kHz vi gain tuyet
   doi cua mic khong biet duoc. Khong tu ap ket qua vao EQ. */
var micStream=null, micSrc=null, micAnalyser=null, micSweepSrc=null, micTimer=null;
var micMeasuring=false, micMeasured=[], micSweepDur=8, micStartCtx=0, micSweepBuf=null;
var micTargets=[20,25,31,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
function micSweepFreq(t, dur, f0, f1){
  if (!isFinite(t) || t<0) t=0; if (!isFinite(dur) || dur<=0) dur=8;
  if (!isFinite(f0) || f0<=0) f0=20; if (!isFinite(f1) || f1<=f0) f1=20000;
  if (t>dur) t=dur;
  return f0*Math.pow(f1/f0, t/dur);
}
function micBinForFreq(freq, fftSize, sampleRate){
  if (!isFinite(freq) || freq<0) freq=0;
  if (!isFinite(fftSize) || fftSize<=0) fftSize=2048;
  if (!isFinite(sampleRate) || sampleRate<=0) sampleRate=48000;
  var bin=Math.round(freq*fftSize/sampleRate);
  var max=Math.floor(fftSize/2)-1;
  if (bin<0) bin=0; if (bin>max) bin=max;
  return bin;
}
function micRmsDb(samples){
  if (!samples || !samples.length) return -100;
  var sum=0; for (var i=0;i<samples.length;i++){ var v=(samples[i]-128)/128; sum+=v*v; }
  var rms=Math.sqrt(sum/samples.length);
  if (!(rms>0) || !isFinite(rms)) return -100;
  var db=20*Math.log10(rms); return db<-100 ? -100 : db;
}
function micDbRel(points){
  /* points: [{f, db}] -> [{f, rel}] chuan hoa ve 0 dB tai diem gan 1 kHz nhat; thieu 1 kHz -> giu nguyen, rel=null */
  var ref=null, best=1e9;
  for (var i=0;i<points.length;i++){
    if (!isFinite(points[i].db)) continue;
    var d=Math.abs(Math.log(points[i].f/1000));
    if (d<best){ best=d; ref=points[i].db; }
  }
  var out=[];
  for (var j=0;j<points.length;j++) out.push({ f:points[j].f, db:points[j].db, rel:(ref===null || !isFinite(points[j].db)) ? null : points[j].db-ref });
  return out;
}
function micSetInfo(msg){ var el=$("micInfo"); if (el) el.textContent = msg; }
function micRenderResult(){
  var el=$("micResult"); if (!el) return;
  if (!micMeasured.length){ el.textContent="—"; return; }
  var rel=micDbRel(micMeasured), parts=[];
  for (var i=0;i<rel.length;i++){
    if (rel[i].rel===null) continue;
    parts.push((rel[i].f>=1000 ? (rel[i].f/1000)+" kHz" : rel[i].f+" Hz") + ": " + (rel[i].rel>=0 ? "+" : "") + rel[i].rel.toFixed(1) + " dB");
  }
  el.textContent = parts.join(" · ") + (micMeasured.length<micTargets.length ? " (chỉ bắt được " + micMeasured.length + "/" + micTargets.length + " điểm)" : "");
}
function micSave(){
  try{ if (typeof localStorage!=="undefined") localStorage.setItem("webAutoEq.mic.v1", JSON.stringify(micMeasured)); }catch(e){}
}
function micLoad(){
  try{
    if (typeof localStorage==="undefined") return;
    var raw=localStorage.getItem("webAutoEq.mic.v1"); if (!raw) return;
    var arr=JSON.parse(raw);
    if (!arr || !arr.length) return;
    /* Pha C 2026-11-05: ve sinh diem do mic khi khoi phuc tu localStorage —
       truoc day gan tho: JSON ban (f/db null, chuoi rac, 1e999) lot thang vao
       micMeasured roi micDbRel hien diem gia ("null Hz", "abc Hz") vi bay
       isFinite(null)===true / isFinite("")===true keo null/chuoi rong ve 0,
       dong "da khoi phuc N diem" dem ca diem gia, va muc {f:1000, db:null}
       chan do lai tan so do trong micCaptureUpTo (f===f). Chi giu muc la
       object co f, db parseFloat duoc so huu han, f trong [20, 20000] Hz
       (luoi micTargets), db trong [-200, 50] dBFS; muc xau bo qua, khong
       con muc tot thi khong khoi phuc gi. */
    var good=[];
    for (var i=0;i<arr.length;i++){
      var it=arr[i]; if (!it || typeof it!=="object") continue;
      var fv=parseFloat(it.f), dv=parseFloat(it.db);
      if (!isFinite(fv) || !isFinite(dv)) continue;
      if (fv<20 || fv>20000 || dv<-200 || dv>50) continue;
      good.push({ f:fv, db:dv });
    }
    if (!good.length){ micSetInfo("Dữ liệu đo mic đã lưu không hợp lệ — đã bỏ qua, bấm nút đo để đo lại."); return; }
    micMeasured=good; micRenderResult();
    micSetInfo("Đã khôi phục kết quả đo lần trước (" + good.length + " điểm" + (good.length<arr.length ? ", đã bỏ " + (arr.length-good.length) + " điểm hỏng" : "") + ") — bấm nút đo để đo lại.");
  }catch(e){}
}
function micCaptureUpTo(freqNow){
  if (!micAnalyser || !micSweepBuf) return;
  var freqData=new Float32Array(micAnalyser.frequencyBinCount);
  try{ micAnalyser.getFloatFrequencyData(freqData); }catch(e){ return; }
  for (var i=0;i<micTargets.length;i++){
    var f=micTargets[i], done=false;
    for (var j=0;j<micMeasured.length;j++) if (micMeasured[j].f===f) done=true;
    if (done || f>freqNow) continue;
    var bin=micBinForFreq(f, micAnalyser.fftSize, displayFs||48000);
    var v=freqData[bin];
    if (isFinite(v)) micMeasured.push({ f:f, db:v });
  }
  micMeasured.sort(function(a,b){ return a.f-b.f; });
}
function micStop(finished){
  if (micTimer){ clearInterval(micTimer); micTimer=null; }
  if (micSweepSrc){ try{ micSweepSrc.onended=null; micSweepSrc.stop(); }catch(e){} micSweepSrc=null; }
  if (micSrc){ try{ micSrc.disconnect(); }catch(e){} micSrc=null; }
  if (micStream){ var tr=micStream.getTracks(); for (var i=0;i<tr.length;i++){ try{ tr[i].stop(); }catch(e){} } micStream=null; }
  var was=micMeasuring; micMeasuring=false;
  if (was){
    if (finished) micCaptureUpTo(20000);
    micRenderResult(); micSave();
    micSetInfo(finished ? ("Đo xong — bắt được " + micMeasured.length + "/" + micTargets.length + " điểm, đã chuẩn hoá về 0 dB tại 1 kHz (điểm gần 1 kHz nhất nếu thiếu đúng 1 kHz).") : ("Đã dừng đo giữa chừng — giữ " + micMeasured.length + " điểm đã bắt được."));
    syncPlayBtn();
  }
}
async function micStart(){
  if (micMeasuring){ micStop(false); return false; }
  if (typeof navigator==="undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    micSetInfo("Trình duyệt này không hỗ trợ getUserMedia — không đo được bằng microphone.");
    return false;
  }
  var ok = await initEngine(); if (!ok) return false;
  if (typeof tpStopBufferTrack==="function") tpStopBufferTrack();
  if (typeof sysStop==="function") sysStop();
  stopBuffer(); $("audioEl").pause();
  try{
    var stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false }, video:false });
    micStream=stream;
    micAnalyser=AC.createAnalyser(); micAnalyser.fftSize=2048; micAnalyser.smoothingTimeConstant=0.3;
    micSrc=AC.createMediaStreamSource(stream); micSrc.connect(micAnalyser);
    micMeasured=[]; micMeasuring=true; sourceKind="mic";
    $("srcKind").textContent = "đo bằng microphone";
    $("trackName").innerHTML = "<b>Đang đo đáp tuyến bằng microphone</b> — sweep 20 Hz → 20 kHz phát thẳng ra loa (không qua EQ), microphone thu và bắt điểm theo tần số quét.";
    micSweepBuf = (typeof makeSweepBuffer==="function") ? makeSweepBuffer() : null;
    if (!micSweepBuf){ micStop(false); micSetInfo("Không tạo được sweep đo — thử lại."); return false; }
    micSweepSrc=AC.createBufferSource(); micSweepSrc.buffer=micSweepBuf;
    var g=AC.createGain(); g.gain.value=0.35;
    micSweepSrc.connect(g); g.connect(AC.destination);
    micStartCtx=AC.currentTime;
    micSweepSrc.start();
    micSetInfo("Đang đo… 0% · chờ sweep.");
    micTimer=setInterval(function(){
      if (!micMeasuring) return;
      var el=AC.currentTime-micStartCtx;
      var fNow=micSweepFreq(el, micSweepDur, 20, 20000);
      micCaptureUpTo(fNow);
      var td=new Uint8Array(micAnalyser.fftSize);
      try{ micAnalyser.getByteTimeDomainData(td); }catch(e){}
      var lvl=micRmsDb(td);
      micSetInfo("Đang đo… " + Math.min(100, Math.round(el/micSweepDur*100)) + "% · quét tới " + (fNow>=1000 ? (fNow/1000).toFixed(1)+" kHz" : Math.round(fNow)+" Hz") + " · mức mic " + lvl.toFixed(0) + " dBFS · đã bắt " + micMeasured.length + "/" + micTargets.length + " điểm.");
      if (el>=micSweepDur+0.3) micStop(true);
    }, 50);
    syncPlayBtn(); return true;
  }catch(e){
    if (e && e.name==="NotAllowedError") micSetInfo("Bạn đã từ chối quyền microphone — đo chưa bắt đầu.");
    else micSetInfo("Không mở được microphone (" + (e && e.message ? e.message : "lỗi không rõ") + ").");
    return false;
  }
}
$("micBtn").addEventListener("click", function(){ if (micMeasuring) micStop(false); else micStart(); });
$("micClearBtn").addEventListener("click", function(){
  micStop(false); micMeasured=[];
  try{ if (typeof localStorage!=="undefined") localStorage.removeItem("webAutoEq.mic.v1"); }catch(e){}
  micRenderResult(); micSetInfo("Đã xoá kết quả đo.");
});
function micSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  ck(micSweepFreq(0,8,20,20000)===20);
  ck(Math.abs(micSweepFreq(8,8,20,20000)-20000)<1e-9);
  ck(Math.abs(micSweepFreq(4,8,20,20000)-632.4555)<0.01);
  ck(micSweepFreq(-1,8,20,20000)===20);
  ck(micSweepFreq(99,8,20,20000)===20000);
  ck(micBinForFreq(1000,2048,48000)===43);
  ck(micBinForFreq(20000,2048,48000)===853);
  ck(micBinForFreq(0,2048,48000)===0);
  ck(micBinForFreq(999999,2048,48000)===1023);
  var rel=micDbRel([{f:100,db:-50},{f:1000,db:-40},{f:10000,db:-45}]);
  ck(rel[0].rel===-10 && rel[1].rel===0 && rel[2].rel===-5);
  ck(micDbRel([{f:100,db:-50}])[0].rel===0);
  var silent=new Uint8Array(1024); silent.fill(128);
  ck(micRmsDb(silent)===-100);
  var loud=new Uint8Array(4); loud[0]=0; loud[1]=255; loud[2]=0; loud[3]=255;
  ck(Math.abs(micRmsDb(loud)-0)<0.05); /* byte 255 -> (255-128)/128 = 0,9921875 nen RMS that la -0,034 dB, khong phai 0 — sua ky vong kiem thu theo luong tu hoa byte, khong sua ham do */
  var el=$("micCheck"); if (el) el.textContent = "PASS " + pass + "/" + total + " — ánh xạ sweep, bin analyser, chuẩn hoá 1 kHz, mức RMS";
  return { pass:pass, total:total };
}
micSelfCheck();
micLoad();
/* ---------------- Dong bo phan cung Nhom 3 v2: WebUSB/WebSerial/WebHID ----------------
   Khung nhi phan: [0xAA, 0x55, count] + moi band 8 byte (freq u16 LE, gain
   i16 LE don vi 0,01 dB, Q u16 LE don vi 0,01, type u8, on u8) + checksum
   (tong cac byte truoc mod 256). Truoc khi gui, khung luon parse-back de
   kiem checksum. Gui chi khi bam tay — khong tu dong gui khi chinh EQ. */
var hwTransport=null, hwSimSent=[];
function hwTypeCode(t){
  if (t==="lowshelf") return 1;
  if (t==="highshelf") return 2;
  if (t==="lowpass") return 3;
  if (t==="highpass") return 4;
  if (t==="notch") return 5;
  if (t==="bandpass") return 6;
  return 0; /* peaking va moi loai khong biet -> 0; chi 3 loai nay co trong app */
}
function hwTypeName(c){
  if (c===0) return "peaking";
  if (c===1) return "lowshelf";
  if (c===2) return "highshelf";
  if (c===3) return "lowpass";
  if (c===4) return "highpass";
  if (c===5) return "notch";
  if (c===6) return "bandpass";
  return null;
}
function hwClampInt(v, lo, hi, def){
  if (!isFinite(v)) return def;
  v=Math.round(v); if (v<lo) return lo; if (v>hi) return hi; return v;
}
function hwBuildFrame(bandList){
  var list = bandList||[];
  var n = Math.min(list.length, 31);
  var out = new Uint8Array(3 + 8*n + 1);
  out[0]=0xAA; out[1]=0x55; out[2]=n;
  for (var i=0;i<n;i++){
    var b=list[i]||{};
    var freq=hwClampInt(b.freq, 20, 20000, 1000);
    var gain=hwClampInt((isFinite(b.gain) ? b.gain : 0)*100, -3000, 3000, 0);
    var q=hwClampInt((isFinite(b.q) ? b.q : 1)*100, 10, 2000, 100);
    var o=3+8*i;
    out[o]=freq&0xFF; out[o+1]=(freq>>8)&0xFF;
    var g=gain<0 ? gain+65536 : gain;
    out[o+2]=g&0xFF; out[o+3]=(g>>8)&0xFF;
    out[o+4]=q&0xFF; out[o+5]=(q>>8)&0xFF;
    out[o+6]=hwTypeCode(b.type); out[o+7]=b.on ? 1 : 0;
  }
  var sum=0; for (var k=0;k<out.length-1;k++) sum=(sum+out[k])&0xFF;
  out[out.length-1]=sum;
  return out;
}
function hwParseFrame(bytes){
  if (!bytes || bytes.length<4) return null;
  if (bytes[0]!==0xAA || bytes[1]!==0x55) return null;
  var n=bytes[2];
  if (bytes.length!==3+8*n+1) return null;
  var sum=0; for (var i=0;i<bytes.length-1;i++) sum=(sum+bytes[i])&0xFF;
  if (sum!==bytes[bytes.length-1]) return null;
  var bands=[];
  for (var j=0;j<n;j++){
    var o=3+8*j;
    var freq=bytes[o]|(bytes[o+1]<<8);
    var gr=bytes[o+2]|(bytes[o+3]<<8); if (gr>=32768) gr-=65536;
    var q=bytes[o+4]|(bytes[o+5]<<8);
    var type=hwTypeName(bytes[o+6]); if (type===null) return null;
    if (bytes[o+7]!==0 && bytes[o+7]!==1) return null;
    bands.push({ freq:freq, gain:gr/100, q:q/100, type:type, on:bytes[o+7]===1 });
  }
  return bands;
}
function hwCurrentFrame(){ return hwBuildFrame((typeof bands!=="undefined") ? bands : []); }
function hwSetInfo(msg){ var el=$("hwInfo"); if (el) el.textContent = msg; }
function hwDisconnect(){
  if (hwTransport && hwTransport.close){ try{ hwTransport.close(); }catch(e){} }
  hwTransport=null; hwSetInfo("Đã ngắt kết nối thiết bị.");
}
async function hwSendCurrent(){
  if (!hwTransport){ hwSetInfo("Chưa kết nối thiết bị — bấm kết nối (USB/Serial/HID) hoặc dùng thiết bị mô phỏng trước."); return false; }
  var frame=hwCurrentFrame();
  var back=hwParseFrame(frame);
  if (!back){ hwSetInfo("Lỗi nội bộ: khung vừa dựng không qua được kiểm tra parse-back — không gửi."); return false; }
  try{
    var ok=await hwTransport.send(frame);
    if (ok) hwSetInfo("Đã gửi " + back.length + " band (" + frame.length + " byte, checksum OK) qua " + hwTransport.label + ".");
    else hwSetInfo("Thiết bị từ chối khung — chưa gửi thành công qua " + hwTransport.label + ".");
    return !!ok;
  }catch(e){
    hwSetInfo("Gửi thất bại qua " + hwTransport.label + " (" + (e && e.message ? e.message : "lỗi không rõ") + ").");
    return false;
  }
}
async function hwConnectUsb(){
  if (typeof navigator==="undefined" || !navigator.usb){ hwSetInfo("Trình duyệt này không hỗ trợ WebUSB — dùng Chrome trên máy tính."); return false; }
  try{
    var dev=await navigator.usb.requestDevice({ filters:[] });
    await dev.open();
    if (dev.configuration===null) await dev.selectConfiguration(1);
    var ep=null, ifaceNum=null;
    var ifaces=dev.configuration.interfaces;
    for (var i=0;i<ifaces.length && !ep;i++){
      var alt=ifaces[i].alternate;
      if (!alt || !alt.endpoints) continue;
      for (var j=0;j<alt.endpoints.length;j++){
        if (alt.endpoints[j].direction==="out"){ ep=alt.endpoints[j].endpointNumber; ifaceNum=ifaces[i].interfaceNumber; break; }
      }
    }
    if (!ep){ hwSetInfo("Thiết bị USB không có endpoint OUT — không gửi được EQ qua USB."); return false; }
    await dev.claimInterface(ifaceNum);
    hwTransport={ kind:"usb", label:"WebUSB (" + (dev.productName||"thiết bị USB") + ")",
      send: async function(frame){ await dev.transferOut(ep, frame); return true; },
      close: function(){ try{ dev.close(); }catch(e){} } };
    hwSetInfo("Đã kết nối WebUSB: " + (dev.productName||"thiết bị USB") + " — bấm “Gửi EQ hiện tại” để đồng bộ.");
    return true;
  }catch(e){
    if (e && e.name==="NotFoundError") hwSetInfo("Bạn đã huỷ hộp thoại chọn thiết bị USB.");
    else hwSetInfo("Không kết nối được WebUSB (" + (e && e.message ? e.message : "lỗi không rõ") + ").");
    return false;
  }
}
async function hwConnectSerial(){
  if (typeof navigator==="undefined" || !navigator.serial){ hwSetInfo("Trình duyệt này không hỗ trợ WebSerial — dùng Chrome trên máy tính."); return false; }
  try{
    var port=await navigator.serial.requestPort();
    await port.open({ baudRate:115200 });
    var writer=port.writable.getWriter();
    hwTransport={ kind:"serial", label:"WebSerial (115200 baud)",
      send: async function(frame){ await writer.write(frame); return true; },
      close: function(){ try{ writer.releaseLock(); }catch(e){} try{ port.close(); }catch(e2){} } };
    hwSetInfo("Đã kết nối WebSerial (115200 baud) — bấm “Gửi EQ hiện tại” để đồng bộ.");
    return true;
  }catch(e){
    if (e && e.name==="NotFoundError") hwSetInfo("Bạn đã huỷ hộp thoại chọn cổng Serial.");
    else hwSetInfo("Không kết nối được WebSerial (" + (e && e.message ? e.message : "lỗi không rõ") + ").");
    return false;
  }
}
async function hwConnectHid(){
  if (typeof navigator==="undefined" || !navigator.hid){ hwSetInfo("Trình duyệt này không hỗ trợ WebHID — dùng Chrome trên máy tính."); return false; }
  try{
    var devs=await navigator.hid.requestDevice({ filters:[] });
    if (!devs || !devs.length){ hwSetInfo("Bạn đã huỷ hộp thoại chọn thiết bị HID."); return false; }
    var dev=devs[0]; await dev.open();
    hwTransport={ kind:"hid", label:"WebHID (" + (dev.productName||"thiết bị HID") + ")",
      send: async function(frame){ await dev.sendReport(0, frame); return true; },
      close: function(){ try{ dev.close(); }catch(e){} } };
    hwSetInfo("Đã kết nối WebHID: " + (dev.productName||"thiết bị HID") + " — bấm “Gửi EQ hiện tại” để đồng bộ (khung dài hơn giới hạn report của thiết bị có thể bị từ chối).");
    return true;
  }catch(e){
    if (e && e.name==="NotFoundError") hwSetInfo("Bạn đã huỷ hộp thoại chọn thiết bị HID.");
    else hwSetInfo("Không kết nối được WebHID (" + (e && e.message ? e.message : "lỗi không rõ") + ").");
    return false;
  }
}
function hwConnectSim(){
  hwSimSent=[];
  hwTransport={ kind:"sim", label:"thiết bị mô phỏng",
    send: async function(frame){ var back=hwParseFrame(frame); if (!back) return false; hwSimSent.push(frame); return true; },
    close: function(){} };
  hwSetInfo("Đã kết nối thiết bị mô phỏng — bấm “Gửi EQ hiện tại” để kiểm tra khung giao thức (không gửi ra phần cứng thật).");
  return true;
}
$("hwUsbBtn").addEventListener("click", function(){ hwConnectUsb(); });
$("hwSerBtn").addEventListener("click", function(){ hwConnectSerial(); });
$("hwHidBtn").addEventListener("click", function(){ hwConnectHid(); });
$("hwSimBtn").addEventListener("click", function(){ hwConnectSim(); });
$("hwSendBtn").addEventListener("click", function(){ hwSendCurrent(); });
$("hwDiscBtn").addEventListener("click", function(){ hwDisconnect(); });
function hwSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  var src=[{freq:31,type:"lowshelf",gain:2.5,q:0.71,on:true},{freq:1000,type:"peaking",gain:-3.25,q:1.41,on:true},{freq:16000,type:"highshelf",gain:0,q:0.71,on:false}];
  var fr=hwBuildFrame(src), back=hwParseFrame(fr);
  ck(!!back && back.length===3);
  ck(back[0].freq===31 && back[0].gain===2.5 && back[0].q===0.71 && back[0].type==="lowshelf" && back[0].on===true);
  ck(back[1].freq===1000 && back[1].gain===-3.25 && back[1].q===1.41 && back[1].type==="peaking");
  ck(back[2].freq===16000 && back[2].gain===0 && back[2].on===false);
  ck(fr[0]===0xAA && fr[1]===0x55 && fr[2]===3);
  ck(fr.length===3+8*3+1);
  var ten=[]; for (var i=0;i<10;i++) ten.push({freq:1000+i,type:"peaking",gain:0,q:1,on:true});
  ck(hwBuildFrame(ten).length===3+8*10+1);
  var edge=hwParseFrame(hwBuildFrame([{freq:999999,type:"peaking",gain:NaN,q:0.001,on:true}]));
  ck(!!edge && edge[0].freq===20000 && edge[0].gain===0 && edge[0].q===0.1);
  ck(hwTypeCode("lowshelf")===1 && hwTypeCode("highshelf")===2 && hwTypeCode("peaking")===0 && hwTypeCode("khong-co")===0);
  var bad=new Uint8Array(fr); bad[5]=(bad[5]+1)&0xFF;
  ck(hwParseFrame(bad)===null);
  ck(hwParseFrame(fr.slice(0, fr.length-1))===null);
  var badH=new Uint8Array(fr); badH[0]=0x00;
  ck(hwParseFrame(badH)===null);
  var badT=new Uint8Array(fr); badT[3+6]=99; var s2=0; for (var k=0;k<badT.length-1;k++) s2=(s2+badT[k])&0xFF; badT[badT.length-1]=s2;
  ck(hwParseFrame(badT)===null);
  ck(hwParseFrame(new Uint8Array(0))===null);
  ck(hwParseFrame(hwBuildFrame([]))!==null && hwParseFrame(hwBuildFrame([])).length===0);
  var el=$("hwCheck"); if (el) el.textContent = "PASS " + pass + "/" + total + " — dựng/parse khung, kẹp biên, checksum, loại band, độ dài khung";
  return { pass:pass, total:total };
}
hwSelfCheck();
/* ---------------- Spectrogram / RTA Nhom 4 v2 ----------------
   Pho truc tiep tu analyser cua engine (FFT 2048), truc tan logarit
   20 Hz – 20 kHz. Spectrogram: cuon trai 1 cot/khung, mau theo dB
   (-90…0). RTA: 239 band 1/24-octave, trung binh cong suat tuyen tinh
   trong band roi doi ra dB. Chi ve khi bat; tat la dung vong ve. */
var specOn=false, specMode="spec", specRaf=0;
/* Pha C (2026-11-05): cache trung tam band RTA — cac trung tam la hang so
   (239 diem 1/24-octave, 20 Hz-20 kHz), truoc day specDraw() tinh lai
   (239 phep pow + 1 mang moi) moi khung RTA 60fps. Cache 1 lan, dong bang
   (freeze) roi tra lai cung mang cho moi lan goi; khong noi goi nao sua
   mang tra ve (chi doc length/[i] o specDraw va specSelfCheck) nen ket
   qua ve so hoc khong doi va cache khong the bi nhiem ban. */
var _specCenters=null;
function specBandCenters(){
  if (_specCenters) return _specCenters;
  var out=[];
  for (var k=-135;k<=103;k++){
    var f=1000*Math.pow(2, k/24);
    if (f>=20 && f<=20000) out.push(f);
  }
  _specCenters=Object.freeze(out);
  return _specCenters;
}
function specNormDb(db){
  if (!isFinite(db)) return 0;
  var v=(db+90)/90;
  if (v<0) return 0; if (v>1) return 1; return v;
}
var _specBinCache = {}, _specBinCount = 0;
function specBandDb(freqData, fftSize, sampleRate, fc){
  if (!freqData || !freqData.length) return null;
  if (!isFinite(fftSize) || fftSize<=0) fftSize=2048;
  if (!isFinite(sampleRate) || sampleRate<=0) sampleRate=48000;
  var _bk = fftSize + "|" + sampleRate + "|" + fc;
  var _br = _specBinCache[_bk];
  var i0, i1;
  if (_br){ i0 = _br[0]; i1 = Math.min(freqData.length-1, _br[1]); }
  else {
    var lo=fc*Math.pow(2, -1/48), hi=fc*Math.pow(2, 1/48);
    var binHz=sampleRate/fftSize;
    i0=Math.max(0, Math.floor(lo/binHz));
    i1=Math.ceil(hi/binHz);
    if (_specBinCount > 8192){ _specBinCache = {}; _specBinCount = 0; }
    _specBinCache[_bk] = [i0, i1]; _specBinCount++;
    i1=Math.min(freqData.length-1, i1);
  }
  if (i1<i0) return null;
  var sum=0, n=0;
  for (var i=i0;i<=i1;i++){
    if (!isFinite(freqData[i])) continue;
    sum+=Math.pow(10, freqData[i]/10); n++;
  }
  if (!n) return null;
  return 10*Math.log10(sum/n);
}
/* Ban toi uu toc do ve RTA (2026-11-05): khoang bin theo trung tam band chi
   phu thuoc (fftSize, sampleRate) — tinh 1 lan cho ca 239 band roi tra lai
   cung mang; moi khung RTA chi tra cuu mang thay vi xay chuoi khoa
   fftSize|sampleRate|fc va tra hash 239 lan trong specBandDb. Khoang [i0, i1]
   giong het nhanh cache-miss cua specBandDb (cung bieu thuc), chi chua kep
   theo do dai freqData — viec kep giu nguyen o cho dung nen ket qua giong het. */
var _specBandRanges = {};
function specBandRanges(fftSize, sampleRate){
  if (!isFinite(fftSize) || fftSize<=0) fftSize=2048;
  if (!isFinite(sampleRate) || sampleRate<=0) sampleRate=48000;
  var k = fftSize + "|" + sampleRate;
  var r = _specBandRanges[k];
  if (r) return r;
  var centers = specBandCenters();
  var binHz = sampleRate/fftSize;
  r = new Array(centers.length);
  for (var i=0;i<centers.length;i++){
    var fc=centers[i];
    var lo=fc*Math.pow(2, -1/48), hi=fc*Math.pow(2, 1/48);
    r[i]=[Math.max(0, Math.floor(lo/binHz)), Math.ceil(hi/binHz)];
  }
  _specBandRanges[k]=r;
  return r;
}
function specYForFreq(f, h){
  if (!isFinite(f) || f<=0) return h;
  var t=Math.log(f/20)/Math.log(1000);
  if (t<0) t=0; if (t>1) t=1;
  return h*(1-t);
}
function specColor(db){
  var v=specNormDb(db);
  var hue=240*(1-v);
  return "hsl(" + hue.toFixed(0) + ",90%," + (20+40*v).toFixed(0) + "%)";
}
function specSetInfo(){
  var el=$("specInfo"); if (!el) return;
  el.textContent = (specMode==="spec" ? "Spectrogram" : "RTA 1/24-octave (239 band)") + " · dải 20 Hz – 20 kHz · analyser FFT 2048 · " + (specOn ? "đang vẽ" : "đang tắt");
}
function specSetState(on){
  specOn=on;
  var st=$("specState"), tg=$("specToggle");
  if (on && (typeof analyser==="undefined" || !analyser)){
    specOn=false;
    if (st) st.textContent="Cần engine đang chạy — bấm nguồn phát trước rồi bật lại";
    if (tg) tg.textContent="Bật Spectrogram";
    specSetInfo(); return;
  }
  if (st) st.textContent = on ? ((specMode==="spec" ? "Spectrogram" : "RTA") + " đang chạy") : "Đang tắt";
  if (tg) tg.textContent = on ? "Tắt Spectrogram/RTA" : "Bật Spectrogram";
  if (on){ if (specRaf) cancelAnimationFrame(specRaf); specRaf=requestAnimationFrame(specDraw); }
  else if (specRaf){ cancelAnimationFrame(specRaf); specRaf=0; }
  specSetInfo();
}
var _specCtx=null, _specCv=null, _specFd=null, _specLut=null, _specCol=null, _specColCtx=null, _specImg=null, _specRowBins=null;
function specColorLut(){
  if (_specLut) return _specLut;
  var lut=new Array(256);
  for (var i=0;i<256;i++){
    var v=i/255, hue=240*(1-v), li=(20+40*v)/100;
    var c=(1-Math.abs(2*li-1))*0.9, x=c*(1-Math.abs(((hue/60)%2)-1)), m=li-c/2, r=0, g=0, b=0;
    if (hue<60){ r=c; g=x; } else if (hue<120){ r=x; g=c; } else if (hue<180){ g=c; b=x; }
    else if (hue<240){ g=x; b=c; } else if (hue<300){ r=x; b=c; } else { r=c; b=x; }
    lut[i]=[Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
  }
  _specLut=lut; return lut;
}
/* Pha B (2026-11-05): bang chuoi fill cho RTA — suy ra tu specColorLut (cung
   256 muc luong tu hoa) de RTA va Spectrogram dung chung 1 bang mau; moi khung
   chi tra cuu chuoi co san thay vi tao chuoi hsl() moi band (239 lan/khung). */
var _specFillLut=null;
function specFillLut(){
  if (_specFillLut) return _specFillLut;
  var lut=specColorLut(), out=new Array(256);
  for (var i=0;i<256;i++){ var rgb=lut[i]; out[i]="rgb("+rgb[0]+","+rgb[1]+","+rgb[2]+")"; }
  _specFillLut=out; return out;
}
/* --- Vòng tự động 17:09, hướng D (ÁP DỤNG): bảng tra specPowLut cho
   vòng RTA của specDraw — 10^(db/10) lượng tử hoá bước 0,05 dB trên
   [-120, 0] (4001 mục) thay Math.pow mỗi bin mỗi khung. Lab Node trên
   hàm thật (3 lần chạy, 7 fixture fd x 239 band, 5 vòng x 2000 khung):
   tốc độ khung RTA 0,0617 -> 0,0254 ms (nhanh 2,43x, ổn định cả 3 lần;
   dựng LUT một lần 0,55-0,85 ms); sai số vẽ tối đa 0,024 dB / 0,07 px
   (H=260), 7/1673 band lệch 1 bước màu (RGB <= 3) — dưới ngưỡng hiển
   thị; không band nào mất/khác. Dải [-120, 0] rộng hơn dải thật của
   analyser (minDecibels -100) nên bin rất nhỏ không bị kẹp lên 1e-10
   (bản LUT [-100, 0] đầu tiên lệch tới 0,070 dB ở band gần -89 dB
   trên fixture stress có giá trị < -100 nên đã mở rộng dải). Không
   chạm specBandDb (đo chính xác), solver, WASM, FIR hay QA. Ý tưởng
   lượt kế: hướng C — rà soát upSelfCheck1..6 trên lưới phon; hoặc
   hướng D — đo lại tốc độ dựng FIR sau vá 16:41. --- */
/* Bang tra cong suat tuyen tinh theo dB (vong tu dong 17:09, huong D):
   10^(db/10) luong tu hoa buoc 0,05 dB tren [-120, 0] (4001 muc), dung
   chung cho vong RTA moi khung thay vi Math.pow moi bin. Sai so toi da
   0,025 dB/bin, sau trung binh band <= 0,025 dB — duoi 1 buoc mau
   (90/255 = 0,35 dB) va duoi 0,1 px chieu cao (H=260) nen hinh ve
   thuc te khong doi; dai [-120, 0] rong hon dai that cua analyser
   (minDecibels mac dinh -100) de bin rat nho khong bi kep len 1e-10,
   gia tri ngoai dai duoc kep bien. */
var _specPowLut=null;
function specPowLut(){
  if (_specPowLut) return _specPowLut;
  var lut=new Float64Array(4001);
  for (var i=0;i<=4000;i++) lut[i]=Math.pow(10, (-120+i*0.05)/10);
  _specPowLut=lut; return lut;
}
/* --- Vòng tự động 18:43, hướng D (ÁP DỤNG): duyệt bin một lượt duy nhất
   trong nhánh RTA của specDraw — map bin->bands qua specBinBands (cache theo
   fftSize|fs|nbins, 1025 bin, 242 bin thuộc >1 band, tối đa 39 band/bin):
   lượng tử hoá + tra powLut 1 lần/bin (1025 thay vì 1325 lần thăm band), cộng
   dồn vào từng band theo đúng thứ tự bin tăng dần nên tổng từng band giống
   từng bit với bản gốc. Lab Node trên hàm thật (2 lần chạy, 5 fixture fd x
   239 band, 3 vòng x 2000 khung): 1,048 -> 0,807 ms/khung (1,30x, lần 1) và
   0,949 -> 0,791 ms/khung (1,20x, lần 2), ổn định cả 5 fixture; chữ ký
   fillRect giống từng bit (max ΔdB = 0 trên cả 5 fixture, 240 rect/khung,
   0 styleDiff). Không áp biến thể A (Math.log thay log10): chỉ 1,00-1,09x,
   nhiễu — để làm ý tưởng lượt kế. Không chạm specBandDb (đo chính xác),
   solver, WASM, FIR hay QA. Ý tưởng lượt kế: hướng D — đo lại Math.log thay
   log10 trong nhánh RTA (biến thể A) hoặc gán fillStyle chỉ khi màu đổi;
   hoặc hướng C — rà soát upSelfCheck1..6 trên lưới phon. --- */
/* --- Vòng tự động 18:51, hướng D (ÁP DỤNG): gán fillStyle chỉ khi màu đổi
   trong vòng band RTA của specDraw — nhớ lastCi (khởi tạo -1; nền "#0a0c0f"
   gán trước vòng band, ci luôn 0..255 nên band đầu tiên luôn gán): chỉ gán
   ctx.fillStyle=fillLut[ci] khi ci khác band trước, vì trên phổ mượt nhiều
   band kề nhau có cùng chỉ số màu lượng tử nên phần lớn lần gán là thừa
   (trình duyệt phải parse lại cùng chuỗi "rgb(r,g,b)" mỗi lần). Lab Node
   trên hàm thật (2 lần chạy, 5 fixture fd x 239 band, 3 vòng x 2000 khung):
   0,800 -> 0,572 ms/khung (1,40x, lần 1) và 0,785 -> 0,543 ms/khung (1,45x,
   lần 2); số lần gán fillStyle/khung 240 -> 2 (flat), 92 (slope), 146
   (music), 12 (stress), 5 (silence+tone); chữ ký fillRect giống từng bit
   (240 rect/khung, 0 styleDiff, max ΔdB = 0 trên cả 5 fixture). Không chạm
   specBandDb (đo chính xác), solver, WASM, FIR hay QA. Ý tưởng lượt kế:
   hướng C — rà soát upSelfCheck1..6 trên lưới phon; hoặc hướng D — đo lại
   biến thể A (Math.log thay log10) trong nhánh RTA sau khi vòng band đã nhẹ
   hơn. --- */
/* Bang tra bin -> danh sach band RTA chua bin do (vong tu dong 18:43, huong D):
   xay 1 lan theo (fftSize, sampleRate, so bin), dung chung moi khung RTA.
   Khoang [i0, i1] giong het specBandRanges (cung bieu thuc), chi kep i1 theo
   so bin cua freqData — viec kep giu nguyen o cho dung nen ket qua giong het;
   tong cong don theo thu tu bin tang dan nen giong tung bit voi vong long
   nhau cu. sums/cnts tai su dung moi khung (fill(0)), khong cap phat moi. */
var _specBinBands = {};
function specBinBands(fftSize, sampleRate, nbins){
  if (!isFinite(fftSize) || fftSize<=0) fftSize=2048;
  if (!isFinite(sampleRate) || sampleRate<=0) sampleRate=48000;
  if (!isFinite(nbins) || nbins<=0) nbins=1024;
  var k = fftSize + "|" + sampleRate + "|" + nbins;
  var m = _specBinBands[k];
  if (m) return m;
  var ranges = specBandRanges(fftSize, sampleRate);
  var lists = new Array(nbins);
  for (var j=0;j<nbins;j++) lists[j]=[];
  for (var i=0;i<ranges.length;i++){
    var rg=ranges[i], i1=Math.min(nbins-1, rg[1]);
    if (i1<rg[0]) continue;
    for (var j=rg[0];j<=i1;j++) lists[j].push(i);
  }
  m = { lists:lists, nb:nbins, sums:new Float64Array(ranges.length), cnts:new Uint16Array(ranges.length) };
  _specBinBands[k]=m;
  return m;
}
function specDraw(){
  if (!specOn) return;
  if (!_specCv) _specCv=$("specCanvas");
  var cv=_specCv;
  if (cv){
    if (!_specCtx) _specCtx=cv.getContext("2d");
    var ctx=_specCtx;
    if (ctx && typeof analyser!=="undefined" && analyser){
      var W=cv.width, H=cv.height;
      if (!_specFd || _specFd.length!==analyser.frequencyBinCount) _specFd=new Float32Array(analyser.frequencyBinCount);
      var fd=_specFd;
      try{ analyser.getFloatFrequencyData(fd); }catch(e){ fd=null; }
      if (fd){
        if (specMode==="spec"){
          ctx.drawImage(cv, -1, 0);
          if (!_specCol){ _specCol=document.createElement("canvas"); _specCol.width=1; _specColCtx=_specCol.getContext("2d"); }
          if (_specCol.height!==H){ _specCol.height=H; _specImg=_specColCtx.createImageData(1, H); }
          var lut=specColorLut(), data=_specImg.data;
          var _sfs = (displayFs||48000);
          if (!_specRowBins || _specRowBins.H!==H || _specRowBins.fs!==_sfs || _specRowBins.n!==analyser.fftSize){
            var _rb = new Int32Array(H);
            for (var _ry=0;_ry<H;_ry++){
              var _rf=20*Math.pow(1000, 1-_ry/H);
              var _rbin=Math.round(_rf*analyser.fftSize/_sfs);
              if (_rbin<0) _rbin=0; if (_rbin>=fd.length) _rbin=fd.length-1;
              _rb[_ry]=_rbin;
            }
            _specRowBins = { H:H, fs:_sfs, n:analyser.fftSize, bins:_rb };
          }
/* --- Mở rộng 2026-11-09 (vòng tự động 20:35, hướng D): inline lượng tử hoá màu trong vòng hàng
   Spectrogram của specDraw — ÁP DỤNG, có cải thiện. Thay lut[Math.round(specNormDb(fd[bin])*255)]
   bằng tính trực tiếp trong vòng lặp, giữ nguyên thứ tự số học ((db+90)/90 rồi *255, kẹp 0..1,
   (x+0.5)|0 = Math.round với x>=0) nên chỉ số màu giống từng bit; NaN -> 0, -Inf -> 0 như cũ,
   +Inf kẹp riêng về 0 (specNormDb trả 0 do isFinite sai). Lab Node trên hàm thật (lượt 20:35,
   chạy 2 lần, 6 fixture fd x H=260, 3 vòng x 2000 khung, median): bytes putImageData 1040
   giống từng bit cả 6 fixture (0 diff, kể cả fixture edge NaN/+-Inf/-200/+50), draws/puts
   giống hệt; tốc độ khung Spectrogram 0,452 -> 0,253 ms (1,79x, lần 1) và 0,445 -> 0,256 ms
   (1,74x, lần 2), nhanh hơn ở cả 6 fixture cả 2 lần. Lưu ý: số tuyệt đối đo trên mock canvas
   (drawImage/putImageData là no-op) nên trong trình duyệt thật, nơi lệnh canvas chiếm phần
   lớn chi phí khung, lợi ích thực sẽ nhỏ hơn con số lab. Không chạm nhánh RTA, solver, WASM,
   FIR hay QA. Ý tưởng lượt kế: hướng B — đo lại profile 3 pha buildFirTaps sau vá 20:20/20:30;
   hoặc hướng D — đo measureFps/drawGraph trên phổ thật. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 23:18, hướng D): đo specDraw nhánh
   Spectrogram trên phổ thật (ý tưởng treo từ 20:30/20:57) — KHÔNG ÁP VÁ CODE.
   Lab Node trên hàm thật trích verbatim từ file (7 fixture: 6 cũ + mkReal phổ
   nhạc thực tế — pink falloff + đỉnh kick/bass/vocal/air + ripple, giá trị
   trong [-100, 0] dB như analyser thật; 7 vòng x 800 khung/fixture xen kẽ
   xoay thứ tự, cả 2 chế độ spec/rta, 2 file lab 2318/2318b/2318c):
   bytes putImageData giống từng bit cả 7 fixture (diffBytes=0, 1040 byte),
   đổi H 260->200->260 đúng (800/1040 byte, diffBytes=0); RTA rects giống
   hệt (240 rect/khung, 0 styleDiff). V1 ghi 1 lần Uint32 thay 4 lần ghi
   byte: 0,554-0,597x (chậm 1,75x trung bình) — BÁC. V2 Int32 (nghi chuyển
   đổi double do giá trị >2^31): 0,558-0,593x — BÁC, giả thuyết sai. V3
   Int32 + tách nhánh _specLE ra khỏi vòng: 0,661-0,791x — BÁC. V4 Int32 +
   đọc _specU32 vào local trước vòng (nghi đọc global mỗi hàng trong vm):
   0,653-0,782x — BÁC, giả thuyết sai. V5 LUT phẳng Uint8Array(768) thay
   mảng [r,g,b] lồng nhau: 0,933-1,052x theo fixture, trung bình 1,003x —
   BÁC (trong nhiễu; thắng flat-60/real/silence, thua slope/music/stress).
   Chẩn đoán: microbench cô lập vòng hàng (ngoài specDraw) cho u32 nhanh
   hơn gốc 4,58x và LUT phẳng 2,39x, nhưng trong specDraw đầy đủ cả hai đều
   không nhanh hơn — vòng hàng chỉ ~0,004 ms so với khung spec ~0,137 ms
   trong lab (mock canvas no-op), tức khung bị chi phối bởi chi phí khác
   (getFloatFrequencyData, gọi hàm, overhead vm context); tối ưu vòng hàng
   không di chuyển được thời gian khung. Lượt sau KHÔNG thử lại ghi
   Uint32/Int32 hay LUT phẳng trong vòng hàng Spectrogram; muốn nhanh khung
   spec thì profile chi phí khung trước (getFloatFrequencyData,
   drawImage/putImageData thật trong trình duyệt). Không chạm nhánh RTA,
   solver, WASM, FIR hay QA; aeV1/aeV2/aeV3 không đổi. Nhánh D: 1 lượt
   không vá liên tiếp sau vá 22:47. Ý tưởng lượt kế: hướng A — rà soát
   aeSolveSingle trên tai nghe thực tế trong DB (ý tưởng treo từ 18:56/
   21:19); hoặc hướng B — đo lại buildFirTaps sau vá truy hồi lượng giác
   (ý tưởng treo từ 23:06). --- */
          for (var y=0;y<H;y++){
            var bin=_specRowBins.bins[y];
            var _sv=fd[bin];
            var _nv=(_sv+90)/90;
            var _qi;
            if (_nv<0) _qi=0;
            else if (_nv>1) _qi=255;
            else _qi=(_nv*255+0.5)|0;
            if (_sv===Infinity) _qi=0;
            var rgb=lut[_qi], o=y*4;
            data[o]=rgb[0]; data[o+1]=rgb[1]; data[o+2]=rgb[2]; data[o+3]=255;
          }
          _specColCtx.putImageData(_specImg, 0, 0);
          ctx.drawImage(_specCol, W-1, 0);
        } else {
          ctx.fillStyle="#0a0c0f"; ctx.fillRect(0, 0, W, H);
          var centers=specBandCenters(), bw=W/centers.length, fillLut=specFillLut();
          var powLut=specPowLut();
          var bb=specBinBands(analyser.fftSize, (displayFs||48000), fd.length);
          var sums=bb.sums, cnts=bb.cnts, lists=bb.lists;
          sums.fill(0); cnts.fill(0);
/* --- Mở rộng 2026-11-09 (vòng tự động 21:19, hướng D): bỏ qua bin FFT rỗng
   trong vòng bin RTA của specDraw — ÁP DỤNG, có cải thiện. Chẩn đoán: band RTA
   chỉ phủ 20 Hz–20 kHz nên 175/1024 bin (bin >= ~867, trên 20,3 kHz) có
   lists[j] rỗng — 849 bin dùng, 1.325 cặp (bin,band), tối đa 39 band/bin.
   V1 lấy lst=lists[j] trước rồi bỏ qua bin rỗng ngay, khỏi đọc fd/isFinite/
   lượng tử hoá/tra powLut cho bin không cộng dồn gì; thứ tự cộng dồn theo
   bin tăng dần giữ nguyên nên sums/cnts giống từng bit với bản gốc theo cấu trúc.
   Lab Node trên hàm thật (lượt 21:19, chạy 2 lần độc lập, 6 fixture fd x 239 band,
   7 vòng x 800 khung/fixture xen kẽ xoay thứ tự; lượt quét kho chạy song song
   chiếm ~1 CPU nên số tuyệt đối phồng, tỉ lệ xen kẽ vẫn ổn định): chữ ký
   fillRect GIỐNG HỆT cả 6 fixture cả 2 lần (240 rect/khung, số lần gán fillStyle
   giống hệt, 0 styleDiff, maxDx/Dy/Dw/Dh = 0 — kể cả fixture edge với NaN/±Inf
   ở cả vùng bin rỗng và vùng bin có band); tốc độ lần 1: 1,91162 -> 1,86558
   ms/khung (1,024x; nhanh hơn 5/6 fixture, 1,008–1,088x; silence+tone 0,995x
   trong nhiễu), lần 2: 1,99355 -> 1,83114 ms/khung (1,089x; nhanh hơn 6/6
   fixture, 1,018–1,231x). V2 (specBinBands dựng sẵn mảng used 849 bin rồi vòng
   RTA duyệt used thay 0..nb-1) cũng giống từng bit nhưng chậm hơn V1 ở cả 2 lần
   (lần 1: 1,84151; lần 2: 1,90206 ms/khung) và chậm hơn gốc ở fixture slope cả
   2 lần (0,979x) nên không chọn. Không chạm nhánh Spectrogram, specBandDb,
   solver, WASM, FIR hay QA. Ý tưởng lượt kế: hướng D — đo measureFps trên phổ
   thật (ý tưởng treo từ 20:30/20:57); hoặc hướng A — rà soát aeSolveSingle trên
   tai nghe thực tế trong DB (ý tưởng từ 18:56). --- */
          for (var j=0;j<bb.nb;j++){
            var lst=lists[j];
            if (!lst.length) continue;
            var pv=fd[j];
            if (!isFinite(pv)) continue;
            var qi=((pv+120)*20+0.5)|0;
            if (qi<0) qi=0; else if (qi>4000) qi=4000;
            var pw=powLut[qi];
            for (var q=0;q<lst.length;q++){ var bi=lst[q]; sums[bi]+=pw; cnts[bi]++; }
          }
/* --- Mở rộng 2026-11-09 (vòng tự động 18:56, hướng D): đo LẠI biến thể A (Math.log thay log10 trong
   vòng band RTA) sau vá 18:51 — BỊ BÁC, KHÔNG ÁP VÁ CODE. Ứng viên: db=Math.log(sums[i]/cnts[i])*4.3429448190325175
   (10/ln10, cùng hằng số như 18:43). Lab Node trên hàm thật (lượt 18:56, chạy 2 lần, 5 fixture fd x 239 band,
   3 vòng x 2000 khung/fixture, median; baseline đã có vá fillStyle 18:51):
   lần 1: gốc 0,545 ms/khung -> A 0,540 (0,992×); lần 2: 0,554 -> 0,539 (0,973×). Nhanh hơn trung bình 0,8–2,7%
   nhưng không ổn định theo fixture: lần 1 slope 0,997× và stress 0,997× (chậm hơn), lần 2 mới nhanh hơn cả 5
   fixture (1,01–1,06×). Mức tăng ~0,015 ms/khung, trong nhiễu đo — cùng kết luận như 18:43 (1,09×/1,00×):
   Math.log không nhanh hơn Math.log10 một cách đáng tin trong V8 ở đây. Chữ ký fillRect giống hệt (240 rect,
   0 styleDiff, lệch dB tối đa 2,95e-14) nên không có vấn đề đúng sai — chỉ thiếu lợi ích tốc độ.
   Lượt sau KHÔNG đo lại Math.log thay log10 trong nhánh RTA này. Ý tưởng lượt kế: hướng C — rà soát
   upSelfCheck1..6 trên lưới phon (ý tưởng từ 17:09, nhắc lại ở 18:43/18:51); hoặc hướng A — rà soát
   aeSolveSingle trên tai nghe thực tế trong DB. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 21:35, hướng D): inline specNormDb +
   (nv*255+0.5)|0 thay Math.round trong vòng band RTA của specDraw — ÁP DỤNG,
   có cải thiện. Chẩn đoán: vòng band duyệt 239 band/khung; mỗi band gọi
   specNormDb(db) rồi Math.round(nv*255). specNormDb chỉ là (db+90)/90 kẹp
   [0,1], non-finite -> 0; inline giữ đúng thứ tự số học nên nv giống từng
   bit theo cấu trúc. nv đã kẹp trong [0,1] nên nv*255 trong [0,255],
   (nv*255+0.5)|0 == Math.round(nv*255) chính xác (Math.round(x)=floor(x+0.5)
   với x>=0; |0 là floor với số không âm; tối đa 255 nên không tràn int32).
   Lab Node trên hàm thật (lượt 21:35, chạy 2 lần độc lập, 6 fixture fd x
   239 band, 7 vòng x 800 khung/fixture xen kẽ xoay thứ tự): chữ ký fillRect
   GIỐNG HỆT cả 6 fixture cả 2 lần (240 rect/khung, số lần gán fillStyle
   giống hệt, 0 styleDiff, maxDx/Dy/Dw/Dh = 0 — kể cả fixture edge với
   NaN/±Inf); tốc độ lần 1: 1,13380 -> 0,96485 ms/khung (1,176x; nhanh hơn
   6/6 fixture, 1,121–1,233x), lần 2: 1,19170 -> 0,97683 ms/khung (1,220x;
   nhanh hơn 6/6 fixture, 1,174–1,272x). Lưu ý: số tuyệt đối đo trên mock
   canvas (fillRect là no-op) nên trong trình duyệt thật, nơi lệnh canvas
   chiếm phần lớn chi phí khung, lợi ích thực sẽ nhỏ hơn con số lab. Không
   chạm vòng bin RTA (đã vá 21:19), nhánh Spectrogram, specBandDb, solver,
   WASM, FIR hay QA. Ý tưởng lượt kế: hướng D — đo drawGraph FFT-on trên
   phổ thật (phần còn lại của ý tưởng đo measureFps từ 20:30/20:57); hoặc
   hướng C — rà soát loudFitError trên lưới phon rộng (10–100 phon, ý
   tưởng từ 19:20). --- */
          var bw1=Math.max(1, bw), lastCi=-1;
          for (var i=0;i<centers.length;i++){
            if (!cnts[i]) continue;
            var db=10*Math.log10(sums[i]/cnts[i]);
            var nv=(db+90)/90; if (!isFinite(db)) nv=0; else if (nv<0) nv=0; else if (nv>1) nv=1;
            var hgt=nv*H;
            var ci=(nv*255+0.5)|0;
            if (ci!==lastCi){ ctx.fillStyle=fillLut[ci]; lastCi=ci; }
            ctx.fillRect(i*bw, H-hgt, bw1, hgt);
          }
        }
      }
    }
  }
  if (specOn) specRaf=requestAnimationFrame(specDraw);
}
$("specToggle").addEventListener("click", function(){ specSetState(!specOn); });
$("specModeBtn").addEventListener("click", function(){
  specMode = (specMode==="spec") ? "rta" : "spec";
  var mb=$("specModeBtn"); if (mb) mb.textContent = "Chế độ: " + (specMode==="spec" ? "Spectrogram" : "RTA 1/24-octave");
  if (specOn){ var st=$("specState"); if (st) st.textContent = (specMode==="spec" ? "Spectrogram" : "RTA") + " đang chạy"; }
  specSetInfo();
});
$("specClearBtn").addEventListener("click", function(){
  var cv=$("specCanvas"); if (!cv) return;
  var ctx=cv.getContext("2d"); if (!ctx) return;
  ctx.fillStyle="#0a0c0f"; ctx.fillRect(0, 0, cv.width, cv.height);
});
function specSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  var c=specBandCenters();
  ck(c.length===239);
  ck(c[0]>=20 && c[0]<21);
  ck(c[c.length-1]>19000 && c[c.length-1]<=20000);
  ck(Math.abs(c[1]/c[0]-Math.pow(2, 1/24))<1e-9);
  var flat=new Float32Array(1024); flat.fill(-60);
  ck(Math.abs(specBandDb(flat, 2048, 48000, 1000)+60)<1e-9);
  ck(specBandDb(new Float32Array(0), 2048, 48000, 1000)===null);
  ck(specNormDb(-90)===0 && specNormDb(0)===1 && specNormDb(-45)===0.5 && specNormDb(NaN)===0 && specNormDb(-200)===0 && specNormDb(50)===1);
  ck(specYForFreq(20000, 260)===0 && specYForFreq(20, 260)===260);
  ck(Math.abs(specYForFreq(632.4555, 260)-130)<1);
  ck(typeof specColor(-60)==="string" && specColor(-60).indexOf("hsl(")===0);
  var fl=specFillLut(), lut2=specColorLut();
  ck(fl.length===256 && fl[0]==="rgb("+lut2[0][0]+","+lut2[0][1]+","+lut2[0][2]+")" && fl[255]==="rgb("+lut2[255][0]+","+lut2[255][1]+","+lut2[255][2]+")");
  ck(specFillLut()===fl);
  var el=$("specCheck"); if (el) el.textContent = "PASS " + pass + "/" + total + " — band 1/24-octave, trung bình band, chuẩn hoá dB, trục tần logarit";
  specSetInfo();
  return { pass:pass, total:total };
}
specSelfCheck();
/* ---------------- Tach kenh L/R Nhom 4 v2 ----------------
   Che do mac dinh Lien ket (hanh vi cu: mot bo band cho ca hai kenh).
   Khi tach: kenh L giu nguyen bo band hien tai (tham chieu toi store cua
   BAND_STORE), kenh R la ban sao doc lap; chuyen kenh chi doi con tro
   `bands` nen moi UI/graph/preset/solver cu deu lam viec voi bo dang xem.
   pushCoeffs gui ca hai bo xuong worklet (coeffs = L, coeffsR = R);
   worklet ap dung theo kenh o tang IIR. Dynamic EQ: cau hinh theo band
   dung chung, nhung gain/Q/tan so theo tung kenh (dynConfigForWorklet
   gui them fL/tL/qL/gL/fR/tR/qR/gR). Gioi han: FIR dung mot bo taps
   chung nen khong tach duoc — chuyen FIR va doi so band bi chan khi
   dang tach; ve Lien ket se lay bo dang xem lam bo chung. */
var LR_MODE="linked", LR_L=null, LR_R=null;
function lrCopyStore(store){
  var out=[];
  for (var i=0;i<store.length;i++){ var b=store[i]; out.push({ freq:b.freq, type:b.type, gain:b.gain, q:b.q, on:!!b.on }); }
  return out;
}
function lrCoeffsFor(store, fs){
  var out=[];
  for (var i=0;i<store.length;i++){
    var b=store[i];
    if (!b.on || b.gain===0) out.push({ b0:1, b1:0, b2:0, a1:0, a2:0 });
    else out.push(rbjCoeffs(b.type, b.freq, b.gain, b.q, fs));
  }
  return out;
}
function lrSetInfo(msg){ var el=$("lrInfo"); if (el) el.textContent = msg; }
function lrSyncUI(){
  var map={ linked:"lrLinked", L:"lrL", R:"lrR" };
  for (var k in map){ var el=$(map[k]); if (el) el.className = ((k==="linked" ? (LR_MODE==="linked" && (typeof MS_MODE==="undefined" || MS_MODE==="linked")) : LR_MODE===k)) ? "on" : ""; }
  var mMap={ M:"msM", S:"msS" };
  for (var k2 in mMap){ var el2=$(mMap[k2]); if (el2) el2.className = (typeof MS_MODE!=="undefined" && MS_MODE===k2) ? "on" : ""; }
  if (typeof MS_MODE!=="undefined" && MS_MODE!=="linked") lrSetInfo("Đang tách kênh Mid/Side: bạn đang chỉnh kênh " + (MS_MODE==="M" ? "Giữa (M)" : "Bên (S)") + " — kênh còn lại giữ nguyên; về Liên kết để lấy bộ đang xem làm bộ chung cho cả hai kênh. Tách kênh chỉ áp dụng ở chế độ IIR; Dynamic EQ (nếu bật) dùng cùng cấu hình theo band nhưng gain/Q/tần số theo từng kênh (Mid = kênh L, Side = kênh R của detector, detector vẫn đọc mono L/R); đổi số band và chuyển FIR bị chặn khi đang tách. Xuất preset/file vẫn theo bộ đang xem (stereo).");
  else if (LR_MODE==="linked") lrSetInfo("Liên kết: cả hai kênh dùng chung một bộ band (hành vi cũ).");
  else lrSetInfo("Đang tách kênh: bạn đang chỉnh kênh " + (LR_MODE==="L" ? "Trái (L)" : "Phải (R)") + " — kênh còn lại giữ nguyên; về Liên kết để lấy bộ đang xem làm bộ chung cho cả hai kênh. Tách kênh chỉ áp dụng ở chế độ IIR; Dynamic EQ (nếu bật) dùng cùng cấu hình theo band nhưng gain/Q/tần số theo từng kênh; đổi số band và chuyển FIR bị chặn khi đang tách.");
}
function lrSetMode(m){
  if (m===LR_MODE){ lrSyncUI(); return; }
  if (m!=="linked" && typeof MS_MODE!=="undefined" && MS_MODE!=="linked"){ lrSetInfo("Đang tách kênh Mid/Side — về Liên kết trước khi tách kênh L/R."); return; }
  if (m!=="linked" && typeof mode!=="undefined" && mode==="fir"){ lrSetInfo("Chế độ FIR dùng một bộ taps chung — chuyển sang IIR trước khi tách kênh L/R."); return; }
  if (LR_MODE==="linked" && m!=="linked"){
    LR_L=bands; LR_R=lrCopyStore(bands);
    bands = (m==="R") ? LR_R : LR_L;
  } else if (m==="linked" && LR_MODE!=="linked"){
    var cur=(typeof BAND_STORE!=="undefined") ? BAND_STORE[bandCount] : null;
    if (cur && bands!==cur){
      for (var i=0;i<cur.length && i<bands.length;i++){
        cur[i].freq=bands[i].freq; cur[i].type=bands[i].type; cur[i].gain=bands[i].gain; cur[i].q=bands[i].q; cur[i].on=bands[i].on;
      }
      bands=cur;
    }
    LR_L=null; LR_R=null;
  } else if (m==="L" && LR_MODE!=="linked"){
    bands=LR_L;
  } else if (m==="R" && LR_MODE!=="linked"){
    bands=LR_R;
  }
  LR_MODE=m;
  if (typeof selBand!=="undefined" && selBand>=bands.length) selBand=bands.length-1;
  if (typeof BAND_CC!=="undefined") BAND_CC=[];
  if (typeof GRID_TOT!=="undefined") GRID_TOT={};
  if (typeof buildBandStrips==="function") buildBandStrips();
  if (typeof updateAll==="function") updateAll(true);
  lrSyncUI();
}
$("lrLinked").addEventListener("click", function(){ lrSetMode("linked"); });
$("lrL").addEventListener("click", function(){ lrSetMode("L"); });
$("lrR").addEventListener("click", function(){ lrSetMode("R"); });
function lrSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  var store=[{freq:31,type:"lowshelf",gain:0,q:0.707,on:true},{freq:1000,type:"peaking",gain:6,q:1.41,on:true},{freq:1000,type:"peaking",gain:-6,q:1.41,on:true},{freq:2000,type:"peaking",gain:3,q:1,on:false}];
  var cp=lrCopyStore(store);
  ck(cp.length===4 && cp[1].gain===6 && cp[1]!==store[1]);
  store[1].gain=99;
  ck(cp[1].gain===6);
  var co=lrCoeffsFor(cp, 48000);
  ck(co.length===4);
  ck(co[0].b0===1 && co[0].b1===0 && co[0].b2===0);
  ck(co[3].b0===1 && co[3].b1===0);
  ck(co[1].b0>co[2].b0);
  var flat=lrCoeffsFor(lrCopyStore([{freq:1000,type:"peaking",gain:0,q:1,on:true}]), 48000);
  ck(flat[0].b0===1 && flat[0].b1===0 && flat[0].b2===0 && flat[0].a1===0 && flat[0].a2===0);
  var el=$("lrCheck"); if (el) el.textContent = "PASS " + pass + "/" + total + " — sao chép bộ band độc lập, hệ số identity, hệ số L/R khác nhau theo gain";
  lrSyncUI();
  return { pass:pass, total:total };
}
lrSelfCheck();
/* ---------------- Tach kenh Mid/Side Nhom 4 (2026-11-06) ----------------
   Giong het mau tach L/R v2: mac dinh Lien ket; khi tach, kenh Mid giu
   bo band hien tai, kenh Side la ban sao doc lap; chuyen kenh chi doi con
   tro `bands`. Che do kenh 3 nac loai tru nhau (Lien ket / L-R / M-S):
   dang tach mot kieu thi bat kieu kia bi chan. pushCoeffs gui ca hai bo
   xuong worklet (coeffs = Mid, coeffsR = Side) va pushConfig gui msOn=true;
   worklet ma hoa L/R thanh M/S truoc tang IIR roi giai ma lai sau tang loc
   (xem nhanh msOn trong processIIR). Ve Lien ket lay bo dang xem lam bo
   chung. Gioi han giong L/R: chi IIR, chan FIR/doi so band khi dang tach,
   bo kenh con lai chi giu trong phien, preset/xuat theo bo dang xem. */
var MS_MODE="linked", MS_M=null, MS_S=null;
function msSetInfo(msg){ lrSetInfo(msg); }
function msSyncUI(){ lrSyncUI(); }
function msSetMode(m){
  if (m===MS_MODE){ msSyncUI(); return; }
  if (m!=="linked" && typeof LR_MODE!=="undefined" && LR_MODE!=="linked"){ lrSetInfo("Đang tách kênh L/R — về Liên kết trước khi tách kênh Mid/Side."); return; }
  if (m!=="linked" && typeof mode!=="undefined" && mode==="fir"){ lrSetInfo("Chế độ FIR dùng một bộ taps chung — chuyển sang IIR trước khi tách kênh Mid/Side."); return; }
  if (MS_MODE==="linked" && m!=="linked"){
    MS_M=bands; MS_S=lrCopyStore(bands);
    bands = (m==="S") ? MS_S : MS_M;
  } else if (m==="linked" && MS_MODE!=="linked"){
    var cur=(typeof BAND_STORE!=="undefined") ? BAND_STORE[bandCount] : null;
    if (cur && bands!==cur){
      for (var i=0;i<cur.length && i<bands.length;i++){
        cur[i].freq=bands[i].freq; cur[i].type=bands[i].type; cur[i].gain=bands[i].gain; cur[i].q=bands[i].q; cur[i].on=bands[i].on;
      }
      bands=cur;
    }
    MS_M=null; MS_S=null;
  } else if (m==="M" && MS_MODE!=="linked"){
    bands=MS_M;
  } else if (m==="S" && MS_MODE!=="linked"){
    bands=MS_S;
  }
  MS_MODE=m;
  if (typeof selBand!=="undefined" && selBand>=bands.length) selBand=bands.length-1;
  if (typeof BAND_CC!=="undefined") BAND_CC=[];
  if (typeof GRID_TOT!=="undefined") GRID_TOT={};
  if (typeof buildBandStrips==="function") buildBandStrips();
  if (typeof updateAll==="function") updateAll(true);
  msSyncUI();
}
$("msM").addEventListener("click", function(){ msSetMode("M"); });
$("msS").addEventListener("click", function(){ msSetMode("S"); });
function msSelfCheck(){
  var pass=0, total=0;
  function ck(cond){ total++; if (cond) pass++; }
  var store=[{freq:31,type:"lowshelf",gain:0,q:0.707,on:true},{freq:1000,type:"peaking",gain:6,q:1.41,on:true},{freq:1000,type:"peaking",gain:-6,q:1.41,on:true},{freq:2000,type:"peaking",gain:3,q:1,on:false}];
  var cp=lrCopyStore(store);
  ck(cp.length===4 && cp[1].gain===6 && cp[1]!==store[1]);
  store[1].gain=99;
  ck(cp[1].gain===6);
  var co=lrCoeffsFor(cp, 48000);
  ck(co.length===4);
  ck(co[0].b0===1 && co[0].b1===0 && co[0].b2===0);
  ck(co[3].b0===1 && co[3].b1===0);
  ck(co[1].b0>co[2].b0);
  var flat=lrCoeffsFor(lrCopyStore([{freq:1000,type:"peaking",gain:0,q:1,on:true}]), 48000);
  ck(flat[0].b0===1 && flat[0].b1===0 && flat[0].b2===0 && flat[0].a1===0 && flat[0].a2===0);
  /* Loai tru nhau 3 nac: bat M/S roi bat L/R phai bi chan, va nguoc lai;
     khoi phuc ve Lien ket dung bo band goc. */
  var savedBands=bands;
  try{
    msSetMode("M");
    ck(MS_MODE==="M" && bands===MS_M && MS_S!==null && MS_S!==MS_M);
    lrSetMode("L");
    ck(LR_MODE==="linked");
    msSetMode("S");
    ck(MS_MODE==="S" && bands===MS_S);
    lrSetMode("R");
    ck(LR_MODE==="linked");
    msSetMode("M");
    ck(MS_MODE==="M" && bands===MS_M);
  } finally {
    msSetMode("linked");
  }
  ck(MS_MODE==="linked" && MS_M===null && MS_S===null && bands===savedBands);
  /* L/R van bat duoc sau khi M/S da ve Lien ket. */
  lrSetMode("L");
  ck(LR_MODE==="L");
  lrSetMode("linked");
  ck(LR_MODE==="linked");
  var el=$("msCheck"); if (el) el.textContent = "PASS " + pass + "/" + total + " — sao chép bộ band độc lập, hệ số identity, hệ số Mid/Side khác nhau theo gain, 3 nấc loại trừ nhau";
  msSyncUI();
  return { pass:pass, total:total };
}
msSelfCheck();
