/* Web AutoEQ split module: 12-dock-layout.js (nguon: khoi script L24964 cua ban 1 file) */

/* ================================================================
   BỐ CỤC CẠNH ĐỒ THỊ (yêu cầu người dùng 2026-10-31):
   Mọi thứ làm thay đổi các đường trên đồ thị được đưa về NGAY CẠNH
   đồ thị để khi chỉnh là thấy đường cong đổi ngay:
   - Đồ thị chính (.graphbox + chú thích) được nhấc lên đầu cột giữa
     và GHIM (position: sticky) khi ở gần đầu trang.
   - Khi cuộn xuống sâu, đồ thị TỰ ĐỘNG chuyển sang THANH BÊN TRÁI —
     vùng đen trống ở mép trái màn hình rộng (position: fixed) — để
     không che nội dung ở giữa nữa. Trên màn hẹp (khoảng trống bên lề
     < 280px) đồ thị vẫn dock sang trái nhưng ở CHẾ ĐỘ NỔI — đè lên mép
     trái trang, nền đục, rộng ~320-360px — để dùng được ở zoom 100% mà
     không cần thu nhỏ trang (yêu cầu người dùng 2026-11-08). Thanh bên có nút Tắt (✕) để ẩn
     đồ thị và một nút "Hiện đồ thị" nhỏ để mở lại; cuộn về gần đầu
     trang thì đồ thị tự trở về vị trí ghim ở cột giữa.
   - Panel AutoEQ, Quick EQ Bar và cả 6 panel Nâng cấp 1-6 được dời
     vào cột giữa, xếp ngay dưới đồ thị theo thứ tự.
   - Cột phải giữ nguyên: thẻ band, Điều khiển chính xác, Đo mức và
     Pre-amp — vốn đã nằm sát đồ thị ở phía bên phải.
   Chỉ dời nút DOM (giữ nguyên id, sự kiện, trạng thái).
   ================================================================ */
(function(){
"use strict";
function panelByHeading(txt){
  var hs = document.querySelectorAll("h2"), i;
  for (i = 0; i < hs.length; i++)
    if (hs[i].textContent.indexOf(txt) >= 0) return hs[i].closest(".panel");
  return null;
}
try {
  var center = document.querySelector(".st-center");
  var graph = document.getElementById("graph");
  if (!center || !graph) return;
  var graphPanel = graph.closest(".panel");
  var graphbox = graph.closest(".graphbox") || graph.parentElement;
  var legend = graphPanel ? graphPanel.querySelector(":scope > .legend") : null;

  /* --- Thanh ghim đồ thị ở đầu cột giữa --- */
  var wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.id = "graphPinWrap";
  var head = document.createElement("div");
  head.id = "graphPinHead";
  head.innerHTML = "<span class=\"gpt\">ĐỒ THỊ TỔNG — GHIM KHI CUỘN</span>"
    + "<label><input type=\"checkbox\" id=\"graphPinToggle\" checked> Ghim đồ thị</label>";
  wrap.appendChild(head);
  if (graphbox) wrap.appendChild(graphbox);
  if (legend) wrap.appendChild(legend);
  var note = document.createElement("div");
  note.id = "graphPinNote";
  note.textContent = "Đồ thị đang hiển thị ở thanh bên trái — cuộn về đầu cột này để đồ thị trở về đây.";
  wrap.appendChild(note);
  center.insertBefore(wrap, center.firstChild);
  var tg = document.getElementById("graphPinToggle");
  if (tg) tg.addEventListener("change", function(){
    /* Khi do thi da sang dock, placeholder chi la khung rong giu chieu cao trang:
       khong cho dinh lai ke ca khi tick "Ghim", neu khong khung rong ~462px dinh
       o dau cot giua se che nut di qua dai do (vd #btnDemo bi che o scrollY
       ~10.400-10.900, do rong ~490px, do trinh duyet 19:37-20:00 ngay 07/11/2026). */
    wrap.style.position = (tg.checked && !docked) ? "sticky" : "static";
  });

  /* --- Dời các panel điều khiển vào cột giữa, ngay dưới panel đồ thị --- */
  var anchor = graphPanel;
  function moveAfter(el){
    if (!el || el === anchor) return;
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
    anchor = el;
  }
  moveAfter(panelByHeading("Quick EQ Bar"));
  moveAfter(document.getElementById("aePanel"));
  ["Nâng cấp 1", "Nâng cấp 2", "Nâng cấp 3", "Nâng cấp 4", "Nâng cấp 5", "Nâng cấp 6"].forEach(function(h){
    moveAfter(panelByHeading(h));
  });
  /* Nguồn phát + Dynamic EQ cũng về cột giữa (yêu cầu người dùng): hai panel này
     vốn nằm full-width ở mép trái trang nên bị thanh đồ thị bên trái che mất khi cuộn */
  moveAfter(document.getElementById("tpPanel"));
  /* Ba mô-đun Psychoacoustics còn lại (Loudness, notch cộng hưởng ống tai,
     Crossfeed) cũng về cột giữa cạnh đồ thị như Dynamic EQ — chúng đều làm
     thay đổi đáp tuyến/nghe trực tiếp và trước đây nằm full-width ở mép trái
     nên bị thanh đồ thị bên trái che khi cuộn. */
  moveAfter(panelByHeading("Bù Loudness ISO 226"));
  moveAfter(panelByHeading("Hiệu chuẩn cộng hưởng ống tai"));
  moveAfter(panelByHeading("Natural Crossfeed"));
  (function(){
    var hs = document.querySelectorAll("h2"), i, p = null;
    for (i = 0; i < hs.length; i++) {
      if (hs[i].textContent.indexOf("Dynamic EQ") >= 0) {
        var cand = hs[i].closest(".panel");
        if (cand && cand.textContent.indexOf("Threshold detector") >= 0) { p = cand; break; }
      }
    }
    moveAfter(p);
  })();

  /* --- Khôi phục 2026-11-10 (yêu cầu người dùng): tay nắm kéo đổi kích thước dock + chế độ nổi màn hẹp, đúng code bản Drive 08/11 — tính năng này bị mất khi file làm việc đổi sang bản local fsrate. */
  /* --- Thanh đồ thị bên trái (dock) cho vùng đen mép màn hình --- */
  var dock = document.createElement("div");
  dock.className = "panel";
  dock.id = "graphDock";
  dock.innerHTML = "<div id=\"graphDockHead\"><span class=\"gpt\">ĐỒ THỊ TỔNG</span>"
    + "<button type=\"button\" id=\"graphDockHide\" title=\"Ẩn đồ thị\">✕ Tắt</button></div>"
    + "<div id=\"graphDockBody\"></div>"
    + "<div id=\"graphDockResize\" title=\"Kéo để đổi kích thước — nhấp đúp để về mặc định\"></div>";
  document.body.appendChild(dock);
  var dockBody = dock.querySelector("#graphDockBody");
  var dockHead = dock.querySelector("#graphDockHead");
  var showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.id = "graphDockShow";
  showBtn.textContent = "📈 Hiện đồ thị";
  document.body.appendChild(showBtn);

  var docked = false, manualHide = false, homeH = 0, overlayMode = false;
  /* --- Kích thước dock tùy chỉnh: kéo góc dưới-phải (yêu cầu người dùng 2026-11-08).
     Chưa kéo: hành vi Y HỆT như cũ (công thức dockWidth/dockHeight mặc định).
     Đã kéo: rộng/cao do người dùng chọn, lưu localStorage, khôi phục khi tải trang. */
  var DOCK_SIZE_KEY = "webAutoEq.dockSize.v1";
  var DOCK_MIN_W = 260, DOCK_MAX_W = 720, DOCK_MIN_H = 260;
  function clampDockSize(w, h){
    var maxW = Math.max(DOCK_MIN_W, Math.min(DOCK_MAX_W, window.innerWidth - 40));
    var maxH = Math.max(DOCK_MIN_H, window.innerHeight - 140);
    return { w: Math.max(DOCK_MIN_W, Math.min(maxW, Math.round(w))),
             h: Math.max(DOCK_MIN_H, Math.min(maxH, Math.round(h))) };
  }
  var dockCustom = null;
  try {
    var _ds = JSON.parse(window.localStorage.getItem(DOCK_SIZE_KEY) || "null");
    if (_ds && isFinite(_ds.w) && isFinite(_ds.h)) dockCustom = clampDockSize(_ds.w, _ds.h);
  } catch (e) {}
  function saveDockSize(){
    try { window.localStorage.setItem(DOCK_SIZE_KEY, JSON.stringify(dockCustom)); } catch (e) {}
  }
  function dockHeight(){
    /* Chưa kéo: chiều cao theo nội dung như cũ (canvas 320px + legend).
       Đã kéo: chiều cao người dùng đã chọn, clamp theo viewport hiện tại. */
    if (!dockCustom) return null;
    return clampDockSize(dockCustom.w, dockCustom.h).h;
  }
  function fitCanvasHeight(){
    /* Canvas #graph có height CSS cố định 320px. Khi dock đã kéo cao thì
       cho canvas cao theo phần thân dock còn lại (trừ đầu dock, legend và
       padding/border), để đồ thị to ra thật chứ không chỉ khung. Khi chưa
       kéo hoặc đã về nhà thì bỏ height inline, canvas về lại 320px CSS.
       Công thức: clientHeight(dock) - padding(20) - đầu dock - margin
       dưới đầu(6) - legend - margin trên legend(9) - border graphbox(2). */
    if (!docked || !dockCustom) { graph.style.height = ""; return; }
    if (!dock.offsetHeight) return; /* đang ẩn (manualHide): để nguyên, lúc hiện sẽ tính lại */
    var legH = legend ? legend.offsetHeight : 0;
    var ch = dock.clientHeight - (dockHead ? dockHead.offsetHeight : 0) - legH - 37;
    ch = Math.max(200, Math.min(ch, window.innerHeight - 200));
    graph.style.height = ch + "px";
  }
  function refreshCanvasSize(){
    /* Bỏ cache kích thước canvas (CV_SIZE) để lần vẽ tới đo lại đúng kích
       thước hiện tại. Cần vì ResizeObserver cập nhật cache bất đồng bộ: khi
       dock vừa hiện/kéo đổi cỡ mà vẽ ngay thì drawGraph có thể dùng cache cũ
       (canvas 0×0 sau khi hiện lại, hoặc cỡ cũ sau khi đổi cỡ). */
    try { if (typeof CV_SIZE !== "undefined" && CV_SIZE && CV_SIZE.delete) CV_SIZE.delete(graph); } catch (e) {}
  }
  function positionGrip(){
    /* Tay nắm bám góc dưới-phải của dock. Dock cuộn được khi nội dung tràn
       (chiều cao tối thiểu) nên tay nắm phải fixed — không cuộn theo nội dung. */
    if (!grip) return;
    var r = dock.getBoundingClientRect();
    if (!r.width) return;
    grip.style.left = (r.left + r.width - 22) + "px";
    grip.style.top = (r.top + r.height - 22) + "px";
  }
  function applyDockSize(){
    refreshCanvasSize();
    dock.style.width = dockWidth() + "px";
    var dh = dockHeight();
    dock.style.height = dh ? dh + "px" : "";
    fitCanvasHeight();
    positionGrip();
  }
  function leftSpace(){
    /* Vùng đen trống bên trái trang = mép trái màn hình tới mép trái .wrap.
       Đo theo .wrap, KHÔNG theo cột giữa: các panel toàn chiều rộng như
       Blind A/B/X và Chấm điểm mù nằm ngoài lưới 3 cột nên mép trái của
       chúng là mép .wrap — đo theo cột giữa làm dock rộng quá (mép phải
       tới 570px ở viewport 1919) và che nút khi cuộn. Đo trực tiếp nên
       đúng cả khi trình duyệt phóng to. */
    var pageWrap = document.querySelector(".wrap");
    return pageWrap ? pageWrap.getBoundingClientRect().left : center.getBoundingClientRect().left;
  }
  function dockWidth(){
    /* Đã kéo: rộng do người dùng chọn (clamp theo viewport). Ở chế độ lề,
       rộng tùy chỉnh có thể vượt quá vùng lề — chấp nhận được vì người dùng
       chủ động kéo và nền dock đục. Chưa kéo: công thức mặc định như cũ. */
    if (dockCustom) return clampDockSize(dockCustom.w, dockCustom.h).w;
    /* Màn rộng: rộng theo khoảng trống bên lề như cũ. Màn hẹp
       (leftSpace < 280): rộng cố định ~320-360px, không vượt quá bề
       rộng cửa sổ trừ 20px. Dock có class "panel" nên nền là var(--panel)
       #14181e — đục hoàn toàn, chữ bên dưới không lộ qua khi đè lên trang. */
    var ls = leftSpace();
    return (ls < 280)
      ? Math.max(260, Math.min(360, window.innerWidth - 20))
      : Math.max(260, Math.min(560, ls - 20));
  }
  function redraw(){
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(function(){ try { if (typeof updateAll === "function") updateAll(true); } catch (e) {} });
  }
  function toDock(){
    homeH = wrap.offsetHeight;
    wrap.style.minHeight = homeH + "px"; /* giữ nguyên chiều cao trang, tránh nhảy cuộn */
    /* Bo sticky cua placeholder khi docked: khung rong chi giu cho trong luong nen
       cuon khoi viewport nhu phan tu thuong, khong dinh o dau cot giua che nut.
       Bo cuc khong doi (sticky chi dich vi tri hien thi), trang khong nhay cuon. */
    wrap.style.position = "static";
    note.style.display = "block";
    if (graphbox) dockBody.appendChild(graphbox);
    if (legend) dockBody.appendChild(legend);
    docked = true;
    overlayMode = leftSpace() < 280;
    dock.style.display = manualHide ? "none" : "block";
    showBtn.style.display = manualHide ? "block" : "none";
    applyDockSize();
    redraw();
  }
  function toHome(){
    wrap.style.minHeight = "";
    wrap.style.position = (tg && tg.checked) ? "sticky" : "static";
    note.style.display = "none";
    if (graphbox) wrap.appendChild(graphbox);
    if (legend) wrap.appendChild(legend);
    dock.style.display = "none";
    showBtn.style.display = "none";
    docked = false;
    fitCanvasHeight();
    redraw();
  }
  dock.querySelector("#graphDockHide").addEventListener("click", function(){
    manualHide = true;
    dock.style.display = "none";
    showBtn.style.display = "block";
  });
  showBtn.addEventListener("click", function(){
    manualHide = false;
    dock.style.display = "block";
    showBtn.style.display = "none";
    applyDockSize();
    redraw();
  });
  /* --- Tay nắm kéo đổi kích thước dock (góc dưới-phải) --- */
  var grip = dock.querySelector("#graphDockResize");
  var dragRaf = 0;
  function dragRedraw(){
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(function(){ dragRaf = 0; redraw(); });
  }
  /* Nhấp đúp tay nắm = về mặc định. Sự kiện dblclick gốc của trình duyệt
     nhạy với khoảng cách giữa 2 lần bấm: trong môi trường QA, 2 lần bấm
     cách 335 ms đã KHÔNG sinh ra dblclick (lab tái hiện: chỉ có
     pointerdown/up + click, không có dblclick) nên handler reset không bao
     giờ chạy. Vì vậy tự đếm lần bấm trong pointerup: 2 lần bấm không kéo
     trong 500 ms thì coi là nhấp đúp, không phụ thuộc dblclick gốc nữa. */
  var gripLastUp = 0;
  function resetDockSize(){
    dockCustom = null;
    try { window.localStorage.removeItem(DOCK_SIZE_KEY); } catch (e) {}
    applyDockSize();
    redraw();
  }
  if (grip) grip.addEventListener("pointerdown", function(ev){
    if (!docked) return;
    ev.preventDefault(); ev.stopPropagation();
    try { if (grip.setPointerCapture) grip.setPointerCapture(ev.pointerId); } catch (e) {}
    var startX = ev.clientX, startY = ev.clientY;
    var startW = dock.offsetWidth, startH = dock.offsetHeight;
    var moved = false;
    function onMove(e){
      if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) moved = true;
      dockCustom = clampDockSize(startW + (e.clientX - startX), startH + (e.clientY - startY));
      applyDockSize();
      dragRedraw();
    }
    function onUp(e){
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      saveDockSize();
      redraw();
      if (e && e.type === "pointercancel") { gripLastUp = 0; return; }
      var now = Date.now();
      if (!moved && gripLastUp && (now - gripLastUp) < 500) { gripLastUp = 0; resetDockSize(); }
      else if (!moved) { gripLastUp = now; }
      else { gripLastUp = 0; }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
  if (grip) grip.addEventListener("dblclick", function(ev){
    /* Nhấp đúp tay nắm: về kích thước mặc định, xóa kích thước đã lưu.
       Giữ lại làm dự phòng cho trình duyệt sinh dblclick nhanh; trường hợp
       dblclick gốc không sinh (bấm chậm) thì pointerup ở trên đã xử lý. */
    ev.preventDefault(); ev.stopPropagation();
    resetDockSize();
  });
  var ticking = false, homeTopCache = null;
  function currentHomeTop(){
    var r = wrap.getBoundingClientRect();
    /* Khi thanh ghim đang dính (sticky), rect.top luôn = 8 và không còn là vị trí gốc —
       chỉ cập nhật mốc khi trang ở gần đầu (thanh chưa dính) */
    if (window.pageYOffset < 50 || r.top > 9) homeTopCache = r.top + window.pageYOffset;
    return homeTopCache !== null ? homeTopCache : r.top + window.pageYOffset;
  }
  function evaluate(){
    ticking = false;
    /* Màn hẹp (leftSpace < 280): dock NỔI đè lên mép trái trang (yêu cầu
       người dùng 2026-11-08: zoom 100% trên màn hẹp, không cần thu nhỏ
       trang). Màn rộng: dock ở vùng đen bên lề như cũ. Resize mà vẫn đang
       docked thì đổi chế độ + cập nhật rộng + vẽ lại. */
    var ov = leftSpace() < 280;
    if (docked && ov !== overlayMode) { overlayMode = ov; applyDockSize(); redraw(); }
    var threshold = currentHomeTop() + 150;
    if (!docked && window.pageYOffset > threshold + 60) toDock();
    else if (docked && window.pageYOffset < threshold - 60) toHome();
  }
  window.addEventListener("scroll", function(){
    if (!ticking) { ticking = true; requestAnimationFrame(evaluate); }
  }, { passive: true });
  window.addEventListener("resize", function(){
    evaluate();
    /* Cửa sổ đổi kích thước: clamp lại kích thước tùy chỉnh theo viewport
       mới (chưa kéo thì giữ nguyên hành vi cũ — evaluate đã lo). */
    if (docked && dockCustom) { applyDockSize(); redraw(); }
  });
  /* Khoi phuc cuon sau tai lai (c, 2026-11-07): trinh duyet khoi phuc vi tri
     cuon SAU su kien load va co the khong phat su kien scroll — evaluate()
     luc IIFE chay chi thay pageYOffset=0 nen dock van an cho toi khi nguoi
     dung cuon. Danh gia lai khi load/pageshow + 2 lan tre (150/500ms) de
     bat kip thoi diem khoi phuc; evaluate() co guard theo co docked nen
     goi thua la no-op. Lab tren ham that: ban goc khong hien dock neu
     khong co su kien cuon, ung vien hien dock ngay sau load. */
  window.addEventListener("load", function(){
    evaluate();
    setTimeout(evaluate, 150);
    setTimeout(evaluate, 500);
  });
  window.addEventListener("pageshow", function(){
    evaluate();
    setTimeout(evaluate, 150);
  });
  evaluate();
  redraw();
} catch (e) {}
})();
