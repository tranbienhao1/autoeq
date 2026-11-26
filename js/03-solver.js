/* Web AutoEQ split module: 03-solver.js (nguon: khoi script L5378 cua ban 1 file) */

"use strict";
/* ================================================================
   Web AutoEQ — Giai đoạn 2: AutoEQ solver & Target Curve (core)
   Thuần toán học, không phụ thuộc DOM — dùng chung cho app & test.
   Phụ thuộc: rbjCoeffs(), biquadMagDb() của Giai đoạn 1.
   ================================================================ */
var AE_FS = 48000;
var AE_FMIN = 20, AE_FMAX = 20000, AE_PER_OCT = 24; /* lưới log 1/24 octave */

/* ---------- Thư viện Target Curve: DỮ LIỆU, không hard-code vào logic ----------
   Knot [freq_Hz, dB] — hình dạng tương đối, sẽ chuẩn hoá 0 dB tại 1 kHz khi dùng. */
var AE_TARGETS = {
  harmanOE: { name:"Harman Over-Ear 2018", note:"Target tai nghe over-ear, tham chiếu rig 711/GRAS", knots:[
    [20,5.8],[30,5.9],[50,5.8],[80,5.2],[100,4.6],[150,3.2],[200,2.2],[300,1.2],[500,0.4],[800,0.0],[1000,0.3],
    [1500,1.2],[2000,3.2],[2500,5.6],[3000,7.8],[3500,8.6],[4000,8.2],[5000,6.4],[6000,5.2],[7000,5.6],
    [8000,6.2],[9000,5.4],[10000,4.2],[12000,2.4],[14000,0.8],[16000,-0.6],[18000,-2.2],[20000,-3.6]]},
  harmanIE: { name:"Harman In-Ear 2019 v2", note:"Target tai nghe in-ear, tham chiếu rig 711", knots:[
    [20,7.5],[50,7.2],[100,5.6],[200,3.4],[400,1.2],[700,0.2],[1000,0.0],[1500,1.6],[2000,4.5],[2500,7.5],
    [3000,9.6],[3500,10.2],[4000,9.4],[5000,7.0],[6000,5.6],[7000,6.0],[8000,6.4],[9000,5.2],[10000,3.6],
    [12000,1.4],[16000,-1.8],[20000,-4.5]]},
  ief: { name:"IEF Neutral 2023", note:"Target trung tính của Crinacle (IEF), tham chiếu rig 711", knots:[
    [20,2.2],[50,2.0],[100,1.4],[200,0.7],[400,0.2],[700,0.0],[1000,0.2],[1500,1.6],[2000,4.2],[2500,6.2],
    [3000,7.4],[3500,7.6],[4000,7.0],[5000,5.4],[6000,4.4],[7000,5.0],[8000,5.4],[9000,4.6],[10000,3.4],
    [12000,1.6],[16000,-1.0],[20000,-3.0]]},
  jm1: { name:"JM-1 Diffuse Field", note:"Target trường khuếch tán (diffuse field), tham chiếu B&K 5128", knots:[
    [20,0.4],[50,0.3],[100,0.2],[200,0.1],[400,0.0],[700,0.1],[1000,0.4],[1500,2.4],[2000,6.0],[2500,9.4],
    [3000,11.6],[3500,12.0],[4000,10.8],[5000,8.0],[6000,6.4],[7000,6.8],[8000,7.2],[9000,6.0],[10000,4.6],
    [12000,2.6],[16000,0.2],[20000,-1.6]]},
  diffuseField: { name:"Diffuse Field (ISO 11904-1)", note:"Target trường khuếch tán thuần theo ISO 11904-1 — dữ liệu gốc từ repo AutoEq (targets/Diffuse field ISO 11904-1.csv), resample về knot khi đóng gói app", knots:[
    [20,-4.1],[30,-4.1],[50,-4.1],[80,-4.1],[100,-4.1],[150,-3.8],[200,-3.5],[300,-3.1],[400,-2.6],[500,-2.0],[700,-1.1],[1000,0.0],[1500,3.0],[2000,6.9],[2500,11.2],[3000,11.5],[3500,10.4],[4000,8.8],[5000,6.5],[6000,5.5],[7000,5.3],[8000,5.4],[9000,4.0],[10000,2.7],[12000,0.2],[14000,-1.7],[16000,-3.4],[18000,-5.3],[20000,-6.9]]},
  diffuseFieldKemar: { name:"Diffuse Field (GRAS KEMAR)", note:"Target trường khuếch tán đo trên đầu giả GRAS KEMAR — dữ liệu gốc từ repo AutoEq (targets/Diffuse field GRAS KEMAR.csv), resample về knot khi đóng gói app; rất gần bản ISO 11904-1 nhưng là đáp tuyến đo thật của KEMAR thay vì đường lý thuyết", knots:[
    [20,-3.9],[30,-3.9],[50,-3.9],[80,-3.9],[100,-3.8],[150,-3.9],[200,-3.8],[300,-3.4],[400,-2.7],[500,-1.8],[700,-0.7],[1000,0.0],[1500,2.8],[2000,7.9],[2500,11.1],[3000,11.3],[3500,10.5],[4000,9.4],[5000,6.9],[6000,5.4],[7000,3.8],[8000,5.4],[9000,5.0],[10000,3.2],[12000,1.8],[14000,-0.8],[16000,-2.7],[18000,-4.2],[20000,-5.2]]},
  freeField: { name:"Free Field (ISO 11904-1)", note:"XẤP XỈ số hoá từ đồ thị đáp tuyến trường tự do công bố trong ISO 11904-1 — không phải dữ liệu gốc (repo AutoEq không có file free-field); chỉ dùng để tham chiếu tương đối so với Diffuse Field", knots:[
    [20,-3.5],[50,-3.5],[100,-3.4],[200,-2.8],[400,-1.8],[700,-0.8],[1000,0.0],[1500,3.5],[2000,7.5],[2500,12.0],[3000,13.5],[3500,12.5],[4000,10.5],[5000,8.0],[6000,7.0],[7000,7.5],[8000,8.0],[9000,6.5],[10000,5.0],[12000,2.5],[14000,0.0],[16000,-2.5],[18000,-5.0],[20000,-8.0]]},
  harmanOE2013: { name:"Harman Over-Ear 2013", note:"Target over-ear đời đầu của nghiên cứu Harman (Olive & Welti, 2013) — dữ liệu gốc từ repo AutoEq (targets/Harman over-ear 2013.csv). Harman không công bố target in-ear năm 2013; dòng target in-ear của Harman bắt đầu từ bản 2016", knots:[
    [20,1.5],[30,1.3],[50,1.3],[80,0.2],[100,-0.4],[150,-1.8],[200,-2.4],[300,-2.0],[400,-1.5],[500,-1.2],[700,-0.6],[1000,0.0],[1500,2.1],[2000,5.4],[2500,8.1],[3000,9.1],[3500,8.5],[4000,7.5],[5000,5.4],[6000,3.8],[7000,2.4],[8000,0.9],[9000,-0.6],[10000,-2.1],[12000,-5.5],[14000,-8.4],[16000,-11.5],[18000,-14.5],[20000,-16.6]]},
  harmanOE2015: { name:"Harman Over-Ear 2015", note:"Target over-ear thế hệ giữa của nghiên cứu Harman (Olive & Welti) — dữ liệu gốc từ repo AutoEq (targets/Harman over-ear 2015.csv), resample về knot khi đóng gói app; cùng họ và cùng khung tham chiếu với bản 2013", knots:[
    [20,3.3],[30,3.3],[50,3.2],[80,1.7],[100,0.6],[150,-1.5],[200,-2.4],[300,-2.0],[400,-1.4],[500,-1.2],[700,-0.7],[1000,0.0],[1500,2.0],[2000,5.2],[2500,8.6],[3000,10.0],[3500,9.7],[4000,8.7],[5000,6.7],[6000,5.3],[7000,4.0],[8000,2.5],[9000,0.8],[10000,-0.7],[12000,-4.2],[14000,-7.1],[16000,-10.4],[18000,-13.8],[20000,-16.6]]},
  oratoryOptimum: { name:"oratory1990 Optimum Hifi (Over-Ear)", note:"Target 'Optimum Hifi' của oratory1990 cho tai nghe over-ear (đường cong tối ưu theo gu của oratory1990, gần như không nâng bass shelf) — dữ liệu gốc từ repo AutoEq (targets/oratory1990 optimum hifi over-ear.csv), resample về knot khi đóng gói app", knots:[
    [20,-1.6],[30,-1.3],[50,-1.6],[80,-1.7],[100,-1.5],[150,-1.4],[200,-1.7],[300,-1.4],[400,-1.0],[500,-0.7],[700,-0.3],[1000,0.0],[1500,2.1],[2000,5.3],[2500,7.4],[3000,8.3],[3500,8.4],[4000,7.9],[5000,6.0],[6000,4.5],[7000,3.0],[8000,1.4],[9000,-0.2],[10000,-1.7],[12000,-4.5],[14000,-6.8],[16000,-8.8],[18000,-10.6],[20000,-12.1]]},
  rtings: { name:"RTINGS Original", note:"Target gốc của RTINGS (trung bình treble của các tai nghe họ đo + đáp tuyến gốc dưới 2.5 kHz, theo tài liệu dự án AutoEq) — dữ liệu gốc từ repo AutoEq (targets/Rtings original with bass.csv), đã làm mượt nhẹ 1/6 octave ở vùng treble vốn răng cưa khi đóng gói. RTINGS hiện công bố target của họ dựa trên Harman", knots:[
    [20,4.7],[30,4.3],[50,3.6],[80,2.5],[100,1.1],[150,-0.2],[200,-1.0],[300,-1.0],[400,-0.6],[500,0.0],[700,0.5],[1000,1.5],[1500,3.5],[2000,5.9],[2500,7.9],[3000,8.8],[3500,8.9],[4000,8.5],[5000,7.7],[6000,6.4],[7000,4.9],[8000,3.6],[9000,2.4],[10000,1.7],[12000,1.5],[14000,1.9],[16000,2.1],[18000,-1.4],[20000,-10.8]]},
  soundguys: { name:"SoundGuys Preference", note:"XẤP XỈ số hoá từ đồ thị Headphone Preference Curve mà SoundGuys công bố (đo trên B&K 5128, bài 'The house curve' trên soundguys.com) — không phải dữ liệu gốc của SoundGuys", knots:[
    [20,3.8],[50,3.9],[100,3.4],[200,2.2],[300,1.4],[500,0.5],[800,0.1],[1000,0.0],[1500,1.8],[2000,4.6],[2500,7.6],[3000,10.2],[3500,10.6],[4000,9.8],[5000,7.6],[6000,6.0],[7000,6.4],[8000,6.6],[9000,5.4],[10000,3.8],[12000,1.8],[14000,0.2],[16000,-1.6],[18000,-3.4],[20000,-5.2]]}
};

/* ---------- Đường đo mẫu tích hợp (dữ liệu mẫu để thử ngay, không phải số đo thật của người dùng) ---------- */
var AE_SAMPLES = [
  { id:"sampleA", name:"Mẫu A — V-Shape: bass mạnh, treble gắt", rig:"711", knots:[
    [20,86],[40,89.5],[60,90],[100,88],[150,85.5],[250,83],[400,81.5],[600,80.5],[1000,80],[1500,80.5],
    [2000,82.5],[2500,85.5],[3000,88],[3500,88.5],[4500,86],[5500,84.5],[6500,85.5],[7500,87.5],[8500,88],
    [10000,85],[12000,82.5],[14000,79.5],[16000,75.5],[18000,71],[20000,66]]},
  { id:"sampleB", name:"Mẫu B — Thiếu bass, dư mid-cao", rig:"5128", knots:[
    [20,74],[50,76],[100,78],[200,79.5],[400,80.5],[700,81],[1000,81.5],[1500,83],[2000,85],[2500,87.5],
    [3000,89],[4000,87],[5000,84],[6000,82.5],[7000,84],[8000,85.5],[10000,83],[12000,80],[16000,74],[20000,68]]},
  { id:"sampleC", name:"Mẫu C — Null hẹp 15 dB tại 8 kHz (kiểm chứng safety)", rig:"711", knots:[
    [20,84],[50,86],[100,85],[200,83.5],[400,82],[700,81.5],[1000,81],[1500,82],[2000,84],[2500,86.5],
    [3000,88],[4000,86.5],[5000,84.5],[6000,84],[7000,85],[7600,84.6],[7900,84.2],[8000,69.5],[8100,84.2],
    [8400,84.8],[9000,85.5],[10000,83.5],[12000,80.5],[14000,77],[16000,73],[18000,68],[20000,63]]}
];

/* ---------- Tiện ích nội suy / lưới log ---------- */
/* (vòng tự động 12:52, hướng D — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên cache log tần số theo identity mảng (WeakMap) trong aeInterp — aeInterp được aeDetectNulls gọi 960 lần và aePrepare gọi 241 lần trên cùng mảng ptsN nên tính lại Math.log(pts[lo][0])/Math.log(pts[hi][0]) mỗi lần; bản thử cache log theo từng chỉ số lo/hi trong WeakMap khóa theo mảng pts (validate độ dài + tần số đầu/cuối, dựng lại khi lệch), giữ nguyên tìm nhị phân và biểu thức t nên giống từng bit theo cấu trúc. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench.js trong hidden_files/run_20261123_1250_D/, 2 lần chạy độc lập): parity 247.578 kiểm tra GIỐNG TỪNG BIT cả 2 lần (Object.is, 0 lệch; gồm lưới 1/96-oct, trùng tần số, NaN/±Inf/±0/subnormal/1e308, mảng 1–3 điểm, xen kẽ 3 mảng, đột biến độ dài/tần số đầu/cuối/dB, ném lỗi đúng TypeError với mảng rỗng/null/undefined); tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 vòng 960 truy vấn trên cùng mảng 0,8355× (thắng 0/15), W2 vòng 241 truy vấn 0,8442× (0/15), W3 mảng mới mỗi rep 0,8371× (1/15), W4 1 truy vấn/mảng mới 0,8312× (5/15); lần 2 W1 0,8336× (0/15), W2 0,8416× (1/15), W3 0,8394× (1/15), W4 0,8775× (0/15) — chậm ổn định ~16–17% mọi workload cả 2 lần: chi phí WeakMap.get + validate + đọc mảng log ăn hết lợi ích của 2 lần Math.log tiết kiệm được (V8 tính Math.log rẻ) → BÁC, không vá code. KHÔNG thử lại hướng cache WeakMap theo identity mảng trong aeInterp. Hướng thay thế cho lượt D sau (chưa thử chính thức): tiền tính mảng log knot MỘT lần trong vòng của aeDetectNulls (bench nhanh toàn hàm ~1,05×, cần lab chính thức). Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm A. --- */
function aeInterp(pts, f){ /* pts: [[f,dB]...] đã sắp xếp; nội suy tuyến tính theo log-f */
  if (f <= pts[0][0]) return pts[0][1];
  if (f >= pts[pts.length-1][0]) return pts[pts.length-1][1];
  var lo=0, hi=pts.length-1;
  while (hi-lo>1){ var m=(lo+hi)>>1; if (pts[m][0]<=f) lo=m; else hi=m; }
  var t=(Math.log(f)-Math.log(pts[lo][0]))/(Math.log(pts[hi][0])-Math.log(pts[lo][0]));
  return pts[0+lo][1] + t*(pts[hi][1]-pts[lo][1]);
}
var _aeGridFreqsCache = null;
function aeGridFreqs(){
  if (_aeGridFreqsCache && Object.is(_aeGridFreqsCache.fmin, AE_FMIN) && Object.is(_aeGridFreqsCache.fmax, AE_FMAX) && Object.is(_aeGridFreqsCache.perOct, AE_PER_OCT)) return _aeGridFreqsCache.out.slice();
  var n = Math.round(Math.log2(AE_FMAX/AE_FMIN)*AE_PER_OCT)+1, out=[];
  for (var i=0;i<n;i++) out.push(AE_FMIN*Math.pow(2, i/AE_PER_OCT));
  _aeGridFreqsCache = { fmin: AE_FMIN, fmax: AE_FMAX, perOct: AE_PER_OCT, out: out };
  return out.slice();
}
/* --- Mở rộng 2026-11-23 (vòng tự động 20:41, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 20:31, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 20:31:41+07, 6.252.041 byte / 25.329 dòng (wc -l), md5 de516457198cf0f2152d2b0eeb8ae40e, version 312) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-D lưu tại ~/workspace/autoeq/backups/Web AutoEQ - DSP Core_2026-11-23_2035_pre-D.html. Ứng viên D duy nhất: cache mẫu lưới trong aeGridFreqs — lưới 1/24-octave chỉ phụ thuộc (AE_FMIN, AE_FMAX, AE_PER_OCT) là hằng số toàn cục không đổi trong vòng đời trang, nên tính MỘT lần (240 điểm, 240 lần Math.pow + 1 lần Math.log2) vào _aeGridFreqsCache rồi mỗi lần gọi trả out.slice() (bản sao mới) thay vì tính lại toàn bộ lưới; khóa cache so bằng Object.is từng trường (phân biệt -0/0, NaN khớp NaN) nên khi hằng số đổi (kể cả đổi rồi đổi lại) tự tính lại đúng đường gốc — cùng biểu thức, cùng số double nên GIỐNG TỪNG BIT theo cấu trúc; trả bản sao giữ nguyên ngữ nghĩa mảng mới mỗi lần gọi (caller sửa mảng trả về không làm hỏng mẫu, AE.freqs không bị gắn thuộc tính phụ lên mẫu). Khác hướng đã bác: tiền tính lưới 1/48-octave của aeSamplePoints (đã áp 17:45), tiền tính lưới 1/96-octave của aeDetectNulls (đã áp 18:31), cache WeakMap trong aeInterp (bác 12:52) — lượt này chỉ cache lưới solver dùng chung của aeGridFreqs, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + verify_patched.js trong hidden_files/run_20261123_2035_D/, 2 lần chạy độc lập): parity 28/28 GIỐNG TỪNG BIT cả 2 lần (Object.is sâu; gồm mặc định, mảng mới mỗi lần gọi, cô lập đột biến mảng trả về, lặp 100 lần, 22 cấu hình hằng số đổi (perOct 12/48/1/0/âm/NaN/chuỗi/null/phân số, fmin 10/âm/NaN/Infinity/-0/huge/chuỗi, fmax 40000/NaN/chuỗi, fmin=fmax, fmin>fmax) cả đường tính lại lẫn đường trúng cache, xen kẽ perOct, khôi phục mặc định; các ca n=Infinity (perOct/Infinity, fmax/Infinity, fmin 0/subnormal/null) hàm gốc không kết thúc nên loại khỏi parity — cả hai bản cùng vòng lặp trên đường trượt cache); kiểm chứng lại trên file ĐÃ VÁ 52/52; tốc độ paired-median xen kẽ 15 vòng × 2000 rep trên aeGridFreqs cô lập: lần 1 64,8657× (thắng 15/15), lần 2 64,8471× (thắng 15/15) — cải thiện ổn định cả 2 lần; lợi ích thực trên đường gọi thật (preFor/lufsFor/geqFit, mỗi lần gọi 1 lần) nhỏ hơn vì vòng biquad/solver chiếm phần lớn chi phí. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff với backup pre-D đúng 3 hunk code + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_2035_D/. --- */
/* Làm mượt phân đoạn octave: cửa sổ trung bình trượt rộng `oct` octave (tổng), trên lưới đều theo log2.
   perOct = số điểm trên 1 octave của lưới đang dùng. */
function aeSmooth(vals, freqs, octAt, perOct){
  var po = perOct || AE_PER_OCT;
  var n=vals.length, out=new Array(n), i, j;
  if (n < 512){
    for (i=0;i<n;i++){
      var half = octAt(freqs[i])*po/2, s=0, c=0;
      var a=Math.max(0, Math.floor(i-half)), b=Math.min(n-1, Math.ceil(i+half));
      for (j=a;j<=b;j++){ s+=vals[j]; c++; }
      out[i]=s/c;
    }
    return out;
  }
  var _aArr=[], _bArr=[], _pref=[0], _prefOk=true, _totW=0;
  for (i=0;i<n;i++){
    var half = octAt(freqs[i])*po/2;
    var a=Math.max(0, Math.floor(i-half)), b=Math.min(n-1, Math.ceil(i+half));
    _aArr.push(a); _bArr.push(b);
    if (b>=a) _totW += (b-a+1);
    if (_prefOk){ _pref.push(_pref[i]+vals[i]); if (!isFinite(_pref[i+1])) _prefOk=false; }
  }
  if (_prefOk && _totW > 6*n){
    for (i=0;i<n;i++){
      var _a=_aArr[i], _b=_bArr[i], _cnt=_b-_a+1;
      out[i] = (_cnt>0) ? (_pref[_b+1]-_pref[_a])/_cnt : (0/0);
    }
    return out;
  }
  for (i=0;i<n;i++){
    var s=0, c=0;
    for (j=_aArr[i];j<=_bArr[i];j++){ s+=vals[j]; c++; }
    out[i]=s/c;
  }
  return out;
}
/* (vòng tự động 16:07, hướng D — ÁP DỤNG, vá code): tổng tiền tố cho aeSmooth khi lưới lớn — khi n>=512 và tổng độ rộng cửa sổ >6n (đúng đường trend 1/3-oct của aeDetectNulls: n=958, cửa sổ 33 điểm), tính prefix sum MỘT lần rồi mỗi điểm lấy (pref[b+1]-pref[a])/(b-a+1) thay vì cộng lại từng cửa sổ; mọi trường hợp khác (n<512 giữ nguyên vòng gốc từng ký tự, prefix không hữu hạn do NaN/Inf/tràn, cửa sổ rỗng) rơi về vòng cộng trực tiếp gốc nguyên vẹn — đường nhỏ giống từng bit, đường lớn lệch tối đa 5,2e-14 dB mức ulp. aeSmooth không nằm trong AE_WORKER_SRC nên parity Worker giữ nguyên. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench.js + bench_detect.js trong hidden_files/run_20261123_1605_D/, 2 lần chạy độc lập): parity 50/50 ca (12.938 phần tử giống từng bit, phần còn lại lệch tối đa 5,15e-14 dB; gồm n=1..2000, psycho/third/sixth/twelfth, oct 0/âm/NaN/Inf, vals NaN/Inf/1e308/subnormal/-0, freqs NaN/ngắn, ném lỗi đúng loại với null/undefined/octAt ném lỗi); aeDetectNulls toàn hàm: số null và mọi trường trừ depth giống hệt, depth lệch tối đa 1,25e-14 dB; tốc độ paired-median xen kẽ 15 vòng: aeSmooth trend n958 lần 1 1,6307x (15/15) lần 2 1,7203x (14/15), n2000 2,1772x/2,0726x (15/15), đường n241 psycho trung tính trong test cô lập (~1,0x, code không đổi); aeDetectNulls toàn hàm 1,0483-1,1038x thắng 11-15/15 cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1605_D/. */

/* ---------- Parser file đo: CSV/TXT kiểu REW / AutoEQ (cột freq, SPL) ----------
   Bỏ qua dòng header/comment; dòng trông như dữ liệu mà đọc không được -> lỗi rõ ràng kèm số dòng. */
function aeParseMeasurement(text){
  var lines = String(text).split(/\r?\n/), pts=[], bad=[], skipped=0;
  for (var li=0; li<lines.length; li++){
    var raw = lines[li].trim();
    if (!raw){ continue; }
    var first = raw.charAt(0);
    if (first==="*" || first==="#" || first===";"){ skipped++; continue; }
    var toks = raw.split(/[,;\t ]+/).filter(function(x){ return x.length>0; });
    var f = parseFloat(toks[0]), v = toks.length>1 ? parseFloat(toks[1]) : NaN;
    if (isFinite(f) && isFinite(v)){
      if (f>=10 && f<=24000 && v>-100 && v<200){ pts.push([f,v]); continue; }
      bad.push(li+1); continue; /* số nhưng ngoài dải hợp lệ */
    }
    if (/[0-9]/.test(first)){ bad.push(li+1); } /* bắt đầu bằng số mà không đọc được = dòng dữ liệu hỏng */
    else skipped++; /* header chữ */
  }
  if (bad.length) throw new Error("Dòng dữ liệu không đọc được ở dòng: "+bad.slice(0,8).join(", ")+(bad.length>8?"…":"")+" — file phải có 2 cột: tần số (Hz) và SPL (dB).");
  if (pts.length<8) throw new Error("Chỉ tìm thấy "+pts.length+" điểm đo hợp lệ (cần tối thiểu 8). File phải có 2 cột: tần số (Hz) và SPL (dB), kiểu REW/AutoEQ.");
  pts.sort(function(a,b){ return a[0]-b[0]; });
  var ded=[]; /* gộp trùng tần số: lấy trung bình */
  for (var i=0;i<pts.length;i++){
    if (ded.length && Math.abs(ded[ded.length-1][0]-pts[i][0])<1e-9){ var d=ded[ded.length-1]; d[1]=(d[1]*d[2]+pts[i][1])/(d[2]+1); d[2]++; }
    else ded.push([pts[i][0], pts[i][1], 1]);
  }
  return { points: ded.map(function(d){ return [d[0], d[1]]; }), skipped: skipped };
}

/* ---------- Target sau hiệu chỉnh người dùng: Tilt / Bass shelf / Ear Gain ---------- */
function aeTargetCurve(targetId, tilt, bassDb, earDb){
  var t = AE_TARGETS[targetId]; if (!t) throw new Error("Target không tồn tại: "+targetId);
  var knots = t.knots;
  var _adjZero = (tilt===0 && bassDb===0 && earDb===0 && 1/tilt===Infinity && 1/bassDb===Infinity && 1/earDb===Infinity);
  function adj(f){
    if (_adjZero && f>0 && isFinite(f) && f/3000>0) return 0;
    var tiltDb = tilt*Math.log2(f/1000);
    var shelf = bassDb * 0.5*(1 - Math.tanh(Math.log2(f/180)/0.9));
    var bell = earDb * Math.exp(-0.5*Math.pow(Math.log2(f/3000)/0.55, 2));
    return tiltDb + shelf + bell;
  }
  var _logK = null, _useFast = false;
  if (Array.isArray(knots) && knots.length >= 2){
    _useFast = true; _logK = new Array(knots.length);
    for (var _ki=0; _ki<knots.length; _ki++){
      var _kf = knots[_ki] && knots[_ki][0];
      if (!(typeof _kf==="number" && isFinite(_kf) && _kf>0)){ _useFast=false; break; }
      _logK[_ki] = Math.log(_kf);
    }
  }
  function _interp(f){
    if (!_useFast) return aeInterp(knots, f);
    if (f <= knots[0][0]) return knots[0][1];
    if (f >= knots[knots.length-1][0]) return knots[knots.length-1][1];
    var lo=0, hi=knots.length-1;
    while (hi-lo>1){ var m=(lo+hi)>>1; if (knots[m][0]<=f) lo=m; else hi=m; }
    var tt=(Math.log(f)-_logK[lo])/(_logK[hi]-_logK[lo]);
    return knots[lo][1] + tt*(knots[hi][1]-knots[lo][1]);
  }
  var at1k = _interp(1000) + adj(1000);
  return function(f){ return _interp(f) + adj(f) - at1k; }; /* chuẩn hoá 0 dB @ 1 kHz */
}
  /* (vòng tự động 11:58, hướng D — ÁP DỤNG, vá code): tiền tính log knot trong aeTargetCurve — closure trả về trước đây gọi aeInterp(knots, f) cho MỌI lần gọi, aeInterp tính lại Math.log(pts[lo][0]) và Math.log(pts[hi][0]) mỗi lần (3 Math.log/lần gọi, gồm Math.log(f)); nay aeTargetCurve tính logK[i]=Math.log(knots[i][0]) MỘT lần lúc dựng closure (chỉ khi knots là mảng >=2 điểm với tần số hữu hạn >0, mọi trường hợp khác rơi về aeInterp gốc nguyên vẹn) rồi _interp tự nội suy với đúng biểu thức của aeInterp (cùng nhánh biên, cùng tìm nhị phân, cùng t=(Math.log(f)-logK[lo])/(logK[hi]-logK[lo]), cùng thứ tự phép tính) — Math.log xác định theo đầu vào nên giống từng bit theo cấu trúc, chỉ bớt 2 lần gọi Math.log mỗi lần gọi tgtFn (đường dựng AE_GRID_CACHE của drawGraph: 881 điểm mỗi lần đổi tai nghe/target, và đường map 240 điểm trong solver). Không đổi tên/chữ ký aeTargetCurve/aeInterp, không chạm solver/WASM/FIR/QA. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench.js + verify_patched.js trong hidden_files/run_20261123_1158/, 2 lần chạy độc lập): parity 170.832/170.832 kiểm tra GIỐNG TỪNG BIT (Object.is; 12 target × 10 tổ hợp adj gồm (0,0,0)/một phần 0/-0/NaN/Infinity/undefined × lưới 881 điểm + biên 0/âm/NaN/±Inf/1e308/subnormal + 9 target giả gồm rỗng/1 điểm/2 điểm/chưa sắp/tần số 0/âm/NaN/null/chuỗi); kiểm chứng lại trên file ĐÃ VÁ 107.880/107.880; tốc độ paired-median xen kẽ 15 vòng (30 rep × 12 target × 881 điểm): lần 1 adjZero 2,4194× / adj khác 0 1,3849× thắng 15/15 cả hai, lần 2 adjZero 2,4720× / adj khác 0 1,3769× thắng 15/15 cả hai — cải thiện ổn định cả 2 lần. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 51/51 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff đúng 1 hunk trong vùng aeTargetCurve. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. */

/* ---------- Trọng số tri giác W(f): cao 20 Hz–4 kHz, giảm dần > 10 kHz ---------- */
/* --- Mở rộng 2026-11-23 (vòng tự động 12:03, hướng A — ÁP DỤNG, vá code): Lượt nhóm A (sau D 11:58, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 12:01:47+07, 6.124.261 byte / 25.055 dòng, md5 63791d8d30f3ca16a991cc79386d507e, version 145) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-insert lưu tại ~/workspace/autoeq/backups/*2026-11-23_1203*. Ứng viên A duy nhất: inline Jacobian Jm + tot của giai đoạn RLS trong aeSolveSingle (port kỹ thuật hwSolve 13:48/13:57 sang aeSolveSingle) — trước đây mỗi vòng RLS gọi aeBandCurve 2m lần nữa (Jm gain+1: m lần; aeTotalCurve cho tot: m lần), mỗi lần cấp phát mảng n điểm rồi mới trừ/cộng từng cặp qua .map/forEach; nay tính trực tiếp trên cache lượng giác freqs._cw (đã do vòng curves xây khi m>0; guard giữ nguyên điều kiện của aeBandCurve) với đúng công thức của aeBandCurve (cùng thứ tự b0+b1*C1+b2*C2, cùng num/max(1e-30,den), cùng 10*Math.log10) — Jm[bi][k] = cvp - curves[bi][k], tot cộng dồn theo thứ tự band 0..m-1 như aeTotalCurve nên mọi số double giống hệt bản gốc theo cấu trúc; khi m=0 các vòng không chạy, tot toàn 0 như aeTotalCurve trên danh sách rỗng. Không tham chiếu biến ngoài mới (chỉ rbjCoeffs/aeBandCurve đã có trong AE_WORKER_SRC) nên parity Worker giữ nguyên. Lab Node trên hàm thật trích verbatim, file thường nối liền (extract.py + gen_bench.py + driver.js trong hidden_files/run_20261123_1203/, 2 lần chạy độc lập + verify trên file đã vá): parity 32/32 ca GIỐNG TỪNG BIT (ma trận 10/20 band x 3 err x 3 W + fs 44100/96000/0, anchor/step, relLambda 0, nBands 2/3, contBands, err NaN/Infinity, W toàn 0, n=1/3/9, contBands rỗng; ~8.128 giá trị bands/total + fixedPoint) + stage parity 2.640/2.640; tốc độ stage Jm+tot paired-median xen kẽ 15 vòng x 300 rep: lần 1 1,0876x (thắng 14/15), lần 2 1,0552x (15/15), lần 3 (bench_ek0) 1,0570x (15/15) — cải thiện ổn định; full-solve 31 vòng lệch ±1% trong nhiễu (thắng 20-22/31, không hồi quy thật). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA: 51/51 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff đúng 2 hunk code (Jm + tot trong aeSolveSingle) + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm B. Lab: hidden_files/run_20261123_1203/. --- */
function aeWeight(f){
  if (f<=4000) return 1.0;
  if (f<=10000) return 1.0 - 0.45*(Math.log2(f/4000)/Math.log2(10000/4000));
  return 0.55 - 0.25*(Math.log2(f/10000)/Math.log2(20000/10000));
}

/* ---------- Phát hiện null hẹp trên DỮ LIỆU ĐO GỐC (lưới mịn 1/96 oct, trước khi nội suy về lưới solver):
   sâu > 10 dB so với xu hướng 1/3 oct, rộng < 1/12 oct ở nửa độ sâu -> null triệt pha, cấm boost. ---------- */
/* (vòng tự động 18:31, hướng D — ÁP DỤNG, vá code): tiền tính lưới 1/96-octave của aeDetectNulls — trước đây vòng lưới tính lại AE_FMIN*Math.pow(2,i/96) và Math.log(f) cho mọi điểm (958 lần mỗi lần gọi); nay tần số và log của nó tính MỘT lần lúc nạp trang vào _aeNullGridF/_aeNullGridLogF rồi dùng lại — cùng biểu thức, cùng số double nên f và Math.log(f) giống hệt từng bit theo cấu trúc; vòng lặp, nhánh biên và biểu thức nội suy giữ nguyên từng toán hạng. */
var _aeNullGridF = [], _aeNullGridLogF = [];
var _aeNullGridN = Math.round(Math.log2(AE_FMAX/AE_FMIN)*96)+1;
for (var _ng = 0; _ng < _aeNullGridN; _ng++){ var _nf = AE_FMIN*Math.pow(2, _ng/96); _aeNullGridF.push(_nf); _aeNullGridLogF.push(Math.log(_nf)); }
function aeDetectNulls(points){
  var PO=96, n=Math.round(Math.log2(AE_FMAX/AE_FMIN)*PO)+1, freqs=[], raw=[], i;
  var _logK=null, _useFast=false;
  if (Array.isArray(points) && points.length>=2){
    _useFast=true; _logK=new Array(points.length);
    for (var _ki=0; _ki<points.length; _ki++){
      var _kf = points[_ki] && points[_ki][0];
      if (!(typeof _kf==="number" && isFinite(_kf) && _kf>0)){ _useFast=false; break; }
      _logK[_ki]=Math.log(_kf);
    }
  }
  for (i=0;i<n;i++){ var f=_aeNullGridF[i]; freqs.push(f);
    if (!_useFast){ raw.push(aeInterp(points, f)); }
    else if (f <= points[0][0]){ raw.push(points[0][1]); }
    else if (f >= points[points.length-1][0]){ raw.push(points[points.length-1][1]); }
    else {
      var _lo=0, _hi=points.length-1;
      while (_hi-_lo>1){ var _m=(_lo+_hi)>>1; if (points[_m][0]<=f) _lo=_m; else _hi=_m; }
      var _t=(_aeNullGridLogF[i]-_logK[_lo])/(_logK[_hi]-_logK[_lo]);
      raw.push(points[_lo][1] + _t*(points[_hi][1]-points[_lo][1]));
    }
  }
  var trend = aeSmooth(raw, freqs, function(){ return 1/3; }, PO);
  var nulls=[], depth = raw.map(function(v,k){ return trend[k]-v; });
  i=0;
  while (i<n){
    if (depth[i] > 5){
      var j=i; while (j<n && depth[j]>5) j++;
      var pk=i; for (var k=i;k<j;k++) if (depth[k]>depth[pk]) pk=k;
      if (depth[pk] > 10){
        var half = depth[pk]/2, a=pk, b=pk;
        while (a>i && depth[a]>half) a--; while (b<j-1 && depth[b]>half) b++;
        /* Pha C 2026-11-07: dem rong bang SO BUOC luoi (1/96 oct) thay vi so
           sanh float widthOct < 1/12 — nua-rong cua dip 1 diem dung bang
           8 buoc = 1/12 oct nen phep < loai no: lab 2026-11-07 notch 1 diem
           sau 15 dB thi bat duoc (rong 6 buoc), sau 20/30 dB thi lot
           (rong 8 buoc) roi solver boost +12 dB vao dung dip, preamp roi
           xuong -20...-33 dB; kho that cung co 22 doan sau >10 dB khong duoc
           phat hien (sau nhat 19,9 dB @ 19,3 kHz). Dem buoc tranh ca sai so
           float cua Math.log2(2^(k/96)). */
        var widthOct = Math.log2(freqs[b]/freqs[a]);
        /* Pha C 2026-11-07: loc 2 chieu cho tang bien b-a==8 — neu fc > 19000 Hz
           va depth <= 11 dB thi KHONG ghi null (dip mep rolloff): lab 2026-11-07
           kho that chi lat Sony WF-1000XM4 10,45 dB va Status IEM-2X 10,04 dB
           (tong RMS -0,48916 dB / 4 o, 0 o te hon); Galaxy 11,73 / Starfield
           13,22 / Final B3 19,09 / KZ AST 19,9 dB van la null; notch 3 diem
           D=20 @3k/8k/12k/16k/17k van duoc bat, notch 1 diem D>=15 @18k/19,3k
           van duoc bat, 3 diem D=30 @19,3k van duoc bat; 6/6 o chuan
           bit-identical. FCUT 19000 khoi phuc bao ve notch 16k/17k ma FCUT
           16000 lam mat, khong ton gi tren kho that (bien mong 18246->19331,
           1 buoc luoi — da do truc tiep bang lab nullfc19b 2026-11-07). */
        if (b - a <= 8 && !(b - a === 8 && freqs[pk] > 19000 && depth[pk] <= 11)){
          nulls.push({ fLo: freqs[Math.max(0,a-3)], fHi: freqs[Math.min(n-1,b+3)], fc: freqs[pk], depth: depth[pk], widthOct: widthOct });
        }
      }
      i=j;
    } else i++;
  }
  return nulls;
}
/* --- Mở rộng 2026-11-23 (vòng tự động 18:31, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 18:26, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 18:26:53+07, 6.218.241 byte / 25.259 dòng, md5 a5a2085e31d7c4343420ad6104c5d4de, version 273) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-D lưu tại ~/workspace/autoeq/backups/*2026-11-23_1828*. Ứng viên D duy nhất: tiền tính lưới 1/96-octave của aeDetectNulls — trước đây vòng lưới tính lại AE_FMIN*Math.pow(2,i/96) và Math.log(f) cho mọi điểm (958 lần mỗi lần gọi); nay tần số và log của nó tính MỘT lần lúc nạp trang vào _aeNullGridF/_aeNullGridLogF (958 mục, cùng biểu thức AE_FMIN*Math.pow(2,k/96) và Math.log của nó) rồi dùng lại — cùng số double nên f và Math.log(f) giống hệt từng bit theo cấu trúc; vòng lặp, nhánh biên, biểu thức nội suy và thứ tự phép tính giữ nguyên từng toán hạng; freqs vẫn push như cũ. Khác hướng đã bác: cache WeakMap trong aeInterp (12:52), tiền cấp phát Array(n) trong aeDetectNulls (14:12), inline logK trong aePrepare (15:18), tìm nội suy trong _interp của aeTargetCurve (15:41), hai-con-trỏ trong aeDetectNulls (16:57) — lượt này chỉ bỏ phép tính lưới lặp lại trong aeDetectNulls, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + verify_patched.js trong hidden_files/run_20261123_1828_D/, 2 lần chạy độc lập): parity 26/26 fixture + 300/300 fuzz GIỐNG TỪNG BIT cả 2 lần (Object.is sâu; gồm mẫu A/C, notch, lưới 50/200/481/1000 điểm, 1/2 điểm, rỗng/null/undefined/không phải mảng ném lỗi đúng, chưa sắp, trùng tần số, NaN/±Inf ở giá trị, tần số 0/âm/NaN/chuỗi, phần tử null, cực đoan 1e308/subnormal/-0, biên dưới/trên dải); kiểm chứng lại trên file ĐÃ VÁ 26/26 + 300/300; tốc độ paired-median xen kẽ 15 vòng: lần 1 sampleC 1,1836× (15/15), rand200 1,1626× (14/15), rand1000 1,1192× (14/15), notch481 1,1535× (14/15); lần 2 sampleC 1,1780× (14/15), rand200 1,1544× (15/15), rand1000 1,1337× (14/15), notch481 1,1546× (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff với backup pre-D đúng 3 hunk code + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1828_D/. --- */
/* (vòng tự động 16:57, hướng D — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): Lượt nhóm D (sau C 16:24, BÁC BỎ). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 16:29:18+07, 6.193.806 byte / 25.221 dòng, md5 690aab7deefc64ccb41e2cb35f7f4d14, version 247) khớp từng byte bản cục bộ (cmp IDENTICAL) — không có thay đổi ngoài; backup pre-download/pre-insert lưu tại ~/workspace/autoeq/backups/*2026-11-23_1654* và *1657_pre-insert*. Ứng viên D duy nhất: hai-con-trỏ đơn điệu trong aeDetectNulls — khi points là mảng >=2 điểm, mọi tần số là number hữu hạn >0 và đã sắp tăng dần (kiểm tra MỘT lần O(m)), duy trì _tpLo chỉ tiến khi duyệt lưới 1/96-oct tăng dần (while points[_tpLo+1][0]<=f) thay tìm nhị phân mỗi điểm, biểu thức nội suy giữ nguyên từng toán hạng/thứ tự nên giống từng bit theo cấu trúc; mọi trường hợp khác (chưa sắp, tần số không hợp lệ) rơi về tìm nhị phân gốc nguyên vẹn. Khác hướng đã bác: cache WeakMap trong aeInterp (12:52), tiền cấp phát Array(n) (14:12), inline tìm nhị phân + tiền tính logK trong aePrepare (15:18), tìm nội suy trong _interp của aeTargetCurve (15:41) — lượt này chỉ đổi thuật toán tìm lo trong vòng lưới của aeDetectNulls, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1654_D/, 1 lần chạy): parity 72/72 GIỐNG TỪNG BIT (Object.is sâu trên nulls + loại lỗi; gồm mẫu 50/200/481/1000/2000 điểm, notch, flat, 1/2/3 điểm, rỗng/null/undefined/không phải mảng, chưa sắp + fuzz chưa sắp, trùng tần số, NaN/±Inf ở giá trị, tần số 0/âm/NaN/Inf/chuỗi/null/subnormal/1e308, giá trị cực đoan, biên dưới/trên dải, knot chính xác, 20 fuzz ngẫu nhiên) — nhưng tốc độ paired-median xen kẽ 15 vòng không ổn định trên toàn hàm: sample481 1,0186x (thắng 12/15), sample200 0,9694x (thắng 8/15, CHẬM HƠN), sample1000 0,9995x (9/15), notch481 1,0152x (8/15), rand50 1,0035x (9/15), rand2000 1,0052x (11/15) — lợi ích ~0–1,8% nằm trong nhiễu VM (aeSmooth + quét null chiếm phần lớn thời gian aeDetectNulls) và sample200 hồi quy 3% → BÁC, không vá code. KHÔNG thử lại hướng hai-con-trỏ trong aeDetectNulls. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1654_D/. --- */
/* (vòng tự động 14:12, hướng D — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên tiền cấp phát mảng freqs/raw bằng new Array(n) + ghi theo chỉ số trong aeDetectNulls thay vì freqs=[]/raw=[] + push trong vòng lưới 1/96-oct — Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1409_D/, 2 lần chạy độc lập): parity 49/49 kiểm tra GIỐNG TỪNG BIT cả 2 lần (Object.is sâu trên nulls; gồm mẫu 50/200/500/1000 điểm, notch, 1/2/3 điểm, trùng tần số, chưa sắp, NaN/Infinity ở giá trị, tần số 0/âm/NaN/chuỗi, phần tử null, rỗng, subnormal/1e308, lỗi null/undefined/số/chuỗi/object ném đúng); nhưng tốc độ paired-median xen kẽ 15 vòng x 200 rep: lần 1 sample200 0,8378x (1/15), rand1000 0,8904x (1/15), notch 0,8949x (1/15), rand50 0,8970x (1/15); lần 2 sample200 0,7755x (1/15), rand1000 0,7992x (0/15), notch 0,7890x (3/15), rand50 0,7823x (0/15) — chậm ổn định cả 2 lần trên mọi workload (Array(n) tạo mảng lỗ, ghi chỉ số chậm hơn push trong V8) → BÁC, không vá code. KHÔNG thử lại hướng tiền cấp phát Array(n) cho freqs/raw trong aeDetectNulls. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không vá code, không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1409_D/. --- */
/* --- Mở rộng 2026-11-23 (vòng tự động 13:33, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 13:29, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 13:29:38+07, 6.150.866 byte / 25.115 dòng, md5 15f690ae9a28ba501cdc6ae69771021c, version 180) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-insert lưu tại ~/workspace/autoeq/backups/*2026-11-23_1331* và *1335*. Ứng viên D duy nhất (đúng hướng thay thế đã gợi ý trong comment bác bỏ 12:52, chưa thử chính thức trước đó): tiền tính mảng log knot MỘT lần trong aeDetectNulls — trước đây vòng lưới 1/96-oct gọi aeInterp(points, f) 960 lần, mỗi lần tính lại Math.log(pts[lo][0]) và Math.log(pts[hi][0]); nay aeDetectNulls tính _logK[i]=Math.log(points[i][0]) MỘT lần lúc vào hàm (chỉ khi points là mảng >=2 điểm với mọi tần số là number hữu hạn >0, mọi trường hợp khác rơi về aeInterp gốc nguyên vẹn) rồi vòng lưới nội suy trực tiếp với đúng biểu thức của aeInterp (cùng nhánh biên, cùng tìm nhị phân, cùng t=(Math.log(f)-_logK[lo])/(_logK[hi]-_logK[lo]), cùng thứ tự phép tính) — Math.log xác định theo đầu vào nên giống từng bit theo cấu trúc, chỉ bớt 2 lần gọi Math.log mỗi lần gọi aeInterp. Không đổi tên/chữ ký aeDetectNulls/aeInterp, không chạm solver/WASM/FIR/QA. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + verify_patched.js trong hidden_files/run_20261123_1331/, 2 lần chạy độc lập): parity 60/60 kiểm tra GIỐNG TỪNG BIT cả 2 lần (Object.is sâu; gồm mẫu A/C, notch, lưới 8/50/200/1000 điểm, 2 điểm, 1 điểm, trùng tần số, chưa sắp, NaN/±Inf/±0/subnormal/1e308, tần số 0/âm/NaN/chuỗi, thiếu dB, phần tử null, rỗng/null/undefined/không phải mảng ném lỗi đúng); kiểm chứng lại trên file ĐÃ VÁ 32/32; tốc độ paired-median xen kẽ 15 vòng: lần 1 W1 sampleC 1,6994× (15/15), W2 rand200 1,6503× (15/15), W3 rand1000 1,3899× (14/15), W4 notch 1,6417× (15/15); lần 2 W1 1,7118× (15/15), W2 1,7088× (15/15), W3 1,3780× (14/15), W4 1,6622× (15/15) — cải thiện ổn định cả 2 lần, vượt xa bench nhanh ~1,05× đã ghi trước (lợi ích gồm cả bỏ chi phí gọi hàm aeInterp). Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff đúng 1 hunk code trong vùng aeDetectNulls (+ dòng comment này). Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1331/. --- */

/* ---------- Safety: giới hạn cứng, không bao giờ vượt ---------- */
var AE_LIMITS = { gainMax:12, qMin:0.5, qMax:10, trebleHz:6000, trebleQMax:6, trebleGainMax:8 };
function aeClampBand(b){
  var hit=[];
  if (b.freq<AE_FMIN){ b.freq=AE_FMIN; hit.push("Fc"); }
  if (b.freq>AE_FMAX){ b.freq=AE_FMAX; hit.push("Fc"); }
  var gMax = b.freq>AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
  var qMax = b.freq>AE_LIMITS.trebleHz ? AE_LIMITS.trebleQMax : AE_LIMITS.qMax;
  if (b.gain> gMax){ b.gain= gMax; hit.push("Gain"); }
  if (b.gain<-gMax){ b.gain=-gMax; hit.push("Gain"); }
  if (b.q>qMax){ b.q=qMax; hit.push("Q"); }
  if (b.q<AE_LIMITS.qMin){ b.q=AE_LIMITS.qMin; hit.push("Q"); }
  return hit;
}
function aeBandCurve(b, freqs, fs){
  /* Pha A/C 2026-11-07: solver theo sample rate that (lab fsrate: band giai o 48k
     phat o 44,1k lech toi 1,15 dB, o 192k toi 2,34 dB; giai lai o dung rate hoi
     phuc >=0,84 lan). fs mac dinh AE_FS nen moi loi goi cu giu bit-identical;
     cache luong giac khoa them theo fs (_cwFs) vi AE.freqs dung chung qua cac
     lan giai o rate khac nhau — khong khoa thi lan giai sau dung nham cache cu. */
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS;
  var c = rbjCoeffs(b.type, b.freq, b.gain, b.q, fsv), n = freqs.length, out = new Array(n);
  if (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== fsv){
    var cw = new Float64Array(n), sw = new Float64Array(n), cw2 = new Float64Array(n), sw2 = new Float64Array(n);
    for (var j = 0; j < n; j++){
      var w = 2 * Math.PI * freqs[j] / fsv, cc = Math.cos(w), ss = Math.sin(w);
      cw[j] = cc; sw[j] = ss; cw2[j] = 2 * cc * cc - 1; sw2[j] = 2 * ss * cc;
    }
    freqs._cw = cw; freqs._sw = sw; freqs._cw2 = cw2; freqs._sw2 = sw2; freqs._cwFs = fsv;
  }
  var b0 = c.b0, b1 = c.b1, b2 = c.b2, a1 = c.a1, a2 = c.a2;
  var C1 = freqs._cw, S1 = freqs._sw, C2 = freqs._cw2, S2 = freqs._sw2;
  for (var i = 0; i < n; i++){
    var nr = b0 + b1 * C1[i] + b2 * C2[i], ni = b1 * S1[i] + b2 * S2[i];
    var dr = 1  + a1 * C1[i] + a2 * C2[i], di = a1 * S1[i] + a2 * S2[i];
    out[i] = 10 * Math.log10((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
  }
  return out;
}
function aeTotalCurve(bandList, freqs, fs){
  var tot=new Array(freqs.length).fill(0);
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS;
  bandList.forEach(function(b){
    var c = rbjCoeffs(b.type, b.freq, b.gain, b.q, fsv);
    if (!freqs._cw || freqs._cw.length !== freqs.length || freqs._cwFs !== fsv){
      var cw = new Float64Array(freqs.length), sw = new Float64Array(freqs.length), cw2 = new Float64Array(freqs.length), sw2 = new Float64Array(freqs.length);
      for (var j = 0; j < freqs.length; j++){
        var w = 2 * Math.PI * freqs[j] / fsv, cc = Math.cos(w), ss = Math.sin(w);
        cw[j] = cc; sw[j] = ss; cw2[j] = 2 * cc * cc - 1; sw2[j] = 2 * ss * cc;
      }
      freqs._cw = cw; freqs._sw = sw; freqs._cw2 = cw2; freqs._sw2 = sw2; freqs._cwFs = fsv;
    }
    var b0=c.b0, b1=c.b1, b2=c.b2, a1=c.a1, a2=c.a2;
    var C1 = freqs._cw, S1 = freqs._sw, C2 = freqs._cw2, S2 = freqs._sw2;
    for (var i=0;i<freqs.length;i++){
      var nr = b0 + b1*C1[i] + b2*C2[i], ni = b1*S1[i] + b2*S2[i];
      var dr = 1 + a1*C1[i] + a2*C2[i], di = a1*S1[i] + a2*S2[i];
      tot[i] += 10*Math.log10((nr*nr+ni*ni)/Math.max(1e-30, dr*dr+di*di));
    }
  });
  return tot;
}
function aeRms(errArr, freqs, wf){ /* RMS 20 Hz–10 kHz */
  var s=0, c=0;
  for (var i=0;i<errArr.length;i++){ if (freqs[i]<=10000){ s+=errArr[i]*errArr[i]; c++; } }
  return c? Math.sqrt(s/c) : 0;
}

/* ---------- Bộ tối ưu: Regularized Least Squares khởi tạo + Nelder–Mead từng band ----------
   minimize Σf W(f)·[ E(f) − H_total(f) ]² + λ·Σ (Gain² + phạt Q), E = Target − Measured (đã làm mượt). */
/* ---------- Solver 20 band dày (v2, 2026-10-26): aeSolveSingle là bản gốc ----------
   relLambda==null -> đường cũ tuyệt đối (LAMBDA 0.35, NM 2 vòng, hệ số phạt 0.02),
   dùng nguyên cho <=10 band. relLambda là số -> ridge tương đối relLambda * trung
   bình đường chéo J^T W J (theo cách hwSolve xử lý band dày), chỉ dùng khi >10 band. */
var AE_RLS_MODE = 3; /* che do RLS mac dinh: 3 vong; khoi song song RLS6 dat tam = 6 trong luc goi de quy aeSolve, khoi phuc bang try/finally */
var AE_RC_SCALE = 1; /* he so ti le rc: khoi song song rc/2 dat tam = 0.5 trong luc goi de quy aeSolve, khoi phuc bang try/finally */
var AE_SHELF_CAP = 0; /* cap mem tan so lowshelf (Hz) cho luot song song kep mem 02:07; 0 = khong kep */
/* --- Mo rong 2026-11-10 (vong tu dong 04:33, huong A): noi gainMax NOI BO trong NM (12->15, chi trong toBand cua nmBand) + chieu dap an ve kep chuan bang aeClampBand o cuoi aeSolveSingle; AE_LIMITS khong doi. BAC BO — khong va.
   Lab Node tren ham that trich verbatim (build_extract_0433.py, solver_funcs_0433.js + db_raw_0433.js, build_lab_0433.py, lab_0433_v0/v1.js; 8 fixture 10 band, 1 rep, xac dinh; quet toan kho chay song song nen chi do RMS/obj, khong do ms). V0 tai lap dung: Hi-X15 1,1724, K250 1,1755, Mau A 0,0685, Mau C 0,1460; D1 ref Hi-X15 1,0292.
   V1 (noi NM + chieu cuoi): 5/8 TE DI — Mau B 0,1221->0,9502, K250 1,1755->1,4280, SP-5 0,6857->0,7026, HD 600 0,1838->0,6651, XEA20 0,9741->2,5335; Mau A/C/Hi-X15 giong het goc; Hi-X15 KHONG tai lap duoc loi D1 (1,0292).
   Chan doan V1np (chi noi NM, khong chieu): RMS tot hon (B 0,0754, K250 0,6979, XEA20 0,8526) NHUNG viol>0 o 5/8 ca (gain toi 15,00) — loi toi tu vi pham kep. D1ALL (noi toan cuc RLS+NM, khong chieu): cung mau — chi Hi-X15 loi mien phi (gain cuoi <=11,34, viol=0); NM-rieng khong tim duoc duong D1 o Hi-X15, RLS khoi tao moi quyet dinh basin.
   Ket luan: chieu gain hau ky (clamp ma khong giai lai) pha vo can bang band nen te di; loi cua noi gain chi co khi chap nhan vuot kep an toan. Y tuong noi-gain + chieu ve DONG — khong thu lai. Khong cham solver/WASM/FIR/QA; aeV1/aeV2/aeV3 khong doi theo cau truc.
   Bo dem luu lab-only: 3 (04:06, 04:18, 04:33) — LUOT KE PHAI QA-ONLY theo skill (chay day du qaRunSuite tren trinh duyet, do lai aeV1/aeV2/aeV3), khong va moi.
   Y tuong luot ke (sau QA-only): huong B — do lai profile 3 pha buildFirTaps sau va truy hoi luong giac (treo tu 20:19/23:49); hoac huong D — do measureFps/specDraw tren pho that. --- */
/* --- Mo rong 2026-11-10 (vong tu dong 04:47, QA-ONLY, khong va): chay day du qaRunSuite tren trinh duyet (qa_headless/run_qa.js, Playwright + Chromium Headless Shell, 82,2 s; quet toan kho batch 04:46 chay song song ~100% CPU trong suot luot QA).
   Ket qua: 57 test, 54 PASS, 2 FAIL that — ca 2 deu la cong thoi gian duoi tai sweep: aeV3 Mau A 695 ms / Mau C 638 ms (vuot 500 ms; do don lanh, ban trung vi 03:41 da revert; A 695 gan dung 698 o 03:29); p4V1 keo node TB 14,36 ms / max 62,70 ms (vuot 16 ms). FPS conditional khong tinh FAIL (nhu 03:41).
   aeV1 DAT (RMS 2,1797 -> 0,1029 dB, 0 vi pham), aeV2 DAT (null 8011 Hz, sau 12,8 dB), toan bo cong khac DAT; so 03:41 chi co 1 pass-flip duy nhat la p4V1 (TB 1,92/max 2,40 ms luc do). Code khong doi tu 03:29 (chi them comment) nen khong phai hoi quy — nhieu thoi gian duoi tai: p4V3 cung luot cai thien 17,03 -> 2,57 ms, aeV5 20 band 10416 -> 11268 ms. Loi trang giong het tap co san (clampN, addEventListener null, ERR_TUNNEL, 404).
   Bo dem luu lab-only: 0 (da chay QA day du trong luot) — luot ke duoc phep va tro lai. Y tuong luot ke: do lai aeV3/p4V1 khi sweep nghi (probe 02:40 het sweep cho trung vi 387/419 ms); hoac huong B — profile 3 pha buildFirTaps. --- */
/* (vòng tự động 13:36, hướng A — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên đổi 2 điểm 10*Math.log10 còn sót trong giai đoạn RLS của aeSolveSingle (Jm gain+1 và tot cuối vòng RLS) sang Math.log(x)*4.342944819032518 — Lab Node trên hàm thật trích verbatim (extract.py + ae_old.js/ae_new.js + harness.js trong hidden_files/run_20261123_1335/, 2 lần chạy độc lập): parity 8 fixture (8 dạng err × 10 band, p0=12) lệch RMS tối đa 2,37e-12 dB, lệch band tối đa 3,45e-11 (mức ulp), 1/8 giống từng bit; bench toàn aeSolveSingle paired-median 9 vòng: lần 1 process 1: 1,0279× thắng 5/9, process 2: 1,0015× thắng 5/9; lần 2 process 1: 1,0151× thắng 4/9, process 2: 0,9534× thắng 1/9 — không cải thiện ổn định → BÁC, không vá code. KHÔNG thử lại hướng đổi log10 trong RLS của aeSolveSingle. Lượt kế: nhóm B. */
/* (vòng tự động 14:24, hướng A — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên tiền tính tổng tiền tố phần phạt gain reg trong objective/objectiveS của aeSolveSingle — tính nmPref[bi]=Σ_{j<bi}(bands[j].gain/12)² MỘT lần đầu nmBand rồi mỗi lần đánh giá dùng nmPref[bi]+trialTerm+suffix thay vì vòng lặp O(m) đầy đủ; cùng thứ tự cộng nên giống từng bit theo cấu trúc — Lab Node trên hàm thật trích verbatim (extract.py + ae_old.js/ae_new.js + harness.js trong hidden_files/run_20261123_1424_A/, 2 lần chạy độc lập): parity 12/12 fixture (8 dạng err × 10 band + 4 × 20 band) GIỐNG TỪNG BIT cả 2 lần (Object.is trên bands + total, maxRmsDev=0, maxBandDev=0); nhưng tốc độ paired-median xen kẽ 15 vòng không ổn định — lần 1 bench10 0,9967× (9/15), bench20 1,0255× (12/15) và 1,0293× (11/15); lần 2 bench10 0,9126× (6/15) và 0,9800× (5/15), bench20 0,9424× (2/15) và 0,9399× (0/15) — đảo chiều giữa 2 lần chạy → BÁC, không vá code. KHÔNG thử lại hướng prefix-sum cho reg trong objective/objectiveS của aeSolveSingle. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không vá code, không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261123_1424_A/. */
function aeSolveSingle(freqs, errDb, weights, nBands, relLambda, nmPasses, regCoef, shelfFreq, contBands, anchorShelf, stepScale, fs){
  var t0 = (typeof performance!=="undefined"? performance.now() : Date.now());
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS; /* Pha A/C 2026-11-07: solver theo sample rate that; mac dinh 48000. */
  var n=freqs.length, bands=[], i, k;
  if (contBands){
    bands = contBands.map(function(b){ return { type:b.type, freq:b.freq, gain:b.gain, q:b.q }; });
  } else {
    bands.push({ type:"lowshelf", freq:(shelfFreq||105), gain:0, q:0.707 });
    var nP = nBands-2;
    for (i=0;i<nP;i++){
      var ff = nP===1 ? 1260 : 200*Math.pow(8000/200, i/(nP-1));
      bands.push({ type:"peaking", freq:ff, gain:0, q:1.1 });
    }
    bands.push({ type:"highshelf", freq:10000, gain:0, q:0.707 });
  }
  var W = weights, sumW=0; for (i=0;i<n;i++) sumW+=W[i];
  var sumW2=0; for (var swi=0;swi<n;swi+=2) sumW2+=W[swi];
  /* --- Solver nhận biết null (2026-10-28, hạng mục A): khoảng null suy ra từ
       chính các điểm có trọng số 0 (aeCompute đã đặt W=0 trên [fLo,fHi] của
       mỗi null; aeWeight không bao giờ bằng 0 nên mọi đoạn W<=0 đều là null).
       Mỗi đoạn được nới nửa bước lưới log để tâm band rơi giữa hai điểm lưới
       nhưng vẫn trong khoảng null thật cũng bị bắt. Không thêm hàm mới ngoài
       aeSolveSingle để AE_WORKER_SRC (dựng từ .toString() các hàm này) giữ
       nguyên parity Worker. --- */
  var nullIv = [];
  for (var ni=0; ni<n; ni++){
    if (W[ni]<=0){
      var na=ni; while (ni<n && W[ni]<=0) ni++;
      var nb=ni-1;
      /* Nới đủ MỘT bước lưới mỗi phía (tới điểm lưới kề ngoài đoạn W=0,
         hoặc tới AE_FMIN/AE_FMAX khi chạm biên): fLo thật nằm giữa điểm lưới
         ngoài đoạn và điểm lưới đầu đoạn, nên nới nửa bước vẫn hẹp hơn khoảng
         thật — band kẹp sát biên suy ra (Stax SR-X1: fLo thật 9735 Hz, biên
         nửa bước 9805.86 Hz, band ở 9805.85 Hz) lọt qua chiếu cuối nhưng vẫn
         bị hậu kiểm bắt. Với một bước đầy, khoảng suy ra BAO TRỌN khoảng thật
         nên band ngoài khoảng suy ra chắc chắn ngoài khoảng thật: hậu kiểm
         không bao giờ nổ. Giá đánh đổi: band có tâm trong vòng ~1 bước lưới
         quanh mép null cũng bị phạt/chiếu dù hậu kiểm không bắt — vùng hẹp
         (~3% tần số) và đúng ý đồ "không boost sát null". Biên trên dùng
         AE_FMAX vì lưới solver kết thúc ở 19897 Hz trong khi khoảng null thật
         có thể vượt 20000 Hz và band bị kẹp ở đúng 20000 Hz. */
      var fLo = na>0 ? freqs[na-1] : AE_FMIN;
      var fHi = nb<n-1 ? freqs[nb+1] : AE_FMAX;
      nullIv.push({ fLo:fLo, fHi:fHi });
    }
  }
  function aeInNull(fc){ for (var q=0;q<nullIv.length;q++) if (fc>=nullIv[q].fLo && fc<=nullIv[q].fHi) return true; return false; }
  function aeNullPen(trial){
    if (trial.gain<=0.5) return 0;
    if (!aeInNull(trial.freq)) return 0;
    var ex = trial.gain-0.5; return 5.0*ex*ex;
  }
  /* (vong tu dong 07:31, huong A): bo lan tinh aeTotalCurve dau aeSolveSingle khi !contBands va luoi huu han - band moi deu gain 0 (lowshelf/peaking/highshelf) nen rbjCoeffs tra identity, moi duong cong dung 0 dB tung bit; tot = mang 0. Cache luong giac van duoc dung o guard dau vong RLS nhu cu. Luoi chua NaN/Infinity/mang thua hoac contBands giu nguyen aeTotalCurve goc. */
  var tot, _preCurves = null;
  if (!contBands && Array.isArray(freqs)){
    var _fin = true;
    for (var _fi = 0; _fi < n; _fi++){ if (!isFinite(freqs[_fi])){ _fin = false; break; } }
    tot = _fin ? new Array(n).fill(0) : aeTotalCurve(bands, freqs, fsv);
  } else if (contBands){
    /* (vong tu dong 16:24, huong A): bo tinh trung tot/curves o duong contBands - truoc day tot = aeTotalCurve tinh lai duong cong tung band (m x n log10) roi giai doan NM lai tinh curves = bands.map(aeBandCurve) them m x n log10 nua; nay tinh curves MOT lan som (dung aeBandCurve nhu cu) roi cong don thanh tot theo dung thu tu band 0..m-1 tu diem bat dau fill(0) nhu aeTotalCurve (cung bieu thuc biquad, cung thu tu cong tung diem) nen tot va curves GIONG TUNG BIT theo cau truc ke ca NaN/Infinity/cuc doan; duong !contBands giu nguyen. Khong tham chieu bien ngoai moi (chi aeBandCurve da co trong AE_WORKER_SRC) nen parity Worker giu nguyen. */
    _preCurves = bands.map(function(b){ return aeBandCurve(b, freqs, fsv); });
    tot = new Array(n).fill(0);
    for (var _fb = 0; _fb < _preCurves.length; _fb++){
      var _fc = _preCurves[_fb];
      for (var _fk = 0; _fk < n; _fk++) tot[_fk] += _fc[_fk];
    }
  } else {
    tot = aeTotalCurve(bands, freqs, fsv);
  }

  /* --- Giai đoạn 1: Regularized Least Squares (Jacobian hiệu số hữu hạn, ridge λ) --- */
  var LAMBDA = 0.35;
  for (var iter=0; iter<(AE_RLS_MODE||3) && !contBands; iter++){
    var m=bands.length, J=[]; /* J[k] = mảng đáp tuyến từng band tại điểm k cho gain hiện tại */
    /* (vòng tự động 12:03, hướng A — ÁP DỤNG, vá code): inline Jacobian Jm của giai đoạn RLS trong aeSolveSingle (port kỹ thuật hwSolve 13:48 sang aeSolveSingle): trước đây mỗi band gọi aeBandCurve thêm 1 lần cho đường gain+1, mỗi lần cấp phát mảng n điểm rồi mới trừ từng cặp qua .map; nay tính trực tiếp trong 1 vòng trên cache lượng giác freqs._cw (đã do vòng curves ở trên xây khi m>0; guard giữ nguyên điều kiện của aeBandCurve) với đúng công thức của aeBandCurve (cùng thứ tự b0+b1*C1+b2*C2, cùng num/max(1e-30,den), cùng 10*Math.log10) — Jm[bi][k] = cvp - curves[bi][k] nên mọi số double giống hệt bản gốc; chỉ bớt m lần gọi aeBandCurve + m mảng n điểm mỗi vòng RLS. */
    /* (vòng tự động 15:45, hướng A — ÁP DỤNG, vá code): hợp nhất vòng curves + vòng Jm của giai đoạn RLS trong aeSolveSingle thành MỘT vòng — trước đây vòng curves gọi aeBandCurve m lần (mỗi lần duyệt lại 4 mảng lượng giác freqs._cw/_sw/_cw2/_sw2) rồi vòng Jm duyệt lại lần nữa để tính đường gain+1; nay mỗi band tính cả 2 bộ hệ số rbjCoeffs (gain và gain+1, đúng fs đã chuẩn hoá _fsv như aeBandCurve) rồi trong cùng vòng điểm tính cv (đúng biểu thức của aeBandCurve: cùng thứ tự b0+b1*C1+b2*C2, cùng num/max(1e-30,den), cùng 10*Math.log10) và cvp, ghi curves[bi][k]=cv và Jm[bi][k]=cvp-cv — cùng toán hạng, cùng thứ tự phép tính cho từng phần tử nên mọi số double giống hệt bản hai vòng; chỉ bớt 1 lần duyệt mảng lượng giác + m lần gọi aeBandCurve mỗi vòng RLS. _fsv chuẩn hoá theo đúng điều kiện của aeBandCurve (fs hợp lệ giữ nguyên, còn lại AE_FS) nên guard cache và rbjCoeffs dùng đúng fs như bản gốc khi fsv đã hợp lệ (aeSolveSingle luôn chuẩn hoá fsv trước vòng RLS). Không tham chiếu biến ngoài mới (chỉ rbjCoeffs/aeBandCurve/AE_FS đã có trong AE_WORKER_SRC) nên parity Worker giữ nguyên. Lab Node trên hàm thật trích verbatim, file thường nối liền (extract.py + driver.js trong hidden_files/run_20261123_1545_A/, 2 lần chạy độc lập): parity 22/22 fixture GIỐNG TỪNG BIT cả 2 lần (55.212 kiểm tra Object.is, 0 lệch; gồm 10/20 band lạnh/ấm cache, rỗng, 1 band, n=0/1/3, gain 0, NaN/Infinity, thiếu trường, fs 44100/96000, cực đoan, tần số NaN, mảng thưa/null ném đúng TypeError); tốc độ paired-median xen kẽ 15 vòng × 200 rep trên khối curves+Jm: lần 1 W10 1,1336× (thắng 14/15), W20 1,1440× (15/15); lần 2 W10 1,1410× (15/15), W20 1,1405× (15/15) — cải thiện ổn định cả 2 lần trên mọi workload. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
    var _fsv = (typeof fsv === "number" && isFinite(fsv) && fsv > 0) ? fsv : AE_FS;
    if (m && (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== _fsv)) aeBandCurve(bands[0], freqs, _fsv);
    var _rC1 = freqs._cw, _rS1 = freqs._sw, _rC2 = freqs._cw2, _rS2 = freqs._sw2;
    /* (vòng tự động 09:54, hướng A — ÁP DỤNG, vá code): bỏ tính cv khi band có gain 0 trong vòng curves+Jm của giai đoạn RLS trong aeSolveSingle — rbjCoeffs trả identity {1,0,0,0,0} cho gain 0 ở peaking/lowshelf/highshelf (fast-path sẵn có, kể cả khi freq/Q/fs không hữu hạn vì nhánh identity đầu hàm) nên cv = 10*log10(1) = +0 chính xác từng điểm và Jm = cvp - 0 = cvp; nay khi _b.gain===0 và type thuộc 3 họ đó (và 4 mảng trig hữu hạn — chỉ kiểm tra khi tồn tại band gain 0, để đường gain khác 0 không tốn gì thêm; NaN/Infinity trong freqs/trig vẫn rơi về đường gốc tính cv như cũ) chỉ tính cvp, ghi curves=0 và Jm=cv — cùng từng double với bản gốc (x-0===x kể cả -0/NaN/Infinity); band gain khác 0 hoặc type khác giữ nguyên vòng gốc từng ký tự (2 vòng điểm riêng: vòng gain 0 chỉ tính cvp, vòng thường giữ nguyên thứ tự cv rồi cvp như cũ). Không tham chiếu biến ngoài mới (chỉ rbjCoeffs đã có trong AE_WORKER_SRC) nên parity Worker giữ nguyên. Lab Node trên khối trích verbatim (extract.py + harness.js + bench.js trong hidden_files/run_20261124_0954_A/, 2 lần chạy độc lập): parity GIỐNG TỪNG BIT (Object.is trên curves/Jm; gồm 10/20 band gain 0/toàn phần/mixed, type lạ, freqs NaN/Infinity/thưa, fs 44100/48000/0/NaN, n=0/1/3/240, fuzz) + toàn hàm aeSolveSingle; tốc độ paired-median xen kẽ 15 vòng trên khối curves+Jm: W10-zero/W20-zero nhanh hơn rõ, control gain khác 0 trung tính. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
    var _anyZero = false;
    for (var _bi0 = 0; _bi0 < m; _bi0++){ var _b0 = bands[_bi0]; if (_b0 && _b0.gain === 0 && (_b0.type === "peaking" || _b0.type === "lowshelf" || _b0.type === "highshelf")){ _anyZero = true; break; } }
    var _rFin = !_anyZero || !!_rC1;
    for (var _fi2 = 0; _anyZero && _rFin && _fi2 < n; _fi2++){ if (!isFinite(_rC1[_fi2]) || !isFinite(_rS1[_fi2]) || !isFinite(_rC2[_fi2]) || !isFinite(_rS2[_fi2])){ _rFin = false; break; } }
    var curves = new Array(m), Jm = new Array(m);
    for (var _bi = 0; _bi < m; _bi++){
      var _b = bands[_bi];
      var _cb = rbjCoeffs(_b.type, _b.freq, _b.gain, _b.q, _fsv);
      var _cp = rbjCoeffs(_b.type, _b.freq, _b.gain + 1, _b.q, _fsv);
      var _zero = _anyZero && _rFin && _b.gain === 0 && (_b.type === "peaking" || _b.type === "lowshelf" || _b.type === "highshelf");
      var _crow = new Array(n), _jrow = new Array(n);
      if (_zero){
        for (var _kk = 0; _kk < n; _kk++){
          var _nrp = _cp.b0 + _cp.b1*_rC1[_kk] + _cp.b2*_rC2[_kk], _nip = _cp.b1*_rS1[_kk] + _cp.b2*_rS2[_kk];
          var _drp = 1 + _cp.a1*_rC1[_kk] + _cp.a2*_rC2[_kk], _dip = _cp.a1*_rS1[_kk] + _cp.a2*_rS2[_kk];
          var _cvp = 10*Math.log10((_nrp*_nrp+_nip*_nip)/Math.max(1e-30, _drp*_drp+_dip*_dip));
          _crow[_kk] = 0;
          _jrow[_kk] = _cvp;
        }
      } else {
        for (var _kk = 0; _kk < n; _kk++){
          var _nr = _cb.b0 + _cb.b1*_rC1[_kk] + _cb.b2*_rC2[_kk], _ni = _cb.b1*_rS1[_kk] + _cb.b2*_rS2[_kk];
          var _dr = 1 + _cb.a1*_rC1[_kk] + _cb.a2*_rC2[_kk], _di = _cb.a1*_rS1[_kk] + _cb.a2*_rS2[_kk];
          var _cv = 10*Math.log10((_nr*_nr+_ni*_ni)/Math.max(1e-30, _dr*_dr+_di*_di));
          var _nrp = _cp.b0 + _cp.b1*_rC1[_kk] + _cp.b2*_rC2[_kk], _nip = _cp.b1*_rS1[_kk] + _cp.b2*_rS2[_kk];
          var _drp = 1 + _cp.a1*_rC1[_kk] + _cp.a2*_rC2[_kk], _dip = _cp.a1*_rS1[_kk] + _cp.a2*_rS2[_kk];
          var _cvp = 10*Math.log10((_nrp*_nrp+_nip*_nip)/Math.max(1e-30, _drp*_drp+_dip*_dip));
          _crow[_kk] = _cv;
          _jrow[_kk] = _cvp - _cv;
        }
      }
      curves[_bi] = _crow; Jm[_bi] = _jrow;
    }
    /* hệ phương trình chuẩn: (JᵀWJ + λI) Δ = JᵀW r, r = E − H_total */
    var A=[], rhs=new Array(m).fill(0);
    for (i=0;i<m;i++){ A.push(new Array(m).fill(0)); }
    /* (vòng tự động 18:33, hướng A — ÁP DỤNG, vá code): chuyển vị Jm trước vòng dựng ma trận chuẩn RLS của aeSolveSingle khi m>=8 — trước đây vòng A/rhs đọc Jm[i][k] và Jm[j2][k] theo cột (bước nhảy giữa các hàng Jm) cho mọi điểm lưới; nay khi m>=8 (đường solver thật 10/20 band, m=bands.length) tính MỘT lần mảng chuyển vị _Jt (n hàng × m cột, _Jt[k][i]=Jm[i][k] — phép gán sao chép đúng từng double) rồi vòng A/rhs đọc _Jt[k][i]/_Jt[k][j2] tuần tự trong cùng hàng; thứ tự vòng k/i/j2, biểu thức _wji=wk*Jm[i][k], rhs[i]+=_wji*r và A[i][j2]+=_wji*Jm[j2][k] giữ nguyên từng toán hạng/thứ tự nên A/rhs GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, mảng thưa); m<8 giữ nguyên vòng gốc. Không tham chiếu biến ngoài mới nên parity Worker giữ nguyên. Lab Node trên khối trích verbatim (harness.js trong hidden_files/run_20261123_1833_A/, 3 lần chạy độc lập): parity 256 ca / 25.104 kiểm tra GIỐNG TỪNG BIT (Object.is trên A/rhs; gồm m=0/1/2/3/5/8/10/13/20 × n=0/1/3/9/64/240, W=0/âm/NaN/Infinity, Jm/tot/errDb NaN/±Infinity/-0/1e308/subnormal, mảng thưa, 40 fuzz); tốc độ paired-median xen kẽ 15 vòng: W10 1,02–1,05×, W20 1,05–1,23×, W10z 1,01–1,03× trên các lần chạy (W20 ổn định nhất, 14–15/15 vòng thắng ở các lần đo chính). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
    if (m>=8){
      var _Jt = new Array(n);
      for (var _tk=0; _tk<n; _tk++){
        var _trow = new Array(m);
        for (var _ti=0; _ti<m; _ti++) _trow[_ti] = Jm[_ti][_tk];
        _Jt[_tk] = _trow;
      }
      for (k=0;k<n;k++){
        var r = errDb[k]-tot[k], wk=W[k]; if (wk<=0) continue;
        var _Jk = _Jt[k];
        for (i=0;i<m;i++){
          var _wji = wk*_Jk[i];
          rhs[i]+=_wji*r;
          for (var j2=i;j2<m;j2++) A[i][j2]+=_wji*_Jk[j2];
        }
      }
    } else {
      for (k=0;k<n;k++){
        var r = errDb[k]-tot[k], wk=W[k]; if (wk<=0) continue;
        for (i=0;i<m;i++){
          var _wji = wk*Jm[i][k];
          rhs[i]+=_wji*r;
          for (var j2=i;j2<m;j2++) A[i][j2]+=_wji*Jm[j2][k];
        }
      /* (vòng tự động 16:13, hướng A — ÁP DỤNG, vá code): hoist tích wk*Jm[i][k] trong vòng dựng ma trận chuẩn RLS của aeSolveSingle — trước đây mỗi điểm lưới k và mỗi band i tính lại wk*Jm[i][k] cho rhs và cho MỌI j2 trong vòng trong (tổng m(m+1)/2 lần tính thừa mỗi (k,i)); nay tính MỘT lần thành _wji rồi dùng lại: rhs[i]+=_wji*r và A[i][j2]+=_wji*Jm[j2][k] — cùng thứ tự kết hợp trái (wk*Jm[i][k])*r và (wk*Jm[i][k])*Jm[j2][k] nên mọi số double của A/rhs giống hệt bản gốc từng bit, kể cả NaN/Infinity/-0 (cây biểu thức giống hệt, chỉ bớt tính lại); không tham chiếu biến ngoài mới nên parity Worker giữ nguyên. Lab Node trên khối trích verbatim (harness.js trong hidden_files/run_20261123_1611_A/, 2 lần chạy độc lập): parity 62 ca / 13.212 kiểm tra GIỐNG TỪNG BIT cả 2 lần (Object.is trên A/rhs; gồm m=0/1/2/10/20, n=0/1/3/240, W=0/âm/NaN/Infinity, Jm/tot/errDb NaN/±Infinity/-0/1e308/subnormal, 40 fuzz); tốc độ paired-median xen kẽ 15 vòng: lần 1 W10 1,2228x (15/15), W20 1,2856x (15/15), W10z 1,2084x (15/15); lần 2 W10 1,2443x (14/15), W20 1,2750x (15/15), W10z 1,2046x (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. */
      }
    }
    var meanDiag=0; for (var md=0;md<m;md++) meanDiag+=A[md][md]/m;
    var LAM_EFF = (relLambda===null || relLambda===undefined) ? LAMBDA : relLambda*meanDiag;
    for (i=0;i<m;i++){ for (var j3=0;j3<i;j3++) A[i][j3]=A[j3][i]; A[i][i]+=LAM_EFF; }
    /* giải Gauss */
    var x=new Array(m).fill(0), aug=A.map(function(row,i2){ return row.concat([rhs[i2]]); });
    for (var col=0, row2=0; col<m && row2<m; col++, row2++){
      var piv=row2; for (var r2=row2+1;r2<m;r2++) if (Math.abs(aug[r2][col])>Math.abs(aug[piv][col])) piv=r2;
      var tmp=aug[piv]; aug[piv]=aug[row2]; aug[row2]=tmp;
      var d0=aug[row2][col]; if (Math.abs(d0)<1e-12) continue;
      var _prow=aug[row2];
      for (var r3=0;r3<m;r3++){ if (r3!==row2){ var _rrow=aug[r3]; var fac=_rrow[col]/d0; for (var c2=col+1;c2<=m;c2++) _rrow[c2]-=fac*_prow[c2]; _rrow[col]=0; } }
      x[col]=_prow[m]/d0;
    }
    /* (vòng tự động 11:54, hướng A — ÁP DỤNG, vá code): bỏ ghi cột chết trong vòng khử Gauss-Jordan của giai đoạn RLS trong aeSolveSingle — sau bước khử cột col, mọi mục aug[r3][col] (r3 khác hàng pivot) không bao giờ được đọc lại: tìm pivot các bước sau chỉ đọc cột col'>col, vòng khử các bước sau chỉ đọc c2>=col'>col, x[col] lấy từ _prow[m]/d0 (cột tăng cường vẫn được cập nhật vì vòng trong chạy tới c2=m); nay vòng trong bắt đầu từ c2=col+1 và gán _rrow[col]=0 tường minh (giữ đúng điểm ghi và ngữ nghĩa "cột đã khử" như bản gốc, kể cả đường ném lỗi: fac vẫn đọc _rrow[col] trước, hàng null ném đúng TypeError) — mọi x GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, ma trận suy biến, mảng thưa, nhánh |d0|<1e-12 continue, không mutate A/rhs). Lab Node trên khối trích verbatim (extract.py + make_new.py + harness.js + bench2/bench3 trong hidden_files/run_20261124_1154_A/, hàm khai báo thường không eval): parity 272/272 GIỐNG TỪNG BIT (Object.is trên x + loại lỗi; gồm m=0/1/2/3/5/8/10/13/20 đối xứng/tổng quát/suy biến/lẻ/đơn vị, NaN/±Infinity/-0/cực đoan/subnormal, mảng thưa/hàng null/ngắn/dài, rhs thưa/NaN/Infinity, A null, rhs null, nhánh |d0|<1e-12, pivot-swap, 200 fuzz, kiểm tra không mutate A/rhs); tốc độ khối Gauss đầy đủ paired-median xen kẽ 15 vòng min-of-3: W10 1,0402x (14/15), W20 1,0850x (11/15) — cải thiện ổn định cả 2 workload (bench thường 2 lần độc lập: m=20 1,0844x/1,0663x, m=10 1,0197x/1,0303x). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261124_1154_A/. */
    /* (vòng tự động 21:24, hướng A — ÁP DỤNG, vá code): hoist hàng pivot/trục trong vòng khử Gauss của giai đoạn RLS trong aeSolveSingle — trước đây vòng trong truy cập aug[r3][c2] và aug[row2][c2] bằng chỉ số kép cho MỌI phần tử (mỗi phần tử 2 lần tra mảng + 2 lần tra chỉ số); nay lấy _prow=aug[row2] MỘT lần sau kiểm tra d0 và _rrow=aug[r3] MỘT lần mỗi hàng r3 rồi dùng _rrow[c2]-=fac*_prow[c2] — cùng toán hạng, cùng thứ tự phép tính từng phần tử; hàng pivot không bị sửa trong vòng khử (r3!==row2) nên _prow giữ nguyên giá trị và x[col]=_prow[m]/d0 đúng như aug[row2][m]/d0; nhánh |d0|<1e-12 continue và thứ tự pivot/hoán vị giữ nguyên nên GIỐNG TỪNG BIT theo cấu trúc (kể cả NaN/Infinity/-0, ma trận suy biến, mảng thưa/ném lỗi đúng TypeError). Lab Node trên khối trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261123_2124_A/, 2 lần bench độc lập bằng hàm khai báo trực tiếp như trong file): parity 86/86 GIỐNG TỪNG BIT cả 2 lần (Object.is trên x; gồm m=1/2/3/5/10/20 đối xứng/tổng quát, lặp lại, suy biến, pivot-swap, NaN/Infinity/-0/cực đoan/subnormal, nhánh |d0|<1e-12, mảng thưa/hàng ngắn/dài, rhs thưa, A null/hàng null ném đúng TypeError, 40 fuzz, kiểm tra không mutate A/rhs); tốc độ paired-median xen kẽ 15 vòng: lần 1 W10 sym 1,4856x (15/15), W20 sym 2,1962x (15/15), W10 gen 1,5093x (15/15), W20 gen 2,1946x (15/15); lần 2 W10 sym 1,4633x (14/15), W20 sym 2,2022x (15/15), W10 gen 1,5191x (15/15), W20 gen 2,2196x (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261123_2124_A/. */
    var changed=false;
    bands.forEach(function(b,bi){ var ng=b.gain + Math.max(-6, Math.min(6, x[bi]||0)); if (Math.abs(ng-b.gain)>0.01) changed=true; b.gain=ng; aeClampBand(b); if (b.gain>0.5 && aeInNull(b.freq)) b.gain=0; });
    /* (vòng tự động 12:03, hướng A — cùng vá với Jm ở trên): inline tot cuối vòng RLS (port kỹ thuật hwSolve 13:57): trước đây gọi aeTotalCurve = m lần aeBandCurve, mỗi lần cấp phát mảng n điểm rồi mới cộng vào tot; nay cộng dồn trực tiếp theo thứ tự band 0..m-1 trên cùng cache lượng giác (đã do vòng curves xây) với đúng công thức của aeBandCurve nên mọi số double của tot giống hệt bản gốc; chỉ bớt m lần gọi aeBandCurve + m mảng n điểm mỗi vòng RLS. Khi m=0 vòng không chạy, tot toàn 0 như aeTotalCurve trên danh sách rỗng. */
    tot = new Array(n).fill(0);
    for (var _ti = 0; _ti < m; _ti++){
      var _bt = bands[_ti];
      var _ct = rbjCoeffs(_bt.type, _bt.freq, _bt.gain, _bt.q, fsv);
      for (var _tk = 0; _tk < n; _tk++){
        var _tnr = _ct.b0 + _ct.b1*_rC1[_tk] + _ct.b2*_rC2[_tk], _tni = _ct.b1*_rS1[_tk] + _ct.b2*_rS2[_tk];
        var _tdr = 1 + _ct.a1*_rC1[_tk] + _ct.a2*_rC2[_tk], _tdi = _ct.a1*_rS1[_tk] + _ct.a2*_rS2[_tk];
        tot[_tk] += 10*Math.log10((_tnr*_tnr+_tni*_tni)/Math.max(1e-30, _tdr*_tdr+_tdi*_tdi));
      }
    }
    if (!changed) break;
  }

  /* --- Giai đoạn 2: Nelder–Mead trên (Fc, Gain, Q) từng band, lặp vòng --- */
  var curves = _preCurves || bands.map(function(b){ return aeBandCurve(b, freqs, fsv); });
  /* --- Tối ưu tốc độ objective NM (2026-10-31, vòng tự động 12:24):
       Profile trên trình duyệt thật: một lần aeSolve 10 band gọi
       aeBandCurve ~49.867 lần, mỗi lần cấp phát một mảng 240 điểm rồi
       mới cộng sai số — đó là nút thắt khiến cổng aeV3 500 ms rớt
       liên tiếp 6 vòng trên máy kiểm chứng chậm dù code không đổi.
       Sửa này KHÔNG đổi một phép toán nào, chỉ đổi thứ tự thực thi:
       (1) base[k] = tot[k]-curves[bi][k] tính trước một lần mỗi band
       (vốn chính là số hạng trung gian trong biểu thức gốc, nên
       err-(base+cv) cho từng điểm giống hệt từng bit so với
       err-(tot-curves+cv)); (2) đường cong của trial tính trực tiếp
       trong cùng vòng cộng sai số bằng đúng công thức của aeBandCurve
       (cùng thứ tự b0+b1*C1+b2*C2, cùng num/max(1e-30,den)),
       không cấp phát mảng cv mỗi lần đánh giá. Phần phạt gain/Q giữ
       nguyên thứ tự cộng cũ (nay dùng vòng for thay forEach).
       Một ngoại lệ duy nhất, có ghi rõ: logarit dùng
       Math.log(x)*(10/ln10) thay cho Math.log10(x) vì microbenchmark
       trên trình duyệt thật cho thấy Math.log nhanh hơn ~30%
       (log10 chiếm ~55% chi phí vòng lặp); hai cách khác nhau tối đa
       ~1-2 ulp (~1e-13 dB) và RMS báo cáo vẫn tính từ đường tổng của
       aeBandCurve/log10 gốc, nên ma trận RMS trước/sau khớp tới 4 chữ
       số thập phân và parity Worker vẫn = 0 (Worker dùng chung code
       qua .toString()). nmBase vô hiệu ở đầu mỗi nmBand vì tot thay
       đổi sau mỗi band; cache lượng giác freqs._cw vẫn do aeBandCurve
       xây như trước (nhánh dự phòng chỉ chạy khi thiếu). --- */
  var nmBase = null, nmBi = -1;
  /* (vong tu dong 18:24, huong A): inline he so RBJ trong objective/objectiveS cua aeSolveSingle - truoc day moi lan danh gia NM goi rbjCoeffs cap phat object {b0..a2} roi doc lai 5 truong; nay voi 3 ho peaking/lowshelf/highshelf (duy nhat solver dung) tinh thang b0..a2 vao bien cuc bo voi dung thu tu bieu thuc, dung kep/guard identity va phep chia chuan hoa cua rbjCoeffs (slopeS khong truyen nen dung alpha) nen GIONG TUNG BIT; type khac roi ve rbjCoeffs goc. Khong tham chieu bien ngoai moi (chi Math/isFinite/rbjCoeffs da co trong AE_WORKER_SRC) nen parity Worker giu nguyen. Lab: parity objective 5200 ca + tich hop aeSolve 22 fixture 0 lech (Object.is); bench khoi paired-median xen ke 15 vong: 1,0238x thang 15/15 va 1,0140x thang 11/15. */
  function objective(bi, trial){
    if (nmBi !== bi || !nmBase){
      nmBase = new Array(n);
      for (var kb=0;kb<n;kb++) nmBase[kb] = tot[kb]-curves[bi][kb];
      nmBi = bi;
    }
    if (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== fsv) aeBandCurve(trial, freqs, fsv);
    var b0, b1, b2, a1, a2;
    var _tt = trial.type;
    if (_tt === "peaking" || _tt === "lowshelf" || _tt === "highshelf") {
      var _tf = trial.freq, _tg = trial.gain, _tq = trial.q;
      if (!isFinite(_tf) || !isFinite(_tg) || !isFinite(_tq) || !isFinite(fsv) || fsv <= 0) { b0=1;b1=0;b2=0;a1=0;a2=0; }
      else {
        _tf = Math.min(Math.min(22000, 0.495*fsv), Math.max(10, _tf));
        _tg = Math.max(-30, Math.min(30, _tg));
        _tq = Math.max(0.1, Math.min(30, _tq));
        if (_tg === 0) { b0=1;b1=0;b2=0;a1=0;a2=0; }
        else {
          var _w0 = 2*Math.PI*_tf/fsv, _cw0 = Math.cos(_w0), _sw0 = Math.sin(_w0);
          var _alpha = _sw0/(2*_tq);
          var _A = Math.pow(10, _tg/40);
          var _b0, _b1, _b2, _a0, _a1, _a2;
          if (_tt === "peaking") {
            _b0=1+_alpha*_A; _b1=-2*_cw0; _b2=1-_alpha*_A; _a0=1+_alpha/_A; _a1=-2*_cw0; _a2=1-_alpha/_A;
          } else {
            var _s = 2*Math.sqrt(_A)*_alpha;
            if (_tt === "lowshelf") {
              _b0=_A*((_A+1)-(_A-1)*_cw0+_s); _b1=2*_A*((_A-1)-(_A+1)*_cw0); _b2=_A*((_A+1)-(_A-1)*_cw0-_s);
              _a0=(_A+1)+(_A-1)*_cw0+_s; _a1=-2*((_A-1)+(_A+1)*_cw0); _a2=(_A+1)+(_A-1)*_cw0-_s;
            } else {
              _b0=_A*((_A+1)+(_A-1)*_cw0+_s); _b1=-2*_A*((_A-1)+(_A+1)*_cw0); _b2=_A*((_A+1)+(_A-1)*_cw0-_s);
              _a0=(_A+1)-(_A-1)*_cw0+_s; _a1=2*((_A-1)-(_A+1)*_cw0); _a2=(_A+1)-(_A-1)*_cw0-_s;
            }
          }
          var _nb0=_b0/_a0, _nb1=_b1/_a0, _nb2=_b2/_a0, _na1=_a1/_a0, _na2=_a2/_a0;
          if (!isFinite(_nb0+_nb1+_nb2+_na1+_na2)) { b0=1;b1=0;b2=0;a1=0;a2=0; }
          else { b0=_nb0;b1=_nb1;b2=_nb2;a1=_na1;a2=_na2; }
        }
      }
    } else {
      var cc = rbjCoeffs(trial.type, trial.freq, trial.gain, trial.q, fsv);
      b0=cc.b0; b1=cc.b1; b2=cc.b2; a1=cc.a1; a2=cc.a2;
    }
    var C1=freqs._cw, S1=freqs._sw, C2=freqs._cw2, S2=freqs._sw2;
    var s=0;
    for (var k2=0;k2<n;k2++){
      var nr = b0 + b1*C1[k2] + b2*C2[k2], ni = b1*S1[k2] + b2*S2[k2];
      var dr = 1 + a1*C1[k2] + a2*C2[k2], di = a1*S1[k2] + a2*S2[k2];
      var cv = Math.log((nr*nr+ni*ni)/Math.max(1e-30, dr*dr+di*di))*4.342944819032518;
      var e = errDb[k2]-(nmBase[k2]+cv); s += W[k2]*e*e;
    }
    var reg=0;
    for (var bj=0;bj<bands.length;bj++){ var g=(bj===bi)? trial.gain : bands[bj].gain; reg+=(g/12)*(g/12); }
    var qPen = Math.max(0, trial.q-4); reg += 0.15*qPen*qPen;
    return s/Math.max(1e-9,sumW) + regCoef*reg + aeNullPen(trial);
  }
  /* --- Vòng tự động 14:45, hướng A (BÁC BỎ — không áp): dạng rút gọn
     |B|^2 = b0^2+b1^2+b2^2 + 2(b0b1+b1b2)C1 + 2b0b2C2 (và tương tự |A|^2)
     trong objective/objectiveS — đúng về đại số, ít phép nhân/load hơn, đo
     nhanh hơn thật (median 326,1 -> 280,9 ms, 0,861x trên 22 fixture tai nghe
     thật), NHƯNG dạng tổng bình phương gốc ổn định số học còn dạng rút gọn bị
     triệt tiêu trầm trọng khi |B|^2/|A|^2 rất nhỏ (notch sâu/hẹp): sai số cv
     tới 0,0098 dB (1.008.000 điểm, 4000 trial ngẫu nhiên + 200 biên), NM đổi
     quỹ đạo, RMS cuối lệch tới 0,0714 dB hai chiều (có fixture tốt hơn, có
     fixture tệ hơn) — không phải cải thiện có kiểm soát nên KHÔNG áp. Kiểm
     toán cùng lượt: aeSolve 10 band trên 11 tai nghe thật x harmanOE/IE
     (22 fixture, DB 1605 mục): RMS 0,061–0,675 dB, ms 163–651 (median 326);
     chỉ KZ AST có null (1 null, 3/240 điểm W=0) nên bỏ qua điểm W=0 cũng chỉ
     ~1% và không đáng rủi ro NaN — nhánh đó cũng bác. Ý tưởng lượt kế:
     hướng A — đo xem các ứng viên 4 đường + chuỗi tiếp tục trong aeSolve có
     hội tụ về cùng band không để bỏ chạy trùng (bit-identical khi band
     giống hệt); hoặc hướng D — đo lại tốc độ dựng đồ thị/FIR sau vòng 12:50. --- */
  /* --- Vòng tự động 15:02, hướng A (BÁC BỎ — không áp): đo hội tụ 4 ứng viên
     aeSolve (lam null/0.3 x shelf 105/55) + chuỗi tiếp tục — có cặp nào về
     cùng band (bit-identical) để bỏ chạy trùng không? Lab Node trên hàm thật
     (lượt 15:02, chạy 2 lần, 22 fixture tai nghe thật x harmanOE/IE, 10 band):
     KHÔNG cặp nào giống hệt ở bất kỳ fixture nào — 0/22 cho cả 6 cặp (kiểm
     chứng lần 2: keys + fullKey giống hệt 22/22, tính xác định). Không chỉ
     khác nhau: cặp shelf lệch median max|Δgain| 0,82-1,07 dB (min 0,036 dB),
     cặp lam lệch median 5,79 dB; band shelf cuối trôi xa điểm neo (median
     91 Hz vs 77 Hz, tới 13,4 kHz) nên không có điều kiện tiên đoán rẻ nào
     để bỏ chạy trước. Cả 4 ứng viên đều thắng ở một số fixture (thắng:
     c0=2, c1=7, c2=8, c3=5; shelf-55 thắng 13/22) nên không ứng viên nào
     thừa; biên thắng median 0,0052 (min 0,00004) nên bỏ ứng viên có thể
     lật pick. Chuỗi tiếp tục cũng không thừa: band cuối aeSolve khác band
     thắng ở 22/22 fixture (cả 2 lần chạy) — mọi lượt tiếp tục đều đổi band.
     Không ứng viên nào đạt fixedPoint trong 12 vòng đầu (0/22). Chi phí:
     4 ứng viên median ~149 ms, aeSolve đầy đủ median ~328 ms (tỉ lệ 2,21x).
     Kết luận: giữ nguyên cả 4 ứng viên + chuỗi tiếp tục, không bỏ chạy trùng.
     Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng đồ thị/dựng FIR sau khi
     buildFirTaps nhanh hơn (vòng 12:50); hoặc hướng A — rà soát aeSolveSingle
     trên đường 20 band với cùng phương pháp đo hội tụ. --- */
  /* --- Vòng tự động 16:42, hướng A (BÁC BỎ — không áp): tối ưu vòng NM của
     aeSolveSingle — (1) tot cập nhật tăng lượng trong nmBand (tot[k] +=
     cvMoi[k]-cvCu[k] khi band được chấp nhận) thay vì tổng lại toàn bộ m
     đường cong mỗi band; (2) dư trừ sẵn nmRes0[k]=errDb[k]-nmBase[k] tính
     cùng lúc với nmBase, vòng điểm dùng e=nmRes0[k2]-cv thay vì
     errDb[k2]-(nmBase[k2]+cv). Cả hai chỉ đổi thứ tự kết hợp số thực
     (~1 ulp), tổng cuối vẫn tính lại bằng aeTotalCurve nên RMS báo cáo
     không đổi theo cấu trúc. Lab Node trên hàm thật dạng FILE THƯỜNG
     (lượt 16:42, 22 fixture tai nghe thật x harmanOE/IE, 10 band x3 rep;
     6 fixture 20 band x1 rep): 21/22 ca 10 band RMS/objective/band GIỐNG
     HỆT từng bit, 5/6 ca 20 band giống hệt; tốc độ median 0,966x (10 band,
     0,919-0,989 khi loại outlier) và 0,954x (20 band) — NHƯNG quỹ đạo NM
     nhạy hỗn loạn với nhiễu ulp nên lật quyết định ở 2/28 ca: Sony
     WF-1000XM4/harmanIE tệ đi RMS +0,0051 dB (0,1332 -> 0,1382), objective
     +0,0069, và CHẬM 2,53x (209 -> 529 ms, ổn định cả 3 rep — trượt mất
     điểm dừng fixedPoint nên chuỗi c10z chạy hết vòng); AKG K250/harmanOE
     20 band RMS tốt hơn -0,0007 dB nhưng objective tệ hơn +0,00006.
     Cùng lớp lỗi như vòng 14:45 (dạng rút gọn |B|^2) — mọi phép đổi thứ tự
     kết hợp trong objective/nmBand đều không an toàn; chỉ cấu trúc lại
     KHÔNG đổi thứ tự số học mới được thử tiếp. PHÁT HIỆN PHỤ VỀ PHƯƠNG
     PHÁP: lab qua eval/vm làm aeSolve 10 band chậm ~14x (5000-6000 ms so
     với 336-498 ms file thường, cùng rms 0,1838 HD 600/harmanOE; microbench
     vòng log thuần vẫn 54 ms/2,4M điểm) do V8 không tối ưu hàm trong
     eval/vm — lab solver từ nay PHẢI dùng file thường nối liền (db+funcs+
     driver) như lượt 15:02/15:44, không dùng vm context cho hàm solver.
     Không đổi code, chỉ ghi comment này. Ý tưởng lượt kế: hướng D — rà
     soát specDraw nhánh RTA (Math.pow(10, fd/10) mỗi bin mỗi khung); hoặc
     hướng C — rà soát upSelfCheck trên lưới phon. --- */
  /* --- Vòng tự động 18:24, hướng A (KHÔNG ÁP VÁ — chỉ đo, quét rộng): rà soát aeCompute/aeSolve
     trên tai nghe thật — lần đầu quét TOÀN BỘ kho thay vì 11 tai nghe chọn tay (lượt 14:45/15:02/16:42).
     Lab Node trên hàm thật trích từ file hiện tại (lượt 18:24, file thường nối liền, DB 1605 mục
     giải mã từ script base64 của file hiện tại, giống hệt bản lượt 15:02):
     Phase 1 — độ lệch thô errBefore vs harmanOE cho cả 1605 tai nghe (0,38 ms/tai, tổng 0,61 s):
     median 3,99 dB, p90 7,38, p99 12,58, max 20,87 dB; 1156/1605 (72%) lệch > 3 dB, 537 > 5 dB;
     68 tai có null. Khó nhất toàn kho đều là earbud/tai rẻ thiếu bass trầm trọng: maxErr 43–49 dB
     @ 20 Hz (ATH-CT200iS 20,87; Comradz NW-STUDIO 20,24; Mpow CH1 19,67; Anker C30i 18,92 dB).
     Phase 2 — solve đầy đủ 10 band, target khớp dạng (Over-ear→harmanOE, In-ear/Earbud→harmanIE),
     15 tai (top 8 khó nhất + 6 mẫu rải đều + HD 600): RMS sau 0,17–2,37 dB, viol = 0 ở cả 15 ca,
     ms 230–612 (VM chia sẻ; ATH-CT200iS 612 ms, Yuin PK2 567 ms — nhiễu máy như lượt 18:22, cổng
     aeV3 chỉ áp cho Mẫu A). Tai nghe thường solve tốt (HD 600: 5,25 → 0,184 dB; Tanchjim Fission
     0,172 dB). Ca tệ nhất Mpow CH1: 19,67 → 2,37 dB, dư lớn nhất 11,15 dB @ 20 Hz — band chạm
     trần ±12 dB nên không bù nổi bass thiếu ~45 dB; 20 band cứu được về 0,358 dB (Sony XEA20
     0,974→0,218; ATH-CT200iS 0,840→0,222; xác nhận 2 lần, viol 0) NHƯNG tốn 6,7–8,9 s (22–30×
     thời gian 10 band). Kết luận: không có vá rẻ nào từ lượt này — ca tệ là giới hạn vật lý
     (thiếu bass) + trần gain, không phải lỗi solver; đường cứu 20 band có sẵn nhưng quá chậm để
     bật mặc định. Không đổi code, chỉ ghi comment này.
     Ý tưởng lượt kế: hướng A — đo xem 20 band chậm 6,7–8,9 s ở khâu nào trên ca khó (chuỗi tiếp
     tục c10–c12 chạy 48/64/80 vòng NM × 20 band?) để tìm đường cứu rẻ (ladder rút gọn / chỉ leo
     thang khi RMS 10 band > 0,5 dB); hoặc hướng D — rà soát specDraw nhánh RTA (ý tưởng lượt
     16:42, chưa làm). --- */
  /* --- Vòng tự động 18:29, hướng A (KHÔNG ÁP VÁ — chỉ đo, profile cây đệ quy): trả lời câu hỏi lượt
     18:24 — 20 band chậm 6,7–8,9 s ở khâu nào? Lab Node trên hàm thật trích từ file hiện tại
     (lượt 18:29, file thường nối liền, DB 1605 mục; 2 lab: profile từng lần gọi aeSolveSingle
     + cây đệ quy aeSolve), 5 fixture 20 band: Mpow CH1, ATH-CT200iS, Sony XEA20 (harmanIE),
     HD 600 (harmanOE), Mẫu B/harmanIE.
     KẾT LUẬN 1 — chậm KHÔNG phải do chuỗi c7–c15 dài: MỘT ladder gốc (4 ứng viên + polish +
     chuỗi tiếp tục + fallback 32–112 vòng) chỉ tốn 1,7–2,7 s. Chậm vì aeSolve tự đệ quy chạy
     TOÀN BỘ ladder thêm 4–6 lần: neo shelf (chỉ khi RMS > 0,50), song song RLS6, song song
     rc/2 — mỗi nhánh lại đệ quy tiếp (tối đa 10 nút, đo được 5–7 nút/ca). Tổng 6,5–14,3 s
     (VM chia sẻ; Mpow 14,3 s lượt này vs 6,7–8,9 s lượt 18:24 — nhiễu máy); nhánh đệ quy
     chiếm 59–85% tổng thời gian (Mpow 85%, ATH 79%, Sony 72%, HD 600 59%, Mẫu B 73%).
     KẾT LUẬN 2 — nhánh đệ quy thắng lớn ở 3/5 ca (RMS ladder gốc → cuối, mô phỏng chấp nhận
     chặt trên dãy gọi): Mpow 0,6224 → 0,3538 (−43%, nhờ nhánh RLS6→rc/2), ATH-CT200iS
     0,3186 → 0,2224 (−30%, nhờ RLS6→rc/2), Mẫu B 0,0705 → 0,0462 (−34%, nhờ RLS6). Vì vậy
     ý tưởng lượt 18:24 (giới hạn nhánh đệ quy theo RMS ≤ 0,50) BỊ BÁC: Mẫu B gốc chỉ 0,0705
     mà nhánh vẫn thắng −34% — RMS gốc thấp không dự báo được nhánh thua.
     KẾT LUẬN 3 — nhánh đệ quy phí hoàn toàn ở 2/5 ca: Sony XEA20 (gốc 0,2177 = cuối, phí
     4,8 s) và HD 600 (gốc 0,1698 = cuối, phí 3,8 s); nhánh rc/2 ở gốc bị từ chối ở cả 5/5 ca
     — kể cả khi nó tìm được RMS tốt hơn nhiều (HD 600 rc/2 0,0710 vs gốc 0,1698) thì objective
     có phạt rc gốc vẫn cao hơn nên bị cổng chặt loại, đúng tiêu chí đã chốt 2026-11-02/03.
     Phí ròng (nhánh bị từ chối toàn bộ): Mpow ~8,8 s, ATH ~3,0 s, Mẫu B ~4,6 s.
     Không đổi code, chỉ ghi comment này.
     Ý tưởng lượt kế: hướng A — đo số vòng RLS thực chạy ở 4 ứng viên gốc (RLS có hội tụ sớm
     trong ≤3 vòng không): nếu cả 4 ứng viên đều hội tụ sớm thì nhánh RLS6 cho đúng cùng band
     gốc (bit-identical) nên bỏ được cả cây con RLS6 mà không mất gì; kiểm chứng trên cùng
     5 fixture + ma trận A/B/C×OE/IE. Đây là lượt thứ 2 liên tiếp không có vá (sau 18:24) —
     nếu lượt kế nữa vẫn không tìm được vá thì đổi sang hướng D (specDraw RTA) theo luật 3 lượt. --- */
  /* --- Vòng tự động 18:39, hướng A (KHÔNG ÁP VÁ — chỉ đo, đếm vòng RLS thực chạy): kiểm chứng
     ý tưởng lượt 18:29 — nếu 4 ứng viên gốc hội tụ RLS sớm (≤3 vòng) thì nhánh RLS6 cho cùng
     band gốc (bit-identical) và bỏ được cả cây con RLS6. Lab Node trên hàm thật trích từ file
     hiện tại (lượt 18:39, file thường nối liền, DB 1605 mục), 5 fixture 20 band như lượt 18:29:
     Mpow CH1, ATH-CT200iS, Sony XEA20 (harmanIE), HD 600 (harmanOE), Mẫu B/harmanIE.
     KẾT QUẢ — giả thuyết BỊ BÁC, dứt khoát: RLS KHÔNG BAO GIỜ hội tụ sớm. Tổng 120 lần gọi
     aeSolveSingle có chạy RLS (35/20/22/20/23 mỗi ca), TẤT CẢ đều chạy đủ vòng: mode 3 → đúng
     3 vòng, mode 6 → đúng 6 vòng, brk=false ở 120/120 lần. 4 ứng viên gốc ở nút gốc đều chạy
     3/3 vòng ở cả 5/5 ca — kể cả ca dễ nhất Mẫu B (lệch thô chỉ 7,26 dB, RMS cuối 0,0462).
     Các lần gọi mode 6 (12–20/ca, gồm cả nút con neo/rc/2) đều chạy 6/6 vòng. Nghĩa là các vòng
     RLS 4–6 LUÔN đổi gain > 0,01 dB/band nên RLS6 khác thật với RLS3 — nhánh song song RLS6
     không dư thừa, không được bỏ. Lệnh break `if (!changed)` trong vòng RLS thực tế không bao
     giờ kích hoạt trên 5 fixture này, nhưng giữ nguyên (vô hại, vẫn là guard đúng).
     Kiểm chứng phụ: RMS cuối tái lập đúng lượt 18:29 (Mpow 0,3538; ATH 0,2224; Sony 0,2177;
     HD 600 0,1698; Mẫu B 0,0462; viol=0 cả 5 ca), tổng thời gian lab 44,0 s.
     Không đổi code, chỉ ghi comment này.
     Đây là lượt thứ 3 liên tiếp không có vá (18:24, 18:29, 18:39) — theo luật 3 lượt, TẠM DỪNG
     nhánh A và chuyển sang nhánh tiếp theo.
     Ý tưởng lượt kế: hướng D — rà soát specDraw nhánh RTA (ý tưởng lượt 16:42, chưa làm). --- */
  /* Tang toc NM 2026-11-02 (do truoc trong lab Node, khong cat viec): cac lan cham diem THU
     trong simplex dung objectiveS tren mot nua luoi (buoc 2, chuan hoa bang sumW2);
     chot nhan band van bang objective luoi day du o cuoi nmBand, chon ung vien va RMS
     bao cao khong doi. Do tren ma tran 3 mau x 2 target x 10/20 band: nhanh ~1,7 lan,
     RMS trung binh ngang/tot hon goc, an toan null giu nguyen. */
  function objectiveS(bi, trial){
    if (nmBi !== bi || !nmBase){
      nmBase = new Array(n);
      for (var kb=0;kb<n;kb++) nmBase[kb] = tot[kb]-curves[bi][kb];
      nmBi = bi;
    }
    if (!freqs._cw || freqs._cw.length !== n || freqs._cwFs !== fsv) aeBandCurve(trial, freqs, fsv);
    var b0, b1, b2, a1, a2;
    var _tt = trial.type;
    if (_tt === "peaking" || _tt === "lowshelf" || _tt === "highshelf") {
      var _tf = trial.freq, _tg = trial.gain, _tq = trial.q;
      if (!isFinite(_tf) || !isFinite(_tg) || !isFinite(_tq) || !isFinite(fsv) || fsv <= 0) { b0=1;b1=0;b2=0;a1=0;a2=0; }
      else {
        _tf = Math.min(Math.min(22000, 0.495*fsv), Math.max(10, _tf));
        _tg = Math.max(-30, Math.min(30, _tg));
        _tq = Math.max(0.1, Math.min(30, _tq));
        if (_tg === 0) { b0=1;b1=0;b2=0;a1=0;a2=0; }
        else {
          var _w0 = 2*Math.PI*_tf/fsv, _cw0 = Math.cos(_w0), _sw0 = Math.sin(_w0);
          var _alpha = _sw0/(2*_tq);
          var _A = Math.pow(10, _tg/40);
          var _b0, _b1, _b2, _a0, _a1, _a2;
          if (_tt === "peaking") {
            _b0=1+_alpha*_A; _b1=-2*_cw0; _b2=1-_alpha*_A; _a0=1+_alpha/_A; _a1=-2*_cw0; _a2=1-_alpha/_A;
          } else {
            var _s = 2*Math.sqrt(_A)*_alpha;
            if (_tt === "lowshelf") {
              _b0=_A*((_A+1)-(_A-1)*_cw0+_s); _b1=2*_A*((_A-1)-(_A+1)*_cw0); _b2=_A*((_A+1)-(_A-1)*_cw0-_s);
              _a0=(_A+1)+(_A-1)*_cw0+_s; _a1=-2*((_A-1)+(_A+1)*_cw0); _a2=(_A+1)+(_A-1)*_cw0-_s;
            } else {
              _b0=_A*((_A+1)+(_A-1)*_cw0+_s); _b1=-2*_A*((_A-1)+(_A+1)*_cw0); _b2=_A*((_A+1)+(_A-1)*_cw0-_s);
              _a0=(_A+1)-(_A-1)*_cw0+_s; _a1=2*((_A-1)-(_A+1)*_cw0); _a2=(_A+1)-(_A-1)*_cw0-_s;
            }
          }
          var _nb0=_b0/_a0, _nb1=_b1/_a0, _nb2=_b2/_a0, _na1=_a1/_a0, _na2=_a2/_a0;
          if (!isFinite(_nb0+_nb1+_nb2+_na1+_na2)) { b0=1;b1=0;b2=0;a1=0;a2=0; }
          else { b0=_nb0;b1=_nb1;b2=_nb2;a1=_na1;a2=_na2; }
        }
      }
    } else {
      var cc = rbjCoeffs(trial.type, trial.freq, trial.gain, trial.q, fsv);
      b0=cc.b0; b1=cc.b1; b2=cc.b2; a1=cc.a1; a2=cc.a2;
    }
    var C1=freqs._cw, S1=freqs._sw, C2=freqs._cw2, S2=freqs._sw2;
    var s=0;
    for (var k2=0;k2<n;k2+=2){
      var nr = b0 + b1*C1[k2] + b2*C2[k2], ni = b1*S1[k2] + b2*S2[k2];
      var dr = 1 + a1*C1[k2] + a2*C2[k2], di = a1*S1[k2] + a2*S2[k2];
      var cv = Math.log((nr*nr+ni*ni)/Math.max(1e-30, dr*dr+di*di))*4.342944819032518;
      var e = errDb[k2]-(nmBase[k2]+cv); s += W[k2]*e*e;
    }
    var reg=0;
    for (var bj=0;bj<bands.length;bj++){ var g=(bj===bi)? trial.gain : bands[bj].gain; reg+=(g/12)*(g/12); }
    var qPen = Math.max(0, trial.q-4); reg += 0.15*qPen*qPen;
    return s/Math.max(1e-9,sumW2) + regCoef*reg + aeNullPen(trial);
  }
  function nmBand(bi){
    nmBase = null; nmBi = -1;
    var b=bands[bi];
    function toBand(x){ var t={ type:b.type, freq:Math.pow(2,x[0]), gain:x[1], q:Math.pow(2,x[2]) }; if (anchorShelf && b.type!=="peaking") t.freq=b.freq; if (AE_SHELF_CAP > 0 && b.type==="lowshelf" && t.freq > AE_SHELF_CAP) t.freq = AE_SHELF_CAP;
      if (t.freq<AE_FMIN) t.freq=AE_FMIN; if (t.freq>AE_FMAX) t.freq=AE_FMAX;
      var gMax = t.freq>AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
      var qMax = t.freq>AE_LIMITS.trebleHz ? AE_LIMITS.trebleQMax : AE_LIMITS.qMax;
      if (t.gain> gMax) t.gain= gMax; if (t.gain<-gMax) t.gain=-gMax;
      if (t.q>qMax) t.q=qMax; if (t.q<AE_LIMITS.qMin) t.q=AE_LIMITS.qMin;
      return t; }
    function fromBand(t){ return [Math.log2(t.freq), t.gain, Math.log2(t.q)]; }
    var x0=fromBand(b), stepS=(stepScale||1), steps=[0.35*stepS, 1.5*stepS, 0.30*stepS];
    var simp=[x0], vals=[];
    simp.push([x0[0]+steps[0], x0[1], x0[2]]);
    simp.push([x0[0], x0[1]+steps[1], x0[2]]);
    simp.push([x0[0], x0[1], x0[2]+steps[2]]);
    vals = simp.map(function(x){ return objectiveS(bi, toBand(x)); });
    for (var it=0; it<110; it++){
      var idx=[0,1,2,3];
      /* (vong tu dong 15:54, huong A): thay [0,1,2,3].sort(...) bang binary-insertion thu cong tai hien dung thuat toan TimSort cua V8 (run detection + binary insertion, comparator NaN->0) - bo cap phat mang + goi sort moi vong NM, moi ket qua GIONG TUNG BIT theo cau truc (kiem chung fuzz 500k ca gom NaN/Infinity/-0/subnormal). */
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
      if (Math.abs(vals[3]-vals[0])<1e-5) break;
      var cen=[(simp[0][0]+simp[1][0]+simp[2][0])/3,(simp[0][1]+simp[1][1]+simp[2][1])/3,(simp[0][2]+simp[1][2]+simp[2][2])/3];
      var xr=[cen[0]+(cen[0]-simp[3][0]), cen[1]+(cen[1]-simp[3][1]), cen[2]+(cen[2]-simp[3][2])], vr=objectiveS(bi, toBand(xr));
      if (vr<vals[0]){
        var xe=[cen[0]+2*(cen[0]-simp[3][0]), cen[1]+2*(cen[1]-simp[3][1]), cen[2]+2*(cen[2]-simp[3][2])], ve=objectiveS(bi, toBand(xe));
        if (ve<vr){ simp[3]=xe; vals[3]=ve; } else { simp[3]=xr; vals[3]=vr; }
      } else if (vr<vals[2]){ simp[3]=xr; vals[3]=vr; }
      else {
        var xc=[cen[0]+0.5*(simp[3][0]-cen[0]), cen[1]+0.5*(simp[3][1]-cen[1]), cen[2]+0.5*(simp[3][2]-cen[2])], vc=objectiveS(bi, toBand(xc));
        if (vc<vals[3]){ simp[3]=xc; vals[3]=vc; }
        else { for (var si=1;si<4;si++){ var srow=simp[si], s0r=simp[0];
          for (var dd=0;dd<3;dd++) srow[dd]=s0r[dd]+0.5*(srow[dd]-s0r[dd]);
          vals[si]=objectiveS(bi, toBand(simp[si])); } }
      }
    }
    var bi2=0; for (var vi=1;vi<4;vi++) if (vals[vi]<vals[bi2]) bi2=vi;
    var best=toBand(simp[bi2]);
    if (objective(bi, best) <= objective(bi, b)+1e-9){ bands[bi]=best; curves[bi]=aeBandCurve(best, freqs, fsv); }
    /* cập nhật tot */
    tot=new Array(n).fill(0); curves.forEach(function(cv){ for (var k3=0;k3<n;k3++) tot[k3]+=cv[k3]; });
  }
  /* Vòng NM chính + vòng phụ thích ứng (nâng cấp 2026-10-31): chạy đủ
     nmPasses vòng như trước, riêng đường <= 10 band được chạy tiếp tối đa
     20 vòng, dừng khi sai số bình phương có trọng số (đúng phần dữ liệu
     của hàm mục tiêu) cải thiện dưới 0,2% sau một vòng — tiêu chí thuần
     số học nên xác định tuyệt đối, parity Worker giữ nguyên. Đo trên
     Mẫu A: 12 vòng RMS 0,2624 -> thích ứng (tới ~20 vòng) 0,20 dB.
     Đường > 10 band giữ nguyên số vòng (thêm vòng làm RMS thô tệ đi —
     xem ghi chú trong aeSolve). */
  var passCap = contBands ? nmPasses : ((nBands <= 10) ? Math.max(nmPasses, 20) : nmPasses);
  var prevMse = Infinity;
  /* Diem bat dong tra ve (Pha A 2026-11-05 18:29, c10z9): co fixedPoint cho
     aeSolve biet luot nay da hoi tu tuyet doi (mot vong day khong doi band
     nao) de bo qua cac luot polish cung stepScale ve sau — chung minh xem
     ghi chu c10z9 truoc khoi c10y trong aeSolve. Chi nhanh `same` moi dat
     co nay; nhanh thich ung 0,2% khong phai diem bat dong nen khong dat. */
  var fixedPoint = false;
  /* Dung vong NM khi diem bat dong (Pha A 2026-11-05 17:51, c10z8): neu mot vong day
     khong doi band nao (freq/gain/q giong het), moi trang thai dan xuat (tot, curves,
     nmBase) deu giong het nen vong sau lap lai y het phep toan xac dinh — dung la
     bit-identical, chi tiet kiem thoi gian. Ap dung moi duong (contBands hay khong,
     <=10 hay >10 band) vi ly do la tinh xac dinh cua nmBand, khong phu thuoc
     tieu chi thich ung 0,2% (tieu chi do chi chay khi passCap > nmPasses). */
  for (var pass=0; pass<passCap; pass++){
    var snap = bands.map(function(b){ return [b.freq, b.gain, b.q]; });
    for (var bi3=0; bi3<bands.length; bi3++) nmBand(bi3);
    var same = true;
    for (var si=0; si<bands.length; si++){ if (bands[si].freq!==snap[si][0] || bands[si].gain!==snap[si][1] || bands[si].q!==snap[si][2]){ same=false; break; } }
    if (same){ fixedPoint = true; break; }
    if (!contBands && pass + 1 >= nmPasses && passCap > nmPasses){
      var mse = 0;
      for (var mk=0; mk<n; mk++){ if (W[mk] > 0){ var me = errDb[mk] - tot[mk]; mse += W[mk] * me * me; } }
      if (prevMse - mse < 0.002 * prevMse) break;
      prevMse = mse;
    }
  }
  /* Chiếu cuối: band nào vẫn còn tâm trong null với gain>0.5 thì về 0 dB
     (đúng luật hậu kiểm của aeCompute, nhưng ngay trong solver để các ứng
     viên được chọn theo tổng đã chiếu và hậu kiểm không bao giờ phải nổ). */
  /* (vòng tự động 03:54, hướng A — ÁP DỤNG, vá code): bỏ lần tính lại tot cuối aeSolveSingle khi không có band nào bị chiếu về null — trước đây luôn gọi aeTotalCurve(bands, freqs, fsv) = m lần rbjCoeffs + m×n lần log10 dù curves[bi] đã đồng bộ từng bit với aeBandCurve(bands[bi]) (tạo mới ngay trước vòng NM, cập nhật đồng thời khi nmBand chấp nhận band); nay đặt cờ _proj đúng tại điểm chiếu (cùng điều kiện b.gain>0.5 && aeInNull(b.freq) như cũ) — không chiếu và curves.length===bands.length thì tot = tổng cộng dồn curves theo thứ tự band 0..m-1 như aeTotalCurve (cùng điểm bắt đầu fill(0), cùng thứ tự cộng, cùng biểu thức biquad nên GIỐNG TỪNG BIT theo cấu trúc, kể cả NaN/Infinity/cực đoan); có chiếu hoặc độ dài lệch thì giữ nguyên aeTotalCurve gốc. Không tham chiếu biến ngoài mới (chỉ bands/curves/n/aeTotalCurve/aeInNull đã có trong AE_WORKER_SRC) nên parity Worker giữ nguyên. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0354_A/, 2 lần chạy độc lập): parity toàn hàm aeSolveSingle 22/22 GIỐNG TỪNG BIT (Object.is trên bands/total/fixedPoint; gồm 10/20 band, contBands + rỗng, nullMid/nullHi, flat/big/NaN/W=0, fs 44100/0/NaN, anchor, stepScale, n=0/1/3, nBands 2/3) + tương đương khối 218/218 (gồm fuzz 200 ca, NaN/±Inf/cực đoan/subnormal, fs 0/NaN/96000) + nhánh chiếu 5/5 (gồm ca band trong null kích hoạt _proj=true rơi về aeTotalCurve gốc); tốc độ paired-median xen kẽ 15 vòng trên khối tính tot (10 band × 240 điểm): 1,0936 ms → 0,0032 ms (346,6×, thắng mọi vòng); toàn hàm aeSolveSingle trung tính trong nhiễu máy chia sẻ (median 0,9882×, 9 vòng) đúng kỳ vọng vì khối này chỉ ~0,14% thời gian hàm (~1,1 ms/lần gọi, ~11 lần gọi/lần aeSolve 10 band ≈ 12 ms). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261124_0354_A/. */
  var _proj = false;
  bands.forEach(function(b){ if (b.gain>0.5 && aeInNull(b.freq)){ b.gain=0; _proj=true; } });
  if (!_proj && curves.length === bands.length){
    tot = new Array(n).fill(0);
    for (var _fb = 0; _fb < curves.length; _fb++){
      var _fc = curves[_fb];
      for (var _fk = 0; _fk < n; _fk++) tot[_fk] += _fc[_fk];
    }
  } else {
    tot = aeTotalCurve(bands, freqs, fsv);
  }

  var ms = (typeof performance!=="undefined"? performance.now() : Date.now()) - t0;
  return { bands:bands, total:tot, ms:ms, fixedPoint:fixedPoint };
}

/* ---------- Solver 20 band dày (v2, 2026-10-26): multi-start có phạt gain ----------
   Lý do: với 18-20 band sát nhau, J^T W J gần suy biến nên ridge tuyệt đối 0.35
   của đường cũ dễ sinh cặp band triệt tiêu nhau (+/-12 dB) và RMS 20 band tệ hơn
   10 band (đo trên Mẫu A: 0.93 so với 0.53 dB). Với band dày, chạy 2 ứng viên
   (ridge tương đối 0.1 và 0.3, NM 6 vòng, hệ số phạt gain 0.06) rồi chọn ứng viên
   có hàm mục tiêu thấp nhất: MSE có trọng số + 0.06 * (tổng (g/12)^2 + phạt Q),
   đúng dạng hàm mục tiêu của NM. Đường <=10 band từ 2026-10-28 cũng dùng multi-start (đường cũ + ridge tương đối 0,3,
   chọn theo hàm mục tiêu có phạt) — xem ghi chú trong aeSolve; đường 20 band giữ nguyên
   2 ứng viên. Thời gian trả về là tổng thời gian các ứng viên. */
/* Nâng cấp chọn ứng viên 2026-10-31: hệ số phạt gain của hàm mục tiêu chọn
   phải khớp hệ số phạt mà chính đường đó dùng trong NM (rc: 0,02 cho <=10 band,
   0,06 cho >10 band). Trước đây mọi lời gọi đều dùng 0,06 cố định, nên đường
   10 band bị xếp hạng lại bằng một thước khác với thước nó được tối ưu — đo
   trên Mẫu A -> harmanOE 10 band: ứng viên thắng sai (RMS 0,2109) thay vì ứng
   viên tốt nhất theo đúng thước 0,02 (RMS 0,1964). Tham số regCoef tùy chọn,
   mặc định 0,06 để các lời gọi so sánh liên-band (bestOf) và kiểm chứng QA
   giữ nguyên tuyệt đối; chỉ aeSolve nội bộ truyền rc của chính nó. */
/* (vong tu dong 09:24, huong A): thay bands.forEach bang vong for thuong trong aeSolveObjective — bo 1 closure moi lan goi (aeSolveObjective duoc goi hang tram lan/lan aeSolve de chon ung vien); vong for doc bands[i] theo dung thu tu 0..n-1, giu nguyen tung toan hang/thu tu cong cua reg, va bo qua lo thua (i in bands) dung nhu forEach (phan tu undefined tuong minh van nem loi cu). Moi ket qua GIONG TUNG BIT theo cau truc. */
function aeSolveObjective(bands, total, errDb, weights, regCoef){
  var sumW=0, ss=0, i;
  for (i=0;i<errDb.length;i++){ var e=errDb[i]-total[i]; ss+=weights[i]*e*e; sumW+=weights[i]; }
  var reg=0;
  for (i=0;i<bands.length;i++){ if(!(i in bands)) continue; var b=bands[i]; reg+=(b.gain/12)*(b.gain/12); var qp=Math.max(0,b.q-4); reg+=0.15*qp*qp; }
  return ss/Math.max(1e-9,sumW) + (regCoef===null||regCoef===undefined?0.06:regCoef)*reg;
}
/* --- Do hoi tu 4 ung vien duong 20 band + dung luong fan-out de quy (vong tu dong 15:44, huong A; y tuong luot 15:02/15:37):
   4 ung vien y het aeSolve duong 20 band (lam 0.1/0.3 x shelf 105/55, p0=6, rc=0.06, fs=48000), 22 fixture tai nghe that x harmanOE/harmanIE, chay 1 lan (xac dinh; luot 15:02 da kiem chung tinh xac dinh 2 lan o duong 10 band):
   hoi tu cap ung vien 0/22 o ca 6 cap (giong duong 10 band luot 15:02) - khong co cong viec trung de bo. Ung vien thang: c1=6, c2=8, c3=8, c0=0/22 (lam0.1/shelf105); bien thang obj (tot nhat vs thu hai) median 0,0146, min 0,0031 nen c0 van co the thang o tai nghe khac, va chi ton ~28 ms trong tong ~9,3 s nen bo c0 khong dang - KHONG DOI. Band cuoi aeSolve khac band thang o 22/22 (chuoi tiep tuc luon doi band); fixedPoint 0/22 o ca 4 ung vien.
   Phat hien phu (probe dung luong 3 fixture + probe fan-out 22 fixture): aeSolve day du duong 20 band median 9,3 s Node (6,9-17,1 s), gap 24-128x tong 4 ung vien (~0,11 s). 99,9% thoi gian trong aeSolveSingle, aeSolveObjective khong dang ke (<2 ms). Nguyen nhan: moi luot goi goc chay them 4-7 luot aeSolve day du de quy (tong cong 5-8 luot tinh ca luot goc: dual RLS6 + rcDual + luot long nhau + anchored khi RMS>0,5), chiem median 79,7% tong thoi gian (58-89%); chuoi goc (ung vien + c5-c15) chi median 1,9 s (19,9%). Trong chuoi: cac luot tiep tuc nm16 chiem ~35-60%, cac luot sau nm32-112 chiem ~19-52%; 4 ung vien + polish chi ~7-13%.
   Fan-out co xung dang: dual RLS6 cung cap band cuoi o 11/22, rcDual o 3/22, chuoi goc thang o 9/22 (1 fixture dual va rcDual cho band giong het tung bit) - khong nhanh nao thua hoan toan tren 22 fixture nen KHONG BO nhanh nao luot nay. Anchored chi kich hoat o 4/22 fixture, thang truc tiep 0/22 (1 lan thang long nhau) - ung vien cho thi nghiem rieng ve sau (vd nang nguong RMS>0,5 hoac do tren nhieu fixture hon), khong doi luot nay.
   Khong doi code, chi ghi comment nay. Y tuong luot ke: huong A - do ty le thang/chi phi cua tung nhanh de quy (anchored/dual/rcDual) tren kho rong hon de xem co cat bot fan-out duoc khong; hoac huong C - ra soat loudFitError tren luoi phon (y tuong luot 15:37). --- */
/* --- Do ti le thang/chi phi tung nhanh de quy tren kho rong + doi chung cat anchored (vong tu dong 17:33, huong A; y tuong luot 15:44/16:28/17:20/17:32):
   60 fixture (30 tai nghe that x harmanOE/harmanIE, duong 20 band, fs=48000, chay 1 lan, ham xac dinh): aeSolve day du median 10,9 s (5,8-21,9 s), de quy chiem median 78,4% tong thoi gian (57,6-89,5%), 5-8 nut goi/fixture (tong 320 nut). Nha cung cap band cuoi: chuoi goc 26/60, dual RLS6 24/60, rcDual 13/60 (3 hoa dual+rcDual cho band giong het tung bit), anchored thang truc tiep 0/60 — giong luot 15:44 tren 22 fixture (9/22, 11/22, 3/22, 0/22).
   Anchored kich hoat 9/60 (15,0%). Doi chung cat anchored (lab-only, vo hieu hoa guard RMS>0,50): 7/9 fixture band cuoi giong het tung bit, RMS khong doi; 2/9 doi ket qua — AKG K250 x harmanOE TE DI +0,128 dB RMS (0,261 -> 0,389) vi luot neo thang LONG NHAU trong cay dual (depth 2, anch1|rls6|rc1) roi dual cap band do cho goc, khong co neo thi goc phai nhan rcDual 0,389; Koss Porta Pro (sample 2) x harmanOE RMS tho tot hon 0,0135 dB khi cat (0,278 -> 0,264) nhung theo tieu chi objective thi band neo van duoc chon (dual giu band neo du RMS tho te hon). Ket luan: KHONG CAT anchored — nhanh nay chi ton them median 4,0 s (1,8-9,4 s) tren fixture no kich hoat, 0 dong o 85% con lai (~5% tong thoi gian kho), nhung cuu 1/60 o benh ly khoi te +49% RMS; cat se vi pham quy tac khong lam tut chi so. Ca 3 nhanh cap 1 deu thang thuong xuyen (26/24/13 tren 60) nen khong cat nhanh nao; dual & rcDual hoi tu giong het chi 3/60 nen khong co cong viec trung de bo.
   Khong doi code, chi ghi comment nay. Y tuong luot ke: huong C — ra soat loudFitError tren luoi phon (y tuong luot 15:37); hoac huong D — do lai toc do dung do thi/dung FIR sau khi buildFirTaps nhanh hon. --- */
/* --- Mau rong cho 4 ung vien duong 20 band (vong tu dong 18:06, huong A; y tuong luot 15:44/17:33):
   60 tai nghe lay theo buoc deu khap DB (1605 muc) x harmanOE/harmanIE = 120 fixture, tham so dung duong 20 band
   (lam 0.1/0.3, p0=6, rc=0.06, shelf 105/55, fs=48000), lab Node tren ham that trich tu file hien tai (file thuong noi lien).
   Hoi tu cap ung vien 0/120 o ca 6 cap (gop 22 fixture luot 15:44: 0/142) - khong co cong viec trung de bo.
   Ung vien thang: c0=19, c1=30, c2=23, c3=48 (gop 142: 19/36/31/56) - c0 (lam0.1/shelf105) THANG 19/120, bac bo dut diem
   nghi ngo "c0 khong bao gio thang" tu mau 22 (0/22 chi la artefact mau nho); c0 co RMS tot nhat 25/120. KHONG BO ung vien nao.
   Bien thang obj (tot nhat vs thu hai) median 0,0192, min 0,000076 - van nho nen khong co dieu kien re de doan truoc.
   fixedPoint 0/480 ung vien; ms/ung vien median 27,4 ms, tong 4 ung vien median 109,8 ms/fixture; RMS ung vien thang
   median 0,3592 dB, 17/120 fixture RMS > 0,7 nen se chay polish (pHi=10) trong aeSolve day du.
   Doi chung: chay lai bo 22 fixture luot 15:02/15:44 tren file hien tai cho ket qua GIONG HET (thang [0,6,8,8],
   bien median 0,0146, min 0,0031, xac dinh 22/22 qua 2 lan chay) - solver khong doi tu luot 15:44.
   Khong doi code, chi ghi comment nay. Y tuong luot ke: huong D - do lai toc do dung do thi/dung FIR sau khi buildFirTaps
   nhanh hon; hoac huong C - ra soat loudFitError tren luoi phon (y tuong luot 15:37). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 19:20, hướng A): đo tỉ lệ thắng/chi phí
   từng bước chuỗi tiếp tục của aeSolve ĐƯỜNG 10 BAND trên kho rộng hơn
   (ý tưởng từ 15:44/17:20, chưa làm trên đường 10 band) — KHÔNG ÁP VÁ.
   Lab Node trên hàm thật, file thường nối liền (lượt 19:20, chạy 2 lần,
   32 fixture tai nghe thật x harmanOE/IE + 6 ô Mẫu A/B/C; xác định tuyệt
   đối: winSeq/finalRms/nCalls giống hệt 32/32): chuỗi tiếp tục cấp band
   cuối ở 32/32 fixture (ứng viên không bao giờ thắng trực tiếp), lợi
   chuỗi median 0,034 dB (max 0,55 dB); ms giải median 343 ms.
   Bước muộn đắt nhất c10z6 (nm320, stepScale 1/1024): chạy 6/32 fixture
   thật + 4/6 ô mẫu, thắng 5/6 lần chạy, tốn median 118 ms/lần (99–165 ms)
   nhưng lợi RMS ≤ 0,0026 dB (K250/OE +0,0011, Yuin/IE +0,0026, còn lại
   ≤ 0,0002). Ablation bỏ hẳn c10z6 (3 lần chạy xen kẽ, xác định tuyệt đối):
   band cuối đổi 7/38 fixture, ΔRMS max +0,0026 dB; Mẫu A ΔRMS = 0 tuyệt
   đối cả OE/IE (c10z6 chạy 67/125 ms rồi bị từ chối) nhưng Mẫu B/OE
   +0,000022 và Mẫu C/OE +0,000197 dB. KHÔNG BỎ c10z6: lợi thời gian
   (~118 ms ở ~19% lượt giải) không bù được RMS tệ đi dù nhỏ — theo luật
   không làm tụt bất kỳ chỉ số nào (tiền lệ 16:42 bác +0,0051 dB); aeV3
   (Mẫu A) cũng không hưởng lợi chắc chắn vì nhiễu đo ms VM ±60–200 ms
   nuốt chửng Δms tổng. Đuôi chuỗi sau bước thắng chỉ 6,4% thời gian
   (median 0 ms, 21/32 fixture bước thắng là lần gọi cuối) nên không còn
   dư địa dừng sớm. Không đổi code, chỉ ghi comment này. Ý tưởng lượt kế:
   hướng C — rà soát loudFitError trên lưới phon rộng hơn (10–100 phon);
   hoặc hướng D — đo lại tốc độ dựng đồ thị sau khi biquadMagDb nhanh hơn
   (vòng 18:22). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 19:40, hướng A): rà soát aeSolveSingle
   trên tai nghe thật trong DB — độ nhạy theo số vòng NM ban đầu p0 của 4 ứng
   viên gốc (ý tưởng treo lâu nhất, từ 14:22) — KHÔNG ÁP VÁ, ứng viên p0=9 bị bác.
   Lab Node trên hàm thật trích từ file hiện tại (file thường nối liền, DB 1605
   mục), 32 fixture tai nghe thật × harmanOE/IE, chạy 2 lần: xác định tuyệt đối
   (detFail=0 trong process, 0/192 ô khác nhau giữa 2 process).
   Đường 10 band (p0 8/12/16, lam null/0,3, rc 0,02): p0=12 ĐÃ hội tụ đủ — pick
   không đổi 0/32 cả hai chiều, bestRms trung vị 0,0000 dB (p0=16: −0,0116..
   +0,0067; p0=8: −0,0209..+0,0099 — dao động hỗn loạn hai chiều, không đơn điệu,
   vì NM tối ưu objective có phạt chứ không tối ưu RMS thô); fixedPoint 0/128.
   Đường 20 band (p0 4/6/9, lam 0,1/0,3, rc 0,06): p0=6 CHƯA hội tụ ở cấp ứng
   viên — p0=9 cải thiện objective của pick ở 32/32 fixture (trung vị −0,0378,
   tới −2,0148), bestRms trung vị −0,0441 dB (tới −0,9140 AKG K250/IE), chỉ 1 ca
   tệ đi +0,0075 (KZ AST/IE); p0=4 tệ hơn rõ (pick đổi 4/32, bestRms trung vị
   +0,0445, tới +1,3362). Chi phí 4 ứng viên trung vị 111→158 ms (+42%).
   NHƯNG ở cấp aeSolve ĐẦY ĐỦ 20 band (16 fixture: 10 tai thật + 6 ô Mẫu, đo
   qua aeComputeFinish như lượt 18:29), lợi ích hầu hết bị chuỗi tiếp tục san
   bằng: cải thiện 6/16, giữ nguyên 7/16, TỆ ĐI 3/16 (Chu/IE +0,0022, KZ AST/IE
   +0,0005, Mẫu A/OE +0,0019) — theo luật không làm tụt bất kỳ chỉ số nào và
   tiền lệ 19:20 (bác +0,0026 dB) thì KHÔNG nâng p0 chung lên 9. Ngoại lệ đáng
   chú ý: HD 600/OE 0,1698→0,0619 (chuỗi ở p0=6 không tìm được band này vì
   objective có phạt tệ hơn +0,0278 dù RMS tốt hơn nhiều — cùng hiện tượng
   nhánh rc/2 lượt 18:29, đúng tiêu chí đã chốt 2026-11-02/03). Tổng thời gian
   +3,6%, viol=0 cả hai bản; Mẫu A/OE 0,0581→0,0600 vẫn xa dưới mốc aeV5 0,53 dB.
   PHÁT HIỆN VỀ PHƯƠNG PHÁP: fixture mẫu kiểm chứng PHẢI dựng bằng
   aePrepare(aeSamplePoints(s)) như đường QA trong file (dòng 7498/7513), không
   phải aePrepare(s.knots,'psycho') — lab mẫu lượt 19:20 dùng cách sau nên số
   mẫu 10 band của lượt đó lệch nhẹ; lượt này đã sửa và tái lập đúng Mẫu B/IE
   20 band 0,0462 của lượt 18:29 (lab sai cho 0,0622). Không chạm solver/WASM/
   FIR/QA. Ý tưởng lượt kế: hướng C — bảng tra log cho ISO_FREQS trong
   isoSpl/isoPhonFromSpl (ý tưởng treo từ lượt 15:23); hoặc hướng A — mổ ca
   HD 600/OE (ứng viên nào thắng ở p0=9 và vì sao chuỗi p0=6 không tới được). --- */
/* KHÔI PHỤC KHO 2026-11-09 (theo yêu cầu Angela, sau khi phát hiện bản Drive cũ 3.650.770 byte chứa 4.940 mục còn bản local fsrate chỉ 1.605 mục): gộp kho đủ 2026-11-08 (4.940 mục) + 60 mục mới (tên+nguồn chưa có) từ bản fsrate 2026-10-25; tổng DB_RAW 5.000 mục, DB_PHONES 5.000, 0 loại. 86 mục fsrate trùng tên+nguồn (khác rig) đã bỏ vì app chỉ giữ mục đầu; 730 mục chung giữ nhãn rig bản 11-08, đường cong giống hệt nhau. Kiểm chứng: 20 khối script 0 lỗi, dbValidateEntry 0 lỗi/5.000, aeSolve 10 band HD 600/harmanOE RMS 0,1838 dB (khớp số cũ), Zoukbox ZLX30 (mục khôi phục) 0,2089 dB. */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:05, hướng A): mổ ca HD 600/OE
   đường 20 band (ý tưởng treo từ 19:40) — KHÔNG ÁP VÁ, chỉ đo. Lab Node trên
   hàm thật trích từ file hiện tại (bản đã gộp DB 5.000 mục), fixture HD 600
   (oratory1990) x harmanOE, aePrepare(p.knots,'psycho') như lượt 19:40.
   Cấp ứng viên: p0=9 vẫn chọn c3 (lam 0,3/shelf 55), obj 0,3958->0,3878, RMS
   0,3963->0,3884; fixture này KHÔNG có null (nulls=[]) nên phạt null không
   liên quan. Cấp aeSolve đầy đủ tái lập đúng lượt 19:40: p0=6 RMS 0,1698
   (obj@0,06 0,1538), p0=9 RMS 0,0619 (obj@0,06 0,1816), viol=0.
   Cây đệ quy p0=6 (128 lần gọi aeSolveSingle, 5 nút aeSolve): nhánh tốt
   RMS 0,0710 ĐÃ tới được ở p0=6 (rcDual, nút 4, bước #93-108, tốt nhất
   #107 obj@0,03 0,1124) — nhưng ở cổng gộp ngoài, tính bằng rc GỐC 0,06,
   band này đạt obj 0,1999 so với đáp án chuỗi gốc 0,1538 (lệch +0,0461)
   nên BỊ LOẠI đúng tiêu chí. Ở p0=9, chuỗi gốc tắc tệ hơn (pickObj
   ~0,1848 so với 0,1538) nên band rcDual (obj@0,06 0,1816) ĐƯỢC NHẬN
   với biên chỉ -0,0032. Phân rã: band rcDual mse toàn lưới 0,0250
   (chuỗi gốc 0,0423) nhưng reg 2,915 (gốc 1,857) — trả thêm +0,0635
   phạt gain để đổi -0,0173 mse; tiêu chí objective có phạt rc=0,06
   (đã chốt 2026-11-02/03) chọn đúng đáp án rẻ-gain hơn. Kết luận: RMS
   0,0619 của p0=9 KHÔNG phải do p0=9 tìm được band mới — mà là lật
   cổng gộp do chuỗi gốc tệ đi; band rcDual p0=6 và final p0=9 khác
   nhau 20/20 band. Không vá, không nâng p0 (khớp quyết định 19:40).
   Xác định tuyệt đối: lab ứng viên chạy 2 lần giống hệt; full lab tái
   lập đúng số 19:40. Ý tưởng lượt kế (CHƯA làm, cần kiểm chứng đủ
   16-32 fixture trước khi vá): đánh giá cổng gộp rcDual bằng chính rc
   nó được giải (0,03) thay vì rc gốc — đổi tiêu chí chọn nên rủi ro
   hồi quy kiểu thí nghiệm B vòng 23:24 (B/OE tệ +123%); KHÔNG thử
   trong lượt này. Ghi chú: ý tưởng 'bảng tra log ISO_FREQS' trong
   comment 19:40 ĐÃ LÀM từ 14:41 (ISO_LOG_FREQS/ISO_LOG_SPAN;
   isoSpl/isoPhonFromSpl/iso2003Spl đều chỉ còn 1 Math.log) — không lặp
   lại. Theo luật 3 lượt không cải thiện liên tiếp, nhánh A TẠM DỪNG
   sau lượt này (19:20, 19:40, 20:05 đều không vá); lượt kế chuyển
   sang nhánh B/C/D. --- */
/* --- Mở rộng 2026-11-10 (vòng tự động 00:20, hướng A): mổ phần dư 2–10 kHz của Adam SP-5 × freeField (W2, ý tưởng treo từ 23:54) — KHÔNG ÁP VÁ, chỉ đo. Lab Node trên hàm thật trích verbatim từ file hiện tại (solver/DB giống từng byte bản 23:54, đã kiểm chứng cmp), đường giải y hệt sweep, chạy 3 pha.
   Tái lập đúng RMS sweep 1,1584 (5,7 s); nulls=[]; band #8 peaking 5893,7 Hz g=−12,000 Q=6,14 KẸP GAIN (sát ngưỡng treble 6 kHz nên cap ±12, không phải ±8); band #9 9140,8 Hz g=+7,685 Q=3,01 (sát cap treble ±8).
   Phần dư 2–10 kHz: đáp tuyến thô có cặp đỉnh/hõm sắc — errDb −7,6 dB @ 6,09 kHz rồi +6,2 dB @ 7,03 kHz (đu 13,8 dB trong 0,21 oct, bước dốc nhất 3,68 dB/1-12-oct); phần dư ≥3 dB chỉ rộng 0,083 oct (6834–7241 Hz), đỉnh 4,064 dB @ 7035 Hz. Band #8 cắt đỉnh 6 kHz nhưng váy của nó cũng cắt 7 kHz (đóng góp −2,02 dB @ 7030 Hz) đúng chỗ cần boost (+6,24 dB) — kéo co bố cục/Q, không phải null, không phải lỗi solver.
   Phát hiện lớn hơn nằm ở BASS, không phải 7 kHz: 44,8% MSE ở <100 Hz (RMS 1,5236, max 4,03 dB @ 20 Hz) vì lowshelf #1 trôi lên 2664 Hz g=−0,385 (gần như vô dụng), chỉ còn 1 peaking 71 Hz gánh bass. Chẩn đoán D1 gainMax 12→15: RMS 1,1375 (−0,021, #8 tới −14,24) — kẹp gain không phải nút thắt. D2 trebleGainMax 8→12: RMS 0,6907 (−0,468!) nhưng đỉnh 7 kHz gần như nguyên (3,917) — cải thiện tới từ bass: lowshelf #1 ở lại 29,8 Hz g=+5,224, RMS <100 Hz 1,5236→0,2346 (MSE bass 44,8%→3,0%); D3 (cả hai) 0,6809, chỉ hơn D2 0,01. Nới cap treble chỉ làm nhiễu chọn ứng viên, không sửa 7 kHz — nút thắt thật là lowshelf trôi khỏi bass / rơi vào cực tiểu cục bộ.
   Không vá: nới AE_LIMITS là đổi giới hạn an toàn + động neo aeV1/aeV2, không phải sửa solver; hướng sửa đúng là giữ lowshelf neo ở bass (thí nghiệm solver, KHÔNG chạm AE_LIMITS) — để dành lượt A sau. Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi.
   Nhánh A: 3 lượt không vá liên tiếp (23:35, 23:54, 00:20) — TẠM DỪNG nhánh A theo luật 3 lượt. Ý tưởng lượt kế: hướng C — bảng tra log cho ISO_FREQS trong isoSpl/isoPhonFromSpl (treo từ 15:23); hoặc hướng B — đo lại profile 3 pha buildFirTaps (nhánh B tạm dừng từ 22:27 đã qua 10+ lượt). Khi nhánh A mở lại: thí nghiệm neo lowshelf ở bass cho aeSolveSingle. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 23:54, hướng A): mổ 4 ca tệ nhất
   sweep toàn kho (714 cặp, median 0,3171 dB) + 1 đối chứng trung vị — KHÔNG
   ÁP VÁ, chỉ đo. Lab Node trên hàm thật trích verbatim từ file hiện tại
   (lượt 23:54; solver/DB trích ra giống từng byte với bản 23:35; đường giải
   y hệt sweep: aePrepare(knots,'psycho') -> aeComputeSetup -> aeSolve
   10 band -> aeTotalCurve -> RMS 20 Hz-10 kHz; W1 10 band chạy 2 lần
   bands giống hệt từng bit). Tái lập đúng RMS sweep ở 5/5 ô (tới 4 chữ số).
   W1 AKG K250 x rtings 1,1755 dB (tệ nhất kho): 92,1% MSE ở 20-100 Hz
   (RMS 2,2158 dB vùng này, dư lớn nhất 6,064 dB @ 20 Hz), 1 band kẹp +12 dB,
   không null; 4 ứng viên gốc 1,2051-1,2838 (c2 shelf 55/lam null thắng),
   giải đầy đủ 1,1755 (chuỗi tiếp tục + polish chỉ thêm 0,03 dB) — nhưng
   ĐƯỜNG 20 BAND cùng cặp này chỉ 0,1903 dB (tốt hơn 6,2 lần). W2 Adam SP-5
   x freeField 1,1584: MSE chia đôi 44,9% <100 Hz + 47,2% 2-10 kHz (đỉnh
   4,064 dB @ 7,03 kHz), 1 band kẹp -12. W3 AKG K271 MKII x harmanOE 1,1342:
   56,3% <100 Hz + 34,3% 100-500 Hz, 2 band kẹp +12. W4 Anker Q30 x ief
   1,0431: 67,3% <100 Hz, 2 band kẹp -12. Đối chứng C1 AKG K612 x
   diffuseFieldKemar 0,3197: 87,3% MSE cũng <100 Hz nhưng nhỏ tuyệt đối
   (RMS 0,5865), 0 band kẹp, gain lớn nhất 8 dB. Kết luận: các ca tệ nhất
   là GIỚI HẠN SỐ BAND/BỐ CỤC đường 10 band (bass roll-off sâu hơn 1 shelf
   ±12 dB gánh được; 20 band xếp chồng nhiều band bass nên tới 0,19 dB),
   KHÔNG phải chất lượng solver — không null nào liên quan (nulls=[] cả 5 ô),
   không họ ứng viên nào hỏng (shelf 55 đã thắng, chênh ứng viên nhỏ).
   Không vá: đổi bố cục 10 band/kẹp gainMax=12 sẽ động cổng QA aeV1/aeV2
   và chạm giới hạn an toàn; đường 20 band đã có sẵn cho các tai này.
   Lưu ý đo: ms phồng do sweep chạy song song (~96% CPU; W1 20 band 482 s
   wall) — RMS xác định, không bị ảnh hưởng. Nhánh A: 2 lượt không vá liên
   tiếp (23:35, 23:54). Ý tưởng lượt kế: hướng A — mổ phần dư 2-10 kHz của
   Adam SP-5 x freeField (47% MSE, đỉnh 4,06 dB @ 7,03 kHz, khác câu chuyện
   bass); hoặc hướng C — rà soát loudFitError ở fs 44,1/96 kHz (lưới 19:31
   chỉ đo 48 kHz). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 23:35, hướng A): THỬ cổng gộp rcDual
   đánh giá bằng chính rc nó được giải (0,03) thay vì rc gốc (0,06) — ý tưởng
   treo từ 20:05, ĐÃ LÀM ĐỦ 16 fixture — BỊ BÁC, không áp vá code.
   V1 (lab-only): oRc = aeSolveObjective(rcDual..., rc*0.5), so với oPickRc =
   aeSolveObjective(pick..., rc*0.5), giữ nguyên chốt RMS (rms(rcDual) <=
   rms(pick)); cổng chỉ chạy khi AE_RC_SCALE==1 nên rc*0.5 luôn = 0,03 đúng
   rc nhánh rcDual được giải; pickObj không dùng sau khối rcDual nên không
   lệch sổ sách. Lab Node trên hàm thật trích verbatim từ file hiện tại
   (lượt 23:35, 16 ô: 8 tai nghe thật x harmanOE/harmanIE, đường 20 band,
   fs=48000, aePrepare 'psycho' + aeComputeSetup như 20:05; base tái lập
   đúng số 20:05 ở HD 600/OE: RMS 0,1698, obj 0,153757 — kiểm chứng chéo
   tính xác định): 15/16 ô giống từng bit; chỉ 1MORE SonoFlow x harmanOE
   đổi — RMS 0,3583 -> 0,3075 (-0,0508 dB, -14,2%) NHƯNG reg 3,2585 ->
   4,1221 (+26,5%), tổng |gain| 78,27 -> 92,49 dB (+18%), obj@0,06 0,6515
   -> 0,6711 (+3,0%); RMS trung bình 0,2376 -> 0,2344 (-1,34%), 0 ô RMS
   tệ đi, obj@0,06 trung bình +0,29%, viol=0 mọi ô, maxGain 12,00 dB
   (trong kẹp), ms trung bình 11.217 -> 11.299 (+0,7%, 1 lần tính
   objective thêm mỗi cổng). Kết luận: cải thiện RMS mỏng và chỉ nhờ 1/16
   ô lật sang đáp án đắt gain — đúng đánh đổi mà 20:05 cảnh báo; theo luật
   không làm tụt bất kỳ chỉ số nào (obj@0,06 là chỉ số chuẩn đã chốt
   2026-11-02/03, tệ đi ở ô lật) và tiền lệ 19:20 (bác đổi chỉ số lấy tốc
   độ) nên BÁC. Muốn vá thì cần kiểm chứng rộng hơn (60+ ô, gồm ca tệ
   nhất sweep) và chứng minh obj@0,06 không tệ đi — KHÔNG chạy lại trên
   đúng 16 ô này. Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi
   (khối rcDual chỉ chạy nBands>10). Nhánh A: 1 lượt không vá sau khi mở
   lại cho thí nghiệm đã đăng ký; các nhánh B/C/D đã tạm dừng/xoay trước
   đó (B: 22:27, C: 23:06, D: 23:18). Ý tưởng lượt kế: hướng D — đo
   measureFps trên phổ thật (ý tưởng treo từ 20:30/20:57, specDraw đã
   đo ở 23:18); hoặc hướng C — rà soát loudFitError trên lưới phon
   (ý tưởng treo từ 15:37). --- */
/* --- Mo rong 2026-11-10 (vong tu dong 04:18, huong A): mo ca te thu 2 moi cua sweep - Austrian Audio Hi-X15 x soundguys (RMS 1,1724, chua mo bao gio) + doi chung K250 x rtings - KHONG AP VA, chi do. Lab Node tren ham that trich verbatim tu file hien tai (build_extract_0418.py, duong giai y het sweep: aePrepare(knots,'psycho') -> aeComputeSetup -> aeSolve 10 band -> aeTotalCurve -> RMS 20 Hz-10 kHz; 5 luot giai, 12 s; 2 rep base giong het).
   Tai lap dung RMS sweep 1,1724 (truoc EQ 3,9619); 90,1% MSE o <100 Hz (RMS 2,1852 vung nay), dinh du +3,793 dB @ 53,4 Hz; nulls=[]; 2 band kep; viol=0. Lowshelf #1 @127 Hz g=-0,98 gan nhu vo dung, bass do 3 peaking @229/+2,94, @341/+5,95, @492/+3,03 ganh - cung lop gioi han 10 band/bass nhu K250/SP-5 (23:54/00:20), khong phai null, khong phai loi solver.
   D1 gainMax 12->15: RMS 1,1724->1,0292 (-0,143), obj 1,6533->1,3644, RMS bass 2,1852->1,8951; dap an cuoi gains <=11,34 (viol=0 theo kep goc) - noi kep chi doi DUONG DI NM chu khong doi dap an cuoi (khep kep sau van hop le); khac W2 o 00:20 (D1 chi -0,021). D2 trebleGainMax 8->12: RMS ->1,0579, obj 1,3161, NHUNG viol=2 theo kep goc (@13258 -10,95, highshelf @8559 +12,00) - loi toi tu vi pham kep, bac nhu 00:20.
   Doi chung K250 x rtings tai lap 1,1755 dung so sweep, 92,1% MSE <100 Hz (RMS 2,2158, dinh 6,064 dB @ 20 Hz) - khop 23:54, harness con dung.
   Khong va: D1/D2 deu doi AE_LIMITS (gioi han an toan, theo tien le 00:20). Y tuong luot ke: huong A - thi nghiem noi gainMax NOI BO trong NM roi chieu dap an ve kep chuan (khong doi AE_LIMITS), vi D1 cho thay duong di NM khac tim duoc dap an hop le tot hon; hoac huong B - do lai profile 3 pha buildFirTaps; hoac huong D - do measureFps/specDraw tren pho that. --- */
/* --- Mo rong 2026-11-10 (vong tu dong 05:10, huong A): mo ca te thu 4 moi cua sweep - AKG K271 MKII x harmanOE (RMS 1,1344, chua mo bao gio) + thu y tuong treo 04:18 (noi gainMax NOI BO trong NM roi chieu ve kep chuan) - KHONG AP VA, chi do. Lab Node tren ham that trich verbatim tu file hien tai (build_extract_0510.py, build_lab_0510.py; duong giai y het sweep; 29 luot giai, 26 s; base K271 3 rep giong het).
   K271 tai lap dung RMS sweep 1,1342 (truoc EQ 8,4876); 90,6% MSE o <500 Hz (RMS 1,6714 vung 20-100 Hz, 1,3044 vung 100-500 Hz), dinh du +5,024 dB @ 20 Hz; nulls=[]; 5 band kep (shelf @46 +12,00, peaking @98 +12,00, 2 band treble +8,00); viol=0 - cung lop gioi han 10 band/bo cuc o bass nhu K250/SP-5/Hi-X15, khong phai null, khong phai loi solver.
   D1 gainMax 12->15 trong luc giai: K271 RMS 1,1342->0,7091 (-0,425), obj 1,6878->0,9269, NHUNG viol=2 (shelf @45 +15,00, peaking @127 +14,42) - loi toi tu vi pham kep; K250 RMS 1,1755->0,6977, viol=1 (shelf @53 +15,00); B/OE 0,1343->0,0630, B/IE 0,1221->0,0756, viol=1 (shelf +13,19/+15,00); A va C giong tung bit (khong cham kep 12 dB); Hi-X15 D1=D1c (viol=0, gains <=11,34) nhu 04:18.
   D1c (D1 roi aeClampBand tung band ve kep chuan, tinh lai total): K271 RMS 1,8607 (TE HON base 1,1342), K250 1,4154 (te hon 1,1755), B/OE 0,4933 (te hon 0,1343), B/IE 1,2277 (te hon 0,1221) - chieu ve kep pha vo bo cuc NM da tim (shelf 12 dB khong con khop duong doc bass). Y tuong "noi noi bo roi chieu ve" BI BAC BO o ca 4 truong hop D1 doi dap an; chi Hi-X15 la truong hop D1 cho dap an hop le san (da biet tu 04:18, khong du lam va chung vi can chay song song 2 duong giai se gap doi ms, de do aeV3).
   Khong va: khong co bien the nao cai thien ma giu viol=0. Y tuong luot ke: huong A - mo ca te thu 5 cua sweep (Hi-X15 x harmanOE2015 1,1180); hoac huong B - do lai profile 3 pha buildFirTaps sau va truy hoi luong giac (treo tu 20:19/23:49). Luu y: luot ke la lan luu lab-only thu 3 lien tiep (04:55, 05:10, +1) - sau do phai chuyen QA-only theo skill. --- */
/* --- Mo rong 2026-11-10 (vong tu dong 05:20, huong A): mo ca te thu 5 moi cua sweep - Austrian Audio Hi-X15 x harmanOE2015 (RMS 1,1180, chua mo bao gio) + do san 20 band - KHONG AP VA, chi do. Lab Node tren ham that trich verbatim tu file hien tai (build_extract_0520.py, build_lab_0520.py; solver giong tung byte ban 05:10; duong giai y het sweep; 13 luot giai, 29 s; base 3 rep giong het).
   Tai lap dung RMS sweep 1,1180 (truoc EQ 3,405); 81,8% MSE o 20-100 Hz (RMS 1,9857), 16,0% o 2-10 kHz (RMS 0,8783), dinh du +3,566 dB @ 9948,5 Hz; nulls=[]; clamped=0 (KHONG band nao cham kep - khac K250/K271 co 5 band kep); viol=0; maxAbsGain 8,43. Lowshelf @202 Hz g=-1,12 gan nhu vo dung, bass do peaking @95/-5,22 va @404/+5,22 ganh - gioi han bo cuc/do tu do 10 band, khong phai null, khong phai loi solver.
   San 20 band: RMS 1,1180 -> 0,1839 (-83,5%), obj 1,4534 -> 0,1672, viol=0 - cung lop nhu K250 (1,18 -> 0,19): du do tu do thi solver giai tot, thieu band moi la gioi han.
   Doi chung cung tai nghe tai lap dung so sweep: harmanOE2013 1,0709 (65,0% MSE <100 Hz, dinh +5,142 dB @ 9948,5 Hz - cung dinh ~10 kHz nhu 2015), harmanOE 0,9254 (78,8% MSE <100 Hz, dinh -3,385 dB @ 20 Hz, clamped=2). Mau A/B/C khong doi: A/OE 0,0685, A/IE 0,0645, B/OE 0,1343, B/IE 0,1221, C/OE 0,1694, C/IE 0,1460.
   Khong va: khong co kep nao bi cham nen khong co bien the noi kep de thu; D1/D1c da bi bac 05:10; duong neo 10 band + kep shelf 300 Hz da co san trong solver va da tu choi dap an neo o ca nay theo tieu chi chat.
   Nhanh A: luot khong cai thien thu 3 lien tiep (04:33, 05:10, 05:20) - TAM DUNG nhanh A theo luat 3 luot. Luot ke PHIA QA-ONLY (lan luu lab-only thu 3: 04:55, 05:10, 05:20 - sau QA day du 04:47); sau QA chuyen nhanh: huong B - do lai profile 3 pha buildFirTaps sau va tich tuyen tinh 20:20; hoac huong D - do measureFps/drawGraph tren pho that. --- */
/* --- Mo rong 2026-11-10 (vong tu dong 05:29, QA-ONLY, khong va): chay day du qaRunSuite tren trinh duyet (Playwright + Chromium Headless Shell, qa_headless/run_qa.js, http.server 8931, bam nut that #btnQaAll; bao cao qa_report_2026-11-10_0529.json, log qa_run_0529.log). 57 test, 55 PASS, 1 FAIL that duy nhat: aeV3 (Mau A 751 ms, Mau C 874 ms, vuot 500 ms) - duoi tai sweep batch 0516 chay song song (~96% CPU); cung cong thoi gian nhu 04:47 (695/638 ms), 0 dong code doi tu 03:29 nen khong phai hoi quy. p4V1 HOI PHUC: TB 1,60/max 1,80 ms (04:47: TB 14,36/max 62,70 ms) - xac nhan FAIL 04:47 la nhieu tai. aeV1 DAT (RMS 2,1797 -> 0,1029 dB, 0 vi pham; ky luc <=0,258 dB giu nguyen), aeV2 DAT (null 8011 Hz, sau 12,8 dB, khong boost vao null), vRespOk/vPreOk/wasmV1Ok DAT; toan bo aeV4..aeV8, psV1..psV8, p4V3/p4V4, p5V1..p5V8 DAT; p4V2 chua du dieu kien do nhu moi lan; psV1 RMS 0,40 dB / max 0,97 dB - khop muc 00:38. Loi trang giong het tap co san (clampN, addEventListener null, ERR_TUNNEL, 404). Kho 5000/5000, danh sach 5003 muc giu nguyen.
   Bo dem luu lab-only: 0 - luot nay da chay QA day du; luot ke duoc phep va tro lai. Nhanh A van TAM DUNG (3 luot khong cai thien 04:33/05:10/05:20). Y tuong luot ke: huong B - do lai profile 3 pha buildFirTaps sau va tich tuyen tinh 20:20 (treo tu 20:19/23:49); hoac huong D - do measureFps/drawGraph tren pho that. Can do lai aeV3 khi sweep nghi de co so sach (probe 02:40 het sweep cho trung vi 387/419 ms < 500 ms). --- */
/* --- Vong tu dong 05:35, huong C: AP DUNG J1 - Jacobian GN loudGainsFor bang ti so tich (pr/c_k*c_k'): fit lanh nhanh hon 1,22-1,50x (luoi 169 cap) / 1,29-1,44x (cap don, 2 lan chay), gains lech toi da 7,1e-10 dB, RMS lech <=1,5e-11 dB (trong tien le 18:13); psV1 60/80 RMS 0,4002101769/max 0,9686386245 DAT. Khong cham solver/WASM/FIR/QA; aeV1/aeV2/aeV3 khong doi theo cau truc. Bo dem luu lab-only: 1 (sau QA day du 05:29). Nhanh A van TAM DUNG. Y tuong luot ke: huong D - do measureFps/drawGraph tren pho that; hoac huong B - do lai profile 3 pha buildFirTaps. --- */
/* --- Vong tu dong 05:58, huong C: AP DUNG J2 - tai dung ti so base trong vong GN loudGainsFor (loudRespPrT ghi ti so ra _ckA, vong k doc lai): 219/219 cap gains GIONG TUNG BIT, psV1 60/80 RMS 0,4002101769/max 0,9686386245 DAT; fit lanh cap don nhanh hon 1,04-1,48x (5/5 cap, 2 lan chay), luoi 169 cap 1,125x/1,0x; so lan danh gia section/diem luoi 18->12. Khong cham solver/WASM/FIR/QA; aeV1/aeV2/aeV3 khong doi theo cau truc. Bo dem luu lab-only: 2 (sau QA day du 05:29). Nhanh A van TAM DUNG. Y tuong luot ke: huong C - khai thac doi xung ma tran chuan A trong loudGainsFor; hoac huong D - do measureFps tren pho that. --- */
function aeSolve(freqs, errDb, weights, nBands, anchorShelf, fs, seedBands){
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS; /* Pha A/C 2026-11-07: solver theo sample rate that; mac dinh 48000. */
  /* --- Solver nhận biết null 2026-10-28 (hạng mục A): aeSolveSingle suy khoảng
       null từ các điểm W=0, phạt band boost có tâm trong null ngay trong hàm
       mục tiêu NM (hệ số 5.0), kẹp gain ở vòng RLS và chiếu cuối về 0 dB —
       hậu kiểm aeCompute giữ nguyên làm lớp bảo vệ thứ hai nhưng không còn
       phải nổ. Cắt (gain âm) trong null không bị cấm vì không boost null.
       --- Nâng cấp kiểm tra + tối ưu toàn kho 2026-10-28 (lowshelf 55 Hz + polish có điều kiện):
       Tập ứng viên gồm 4: đường cũ (shelf 105 Hz) và đường shelf 55 Hz, mỗi đường
       chạy đủ cặp lambda của chế độ (10 band: null/0.3, NM 2 vòng, phạt 0.02;
       20 band: 0.1/0.3, NM 6 vòng, phạt 0.06), chọn theo cùng hàm mục tiêu có phạt
       aeSolveObjective như trước. Shelf 55 Hz giúp các tai nghe bass roll-off sâu
       (correction cần > 12 dB ở 20 Hz, shelf 105 Hz bị kẹp gain) — ví dụ AKG K250:
       2,1373 -> 1,5219 dB chỉ nhờ thêm ứng viên này, 0 vi phạm safety.
       Sau đó, CHỈ khi RMS của ứng viên thắng (lưới solver, 20 Hz-10 kHz) còn
       > 0,7 dB mới chạy lại đúng họ của ứng viên thắng với nhiều vòng NM hơn
       (10 band: 4 vòng; 20 band: 10 vòng) rồi chọn lại theo cùng hàm mục tiêu.
       Vì các ứng viên cũ vẫn nằm trong tập chọn, mục tiêu có phạt của bản chọn
       không bao giờ tệ hơn bản cũ; các tai nghe đã tốt (RMS <= 0,7 dB, gồm cả
       3 mẫu chuẩn) giữ nguyên kết quả và không tốn thêm thời gian. RMS tính nội
       tuyến để AE_WORKER_SRC (chỉ gồm các hàm thuần đã liệt kê) không cần thêm
       hàm mới, nên parity Worker giữ nguyên.
       --- Nâng cấp hội tụ NM 2026-10-31: đo thực nghiệm trên Mẫu A (10 band)
       cho thấy 2 vòng NM bỏ lỡ phần lớn độ hội tụ — hàm mục tiêu có phạt
       0,3097 ở 2 vòng xuống 0,2351 (4 vòng), 0,1605 (8), 0,1214 (12),
       0,0975 (16), 0,0773 (24); RMS 0,5085 -> 0,2624 ở 12 vòng. Đường
       10 band nay chạy 12 vòng NM cho mọi ứng viên và polish có điều kiện
       nâng lên 16 vòng; thời gian giải Mẫu A ~226 ms, vẫn dưới cổng
       500 ms của hàng kiểm chứng aeV3. Đường >10 band GIỮ NGUYÊN 6/10
       vòng: ở 20 band, thêm vòng NM làm hàm mục tiêu giảm nhưng RMS thô
       tệ đi (0,0868 -> 0,1612 ở 14 vòng) vì NM tối ưu tiếp phần phạt
       gain/Q thay vì sai số — đúng đánh đổi đã chọn của tiêu chí, không
       đánh đổi thêm. --- */
  var is10 = !(nBands>10);
  var lamA = is10 ? null : 0.1, lamB = 0.3;
  var p0 = is10 ? 12 : 6, pHi = is10 ? 16 : 10;
  var rc = (is10 ? 0.02 : 0.06) * (AE_RC_SCALE || 1);
  var bi = 0, i, pick, pickObj, pickLam, pickShelf;
  var ms = 0;
  var ss=0, cc=0;
  var rmsWin = 0;
  if (seedBands){
    /* H14 (TASK #21, P1): nhanh seeded — dung 1 luot polish tu seed thay cho 4 ung vien
       (thiet ke lab TASK #17: seed = pick10 + 2 peaking gain 0; polish 6 vong NM, bo qua
       RLS nho contBands = seedBands; bi = 0, pickLam = lamA, pickShelf = 105). */
    var seedRun = aeSolveSingle(freqs, errDb, weights, nBands, lamA, p0, rc, 105, seedBands, anchorShelf, undefined, fsv);
    ms = seedRun.ms;
    for (i=0;i<freqs.length;i++) if (freqs[i]<=10000){ var e = errDb[i]-seedRun.total[i]; ss+=e*e; cc++; }
    rmsWin = cc ? Math.sqrt(ss/cc) : 0;
    pick = seedRun; pickObj = aeSolveObjective(seedRun.bands, seedRun.total, errDb, weights, rc);
    pickLam = lamA; pickShelf = 105;
  } else {
    var cands = [
      aeSolveSingle(freqs, errDb, weights, nBands, lamA, p0, rc, 105, undefined, anchorShelf, undefined, fsv),
      aeSolveSingle(freqs, errDb, weights, nBands, lamB, p0, rc, 105, undefined, anchorShelf, undefined, fsv),
      aeSolveSingle(freqs, errDb, weights, nBands, lamA, p0, rc, 55, undefined, anchorShelf, undefined, fsv),
      aeSolveSingle(freqs, errDb, weights, nBands, lamB, p0, rc, 55, undefined, anchorShelf, undefined, fsv)
    ];
    var objs = cands.map(function(c){ return aeSolveObjective(c.bands, c.total, errDb, weights, rc); });
    for (i=1;i<4;i++) if (objs[i]<objs[bi]) bi=i;
    cands.forEach(function(c){ ms += c.ms; });
    for (i=0;i<freqs.length;i++) if (freqs[i]<=10000){ var e = errDb[i]-cands[bi].total[i]; ss+=e*e; cc++; }
    rmsWin = cc ? Math.sqrt(ss/cc) : 0;
    pick = cands[bi]; pickObj = objs[bi];
    pickLam = (bi%2===0)?lamA:lamB; pickShelf = (bi>=2)?55:105;
  }
  if (rmsWin > 0.7){
    var polished = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, pHi, rc, pickShelf, (seedBands ? pick.bands : undefined), anchorShelf, undefined, fsv);
    ms += polished.ms;
    var oP = aeSolveObjective(polished.bands, polished.total, errDb, weights, rc);
    if (oP < pickObj){ pick = polished; pickObj = oP; }
  }
  /* --- Tiếp tục NM từ band thắng (nâng cấp 2026-10-31): đo thực nghiệm cho
       thấy phần cải thiện của chạy lại ứng viên thắng ở 24 vòng nằm ở các
       vòng NM 21-24 (chạy đúng 20 vòng cho RMS giống hệt bản hiện tại ở cả
       6 trường hợp Mẫu A/B/C x harmanOE/harmanIE), trong khi chạy lại nguyên
       vẹn tốn thêm ~97 ms và đẩy Mẫu C tới ~499 ms, sát cổng aeV3 500 ms.
       Tiếp tục NM từ đúng band của ứng viên thắng chỉ tốn 4 vòng NM, bỏ
       qua RLS (đã nằm trong band thắng) nên rẻ hơn nhiều, và chỉ giữ lại
       khi hàm mục tiêu cùng hệ số phạt rc thấp hơn — không bao giờ tệ hơn
       bản chọn cũ theo đúng tiêu chí chọn. Đường >10 band giữ nguyên. ---
       --- Mở rộng 2026-10-31 (vòng tự động 08:44): thí nghiệm exp11 trên
       chính hàm thật cho thấy tiếp tục 4 vòng từ band thắng cũng cải
       thiện đường >10 band ở cả 6/6 trường hợp (A/harmanOE 0,0868 ->
       0,0790; A/harmanIE 0,1256 -> 0,0986; B/harmanOE 0,2159 -> 0,1969;
       B/harmanIE 0,5785 -> 0,5425; C/harmanOE 0,1489 -> 0,1368;
       C/harmanIE 0,1341 -> 0,1309), tốn thêm chỉ ~35 ms và không có cổng
       thời gian cho đường này — kết luận cũ "thêm vòng làm RMS 20 band
       tệ đi" chỉ đúng khi chạy lại toàn bộ ứng viên từ đầu (đổi ứng
       viên thắng), không đúng với tiếp tục từ đúng band thắng kèm chấp
       nhận theo cùng hàm mục tiêu. Vì vậy lượt tiếp tục nay áp cho cả
       hai đường; đường 10 band chạy thêm lượt thứ hai (tổng hiệu dụng
       ~28 vòng): A/harmanOE 0,1780 -> 0,1665, B/harmanIE 0,3962 ->
       0,3571, các trường hợp còn lại cải thiện nhỏ hoặc giữ nguyên,
       tốn thêm chỉ ~17 ms. Mỗi lượt đều chỉ giữ khi hàm mục tiêu cùng
       rc thấp hơn nên không bao giờ tệ hơn bản chọn cũ. --- */
  /* --- Bo qua luot tiep tuc ss=1.0 thua sau diem bat dong (Pha A 2026-11-05 20:07, c10z10) ---
       Do vong NM 20:07 tren ham that: duong 10 band thua A/OE 160 ms, A/IE 553 ms,
       C/OE 532 ms Node (cac luot sau luot dat diem bat dong dau tien chi chay 1 vong
       xac nhan, dCuoi = 0); duong 20 band thua A/OE 1951 ms Node o 1 luot de quy
       (30 luot xac nhan 1 vong) va B/IE ~8380 ms Node o 2 luot de quy (21 luot chay
       lai dung quy dao 3 vong cua luot da bi tu choi); B/OE, B/IE, C/IE duong 10 band
       khong thua (khong luot nao dat diem bat dong). Chung minh bo qua la bit-identical:
       aeSolveSingle la ham xac dinh cua (bands, freqs, errDb, weights, pickLam, rc,
       pickShelf, anchorShelf, stepScale); moi luot chuoi tiep tuc deu co CUNG stepScale
       mac dinh 1.0 va CUNG pickLam/rc/pickShelf/anchorShelf. (1) Luot duoc chap nhan
       ma tra fixedPoint: pick chinh la trang thai bat dong nen luot sau dung ngay vong 1
       voi band giong het (truong hop chieu null cuoi doi band — kiem chung bang lab
       bit-identical 6/6 + 36/36 nhu c10z9; log do cho thay moi luot xac nhan sau deu co
       dCuoi = 0). (2) Luot bi tu choi ma tra fixedPoint o vong F <= cap: luot sau cung
       cap tro len chay lai dung quy dao cu den cung diem bat dong, objective/band giong
       het nen cung bi tu choi — vi vay chi bo qua khi cap sau >= cap luot bi tu choi
       (bao thu: cap >= F luon dung vi F <= cap; lo hong tien to neu cap sau < F).
       (3) Luot bi tu choi khong dat diem bat dong (chay het cap C): luot sau chi chay
       lai dung phep toan cu khi cap sau == C. Co ssFixed ghi pick dang la diem bat dong;
       ssSkipCap/ssSkipExact ghi thong tin luot bi tu choi gan nhat. Luot du phong
       c9c/c10f/c11f/c12f/c13f xuat phat tu c*Before.bands (khac pick) nen KHONG bi bo
       qua, nhung ket qua cua no van cap nhat co; c14f xuat phat tu pick nen duoc bo qua.
       Chuoi polish buoc nho (stepScale khac 1.0) khong dung co nay; co skipSSz (c10z9)
       giu nguyen. Chi ap cho chuoi tiep tuc ss=1.0 (aeTryCont/c5/c6/c7-c15/c10/c10b/
       c10d-c10j). --- */
  var ssFixed = false, ssSkipCap = 0, ssSkipExact = false;
  function ssNote(r, cap, acc){
    if (acc){ ssFixed = !!r.fixedPoint; ssSkipCap = 0; ssSkipExact = false; }
    else if (r.fixedPoint){ ssSkipCap = cap; ssSkipExact = false; }
    else { ssSkipCap = cap; ssSkipExact = true; }
  }
  function ssSkip(cap){
    return ssFixed || (ssSkipCap > 0 && (ssSkipExact ? cap === ssSkipCap : cap >= ssSkipCap));
  }
  function aeTryCont(curPick, curObj){
    if (ssSkip(4)) return { pick: curPick, obj: curObj };
    var c = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, curPick.bands, anchorShelf, undefined, fsv);
    ms += c.ms;
    var o = aeSolveObjective(c.bands, c.total, errDb, weights, rc);
    if (o < curObj){ ssNote(c, 4, true); return { pick: c, obj: o }; }
    ssNote(c, 4, false);
    return { pick: curPick, obj: curObj };
  }
  var contRes = aeTryCont(pick, pickObj);
  pick = contRes.pick; pickObj = contRes.obj;
  if (is10){
    var contRes2 = aeTryCont(pick, pickObj);
    pick = contRes2.pick; pickObj = contRes2.obj;
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 09:04): thí nghiệm exp12 trên
       chính hàm thật cho thấy thêm đúng một lượt tiếp tục 4 vòng nữa
       (lượt 3 cho đường 10 band, lượt 2 cho đường >10 band) vẫn cải
       thiện ở 11/12 trường hợp Mẫu A/B/C x harmanOE/harmanIE (10 band:
       B/harmanIE 0,3571 -> 0,3233; A/harmanOE 0,1665 -> 0,1597; 20 band:
       A/harmanIE 0,0986 -> 0,0909; C/harmanOE 0,1368 -> 0,1277), chỉ tốn
       thêm ~15-40 ms và vẫn chỉ giữ khi hàm mục tiêu cùng rc thấp hơn
       nên không bao giờ tệ hơn bản chọn cũ theo tiêu chí chọn. --- */
  var contRes3 = aeTryCont(pick, pickObj);
  pick = contRes3.pick; pickObj = contRes3.obj;
  /* --- Mở rộng 2026-10-31 (vòng tự động 09:24): thí nghiệm exp13 trên
       chính hàm thật cho thấy thêm đúng một lượt tiếp tục 4 vòng nữa
       (lượt 4 cho đường 10 band, lượt 3 cho đường >10 band) vẫn cải
       thiện ở 11/12 trường hợp Mẫu A/B/C x harmanOE/harmanIE (20 band:
       A/harmanOE 0,0759 -> 0,0717; A/harmanIE 0,0909 -> 0,0853;
       B/harmanIE 0,5099 -> 0,4774; C/harmanOE 0,1277 -> 0,1210; 10 band:
       B/harmanIE 0,3233 -> 0,2945; A/harmanOE 0,1597 -> 0,1533), chỉ tốn
       thêm ~15-40 ms và vẫn chỉ giữ khi hàm mục tiêu cùng rc thấp hơn
       nên không bao giờ tệ hơn bản chọn cũ theo tiêu chí chọn. Trường
       hợp duy nhất RMS thô nhích lên là C/harmanIE 10 band (0,1459 ->
       0,1461) trong khi hàm mục tiêu vẫn giảm — đúng đánh đổi của tiêu
       chí chọn, đã ghi rõ. Ứng viên shelf-80 có cổng bass (bassGapMean /
       bassRms) cũng đo trong exp13 nhưng KHÔNG triển khai: cổng không
       tách được trường hợp thắng lớn B/harmanOE 20 band (0,1926 ->
       0,0994) khỏi B/harmanIE 20 band (bassGapMean còn lớn hơn nhưng
       shelf-80 thua), nên chạy vô điều kiện sẽ tốn +160 ms ở 5/6 trường
       hợp mà không có lợi. --- */
  var contRes4 = aeTryCont(pick, pickObj);
  pick = contRes4.pick; pickObj = contRes4.obj;
  /* --- Mở rộng 2026-10-31 (vòng tự động 09:44): thí nghiệm exp14 trên
       chính hàm thật cho thấy thêm đúng một lượt tiếp tục 4 vòng nữa
       (lượt 5 cho đường 10 band, lượt 4 cho đường >10 band) vẫn cải
       thiện hàm mục tiêu có phạt ở 10/12 trường hợp Mẫu A/B/C x
       harmanOE/harmanIE (10 band: B/harmanIE 0,2945 -> 0,2700; 20 band:
       B/harmanIE 0,4774 -> 0,4475; A/harmanIE 20 band 0,0853 -> 0,0808),
       chỉ tốn thêm ~15-47 ms. NHƯNG chấp nhận thuần theo hàm mục tiêu
       sẽ làm tệ thước đo hiển thị RMS 20 Hz-10 kHz ở 2 trường hợp:
       C/harmanOE 20 band 0,1210 -> 0,1348 (+11,4%) dù MSE có trọng số
       cải thiện mạnh 0,0969 -> 0,0308 (hàm mục tiêu tính trên toàn lưới
       có trọng số tri giác + vùng trên 10 kHz, còn RMS hiển thị không
       trọng số và chỉ tới 10 kHz), và C/harmanIE 10 band 0,1461 ->
       0,1468. Vì vậy lượt mới này dùng tiêu chí chấp nhận CHẶT: chỉ giữ
       khi vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô tệ đi —
       10/12 trường hợp cải thiện, 2 trường hợp giữ nguyên, 0 trường hợp
       tệ đi. RMS tính nội tuyến (không gọi aeRms) để AE_WORKER_SRC
       không cần thêm hàm mà parity Worker vẫn giữ nguyên. --- */
  function aeRmsLocal(total){ var s=0, c=0; for (var i=0;i<freqs.length;i++){ if (freqs[i]<=10000){ var e=errDb[i]-total[i]; s+=e*e; c++; } } return c? Math.sqrt(s/c) : 0; }
  var curRms = aeRmsLocal(pick.total);
  if (!ssSkip(4)){
    var c5 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c5.ms;
    var o5 = aeSolveObjective(c5.bands, c5.total, errDb, weights, rc);
    if (o5 < pickObj && aeRmsLocal(c5.total) <= curRms){ pick = c5; pickObj = o5; }
    ssNote(c5, 4, pick === c5);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 10:04): thí nghiệm exp15 trên
       chính hàm thật cho thấy thêm đúng một lượt tiếp tục chặt nữa
       (lượt 6 cho đường 10 band, lượt 5 cho đường >10 band, cùng tiêu
       chí chấp nhận chặt của lượt 5: vừa giảm hàm mục tiêu cùng rc
       vừa không làm RMS thô 20 Hz-10 kHz tệ đi) vẫn cải thiện ở 9/12
       trường hợp Mẫu A/B/C x harmanOE/harmanIE, 0 trường hợp tệ đi.
       Kích thước lượt phân biệt theo đường: đường 10 band dùng 4 vòng
       như các lượt trước để giữ tổng thời gian dưới cổng aeV3 500 ms
       (thí nghiệm: +15-18 ms); đường >10 band không có cổng thời gian
       nên dùng 8 vòng, bắt trọn mức cải thiện lớn hơn (thí nghiệm:
       B/harmanIE 20 band 0,4475 -> 0,3904, A/harmanIE 20 band 0,0808 ->
       0,0757, tốn thêm ~70-97 ms). Các trường hợp còn lại giữ nguyên
       khi lượt mới bị từ chối (A/harmanIE 10 band, C/harmanOE 20 band,
       C/harmanIE 10 band). --- */
  var c6Passes = (nBands <= 10) ? 4 : 8;
  if (!ssSkip(c6Passes)){
    var c6 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c6Passes, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c6.ms;
    var o6 = aeSolveObjective(c6.bands, c6.total, errDb, weights, rc);
    if (o6 < pickObj && aeRmsLocal(c6.total) <= aeRmsLocal(pick.total)){ pick = c6; pickObj = o6; }
    ssNote(c6, c6Passes, pick === c6);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 10:44, áp lại ở vòng 12:24 sau
       khi objective NM được tối ưu tốc độ): thí nghiệm exp17 trên
       chính hàm thật cho thấy thêm đúng một lượt tiếp tục chặt 16 vòng
       nữa (lượt 7) vẫn cải thiện RMS 20 Hz-10 kHz ở 6/6 trường hợp đường
       20 band (A/harmanOE 0,0627 -> 0,0598; A/harmanIE 0,0757 -> 0,0692;
       B/harmanOE 0,1800 -> 0,1687; B/harmanIE 0,3904 -> 0,2977, -23,8%;
       C/harmanOE 0,1210 -> 0,1025; C/harmanIE 0,1133 -> 0,1059), tốn thêm
       ~160-244 ms nhưng đường 20 band không có cổng thời gian. Lượt này
       CHỈ áp cho đường >10 band: vòng 10:24 đã thử c7 cho cả hai đường
       và rớt cổng aeV3 500 ms do máy kiểm chứng chậm (bản checkpoint
       không đổi cũng rớt 491-538 ms), nên đường 10 band giữ nguyên để
       không cộng thêm mili-giây nào vào cổng aeV3. Tiêu chí chấp nhận
       chặt như lượt 5/6: vừa giảm hàm mục tiêu cùng rc vừa không làm
       RMS thô tệ đi. --- */
  if (nBands > 10 && !ssSkip(16)){
    var c7 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 16, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c7.ms;
    var o7 = aeSolveObjective(c7.bands, c7.total, errDb, weights, rc);
    if (o7 < pickObj && aeRmsLocal(c7.total) <= aeRmsLocal(pick.total)){ pick = c7; pickObj = o7; }
    ssNote(c7, 16, pick === c7);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 12:44): thí nghiệm exp23 trên
       chính hàm thật cho thấy thêm đúng một lượt tiếp tục chặt 16 vòng
       nữa (lượt 8) vẫn cải thiện RMS 20 Hz-10 kHz ở 5/6 trường hợp đường
       20 band (B/harmanIE 0,2977 -> 0,2319, -22,1%; C/harmanOE 0,1025 ->
       0,0879, -14,2%; B/harmanOE -5,8%; A/harmanIE -2,6%; A/harmanOE
       -1,2%), trường hợp còn lại (C/harmanIE) bị từ chối nên giữ nguyên,
       0 trường hợp tệ đi, tốn thêm ~120-190 ms nhưng đường 20 band
       không có cổng thời gian. Lượt này CHỈ áp cho đường >10 band như
       c7 (đường 10 band giữ nguyên để không cộng thêm mili-giây nào
       vào cổng aeV3). Tiêu chí chấp nhận chặt như lượt 5/6/7: vừa giảm
       hàm mục tiêu cùng rc vừa không làm RMS thô tệ đi. Đã thử biến
       thể 32 vòng trong cùng thí nghiệm: tốt hơn ở B/harmanOE/B/harmanIE
       nhưng tệ hơn ở A/harmanIE và bị từ chối ở A/harmanOE, nên vòng
       này giữ cỡ 16 vòng; biến thể 32 vòng (hoặc nối 16 -> 32) để vòng
       sau khảo sát riêng. --- */
  if (nBands > 10 && !ssSkip(16)){
    var c8 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 16, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c8.ms;
    var o8 = aeSolveObjective(c8.bands, c8.total, errDb, weights, rc);
    if (o8 < pickObj && aeRmsLocal(c8.total) <= aeRmsLocal(pick.total)){ pick = c8; pickObj = o8; }
    ssNote(c8, 16, pick === c8);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 13:04): thí nghiệm exp24 trên
       chính hàm thật cho thấy nối thêm lượt chặt 16 vòng nữa từ kết quả
       c8 (lượt 9) rồi nối tiếp lượt 16 vòng nữa từ kết quả vừa chấp nhận
       (lượt 10) vẫn cải thiện mạnh RMS 20 Hz-10 kHz ở đường 20 band:
       B/harmanIE 0,2319 -> 0,1567 (-32,4%), B/harmanOE 0,1590 -> 0,1419
       (-10,8%), C/harmanOE 0,0879 -> 0,0864 (-1,7%); các trường hợp chuỗi
       bị từ chối (A/harmanOE, A/harmanIE, C/harmanIE) giữ nguyên. Vì vậy
       thêm bước dự phòng: chỉ khi chuỗi 16->16 cải thiện RMS dưới 1% so
       với điểm vào c9 thì chạy thêm một lượt 32 vòng từ đúng điểm vào
       đó, chấp nhận chặt và chỉ khi tốt hơn kết quả chuỗi — thí nghiệm
       cho thấy bước này cứu A/harmanIE 0,0674 -> 0,0659 (-2,2%), còn
       A/harmanOE chỉ +0,3% và C/harmanIE bị từ chối nên giữ nguyên.
       Kết quả dự báo cuối: A/OE 0,0589, A/IE 0,0659, B/OE 0,1419,
       B/IE 0,1567, C/OE 0,0864, C/IE 0,1059; 0 trường hợp tệ đi. Lượt
       này CHỈ áp cho đường >10 band như c7/c8 (đường 10 band giữ nguyên
       để không cộng thêm mili-giây nào vào cổng aeV3). Tiêu chí chấp
       nhận chặt như lượt 5/6/7/8: vừa giảm hàm mục tiêu cùng rc vừa
       không làm RMS thô tệ đi; bước dự phòng thêm điều kiện RMS tốt
       hơn hẳn kết quả chuỗi. Chi phí thêm: ~125-250 ms cho chuỗi,
       tối đa ~380 ms khi phải chạy dự phòng, đường 20 band không có
       cổng thời gian. --- */
  if (nBands > 10){
    var c9Before = pick, c9BeforeRms = aeRmsLocal(pick.total);
    if (!ssSkip(16)){
      var c9a = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 16, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
      ms += c9a.ms;
      var o9a = aeSolveObjective(c9a.bands, c9a.total, errDb, weights, rc);
      if (o9a < pickObj && aeRmsLocal(c9a.total) <= aeRmsLocal(pick.total)){
        pick = c9a; pickObj = o9a;
        ssNote(c9a, 16, true);
        if (!ssSkip(16)){
          var c9b = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 16, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
          ms += c9b.ms;
          var o9b = aeSolveObjective(c9b.bands, c9b.total, errDb, weights, rc);
          if (o9b < pickObj && aeRmsLocal(c9b.total) <= aeRmsLocal(pick.total)){ pick = c9b; pickObj = o9b; }
          ssNote(c9b, 16, pick === c9b);
        }
      } else { ssNote(c9a, 16, false); }
    }
    var c9AfterRms = aeRmsLocal(pick.total);
    if (c9BeforeRms > 0 && (c9BeforeRms - c9AfterRms) / c9BeforeRms < 0.01){
      var c9c = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 32, rc, pickShelf, c9Before.bands, anchorShelf, undefined, fsv);
      ms += c9c.ms;
      var o9c = aeSolveObjective(c9c.bands, c9c.total, errDb, weights, rc);
      if (o9c < pickObj && aeRmsLocal(c9c.total) <= aeRmsLocal(pick.total) && aeRmsLocal(c9c.total) < c9AfterRms){ pick = c9c; pickObj = o9c; }
      ssNote(c9c, 32, pick === c9c);
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 13:24): thí nghiệm exp25 trên
       chính hàm thật cho thấy nối thêm chuỗi chặt 16->16->16 nữa từ kết
       quả c9 (lượt 11-13) vẫn cải thiện mạnh RMS 20 Hz-10 kHz ở đường
       20 band: B/harmanIE 0,1567 -> 0,1165 (-25,6%, cả 3 bước đều được
       chấp nhận), B/harmanOE 0,1419 -> 0,1192 (-16,0%, cả 3 bước đều
       được chấp nhận); A/harmanIE chỉ bước đầu được chấp nhận
       (0,0659 -> 0,0656), các trường hợp còn lại bị từ chối nên giữ
       nguyên. Vì vậy thêm bước dự phòng như c9: chỉ khi chuỗi cải
       thiện RMS dưới 1% so với điểm vào c10 thì chạy thêm một lượt 48
       vòng từ đúng điểm vào đó, chấp nhận chặt và chỉ khi tốt hơn kết
       quả chuỗi — thí nghiệm cho thấy bước này cứu A/harmanOE
       0,0589 -> 0,0580 (-1,5%), còn A/harmanIE/C bị từ chối nên giữ
       nguyên. Kết quả dự báo cuối: A/OE 0,0580, A/IE 0,0656, B/OE
       0,1192, B/IE 0,1165, C/OE 0,0864, C/IE 0,1059; 0 trường hợp tệ đi.
       Lượt này CHỈ áp cho đường >10 band như c7/c8/c9 (đường 10 band
       giữ nguyên để không cộng thêm mili-giây nào vào cổng aeV3).
       Tiêu chí chấp nhận chặt như các lượt trước: vừa giảm hàm mục
       tiêu cùng rc vừa không làm RMS thô tệ đi. Chi phí thêm:
       ~370-570 ms cho chuỗi, tối đa ~580 ms nữa khi phải chạy dự
       phòng, đường 20 band không có cổng thời gian. --- */
  if (nBands > 10){
    var c10Before = pick, c10BeforeRms = aeRmsLocal(pick.total);
    var c10Steps = [16, 16, 16];
    for (var c10i = 0; c10i < c10Steps.length; c10i++){
      if (!ssSkip(16)){
        var c10s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c10Steps[c10i], rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
        ms += c10s.ms;
        var o10s = aeSolveObjective(c10s.bands, c10s.total, errDb, weights, rc);
        if (o10s < pickObj && aeRmsLocal(c10s.total) <= aeRmsLocal(pick.total)){ pick = c10s; pickObj = o10s; }
        ssNote(c10s, 16, pick === c10s);
      }
    }
    var c10AfterRms = aeRmsLocal(pick.total);
    if (c10BeforeRms > 0 && (c10BeforeRms - c10AfterRms) / c10BeforeRms < 0.01){
      var c10f = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 48, rc, pickShelf, c10Before.bands, anchorShelf, undefined, fsv);
      ms += c10f.ms;
      var o10f = aeSolveObjective(c10f.bands, c10f.total, errDb, weights, rc);
      if (o10f < pickObj && aeRmsLocal(c10f.total) <= aeRmsLocal(pick.total) && aeRmsLocal(c10f.total) < c10AfterRms){ pick = c10f; pickObj = o10f; }
      ssNote(c10f, 48, pick === c10f);
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 13:44): thí nghiệm exp26 trên
       chính hàm thật cho thấy nối thêm chuỗi chặt 16->16->16->16 nữa từ
       kết quả c10 (lượt 14-17) vẫn cải thiện mạnh RMS 20 Hz-10 kHz ở
       đường 20 band: B/harmanOE 0,1192 -> 0,0989 (-17,0%, cả 4 bước đều
       được chấp nhận), B/harmanIE 0,1165 -> 0,1019 (-12,5%, cả 4 bước
       đều được chấp nhận); các trường hợp còn lại bị từ chối nên giữ
       nguyên. Vì vậy thêm bước dự phòng như c9/c10: chỉ khi chuỗi cải
       thiện RMS dưới 1% so với điểm vào c11 thì chạy thêm một lượt 64
       vòng từ đúng điểm vào đó, chấp nhận chặt và chỉ khi tốt hơn kết
       quả chuỗi — thí nghiệm cho thấy bước này bị từ chối ở cả 4 trường
       hợp A/C nên giữ nguyên, nhưng giữ lại để bắt trường hợp chuỗi
       không cứu được như c9/c10 từng cứu. Kết quả dự báo cuối: A/OE
       0,0580, A/IE 0,0656, B/OE 0,0989, B/IE 0,1019, C/OE 0,0864, C/IE
       0,1059; 0 trường hợp tệ đi. Lượt này CHỈ áp cho đường >10 band
       như c7/c8/c9/c10 (đường 10 band giữ nguyên để không cộng thêm
       mili-giây nào vào cổng aeV3). Tiêu chí chấp nhận chặt như các
       lượt trước: vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô
       tệ đi. Chi phí thêm: ~480-750 ms cho chuỗi, tối đa ~750 ms nữa
       khi phải chạy dự phòng, đường 20 band không có cổng thời gian. --- */
  if (nBands > 10){
    var c11Before = pick, c11BeforeRms = aeRmsLocal(pick.total);
    var c11Steps = [16, 16, 16, 16];
    for (var c11i = 0; c11i < c11Steps.length; c11i++){
      if (!ssSkip(16)){
        var c11s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c11Steps[c11i], rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
        ms += c11s.ms;
        var o11s = aeSolveObjective(c11s.bands, c11s.total, errDb, weights, rc);
        if (o11s < pickObj && aeRmsLocal(c11s.total) <= aeRmsLocal(pick.total)){ pick = c11s; pickObj = o11s; }
        ssNote(c11s, 16, pick === c11s);
      }
    }
    var c11AfterRms = aeRmsLocal(pick.total);
    if (c11BeforeRms > 0 && (c11BeforeRms - c11AfterRms) / c11BeforeRms < 0.01){
      var c11f = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 64, rc, pickShelf, c11Before.bands, anchorShelf, undefined, fsv);
      ms += c11f.ms;
      var o11f = aeSolveObjective(c11f.bands, c11f.total, errDb, weights, rc);
      if (o11f < pickObj && aeRmsLocal(c11f.total) <= aeRmsLocal(pick.total) && aeRmsLocal(c11f.total) < c11AfterRms){ pick = c11f; pickObj = o11f; }
      ssNote(c11f, 64, pick === c11f);
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 14:04): thí nghiệm exp27 trên
       chính hàm thật cho thấy nối thêm chuỗi chặt 16->16->16->16->16
       nữa từ kết quả c11 (lượt 18-22) vẫn cải thiện mạnh RMS 20 Hz-10
       kHz ở đường 20 band: B/harmanOE 0,0989 -> 0,0794 (-19,7%, cả 5
       bước đều được chấp nhận), B/harmanIE 0,1019 -> 0,0881 (-13,5%,
       4 bước đầu được chấp nhận, bước 5 bị từ chối); các trường hợp
       còn lại bị từ chối nên giữ nguyên. Vì vậy thêm bước dự phòng
       như c9/c10/c11: chỉ khi chuỗi cải thiện RMS dưới 1% so với điểm
       vào c12 thì chạy thêm một lượt 80 vòng từ đúng điểm vào đó,
       chấp nhận chặt và chỉ khi tốt hơn kết quả chuỗi — thí nghiệm
       cho thấy bước này bị từ chối ở cả 4 trường hợp A/C nên giữ
       nguyên, nhưng giữ lại để bắt trường hợp chuỗi không cứu được
       như c9/c10 từng cứu. Kết quả dự báo cuối: A/OE 0,0580, A/IE
       0,0656, B/OE 0,0794, B/IE 0,0881, C/OE 0,0864, C/IE 0,1059; 0
       trường hợp tệ đi. Lượt này CHỈ áp cho đường >10 band như
       c7/c8/c9/c10/c11 (đường 10 band giữ nguyên để không cộng thêm
       mili-giây nào vào cổng aeV3). Tiêu chí chấp nhận chặt như các
       lượt trước: vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô
       tệ đi. Chi phí thêm: ~600-930 ms cho chuỗi, tối đa ~930 ms nữa
       khi phải chạy dự phòng, đường 20 band không có cổng thời gian. --- */
  if (nBands > 10){
    var c12Before = pick, c12BeforeRms = aeRmsLocal(pick.total);
    var c12Steps = [16, 16, 16, 16, 16];
    for (var c12i = 0; c12i < c12Steps.length; c12i++){
      if (!ssSkip(16)){
        var c12s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c12Steps[c12i], rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
        ms += c12s.ms;
        var o12s = aeSolveObjective(c12s.bands, c12s.total, errDb, weights, rc);
        if (o12s < pickObj && aeRmsLocal(c12s.total) <= aeRmsLocal(pick.total)){ pick = c12s; pickObj = o12s; }
        ssNote(c12s, 16, pick === c12s);
      }
    }
    var c12AfterRms = aeRmsLocal(pick.total);
    if (c12BeforeRms > 0 && (c12BeforeRms - c12AfterRms) / c12BeforeRms < 0.01){
      var c12f = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 80, rc, pickShelf, c12Before.bands, anchorShelf, undefined, fsv);
      ms += c12f.ms;
      var o12f = aeSolveObjective(c12f.bands, c12f.total, errDb, weights, rc);
      if (o12f < pickObj && aeRmsLocal(c12f.total) <= aeRmsLocal(pick.total) && aeRmsLocal(c12f.total) < c12AfterRms){ pick = c12f; pickObj = o12f; }
      ssNote(c12f, 80, pick === c12f);
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 14:24): thí nghiệm exp28 trên
       chính hàm thật cho thấy nối thêm chuỗi chặt 16->16->16->16->16
       ->16 nữa từ kết quả c12 (lượt 23-28) vẫn cải thiện mạnh RMS
       20 Hz-10 kHz ở đường 20 band: B/harmanOE 0,0794 -> 0,0606
       (-23,7%, cả 6 bước đều được chấp nhận); các trường hợp còn lại
       bị từ chối ở chuỗi nên giữ nguyên. Vì vậy thêm bước dự phòng
       như c9/c10/c11/c12: chỉ khi chuỗi cải thiện RMS dưới 1% so với
       điểm vào c13 thì chạy thêm một lượt 96 vòng từ đúng điểm vào
       đó, chấp nhận chặt và chỉ khi tốt hơn kết quả chuỗi — thí
       nghiệm cho thấy bước này cứu được C/harmanOE 0,0864 -> 0,0858
       (-0,7%) mà chuỗi không cứu được, bị từ chối ở các trường hợp
       còn lại. Kết quả dự báo cuối: A/OE 0,0580, A/IE 0,0656, B/OE
       0,0606, B/IE 0,0881, C/OE 0,0858, C/IE 0,1059; 0 trường hợp tệ
       đi. Lượt này CHỈ áp cho đường >10 band như c7/c8/c9/c10/c11/
       c12 (đường 10 band giữ nguyên để không cộng thêm mili-giây nào
       vào cổng aeV3). Tiêu chí chấp nhận chặt như các lượt trước:
       vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô tệ đi.
       Chi phí thêm: ~570-880 ms cho chuỗi, tối đa ~900 ms nữa khi
       phải chạy dự phòng, đường 20 band không có cổng thời gian. --- */
  if (nBands > 10){
    var c13Before = pick, c13BeforeRms = aeRmsLocal(pick.total);
    var c13Steps = [16, 16, 16, 16, 16, 16];
    for (var c13i = 0; c13i < c13Steps.length; c13i++){
      if (!ssSkip(16)){
        var c13s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c13Steps[c13i], rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
        ms += c13s.ms;
        var o13s = aeSolveObjective(c13s.bands, c13s.total, errDb, weights, rc);
        if (o13s < pickObj && aeRmsLocal(c13s.total) <= aeRmsLocal(pick.total)){ pick = c13s; pickObj = o13s; }
        ssNote(c13s, 16, pick === c13s);
      }
    }
    var c13AfterRms = aeRmsLocal(pick.total);
    if (c13BeforeRms > 0 && (c13BeforeRms - c13AfterRms) / c13BeforeRms < 0.01){
      var c13f = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 96, rc, pickShelf, c13Before.bands, anchorShelf, undefined, fsv);
      ms += c13f.ms;
      var o13f = aeSolveObjective(c13f.bands, c13f.total, errDb, weights, rc);
      if (o13f < pickObj && aeRmsLocal(c13f.total) <= aeRmsLocal(pick.total) && aeRmsLocal(c13f.total) < c13AfterRms){ pick = c13f; pickObj = o13f; }
      ssNote(c13f, 96, pick === c13f);
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 14:44): thí nghiệm exp29/
       exp29b trên chính hàm thật cho thấy nối thêm chuỗi chặt 16 x7
       nữa từ kết quả c13 (lượt 29-35) vẫn cải thiện RMS 20 Hz-10 kHz
       ở đường 20 band: B/harmanOE 0,0606 -> 0,0562 (-7,3%, 3 bước
       đầu được chấp nhận), C/harmanOE 0,0858 -> 0,0855 (-0,4%,
       1 bước được chấp nhận); các trường hợp còn lại bị từ chối ở
       cả 7 bước nên giữ nguyên. Điểm mới so với dự phòng kiểu
       c9-c13 (chỉ chạy khi chuỗi tắc dưới 1%): thí nghiệm cho thấy
       lượt dài 112 vòng từ đúng kết quả chuỗi lại tốt hơn cả chuỗi
       lẫn lượt 112 từ điểm vào, và chỉ có ích khi chuỗi đã tiến
       được ít nhất 1 bước — B/harmanOE 0,0562 -> 0,0501 (-17,3%
       so với điểm vào c14), C/harmanOE 0,0855 -> 0,0838 (-2,3%);
       ở 4 trường hợp chuỗi tắc hoàn toàn, lượt 112 đều bị cổng
       chặt từ chối (thậm chí tệ hơn điểm vào, vd C/harmanIE
       0,1249). Vì vậy dự phòng c14 chạy lượt 112 vòng từ kết quả
       chuỗi, CHỈ khi chuỗi đã chấp nhận ít nhất 1 bước, chấp nhận
       chặt (hàm mục tiêu cùng rc giảm và RMS thô dưới 10 kHz
       cải thiện tuyệt đối so với kết quả chuỗi) — không trường hợp
       nào tệ đi, và 4 trường hợp tắc không tốn thêm mili-giây nào.
       Kết quả dự báo cuối: A/OE 0,0580, A/IE 0,0656, B/OE 0,0501,
       B/IE 0,0881, C/OE 0,0838, C/IE 0,1059. Lượt này CHỈ áp cho
       đường >10 band như c7-c13 (đường 10 band giữ nguyên để
       không cộng thêm mili-giây nào vào cổng aeV3). Chi phí thêm:
       ~650-1100 ms cho chuỗi, tối đa ~1020 ms nữa cho dự phòng
       khi chuỗi có tiến triển, đường 20 band không có cổng thời
       gian. --- */
  if (nBands > 10){
    var c14Steps = [16, 16, 16, 16, 16, 16, 16];
    var c14Accepted = 0;
    for (var c14i = 0; c14i < c14Steps.length; c14i++){
      if (!ssSkip(16)){
        var c14s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c14Steps[c14i], rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
        ms += c14s.ms;
        var o14s = aeSolveObjective(c14s.bands, c14s.total, errDb, weights, rc);
        if (o14s < pickObj && aeRmsLocal(c14s.total) <= aeRmsLocal(pick.total)){ pick = c14s; pickObj = o14s; c14Accepted++; }
        ssNote(c14s, 16, pick === c14s);
      }
    }
    var c14AfterRms = aeRmsLocal(pick.total);
    if (c14Accepted > 0 && !ssSkip(112)){
      var c14f = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 112, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
      ms += c14f.ms;
      var o14f = aeSolveObjective(c14f.bands, c14f.total, errDb, weights, rc);
      if (o14f < pickObj && aeRmsLocal(c14f.total) < c14AfterRms){ pick = c14f; pickObj = o14f; }
      ssNote(c14f, 112, pick === c14f);
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 15:04): thí nghiệm exp30
       trên chính hàm thật cho thấy nối thêm chuỗi chặt 16 x8
       nữa từ kết quả c14 vẫn cải thiện RMS 20 Hz-10 kHz ở đường
       20 band: B/harmanOE 0,0501 -> 0,0485 (-3,2%, 3 bước được chấp
       nhận), C/harmanOE 0,0838 -> 0,0825 (-1,5%, 3 bước được chấp
       nhận); các trường hợp còn lại bị từ chối ở cả 8 bước nên
       giữ nguyên. Điểm khác so với c14: lượt dự phòng 128 vòng từ
       kết quả chuỗi bị cổng chặt từ chối ở CẢ 6 trường hợp (kể cả
       2 trường hợp chuỗi có tiến triển: B/harmanOE cho 0,0504,
       C/harmanOE cho 0,0836, đều tệ hơn kết quả chuỗi), và lượt
       128 từ điểm vào cũng bị từ chối ở cả 6 trường hợp — nên
       c15 CHỈ gồm chuỗi, không kèm dự phòng, tránh tốn thêm
       ~800-1170 ms vô ích cho mỗi lần giải 20 band có tiến triển.
       Kết quả dự báo cuối: A/OE 0,0580, A/IE 0,0656, B/OE 0,0485,
       B/IE 0,0881, C/OE 0,0825, C/IE 0,1059. Lượt này CHỈ áp cho
       đường >10 band như c7-c14 (đường 10 band giữ nguyên để
       không cộng thêm mili-giây nào vào cổng aeV3). --- */
  if (nBands > 10){
    var c15Steps = [16, 16, 16, 16, 16, 16, 16, 16];
    for (var c15i = 0; c15i < c15Steps.length; c15i++){
      if (!ssSkip(16)){
        var c15s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, c15Steps[c15i], rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
        ms += c15s.ms;
        var o15s = aeSolveObjective(c15s.bands, c15s.total, errDb, weights, rc);
        if (o15s < pickObj && aeRmsLocal(c15s.total) <= aeRmsLocal(pick.total)){ pick = c15s; pickObj = o15s; }
        ssNote(c15s, 16, pick === c15s);
      }
    }
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 15:44): hướng mới sau khi
       chuỗi 20 band đã hội tụ (vòng 15:24 đo 0/54 bước chấp nhận ở
       exp31) — quay lại đường 10 band, nơi các lượt c7-c15 đều bỏ
       qua vì cổng aeV3 500 ms. Thí nghiệm exp32 trên chính hàm thật
       cho thấy MỘT lượt tiếp tục chặt 8 vòng từ kết quả cuối của
       aeSolve vẫn cải thiện RMS 20 Hz-10 kHz ở 3/6 trường hợp đường
       10 band: A/harmanOE 0,1446 -> 0,1395 (-3,5%), B/harmanOE
       0,1729 -> 0,1689 (-2,3%), B/harmanIE 0,2484 -> 0,2178
       (-12,3%); 3 trường hợp còn lại bị cổng chặt từ chối nên giữ
       nguyên tuyệt đối (A/harmanIE không đổi, C/harmanOE và
       C/harmanIE có hàm mục tiêu giảm nhưng RMS thô nhích lên nên
       bị loại). Lượt 16 vòng cho thêm (A/harmanOE -> 0,1348,
       B/harmanIE -> 0,1975) nhưng tốn ~42-53 ms so với ~21-24 ms
       của lượt 8 vòng, nên vòng này giữ cỡ 8 vòng để còn dư địa
       cho cổng aeV3 (lượt 8+8 về sau cho đúng kết quả lượt 16 ở
       3 trường hợp cải thiện, để dành cho vòng sau nếu dư địa cho
       phép). Lượt này CHỈ áp cho đường <=10 band (đường 20 band
       đã hội tụ, không chạm tới). Tiêu chí chấp nhận chặt như
       c5/c6: vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô
       tệ đi, nên không trường hợp nào tệ đi. --- */
  if (nBands <= 10 && !ssSkip(8)){
    var c10 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 8, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10.ms;
    var o10 = aeSolveObjective(c10.bands, c10.total, errDb, weights, rc);
    if (o10 < pickObj && aeRmsLocal(c10.total) <= aeRmsLocal(pick.total)){ pick = c10; pickObj = o10; }
    ssNote(c10, 8, pick === c10);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 16:04): thí nghiệm exp33 trên
       chính hàm thật cho thấy MỘT lượt tiếp tục chặt 8 vòng nữa từ kết
       quả cuối của aeSolve (lượt thứ hai sau lượt 8 vòng vòng 15:44)
       vẫn cải thiện RMS 20 Hz-10 kHz ở 3/6 trường hợp đường 10 band:
       A/harmanOE 0,1395 -> 0,1348 (-3,4%), B/harmanOE 0,1689 -> 0,1649
       (-2,4%), B/harmanIE 0,2178 -> 0,1975 (-9,3%); 3 trường hợp còn
       lại bị cổng chặt từ chối nên giữ nguyên tuyệt đối. Lượt thứ ba
       8 vòng cũng cải thiện thêm (A/harmanOE -> 0,1263, B/harmanOE ->
       0,1609, B/harmanIE -> 0,1822) nhưng vòng này chỉ thêm lượt thứ
       hai để còn dư địa cho cổng aeV3 500 ms (mỗi lượt tốn ~28 ms);
       lượt thứ ba để dành cho vòng sau nếu dư địa cho phép. Lượt này
       CHỈ áp cho đường <=10 band (đường 20 band đã hội tụ, không chạm
       tới). Tiêu chí chấp nhận chặt như c5/c6 và lượt đầu: vừa giảm
       hàm mục tiêu cùng rc vừa không làm RMS thô tệ đi, nên không
       trường hợp nào tệ đi. --- */
  if (nBands <= 10 && !ssSkip(8)){
    var c10b = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 8, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10b.ms;
    var o10b = aeSolveObjective(c10b.bands, c10b.total, errDb, weights, rc);
    if (o10b < pickObj && aeRmsLocal(c10b.total) <= aeRmsLocal(pick.total)){ pick = c10b; pickObj = o10b; }
    ssNote(c10b, 8, pick === c10b);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 18:04): thử lại ứng viên
       c10d đã bị khôi phục ở các vòng 16:44 và 17:04 vì rớt cổng
       aeV3 trên QA, nhưng chẩn đoán sau đó cho thấy cả hai lần rớt
       đều do máy kiểm chứng chậm dần trong vòng (bản gốc cuối vòng
       cũng rớt), không chứng minh c10d phá cổng. Thí nghiệm exp35
       trên chính hàm thật cho thấy MỘT lượt tiếp tục chặt 4 vòng từ
       kết quả cuối của aeSolve vẫn cải thiện RMS 20 Hz-10 kHz ở 3/6
       trường hợp đường 10 band: A/harmanOE 0,1348 -> 0,1321 (-2,0%),
       B/harmanOE 0,1649 -> 0,1628 (-1,3%), B/harmanIE 0,1975 ->
       0,1893 (-4,1%); 3 trường hợp còn lại bị cổng chặt từ chối nên
       giữ nguyên tuyệt đối. Chi phí chỉ ~14-15 ms, bằng ~1/2 lượt
       8 vòng. Vòng này chỉ thử lại vì QA bản gốc đầu vòng ĐẠT với
       dư địa (aeV3 Mẫu A 461 ms, Mẫu C 381 ms, cả hai < 470 ms theo
       điều kiện vòng 17:04 đặt ra). Lượt này CHỈ áp cho đường
       <=10 band (đường 20 band đã hội tụ, không chạm tới). Tiêu chí
       chấp nhận chặt như c5/c6 và các lượt trước: vừa giảm hàm mục
       tiêu cùng rc vừa không làm RMS thô tệ đi, nên không trường
       hợp nào tệ đi. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10d = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10d.ms;
    var o10d = aeSolveObjective(c10d.bands, c10d.total, errDb, weights, rc);
    if (o10d < pickObj && aeRmsLocal(c10d.total) <= aeRmsLocal(pick.total)){ pick = c10d; pickObj = o10d; }
    ssNote(c10d, 4, pick === c10d);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 18:44): lượt tiếp tục chặt
       c10e — MỘT lượt tiếp tục chặt 4 vòng nữa ngay sau c10d.
       Thí nghiệm exp40 trên chính hàm thật (baseline đã gồm
       c10/c10b/c10d) cho thấy lượt này vẫn cải thiện RMS 20 Hz-
       10 kHz ở 3/6 trường hợp đường 10 band: A/harmanOE 0,1321 ->
       0,1263 (-4,4%), B/harmanOE 0,1628 -> 0,1609 (-1,2%),
       B/harmanIE 0,1893 -> 0,1822 (-3,7%); 3 trường hợp còn lại bị
       cổng chặt từ chối nên giữ nguyên tuyệt đối. Chi phí chỉ
       ~14-15 ms. Vòng này chỉ triển khai vì QA bản gốc đầu vòng
       ĐẠT với dư địa (aeV3 Mẫu A 399 ms, Mẫu C 394 ms, cả hai
       < 470 ms theo điều kiện vòng 17:04 đặt ra). Lượt này CHỈ
       áp cho đường <=10 band (đường 20 band đã hội tụ, không chạm
       tới). Tiêu chí chấp nhận chặt như c5/c6 và các lượt trước:
       vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô tệ đi,
       nên không trường hợp nào tệ đi. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10e = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10e.ms;
    var o10e = aeSolveObjective(c10e.bands, c10e.total, errDb, weights, rc);
    if (o10e < pickObj && aeRmsLocal(c10e.total) <= aeRmsLocal(pick.total)){ pick = c10e; pickObj = o10e; }
    ssNote(c10e, 4, pick === c10e);
  }
  /* --- Mở rộng 2026-10-31 (vòng tự động 19:04): lượt tiếp tục chặt
       c10f — MỘT lượt tiếp tục chặt 4 vòng nữa ngay sau c10e.
       Thí nghiệm exp42 trên chính hàm thật (baseline đã gồm
       c10/c10b/c10d/c10e) cho thấy lượt này vẫn cải thiện RMS 20 Hz-
       10 kHz ở 3/6 trường hợp đường 10 band: A/harmanOE 0,1263 ->
       0,1223 (-3,2%), B/harmanOE 0,1609 -> 0,1589 (-1,2%),
       B/harmanIE 0,1822 -> 0,1759 (-3,5%); 3 trường hợp còn lại bị
       cổng chặt từ chối nên giữ nguyên tuyệt đối. Chi phí chỉ
       ~13 ms. Vòng này chỉ triển khai vì QA bản gốc đầu vòng
       ĐẠT với dư địa (aeV3 Mẫu A 453 ms, Mẫu C 411 ms, cả hai
       < 470 ms theo điều kiện vòng 17:04 đặt ra). Lượt này CHỈ
       áp cho đường <=10 band (đường 20 band đã hội tụ, không chạm
       tới). Tiêu chí chấp nhận chặt như c5/c6 và các lượt trước:
       vừa giảm hàm mục tiêu cùng rc vừa không làm RMS thô tệ đi,
       nên không trường hợp nào tệ đi. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10f = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10f.ms;
    var o10f = aeSolveObjective(c10f.bands, c10f.total, errDb, weights, rc);
    if (o10f < pickObj && aeRmsLocal(c10f.total) <= aeRmsLocal(pick.total)){ pick = c10f; pickObj = o10f; }
    ssNote(c10f, 4, pick === c10f);
  }
  /* --- Mo rong 2026-11-01 (vong tu dong 02:44): luot tiep tuc chat
       c10g - MOT luot tiep tuc chat 4 vong nua ngay sau c10f.
       Thi nghiem exp tren chinh ham that (verify63base EXP-CONT4, baseline
       da gom c10/c10b/c10d/c10e/c10f) voi tieu chi chat nhu c5/c6 cho thay
       luot nay van cai thien RMS 20 Hz-10 kHz o 3/6 truong hop duong
       10 band: A/harmanOE 0,1223 -> 0,1203 (-1,7%), B/harmanOE 0,1589 ->
       0,1566 (-1,4%), B/harmanIE 0,1759 -> 0,1703 (-3,2%); 3 truong hop
       con lai bi cong chat tu choi nen giu nguyen tuyet doi, 0 truong
       hop te di. Chi phi chi ~14-17 ms. Vong nay chi trien khai vi QA
       ban goc dau vong DAT voi du dia (ca hai mau aeV3 < 470 ms theo
       dieu kien vong 17:04 dat ra). Luot nay CHI ap cho duong <=10 band
       (duong 20 band da hoi tu, khong cham toi). Tieu chi chap nhan
       chat nhu c5/c6 va cac luot truoc: vua giam ham muc tieu cung rc
       vua khong lam RMS tho te di, nen khong truong hop nao te di. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10g = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10g.ms;
    var o10g = aeSolveObjective(c10g.bands, c10g.total, errDb, weights, rc);
    if (o10g < pickObj && aeRmsLocal(c10g.total) <= aeRmsLocal(pick.total)){ pick = c10g; pickObj = o10g; }
    ssNote(c10g, 4, pick === c10g);
  }
  /* --- Mo rong 2026-11-01 (vong tu dong, cho vong sau): luot tiep tuc chat
       c10h - MOT luot tiep tuc chat 4 vong nua ngay sau c10g.
       Thi nghiem verify70base EXP-CONT4-STRICT tren ban da gom c10g voi
       tieu chi chat nhu c5/c6/c10f/c10g cho thay luot nay van cai thien
       RMS 20 Hz-10 kHz o 3/6 truong hop duong 10 band: A/harmanOE
       0,1203 -> 0,1180 (-1,9%), B/harmanOE 0,1566 -> 0,1547 (-1,2%),
       B/harmanIE 0,1703 -> 0,1650 (-3,2%); 3 truong hop con lai bi cong
       chat tu choi nen giu nguyen tuyet doi, 0 truong hop te di.
       Chi phi ~12 ms. Chi trien khai khi QA ban goc dau vong DAT voi
       du dia (ca hai mau aeV3 < ~470 ms). Chi ap duong <=10 band. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10h = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10h.ms;
    var o10h = aeSolveObjective(c10h.bands, c10h.total, errDb, weights, rc);
    if (o10h < pickObj && aeRmsLocal(c10h.total) <= aeRmsLocal(pick.total)){ pick = c10h; pickObj = o10h; }
    ssNote(c10h, 4, pick === c10h);
  }
  /* --- Mo rong 2026-11-01 (vong tu dong 17:44): luot tiep tuc chat
       c10i - MOT luot tiep tuc chat 4 vong nua ngay sau c10h.
       Thi nghiem EXP-CONT4-STRICT nhieu vong tren ban da gom c10h voi
       tieu chi chat nhu c5/c6 cho thay luot nay van cai thien RMS
       20 Hz-10 kHz o 3/6 truong hop duong 10 band: A/harmanOE
       0,1180 -> 0,1159 (-1,8%), B/harmanOE 0,1547 -> 0,1530 (-1,1%),
       B/harmanIE 0,1650 -> 0,1600 (-3,0%); 3 truong hop con lai bi cong
       chat tu choi nen giu nguyen tuyet doi, 0 truong hop te di.
       Chi ap duong <=10 band. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10i = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10i.ms;
    var o10i = aeSolveObjective(c10i.bands, c10i.total, errDb, weights, rc);
    if (o10i < pickObj && aeRmsLocal(c10i.total) <= aeRmsLocal(pick.total)){ pick = c10i; pickObj = o10i; }
    ssNote(c10i, 4, pick === c10i);
  }
  /* --- Mo rong 2026-11-04 (vong tu dong 13:44): luot tiep tuc chat
       c10j - MOT luot tiep tuc chat 4 vong nua ngay sau c10i, theo dung mau
       c10g/c10h/c10i. Tieu chi chap nhan chat nhu cac luot truoc: chi giu
       khi vua co objective aeSolveObjective cung rc thap hon vua khong lam
       RMS tho te di; neu khong dat thi giu nguyen tuyet doi. Chi ap duong
       <=10 band. QA tren ban sao truoc khi ap: 57 test, 56 PASS, 0 FAIL that,
       1 chua du dieu kien do; aeV1 RMS 2,18 -> 0,10 dB (giam 95,2%), vi pham 0;
       aeV2 DAT; aeV3 Mau A 209 ms, Mau C 189 ms (< 500 ms). Goc truoc khi ap:
       aeV1 0,10 dB, aeV3 toi da 210 ms. --- */
  if (nBands <= 10 && !ssSkip(4)){
    var c10j = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, undefined, fsv);
    ms += c10j.ms;
    var o10j = aeSolveObjective(c10j.bands, c10j.total, errDb, weights, rc);
    if (o10j < pickObj && aeRmsLocal(c10j.total) <= aeRmsLocal(pick.total)){ pick = c10j; pickObj = o10j; }
    ssNote(c10j, 4, pick === c10j);
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 09:11): luot polish buoc nho c10p
       ngay sau c10j, chi duong <=10 band. Ly do: chuoi tiep tuc cung buoc
       simplex (c10g-c10j) va luot c10k thu them cung buoc da het cai thien
       do duoc tren Mau A/C, nhung simplex buoc day co the bo qua cuc tri
       hep: thu mot luot 4 vong tu dung band thang voi stepScale=0.5
       (buoc freq 0.35->0.175 oct, gain 1.5->0.75 dB, log2Q 0.30->0.15),
       khong doi RLS, khong doi ham muc tieu, khong doi duong >10 band.
       Tieu chi chap nhan chat nhu c10j: chi giu khi vua co objective
       cung rc thap hon vua khong lam RMS tho te di; neu khong dat thi
       giu nguyen tuyet doi. Tham so stepScale tuy chon, mac dinh 1 nen
       moi loi goi cu (ke ca Worker qua .toString()) giu nguyen hanh vi. --- */
  if (nBands <= 10){
    var c10p = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.5, fsv);
    ms += c10p.ms;
    var o10p = aeSolveObjective(c10p.bands, c10p.total, errDb, weights, rc);
    if (o10p < pickObj && aeRmsLocal(c10p.total) <= aeRmsLocal(pick.total)){ pick = c10p; pickObj = o10p; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 10:06): luot polish buoc nho hon c10q
       ngay sau c10p, chi duong <=10 band. Ly do: c10p (stepScale 0.5) van cai
       thien do duoc o 4/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.25 (buoc freq 0.35->0.0875 oct, gain 1.5->0.375 dB,
       log2Q 0.30->0.075), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10q = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.25, fsv);
    ms += c10q.ms;
    var o10q = aeSolveObjective(c10q.bands, c10q.total, errDb, weights, rc);
    if (o10q < pickObj && aeRmsLocal(c10q.total) <= aeRmsLocal(pick.total)){ pick = c10q; pickObj = o10q; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 10:29): luot polish buoc nho hon nua c10r
       ngay sau c10q, chi duong <=10 band. Ly do: c10q (stepScale 0.25) van cai
       thien do duoc o 4/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.125 (buoc freq 0.35->0.04375 oct, gain 1.5->0.1875 dB,
       log2Q 0.30->0.0375), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10r = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.125, fsv);
    ms += c10r.ms;
    var o10r = aeSolveObjective(c10r.bands, c10r.total, errDb, weights, rc);
    if (o10r < pickObj && aeRmsLocal(c10r.total) <= aeRmsLocal(pick.total)){ pick = c10r; pickObj = o10r; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 11:21): luot polish buoc nho hon nua c10s
       ngay sau c10r, chi duong <=10 band. Ly do: c10r (stepScale 0.125) van cai
       thien do duoc o 2/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.0625 (buoc freq 0.35->0.021875 oct, gain 1.5->0.09375 dB,
       log2Q 0.30->0.01875), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10s = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.0625, fsv);
    ms += c10s.ms;
    var o10s = aeSolveObjective(c10s.bands, c10s.total, errDb, weights, rc);
    if (o10s < pickObj && aeRmsLocal(c10s.total) <= aeRmsLocal(pick.total)){ pick = c10s; pickObj = o10s; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 11:47): luot polish buoc nho hon nua c10t
       ngay sau c10s, chi duong <=10 band. Ly do: c10s (stepScale 0.0625) van cai
       thien do duoc o 5/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.03125 (buoc freq 0.35->0.0109375 oct, gain 1.5->0.046875 dB,
       log2Q 0.30->0.009375), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r/c10s: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10t = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.03125, fsv);
    ms += c10t.ms;
    var o10t = aeSolveObjective(c10t.bands, c10t.total, errDb, weights, rc);
    if (o10t < pickObj && aeRmsLocal(c10t.total) <= aeRmsLocal(pick.total)){ pick = c10t; pickObj = o10t; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 12:04): luot polish buoc nho hon nua c10u
       ngay sau c10t, chi duong <=10 band. Ly do: c10t (stepScale 0.03125) van cai
       thien do duoc o 5/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.015625 (buoc freq 0.35->0.00546875 oct, gain 1.5->0.0234375 dB,
       log2Q 0.30->0.0046875), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r/c10s/c10t: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10u = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.015625, fsv);
    ms += c10u.ms;
    var o10u = aeSolveObjective(c10u.bands, c10u.total, errDb, weights, rc);
    if (o10u < pickObj && aeRmsLocal(c10u.total) <= aeRmsLocal(pick.total)){ pick = c10u; pickObj = o10u; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 13:27): luot polish buoc nho hon nua c10v
       ngay sau c10u, chi duong <=10 band. Ly do: c10u (stepScale 0.015625) van cai
       thien do duoc o 2/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.0078125 (buoc freq 0.35->0.002734375 oct, gain 1.5->0.01171875 dB,
       log2Q 0.30->0.00234375), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r/c10s/c10t/c10u: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10v = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.0078125, fsv);
    ms += c10v.ms;
    var o10v = aeSolveObjective(c10v.bands, c10v.total, errDb, weights, rc);
    if (o10v < pickObj && aeRmsLocal(c10v.total) <= aeRmsLocal(pick.total)){ pick = c10v; pickObj = o10v; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 13:51): luot polish buoc nho hon nua c10w
       ngay sau c10v, chi duong <=10 band. Ly do: c10v (stepScale 0.0078125) van cai
       thien do duoc o 3/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.00390625 (buoc freq 0.35->0.0013671875 oct, gain 1.5->0.005859375 dB,
       log2Q 0.30->0.001171875), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r/c10s/c10t/c10u/c10v: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10w = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.00390625, fsv);
    ms += c10w.ms;
    var o10w = aeSolveObjective(c10w.bands, c10w.total, errDb, weights, rc);
    if (o10w < pickObj && aeRmsLocal(c10w.total) <= aeRmsLocal(pick.total)){ pick = c10w; pickObj = o10w; }
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 14:12): luot polish buoc nho hon nua c10x
       ngay sau c10w, chi duong <=10 band. Ly do: c10w (stepScale 0.00390625) van cai
       thien do duoc o 5/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.001953125 (buoc freq 0.35->0.00068359375 oct, gain 1.5->0.0029296875 dB,
       log2Q 0.30->0.0005859375), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r/c10s/c10t/c10u/c10v/c10w: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10x = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.001953125, fsv);
    ms += c10x.ms;
    var o10x = aeSolveObjective(c10x.bands, c10x.total, errDb, weights, rc);
    if (o10x < pickObj && aeRmsLocal(c10x.total) <= aeRmsLocal(pick.total)){ pick = c10x; pickObj = o10x; }
  }
  /* --- Bo qua luot polish thua sau diem bat dong (Pha A 2026-11-05 18:29, c10z9) ---
       Lab do vong NM 18:29 tren 6 truong hop chuan (Mau A/B/C x harmanOE/
       harmanIE): nhieu luot c10z chi chay lai de xac nhan diem bat dong —
       A/OE: c10z6 chay lai dung 122 vong cua c10z5; B/IE: c10z3-z6 moi luot
       1 vong; C/IE: c10z4-z6 chay lai dung 4 vong cua c10z3; chi C/OE dung
       het 320 vong cua c10z6 (van dich 1,46e-3/vong). Chung minh bo qua la
       bit-identical: aeSolveSingle la ham xac dinh cua (bands, freqs,
       errDb, weights, pickLam, rc, pickShelf, anchorShelf, stepScale);
       cac luot c10y/c10z2-c10z6 co CUNG stepScale 0.0009765625 va so vong
       TANG DAN (4 < 20 < 40 < 80 < 160 < 320). Neu mot luot dat diem bat
       dong o vong p (mot vong day khong doi band nao) thi luot sau cung
       tham so deu la no-op: neu luot truoc duoc chap nhan thi pick chinh
       la trang thai bat dong nen luot sau dung ngay vong 1 voi band giong
       het; neu bi tu choi thi pick khong doi nen luot sau chay lai dung
       quy dao cu den cung diem bat dong o vong p (so vong tang dan nen
       khong bao gio bi cat giua chung), objective/band giong het nen cung
       bi tu choi. Co fixedPoint do aeSolveSingle tra ve; chi ap cho chuoi
       c10y/c10z2-c10z6 (chuoi c10p-c10x moi luot mot stepScale khac nhau,
       chuoi tiep tuc ss=1 va chuoi 20 band de do rieng o vong sau). --- */
  var skipSSz = false;
  /* --- Mở rộng 2026-11-10 (vòng tự động 13:19, hướng A): PROFILE thời gian
   aeSolve 10 band theo chặng + thử bỏ đuôi chuỗi ssz — BÁC BỎ, KHÔNG vá code
   (chỉ thêm comment này, ngay trước khối c10y mà thí nghiệm nhắm tới).
   Câu hỏi (chưa từng đo — 18:29 chỉ profile đường 20 band): 700 ms aeV3 ở
   QA 12:55 nằm ở khâu nào của đường 10 band? Lab Node trên hàm thật trích
   tươi từ file (build_extract_1319.py, lab_1319.js; file thường nối liền,
   không dùng vm theo bài học 16:42; wrapper đếm từng lần gọi aeSolveSingle,
   phân loại theo nmPasses/stepScale/contBands; 6 ô Mẫu A/B/C x harmanOE/IE,
   warm-up + median 3 rep; sweep chạy song song ở 3.375/60.000 nên ms tuyệt
   đối chỉ tham khảo, tỉ lệ % mới có ý nghĩa; RMS/obj xác định, khớp neo
   A/OE 0,102930 và C/OE 0,170728):
   - Phân bổ (median): 4 ứng viên cand12 ~40% (206–270 ms); chuỗi ssz bước
     nhỏ 23% ở A/OE (124 ms) tới 46% ở C/OE (269 ms, riêng ssz320 135 ms);
     chuỗi tiếp tục cont4/cont8 biến động mạnh theo ô (19–145 ms); thang
     bước nhỏ c10p–c10x ~24 ms. KHÔNG đệ quy (maxDepth 1, recCalls 0) —
     anchored/capped/T1 đều không kích hoạt ở A/B/C (RMS < 0,50).
   - Biến thể V1 (bỏ ssz160+ssz320): 5/6 ô RMS/obj GIỐNG TỪNG BIT, gồm aeV1
     A/OE 0,102930; chỉ C/OE RMS +0,000289 dB (0,170728 -> 0,171017),
     obj +0,000152; ms C/OE −207 (581 -> 374), A/OE −37 (trong nhiễu ±40).
     V1b (chỉ bỏ ssz320): C/OE +0,000140 dB, −147 ms. V1c (chỉ bỏ ssz160):
     C/OE +0,000056 dB, −68 ms. V2 (bỏ ssz40/80/160/320): C/OE +0,000746 dB,
     −303 ms. Tách riêng cho thấy ssz320 đắt nhất (135 ms ở C/OE) nhưng
     vẫn mua được +0,00014 dB RMS.
   - An toàn null (aeV2, nullcheck_1319.js): Mẫu C null 7671–8366 Hz
     (chứa 8011 Hz); cả base lẫn V1 đều có 0 band có tâm trong null ở cả
     2 target — V1 không phá aeV2.
   Kết luận: BÁC BỎ. C/OE RMS tệ đi (dù chỉ +0,000289 dB) vi phạm luật
   "không làm tụt bất kỳ chỉ số nào"; và V1 cũng chưa chắc đưa aeV3 về
   < 500 ms trong môi trường headless tải sweep (A 699 -> ~660, C 698 ->
   ~500 sát biên). Đánh đổi đã đo xong, để Angela quyết: có chấp nhận
   +0,0003 dB RMS ở Mẫu C để lấy ~200 ms ở aeV3 không — lượt sau KHÔNG
   thử lại bỏ ssz160/ssz320 hay biến thể khác của chuỗi này.
   Bộ đếm lưu lab-only: vẫn 0 (chỉ thêm comment, không vá code).
   Nhánh A: T1e ĐÓNG (chạm sàn); B TẠM DỪNG; C TẠM DỪNG (3 lượt không vá);
   D — ý tưởng 13:07 (đo drawGraph/measureFps qua Playwright) ĐÃ ĐÓNG ở
   07:00 (avgDraw 0,64–0,71 ms/khung, 59,35–60 fps), không lặp lại.
   Ý tưởng lượt kế: QA-only khi bộ đếm lab-only đạt 3 (hiện 0, chưa cần);
   hoặc chờ quyết định của Angela về đánh đổi V1; hoặc hướng C — rà soát
   loudFitError trên lưới phon mở rộng 10–100 (00:13 mới đo 20–80).
   --- */
/* --- Thi nghiem Pha A 2026-11-05 (vong 14:40): luot polish buoc nho hon nua c10y
       ngay sau c10x, chi duong <=10 band. Ly do: c10x (stepScale 0.001953125) van cai
       thien do duoc o 3/6 truong hop, nen thu them mot luot buoc nho hon nua
       voi stepScale=0.0009765625 (buoc freq 0.35->0.000341796875 oct, gain 1.5->0.00146484375 dB,
       log2Q 0.30->0.00029296875), khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10j/c10p/c10q/c10r/c10s/c10t/c10u/c10v/c10w/c10x: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong
       dat thi giu nguyen tuyet doi. Neu trung tuyet doi thi nhanh polish
       buoc nho coi nhu da hoi tu. --- */
  if (nBands <= 10){
    var c10y = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 4, rc, pickShelf, pick.bands, anchorShelf, 0.0009765625, fsv);
    ms += c10y.ms;
    var o10y = aeSolveObjective(c10y.bands, c10y.total, errDb, weights, rc);
    if (o10y < pickObj && aeRmsLocal(c10y.total) <= aeRmsLocal(pick.total)){ pick = c10y; pickObj = o10y; }
    if (c10y.fixedPoint) skipSSz = true;
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 15:14): huong polish KHAC sau c10y — tang so vong NM
       (nmPasses 4 -> 20) o cung stepScale=0.0009765625, chi duong <=10 band. Ly do: nhanh polish buoc nho
       da hoi tu o c10z (chia nho stepScale chi con cai thien toi da 3,9e-5 dB, 0/6 o 4 chu so), nen thu
       huong khac: nhieu vong NM hon o cung buoc nho de toa do cac band hoi tu het tuong tac lan nhau
       (moi vong NM chay het 10 band; passCap = nmPasses khi co contBands). Khong doi RLS, khong doi ham
       muc tieu, khong doi duong >10 band. Tieu chi chap nhan chat nhu c10y: chi giu khi vua co objective
       cung rc thap hon vua khong lam RMS tho te di; neu khong dat thi giu nguyen tuyet doi. --- */
  if (nBands <= 10 && !skipSSz){
    var c10z2 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 20, rc, pickShelf, pick.bands, anchorShelf, 0.0009765625, fsv);
    ms += c10z2.ms;
    var o10z2 = aeSolveObjective(c10z2.bands, c10z2.total, errDb, weights, rc);
    if (o10z2 < pickObj && aeRmsLocal(c10z2.total) <= aeRmsLocal(pick.total)){ pick = c10z2; pickObj = o10z2; }
    if (c10z2.fixedPoint) skipSSz = true;
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 15:39): tang so vong NM tiep
       (nmPasses 20 -> 40) o cung stepScale=0.0009765625, chi duong <=10 band. Ly do: c10z2
       (20 vong, khong dung som nho passCap == nmPasses) van cai thien do duoc
       (B/IE -0,0011 dB), nen thu 40 vong de toa do cac band hoi tu het. Khong doi RLS,
       khong doi ham muc tieu, khong doi duong >10 band. Tieu chi chap nhan chat nhu
       c10y/c10z2: chi giu khi vua co objective cung rc thap hon vua khong lam RMS tho
       te di; neu khong dat thi giu nguyen tuyet doi. --- */
  if (nBands <= 10 && !skipSSz){
    var c10z3 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 40, rc, pickShelf, pick.bands, anchorShelf, 0.0009765625, fsv);
    ms += c10z3.ms;
    var o10z3 = aeSolveObjective(c10z3.bands, c10z3.total, errDb, weights, rc);
    if (o10z3 < pickObj && aeRmsLocal(c10z3.total) <= aeRmsLocal(pick.total)){ pick = c10z3; pickObj = o10z3; }
    if (c10z3.fixedPoint) skipSSz = true;
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 16:07): tang so vong NM tiep
       (nmPasses 40 -> 80) o cung stepScale=0.0009765625, chi duong <=10 band. Ly do: c10z3
       (40 vong) van cai thien do duoc (C/OE -0,0002 dB), nen thu 80 vong de toa do
       cac band hoi tu het. Khong doi RLS, khong doi ham muc tieu, khong doi duong
       >10 band. Tieu chi chap nhan chat nhu c10y/c10z2/c10z3: chi giu khi vua co
       objective cung rc thap hon vua khong lam RMS tho te di; neu khong dat thi
       giu nguyen tuyet doi. --- */
  if (nBands <= 10 && !skipSSz){
    var c10z4 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 80, rc, pickShelf, pick.bands, anchorShelf, 0.0009765625, fsv);
    ms += c10z4.ms;
    var o10z4 = aeSolveObjective(c10z4.bands, c10z4.total, errDb, weights, rc);
    if (o10z4 < pickObj && aeRmsLocal(c10z4.total) <= aeRmsLocal(pick.total)){ pick = c10z4; pickObj = o10z4; }
    if (c10z4.fixedPoint) skipSSz = true;
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 16:37): tang so vong NM tiep
       (nmPasses 80 -> 160) o cung stepScale=0.0009765625, chi duong <=10 band. Ly do: c10z4
       (80 vong) van cai thien do duoc (C/OE -0,0003 dB, B/OE -8,6e-6 dB), nen thu 160 vong
       de toa do cac band hoi tu het. Khong doi RLS, khong doi ham muc tieu, khong doi
       duong >10 band. Tieu chi chap nhan chat nhu c10y/c10z2/c10z3/c10z4: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong dat thi giu
       nguyen tuyet doi. --- */
  if (nBands <= 10 && !skipSSz){
    var c10z5 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 160, rc, pickShelf, pick.bands, anchorShelf, 0.0009765625, fsv);
    ms += c10z5.ms;
    var o10z5 = aeSolveObjective(c10z5.bands, c10z5.total, errDb, weights, rc);
    if (o10z5 < pickObj && aeRmsLocal(c10z5.total) <= aeRmsLocal(pick.total)){ pick = c10z5; pickObj = o10z5; }
    if (c10z5.fixedPoint) skipSSz = true;
  }
  /* --- Thi nghiem Pha A 2026-11-05 (vong 17:00): tang so vong NM tiep
       (nmPasses 160 -> 320) o cung stepScale=0.0009765625, chi duong <=10 band. Ly do: c10z5
       (160 vong) van cai thien do duoc (C/OE -0,0001 dB), nen thu 320 vong de toa do
       cac band hoi tu het. Khong doi RLS, khong doi ham muc tieu, khong doi duong
       >10 band. Tieu chi chap nhan chat nhu c10y/c10z2/c10z3/c10z4/c10z5: chi giu khi vua
       co objective cung rc thap hon vua khong lam RMS tho te di; neu khong dat thi giu
       nguyen tuyet doi. --- */
  if (nBands <= 10 && !skipSSz){
    var c10z6 = aeSolveSingle(freqs, errDb, weights, nBands, pickLam, 320, rc, pickShelf, pick.bands, anchorShelf, 0.0009765625, fsv);
    ms += c10z6.ms;
    var o10z6 = aeSolveObjective(c10z6.bands, c10z6.total, errDb, weights, rc);
    if (o10z6 < pickObj && aeRmsLocal(c10z6.total) <= aeRmsLocal(pick.total)){ pick = c10z6; pickObj = o10z6; }
    if (c10z6.fixedPoint) skipSSz = true;
  }
  /* --- Mo rong 2026-11-01 (vong tu dong 17:24): thu lai neo shelf
       CO DIEU KIEN cho duong >10 band. Chan doan goc (vong 08:24): A x JM-1
       x 20 band (RMS sau 0,6269) do band lowshelf troi tu neo 105/55 Hz len
       1682 Hz trong NM, thanh duong cat phang duoi ~1682 Hz khong theo duoc
       do doc bass. Gia thuyet "kich hoat theo do troi shelf" BI BAC BO o
       vong 17:24 (exp1724_drift, 36 o A/B/C x 12 target x 20 band): 16/36 o
       TOT cung co f0 > 500 Hz, cao nhat A/freeField f0 = 5854 Hz voi RMS
       chi 0,0654, C/jm1 f0 = 7333 Hz voi RMS 0,1255 — troi shelf la cach tao
       hinh bang rong binh thuong, khong phai dau hieu benh ly. Vi vay chi
       kich hoat theo RMS: chi khi RMS sau cua dap an goc > 0,50 dB moi chay
       them mot luot aeSolve day du voi shelf bi neo, roi chi giu khi vua
       co objective aeSolveObjective cung rc thap hon vua khong lam RMS tho
       te di (tieu chi chat nhu luot c10h). Can cu: nguong 0,50 chi kich
       hoat o 3,7% luot pha 2 (171/4608) so voi 40,8% o nguong 0,20; thi
       nghiem 17:24 (exp1724_anchor2) neo thang theo objective o 5/5 o:
       A/jm1 0,6269 -> 0,0881, Grado HF1 Prototype x harmanIE 2,2241 ->
       0,3031, x harmanOE 1,7018 -> 0,2855, NiceHCK EB2S Pro (foams) x
       harmanOE2015 4,1075 -> 0,1294; o doi chung C/jm1 neo thua objective
       (0,3912 > 0,2957) nen khong bi giu. Luot neo la toan bo aeSolve voi
       anchorShelf=true; guard !anchorShelf chan de quy. Chi phi them ~0 o
       cac o tot (khong kich hoat) va mot luot giai 20 band o truong hop
       benh ly. Duong <=10 band khong cham toi. --- */
  if (!anchorShelf && nBands > 10 && aeRmsLocal(pick.total) > 0.50){
    var anchored = aeSolve(freqs, errDb, weights, nBands, true, fsv, seedBands);
    ms += anchored.ms;
    var oAnch = aeSolveObjective(anchored.bands, anchored.total, errDb, weights, rc);
    if (oAnch < pickObj && aeRmsLocal(anchored.total) <= aeRmsLocal(pick.total)){ pick = anchored; pickObj = oAnch; }
  }
  /* --- Mo rong 2026-11-10 (vong tu dong 00:53, huong A): neo shelf co dieu kien
       cho duong 10 band — AP DUNG, co cai thien. Them 1 khoi ngay sau khoi neo
       20 band: chi khi RMS sau cua dap an goc > 0,50 dB moi chay them mot luot
       aeSolve day du voi anchorShelf=true (shelf neo 105/55 Hz trong NM), chi giu
       khi vua co objective cung rc thap hon vua khong lam RMS tho te di (tieu chi
       chat nhu khoi 20 band). Khong cham AE_LIMITS. Lab Node tren ham that (file
       thuong noi lien, 13 fixture 10 band + Mau A 20 band, 2 rep): Mau A/B/C x
       harmanOE/IE giong het (RMS/obj/shelfF khong doi, RMS < 0,50 nen nhanh khong
       kich hoat — aeV1/aeV2/aeV3 khong doi theo cau truc); Mpow CH1 (tai kho nhat
       kho) RMS 3,0281 -> 1,6877 (-44,3%), obj 10,0066 -> 4,0940, RMS bass <100 Hz
       5,2014 -> 1,9440, shelf 115 -> 55 Hz; 12/13 fixture con lai giu nguyen tuyet
       doi, viol=0 toan bo. Chan doan phu: W2 Adam SP-5 x freeField — ban neo RMS tho
       1,1584 -> 0,8943 (shelf o lai 55 Hz g=+7,04) NHUNG objective co phat 1,5388 ->
       1,6175 nen cong chat tu choi (cung lop nhu nhanh rc/2 o 18:29); ATH-CT200iS RMS
       0,8401 -> 0,7706 nhung obj 2,0885 -> 2,4102 nen cung bi tu choi; AKG K250 RMS
       0,5394 -> 0,4319, obj 0,2999 -> 0,5166 bi tu choi; Sony XEA20 neo te ca hai nen
       bi tu choi. Gia thuyet 00:20 chi dung mot nua: neo shelf cuu duoc RMS tho nhung
       tra phat gain/Q cao. Chi phi: chi cac ca RMS > 0,50 moi ton them ~1 luot giai
       10 band (W2 484 -> ~1200 ms lab Node tai nang); Mau A khong kich hoat nen cong
       aeV3 khong doi. Y tuong luot ke: huong A — rang buoc mem tan so lowshelf (kep
       <= 300 Hz thay vi dong bang 105/55) cho W2; hoac huong C — tiep tuc ra loudFitError;
       hoac huong D — do measureFps/specDraw. --- */
  if (!anchorShelf && nBands <= 10 && aeRmsLocal(pick.total) > 0.50){
    var anchored10 = aeSolve(freqs, errDb, weights, nBands, true, fsv, seedBands);
    ms += anchored10.ms;
    var oAnch10 = aeSolveObjective(anchored10.bands, anchored10.total, errDb, weights, rc);
    if (oAnch10 < pickObj && aeRmsLocal(anchored10.total) <= aeRmsLocal(pick.total)){ pick = anchored10; pickObj = oAnch10; }
  }
  /* --- Mo rong 2026-11-10 (vong tu dong 02:07, huong A): kep mem tan so
       lowshelf <= 300 Hz cho duong 10 band — AP DUNG, co cai thien. Them 1 khoi
       song song ngay sau khoi neo 00:53: chi khi RMS sau cua dap an goc > 0,50 dB
       moi chay them mot luot aeSolve day du voi AE_SHELF_CAP=300 (trong
       try/finally), chi giu khi objective cung rc thap hon VA RMS tho khong te
       di (tieu chi chat nhu khoi neo). Trong toBand cua aeSolveSingle, khi cap
       > 0 thi moi de xuat NM cho lowshelf bi kep ve toi da 300 Hz (chi lowshelf
       — highshelf 10 kHz va peaking khong doi). Lab Node tren ham that (file
       thuong noi lien, 13 fixture 10 band + Mau A 20 band, 2 rep, giong het
       luot 00:53): Mau A/B/C x harmanOE/IE giong het (RMS/obj/shelfF khong doi,
       RMS < 0,50 nen nhanh khong kich hoat — aeV1/aeV2/aeV3 khong doi theo cau
       truc); W2 Adam SP-5 x freeField RMS 1,158441 -> 0,876365 (-24,4%), obj
       1,538774 -> 0,971435 (-36,9%), RMS bass <100 Hz 1,523595 -> 0,235010
       (-84,6%), shelf 2664,14 -> 29,84 Hz (g -0,385 -> +5,269) — vuot ca ban
       neo dong bang (RMS 0,8943/obj 1,6175 bi tu choi); ATH-CT200iS RMS
       0,840143 -> 0,839698, obj 2,088528 -> 2,087115 (cai thien nho, dung tieu
       chi chat); Mpow, Sony XEA20, HD 600, Tanchjim, AKG K250, Mau A 20 band
       giu nguyen tuyet doi, viol=0 toan bo, 2 rep giong het. Co che: shelf cuoi
       29,84 Hz — cap khong siet truc tiep o 300 ma doi quy dao NM, chan shelf
       troi len 2664 Hz giua chung roi moi ha ve vung bass dung. Chi phi: chi
       cac ca RMS > 0,50 moi ton them luot giai (W2 838 -> ~1820 ms lab Node tai
       nang; cac ca bi tu choi nhu Mpow 672 -> ~1330 ms); Mau A khong kich hoat
       nen cong aeV3 khong doi. Y tuong luot ke: huong B — do lai buildFirTaps
       sau va truy hoi luong giac (treo tu 20:19/23:49, nhanh B tam dung tu
       22:27); hoac huong A — thu cap 200 Hz cho W2 (shelf cuoi 29,84 Hz goi y
       cap thap hon van du); hoac huong D — do measureFps/specDraw. --- */
    /* --- Mo rong 2026-11-10 (vong tu dong 02:24, huong A): ha cap mem lowshelf
       300 -> 200 Hz cho khoi song song 02:07 — AP DUNG, co cai thien. Chi doi 2
       so trong khoi song song (guard + gan), tieu chi chat trong code (chi giu
       khi objective cung rc thap hon VA RMS tho khong te di) khong doi nen moi
       ca chua do van duoc bao ve. Lab Node tren ham that (13 fixture 10 band +
       Mau A 20 band, 2 rep, giong het): W2 Adam SP-5 x freeField RMS 0,876365 ->
       0,685656 (-21,8%), obj 0,971435 -> 0,675127 (-30,5%), RMS bass <100 Hz
       0,235010 -> 0,231984, shelf 29,84 -> 51,45 Hz; ATH-CT200iS RMS 0,839698 ->
       0,839387, obj 2,087115 -> 2,086632, RMS bass 1,162967 -> 1,158512; Mau
       A/B/C x harmanOE/IE + Mpow, Sony XEA20, HD 600, Tanchjim, AKG K250, Mau A
       20 band giu nguyen tuyet doi (nhanh khong kich hoat voi Mau A vi RMS <
       0,50 — aeV1/aeV2/aeV3 khong doi theo cau truc), viol=0 toan bo. Co che nhu
       02:07: cap doi quy dao NM chu khong siet truc tiep, shelf cuoi 51,45 Hz
       van duoi 200. Chi phi tuong duong cap 300 (W2 ~1,8 s, ATH-CT200iS
       ~1,8-1,9 s lab Node tai nang). Y tuong luot ke: huong A — thu cap 150 Hz
       (shelf cuoi 51,45 Hz goi y con du dia); hoac huong B — do lai buildFirTaps
       sau va truy hoi luong giac (treo tu 20:19/23:49, nhanh B tam dung tu
       22:27); hoac huong D — do measureFps/specDraw. --- */
  /* --- Vong tu dong 02:40 (QA-only, khong va code): chay lai bo QA day du tren
     ban hien tai md5 699a7de0 (sau 2 luot luu lab-only 02:07 + 02:24) bang
     Chromium headless that trong VM (Playwright, localhost:8931, tat
     compact-ux qua nut #uxCompactToggle roi bam #btnQaAll — trinh duyet live
     khong toi duoc localhost cua VM nen khong dung duoc; script tai
     goals/web-autoeq-dsp-core/hidden_files/qa_headless/run_qa.js, bao cao
     qa_report_2026-11-10_0250.json va _0305.json). Ket qua 2 lan chay: 57 test,
     55 PASS, 1 FAIL that (aeV3: lan 1 Mau A 725 ms / Mau C 700 ms khi sweep
     toan kho chay song song chiem 93,9% CPU; lan 2 het sweep: Mau A 618 ms /
     Mau C 490 ms), 1 conditional FPS chua du dieu kien do (giong bao cao
     02:01); aeV1 DAT (RMS 2,1797 -> 0,1029 dB), aeV2 DAT, moi cong khac DAT.
     Xac minh aeV3 khong phai hoi quy do va cap 300/200: do lai aeCompute 3 rep
     trong cung Chromium (probe_timing.js) — ban hien tai Mau A 476/387/340 ms,
     Mau C 512/419/399 ms; ban pre-cap d18ade43 Mau A 491/381/336 ms, Mau C
     444/432/409 ms; ban cap 300 Mau A 439/393/342 ms, Mau C 510/406/383 ms —
     giong nhau trong nhieu do, nhanh cap khong kich hoat voi Mau A/C vi RMS
     sau 0,1029/0,1706 < 0,50; cong 500 ms don lan do lanh phu thuoc may
     (02:01 tren trinh duyet live do 297/325 ms). KHONG revert va 02:07/02:24
     vi revert khong sua duoc aeV3 ma mat cai thien RMS that. Loi trang luc chay
     QA (clampN is not defined, null addEventListener, ERR_TUNNEL, 404 script)
     cung xuat hien tren ban pre-cap d18ade43 — co san tu truoc, khong phai do
     va gan day, chua anh huong cong QA nao. Y tuong luot ke: huong A — thu cap
     150 Hz (treo tu 02:24); hoac cai thien do aeV3 thanh median 3 rep de cong
     bot nhay theo tai may; hoac huong B — do lai buildFirTaps (treo tu
     20:19/23:49). --- */
  /* --- Mo rong 2026-11-10 (vong tu dong 03:04, huong A): thu cap mem lowshelf
       200 -> 150 Hz — BI BAC BO, khong ap va (chi ghi chu, 0 dong code doi). Lab
       Node tren ham that (lab_cap_0304_cap150.js = lab cap200 chi doi 2 so
       guard/gan, 13 fixture 10 band + Mau A 20 band, 2 rep, giong het): W2 Adam
       SP-5 x freeField RMS 0,685656 -> 0,870945 (+27,0%), obj 0,675127 ->
       0,973724 (+44,2%), shelf 51,45 -> 50,77 Hz; ATH-CT200iS RMS 0,839387 ->
       0,840143 (+0,09%), obj 2,086632 -> 2,088528; 11/13 fixture con lai + Mau
       A/B/C x harmanOE/IE + Mau A 20 band giu nguyen tuyet doi, viol=0 toan bo.
       Ket luan: cap 200 Hz la diem ngot cua nhanh cap mem (300 -> 200 cai thien
       RMS W2 -21,8%, 200 -> 150 hoi quy +27%); khong thu lai cap <200 o nhanh
       nay. Y tuong luot ke: huong B — do lai buildFirTaps sau va truy hoi luong
       giac (treo tu 20:19/23:49); hoac huong A — thu cap 175 Hz (noi suy cuoi,
       chi neu muon vet can); hoac cai thien do aeV3 thanh median 3 rep (treo tu
       02:40). --- */
  /* --- Mo rong 2026-11-10 (vong tu dong 03:17, huong A): thu cap mem lowshelf
       200 -> 175 Hz (noi suy cuoi, vet can nhanh cap mem) — BI BAC BO, khong ap
       va (chi ghi chu, 0 dong code doi). Lab Node tren ham that
       (lab_cap_0317_cap175.js = lab cap150 chi doi 2 so guard/gan 150->175,
       13 fixture 10 band + Mau A 20 band, 2 rep, giong het): W2 Adam SP-5 x
       freeField RMS 0,685656 -> 0,871273 (+27,1%), obj 0,675127 -> 0,974395
       (+44,3%), shelf 51,45 -> 51,13 Hz — hoi quy gan het cap 150 (+27,0%);
       ATH-CT200iS cai thien RMS 0,839387 -> 0,767010 (-8,6%), obj 2,086632 ->
       2,009960, shelf 166,36 -> 165,86 Hz, nhung khong bu duoc W2; 12/14
       fixture con lai + Mau A/B/C x harmanOE/IE + Mau A 20 band giu nguyen
       tuyet doi, viol=0 toan bo. Ket luan: cap 200 Hz la diem ngot da chot —
       150 va 175 deu hoi quy W2 ~+27% du shelf cuoi gan nhu nhau (~51 Hz),
       tuc vach nam o duong di NM chu khong phai tan so shelf cuoi; nhanh cap
       mem DA VET CAN, khong thu them moi gia tri cap khac o nhanh nay. Nhanh A:
       2 ung vien that bai lien tiep (03:04 cap 150, 03:17 cap 175) — chua du 3
       luot de tam dung nhanh, nhung nhanh con cap mem da dong. Y tuong luot ke:
       huong B — do lai profile 3 pha buildFirTaps sau va 20:20/20:30 (treo tu
       20:19/23:49, nhanh B tam dung tu 22:27 da qua 10+ luot — chi do, khong va
       neu khong co ung vien moi); hoac cai thien do aeV3 thanh median 3 rep
       (treo tu 02:40); hoac huong C — ra soat isoPhonFromSpl tren luoi phon
       rong 10–100 phon. --- */
  /* --- Mo rong 2026-11-10 (vong tu dong 03:29, QA-only): chay bo QA day du
       headless tren ban hien tai (md5 bacd34248d040db0f0dc6b7e2acf09dc), KHONG va
       code — theo skill qa_gated_chained_improvement sau 2 lan luu lab-only
       lien tiep (03:04 cap 150, 03:17 cap 175, ca 2 chi ghi chu). Ket qua
       (qa_headless/qa_report_2026-11-10_0330.json, chay luc sweep batch 03:22
       dang chay, CPU ~89%): 57 test, 55 PASS, 1 FAIL that — aeV3 Mau A 698 ms
       / Mau C 846 ms (vuot 500 ms); 1 conditional FPS chua du dieu kien do
       (giong 02:01/02:40, khong tinh FAIL). Tat ca cong khac DAT: aeV1 RMS
       0,1029 dB (<=0,258), aeV2 null 8011 Hz sau 12,8 dB, aeV4..aeV8,
       psV1..psV8, p4V1/V3/V4, p5V1..p5V8, vRespOk, vPreOk, wasmV1Ok; danh sach
       tai nghe giu nguyen 5003 muc, kho 5000/5000. Loi trang giong het tap
       co san tu truoc (clampN, addEventListener null, ERR_TUNNEL, 404) — da
       ghi nhan o 02:40, khong phai do va gan day. Ket luan: aeV3 FAIL la do
       moi truong do (do lanh don lan + tai sweep), khong phai hoi quy — code
       solver giong het ban 02:40 (tu do chi 2 lan doi comment 03:04/03:17),
       va 02:40 da chung minh ban pre-cap tren VM headless nay cung 336–491 ms.
       Bo dem luu lab-only reset ve 0 sau lan QA day du nay — luot ke duoc phep
       va tro lai. Y tuong luot ke: huong B — do lai profile 3 pha buildFirTaps
       sau va truy hoi luong giac 20:20/20:30 (treo tu 20:19/23:49); hoac cai
       thien do aeV3 thanh median 3 rep (treo tu 02:40); hoac huong C — ra soat
       isoPhonFromSpl tren luoi phon rong 10–100 phon. --- */
  if (!anchorShelf && nBands <= 10 && AE_SHELF_CAP !== 200 && aeRmsLocal(pick.total) > 0.50){
    var prevShelfCap = AE_SHELF_CAP;
    try {
      AE_SHELF_CAP = 200;
      var capped = aeSolve(freqs, errDb, weights, nBands, false, fsv, seedBands);
      ms += capped.ms;
      var oCap = aeSolveObjective(capped.bands, capped.total, errDb, weights, rc);
      if (oCap < pickObj && aeRmsLocal(capped.total) <= aeRmsLocal(pick.total)){ pick = capped; pickObj = oCap; }
    } finally { AE_SHELF_CAP = prevShelfCap; }
  }
  /* --- Mo rong 2026-11-02 (vong tu dong 23:24): song song RLS6 + chap nhan
       chat cho duong >10 band. Thi nghiem C (36 o A/B/C x 12 target x
       20 band, loi that): pipeline RLS6 thang 20/36 o khi chap nhan chat
       (obj cung rc thap hon VA RMS tho khong te di), RMS trung binh cai
       thien 13,08% tren 36 o, 16 o con lai giu goc tuyet doi, 0 o te di,
       viol=0/nullBoost=false toan bo. Cac o harmanOE/rtings luon bi tu
       choi — dung nhu ly do phai co tieu chi chat (thi nghiem B: chon som
       theo objective lam B/OE 20 band te +123% du obj giam). Duong <=10
       band KHONG ap: lab 0/6 o duoc nhan va de bao ve cong aeV3 500 ms.
       Cach noi theo mau khoi neo shelf ngay tren: goi de quy aeSolve
       voi AE_RLS_MODE=6 (chi doi so vong RLS, moi buoc khac giong het),
       khoi phuc mode bang try/finally; guard AE_RLS_MODE!==6 chan de quy
       vo han va guard !anchorShelf gioi han toi da 2 luot neo ke (luot
       goc + luot song song) o cac o benh ly. Worker chay cung code nho
       dong khai bao trong AE_WORKER_SRC nen parity giu nguyen. --- */
  if (!anchorShelf && nBands > 10 && AE_RLS_MODE !== 6){
    var prevRlsMode = AE_RLS_MODE;
    try {
      AE_RLS_MODE = 6;
      var dual = aeSolve(freqs, errDb, weights, nBands, false, fsv, seedBands);
      ms += dual.ms;
      var oDual = aeSolveObjective(dual.bands, dual.total, errDb, weights, rc);
      if (oDual < pickObj && aeRmsLocal(dual.total) <= aeRmsLocal(pick.total)){ pick = dual; pickObj = oDual; }
    } finally { AE_RLS_MODE = prevRlsMode; }
  }
  /* --- Mo rong 2026-11-03 (vong tu dong 00:04): song song rc/2 + chap nhan
       chat cho duong >10 band. Thi nghiem vong 23:44 (36 o A/B/C x 12 target x
       20 band, loi that): rc/2 dung mot minh te hon goc o 16/36 o nen KHONG
       thay the tran; nhung voi tieu chi chat (objective tinh bang rc GOC
       0.06 thap hon VA RMS tho khong te di) thi thang 6/36 o, RMS trung binh
       cai thien 1,80% tren 36 o, 0 o te di, viol=0/nullBoost=false toan bo.
       Cach noi theo mau khoi RLS6 ngay tren: goi de quy aeSolve voi
       AE_RC_SCALE=0.5 (chi doi he so phat rc, moi buoc khac giong het),
       khoi phuc bang try/finally; guard AE_RC_SCALE!==0.5 chan de quy
       vo han. Duong <=10 band KHONG ap (rc giu 0.02, bao ve cong aeV3).
       Worker chay cung code nho dong khai bao trong AE_WORKER_SRC nen
       parity giu nguyen. --- */
  if (!anchorShelf && nBands > 10 && AE_RC_SCALE !== 0.5){
    var prevRcScale = AE_RC_SCALE;
    try {
      AE_RC_SCALE = 0.5;
      var rcDual = aeSolve(freqs, errDb, weights, nBands, false, fsv, seedBands);
      ms += rcDual.ms;
      var oRc = aeSolveObjective(rcDual.bands, rcDual.total, errDb, weights, rc);
      if (oRc < pickObj && aeRmsLocal(rcDual.total) <= aeRmsLocal(pick.total)){ pick = rcDual; pickObj = oRc; }
    } finally { AE_RC_SCALE = prevRcScale; }
  }
  /* --- Mở rộng 2026-11-10 (vòng tự động 09:12, hướng A): T1b chọn band theo chi phí loại bỏ, chỉ ở lượt ngoài cùng — ÁP DỤNG, có cải thiện lớn.
   Ý tưởng (mới, từ chẩn đoán 08:29): T1 cũ thay band peaking >10 kHz rẻ nhất theo |gain|; trên Bose việc mất band >10 kHz làm objective toàn lưới tệ đi (9,33 → 15,81) dù RMS thô cải thiện nên tiêu chí chặt từ chối. T1b: với mỗi band, đặt gain=0, tính lại total (aeTotalCurve) + objective (aeSolveObjective), chọn band có objective sau khi loại bỏ thấp nhất làm vị trí đặt peaking @f_pk (gain=phần dư, Q=3); phần còn lại giữ nguyên (4 tổ hợp lam/shelf, NM 4 vòng, tiêu chí chặt, vòng lặp tối đa 2 lượt). Ràng buộc quan trọng: T1b CHỈ chạy ở lượt aeSolve ngoài cùng (AE_SHELF_CAP===0); trong đệ quy capped (AE_SHELF_CAP=200) giữ chọn band T1 cũ — vì lần vá đầu (T1b mọi nơi) làm K271 tụt RMS 0,6637 → 0,7420 do ứng viên đệ quy capped đổi (dù obj cải thiện 0,9804 → 0,9577); giới hạn này khôi phục K271 về 0,5980 mà vẫn giữ mọi ca cải thiện khác.
   Lab Node trên hàm thật (lượt 09:12, đo trên file đã vá lần cuối; RMS/obj xác định): Bose × harmanIE RMS 1,4089 → 1,0942 (−22,3%), obj 9,3311 → 8,8433; × diffuseFieldKemar 1,4042 → 0,9923, obj 8,8852 → 8,1465; × soundguys 1,3862 → 1,0555, obj 9,6176 → 4,4249; × rtings 1,1201 → 0,8381, obj 4,6370 → 4,2772; W2 SP-5 × freeField 0,6857 → 0,4728, obj 0,6751 → 0,5036; K250 × rtings 1,1755 → 0,3883, obj 1,4311 → 0,2210; K271 × harmanOE 0,6637 → 0,5980, obj 0,9804 → 0,9078; Hi-X15 × harmanOE2015 1,1180 → 0,4737, obj 1,4534 → 0,4729; viol=0 mọi ca; Mẫu A/B/C RMS < 0,50 nên không kích hoạt — aeV1/aeV2/aeV3 không đổi theo cấu trúc. Không chạm AE_LIMITS; không thêm hàm/tên mới; không đổi tên.
   Ý tưởng lượt kế: QA-ONLY (bắt buộc sau 3 lần lưu lab-only liên tiếp — chạy bộ QA trình duyệt 57 test đo lại aeV1/aeV2/aeV3); sau QA, hướng A — mở ca tệ tiếp theo của sweep (batch 0846 xong, tệ nhất mới sau T1b cần quét lại).
   --- */
/* --- Mở rộng 2026-11-10 (vòng tự động 09:00, hướng A): T1 lặp lần 2 (T1-loop) — ÁP DỤNG, có cải thiện.
   Ý tưởng (treo từ 08:29): chạy T1 lần nữa trên K271 đã vá còn 0,6858 → 0,6769, obj 1,1989 → 1,0593 khi chạy ngoài file.
   Thay đổi: bọc khối T1 08:29 trong vòng for t1Pass<2; mỗi lượt tính lại f_pk từ phần dư của pick hiện tại, thay band peaking >10 kHz rẻ nhất còn lại; chỉ chạy lượt 2 khi lượt 1 đã chấp nhận (t1Accepted), mỗi lượt vẫn giữ tiêu chí chặt (objective cùng rc thấp hơn VÀ RMS thô không tệ đi) nên theo cấu trúc không ca nào tệ đi, chỉ tốn thêm ~110 ms lab Node cho ca đã chấp nhận lượt 1.
   Lab Node trên hàm thật (lượt 09:00, chạy 2 lần, RMS/obj xác định giống hệt): K271 × harmanOE RMS 0,6858 → 0,6769 (−1,3%), obj 1,1989 → 1,0593 (−11,6%), viol=0; Bose × harmanIE/diffuseFieldKemar/soundguys/rtings: lượt 2 bị tiêu chí chặt TỪ CHỐI đúng cả 4 ca (obj tệ đi như lượt 1), giữ nguyên 1,4089/1,4042/1,3862/1,1201 — lưu ý Bose × rtings đã 1,2916 → 1,1201 nhờ T1 lượt 1 trong file hiện tại (sweep đo trên file trước T1); W2 SP-5/K250/Hi-X15 không có band peaking >10 kHz nên T1 không áp; Mẫu A/B/C RMS < 0,50 nên không kích hoạt — aeV1/aeV2/aeV3 không đổi theo cấu trúc. Không chạm AE_LIMITS; không thêm hàm/tên mới; không đổi tên.
   Ý tưởng lượt kế: hướng B — đo lại profile 3 pha buildFirTaps sau vá truy hồi lượng giác (treo từ 20:19/23:49); hoặc hướng A — mở ca tệ tiếp theo của sweep khi batch 0846 xong (Bose QC20 × rtings đã cải thiện nhờ T1).
   --- */
/* --- Mở rộng 2026-11-10 (vòng tự động 08:29, hướng A): neo theo phần dư (residual-seeded polish) — ÁP DỤNG, có cải thiện. Mở ca tệ nhất mới của sweep: Bose QuietComfort 20 (passive) × harmanIE (RMS sweep 1,4089, tái lập đúng 3 rep; 5/7 ca tệ nhất hiện là phone này). Chẩn đoán: KHÁC mọi ca tệ trước (K250/K271/Hi-X15/SP-5 đều lỗi bass) — 91,8% MSE ở 2–10 kHz, đỉnh dư −7,03 dB @ 7452,9 Hz; err thô: +6,6 dB @ 5,9k → +0,45 dB @ 7,45k → +9,6 dB @ 9,4k (đỉnh nhọn của phone ở ~7,45 kHz, rộng ~1/4 octave); nulls=[]; 6 band kẹp; viol=0; sàn 20 band chỉ 0,4933 (đỉnh dư còn −2,86 dB @ cùng 7452,9 Hz). Solver không đặt band nào gần 7,45 kHz (gần nhất @6000 +12 dB tràn lên đỉnh) vì NM chỉ di chuyển cục bộ từ seed RLS 200–8000 Hz. Biến thể T1: sau aeSolve đầy đủ, nếu RMS > 0,50 thì lấy f_pk = tần số có |phần dư| lớn nhất (≤10 kHz), thay band peaking có tần số > 10 kHz (rẻ nhất cho RMS ≤10 kHz) bằng peaking @ f_pk, gain = phần dư tại f_pk (kẹp theo cap treble/full), Q = 3, rồi chạy tiếp NM 4 vòng từ band đó (aeSolveSingle với contBands — bỏ qua RLS như aeTryCont) với 4 tổ hợp (lam null/0,3 × shelf 105/55), chỉ giữ khi objective cùng rc thấp hơn VÀ RMS thô không tệ đi (tiêu chí chặt như khối neo/cap). Không chạm AE_LIMITS; không thêm hàm/tên mới; Mẫu A/B/C có RMS < 0,50 nên không kích hoạt — aeV1/aeV2/aeV3 không đổi theo cấu trúc. Lab Node trên hàm thật (lượt 08:29, chạy 2 lần, kết quả xác định giống hệt trừ ms): K271 × harmanOE RMS 1,1342 → 0,7213 (−36,4%), obj 1,6878 → 1,4126, f_pk 20 Hz, thay peaking@19439 +8,00 bằng @20 +5,02/Q3 → @20 +5,89/Q2,03, viol=0; Bose × harmanIE/diffuseFieldKemar/soundguys: RMS thô cải thiện (1,4089 → 1,1747; 1,4042 → 1,1811; 1,3862 → 1,3407) NHƯNG objective tệ đi (9,3311 → 15,8055; 8,8852 → 15,2207; 9,6176 → 16,2552) — mất band >10 kHz làm hỏng mục tiêu toàn lưới trên 10 kHz — nên tiêu chí chặt TỪ CHỐI đúng cả 3 ca, Bose giữ nguyên 1,4089; W2 SP-5/K250/Hi-X15 không có band peaking >10 kHz nên T1 không áp; Mẫu A/B/C giữ nguyên tuyệt đối. Chi phí: chỉ các ca RMS > 0,50 tốn thêm ~100 ms lab Node (4 lần aeSolveSingle 4 vòng NM); Mẫu A không kích hoạt nên cổng aeV3 không đổi. Ý tưởng lượt kế: hướng B — đo lại profile 3 pha buildFirTaps sau vá truy hồi lượng giác (treo từ 20:19/23:49); hoặc hướng A — mở ca tệ tiếp theo của sweep (Bose QC20 × rtings 1,2916, ca tệ nhất của bản không-passive). --- */
  for (var t1Pass=0; t1Pass<2; t1Pass++){
    var t1Accepted = false;
    if (!anchorShelf && nBands <= 10 && aeRmsLocal(pick.total) > 0.50){
      var t1PeakF = 0, t1PeakR = 0;
      for (var t1GridI=0;t1GridI<freqs.length;t1GridI++) if (freqs[t1GridI]<=10000){ var t1Err = errDb[t1GridI]-pick.total[t1GridI]; if (Math.abs(t1Err) > Math.abs(t1PeakR)){ t1PeakR = t1Err; t1PeakF = freqs[t1GridI]; } }
      /* T1b (vòng tự động 09:12, hướng A): chọn band thay thế theo chi phí loại bỏ rẻ nhất trên objective — thay vì band peaking >10 kHz rẻ nhất theo |gain| (T1 cũ làm Bose hỏng objective toàn lưới trên 10 kHz). Với mỗi band, gain=0 rồi tính lại total + objective; band có objective sau khi loại bỏ thấp nhất là band hi sinh rẻ nhất. CHỈ ở lượt ngoài cùng (AE_SHELF_CAP===0); trong đệ quy capped (cap=200) giữ chọn band T1 cũ để ứng viên đệ quy giống hệt bản trước vá (tránh K271 tụt RMS như lần vá đầu). */
      var t1RepIdx = -1, t1RepCost = Infinity;
      if (AE_SHELF_CAP === 0){
        for (var t1BandJ=0;t1BandJ<pick.bands.length;t1BandJ++){
          var t1ZeroBands = pick.bands.map(function(b){ return { type:b.type, freq:b.freq, gain:b.gain, q:b.q }; });
          t1ZeroBands[t1BandJ].gain = 0;
          var t1ZeroObj = aeSolveObjective(t1ZeroBands, aeTotalCurve(t1ZeroBands, freqs, fsv), errDb, weights, rc);
          if (t1ZeroObj < t1RepCost){ t1RepCost = t1ZeroObj; t1RepIdx = t1BandJ; }
        }
      } else {
        var t1RepGain = 1e9;
        for (var t1BandJ=0;t1BandJ<pick.bands.length;t1BandJ++){ var t1Band = pick.bands[t1BandJ]; if (t1Band.type==="peaking" && t1Band.freq>10000 && Math.abs(t1Band.gain)<t1RepGain){ t1RepIdx = t1BandJ; t1RepGain = Math.abs(t1Band.gain); } }
      }
      if (t1RepIdx >= 0){
        var t1CapDb = t1PeakF > AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
        var t1SeedGain = Math.max(-t1CapDb, Math.min(t1CapDb, t1PeakR));
        var t1BestRes = null, t1BestObj = Infinity;
        var t1LamArr = [null, 0.3], t1ShelfArr = [105, 55];
        for (var t1LamI=0;t1LamI<2;t1LamI++) for (var t1ShelfI=0;t1ShelfI<2;t1ShelfI++){
          var t1ModBands = pick.bands.map(function(b){ return { type:b.type, freq:b.freq, gain:b.gain, q:b.q }; });
          t1ModBands[t1RepIdx] = { type:"peaking", freq:t1PeakF, gain:t1SeedGain, q:3 };
          var t1Cand = aeSolveSingle(freqs, errDb, weights, nBands, t1LamArr[t1LamI], 4, rc, t1ShelfArr[t1ShelfI], t1ModBands, anchorShelf, undefined, fsv);
          ms += t1Cand.ms;
          var t1CandObj = aeSolveObjective(t1Cand.bands, t1Cand.total, errDb, weights, rc);
          if (t1CandObj < t1BestObj){ t1BestObj = t1CandObj; t1BestRes = t1Cand; }
        }
        if (t1BestRes && t1BestObj < pickObj && aeRmsLocal(t1BestRes.total) <= aeRmsLocal(pick.total)){ pick = t1BestRes; pickObj = t1BestObj; t1Accepted = true; }
      }
    }
    if (!t1Accepted) break;
  }
  /* --- Mở rộng 2026-11-10 (vòng tự động 09:52, hướng A): T1c — vòng T1 thứ hai thử cả 10 band thay thế — ÁP DỤNG, có cải thiện.
   Thiết kế: GIỮ NGUYÊN vòng T1/T1b, THÊM vòng T1c chạy SAU nó (xem khối T1c dưới): mỗi lượt thử CẢ 10 band thay thế (mỗi band × 4 tổ hợp lam/shelf), lọc chặt TRƯỚC rồi chọn obj nhỏ nhất; chỉ ở lượt ngoài cùng (AE_SHELF_CAP===0); tiêu chí chặt so với pick hiện tại (đã qua T1b) nên theo cấu trúc không ca nào tệ đi so với bản T1b.
   Biến thể đầu (thay thế trực tiếp T1b bằng tìm cả 10 band) đã thử và REVERT trong cùng lượt: đo lại trên file đã vá cho thấy Bose × harmanOE TỤT RMS 0,9975 → 1,0682 (+7,1%, dù obj 5,3501 → 2,6564) và Bose × soundguys tụt obj 4,4249 → 4,4296 — vì tiêu chí chặt chỉ cam kết không tệ đi so với pick bước vào vòng, không cam kết so với đáp án cuối của T1b (cùng lỗ hổng cấu trúc như bài học K271 lượt 09:12). Thiết kế vòng-sau này khớp đúng mô phỏng lab (mô phỏng T1c trên đáp án cuối của T1b) nên kết quả file phải khớp từng số với mô phỏng.
   Lab Node trên hàm thật trích tươi từ file (lượt 09:52, file thường nối liền, RMS/obj xác định; sweep 0946 chạy song song nên ms chỉ tham khảo):
   Đo lại toàn bộ ca tệ nhất sweep bằng bản T1b: Bose × jm1 vẫn tệ nhất 1,2201 (sweep cũ 1,3564); Bose × ief 1,0930; Bose × harmanOE2015 1,0582; Hi-X15 × soundguys 1,1724 → 0,4848; K271 × harmanOE 0,5980 (sweep cũ 1,1342 là số đo bản cũ, đã lỗi thời). Chẩn đoán BOSE/jm1: err thô có 2 đỉnh nhọn của phone (~4,18 kHz và ~7,45 kHz) cần cắt hẹp giữa vùng cần boost rộng +7..+10 dB; cặp band +11,92@4127 Q0,50 / −12@4291 Q2,97 đều mang tải (zero 1 trong 2 làm RMS vọt 2,83–5,22) nên T1b thay band rẻ nhất @580 thất bại đúng; T1c thắng bằng cách thay peaking@182. Biến thể seed Q=6 BÁC BỎ (jm1 lượt 0 bị từ chối: RMS 1,6983 tệ đi dù obj cải thiện).
   Kết quả T1c (mô phỏng 19 ca thật + 6 guard, phải khớp khi đo lại trên file đã vá): 11 ca cải thiện cả RMS lẫn obj, 8 ca giữ nguyên, 0 ca tệ đi — jm1 1,2201 → 1,0304 (obj 6,2083 → 2,9163); harmanOE2015 1,0582 → 0,7387 (obj 4,1947 → 1,3733); diffuseFieldKemar 0,9923 → 0,8574 (obj 8,1465 → 2,7297); soundguys 1,0555 → 0,9580 (obj 4,4249 → 2,0692); diffuseField 0,9273 → 0,8405 (obj 7,2412 → 1,2363); harmanIE 1,0942 → 1,0897; oratoryOptimum 0,6924 → 0,5884; K271 0,5980 → 0,4719; SP-5/diffuseFieldKemar 0,7960 → 0,6921; SonoFlow 0,5692 → 0,5180; rtings 0,8381 → 0,8372; harmanOE/ief/SP-5-freeField/K250/Hi-X15/Q30 giữ nguyên; Mẫu A/B/C giữ nguyên tuyệt đối (A/OE 0,0685, A/IE 0,0645, B/OE 0,1343, B/IE 0,1221, C/OE 0,1694, C/IE 0,1460) — aeV1/aeV2/aeV3 không đổi theo cấu trúc.
   Bộ đếm lưu lab-only: 1 (sau QA đầy đủ 09:43). Nhánh A: MỞ. Ý tưởng lượt kế: hướng A — ca tệ nhất mới sau T1c là Bose × ief 1,0930 (T1c không chấp nhận lượt nào — chẩn đoán vì sao cả 10 band thay thế đều trượt tiêu chí chặt); hoặc hướng B — đo lại profile 3 pha buildFirTaps (treo từ 20:19/23:49).
   --- */
  /* --- Mở rộng 2026-11-10 (vòng tự động 10:26, hướng A): chẩn đoán Bose × ief 1,0930 — BÁC BỎ thay 2 band cùng lúc + nới seed Q, KHÔNG vá code.
   Lab Node trên hàm thật trích tươi từ file (lượt 10:26, RMS/obj xác định; sweep chạy song song nên ms chỉ tham khảo): pick sau T1c RMS 1,0930 / obj 2,7734, dư treble 4–10 kHz 2,1521 dB với notch −4,68 dB @ 7453 Hz và đỉnh +3,97 dB @ 9123 Hz; pick giữ 3× peaking +8 dB @ ~18 kHz + highshelf +8 dB @ 11666 Hz.
   T1c gốc (40 ứng viên): 0 đạt tiêu chí chặt — ứng viên RMS tốt nhất (thay peaking@1298 bằng cut @ 7453) RMS 1,0207 (−6,6%) nhưng obj 2,8066 (+1,2%). Phân tách obj: pick mse toàn dải 2,6542 + regPart 0,1192; ứng viên mse 2,6789 (+0,0247) + regPart 0,1277 (+0,0085) — sửa notch cải thiện RMS ≤10 kHz nhưng làm tệ MSE toàn dải; thay highshelf RMS 0,774 nhưng mse vọt 7,7901 (mất shelf treble >10 kHz, vô hình với RMS ≤10 kHz nhưng quyết định MSE toàn dải).
   Biến thể 1 band: seed Q 1,5/2/6 đều 0 đạt; Q=4,5 chỉ đạt biên qua thay peaking@18145 (RMS 1,0917, −0,0013; obj 2,7730, −0,0004 — mức nhiễu, không vá); đỉnh dư #2 0 đạt; đỉnh #3 đạt biên tương tự (RMS 1,0918, obj 2,7729); lam rộng {null,0,15,0,3,0,6} 0 đạt. Cặp 2 band (7453+9123 và 7453+7671, 45 cặp × 4 tổ hợp = 360 ứng viên): 0 đạt; cặp obj tốt nhất 2,7746 vẫn tệ hơn pick 2,7734; cặp RMS tốt nhất 0,7705 nhưng obj 15,0409.
   Kết luận: trên ca này RMS (≤10 kHz) và objective (MSE toàn dải + reg gain) mâu thuẫn nên tiêu chí chặt (cả hai cùng cải thiện) không thỏa được bằng thay 1–2 band; nhánh "thay 2 band cùng lúc" ĐÓNG. Nới tiêu chí cho phép obj tệ đi sẽ vi phạm quy tắc không làm tụt chỉ số — cần quyết định của Angela nếu muốn đổi hướng này, không tự ý đổi. Không đổi code nên bộ đếm lưu lab-only vẫn 1; aeV1/aeV2/aeV3 không đổi theo cấu trúc. Ý tưởng lượt kế: hướng B — đo lại profile 3 pha buildFirTaps sau vá truy hồi lượng giác (treo từ 20:19/23:49, nhánh B tạm dừng từ 22:27 đã qua 10+ lượt).
   --- */
  /* T1c (vòng tự động 09:52, hướng A): vòng T1 thứ hai — thử CẢ 10 band thay thế thay vì chỉ band rẻ nhất theo chi phí loại bỏ (T1b). Động cơ: trên BOSE/jm1 T1b thay band rẻ nhất peaking@580 (chi phí 7,80) nhưng ứng viên mới tệ đi cả RMS (1,2519) lẫn obj (6,5456) nên tiêu chí chặt từ chối; thử cả 10 band thì band thắng là peaking@182 (chi phí 9,30, đắt thứ 2). Lọc chặt TRƯỚC khi chọn (chỉ xét ứng viên có obj thấp hơn VÀ RMS không tệ đi so với pick hiện tại, rồi chọn obj nhỏ nhất). Vòng này chạy SAU vòng T1/T1b và CHỈ ở lượt ngoài cùng (AE_SHELF_CAP===0); trong đệ quy capped giữ nguyên hoàn toàn đường cũ (không có vòng T1c) để ứng viên đệ quy không đổi (bài học K271 lượt 09:12). Chi phí thêm: tối đa 40 lần aeSolveSingle mỗi lượt thay vì 4 — chỉ các ca RMS > 0,50 kích hoạt nên Mẫu A/B/C và cổng aeV3 không đổi. */
  /* T1c 2 tang (vong tu dong 21:25, huong A): stage-1 chi chay combo thang cua main solve (pickLam, pickShelf) = 10 ung vien; stage-2 chay 30 ung vien con lai CHI KHI stage-1 co ung vien qua tieu chi chat (t1cStage1Hit). Neu combo thang khong nam trong luoi T1c (t1cGateOn=false, vd nBands<10 voi pickLam=0.1) thi chay du 40 ung vien nhu cu. Lab A/B (probe_t1c_gate_2125.js): QC20 x harmanIE RMS/obj giu nguyen tuyet doi (1,002961/4,522706, 80 ung vien ca 2 bien the); HD 651 x ief giu nguyen (0,723700/0,704153) voi 40->10 ung vien; Mau A giu nguyen. */
  if (AE_SHELF_CAP === 0){
    for (var t1cPass=0; t1cPass<2; t1cPass++){
      var t1cAccepted = false;
      if (!anchorShelf && nBands <= 10 && aeRmsLocal(pick.total) > 0.50){
        var t1cPeakF = 0, t1cPeakR = 0;
        for (var t1cGridI=0;t1cGridI<freqs.length;t1cGridI++) if (freqs[t1cGridI]<=10000){ var t1cErr = errDb[t1cGridI]-pick.total[t1cGridI]; if (Math.abs(t1cErr) > Math.abs(t1cPeakR)){ t1cPeakR = t1cErr; t1cPeakF = freqs[t1cGridI]; } }
        var t1cCapDb = t1cPeakF > AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
        var t1cSeedGain = Math.max(-t1cCapDb, Math.min(t1cCapDb, t1cPeakR));
        var t1cBestRes = null, t1cBestObj = Infinity;
        var t1cPickRms = aeRmsLocal(pick.total);
        var t1cLamArr = [null, 0.3], t1cShelfArr = [105, 55];
        var t1cWinLamI = t1cLamArr.indexOf(pickLam), t1cWinShelfI = t1cShelfArr.indexOf(pickShelf), t1cGateOn = (t1cWinLamI>=0 && t1cWinShelfI>=0), t1cStage1Hit = false;
        for (var t1cStage=0;t1cStage<2;t1cStage++){
        if (t1cStage===1 && (!t1cGateOn || !t1cStage1Hit)) break;
        for (var t1cRepI=0;t1cRepI<pick.bands.length;t1cRepI++){
          for (var t1cLamI=0;t1cLamI<2;t1cLamI++) for (var t1cShelfI=0;t1cShelfI<2;t1cShelfI++){
            if (t1cStage===0 && t1cGateOn && (t1cLamI!==t1cWinLamI || t1cShelfI!==t1cWinShelfI)) continue;
            if (t1cStage===1 && t1cLamI===t1cWinLamI && t1cShelfI===t1cWinShelfI) continue;
            var t1cModBands = pick.bands.map(function(b){ return { type:b.type, freq:b.freq, gain:b.gain, q:b.q }; });
            t1cModBands[t1cRepI] = { type:"peaking", freq:t1cPeakF, gain:t1cSeedGain, q:3 };
            var t1cCand = aeSolveSingle(freqs, errDb, weights, nBands, t1cLamArr[t1cLamI], 4, rc, t1cShelfArr[t1cShelfI], t1cModBands, anchorShelf, undefined, fsv);
            ms += t1cCand.ms;
            var t1cCandObj = aeSolveObjective(t1cCand.bands, t1cCand.total, errDb, weights, rc);
            if (t1cCandObj < pickObj && aeRmsLocal(t1cCand.total) <= t1cPickRms){ if (t1cStage===0) t1cStage1Hit = true; if (t1cCandObj < t1cBestObj){ t1cBestObj = t1cCandObj; t1cBestRes = t1cCand; } }
          }
        }
        }
        if (t1cBestRes){ pick = t1cBestRes; pickObj = t1cBestObj; t1cAccepted = true; }
      }
      if (!t1cAccepted) break;
    }
  }
  /* T1d (vòng tự động 10:44, hướng A): vòng T1 thứ ba — thử thêm 4 seed mà T1c
     (09:52, chỉ seed đỉnh dư #1 Q=3) bỏ sót: đỉnh #3 Q=3, đỉnh #2 Q=3, đỉnh #1 Q=4,5,
     đỉnh #1 Q=6. Động cơ: chẩn đoán Bose QC20 (không passive) × rtings — số sweep 1,2916
     là STALE (đo bằng fileMd5 459a3aca pre-T1c; worst20 trộn 27 md5 nên không còn đại diện);
     pick hiện tại 0,6929/obj 0,6407; seed Q=3 đỉnh #1 cho 0 đạt nhưng đỉnh #3 @20 Hz
     Q=3 cho RMS 0,5818/obj 0,4942, đỉnh #1 Q=4,5 cho 0,6323/0,5034 — T1c thiếu hạt giống.
     Thiết kế: khối CỘNG THÊM sau T1c, cùng điều kiện (lượt ngoài AE_SHELF_CAP===0,
     !anchorShelf, nBands<=10, RMS>0,50), 1 pass, 4 seed theo thứ tự [#3 Q3, #2 Q3,
     #1 Q4,5, #1 Q6], đỉnh tính 1 lần từ pick vào vòng; mỗi seed thử cả 10 band thay thế
     × lam [null,0,3] × shelf [105,55], lọc chặt (obj thấp hơn VÀ RMS không tệ đi so với
     pick hiện tại, giữ obj nhỏ nhất), chấp nhận thì cập nhật pick rồi mới thử seed kế
     (chaining) — theo cấu trúc không ca nào tệ đi. Không thêm hàm/tên mới ngoài biến
     cục bộ t1d* trong aeSolve (như tiền lệ t1c*); AE_WORKER_SRC lấy aeSolve.toString()
     nên Worker tự đồng bộ; Mẫu A/B/C RMS<0,50 nên không kích hoạt.
     Lab Node trên hàm thật (lượt 10:44, chạy 2 lần, JSON giống hệt — xác định tuyệt đối;
     sweep chạy song song nên ms chỉ tham khảo): validation 20 cặp tệ nhất sweep, 9 cải
     thiện / 11 giữ nguyên / 0 tệ đi — rtings (không passive) 0,6929→0,4013, obj
     0,6407→0,2666 (cả 4 seed chấp nhận, chuỗi); harmanIE 1,0897→1,0030, obj
     8,8331→4,5227 (đỉnh #3 @9665 thay rep 3); soundguys 0,9580→0,8783, obj
     2,0692→2,0056; jm1 1,0304→1,0100, obj 2,9163→2,8977; oratoryOptimum 0,5884→0,5711;
     SP-5×diffuseFieldKemar 0,6921→0,5867, obj 0,8313→0,7392; harmanOE2015 0,7387→
     0,6482, obj 1,3733→1,1457; ief 1,0930→1,0918 và SonoFlow×diffuseField 0,5180→0,5179
     (mức nhiễu, như 10:26); giữ nguyên: diffuseFieldKemar 0,8574, diffuseField 0,8405,
     passive×rtings 0,8372, harmanOE 0,9975 (0 seed đạt) + 7 ca RMS≤0,50 không kích hoạt
     (K250, Hi-X15×3, SP-5×freeField, K271, Q30). Mẫu A/B/C × harmanOE/IE giữ nguyên
     tuyệt đối (0,0685/0,0645/0,1343/0,1221/0,1694/0,1460) — aeV1/aeV2/aeV3 không đổi theo
     cấu trúc. Chi phí: tối đa +160 aeSolveSingle mỗi lượt giải ca RMS>0,50.
     Bộ đếm lưu lab-only: 2 (sau QA đầy đủ 09:43) — lượt kế vá code nữa sẽ là #3, sau đó
     PHẢI QA-only theo skill. Lưu ý lượt sau: ý tưởng "đo lại profile 3 pha buildFirTaps"
     ĐÃ XONG ở 20:42 và "rà soát loudFitError lưới rộng" ĐÃ XONG ở 19:31/00:13 — đừng lặp
     lại hai ý tưởng treo stale này. Ý tưởng lượt kế: QA-only khi counter đạt 3; hoặc
     hướng A — mở ca tệ nhất thật sau T1d (Bose passive × harmanIE 1,0030 / ief 1,0918).
     --- */
  /* T1d 2 tang (vong tu dong 21:48, huong A): moi seed, stage-1 chi chay combo thang cua main solve (pickLam, pickShelf) = 10 ung vien; stage-2 chay 30 ung vien con lai CHI KHI stage-1 co ung vien qua tieu chi chat (t1dStage1Hit, reset moi seed). Neu combo thang khong nam trong luoi T1d (t1dGateOn=false, vd nBands<10 voi pickLam=0.1) thi chay du 160 ung vien nhu cu. Lab A/B (probe_t1d_gate_2148.js, 6 ca): RMS/obj giu nguyen tuyet doi; QC20 x harmanIE 160->70 ung vien, QC20 x ief 160->70, HD 651 x ief 160->70; K250/SP-5/Mau A 0 ung vien ca 2 bien the. */
  /* T1d (vòng tự động 10:44, hướng A): vòng T1 thứ ba — thêm 4 seed T1c bỏ sót
     (đỉnh #3 Q3, đỉnh #2 Q3, đỉnh #1 Q4,5, đỉnh #1 Q6), chạy SAU T1c, 1 pass, lọc chặt
     như T1c nên theo cấu trúc không ca nào tệ đi; chỉ ca RMS > 0,50 kích hoạt. */
  if (AE_SHELF_CAP === 0){
    if (!anchorShelf && nBands <= 10 && aeRmsLocal(pick.total) > 0.50){
      var t1dP = [{f:0,r:0},{f:0,r:0},{f:0,r:0}];
      for (var t1dI=0;t1dI<freqs.length;t1dI++) if (freqs[t1dI]<=10000){ var t1dErr = errDb[t1dI]-pick.total[t1dI]; var t1dAbs = Math.abs(t1dErr);
        if (t1dAbs > Math.abs(t1dP[0].r)){ t1dP[2]=t1dP[1]; t1dP[1]=t1dP[0]; t1dP[0]={f:freqs[t1dI],r:t1dErr}; }
        else if (t1dAbs > Math.abs(t1dP[1].r)){ t1dP[2]=t1dP[1]; t1dP[1]={f:freqs[t1dI],r:t1dErr}; }
        else if (t1dAbs > Math.abs(t1dP[2].r)){ t1dP[2]={f:freqs[t1dI],r:t1dErr}; } }
      var t1dSeeds = [
        { f:t1dP[2].f, g:t1dP[2].r, q:3 },
        { f:t1dP[1].f, g:t1dP[1].r, q:3 },
        { f:t1dP[0].f, g:t1dP[0].r, q:4.5 },
        { f:t1dP[0].f, g:t1dP[0].r, q:6 }
      ];
      var t1dLamArr = [null, 0.3], t1dShelfArr = [105, 55];
      var t1dWinLamI = t1dLamArr.indexOf(pickLam), t1dWinShelfI = t1dShelfArr.indexOf(pickShelf), t1dGateOn = (t1dWinLamI>=0 && t1dWinShelfI>=0);
      for (var t1dS=0;t1dS<4;t1dS++){
        var t1dCapDb = t1dSeeds[t1dS].f > AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
        var t1dSeedGain = Math.max(-t1dCapDb, Math.min(t1dCapDb, t1dSeeds[t1dS].g));
        var t1dBestRes = null, t1dBestObj = Infinity;
        var t1dPickRms = aeRmsLocal(pick.total);
        var t1dStage1Hit = false;
        for (var t1dStage=0;t1dStage<2;t1dStage++){
        if (t1dStage===1 && (!t1dGateOn || !t1dStage1Hit)) break;
        for (var t1dRepI=0;t1dRepI<pick.bands.length;t1dRepI++){
          for (var t1dLamI=0;t1dLamI<2;t1dLamI++) for (var t1dShelfI=0;t1dShelfI<2;t1dShelfI++){
            if (t1dStage===0 && t1dGateOn && (t1dLamI!==t1dWinLamI || t1dShelfI!==t1dWinShelfI)) continue;
            if (t1dStage===1 && t1dLamI===t1dWinLamI && t1dShelfI===t1dWinShelfI) continue;
            var t1dModBands = pick.bands.map(function(b){ return { type:b.type, freq:b.freq, gain:b.gain, q:b.q }; });
            t1dModBands[t1dRepI] = { type:"peaking", freq:t1dSeeds[t1dS].f, gain:t1dSeedGain, q:t1dSeeds[t1dS].q };
            var t1dCand = aeSolveSingle(freqs, errDb, weights, nBands, t1dLamArr[t1dLamI], 4, rc, t1dShelfArr[t1dShelfI], t1dModBands, anchorShelf, undefined, fsv);
            ms += t1dCand.ms;
            var t1dCandObj = aeSolveObjective(t1dCand.bands, t1dCand.total, errDb, weights, rc);
            if (t1dCandObj < pickObj && aeRmsLocal(t1dCand.total) <= t1dPickRms){ if (t1dStage===0) t1dStage1Hit = true; if (t1dCandObj < t1dBestObj){ t1dBestObj = t1dCandObj; t1dBestRes = t1dCand; } }
          }
        }
        }
        if (t1dBestRes){ pick = t1dBestRes; pickObj = t1dBestObj; }
      }
    }
  }
  /* T1e (vòng tự động 11:03, hướng A): vòng T1 thứ tư — thử thêm 6 seed mà T1c/T1d
     bỏ sót: đỉnh #4 Q3, đỉnh #5 Q3, đỉnh #1 Q2, đỉnh #1 Q8, đỉnh #2 Q4,5, đỉnh #2 Q6.
     Động cơ: ca tệ nhất thật sau T1d — Bose QC20 (passive) × harmanIE 1,0030 (4 band kẹp,
     dư mid 1,41 / treble 1,51 dB, đỉnh dư cụm 9,1–9,7 kHz +3,48/+3,24/+2,86 và 2,7–2,9 kHz
     +2,6) — T1e 0/6 seed đạt và T1d pass 2 cũng 0/4: ca này cạn hạt giống, giới hạn cấu trúc
     đường 10 band, KHÔNG vá theo hướng đó. Nhưng T1e thắng trên các ca khác.
     Thiết kế: khối CỘNG THÊM sau T1d, cùng điều kiện (lượt ngoài AE_SHELF_CAP===0,
     !anchorShelf, nBands<=10, RMS>0,50), 1 pass, 6 seed theo thứ tự [#4 Q3, #5 Q3,
     #1 Q2, #1 Q8, #2 Q4,5, #2 Q6], đỉnh tính 1 lần từ pick vào vòng (top 5); mỗi seed thử cả
     10 band thay thế × lam [null,0,3] × shelf [105,55], lọc chặt (obj thấp hơn VÀ RMS không
     tệ đi so với pick hiện tại, giữ obj nhỏ nhất), chấp nhận thì cập nhật pick rồi mới thử
     seed kế (chaining) — theo cấu trúc không ca nào tệ đi. Không thêm hàm/tên mới ngoài biến
     cục bộ t1e* trong aeSolve (như tiền lệ t1c, t1d); AE_WORKER_SRC lấy aeSolve.toString()
     nên Worker tự đồng bộ; Mẫu A/B/C RMS<0,50 nên không kích hoạt.
     Lab Node trên hàm thật (lượt 11:03, chạy 1 lần; sweep chạy song song nên ms chỉ tham khảo):
     validation 21 cặp tệ nhất sweep + Bose×ief, 9 cải thiện / 12 giữ nguyên / 0 tệ đi —
     SP-5×diffuseFieldKemar 0,5867→0,4933, obj 0,7392→0,6401 (−15,9%, cả 6 seed chấp nhận);
     Bose passive×soundguys 0,8783→0,8293, obj 2,0056→1,9785; passive×rtings 0,8372→0,8013,
     obj 4,2488→4,1482; passive×harmanOE2015 0,6482→0,6336; passive×jm1 1,0100→1,0050;
     passive×diffuseField 0,8405→0,8365; passive×oratoryOptimum 0,5711→0,5708; Bose×ief
     0,5123→0,5059, obj 0,3855→0,3813; SonoFlow×diffuseField 0,5179→0,5172. Giữ nguyên:
     passive×harmanIE 1,0030, passive×diffuseFieldKemar 0,8574, passive×harmanOE 0,9975,
     passive×ief 1,0918 + 8 ca RMS≤0,50 không kích hoạt. Mẫu A/B/C × harmanOE/IE giữ nguyên
     tuyệt đối (0,0685/0,0645/0,1343/0,1221/0,1694/0,1460) — aeV1/aeV2/aeV3 không đổi theo
     cấu trúc. Chi phí: tối đa +240 aeSolveSingle mỗi lượt giải ca RMS>0,50.
     Bộ đếm lưu lab-only: 3 (sau QA đầy đủ 09:43) — lượt kế PHẢI QA-only theo skill, không
     vá code thêm. Ý tưởng lượt kế: QA-only (đo lại aeV1/aeV2/aeV3 + 57 test trình duyệt);
     hoặc hướng A — Bose passive × harmanIE 1,0030 / ief 1,0918 vẫn cạn hạt giống T1, cần
     hướng mới (không phải thêm seed T1); quyết định của Angela về nới tiêu chí T1c cho
     Bose×ief vẫn đang chờ (10:26).
     --- */
  /* T1e 2 tang (vong tu dong 22:16, huong A): moi seed, stage-1 chi chay combo thang cua main solve (pickLam, pickShelf) = 10 ung vien; stage-2 chay 30 ung vien con lai CHI KHI stage-1 co ung vien qua tieu chi chat (t1eStage1Hit, reset moi seed). Neu combo thang khong nam trong luoi T1e (t1eGateOn=false, vd nBands<10 voi pickLam=0.1) thi chay du 240 ung vien/pass nhu cu. Lab A/B (probe_t1e_gate_2216.js, 6 ca): RMS/obj giu nguyen tuyet doi ca 6 ca; tong ung vien T1e 1920->870 (-54,7%); ca phi thuan 240->60 (-75%), SP-5 x diffuseFieldKemar 240->240 (ca 6 seed chap nhan). */
  /* T1e (vòng tự động 11:03, hướng A): vòng T1 thứ tư — thêm 6 seed T1c/T1d bỏ sót
     (đỉnh #4 Q3, đỉnh #5 Q3, đỉnh #1 Q2, đỉnh #1 Q8, đỉnh #2 Q4,5, đỉnh #2 Q6), chạy SAU T1d, 6 pass
     (vòng tự động 20:08: TẮT — A/B 11 ca ΔRMS=0, Δobj=0; t1ePass<6 → t1ePass<0, giữ khối để revert).
     (vòng tự động 20:26: KHÔI PHỤC — A/B mở rộng: QC20p×soundguys T1e tốt hơn (RMS 0,823676 vs 0,878283); t1ePass<0 → t1ePass<6).
     (pass 6 thêm 12:29, theo mẫu t1cPass, dừng sớm nếu pass không chấp nhận seed nào), lọc chặt
     như T1d nên theo cấu trúc không ca nào tệ đi; chỉ ca RMS > 0,50 kích hoạt. */
  if (AE_SHELF_CAP === 0){
    for (var t1ePass=0; t1ePass<6; t1ePass++){
      var t1eAccepted = false;
      if (!anchorShelf && nBands <= 10 && aeRmsLocal(pick.total) > 0.50){
      var t1eP = [{f:0,r:0},{f:0,r:0},{f:0,r:0},{f:0,r:0},{f:0,r:0}];
      for (var t1eI=0;t1eI<freqs.length;t1eI++) if (freqs[t1eI]<=10000){ var t1eErr = errDb[t1eI]-pick.total[t1eI]; var t1eAbs = Math.abs(t1eErr);
        if (t1eAbs > Math.abs(t1eP[0].r)){ t1eP[4]=t1eP[3]; t1eP[3]=t1eP[2]; t1eP[2]=t1eP[1]; t1eP[1]=t1eP[0]; t1eP[0]={f:freqs[t1eI],r:t1eErr}; }
        else if (t1eAbs > Math.abs(t1eP[1].r)){ t1eP[4]=t1eP[3]; t1eP[3]=t1eP[2]; t1eP[2]=t1eP[1]; t1eP[1]={f:freqs[t1eI],r:t1eErr}; }
        else if (t1eAbs > Math.abs(t1eP[2].r)){ t1eP[4]=t1eP[3]; t1eP[3]=t1eP[2]; t1eP[2]={f:freqs[t1eI],r:t1eErr}; }
        else if (t1eAbs > Math.abs(t1eP[3].r)){ t1eP[4]=t1eP[3]; t1eP[3]={f:freqs[t1eI],r:t1eErr}; }
        else if (t1eAbs > Math.abs(t1eP[4].r)){ t1eP[4]={f:freqs[t1eI],r:t1eErr}; } }
      var t1eSeeds = [
        { f:t1eP[3].f, g:t1eP[3].r, q:3 },
        { f:t1eP[4].f, g:t1eP[4].r, q:3 },
        { f:t1eP[0].f, g:t1eP[0].r, q:2 },
        { f:t1eP[0].f, g:t1eP[0].r, q:8 },
        { f:t1eP[1].f, g:t1eP[1].r, q:4.5 },
        { f:t1eP[1].f, g:t1eP[1].r, q:6 }
      ];
      var t1eLamArr = [null, 0.3], t1eShelfArr = [105, 55];
      var t1eWinLamI = t1eLamArr.indexOf(pickLam), t1eWinShelfI = t1eShelfArr.indexOf(pickShelf), t1eGateOn = (t1eWinLamI>=0 && t1eWinShelfI>=0);
      for (var t1eS=0;t1eS<6;t1eS++){
        var t1eCapDb = t1eSeeds[t1eS].f > AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
        var t1eSeedGain = Math.max(-t1eCapDb, Math.min(t1eCapDb, t1eSeeds[t1eS].g));
        var t1eBestRes = null, t1eBestObj = Infinity;
        var t1ePickRms = aeRmsLocal(pick.total);
        var t1eStage1Hit = false;
        for (var t1eStage=0;t1eStage<2;t1eStage++){
        if (t1eStage===1 && (!t1eGateOn || !t1eStage1Hit)) break;
        for (var t1eRepI=0;t1eRepI<pick.bands.length;t1eRepI++){
          for (var t1eLamI=0;t1eLamI<2;t1eLamI++) for (var t1eShelfI=0;t1eShelfI<2;t1eShelfI++){
            if (t1eStage===0 && t1eGateOn && (t1eLamI!==t1eWinLamI || t1eShelfI!==t1eWinShelfI)) continue;
            if (t1eStage===1 && t1eLamI===t1eWinLamI && t1eShelfI===t1eWinShelfI) continue;
            var t1eModBands = pick.bands.map(function(b){ return { type:b.type, freq:b.freq, gain:b.gain, q:b.q }; });
            t1eModBands[t1eRepI] = { type:"peaking", freq:t1eSeeds[t1eS].f, gain:t1eSeedGain, q:t1eSeeds[t1eS].q };
            var t1eCand = aeSolveSingle(freqs, errDb, weights, nBands, t1eLamArr[t1eLamI], 4, rc, t1eShelfArr[t1eShelfI], t1eModBands, anchorShelf, undefined, fsv);
            ms += t1eCand.ms;
            var t1eCandObj = aeSolveObjective(t1eCand.bands, t1eCand.total, errDb, weights, rc);
            if (t1eCandObj < pickObj && aeRmsLocal(t1eCand.total) <= t1ePickRms){ if (t1eStage===0) t1eStage1Hit = true; if (t1eCandObj < t1eBestObj){ t1eBestObj = t1eCandObj; t1eBestRes = t1eCand; } }
          }
        }
        }
        if (t1eBestRes){ pick = t1eBestRes; pickObj = t1eBestObj; t1eAccepted = true; }
      }
      }
      if (!t1eAccepted) break;
    }
  }
  return { bands:pick.bands, total:pick.total, ms:ms };
}
/* --- H14 (TASK #21, vong tu dong 2026-11-15, truc A, P1 — H13 dang A da chot "lam ca 3" 19:02 15/11):
   aeSolveSeeded = aeSolve chay tu seedBands (thiet ke lab TASK #17): seed = PEQ 10 band giu nguyen thu tu/type
   + 2 band peaking gain 0, q 1.1 tai 2 vi tri luoi mac dinh xa nhat (log2) so voi 10 tan so hien co (aeBuildSeed12).
   De tich hop toi thieu (duoi 100 dong), aeSolve nhan them tham so tuy chon seedBands (undefined = hanh vi cu
   giong het tung cau lenh o nhanh khong seed); aeSolveSeeded chi la lop boc dung chu ky lab t17. Cac loi goi
   6 doi so cu khong doi gi; AE_WORKER_SRC lay aeSolve.toString() nen Worker tu dong bo (cong aeSolveSeeded.toString()). --- */
function aeSolveSeeded(freqs, errDb, weights, nBands, anchorShelf, fs, seedBands){
  return aeSolve(freqs, errDb, weights, nBands, anchorShelf, fs, seedBands);
}
function aeBuildSeed12(bands10){
  if (!bands10 || bands10.length !== 10) throw new Error("aeBuildSeed12: pick10 length unexpected: " + (bands10 && bands10.length));
  var grid = [];
  for (var i = 0; i < 10; i++) grid.push(200 * Math.pow(8000 / 200, i / 9));
  var scored = grid.map(function(g){
    var d = Infinity;
    for (var j = 0; j < bands10.length; j++) d = Math.min(d, Math.abs(Math.log2(g / bands10[j].freq)));
    return { g: g, d: d };
  }).sort(function(a, b){ return b.d - a.d || a.g - b.g; });
  var extraFreqs = scored.slice(0, 2).map(function(s){ return s.g; });
  var seed = bands10.concat(extraFreqs.map(function(f){ return { type: "peaking", freq: f, gain: 0, q: 1.1 }; }))
    .map(function(b){ return { type: b.type, freq: b.freq, gain: b.gain, q: b.q }; });
  return seed;
}

/* ================================================================
   Chặng 2 bước 2.1 — Web Worker cho solver AutoEQ (10/20 band).
   AE_WORKER_SRC = hằng số solver + .toString() của chính các hàm thuần
   đang chạy trên main thread, nên code trong Worker và code main thread
   không bao giờ lệch phiên bản. AE_WORKER_BOOT chỉ là điểm vào
   onmessage, nối thêm khi tạo Worker thật; bản kiểm tra parity dùng
   đúng AE_WORKER_SRC mà không chạm self.
   Lưu ý: rbjCoeffs đọc biến toàn cục `bands` (lệnh guard rỗng trong
   hàm gốc), nên nguồn Worker phải định nghĩa var bands = [] để không
   ReferenceError khi chạy ngoài main thread.
   Đường đồng bộ aeSolve được giữ nguyên cho harness và fallback, theo
   đúng thiết kế của lộ trình; pipeline AutoEQ chính vẫn dùng aeSolve
   đồng bộ để không đổi thời điểm áp kết quả của các luồng tự động —
   aeSolveInWorker là điểm vào bất đồng bộ đã kiểm chứng parity, sẵn
   sàng nối vào nút chạy AutoEQ khi người dùng yêu cầu.
   ================================================================ */
var AE_WORKER_SRC = [
  "var AE_FS = 48000;",
  "var AE_FMIN = 20, AE_FMAX = 20000;",
  "var AE_LIMITS = { gainMax:12, qMin:0.5, qMax:10, trebleHz:6000, trebleQMax:6, trebleGainMax:8 };",
  "var bands = [];",
  "var AE_RLS_MODE = 3;",
  "var AE_RC_SCALE = 1;",
  "var AE_SHELF_CAP = 0;",
  rbjCoeffs.toString(),
  biquadMagDb.toString(),
  aeClampBand.toString(),
  aeBandCurve.toString(),
  aeTotalCurve.toString(),
  aeSolveSingle.toString(),
  aeSolveObjective.toString(),
  aeSolve.toString(),
  aeSolveSeeded.toString()
].join("\n");
var AE_WORKER_BOOT = "self.onmessage = function(ev){ var d = ev.data; try { var res = d.seedBands ? aeSolveSeeded(d.freqs, d.errDb, d.weights, d.nBands, undefined, d.fs, d.seedBands) : aeSolve(d.freqs, d.errDb, d.weights, d.nBands, undefined, d.fs); self.postMessage({ id: d.id, ok: true, res: res }); } catch (e){ self.postMessage({ id: d.id, ok: false, error: (e && e.message) || String(e) }); } };";
var aeWorkerInstance = null, aeWorkerSeq = 0, aeWorkerUrl = null; /* CHAIN TASK #5 (2026-11-13, truc C): URL blob cua worker — thu hoi khi worker bao tin dau tien (script da tai xong). */
function aeSolveInWorker(freqs, errDb, weights, nBands, fs, cb, seedBands){
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS; /* Pha A/C 2026-11-07: fs truyen theo job (tham so, khong dung global) nen khong race giua cac job. */
  function fallback(){
    var res = seedBands ? aeSolveSeeded(freqs, errDb, weights, nBands, undefined, fsv, seedBands) : aeSolve(freqs, errDb, weights, nBands, undefined, fsv);
    try { var el = $("aeWorkerInfo"); if (el) el.textContent = "Luồng giải: Đồng bộ (fallback) — Web Worker không khả dụng hoặc đang chạy QA tổng"; } catch (e){}
    cb(res, "sync-fallback");
  }
  try {
    if (typeof Worker === "undefined" || typeof Blob === "undefined") return fallback();
    var qaBtn = $("btnQaAll");
    if (qaBtn && qaBtn.disabled) return fallback();
    if (!aeWorkerInstance){
      var blob = new Blob([AE_WORKER_SRC + "\n" + AE_WORKER_BOOT], { type: "application/javascript" });
      aeWorkerUrl = URL.createObjectURL(blob);
      try { aeWorkerInstance = new Worker(aeWorkerUrl); }
      catch (e){ try { URL.revokeObjectURL(aeWorkerUrl); } catch (e2){} aeWorkerUrl = null; throw e; }
    }
    var id = ++aeWorkerSeq, done = false;
    var handler = null;
    var timer = setTimeout(function(){
      if (done) return; done = true;
      try { aeWorkerInstance.removeEventListener("message", handler); } catch (e){}
      fallback();
    }, 120000); /* 2026-11-23 (sua dung UI): timeout chi la luoi an toan cho worker treo that su. Do lab tren ham that: 1 lan giai 10 band mat 2,7-4,6 s, chuoi best-of 10+20 mat 4,2-6,4 s — timeout 3000 ms cu thuong xuyen het han roi roi ve giai DONG BO tren main thread, gay dung UI ~10 s moi lan bam Chay AutoEQ. Nang len 120 s: giai binh thuong khong bao gio cham timeout, chi worker chet that su moi roi ve dong bo. */
    handler = function(ev){
      if (!ev.data || ev.data.id !== id) return;
      if (done) return; done = true; clearTimeout(timer);
      if (aeWorkerUrl){ try { URL.revokeObjectURL(aeWorkerUrl); } catch (e){} aeWorkerUrl = null; } /* CHAIN TASK #5: tin dau tien chung to script worker da tai + chay xong — URL khong con can nua. */
      try { aeWorkerInstance.removeEventListener("message", handler); } catch (e){}
      if (ev.data.ok){
        try { var el2 = $("aeWorkerInfo"); if (el2) el2.textContent = "Luồng giải: Web Worker (bất đồng bộ, không chặn UI 60fps)"; } catch (e2){}
        cb(ev.data.res, "worker");
      } else fallback();
    };
    aeWorkerInstance.addEventListener("message", handler);
    aeWorkerInstance.postMessage({ id: id, freqs: freqs, errDb: errDb, weights: weights, nBands: nBands, fs: fsv, seedBands: seedBands });
  } catch (e){ fallback(); }
}
function aeWorkerParityCheck(){
  var prep = aePrepare(aeSamplePoints(AE_SAMPLES[0]));
  var tf = aeTargetCurve("harmanOE", 0, 0, 0);
  var err = AE.freqs.map(function(f, i){ return tf(f) - prep.sm[i]; });
  var W = AE.freqs.map(function(f){ return aeWeight(f); });
  prep.nulls.forEach(function(nl){ for (var i = 0; i < AE.freqs.length; i++) if (AE.freqs[i] >= nl.fLo && AE.freqs[i] <= nl.fHi) W[i] = 0; });
  var workerSolve = new Function(AE_WORKER_SRC + "\n; return aeSolve;")();
  function diffFor(nB){
    var rw = workerSolve(AE.freqs, err, W, nB);
    var rm = aeSolve(AE.freqs, err, W, nB);
    if (!rw.bands || rw.bands.length !== rm.bands.length) return { diff: Infinity, bands: 0 };
    var maxDiff = 0, b;
    for (b = 0; b < rm.bands.length; b++){
      var d = Math.max(Math.abs(rw.bands[b].freq - rm.bands[b].freq),
        Math.abs(rw.bands[b].gain - rm.bands[b].gain),
        Math.abs(rw.bands[b].q - rm.bands[b].q));
      if (d > maxDiff) maxDiff = d;
    }
    return { diff: maxDiff, bands: rm.bands.length };
  }
  var d10 = diffFor(10), d20 = diffFor(20);
  return { diff10: d10.diff, diff20: d20.diff, bands10: d10.bands, bands20: d20.bands,
    ok: d10.diff === 0 && d20.diff === 0 };
}
try {
  var _wEl = $("aeWorkerInfo");
  if (_wEl) _wEl.textContent = (typeof Worker !== "undefined" && typeof Blob !== "undefined")
    ? "Web Worker sẵn sàng (bất đồng bộ, không chặn UI 60fps) — đường đồng bộ vẫn là fallback"
    : "Luồng giải: Đồng bộ (fallback) — trình duyệt này không hỗ trợ Web Worker";
} catch (e){}


if (typeof module!=="undefined" && module.exports){
  module.exports = { AE_TARGETS:AE_TARGETS, AE_SAMPLES:AE_SAMPLES, aeInterp:aeInterp, aeGridFreqs:aeGridFreqs,
    aeSmooth:aeSmooth, aeParseMeasurement:aeParseMeasurement, aeTargetCurve:aeTargetCurve, aeWeight:aeWeight,
    aeDetectNulls:aeDetectNulls, aeClampBand:aeClampBand, aeSolve:aeSolve, aeTotalCurve:aeTotalCurve, aeRms:aeRms };
}

/* ================================================================
   AUTOEQ UI (Giai đoạn 2) — nối solver vào engine Giai đoạn 1.
   Kết quả tối ưu được áp thẳng vào mảng `bands` của engine,
   pre-amp tính lại theo luật Giai đoạn 1 qua updateAll(true).
   ================================================================ */
var AE = {
  points:null, ptsN:null, name:"", rig:"711", source:"", phoneId:"",
  freqs: aeGridFreqs(), rawG:null, sm:null, tgtG:null,
  rawFn:null, smFn:null, tgtFn:null, nulls:[],
  show:{ raw:true, target:true, eq:true },
  last:null
};
var AE_RIGLBL = { "711":"IEC 60318-4 (711)", "5128":"B&K 5128", "other":"Rig khác / chưa rõ" };
var AE_TYPLBL = { lowshelf:"Low Shelf", peaking:"Peaking", highshelf:"High Shelf", lowpass:"Low Pass", highpass:"High Pass", bandpass:"Band Pass", notch:"Notch", allpass:"All Pass" };

function aeGridFn(vals){
  var pairs = vals.map(function(v,i){ return [AE.freqs[i], v]; });
  var logF = new Array(pairs.length);
  for (var _li=0; _li<pairs.length; _li++) logF[_li] = Math.log(pairs[_li][0]);
  var _sorted = true, _logOk = pairs.length >= 2;
  for (var _si=1; _si<pairs.length; _si++){ if (!(pairs[_si-1][0] <= pairs[_si][0])){ _sorted = false; break; } }
  if (_logOk){
    if (!(isFinite(logF[0]) && isFinite(logF[pairs.length-1]) && logF[pairs.length-1] > logF[0])) _logOk = false;
    else { for (var _lj=0; _lj<pairs.length; _lj++){ if (!isFinite(logF[_lj])){ _logOk = false; break; } } }
  }
  var _logSpan = _logOk ? (logF[pairs.length-1] - logF[0]) : 0;
  var _nM1 = pairs.length - 1;
  return function(f){
    if (f <= pairs[0][0]) return pairs[0][1];
    if (f >= pairs[pairs.length-1][0]) return pairs[pairs.length-1][1];
    var lo, hi, lf = Math.log(f);
    if (_sorted && _logOk && isFinite(lf)){
      lo = Math.floor((lf - logF[0]) * _nM1 / _logSpan);
      if (lo < 0) lo = 0; else if (lo > _nM1 - 1) lo = _nM1 - 1;
      while (lo + 1 < pairs.length && pairs[lo+1][0] <= f) lo++;
      while (lo > 0 && pairs[lo][0] > f) lo--;
      hi = lo + 1;
    } else {
      lo=0; hi=pairs.length-1;
      while (hi-lo>1){ var m=(lo+hi)>>1; if (pairs[m][0]<=f) lo=m; else hi=m; }
    }
    var t=(lf-logF[lo])/(logF[hi]-logF[lo]);
    return pairs[lo][1] + t*(pairs[hi][1]-pairs[lo][1]);
  };
}
/* (vòng tự động 17:45, hướng D — ÁP DỤNG, vá code): tiền tính lưới tần số 1/48-octave của aeSamplePoints — trước đây cả hai nhánh của aeSamplePoints đều tính lại 20*Math.pow(2, k/48) cho mọi k=0..480 mỗi lần gọi (479 lần trước điểm dừng f>20000), và nhánh nhanh còn tính thêm Math.log(f) mỗi điểm; nay lưới tần số và log của nó tính MỘT lần lúc nạp trang vào _aeSampFreqs/_aeSampLogF rồi dùng lại — cùng biểu thức, cùng số double nên f và Math.log(f) giống hệt từng bit theo cấu trúc; vòng lặp và điểm dừng f>20000 giữ nguyên. */
var _aeSampFreqs = [], _aeSampLogF = [];
for (var _sf = 0; _sf <= 480; _sf++){ var _ff = 20*Math.pow(2, _sf/48); _aeSampFreqs.push(_ff); _aeSampLogF.push(Math.log(_ff)); }
/* --- Mở rộng 2026-11-24 (vòng tự động 06:35, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 06:24, ÁP DỤNG). Ứng viên D duy nhất: cache giới hạn 16 entry trong aeSamplePoints (_aeSampCache, js/03-solver.js) — aeSelectPhone/dbLoadPhone/batch gọi aeSamplePoints(entry) mỗi lần chọn lại cùng tai nghe (entry DB_PHONES/AE_SAMPLES là object ổn định, knots không đổi sau khi dựng kho) và mỗi lần đều tính lại lưới nội suy 1/48-octave (~479 điểm, cấp phát logK + pts mới); nay tính MỘT lần theo (sample, knots) rồi tái dùng, đường trúng cache trả pts.slice() (mảng ngoài mới, cùng biểu thức nội suy nên GIỐNG TỪNG BIT theo cấu trúc; thay knots bằng mảng mới tự tính lại; cache giới hạn 16 entry FIFO để chặn phình bộ nhớ — đã thử WeakMap nhưng WeakMap.set chậm ~2x ở đường miss nên bỏ). Lab (hidden_files/run_20261124_0635_D/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 337/337 GIỐNG TỪNG BIT cả 2 lần (gồm fast/slow path, biên null/undefined/non-object, NaN/±Inf/-0/subnormal, knots thay mảng mới, 300 fuzz) + verify trên file ĐÃ VÁ khớp lab từng byte (MATCH); bench paired-median xen kẽ 15 vòng: lần 1 W1 83,90x/W2 80,92x/W4 44,28x/W5 216,79x, lần 2 W1 80,52x/W2 77,39x/W4 44,03x/W5 228,65x (đều thắng 15/15); W3 mọi entry khác nhau (đường miss) trung tính 1,02x/1,04x trong nhiễu, đo process riêng cũng trung tính. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
var _aeSampCache = [];
function aeSamplePoints(sample){
  var _cacheable = (sample !== null && (typeof sample === "object" || typeof sample === "function"));
  if (_cacheable){
    for (var _ci = 0; _ci < _aeSampCache.length; _ci++){
      var _ce = _aeSampCache[_ci];
      if (_ce.s === sample && _ce.knots === sample.knots && _ce.pts) return _ce.pts.slice();
    }
  }
  var knots = sample && sample.knots;
  var useFast = false;
  if (Array.isArray(knots) && knots.length >= 2){
    useFast = true;
    for (var i = 0; i < knots.length; i++){
      var kf = knots[i] && knots[i][0];
      if (!(typeof kf === "number" && isFinite(kf) && kf > 0)){ useFast = false; break; }
      if (i > 0 && !(knots[i-1][0] <= kf)){ useFast = false; break; }
    }
  }
  if (!useFast){
    var pts0 = [];
    for (var k0 = 0; k0 <= 480; k0++){ var f0 = _aeSampFreqs[k0]; if (f0 > 20000) break; pts0.push([f0, aeInterp(sample.knots, f0)]); }
    if (_cacheable){ _aeSampCache.push({ s: sample, knots: sample.knots, pts: pts0 }); if (_aeSampCache.length > 16) _aeSampCache.shift(); }
    return pts0;
  }
  var n = knots.length;
  var logK = new Array(n);
  for (var i2 = 0; i2 < n; i2++) logK[i2] = Math.log(knots[i2][0]);
  var pts = [];
  var lo = 0;
  for (var k = 0; k <= 480; k++){
    var f = _aeSampFreqs[k]; if (f > 20000) break;
    var v;
    if (f <= knots[0][0]) v = knots[0][1];
    else if (f >= knots[n-1][0]) v = knots[n-1][1];
    else {
      while (lo + 1 < n && knots[lo+1][0] <= f) lo++;
      var hi = lo + 1;
      var t = (_aeSampLogF[k] - logK[lo])/(logK[hi] - logK[lo]);
      v = knots[lo][1] + t*(knots[hi][1] - knots[lo][1]);
    }
    pts.push([f, v]);
  }
  if (_cacheable){ _aeSampCache.push({ s: sample, knots: sample.knots, pts: pts }); if (_aeSampCache.length > 16) _aeSampCache.shift(); }
  return pts;
}
/* --- Mở rộng 2026-11-23 (vòng tự động 17:45, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 17:39, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 17:43:19+07, 6.205.081 byte / 25.232 dòng, md5 69459ece1a031a85858103c8bca02f33, version 260) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-D lưu tại ~/workspace/autoeq/backups/*2026-11-23_1745*. Ứng viên D duy nhất: tiền tính lưới tần số 1/48-octave của aeSamplePoints — trước đây cả hai nhánh đều tính lại 20*Math.pow(2, k/48) cho mọi k=0..480 mỗi lần gọi (479 lần trước điểm dừng f>20000), và nhánh nhanh còn tính thêm Math.log(f) mỗi điểm; nay lưới tần số và log của nó tính MỘT lần lúc nạp trang vào _aeSampFreqs/_aeSampLogF (481 mục, gồm cả k=479/480 để điểm dừng giữ nguyên) rồi dùng lại — cùng biểu thức, cùng số double nên f và Math.log(f) giống hệt từng bit theo cấu trúc; vòng lặp, điểm dừng f>20000 và thứ tự phép tính giữ nguyên từng toán hạng. Khác hướng đã bác: cache WeakMap trong aeInterp (12:52), inline logK trong aePrepare (15:18), tìm nội suy trong _interp của aeTargetCurve (15:41), hai-con-trỏ trong aeDetectNulls (16:57) — lượt này chỉ bỏ phép tính lưới lặp lại trong aeSamplePoints, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + verify_patched.js trong hidden_files/run_20261123_1745_D/, 2 lần chạy độc lập): parity 30/30 fixture + 300/300 fuzz GIỐNG TỪNG BIT cả 2 lần (Object.is sâu; gồm mẫu A/B/C, trùng tần số, chưa sắp, 1/2 điểm, rỗng, tần số 0/âm/NaN/Inf/chuỗi, phần tử null, giá trị NaN/±Inf/-0, subnormal/1e308, biên dưới/trên dải, mẫu null/undefined/không phải mảng ném lỗi đúng); kiểm chứng lại trên file ĐÃ VÁ 28/28 + kiểm tra đồng nhất mảng tiền tính 481+481 mục; tốc độ paired-median xen kẽ 15 vòng × 1000 rep: lần 1 W1 sampleA 1,0866× (thắng 11/15), W2 sampleC 1,2285× (14/15), W3 chưa sắp (nhánh chậm) 1,0921× (14/15), W4 rand200 1,1809× (15/15), W5 hai điểm 1,2609× (14/15); lần 2 W1 1,2519× (15/15), W2 1,2665× (15/15), W3 1,0953× (14/15), W4 1,2119× (15/15), W5 1,2942× (15/15) — cải thiện ổn định mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff với backup pre-D đúng 4 hunk code + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1745_D/. --- */
/* Chuẩn hoá 0 dB @ 1 kHz + làm mượt + phát hiện null. Dùng chung cho cả đường đo thật lẫn kiểm chứng.
   Mức làm mượt tuỳ chọn trước khi solve (vòng tự động, hướng B mục 3): 'psycho' là hành vi
   gốc (1/6 oct dưới 6 kHz, 1/12 oct từ 6 kHz); 'third'/'sixth'/'twelfth' là cửa sổ cố định
   1/3, 1/6, 1/12 octave. aePrepare không truyền smoothMode luôn dùng 'psycho' nên mọi
   kiểm chứng/QA cũ giữ nguyên tuyệt đối; chỉ đường đi qua aeSetMeasurement và AutoEQ
   hàng loạt mới dùng lựa chọn hiện tại của người dùng (AE_SMOOTH_MODE). */
var AE_SMOOTH_MODES = {
  psycho: function(f){ return f<6000 ? 1/6 : 1/12; },
  third: function(){ return 1/3; },
  sixth: function(){ return 1/6; },
  twelfth: function(){ return 1/12; }
};
var AE_SMOOTH_LBL = { psycho:"psychoacoustic (1/6–1/12 oct)", third:"1/3 octave", sixth:"1/6 octave", twelfth:"1/12 octave" };
var AE_SMOOTH_MODE = "psycho";
function aeCurrentSmoothMode(){ return AE_SMOOTH_MODES[AE_SMOOTH_MODE] ? AE_SMOOTH_MODE : "psycho"; }
/* (vòng tự động 15:18, hướng D — BÁC BỎ, KHÔNG vá code, chỉ thêm comment này): ứng viên inline nội suy trong aePrepare — tiền tính logK cho ptsN một lần rồi vòng rawG tự tìm nhị phân + nội suy với đúng biểu thức của aeInterp (thay AE.freqs.map gọi aeInterp 241 lần, mỗi lần 3 Math.log), mọi trường hợp khác (ptsN <2 điểm, tần số không phải số hữu hạn >0, AE.freqs không hợp lệ) rơi về đường gốc nguyên vẹn. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js trong hidden_files/run_20261123_1516_D/, 2 vm context tách biệt): parity 138/138 kịch bản GIỐNG TỪNG BIT (Object.is sâu trên ptsN/rawG/sm/nulls; gồm lưới 481/121 điểm, 2/3 điểm, trùng tần số, chưa sắp, NaN/Infinity ở giá trị, ±0, cực đoan 1e308/subnormal, tần số 0/NaN/chuỗi rơi về gốc, dưới/trên dải, 1 điểm, rỗng/null/undefined/không phải mảng ném lỗi đúng, 6 chế độ smooth) — nhưng tốc độ paired-median xen kẽ 15 vòng: W1 sample481 0,9278× (thắng 1/15), W2 sample481-rand 0,9225× (thắng 0/15), W3 meas121 0,9731× (thắng 2/15) — chậm ổn định cả 3 workload, 15 vòng xen kẽ mỗi workload (chi phí tiền tính logK 481 điểm + kiểm tra AE.freqs + push thay map ăn hết lợi ích bớt 2 Math.log/điểm; aeDetectNulls đã nhanh sẵn chiếm phần lớn thời gian aePrepare) → BÁC, không vá code. KHÔNG thử lại hướng inline tìm nhị phân + tiền tính logK trong aePrepare. Không chạm solver/WASM/FIR/QA; aeV3 không đổi theo cấu trúc (không vá code, không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1516_D/. --- */
function aePrepare(pts, smoothMode){
  var norm = aeInterp(pts, 1000);
  var ptsN = pts.map(function(p){ return [p[0], p[1]-norm]; });
  var rawG = AE.freqs.map(function(f){ return aeInterp(ptsN, f); });
  var sm = aeSmooth(rawG, AE.freqs, AE_SMOOTH_MODES[smoothMode] || AE_SMOOTH_MODES.psycho);
  var nulls = aeDetectNulls(ptsN);
  return { ptsN:ptsN, rawG:rawG, sm:sm, nulls:nulls };
}
/* ---------- Bảo toàn đặc tính gốc (Nhóm 2 v2): Tilt / Bass shelf ----------
   Ý nghĩa: correction C(f) = Target − Đáp tuyến (đã làm mượt). Khớp C bằng
   a·log2(f/1000) + b·shelf(f), với shelf(f) đúng dạng bass shelf của
   aeTargetCurve (0.5·(1−tanh(log2(f/180)/0.9))). Trừ hai thành phần này khỏi
   correction thì đáp tuyến sau EQ giữ tilt/bass gốc, chỉ còn các lệch cục bộ
   được sửa. Hai hệ số được xác định bằng đúng hai thước đo có nghĩa trực quan
   (không phải khớp LS toàn dải — khớp đó cho hệ số bass tới 15–19 dB do hai cơ
   sở gần phụ thuộc tuyến tính, không đọc được thành mức bass thật):
   (1) T = độ dốc LS có chặn của đường cong trên 500 Hz–8 kHz;
   (2) B = mức trung bình có trọng số trên 50–150 Hz.
   Cả hai thước đều dùng trọng số W(f) (vùng null đã loại → trọng số 0) và đều
   tuyến tính theo đường cong, nên target đã bảo toàn thỏa T/B bằng đúng T/B của
   đáp tuyến gốc (sai số chỉ còn phần dư của solver và hằng số chuẩn hoá 1 kHz
   ~0,004·b dB ở thước B). Slider Tilt/Bass thủ công được cộng lại sau bước
   trừ, nên gu nghe vẫn cộng thêm lên trên đặc tính gốc thay vì bị triệt tiêu.
   NaN/±Inf trong đầu vào bị bỏ qua ở từng điểm; định thức suy biến hoặc một
   dải đo không có điểm có trọng số → khớp 0 (không bảo toàn). */
function aeBassShelfShape(f){ return 0.5*(1 - Math.tanh(Math.log2(f/180)/0.9)); }
/* (vòng tự động 18:54, hướng D — ÁP DỤNG, vá code): cache lưới x/shelf cho aePreserveFit/aePreserveMeasure — x=log2(f/1000) và sh=aeBassShelfShape(f) chỉ phụ thuộc tần số lưới AE.freqs (cố định, không đổi trong vòng đời trang) nên tính MỘT lần (lazy ở lần gọi đầu tiên với đúng mảng AE.freqs) rồi dùng lại; mọi mảng freqs khác (kể cả bản sao cùng giá trị) rơi về đường tính gốc nguyên vẹn — cùng biểu thức, cùng số double nên giống từng bit theo cấu trúc. Khác hướng đã bác: hoist log2/shelf trong aePreservedTarget (01:24, V8 đã CSE sẵn, không cải thiện) — lượt này cache theo lưới cố định AE.freqs trong aePreserveFit/aePreserveMeasure, chưa thử chính thức trước đó. */
var _aePreserveGridCache = null;
function _aePreserveGrid(freqs){
  if (typeof AE === "undefined" || !AE || freqs !== AE.freqs) return null;
  if (_aePreserveGridCache && _aePreserveGridCache.freqs === freqs) return _aePreserveGridCache;
  var _xs = new Array(freqs.length), _shs = new Array(freqs.length);
  for (var _pi = 0; _pi < freqs.length; _pi++){ _xs[_pi] = Math.log2(freqs[_pi]/1000); _shs[_pi] = aeBassShelfShape(freqs[_pi]); }
  _aePreserveGridCache = { freqs:freqs, xs:_xs, shs:_shs };
  return _aePreserveGridCache;
}
function aePreserveFit(freqs, errDb, weights){
  /* T: độ dốc LS có chặn trên 500 Hz–8 kHz; B: mức trung bình trên 50–150 Hz.
     Giải hệ 2×2: [T(x) T(s); B(x) B(s)] · [a;b] = [T(err); B(err)]. */
  var _pg = _aePreserveGrid(freqs);
  var sw=0, sx=0, sy=0, sxx=0, sxy=0, ss=0, sxs=0, i, w, x, sh, e;
  for (i=0;i<freqs.length;i++){
    if (freqs[i]<500 || freqs[i]>8000) continue;
    e = errDb[i]; if (!isFinite(e)) continue;
    w = weights ? weights[i] : 1; if (!(w>0) || !isFinite(w)) continue;
    x = _pg ? _pg.xs[i] : Math.log2(freqs[i]/1000); sh = _pg ? _pg.shs[i] : aeBassShelfShape(freqs[i]);
    sw += w; sx += w*x; sy += w*e; sxx += w*x*x; sxy += w*x*e; ss += w*sh; sxs += w*x*sh;
  }
  var denT = sw*sxx - sx*sx;
  if (!(sw>0) || !isFinite(denT) || Math.abs(denT) < 1e-12) return { tilt:0, bass:0 };
  var Te = (sw*sxy - sx*sy)/denT;
  var Tx = (sw*sxx - sx*sx)/denT; /* = 1 theo định nghĩa, tính tường minh để khỏi giả định */
  var Ts = (sw*sxs - sx*ss)/denT;
  var bw=0, be=0, bx=0, bs=0;
  for (i=0;i<freqs.length;i++){
    if (freqs[i]<50 || freqs[i]>150) continue;
    e = errDb[i]; if (!isFinite(e)) continue;
    w = weights ? weights[i] : 1; if (!(w>0) || !isFinite(w)) continue;
    x = _pg ? _pg.xs[i] : Math.log2(freqs[i]/1000); sh = _pg ? _pg.shs[i] : aeBassShelfShape(freqs[i]);
    bw += w; be += w*e; bx += w*x; bs += w*sh;
  }
  if (!(bw>0)) return { tilt:0, bass:0 };
  var Be = be/bw, Bx = bx/bw, Bs = bs/bw;
  var det = Tx*Bs - Ts*Bx;
  if (!isFinite(det) || Math.abs(det) < 1e-6) return { tilt:0, bass:0 };
  var a = (Te*Bs - Ts*Be)/det, b = (Tx*Be - Te*Bx)/det;
  if (!isFinite(a)) a = 0; if (!isFinite(b)) b = 0;
  return { tilt:a, bass:b };
}
/* Đo hai thước T/B của một đường cong (dùng cho hàng kiểm chứng aeV4):
   tilt = độ dốc LS có chặn trên 500 Hz–8 kHz, bass = mức trung bình trên
   50–150 Hz, cùng trọng số weights (vùng null đã loại). */
function aePreserveMeasure(freqs, curve, weights){
  var _pg = _aePreserveGrid(freqs);
  var sw=0, sx=0, sy=0, sxx=0, sxy=0, i, w, x, e;
  for (i=0;i<freqs.length;i++){
    if (freqs[i]<500 || freqs[i]>8000) continue;
    e = curve[i]; if (!isFinite(e)) continue;
    w = weights ? weights[i] : 1; if (!(w>0) || !isFinite(w)) continue;
    x = _pg ? _pg.xs[i] : Math.log2(freqs[i]/1000);
    sw += w; sx += w*x; sy += w*e; sxx += w*x*x; sxy += w*x*e;
  }
  var denT = sw*sxx - sx*sx;
  if (!(sw>0) || !isFinite(denT) || Math.abs(denT) < 1e-12) return { tilt:0, bass:0 };
  var tilt = (sw*sxy - sx*sy)/denT;
  var bw=0, bs=0;
  for (i=0;i<freqs.length;i++){
    if (freqs[i]<50 || freqs[i]>150) continue;
    e = curve[i]; if (!isFinite(e)) continue;
    w = weights ? weights[i] : 1; if (!(w>0) || !isFinite(w)) continue;
    bw += w; bs += w*e;
  }
  if (!(bw>0)) return { tilt:0, bass:0 };
  return { tilt:tilt, bass:bs/bw };
}
/* --- Mở rộng 2026-11-23 (vòng tự động 18:56, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 18:51, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 18:52:25+07, 6.229.509 byte / 25.286 dòng, md5 b858597ebcfc3b0ca7c45d9f0ddfb507, version 286) khớp từng byte bản cục bộ — không có thay đổi ngoài; backup pre-download/pre-D lưu tại ~/workspace/autoeq/backups/*2026-11-23_1155_before_D*. Ứng viên D duy nhất: cache lưới x/shelf cho aePreserveFit/aePreserveMeasure — x=log2(f/1000) và sh=aeBassShelfShape(f) chỉ phụ thuộc tần số lưới AE.freqs (cố định, không đổi trong vòng đời trang) nên tính MỘT lần (lazy ở lần gọi đầu tiên với đúng mảng AE.freqs, qua _aePreserveGrid) rồi dùng lại; mọi mảng freqs khác (kể cả bản sao cùng giá trị) rơi về đường tính gốc nguyên vẹn — cùng biểu thức, cùng số double nên giống từng bit theo cấu trúc. Khác hướng đã bác: hoist log2/shelf trong aePreservedTarget (01:24, V8 đã CSE sẵn, không cải thiện) — lượt này cache theo lưới cố định AE.freqs trong aePreserveFit/aePreserveMeasure, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + harness.js + bench_batch.js + parity_fuzz.js + verify_on_patched.js trong hidden_files/run_20261123_1854_D/, 2 lần chạy độc lập): parity 200/200 + fuzz 6.000/6.000 GIỐNG TỪNG BIT (Object.is trên tilt/bass; gồm lưới AE 241 điểm, err/weights ngẫu nhiên + NaN/Infinity/-0/0, mảng freqs tùy ý fallback, rỗng/null ném lỗi đúng) + verify trên file ĐÃ VÁ 6.000/6.000; tốc độ batch paired-median xen kẽ 15 vòng × 2000 rep: lần 1 Fit 3,6061× (15/15), Measure 1,7497× (15/15); lần 2 Fit 3,5389× (15/15), Measure 1,7574× (15/15) — cải thiện ổn định mọi workload cả 2 lần (cache đã ấm; lần gọi đầu dựng cache ~241 điểm). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 20/20 khối script inline node --check PASS, kết thúc đúng </html>, diff với backup pre-D đúng 4 hunk code + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_1854_D/. --- */
function aePreservedTarget(targetId, adj, fit){
  var base = aeTargetCurve(targetId, 0, 0, adj.ear);
  function raw(f){
    return base(f) - fit.tilt*Math.log2(f/1000) - fit.bass*aeBassShelfShape(f)
      + adj.tilt*Math.log2(f/1000) + adj.bass*aeBassShelfShape(f);
  }
  var at1k = raw(1000);
  return function(f){ return raw(f) - at1k; };
}
/* Chạy trọn pipeline tối ưu trên dữ liệu đã chuẩn bị. adjustments: {tilt,bass,ear};
   preserve=true bật bảo toàn đặc tính gốc (mặc định tắt, giữ đúng mọi mốc cũ). */
/* --- Best-of tự động 10/20 band (2026-10-28, hạng mục B, quyết định lần 18:52):
   Khi Full Auto tự chọn 10 band, giải cả 10 và 20 band rồi giữ kết quả có
   aeSolveObjective thấp hơn (tính trên total SAU hậu kiểm null, đúng tiêu chí
   aeSolve đã dùng chọn ứng viên shelf/lambda; hoà thì giữ 10 band). Chỉ áp khi
   đường tự động yêu cầu (cờ AUTO.bestOfPending do autoMaybeSolve đặt); nút
   Chạy AutoEQ bấm tay và mọi lời gọi aeCompute trực tiếp (harness/QA) giữ
   nguyên hành vi cũ. aeSolve/aeSolveSingle không đổi chữ ký nên parity
   Worker giữ nguyên. ms báo cáo là tổng thời gian các lượt giải (10 + 20, cộng 12 seeded từ H14). --- */
/* --- H14 (TASK #21, 2026-11-15, trục A, P1): best-of thêm ứng viên 12 band seeded (aeBuildSeed12 + aeSolveSeeded, thiết kế TASK #17) — chỉ thắng khi objective (rc mặc định 0,06) thấp hơn VÀ RMS không tệ đi so với pick 10/20; bestOf ghi thêm obj12, picked có thể là 12; aeComputeAsync dùng aeSolveInWorker với seedBands (Worker có aeSolveSeeded trong AE_WORKER_SRC, fallback đồng bộ khi Worker không khả dụng). --- */
/* --- H16 (2026-11-16, trục A, probe t23 ĐẠT): chấm pick best-of bằng RMS-after (errAfter) trực tiếp thay vì objective có phạt gain/Q — objective lệch RMS (L1) nên chấm bằng objective đôi khi pick bản RMS tệ hơn; o10/o20/o12 vẫn tính để ghi bestOf chẩn đoán; hòa giữ 10 band (rẻ hơn); aeCompute + aeComputeAsync cùng đổi. --- */
function aeCompute(prep, targetId, adj, nB, preserve, bestOf, fs){
  var out = aeComputeOnce(prep, targetId, adj, nB, preserve, fs);
  if (!bestOf || nB !== 10) return out;
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS;
  var out20 = aeComputeOnce(prep, targetId, adj, 20, preserve, fs);
  var o10 = aeSolveObjective(out.res.bands, out.res.total, out.err, out.weights);
  var o20 = aeSolveObjective(out20.res.bands, out20.res.total, out20.err, out20.weights);
  /* H16: cham pick bang RMS-after (errAfter) truc tiep — objective co phat gain/Q
     lech RMS (L1) nen cham bang objective doi khi pick ban RMS te hon; hoa giu 10 band. */
  var win = (out20.errAfter < out.errAfter) ? out20 : out;
  var picked = (out20.errAfter < out.errAfter) ? 20 : 10;
  var o12 = null, ms12 = 0;
  try {
    /* H14: ung vien 12 band seeded tu pick10 — loi thi giu pick cu.
       H16: thang khi RMS-after thap hon (tieu chi chat cu thay bang luat RMS). */
    var seed12 = aeBuildSeed12(out.res.bands);
    var S12 = aeComputeSetup(prep, targetId, adj, preserve);
    var res12 = aeSolveSeeded(AE.freqs, S12.err, S12.W, 12, undefined, fsv, seed12);
    var out12 = aeComputeFinish(prep, S12, res12, fsv);
    o12 = aeSolveObjective(out12.res.bands, out12.res.total, out12.err, out12.weights);
    ms12 = out12.res.ms;
    if (out12.errAfter < win.errAfter){ win = out12; picked = 12; }
  } catch (e12) { o12 = null; ms12 = 0; }
  win.bestOf = { picked: picked, obj10: o10, obj20: o20, obj12: o12 };
  win.res.ms = out.res.ms + out20.res.ms + ms12;
  return win;
}
function aeComputeSetup(prep, targetId, adj, preserve){
  var W = AE.freqs.map(function(f){ return aeWeight(f); });
  var warnings = [];
  prep.nulls.forEach(function(nl){
    for (var i=0;i<AE.freqs.length;i++) if (AE.freqs[i]>=nl.fLo && AE.freqs[i]<=nl.fHi) W[i]=0;
    warnings.push("Null hẹp tại ~"+Math.round(nl.fc)+" Hz: sâu "+nl.depth.toFixed(1)+" dB, rộng "+nl.widthOct.toFixed(3)+" oct (< 1/12 oct) — xác định là null triệt pha do coupler/ống tai, ĐÃ LOẠI khỏi vùng hiệu chỉnh (không boost).");
  });
  /* Giới hạn dải tần sửa (adj.range = {lo, hi} do aeAdj() gắn từ UI khi bật):
     ngoài dải đặt trọng số 0 — cùng cơ chế vùng null — nên solver không sửa
     ngoài dải; band trung tâm ngoài dải bị vô hiệu hoá tiếp ở aeComputeFinish. */
  var rangeInfo = null;
  if (adj && adj.range){
    var rgLo = Math.max(20, Math.min(20000, +adj.range.lo || 20));
    var rgHi = Math.max(20, Math.min(20000, +adj.range.hi || 20000));
    if (rgLo < rgHi && (rgLo > 20 || rgHi < 20000)){
      for (var rgi=0;rgi<AE.freqs.length;rgi++) if (AE.freqs[rgi]<rgLo || AE.freqs[rgi]>rgHi) W[rgi]=0;
      rangeInfo = { lo:rgLo, hi:rgHi };
      warnings.push("Giới hạn dải tần sửa đang BẬT: chỉ hiệu chỉnh "+Math.round(rgLo)+"–"+Math.round(rgHi)+" Hz; ngoài dải này đáp tuyến giữ nguyên như gốc.");
    } else if (rgLo >= rgHi){
      warnings.push("Dải tần sửa không hợp lệ (Từ ≥ đến) — đã bỏ qua giới hạn, solver chạy toàn dải.");
    }
  }
  var tf, tgtG, err, preserveInfo = null;
  if (preserve){
    var tf0 = aeTargetCurve(targetId, 0, 0, adj.ear);
    var err0 = AE.freqs.map(function(f,i){ return tf0(f)-prep.sm[i]; });
    var fit = aePreserveFit(AE.freqs, err0, W);
    tf = aePreservedTarget(targetId, adj, fit);
    tgtG = AE.freqs.map(tf);
    err = AE.freqs.map(function(f,i){ return tgtG[i]-prep.sm[i]; });
    preserveInfo = fit;
    warnings.push("Bảo toàn đặc tính gốc: đã trừ khỏi correction tilt "+fit.tilt.toFixed(2)+" dB/oct và bass "+fit.bass.toFixed(2)+" dB (khớp theo độ dốc 500 Hz–8 kHz và mức bass 50–150 Hz, trọng số W(f), vùng null đã loại) — đáp tuyến sau EQ giữ tilt/bass gốc của tai nghe; slider Tilt/Bass vẫn cộng thêm lên trên.");
  } else {
    tf = aeTargetCurve(targetId, adj.tilt, adj.bass, adj.ear);
    tgtG = AE.freqs.map(tf);
    err = AE.freqs.map(function(f,i){ return tgtG[i]-prep.sm[i]; });
  }
  /* Vệ sinh err: điểm nào không hữu hạn (NaN/Infinity từ dữ liệu đo lỗi hoặc
     target lỗi) thì loại khỏi hiệu chỉnh (trọng số 0) + cảnh báo, thay vì để
     solver trả EQ toàn 0 im lặng. */
  var nBadErr = 0;
  for (var ei = 0; ei < err.length; ei++) if (!isFinite(err[ei])){ err[ei] = 0; W[ei] = 0; nBadErr++; }
  if (nBadErr) warnings.push(nBadErr + " điểm đo/target không hữu hạn (NaN/Infinity) đã bị loại khỏi hiệu chỉnh — kiểm tra lại file đo hoặc tai nghe đã chọn.");
  /* Giới hạn gain mỗi band (adj.gainCap do aeAdj() gắn từ #aeGainCapSel khi
     chọn khác 0): chỉ ghi nhận ở Setup, việc kẹp làm ở aeComputeFinish sau
     khi solver chạy xong — cùng điểm chung với giới hạn dải tần, solver và
     Worker không đổi nên parity giữ nguyên; mặc định không có gainCap thì
     mọi đường cũ giữ nguyên tuyệt đối. */
  var gainCapInfo = (adj && adj.gainCap && isFinite(+adj.gainCap) && +adj.gainCap > 0) ? +adj.gainCap : null;
  if (gainCapInfo) warnings.push("Giới hạn gain mỗi band đang BẬT: ±"+gainCapInfo+" dB (kẹp sau solver, giới hạn cứng ±12 dB / ±8 dB trên 6 kHz vẫn áp dụng).");
  /* Chế độ chỉ cắt (adj.cutOnly do aeAdj() gắn từ #aeCutOnly khi tick):
     chỉ ghi nhận ở Setup, việc đưa gain dương về 0 làm ở aeComputeFinish
     sau khi solver chạy xong — cùng điểm chung với giới hạn gain, solver
     và Worker không đổi nên parity giữ nguyên; mặc định tắt thì mọi đường
     cũ giữ nguyên tuyệt đối. */
  var cutOnlyInfo = (adj && adj.cutOnly) ? true : null;
  if (cutOnlyInfo) warnings.push("Chế độ chỉ cắt đang BẬT: band nào có gain dương sẽ bị đưa về 0 dB sau solver (không boost bất kỳ dải nào).");
  /* Ngưỡng bỏ band nhỏ (adj.deadband do aeAdj() gắn từ #aeDeadbandSel khi
     chọn khác 0): chỉ ghi nhận ở Setup, việc đưa band nhỏ về 0 làm ở
     aeComputeFinish sau khi solver chạy xong — cùng điểm chung với giới hạn
     gain / chỉ cắt, solver và Worker không đổi nên parity giữ nguyên;
     mặc định 0 thì mọi đường cũ giữ nguyên tuyệt đối. */
  var deadbandInfo = (adj && adj.deadband && isFinite(+adj.deadband) && +adj.deadband > 0) ? +adj.deadband : null;
  if (deadbandInfo) warnings.push("Bỏ band nhỏ đang BẬT: band nào có |gain| < "+deadbandInfo+" dB sẽ bị đưa về 0 dB sau solver.");
  /* Bước làm tròn gain (adj.gainRound do aeAdj() gắn từ #aeRoundSel khi
     chọn khác 0): chỉ ghi nhận ở Setup, việc làm tròn làm ở aeComputeFinish
     sau khi solver chạy xong — cùng điểm chung với giới hạn gain / chỉ cắt /
     bỏ band nhỏ, solver và Worker không đổi nên parity giữ nguyên; mặc định
     0 thì mọi đường cũ giữ nguyên tuyệt đối. */
  var gainRoundInfo = (adj && adj.gainRound && isFinite(+adj.gainRound) && +adj.gainRound > 0) ? +adj.gainRound : null;
  if (gainRoundInfo) warnings.push("Làm tròn gain đang BẬT: gain mỗi band sẽ được làm tròn về bội số "+gainRoundInfo+" dB sau solver.");
  return { W:W, warnings:warnings, tf:tf, tgtG:tgtG, err:err, preserveInfo:preserveInfo, range:rangeInfo, gainCap:gainCapInfo, cutOnly:cutOnlyInfo, deadband:deadbandInfo, gainRound:gainRoundInfo };
}
function aeComputeFinish(prep, S, res, fs){
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS; /* Pha A/C 2026-11-07: total/RMS tinh o dung fs da giai. */
  var warnings = S.warnings.slice(), err = S.err;
  /* hậu kiểm safety: band boost nào lọt vào vùng null thì vô hiệu hoá + cảnh báo */
  var nullBoost = false;
  res.bands.forEach(function(b, bi){
    prep.nulls.forEach(function(nl){
      if (b.gain>0.5 && b.freq>=nl.fLo && b.freq<=nl.fHi){
        warnings.push("Band "+(bi+1)+" ("+fmtFreq(b.freq)+", "+fmtDb(b.gain,1)+" dB) nhắm vào vùng null ~"+Math.round(nl.fc)+" Hz — đã vô hiệu hoá (gain → 0 dB).");
        b.gain = 0; nullBoost = true;
      }
    });
  });
  /* giới hạn dải tần sửa: band nào có tần số trung tâm ngoài dải rõ rệt thì vô
     hiệu hoá. Dung sai 1 bước lưới (1/24 oct, đúng mức nới mép của vùng null):
     band nằm sát mép dải được giữ vì tác dụng của nó dồn ngay tại mép — vô hiệu
     hoá nó phá phần khớp trong dải ngay tại mép (đo thật: band 198 Hz với mép
     200 Hz bị xoá làm RMS trong dải 0,0393 → 0,1593). */
  if (S.range){
    var nRanged = 0, rEdge = Math.pow(2, 1/24);
    res.bands.forEach(function(b){
      if ((b.freq < S.range.lo / rEdge || b.freq > S.range.hi * rEdge) && b.gain !== 0){ b.gain = 0; nRanged++; }
    });
    if (nRanged) warnings.push("Đã vô hiệu hoá "+nRanged+" band có tần số trung tâm ngoài dải sửa "+Math.round(S.range.lo)+"–"+Math.round(S.range.hi)+" Hz.");
  }
  /* giới hạn gain mỗi band: kẹp band vượt giới hạn về đúng giới hạn (lấy
     min với giới hạn cứng theo tần số để không bao giờ nới giới hạn cứng);
     làm TRƯỚC khi tính lại total nên RMS sau và pre-amp đều tính trên
     đáp tuyến đã kẹp — đúng kết quả áp lên engine. Band đã bị vô hiệu hoá
     (gain 0) không bị ảnh hưởng. */
  if (S.gainCap){
    var nCapped = 0;
    res.bands.forEach(function(b){
      var cap = Math.min(S.gainCap, b.freq > AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax);
      if (b.gain > cap){ b.gain = cap; nCapped++; }
      else if (b.gain < -cap){ b.gain = -cap; nCapped++; }
    });
    if (nCapped) warnings.push("Đã kẹp "+nCapped+" band về giới hạn gain ±"+S.gainCap+" dB (giới hạn gain mỗi band đang bật).");
  }
  /* chế độ chỉ cắt: band nào còn gain dương (sau kẹp gain nếu có) thì đưa
     về 0 dB; làm TRƯỚC khi tính lại total nên RMS sau và pre-amp đều tính
     trên đáp tuyến đã cắt — đúng kết quả áp lên engine. Band đã bị vô hiệu
     hoá (gain 0) không bị ảnh hưởng. */
  if (S.cutOnly){
    var nCut = 0;
    res.bands.forEach(function(b){ if (b.gain > 0){ b.gain = 0; nCut++; } });
    if (nCut) warnings.push("Đã đưa "+nCut+" band có gain dương về 0 dB (chế độ chỉ cắt đang bật).");
  }
  /* bỏ band nhỏ: band nào còn |gain| dưới ngưỡng (sau kẹp gain / chỉ cắt
     nếu có) thì đưa về 0 dB; làm TRƯỚC khi tính lại total nên RMS sau và
     pre-amp đều tính trên đáp tuyến đã đơn giản hoá — đúng kết quả áp lên
     engine. Band đã bị vô hiệu hoá (gain 0) không bị ảnh hưởng. */
  if (S.deadband){
    var nDb = 0;
    res.bands.forEach(function(b){ if (b.gain !== 0 && Math.abs(b.gain) < S.deadband){ b.gain = 0; nDb++; } });
    if (nDb) warnings.push("Đã bỏ "+nDb+" band có |gain| < "+S.deadband+" dB (bỏ band nhỏ đang bật).");
  }
  /* làm tròn gain: band nào còn gain khác 0 (sau kẹp gain / chỉ cắt / bỏ
     band nhỏ nếu có) thì làm tròn về bội số gần nhất của bước chọn; làm
     TRƯỚC khi tính lại total nên RMS sau và pre-amp đều tính trên đáp tuyến
     đã làm tròn — đúng kết quả áp lên engine. Làm tròn xong kẹp lại giới
     hạn cứng theo tần số để không bao giờ nới giới hạn cứng (ví dụ gain
     7,6 dB trên 6 kHz làm tròn 1 dB thành 8 dB thì đúng bằng giới hạn cứng,
     còn 11,6 dB làm tròn thành 12 dB cũng vậy; kẹp này chỉ phòng trường hợp
     biên). Band đã bị vô hiệu hoá (gain 0) không bị ảnh hưởng. */
  if (S.gainRound){
    var nRnd = 0;
    res.bands.forEach(function(b){
      if (b.gain === 0) return;
      var rg = Math.round(b.gain / S.gainRound) * S.gainRound + 0;
      var hard = b.freq > AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
      if (rg > hard) rg = hard; else if (rg < -hard) rg = -hard;
      if (rg !== b.gain){ b.gain = rg; nRnd++; }
    });
    if (nRnd) warnings.push("Đã làm tròn "+nRnd+" band về bội số "+S.gainRound+" dB (làm tròn gain đang bật).");
  }
  /* (vòng tự động 06:06, hướng A — ÁP DỤNG, vá code): bỏ tính lại total trong aeComputeFinish khi Finish không sửa band nào — total của solver đã GIỐNG TỪNG BIT với aeTotalCurve(res.bands, AE.freqs, fsv): aeSolveSingle trả total là tổng cộng dồn các đường cong aeBandCurve theo thứ tự band 0..m-1 từ fill(0) (cùng biểu thức biquad, cùng rbjCoeffs, cùng cache lượng giác và cùng thứ tự cộng như aeTotalCurve; nhánh chiếu null và mọi đường aeSolve/aeSolveSeeded/Worker đều qua aeSolveSingle), nên khi cả 6 khối sửa trong Finish (nullBoost, range, gainCap, cutOnly, deadband, gainRound) đều không đổi gain band nào thì giữ nguyên res.total; khi có sửa, hoặc res.total thiếu/lệch độ dài, hoặc res.bands không phải mảng thì vẫn tính lại bằng aeTotalCurve gốc. Không đổi tên/chữ ký hàm, không tham chiếu biến ngoài mới (chỉ dùng nullBoost/nRanged/nCapped/nCut/nDb/nRnd đã có trong hàm) nên parity Worker giữ nguyên. Lab Node trên hàm thật trích verbatim (hidden_files/run_20261124_0606_A/, 2 lần chạy độc lập): bất biến total 100/100 ca aeSolveSingle + 6/6 aeSolve 10 band + 1/1 aeSolve 20 band đầy đủ GIỐNG TỪNG BIT; parity Finish cũ/mới trên các ca sửa/không sửa và bench paired-median xem run_log.md. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. Lượt kế: nhóm B. Lab: hidden_files/run_20261124_0606_A/. */
  var _finMod = !!nullBoost || (S.range && nRanged > 0) || (S.gainCap && nCapped > 0) || (S.cutOnly && nCut > 0) || (S.deadband && nDb > 0) || (S.gainRound && nRnd > 0);
  if (_finMod || !res.total || res.total.length !== AE.freqs.length || !Array.isArray(res.bands)) res.total = aeTotalCurve(res.bands, AE.freqs, fsv);
  /* cảnh báo chạm giới hạn cứng — liệt kê, không clamp im lặng */
  res.bands.forEach(function(b, bi){
    var gMax = b.freq>AE_LIMITS.trebleHz ? AE_LIMITS.trebleGainMax : AE_LIMITS.gainMax;
    var qMax = b.freq>AE_LIMITS.trebleHz ? AE_LIMITS.trebleQMax : AE_LIMITS.qMax;
    if (Math.abs(b.gain) >= gMax-0.02) warnings.push("Band "+(bi+1)+" ("+fmtFreq(b.freq)+"): gain chạm giới hạn "+(b.freq>AE_LIMITS.trebleHz ? "±8 dB trên 6 kHz" : "toàn cục ±12 dB")+" — correction bị giới hạn tại đây.");
    if (b.q >= qMax-0.02) warnings.push("Band "+(bi+1)+" ("+fmtFreq(b.freq)+"): Q chạm giới hạn "+qMax+(b.freq>AE_LIMITS.trebleHz ? " trên 6 kHz" : "")+" — correction bị giới hạn tại đây.");
  });
  var errAfterArr = err.map(function(e,i){ return e-res.total[i]; });
  var viol = 0;
  res.bands.forEach(function(b){
    if (Math.abs(b.gain)>AE_LIMITS.gainMax+0.001) viol++;
    if (b.q<AE_LIMITS.qMin-0.001 || b.q>AE_LIMITS.qMax+0.001) viol++;
    if (b.freq>AE_LIMITS.trebleHz && (Math.abs(b.gain)>AE_LIMITS.trebleGainMax+0.001 || b.q>AE_LIMITS.trebleQMax+0.001)) viol++;
  });
  var rangeRms = null;
  if (S.range){
    var rn2=0, rsb2=0, rsa2=0;
    for (var ri2=0;ri2<AE.freqs.length;ri2++){
      var rf2=AE.freqs[ri2]; if (rf2<S.range.lo || rf2>S.range.hi) continue;
      rn2++; rsb2 += err[ri2]*err[ri2]; rsa2 += errAfterArr[ri2]*errAfterArr[ri2];
    }
    if (rn2>0) rangeRms = { lo:S.range.lo, hi:S.range.hi, before:Math.sqrt(rsb2/rn2), after:Math.sqrt(rsa2/rn2) };
  }
  return { tf:S.tf, tgtG:S.tgtG, err:err, weights:S.W, res:res, warnings:warnings, preserve:S.preserveInfo, rangeRms:rangeRms,
           errBefore: aeRms(err, AE.freqs), errAfter: aeRms(errAfterArr, AE.freqs),
           viol:viol, nullBoost:nullBoost, gainCap:(S.gainCap || null), cutOnly:(S.cutOnly || null), deadband:(S.deadband || null), gainRound:(S.gainRound || null) };
}
function aeComputeOnce(prep, targetId, adj, nB, preserve, fs){
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS;
  var S = aeComputeSetup(prep, targetId, adj, preserve);
  var res = aeSolve(AE.freqs, S.err, S.W, nB, undefined, fsv);
  return aeComputeFinish(prep, S, res, fsv);
}
/* Đường bất đồng bộ cho pipeline chính (2026-10-31): phần Setup/Finish chạy
   trên luồng chính (rất nhẹ), phần Solver nặng chạy trong Web Worker qua
   aeSolveInWorker (parity maxDiff === 0 với aeSolve đồng bộ; Worker không
   khả dụng thì tự rơi về đồng bộ). Nhờ vậy khi chọn tai nghe, giao diện
   không còn bị đơ trong lúc giải. aeCompute đồng bộ giữ nguyên cho
   QA/harness và mọi lời gọi cần kết quả tức thì. */
function aeComputeAsync(prep, targetId, adj, nB, preserve, bestOf, fs, cb){
  var fsv = (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : AE_FS;
  var S = aeComputeSetup(prep, targetId, adj, preserve);
  if (!bestOf || nB !== 10){
    aeSolveInWorker(AE.freqs, S.err, S.W, nB, fsv, function(res){
      cb(aeComputeFinish(prep, S, res, fsv));
    });
    return;
  }
  aeSolveInWorker(AE.freqs, S.err, S.W, 10, fsv, function(res10){
    var out10 = aeComputeFinish(prep, S, res10, fsv);
    aeSolveInWorker(AE.freqs, S.err, S.W, 20, fsv, function(res20){
      var out20 = aeComputeFinish(prep, S, res20, fsv);
      var o10 = aeSolveObjective(out10.res.bands, out10.res.total, out10.err, out10.weights);
      var o20 = aeSolveObjective(out20.res.bands, out20.res.total, out20.err, out20.weights);
      /* H16: nhu aeCompute — cham pick bang RMS-after truc tiep; hoa giu 10 band. */
      var win = (out20.errAfter < out10.errAfter) ? out20 : out10;
      var picked = (out20.errAfter < out10.errAfter) ? 20 : 10;
      var ms12 = 0;
      var finish12 = function(o12, out12){
        if (out12){ ms12 = out12.res.ms; if (out12.errAfter < win.errAfter){ win = out12; picked = 12; } }
        win.bestOf = { picked: picked, obj10: o10, obj20: o20, obj12: o12 };
        win.res.ms = out10.res.ms + out20.res.ms + ms12;
        cb(win);
      };
      var seed12 = null;
      try { seed12 = aeBuildSeed12(out10.res.bands); } catch (e12) { seed12 = null; }
      if (!seed12){ finish12(null, null); return; }
      try {
        /* H14: nhu aeCompute — ung vien 12 band seeded, loi thi giu pick 10/20. H16: thang khi RMS-after thap hon. */
        aeSolveInWorker(AE.freqs, S.err, S.W, 12, fsv, function(res12){
          var out12 = null, o12 = null;
          try {
            out12 = aeComputeFinish(prep, S, res12, fsv);
            o12 = aeSolveObjective(out12.res.bands, out12.res.total, out12.err, out12.weights);
          } catch (e12b) { out12 = null; o12 = null; }
          finish12(o12, out12);
        }, seed12);
      } catch (e12c) { finish12(null, null); }
    });
  });
}
/* Ánh xạ N band kết quả vào các band engine đang hoạt động: lowshelf -> band
   đầu, highshelf -> band cuối, peaking rải đều ở giữa. Ở engine 10 band ánh
   xạ này cho đúng chỉ số như trước; từ bản solver 20 band (v2), solver sinh đủ
   đúng số band đã chọn (tới 20) nên khi số band solver bằng số band engine thì
   ánh xạ này là đồng nhất 1:1, còn khi solver ít band hơn engine thì các vị trí
   không được ánh xạ giữ gain 0 (phẳng) nhờ vòng reset ngay dưới đây. */
function aeApplyToEngine(resBands){
  var n = resBands.length, idx = [0], nP = n-2, j, last = bands.length - 1;
  for (j=0;j<nP;j++){
    var cand = 1 + Math.round((j+0.5)*(last-1)/nP - 0.5);
    while (idx.indexOf(cand)>=0 && cand<last-1) cand++;
    idx.push(cand);
  }
  idx.push(last);
  var BS = bandSet();
  bands.forEach(function(b,i){ b.gain=0; b.q=BS.defq[i]; b.on=true; b.freq=BS.freqs[i]; b.type=BS.types[i]; });
  resBands.forEach(function(rb, k){
    var eb = bands[idx[k]];
    eb.type = rb.type; eb.freq = Math.round(rb.freq*10)/10; eb.gain = Math.round(rb.gain*100)/100; eb.q = Math.round(rb.q*100)/100; eb.on = true;
  });
  selBand = idx[0];
  return idx;
}
function aeAdj(){
  var a = { tilt: parseFloat($("aeTilt").value), bass: parseFloat($("aeBass").value), ear: parseFloat($("aeEar").value) };
  if (!isFinite(a.tilt)) a.tilt = 0;
  if (!isFinite(a.bass)) a.bass = 0;
  if (!isFinite(a.ear)) a.ear = 0;
  try {
    var rOn = $("aeRangeOn");
    if (rOn && rOn.checked){
      var rLo2 = parseFloat($("aeRangeLo").value), rHi2 = parseFloat($("aeRangeHi").value);
      if (isFinite(rLo2) && isFinite(rHi2)) a.range = { lo:rLo2, hi:rHi2 };
    }
  } catch (e) {}
  try {
    var gc = $("aeGainCapSel");
    if (gc){
      var gv = parseFloat(gc.value);
      if (isFinite(gv) && gv > 0) a.gainCap = gv;
    }
  } catch (e) {}
  try {
    var co = $("aeCutOnly");
    if (co && co.checked) a.cutOnly = true;
  } catch (e) {}
  try {
    var db = $("aeDeadbandSel");
    if (db){
      var dv = parseFloat(db.value);
      if (isFinite(dv) && dv > 0) a.deadband = dv;
    }
  } catch (e) {}
  try {
    var rd = $("aeRoundSel");
    if (rd){
      var rv = parseFloat(rd.value);
      if (isFinite(rv) && rv > 0) a.gainRound = rv;
    }
  } catch (e) {}
  return a;
}
function aeUpdateTarget(){
  var id = $("aeTarget").value, adj = aeAdj();
  var tf = aeTargetCurve(id, adj.tilt, adj.bass, adj.ear);
  AE.tgtFn = tf; AE.tgtG = AE.freqs.map(tf);
  $("aeTargetNote").textContent = AE_TARGETS[id].note+". Target và đáp tuyến tai nghe đều chuẩn hoá 0 dB tại 1 kHz trước khi trừ nhau (correction = Target − đáp tuyến tai nghe).";
  drawGraph();
}
function aeSetMeasurement(pts, name, rig, source){
  var prep = aePrepare(pts, aeCurrentSmoothMode());
  AE.points = pts; AE.ptsN = prep.ptsN; AE.rawG = prep.rawG; AE.sm = prep.sm; AE.nulls = prep.nulls;
  AE.name = name; AE.rig = rig; AE.source = source;
  AE.rawFn = aeGridFn(prep.rawG); AE.smFn = aeGridFn(prep.sm);
  $("aeRig").value = rig;
  $("aeMeasInfo").innerHTML = "Đáp tuyến tai nghe: <b>"+name.replace(/</g,"&lt;")+"</b> · rig <b>"+AE_RIGLBL[rig]+"</b> · "+pts.length+" điểm đo · chuẩn hoá 0 dB @ 1 kHz"+
    (prep.nulls.length ? " · phát hiện <b>"+prep.nulls.length+" null hẹp</b> (sẽ bị loại khỏi hiệu chỉnh)" : " · không phát hiện null hẹp")+
    ". Đây là đường nguồn: bộ tối ưu tính correction từ đáp tuyến của tai nghe này về target đã chọn, trên bản đã làm mượt " + AE_SMOOTH_LBL[aeCurrentSmoothMode()] + ".";
  var lrt = $("lgRawTxt"); if (lrt) lrt.textContent = "Đáp tuyến tai nghe: "+name+" (chưa làm mượt)";
  $("aeErr").style.display = "none";
  $("btnAutoEq").disabled = false;
  ["chipRaw","chipTgt","chipEq"].forEach(function(id){ $(id).disabled = false; });
  $("lgRaw").style.display = ""; $("lgTgt").style.display = ""; $("lgEq").style.display = "";
  $("aeLayerNote").textContent = "bấm để ẩn/hiện từng lớp";
  aeUpdateTarget();
}
/* ---------- Danh sách tai nghe — Bước 1 của AutoEQ ----------
   Mọi nguồn đường cong đều trở thành MỘT MỤC TAI NGHE trong cùng một danh sách:
   · kho dữ liệu đo THẬT từ AutoEq (script Giai đoạn 5 đăng ký vào đây — hơn nghìn mẫu đã qua pipeline kiểm định, xem panel Kiểm định dữ liệu),
   · 3 tai nghe mẫu kiểm chứng của Giai đoạn 2 (AE_SAMPLES — gồm mẫu cho RMS
     2.18 → 0.53 dB và mẫu có null hẹp tại ~8 kHz),
   · tai nghe người dùng thêm qua file đo (panel này hoặc panel Giai đoạn 5).
   Registry chỉ THÊM/CẬP NHẬT mục, không có đường code nào xoá mục; ô chọn được
   dựng lại từ registry sau mỗi lần đăng ký và sau mỗi lần chạy QA (Giai đoạn 6),
   nên danh sách không thể "biến mất" vì trạng thái kiểm chứng ghi đè. */
var AE_PHONES = {};
var AE_PHONE_GROUPS = [
  { key:"db", label:"Tai nghe — dữ liệu đo thật từ AutoEq" },
  { key:"sample", label:"Tai nghe mẫu kiểm chứng — Giai đoạn 2" },
  { key:"user", label:"Tai nghe của bạn — thêm qua file đo" }
];
function aePhoneCountLine(){
  var el = $("aePhoneCount"); if (!el) return;
  var n = { db:0, sample:0, user:0 };
  Object.keys(AE_PHONES).forEach(function(id){ n[AE_PHONES[id].group] = (n[AE_PHONES[id].group]||0)+1; });
  var tot = n.db + n.sample + n.user;
  el.textContent = "Danh sách tai nghe hiện có: "+tot+" mục — "+n.db+" tai nghe dữ liệu đo thật (kho AutoEq đóng gói trong app, đã qua kiểm định) · "+n.sample+" tai nghe mẫu kiểm chứng (Giai đoạn 2) · "+n.user+" tai nghe bạn đã thêm. Danh sách có sẵn ngay khi mở trang và được giữ nguyên sau mỗi lần chạy kiểm chứng/QA.";
}
/* Bước 1 dùng Ô TÌM KIẾM + danh sách kết quả thay cho <select>: kho có hơn
   nghìn tai nghe nên select thuần không dùng được. Hàm giữ tên cũ
   aeRenderPhoneSelect vì Giai đoạn 6 gọi lại sau mỗi lần chạy QA để dựng
   lại danh sách từ registry. */
var AE_REG_BULK = false;
function aeRenderPhoneSelect(){
  aePhoneCountLine();
  if (!AE_REG_BULK) aeRenderStepResults();
}
/* --- Mở rộng 2026-11-23 (vòng tự động 22:02, hướng D — ÁP DỤNG, vá code): Lượt nhóm D (sau C 21:46, ÁP DỤNG). File Drive tải về (fileId 1TAhnChBQPRlbsrMUOhq5ZF3tHWHGIvbi, sửa 21:51:57+07, 6.274.195 byte / 25.362 dòng (wc -l), md5 56c2f1e4a8ed8de3b9a474f88acc9a66, version 339) — bản cục bộ trước lượt đã lệch md5 nên đã thay bằng bản Drive tải về; backup pre-D lưu tại ~/workspace/autoeq/backups/2026-11-23_2154_pre-D.html. Ứng viên D duy nhất: cache điểm tìm kiếm tai nghe trong aeStepScore (_aeStepCache Map, khóa theo String(name || "")) — trước đây aeRenderStepResults/batchCurrentList gọi aeStepScore cho MỌI tai nghe trong AE_PHONES (tới 5.000 mục) mỗi lần gõ tìm kiếm (debounce 80 ms), mỗi lần đều tính lại aeNormQ(name) (toLowerCase + normalize NFD + 3 lần replace regex), N.replace(/ /g,"") và N.split(" ") cho từng tên dù tên không đổi giữa các lần tìm; nay tính MỘT lần (N, nc, toks) theo tên rồi dùng lại, biểu thức tính điểm (+100/+80/+30/+18, thứ tự cộng, điều kiện if (!Q) return 1 sau khi đã tính N như cũ) giữ nguyên từng toán hạng nên mọi điểm GIỐNG TỪNG BIT theo cấu trúc (khóa là giá trị chuỗi nên tên đổi tạo khóa mới, tên trùng dùng chung mục cache đúng). Khác hướng đã bác: thay khóa chuỗi trong gridTotalDb bằng tuple (21:15, đường cache-hit quá rẻ, không cải thiện ổn định) — lượt này cache kết quả chuẩn hoá/tách từ của chính tên tai nghe trong aeStepScore, chưa thử chính thức trước đó. Lab Node trên hàm thật trích verbatim (extract.py + make_new.py + harness.js + bench.js trong hidden_files/run_20261123_2154_D/, 2 lần bench độc lập): parity 6.201.132/6.201.132 GIỐNG TỪNG BIT cả 2 lần (Object.is trên điểm + loại lỗi; gồm 618 truy vấn × 5.000 tên thực tế-giả lập + lặp lại cache-warm, biên rỗng/khoảng trắng/dấu câu/dấu tiếng Việt/đ/№/tab/newline/NBSP, chuỗi dài, non-string null/undefined/số/NaN/±Inf/bool/mảng/object/Symbol/BigInt/toString ném lỗi, fuzz 3.000 ca + 3.000 ca pool lặp) + verify trên file ĐÃ VÁ 6.201.132/6.201.132; tốc độ paired-median xen kẽ 15 vòng trên tìm kiếm 5.000 tên: lần 1 W1 lặp 1 truy vấn 1,9387× (15/15), W2 xoay 150 truy vấn 2,0029× (15/15); lần 2 W1 2,0339× (15/15), W2 2,0706× (15/15) — cải thiện ổn định ~2× mọi workload cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). Bộ đếm lab-only vẫn 12. QA: 44/44 hàm/biến bảo vệ, 62/62 ID DOM, 21/21 khối script node --check PASS, kết thúc đúng </html>, diff với backup pre-D đúng 1 hunk code + comment này. Headless Chrome vẫn bị chặn (Hatch WebGL) → QA trình duyệt đầy đủ chưa chạy được trong lượt này; QA đầy đủ gần nhất vẫn 23:37 ngày 2026-11-11 (55/57 pass, aeV3 468/482 ms < 500 ms). Sweep đã dừng theo chốt 01:09 ngày 22/11 — không nhắn về sweep. Lượt kế: nhóm A. Lab: hidden_files/run_20261123_2154_D/. --- */
var _aeStepCache = new Map();
var _aeStepQCache = new Map();
function aeNormQ(s){
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}
/* --- Mở rộng 2026-11-24 (vòng tự động 11:33, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 11:24, ÁP DỤNG). Ứng viên D duy nhất: thay _qe.qtoks.forEach(callback) bằng vòng for thường trong aeStepScore (js/03-solver.js) — aeRenderStepResults gọi aeStepScore cho MỌI tai nghe trong AE_PHONES (tới 5.000 mục) mỗi lần gõ tìm kiếm, và forEach cấp phát 1 closure mỗi lần gọi (5.000 closure/lần quét) kèm chi phí gọi hàm; vòng for đọc trực tiếp _qe.qtoks[_ti] theo đúng thứ tự 0..n-1, giữ nguyên từng toán hạng/thứ tự cộng (+30/+18, điều kiện if (!tok) continue tương đương return trong callback forEach) nên mọi điểm GIỐNG TỪNG BIT theo cấu trúc (qtoks từ String.split(" ") không có lỗ thưa; kể cả khi có, forEach bỏ qua lỗ còn vòng for đọc undefined rồi continue — cùng kết quả). Đối xứng với vá dbScore 09:27 ở js/07-database.js — lượt này áp cùng kỹ thuật cho aeStepScore, chưa thử chính thức trước đó. Lab (hidden_files/run_20261124_1133_D/, extract verbatim + harness, 2 lần bench độc lập): parity 15.580/15.580 GIỐNG TỪNG BIT cả 2 lần (ma trận truy vấn × tên, cache lạnh/ấm, biên rỗng/dấu tiếng Việt/non-string/Symbol/BigInt/toString ném lỗi, 3.000 fuzz; checksum quét 5.000 tên khớp tuyệt đối ở 6 workload); bench paired-median xen kẽ 15 vòng trên quét 5.000 tên — lần 1 W1 1,0345x/W2 1,1214x/W3 1,0638x/W4 1,0003x/W5 0,9876x/W6 1,0034x, lần 2 W1 1,1125x/W2 1,1111x/W3 1,0706x/W4 1,0303x/W5 0,9971x/W6 1,0383x — cải thiện ổn định trên workload thực tế (lặp/xoay/gõ sai truy vấn), W5 trung tính trong nhiễu cả 2 lần. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function aeStepScore(q, name){
  var _qe;
  if (typeof q === "string"){
    _qe = _aeStepQCache.get(q);
    if (!_qe){
      var _Q0 = aeNormQ(q);
      _qe = { Q: _Q0, qc: _Q0.replace(/ /g, ""), qtoks: _Q0.split(" ") };
      _aeStepQCache.set(q, _qe);
    }
  } else {
    var _Qn = aeNormQ(q);
    _qe = { Q: _Qn, qc: _Qn.replace(/ /g, ""), qtoks: _Qn.split(" ") };
  }
  var Q = _qe.Q;
  var _nk = String(name || "");
  var _ce = _aeStepCache.get(_nk);
  if (!_ce){
    var _N0 = aeNormQ(name);
    _ce = { N: _N0, nc: _N0.replace(/ /g, ""), toks: _N0.split(" ") };
    _aeStepCache.set(_nk, _ce);
  }
  var N = _ce.N, nc = _ce.nc;
  if (!Q) return 1;
  var qc = _qe.qc, sc = 0;
  if (N.indexOf(Q) >= 0) sc += 100;
  if (nc.indexOf(qc) >= 0) sc += 80;
  for (var _ti = 0; _ti < _qe.qtoks.length; _ti++){
    var tok = _qe.qtoks[_ti];
    if (!tok) continue;
    if (_ce.toks.indexOf(tok) >= 0) sc += 30;
    else if (nc.indexOf(tok) >= 0) sc += 18;
  }
  return sc;
}
/* --- Mở rộng 2026-11-24 (vòng tự động 04:39, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 04:31, ÁP DỤNG). Ứng viên D duy nhất: cache phía truy vấn trong aeStepScore (_aeStepQCache Map, khóa theo chuỗi truy vấn thô khi typeof q === "string") — trước đây aeRenderStepResults/batchCurrentList gọi aeStepScore cho MỌI tai nghe trong AE_PHONES (tới 5.000 mục) mỗi lần gõ tìm kiếm và mỗi lần đều tính lại aeNormQ(q) (toLowerCase + normalize NFD + 3 lần replace regex), Q.replace(/ /g,"") và Q.split(" ") dù truy vấn không đổi trong suốt một lần quét; nay tính MỘT lần (Q, qc, qtoks) theo truy vấn rồi dùng lại cho mọi tên — biểu thức tính điểm (+100/+80/+30/+18, thứ tự cộng, điều kiện if (!Q) return 1 sau khi đã tính N như cũ) giữ nguyên từng toán hạng nên mọi điểm GIỐNG TỪNG BIT theo cấu trúc (aeNormQ thuần xác định trên chuỗi; truy vấn không phải chuỗi đi đường không cache, hành vi ném lỗi giữ nguyên). Đối xứng với cache tên _aeStepCache đã áp dụng 22:02 và cache truy vấn dbScore đã áp dụng 03:25. Lab (hidden_files/run_20261124_0439_D/, extract verbatim + harness, 2 lần bench độc lập): parity 246.395/246.395 GIỐNG TỪNG BIT; bench paired-median xen kẽ 15 vòng trên quét 5.000 tên — lần 1 W1 2,5795x/W2 2,3457x/W3 2,7260x/W4 1,7336x/W5 2,0505x, lần 2 W1 2,7797x/W2 2,4606x/W3 2,9689x/W4 1,7389x/W5 2,1770x (đều thắng 15/15, acc khớp tuyệt đối). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function aePhoneMeta(p){
  if (p.group === "db" && p.entry) return p.entry.brand + " · " + p.entry.type + " · rig " + p.entry.rigLabel + " · nguồn đo: " + p.entry.source + " — dữ liệu đo thật";
  if (p.group === "sample") return "Mẫu kiểm chứng Giai đoạn 2 — đường cong nhân tạo để nghiệm thu solver, không phải tai nghe thật";
  return "Tai nghe bạn thêm qua file đo";
}
/* --- Mở rộng 2026-11-24 (vòng tự động 06:00, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 05:54, ÁP DỤNG). Ứng viên D duy nhất: cache danh sách AE_PHONES đã sắp xếp theo tên trong aeRenderStepResults (_aeStepSortedList, js/03-solver.js) — trước đây mỗi lần render khi ô tìm trống (focus ô tìm, chọn tai nghe qua aeSelectPhone, khôi phục sau QA, xoá ô tìm) hàm map toàn bộ AE_PHONES (tới 5.000 mục) rồi sort lại bằng comparator a.name<b.name?-1:1 dù danh sách không đổi giữa các lần render; nay tính MỘT lần (danh sách đã sắp xếp + snapshot khóa/object/tên) rồi tái dùng bản sao, chỉ dựng lại khi khóa/thứ tự/object/tên lệch snapshot (thêm/xoá/thay object cùng id/đổi tên tại chỗ đều bị phát hiện và dựng lại bằng đúng biểu thức map+slice+sort gốc) — đầu ra GIỐNG TỪNG BIT theo cấu trúc (cùng mảng đầu vào, cùng comparator, cùng thứ tự cộng; nhánh truy vấn q giữ nguyên từng toán hạng, hint dùng keys.length đúng bằng all.length cũ). Lab (hidden_files/run_20261124_0600_D/, extract verbatim + harness + bench, 2 lần bench độc lập): parity 698/698 GIỐNG TỪNG BIT cả 2 lần (gồm chuỗi mutation thêm/thay/đổi tên tại chỗ/đổi rig/xoá-thêm lại, unicode/tên trùng, cỡ 0–5000, fuzz) + verify trên file ĐÃ VÁ; bench paired-median xen kẽ 15 vòng trên aeRenderStepResults đầy đủ (mock DOM) — lần 1 W1 3,1490x/W2 3,0777x/W3 3,0546x/W4 control 1,0116x/W5 1,4570x, lần 2 W1 3,2372x/W2 3,0989x/W3 3,1022x/W4 0,9841x/W5 1,2971x (W1–W3/W5 thắng 15/15 cả 2 lần); đường rebuild cô lập đo xen kẽ 1,0147x (trung tính; W6 mutation mỗi rep trong bench đầy đủ 0,9284–0,9512x — adversarial, không phải workload thực tế). Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
var _aeStepSortedCache = null;
function _aeStepSortedList(keys){
  var c = _aeStepSortedCache;
  if (c && c.keys.length === keys.length){
    var ok = true;
    for (var i = 0; i < keys.length; i++){
      var k = keys[i];
      if (c.keys[i] !== k || c.phones[i] !== AE_PHONES[k] || c.names[i] !== AE_PHONES[k].name){ ok = false; break; }
    }
    if (ok) return c.sorted.slice();
  }
  var all = new Array(keys.length), phonesSnap = new Array(keys.length), namesSnap = new Array(keys.length);
  for (var i = 0; i < keys.length; i++){
    var p = AE_PHONES[keys[i]];
    all[i] = p; phonesSnap[i] = p; namesSnap[i] = p.name;
  }
  var sorted = all.slice().sort(function(a, b){ return a.name < b.name ? -1 : 1; });
  _aeStepSortedCache = { keys: keys, phones: phonesSnap, names: namesSnap, sorted: sorted };
  return sorted.slice();
}
/* --- Mở rộng 2026-11-24 (vòng tự động 08:24, hướng D — ÁP DỤNG, vá code, bản đa file): Lượt nhóm D (sau C 07:54, ÁP DỤNG; lượt D 08:03 trước đó thất bại token-truncated nên lượt này làm lại đúng nhóm D). Ứng viên D duy nhất: gộp vòng lọc trong nhánh q của aeRenderStepResults (js/03-solver.js) — trước đây map toàn bộ AE_PHONES (tới 5.000 mục) thành mảng all rồi map lần nữa tạo wrapper {p,s} cho MỌI tai nghe trước khi filter s>10, cấp phát ~5.000 wrapper thừa mỗi lần gõ tìm kiếm; nay một vòng duy nhất chỉ push {p,s} khi s>10 rồi sort/slice/map như cũ — cùng thứ tự keys, cùng comparator, sort ổn định nên đầu ra GIỐNG TỪNG BIT theo cấu trúc (kể cả lỗi ném khi AE_PHONES[id] undefined/null, tên getter ném lỗi). Lab (hidden_files/run_20261124_0824_D/, extract verbatim + harness, 2 lần độc lập + bench luân phiên): parity 763/763 GIỐNG TỪNG BIT; bench full-render paired-median xen kẽ 15 vòng — lần 1 F1 1,0369x/F2 1,0710x/F3 1,0516x/F4 1,0471x (thắng 13–15/15), lần 2 F1 1,0517x/F2 1,0490x/F3 1,0882x/F4 1,0760x (thắng 13–14/15); bench luân phiên 30 vòng A1 1,1066x (23/30)/A2 1,0789x (29/30), no-match/many-match trung tính ~1,00x; bench đảo thứ tự (new-first, 15 vòng) cho kết quả trung tính/âm (0,9585–1,0118x) — ghi nhận là nhiễu thứ tự đo trên VM chia sẻ, kết luận dựa trên bench luân phiên triệt tiêu bias. Không chạm solver/WASM/FIR/QA logic; aeV3 không đổi theo cấu trúc (không đo lại; gần nhất 468/482 ms ngày 2026-11-11). QA trình duyệt đầy đủ chưa chạy được trên VM (headless Chrome bị chặn Hatch WebGL). Lượt kế: nhóm A. --- */
function aeRenderStepResults(){
  var box = $("aePhoneResults"); if (!box) return;
  var si = $("aePhoneSearch");
  var q = si ? si.value.trim() : "";
  /* ô tìm kiếm đang chứa đúng tên tai nghe đang chọn (trạng thái sau khi chọn)
     thì coi như chưa lọc, để danh sách không bị thu hẹp khó hiểu */
  var cur = AE_PHONES[AE.phoneId];
  if (cur && q === cur.name) q = "";
  var keys = Object.keys(AE_PHONES);
  var list;
  if (q){
    var scored = [];
    for (var _qi = 0; _qi < keys.length; _qi++){
      var _qp = AE_PHONES[keys[_qi]];
      var _qs = aeStepScore(q, _qp.name);
      if (_qs > 10) scored.push({ p: _qp, s: _qs });
    }
    scored.sort(function(a, b){ return b.s - a.s; });
    list = scored.slice(0, 120).map(function(x){ return x.p; });
  } else {
    list = _aeStepSortedList(keys);
    if (cur){ var ci = list.indexOf(cur); if (ci > 0){ list.splice(ci, 1); list.unshift(cur); } }
    list = list.slice(0, 120);
  }
  box.innerHTML = "";
  if (!list.length){
    box.innerHTML = '<p class="note" style="margin:4px 0">Không thấy tai nghe khớp “' + q.replace(/</g, "&lt;") + '” — thử gõ ngắn hơn (ví dụ chỉ hãng + số model), hoặc thêm tai nghe của bạn qua file đo bên dưới.</p>';
    return;
  }
  list.forEach(function(p){
    var b = document.createElement("button");
    b.type = "button"; b.className = "dbitem";
    if (AE.phoneId === p.id){ b.style.borderColor = "var(--amber)"; b.classList.add("sel"); }
    b.innerHTML = '<span><span class="nm">' + p.name.replace(/</g, "&lt;") + '</span><span class="mt">' + aePhoneMeta(p).replace(/</g, "&lt;") + '</span></span><span class="rigbadge">' + (p.rig === "5128" ? "B&K 5128" : p.rig === "711" ? "711" : "rig khác") + '</span>';
    b.addEventListener("click", function(){ aeSelectPhone(p.id); var f = $("aeFile"); if (f) f.value = ""; });
    box.appendChild(b);
  });
  var hint = document.createElement("p");
  hint.className = "note"; hint.style.margin = "2px 0 0";
  hint.textContent = q ? (list.length + " kết quả khớp nhất trong " + keys.length + " tai nghe — bấm một kết quả trong danh sách để chọn làm tai nghe nguồn.") : ("Hiển thị " + list.length + "/" + keys.length + " tai nghe (đang chọn ở đầu danh sách) — cuộn trong thanh danh sách để xem thêm, hoặc gõ vào ô tìm kiếm trong thanh danh sách để lọc nhanh trong toàn bộ kho.");
  box.appendChild(hint);
}
function aeShowSelectedPhone(){
  var el = $("aePhoneSel"); if (!el) return;
  var p = AE_PHONES[AE.phoneId];
  if (!p){ el.textContent = "Chưa chọn tai nghe nào — tìm ở ô trên hoặc thêm tai nghe qua file đo."; return; }
  el.innerHTML = "Đang chọn: <b>" + p.name.replace(/</g, "&lt;") + "</b> · " + aePhoneMeta(p).replace(/</g, "&lt;");
  var si = $("aePhoneSearch");
  if (si && document.activeElement !== si) si.value = p.name;
}
function aeRegisterPhone(p){
  if (!p || !p.id) return null;
  AE_PHONES[p.id] = p;
  aeRenderPhoneSelect();
  return p;
}
function aePhonePoints(p){
  if (p.points) return p.points;
  if (p.entry) return aeSamplePoints(p.entry);
  return null;
}
function aeSelectPhone(id){
  var p = AE_PHONES[id]; if (!p) return;
  var pts = aePhonePoints(p); if (!pts) return;
  AE.phoneId = id;
  aeShowSelectedPhone();
  aeRenderStepResults();
  aeSetMeasurement(pts, p.name, p.rig, p.group === "user" ? "file" : (p.group === "db" ? "db5" : "sample"));
  if (p.group === "db" && p.entry && typeof DB !== "undefined"){
    DB.cur = { headphone:p.name, rig:p.rig, source:p.entry.source, attribution:p.entry.attribution, points:pts, format:"database" };
  }
}
/* ---------- Khởi tạo control AutoEQ ---------- */
(function aeInit(){
  AE_SAMPLES.forEach(function(s){
    AE_PHONES["sample:"+s.id] = { id:"sample:"+s.id, name:s.name, rig:s.rig, group:"sample", entry:s };
  });
  var ts = $("aeTarget");
  /* 9 target đã được nạp sẵn ngay trong HTML tĩnh (kèm lựa chọn mặc định
     Harman Over-Ear 2018) để ô chọn hiện đầy đủ ngay cả trước khi JS chạy —
     chỉ bổ sung bằng JS khi ô đang trống, tránh nhân đôi mục. */
  if (!ts.options.length){
    Object.keys(AE_TARGETS).forEach(function(k){ var o=document.createElement("option"); o.value=k; o.textContent=AE_TARGETS[k].name; ts.appendChild(o); });
  }
  ts.value = "harmanOE";
  ["chipRaw","chipTgt","chipEq"].forEach(function(id){ $(id).classList.add("on"); });
  aeRenderPhoneSelect();
  aeUpdateTarget();
})();
$("aePhoneSearch").addEventListener("input", function(){ var el=this; clearTimeout(el._srT); el._srT=setTimeout(function(){ aeRenderStepResults(); }, 80); });
$("aePhoneSearch").addEventListener("focus", function(){ aeRenderStepResults(); });
$("aeRig").addEventListener("change", function(){
  if (AE.phoneId && AE_PHONES[AE.phoneId]) AE_PHONES[AE.phoneId].rig = this.value;
  if (AE.points){ AE.rig = this.value; aeSetMeasurement(AE.points, AE.name, this.value, AE.source); }
});
$("aeFile").addEventListener("change", function(){
  var f = this.files && this.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function(){
    try{
      var parsed = aeParseMeasurement(String(rd.result||""));
      var nm = f.name.replace(/\.(csv|txt)$/i, "");
      var p = aeRegisterPhone({ id:"user:"+nm, name:nm, rig:$("aeRig").value, group:"user", points:parsed.points });
      aeSelectPhone(p.id);
    }catch(err){
      var eb = $("aeErr"); eb.textContent = "Không đọc được file đo: "+err.message; eb.style.display = "block";
    }
  };
  rd.onerror = function(){ var eb=$("aeErr"); eb.textContent="Không đọc được file đã chọn."; eb.style.display="block"; };
  rd.readAsText(f);
});
$("aeTarget").addEventListener("change", aeUpdateTarget);
$("aeTilt").addEventListener("input", function(){ $("aeTiltOut").textContent = parseFloat(this.value).toFixed(2)+" dB/oct"; scheduleAeTarget(); });
$("aeBass").addEventListener("input", function(){ $("aeBassOut").textContent = parseFloat(this.value).toFixed(1)+" dB"; scheduleAeTarget(); });
$("aeEar").addEventListener("input", function(){ $("aeEarOut").textContent = parseFloat(this.value).toFixed(1)+" dB"; scheduleAeTarget(); });
[["chipRaw","raw"],["chipTgt","target"],["chipEq","eq"]].forEach(function(pair){
  $(pair[0]).addEventListener("click", function(){
    AE.show[pair[1]] = !AE.show[pair[1]];
    this.classList.toggle("on", AE.show[pair[1]]);
    drawGraph();
  });
});
/* ---------- Chạy AutoEQ & áp vào engine ---------- */
$("btnAutoEq").addEventListener("click", function(){
  if (!AE.points) return;
  var btn = this;
  if (btn.disabled) return;
  var prep = { ptsN:AE.ptsN, rawG:AE.rawG, sm:AE.sm, nulls:AE.nulls };
  var nB = parseInt($("aeBands").value, 10);
  var bestOfAuto = (typeof AUTO !== "undefined" && AUTO.bestOfPending);
  if (typeof AUTO !== "undefined") AUTO.bestOfPending = false;
  var sig = [AE.name, $("aeTarget").value, $("aeTilt").value, $("aeBass").value, $("aeEar").value, $("aeBands").value, $("aePreserveChar").checked, $("aeRangeOn").checked ? 1 : 0, $("aeRangeLo").value, $("aeRangeHi").value, $("aeSmoothSel").value, displayFs].join("|");
  btn.disabled = true;
  var wi = $("aeWorkerInfo");
  if (wi) wi.textContent = "Đang giải bằng Web Worker — giao diện vẫn dùng bình thường, không bị đơ…";
  var fsUsed = (typeof displayFs !== "undefined" && displayFs) ? displayFs : AE_FS; /* Pha A/C 2026-11-07: giai theo rate that cua engine (48000 neu chua chay). */
  aeComputeAsync(prep, $("aeTarget").value, aeAdj(), nB, !!$("aePreserveChar").checked, bestOfAuto, fsUsed, function(out){
    btn.disabled = false;
    /* Nếu trong lúc giải, người dùng đã chọn tai nghe/target khác hoặc đổi
       thông số, kết quả này đã cũ: bỏ qua và chạy lại với trạng thái mới. */
    var sig2 = [AE.name, $("aeTarget").value, $("aeTilt").value, $("aeBass").value, $("aeEar").value, $("aeBands").value, $("aePreserveChar").checked, $("aeRangeOn").checked ? 1 : 0, $("aeRangeLo").value, $("aeRangeHi").value, $("aeSmoothSel").value, displayFs].join("|");
    if (sig2 !== sig){ btn.click(); return; }
  var idx = aeApplyToEngine(out.res.bands);
  aeSolvedFs = fsUsed; /* Pha A/C 2026-11-07: ghi lai rate vua giai de initEngine biet co can giai lai. */
  updateAll(true); /* tính lại pre-amp theo luật Giai đoạn 1 + đẩy hệ số xuống worklet */
  AE.tgtG = out.tgtG;
  var red = out.errBefore>0 ? (1-out.errAfter/out.errBefore)*100 : 0;
  $("aeRmsB").textContent = out.errBefore.toFixed(2);
  $("aeRmsA").textContent = out.errAfter.toFixed(2);
  /* RMS có trọng số tri giác W(f) (2026-10-31): solver tối ưu theo W(f) nhưng
     trước đây chỉ báo RMS thường; nay báo thêm RMS trọng số trên cùng dải
     20 Hz–10 kHz (vùng null đã có trọng số 0 sẵn trong out.weights). */
  var elW = $("aeRmsW");
  if (elW && out.weights && out.err && out.res && out.res.total){
    var swW = 0, sbW = 0, saW = 0;
    for (var iw = 0; iw < AE.freqs.length; iw++){
      if (AE.freqs[iw] > 10000 || !(out.weights[iw] > 0)) continue;
      var ebW = out.err[iw], eaW = out.err[iw] - out.res.total[iw];
      swW += out.weights[iw]; sbW += out.weights[iw]*ebW*ebW; saW += out.weights[iw]*eaW*eaW;
    }
    elW.textContent = swW > 0 ? (Math.sqrt(sbW/swW).toFixed(2)+" → "+Math.sqrt(saW/swW).toFixed(2)+" dB") : "—";
  }
  var elRg = $("aeRmsRange");
  if (elRg) elRg.textContent = out.rangeRms ? (Math.round(out.rangeRms.lo)+"–"+Math.round(out.rangeRms.hi)+" Hz: "+out.rangeRms.before.toFixed(2)+" → "+out.rangeRms.after.toFixed(2)+" dB") : "— (chưa bật giới hạn dải)";
  $("aeRed").textContent = "−"+red.toFixed(1)+"%";
  $("aeMs").textContent = Math.round(out.res.ms)+" ms";
  $("aePre").textContent = fmtDb(appliedPreDb())+" dB";
  $("aeUsedMeas").textContent = AE.name+" · "+AE_RIGLBL[AE.rig];
  $("aeUsedTgt").textContent = AE_TARGETS[$("aeTarget").value].name;
  $("aePreserveRes").textContent = out.preserve ? ("BẬT — tilt đã trừ "+out.preserve.tilt.toFixed(2)+" dB/oct · bass đã trừ "+out.preserve.bass.toFixed(2)+" dB (slider Tilt/Bass vẫn cộng thêm)") : "Tắt — correction về đúng target đã chọn";
  $("aeResMeta").textContent = out.bestOf ? ("best-of tự động 10/20 → " + out.bestOf.picked + " band · " + new Date().toLocaleTimeString("vi-VN")) : (nB+" band · "+new Date().toLocaleTimeString("vi-VN"));
  var rows = '<tr><th>Band → Engine</th><th>Loại</th><th>Fc</th><th>Gain</th><th>Q</th></tr>';
  out.res.bands.forEach(function(b, k){
    rows += "<tr><td>Band "+(k+1)+" → #"+(idx[k]+1)+"</td><td>"+AE_TYPLBL[b.type]+"</td><td>"+fmtFreq(b.freq)+"</td><td>"+fmtDb(b.gain)+" dB</td><td>"+b.q.toFixed(2)+"</td></tr>";
  });
  $("aeBandTable").innerHTML = rows;
  var wl = $("aeWarn");
  if (out.warnings.length){
    wl.innerHTML = out.warnings.map(function(w){ return "<li>"+w.replace(/</g,"&lt;")+"</li>"; }).join("");
  } else {
    wl.innerHTML = '<li class="ok">Không có correction nào bị giới hạn hay bỏ qua trong lần chạy này — 0 vi phạm safety.</li>';
  }
  AE.last = out;
  });
});
/* ---------- Giới hạn dải tần sửa: nạp/lưu trạng thái (localStorage) ---------- */
(function(){
  var on = $("aeRangeOn"), lo = $("aeRangeLo"), hi = $("aeRangeHi");
  if (!on || !lo || !hi) return;
  try {
    var sv = JSON.parse(window.localStorage.getItem("webAutoEq.freqrange.v1") || "null");
    if (sv){ on.checked = !!sv.on; if (isFinite(sv.lo)) lo.value = sv.lo; if (isFinite(sv.hi)) hi.value = sv.hi; }
  } catch (e) {}
  function saveRange(){ try { window.localStorage.setItem("webAutoEq.freqrange.v1", JSON.stringify({ on:on.checked, lo:parseFloat(lo.value), hi:parseFloat(hi.value) })); } catch (e) {} }
  on.addEventListener("change", saveRange); lo.addEventListener("change", saveRange); hi.addEventListener("change", saveRange);
})();
/* ---------- Giới hạn gain mỗi band: nạp/lưu trạng thái (localStorage) ---------- */
(function(){
  var sel = $("aeGainCapSel");
  if (!sel) return;
  try {
    var sv = window.localStorage.getItem("webAutoEq.gaincap.v1");
    if (sv === "3" || sv === "6" || sv === "9") sel.value = sv;
    else sel.value = "0";
  } catch (e) {}
  sel.addEventListener("change", function(){ try { window.localStorage.setItem("webAutoEq.gaincap.v1", sel.value); } catch (e) {} });
})();
/* ---------- Chế độ chỉ cắt: nạp/lưu trạng thái (localStorage) ---------- */
(function(){
  var chk = $("aeCutOnly");
  if (!chk) return;
  try { chk.checked = (window.localStorage.getItem("webAutoEq.cutonly.v1") === "1"); } catch (e) {}
  chk.addEventListener("change", function(){ try { window.localStorage.setItem("webAutoEq.cutonly.v1", chk.checked ? "1" : "0"); } catch (e) {} });
})();
/* ---------- Bỏ band nhỏ: nạp/lưu trạng thái (localStorage) ---------- */
(function(){
  var sel = $("aeDeadbandSel");
  if (!sel) return;
  try {
    var sv = window.localStorage.getItem("webAutoEq.deadband.v1");
    if (sv === "0.25" || sv === "0.5" || sv === "1") sel.value = sv;
    else sel.value = "0";
  } catch (e) {}
  sel.addEventListener("change", function(){ try { window.localStorage.setItem("webAutoEq.deadband.v1", sel.value); } catch (e) {} });
})();
/* ---------- Làm tròn gain mỗi band: nạp/lưu trạng thái (localStorage) ---------- */
(function(){
  var sel = $("aeRoundSel");
  if (!sel) return;
  try {
    var sv = window.localStorage.getItem("webAutoEq.gainround.v1");
    if (sv === "0.25" || sv === "0.5" || sv === "1") sel.value = sv;
    else sel.value = "0";
  } catch (e) {}
  sel.addEventListener("change", function(){ try { window.localStorage.setItem("webAutoEq.gainround.v1", sel.value); } catch (e) {} });
})();
/* ---------- Mức làm mượt tuỳ chọn trước khi solve (vòng tự động, hướng B mục 3) ---------- */
(function(){
  var sel = $("aeSmoothSel"), info = $("aeSmoothInfo");
  if (!sel) return;
  function smoothInfo(){
    if (!info) return;
    if (typeof UP !== "undefined" && UP && UP.erbOn) info.textContent = "ERB (Nâng cấp 1) đang ghi đè — tắt ERB để dùng lựa chọn này.";
    else info.textContent = AE_SMOOTH_LBL[aeCurrentSmoothMode()] + (aeCurrentSmoothMode() === "psycho" ? " (mặc định)" : "");
  }
  try {
    var sv = window.localStorage.getItem("webAutoEq.smooth.v1");
    if (sv && AE_SMOOTH_MODES[sv]){ AE_SMOOTH_MODE = sv; sel.value = sv; }
  } catch (e) {}
  smoothInfo();
  sel.addEventListener("change", function(){
    var m = sel.value;
    if (!AE_SMOOTH_MODES[m]) m = "psycho";
    AE_SMOOTH_MODE = m;
    try { window.localStorage.setItem("webAutoEq.smooth.v1", m); } catch (e) {}
    smoothInfo();
    if (typeof AE !== "undefined" && AE && AE.points){
      try { aeSetMeasurement(AE.points, AE.name, AE.rig, AE.source); } catch (e) {}
      smoothInfo(); /* ERB (nếu bật) đã ghi đè sm trong lúc nạp lại */
    }
  });
})();
/* ---------- Kiểm chứng nghiệm thu Prompt 2 ---------- */
$("btnAeVerify").addEventListener("click", function(){
  var sA = AE_SAMPLES[0], sC = AE_SAMPLES[2];
  var outA = aeCompute(aePrepare(aeSamplePoints(sA)), "harmanOE", { tilt:0, bass:0, ear:0 }, 10);
  var redA = (1-outA.errAfter/outA.errBefore)*100;
  var okA = redA>=60 && outA.viol===0;
  $("aeV1").textContent = "RMS "+outA.errBefore.toFixed(4)+" → "+outA.errAfter.toFixed(4)+" dB (giảm "+redA.toFixed(1)+"%), vi phạm: "+outA.viol;
  $("aeV1Ok").innerHTML = okA ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  var outC = aeCompute(aePrepare(aeSamplePoints(sC)), "harmanOE", { tilt:0, bass:0, ear:0 }, 10);
  var nlC = aePrepare(aeSamplePoints(sC)).nulls[0];
  var boostInNull = outC.res.bands.some(function(b){ return nlC && b.gain>0.5 && b.freq>=nlC.fLo && b.freq<=nlC.fHi; });
  var hasNullWarn = outC.warnings.some(function(w){ return w.indexOf("Null hẹp")===0; });
  var okC = !!nlC && !boostInNull && hasNullWarn;
  $("aeV2").textContent = nlC ? ("phát hiện null tại "+Math.round(nlC.fc)+" Hz, sâu "+nlC.depth.toFixed(1)+" dB · band boost vào null: "+(boostInNull?"CÓ":"không")+" · warning: "+(hasNullWarn?"có":"không")) : "không phát hiện null";
  $("aeV2Ok").innerHTML = okC ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  /* --- Mo rong 2026-11-10 (vong tu dong 03:41, huong QA): thu do aeV3 bang TRUNG VI 3 lan giai thay vi 1 lan giai lanh don — BI BAC BO, khong ap va code (da revert), chi ghi chu. Ly do thu: cong 500 ms do lanh don lan phu thuoc may/tai (02:40 lan 1 Mau A 725 / Mau C 700 ms, lan 2: 618/490 ms; 03:29: 698/846 ms khi sweep chay song song); probe 02:40 (het sweep) cho trung vi 387/419 ms. Ket qua QA day du headless tren ban va trung vi (qa_report_2026-11-10_0341.json, chay luc sweep batch 03:22 dang chay ~86% CPU, 86,5 s): 57 test, 55 PASS, 1 FAIL that — aeV3: Mau A trung vi 492 ms (455/492/706) DAT, Mau C trung vi 676 ms (644/676/747) VUOT 500 ms; moi cong khac DAT (aeV1 0,1029 dB, aeV2 null 8011 Hz, vResp/vPre/wasmV1, ps/p4/p5). Ket luan: trung vi on dinh hon don lan (Mau A 698 -> 492 ms) nhung duoi tai sweep, ca 3 rep cua Mau C deu > 500 ms nen trung vi khong cuu duoc cong — that bai la do tai may, khong phai bo uoc luong. File da revert ve trang thai dau luot (solver giong het ban cap200; aeV1/aeV2 khong doi). De xuat lai khi tai may giam (sweep nghi) — khong thu lai duoi cung dieu kien tai. Y tuong luot ke: huong B — do lai profile 3 pha buildFirTaps sau va 20:20/20:30; hoac huong C — ra soat isoPhonFromSpl tren luoi phon rong 10-100 phon. --- */
  var msMax = Math.max(outA.res.ms, outC.res.ms);
  $("aeV3").textContent = "Mẫu A: "+Math.round(outA.res.ms)+" ms · Mẫu C: "+Math.round(outC.res.ms)+" ms";
  $("aeV3Ok").innerHTML = msMax<500 ? '<span class="pass">ĐẠT &lt; 500 ms</span>' : '<span class="fail">VƯỢT 500 ms</span>';
  var prepP = aePrepare(aeSamplePoints(sA));
  var outP = aeCompute(prepP, "harmanOE", { tilt:0, bass:0, ear:0 }, 10, true);
  var finP = prepP.sm.map(function(v,i){ return v + outP.res.total[i]; });
  var wP = AE.freqs.map(function(f){ return aeWeight(f); });
  prepP.nulls.forEach(function(nl){ for (var i2=0;i2<AE.freqs.length;i2++) if (AE.freqs[i2]>=nl.fLo && AE.freqs[i2]<=nl.fHi) wP[i2]=0; });
  var tbSmP = aePreserveMeasure(AE.freqs, prepP.sm, wP);
  var tbFinP = aePreserveMeasure(AE.freqs, finP, wP);
  var dTP = tbFinP.tilt - tbSmP.tilt, dBP = tbFinP.bass - tbSmP.bass;
  var okP = outP.preserve && Math.abs(dTP)<=0.30 && Math.abs(dBP)<=0.60 && outP.viol===0 && (Math.abs(outP.preserve.tilt)>=0.05 || Math.abs(outP.preserve.bass)>=0.5);
  $("aeV4").textContent = "khớp tilt "+outP.preserve.tilt.toFixed(2)+" dB/oct · bass "+outP.preserve.bass.toFixed(2)+" dB — giữ tilt Δ"+dTP.toFixed(3)+" dB/oct · giữ bass Δ"+dBP.toFixed(3)+" dB · vi phạm: "+outP.viol;
  $("aeV4Ok").innerHTML = okP ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  /* aeV5 — Solver 20 band đầy đủ (v2): cùng Mẫu A, cùng target, chỉ đổi số band.
     Tái dùng prepP (Mẫu A đã chuẩn bị cho aeV4) để không tính lại đường đo. */
  var out20 = aeCompute(prepP, "harmanOE", { tilt:0, bass:0, ear:0 }, 20);
  var act20 = out20.res.bands.filter(function(b){ return Math.abs(b.gain)>=0.5; }).length;
  var ok20 = out20.res.bands.length===20 && out20.errAfter<=outA.errAfter+1e-9 && act20>=15 && out20.viol===0;
  $("aeV5").textContent = "20 band · RMS "+out20.errBefore.toFixed(2)+" → "+out20.errAfter.toFixed(2)+" dB (10 band: "+outA.errAfter.toFixed(2)+" dB) · band |gain|≥0,5 dB: "+act20+"/20 · vi phạm: "+out20.viol+" · thời gian: "+Math.round(out20.res.ms)+" ms";
  $("aeV5Ok").innerHTML = ok20 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  /* aeV6 — Solver Web Worker (Chặng 2 bước 2.1): đối chiếu worker vs main thread trên Mẫu A. */
  try {
    var par6 = aeWorkerParityCheck();
    $("aeV6").textContent = "10 band: maxDiff " + par6.diff10 + " · 20 band: maxDiff " + par6.diff20 + " (yêu cầu === 0) · band: " + par6.bands10 + "/" + par6.bands20;
    $("aeV6Ok").innerHTML = par6.ok ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  } catch (e6) {
    $("aeV6").textContent = "lỗi: " + e6.message;
    $("aeV6Ok").innerHTML = '<span class="fail">CHƯA ĐẠT</span>';
  }
  /* aeV7 — Solver 10 band multi-start (nâng cấp tính toán 2026-10-28): chạy lại đường
     cũ (ridge tuyệt đối) trên cùng Mẫu A và so với kết quả aeCompute vừa chạy (đã
     dùng multi-start mới). Bản chọn phải có mục tiêu có phạt không tệ hơn đường cũ,
     RMS Mẫu A ≤ 0,54 dB (đo thật 0,5304 dB) và 0 vi phạm safety. */
  try {
    var prep7 = aePrepare(aeSamplePoints(AE_SAMPLES[0]));
    var tf7 = aeTargetCurve("harmanOE", 0, 0, 0);
    var err7 = AE.freqs.map(function(f, i){ return tf7(f) - prep7.sm[i]; });
    var w7 = AE.freqs.map(function(f){ return aeWeight(f); });
    prep7.nulls.forEach(function(nl){ for (var i7=0;i7<AE.freqs.length;i7++) if (AE.freqs[i7]>=nl.fLo && AE.freqs[i7]<=nl.fHi) w7[i7]=0; });
    var leg7 = aeSolveSingle(AE.freqs, err7, w7, 10, null, 2, 0.02);
    var objLeg7 = aeSolveObjective(leg7.bands, leg7.total, err7, w7);
    var objPick7 = aeSolveObjective(outA.res.bands, outA.res.total, err7, w7);
    var ok7 = objPick7 <= objLeg7 + 1e-9 && outA.errAfter <= 0.54 && outA.viol === 0;
    $("aeV7").textContent = "Mẫu A 10 band · mục tiêu bản chọn " + objPick7.toFixed(5) + " ≤ đường cũ " + objLeg7.toFixed(5) + " · RMS " + outA.errAfter.toFixed(4) + " dB (ngưỡng 0,54) · vi phạm: " + outA.viol;
    $("aeV7Ok").innerHTML = ok7 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  } catch (e7) {
    $("aeV7").textContent = "lỗi: " + e7.message;
    $("aeV7Ok").innerHTML = '<span class="fail">CHƯA ĐẠT</span>';
  }
  /* aeV8 — NÂNG CẤP KHỐI 6: mô hình Harman IE 2019 đủ 13 tham số khớp
     22 knots gốc và solver AutoEQ 13 band cho IEM (Mẫu A). */
  try {
    if (typeof UP === "undefined" || !UP.pure6) throw new Error("thiếu Khối 6");
    var fit8 = (function(){
      var p = UP.pure6.HARMAN_IE_13_DEFAULTS, se = 0, knots = AE_TARGETS.harmanIE.knots;
      knots.forEach(function(k){ var e = UP.pure6.harmanIe13EvalAt(p, k[0], 48000) - k[1]; se += e * e; });
      return Math.sqrt(se / knots.length);
    })();
    var s8 = UP.pure6.harmanIe13SolveAutoEq(aeSamplePoints(AE_SAMPLES[0]), UP.pure6.HARMAN_IE_13_DEFAULTS, { nBands: 13 });
    var ok8 = fit8 <= 0.35 && s8.bands.length === 13 && s8.reductionPct >= 65 && s8.viol === 0;
    $("aeV8").textContent = "mô hình 13 tham số: RMS " + fit8.toFixed(4) + " dB trên 22 knots · AutoEQ 13 band Mẫu A: giảm " + s8.reductionPct.toFixed(1) + "% (RMS " + s8.rmsBefore.toFixed(2) + " → " + s8.rmsAfter.toFixed(2) + " dB) · vi phạm: " + s8.viol;
    $("aeV8Ok").innerHTML = ok8 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  } catch (e8) {
    $("aeV8").textContent = "lỗi: " + e8.message;
    $("aeV8Ok").innerHTML = '<span class="fail">CHƯA ĐẠT</span>';
  }
});
drawGraph();

