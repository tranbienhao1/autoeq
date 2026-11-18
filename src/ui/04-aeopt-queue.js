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
    function keyOf(prep, targetId, adj, nB, preserve, bestOf){
      try {
        var a = adj || {};
        return [ (typeof AE !== "undefined" && AE && AE.name) || "", targetId, a.tilt, a.bass, a.ear, nB, !!preserve, !!bestOf, (prep && prep.ptsN) || "" ].join("|");
      } catch (e) { return String(targetId) + "|" + nB; }
    }
    function startRun(key, args, cbs){
      busy = true; currentKey = key; currentCbs = cbs;
      try {
        orig(args[0], args[1], args[2], args[3], args[4], args[5], function(out){
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
    aeComputeAsync = function(prep, targetId, adj, nB, preserve, bestOf, cb){
      if (!OPT.enabled) return orig(prep, targetId, adj, nB, preserve, bestOf, cb);
      var key = keyOf(prep, targetId, adj, nB, preserve, bestOf);
      var args = [prep, targetId, adj, nB, preserve, bestOf];
      if (!busy){ startRun(key, args, [{ cb: cb, args: args }]); return; }
      if (key === currentKey){ currentCbs.push({ cb: cb, args: args }); OPT.coalesced++; render(); return; }
      for (var qi = 0; qi < queue.length; qi++){ if (queue[qi].key === key){ queue[qi].cbs.push({ cb: cb, args: args }); OPT.coalesced++; render(); return; } }
      queue.push({ key: key, args: args, cbs: [{ cb: cb, args: args }] }); render();
    };
  } catch (e) {}
})();
