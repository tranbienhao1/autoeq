/* ================================================================
   Chế độ Tự Động Toàn Diện (chỉ đạo người dùng 2026-10-26 13:10):
   mặc định BẬT; tự động hoá mọi tuỳ chỉnh tính được từ dữ liệu sẵn
   có, chỉnh tay luôn ghi đè cho mục đó, tắt được bất cứ lúc nào.
   7 tự động hoá: (1) chọn số band engine 10/20 theo độ phức tạp của
   đường correction; (2) chạy solver + áp kết quả khi đổi tai nghe
   hoặc target; (3) pre-amp tự động (luật Giai đoạn 1); (4) bù
   loudness theo mức âm lượng hiện tại (ước lượng, không phải SPL
   thật); (5) cấu hình Dynamic EQ; (6) true-peak limiter ở trần
   −1.0 dBTP; (7) lưu/khôi phục trạng thái qua localStorage.
   Không tự động: chọn target, tilt/bass theo gu nghe, đáp án test mù.
   Solver 20 band (v2, 2026-10-26): aeSolve sinh đủ số band đã chọn (tới 20)
   bằng multi-start có phạt gain; autoMaybeSolve đồng bộ số band solver theo
   engine mỗi khi nó tự đổi số band engine (xem aeV5).
   An toàn: không chạy trong lúc toàn bộ QA đang chạy (btnQaAll bị
   khoá) để không phá trạng thái QA đang khôi phục; không chạy khi
   đang khôi phục trạng thái đã lưu; mọi chỉnh tay đều có cờ riêng.
   ================================================================ */
var AUTO = { on: true, solving: false, restoring: false,
  manual: { band: false, pre: false, limiter: false, loud: false, listen: false },
  manualDynOff: {}, manualDynEdit: {}, last: "", bestOfPending: false };

/* --- Hàm thuần: chọn số band engine theo độ phức tạp đường correction.
   err: mảng correction (target − đáp tuyến đã làm mượt), theo lưới tần
   của solver. 20 band khi có từ 6 lần đổi chiều (bỏ qua bước nhảy nhỏ
   hơn 0.3 dB) VÀ biên độ đỉnh–đỉnh từ 8 dB trở lên; còn lại 10 band.
   Dốc mượt (tilt) có biên lớn nhưng không đổi chiều -> vẫn 10 band. --- */
function autoPickBandCount(err){
  if (!err || !err.length) return 10;
  var mn = Infinity, mx = -Infinity, i;
  for (i = 0; i < err.length; i++){
    if (!isFinite(err[i])) continue;
    if (err[i] < mn) mn = err[i];
    if (err[i] > mx) mx = err[i];
  }
  if (!isFinite(mn)) return 10;
  var pp = mx - mn, wiggles = 0, prev = 0;
  for (i = 1; i < err.length; i++){
    if (!isFinite(err[i]) || !isFinite(err[i - 1])) continue;
    var d = err[i] - err[i - 1];
    if (Math.abs(d) < 0.3) continue;
    var s = d > 0 ? 1 : -1;
    if (prev !== 0 && s !== prev) wiggles++;
    prev = s;
  }
  return (wiggles >= 6 && pp >= 8) ? 20 : 10;
}
/* --- Hàm thuần: mức nghe (phon) ước lượng từ thanh âm lượng.
   vol: 0–100; ref: mức tham chiếu (phon). 100% -> ref, mỗi −10% ~ −3
   phon, kẹp [20, 90]. Đây là ước lượng từ vị trí thanh trượt, KHÔNG
   phải đo SPL thật (SPL thật phụ thuộc tai nghe + mức nguồn). --- */
function autoVolToListen(vol, ref){
  if (!isFinite(vol)) vol = 85;
  if (!isFinite(ref)) ref = 80;
  vol = Math.max(0, Math.min(100, vol));
  return Math.max(20, Math.min(90, Math.round(ref - (100 - vol) * 0.3)));
}
/* --- Hàm thuần: cấu hình Dynamic EQ tự động từ gain của band.
   Ngưỡng cố định −20 dBFS; ratio tăng theo |gain| (2–8); range cắt
   tối đa bằng |gain| (kẹp 2–8 dB); detector RMS (hợp nhạc hơn Peak).
   Attack/release/sidechain giữ nguyên theo cài đặt hiện tại. --- */
function autoDynConfig(gain){
  var a = Math.abs(gain);
  if (!isFinite(a)) a = 0;
  return { thr: -20, ratio: Math.min(8, Math.max(2, 1 + a / 2)),
           range: -Math.min(8, Math.max(2, a)), det: "rms" };
}
/* --- Hàm thuần: khử giá trị không an toàn khi lưu/khôi phục band. --- */
function autoSanitizeBand(b){
  b = b || {};
  /* Pha C 2026-11-05: parseFloat truoc isFinite — isFinite(null)===true keo
     null ve bien kep (freq null -> 20 Hz, q null -> 0,1 thay vi mac dinh
     1000 Hz / 1); chuoi rac da ve mac dinh dung tu truoc. */
  var ff = parseFloat(b.freq), gf = parseFloat(b.gain), qf = parseFloat(b.q);
  var f = isFinite(ff) ? Math.max(20, Math.min(20000, ff)) : 1000;
  var t = (b.type === "lowshelf" || b.type === "highshelf") ? b.type : "peaking";
  var g = isFinite(gf) ? Math.max(-12, Math.min(12, gf)) : 0;
  var q = isFinite(qf) ? Math.max(0.1, Math.min(10, qf)) : 1;
  return { freq: f, type: t, gain: g, q: q, on: b.on !== false };
}
/* --- Tự kiểm mô-đun Auto (chạy trong app + dùng cho hàng QA). --- */
function autoSelfCheck(){
  var checks = [], ok = true, i, j;
  function ck(name, cond, detail){
    checks.push(name + ": " + (cond ? "ĐẠT" : "CHƯA ĐẠT") + " (" + detail + ")");
    if (!cond) ok = false;
  }
  var flat = []; for (i = 0; i < 24; i++) flat.push(0);
  ck("band phẳng", autoPickBandCount(flat) === 10, "phẳng 24 điểm -> 10");
  ck("band phức tạp", autoPickBandCount([0, 5, 0, -5, 0, 5, 0, -5, 0, 5, 0, -5, 0]) === 20, "nhiều đổi chiều + biên 10 dB -> 20");
  var ramp = []; for (j = 0; j < 24; j++) ramp.push(-6 + 12 * j / 23);
  ck("band dốc mượt", autoPickBandCount(ramp) === 10, "dốc tuyến tính −6..6 dB -> 10");
  ck("âm lượng 100%", autoVolToListen(100, 80) === 80, "100% -> 80 phon");
  ck("âm lượng 85%", autoVolToListen(85, 80) === 76, "85% -> 76 phon (80 − 4.5, làm tròn)");
  ck("âm lượng 0%", autoVolToListen(0, 80) === 50, "0% -> 50 phon");
  var dc = autoDynConfig(6);
  ck("dyn tự động", dc.thr === -20 && dc.ratio === 4 && dc.range === -6 && dc.det === "rms", "gain 6 dB -> thr −20, ratio 4, range −6, RMS");
  var sb = autoSanitizeBand({ freq: NaN, type: "bogus", gain: NaN, q: Infinity, on: true });
  ck("khử NaN", sb.freq === 1000 && sb.type === "peaking" && sb.gain === 0 && sb.q === 1, "NaN/Inf -> giá trị an toàn");
  return { ok: ok, detail: checks.join(" · ") };
}

/* --- Đồng bộ UI panel Auto --- */
function autoManualSummary(){
  var parts = [];
  if (AUTO.manual.band) parts.push("số band");
  if (AUTO.manual.pre) parts.push("pre-amp");
  if (AUTO.manual.limiter) parts.push("limiter");
  if (AUTO.manual.loud) parts.push("bù loudness");
  if (AUTO.manual.listen) parts.push("mức nghe");
  var offs = Object.keys(AUTO.manualDynOff).filter(function(k){ return AUTO.manualDynOff[k]; });
  if (offs.length) parts.push("Dynamic EQ tắt ở band " + offs.map(function(k){ return (parseInt(k, 10) + 1); }).join(", "));
  var edits = Object.keys(AUTO.manualDynEdit).filter(function(k){ return AUTO.manualDynEdit[k]; });
  if (edits.length) parts.push("Dynamic EQ chỉnh tay ở band " + edits.map(function(k){ return (parseInt(k, 10) + 1); }).join(", "));
  return parts.length ? parts.join(" · ") : "không có — mọi mục đang tự động";
}
function autoSyncUI(){
  var st = $("autoState");
  if (st) st.textContent = AUTO.on ? "ĐANG BẬT (mặc định)" : "ĐANG TẮT — chỉnh tay hoàn toàn";
  var tg = $("autoToggle");
  if (tg){ tg.textContent = AUTO.on ? "Tắt chế độ tự động" : "Bật chế độ tự động"; tg.classList.toggle("on", AUTO.on); }
  var last = $("autoLast");
  if (last) last.textContent = AUTO.last || "—";
  var bi = $("autoBandInfo");
  if (bi) bi.textContent = bandCount + " band · luật: ≥6 đổi chiều + biên ≥8 dB → 20 band, còn lại 10 band" + (AUTO.manual.band ? " · đang giữ theo chọn tay" : "");
  var mi = $("autoManualInfo");
  if (mi) mi.textContent = autoManualSummary();
}

/* --- (4) Bù loudness theo mức âm lượng hiện tại --- */
function autoApplyLoudnessFromVol(){
  if (!AUTO.on || AUTO.manual.listen) return;
  if (!PSY.loud.on) return;
  var vol = parseInt($("vol").value, 10);
  if (!isFinite(vol)) return;
  var listen = autoVolToListen(vol, PSY.loud.ref);
  if (listen !== PSY.loud.listen){
    PSY.loud.listen = listen;
    syncPsyUI(); applyPsycho();
  }
}

/* --- (5) Cấu hình Dynamic EQ tự động (chỉ chế độ IIR) --- */
function autoApplyDyn(){
  var changed = false;
  for (var i = 0; i < bands.length; i++){
    var b = bands[i];
    if (!b || !b.on) continue;
    if (AUTO.manualDynOff[i]) continue;
    var d = dynCfgFor(i);
    var cfg = autoDynConfig(b.gain);
    if (!d.on && b.gain >= 6){
      /* Band boost lớn (>= +6 dB): tự bật Dynamic EQ để kìm đỉnh khi
         tín hiệu lớn — band boost là nơi Dynamic EQ có ích nhất. */
      d.on = true; d.thr = cfg.thr; d.ratio = cfg.ratio; d.range = cfg.range; d.det = cfg.det;
      changed = true;
    } else if (d.on && !AUTO.manualDynEdit[i] && Math.abs(b.gain) >= 2){
      d.thr = cfg.thr; d.ratio = cfg.ratio; d.range = cfg.range; d.det = cfg.det;
      changed = true;
    }
  }
  if (changed){ refreshDynPanel(); pushConfig(); }
}

/* --- Chu trình tự động chính: chạy khi đổi tai nghe/target --- */
function autoMaybeSolve(reason){
  if (!AUTO.on || AUTO.solving || AUTO.restoring) return;
  var qaBtn = $("btnQaAll");
  if (qaBtn && qaBtn.disabled) return; /* toàn bộ QA đang chạy: không chạm trạng thái QA đang khôi phục */
  if (typeof AE === "undefined" || !AE.points) return;
  var btn = $("btnAutoEq");
  if (!btn || btn.disabled) return;
  AUTO.solving = true;
  try {
    /* Chặng 4 Smart Auto-Pilot v2 (8)(10): khi đổi tai nghe hoặc bật lại chế độ,
       chọn target + crossfeed theo tai nghe mới — KHÔNG chạy khi lý do là đổi
       target tay (người dùng vừa tự chọn target) hay đổi phong cách. */
    if (reason === "tai nghe" || reason === "bật lại chế độ tự động"){
      try {
        var _aeP = (typeof AE_PHONES !== "undefined" && AE.phoneId) ? AE_PHONES[AE.phoneId] : null;
        var _aeType = (_aeP && (_aeP.type || (_aeP.entry && _aeP.entry.type))) || "";
        var _aeRig = (_aeP && (_aeP.rig || (_aeP.entry && _aeP.entry.rig))) || (typeof AE !== "undefined" && AE.rig) || "";
        var _tgt = autoPickTarget({ type: _aeType, rig: _aeRig });
        if ($("aeTarget") && $("aeTarget").value !== _tgt){ $("aeTarget").value = _tgt; aeUpdateTarget(); }
      } catch (e) {}
      try {
        if (!AUTO.manual.cross && typeof PSY !== "undefined" && PSY.cross){
          var _cf = autoPickCrossfeed({ type: (_aeP && (_aeP.type || (_aeP.entry && _aeP.entry.type))) || "" });
          PSY.cross.mix = _cf.mix; PSY.cross.itdMs = _cf.itdMs;
          if (typeof syncPsyUI === "function") syncPsyUI();
          if (typeof pushConfig === "function") pushConfig();
        }
      } catch (e) {}
    }
    /* (3) pre-amp tự động */
    if (!AUTO.manual.pre && preMode !== "auto") $("preAuto").click();
    /* (6) true-peak limiter ở trần −1.0 dBTP */
    if (!AUTO.manual.limiter && !limiterOn) $("btnLimiter").click();
    /* (4) bật bù loudness nếu chưa bật (mức nghe theo âm lượng ở cuối) */
    if (!AUTO.manual.loud && !PSY.loud.on) $("psLoudToggle").click();
    /* (1) chọn số band engine theo độ phức tạp đường correction */
    var err = null;
    if (AE.tgtG && AE.sm && AE.tgtG.length === AE.sm.length){
      err = [];
      for (var i = 0; i < AE.tgtG.length; i++) err.push(AE.tgtG[i] - AE.sm[i]);
    }
    var pick = err ? autoPickBandCount(err) : bandCount;
    var bandTxt;
    if (!AUTO.manual.band && pick !== bandCount){
      setBandCount(pick);
      /* Solver 20 band (v2): engine vừa tự đổi thì đồng bộ luôn số band tối ưu
         theo engine — nếu không, solver vẫn chạy ở số band cũ và engine 20 band
         lại chỉ nhận 10 band rải đều. Chỉ đồng bộ khi engine vừa đổi: người dùng
         đã chọn tay số band solver khác vẫn được giữ ở những lần đổi sau. */
      if ($("aeBands")) $("aeBands").value = String(pick);
      bandTxt = "tự chọn " + pick + " band · solver " + pick + " band";
    }
    else bandTxt = AUTO.manual.band ? ("giữ " + bandCount + " band theo chọn tay") : ("giữ " + bandCount + " band");
    /* (2) chạy solver đúng nút Bước 3 (tái dùng handler, không sao chép logic) */
    /* Best-of B: chỉ khi số band solver hiện tại là 10 và không do chọn tay
       giữ (AUTO.manual.band) — tức 10 band đến từ đường tự động. Khi engine
       vừa tự đổi sang 20 thì aeBands đã đồng bộ 20 nên cờ không đặt. */
    if (!AUTO.manual.band && parseInt($("aeBands").value, 10) === 10) AUTO.bestOfPending = true;
    btn.click();
    if (AE.last && AE.last.bestOf) bandTxt += " · best-of → " + AE.last.bestOf.picked + " band";
    /* (5) Dynamic EQ (chế độ FIR không chạy tầng này) */
    if (mode === "iir") autoApplyDyn();
    /* (4) mức nghe theo âm lượng hiện tại */
    autoApplyLoudnessFromVol();
    /* Chặng 4 Smart Auto-Pilot v2 (9): guard group-delay thấp sau solve — chỉ
       giảm Q các band <= 120 Hz khi gdMaxLow > 5,0 ms; refresh cuối hàm đẩy lại engine. */
    if (mode === "iir"){
      try { autoGuardLowGroupDelay(displayFs || 48000); } catch (e) {}
    }
    refreshDerived(); updateAll(true); drawGraph();
    var rmsB = $("aeRmsB") ? $("aeRmsB").textContent : "—";
    var rmsA = $("aeRmsA") ? $("aeRmsA").textContent : "—";
    var pre = $("aePre") ? $("aePre").textContent : "—";
    AUTO.last = "đổi " + reason + " · " + bandTxt + " · solver RMS " + rmsB + " → " + rmsA + " dB · pre-amp " + pre;
    autoSyncUI();
    try { autoSaveState(); } catch (e) {}
    try { if (typeof shareRefreshIfBuilt === "function") shareRefreshIfBuilt(); } catch (e) {}
  } finally { AUTO.solving = false; }
}

/* --- (7) Lưu trạng thái (localStorage, chỉ trên trình duyệt này) --- */
function autoSaveState(){
  try {
    var snap = { v: 1, savedAt: new Date().toISOString(), autoMode: AUTO.on,
      phoneId: (typeof AE !== "undefined" && AE.phoneId) ? AE.phoneId : "",
      target: $("aeTarget").value,
      tilt: parseFloat($("aeTilt").value), bass: parseFloat($("aeBass").value), ear: parseFloat($("aeEar").value),
      preserveChar: !!$("aePreserveChar").checked,
      aeBands: parseInt($("aeBands").value, 10),
      bandCount: bandCount,
      bands10: BAND_STORE[10].map(autoSanitizeBand), bands20: BAND_STORE[20].map(autoSanitizeBand),
      mode: mode, preMode: preMode, manualPreDb: manualPreDb, extraHeadDb: extraHeadDb, limiterOn: limiterOn,
      vol: parseInt($("vol").value, 10),
      loud: { on: PSY.loud.on, ref: PSY.loud.ref, listen: PSY.loud.listen },
      notch: { on: PSY.notch.on, freq: PSY.notch.freq, depth: PSY.notch.depth, q: PSY.notch.q },
      cross: { on: PSY.cross.on, mix: PSY.cross.mix, itdMs: PSY.cross.itdMs, preset: PSY.cross.preset },
      dyn: JSON.parse(JSON.stringify(PSY.dyn || {})), earRes: (typeof earRes !== "undefined") ? { sweep: earRes.sweep, noise: earRes.noise } : null };
    window.localStorage.setItem("webAutoEq.state.v1", JSON.stringify(snap));
    window.localStorage.setItem("webAutoEq.autoMode.v1", AUTO.on ? "1" : "0");
    var el = $("autoSavedInfo");
    if (el) el.textContent = "đã lưu " + new Date().toLocaleTimeString("vi-VN");
  } catch (e) {}
}

/* --- (7) Khôi phục trạng thái khi mở app (không tự chạy solver đè lên) --- */
function autoApplySnapshot(s){
  var info = $("autoSavedInfo");
  if (!s || s.v !== 1){ if (info) info.textContent = "bản lưu không hợp lệ, bỏ qua"; return false; }
  AUTO.restoring = true;
  try {
    AUTO.on = (s.autoMode !== false);
    var phoneOk = false;
    if (s.phoneId && typeof AE_PHONES !== "undefined" && AE_PHONES[s.phoneId]){ aeSelectPhone(s.phoneId); phoneOk = true; }
    if (s.target && AE_TARGETS[s.target]) $("aeTarget").value = s.target;
    /* Pha C 2026-11-05: ve sinh nhu applyPresetV2 — isFinite(null)===true
       keo null vao input (tilt null -> value "null", aeAdj NaN) va vao bien
       (manualPreDb null -> .toFixed crash, khoi phuc loi; vol null -> gain
       ve 0, cam tieng; loud/notch/cross null nhiem PSY). parseFloat + kep
       theo khoang slider, giu cu khi xau. */
    var stv = parseFloat(s.tilt); if (isFinite(stv)){ $("aeTilt").value = clampN(stv, -1, 1); $("aeTiltOut").textContent = parseFloat($("aeTilt").value).toFixed(2) + " dB/oct"; }
    var sbv = parseFloat(s.bass); if (isFinite(sbv)){ $("aeBass").value = clampN(sbv, -6, 6); $("aeBassOut").textContent = parseFloat($("aeBass").value).toFixed(1) + " dB"; }
    var sev = parseFloat(s.ear); if (isFinite(sev)){ $("aeEar").value = clampN(sev, -4, 4); $("aeEarOut").textContent = parseFloat($("aeEar").value).toFixed(1) + " dB"; }
    if (typeof s.preserveChar === "boolean"){ $("aePreserveChar").checked = s.preserveChar; }
    var sabv = parseInt(s.aeBands, 10); if (isFinite(sabv) && sabv >= 5 && sabv <= 20) $("aeBands").value = String(sabv);
    aeUpdateTarget();
    /* Pha C 2026-11-05: chi nhan mang band DUNG DO DAI (10/20) — truoc day chi
       kiem Array.isArray: ban luu localStorage ban (bands10 3 muc hoac rong)
       lot thang vao BAND_STORE, roi applyPresetV2 dat selBand=5 cung lam
       updateCoeffPanel/refreshDynPanel doc bands[5] undefined -> TypeError,
       preset ap dung that bai, moi updateAll sau do deu nem (lab 1555:
       3 muc -> 2 panel nem TypeError; rong -> selBand=-1 -> nem). Mang
       sai do dai bi bo qua, giu bo band hien tai (nhu moi truong so xau
       khac trong ham nay); link ?waeq= da bat dung do dai tu shareParseBands. */
    if (Array.isArray(s.bands10) && s.bands10.length === 10) BAND_STORE[10] = s.bands10.map(autoSanitizeBand);
    if (Array.isArray(s.bands20) && s.bands20.length === 20) BAND_STORE[20] = s.bands20.map(autoSanitizeBand);
    var bc = (s.bandCount === 20) ? 20 : 10;
    bandCount = bc; bands = BAND_STORE[bc];
    if (selBand >= bands.length) selBand = bands.length - 1;
    buildBandStrips(); syncBandCountUI();
    if (s.mode === "fir" || s.mode === "iir") setMode(s.mode);
    preMode = (s.preMode === "manual") ? "manual" : "auto";
    var smpv = parseFloat(s.manualPreDb); if (isFinite(smpv)) manualPreDb = clampN(smpv, -30, 6);
    var sehv = parseFloat(s.extraHeadDb); if (isFinite(sehv)) extraHeadDb = clampN(sehv, 0, 6);
    $("extraHead").value = extraHeadDb; $("extraOut").textContent = extraHeadDb.toFixed(1) + " dB";
    $("manualPre").value = manualPreDb; $("manualOut").textContent = manualPreDb.toFixed(1) + " dB";
    $("preModeOut").textContent = preMode === "auto" ? "Tự động" : "Thủ công";
    $("preAuto").classList.toggle("on", preMode === "auto");
    $("preManual").classList.toggle("on", preMode === "manual");
    $("manualWrap").style.display = preMode === "manual" ? "block" : "none";
    if (typeof s.limiterOn === "boolean"){
      limiterOn = s.limiterOn;
      $("btnLimiter").textContent = limiterOn ? "Tắt limiter" : "Bật limiter";
      $("kvLimState").textContent = limiterOn ? "Bật" : "Tắt";
    }
    var svv = parseFloat(s.vol);
    if (isFinite(svv)){
      svv = clampN(svv, 0, 100);
      $("vol").value = svv;
      if (typeof masterGain !== "undefined" && masterGain) masterGain.gain.value = svv / 100;
    }
    if (s.loud){
      PSY.loud.on = !!s.loud.on;
      var slrv = parseFloat(s.loud.ref); if (isFinite(slrv)) PSY.loud.ref = clampN(slrv, 40, 90);
      var sllv = parseFloat(s.loud.listen); if (isFinite(sllv)) PSY.loud.listen = clampN(sllv, 20, 90);
    }
    if (s.notch){
      PSY.notch.on = !!s.notch.on;
      var snfv = parseFloat(s.notch.freq); if (isFinite(snfv)) PSY.notch.freq = clampN(snfv, 20, 20000);
      var sndv = parseFloat(s.notch.depth); if (isFinite(sndv)) PSY.notch.depth = clampN(sndv, -8, -3);
      var snqv = parseFloat(s.notch.q); if (isFinite(snqv)) PSY.notch.q = clampN(snqv, 1, 8);
    }
    if (s.earRes && typeof earRes !== "undefined"){
      /* Pha C 2026-11-05: kẹp như mọi trường số khác trong autoApplySnapshot —
         trước đây chỉ parseFloat + isFinite: bản lưu bẩn (sweep/noise 1e9
         hoặc 5 Hz) lọt thẳng vào earRes, rồi nút "Áp dụng notch đã suy
         luận" đặt PSY.notch.freq = trung bình hình học hai đánh dấu
         (1e9 Hz / 5 Hz, ngoài khoảng slider notch [20, 20000]) và lưu bẩn
         ngược lại qua autoSaveState; đường trong app không tạo được giá
         trị này (sweep tone 5500-9500 Hz, notch dò 5500-9500 Hz) nên kẹp
         về đúng dải dò [EAR_FLO, EAR_FHI]; đường âm thanh đã an toàn nhờ
         rbjCoeffs kẹp tần số nên đây là lỗi UX/lưu trữ, lab 1529. */
      var sersv = parseFloat(s.earRes.sweep); if (isFinite(sersv)) earRes.sweep = clampN(Math.round(sersv), EAR_FLO, EAR_FHI);
      var sernv = parseFloat(s.earRes.noise); if (isFinite(sernv)) earRes.noise = clampN(Math.round(sernv), EAR_FLO, EAR_FHI);
      if (typeof earResRefresh === "function") earResRefresh();
    }
    if (s.cross){
      PSY.cross.on = !!s.cross.on;
      var scmv = parseFloat(s.cross.mix); if (isFinite(scmv)) PSY.cross.mix = clampN(scmv, 0, 100);
      var sciv = parseFloat(s.cross.itdMs); if (isFinite(sciv)) PSY.cross.itdMs = clampN(sciv, 0.25, 0.35);
      PSY.cross.preset = s.cross.preset || "custom";
    }
    if (s.dyn && typeof s.dyn === "object"){
      PSY.dyn = s.dyn;
      /* Pha C 2026-11-07: gan lai gia tri tra ve (xem applyPresetV2). */
      Object.keys(PSY.dyn).forEach(function(k){ PSY.dyn[k] = normalizeDynEntry(PSY.dyn[k]); });
    }
    PSY.loud.cur = [0, 0, 0, 0, 0, 0]; PSY.loud.tgt = [0, 0, 0, 0, 0, 0];
    syncPsyUI(); applyPsycho(); refreshDerived(); updateAll(true); drawGraph();
    if (info) info.textContent = "đã khôi phục lúc mở trang" +
      (s.savedAt ? " · bản lưu " + new Date(s.savedAt).toLocaleTimeString("vi-VN") : "") +
      (phoneOk ? "" : " · không tìm thấy tai nghe đã lưu, giữ tai nghe mặc định");
    return true;
  } catch (e) {
    if (info) info.textContent = "khôi phục lỗi: " + e.message;
    return false;
  } finally { AUTO.restoring = false; }
}

/* --- Khôi phục từ localStorage: chỉ là parse + gọi autoApplySnapshot
   (cùng hàm mà link chia sẻ ?waeq= dùng, để hai đường khôi phục không
   lệch nhau; thứ tự ưu tiên do khối khởi tạo quyết định: ?waeq= trước,
   localStorage sau). --- */
function autoRestore(){
  var info = $("autoSavedInfo"), raw = null;
  try { raw = window.localStorage.getItem("webAutoEq.state.v1"); } catch (e) { raw = null; }
  if (!raw){ if (info) info.textContent = "chưa có trạng thái đã lưu"; return false; }
  var s = null;
  try { s = JSON.parse(raw); } catch (e) { if (info) info.textContent = "bản lưu hỏng, bỏ qua"; return false; }
  return autoApplySnapshot(s);
}

/* --- Điểm móc: bọc aeSetMeasurement (tai nghe/file/rig/DB) + target --- */
var _autoOrigAeSetMeasurement = aeSetMeasurement;
aeSetMeasurement = function(pts, name, rig, source){
  var r = _autoOrigAeSetMeasurement(pts, name, rig, source);
  try { autoMaybeSolve("tai nghe"); } catch (e) {}
  return r;
};
$("aeTarget").addEventListener("change", function(){ try { autoMaybeSolve("target"); } catch (e) {} });
$("vol").addEventListener("input", function(){ try { autoApplyLoudnessFromVol(); } catch (e) {} });

/* --- Cờ chỉnh tay: listener chạy SAU handler gốc (đăng ký sau) --- */
$("bc10").addEventListener("click", function(){ AUTO.manual.band = true; autoSyncUI(); });
$("bc20").addEventListener("click", function(){ AUTO.manual.band = true; autoSyncUI(); });
$("preManual").addEventListener("click", function(){ AUTO.manual.pre = true; autoSyncUI(); });
$("preAuto").addEventListener("click", function(){ AUTO.manual.pre = false; autoSyncUI(); });
$("btnLimiter").addEventListener("click", function(){ AUTO.manual.limiter = !limiterOn; autoSyncUI(); });
$("psLoudToggle").addEventListener("click", function(){ AUTO.manual.loud = !PSY.loud.on; autoSyncUI(); });
$("psListen").addEventListener("input", function(){ AUTO.manual.listen = true; autoSyncUI(); });
$("psNight").addEventListener("click", function(){ AUTO.manual.listen = true; autoSyncUI(); });
$("psDynToggle").addEventListener("click", function(){
  var d = dynCfgFor(selBand);
  if (!d.on) AUTO.manualDynOff[selBand] = true; else delete AUTO.manualDynOff[selBand];
  autoSyncUI();
});
["psThr", "psRatio", "psRange"].forEach(function(id){
  $(id).addEventListener("input", function(){ AUTO.manualDynEdit[selBand] = true; autoSyncUI(); });
});
$("psDetSeg").addEventListener("click", function(){ AUTO.manualDynEdit[selBand] = true; autoSyncUI(); });

/* --- Nút bật/tắt chế độ: bật lại = cờ tay mới, chạy tự động ngay --- */
$("autoToggle").addEventListener("click", function(){
  AUTO.on = !AUTO.on;
  if (AUTO.on){
    AUTO.manual = { band: false, pre: false, limiter: false, loud: false, listen: false };
    AUTO.manualDynOff = {}; AUTO.manualDynEdit = {};
  }
  autoSyncUI();
  try { autoSaveState(); } catch (e) {}
  if (AUTO.on){ try { autoMaybeSolve("bật lại chế độ tự động"); } catch (e) {} }
});

/* --- Khởi tạo: khôi phục trạng thái, đồng bộ UI, tự kiểm, lưu khi rời trang --- */
var _waeqDone = false;
try { _waeqDone = waeqApplyFromUrl(); } catch (e) { _waeqDone = false; }
if (!_waeqDone){ try { autoRestore(); } catch (e) {} }
autoSyncUI();
try {
  var _ac = autoSelfCheck();
  $("autoCheck").textContent = _ac.ok ? "ĐẠT — " + _ac.detail : "CHƯA ĐẠT — " + _ac.detail;
} catch (e) { $("autoCheck").textContent = "lỗi tự kiểm: " + e.message; }
window.addEventListener("beforeunload", function(){ try { autoSaveState(); } catch (e) {} });
document.addEventListener("visibilitychange", function(){ if (document.hidden){ try { autoSaveState(); } catch (e) {} } });

/* ================================================================
   Liều nghe trong tuần (Weekly Listening Dose) — hạng mục Idea do
   người dùng duyệt 2026-10-28, sửa trực tiếp ngoài vòng lặp giờ
   (tiền lệ: sửa thanh list bar 2026-10-26 17:24).
   Mô hình: liều % = Σ giờ(L) × 2^((L−80)/3) ÷ 40 giờ × 100 — mốc
   tuần 80 dB / 40 giờ, hệ số trao đổi 3 dB. Mức L CHỈ lấy từ ước
   lượng mức nghe theo thanh âm lượng (autoVolToListen — cùng tín
   hiệu mức phát mà Chế độ Tự Động dùng cho loudness), KHÔNG phải
   SPL đo thật; app KHÔNG ghi lại nội dung âm thanh, chỉ cộng mức
   ước lượng × thời gian đang phát thật (isPlaying).
   ================================================================ */
function doseWeekKey(d){
  if (!(d instanceof Date) || !isFinite(d.getTime())) d = new Date();
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  var firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  var fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  var week = 1 + Math.round((t.getTime() - firstThu.getTime()) / 6048e5);
  return t.getUTCFullYear() + "-W" + (week < 10 ? "0" : "") + week;
}
function doseRatePerHour(levelDb){
  if (!isFinite(levelDb)) return 0;
  return Math.pow(2, (levelDb - 80) / 3) / 40 * 100;
}
function doseAdd(pct, levelDb, hours){
  /* Pha C 2026-11-05: parseFloat truoc isFinite nhu doseResolveWeek —
     chuoi "50" qua isFinite roi noi chuoi o phep + (thanh "502.5"). */
  pct = parseFloat(pct);
  if (!isFinite(pct) || pct < 0) pct = 0;
  if (!isFinite(hours) || hours <= 0) return pct;
  return pct + doseRatePerHour(levelDb) * hours;
}
function doseTrimDb(pct){
  if (!isFinite(pct) || pct < 80) return 0;
  if (pct >= 100) return -3;
  return -3 * (pct - 80) / 20;
}
function doseEaseState(pct, override){
  if (override) return { trimDb: 0, override: true };
  return { trimDb: doseTrimDb(pct), override: false };
}
function doseResolveWeek(storedKey, storedPct, nowKey){
  if (storedKey !== nowKey) return { key: nowKey, pct: 0, reset: true };
  /* Pha C 2026-11-05: parseFloat truoc isFinite — isFinite("50")===true va
     isFinite(true)===true de chuoi/boolean lot qua, DOSE.pct thanh chuoi
     roi doseSyncUI() nem TypeError o .toFixed(1) (goi tran cuoi script,
     setInterval doseTick o dong sau khong bao gio duoc cai, dong ho lieu
     chet ca phien); doseAdd() cung noi chuoi thay vi cong so. */
  var p = parseFloat(storedPct);
  return { key: nowKey, pct: (isFinite(p) && p > 0) ? p : 0, reset: false };
}
function doseSelfCheck(){
  var ck = [];
  function eq(name, got, want){ ck.push({ name: name, ok: Math.abs(got - want) < 1e-9, got: got, want: want }); }
  eq("40 giờ @ 80 dB", doseAdd(0, 80, 40), 100);
  eq("20 giờ @ 83 dB", doseAdd(0, 83, 20), 100);
  eq("10 giờ @ 77 dB", doseAdd(0, 77, 10), 12.5);
  eq("giảm nhẹ ở 50%", doseTrimDb(50), 0);
  eq("giảm nhẹ ở 80%", doseTrimDb(80), 0);
  eq("giảm nhẹ ở 90%", doseTrimDb(90), -1.5);
  eq("giảm nhẹ ở 100%", doseTrimDb(100), -3);
  eq("giảm nhẹ ở 150% (kẹp)", doseTrimDb(150), -3);
  var es1 = doseEaseState(95, false), es2 = doseEaseState(95, true);
  ck.push({ name: "không ghi đè @95%", ok: Math.abs(es1.trimDb - (-2.25)) < 1e-9 && es1.override === false, got: es1.trimDb, want: -2.25 });
  ck.push({ name: "ghi đè tay @95% -> trim 0", ok: es2.trimDb === 0 && es2.override === true, got: es2.trimDb, want: 0 });
  ck.push({ name: "tuần ISO 2026-01-01", ok: doseWeekKey(new Date(2026, 0, 1)) === "2026-W01", got: doseWeekKey(new Date(2026, 0, 1)), want: "2026-W01" });
  ck.push({ name: "tuần ISO 2025-12-29", ok: doseWeekKey(new Date(2025, 11, 29)) === "2026-W01", got: doseWeekKey(new Date(2025, 11, 29)), want: "2026-W01" });
  var rw = doseResolveWeek("2026-W43", 55, "2026-W44"), rw2 = doseResolveWeek("2026-W44", 55, "2026-W44");
  ck.push({ name: "đổi tuần -> liều về 0", ok: rw.reset === true && rw.pct === 0, got: rw.pct, want: 0 });
  ck.push({ name: "cùng tuần -> giữ liều", ok: rw2.reset === false && rw2.pct === 55, got: rw2.pct, want: 55 });
  var rw3 = doseResolveWeek("2026-W44", "50", "2026-W44"), rw4 = doseResolveWeek("2026-W44", true, "2026-W44");
  ck.push({ name: "chuỗi \"50\" -> số 50", ok: rw3.reset === false && rw3.pct === 50 && typeof rw3.pct === "number", got: rw3.pct, want: 50 });
  ck.push({ name: "boolean true -> 0", ok: rw4.reset === false && rw4.pct === 0, got: rw4.pct, want: 0 });
  var bad = doseAdd(0, NaN, 5) + doseAdd(0, 80, -2) + doseTrimDb(NaN);
  ck.push({ name: "NaN/giờ âm -> an toàn", ok: isFinite(bad) && bad === 0, got: bad, want: 0 });
  var okAll = ck.every(function(c){ return c.ok; });
  return { ok: okAll, detail: ck.map(function(c){ return c.name + ": " + (typeof c.got === "number" ? (+c.got.toFixed(4)) : c.got) + (c.ok ? "" : " (muốn " + c.want + ")"); }).join(" · ") };
}
var DOSE = { on: true, pct: 0, key: "", override: false, trimDb: 0, sim: null, saveMark: -1 };
var DOSE_STORE_KEY = "webAutoEq.dose.v1";
function doseCurrentLevel(){
  var vol = 85;
  try { vol = parseInt($("vol").value, 10); } catch (e) {}
  if (!isFinite(vol)) vol = 85;
  var ref = 80;
  try { if (typeof PSY !== "undefined" && PSY.loud && isFinite(PSY.loud.ref)) ref = PSY.loud.ref; } catch (e) {}
  return autoVolToListen(vol, ref);
}
function doseSave(){
  try {
    localStorage.setItem(DOSE_STORE_KEY, JSON.stringify({ key: DOSE.key, pct: Math.round(DOSE.pct * 1000) / 1000, on: DOSE.on, override: DOSE.override }));
  } catch (e) {}
}
function doseLoad(){
  var nowKey = doseWeekKey(new Date());
  var st = null;
  try { st = JSON.parse(localStorage.getItem(DOSE_STORE_KEY) || "null"); } catch (e) { st = null; }
  DOSE.key = nowKey; DOSE.pct = 0;
  if (st){
    var r = doseResolveWeek(st.key, st.pct, nowKey);
    DOSE.key = r.key; DOSE.pct = r.pct;
    DOSE.override = r.reset ? false : !!st.override;
    if (typeof st.on === "boolean") DOSE.on = st.on;
  }
}
function doseApplyGain(){
  try {
    if (typeof masterGain === "undefined" || !masterGain) return;
    var vol = parseInt($("vol").value, 10); if (!isFinite(vol)) vol = 85;
    masterGain.gain.value = (vol / 100) * Math.pow(10, (DOSE.trimDb || 0) / 20);
  } catch (e) {}
}
function doseSyncUI(){
  var st = $("doseState");
  if (st) st.textContent = !DOSE.on ? "ĐANG TẮT" : DOSE.override ? "GHI ĐÈ THỦ CÔNG" : (DOSE.trimDb < 0 ? "ĐANG GIẢM NHẸ " + DOSE.trimDb.toFixed(1) + " dB" : "ĐANG BẬT (mặc định)");
  var tg = $("doseToggle");
  if (tg){ tg.textContent = DOSE.on ? "Tắt đồng hồ liều" : "Bật đồng hồ liều"; tg.classList.toggle("on", DOSE.on); }
  var fig = $("doseFigure");
  if (fig) fig.textContent = DOSE.pct.toFixed(1) + " % của mốc tuần (tương đương " + (DOSE.pct / 100 * 40).toFixed(1) + " giờ ở 80 dB)";
  var bar = $("doseBar");
  if (bar) bar.style.width = Math.max(0, Math.min(100, DOSE.pct)) + "%";
  var lv = $("doseLevel");
  if (lv) lv.textContent = doseCurrentLevel() + " dB (phon ước lượng từ thanh âm lượng — không phải SPL đo thật)";
  var tr = $("doseTrim");
  if (tr) tr.textContent = !DOSE.on ? "đồng hồ đang tắt — không giảm nhẹ" : DOSE.override ? "đang GHI ĐÈ THỦ CÔNG — giảm nhẹ đã huỷ ngay khi bạn chỉnh âm lượng, mức của bạn được giữ nguyên" : (DOSE.trimDb < 0 ? "đang giảm nhẹ " + DOSE.trimDb.toFixed(2) + " dB qua master gain — phát vẫn tiếp tục, không bao giờ dừng phát" : "chưa giảm — liều dưới 80% mốc tuần");
  var wk = $("doseWeek");
  if (wk) wk.textContent = "Tuần ISO " + DOSE.key + " · lưu localStorage ở máy này · tự về 0 khi sang tuần mới";
}
function doseTick(){
  var nowKey = doseWeekKey(new Date());
  if (nowKey !== DOSE.key){
    var r = doseResolveWeek(DOSE.key, DOSE.pct, nowKey);
    DOSE.key = r.key; DOSE.pct = r.pct; if (r.reset) DOSE.override = false;
  }
  var playing = false;
  try { playing = (typeof isPlaying === "function") && !!isPlaying() && (typeof AC === "undefined" || !AC || AC.state === "running"); } catch (e) { playing = false; }
  if (DOSE.on && playing) DOSE.pct = doseAdd(DOSE.pct, doseCurrentLevel(), 1 / 3600);
  var newTrim = DOSE.on ? doseEaseState(DOSE.pct, DOSE.override).trimDb : 0;
  if (newTrim !== DOSE.trimDb){ DOSE.trimDb = newTrim; doseApplyGain(); }
  doseSyncUI();
  var mark = Math.floor(DOSE.pct * 20);
  if (mark !== DOSE.saveMark){ DOSE.saveMark = mark; doseSave(); }
}
function doseSimRender(){
  var info = $("doseSimInfo");
  if (!info) return;
  if (!DOSE.sim){ info.textContent = "chưa chạy — xem trước chỉ mô phỏng bằng số, không phát tiếng và không tính là nghe thật"; return; }
  var s = DOSE.sim;
  info.textContent = "MÔ PHỎNG (không phải nghe thật): bắt đầu từ liều thật " + s.fromPct.toFixed(1) + "% · cộng " + s.hours + " giờ ở " + s.level + " dB -> liều mô phỏng " + s.pct.toFixed(1) + "% của mốc tuần · giảm nhẹ mô phỏng: " + (s.override ? "0 dB — ĐÃ GHI ĐÈ THỦ CÔNG, mức mô phỏng giữ nguyên dù liều trên 80%" : (s.trimDb.toFixed(2) + " dB" + (s.trimDb < 0 ? " (giảm nhẹ đã kích hoạt vì liều tới gần mốc)" : " (chưa tới 80% mốc nên chưa giảm)")));
}
function doseSimRun(){
  var level = parseFloat($("doseSimLevel").value), hours = parseFloat($("doseSimHours").value);
  if (!isFinite(level)) level = 83;
  if (!isFinite(hours) || hours < 0) hours = 0;
  var pct = doseAdd(DOSE.pct, level, hours);
  DOSE.sim = { fromPct: DOSE.pct, level: level, hours: hours, pct: pct, override: false, trimDb: doseTrimDb(pct) };
  doseSimRender();
}
function doseSimManual(){
  if (!DOSE.sim) doseSimRun();
  if (DOSE.sim){ DOSE.sim.override = true; DOSE.sim.trimDb = 0; }
  doseSimRender();
}
try {
  doseLoad();
  var _dc = doseSelfCheck();
  if ($("doseCheck")) $("doseCheck").textContent = _dc.ok ? "ĐẠT — " + _dc.detail : "CHƯA ĐẠT — " + _dc.detail;
} catch (e) { if ($("doseCheck")) $("doseCheck").textContent = "lỗi tự kiểm: " + e.message; }
if ($("doseToggle")) $("doseToggle").addEventListener("click", function(){ DOSE.on = !DOSE.on; if (!DOSE.on){ DOSE.trimDb = 0; doseApplyGain(); } doseSave(); doseSyncUI(); });
if ($("doseReenable")) $("doseReenable").addEventListener("click", function(){ DOSE.override = false; DOSE.trimDb = DOSE.on ? doseEaseState(DOSE.pct, false).trimDb : 0; doseApplyGain(); doseSave(); doseSyncUI(); });
if ($("doseResetWeek")) $("doseResetWeek").addEventListener("click", function(){ DOSE.pct = 0; DOSE.key = doseWeekKey(new Date()); DOSE.override = false; DOSE.trimDb = 0; doseApplyGain(); doseSave(); doseSyncUI(); });
if ($("doseSimRun")) $("doseSimRun").addEventListener("click", doseSimRun);
if ($("doseSimManual")) $("doseSimManual").addEventListener("click", doseSimManual);
if ($("doseSimReset")) $("doseSimReset").addEventListener("click", function(){ DOSE.sim = null; doseSimRender(); });
if ($("doseSimLevel")) $("doseSimLevel").addEventListener("input", function(){ if ($("doseSimLevelVal")) $("doseSimLevelVal").textContent = this.value; });
if ($("doseSimHours")) $("doseSimHours").addEventListener("input", function(){ if ($("doseSimHoursVal")) $("doseSimHoursVal").textContent = this.value; });
if ($("vol")) $("vol").addEventListener("input", function(e){
  if (!e.isTrusted) return;
  DOSE.override = true; DOSE.trimDb = 0; doseSave(); doseSyncUI();
});
doseSyncUI();
setInterval(function(){ try { doseTick(); } catch (e) {} }, 1000);
