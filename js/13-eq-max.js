/* Web AutoEQ split module: 13-eq-max.js (nguon: khoi script L25316, L25390, L25423 cua ban 1 file) */

/* ---------- EQ chuan xac toi da - 1 lan bam (yeu cau nguoi dung 02/11/2026;
   cap nhat preset 07/11/2026 theo lab 6 o chuan; nang cap 26/11/2026: bat
   danh gia best-of) ----------
   Preset cau hinh + chay: dat moi o dieu khien solve-side ve cau hinh thuan
   nhat da kiem chung (target goc - tat tu dong Khối 6, lam muot psychoacoustic
   mac dinh, tat moi hau ky; BAT gioi han dai tan sua 20-10000 Hz va BAT trong
   so ERB cua tuy chon solver Khối 3) bang dung su kien change cua tung o
   (trang thai duoc luu nhu khi nguoi dung tu chinh), roi bat co best-of va bam
   nut Buoc 3 goc. Best-of (co san trong solver, H14/H16): khi dang chon 10
   band, solver danh gia them ung vien 20 band va 12 band seeded va giu ban co
   RMS-after thap nhat (cham bang RMS truc tiep, khong phai objective co phat);
   voi so band khac 10, giu nguyen 1 lan giai nhu cu. Lab 2026-11-07 tren ham
   that, tham chieu co dinh (target goc, duong psycho): RMS sau trung binh 6 o
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
      /* Nâng cấp khả năng: bật đánh giá best-of cho lần giải này — solver đánh giá
         ứng viên 10/20/12 band (khi đang chọn 10 band) và giữ bản có RMS-after
         thấp nhất, thay vì chỉ 1 lần giải. Cờ AUTO.bestOfPending được btnAutoEq
         đọc và tự xoá sau khi dùng; với số band khác 10, solver giữ nguyên hành
         vi 1 lần giải. */
      if (typeof AUTO !== "undefined") AUTO.bestOfPending = true;
      solve.click();
    } else if (info){
      info.textContent = "Đã đặt sẵn cấu hình chuẩn xác tối đa (target gốc · không hậu kỳ · đánh giá best-of giữ RMS tốt nhất khi chọn 10 band). Hãy chọn nguồn đo ở Bước 1 trước, rồi bấm nút này lần nữa để chạy.";
    }
  });
})();

/* --- Shim tuong thich 2026-11-04: cac ten duoc yeu cau nhung truoc day khong co dung ten trong file. Day la wrapper moi, khong sua cac ham goc. Giu nguyen: appliedPreDb, hwPreamp, qaRunSuite, wasmBenchmark, DB_RAW, hwSelfCheck. --- */
function computePreamp(bandList) {
  if (bandList && typeof hwPreamp === "function") return hwPreamp(bandList);
  if (typeof appliedPreDb === "function") return appliedPreDb();
  return 0;
}
function runValidationSuite() {
  if (typeof qaRunSuite === "function") return qaRunSuite();
  return [];
}
function runSelfBenchmark() {
  if (typeof wasmBenchmark === "function") return wasmBenchmark();
  return { enabled: false, reason: "wasmBenchmark khong co san" };
}
var INLINE_HEADPHONE_DB = (typeof DB_RAW !== "undefined" ? DB_RAW : []);
function hw15() {
  if (typeof hwSelfCheck === "function") return hwSelfCheck();
  return { pass: 0, total: 0 };
}
function preOk(bandList) {
  try {
    var v = (bandList && typeof hwPreamp === "function") ? hwPreamp(bandList) : appliedPreDb();
    return typeof v === "number" && isFinite(v) && v <= 0;
  } catch (e) { return false; }
}
function stOk() {
  try {
    var r = hwSelfCheck();
    return !!(r && r.pass === r.total);
  } catch (e) { return false; }
}

/* ---------- AEOPT v1 — Trinh toi uu Web AutoEQ (2026-11-05) ----------
   Muc dich: het lag/do khi chay AutoEQ ma KHONG doi ket qua solver.
   - Gop solve: neu mot solve dang chay ma nut AutoEQ bi bam lai (vi du
     handler cu tu bam lai khi sig doi giua chung), request trung signature
     se doi chung ket qua, request khac signature xep hang FIFO,
     va chay lan luot sau khi solve hien tai xong — khong con chuoi solve
     noi nhau vo han, khong solve song song tren cung Worker.
   - Panel bat/tat: nut noi o goc duoi-phai, khong dung id DOM moi nen
     khong doi so luong id; tat di thi moi wrapper tro ve hanh vi goc.
   - scheduleAeTarget (o tren) + bo drawGraph trung lap + cache spec la
     cac phan con lai cua v1. Tat ca deu co try/catch: loi toi uu khong
     bao gio lam hong duong chay goc. --- */
(function(){
  try {
    var OPT = { enabled: true, coalesced: 0, targetSkipped: 0 };
    try { var _sv = window.localStorage.getItem("webAutoEq.opt.v1"); if (_sv === "0") OPT.enabled = false; } catch (e) {}
    window.AEOPT = OPT;
    var _btnT = null, _stat = null;
    function render(){
      try {
        if (_btnT) _btnT.textContent = OPT.enabled ? "Tối ưu: BẬT" : "Tối ưu: TẮT";
        if (_stat) _stat.textContent = "gộp solve: " + OPT.coalesced + " · gộp vẽ target: " + OPT.targetSkipped;
        window.localStorage.setItem("webAutoEq.opt.v1", OPT.enabled ? "1" : "0");
      } catch (e) {}
    }
    try {
      var panel = document.createElement("div");
      panel.className = "aeopt-panel";
      panel.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:9999;background:#10151c;border:1px solid #2e3745;border-radius:8px;padding:6px 10px;font:12px system-ui;color:#dbe2ea;opacity:0.92");
      _btnT = document.createElement("button");
      _btnT.className = "aeopt-toggle";
      _btnT.setAttribute("style", "background:#1d2733;color:#fff;border:1px solid #3a4757;border-radius:6px;padding:3px 8px;cursor:pointer");
      _stat = document.createElement("span");
      _stat.className = "aeopt-stat";
      _stat.setAttribute("style", "margin-left:8px;color:#8b95a3");
      _btnT.addEventListener("click", function(){ OPT.enabled = !OPT.enabled; render(); });
      panel.appendChild(_btnT); panel.appendChild(_stat);
      document.body.appendChild(panel); render();
    } catch (e) {}
    if (typeof aeComputeAsync !== "function") return;
    var orig = aeComputeAsync;
    var busy = false, currentKey = null, currentCbs = [], queue = [];
    function keyOf(prep, targetId, adj, nB, preserve, bestOf, fs){
      try {
        var a = adj || {};
        return [ (typeof AE !== "undefined" && AE && AE.name) || "", targetId, a.tilt, a.bass, a.ear, nB, !!preserve, !!bestOf, (typeof fs === "number" && isFinite(fs) && fs > 0) ? fs : 48000, (prep && prep.ptsN) || "" ].join("|");
      } catch (e) { return String(targetId) + "|" + nB; }
    }
    function startRun(key, args, cbs){
      busy = true; currentKey = key; currentCbs = cbs;
      try {
        orig(args[0], args[1], args[2], args[3], args[4], args[5], args[6], function(out){
          var done = currentCbs; currentCbs = [];
          for (var i = 0; i < done.length; i++){ try { done[i].cb(out); } catch (e) {} }
          if (queue.length){
            var p = queue.shift();
            startRun(p.key, p.args, p.cbs);
          } else if (currentCbs.length){
            var rc = currentCbs; currentCbs = [];
            startRun(currentKey, rc[0].args, rc);
          } else { busy = false; currentKey = null; }
        });
      } catch (e) { busy = false; currentKey = null; currentCbs = []; queue = []; throw e; }
    }
    aeComputeAsync = function(prep, targetId, adj, nB, preserve, bestOf, fs, cb){
      if (typeof fs === "function"){ cb = fs; fs = undefined; }
      if (!OPT.enabled) return orig(prep, targetId, adj, nB, preserve, bestOf, fs, cb);
      var key = keyOf(prep, targetId, adj, nB, preserve, bestOf, fs);
      var args = [prep, targetId, adj, nB, preserve, bestOf, fs];
      if (!busy){ startRun(key, args, [{ cb: cb, args: args }]); return; }
      if (key === currentKey){ currentCbs.push({ cb: cb, args: args }); OPT.coalesced++; render(); return; }
      for (var qi = 0; qi < queue.length; qi++){ if (queue[qi].key === key){ queue[qi].cbs.push({ cb: cb, args: args }); OPT.coalesced++; render(); return; } }
      queue.push({ key: key, args: args, cbs: [{ cb: cb, args: args }] }); render();
    };
  } catch (e) {}
})();
