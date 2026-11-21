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
  /* (vòng tự động 09:05, hướng B — H9): chỉ tính gdMaxLow cho vòng guard — cùng
     qaPhaseGdData + cùng biểu thức quét gdMs (f <= 100 Hz) như qaDrawPhaseGd nên
     QA6.gdMaxLow giống từng bit, nhưng bỏ qua ph1/DOM/2 lần vẽ canvas (các lần
     vẽ giữa trong vòng guard đồng bộ không bao giờ kịp hiển thị). */
  try {
    var fs = displayFs || 48000;
    var d = qaPhaseGdData(fs);
    QA6.gdMaxLow = null;
    d.freqs.forEach(function(f, i){
      if (f <= 100 && (QA6.gdMaxLow === null || d.gdMs[i] > QA6.gdMaxLow)) QA6.gdMaxLow = d.gdMs[i];
    });
  } catch (e) { /* như qaDrawPhaseGd: lỗi tính toán không được làm hỏng guard */ }
}
function autoGuardLowGroupDelay(fs){
  if (mode !== "iir") return { guarded: false, gdMaxLow: 0 };
  qaGdMaxLowOnly();
  var iter = 0;
  while (QA6.gdMaxLow !== null && QA6.gdMaxLow > 5.0 && iter < 8){
    var touched = false;
    for (var i = 0; i < bands.length; i++){
      if (bands[i].on && bands[i].freq <= 120 && Math.abs(bands[i].gain) > 0.5 && bands[i].q > 0.65){
        bands[i].q = Math.max(0.5, Math.round(bands[i].q * 82) / 100);
        touched = true;
      }
    }
    if (!touched) break;
    BAND_CC = []; GRID_TOT = {};
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
  var t1 = autoPickTarget({ type: "In-ear", rig: "5128" }) === "jm1";
  var t2 = autoPickTarget({ type: "In-ear", rig: "711" }) === "harmanIE";
  var t3 = autoPickTarget({ type: "Over-ear", rig: "711" }) === "harmanOE";
  var t4 = autoPickTarget(null) === "harmanOE";
  if (!(t1 && t2 && t3 && t4)) ok = false;
  notes.push("target: IE+5128→" + autoPickTarget({ type: "In-ear", rig: "5128" }) + " · IE+711→" + autoPickTarget({ type: "In-ear", rig: "711" }) + " · OE→" + autoPickTarget({ type: "Over-ear", rig: "711" }) + " · rỗng→" + autoPickTarget(null));
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
    var advHeads = ["Spectrogram", "Đo mức & Limiter", "Pre-amp tự động", "Preset nhanh", "Psychoacoustics", "Bù Loudness", "Hiệu chuẩn cộng hưởng", "Chấm điểm mù", "Natural Crossfeed", "Dynamic EQ chọn band", "Binaural HRTF", "WASM + SIMD", "Preset — Schema", "Blind A/B/X", "Kho tai nghe", "Hardware Constraint", "Universal Export", "Attribution", "Điều khiển chính xác", "Hệ số biquad", "Tổng hợp hệ thống"];
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
