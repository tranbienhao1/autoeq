/* ---------- EQ chuan xac toi da - 1 lan bam (yeu cau nguoi dung 02/11/2026;
   cap nhat preset 07/11/2026 theo lab 6 o chuan) ----------
   Chi la preset cau hinh + chay: dat moi o dieu khien solve-side ve cau hinh
   thuan nhat da kiem chung (target goc - tat tu dong Khối 6, lam muot
   psychoacoustic mac dinh, tat moi hau ky; BAT gioi han dai tan sua 20-10000 Hz
   va BAT trong so ERB cua tuy chon solver Khối 3; giu nguyen so band nguoi dung
   dang chon) bang dung su kien change cua tung o (trang thai duoc luu nhu khi
   nguoi dung tu chinh), roi bam nut Buoc 3 goc. Lab 2026-11-07 tren ham that,
   tham chieu co dinh (target goc, duong psycho): RMS sau trung binh 6 o
   0,12515 -> 0,10734 dB, 6/6 o khong te hon (rieng range: 0,11159; rieng
   erbWeight: 0,12179). Khong them tang xu ly nao: solver, Worker va safety
   giu nguyen tuyet doi. */
(function(){
  var btn = document.getElementById("btnAeMaxAcc");
  if (!btn) return;
  function setVal(id, v){
    var el = document.getElementById(id);
    if (!el) return;
    if (String(el.value) !== String(v)){ el.value = String(v); el.dispatchEvent(new Event("change", { bubbles:true })); }
  }
  function setChk(id, v){
    var el = document.getElementById(id);
    if (!el) return;
    if (!!el.checked !== !!v){ el.checked = !!v; el.dispatchEvent(new Event("change", { bubbles:true })); }
  }
  btn.addEventListener("click", function(){
    /* ERB smoothing (Nang cap 1) ghi de muc lam muot cua solver: tat truoc,
       va neu no dang bat thi nap lai duong do ngay sau khi dat muc lam muot
       de AE.sm ve dung ban psychoacoustic (tat ERB khong tu nap lai). */
    var erbWasOn = false;
    var erbT = document.getElementById("upErbToggle");
    if (erbT && erbT.checked){ erbWasOn = true; erbT.checked = false; erbT.dispatchEvent(new Event("change", { bubbles:true })); }
    /* Tuy chon solver Khối 3: BAT trong so ERB (lab 2026-11-07: cung gioi han
       dai 20-10000 Hz cho RMS trung binh 6 o 0,12515 -> 0,10734 dB, 6/6 o khong
       te hon; rieng erbWeight: 0,12179, rieng range: 0,11159). Cap gain/Q giu
       mac dinh 12/10 (khong siet them). Ap dung qua nut Ap dung cua panel do
       neu trang thai chua dung — ke ca khi o tick da bat san nhung nguoi dung
       chua bam Ap dung (UP.solverOpts con cu). */
    var ew = document.getElementById("upErbWeightToggle"), gc = document.getElementById("upGainCap"), qc = document.getElementById("upQCap"), ap = document.getElementById("upSolverOptsApply");
    if (ew && gc && qc && ap){
      var needApply3 = !ew.checked || parseFloat(gc.value) !== 12 || parseFloat(qc.value) !== 10 ||
        !(typeof UP !== "undefined" && UP.solverOpts && UP.solverOpts.erbWeight === true && UP.solverOpts.gainCap === 12 && UP.solverOpts.qCap === 10);
      ew.checked = true; gc.value = "12"; qc.value = "10";
      if (needApply3) ap.click();
    }
    setVal("aeSmoothSel", "psycho");
    if (erbWasOn && typeof AE !== "undefined" && AE && AE.points && typeof aeSetMeasurement === "function"){
      try { aeSetMeasurement(AE.points, AE.name, AE.rig, AE.source); } catch (e) {}
    }
    /* So band: GIU NGUYEN lua chon cua nguoi dung (sua theo yeu cau 02/11/2026) - khong cham o aeBands. */
    setChk("aePreserveChar", false);
    /* Gioi han dai tan sua: BAT 20-10000 Hz (dung dai do RMS cua app) de solver
       tap trung toan bo band vao dai dang do — lab 2026-11-07 (xem ghi chu Khối 3
       o tren). Dat ro lo/hi ve mac dinh 20/10000 vi nguoi dung co the da doi
       chung truoc do. */
    setChk("aeRangeOn", true);
    setVal("aeRangeLo", "20");
    setVal("aeRangeHi", "10000");
    setVal("aeGainCapSel", "0");
    setChk("aeCutOnly", false);
    setVal("aeDeadbandSel", "0");
    setVal("aeRoundSel", "0");
    setChk("aeH13Auto", false);
    var info = document.getElementById("aeMaxAccInfo");
    var solve = document.getElementById("btnAutoEq");
    if (solve && !solve.disabled){
      solve.click();
    } else if (info){
      info.textContent = "Đã đặt sẵn cấu hình chuẩn xác tối đa (target gốc · không hậu kỳ · giữ số band đang chọn). Hãy chọn nguồn đo ở Bước 1 trước, rồi bấm nút này lần nữa để chạy.";
    }
  });
})();
