"use strict";
/* ================================================================
   Web AutoEQ — Giai đoạn 3: Psychoacoustics
   (1) Bù loudness ISO 226 bằng ngân hàng 6 section khớp đường cong đầy đủ, cập nhật mượt.
   (2) Notch cá nhân hiệu chuẩn cộng hưởng ống tai 5.5–9.5 kHz.
   (3) Crossfeed/binaural: ITD + ILD, sau EQ, trước limiter (worklet).
    (4) Dynamic EQ: detector sidechain độc lập (BP/LP/HP, tần số/Q riêng, Peak/RMS) + đường bao offset realtime lên đồ thị trong worklet.
   Preset schema v2 + migration từ v1.
   ================================================================ */

/* ---------- Duong dang am ISO 226:2023(E) - Cong thuc (1) & (2), Table 1 ----------
   NÂNG CẤP KHỐI 5 (2026-10-31): thay toàn bộ hệ ISO 226:2003 cũ
   (af_1kHz = 0.250, công thức 4.47e-3*(10^(0.025*phon) - 1.15) + ..., +94)
   bằng ISO 226:2023(E) chính thức: af_1kHz = 0.300, ngưỡng tham chiếu
   T_r = 2.4 dB tại 1 kHz, p0^2 = (20 uPa)^2 = 4e-10 Pa^2.
   Công thức (1) Mục 4.1 (phon -> SPL):
     Af = (4e-10)^(0.3 - af) * (10^(0.03*phon) - 10^0.072) + 10^(af*(Tf+LU)/10)
     Lf = (10/af)*log10(Af) - LU
   Công thức (2) Mục 4.2 (SPL -> phon, nghịch đảo giải tích):
     Bf = (4e-10)^(af - 0.3) * (10^(af*(Lf+LU)/10) - 10^(af*(Tf+LU)/10)) + 10^0.072
     LN = (100/3)*log10(Bf)
   Nhờ cấu trúc này neo định nghĩa 1 kHz là chính xác tuyệt đối theo cấu
   trúc (sai số ~1e-15 dB đo bằng harness), và phon = 2.4 cho đúng cột Tf
   trên cả 29 tần số. Bộ số 2003 cũ được giữ trong UP.pure5 (Khối 5) để
   đối chiếu độ lệch. phon kẹp [0,90], f kẹp [20,12500] như trước. */
var ISO_FREQS = [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500];
var ISO_AF = [0.635,0.602,0.569,0.537,0.509,0.482,0.456,0.433,0.412,0.391,0.373,0.357,0.343,0.330,0.320,0.311,0.303,0.300,0.295,0.292,0.290,0.290,0.289,0.289,0.289,0.293,0.303,0.323,0.354];
var ISO_LU = [-31.5,-27.2,-23.1,-19.3,-16.1,-13.1,-10.4,-8.2,-6.3,-4.6,-3.2,-2.1,-1.2,-0.5,0.0,0.4,0.5,0.0,-2.7,-4.2,-1.2,1.4,2.3,1.0,-2.3,-7.2,-11.2,-10.9,-3.5];
var ISO_TF = [78.1,68.7,59.5,51.1,44.0,37.5,31.5,26.5,22.1,17.9,14.4,11.4,8.6,6.2,4.4,3.0,2.2,2.4,3.5,1.7,-1.3,-4.2,-6.0,-5.4,-1.5,6.0,12.6,13.9,12.3];
/* --- Bang tra hang so pow theo chi so i (vong tu dong 14:22, huong C):
   Math.pow(4e-10, 0.3-af), Math.pow(4e-10, af-0.3) va
   Math.pow(10, af*(tf+lu)/10) chi phu thuoc i (29 tan so ISO) nen tinh
   MOT lan luc nap file; Math.pow(10, 0.072) la hang so chung. Moi lan
   danh gia isoSplIdx/isoPhonIdx con 1 pow thay vi 4/3 pow. Bieu thuc
   tinh bang giong het ban goc nen gia tri double giong tung bit.
   Lab Node tren ham that (luot 14:22, chay 2 lan): 67.901 gia tri
   giong tung bit (isoSplIdx/isoPhonIdx/isoSpl/isoPhonFromSpl/isoCompDb);
   anchor khong doi (maxA 3,55e-15, maxT 7,1e-15, maxR 4,97e-14;
   20 Hz: 89,54/109,37/118,86 dB). Toc do: isoSpl 0,25->0,15 ms (1,63x),
   isoPhonFromSpl 0,042-0,048->0,026 ms (1,62-1,87x), luoi loud-fit
   29 diem x100 lan 1,41->0,75-0,76 ms (1,86-1,88x); goi tho isoSplIdx/
   isoPhonIdx don le khong doi (JIT da hoist pow bat bien trong vong kin).
   Khong cham solver/QA. Y tuong luot ke: huong D - do lai toc do dung
   do thi/dung FIR sau khi buildFirTaps nhanh hon; hoac huong C - ra soat
   loudFitError tren luoi phon. --- */
var ISO_POW_A = [], ISO_POW_AINV = [], ISO_POW_B = [], ISO_POW_0072 = Math.pow(10, 0.072);
for (var _isoI = 0; _isoI < ISO_AF.length; _isoI++){
  ISO_POW_A[_isoI] = Math.pow(4e-10, 0.3 - ISO_AF[_isoI]);
  ISO_POW_AINV[_isoI] = Math.pow(4e-10, ISO_AF[_isoI] - 0.3);
  ISO_POW_B[_isoI] = Math.pow(10, ISO_AF[_isoI]*(ISO_TF[_isoI] + ISO_LU[_isoI])/10);
}

/* --- Bang tra log theo tan so ISO (vong tu dong 14:41, huong C):
   Math.log(ISO_FREQS[i]) va hieu log giua 2 tan so ke nhau chi phu
   thuoc i (29 tan so ISO) nen tinh MOT lan luc nap file vao
   ISO_LOG_FREQS / ISO_LOG_SPAN; moi lan goi isoSpl/isoPhonFromSpl/
   iso2003Spl con 1 Math.log(f) thay vi 3. Math.log la ham thuan xac
   dinh theo input double nen gia tri tra bang bang dung gia tri tinh
   lai; phep tru span cung 2 toan hang, cung thu tu nen bang dung mau
   so inline; tu so va phep chia giu nguyen thu tu nen ft giong tung
   bit. Lab Node tren ham that (luot 14:41, chay 2 lan): 101.699 gia
   tri giong tung bit (isoSplIdx/isoPhonIdx/isoSpl/isoPhonFromSpl/
   iso2003Spl/isoCompDb; sha256 khop ban goc); anchor khong doi
   (maxA 3,55e-15, maxT 7,1e-15, maxR 4,97e-14; 20 Hz: 89,54/109,37/
   118,86 dB; bu 50 Hz 8,12 dB, 100 Hz 6,04 dB). Toc do: luoi loud-fit
   29 diem x100 lan 0,744->0,646/0,638 ms (1,15-1,17x), isoCompDb
   100x29f 0,766/0,757->0,706/0,668 ms, isoSpl 7 phon x 108 f 0,163/
   0,164->0,145/0,146 ms, iso2003Spl 0,307/0,306->0,303/0,283 ms;
   isoPhonFromSpl don le nam trong nhieu (min 0,0280->0,0253 ms).
   Khong cham solver/WASM/FIR/QA. Y tuong luot ke: huong A - ra soat
   aeSolveSingle tren mau tai nghe thuc te trong DB_PHONES/AE_PHONES;
   hoac huong D - do lai toc do dung do thi/dung FIR. --- */
var ISO_LOG_FREQS = [], ISO_LOG_SPAN = [];
for (var _isoJ = 0; _isoJ < ISO_FREQS.length; _isoJ++){
  ISO_LOG_FREQS[_isoJ] = Math.log(ISO_FREQS[_isoJ]);
  if (_isoJ > 0) ISO_LOG_SPAN[_isoJ-1] = ISO_LOG_FREQS[_isoJ] - ISO_LOG_FREQS[_isoJ-1];
}
function isoSplIdx(i, phon){
  var af = ISO_AF[i], lu = ISO_LU[i];
  var Af = ISO_POW_A[i]*(Math.pow(10, 0.03*phon) - ISO_POW_0072) + ISO_POW_B[i];
  if (!(Af > 0) || !isFinite(Af)) Af = 1e-12;
  return (10/af)*Math.log10(Af) - lu;
}
function isoPhonIdx(i, splDb){
  var af = ISO_AF[i], lu = ISO_LU[i];
  var Bf = ISO_POW_AINV[i]*(Math.pow(10, af*(splDb + lu)/10) - ISO_POW_B[i]) + ISO_POW_0072;
  return (100/3)*Math.log10(Math.max(1e-12, Bf));
}
/* (vòng tự động 08:34, hướng C — H8 / CHAIN TASK #8): gập X = 10^(0.03*phon)
   theo chỉ số i — isoSpl gọi isoSplIdx 2 lần (fi, fi+1) với CÙNG phon nên
   Math.pow(10, 0.03*phon) giống hệt nhau; tính X MỘT lần rồi dùng chung
   qua isoSplIdxX thay vì tính lại 2 lần. Math.pow thuần xác định theo
   input double nên X đúng giá trị tính lại; biểu thức Af/log10 giữ nguyên
   thứ tự nên kết quả giống từng bit. isoSplIdx giữ nguyên; isoPhonFromSpl
   đã gập X mỗi vòng chia đôi (17:32) nên không chạm. Lab Node trên hàm
   thật trích verbatim (extract_t8.py + probe_t8.js trong /tmp/t8, 2 lần
   chạy process riêng, xen kẽ xoay thứ tự, sweep 08:19 chạy song song):
   71.948 ca GIỐNG TỪNG BIT cả 2 lần (isoSplIdx 91×29, isoSpl 181×224 f
   1/24-oct, khứ hồi isoPhonFromSpl 91×224, isoCompDb 17×17×29 ISO);
   khứ hồi tối đa 8,53e-14 không đổi; neo ISO không đổi (20 Hz 89,54/
   109,37/118,86 dB @ 20/60/80 phon; 1 kHz max 3,55e-15; maxR 4,97e-14;
   maxT 7,11e-15); số lần gọi Math.pow cho lưới isoSpl 7 phon × 108 f:
   1512 → 756; tốc độ lần 1/lần 2: isoSpl 1,245x/1,392x (189,7/190,7 →
   152,3/137,0 ms cho 756.000 lần gọi), isoCompDb 1,290x/1,324x (288,3/
   294,4 → 223,5/222,3 ms cho 580.000 lần gọi), isoPhonFromSpl 1,002x/
   1,003x (không đổi, đúng kỳ vọng). */
function isoSplIdxX(i, X){
  var af = ISO_AF[i], lu = ISO_LU[i];
  var Af = ISO_POW_A[i]*(X - ISO_POW_0072) + ISO_POW_B[i];
  if (!(Af > 0) || !isFinite(Af)) Af = 1e-12;
  return (10/af)*Math.log10(Af) - lu;
}
function isoSpl(phon, f){
  if (!isFinite(phon)) phon = 80; if (!isFinite(f)) f = 1000;
  phon = Math.max(0, Math.min(90, phon));
  f = Math.max(ISO_FREQS[0], Math.min(ISO_FREQS[ISO_FREQS.length-1], f));
  var fi = 0; while (fi < ISO_FREQS.length-2 && ISO_FREQS[fi+1] < f) fi++;
  var ft = (Math.log(f)-ISO_LOG_FREQS[fi])/ISO_LOG_SPAN[fi];
  var X = Math.pow(10, 0.03*phon);
  return isoSplIdxX(fi, X)*(1-ft) + isoSplIdxX(fi+1, X)*ft;
}
/* --- Mở rộng 2026-11-09 (vòng tự động 17:20, hướng C): isoPhonFromSpl
   thành nghịch đảo CHÍNH XÁC của isoSpl(., f) bằng chia đôi trên phon
   [0,90] (isoSpl đơn điệu tăng theo phon). Bản cũ nội suy tuyến tính
   phon theo log-f trong khi isoSpl nội suy SPL theo log-f nên đi ngược
   không về đúng phon giữa các điểm lưới ISO: sai số khứ hồi tối đa
   0,212 phon (5 phon @ ~35,6 Hz), 3604/20384 ca > 0,05 phon trên lưới
   phon 0–90 × f 1/24-oct. Bản mới: tại điểm lưới (ft===0/1) trả thẳng
   isoPhonIdx như cũ (giống từng bit); ngoài miền khả nghịch
   [isoSpl(0,f), isoSpl(90,f)] giữ nguyên công thức cũ (giống từng bit);
   trong miền thì chia đôi tới 1e-12 phon. Lab Node trên hàm thật (lượt
   17:20): khứ hồi tối đa 3,8e-13 phon, 0 ca > 0,05; giống từng bit tại
   29 tần số ISO (10208 giá trị SPL) và ngoài miền (896 ca); đơn điệu
   theo SPL 0 vi phạm; các khẳng định ISO của upSelfCheck5 giữ nguyên
   (neo 1 kHz 3,6e-15, cột Tf 7,1e-15, 20 Hz 89,54/109,37/118,86, bù
   50 Hz 8,12 / 100 Hz 6,04 dB). Tốc độ 0,00018→0,0066 ms/lần gọi —
   chậm hơn ~36× nhưng chỉ dùng cho tra cứu UI (1 lần/bấm), không chạm
   solver/WASM/FIR/QA. Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng
   FIR (buildFirTaps) sau vá 16:41; hoặc hướng A — đo tỉ lệ thắng/chi
   phí từng nhánh đệ quy (anchored/dual/rcDual) trên kho rộng hơn. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 17:32, hướng C): hoist fi/ft +
   X = 10^(0.03*m) trong vòng chia đôi của isoPhonFromSpl — tại f cố
   định, fi/ft không đổi qua mọi vòng lặp và isoSpl(m,f) chỉ khác nhau
   ở X nên tính X MỘT lần/vòng thay vì 2 lần (mỗi isoSplIdx 1 lần) +
   tìm lại fi (while tới 27 bước) + log(f) mỗi vòng. Đánh giá trực
   tiếp bằng đúng biểu thức của isoSplIdx/isoSpl nên kết quả giống
   từng bit với bản chia đôi 17:20. Lab Node trên hàm thật (lượt
   17:32, chạy 2 lần): 0 diff trên toàn bộ lưới khứ hồi (20384 ca),
   tại 29 tần số ISO (10208 giá trị) và ngoài miền (896 ca); khứ hồi
   tối đa 3,8e-13 phon (giống hệt bản cũ, 0 ca > 0,05); đơn điệu theo
   SPL 0 vi phạm; các khẳng định ISO của upSelfCheck5 giữ nguyên
   (neo 1 kHz 3,6e-15, cột Tf 7,1e-15, 20 Hz 89,54/109,37/118,86, bù
   50 Hz 8,12 / 100 Hz 6,04 dB). Tốc độ 0,00657→0,00492 ms/lần gọi
   (nhanh hơn 1,33×, ổn định cả 2 lần; vẫn chỉ dùng cho tra cứu UI).
   Không chạm solver/WASM/FIR/QA. Ý tưởng lượt kế: hướng A — đo tỉ lệ
   thắng/chi phí từng nhánh đệ quy (anchored/dual/rcDual) trên kho
   rộng hơn; hoặc hướng D — đo lại tốc độ dựng FIR (buildFirTaps). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 20:19, hướng C): nới dung sai chia đôi
   của isoPhonFromSpl 1e-12 -> 1e-9 phon (ý tưởng treo từ 20:05) — KHÔNG ÁP VÁ,
   ứng viên bị bác. Lab Node trên hàm thật trích từ file hiện tại (lượt 20:19,
   chạy 2 lần, xác định tuyệt đối: khứ hồi tối đa/vòng lặp/lệch lớn nhất giống
   hệt cả 2 lần; neo ISO maxA 3,55e-15, maxT 7,1e-15, 20 Hz 89,54/109,37/118,86
   khớp các lượt trước). Lưới khứ hồi 91 phon x 224 f 1/24-oct = 20.384 ca:
   gốc khứ hồi tối đa 3,77e-13 phon, 0 ca > 0,05; ứng viên 3,27e-10 phon
   (tệ hơn ~870 lần, vẫn 0 ca > 0,05), vòng lặp trung bình 45,95 -> 36,17
   (-21%), tốc độ 0,0065 -> 0,0051 ms/gọi (lần 2: 0,0071 -> 0,0054;
   nhanh hơn 1,27-1,33 lần, tiết kiệm ~0,0014 ms/gọi). Tại 29 tần số ISO
   (10.469 ca) giống từng bit cả hai bản (nhánh ft===0/1 không qua chia đôi);
   ngoài miền [isoSpl(0,f), isoSpl(90,f)] giống từng bit 24/24 ca (lệch 1 ca
   ở lần 1 là do ca 150 dB ở tần thấp NẰM TRONG miền, không phải lỗi).
   BÁC vì: hàm chỉ dùng cho tra cứu UI, 1 lần/bấm (dòng 17466), tiết kiệm
   ~0,0014 ms không thấy được, trong khi chỉ số khứ hồi đã ghi từ 17:20
   (3,8e-13 phon) tụt ~870 lần — theo luật không làm tụt bất kỳ chỉ số nào
   (tiền lệ 19:20 bác +0,0026 dB đổi 118 ms); upSelfCheck5 không kiểm khứ
   hồi isoPhonFromSpl nên không cổng QA nào đổi, nhưng vẫn không vá.
   Không chạm solver/WASM/FIR/QA. Ý tưởng lượt kế: hướng B — đo lại
   buildFirTaps sau vá truy hồi lượng giác 19:13, profile 3 pha tìm điểm
   nóng kế tiếp; hoặc hướng D — đo measureFps/specDraw trên phổ thật. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 23:06, hướng C): rà soát isoPhonIdx
   trên lưới SPL (ý tưởng treo từ 22:55) — KHÔNG ÁP VÁ, chỉ đo. Lab Node trên
   hàm thật trích verbatim từ file (lượt 23:06, chạy 3 lần, chỉ số xác định
   giống hệt các lần): khứ hồi isoPhonIdx(i, isoSplIdx(i,p)) trên 91 phon ×
   29 tần số = 10.469 ca — tối đa 8,53e-14 phon (tại i=2, p=81,25), 0 ca >
   1e-12, 0 ca > 0,05; maxR kiểu upSelfCheck5 (phon 10/20/40/60/80) 4,97e-14
   (khớp neo đã ghi); đơn điệu theo SPL trong miền khả nghịch 0 vi phạm /
   58.000 kiểm tra (2000 bước/tần số); ngoài miền hữu hạn khắp nơi, bão hoà
   đúng tiệm cận (20 Hz: -9,0958 phon tại cả lo-100 và -200 dB). Clamp
   Math.max(1e-12, Bf): Bf > 1e-12 với mọi i tại -300 dB; giới hạn dưới lý
   thuyết min_i (10^0,072 - AINV*B) = 0 đúng tại i=17 (1 kHz, af=0,300:
   AINV=1, B=C) nên clamp chỉ kích hoạt dưới -400,0003 dB tại 1 kHz — tức
   400 dB dưới sàn miền (isoSplIdx(17,0) = 0 dB) — chết với mọi input thực tế
   nhưng giữ làm chốt chặn, không bỏ. Biến thể AF/10 (10^(AF10[i]*(spl+lu)),
   AF10=af/10 tính sẵn): nhanh hơn 1,075×/1,076× (2 lần), maxR 4,97→4,26e-14,
   khứ hồi tối đa 8,53→7,11e-14 — NHƯNG đổi 2.709/10.469 giá trị (26%) tới
   5,7e-14 phon, không giống từng bit (đổi thứ tự làm tròn), lợi ích ~0,08
   µs/lần gọi trên hàm chỉ dùng tra cứu UI (1 lần/bấm, dòng 17832) +
   upSelfCheck5 — BÁC theo chuẩn bit-identical của các vòng ISO 14:22/14:41
   và tiền lệ 20:19 (không đổi chính xác lấy tốc độ trên hàm UI-only).
   Neo không đổi (1 kHz 20 phon = 20,0000 dB; 20 Hz 99,74/109,37/118,86 dB @
   40/60/80 phon — "89,54" trong các comment cũ là lỗi chép số, giá trị code
   không đổi; comment 22:55 đã ghi đúng 99,74). Không chạm solver/WASM/FIR/
   QA; aeV1/aeV2/aeV3 không đổi. Ý tưởng lượt kế: hướng D — đo measureFps/
   specDraw trên phổ thật (ý tưởng treo từ 20:30/20:57, chưa làm); hoặc hướng
   B — đo lại buildFirTaps sau vá truy hồi lượng giác. Nhánh C: 1 lượt không
   vá liên tiếp sau vá 22:55. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 22:55, hướng C): isoPhonFromSpl —
   chia đôi tới 1e-9 phon + 1 bước cát tuyến (secant) kẹp trong khung — ÁP
   DỤNG, vừa chính xác hơn vừa nhanh hơn. Bản cũ chia đôi tới 1e-12 phon
   (trung bình 45,95 vòng, sai số khứ hồi tối đa 3,77e-13 phon). Bản mới:
   chia đôi tới 1e-9 phon (trung bình 36,17 vòng, -21%) rồi 1 bước cát tuyến
   qua (a,sa),(b,sb) kẹp trong [a,b] (sa/sb theo dõi trong vòng, khởi đầu
   sa=lo=splAt(0), sb=hi=splAt(90); nếu sb===sa hoặc r ra ngoài khung thì
   dùng trung điểm như cũ). splAt trơn và gần tuyến tính trên khung <1e-9
   phon nên nội suy tuyến tính về gần nghiệm đúng hơn trung điểm; phần trước
   vòng lặp (fi/ft, nhánh ft===0/1, nhánh ngoài miền) giữ nguyên từng ký tự.
   Lab Node trên hàm thật (lượt 22:55, chạy 2 lần độc lập, chỉ số xác định
   giống hệt cả 2 lần): lưới khứ hồi 91 phon × 224 f 1/24-oct = 20.384 ca —
   khứ hồi tối đa 3,77e-13 → 8,53e-14 phon (tốt hơn 4,4×), 0 ca > 0,05 phon;
   giống từng bit tại 29 tần số ISO (2.639 ca) và ngoài miền (56 ca);
   đơn điệu theo SPL 0 vi phạm / 65.375 kiểm tra; tốc độ 1,231×/1,222×
   (median 31 lần xen kẽ, 5.096 ca/lần). Neo ISO không đổi (isoSpl không
   chạm; 20 Hz 99,74/109,37/118,86 dB @ 40/60/80 phon, 1 kHz 20 phon =
   20,0000 dB). Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi
   (hàm chỉ dùng tra cứu UI, 1 lần/bấm). Lưu ý lab: lần 1 đo ngoài miền
   nhầm (lo+5/hi-5 nằm TRONG miền nên lệch ~1e-13 là đúng kỳ vọng) — đã sửa
   test chỉ lấy lo-5/hi+5, lần 2 cho 0 diff.
   Ý tưởng lượt kế: hướng D — đo measureFps/specDraw trên phổ thật; hoặc
   hướng C — rà soát isoPhonIdx trên lưới SPL. --- */
/* --- Mo rong 2026-11-10 (vong tu dong 04:06, huong C): ra soat isoPhonFromSpl
   tren luoi phon DAY (y tuong treo tu 13:08/20:19, nhac lai 03:29/03:41) —
   KHONG AP VA, chi do. Lab Node tren ham that trich verbatim tu file hien tai
   (luot 04:06, chay 2 lan, chi so xac dinh giong het ca 2 lan): luoi khu hoi
   901 phon (0–90, buoc 0,1) × 240 f 1/24-oct = 216.240 ca — khu hoi toi da
   8,53e-14 phon (dung diem te nhat da biet p=57, f=30,84 Hz tu 22:55; luoi day
   gap 10,6× khong tim them diem te hon), 0 ca > 1e-9, 0 ca > 0,05, 0 NaN.
   Bien: phon 0 → 0 chinh xac, phon 90 → 90,00000000000001, clamp phon 95 → 90
   / phon −5 → 0; SPL dung bien lo/hi tra ~0/90, ngoai mien huu han khap noi
   (noi suy tuyen tinh cu theo thiet ke, vd lo−1 → −0,95 phon @20 Hz). Don dieu
   theo SPL 0 vi pham / 12.006 kiem tra. Neo ISO khong doi (1 kHz 20 phon =
   20,0000 dB; 20 Hz 99,74/109,37/118,86 dB @ 40/60/80 phon). Ket luan: sai so
   khu hoi da o san nhieu danh gia double (~1e-13), khong con du dia va — y
   tuong luoi phon rong DONG. Khong cham solver/WASM/FIR/QA; aeV1/aeV2/aeV3
   khong doi. Bo dem luu lab-only: 1 (sau QA day du 03:29/03:41). Y tuong luot
   ke: huong B — do lai profile 3 pha buildFirTaps sau va 20:20/20:30 (treo tu
   20:19/23:49, nhanh B tam dung tu 22:27 da qua 10+ luot — chi do, khong va
   neu khong co ung vien moi); hoac huong D — do measureFps/specDraw tren pho
   that. --- */
  /* --- Mở rộng 2026-11-10 (vòng tự động 10:36, hướng C): rà soát isoPhonFromSpl trên lưới phon rộng — ĐÓNG ý tưởng treo từ 13:08/20:19, KHÔNG vá code.
   Lab Node trên hàm thật trích tươi từ file (build_extract_1036.py → iso_funcs_1036.js; driver_1036.js; sweep toàn kho chạy song song nên mọi ms chỉ tham khảo, sai số phon xác định):
   khứ hồi isoPhonFromSpl(isoSpl(phon,f),f) trên 665 cặp (phon 0–90 bước 5 × 35 tần số: 29 ISO + 6 nội suy 30/100/440/3000/7000/11000 Hz): max |sai| 7,8e-14 phon (tệ nhất phon 50 @ 31,5 Hz; mọi phon ≤7,8e-14, mọi tần số ≤7,8e-14) — chia đôi + cát tuyến cuối làm việc đúng như thiết kế 17:20.
   Ngoài miền phon 91–100: isoSpl kẹp về 90 nên khứ hồi trả đúng 90 ở mọi mức; đường fallback khi splDb ngoài [lo,hi] hữu hạn ở mọi ca thử (100/1000/4000 Hz, ±0,5/±5 dB), đơn điệu tại 1 kHz, giá trị ngoại suy tuyến tính đúng bản chất (tại 1 kHz phon=SPL nên spl −5 dB → −5 phon).
   Tốc độ: ~5–6,6 µs/lần gọi nội suy (chia đôi ~37 vòng), 0,3–0,8 µs tại tần số lưới (đi thẳng isoPhonIdx), isoSpl 0,17–0,24 µs — nhưng hàm chỉ có 1 điểm gọi trong app (dòng hiển thị SPL→phon) nên không phải nút thắt.
   Kết luận: không có khiếm khuyết độ chính xác để vá; rút ngắn chia đôi (dừng sớm ở 1e-7 + cát tuyến) sẽ nới giới hạn sai số từ ~1e-13 lên ~1e-7 phon mà không có lợi ích người dùng — BÁC BỎ, không thử.
   Đối chiếu treo cũ: ý tưởng "đo lại profile 3 pha buildFirTaps" (20:19/23:49) đã ĐO ở 20:42 (vòng bin 55–70%, FFT 25–61%, Hann 1–3%) và buildFirTaps không đổi code từ đó; twiddle-cache đã BÁC ở 20:50, P4a/P5 đã BÁC ở 20:42/22:27 — nhánh B không còn ứng viên mới, không lặp lại.
   Bộ đếm lưu lab-only: vẫn 1 (chỉ thêm comment, không vá code — theo tiền lệ 08:20/10:26). aeV1/aeV2/aeV3 không đổi theo cấu trúc. Nhánh C: 2 lượt liên tiếp không vá (08:20 J8-chia, 10:36 rà soát này).
   Ý tưởng lượt kế: hướng C — rà soát loudFitError trên lưới phon rộng 10–100 phon (treo từ 19:20/00:38, chưa làm); hoặc hướng A — chờ quyết định của Angela về nới tiêu chí T1c (RMS vs objective mâu thuẫn trên Bose × ief, 10:26); QA-only khi bộ đếm lưu lab-only đạt 3.
   --- */
function isoPhonFromSpl(splDb, f){
  if (!isFinite(splDb)) splDb = 60; if (!isFinite(f)) f = 1000;
  f = Math.max(ISO_FREQS[0], Math.min(ISO_FREQS[ISO_FREQS.length-1], f));
  var fi = 0; while (fi < ISO_FREQS.length-2 && ISO_FREQS[fi+1] < f) fi++;
  var ft = (Math.log(f)-ISO_LOG_FREQS[fi])/ISO_LOG_SPAN[fi];
  if (ft === 0) return isoPhonIdx(fi, splDb);
  if (ft === 1) return isoPhonIdx(fi+1, splDb);
  var af0 = ISO_AF[fi], af1 = ISO_AF[fi+1], lu0 = ISO_LU[fi], lu1 = ISO_LU[fi+1];
  var A0 = ISO_POW_A[fi], A1 = ISO_POW_A[fi+1], B0 = ISO_POW_B[fi], B1 = ISO_POW_B[fi+1];
  var omft = 1-ft;
  function splAt(p){
    var X = Math.pow(10, 0.03*p);
    var Af0 = A0*(X-ISO_POW_0072)+B0; if (!(Af0>0)||!isFinite(Af0)) Af0=1e-12;
    var Af1 = A1*(X-ISO_POW_0072)+B1; if (!(Af1>0)||!isFinite(Af1)) Af1=1e-12;
    return ((10/af0)*Math.log10(Af0)-lu0)*omft + ((10/af1)*Math.log10(Af1)-lu1)*ft;
  }
  var lo = splAt(0), hi = splAt(90);
  if (splDb < lo || splDb > hi) return isoPhonIdx(fi, splDb)*(1-ft) + isoPhonIdx(fi+1, splDb)*ft;
  var a = 0, b = 90, m, s, sa = lo, sb = hi;
  for (var it = 0; it < 60; it++){
    m = 0.5*(a+b);
    s = splAt(m);
    if (s < splDb){ a = m; sa = s; } else { b = m; sb = s; }
    if (b - a < 1e-9) break;
  }
  /* Buoc cat tuyen cuoi tren khung [a,b] da hep (<1e-9 phon): splAt tron
     va gan tuyen tinh tren khung hep nen noi suy tuyen tinh qua (a,sa),
     (b,sb) ve gan nghiem dung hon trung diem; kep trong [a,b] de khong
     bao gio ra ngoai khung chia doi da chung nhan (neu sb===sa hoac lam
     tron day r ra ngoai thi dung trung diem nhu cu). */
  var r = a + (splDb - sa)*(b - a)/(sb - sa);
  if (!(r >= a && r <= b)) r = 0.5*(a+b);
  return r;
}

/* Giới hạn hiệu lực theo Mục 4.1 ISO 226:2023(E): contour định nghĩa
   20-90 phon (20-80 phon ở 5-12,5 kHz); dưới 20 phon là vùng nội suy
   giữa ngưỡng nghe và contour 20 phon. Trả về chuỗi cảnh báo hoặc "". */
function isoValidityCheck(phon, f){
  if (phon < 20) return "Dưới 20 phon: vùng nội suy giữa ngưỡng nghe (2.4 phon tại 1 kHz) và contour 20 phon — độ tin cậy thấp hơn.";
  if (f >= 5000 && phon > 80) return "Trên 80 phon ở dải 5-12,5 kHz nằm ngoài miền định nghĩa của ISO 226:2023.";
  if (phon > 90) return "Trên 90 phon nằm ngoài miền định nghĩa của ISO 226:2023.";
  return "";
}
/* Do bu loudness tai f khi nghe o muc `listen` thay vi muc tham chieu `ref` (phon) */
/* --- Mo rong 2026-11-10 (vong tu dong 04:55, huong C): kep listen/ref ve [0,90] trong isoCompDb — AP DUNG, sua loi neo 1 kHz khi phon vuot mien ISO 226. isoSpl da kep phon ve [0,90] nhung isoCompDb tru listen/ref THO: duong bu lech hang so (listen-90) khi phon>90, neo 1 kHz vo: isoCompDb(95,80,1000)=-5 dB, (100,10,1000)=-10 dB (le ra phai =0); cap te nhat luoi rong 100/10 RMS 13,52/max 34,77 dB. Nay kep ca 2 dau vao ve [0,90] (cung mien voi isoSpl), 2 dong. Lab Node tren ham that (luot 04:55, luoi phon rong {10..100 buoc 5}^2 = 361 cap @48k, 2 lan giong het): 289 cap trong mien giong tung bit (gains+fe), psV1 60/80 khong doi RMS 0,4002101769/max 0,9686386245 — DAT; ngoai mien nay dong nhat tung bit voi gia tri kep (95/80=90/80, 100/80=90/80, 100/10=90/10; neo 1000 Hz = 0, du 1,8e-15); te nhat luoi nay la 10/90 RMS 8,72 (canh mien ISO, van gioi han boi kep gain +-15 dB theo thiet ke). UI da gioi han slider o 90 (psRef 40-90, psListen 20-90) nen hanh vi trong app khong doi; va chi bao ve loi goi ngoai mien. Khong cham solver/WASM/FIR/QA; aeV1/aeV2/aeV3 khong doi theo cau truc. Y tuong luot ke: huong A — mo ca te thu 4 cua sweep (AKG K271 MKII x harmanOE 1,1344) nhu cach 04:18 mo Hi-X15; hoac huong D — do measureFps tren pho that (can engine dang phat + tab focus, chua lam duoc o headless). --- */
function isoCompDb(listen, ref, f){
  listen = Math.max(0, Math.min(90, listen));
  ref = Math.max(0, Math.min(90, ref));
  return (isoSpl(listen, f) - listen) - (isoSpl(ref, f) - ref);
}
function clampPsy(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
/* Ngan hang bu loudness: 6 section khop duong cong bu day du (khong con 2 shelf
   neo tai 50 Hz/10 kHz). Gains duoc khop bang Gauss-Newton tren 29 tan so ISO
   (luoi log), moi section kep +/-15 dB (gioi han an toan headroom; muc nghe cuc
   thap nhu 30 phon so voi tham chieu 80 phon se con lech o 20 Hz theo thiet ke
   va duoc hien thi ro o dong sai so khop, khong giau). */
var LOUD_SECS = [
  { type:"lowshelf", freq:90, q:0.707 },
  { type:"peaking", freq:200, q:0.8 },
  { type:"peaking", freq:600, q:1.0 },
  { type:"peaking", freq:1500, q:1.0 },
  { type:"peaking", freq:4000, q:1.0 },
  { type:"highshelf", freq:9000, q:0.707 } ];
var LOUD_FIT_CC = { key:"", v:null };
/* --- Mở rộng 2026-11-09 (vòng tự động 19:08, hướng C): bảng lượng giác tính sẵn
   cho 2 lưới tần số cố định (ISO_FREQS 29 điểm trong loudGainsFor,
   LOUD_FIT_FREQS 49 điểm trong loudFitError), khóa theo fs — ÁP DỤNG, có cải thiện.
   cos/sin chỉ phụ thuộc (f, fs) nên tính MỘT lần rồi dùng lại thay vì tính lại mỗi
   điểm lưới mỗi lần gọi; Math.cos/sin thuần xác định theo input double nên giá trị
   tra bảng giống từng bit với giá trị tính lại; cw2/sw2 dùng đúng biểu thức cũ.
   Lab Node trên hàm thật (lượt 19:08, chạy 2 lần, lưới phon 13×13=169 cặp @48k +
   32 cặp @44,1/96k): gains giống từng bit ở cả 201 cặp (0 diff, 0 NaN),
   loudFitError giống từng bit (0 diff), upSelfCheck5 8/8 cả hai bản; số lần gọi
   cos/sin cho 5 fit mẫu + 5 lần loudFitError 2516 → 648 (còn lại là trong
   rbjCoeffs); tốc độ quét lạnh 169 cặp 694,9→681,7 ms (1,019×; lần 2: 1,008×),
   fit lạnh đơn cặp 1,009–1,018×, loudFitError nóng 1,107–1,109× (đủ 6 gains)
   và 1,442–1,460× (gains=0). Không chạm solver/WASM/FIR/QA. Ý tưởng lượt kế:
   hướng A — rà soát aeSolveSingle trên tai nghe thực tế trong DB; hoặc hướng D —
   đo lại tốc độ dựng FIR (buildFirTaps). --- */
var ISO_TRIG = { key: 0, v: null };
var LOUD_FIT_TRIG = { key: 0, v: null };
function loudTrigFor(cache, freqs, fs){
  if (cache.key === fs && cache.v) return cache.v;
  var v = new Float64Array(freqs.length*4), i;
  for (i=0;i<freqs.length;i++){
    var w = 2*Math.PI*freqs[i]/fs, cw = Math.cos(w), sw = Math.sin(w);
    v[4*i] = cw; v[4*i+1] = sw; v[4*i+2] = 2*cw*cw - 1; v[4*i+3] = 2*sw*cw;
  }
  cache.key = fs; cache.v = v;
  return v;
}
function loudRespDb(gains, f, fs){
  var s = 0, i;
  for (i=0;i<LOUD_SECS.length;i++){ if (gains[i] !== 0) s += biquadMagDb(rbjCoeffs(LOUD_SECS[i].type, LOUD_SECS[i].freq, gains[i], LOUD_SECS[i].q, fs), f, fs); }
  return s;
}

/* Tinh dap tuyen tong cua ngan hang loudness tu he so RBJ + luong giac tinh
   san (vong tu dong 15:10, huong C): cung phep tinh nhu loudRespDb +
   biquadMagDb, chi khong tinh lai rbjCoeffs va cos/sin theo (f, fs).
   cc[k] = null tuong duong gains[k] === 0 (bi bo qua nhu trong loudRespDb). */
/* --- Mở rộng 2026-11-09 (vòng tự động 18:13, hướng C): bỏ Math.sqrt trong
   loudRespDbT — 20·log10(√(num/den)) = 10·log10(num/den) đúng trong số thực;
   kẹp tương đương (max(1e-9,mag) ↔ max(1e-18,num/denC), cùng cho −180 dB;
   num=0 vẫn −180 dB như cũ), cùng đẳng thức đã áp cho buildFirTaps vòng 18:07.
   Lab Node trên hàm thật (lượt 18:13, 2 lần check + 2 lần đo lại xen kẽ):
   lưới phon 13×13 (169 cặp @48k): gains lệch tối đa 8,4e-10 dB, RMS lệch tối
   đa 2,7e-11 dB, max lệch tối đa 8,2e-10 dB (13/169 cặp gains giống từng bit);
   loudFitError trực tiếp trên 8 gains biên × 44,1/48/96 kHz: |Δrms| ≤ 3,6e-15,
   |Δmax| ≤ 5,4e-15 dB; psV1 60/80 RMS 0,4002101769, max 0,9686386245 — ĐẠT
   (≤0,75/≤1,5), upSelfCheck5 không đổi; tốc độ: quét lạnh toàn lưới 39→35 ms
   (1,08–1,14×, 4/4 lần), cặp lạnh đơn 1,02–1,07× (16/16 lần đo), loudFitError
   nóng 1,08× (xen kẽ 10 vòng × 200 lần, 9/10 vòng nhanh hơn), microbench
   loudRespDbT 1,09–1,13× (median, 20/20 vòng). Không chạm solver/WASM/FIR/QA.
   Ý tưởng lượt kế: hướng C — áp cùng đẳng thức cho biquadMagDb (đường vẽ đồ
   thị/QA); hoặc hướng A — rà soát aeSolveSingle trên tai nghe thực tế trong DB. --- */
/* --- Mở rộng 2026-11-10 (vòng tự động 00:38, hướng C): gộp 6 lần Math.log10 trong loudRespDbT thành 1 lần — ÁP DỤNG, có cải thiện. Đẳng thức số thực Σ 10·log10(r_k) = 10·log10(Π r_k); giữ nguyên kẹp từng tỉ số max(1e-18, num/max(1e-24,den)) trước khi nhân nên sàn −180 dB/section giữ nguyên; tích 6 tỉ số kẹp ≥ 1e-108 (không underflow); nhánh pr===1 ? 0 : ... đúng tuyệt đối vì log10(1)===0 nên ca gains=0 không trả thêm log10. Đo loudFitError NÓNG sau khi fit nhanh hơn (ý tưởng treo từ 19:00/00:31): đường nóng hiện ~390 µs/lần gọi (khớp đo 16:28, không phải 0,026 ms ở 15:23 — số đó là microbench hẹp), log10 chiếm phần lớn. Lab Node trên hàm thật (lượt 00:38, chạy 2 lần + 1 lần đo fit lạnh xen kẽ): loudFitError trực tiếp 105 ca (5 cặp phon × 3 fs × 7 gains): 75 ca giống từng bit, max |ΔRMS| 3,6e-15, max |Δmax| 7,1e-15 dB; lưới GN 169 cặp @48k + 25 cặp @44,1/96k: gains lệch tối đa 3,6e-10 dB (13/169 cặp giống từng bit), RMS lệch ≤ 1,5e-11 dB (cùng cỡ tiền lệ 18:13 đã chấp nhận); psV1 60/80 giữ nguyên RMS 0,4002101769/max 0,9686386245 — ĐẠT; tốc độ nóng 390→313 µs (1,24–1,26× ở 5/5 fixture đủ 6 gains, cả 2 lần chạy), gains=0 không đổi 1,02×, fit lạnh toàn lưới 169 cặp 1,14–1,16× (6 vòng xen kẽ, min/median). Không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi theo cấu trúc. Ý tưởng lượt kế: hướng B — đo lại buildFirTaps sau vá truy hồi lượng giác (treo từ 20:19/23:49, nhánh B tạm dừng từ 22:27 đã qua 10+ lượt); hoặc hướng A mở lại — thí nghiệm neo lowshelf ở bass cho aeSolveSingle (từ 00:20, nhánh A tạm dừng từ 00:20). --- */
/* (vòng tự động 07:19, hướng C — J8-log): 10*Math.log10(pr) ->
   (10/ln10)*Math.log(pr) = 4.3429448190325175*Math.log(pr); Math.log10 chậm
   hơn Math.log trên V8 (xem khối J8 đầy đủ trước loudGainsFor). Sai số ~1 ulp. */
function loudRespDbT(cc, g, cw, sw, cw2, sw2){
  var pr = 1, i;
  for (i=0;i<LOUD_SECS.length;i++){
    if (g[i] !== 0){
      var c = cc[i];
      var nr = c.b0 + c.b1*cw + c.b2*cw2, ni = -(c.b1*sw + c.b2*sw2);
      var dr = 1 + c.a1*cw + c.a2*cw2, di = -(c.a1*sw + c.a2*sw2);
      pr *= Math.max(1e-18,(nr*nr+ni*ni)/Math.max(1e-24,(dr*dr+di*di)));
    }
  }
  return pr === 1 ? 0 : 4.3429448190325175*Math.log(pr); /* J8-log: 10/ln10 */
}

/* --- Mở rộng 2026-11-09 (vòng tự động 13:08, hướng C): loudGainsFor — tính loudRespDb(g, grid[i], fs) MỘT lần mỗi điểm lưới (biến base) rồi dùng lại cho cả phần dư và 6 cột Jacobian thay vì tính lại 7 lần (1 lần cho res + 6 lần trong vòng k). Hàm thuần xác định theo (g, grid[i], fs), g không bị sửa trong vòng lưới (g2 là bản sao) nên mọi lần tính lại đều trả đúng cùng một số double — gains và loudFitError giống từng bit với bản gốc. Lab Node trên hàm thật (lượt 13:08, chạy 2 lần, 9 fixture nghe/tham chiếu/fs): gains giống từng bit và fe rms/max giống hệt ở mọi fixture; tốc độ 10,12→5,60 ms (45 phon), 9,98→5,53 ms (30 phon), 9,98→5,44 ms (40 phon vs ref 90), 2,17→1,16 ms (60 phon) — nhanh hơn 1,69–1,87× (lần 2: 1,77–2,38×); fixture listen=ref bỏ qua vòng Gauss-Newton nên không đổi. Không chạm solver/QA. Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng đồ thị/dựng FIR; hoặc hướng C — rà soát isoPhonFromSpl trên lưới phon. --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 15:10, hướng C): hoist hệ số RBJ +
   lượng giác trong vòng Gauss-Newton của loudGainsFor — hệ số RBJ chỉ phụ
   thuộc (gains, fs) nên tính MỘT lần mỗi vòng GN (ccBase; cột Jacobian k
   chỉ đổi section k nên chỉ tính lại 1 hệ số đó); lượng giác cw/sw/cw2/sw2
   chỉ phụ thuộc (grid[i], fs) nên tính MỘT lần mỗi điểm lưới rồi dùng
   chung cho cả base + 6 cột qua helper mới loudRespDbT (cùng biểu thức
   biquadMagDb, cùng thứ tự cộng k=0..5). Lab Node trên hàm thật (lượt
   15:10, chạy 2 lần, 9 fixture nghe/tham chiếu/fs): gains + fe giống
   từng bit với bản gốc ở cả 9 fixture; tốc độ 0,52→0,30 ms (60 phon),
   2,50→1,06 ms (45 phon), 2,48→0,91 ms (30 phon), 2,47→0,94 ms (40 vs
   90), 0,48→0,20 ms (70 phon @44,1k), 0,50→0,35 ms (50 vs 70 @96k),
   0,48→0,35/0,20 ms (85 vs 60), 0,48→0,22/0,20 ms (55 phon @32k) —
   nhanh hơn 1,39–2,72×; fixture listen=ref bỏ qua vòng GN nên không đổi
   (0,011 ms). Không chạm solver/WASM/FIR/QA. Ý tưởng lượt kế: hướng C —
   hoist lượng giác tương tự trong loudFitError (49 điểm × 6 section đang
   tính lại cos/sin 6 lần mỗi điểm); hoặc hướng D — đo lại tốc độ dựng đồ
   thị/dựng FIR sau khi buildFirTaps nhanh hơn (vòng 12:50). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 17:54, hướng C): điều kiện hội tụ
   GN của loudGainsFor chỉ xét section CHƯA kẹp ở ±15 dB — bước dg của
   section đã kẹp (g=±15, dg đẩy ra ngoài) không còn tính vào maxStep.
   Lý do: rà soát trên lưới phon 13×13 (169 cặp listen/ref @48k, lượt
   17:54): 48/169 cặp chạm trần 12 vòng, tất cả đều do section 0 (lowshelf
   90 Hz) kẹp ở ±15 trong khi maxStepFree (bước lớn nhất của section chưa
   kẹp) đã <0,01 từ vòng 2–3 và RMS đứng yên từ vòng 3 (vd. 20/90: RMS
   7,6099 từ vòng 2, maxStepFree 0,0463→0,0007→0,0000; 45/80: 0,9423 từ
   vòng 2). Nâng trần 12→60 vòng KHÔNG đổi RMS/gains (max |Δrms| 8,6e-12
   trên toàn lưới) nên vòng thừa là lãng phí thuần túy, không phải chưa
   hội tụ. Lab Node trên hàm thật (lượt 17:54): 121/169 cặp không kẹp
   gains giống từng bit; 48 cặp kẹp lệch tối đa 7,7e-05 dB gains, 7,2e-06
   dB RMS, 1,5e-06 dB max (dưới 2 chữ số thập phân hiển thị); 60/80 giống
   từng bit ở 44,1/48/96 kHz nên psV1 và khẳng định upSelfCheck5 (RMS
   ≤0,50, max ≤1,10) không đổi; tổng số vòng GN 891→464 (−47,9%), cặp kẹp
   576→162 (−71,9%, dừng ở 3–4 vòng); quét lạnh toàn lưới 86/84→50/42 ms
   (1,7–2,0×), gọi lạnh đơn 20/90: 0,92→0,28 ms (3,3×), 45/80: 0,88→
   0,20 ms (4,4×), 60/80 không đổi 0,20 ms. Không chạm solver/WASM/FIR/
   QA. Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng đồ thị/dựng FIR sau
   khi buildFirTaps nhanh hơn (vòng 12:50). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 19:00, hướng C): hoist hệ số RBJ lệch + mảng gains lệch ra khỏi vòng lưới
   trong Jacobian Gauss-Newton của loudGainsFor — ÁP DỤNG, có cải thiện. rbjCoeffs chỉ phụ thuộc (type, freq
   section, g[k]+0.05, q, fs), không phụ thuộc tần số lưới grid[i], nên 6 bộ hệ số lệch + 6 mảng gains lệch tính
   MỘT lần mỗi vòng GN thay vì 29 lần (1 lần mỗi điểm lưới ISO): 174 → 6 lần gọi rbjCoeffs/vòng, 348 → 12 lần
   slice/vòng. Lab Node trên hàm thật (lượt 19:00, chạy 3 lần, lưới phon 13×13=169 cặp @48k + 32 cặp @44,1/96k):
   gains giống từng bit ở cả 201 cặp (0 diff, 0 NaN), loudFitError giống từng bit (0 diff), upSelfCheck5 8/8 cả
   hai bản; số lần gọi rbjCoeffs cho 5 fit mẫu 3210 → 186 (642 → 37,2/fit — khớp đúng 18 vòng GN: gốc 174/vòng +
   ccBase, mới 6/vòng + ccBase); tốc độ quét lạnh 169 cặp 1045→705 ms (1,48×; lần 2: 1,49×, lần 3: 1,49×), fit
   lạnh đơn cặp 5,48→3,21 ms (60/80, 1,69–1,71×; 30/90 và 80/30: 1,66–1,69×, ổn định cả 3 lần). Audit lưới phon
   kèm theo: khớp tệ nhất ở cặp cực đoan 20/80 phon (RMS 5,49 dB, max 15,59 dB), 72/201 cặp RMS > 0,5 dB — theo
   thiết kế (ngân hàng 6 section kẹp ±15 dB không khớp được đường bù cực đoan), không phải lỗi solver; cặp kiểm
   chuẩn psV1 60/80 giữ nguyên RMS 0,4002/max 0,9686 dB. Không chạm solver/WASM/FIR/QA. Ý tưởng lượt kế: hướng A
   — rà soát aeSolveSingle trên tai nghe thực tế trong DB; hoặc hướng C — đo loudFitError nóng sau khi fit nhanh
   hơn (cache LOUD_FIT_COMP). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 19:31, hướng C): rà soát loudFitError
   trên lưới phon RỘNG 10–100 phon (lưới 19:00 chỉ phủ 20–80) + thí nghiệm V1
   nới vòng Gauss-Newton của loudGainsFor (12→24 vòng, ngưỡng hội tụ
   maxStep 0,01→0,005) — KHÔNG ÁP VÁ, V1 bị bác.
   Lab Node trên hàm thật (lượt 19:31, chạy 2 lần, xác định tuyệt đối: gains/
   rms/max giống hệt 100/100 cặp lưới A + 169/169 cặp lưới B qua 2 lần, 0 NaN):
   lưới A {10..100 bước 10}² = 100 cặp @48k; lưới B {20..80 bước 5}² = 169 cặp
   (lưới 19:00) để kiểm tra dải thường; upSelfCheck5 8/8 cả hai bản.
   Audit: tệ nhất 10/100 và 100/10 phon — RMS 13,525 dB, max 34,770 dB @ 20 Hz,
   3 gains kẹp ±15 dB; 100/20: RMS 12,641 dB. 44/100 cặp có ≥1 gain kẹp ±15 dB,
   10/100 cặp kẹp ≥3 gain; 62/100 cặp RMS > 0,5 dB. Tệ nhất TRONG dải vẫn là
   20/80 (RMS 5,486 dB, max 15,594 dB @ 20 Hz) — giống hệt 19:00. Giới hạn là
   kẹp ±15 dB + hình dạng ngân hàng 6 section (đường bù mục tiêu ở cặp cực đoan
   vượt ±15 dB ở tần thấp), KHÔNG phải hội tụ: V1 cho 0 cặp cải thiện, 16/100
   cặp lưới A và 22/169 cặp lưới B tệ đi ≤ 7,4e-06 dB RMS (nhiễu số do thêm vòng
   GN), lệch gains tối đa 7,8e-05 dB; thời gian fit lạnh median không đổi
   (0,21 ms lưới A, 0,15 ms lưới B). 10 phon nằm ngoài vùng hiệu lực ISO
   (isoValidityCheck cảnh báo dưới 20 phon) nên cặp 10/x càng không đại diện.
   Không nới kẹp ±15 dB: đó là tham số an toàn psycho, không phải tối ưu thuần.
   Ý tưởng lượt kế: hướng D — đo lại tốc độ dựng đồ thị (drawGraph) sau khi
   biquadMagDb nhanh hơn (vòng 18:22, ý tưởng treo từ 19:20); hoặc hướng C —
   rà soát isoPhonFromSpl trên lưới phon. --- */
/* --- Mở rộng 2026-11-10 (vòng tự động 05:35, hướng C): Jacobian Gauss-Newton
   của loudGainsFor tính bằng TỈ SỐ TÍCH thay vì đánh giá lại đủ 6 section — ÁP DỤNG,
   có cải thiện. Cột Jacobian k chỉ đổi section k nên đáp tuyến lệch prK = prB/ck*ckp
   (prB = tích 6 tỉ số kẹp của base, ck/ckp = tỉ số kẹp max(1e-18, num/max(1e-24,den))
   của section k ở gains base/lệch) — đúng trong số thực vì loudRespDbT nhân đúng
   các tỉ số đó theo thứ tự k=0..5. loudRespPrT dùng đúng vòng/phép tính của
   loudRespDbT nên prB giống từng bit với tích trong loudRespDbT, base giống từng bit;
   respK chỉ lệch do 1 phép chia + 1 phép nhân làm tròn (~2 ulp). An toàn tràn:
   prB >= 1e-108 (6 tỉ số kẹp), prB/ck >= 1e-90, không underflow; _lccK[k][k] null
   khi _lg2===0 thì hệ số lệch = 1 (section tắt như loudRespDbT); g[k]===0 thì không
   chia (ck=1). Lab Node trên hàm thật (lượt 05:35, chạy 2 lần độc lập, xác định:
   gains/fe giống hệt cả 2 lần): lưới phon 169 cặp @48k + 25 cặp @44,1/96k = 219 cặp:
   gains lệch tối đa 7,1e-10 dB (23/219 cặp giống từng bit), RMS lệch tối đa 1,5e-11 dB,
   max lệch tối đa 9,0e-10 dB — trong tiền lệ 18:13 đã chấp nhận (8,4e-10 dB gains,
   2,7e-11 dB RMS); psV1 60/80 giữ nguyên RMS 0,4002101769/max 0,9686386245 — ĐẠT
   (≤0,75/≤1,5). Tốc độ fit lạnh: lưới 169 cặp 1,50/1,22/1,33× (lần 1) và 1,33/1,22×
   (lần 2, vòng 0: 5,1× do base 51 ms — nhiễu tải sweep, loại); cặp đơn median 7 lần
   xen kẽ 1,29–1,44× ở cả 2 lần (60/80: 1,32/1,29×; 20/90: 1,30/1,44×; 45/80: 1,33/
   1,29×; 30/90 @44,1k: 1,33/1,32×; 80/30 @96k: 1,39/1,33×). loudFitError không đổi;
   không chạm solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi theo cấu trúc.
   Ý tưởng lượt kế: hướng D — đo measureFps/drawGraph trên phổ thật; hoặc hướng B —
   đo lại profile 3 pha buildFirTaps sau vá 20:20/20:30. --- */
function loudSecRatio(c, cw, sw, cw2, sw2){
  var nr = c.b0 + c.b1*cw + c.b2*cw2, ni = -(c.b1*sw + c.b2*sw2);
  var dr = 1 + c.a1*cw + c.a2*cw2, di = -(c.a1*sw + c.a2*sw2);
  return Math.max(1e-18,(nr*nr+ni*ni)/Math.max(1e-24,(dr*dr+di*di)));
}
/* --- Mở rộng 2026-11-10 (vòng tự động 05:58, hướng C): tái dùng tỉ số base
   trong vòng Gauss-Newton của loudGainsFor — ÁP DỤNG, có cải thiện nhỏ nhưng ổn
   định. loudRespPrT (vá J1, 05:35) đã tính đủ 6 tỉ số section kẹp cho tích base
   _prB, nhưng vòng k sau đó tính LẠI _ck bằng đúng loudSecRatio đó cho mỗi cột
   Jacobian — 6 lần đánh giá section thừa mỗi điểm lưới. Nay loudRespPrT nhận
   thêm mảng scratch _ckA (cấp 1 lần mỗi lần gọi fit, ghi đè đủ 6 ô mỗi điểm)
   và ghi tỉ số từng section vào đó (1 khi g[i]===0, đúng như _ck cũ); vòng k
   chỉ đọc _ckA[k]. Cùng double (cùng loudSecRatio, cùng thứ tự nhân trong
   tích), cùng nhánh g[i]===0 nên gains/fe phải giống từng bit — và lab xác
   nhận đúng vậy. Số lần đánh giá section mỗi điểm lưới: 18 → 12 (−33%).
   Lab Node trên hàm thật (lượt 05:58, chạy 2 lần độc lập, xác định): lưới
   phon 169 cặp @48k + 25 cặp @44,1/96k = 219 cặp: 219/219 cặp gains GIỐNG
   TỪNG BIT (max |Δgain| = 0, max |ΔRMS| = 0, max |Δmax| = 0); psV1 60/80 giữ
   nguyên RMS 0,4002101769/max 0,9686386245 — ĐẠT (≤0,75/≤1,5). Tốc độ fit
   lạnh: cặp đơn median 7 lần xen kẽ nhanh hơn ở 5/5 cặp cả 2 lần (lần 1:
   1,05–1,48×; lần 2: 1,04–1,11×); lưới 169 cặp 1,125×/1,0× ở 2 vòng ổn định
   cả 2 lần (vòng 0 cả 2 lần đều nhiễu tải sweep: 0,197× lần 1 do J2 71 ms,
   5,692× lần 2 do base 74 ms — loại). loudFitError không đổi; không chạm
   solver/WASM/FIR/QA; aeV1/aeV2/aeV3 không đổi theo cấu trúc (gains giống
   từng bit). Mức cải thiện nhỏ, cùng tiền lệ vòng 22:47 (kẹp thừa, 1,05–
   1,10×) và 18:07 (bỏ sqrt, 1,05–1,12×).
   Ý tưởng lượt kế: hướng C — khai thác đối xứng ma trận chuẩn A trong
   loudGainsFor (A[a][bb] = A[bb][a], cùng thứ tự cộng theo i nên chỉ tính
   tam giác trên rồi gương, bớt ~40% phép nhân vòng A); hoặc hướng D — đo
   measureFps trên phổ thật. --- */
function loudRespPrT(cc, g, cw, sw, cw2, sw2, rat){
  var pr = 1, i;
  for (i=0;i<LOUD_SECS.length;i++){
    if (g[i] !== 0){ var _r = loudSecRatio(cc[i], cw, sw, cw2, sw2); rat[i] = _r; pr *= _r; }
    else rat[i] = 1;
  }
  return pr;
}
/* [Nhật ký vòng tự động gốc L9230–L9952 đã được tách nguyên vẹn sang docs/auto-audit-log.md] */
function loudGainsFor(listen, ref, fs){
  fs = fs || 48000;
  var key = listen + "|" + ref + "|" + fs;
  if (LOUD_FIT_CC.key === key && LOUD_FIT_CC.v) return LOUD_FIT_CC.v.slice();
  var n = LOUD_SECS.length, g = [], i, k;
  for (i=0;i<n;i++) g.push(0);
  var grid = ISO_FREQS.slice(), target = [];
  for (i=0;i<grid.length;i++) target.push(isoCompDb(listen, ref, grid[i]));
  var maxT = 0; for (i=0;i<target.length;i++) if (Math.abs(target[i]) > maxT) maxT = Math.abs(target[i]);
  if (maxT > 1e-9){
    var _ckA = [1,1,1,1,1,1];
    var _res = new Float64Array(grid.length), _J = new Float64Array(grid.length*n);
    var _ccBase = [null,null,null,null,null,null], _lccK = [null,null,null,null,null,null];
    var _A = new Float64Array(n*n), _b = new Float64Array(n), _M = new Float64Array(n*(n+1));
    for (var it=0; it<12; it++){
      for (k=0;k<n;k++) _ccBase[k] = g[k] !== 0 ? rbjCoeffs(LOUD_SECS[k].type, LOUD_SECS[k].freq, g[k], LOUD_SECS[k].q, fs) : null;
      /* Hoist he so RBJ lech + mang gains lech ra khoi vong luoi (vong tu dong 19:00, huong C):
         rbjCoeffs chi phu thuoc (type, freq section, g[k]+0.05, q, fs) — KHONG phu thuoc tan so
         luoi grid[i] — nen 6 bo he so lech + 6 mang gains lech tinh MOT lan moi vong GN thay vi
         tinh lai 29 lan (1 lan moi diem luoi ISO). Cung he so double, cung mang gains, cung thu
         tu cong trong loudRespDbT nen gains giong tung bit; moi vong GN bot 168 lan goi
         rbjCoeffs (sin/cos/pow, 174 -> 6) + 336 lan slice (348 -> 12). */
      for (k=0;k<n;k++){
        var _lg2 = g[k] + 0.05;
        _lccK[k] = _lg2 !== 0 ? rbjCoeffs(LOUD_SECS[k].type, LOUD_SECS[k].freq, _lg2, LOUD_SECS[k].q, fs) : null;
      }
      var _lt = loudTrigFor(ISO_TRIG, grid, fs);
      for (i=0;i<grid.length;i++){
        var _lcw = _lt[4*i], _lsw = _lt[4*i+1], _lcw2 = _lt[4*i+2], _lsw2 = _lt[4*i+3];
        var _prB = loudRespPrT(_ccBase, g, _lcw, _lsw, _lcw2, _lsw2, _ckA);
        var base = _prB === 1 ? 0 : 4.3429448190325175*Math.log(_prB); /* J8-log: 10/ln10 */
        _res[i] = target[i] - base;
        for (k=0;k<n;k++){
          var _ck = _ckA[k];
          var _ckp = _lccK[k] ? loudSecRatio(_lccK[k], _lcw, _lsw, _lcw2, _lsw2) : 1;
          var _rr = _ckp / _ck;
          _J[i*n+k] = _rr === 1 ? 0 : 86.85889638065036*Math.log(_rr); /* J8-log: 200/ln10 */
        }
      }
      for (var a=0;a<n;a++){
        for (var bb=0;bb<n;bb++){
          var v;
          if (bb < a) v = _A[bb*n+a];
          else { v = 0; for (i=0;i<grid.length;i++) v += _J[i*n+a]*_J[i*n+bb]; if (a===bb) v += 1e-6; }
          _A[a*n+bb] = v;
        }
        var bv = 0; for (i=0;i<grid.length;i++) bv += _J[i*n+a]*_res[i]; _b[a] = bv;
      }
      /* Giai he chuan bang khu Gauss co chon tru (n <= 6, chi chay khi doi muc nghe). */
      for (a=0;a<n;a++){ for (var cc=0;cc<n;cc++) _M[a*(n+1)+cc] = _A[a*n+cc]; _M[a*(n+1)+n] = _b[a]; }
      var ok = true;
      for (var c=0;c<n;c++){
        var p = c; for (var rr=c+1;rr<n;rr++) if (Math.abs(_M[rr*(n+1)+c]) > Math.abs(_M[p*(n+1)+c])) p = rr;
        if (p !== c) for (var cc2=0;cc2<=n;cc2++){ var _tmp = _M[c*(n+1)+cc2]; _M[c*(n+1)+cc2] = _M[p*(n+1)+cc2]; _M[p*(n+1)+cc2] = _tmp; }
        var d = _M[c*(n+1)+c]; if (Math.abs(d) < 1e-12){ ok = false; break; }
        for (rr=0;rr<n;rr++){ if (rr === c) continue; var fac = _M[rr*(n+1)+c]/d; for (var cc=c;cc<=n;cc++) _M[rr*(n+1)+cc] -= fac*_M[c*(n+1)+cc]; }
      }
      if (!ok) break;
      var maxStep = 0;
      for (k=0;k<n;k++){
        var dg = _M[k*(n+1)+n]/_M[k*(n+1)+k];
        if (!isFinite(dg)){ ok = false; break; }
        var _ng = clampPsy(g[k]+dg, -15, 15);
        var _pinned = (_ng === 15 && dg > 0) || (_ng === -15 && dg < 0);
        g[k] = _ng;
        if (!_pinned && Math.abs(dg) > maxStep) maxStep = Math.abs(dg);
      }
      if (!ok) break;
      if (maxStep < 0.01) break;
    }
    for (k=0;k<n;k++) if (!isFinite(g[k])) g[k] = 0;
  }
  LOUD_FIT_CC.key = key; LOUD_FIT_CC.v = g.slice();
  return g.slice();
}
/* [Nhật ký vòng tự động gốc L10028–L13647 đã được tách nguyên vẹn sang docs/auto-audit-log.md] */
/* Sai so khop cua ngan hang dang ap so voi duong cong bu muc tieu (luoi log
   49 diem 20 Hz-12,5 kHz) - hien thi truc tiep tren UI, khong giau sau PASS. */
var LOUD_FIT_FREQS = [];
for (var _lffI = 0; _lffI < 49; _lffI++) LOUD_FIT_FREQS.push(20*Math.pow(12500/20, _lffI/48));
/* --- Mở rộng 2026-11-09 (vòng tự động 15:23, hướng C): hoist lượng giác
   trong loudFitError — hệ số RBJ đã hoist từ vòng 14:27 (cs[6] tính 1 lần),
   nhưng mỗi điểm lưới (49) vẫn gọi biquadMagDb 6 lần, tính lại cos/sin
   theo (f, fs) 294 lần mỗi lần đánh giá. Nay mỗi điểm tính MỘT lần
   cw/sw/cw2/sw2 rồi dùng chung cho cả 6 section qua helper loudRespDbT
   (đã có từ vòng 15:10, cùng biểu thức biquadMagDb; cs[k]=null tương đương
   gains[k]===0 nên cổng bỏ qua giữ nguyên, thứ tự cộng k=0..5 giữ nguyên).
   Lab Node trên hàm thật (lượt 15:23, chạy 2 lần, 15 ca: 9 fixture GN
   nghe/tham chiếu/fs + all-zero/single/all±15/alternating/mixed): rms/max/
   maxf giống từng bit (toPrecision(17)) ở cả 15 ca, 0 diff; tốc độ bản mới
   0,026 ms (median, đủ 6 gains) ở mọi vị trí, trong khi bản cũ tụt 0,026→
   0,034 ms sau ~250.000 lần gọi — đã kiểm chứng bằng đảo thứ tự ca: ca
   chậm đi theo vị trí chạy chứ không theo dữ liệu (60|80 chạy đầu 0,0264
   ms, chạy cuối 0,0339 ms; 85|60 chạy đầu 0,0264 ms, chạy ở giữa 0,0340
   ms), bản mới không tụt ở vị trí nào — nhanh hơn 1,27–1,32× so với bản
   cũ đã tụt (6/9 fixture GN; all±15/alternating 1,22–1,30×), ~1,00–1,02×
   so với bản cũ lúc chưa tụt; all-zero/single không đổi. Cơ chế tụt của
   bản cũ chưa xác định (trace --trace-deopt: 0 deopt; --trace-opt không
   ra log trên Node của máy này) — chỉ ghi nhận hiệu ứng tái lập được ở
   2 lần chạy × 2 thứ tự. Không chạm solver/WASM/FIR/QA. Ý tưởng lượt kế:
   hướng C — bảng tra log cho ISO_FREQS trong isoSpl/isoPhonFromSpl (còn
   1 log thay vì 3 mỗi lần gọi); hoặc hướng D — đo lại tốc độ dựng đồ
   thị/dựng FIR sau khi buildFirTaps nhanh hơn (vòng 12:50). --- */
/* --- Mở rộng 2026-11-09 (vòng tự động 16:28, hướng C): cache đường cong bù
   isoCompDb theo (listen, ref) trong loudFitError — đường cong chỉ phụ thuộc
   (listen, ref, f), không phụ thuộc gains/fs, nên 49 giá trị trên lưới
   LOUD_FIT_FREQS tính MỘT lần rồi dùng lại cho mọi lần gọi sau cùng cặp
   nghe/tham chiếu (syncLoudReadouts gọi liên tục khi kéo thanh trượt).
   Giá trị cache tính bằng đúng biểu thức cũ, chỉ đọc, không bao giờ bị sửa.
   Lab Node trên hàm thật (lượt 16:28, chạy 2 lần, 10 fixture nghe/tham
   chiếu/fs/gains): rms/max/maxf giống từng bit (toPrecision(17)) ở cả
   10 ca, 0 diff, cả lạnh lẫn nóng; tốc độ nóng 1,32->0,40 ms (3,28-3,35x
   ở gains đủ 6 section; 9,21x khi gains=0), lần gọi đầu sau đổi key
   không đổi (1,31 ms). Không chạm solver/WASM/FIR/QA — psV1 dùng đúng
   các giá trị fe đã kiểm chứng giống từng bit. Ý tưởng lượt kế: hướng A —
   đo tỉ lệ thắng/chi phí từng nhánh đệ quy (anchored/dual/rcDual) trên kho
   rộng hơn; hoặc hướng D — đo lại tốc độ dựng FIR (buildFirTaps). --- */
var LOUD_FIT_COMP = { key: "", v: null };
function loudFitError(gains, listen, ref, fs){
  fs = fs || 48000; var se = 0, mx = 0, mxf = 0, i, k;
  /* (vong tu dong 14:27, huong C): he so RBJ cua 6 section chi phu thuoc
     (gains, fs) nen tinh MOT lan moi lan goi roi dung lai cho ca 49 diem
     luoi thay vi tinh lai trong loudRespDb tai moi diem (294 lan goi
     rbjCoeffs thua moi lan danh gia); luoi tan so co dinh cung tinh san
     1 lan. rbjCoeffs la ham thuan tuy theo (type, freq, gain, q, fs) nen
     he so dung lai giong tung bit voi he so tinh lai; thu tu cong
     k=0..5 (bo qua gains[k]===0) va phep tinh phan du khong doi.
     Lab Node tren ham that (luot 14:27, chay 2 lan): 8/8 fixture giong
     tung bit (rms/max/maxf, toPrecision(17)); toc do 0,064->0,035 ms
     (du 6 gains, 1,79-1,85x), 0,034->0,023 ms (2 gains khac 0, 1,48x),
     khong doi khi tat ca gains=0. Khong cham solver/QA.
     Y tuong luot ke: huong D - do lai toc do dung do thi/dung FIR sau khi
     buildFirTaps nhanh hon; hoac huong C - bang tra log cho ISO_FREQS
     trong isoSpl/isoPhonFromSpl (con 1 log thay vi 3 moi lan goi). */
  var cs = [];
  for (k=0;k<LOUD_SECS.length;k++) cs.push(gains[k] !== 0 ? rbjCoeffs(LOUD_SECS[k].type, LOUD_SECS[k].freq, gains[k], LOUD_SECS[k].q, fs) : null);
  /* Cache duong cong bu theo (listen, ref): isoCompDb chi phu thuoc
     (listen, ref, f) — khong phu thuoc gains/fs — nen 49 gia tri tren
     luoi LOUD_FIT_FREQS tinh MOT lan roi dung lai cho moi lan goi sau
     cung cap nghe/tham chieu (syncLoudReadouts goi lien tuc khi keo
     thanh truot). Gia tri duoc tinh bang dung bieu thuc cu, chi doc,
     khong bao gio bi sua nen giong tung bit. */
  var _compKey = listen + "|" + ref;
  var _comp = (LOUD_FIT_COMP.key === _compKey && LOUD_FIT_COMP.v) ? LOUD_FIT_COMP.v : null;
  if (!_comp){ _comp = []; for (i=0;i<49;i++) _comp.push(isoCompDb(listen, ref, LOUD_FIT_FREQS[i])); LOUD_FIT_COMP.key = _compKey; LOUD_FIT_COMP.v = _comp; }
  var _lt = loudTrigFor(LOUD_FIT_TRIG, LOUD_FIT_FREQS, fs);
  for (i=0;i<49;i++){
    var f = LOUD_FIT_FREQS[i];
    var _fcw = _lt[4*i], _fsw = _lt[4*i+1], _fcw2 = _lt[4*i+2], _fsw2 = _lt[4*i+3];
    var s = loudRespDbT(cs, gains, _fcw, _fsw, _fcw2, _fsw2);
    var e = s - _comp[i];
    se += e*e; if (Math.abs(e) > mx){ mx = Math.abs(e); mxf = f; }
  }
  return { rms: Math.sqrt(se/49), max: mx, maxf: mxf };
}

/* ---------- Trạng thái Psychoacoustics ---------- */
var PSY = {
  bypassAll: false,
  loud:  { on:false, ref:80, listen:80, cur:[0,0,0,0,0,0], tgt:[0,0,0,0,0,0] },
  notch: { on:false, freq:7200, depth:-5, q:4 },
  cross: { on:false, mix:35, itdMs:0.30, preset:"studio" },
  dyn:   {},   /* index band -> {on, thr, ratio, attack, release, range} */
  calFreq: 7000
};
var PSY_ID = { b0:1, b1:0, b2:0, a1:0, a2:0 };
/* Cache theo chữ ký trạng thái psycho (psychoDbAt được gọi cho từng tần số
   trong mọi lần quét/vẽ — không có lý do tính lại các bộ hệ số RBJ mỗi điểm). */
var PSY_CC = { key: "", v: null };
function psychoCoeffs(fs){
  if (!Array.isArray(PSY.loud.cur)) PSY.loud.cur = [0,0,0,0,0,0];
  var key = fs + "|" + (PSY.bypassAll ? 1 : 0) + "|" + (PSY.loud.on ? 1 : 0) + "|" + PSY.loud.cur.join(",") +
            "|" + (PSY.notch.on ? 1 : 0) + "|" + PSY.notch.freq + "|" + PSY.notch.depth + "|" + PSY.notch.q;
  if (PSY_CC.key === key && PSY_CC.v) return PSY_CC.v;
  var out;
  if (PSY.bypassAll) out = [PSY_ID, PSY_ID, PSY_ID, PSY_ID, PSY_ID, PSY_ID, PSY_ID];
  else {
    var cs = [], i;
    for (i=0;i<LOUD_SECS.length;i++){
      cs.push((PSY.loud.on && PSY.loud.cur[i] !== 0) ? rbjCoeffs(LOUD_SECS[i].type, LOUD_SECS[i].freq, PSY.loud.cur[i], LOUD_SECS[i].q, fs) : PSY_ID);
    }
    var notch = PSY.notch.on ? rbjCoeffs("peaking", PSY.notch.freq, PSY.notch.depth, PSY.notch.q, fs) : PSY_ID;
    cs.push(notch);
    out = cs;
  }
  PSY_CC.key = key; PSY_CC.v = out;
  return out;
}
function psychoDbAt(f, fs){
  var cs = psychoCoeffs(fs), s = 0;
  /* Section tắt/0 dB là chính PSY_ID (identity): biquadMagDb của nó = 0 dB
     đúng tuyệt đối — bỏ qua không đổi tổng, tránh đánh giá lượng giác thừa. */
  for (var i=0;i<cs.length;i++) if (cs[i] !== PSY_ID) s += biquadMagDb(cs[i], f, fs);
  return s;
}

/* ---------- Dynamic EQ: đường cong tĩnh + cấu hình gửi xuống worklet ---------- */
function dynOffsetDb(levelDb, cfg){
  if (levelDb <= cfg.thr) return 0;
  var amt = (levelDb - cfg.thr) * (1 - 1/Math.max(1, cfg.ratio));
  var cap = Math.abs(cfg.range);
  if (amt > cap) amt = cap;
  return cfg.range < 0 ? -amt : amt;
}
/* Pha C 2026-11-05: guard 3 ham he so kieu RBJ nay nhu rbjCoeffs (dau vao
   khong huu han tra identity; kep freq [10, min(22000, 0.495*fs)], q [0.1, 30];
   kiem tra huu han cuoi) — neu khong, soloCoeffs truyen thang gia tri band
   tho tu preset import (freq null/0/Infinity, q NaN) se tao he so NaN hoac
   loc-zero {b0:0,b1:0,b2:0,a1:-2,a2:1} (cuc kep z=1): solo phat drone to
   khong tuong quan voi tone, cham tran limiter (lab 1429 tren file goc:
   RMS 0,4302, DC 0,1266, corr -0,000; max 0,8912 o tone 100 Hz). Gia tri
   hop le di qua kep KHONG DOI nen ket qua tung bit giong ban goc. */
function bandpassCoeffs(freq, q, fs){
  if(!isFinite(freq) || !isFinite(q) || !isFinite(fs) || fs<=0)
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  freq = Math.min(Math.min(22000, 0.495*fs), Math.max(10, freq));
  q = Math.max(0.1, Math.min(30, q));
  var w0 = 2*Math.PI*freq/fs, cw = Math.cos(w0), sw = Math.sin(w0), al = sw/(2*q), a0 = 1+al;
  var oc = { b0: al/a0, b1: 0, b2: -al/a0, a1: -2*cw/a0, a2: (1-al)/a0 };
  if(!isFinite(oc.b0 + oc.b1 + oc.b2 + oc.a1 + oc.a2))
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  return oc;
}
function lowpassCoeffs(freq, q, fs){
  if(!isFinite(freq) || !isFinite(q) || !isFinite(fs) || fs<=0)
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  freq = Math.min(Math.min(22000, 0.495*fs), Math.max(10, freq));
  q = Math.max(0.1, Math.min(30, q));
  var w0 = 2*Math.PI*freq/fs, cw = Math.cos(w0), sw = Math.sin(w0), al = sw/(2*q), a0 = 1+al;
  var oc = { b0: ((1-cw)/2)/a0, b1: (1-cw)/a0, b2: ((1-cw)/2)/a0, a1: -2*cw/a0, a2: (1-al)/a0 };
  if(!isFinite(oc.b0 + oc.b1 + oc.b2 + oc.a1 + oc.a2))
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  return oc;
}
function highpassCoeffs(freq, q, fs){
  if(!isFinite(freq) || !isFinite(q) || !isFinite(fs) || fs<=0)
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  freq = Math.min(Math.min(22000, 0.495*fs), Math.max(10, freq));
  q = Math.max(0.1, Math.min(30, q));
  var w0 = 2*Math.PI*freq/fs, cw = Math.cos(w0), sw = Math.sin(w0), al = sw/(2*q), a0 = 1+al;
  var oc = { b0: ((1+cw)/2)/a0, b1: -(1+cw)/a0, b2: ((1+cw)/2)/a0, a1: -2*cw/a0, a2: (1-al)/a0 };
  if(!isFinite(oc.b0 + oc.b1 + oc.b2 + oc.a1 + oc.a2))
    return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  return oc;
}
/* Sidechain doc lap: scFreq/scQ null nghia la "theo band" (giu dung hanh vi cu:
   BP tai Fc, Q = max(0.8, Q band)). scType bp/lp/hp, det peak/rms. */
function dynScFor(i){
  var d = PSY.dyn[i] || {}, b = bands[i] || {};
  var f = (d.scFreq !== null && d.scFreq !== undefined && isFinite(d.scFreq)) ? Math.max(20, Math.min(20000, d.scFreq)) : (b.freq || 1000); /* Pha B 2026-11-05: isFinite(null)===true nen null truoc day roi ve 20 Hz thay vi theo band */
  var q = (d.scQ !== null && d.scQ !== undefined && isFinite(d.scQ)) ? Math.max(0.3, Math.min(10, d.scQ)) : Math.max(0.8, b.q || 1); /* Pha B 2026-11-05: nhu tren, null truoc day roi ve Q 0.3 thay vi max(0.8, Q band) */
  var t = (d.scType === "lp" || d.scType === "hp") ? d.scType : "bp";
  return { freq: f, q: q, type: t, det: (d.det === "rms" ? "rms" : "peak") };
}
function dynScCoeffs(sc, fs){
  if (sc.type === "lp") return lowpassCoeffs(sc.freq, sc.q, fs);
  if (sc.type === "hp") return highpassCoeffs(sc.freq, sc.q, fs);
  return bandpassCoeffs(sc.freq, sc.q, fs);
}
function normalizeDynEntry(d){
  /* Pha C 2026-11-07: entry khong phai object -> ve mac dinh thay vi tra
     nguyen — truoc day chuoi/s/true (truthy) lot thang qua day roi
     refreshDynPanel nem TypeError o d.ratio.toFixed(1) (lab dynEq 15/15:
     {5:"abc"}/{5:7}/{5:true} deu nem; poison song sot ca qua JSON
     round-trip cua autoSaveState nen khoi phuc localStorage hong moi lan
     mo trang). Tra ve object mac dinh moi (giong dynCfgFor) de moi diem
     goi gan lai gia tri tra ve deu duoc entry sach. */
  if (!d || typeof d !== "object") return { on:false, thr:-20, ratio:4, attack:10, release:120, range:-8, scFreq:null, scType:"bp", scQ:null, det:"peak" };
  if (d.scFreq !== null && d.scFreq !== undefined && !isFinite(d.scFreq)) d.scFreq = null;
  if (d.scType !== "lp" && d.scType !== "hp") d.scType = "bp";
  if (d.scQ !== null && d.scQ !== undefined && !isFinite(d.scQ)) d.scQ = null;
  if (d.det !== "rms") d.det = "peak";
  /* Pha C 2026-11-05: ve sinh 5 truong so thr/ratio/range/attack/release —
     truoc day chi scFreq/scQ/det duoc ve sinh: preset JSON hoac ban luu
     localStorage ban (thr/ratio null, thieu truong, chuoi so, NaN, ngoai
     khoang) lot thang vao PSY.dyn, roi syncPsyUI -> refreshDynPanel nem
     TypeError o d.ratio.toFixed(1) (null/undefined/chuoi khong co toFixed),
     ap preset do dang (updateAll/pushXCoeffs sau syncPsyUI khong chay) va
     khoi phuc trang thai that bai hoan toan; dynOffsetDb cung tra NaN.
     parseFloat roi moi kiem isFinite (null -> NaN), kep theo dung khoang
     slider (thr [-60,0], ratio [1,20], attack [0,100], release [20,500],
     range [-12,12]); thieu/xau thi ve mac dinh cua dynCfgFor. */
  d.on = !!d.on;
  var _tv = parseFloat(d.thr); d.thr = isFinite(_tv) ? clampN(_tv, -60, 0) : -20;
  var _rv = parseFloat(d.ratio); d.ratio = isFinite(_rv) ? clampN(_rv, 1, 20) : 4;
  var _gv = parseFloat(d.range); d.range = isFinite(_gv) ? clampN(_gv, -12, 12) : -8;
  var _av = parseFloat(d.attack); d.attack = isFinite(_av) ? clampN(_av, 0, 100) : 10;
  var _ev = parseFloat(d.release); d.release = isFinite(_ev) ? clampN(_ev, 20, 500) : 120;
  return d;
}
function dynConfigForWorklet(){
  if (PSY.bypassAll) return null;
  var list = [], det = [], any = false;
  for (var i=0;i<bands.length;i++){
    var d = PSY.dyn[i];
    if (d && d.on && bands[i].on){
      any = true;
      var sc = dynScFor(i);
      var entry = { on:true, thr:d.thr, ratio:d.ratio, range:d.range, attack:d.attack, release:d.release,
                   freq:bands[i].freq, type:bands[i].type, q:bands[i].q, gain:bands[i].gain, det:sc.det };
       if (typeof LR_MODE!=="undefined" && LR_MODE!=="linked" && LR_L && LR_R && LR_L[i] && LR_R[i]){
         entry.fL=LR_L[i].freq; entry.tL=LR_L[i].type; entry.qL=LR_L[i].q; entry.gL=LR_L[i].gain;
         entry.fR=LR_R[i].freq; entry.tR=LR_R[i].type; entry.qR=LR_R[i].q; entry.gR=LR_R[i].gain;
       } else if (typeof MS_MODE!=="undefined" && MS_MODE!=="linked" && MS_M && MS_S && MS_M[i] && MS_S[i]){
         entry.fL=MS_M[i].freq; entry.tL=MS_M[i].type; entry.qL=MS_M[i].q; entry.gL=MS_M[i].gain;
         entry.fR=MS_S[i].freq; entry.tR=MS_S[i].type; entry.qR=MS_S[i].q; entry.gR=MS_S[i].gain;
       }
       list.push(entry);
      det.push(dynScCoeffs(sc, displayFs));
    } else { list.push(null); det.push(null); }
  }
  return any ? { list:list, det:det } : null;
}
function dynCfgFor(i){
  /* Pha C 2026-11-07: nhu normalizeDynEntry — entry truthy khong phai object
     ("abc"/7/true) truoc day lot thang qua normalize roi tra ve nguyen,
     refreshDynPanel nem o d.ratio.toFixed(1); coi nhu thieu -> mac dinh. */
  if (!PSY.dyn[i] || typeof PSY.dyn[i] !== "object") PSY.dyn[i] = { on:false, thr:-20, ratio:4, attack:10, release:120, range:-8, scFreq:null, scType:"bp", scQ:null, det:"peak" };
  else PSY.dyn[i] = normalizeDynEntry(PSY.dyn[i]);
  return PSY.dyn[i];
}

/* ---------- Áp dụng + làm mượt loudness (ramp 30 ms, chống click) ---------- */
var loudRamp = null;
function loudTargets(){
  if (!PSY.loud.on || PSY.bypassAll) return [0,0,0,0,0,0];
  var fs = (typeof displayFs !== "undefined" && displayFs) ? displayFs : 48000;
  return loudGainsFor(PSY.loud.listen, PSY.loud.ref, fs);
}
function startLoudRamp(){
  if (loudRamp) return;
  if (!Array.isArray(PSY.loud.cur)) PSY.loud.cur = [0,0,0,0,0,0];
  if (!Array.isArray(PSY.loud.tgt)) PSY.loud.tgt = [0,0,0,0,0,0];
  loudRamp = setInterval(function(){
    var done = true, i;
    for (i=0;i<6;i++){
      var d = PSY.loud.tgt[i] - PSY.loud.cur[i];
      if (Math.abs(d) < 0.02) PSY.loud.cur[i] = PSY.loud.tgt[i];
      else { PSY.loud.cur[i] += d*0.3; done = false; }
    }
    if (done){ clearInterval(loudRamp); loudRamp = null; }
    pushXCoeffs(); refreshDerived(); pushConfig(); drawGraph(); syncLoudReadouts();
  }, 30);
}
function applyPsycho(){
  var t = loudTargets();
  PSY.loud.tgt = t.slice();
  if (!Array.isArray(PSY.loud.cur)) PSY.loud.cur = [0,0,0,0,0,0];
  startLoudRamp();
  pushXCoeffs(); pushConfig();
  refreshDerived(); drawGraph();
  syncLoudReadouts();
}
function syncLoudReadouts(){
  var raw = isoCompDb(PSY.loud.listen, PSY.loud.ref, 50);
  var rawH = isoCompDb(PSY.loud.listen, PSY.loud.ref, 10000);
  $("psCompLow").textContent = fmtDb(raw)+" dB";
  $("psCompHigh").textContent = fmtDb(rawH)+" dB";
  if (!Array.isArray(PSY.loud.cur)) PSY.loud.cur = [0,0,0,0,0,0];
  $("psCurLow").textContent = fmtDb(PSY.loud.cur[0])+" dB";
  $("psCurHigh").textContent = fmtDb(PSY.loud.cur[5])+" dB";
  var fs = (typeof displayFs !== "undefined" && displayFs) ? displayFs : 48000;
  var fe = loudFitError(PSY.loud.cur, PSY.loud.listen, PSY.loud.ref, fs);
  $("psFitErr").textContent = "RMS "+fe.rms.toFixed(2)+" dB · max "+fe.max.toFixed(2)+" dB @ "+Math.round(fe.maxf)+" Hz";
  $("psLoudSections").textContent = PSY.loud.cur.map(function(g){ return fmtDb(g); }).join(" · ");
  $("psLoudState").textContent = PSY.loud.on ? ("ĐANG BẬT · "+PSY.loud.listen+" / ref "+PSY.loud.ref+" phon") : "ĐANG TẮT";
}

/* ---------- Đồng bộ toàn bộ UI Psycho từ PSY ---------- */
function syncPsyUI(){
  /* bypass tổng */
  $("psBypass").textContent = PSY.bypassAll ? "Bypass Psycho: BẬT (mọi mô-đun bị bỏ qua)" : "Bypass Psycho: Tắt (đang áp dụng)";
  $("psBypass").classList.toggle("on", PSY.bypassAll);
  /* loudness */
  $("psLoudToggle").textContent = PSY.loud.on ? "Tắt bù loudness" : "Bật bù loudness";
  $("psLoudToggle").classList.toggle("on", PSY.loud.on);
  $("psRef").value = PSY.loud.ref; $("psRefOut").textContent = PSY.loud.ref+" phon";
  $("psListen").value = PSY.loud.listen; $("psListenOut").textContent = PSY.loud.listen+" phon";
  /* notch + cal */
  $("psCalFreq").value = PSY.calFreq; $("psCalOut").textContent = Math.round(PSY.calFreq)+" Hz";
  $("psNotchToggle").textContent = PSY.notch.on ? "Tắt notch cá nhân" : "Bật notch cá nhân";
  $("psNotchToggle").classList.toggle("on", PSY.notch.on);
  $("psDepth").value = PSY.notch.depth; $("psDepthOut").textContent = fmtDb(PSY.notch.depth,1)+" dB";
  $("psNotchQ").value = PSY.notch.q; $("psQOut").textContent = PSY.notch.q.toFixed(1);
  $("psNotchInfo").textContent = fmtFreq(PSY.notch.freq)+" · "+fmtDb(PSY.notch.depth,1)+" dB · Q "+PSY.notch.q.toFixed(1)+(PSY.notch.on ? "" : " (đang tắt)");
  $("psNotchState").textContent = PSY.notch.on ? ("ĐÃ ĐẶT · "+fmtFreq(PSY.notch.freq)) : "CHƯA BẬT";
  /* crossfeed */
  $("psXfToggle").textContent = PSY.cross.on ? "Tắt crossfeed" : "Bật crossfeed";
  $("psXfToggle").classList.toggle("on", PSY.cross.on);
  $("psMix").value = PSY.cross.mix; $("psMixOut").textContent = PSY.cross.mix+"%";
  $("psItd").value = PSY.cross.itdMs; $("psItdOut").textContent = PSY.cross.itdMs.toFixed(2)+" ms";
  $("psItdSamples").textContent = Math.round(PSY.cross.itdMs*displayFs/1000)+" mẫu @ "+displayFs.toLocaleString("vi-VN")+" Hz";
  $("psXfState").textContent = PSY.cross.on ? ("ĐANG BẬT · mix "+PSY.cross.mix+"%") : "ĐANG TẮT";
  Array.prototype.forEach.call($("psXfSeg").children, function(b){ b.classList.toggle("on", b.dataset.xf === PSY.cross.preset); });
  syncLoudReadouts();
  refreshDynPanel();
}
function refreshDynPanel(){
  var b = bands[selBand], d = dynCfgFor(selBand);
  if (!b) return; /* Pha C 2026-11-05: nhu updateCoeffPanel — truoc day b.freq nem TypeError khi selBand ngoai khoang (lab 1555) */
  $("psDynBand").textContent = "Band "+(selBand+1)+" · "+fmtFreq(b.freq)+" · "+TYPELBL[b.type]+" · gain tĩnh "+fmtDb(b.gain,1)+" dB";
  $("psDynToggle").textContent = d.on ? "Tắt Dynamic EQ cho band này" : "Bật Dynamic EQ cho band này";
  $("psDynToggle").classList.toggle("on", d.on);
  $("psThr").value = d.thr; $("psThrOut").textContent = d.thr+" dBFS";
  $("psRatio").value = d.ratio; $("psRatioOut").textContent = d.ratio.toFixed(1)+" : 1";
  $("psAtk").value = d.attack; $("psAtkOut").textContent = d.attack+" ms";
  $("psRel").value = d.release; $("psRelOut").textContent = d.release+" ms";
  $("psRange").value = d.range; $("psRangeOut").textContent = fmtDb(d.range,1)+" dB";
  $("psDyn30").textContent = fmtDb(dynOffsetDb(-30, d))+" dB";
  $("psDyn10").textContent = fmtDb(dynOffsetDb(-10, d))+" dB";
  var sc = dynScFor(selBand);
  $("psScFreq").value = scSliderFromFreq(sc.freq);
  $("psScFreqOut").textContent = fmtFreq(sc.freq) + ((d.scFreq !== null && d.scFreq !== undefined && isFinite(d.scFreq)) ? "" : " (theo band)"); /* Pha B 2026-11-05: nhan "(theo band)" truoc day khong bao gio hien khi scFreq=null */
  $("psScQ").value = sc.q;
  $("psScQOut").textContent = sc.q.toFixed(1) + ((d.scQ !== null && d.scQ !== undefined && isFinite(d.scQ)) ? "" : " (theo band)"); /* Pha B 2026-11-05: nhu tren cho scQ */
  Array.prototype.forEach.call($("psScSeg").children, function(b2){ b2.classList.toggle("on", b2.dataset.sc === sc.type); });
  Array.prototype.forEach.call($("psDetSeg").children, function(b2){ b2.classList.toggle("on", b2.dataset.det === sc.det); });
  $("psDynScInfo").textContent = (sc.type === "bp" ? "Band-pass" : sc.type === "lp" ? "Low-pass" : "High-pass") + " @ " + fmtFreq(sc.freq) + " · Q " + sc.q.toFixed(1) + " · detector " + (sc.det === "rms" ? "RMS (block 128 mẫu)" : "Peak");
  var onList = []; for (var i=0;i<bands.length;i++) if (PSY.dyn[i] && PSY.dyn[i].on) onList.push(i+1);
  $("psDynState").textContent = onList.length ? (onList.length+" band đang bật Dynamic EQ: Band "+onList.join(", ")) : "đang tắt";
}

/* ---------- Sự kiện: bypass + loudness ---------- */
$("psBypass").addEventListener("click", function(){ PSY.bypassAll = !PSY.bypassAll; syncPsyUI(); applyPsycho(); });
$("psLoudToggle").addEventListener("click", function(){ PSY.loud.on = !PSY.loud.on; syncPsyUI(); applyPsycho(); });
$("psRef").addEventListener("input", function(){ PSY.loud.ref = parseInt(this.value,10); $("psRefOut").textContent = PSY.loud.ref+" phon"; applyPsycho(); });
$("psListen").addEventListener("input", function(){ PSY.loud.listen = parseInt(this.value,10); $("psListenOut").textContent = PSY.loud.listen+" phon"; applyPsycho(); });
$("psNight").addEventListener("click", function(){
  PSY.loud.on = true; PSY.loud.listen = 45;
  syncPsyUI(); applyPsycho();
});

/* ---------- Sự kiện: hiệu chuẩn ống tai (tone/quét tích hợp qua engine) ---------- */
var calOsc = null, calGainNode = null, calOn = false, sweepOn = false, sweepTimer = null, sweepT0 = 0;
function calSetFreq(f){
  PSY.calFreq = f;
  $("psCalFreq").value = f; $("psCalOut").textContent = Math.round(f)+" Hz";
  if (calOsc && AC) calOsc.frequency.setTargetAtTime(f, AC.currentTime, 0.02);
}
function calStopSweep(){
  sweepOn = false;
  if (sweepTimer){ clearInterval(sweepTimer); sweepTimer = null; }
  $("psSweep").classList.remove("active");
}
function calStopTone(){
  calStopSweep();
  if (calOsc && AC){
    var o = calOsc, g = calGainNode;
    try { g.gain.setTargetAtTime(0, AC.currentTime, 0.03); setTimeout(function(){ try{ o.stop(); }catch(e){} }, 180); } catch(e){}
    calOsc = null; calGainNode = null;
  }
  calOn = false;
  $("psTone").textContent = "▶ Tone tại tần số đã chọn"; $("psTone").classList.remove("active");
}
async function calStartTone(){
  var ok = await initEngine(); if (!ok) return false;
  if (earProbeOn) earProbeStop();
  if (calOsc) return true;
  calOsc = AC.createOscillator(); calOsc.type = "sine"; calOsc.frequency.value = PSY.calFreq;
  calGainNode = AC.createGain(); calGainNode.gain.value = 0;
  calOsc.connect(calGainNode); calGainNode.connect(inputBus);
  calOsc.start();
  calGainNode.gain.setTargetAtTime(0.12, AC.currentTime, 0.05);
  calOn = true;
  $("psTone").textContent = "⏸ Dừng tone"; $("psTone").classList.add("active");
  return true;
}
$("psTone").addEventListener("click", async function(){ if (calOn) calStopTone(); else await calStartTone(); });
$("psSweep").addEventListener("click", async function(){
  if (sweepOn){ calStopSweep(); return; }
  if (!calOn){ var ok = await calStartTone(); if (!ok) return; }
  sweepOn = true; sweepT0 = performance.now();
  this.classList.add("active");
  sweepTimer = setInterval(function(){
    var ph = ((performance.now()-sweepT0)/6000) % 1;
    calSetFreq(5500*Math.pow(9500/5500, ph));
  }, 50);
});
$("psCalFreq").addEventListener("input", function(){ calStopSweep(); calSetFreq(parseFloat(this.value)); });
$("psMark").addEventListener("click", function(){
  PSY.notch.freq = Math.round(PSY.calFreq);
  PSY.notch.on = true;
  earRes.sweep = Math.round(PSY.calFreq); earResRefresh();
  if (typeof autoSaveState === "function"){ try { autoSaveState(); } catch(e){} }
  syncPsyUI(); applyPsycho();
});

/* ---------- Suy luan cong huong ong tai tu nhac thuc te (Nhom 2 v2) ---------- */
/* Phuong phap: pink noise phang theo quang tam (hoac nhac cua ban dang phat
   qua engine) di qua mot notch do hep (peaking -12 dB, Q 8) quet logarit
   5.5-9.5 kHz, lap 12 giay. Notch do la BiquadFilterNode that nam san trong
   chuoi phat (inputBus -> notch do -> worklet): gain 0 dB khi tat la dong
   nhat theo cong thuc RBJ peaking, nen khong doi am thanh luc khong quet.
   Khi notch do trung dinh cong huong ong tai, dinh do bi triet manh nhat
   nen tieng nghe em nhat - diem em nhat la ung vien cong huong. Day la suy
   luan cam nhan (khong co micro do), nen app chi de xuat ap dung khi no
   khop voi danh dau quet tone (choi nhat) trong +-2 ban am; nguoc lai giu
   ca hai danh dau va khong tu ap dung. */
var EAR_FLO = 5500, EAR_FHI = 9500, EAR_PROBE_DEPTH = -12, EAR_PROBE_Q = 8, EAR_PROBE_MS = 12000, EAR_AGREE_SEMI = 2;
var earProbeNode = null, earProbeOn = false, earProbeTimer = null, earProbeT0 = 0, earProbeFreq = 7000;
var earRes = { sweep: null, noise: null };
function earProbeFreqAt(ph){
  if (!isFinite(ph)) ph = 0;
  ph = Math.max(0, Math.min(1, ph));
  return EAR_FLO * Math.pow(EAR_FHI/EAR_FLO, ph);
}
function earResCompare(fSweep, fNoise){
  if (!isFinite(fSweep) || !isFinite(fNoise) || fSweep <= 0 || fNoise <= 0) return null;
  var ratio = fNoise/fSweep;
  var semi = 12*Math.log(ratio)/Math.log(2);
  return { ratio: ratio, semitones: semi, agree: Math.abs(semi) <= EAR_AGREE_SEMI + 1e-9, suggested: Math.sqrt(fSweep*fNoise) };
}
function earResRefresh(){
  $("earProbeInfo").textContent = earProbeOn ? ("dang quet - notch do "+Math.round(earProbeFreq)+" Hz - -12 dB - Q 8") : "dang tat";
  $("earSweepMark").textContent = earRes.sweep ? (Math.round(earRes.sweep)+" Hz (quet tone, choi nhat)") : "chua co - bam \u201cDanh dau tan so choi nhat\u201d o tren";
  $("earNoiseMark").textContent = earRes.noise ? (Math.round(earRes.noise)+" Hz (nhac thuc te, em nhat)") : "chua co - quet notch do roi bam \u201cDanh dau diem em nhat\u201d";
  var c = (earRes.sweep && earRes.noise) ? earResCompare(earRes.sweep, earRes.noise) : null;
  if (!c) $("earResInfo").textContent = "can ca hai danh dau moi ket luan";
  else if (c.agree) $("earResInfo").textContent = "KHOP trong "+c.semitones.toFixed(2)+" ban am - de xuat notch "+Math.round(c.suggested)+" Hz (trung binh hinh hoc); bam \u201cAp dung notch da suy luan\u201d de dat (giu nguyen do sau/Q hien tai)";
  else $("earResInfo").textContent = "CHUA KHOP: lech "+c.semitones.toFixed(2)+" ban am (> +-2) - giu ca hai danh dau, nghe lai va danh dau lai; app khong tu ap dung khi chua khop";
}
function earProbeStop(){
  earProbeOn = false;
  if (earProbeTimer){ clearInterval(earProbeTimer); earProbeTimer = null; }
  if (earProbeNode && AC){
    try { earProbeNode.gain.setTargetAtTime(0, AC.currentTime, 0.03); } catch(e){}
  }
  $("earProbeBtn").textContent = "\u25b6 Quet notch do tren nhac dang phat"; $("earProbeBtn").classList.remove("active");
  earResRefresh();
}
async function earProbeStart(){
  var ok = await initEngine(); if (!ok) return false;
  if (calOn) calStopTone();
  if (!earProbeNode) return false;
  try {
    earProbeNode.gain.setTargetAtTime(EAR_PROBE_DEPTH, AC.currentTime, 0.03);
    earProbeNode.Q.setTargetAtTime(EAR_PROBE_Q, AC.currentTime, 0.03);
  } catch(e){}
  earProbeOn = true; earProbeT0 = performance.now();
  $("earProbeBtn").textContent = "\u23f8 Dung quet notch do"; $("earProbeBtn").classList.add("active");
  earProbeTimer = setInterval(function(){
    var ph = ((performance.now()-earProbeT0)/EAR_PROBE_MS) % 1;
    earProbeFreq = earProbeFreqAt(ph);
    try { earProbeNode.frequency.setTargetAtTime(earProbeFreq, AC.currentTime, 0.02); } catch(e){}
    earResRefresh();
  }, 50);
  earResRefresh();
  return true;
}
$("earProbeBtn").addEventListener("click", async function(){ if (earProbeOn) earProbeStop(); else await earProbeStart(); });
$("earMarkSmooth").addEventListener("click", function(){
  if (!earProbeOn){ $("earResInfo").textContent = "hay bam \u201cQuet notch do\u201d truoc, nghe roi moi danh dau diem em nhat"; return; }
  earRes.noise = Math.round(earProbeFreq); earResRefresh();
  if (typeof autoSaveState === "function"){ try { autoSaveState(); } catch(e){} }
});
$("earApplyRes").addEventListener("click", function(){
  var c = (earRes.sweep && earRes.noise) ? earResCompare(earRes.sweep, earRes.noise) : null;
  if (!c || !c.agree){ $("earResInfo").textContent = "chua ap dung: can ca hai danh dau va khop trong +-2 ban am"; return; }
  PSY.notch.freq = Math.round(c.suggested); PSY.notch.on = true;
  syncPsyUI(); applyPsycho(); earResRefresh();
  if (typeof autoSaveState === "function"){ try { autoSaveState(); } catch(e){} }
});
$("psNotchToggle").addEventListener("click", function(){ PSY.notch.on = !PSY.notch.on; syncPsyUI(); applyPsycho(); });
$("psDepth").addEventListener("input", function(){ PSY.notch.depth = parseFloat(this.value); $("psDepthOut").textContent = fmtDb(PSY.notch.depth,1)+" dB"; syncPsyUI(); applyPsycho(); });
$("psNotchQ").addEventListener("input", function(){ PSY.notch.q = parseFloat(this.value); $("psQOut").textContent = PSY.notch.q.toFixed(1); syncPsyUI(); applyPsycho(); });

/* ---------- Cham diem mu da cau hinh (Nhom 2 v2) ---------- */
/* Khac A/B/X (doan X la A hay B): day la cham diem ua thich cho toi da 4
   cau hinh. Thu tu nghe duoc xao tron (Fisher-Yates) va nhan an (Mau 1..N);
   ban cham 1-5 sao cho tung mau, xong moi hien ket qua xep hang. Diem da duoc
   can LUFS BS.1770 giua cac ung vien (mac dinh bat, trim chi giam qua cung duong
   slotLin cua worklet nhu A/B/X) nen chenh loudness khong lech diem; van chi la
   goi y cam nhan, khong phai phep do. Slot A/B/X va Bypass bi chan trong luc cham
   de khong cuop trim/lam cac mau nghe giong nhau. Thang chi ap dung khi ban bam tay;
   Che do Tu Dong Toan Dien khong bao gio tu ap dung ket qua cham mu.
   Trong luc cham, ung vien dang nghe ghi de len dai band hien tai; baseline
   truoc khi cham duoc giu de khoi phuc. Ung vien luu localStorage rieng
   (webAutoEq.blind.v1), chi tren may nay. */
var BLIND_MAX = 4;
var blind = { cands: [], order: [], pos: 0, ratings: {}, listened: {}, started: false, revealed: false, baseline: null, seq: 0, lufsOn: true, lufs: null, trims: null, audPos: null };
function blindSeededRng(seed){
  var s = (seed >>> 0) || 1;
  return function(){ s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function blindShuffleIdx(n, rng){
  var a = []; for (var i = 0; i < n; i++) a.push(i);
  var r = (typeof rng === "function") ? rng : Math.random;
  for (var j = a.length - 1; j > 0; j--){ var k = Math.floor(r() * (j + 1)); var t = a[j]; a[j] = a[k]; a[k] = t; }
  return a;
}
function blindSanitizeCand(c){
  c = c || {};
  var bs = [];
  var src = Array.isArray(c.bands) ? c.bands : [];
  for (var i = 0; i < src.length; i++){
    var b = src[i] || {};
    bs.push({ freq: isFinite(b.freq) ? Math.max(20, Math.min(20000, b.freq)) : 1000,
      type: (b.type === "lowshelf" || b.type === "highshelf") ? b.type : "peaking",
      gain: isFinite(b.gain) ? Math.max(-12, Math.min(12, b.gain)) : 0,
      q: isFinite(b.q) ? Math.max(0.1, Math.min(10, b.q)) : 1, on: b.on !== false });
  }
  return { name: (typeof c.name === "string" && c.name) ? c.name : "Cấu hình", count: (c.count === 20) ? 20 : 10, bands: bs };
}
function blindSanitizeRating(r){
  var v = Math.floor(Number(r));
  if (!isFinite(v) || v < 1 || v > 5) return null;
  return v;
}
function blindRankPairs(pairs){
  var a = Array.isArray(pairs) ? pairs.slice() : [];
  a = a.filter(function(p){ return p && isFinite(p.rating) && p.rating >= 1 && p.rating <= 5; });
  a.sort(function(x, y){ if (y.rating !== x.rating) return y.rating - x.rating; return x.sample - y.sample; });
  return a;
}
function blindSnapCurrent(){
  return { count: bandCount, bands: bands.map(function(b){ return { freq: b.freq, type: b.type, gain: b.gain, q: b.q, on: b.on }; }) };
}
function blindApplySnap(snap){
  if (!snap) return;
  if (snap.count !== bandCount) setBandCount(snap.count);
  for (var i = 0; i < bands.length && i < snap.bands.length; i++){
    bands[i].freq = snap.bands[i].freq; bands[i].type = snap.bands[i].type;
    bands[i].gain = snap.bands[i].gain; bands[i].q = snap.bands[i].q; bands[i].on = snap.bands[i].on;
  }
  updateAll(true);
}
/* Cân loudness LUFS giữa các ứng viên (nâng cấp 2026-10-31): dùng đúng
   máy tính LUFS tích hợp BS.1770 (lufsFor) và cùng phổ mô hình với Blind
   A/B/X; trim chỉ giảm, neo theo ứng viên nhỏ nhất, áp qua cùng đường
   slotLin của worklet mà A/B/X dùng (abxTrimDb hỏi blindTrimDb khi
   A/B/X không giữ slot nào). */
function blindComputeLufs(){
  blind.lufs = null; blind.trims = null;
  if (typeof lufsFor !== "function" || blind.cands.length === 0) return;
  blind.lufs = blind.cands.map(function(c){ return lufsFor(c.bands); });
  var mn = Math.min.apply(null, blind.lufs);
  blind.trims = blind.lufs.map(function(v){ return mn - v; });
}
function blindTrimDb(){
  if (!blind.started || !blind.lufsOn || blind.audPos == null || !blind.trims) return 0;
  var ci = blind.order[blind.audPos];
  return (ci != null && isFinite(blind.trims[ci])) ? blind.trims[ci] : 0;
}
function blindSave(){
  try { window.localStorage.setItem("webAutoEq.blind.v1", JSON.stringify({ v: 1, seq: blind.seq, cands: blind.cands, lufsOn: blind.lufsOn })); } catch (e) {}
}
function blindLoad(){
  try {
    var raw = window.localStorage.getItem("webAutoEq.blind.v1"); if (!raw) return;
    var s = JSON.parse(raw); if (!s || s.v !== 1 || !Array.isArray(s.cands)) return;
    blind.cands = s.cands.map(blindSanitizeCand).filter(function(c){ return c.bands.length > 0; }).slice(0, BLIND_MAX);
    if (isFinite(s.seq)) blind.seq = Math.max(blind.seq, Math.floor(s.seq));
    if (typeof s.lufsOn === "boolean"){ blind.lufsOn = s.lufsOn; var tg = $("blindLufsToggle"); if (tg) tg.checked = s.lufsOn; }
  } catch (e) {}
}
function blindSoloOn(){ return (typeof SOLO !== "undefined" && SOLO && SOLO.on); }
function blindRefresh(){
  var list = $("blindCands");
  list.innerHTML = "";
  if (blind.cands.length === 0){
    list.textContent = "chưa có ứng viên — chỉnh EQ rồi bấm “Thêm cấu hình hiện tại làm ứng viên” (tối đa 4)";
  } else {
    if (!blind.started && blind.cands.length && !blind.lufs) blindComputeLufs();
    blind.cands.forEach(function(c, i){
      var row = document.createElement("div"); row.className = "kv";
      var s = document.createElement("span"); s.textContent = "Ứng viên " + (i + 1) + ": " + c.name;
      var b = document.createElement("b"); b.textContent = c.count + " band · " + c.bands.length + " band đã lưu" +
        ((blind.lufs && isFinite(blind.lufs[i])) ? " · LUFS " + blind.lufs[i].toFixed(2) + (blind.lufsOn ? " · trim " + fmtDb(blind.trims[i]) + " dB" : "") : "");
      var del = document.createElement("button"); del.className = "btn small"; del.textContent = "Xoá"; del.setAttribute("data-blind-del", String(i));
      row.appendChild(s); row.appendChild(b); row.appendChild(del); list.appendChild(row);
    });
  }
  if (!blind.started){
    $("blindSampleInfo").textContent = "chưa bắt đầu — cần ít nhất 2 ứng viên";
  } else {
    var cur = "Mẫu " + (blind.pos + 1) + "/" + blind.order.length;
    cur += blind.listened[blind.pos] ? " — đã nghe" : " — chưa nghe, bấm “Nghe mẫu này”";
    if (blind.ratings[blind.pos]) cur += " · đã chấm " + blind.ratings[blind.pos] + "/5";
    if (blind.lufsOn && blind.audPos != null && blind.audPos === blind.pos && blind.trims && isFinite(blind.trims[blind.order[blind.pos]])) cur += " · đã cân LUFS (trim " + fmtDb(blind.trims[blind.order[blind.pos]]) + " dB)";
    if (blind.revealed) cur += " · đã hiện kết quả";
    $("blindSampleInfo").textContent = cur;
  }
  var seg = $("blindRateSeg"); if (seg){
    var btns = seg.querySelectorAll("button");
    btns.forEach(function(btn){ btn.classList.toggle("on", blind.started && blind.ratings[blind.pos] === parseInt(btn.getAttribute("data-rate"), 10)); });
  }
}
function blindInfo(msg){ $("blindInfo").textContent = msg; }
$("blindCands").addEventListener("click", function(e){
  var btn = e.target.closest("button[data-blind-del]"); if (!btn) return;
  if (blind.started){ blindInfo("đang chấm dở — không xoá ứng viên giữa chừng; bấm “Dừng / khôi phục” rồi xoá"); return; }
  blind.cands.splice(parseInt(btn.getAttribute("data-blind-del"), 10), 1);
  blindSave(); blindRefresh(); blindInfo("đã xoá ứng viên");
});
$("blindAddBtn").addEventListener("click", function(){
  if (blind.started){ blindInfo("đang chấm dở — không thêm ứng viên giữa chừng; bấm “Dừng / khôi phục” rồi thêm"); return; }
  if (blind.cands.length >= BLIND_MAX){ blindInfo("đã đủ tối đa 4 ứng viên — xoá bớt rồi thêm"); return; }
  blind.seq += 1;
  var snap = blindSnapCurrent();
  blind.cands.push(blindSanitizeCand({ name: "Cấu hình " + blind.seq, count: snap.count, bands: snap.bands }));
  blind.lufs = null; blind.trims = null;
  blindSave(); blindRefresh(); blindInfo("đã thêm ứng viên “Cấu hình " + blind.seq + "” (" + snap.count + " band)");
});
$("blindClearBtn").addEventListener("click", function(){
  if (blind.started){ blindInfo("đang chấm dở — không xoá giữa chừng; bấm “Dừng / khôi phục” rồi xoá"); return; }
  blind.cands = []; blind.lufs = null; blind.trims = null; blindSave(); blindRefresh(); blindInfo("đã xoá tất cả ứng viên");
});
$("blindStartBtn").addEventListener("click", function(){
  if (blind.started){ blindInfo("đang chấm dở — bấm “Dừng / khôi phục” rồi bắt đầu lại"); return; }
  if (blind.cands.length < 2){ blindInfo("cần ít nhất 2 ứng viên mới chấm mù được"); return; }
  if (blindSoloOn()){ blindInfo("đang bật Solo Band — tắt Solo Band trước khi chấm mù để kết quả không lệch"); return; }
  /* Pha B 2026-11-07: tach slot A/B/X va tat Bypass truoc khi cham — neu khong,
     abxTrimDb uu tien trim slot thay trim mu (lab blindtrim: lech 0,69 dB voi slot A,
     0,57 dB voi che do X, 4,94 dB voi off+Bypass) va Bypass lam ca 4 mau nghe giong
     nhau (phang, worklet out.set(inp)) nen diem cham mat y nghia. Chi dong khi co
     slot/Bypass dang bat; duong cham binh thuong (cur, khong Bypass) khong doi. */
  if (ABX.active !== "cur" || (typeof bypass !== "undefined" && bypass)){
    if (typeof abxDetach === "function") abxDetach();
    if (ABX.active === "off"){ ABX.active = "cur"; ABX.hidden = null; }
    if (typeof bypass !== "undefined" && bypass) setBypassSlot(false);
    syncAbxUI();
  }
  blind.baseline = blindSnapCurrent();
  blindComputeLufs();
  blind.order = blindShuffleIdx(blind.cands.length);
  blind.pos = 0; blind.ratings = {}; blind.listened = {}; blind.started = true; blind.revealed = false;
  $("blindResult").textContent = "—";
  blindRefresh(); blindInfo("đã xáo trộn " + blind.order.length + " mẫu — tên ứng viên đang ẩn; bấm “Nghe mẫu này” cho Mẫu 1");
});
$("blindListenBtn").addEventListener("click", function(){
  if (!blind.started){ blindInfo("bấm “Bắt đầu chấm mù” trước"); return; }
  if (blindSoloOn()){ blindInfo("đang bật Solo Band — tắt Solo Band trước khi nghe mẫu để kết quả không lệch"); return; }
  blind.audPos = blind.pos;
  blindApplySnap(blind.cands[blind.order[blind.pos]]);
  blind.listened[blind.pos] = true;
  blindRefresh(); blindInfo("đang nghe Mẫu " + (blind.pos + 1) + " (ứng viên ẩn) — nghe xong chấm 1–5 sao; nếu engine chưa chạy, bấm nguồn phát trước");
});
$("blindPrevBtn").addEventListener("click", function(){
  if (!blind.started){ blindInfo("bấm “Bắt đầu chấm mù” trước"); return; }
  if (blind.pos <= 0){ blindInfo("đang ở Mẫu 1 rồi"); return; }
  blind.pos -= 1; blindRefresh(); blindInfo("quay lại Mẫu " + (blind.pos + 1) + " — nghe lại và chấm lại được");
});
$("blindNextBtn").addEventListener("click", function(){
  if (!blind.started){ blindInfo("bấm “Bắt đầu chấm mù” trước"); return; }
  if (blind.pos >= blind.order.length - 1){ blindInfo("đã ở mẫu cuối — chấm xong hết thì bấm “Hiện kết quả”"); return; }
  blind.pos += 1; blindRefresh(); blindInfo("sang Mẫu " + (blind.pos + 1) + " — bấm “Nghe mẫu này” rồi chấm");
});
$("blindRateSeg").addEventListener("click", function(e){
  var btn = e.target.closest("button[data-rate]"); if (!btn) return;
  if (!blind.started){ blindInfo("bấm “Bắt đầu chấm mù” trước"); return; }
  if (!blind.listened[blind.pos]){ blindInfo("hãy nghe mẫu này trước khi chấm"); return; }
  var r = blindSanitizeRating(btn.getAttribute("data-rate")); if (r === null) return;
  blind.ratings[blind.pos] = r;
  blindRefresh(); blindInfo("Mẫu " + (blind.pos + 1) + ": " + r + "/5 — chấm lại được trước khi hiện kết quả");
});
$("blindRevealBtn").addEventListener("click", function(){
  if (!blind.started){ blindInfo("bấm “Bắt đầu chấm mù” trước"); return; }
  var missing = [];
  for (var p = 0; p < blind.order.length; p++) if (!blind.ratings[p]) missing.push(p + 1);
  if (missing.length){ blindInfo("chưa chấm đủ — còn thiếu Mẫu " + missing.join(", ")); return; }
  var pairs = [];
  for (var q = 0; q < blind.order.length; q++) pairs.push({ cand: blind.order[q], sample: q + 1, rating: blind.ratings[q] });
  var rank = blindRankPairs(pairs);
  var sum = 0; rank.forEach(function(r){ sum += r.rating; });
  var parts = rank.map(function(r, i){ return "Hạng " + (i + 1) + ": " + blind.cands[r.cand].name + " (Mẫu " + r.sample + ") — " + r.rating + "/5"; });
  $("blindResult").textContent = parts.join(" · ") + " · Điểm trung bình: " + (sum / rank.length).toFixed(2) + "/5";
  blind.revealed = true;
  blindRefresh(); blindInfo("đã hiện kết quả — cấu hình thắng là “" + blind.cands[rank[0].cand].name + "”; chỉ áp dụng khi bạn bấm tay nút bên dưới");
});
$("blindApplyBtn").addEventListener("click", function(){
  if (!blind.started || !blind.revealed){ blindInfo("chấm đủ và hiện kết quả trước, rồi mới áp dụng cấu hình thắng"); return; }
  var pairs = [];
  for (var q = 0; q < blind.order.length; q++) pairs.push({ cand: blind.order[q], sample: q + 1, rating: blind.ratings[q] });
  var rank = blindRankPairs(pairs);
  if (!rank.length) return;
  /* Pha B 2026-11-07: tra audPos ve null truoc khi ap thang — neu khong, thang nghe
     voi trim cua mau nghe cuoi (lab blindtrim: lech 0,69 dB); thang dung doc lap phai
     nghe o muc tu nhien (trim 0), giong nut Dung/khoi phuc. */
  blind.audPos = null;
  blindApplySnap(blind.cands[rank[0].cand]);
  blindInfo("đã áp dụng cấu hình thắng “" + blind.cands[rank[0].cand].name + "” (bấm tay) — muốn về cấu hình trước khi chấm thì bấm “Dừng / khôi phục”");
});
$("blindStopBtn").addEventListener("click", function(){
  blind.audPos = null;
  if (blind.baseline) blindApplySnap(blind.baseline);
  blind.started = false; blind.revealed = false; blind.order = []; blind.pos = 0; blind.ratings = {}; blind.listened = {};
  blindRefresh(); blindInfo("đã dừng chấm mù và khôi phục cấu hình trước khi chấm");
  /* Pha B 2026-11-07: xoá thông báo "Đang chấm mù" còn sót ở panel A/B/X —
     các guard applySlot/abxX ghi vào abxMsg lúc đang chấm, nhưng handler Dừng
     trước đây không chạm tới abxMsg nên câu đó ở lại dù đã dừng (lab abxmsg). */
  abxMsg("Đã dừng chấm mù — có thể nghe lại slot A/B/X hoặc bật chế độ X.");
});
$("blindLufsToggle").addEventListener("change", function(){
  blind.lufsOn = !!this.checked;
  blindSave();
  if (blind.started) pushConfig();
  blindRefresh();
  blindInfo(blind.lufsOn ? "đã bật cân LUFS giữa các ứng viên (trim áp khi nghe mẫu)" : "đã tắt cân LUFS — ứng viên nghe ở mức gốc, chỉ có pre-amp tự động riêng");
});
blindLoad(); blindRefresh();

/* ---------- Sự kiện: crossfeed ---------- */
$("psXfToggle").addEventListener("click", function(){ PSY.cross.on = !PSY.cross.on; PSY.cross.preset = PSY.cross.on ? (PSY.cross.mix>=50 ? "concert" : "studio") : "off"; syncPsyUI(); pushConfig(); });
$("psXfSeg").addEventListener("click", function(e){
  var btn = e.target.closest("button"); if (!btn) return;
  var p = btn.dataset.xf; PSY.cross.preset = p;
  if (p === "off"){ PSY.cross.on = false; }
  else if (p === "studio"){ PSY.cross.on = true; PSY.cross.mix = 35; PSY.cross.itdMs = 0.30; }
  else { PSY.cross.on = true; PSY.cross.mix = 65; PSY.cross.itdMs = 0.35; }
  syncPsyUI(); pushConfig();
});
$("psMix").addEventListener("input", function(){ PSY.cross.mix = parseInt(this.value,10); PSY.cross.on = PSY.cross.mix > 0; PSY.cross.preset = "custom"; syncPsyUI(); pushConfig(); });
$("psItd").addEventListener("input", function(){ PSY.cross.itdMs = parseFloat(this.value); PSY.cross.preset = "custom"; syncPsyUI(); pushConfig(); });

/* ---------- Sự kiện: Dynamic EQ ---------- */
$("bands").addEventListener("click", function(){ refreshDynPanel(); });
$("psDynToggle").addEventListener("click", function(){ var d = dynCfgFor(selBand); d.on = !d.on; refreshDynPanel(); pushConfig(); });
function dynSlider(id, outId, key, fmtFn){
  $(id).addEventListener("input", function(){
    var d = dynCfgFor(selBand); d[key] = parseFloat(this.value);
    $(outId).textContent = fmtFn(d[key]);
    $("psDyn30").textContent = fmtDb(dynOffsetDb(-30, d))+" dB";
    $("psDyn10").textContent = fmtDb(dynOffsetDb(-10, d))+" dB";
    pushConfig();
  });
}
dynSlider("psThr", "psThrOut", "thr", function(v){ return v+" dBFS"; });
dynSlider("psRatio", "psRatioOut", "ratio", function(v){ return v.toFixed(1)+" : 1"; });
dynSlider("psAtk", "psAtkOut", "attack", function(v){ return v+" ms"; });
dynSlider("psRel", "psRelOut", "release", function(v){ return v+" ms"; });
dynSlider("psRange", "psRangeOut", "range", function(v){ return fmtDb(v,1)+" dB"; });
/* Sidechain slider: thang log 20 Hz-20 kHz (3 decade) qua slider 0-1000. */
function scSliderFromFreq(f){ return Math.round(1000*(Math.log10(Math.max(20, Math.min(20000, f))/20)/3)); }
function scFreqFromSlider(v){ return 20*Math.pow(10, 3*v/1000); }
$("psScFreq").addEventListener("input", function(){
  var d = dynCfgFor(selBand); d.scFreq = scFreqFromSlider(parseFloat(this.value));
  refreshDynPanel(); pushConfig();
});
$("psScQ").addEventListener("input", function(){
  var d = dynCfgFor(selBand); d.scQ = parseFloat(this.value);
  refreshDynPanel(); pushConfig();
});
Array.prototype.forEach.call($("psScSeg").children, function(b3){
  b3.addEventListener("click", function(){ var d = dynCfgFor(selBand); d.scType = this.dataset.sc; refreshDynPanel(); pushConfig(); });
});
Array.prototype.forEach.call($("psDetSeg").children, function(b3){
  b3.addEventListener("click", function(){ var d = dynCfgFor(selBand); d.det = this.dataset.det; refreshDynPanel(); pushConfig(); });
});
$("psScFollow").addEventListener("click", function(){
  var d = dynCfgFor(selBand); d.scFreq = null; d.scQ = null; refreshDynPanel(); pushConfig();
});

/* ---------- Preset schema v2 + migration v1 ---------- */
var lastPreset = null;
function capturePresetV2(){
  return { version:2, name:"Web AutoEQ Preset", created:new Date().toISOString(),
    eq:{ mode:mode, preMode:preMode, manualPreDb:manualPreDb, extraHeadDb:extraHeadDb,
      bands: bands.map(function(b){ return { freq:b.freq, type:b.type, gain:b.gain, q:b.q, on:b.on }; }) },
    autoeq:{ target:$("aeTarget").value, tilt:parseFloat($("aeTilt").value), bass:parseFloat($("aeBass").value),
      ear:parseFloat($("aeEar").value), nBands:parseInt($("aeBands").value,10) },
    psycho:{ loudness:{ on:PSY.loud.on, refPhon:PSY.loud.ref, listenPhon:PSY.loud.listen },
      notch:{ on:PSY.notch.on, freq:PSY.notch.freq, depth:PSY.notch.depth, q:PSY.notch.q, label:"notch cá nhân (hiệu chuẩn cộng hưởng ống tai) — tách khỏi band AutoEQ" },
      crossfeed:{ on:PSY.cross.on, mix:PSY.cross.mix, itdMs:PSY.cross.itdMs, preset:PSY.cross.preset },
      dynEq: JSON.parse(JSON.stringify(PSY.dyn)) },
    h13: (window.UP && UP.pure6 && UP.pure6.h13GetState) ? UP.pure6.h13GetState() : null };
}
/* Pha B 2026-11-06: nhap preset Equalizer APO (.txt).
   Dinh dang APO chuan (Equalizer APO/Peace/AutoEq/Qudelix deu dung):
   dong "Preamp: X dB" + cac dong "Filter N: ON|OFF PK|LSC|HSC Fc F Hz Gain G dB Q Q"
   (AutoEq viet LS/HS thay cho LSC/HSC; Peace viet PK/LS/HS). App xuat duoc APO
   nhung truoc day o nhap psImp chi nhan JSON nen file APO — ke ca file do chinh
   app xuat — deu roi vao JSON.parse -> loi; khong co ham parse APO nao trong file.
   Ham thuan, chi doc text: tra ve preset v2 (CHI khoi eq) de applyPresetV2 ap dung,
   nen moi gia tri deu qua dung bo loc cua applyPresetV2 (parseFloat truoc isFinite,
   kep theo khoang slider) nhu duong JSON; khong doi target/psycho, khong doi che
   do engine (giu mode hien tai). Band OFF bi bo (giong cach Wavelet/Poweramp xuat
   bo band OFF); band kieu la (LP/HP...) hoac so khong huu han bi bo va dem vao
   dropped; dong GraphicEQ:/Include: bo qua (khong phai parametric); khong co band
   hop le nao -> nem Error. */
function apoParseText(text){
  if (typeof text !== "string") throw new Error("File APO không phải text.");
  text = text.replace(/^\uFEFF/, "");
  var lines = text.split(/\r\n|\r|\n/);
  var preamp = null, bands = [], dropped = 0, off = 0;
  var APO_T = { PK:"peaking", PEAK:"peaking", LS:"lowshelf", LSC:"lowshelf", LOWSHELF:"lowshelf", HS:"highshelf", HSC:"highshelf", HIGHSHELF:"highshelf" };
  for (var i = 0; i < lines.length; i++){
    var ln = lines[i].replace(/^\s+|\s+$/g, "");
    if (!ln || ln.charAt(0) === "#") continue;
    if (/^preamp\s*:/i.test(ln)){
      var pm = ln.match(/^preamp\s*:\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(?:dB)?\s*(?:#.*)?$/i);
      if (pm){ var pv = parseFloat(pm[1]); if (isFinite(pv)) preamp = pv; else dropped++; }
      else dropped++;
      continue;
    }
    if (/^filter\s+\d+\s*:/i.test(ln)){
      var fm = ln.match(/^filter\s+\d+\s*:\s*(on|off)\s+([A-Za-z]+)\s+Fc\s+([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(?:Hz)?\s+Gain\s+([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(?:dB)?(?:\s+Q\s+([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?))?\s*(?:#.*)?$/i);
      if (!fm){ dropped++; continue; }
      if (fm[1].toLowerCase() === "off"){ off++; continue; }
      var ty = APO_T[fm[2].toUpperCase()];
      var fv = parseFloat(fm[3]), gv = parseFloat(fm[4]), qv = (fm[5] === undefined) ? 1 : parseFloat(fm[5]);
      if (!ty || !isFinite(fv) || !isFinite(gv) || !isFinite(qv)){ dropped++; continue; }
      bands.push({ freq: fv, type: ty, gain: gv, q: qv, on: true });
      continue;
    }
    /* Dong khac (GraphicEQ:, Include:, ...): khong phai parametric, bo qua lang. */
  }
  if (!bands.length) throw new Error("Không tìm thấy band Filter hợp lệ trong file APO (cần ít nhất 1 dòng 'Filter N: ON PK/LSC/HSC Fc ... Gain ... Q ...').");
  return { p: { version: 2, name: "Preset APO (nhập từ file .txt)",
    eq: { mode: (typeof mode !== "undefined" && mode === "fir") ? "fir" : "iir",
      preMode: (preamp === null) ? ((typeof preMode !== "undefined") ? preMode : "auto") : "manual",
      manualPreDb: (preamp === null) ? ((typeof manualPreDb !== "undefined") ? manualPreDb : 0) : preamp,
      extraHeadDb: (typeof extraHeadDb !== "undefined") ? extraHeadDb : 0,
      bands: bands } },
    dropped: dropped, off: off, preamp: preamp };
}
function migratePreset(p){
  if (!p || typeof p !== "object") throw new Error("JSON không phải là preset.");
  if (p.version === 2 && p.eq && p.psycho) return { p:p, migrated:false };
  if (p.version === 1 || Array.isArray(p.gains)){
    var v2 = { version:2, name:(p.name || "Preset v1")+" (đã migrate)", migratedFrom:1,
      eq:{ mode:"iir", preMode:"auto", manualPreDb:0, extraHeadDb:0,
        /* Pha C 2026-11-06: ve sinh gain/q luc migrate nhu applyPresetV2 —
           truoc day isFinite() tho tren p.gains[i]/p.qs[i] nen null (isFinite
           (null)===true), "" va chuoi so "5" lot thang vao object v2, gain 99
           va q 0,05 vuot khoang kep cung lot thang; importPresetBundle luu
           thang object do vao vault, psImp dat lastPreset de luu (lab
           origcheck migrate 10/10). Nay parseFloat roi moi kiem isFinite
           (null/"" -> NaN nen ve gia tri mac dinh), khong huu han -> gain 0 /
           q DEFQ, vuot khoang -> kep dung nhu applyPresetV2 (gain [-12,12],
           q [0,4,10]), lam tron 2 chu so. */
        bands: FREQS.map(function(f, i){
          var gv = parseFloat(p.gains && p.gains[i]), qv = parseFloat(p.qs && p.qs[i]);
          return { freq:f, type:TYPES[i],
            gain: isFinite(gv) ? Math.round(clampN(gv, -12, 12)*100)/100 : 0,
            q: isFinite(qv) ? Math.round(clampN(qv, 0.4, 10)*100)/100 : DEFQ[i], on:true }; }) },
      autoeq:{ target:"harmanOE", tilt:0, bass:0, ear:0, nBands:10 },
      psycho:{ loudness:{ on:false, refPhon:80, listenPhon:80 },
        notch:{ on:false, freq:7200, depth:-5, q:4, label:"notch cá nhân (hiệu chuẩn cộng hưởng ống tai) — tách khỏi band AutoEQ" },
        crossfeed:{ on:false, mix:35, itdMs:0.30, preset:"studio" }, dynEq:{} } };
    return { p:v2, migrated:true };
  }
  if (p.version === 2) return { p:p, migrated:false };
  throw new Error("Không nhận diện được phiên bản preset (cần version 1 hoặc 2).");
}
function applyPresetV2(p){
  if (p.eq && p.eq.bands) p.eq.bands.forEach(function(pb, i){
    if (!bands[i] || !pb) return;
    /* Pha B 2026-11-05: ve sinh gia tri band luc nhap preset, giong he precApply
       (trinh nhap chinh xac): parseFloat roi moi kiem isFinite (null -> NaN nen
       giu cu, chu khong bi isFinite(null)===true keo ve bien kep), khong huu
       han -> giu cu, ngoai khoang -> kep. Truoc day gan tho: preset JSON ban
       (freq null/0/1e999, gain Infinity, q NaN) lot thang vao bands[] roi xuat
       lai thanh null qua capturePresetV2, luu tru trang thai khong hop le;
       duong am thanh da co guard RBJ nen chi la loi UX/luu tru, khong phai
       loi am thanh. */
    var fv = parseFloat(pb.freq), gv = parseFloat(pb.gain), qv = parseFloat(pb.q);
    if (isFinite(fv)) bands[i].freq = Math.round(clampN(fv, 20, 20000)*10)/10;
    if (isFinite(gv)) bands[i].gain = Math.round(clampN(gv, -12, 12)*100)/100;
    if (isFinite(qv)) bands[i].q = Math.round(clampN(qv, 0.4, 10)*100)/100;
    if (pb.type && TYPELBL[pb.type]) bands[i].type = pb.type;
    bands[i].on = pb.on !== false;
  });
  if (p.eq){
    preMode = p.eq.preMode === "manual" ? "manual" : "auto";
    /* Pha C 2026-11-05: ve sinh preamp nhu band (Pha B 14:45) — parseFloat roi
       moi kiem isFinite (null -> NaN nen giu cu, chu khong bi isFinite(null)
       ===true keo null/"5" xuong .toFixed() gay crash, lab 1451: manualPreDb
       null hoac "5" deu nem TypeError, preset ap dung do dang); kep theo
       dung khoang slider: manualPre [-30, 6], extraHead [0, 6]. */
    var mpv = parseFloat(p.eq.manualPreDb), ehv = parseFloat(p.eq.extraHeadDb);
    if (isFinite(mpv)) manualPreDb = clampN(mpv, -30, 6);
    if (isFinite(ehv)) extraHeadDb = clampN(ehv, 0, 6);
    $("extraHead").value = extraHeadDb; $("extraOut").textContent = extraHeadDb.toFixed(1)+" dB";
    $("manualPre").value = manualPreDb; $("manualOut").textContent = manualPreDb.toFixed(1)+" dB";
    $("preModeOut").textContent = preMode === "auto" ? "Tự động" : "Thủ công";
    $("preAuto").classList.toggle("on", preMode === "auto");
    $("preManual").classList.toggle("on", preMode === "manual");
    $("manualWrap").style.display = preMode === "manual" ? "block" : "none";
    setMode(p.eq.mode === "fir" ? "fir" : "iir");
  }
  if (p.autoeq){
    if (AE_TARGETS[p.autoeq.target]) $("aeTarget").value = p.autoeq.target;
    /* Pha C 2026-11-05: nhu tren — chuoi rac "abc" truoc day lot thang vao
       input (aeAdj().tilt = NaN, target NaN); nBands "abc"/99 cung lot thang.
       parseFloat + kep theo dung khoang slider (tilt [-1,1], bass [-6,6],
       ear [-4,4], nBands [5,20]); khong huu han thi giu gia tri hien tai. */
    var tv = parseFloat(p.autoeq.tilt), bv = parseFloat(p.autoeq.bass), ev = parseFloat(p.autoeq.ear);
    if (isFinite(tv)){ $("aeTilt").value = clampN(tv, -1, 1); $("aeTiltOut").textContent = parseFloat($("aeTilt").value).toFixed(2)+" dB/oct"; }
    if (isFinite(bv)){ $("aeBass").value = clampN(bv, -6, 6); $("aeBassOut").textContent = parseFloat($("aeBass").value).toFixed(1)+" dB"; }
    if (isFinite(ev)){ $("aeEar").value = clampN(ev, -4, 4); $("aeEarOut").textContent = parseFloat($("aeEar").value).toFixed(1)+" dB"; }
    var nbv = parseInt(p.autoeq.nBands, 10);
    if (isFinite(nbv) && nbv >= 5 && nbv <= 20) $("aeBands").value = String(nbv);
    aeUpdateTarget();
  }
  if (p.psycho){
    var L = p.psycho.loudness || {}, N = p.psycho.notch || {}, X = p.psycho.crossfeed || {};
    /* Pha C 2026-11-05: nhu tren — refPhon/listenPhon null truoc day nhiem
       PSY.loud (bu loudness sai toi 22,09 dB, lab 1451 D1/D2); notch.q/itdMs
       null nem TypeError trong syncPsyUI (.toFixed); notch.freq/depth, mix
       null nhiem PSY. parseFloat + kep theo khoang slider, giu cu khi xau:
       ref [40,90], listen [20,90], notch freq [20,20000], depth [-8,-3],
       q [1,8], mix [0,100], itdMs [0,25, 0,35]. */
    PSY.loud.on = !!L.on;
    var rpv = parseFloat(L.refPhon), lpv = parseFloat(L.listenPhon);
    if (isFinite(rpv)) PSY.loud.ref = clampN(rpv, 40, 90);
    if (isFinite(lpv)) PSY.loud.listen = clampN(lpv, 20, 90);
    PSY.loud.cur = [0,0,0,0,0,0]; PSY.loud.tgt = [0,0,0,0,0,0];
    PSY.notch.on = !!N.on;
    var nfv = parseFloat(N.freq), ndv = parseFloat(N.depth), nqv = parseFloat(N.q);
    if (isFinite(nfv)) PSY.notch.freq = clampN(nfv, 20, 20000);
    if (isFinite(ndv)) PSY.notch.depth = clampN(ndv, -8, -3);
    if (isFinite(nqv)) PSY.notch.q = clampN(nqv, 1, 8);
    PSY.cross.on = !!X.on;
    var xmv = parseFloat(X.mix), xiv = parseFloat(X.itdMs);
    if (isFinite(xmv)) PSY.cross.mix = clampN(xmv, 0, 100);
    if (isFinite(xiv)) PSY.cross.itdMs = clampN(xiv, 0.25, 0.35);
    PSY.cross.preset = X.preset || "custom";
    PSY.dyn = (p.psycho.dynEq && typeof p.psycho.dynEq === "object") ? p.psycho.dynEq : {};
    /* Pha C 2026-11-07: gan lai gia tri tra ve — truoc day bo qua nen entry
       khong phai object song sot (xem normalizeDynEntry). */
    Object.keys(PSY.dyn).forEach(function(k){ PSY.dyn[k] = normalizeDynEntry(PSY.dyn[k]); });
  }
  if (p.h13 && window.UP && UP.pure6 && UP.pure6.h13SetState){
    try { UP.pure6.h13SetState(p.h13); } catch (e) {}
  }
  PSY.bypassAll = false;
  /* Pha C 2026-11-05: kep selBand theo do dai that cua bands — truoc day dat
     cung 5: neu bands ngan hon (ban luu ban truoc khi co guard do dai o
     autoApplySnapshot) thi updateCoeffPanel/refreshDynPanel doc bands[5]
     undefined -> TypeError (lab 1555). */
  selBand = Math.max(0, Math.min(5, bands.length - 1));
  syncPsyUI(); applyPsycho(); updateAll(true); pushXCoeffs();
}
$("psCap").addEventListener("click", function(){
  lastPreset = capturePresetV2();
  $("psPresetJson").textContent = JSON.stringify(lastPreset, null, 1);
  $("psPresetMsg").textContent = "đã chụp v2 · "+new Date().toLocaleTimeString("vi-VN");
  $("psDl").disabled = false;
});
$("psDl").addEventListener("click", function(){
  if (!lastPreset) return;
  var blob = new Blob([JSON.stringify(lastPreset, null, 1)], { type:"application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "web-autoeq-preset-v2.json";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
});
/* Pha B 2026-11-05: nhap bundle preset — 1 file JSON chua toan bo thu vien
   vault ({ kind:"web-autoeq-preset-bundle-v1", presets:[{name,bands,savedAt,preset}] })
   hoac mang tran cac preset v1/v2; moi muc qua migratePreset roi vaultSavePreset
   (ton trong Opt-In + gioi han 20 preset), muc loi bo qua, khong crash. */
/* Pha B 2026-11-05: nhap bundle khong nhan ban preset trung ten + bao preset
   bi loai do FIFO — truoc day importPresetBundle goi thang vaultSavePreset cho moi
   muc nen nhap lai chinh bundle vua xuat se nhan doi moi preset (cung ten, cung
   band), nhap 5 preset vao thu vien day 20 se loai lang le 5 preset cu nhat ma
   ket qua tra ve khong co truong dropped va thong bao van bao "da nhap 5/5 ...
   vao thu vien" (lab 1854). Khong doi hanh vi luu thu cong (luu trung ten bang
   nut Luu van tao muc moi — co chu y tu 17:43); chi duong nhap bundle: muc co
   ten (sau trim) da co trong thu vien thi bo qua, dem vao dup/dupNames; ten
   preset cu nhat bi loai gom vao dropped[] de hien thi; ap dung preset dau
   tien giu nguyen. store tuy chon chi de vaultSelfCheck chay co lap. */
function importPresetBundle(items, store){
  var ok = 0, saved = 0, first = null, dup = 0, dupNames = [], dropped = [];
  var seen = {};
  vaultListPresets(store).forEach(function(it){ if (it && it.name) seen[String(it.name).trim()] = true; });
  (items || []).forEach(function(it){
    var raw = (it && it.preset) || it;
    try {
      var mig = migratePreset(raw);
      if (!first) first = mig.p;
      ok++;
      var nm = String((mig.p && mig.p.name) || "Preset v2").trim();
      if (seen[nm]) { dup++; if (dupNames.indexOf(nm) < 0) dupNames.push(nm); return; }
      try {
        var r = vaultSavePreset(mig.p, store);
        if (r.saved){ saved++; seen[nm] = true; if (r.dropped) dropped = dropped.concat(r.dropped); }
      } catch (e){}
    } catch (e){}
  });
  var msg;
  if (!items || !items.length) msg = "bundle rỗng — không có preset nào để nhập";
  else if (!ok) msg = "bundle không có preset hợp lệ — không nhập được preset nào";
  else {
    msg = "đã nhập " + ok + "/" + items.length + " preset từ bundle";
    if (dup) msg += " — " + dup + " trùng tên đã bỏ qua (" + dupNames.join(", ") + ")";
    if (ok - dup === 0) msg += " (không lưu thêm preset nào — tất cả đều trùng tên)";
    else msg += (saved < ok - dup) ? " (Opt-In tắt: không lưu vào thư viện)" : " vào thư viện";
    if (dropped.length) msg += " — đã loại preset cũ nhất vì thư viện đầy (" + dropped.join(", ") + ")";
    msg += " — đã áp dụng preset đầu tiên";
  }
  return { ok:ok, saved:saved, skipped:(items ? items.length : 0) - ok, dup:dup, dupNames:dupNames, dropped:dropped, first:first, msg:msg };
}
$("psImp").addEventListener("change", function(){
  var f = this.files && this.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function(){
    try {
      var impText = String(rd.result || "");
      /* Pha B 2026-11-06: nhap preset Equalizer APO (.txt) — nhan dang theo noi
         dung (dong Preamp:/Filter o dau dong), khong theo duoi file, vi trinh
         duyet co the gui file .txt voi MIME text/plain; JSON khong bao gio co
         dong bat dau bang Preamp:/Filter nen khong nham sang JSON. */
      if (/(?:^|\n)\s*(?:preamp\s*:|filter\s+\d+\s*:)/i.test(impText)){
        var ap = apoParseText(impText);
        ap.p.name = (f.name || "preset").replace(/\.[^.]*$/, "") + " (APO)";
        applyPresetV2(ap.p);
        lastPreset = ap.p;
        $("psPresetJson").textContent = JSON.stringify(ap.p, null, 1);
        $("psDl").disabled = false;
        var apOver = (typeof bands !== "undefined" && ap.p.eq.bands.length > bands.length) ? (ap.p.eq.bands.length - bands.length) : 0;
        $("psPresetMsg").textContent = "đã nhập preset Equalizer APO: " + ap.p.eq.bands.length + " band" +
          (ap.preamp === null ? "" : " · preamp " + manualPreDb.toFixed(2) + " dB (đã kẹp theo khoảng preamp thủ công)") +
          (apOver ? " · đã bỏ " + apOver + " band vượt quá số band engine (" + bands.length + ")" : "") +
          (ap.off ? " · đã bỏ " + ap.off + " band OFF" : "") +
          (ap.dropped ? " · đã bỏ " + ap.dropped + " band hỏng" : "") +
          " — các band còn lại giữ nguyên, target/psycho giữ nguyên (giống nhập preset JSON)";
        return;
      }
      var parsed = JSON.parse(impText);
      if ((parsed && parsed.kind === "web-autoeq-preset-bundle-v1" && Array.isArray(parsed.presets)) || Array.isArray(parsed)){
        var impItems = Array.isArray(parsed) ? parsed : parsed.presets;
        var imp = importPresetBundle(impItems);
        if (imp.first){ try { applyPresetV2(imp.first); } catch (e){} lastPreset = imp.first; $("psPresetJson").textContent = JSON.stringify(imp.first, null, 1); $("psDl").disabled = false; }
        $("psPresetMsg").textContent = imp.msg;
        return;
      }
      var mig = migratePreset(parsed);
      applyPresetV2(mig.p);
      lastPreset = mig.p;
      $("psPresetJson").textContent = JSON.stringify(mig.p, null, 1);
      $("psDl").disabled = false;
      $("psPresetMsg").textContent = mig.migrated ? "đã MIGRATE v1 → v2 và áp dụng" : "đã nhập & áp dụng preset v2";
    } catch (err){ $("psPresetMsg").textContent = "lỗi nhập preset: "+err.message; }
  };
  rd.readAsText(f);
});

/* ---------- Kiểm chứng nghiệm thu Prompt 3 ---------- */
function pearson(a, b){
  var n = a.length, ma = 0, mb = 0, i;
  for (i=0;i<n;i++){ ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  var sab = 0, saa = 0, sbb = 0;
  for (i=0;i<n;i++){ var da = a[i]-ma, db = b[i]-mb; sab += da*db; saa += da*da; sbb += db*db; }
  return (saa > 0 && sbb > 0) ? sab/Math.sqrt(saa*sbb) : 0;
}
$("btnPsVerify").addEventListener("click", function(){
  var fs = displayFs || 48000;
  /* Chụp trạng thái notch + calFreq của người dùng: mục V2 bật notch thật để đo,
     cuối handler phải trả lại nguyên trạng (trước đây notch bị để bật luôn) */
  var notchSnap = JSON.stringify({ n: PSY.notch, c: PSY.calFreq });
  /* V1 - Loudness ISO 226 day du: ngan hang 6 section khop duong cong bu tren
     luoi log 49 diem (20 Hz-12,5 kHz). Chuan DAT: RMS <= 0,75 dB va max <= 1,5 dB
     o cap chuan 60/80 phon; cap Night Mode 45/80 chi hien thi (20 Hz con lech
     do kep an toan +/-15 dB/section theo thiet ke, khong tinh FAIL). */
  var g = loudGainsFor(60, 80, fs);
  var fe = loudFitError(g, 60, 80, fs);
  var gN = loudGainsFor(45, 80, fs);
  var feN = loudFitError(gN, 45, 80, fs);
  $("psV1").textContent = "60/80 phon: RMS "+fe.rms.toFixed(2)+" dB · max "+fe.max.toFixed(2)+" dB @ "+Math.round(fe.maxf)+" Hz · gains ["+g.map(function(x){ return x.toFixed(2); }).join(", ")+"] · Night 45/80: RMS "+feN.rms.toFixed(2)+" dB · max "+feN.max.toFixed(2)+" dB @ "+Math.round(feN.maxf)+" Hz (kep +/-15 dB)";
  $("psV1Ok").innerHTML = (fe.rms <= 0.75 && fe.max <= 1.5) ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
/* V2 — Đánh dấu 7.2 kHz -> notch cá nhân (đặt thật + bật để thấy trên đồ thị) */
  PSY.calFreq = 7200; PSY.notch.freq = 7200; PSY.notch.depth = -5; PSY.notch.q = 4; PSY.notch.on = true;
  syncPsyUI(); applyPsycho();
  var nc = rbjCoeffs("peaking", 7200, -5, 4, fs), minF = 0, minV = 1e9;
  for (var f = 5000; f <= 10000; f += 5){ var v = biquadMagDb(nc, f, fs); if (v < minV){ minV = v; minF = f; } }
  var errF = Math.abs(minF - 7200)/7200*100;
  var ok2 = errF <= 1 && minV <= -3.5;
  $("psV2").textContent = "đáy notch đo tại "+Math.round(minF)+" Hz (lệch "+errF.toFixed(2)+"%), sâu "+fmtDb(minV,1)+" dB — notch đã bật trên đồ thị tổng";
  $("psV2Ok").innerHTML = ok2 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  /* V3 — Crossfeed 100%: nhiễu mono xác định qua binaural stage (loa ảo +30°) */
  var N = 8192, seed = 123456789, s = new Float64Array(N), i;
  for (i=0;i<N;i++){ seed = (seed*1103515245 + 12345) % 2147483648; s[i] = seed/2147483648*2 - 1; }
  var corrBefore = pearson(s, s);
  var itdS = Math.max(1, Math.round(PSY.cross.itdMs*fs/1000));
  var lpA = 1 - Math.exp(-2*Math.PI*6500/fs), lp = 0, far = new Float64Array(N);
  for (i=0;i<N;i++){ var d = (i - itdS >= 0) ? s[i-itdS] : 0; lp += lpA*(d - lp); far[i] = lp*0.85; }
  var corrAfter = pearson(s, far);
  var ok3 = corrAfter < corrBefore - 0.3;
  $("psV3").textContent = "tương quan zero-lag: tai nghe thường (L=R) "+corrBefore.toFixed(3)+" → qua stage (tai xa trễ ITD "+PSY.cross.itdMs.toFixed(2)+" ms + ILD thông thấp) "+corrAfter.toFixed(3);
  $("psV3Ok").innerHTML = ok3 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  /* V4 — Dynamic EQ: cấu hình mẫu band 6 kHz, threshold −20 dBFS, ratio 4, range −8 dB */
  var cfg = { thr:-20, ratio:4, range:-8 };
  var o30 = dynOffsetDb(-30, cfg), o10 = dynOffsetDb(-10, cfg);
  var ok4 = Math.abs(o30) <= 0.5 && o10 <= -4;
  $("psV4").textContent = "tone −30 dBFS → offset "+fmtDb(o30)+" dB (gần như không tác động) · tone −10 dBFS → offset "+fmtDb(o10)+" dB (cắt rõ)";
  $("psV4Ok").innerHTML = ok4 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  /* V5 — Dynamic EQ sidechain: LP 500 Hz cho tone 100 Hz qua gan nhu nguyen
     ven nhung chan tone 8 kHz; HP 5 kHz nguoc lai; BP 100 Hz chan tone 1 kHz
     hon 10 dB so voi dinh; RMS cua sine = Peak - 3.01 dB nen offset RMS nho
     hon Peak dung luong do tren duong cong tinh. */
  var lp500 = lowpassCoeffs(500, 1, fs), hp5000 = highpassCoeffs(5000, 1, fs), bp100 = bandpassCoeffs(100, 1.41, fs);
  var lpLo = biquadMagDb(lp500, 100, fs), lpHi = biquadMagDb(lp500, 8000, fs);
  var hpLo = biquadMagDb(hp5000, 100, fs), hpHi = biquadMagDb(hp5000, 8000, fs);
  var bpAt = biquadMagDb(bp100, 100, fs), bpFar = biquadMagDb(bp100, 1000, fs);
  var oRms = dynOffsetDb(-13.01, { thr:-20, ratio:4, range:-8 });
  var ok5 = lpLo > -1 && lpHi < -20 && hpLo < -20 && hpHi > -1 && (bpAt - bpFar) > 10 && Math.abs(oRms - (-5.24)) <= 0.3;
  $("psV5").textContent = "LP500: 100 Hz " + fmtDb(lpLo) + " dB · 8 kHz " + fmtDb(lpHi) + " dB; HP5000: 100 Hz " + fmtDb(hpLo) + " dB · 8 kHz " + fmtDb(hpHi) + " dB; BP100: 100 Hz " + fmtDb(bpAt) + " dB · 1 kHz " + fmtDb(bpFar) + " dB; offset RMS sine " + fmtDb(oRms) + " dB";
  $("psV5Ok").innerHTML = ok5 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
   /* V6 - Suy luan ong tai tu nhac thuc te: anh xa quet logarit + doi chieu
      hai danh dau. Chi kiem ham thuan (anh xa/doi chieu); node BiquadFilter
      that cua notch do chi chay duoc tren trinh duyet that (da noi san trong
      chuoi phat, gain 0 dB khi tat = dong nhat). */
   var pf0 = earProbeFreqAt(0), pf1 = earProbeFreqAt(1), pfMid = earProbeFreqAt(0.5);
   var cA = earResCompare(7200, 7200*Math.pow(2, 1/12));
   var cB = earResCompare(7200, 9500);
   var cE = earResCompare(7200, 7200*Math.pow(2, 2/12));
   var ok6 = Math.abs(pf0-5500) < 1 && Math.abs(pf1-9500) < 1 && Math.abs(pfMid-Math.sqrt(5500*9500)) < 1
     && cA && cA.agree && Math.abs(cA.suggested-7200*Math.pow(2, 1/24)) < 1
     && cB && !cB.agree && cE && cE.agree && earResCompare(7200, NaN) === null && earResCompare(0, 7200) === null
     && Math.abs(earProbeFreqAt(NaN)-5500) < 1;
   $("psV6").textContent = "quet: 0% -> "+Math.round(pf0)+" Hz - 50% -> "+Math.round(pfMid)+" Hz - 100% -> "+Math.round(pf1)+" Hz; 7200 vs 7629 Hz (1 ban am): "+(cA ? "KHOP, de xuat "+Math.round(cA.suggested)+" Hz" : "loi")+" - 7200 vs 9500 Hz ("+(cB ? cB.semitones.toFixed(2) : "?")+" ban am): "+(cB && !cB.agree ? "CHUA KHOP, khong ap dung" : "loi");
   $("psV6Ok").innerHTML = ok6 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
   /* V7 - Cham diem mu da cau hinh: xao tron la hoan vi, cung hat giong cho
      cung thu tu, xep hang theo diem giam dan (hoa diem -> mau truoc thang),
      sanitize kep dung gioi han. Chi kiem ham thuan; nghe/cham that tren
      trinh duyet that vi can AudioWorklet + tai nguoi. */
   var sh1 = blindShuffleIdx(4, blindSeededRng(7)), sh2 = blindShuffleIdx(4, blindSeededRng(7));
   var shOk = sh1.length === 4 && sh1.slice().sort(function(a,b){ return a - b; }).join(",") === "0,1,2,3" && sh1.join(",") === sh2.join(",");
   var rk = blindRankPairs([{cand:0,sample:1,rating:5},{cand:1,sample:2,rating:3},{cand:2,sample:3,rating:5},{cand:3,sample:4,rating:2}]);
   var rkOk = rk.length === 4 && rk[0].cand === 0 && rk[1].cand === 2 && rk[2].cand === 1 && rk[3].cand === 3;
   var sc = blindSanitizeCand({name:"t", count:20, bands:[{freq:NaN,type:"peaking",gain:99,q:0,on:true}]});
   var scOk = sc.bands.length === 1 && sc.bands[0].freq === 1000 && sc.bands[0].gain === 12 && sc.bands[0].q === 0.1;
   var ok7 = shOk && rkOk && scOk && blindSanitizeRating(3) === 3 && blindSanitizeRating(0) === null && blindSanitizeRating(6) === null;
   $("psV7").textContent = "xao tron hat giong 7 (4 mau): [" + sh1.join(",") + "] - xep hang diem 5/3/5/2 -> ung vien [" + rk.map(function(r){ return r.cand; }).join(",") + "] - sanitize: gain 99 -> 12, freq NaN -> 1000, q 0 -> 0.1";
   $("psV7Ok").innerHTML = ok7 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
   /* V8 - Nap HRTF/SOFA + binaural: chon huong gan nhat theo goc khoi,
      parse JSON/WAV that, giai ma SOFA HDF5 that (fixture h5py), chập
      mono x HRIR va resample/peak-scale. Chi kiem ham thuan; graph
      ConvolverNode that chi chay duoc tren trinh duyet that. */
   var hSet = hrtfParseJson(JSON.stringify({ sampleRate: 48000, directions: [
     { azimuth: -30, elevation: 0, left: [1, 0.5], right: [0.5, 0.25] },
     { azimuth: 0, elevation: 0, left: [1], right: [1] },
     { azimuth: 30, elevation: 0, left: [0.5, 0.25], right: [1, 0.5] } ] }));
   var hSel25 = hrtfSelectDirection(hSet.directions, 25, 0);
   var hSelM = hrtfSelectDirection(hSet.directions, -25, 0);
   var hJsonBad = null; try { hrtfParseJson('{"directions":[]}'); } catch (e) { hJsonBad = e.message; }
   var hSrBad = null; try { hrtfParseJson(JSON.stringify({ sampleRate: 48, directions: [{ azimuth: 0, elevation: 0, left: [1], right: [1] }] })); } catch (e) { hSrBad = e.message; }
   var hSrOk = hrtfParseJson(JSON.stringify({ sampleRate: 48000, directions: [{ azimuth: 0, elevation: 0, left: [1], right: [1] }] })).sampleRate;
   var hSrNull = hrtfParseJson(JSON.stringify({ directions: [{ azimuth: 0, elevation: 0, left: [1], right: [1] }] })).sampleRate;
   var hWavBytes = (function(){
     var samplesL = [16384, -16384, 0, 8192], samplesR = [-8192, 8192, 16384, 0], i, out = [];
     function pushStr(s){ for (var k = 0; k < s.length; k++) out.push(s.charCodeAt(k)); }
     function push16(v){ out.push(v & 255); out.push((v >> 8) & 255); }
     function push32(v){ out.push(v & 255); out.push((v >> 8) & 255); out.push((v >> 16) & 255); out.push((v >> 24) & 255); }
     pushStr("RIFF"); push32(36 + 16); pushStr("WAVE");
     pushStr("fmt "); push32(16); push16(1); push16(2); push32(48000); push32(48000 * 4); push16(4); push16(16);
     pushStr("data"); push32(16);
     for (i = 0; i < 4; i++){ push16(samplesL[i] < 0 ? 65536 + samplesL[i] : samplesL[i]); push16(samplesR[i] < 0 ? 65536 + samplesR[i] : samplesR[i]); }
     return new Uint8Array(out);
   })();
   var hWav = hrtfParseWav(hWavBytes);
   var hSofaSet = null, hSofaErr = null, hSofaTruncErr = null, hSofaBadErr = null;
  try {
    var hSofaBin = atob("iUhERg0KGgoAAAAAAAgIAAQAEAAAAAAAAAAAAAAAAAD//////////xg6AAAAAAAA//////////8AAAAAAAAAAGAAAAAAAAAAAQAAAAAAAACIAAAAAAAAAKgCAAAAAAAAAQAFAAEAAAAYAAAAAAAAABAAEAAAAAAAIAMAAAAAAAAQAQAAAAAAAFRSRUUAAAEA/////////////////////wAAAAAAAAAAABgAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIRUFQAAAAAFgAAAAAAAAAQAAAAAAAAADIAgAAAAAAAAAAAAAAAAAARGF0YQAAAABTb3VyY2UAAFJlY2VpdmVyAAAAAAAAAABMaXN0ZW5lcgAAAAAAAAAARW1pdHRlcgABAAAAAAAAABgAAAAAAAAAAAAAAAAAAAARABAAAAAAAIgAAAAAAAAAqAIAAAAAAAAMAEgAAAAAAAEAEAAUAAgAU09GQUNvbnZlbnRpb25zABkBAQAQAAAAEAAAAAEAAAAAAAgAAAAAAAEAAAAAAAAAEwAAAAAIAAAAAAAAAQAAAAwAUAAAAAAAAQAXABQACABTT0ZBQ29udmVudGlvbnNWZXJzaW9uAAAZAQEAEAAAABAAAAABAAAAAAAIAAAAAAABAAAAAAAAAAMAAAAACAAAAAAAAAIAAAAMAEgAAAAAAAEACQAUAAgARGF0YVR5cGUAAAAAAAAAABkBAQAQAAAAEAAAAAEAAAAAAAgAAAAAAAEAAAAAAAAAAwAAAAAIAAAAAAAAAwAAAAEAAQABAAAAGAAAAAAAAAARABAAAAAAAFgEAAAAAAAAeAYAAAAAAABUUkVFAAABAP////////////////////8AAAAAAAAAAEgZAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASEVBUAAAAABYAAAAAAAAADgAAAAAAAAAmAYAAAAAAAAAAAAAAAAAAERhdGEuSVIARGF0YS5TYW1wbGluZ1JhdGUAAAAAAAAARGF0YS5EZWxheQAAAAAAAAEAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAFAAEAAAAAAQAAAAAAAAEAOAAAAAAAAQMBAAAAAAADAAAAAAAAAAIAAAAAAAAABQAAAAAAAAADAAAAAAAAAAIAAAAAAAAABQAAAAAAAAADABgAAQAAABEgPwAIAAAAAABAADQLADT/AwAAAAAAAAUACAABAAAAAgICAQAAAAAIABgAAAAAAAMBACAAAAAAAADwAAAAAAAAAAAAAAAAAAAAaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHQ09MAQAAAAAQAAAAAAAAAQAAAAAAAAATAAAAAAAAAFNpbXBsZUZyZWVGaWVsZEhSSVIAAAAAAAIAAAAAAAAAAwAAAAAAAAAyLjEAAAAAAAMAAAAAAAAAAwAAAAAAAABGSVIAAAAAAAQAAAAAAAAACQAAAAAAAABzcGhlcmljYWwAAAAAAAAAAAAAAAAAAAB4DwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU05PRAEABQAIAAAAAAAAADAEAAAAAAAAAQAAAAAAAABYBAAAAAAAAHgGAAAAAAAAOAAAAAAAAAAANQAAAAAAAAEAAAAAAAAAKDUAAAAAAABINwAAAAAAACgAAAAAAAAA6C8AAAAAAAABAAAAAAAAABAwAAAAAAAAMDIAAAAAAAAYAAAAAAAAANAqAAAAAAAAAQAAAAAAAAD4KgAAAAAAABgtAAAAAAAAEAAAAAAAAACwHAAAAAAAAAEAAAAAAAAA2BwAAAAAAAD4HgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFNOT0QBAAMAKAAAAAAAAACgGwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAA8AYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAJAaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAUAAQAAAAABAAAAAAAAAQAIAAAAAAABAAAAAAAAAAMAGAABAAAAESA/AAgAAAAAAEAANAsANP8DAAAAAAAABQAIAAEAAAACAgIBAAAAAAgAGAAAAAAAAwHwIAAAAAAAAAgAAAAAAAAAAAAAAAAAAACYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABQABAAAAAAEAAAAAAAABACgAAAAAAAECAQAAAAAAAwAAAAAAAAACAAAAAAAAAAMAAAAAAAAAAgAAAAAAAAADABgAAQAAABEgPwAIAAAAAABAADQLADT/AwAAAAAAAAUACAABAAAAAgICAQAAAAAIABgAAAAAAAMB+CAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAFAAEAAAAYAAAAAAAAABAAEAAAAAAAcB8AAAAAAABwAAAAAAAAAFRSRUUAAAEA/////////////////////wAAAAAAAAAAECkAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIRUFQAAAAAFgAAAAAAAAAGAAAAAAAAAAYHwAAAAAAAAAAAAAAAAAAU291cmNlUG9zaXRpb24AAAEAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAAAAAAFgqAAAAAAAAeAAAAAAAAAAMAFAAAAAAAAEAFAAUAAgAU291cmNlUG9zaXRpb25fVHlwZQAAAAAAGQEBABAAAAAQAAAAAQAAAAAACAAAAAAAAQAAAAAAAAAJAAAAAAgAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAOA/AAAAAAAA0D8AAAAAAAAAAAAAAAAAAMC/AAAAAAAA4D8AAAAAAADQPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOg/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADoPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0D8AAAAAAADgPwAAAAAAAPA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAPA/AAAAAAAA4D8AAAAAAADQPwAAAAAAAMA/AAAAAAAAAAAAAAAAAHDnQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD7AAAAAAAAAAAAAAAAAAADwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAD5AAAAAAAAAAAAAAAAAAADwPwAAAAAAAAAAZmZmZmZmtj8AAAAAAAAAAAAAAAAAAAAAZmZmZmZmtr8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABQABAAAAAAEAAAAAAAABACgAAAAAAAECAQAAAAAAAwAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAADABgAAQAAABEgPwAIAAAAAABAADQLADT/AwAAAAAAAAUACAABAAAAAgICAQAAAAAIABgAAAAAAAMBKCEAAAAAAABIAAAAAAAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU05PRAEAAQAIAAAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABEAEAAAAAAA2BwAAAAAAAD4HgAAAAAAAAwAWAAAAAAAAQAVAAgAGABTb3VyY2VQb3NpdGlvbl9Vbml0cwAAAAATAQAABwAAAAEBAQAAAAAAAwAAAAAAAAADAAAAAAAAAGRlZ3JlZXNkZWdyZWVzbWV0cmUAAAAAAAEAAQABAAAAGAAAAAAAAAARABAAAAAAAPgqAAAAAAAAGC0AAAAAAABUUkVFAAABAP////////////////////8AAAAAAAAAAKAuAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASEVBUAAAAABYAAAAAAAAACAAAAAAAAAAOC0AAAAAAAAAAAAAAAAAAFJlY2VpdmVyUG9zaXRpb24AAAAAAAAAAAEAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAFAAEAAAAAAQAAAAAAAAEAKAAAAAAAAQIBAAAAAAACAAAAAAAAAAMAAAAAAAAAAgAAAAAAAAADAAAAAAAAAAMAGAABAAAAESA/AAgAAAAAAEAANAsANP8DAAAAAAAABQAIAAEAAAACAgIBAAAAAAgAGAAAAAAAAwFwIQAAAAAAADAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABTTk9EAQABAAgAAAAAAAAAkC0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAAAYAAAAAAAAABEAEAAAAAAAEDAAAAAAAAAwMgAAAAAAAFRSRUUAAAEA/////////////////////wAAAAAAAAAAuDMAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIRUFQAAAAAFgAAAAAAAAAIAAAAAAAAABQMgAAAAAAAAAAAAAAAAAATGlzdGVuZXJQb3NpdGlvbgAAAAAAAAAAAQAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAUAAQAAAAABAAAAAAAAAQAoAAAAAAABAgEAAAAAAAEAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAMAAAAAAAAAAwAYAAEAAAARID8ACAAAAAAAQAA0CwA0/wMAAAAAAAAFAAgAAQAAAAICAgEAAAAACAAYAAAAAAADAaAhAAAAAAAAGAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFNOT0QBAAEACAAAAAAAAACoMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAAQAAABgAAAAAAAAAEQAQAAAAAAAoNQAAAAAAAEg3AAAAAAAAVFJFRQAAAQD/////////////////////AAAAAAAAAADQOAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEhFQVAAAAAAWAAAAAAAAAAYAAAAAAAAAGg3AAAAAAAAAAAAAAAAAABFbWl0dGVyUG9zaXRpb24AAQAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABQABAAAAAAEAAAAAAAABACgAAAAAAAECAQAAAAAAAQAAAAAAAAADAAAAAAAAAAEAAAAAAAAAAwAAAAAAAAADABgAAQAAABEgPwAIAAAAAABAADQLADT/AwAAAAAAAAUACAABAAAAAgICAQAAAAAIABgAAAAAAAMBuCEAAAAAAAAYAAAAAAAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU05PRAEAAQAIAAAAAAAAAMA3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==");
    var hSofaBytes = new Uint8Array(hSofaBin.length);
    var hBi; for (hBi = 0; hBi < hSofaBin.length; hBi++) hSofaBytes[hBi] = hSofaBin.charCodeAt(hBi);
    hSofaSet = sofaExtractHrtf(hSofaBytes);
    try { sofaExtractHrtf(hSofaBytes.slice(0, 1000)); } catch (e2) { hSofaTruncErr = e2.message; }
    try { sofaExtractHrtf(new Uint8Array([78, 79, 84, 72, 68, 70, 53, 33])); } catch (e3) { hSofaBadErr = e3.message; }
  } catch (e) { hSofaErr = e.message; }
  var hSofaOk = !!hSofaSet && hSofaSet.sampleRate === 48000 && hSofaSet.directions.length === 3
    && hSofaSet.directions[0].azimuth === -30 && hSofaSet.directions[2].azimuth === 30
    && Math.abs(hSofaSet.directions[0].left[0] - 1) < 1e-12 && Math.abs(hSofaSet.directions[0].left[1] - 0.5) < 1e-12
    && Math.abs(hSofaSet.directions[2].left[2] - 1) < 1e-12 && hSofaTruncErr !== null && hSofaBadErr !== null;
   var hConv = hrtfConvolve([1, 0, 0], [0.5, 0.25]);
   var hRs = hrtfResample([0, 10, 20], 48000, 48000);
   var hPk = hrtfPeakScale([2, 0.5], [0.25]);
   var ok8 = hSet.directions.length === 3 && hSel25 && hSel25.index === 2 && Math.abs(hSel25.dist - 5) < 0.01
     && hSelM && hSelM.index === 0 && hJsonBad !== null
     && hSrBad !== null && hSrOk === 48000 && hSrNull === null
     && hWav.sampleRate === 48000 && Math.abs(hWav.left[0] - 0.5) < 1e-9 && Math.abs(hWav.left[1] + 0.5) < 1e-9 && Math.abs(hWav.right[2] - 0.5) < 1e-9
     && hSofaOk
     && hConv.length === 4 && Math.abs(hConv[0] - 0.5) < 1e-12 && Math.abs(hConv[1] - 0.25) < 1e-12 && hConv[2] === 0 && hConv[3] === 0
     && hRs.length === 3 && hRs[1] === 10 && Math.abs(hPk.factor - 0.5) < 1e-12
     && hrtfConvolve([], [1]).length === 0 && hrtfSelectDirection([], 0, 0) === null;
   $("psV8").textContent = "JSON 3 huong: muon 25° -> huong 30° (lech 5°), muon -25° -> -30°; WAV stereo 16-bit parse dung (L0 0.5, L1 -0.5, R2 0.5); SOFA HDF5 giai ma that tu fixture h5py nhung san (3 huong -30/0/30°, rate 48000, IR khop tuyet doi; file sai chu ky/cat ngan bi tu choi kem ly do); chập [1,0,0]x[0.5,0.25] = [0.5,0.25,0,0]; peak 2.0 -> he so 0.5; sampleRate JSON 48 bi tu choi, 48000 nhan, vang mat -> null (theo engine)";
   $("psV8Ok").innerHTML = ok8 ? '<span class="pass">ĐẠT</span>' : '<span class="fail">CHƯA ĐẠT</span>';
  var nsR = JSON.parse(notchSnap); PSY.notch = nsR.n; PSY.calFreq = nsR.c; syncPsyUI(); applyPsycho();
});

/* ================================================================
   v2 — NẠP HRTF / SOFA + BINAURAL BẰNG CONVOLUTION HRIR
   Mô hình: tín hiệu stereo sau EQ/limiter được downmix mono (L+R)/2
   theo chuẩn downmix "speakers" rồi chập với HRIR trái/phải của hướng
   đã chọn qua 2 ConvolverNode -> merger stereo -> destination. Chuỗi
   này nằm SAU masterGain, KHÔNG động vào worklet/solver/limiter nên
   không hồi quy các mốc DSP cũ; analyser (Spectrogram/RTA) vẫn đo tín
   hiệu trước binaural. Khi HRTF bật, crossfeed tham số trong worklet
   vẫn chạy trước đó — nên tắt crossfeed khi dùng HRTF để tránh xử lý
   không gian 2 lần (app chỉ cảnh báo, không tự tắt vì đó là gu nghe).
   Định dạng nạp thật (không bịa dữ liệu HRTF):
   - JSON: {sampleRate?, directions:[{azimuth, elevation, left:[...],
     right:[...]}]} hoặc một hướng đơn {azimuth, elevation, left, right}.
     JSON nạp THAY toàn bộ bộ hướng đang có.
   - WAV stereo: một cặp HRIR trái/phải cho MỘT hướng; hướng lấy từ 2 ô
     số Az/El khi nạp. Mỗi file WAV THÊM một hướng vào bộ đang có (nếu
     sample rate khác bộ đang có thì resample tuyến tính về rate của bộ).
   - SOFA (.sofa, HDF5): GIẢI MÃ THẬT bằng sofaExtractHrtf — superblock
     v0, object header v1 (+ continuation lồng nhau), B-tree v1/SNOD/
     local heap, dataset contiguous không nén (int/float IEEE, kiểm tra
     properties); đọc Data.IR, Data.SamplingRate, SourcePosition hệ
     spherical + cộng Data.Delay (mẫu) vào đầu HRIR. Biến thể ngoài
     phạm vi (nén/filter, chunked, superblock v2/v3, sai chữ ký, file
     cắt ngắn) bị từ chối kèm lý do rõ ràng, không bao giờ báo đã nạp
     và không tạo HRIR giả nào từ nó.
   Tự động hoá: khi nạp bộ mới, app TỰ chọn hướng gần phía trước (0°, 0°)
   nhất; bật/tắt HRTF là lựa chọn không gian cá nhân nên luôn bấm tay,
   Chế độ Tự Động Toàn Diện không tự bật HRTF. Bộ HRTF chỉ sống trong
   phiên làm việc (không lưu localStorage/preset vì HRIR có thể nặng) —
   mở lại trang cần nạp lại file.
   ================================================================ */
var HRTF = { on: false, set: null, srcName: "", az: 0, el: 0, sel: -1, nodes: null, graphOn: false, builtFor: "" };
function hrtfWrapAz(a){
  var v = parseFloat(a); if (!isFinite(v)) return 0;
  while (v > 180) v -= 360; while (v <= -180) v += 360; return v;
}
function hrtfAngDist(az1, el1, az2, el2){
  var r = Math.PI / 180;
  var c = Math.sin(el1 * r) * Math.sin(el2 * r) + Math.cos(el1 * r) * Math.cos(el2 * r) * Math.cos((az1 - az2) * r);
  if (c > 1) c = 1; if (c < -1) c = -1;
  return Math.acos(c) / r;
}
function hrtfSelectDirection(dirs, az, el){
  if (!dirs || !dirs.length) return null;
  var best = 0, bd = 1e9, i, d;
  for (i = 0; i < dirs.length; i++){
    d = hrtfAngDist(az, el, dirs[i].azimuth, dirs[i].elevation);
    if (d < bd){ bd = d; best = i; }
  }
  return { index: best, dir: dirs[best], dist: bd };
}
function hrtfSanitizeDir(d){
  if (!d || typeof d !== "object") return null;
  var az = parseFloat(d.azimuth); if (!isFinite(az)) az = 0; az = Math.max(-180, Math.min(180, az));
  var el = parseFloat(d.elevation); if (!isFinite(el)) el = 0; el = Math.max(-90, Math.min(90, el));
  function clean(arr){
    if (!Array.isArray(arr)) return null;
    var out = [], i, v;
    for (i = 0; i < arr.length; i++){ v = parseFloat(arr[i]); if (!isFinite(v)) return null; out.push(v); }
    if (out.length < 1 || out.length > 65536) return null;
    return out;
  }
  var L = clean(d.left), R = clean(d.right);
  if (!L || !R) return null;
  return { azimuth: az, elevation: el, left: L, right: R };
}
function hrtfParseJson(text){
  var o;
  try { o = JSON.parse(text); } catch (e) { throw new Error("JSON không hợp lệ: " + e.message); }
  var sr = null;
  /* Pha C 2026-11-05: kep sampleRate JSON theo quy uoc 8-192 kHz cua WAV/SOFA
     trong cung file — truoc day chi isFinite: sr=1/48/1e9/null->0/true->1 deu lot,
     roi hrtfResample (n = len*to/from, khong kep) no tung: len toi da 65536 tap
     voi sr=48 -> 65,5 trieu push (~60 s, ~0,5 GB), sr=1 -> 3,1 ti push (treo/OOM);
     chieu WAV cung no khi set.sampleRate=1e9 lam `to`. */
  if (o && o.sampleRate !== undefined && o.sampleRate !== null){
    var srv = parseFloat(o.sampleRate);
    if (!isFinite(srv) || srv < 8000 || srv > 192000) throw new Error("sampleRate JSON ngoài 8–192 kHz (" + o.sampleRate + " Hz)");
    sr = Math.round(srv);
  }
  var list = null;
  if (o && Array.isArray(o.directions)) list = o.directions;
  else if (o && (Array.isArray(o.left) || Array.isArray(o.right))) list = [o];
  else throw new Error("JSON HRTF cần mảng directions hoặc một hướng {azimuth, elevation, left, right}");
  var dirs = [], i, d;
  for (i = 0; i < list.length; i++){ d = hrtfSanitizeDir(list[i]); if (d) dirs.push(d); }
  if (!dirs.length) throw new Error("không có hướng HRTF hợp lệ nào trong file (cần left/right là mảng số hữu hạn, dài 1..65536)");
  return { sampleRate: sr, directions: dirs };
}
function hrtfWavSample(dv, p, fmt){
  if (fmt.audio === 3){
    if (fmt.bits === 32) return dv.getFloat32(p, true);
    if (fmt.bits === 64) return dv.getFloat64(p, true);
    return NaN;
  }
  if (fmt.audio !== 1) return NaN;
  if (fmt.bits === 16) return dv.getInt16(p, true) / 32768;
  if (fmt.bits === 8) return (dv.getUint8(p) - 128) / 128;
  if (fmt.bits === 24){
    var v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16);
    if (v & 0x800000) v -= 0x1000000;
    return v / 8388608;
  }
  if (fmt.bits === 32) return dv.getInt32(p, true) / 2147483648;
  return NaN;
}
function hrtfParseWav(buf){
  var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  function str(o, n){ var s = "", i; for (i = 0; i < n; i++) s += String.fromCharCode(u[o + i]); return s; }
  if (u.length < 44 || str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") throw new Error("không phải file WAV RIFF/WAVE");
  var dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  var off = 12, fmt = null, data = null;
  while (off + 8 <= u.length){
    var id = str(off, 4), sz = dv.getUint32(off + 4, true);
    if (id === "fmt "){ fmt = { audio: dv.getUint16(off + 8, true), ch: dv.getUint16(off + 10, true), sr: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) }; }
    else if (id === "data"){ data = { off: off + 8, len: sz }; }
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || !data) throw new Error("WAV thiếu chunk fmt hoặc data");
  if (fmt.ch < 2) throw new Error("WAV mono không đủ cặp HRIR trái/phải — cần WAV stereo (kênh trái = HRIR trái, kênh phải = HRIR phải)");
  if (!isFinite(fmt.sr) || fmt.sr < 8000 || fmt.sr > 192000) throw new Error("sample rate WAV ngoài 8–192 kHz");
  var bytesPer = fmt.bits / 8;
  if (bytesPer !== Math.floor(bytesPer) || bytesPer < 1) throw new Error("độ sâu bit WAV không hỗ trợ");
  var frames = Math.floor(data.len / (bytesPer * fmt.ch));
  if (frames < 1) throw new Error("WAV không có mẫu nào");
  var L = [], R = [], i, p, a, b;
  for (i = 0; i < frames; i++){
    p = data.off + i * bytesPer * fmt.ch;
    a = hrtfWavSample(dv, p, fmt); b = hrtfWavSample(dv, p + bytesPer, fmt);
    if (!isFinite(a) || !isFinite(b)) throw new Error("định dạng mẫu WAV không hỗ trợ (cần PCM 8/16/24/32-bit hoặc float 32/64-bit)");
    L.push(a); R.push(b);
  }
  return { sampleRate: fmt.sr, left: L, right: R };
}
/* SOFA/HDF5 decoder — pure functions, no DOM. Inserted into the app verbatim. */
function sofaFail(msg){ throw new Error(msg); }
function sofaU16(dv, o){
  if (o < 0 || o + 2 > dv.byteLength) sofaFail("file HDF5 bị cắt (đọc ngoài cuối file)");
  return dv.getUint16(o, true);
}
function sofaU32(dv, o){
  if (o < 0 || o + 4 > dv.byteLength) sofaFail("file HDF5 bị cắt (đọc ngoài cuối file)");
  return dv.getUint32(o, true);
}
function sofaU64(dv, o){
  if (o < 0 || o + 8 > dv.byteLength) sofaFail("file HDF5 bị cắt (đọc ngoài cuối file)");
  var lo = dv.getUint32(o, true), hi = dv.getUint32(o + 4, true);
  if (hi === 0xFFFFFFFF && lo === 0xFFFFFFFF) return -1;
  return hi * 4294967296 + lo;
}
function sofaReq(dv, o, n){
  if (o < 0 || o + n > dv.byteLength) sofaFail("file HDF5 bị cắt (đọc ngoài cuối file)");
}
function sofaSigOk(u){
  return u.length >= 8 && u[0] === 0x89 && u[1] === 0x48 && u[2] === 0x44 && u[3] === 0x46 &&
    u[4] === 0x0D && u[5] === 0x0A && u[6] === 0x1A && u[7] === 0x0A;
}
function sofaBytesEq(u, o, sig){
  var i;
  if (o < 0 || o + sig.length > u.length) return false;
  for (i = 0; i < sig.length; i++) if (u[o + i] !== sig.charCodeAt(i)) return false;
  return true;
}
function sofaReadOh1(u, dv, addr){
  var msgs = [], queue = [], seenCont = {}, i, t, b, sz;
  function readBlock(start, len, isCont){
    var p = start, end = start + len, hdr;
    if (isCont){
      while (p < end){
        if (p + 8 > dv.byteLength) sofaFail("khối continuation của object header bị cắt");
        t = sofaU16(dv, p); sz = sofaU16(dv, p + 2);
        if (sz < 0 || p + 8 + sz > end) sofaFail("message trong khối continuation vượt quá khối");
        msgs.push({ type: t, off: p + 8, size: sz });
        if (t === 0x0010) queue.push({ off: p + 8, size: sz });
        p += 8 + sz; p = (p + 7) & ~7;
      }
    } else {
      sofaReq(dv, start, 16);
      if (u[start] !== 1) sofaFail("object header phiên bản " + u[start] + " chưa hỗ trợ (chỉ hỗ trợ v1, tức file superblock v0)");
      var hsize = sofaU32(dv, start + 8);
      p = start + 16; end = start + 16 + hsize;
      if (end > dv.byteLength) sofaFail("object header bị cắt");
      while (p < end){
        if (p + 8 > end) break;
        t = sofaU16(dv, p); sz = sofaU16(dv, p + 2);
        if (p + 8 + sz > end) sofaFail("message trong object header vượt quá header");
        msgs.push({ type: t, off: p + 8, size: sz });
        if (t === 0x0010) queue.push({ off: p + 8, size: sz });
        p += 8 + sz; p = (p + 7) & ~7;
      }
    }
  }
  readBlock(addr, 0, false);
  while (queue.length){
    var c = queue.shift();
    var off = sofaU64(dv, c.off), len = sofaU64(dv, c.off + 8);
    if (off < 0 || len < 0 || off + len > dv.byteLength) sofaFail("khối continuation của object header nằm ngoài file");
    var key = off + ":" + len;
    if (seenCont[key]) continue;
    seenCont[key] = true;
    readBlock(off, len, true);
  }
  return msgs;
}
function sofaMsg(msgs, type){
  var i;
  for (i = 0; i < msgs.length; i++) if (msgs[i].type === type) return msgs[i];
  return null;
}
function sofaHeapInfo(u, dv, heapAddr){
  sofaReq(dv, heapAddr, 32);
  if (!sofaBytesEq(u, heapAddr, "HEAP")) sofaFail("local heap không có chữ ký HEAP");
  if (u[heapAddr + 4] !== 0) sofaFail("local heap phiên bản " + u[heapAddr + 4] + " chưa hỗ trợ");
  var segSize = sofaU64(dv, heapAddr + 8);
  var segAddr = sofaU64(dv, heapAddr + 24);
  if (segAddr < 0 || segSize < 0 || segAddr + segSize > dv.byteLength) sofaFail("data segment của local heap nằm ngoài file");
  return { segAddr: segAddr, segSize: segSize };
}
function sofaHeapName(u, heap, linkOff){
  var s, e, out = "", i;
  if (linkOff < 0 || linkOff >= heap.segSize) sofaFail("offset tên link trong heap vượt quá data segment");
  s = heap.segAddr + linkOff;
  e = s;
  while (e < heap.segAddr + heap.segSize && u[e] !== 0) e++;
  if (e >= heap.segAddr + heap.segSize) sofaFail("tên link trong heap không có byte 0 kết thúc");
  for (i = s; i < e; i++) out += String.fromCharCode(u[i]);
  return out;
}
function sofaGroupChildren(u, dv, btreeAddr, heapAddr, depth){
  if (depth > 32) sofaFail("nhóm HDF5 lồng nhau quá sâu (>32)");
  var heap = sofaHeapInfo(u, dv, heapAddr);
  var out = {}, stack = [btreeAddr], seenTree = {}, seenSnod = {};
  while (stack.length){
    var node = stack.pop();
    if (seenTree[node]) continue;
    seenTree[node] = true;
    sofaReq(dv, node, 24);
    if (!sofaBytesEq(u, node, "TREE")) sofaFail("B-tree của nhóm không có chữ ký TREE");
    if (u[node + 4] !== 0) sofaFail("B-tree nhóm loại " + u[node + 4] + " chưa hỗ trợ (chỉ hỗ trợ nhóm, loại 0)");
    var level = u[node + 5], n = sofaU16(dv, node + 6), p = node + 24, i;
    if (n < 0 || n > 100000) sofaFail("B-tree nhóm có số mục bất thường");
    for (i = 0; i < n; i++){
      var child = sofaU64(dv, p + 8);
      if (child < 0 || child >= dv.byteLength) sofaFail("B-tree nhóm trỏ ra ngoài file");
      if (level > 0) stack.push(child);
      else {
        if (seenSnod[child]) { p += 16; continue; }
        seenSnod[child] = true;
        sofaReq(dv, child, 8);
        if (!sofaBytesEq(u, child, "SNOD")) sofaFail("symbol node không có chữ ký SNOD");
        if (u[child + 4] !== 1) sofaFail("symbol node phiên bản " + u[child + 4] + " chưa hỗ trợ");
        var nsym = sofaU16(dv, child + 6), q = child + 8, j;
        for (j = 0; j < nsym; j++){
          sofaReq(dv, q, 40);
          var linkOff = sofaU64(dv, q), ohAddr = sofaU64(dv, q + 8);
          var cacheType = sofaU32(dv, q + 16);
          var scrB = sofaU64(dv, q + 24), scrH = sofaU64(dv, q + 32);
          if (ohAddr < 0 || ohAddr >= dv.byteLength) sofaFail("symbol table trỏ tới object header ngoài file");
          var nm = sofaHeapName(u, heap, linkOff);
          out[nm] = { oh: ohAddr, cacheType: cacheType, btree: scrB, heap: scrH };
          q += 40;
        }
      }
      p += 16;
    }
  }
  return out;
}
function sofaGroupChildrenOf(u, dv, entry, depth){
  var msgs = sofaReadOh1(u, dv, entry.oh);
  var st = sofaMsg(msgs, 0x0011);
  if (st){
    var bt = sofaU64(dv, st.off), hp = sofaU64(dv, st.off + 8);
    if (bt < 0 || hp < 0 || bt >= dv.byteLength || hp >= dv.byteLength) sofaFail("symbol table của nhóm trỏ ra ngoài file");
    return sofaGroupChildren(u, dv, bt, hp, depth);
  }
  if (entry.cacheType === 1 && entry.btree >= 0 && entry.heap >= 0)
    return sofaGroupChildren(u, dv, entry.btree, entry.heap, depth);
  sofaFail("nhóm HDF5 không có bảng symbol (chỉ hỗ trợ nhóm superblock v0)");
}
function sofaF16(bits){
  var sign = (bits & 0x8000) ? -1 : 1;
  var exp = (bits >> 10) & 0x1F, mant = bits & 0x3FF;
  if (exp === 0) return sign * mant * Math.pow(2, -24);
  if (exp === 31) return mant === 0 ? sign * Infinity : NaN;
  return sign * (1 + mant / 1024) * Math.pow(2, exp - 15);
}
function sofaReadDataset(u, dv, ohAddr, offSize, lenSize){
  var msgs = sofaReadOh1(u, dv, ohAddr);
  var i, flt = null;
  for (i = 0; i < msgs.length; i++){
    if (msgs[i].type === 0x000B){
      if (msgs[i].size >= 2 && u[msgs[i].off + 1] > 0)
        sofaFail("dataset dùng bộ lọc/nén (filter pipeline) — chỉ hỗ trợ dữ liệu không nén");
    }
    if (msgs[i].type === 0x0007) sofaFail("dataset dùng file dữ liệu ngoài (external storage) — chưa hỗ trợ");
  }
  var dsMsg = sofaMsg(msgs, 0x0001);
  var dtMsg = sofaMsg(msgs, 0x0003);
  var loMsg = sofaMsg(msgs, 0x0008);
  if (!dsMsg) sofaFail("dataset thiếu message dataspace");
  if (!dtMsg) sofaFail("dataset thiếu message datatype");
  if (!loMsg) sofaFail("dataset thiếu message layout");
  var dsb = dsMsg.off;
  var dsVer = u[dsb];
  if (dsVer !== 1 && dsVer !== 2 && dsVer !== 3) sofaFail("dataspace phiên bản " + dsVer + " chưa hỗ trợ");
  var ndims = u[dsb + 1], dsFlags = u[dsb + 2];
  if (dsFlags & 2) sofaFail("dataspace có hoán vị chiều (permutation) — chưa hỗ trợ");
  if (ndims > 8) sofaFail("dataspace có số chiều bất thường (" + ndims + ")");
  var p = dsb + 8, dims = [], k;
  for (k = 0; k < ndims; k++){
    var dsz = lenSize === 8 ? sofaU64(dv, p) : sofaU32(dv, p);
    if (dsz < 0 || dsz > 1000000000) sofaFail("dataspace có kích thước chiều bất thường");
    dims.push(dsz); p += lenSize;
  }
  if (dsFlags & 1) p += ndims * lenSize;
  var dtb = dtMsg.off;
  var dtVer = u[dtb] >> 4, dtClass = u[dtb] & 0x0F;
  if (dtVer !== 1) sofaFail("datatype phiên bản " + dtVer + " chưa hỗ trợ");
  var bitfield = u[dtb + 1] | (u[dtb + 2] << 8) | (u[dtb + 3] << 16);
  var typeSize = sofaU32(dv, dtb + 4);
  var be = (bitfield & 1) === 1;
  var kind, signed = false;
  if (dtClass === 0){
    if (typeSize !== 1 && typeSize !== 2 && typeSize !== 4 && typeSize !== 8)
      sofaFail("kiểu số nguyên có kích thước " + typeSize + " byte — chưa hỗ trợ");
    if (bitfield !== 0 && bitfield !== 1 && bitfield !== 8 && bitfield !== 9)
      sofaFail("kiểu số nguyên không chuẩn (bitfield 0x" + bitfield.toString(16) + ")");
    signed = (bitfield & 8) !== 0;
    var pr = dtMsg.off + 8;
    sofaReq(dv, pr, 8);
    if (u[pr] !== 0 || u[pr + 1] !== 0 || sofaU16(dv, pr + 2) !== typeSize * 8 ||
        u[pr + 4] !== 0 || u[pr + 5] !== 0 || u[pr + 6] !== 0 || u[pr + 7] !== 0)
      sofaFail("kiểu số nguyên không chuẩn (properties lệch khỏi số nguyên chuẩn)");
    kind = signed ? "int" : "uint";
  } else if (dtClass === 1){
    var wantBf = typeSize === 2 ? 0x0F20 : (typeSize === 4 ? 0x1F20 : (typeSize === 8 ? 0x3F20 : -1));
    if (wantBf < 0 || (bitfield & ~1) !== wantBf)
      sofaFail("kiểu float không chuẩn (không phải IEEE 754, bitfield 0x" + bitfield.toString(16) + ")");
    var props = dtMsg.off + 8;
    sofaReq(dv, props, 16);
    var wantProps = typeSize === 2 ? [0,0,16,0,10,5,0,10,15,0,0,0,0,0,0,0] :
      (typeSize === 4 ? [0,0,32,0,23,8,0,23,127,0,0,0,0,0,0,0] :
      [0,0,64,0,52,11,0,52,255,3,0,0,0,0,0,0]);
    for (k = 0; k < 16; k++) if (u[props + k] !== wantProps[k])
      sofaFail("kiểu float không chuẩn (properties lệch khỏi IEEE 754)");
    kind = "float";
  } else {
    sofaFail("datatype class " + dtClass + " chưa hỗ trợ (chỉ hỗ trợ số nguyên và float)");
  }
  var lob = loMsg.off, loVer = u[lob], addr = -1, alloc = -1;
  if (loVer === 3){
    var loClass = u[lob + 1];
    if (loClass === 1){
      addr = sofaU64(dv, lob + 2); alloc = sofaU64(dv, lob + 10);
    } else if (loClass === 2) sofaFail("dataset lưu dạng chunked — chỉ hỗ trợ contiguous");
    else if (loClass === 3) sofaFail("dataset lưu dạng compact — chỉ hỗ trợ contiguous");
    else sofaFail("layout class " + loClass + " (v3) chưa hỗ trợ");
  } else if (loVer === 1){
    var loDim = u[lob + 1];
    if (loDim !== ndims) sofaFail("layout v1 có số chiều lệch với dataspace");
    var loClass1 = u[lob + 2];
    if (loClass1 === 0){ addr = sofaU64(dv, lob + 8); alloc = sofaU64(dv, lob + 8 + offSize); }
    else if (loClass1 === 1) sofaFail("dataset lưu dạng chunked — chỉ hỗ trợ contiguous");
    else if (loClass1 === 2) sofaFail("dataset lưu dạng compact — chỉ hỗ trợ contiguous");
    else sofaFail("layout class " + loClass1 + " (v1) chưa hỗ trợ");
  } else if (loVer === 2){
    var loClass2 = u[lob + 1];
    if (loClass2 === 0){ addr = sofaU64(dv, lob + 2); alloc = sofaU64(dv, lob + 2 + offSize); }
    else if (loClass2 === 1) sofaFail("dataset lưu dạng chunked — chỉ hỗ trợ contiguous");
    else if (loClass2 === 2) sofaFail("dataset lưu dạng compact — chỉ hỗ trợ contiguous");
    else sofaFail("layout class " + loClass2 + " (v2) chưa hỗ trợ");
  } else {
    sofaFail("layout phiên bản " + loVer + " chưa hỗ trợ");
  }
  var count = 1, total = 1;
  for (k = 0; k < dims.length; k++){
    if (dims[k] === 0) sofaFail("dataset có chiều bằng 0 (không có dữ liệu)");
    total *= dims[k];
    if (total > 64000000) sofaFail("dataset quá lớn (>64 triệu phần tử)");
  }
  if (dims.length === 0) total = 1;
  var need = total * typeSize;
  if (addr < 0 || alloc < need || addr + need > dv.byteLength)
    sofaFail("vùng dữ liệu của dataset nằm ngoài file hoặc nhỏ hơn kích thước cần đọc");
  var values = new Array(total), idx, v;
  for (idx = 0; idx < total; idx++){
    var o = addr + idx * typeSize;
    if (kind === "float"){
      if (typeSize === 2) v = sofaF16(dv.getUint16(o, !be));
      else if (typeSize === 4) v = dv.getFloat32(o, !be);
      else v = dv.getFloat64(o, !be);
    } else if (typeSize === 1){
      v = signed ? dv.getInt8(o) : dv.getUint8(o);
    } else if (typeSize === 2){
      v = signed ? dv.getInt16(o, !be) : dv.getUint16(o, !be);
    } else if (typeSize === 4){
      v = signed ? dv.getInt32(o, !be) : dv.getUint32(o, !be);
    } else {
      var bg = signed ? dv.getBigInt64(o, !be) : dv.getBigUint64(o, !be);
      if (bg > 9007199254740991n || bg < -9007199254740991n)
        sofaFail("giá trị nguyên 64-bit vượt giới hạn số JS an toàn");
      v = Number(bg);
    }
    if (!isFinite(v)) sofaFail("dataset chứa giá trị không hữu hạn (NaN/Infinity)");
    values[idx] = v;
  }
  return { dims: dims, values: values, kind: kind, typeSize: typeSize };
}
function sofaExtractHrtf(u8){
  var u = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  if (!sofaSigOk(u)) sofaFail("không phải file HDF5 (thiếu chữ ký \\x89HDF ở đầu file)");
  var dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  var sbVer = u[8];
  if (sbVer === 2 || sbVer === 3)
    sofaFail("superblock HDF5 v" + sbVer + " (nhóm Link Info/fractal heap) chưa hỗ trợ — hãy lưu lại bằng h5py libver='earliest' hoặc SOFA Toolbox để được superblock v0");
  if (sbVer !== 0 && sbVer !== 1)
    sofaFail("superblock HDF5 phiên bản " + sbVer + " chưa hỗ trợ");
  var offSize = u[13], lenSize = u[14];
  if (offSize !== 8 || lenSize !== 8)
    sofaFail("size of offsets/lengths khác 8 byte (" + offSize + "/" + lenSize + ") — chưa hỗ trợ");
  var ste = 32 + 3 * offSize;
  var rootOh = sofaU64(dv, ste + offSize);
  var rootBt = sofaU64(dv, ste + 2 * offSize + 8);
  var rootHp = sofaU64(dv, ste + 3 * offSize + 8);
  if (rootOh < 0 || rootOh >= dv.byteLength) sofaFail("object header của nhóm gốc nằm ngoài file");
  var rootMsgs = sofaReadOh1(u, dv, rootOh);
  var rootSt = sofaMsg(rootMsgs, 0x0011);
  var bt = rootBt, hp = rootHp;
  if (rootSt){
    bt = sofaU64(dv, rootSt.off); hp = sofaU64(dv, rootSt.off + 8);
  }
  if (bt < 0 || hp < 0 || bt >= dv.byteLength || hp >= dv.byteLength)
    sofaFail("bảng symbol của nhóm gốc trỏ ra ngoài file");
  var root = sofaGroupChildren(u, dv, bt, hp, 0);
  if (!root["Data"]) sofaFail("file SOFA thiếu nhóm Data");
  if (!root["Source"]) sofaFail("file SOFA thiếu nhóm Source");
  var dataCh = sofaGroupChildrenOf(u, dv, root["Data"], 1);
  var srcCh = sofaGroupChildrenOf(u, dv, root["Source"], 1);
  if (!dataCh["Data.IR"]) sofaFail("file SOFA thiếu dataset Data/Data.IR");
  if (!dataCh["Data.SamplingRate"]) sofaFail("file SOFA thiếu dataset Data/Data.SamplingRate");
  if (!srcCh["SourcePosition"]) sofaFail("file SOFA thiếu dataset Source/SourcePosition");
  var ir = sofaReadDataset(u, dv, dataCh["Data.IR"].oh, offSize, lenSize);
  var sr = sofaReadDataset(u, dv, dataCh["Data.SamplingRate"].oh, offSize, lenSize);
  var sp = sofaReadDataset(u, dv, srcCh["SourcePosition"].oh, offSize, lenSize);
  if (ir.dims.length !== 3) sofaFail("Data.IR phải có 3 chiều [số hướng, số receiver, số mẫu], nhận được " + ir.dims.length + " chiều");
  var M = ir.dims[0], R = ir.dims[1], N = ir.dims[2];
  if (R !== 2) sofaFail("Data.IR cần đúng 2 receiver (trái/phải), nhận được " + R);
  if (N < 1 || N > 65536) sofaFail("Data.IR có số mẫu/kênh bất thường (" + N + ")");
  if (sp.dims.length !== 2 || sp.dims[1] !== 3)
    sofaFail("SourcePosition phải có dạng [số hướng, 3] (azimuth độ, elevation độ, bán kính), nhận được [" + sp.dims.join(", ") + "]");
  if (sp.dims[0] !== M)
    sofaFail("SourcePosition có " + sp.dims[0] + " hướng, lệch với Data.IR (" + M + " hướng)");
  if (sr.values.length < 1) sofaFail("Data.SamplingRate rỗng");
  var sr0 = sr.values[0], si;
  for (si = 0; si < sr.values.length; si++)
    if (sr.values[si] !== sr0) sofaFail("Data.SamplingRate không đồng nhất trong file");
  if (!isFinite(sr0) || sr0 < 8000 || sr0 > 192000)
    sofaFail("Data.SamplingRate ngoài 8–192 kHz (" + sr0 + " Hz)");
  var delay = null, delayMax = 0;
  if (dataCh["Data.Delay"]){
    var dl = sofaReadDataset(u, dv, dataCh["Data.Delay"].oh, offSize, lenSize);
    if (dl.dims.length !== 2 || dl.dims[0] !== M || dl.dims[1] !== 2)
      sofaFail("Data.Delay phải có dạng [" + M + ", 2], nhận được [" + dl.dims.join(", ") + "]");
    delay = dl.values;
  }
  var dirs = [], m, r;
  for (m = 0; m < M; m++){
    var azRaw = sp.values[m * 3], elRaw = sp.values[m * 3 + 1];
    if (Math.abs(azRaw) > 360) sofaFail("SourcePosition hàng " + m + " có azimuth vượt ±360° (" + azRaw + ") — file này có thể không dùng hệ spherical (azimuth/elevation độ)");
    if (elRaw < -90 || elRaw > 90) sofaFail("SourcePosition hàng " + m + " có elevation ngoài ±90° (" + elRaw + ") — file này có thể không dùng hệ spherical (azimuth/elevation độ)");
    var base = (m * 2) * N;
    var dL = 0, dR = 0;
    if (delay){
      dL = Math.round(delay[m * 2]); dR = Math.round(delay[m * 2 + 1]);
      if (dL < 0 || dR < 0) sofaFail("Data.Delay hàng " + m + " có giá trị âm");
      if (N + dL > 65536 || N + dR > 65536) sofaFail("HRIR sau khi cộng delay vượt 65536 mẫu ở hướng " + m);
      if (dL > delayMax) delayMax = dL;
      if (dR > delayMax) delayMax = dR;
    }
    var left = ir.values.slice(base, base + N);
    var right = ir.values.slice(base + N, base + 2 * N);
    if (dL) left = new Array(dL).fill(0).concat(left);
    if (dR) right = new Array(dR).fill(0).concat(right);
    var az = (typeof hrtfWrapAz === "function") ? hrtfWrapAz(azRaw) : azRaw;
    var dir = null;
    if (typeof hrtfSanitizeDir === "function")
      dir = hrtfSanitizeDir({ azimuth: az, elevation: elRaw, left: left, right: right });
    else
      dir = { azimuth: azRaw, elevation: elRaw, left: left, right: right };
    if (!dir) sofaFail("hướng SOFA số " + m + " không hợp lệ sau khi kiểm tra");
    dirs.push(dir);
  }
  return { sampleRate: Math.round(sr0), directions: dirs, taps: N, delayMax: delayMax, measurements: M };
}
function hrtfResample(x, from, to){
  if (!x || !x.length) return [];
  if (!isFinite(from) || !isFinite(to) || from <= 0 || to <= 0 || Math.abs(from - to) < 1) return x.slice();
  var ratio = from / to, n = Math.max(1, Math.round(x.length / ratio)), out = [], i, p, i0, f, a, b;
  for (i = 0; i < n; i++){
    p = i * ratio; i0 = Math.floor(p); f = p - i0;
    a = isFinite(x[i0]) ? x[i0] : 0;
    b = (i0 + 1 < x.length && isFinite(x[i0 + 1])) ? x[i0 + 1] : 0;
    out.push(a * (1 - f) + b * f);
  }
  return out;
}
function hrtfPeakScale(l, r){
  var pk = 0, i, v;
  for (i = 0; i < l.length; i++){ v = Math.abs(l[i]); if (isFinite(v) && v > pk) pk = v; }
  for (i = 0; i < r.length; i++){ v = Math.abs(r[i]); if (isFinite(v) && v > pk) pk = v; }
  return { peak: pk, factor: (pk > 1 ? 1 / pk : 1) };
}
function hrtfConvolve(mono, h){
  var m = mono || [], hh = h || [], i, j, a, b;
  if (!m.length || !hh.length) return [];
  var out = [];
  for (i = 0; i < m.length + hh.length - 1; i++) out.push(0);
  for (i = 0; i < m.length; i++){
    a = isFinite(m[i]) ? m[i] : 0; if (a === 0) continue;
    for (j = 0; j < hh.length; j++){ b = isFinite(hh[j]) ? hh[j] : 0; out[i + j] += a * b; }
  }
  return out;
}
function hrtfRefreshUI(){
  var st = $("hrtfState"), info = $("hrtfInfo"), sel = $("hrtfSel");
  if ($("hrtfToggle")){ $("hrtfToggle").textContent = HRTF.on ? "Tắt HRTF" : "Bật HRTF"; $("hrtfToggle").classList.toggle("on", HRTF.on); }
  if (st) st.textContent = HRTF.on ? "ĐANG BẬT" : "ĐANG TẮT";
  if ($("hrtfAzOut")) $("hrtfAzOut").textContent = HRTF.az + "°";
  if ($("hrtfElOut")) $("hrtfElOut").textContent = HRTF.el + "°";
  if (info){
    if (!HRTF.set) info.textContent = "Chưa nạp bộ HRTF nào — hãy chọn file JSON, WAV stereo hoặc SOFA của bạn.";
    else info.textContent = "Bộ: " + HRTF.srcName + " · " + HRTF.set.directions.length + " hướng · rate " + (HRTF.set.sampleRate || "theo engine") + " Hz" + (HRTF.set.sampleRate && typeof AC !== "undefined" && AC && HRTF.set.sampleRate !== AC.sampleRate ? " (sẽ resample về " + AC.sampleRate + " Hz khi phát)" : "");
  }
  if (sel){
    if (!HRTF.set || HRTF.sel < 0) sel.textContent = "—";
    else {
      var d = HRTF.set.directions[HRTF.sel];
      var s = hrtfSelectDirection(HRTF.set.directions, HRTF.az, HRTF.el);
      sel.textContent = "Muốn " + HRTF.az + "° / " + HRTF.el + "° → dùng hướng gần nhất " + d.azimuth + "° / " + d.elevation + "° (lệch " + s.dist.toFixed(1) + "°, HRIR " + d.left.length + "/" + d.right.length + " mẫu)" + (typeof PSY !== "undefined" && PSY.cross && PSY.cross.on ? " · CẢNH BÁO: crossfeed tham số đang bật — nên tắt để tránh xử lý không gian 2 lần." : "");
    }
  }
}
function hrtfMakeBuffer(arr, sr){
  var buf = AC.createBuffer(1, arr.length, sr), ch = buf.getChannelData(0), i;
  for (i = 0; i < arr.length; i++) ch[i] = isFinite(arr[i]) ? arr[i] : 0;
  return buf;
}
function hrtfRebuildBuffers(){
  if (typeof AC === "undefined" || !AC || !HRTF.nodes || !HRTF.set || HRTF.sel < 0) return false;
  var d = HRTF.set.directions[HRTF.sel], sr = AC.sampleRate;
  /* Pha C 2026-11-07: uu tien rate rieng cua huong (WAV giu rate goc khi bo
     khong co sampleRate) roi moi den rate bo / rate engine — tranh HRIR
     phat sai thoi gian khi tron rate trong mot bo (lab 2026-11-07). */
  var from = d.sampleRate || HRTF.set.sampleRate || sr;
  var l = hrtfResample(d.left, from, sr), r = hrtfResample(d.right, from, sr);
  var pk = hrtfPeakScale(l, r), i;
  if (pk.factor !== 1){ for (i = 0; i < l.length; i++) l[i] *= pk.factor; for (i = 0; i < r.length; i++) r[i] *= pk.factor; }
  HRTF.nodes.convL.buffer = hrtfMakeBuffer(l, sr);
  HRTF.nodes.convR.buffer = hrtfMakeBuffer(r, sr);
  HRTF.builtFor = HRTF.sel + "@" + HRTF.srcName;
  return true;
}
function hrtfApplyGraph(){
  if (typeof AC === "undefined" || !AC || typeof masterGain === "undefined" || !masterGain) return false;
  try {
    masterGain.disconnect();
    if (HRTF.on && HRTF.set && HRTF.sel >= 0){
      if (!HRTF.nodes){
        var sp = AC.createChannelSplitter(2);
        var mono = AC.createGain(); mono.channelCount = 1; mono.channelInterpretation = "speakers";
        var cL = AC.createConvolver(), cR = AC.createConvolver();
        var mg = AC.createChannelMerger(2);
        sp.connect(mono, 0); sp.connect(mono, 1);
        mono.connect(cL); mono.connect(cR);
        cL.connect(mg, 0, 0); cR.connect(mg, 0, 1);
        HRTF.nodes = { splitter: sp, mono: mono, convL: cL, convR: cR, merger: mg };
      }
      if (HRTF.builtFor !== HRTF.sel + "@" + HRTF.srcName) hrtfRebuildBuffers();
      masterGain.connect(HRTF.nodes.splitter);
      HRTF.nodes.merger.connect(AC.destination);
      HRTF.graphOn = true;
    } else {
      masterGain.connect(AC.destination);
      HRTF.graphOn = false;
    }
    return true;
  } catch (e) {
    try { masterGain.connect(AC.destination); } catch (e2) {}
    HRTF.graphOn = false;
    return false;
  }
}
function hrtfLoadSet(set, name){
  HRTF.set = set; HRTF.srcName = name || "";
  HRTF.az = 0; HRTF.el = 0;
  if ($("hrtfAz")) $("hrtfAz").value = 0;
  if ($("hrtfEl")) $("hrtfEl").value = 0;
  var s = hrtfSelectDirection(set.directions, 0, 0);
  HRTF.sel = s ? s.index : -1;
  HRTF.builtFor = "";
  if (HRTF.on) hrtfApplyGraph();
  hrtfRefreshUI();
}
function hrtfHandleFile(file){
  if (!file) return;
  var name = file.name || "", lower = name.toLowerCase();
  var isJson = /\.json$/i.test(lower), isWav = /\.wav$/i.test(lower), isSofa = /\.sofa$/i.test(lower);
  var info = $("hrtfInfo");
  file.arrayBuffer().then(function(ab){
    var u = new Uint8Array(ab);
    try {
      if (isSofa){
        try {
          var sSet = sofaExtractHrtf(u);
          hrtfLoadSet(sSet, name);
          if (info) info.textContent = "Đã nạp SOFA: " + name + " · " + sSet.directions.length + " hướng · rate " + sSet.sampleRate + " Hz · HRIR " + sSet.taps + " mẫu/kênh" + (sSet.delayMax > 0 ? " (đã cộng delay tối đa " + sSet.delayMax + " mẫu vào đầu HRIR)" : "") + " · tự chọn hướng gần phía trước nhất.";
        } catch (eSofa) {
          if (info) info.textContent = "Không nạp được file SOFA: " + eSofa.message + " — file không bị nạp, không tạo HRIR giả. Hãy lưu lại bằng h5py libver='earliest'/SOFA Toolbox hoặc chuyển sang JSON/WAV rồi nạp lại.";
        }
        return;
      }
      if (isJson){
        var txt = new TextDecoder().decode(u);
        var set = hrtfParseJson(txt);
        hrtfLoadSet(set, name);
        if (info) info.textContent = "Đã nạp JSON: " + name + " · " + set.directions.length + " hướng · tự chọn hướng gần phía trước nhất.";
        return;
      }
      var w = hrtfParseWav(u);
      var az = parseFloat($("hrtfWavAz").value); if (!isFinite(az)) az = 0; az = Math.max(-180, Math.min(180, az));
      var el = parseFloat($("hrtfWavEl").value); if (!isFinite(el)) el = 0; el = Math.max(-90, Math.min(90, el));
      var dir = hrtfSanitizeDir({ azimuth: az, elevation: el, left: w.left, right: w.right });
      if (!dir) throw new Error("cặp HRIR WAV không hợp lệ");
      if (HRTF.set && HRTF.set.sampleRate && w.sampleRate !== HRTF.set.sampleRate){
        dir.left = hrtfResample(dir.left, w.sampleRate, HRTF.set.sampleRate);
        dir.right = hrtfResample(dir.right, w.sampleRate, HRTF.set.sampleRate);
      }
      /* Pha C 2026-11-07: giu rate goc tren tung huong WAV — truoc day khi bo
         JSON khong co sampleRate, huong WAV them vao khong duoc resample
         (nhanh resample chi chay khi bo co rate) nhung cung khong ghi lai
         rate goc, roi hrtfRebuildBuffers lay set.sampleRate || engine rate
         lam `from` nen HRIR 44.1k bi phat o 48k (nhanh 8,8%; file 96k vao
         engine 48k thi nhanh gap doi). Ghi dir.sampleRate = rate ma taps
         dang o (rate bo neu vua resample, rate file neu chua resample);
         rebuild uu tien dung no (xem hrtfRebuildBuffers). */
      dir.sampleRate = (HRTF.set && HRTF.set.sampleRate) ? HRTF.set.sampleRate : w.sampleRate;
      if (HRTF.set){
        HRTF.set.directions.push(dir); HRTF.srcName = HRTF.srcName + " + " + name;
        var s2 = hrtfSelectDirection(HRTF.set.directions, HRTF.az, HRTF.el);
        HRTF.sel = s2 ? s2.index : -1; HRTF.builtFor = "";
        if (HRTF.on) hrtfApplyGraph();
        hrtfRefreshUI();
      } else {
        hrtfLoadSet({ sampleRate: w.sampleRate, directions: [dir] }, name);
      }
      if (info) info.textContent = "Đã thêm WAV: " + name + " → hướng " + az + "° / " + el + "° (" + dir.left.length + " mẫu/kênh).";
    } catch (e) {
      if (info) info.textContent = "Không nạp được " + name + ": " + e.message;
    }
  }).catch(function(e){
    if (info) info.textContent = "Không đọc được file: " + (e && e.message ? e.message : e);
  });
}
$("hrtfFile").addEventListener("change", function(){ if (this.files && this.files[0]) hrtfHandleFile(this.files[0]); });
$("hrtfToggle").addEventListener("click", function(){
  if (!HRTF.on && (!HRTF.set || HRTF.sel < 0)){ if ($("hrtfInfo")) $("hrtfInfo").textContent = "Chưa có bộ HRTF — hãy nạp file JSON, WAV hoặc SOFA trước rồi mới bật."; return; }
  HRTF.on = !HRTF.on;
  if (HRTF.on && typeof engineReady !== "undefined" && !engineReady){ if ($("hrtfInfo")) $("hrtfInfo").textContent = "HRTF đã bật chờ — bấm phát để khởi tạo engine, graph binaural sẽ tự gắn sau masterGain."; }
  else hrtfApplyGraph();
  hrtfRefreshUI();
});
$("hrtfClear").addEventListener("click", function(){
  HRTF.set = null; HRTF.srcName = ""; HRTF.sel = -1; HRTF.on = false; HRTF.builtFor = "";
  hrtfApplyGraph(); hrtfRefreshUI();
});
$("hrtfAz").addEventListener("input", function(){
  HRTF.az = hrtfWrapAz(this.value);
  if (HRTF.set){ var s = hrtfSelectDirection(HRTF.set.directions, HRTF.az, HRTF.el); if (s) HRTF.sel = s.index; if (HRTF.on) hrtfApplyGraph(); }
  hrtfRefreshUI();
});
$("hrtfEl").addEventListener("input", function(){
  var v = parseFloat(this.value); if (!isFinite(v)) v = 0; HRTF.el = Math.max(-90, Math.min(90, v));
  if (HRTF.set){ var s = hrtfSelectDirection(HRTF.set.directions, HRTF.az, HRTF.el); if (s) HRTF.sel = s.index; if (HRTF.on) hrtfApplyGraph(); }
  hrtfRefreshUI();
});
hrtfRefreshUI();

/* ---------- Init Psycho ---------- */
syncPsyUI();
refreshDynPanel();
syncLoudReadouts();
