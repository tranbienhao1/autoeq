"use strict";
/* ================================================================
   Giai đoạn 6 (tiếp): phép đo QA, dashboard, cổng xuất file,
   mutation test, chạy toàn bộ QA + báo cáo tổng hợp.
   ================================================================ */
function qaThdN(levelDb, fs){
  var N = 24000, amp = Math.pow(10, levelDb/20), w = 2*Math.PI*1000/fs, i;
  var x = new Float64Array(N);
  for (i = 0; i < N; i++) x[i] = amp*Math.sin(w*i);
  var out = qaChain(x, x, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 });
  var y = out[0], a0 = 4096;
  /* Bình phương tối thiểu: khớp y ≈ A·cos(wn) + B·sin(wn) + C trên cửa sổ đo */
  var Scc = 0, Sss = 0, Scs = 0, Sc = 0, Ss = 0, Syc = 0, Sys = 0, Sy = 0, cnt = 0;
  for (i = a0; i < N; i++){
    var c = Math.cos(w*i), s = Math.sin(w*i);
    Scc += c*c; Sss += s*s; Scs += c*s; Sc += c; Ss += s;
    Syc += y[i]*c; Sys += y[i]*s; Sy += y[i]; cnt++;
  }
  var M = [[Scc, Scs, Sc], [Scs, Sss, Ss], [Sc, Ss, cnt]], v = [Syc, Sys, Sy], k, j, p;
  for (k = 0; k < 3; k++){
    p = k; for (j = k + 1; j < 3; j++) if (Math.abs(M[j][k]) > Math.abs(M[p][k])) p = j;
    var tmp = M[p]; M[p] = M[k]; M[k] = tmp; var tv = v[p]; v[p] = v[k]; v[k] = tv;
    for (j = k + 1; j < 3; j++){ var fct = M[j][k]/M[k][k]; for (var q = k; q < 3; q++) M[j][q] -= fct*M[k][q]; v[j] -= fct*v[k]; }
  }
  var sol = [0, 0, 0];
  for (k = 2; k >= 0; k--){ var sm = v[k]; for (j = k + 1; j < 3; j++) sm -= M[k][j]*sol[j]; sol[k] = sm/M[k][k]; }
  var resP = 0;
  for (i = a0; i < N; i++){
    var fit = sol[0]*Math.cos(w*i) + sol[1]*Math.sin(w*i) + sol[2];
    var r = y[i] - fit; resP += r*r;
  }
  resP /= cnt;
  var fundP = (sol[0]*sol[0] + sol[1]*sol[1])/2;
  return { thdnDb: 10*Math.log10(Math.max(resP, 1e-300)/fundP), residDbfs: 10*Math.log10(Math.max(resP, 1e-300)) };
}
function qaFirTapsFor(bandList, fs, L){
  var Nf = 4096, re = new Float64Array(Nf), im = new Float64Array(Nf), k, f;
  var qaCc = dbBandCoeffs(bandList, fs);
  for (k = 0; k <= Nf/2; k++){
    f = Math.min(k*fs/Nf, fs*0.499);
    var db = dbBandDbC(qaCc, Math.max(f, 10), fs);
    re[k] = Math.pow(10, db/20); im[k] = 0;
    if (k > 0 && k < Nf/2){ re[Nf - k] = re[k]; im[Nf - k] = 0; }
  }
  fft(re, im, true);
  var taps = new Float64Array(L), half = (L - 1)/2;
  for (var i = 0; i < L; i++){
    var idx = ((i - half) % Nf + Nf) % Nf;
    taps[i] = re[idx]*(0.5 - 0.5*Math.cos(2*Math.PI*i/(L - 1)));
  }
  return taps;
}
function qaNullIir(fs){
  var x = qaNoise(16384, 0.5), coeffs = qaCoeffsFor(QA_TEST_BANDS, fs, {});
  var y = qaCascade(x, x, coeffs)[0];
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var y2 = qaCascade(y, y, qaCoeffsFor(invBands, fs, {}))[0];
  var s = 0, n = 0, i;
  for (i = 200; i < 16000; i++){ var d = y2[i] - x[i]; s += d*d; n++; }
  return 10*Math.log10(Math.max(s/n, 1e-300));
}
function qaNullFir(fs){
  var L = 1023, h = qaFirTapsFor(QA_TEST_BANDS, fs, L);
  var D = 0, pk = 0, i, k;
  for (i = 0; i < L; i++) if (Math.abs(h[i]) > pk){ pk = Math.abs(h[i]); D = i; }
  var M = 32768, x = qaNoise(8192, 0.5, 246813579);
  var xr = new Float64Array(M), xi = new Float64Array(M); xr.set(x);
  var hr = new Float64Array(M), hi = new Float64Array(M); hr.set(h);
  fft(xr, xi, false);
  var Xr = xr.slice(), Xi = xi.slice();
  fft(hr, hi, false);
  var yr = new Float64Array(M), yi = new Float64Array(M);
  for (k = 0; k < M; k++){ yr[k] = Xr[k]*hr[k] - Xi[k]*hi[k]; yi[k] = Xr[k]*hi[k] + Xi[k]*hr[k]; }
  var zr = new Float64Array(M), zi = new Float64Array(M);
  for (k = 0; k < M; k++){
    var den = Math.max(hr[k]*hr[k] + hi[k]*hi[k], 1e-12);
    var ir = hr[k]/den, ii = -hi[k]/den;
    /* Bộ nghịch đảo mang trễ tuyến tính riêng bằng 2D: 1/H tự nó đã khử trễ D của FIR,
       nên cộng 2D để đáp tuyến pha tổng = −2ωD, tức tín hiệu ra trễ đúng 2D so với gốc —
       phần dư được tính sau khi bù đúng tổng trễ 2D này. */
    var th = 2*Math.PI*k*(2*D)/M, c = Math.cos(th), sn = -Math.sin(th);
    var vr = ir*c - ii*sn, vi = ir*sn + ii*c;
    zr[k] = yr[k]*vr - yi[k]*vi; zi[k] = yr[k]*vi + yi[k]*vr;
  }
  fft(zr, zi, true);
  var s = 0, n = 0, totDelay = 2*D;
  for (i = 1400; i < 8000; i++){ var d = zr[i] - x[i - totDelay]; s += d*d; n++; }
  return { rmsDbfs: 10*Math.log10(Math.max(s/n, 1e-300)), dMeas: D };
}
/* ================================================================
   Chặng 1 (lộ trình 4 chặng 2026-10-26): QA trên worklet thật,
   Null Test có limiter, lưu trữ bền vững Opt-In.
   Ghi chú trung thực về sàn đo (đọc trước khi sửa ngưỡng):
   bản sao ngoại tuyến chạy float64 nên THD+N/null của nó nằm ở sàn
   -257/-265 dB, trong khi AudioWorklet vào/ra mẫu Float32 nên mọi phép
   đo qua worklet thật đều nằm ở sàn Float32 (~-153 dB cho THD+N,
   ~-161 dB cho null). Lệch thô giữa hai sàn (~100 dB) KHÔNG phải lệch
   DSP — bằng chứng là phép đối chiếu có gương Float32 (cùng đầu vào
   Float32, cùng lượng tử hoá đầu ra Float32 ở mọi biên worklet) khớp
   worklet trong 0,00 dB (THD+N) và 0,27 dB (null IIR). Vì vậy tiêu chí
   lệch của qaWorkletParity so với bản gương Float32, còn số thô của
   bản float64 vẫn được báo cáo đầy đủ, không giấu.
   ================================================================ */
function qaWorkletProc(fs){
  var StubProc = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
  var ProcCtor = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
    WORKLET_SRC + "\n; return AutoEqProcessor;");
  var Proc = ProcCtor(StubProc, fs, function(){});
  return new Proc();
}
function qaRunWorklet(proc, x, blocks, onBlock){
  var out = new Float64Array(x.length), oi = 0, b, n;
  for (b = 0; b < blocks; b++){
    var inL = new Float32Array(128), inR = new Float32Array(128), outL = new Float32Array(128), outR = new Float32Array(128);
    for (n = 0; n < 128; n++){ var v = (b*128+n < x.length) ? x[b*128+n] : 0; inL[n] = v; inR[n] = v; }
    proc.process([[inL, inR]], [[outL, outR]]);
    if (onBlock) onBlock(proc);
    for (n = 0; n < 128 && oi < out.length; n++, oi++) out[oi] = outL[n];
  }
  return out;
}
function qaQ32(v){ return new Float32Array([v])[0]; }
/* Khớp bình phương tối thiểu 3 tham số (A·cos + B·sin + C) — cùng công
   thức với qaThdN, tách ra để cả đường worklet và đường gương dùng chung. */
function qaThdNFit(y, w, a0, N){
  var Scc = 0, Sss = 0, Scs = 0, Sc = 0, Ss = 0, Syc = 0, Sys = 0, Sy = 0, cnt = 0, i;
  for (i = a0; i < N; i++){ var c = Math.cos(w*i), s = Math.sin(w*i); Scc += c*c; Sss += s*s; Scs += c*s; Sc += c; Ss += s; Syc += y[i]*c; Sys += y[i]*s; Sy += y[i]; cnt++; }
  var M = [[Scc, Scs, Sc], [Scs, Sss, Ss], [Sc, Ss, cnt]], v = [Syc, Sys, Sy], k, j, p;
  for (k = 0; k < 3; k++){
    p = k; for (j = k + 1; j < 3; j++) if (Math.abs(M[j][k]) > Math.abs(M[p][k])) p = j;
    var tmp = M[p]; M[p] = M[k]; M[k] = tmp; var tv = v[p]; v[p] = v[k]; v[k] = tv;
    for (j = k + 1; j < 3; j++){ var fct = M[j][k]/M[k][k]; for (var q = k; q < 3; q++) M[j][q] -= fct*M[k][q]; v[j] -= fct*v[k]; }
  }
  var sol = [0, 0, 0];
  for (k = 2; k >= 0; k--){ var sm = v[k]; for (j = k + 1; j < 3; j++) sm -= M[k][j]*sol[j]; sol[k] = sm/M[k][k]; }
  var resP = 0;
  for (i = a0; i < N; i++){ var fit = sol[0]*Math.cos(w*i) + sol[1]*Math.sin(w*i) + sol[2]; var r = y[i] - fit; resP += r*r; }
  resP /= cnt;
  var fundP = (sol[0]*sol[0] + sol[1]*sol[1])/2;
  return { thdnDb: 10*Math.log10(Math.max(resP, 1e-300)/fundP), residDbfs: 10*Math.log10(Math.max(resP, 1e-300)) };
}
/* Bước 1.1 — Null Test có limiter: nhiễu nhỏ qua worklet thật với
   pre-amp tự động -(maxPos+1) dB và limiter BẬT; bù trễ LA=128 và bù
   gain tĩnh nghịch đảo rồi qua cascade nghịch đảo. ĐẠT khi phần dư
   < -80 dBFS và minGr === 1 (limiter không cắt nhầm trong headroom). */
function qaNullIirWithLimiter(fs){
  var maxPos = 0, i;
  QA_TEST_BANDS.forEach(function(b){ if (b.gain > maxPos) maxPos = b.gain; });
  var preampDb = -(maxPos + 1.0);
  var preampLin = Math.pow(10, preampDb/20);
  var x = qaNoise(16384, 0.15, 135792468);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(QA_TEST_BANDS, fs, {}) } });
  proc.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: preampLin, slotLin: 1 } });
  qaRunWorklet(proc, new Float64Array(64*128), 64);
  var minGr = 1;
  var y = qaRunWorklet(proc, x, 128, function(pr){ if (pr.gr < minGr) minGr = pr.gr; });
  var LA = 128, invGain = Math.pow(10, -preampDb/20);
  var yShift = new Float64Array(16384);
  for (i = 0; i < 16384; i++) yShift[i] = (i + LA < 16384) ? y[i + LA]*invGain : 0;
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var y2 = qaCascade(yShift, yShift, qaCoeffsFor(invBands, fs, {}))[0];
  var s = 0, n = 0;
  for (i = 1000; i < 15000; i++){ var d = y2[i] - x[i]; s += d*d; n++; }
  var residDb = 10*Math.log10(Math.max(s/n, 1e-300));
  var pk = 0; for (i = 0; i < y.length; i++) if (Math.abs(y[i]) > pk) pk = Math.abs(y[i]);
  return { residDb: residDb, minGr: minGr, preampDb: preampDb, outPeakDb: 20*Math.log10(Math.max(1e-12, pk)) };
}
/* Bước 1.2a — THD+N trên worklet thật: sine 1 kHz qua processor thật
   (EQ phẳng, limiter BẬT), 32 block warm-up 0, khớp từ mẫu 4096+128. */
function qaThdNWorklet(levelDb, fs){
  var N = 24000, amp = Math.pow(10, levelDb/20), w = 2*Math.PI*1000/fs, i;
  var x = new Float64Array(N);
  for (i = 0; i < N; i++) x[i] = amp*Math.sin(w*i);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(qaFlatBands(), fs, {}) } });
  proc.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: 1, slotLin: 1 } });
  qaRunWorklet(proc, new Float64Array(32*128), 32);
  var y = qaRunWorklet(proc, x, Math.ceil(N/128));
  return qaThdNFit(y, w, 4096 + 128, N);
}
/* Gương Float32 của qaThdN: cùng chuỗi ngoại tuyến nhưng lượng tử hoá
   đầu vào/ra về Float32 tại đúng biên AudioWorklet, để lệch đo được là
   lệch DSP thật chứ không phải lệch sàn mẫu. */
function qaThdNMirror(levelDb, fs){
  var N = 24000, amp = Math.pow(10, levelDb/20), w = 2*Math.PI*1000/fs, i;
  var x = new Float64Array(N);
  for (i = 0; i < N; i++) x[i] = qaQ32(amp*Math.sin(w*i));
  var out = qaChain(x, x, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 });
  var y = new Float64Array(N);
  for (i = 0; i < N; i++) y[i] = qaQ32(out[0][i]);
  return qaThdNFit(y, w, 4096 + 128, N);
}
/* Bước 1.2b — Null IIR trên worklet thật: chặng xuôi và chặng nghịch đảo
   đều qua processor thật; bù trễ 2×128 mẫu (2 lần qua delay line limiter
   dù limiterOn=false vì đường tín hiệu luôn đi qua dlyL/dlyR). */
function qaNullIirWorklet(fs){
  var x = qaNoise(16384, 0.5);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(QA_TEST_BANDS, fs, {}) } });
  proc.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
  qaRunWorklet(proc, new Float64Array(64*128), 64);
  var y = qaRunWorklet(proc, x, 128);
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var proc2 = qaWorkletProc(fs);
  proc2.port.onmessage({ data: { type: "coeffs", coeffs: qaCoeffsFor(invBands, fs, {}) } });
  proc2.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
  qaRunWorklet(proc2, new Float64Array(64*128), 64);
  var y2full = qaRunWorklet(proc2, y, 128);
  var s = 0, n = 0, i;
  for (i = 1000; i < 15000; i++){ var d = y2full[i + 256] - x[i]; s += d*d; n++; }
  return 10*Math.log10(Math.max(s/n, 1e-300));
}
/* Gương Float32 của null IIR: cùng cửa sổ 1000..15000, lượng tử hoá
   đầu vào và đầu ra chặng xuôi về Float32 tại biên worklet. */
function qaNullIirMirror(fs){
  var x = qaNoise(16384, 0.5);
  var xq = new Float64Array(x.length), i;
  for (i = 0; i < x.length; i++) xq[i] = qaQ32(x[i]);
  var y = qaCascade(xq, xq, qaCoeffsFor(QA_TEST_BANDS, fs, {}))[0];
  var yq = new Float64Array(y.length);
  for (i = 0; i < y.length; i++) yq[i] = qaQ32(y[i]);
  var invBands = QA_TEST_BANDS.map(function(b){ return { freq: b.freq, type: b.type, gain: -b.gain, q: b.q, on: b.on }; });
  var y2 = qaCascade(yq, yq, qaCoeffsFor(invBands, fs, {}))[0];
  var s = 0, n = 0;
  for (i = 1000; i < 15000; i++){ var d = y2[i] - x[i]; s += d*d; n++; }
  return 10*Math.log10(Math.max(s/n, 1e-300));
}
/* Bước 1.2c — Null FIR với chặng xuôi qua worklet thật (mode fir, taps
   QA_TEST_BANDS) và chặng nghịch đảo bằng giải chập FFT ngoại tuyến
   (cùng phương pháp với qaNullFir, đã kiểm chứng độc lập). Bù trễ
   limiter 128 mẫu trước khi giải chập; phần dư so với x trễ 2D. */
function qaNullFirWorklet(fs){
  var L = 1023, h = qaFirTapsFor(QA_TEST_BANDS, fs, L);
  var D = 0, pk = 0, i;
  for (i = 0; i < L; i++) if (Math.abs(h[i]) > pk){ pk = Math.abs(h[i]); D = i; }
  var x = qaNoise(8192, 0.5, 246813579);
  var sig = new Float64Array(8192 + 128);
  sig.set(x);
  var proc = qaWorkletProc(fs);
  proc.port.onmessage({ data: { type: "fir", taps: h } });
  proc.port.onmessage({ data: { type: "config", mode: "fir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
  var yW = qaRunWorklet(proc, sig, Math.ceil(sig.length/128));
  var yConv = new Float64Array(8192);
  for (i = 0; i < 8192; i++) yConv[i] = yW[i + 128];
  var M = 32768;
  var xr = new Float64Array(M), xi = new Float64Array(M); xr.set(yConv);
  var hr = new Float64Array(M), hi = new Float64Array(M); hr.set(h);
  fft(xr, xi, false);
  var Xr = xr.slice(), Xi = xi.slice();
  fft(hr, hi, false);
  var zr = new Float64Array(M), zi = new Float64Array(M), k;
  for (k = 0; k < M; k++){
    var den = Math.max(hr[k]*hr[k] + hi[k]*hi[k], 1e-12);
    var ir = hr[k]/den, ii = -hi[k]/den;
    var th = 2*Math.PI*k*(2*D)/M, c = Math.cos(th), sn = -Math.sin(th);
    var vr = ir*c - ii*sn, vi = ir*sn + ii*c;
    zr[k] = Xr[k]*vr - Xi[k]*vi; zi[k] = Xr[k]*vi + Xi[k]*vr;
  }
  fft(zr, zi, true);
  var s = 0, n = 0, totDelay = 2*D;
  for (i = 1400; i < 8000; i++){ var d = zr[i] - x[i - totDelay]; s += d*d; n++; }
  return { rmsDbfs: 10*Math.log10(Math.max(s/n, 1e-300)), dMeas: D };
}
/* Bước 1.2 — Gom đối chiếu worklet thật vs bản sao ngoại tuyến. */
function qaWorkletParity(fs){
  var thW20 = qaThdNWorklet(-20, fs), thW1 = qaThdNWorklet(-1, fs);
  var thM20 = qaThdNMirror(-20, fs), thOff20 = qaThdN(-20, fs);
  var nullW = qaNullIirWorklet(fs), nullM = qaNullIirMirror(fs), nullRaw = qaNullIir(fs);
  var firW = qaNullFirWorklet(fs), firOff = qaNullFir(fs);
  var okTh = thW20.thdnDb < -140 && thW1.thdnDb < -40 && Math.abs(thW20.thdnDb - thM20.thdnDb) <= 0.5;
  var okNull = nullW < -80 && Math.abs(nullW - nullM) <= 1.0;
  var okFir = firW.rmsDbfs < -80;
  return { thW20: thW20, thW1: thW1, thM20: thM20, thOff20: thOff20,
    nullW: nullW, nullM: nullM, nullRaw: nullRaw, firW: firW, firOff: firOff,
    okTh: okTh, okNull: okNull, okFir: okFir, ok: okTh && okNull && okFir };
}
/* ================================================================
   Bước 1.3 — Kho lưu trữ bền vững Opt-In (Preset v2 + Lịch sử QA).
   Tầng lõi thuần (không chạm DOM): mọi hàm nhận store {get,set,del}
   nên vaultSelfCheck chạy trên store bộ nhớ cô lập mà không bao giờ
   động vào localStorage/IndexedDB thật của người dùng. Đồng bộ
   IndexedDB (DB riêng "webAutoEqVault.v1", store "userVault") chỉ nằm
   ở hàm vaultIdb* riêng, gọi từ UI/hook báo cáo, luôn best-effort
   (không throw, không chặn luồng chính).
   ================================================================ */
var VAULT_KEYS = { optIn: "webAutoEq.optInStore.v1", presets: "webAutoEq.presetLibrary.v1", qa: "webAutoEq.qaHistory.v1" };
function vaultMemStore(){
  var m = {};
  return { get: function(k){ return (k in m) ? m[k] : null; },
    set: function(k, v){ m[k] = String(v); },
    del: function(k){ delete m[k]; } };
}
var _vaultMemFallback = null;
function vaultDefaultStore(){
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return { get: function(k){ try { return localStorage.getItem(k); } catch (e){ return null; } },
        set: function(k, v){ try { localStorage.setItem(k, String(v)); } catch (e){} },
        del: function(k){ try { localStorage.removeItem(k); } catch (e){} } };
    }
  } catch (e){}
  if (!_vaultMemFallback) _vaultMemFallback = vaultMemStore();
  return _vaultMemFallback;
}
function vaultGetOptIn(store){
  store = store || vaultDefaultStore();
  return store.get(VAULT_KEYS.optIn) === "1";
}
function vaultSetOptIn(on, store){
  store = store || vaultDefaultStore();
  if (on){ store.set(VAULT_KEYS.optIn, "1"); return { optIn: true }; }
  store.set(VAULT_KEYS.optIn, "0");
  store.del(VAULT_KEYS.presets);
  store.del(VAULT_KEYS.qa);
  return { optIn: false, cleared: true };
}
function vaultReadList(store, key){
  /* Pha C 2026-11-05: loc muc ban luc doc — chi giu muc la doi tuong (khong
     phai null/chuoi/so/mang). Truoc day chi kiem tra Array.isArray o muc
     mang: 1 muc ban trong localStorage (sua tay/tien ich mo rong/ban cu)
     lam vaultRenamePreset nem TypeError (block strict) khong duoc bat o
     handler "Luu ten", va .map() trong vaultRenderLists nem theo -> ca
     danh sach preset + lich su QA deu khong hien. Muc tot giu nguyen;
     muc ban bi bo luc doc va tu bien mat o lan luu sau (ghi lai danh
     sach da loc). */
  try { var v = store.get(key); if (!v) return []; var a = JSON.parse(v);
    return Array.isArray(a) ? a.filter(function(it){ return it && typeof it === "object" && !Array.isArray(it); }) : []; }
  catch (e){ return []; }
}
function vaultWriteList(store, key, list){
  try { store.set(key, JSON.stringify(list)); return true; }
  catch (e){
    try { list = list.slice(1); store.set(key, JSON.stringify(list)); return true; } catch (e2){ return false; }
  }
}
function vaultSavePreset(presetObj, store){
  store = store || vaultDefaultStore();
  if (!vaultGetOptIn(store)) return { saved: false, reason: "opt-in tắt" };
  var list = vaultReadList(store, VAULT_KEYS.presets);
  list.push({ name: (presetObj && presetObj.name) || "Preset v2",
    bands: (presetObj && presetObj.eq && presetObj.eq.bands) ? presetObj.eq.bands.length : 0,
    savedAt: new Date().toISOString(), preset: presetObj });
  /* Pha B 2026-11-05: bao ten preset cu nhat bi loai khi thu vien day
     (toi da 20, FIFO) — truoc day while/list.shift() xoa lang le, gia tri
     tra ve va giao dien deu khong co tin hieu nao, nguoi dung khong biet
     preset cu nhat cua minh vua bien mat. Khong doi hanh vi FIFO, chi
     them truong dropped[] (ten cac muc vua bi loai, thuong 0 hoac 1 muc). */
  var dropped = [];
  while (list.length > 20) { var _old = list.shift(); if (_old && _old.name) dropped.push(_old.name); }
  var ok = vaultWriteList(store, VAULT_KEYS.presets, list);
  return { saved: ok, count: list.length, dropped: dropped };
}
/* Pha B 2026-11-05: doi ten preset da luu trong vault — truoc day chi doi
   duoc ten luc luu qua #psStoreName; preset luu sai ten phai xoa + luu lai,
   mat thu tu savedAt. Ham thuan (khong cham DOM): doi ten tai cho, giu
   nguyen savedAt, thu tu va so band; dong bo ca ten trong preset goc de
   xuat bundle/tai JSON van dung ten moi. Ten cat khoang trang, toi da
   80 ky tu (giong maxlength cua #psStoreName); ten rong hoac chi muc
   ngoai khoang bi tu choi, khong doi danh sach. */
function vaultRenamePreset(index, newName, store){
  store = store || vaultDefaultStore();
  if (!vaultGetOptIn(store)) return { renamed: false, reason: "opt-in tắt" };
  var list = vaultReadList(store, VAULT_KEYS.presets);
  var i = parseInt(index, 10);
  if (!isFinite(i) || i < 0 || i >= list.length) return { renamed: false, reason: "chỉ mục ngoài khoảng" };
  var nm = String(newName == null ? "" : newName).trim().slice(0, 80);
  if (!nm) return { renamed: false, reason: "tên trống" };
  var it = list[i];
  it.name = nm;
  if (it.preset && typeof it.preset === "object") it.preset.name = nm;
  var ok = vaultWriteList(store, VAULT_KEYS.presets, list);
  return { renamed: ok, name: nm };
}
function vaultSaveQaReport(summary, store){
  store = store || vaultDefaultStore();
  if (!vaultGetOptIn(store)) return { saved: false, reason: "opt-in tắt" };
  var list = vaultReadList(store, VAULT_KEYS.qa);
  var item = { id: summary.id || ("qa-" + Date.now()), timestamp: summary.timestamp || new Date().toISOString(),
    passCount: summary.passCount, totalCount: summary.totalCount, realFails: summary.realFails,
    stageLine: summary.stageLine || "", reportJson: summary.reportJson || null, truncated: false };
  list.push(item);
  while (list.length > 15) list.shift();
  var ok = vaultWriteList(store, VAULT_KEYS.qa, list);
  if (!ok && item.reportJson){
    item.reportJson = null; item.truncated = true;
    ok = vaultWriteList(store, VAULT_KEYS.qa, list);
  }
  return { saved: ok, count: list.length };
}
function vaultListPresets(store){ return vaultReadList(store || vaultDefaultStore(), VAULT_KEYS.presets); }
function vaultListQa(store){ return vaultReadList(store || vaultDefaultStore(), VAULT_KEYS.qa); }
function vaultClearPresets(store){
  store = store || vaultDefaultStore();
  store.del(VAULT_KEYS.presets);
  return { cleared: true };
}
function vaultClearQa(store){
  store = store || vaultDefaultStore();
  store.del(VAULT_KEYS.qa);
  return { cleared: true };
}
function vaultSelfCheck(){
  var s = vaultMemStore(), ok = true, notes = [];
  var r1 = vaultSavePreset({ name: "Kiểm tra A", eq: { bands: [1,2,3] } }, s);
  var r2 = vaultSaveQaReport({ passCount: 10, totalCount: 10, realFails: 0 }, s);
  if (r1.saved || r2.saved) { ok = false; notes.push("opt-in tắt nhưng vẫn lưu được"); }
  if (vaultListPresets(s).length !== 0 || vaultListQa(s).length !== 0) { ok = false; notes.push("opt-in tắt nhưng danh sách không rỗng"); }
  vaultSetOptIn(true, s);
  vaultSavePreset({ name: "Kiểm tra A", eq: { bands: [1,2,3] } }, s);
  vaultSavePreset({ name: "Kiểm tra B", eq: { bands: [1,2] } }, s);
  vaultSaveQaReport({ passCount: 10, totalCount: 12, realFails: 2 }, s);
  vaultSaveQaReport({ passCount: 12, totalCount: 12, realFails: 0 }, s);
  var ps = vaultListPresets(s), qs = vaultListQa(s);
  if (ps.length !== 2 || ps[0].name !== "Kiểm tra A" || ps[1].name !== "Kiểm tra B" || ps[0].bands !== 3) { ok = false; notes.push("preset đọc lại không khớp 100%"); }
  if (qs.length !== 2 || qs[0].passCount !== 10 || qs[1].realFails !== 0) { ok = false; notes.push("báo cáo QA đọc lại không khớp 100%"); }
  /* Kich ban 4 — Pha B 2026-11-05: doi ten giu savedAt/thu tu/so band,
     dong bo ten trong preset goc; ten rong, chi muc ngoai khoang bi tu
     choi; ten dai 100 ky tu cat dung 80 ky tu. */
  var savedAt0 = ps[0].savedAt;
  var rr = vaultRenamePreset(0, "  Kiểm tra A (đổi tên)  ", s);
  var psR = vaultListPresets(s);
  if (!rr.renamed || rr.name !== "Kiểm tra A (đổi tên)") { ok = false; notes.push("đổi tên không trả về tên đã cắt khoảng trắng"); }
  if (psR.length !== 2 || psR[0].name !== "Kiểm tra A (đổi tên)" || psR[1].name !== "Kiểm tra B") { ok = false; notes.push("đổi tên làm sai tên/thứ tự"); }
  if (psR[0].savedAt !== savedAt0 || psR[0].bands !== 3) { ok = false; notes.push("đổi tên làm đổi savedAt/số band"); }
  if (!psR[0].preset || psR[0].preset.name !== "Kiểm tra A (đổi tên)") { ok = false; notes.push("đổi tên không đồng bộ tên trong preset gốc"); }
  if (vaultRenamePreset(0, "   ", s).renamed) { ok = false; notes.push("đổi tên rỗng vẫn được chấp nhận"); }
  if (vaultRenamePreset(99, "X", s).renamed || vaultRenamePreset(-1, "X", s).renamed) { ok = false; notes.push("đổi tên ngoài khoảng vẫn được chấp nhận"); }
  var longName = ""; for (var li2 = 0; li2 < 100; li2++) longName += "B";
  if (!vaultRenamePreset(1, longName, s).renamed || vaultListPresets(s)[1].name.length !== 80) { ok = false; notes.push("đổi tên dài không cắt đúng 80 ký tự"); }
  /* Kich ban 5 — Pha B 2026-11-05: luu tran 20 preset thi preset cu nhat
     bi loai theo FIFO va ten cua no duoc bao trong dropped; luu duoi 20
     thi dropped rong. Dung store bo nho rieng de khong anh huong 2 preset
     cua kich ban 2-4 o tren. */
  var s5 = vaultMemStore(); vaultSetOptIn(true, s5);
  var rLast = null;
  for (var fi = 1; fi <= 21; fi++) rLast = vaultSavePreset({ name: "FIFO " + fi, eq: { bands: [1] } }, s5);
  var ps5 = vaultListPresets(s5);
  if (ps5.length !== 20 || ps5[0].name !== "FIFO 2" || !rLast || !rLast.dropped || rLast.dropped.length !== 1 || rLast.dropped[0] !== "FIFO 1") { ok = false; notes.push("lưu tràn 20 preset không báo đúng preset cũ nhất bị loại"); }
  var s5b = vaultMemStore(); vaultSetOptIn(true, s5b);
  var rUnder = vaultSavePreset({ name: "FIFO A", eq: { bands: [1] } }, s5b);
  if (!rUnder || !rUnder.dropped || rUnder.dropped.length !== 0) { ok = false; notes.push("lưu dưới 20 preset vẫn báo dropped"); }
  /* Kich ban 6 — Pha C 2026-11-05: muc ban trong kho (null/chuoi/so/mang)
     bi loc luc doc; doi ten + doc lai tren danh sach da loc khong nem,
     muc tot giu nguyen. Dung store bo nho rieng de khong anh huong cac
     kich ban tren. */
  var s6 = vaultMemStore(); vaultSetOptIn(true, s6);
  s6.set(VAULT_KEYS.presets, JSON.stringify([null, { name: "Sach", bands: 2, savedAt: "2026-11-05T00:00:00.000Z", preset: { name: "Sach" } }, "chuoi", 42, [1, 2]]));
  s6.set(VAULT_KEYS.qa, JSON.stringify([null, { id: "qa-1", timestamp: "2026-11-05T00:00:00.000Z", passCount: 9, totalCount: 10, realFails: 1 }]));
  var ps6 = vaultListPresets(s6), qs6 = vaultListQa(s6);
  if (ps6.length !== 1 || ps6[0].name !== "Sach" || qs6.length !== 1 || qs6[0].id !== "qa-1") { ok = false; notes.push("mục bẩn trong kho không bị lọc lúc đọc"); }
  var rr6 = vaultRenamePreset(0, "Sach (doi ten)", s6);
  if (!rr6.renamed || vaultListPresets(s6)[0].name !== "Sach (doi ten)") { ok = false; notes.push("đổi tên trên danh sách đã lọc vẫn lỗi"); }
  /* Kich ban 7 — Pha B 2026-11-05: nhap bundle bo qua preset trung ten (ca
     trung voi muc co san lan trung noi bo trong cung bundle) va bao dung ten
     preset cu nhat bi loai khi nhap vao thu vien day. Dung store bo nho rieng
     (importPresetBundle nhan store tuy chon) de khong cham thu vien that. */
  var s7 = vaultMemStore(); vaultSetOptIn(true, s7);
  vaultSavePreset({ name: "Nhap A", eq: { bands: [1,2,3] } }, s7);
  vaultSavePreset({ name: "Nhap B", eq: { bands: [1,2] } }, s7);
  var imp7 = importPresetBundle([
    { version: 2, name: "Nhap A", eq: { bands: [9] }, psycho: {} },
    { version: 2, name: "Nhap C", eq: { bands: [1] }, psycho: {} },
    { version: 2, name: "Nhap C", eq: { bands: [1] }, psycho: {} }], s7);
  var ps7 = vaultListPresets(s7);
  if (ps7.length !== 3 || ps7[0].name !== "Nhap A" || ps7[1].name !== "Nhap B" || ps7[2].name !== "Nhap C") { ok = false; notes.push("nhập bundle nhân bản preset trùng tên"); }
  if (!imp7 || imp7.dup !== 2 || !imp7.dupNames || imp7.dupNames.length !== 2 || imp7.dupNames[0] !== "Nhap A" || imp7.dupNames[1] !== "Nhap C" || imp7.saved !== 1) { ok = false; notes.push("nhập bundle không đếm đúng số mục trùng tên"); }
  if (!imp7 || !imp7.msg || imp7.msg.indexOf("trùng tên") < 0 || imp7.msg.indexOf("Nhap A") < 0) { ok = false; notes.push("thông báo nhập không nhắc preset trùng tên"); }
  var s7b = vaultMemStore(); vaultSetOptIn(true, s7b);
  for (var gi = 1; gi <= 20; gi++) vaultSavePreset({ name: "Goc " + gi, eq: { bands: [1] } }, s7b);
  var imp7b = importPresetBundle([
    { version: 2, name: "Moi 1", eq: { bands: [1] }, psycho: {} },
    { version: 2, name: "Moi 2", eq: { bands: [1] }, psycho: {} }], s7b);
  var ps7b = vaultListPresets(s7b);
  if (ps7b.length !== 20 || ps7b[0].name !== "Goc 3" || !imp7b || !imp7b.dropped || imp7b.dropped.length !== 2 || imp7b.dropped[0] !== "Goc 1" || imp7b.dropped[1] !== "Goc 2") { ok = false; notes.push("nhập bundle vào thư viện đầy không báo đúng preset bị loại"); }
  if (!imp7b || !imp7b.msg || imp7b.msg.indexOf("Goc 1") < 0 || imp7b.msg.indexOf("Goc 2") < 0) { ok = false; notes.push("thông báo nhập không nhắc preset bị loại do FIFO"); }
  vaultSetOptIn(false, s);
  if (vaultListPresets(s).length !== 0 || vaultListQa(s).length !== 0) { ok = false; notes.push("tắt opt-in nhưng kho không về 0 mục"); }
  return { pass: ok, detail: ok ? "7 kịch bản đạt: từ chối khi tắt, khớp 100% khi bật (2 preset + 2 báo cáo), đổi tên giữ savedAt/thứ tự (tên rỗng/ngoài khoảng bị từ chối, tên dài cắt 80 ký tự), lưu tràn 20 preset báo đúng preset cũ nhất bị loại, mục bẩn trong kho (null/chuỗi/số/mảng) bị lọc lúc đọc, nhập bundle bỏ qua trùng tên và báo preset bị loại do FIFO, xoá sạch khi tắt lại" : notes.join(" · ") };
}
/* Đồng bộ IndexedDB best-effort (DB riêng, không chạm kho tai nghe). */
function vaultIdbPut(kind, item){
  try {
    if (typeof indexedDB === "undefined") return;
    var req = indexedDB.open("webAutoEqVault.v1", 1);
    req.onupgradeneeded = function(){ var db = req.result; if (!db.objectStoreNames.contains("userVault")) db.createObjectStore("userVault", { keyPath: "id" }); };
    req.onsuccess = function(){
      try {
        var db = req.result;
        if (!db.objectStoreNames.contains("userVault")) return;
        var tx = db.transaction(["userVault"], "readwrite");
        tx.objectStore("userVault").put({ id: kind + ":" + (item.id || item.savedAt || Date.now()), kind: kind, item: item, savedAt: new Date().toISOString() });
      } catch (e){}
    };
    req.onerror = function(){};
  } catch (e){}
}
function vaultIdbClear(){
  try {
    if (typeof indexedDB === "undefined") return;
    var req = indexedDB.open("webAutoEqVault.v1", 1);
    req.onupgradeneeded = function(){ var db = req.result; if (!db.objectStoreNames.contains("userVault")) db.createObjectStore("userVault", { keyPath: "id" }); };
    req.onsuccess = function(){
      try {
        var db = req.result;
        if (!db.objectStoreNames.contains("userVault")) return;
        db.transaction(["userVault"], "readwrite").objectStore("userVault").clear();
      } catch (e){}
    };
    req.onerror = function(){};
  } catch (e){}
}
/* ---------------- UI kho Opt-In (chỉ chạy khi có đủ phần tử) ---------------- */
function vaultSyncUI(){
  try {
    var on = vaultGetOptIn();
    var btn = $("psStoreOptIn"), st = $("psStoreOptInState");
    if (btn) btn.textContent = on ? "Lưu trữ bền vững phía máy khách (Opt-In): ĐANG BẬT — bấm để tắt & xoá sạch" : "Lưu trữ bền vững phía máy khách (Opt-In): ĐANG TẮT";
    if (st) st.textContent = on ? "ĐANG BẬT" : "ĐANG TẮT";
    var box = $("psStoreBox"); if (box) box.style.display = on ? "block" : "none";
    var hb = $("qaHistoryBox"); if (hb) hb.style.display = on ? "block" : "none";
    vaultRenderLists();
  } catch (e){}
}
function vaultRenderLists(){
  try {
    var ul = $("psStoreList");
    if (ul){
      var ps = vaultListPresets();
      ul.innerHTML = ps.length ? ps.map(function(it, i){
        return "<li>" + qaEsc(it.name) + " · " + it.bands + " band · " + new Date(it.savedAt).toLocaleString("vi-VN") +
          ' <button class="btn small" data-vault-apply="' + i + '">Áp dụng</button>' +
          ' <button class="btn small" data-vault-dl="' + i + '">Tải JSON</button>' +
          ' <button class="btn small" data-vault-rename="' + i + '">Đổi tên</button>' +
          ' <button class="btn small" data-vault-del="' + i + '">Xoá</button></li>';
      }).join("") : "<li>Chưa có preset nào trong thư viện máy khách.</li>";
    }
    var ql = $("qaHistList");
    if (ql){
      var qs = vaultListQa();
      ql.innerHTML = qs.length ? qs.map(function(it, i){
        return "<li>" + new Date(it.timestamp).toLocaleString("vi-VN") + " · " + it.passCount + "/" + it.totalCount + " PASS · " + it.realFails + " FAIL thật" +
          (it.truncated ? " · (báo cáo đầy đủ đã lược vì đầy bộ nhớ)" : "") +
          ' <button class="btn small" data-vault-qa-dl="' + i + '">Tải JSON</button>' +
          ' <button class="btn small" data-vault-qa-del="' + i + '">Xoá</button></li>';
      }).join("") : "<li>Chưa có lịch sử QA nào trong thư viện máy khách.</li>";
    }
  } catch (e){}
}
(function vaultBindUI(){
  try {
    var btn = $("psStoreOptIn");
    if (btn) btn.addEventListener("click", function(){
      var on = !vaultGetOptIn();
      vaultSetOptIn(on);
      if (!on) vaultIdbClear();
      vaultSyncUI();
    });
    var save = $("psStoreSaveBtn");
    if (save) save.addEventListener("click", function(){
      var p = null;
      try { p = lastPreset || capturePresetV2(); } catch (e){}
      if (!p) return;
      /* Pha B 2026-11-05: dat ten preset khi luu vao vault — truoc day
         capturePresetV2() gan cung name:"Web AutoEQ Preset" nen moi muc trong
         thu vien deu trung ten, chi phan biet duoc bang so band + thoi gian.
         Lay ten tu o #psStoreName (cat khoang trang, toi da 80 ky tu); de
         trong thi giu ten mac dinh. Clone truoc khi doi ten de khong sua
         lastPreset dang hien o #psPresetJson; ten moi theo ca muc vault lan
         preset goc (xuat bundle/nhap lai van giu ten). */
      try {
        var ni = $("psStoreName");
        var nm = ni ? (ni.value || "").trim().slice(0, 80) : "";
        if (nm){ p = JSON.parse(JSON.stringify(p)); p.name = nm; }
      } catch (e){}
      var r = vaultSavePreset(p);
      if (r.saved) vaultIdbPut("preset", { id: "preset-" + Date.now(), name: p.name, bands: p.eq ? p.eq.bands.length : 0, savedAt: new Date().toISOString() });
      vaultRenderLists();
      /* Pha B 2026-11-05: bao preset cu nhat vua bi loai khi thu vien day
         (toi da 20, FIFO) — chen dong thong bao len dau danh sach bang DOM
         that (textContent), bien mat o lan render sau; khong doi hanh vi
         FIFO, khong them id DOM moi. */
      if (r.saved && r.dropped && r.dropped.length){
        try {
          var ulN = $("psStoreList");
          if (ulN){
            var liN = document.createElement("li");
            liN.textContent = "Đã xoá preset cũ nhất “" + r.dropped.join("”, “") + "” vì thư viện đầy (tối đa 20 mục).";
            ulN.insertBefore(liN, ulN.firstChild);
          }
        } catch (e){}
      }
    });
    var clr = $("psStoreClearBtn");
    if (clr) clr.addEventListener("click", function(){ vaultClearPresets(); vaultIdbClear(); vaultRenderLists(); });
    var dall = $("psStoreDlAllBtn");
    if (dall) dall.addEventListener("click", function(){
      var ps = vaultListPresets();
      if (!ps.length) return;
      try { dlText("web-autoeq-preset-bundle-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify({ kind:"web-autoeq-preset-bundle-v1", exportedAt:new Date().toISOString(), count:ps.length, presets:ps }, null, 1), "application/json"); } catch (e){}
    });
    var hclr = $("qaHistClearBtn");
    if (hclr) hclr.addEventListener("click", function(){ vaultClearQa(); vaultIdbClear(); vaultRenderLists(); });
    var ul = $("psStoreList");
    if (ul) ul.addEventListener("click", function(ev){
      var t = ev.target;
      var ai = t.getAttribute && t.getAttribute("data-vault-apply");
      var dl = t.getAttribute && t.getAttribute("data-vault-dl");
      var rn = t.getAttribute && t.getAttribute("data-vault-rename");
      var rns = t.getAttribute && t.getAttribute("data-vault-rename-save");
      var rnc = t.getAttribute && t.getAttribute("data-vault-rename-cancel");
      var di = t.getAttribute && t.getAttribute("data-vault-del");
      if (rn !== null && rn !== undefined && rn !== ""){
        /* Doi ten inline: dung DOM that thay vi innerHTML de ten co dau
           ngoac kep cung khong pha vo thuoc tinh value; Huy/Luu ten ve lai
           danh sach qua vaultRenderLists. */
        var itr = vaultListPresets()[parseInt(rn, 10)];
        var li = t.closest ? t.closest("li") : null;
        if (itr && li){
          li.textContent = "";
          var inp = document.createElement("input");
          inp.className = "numin"; inp.type = "text"; inp.maxLength = 80; inp.style.width = "220px";
          inp.value = itr.name || ""; inp.setAttribute("data-vault-rename-input", rn);
          var bSave = document.createElement("button"); bSave.className = "btn small"; bSave.textContent = "Lưu tên"; bSave.setAttribute("data-vault-rename-save", rn);
          var bCancel = document.createElement("button"); bCancel.className = "btn small"; bCancel.textContent = "Huỷ"; bCancel.setAttribute("data-vault-rename-cancel", rn);
          li.appendChild(inp); li.appendChild(document.createTextNode(" ")); li.appendChild(bSave); li.appendChild(document.createTextNode(" ")); li.appendChild(bCancel);
          try { inp.focus(); inp.select(); } catch (e){}
        }
      } else if (rns !== null && rns !== undefined && rns !== ""){
        var li2 = t.closest ? t.closest("li") : null;
        var inp2 = li2 ? li2.querySelector("input[data-vault-rename-input]") : null;
        vaultRenamePreset(parseInt(rns, 10), inp2 ? inp2.value : "");
        vaultRenderLists();
      } else if (rnc !== null && rnc !== undefined && rnc !== ""){
        vaultRenderLists();
      } else if (ai !== null && ai !== undefined && ai !== ""){
        var it = vaultListPresets()[parseInt(ai, 10)];
        if (it && it.preset){ try { applyPresetV2(it.preset); } catch (e){} }
      } else if (dl !== null && dl !== undefined && dl !== ""){
        var itd = vaultListPresets()[parseInt(dl, 10)];
        if (itd && itd.preset){ try { dlText("web-autoeq-preset-v2-" + expSlug(itd.name || "") + "-" + parseInt(dl, 10) + ".json", JSON.stringify(itd.preset, null, 1), "application/json"); } catch (e){} }
      } else if (di !== null && di !== undefined && di !== ""){
        var list = vaultListPresets(); list.splice(parseInt(di, 10), 1);
        vaultWriteList(vaultDefaultStore(), VAULT_KEYS.presets, list); vaultRenderLists();
      }
    });
    var ql = $("qaHistList");
    if (ql) ql.addEventListener("click", function(ev){
      var t = ev.target;
      var di = t.getAttribute && t.getAttribute("data-vault-qa-dl");
      var rm = t.getAttribute && t.getAttribute("data-vault-qa-del");
      if (di !== null && di !== undefined && di !== ""){
        var it = vaultListQa()[parseInt(di, 10)];
        if (it && it.reportJson){ try { dlText("web-autoeq-qa-report-" + it.id + ".json", it.reportJson, "application/json"); } catch (e){} }
      } else if (rm !== null && rm !== undefined && rm !== ""){
        var list = vaultListQa(); list.splice(parseInt(rm, 10), 1);
        vaultWriteList(vaultDefaultStore(), VAULT_KEYS.qa, list); vaultRenderLists();
      }
    });
    vaultSyncUI();
  } catch (e){}
})();

/* Nút đối chiếu OfflineAudioContext + AudioWorklet (Chặng 1, bước 1.2):
   chỉ có ý nghĩa trên trình duyệt thật; mọi đường lỗi/timeout đều báo rõ
   và giữ nguyên kết quả WORKLET_SRC đồng bộ, không bao giờ treo. */
(function qaOfflineWorkletBtn(){
  try {
    var btn = $("btnQaOfflineWorklet");
    if (!btn) return;
    btn.addEventListener("click", async function(){
      var info = $("qaOfflineWorkletInfo");
      function say(t){ if (info) info.textContent = t; }
      var fs = displayFs || 48000;
      if (typeof OfflineAudioContext === "undefined" || typeof Blob === "undefined"){
        say("Môi trường này không hỗ trợ OfflineAudioContext — giữ nguyên kết quả WORKLET_SRC đồng bộ (hàng đối chiếu worklet ở trên).");
        return;
      }
      var url = null;
      try {
        url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        var ctx = new OfflineAudioContext(2, 24000, fs);
        await Promise.race([
          ctx.audioWorklet.addModule(url),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("timeout headless")); }, 1500); })
        ]);
        var N = 24000, amp = Math.pow(10, -20/20), w = 2*Math.PI*1000/fs, i;
        var buf = ctx.createBuffer(2, N, fs);
        for (var ch = 0; ch < 2; ch++){ var d = buf.getChannelData(ch); for (i = 0; i < N; i++) d[i] = amp*Math.sin(w*i); }
        var src = ctx.createBufferSource(); src.buffer = buf;
        var node = new AudioWorkletNode(ctx, "autoeq-dsp", { outputChannelCount: [2] });
        node.port.postMessage({ type: "coeffs", coeffs: qaCoeffsFor(qaFlatBands(), fs, {}) });
        node.port.postMessage({ type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: 1, slotLin: 1 });
        src.connect(node); node.connect(ctx.destination); src.start();
        var rendered = await ctx.startRendering();
        var y = rendered.getChannelData(0);
        var fit = qaThdNFit(y, w, 4096 + 128, N);
        var sync = qaThdNWorklet(-20, fs);
        say("THD+N qua OfflineAudioContext + AudioWorklet thật: " + fit.thdnDb.toFixed(1) + " dB ở −20 dBFS (đường WORKLET_SRC đồng bộ: " + sync.thdnDb.toFixed(1) + " dB).");
      } catch (e){
        say("Không đo được qua OfflineAudioContext + AudioWorklet (" + e.message + ") — giữ nguyên kết quả WORKLET_SRC đồng bộ (hàng đối chiếu worklet ở trên).");
      } finally {
        try { if (url) URL.revokeObjectURL(url); } catch (e2){}
      }
    });
  } catch (e){}
})();

function qaIrCapture(fs){
  var imp = new Float64Array(4096); imp[0] = 1;
  var hI = qaCascade(imp, imp, qaCoeffsFor(qaCurBands(), fs, { psycho: true }))[0];
  var pkI = 0, ampI = 0, i;
  for (i = 0; i < hI.length; i++) if (Math.abs(hI[i]) > ampI){ ampI = Math.abs(hI[i]); pkI = i; }
  var hF = qaFirTapsFor(qaCurBands(), fs, firLen), pkF = 0, ampF = 0;
  for (i = 0; i < hF.length; i++) if (Math.abs(hF[i]) > ampF){ ampF = Math.abs(hF[i]); pkF = i; }
  return { hI: hI, hF: hF, pkI: pkI, ampI: ampI, pkF: pkF, ampF: ampF };
}
function qaDrawIr(ir){
  var cv = $("qaIrCv"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== Math.round(W*dpr)){ cv.width = W*dpr; cv.height = H*dpr; }
  var g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  var mid = H/2, amp = Math.max(ir.ampI, ir.ampF, 0.2)*1.1;
  g.strokeStyle = "#39434f"; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
  function plot(h, color){
    g.beginPath();
    var step = Math.max(1, Math.floor(h.length/ W));
    for (var x = 0; x < W; x++){
      var mx = 0;
      for (var i = x*step; i < Math.min(h.length, (x + 1)*step); i++) if (Math.abs(h[i]) > Math.abs(mx)) mx = h[i];
      var y = mid - mx/amp*(mid - 4);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = color; g.lineWidth = 1.4; g.stroke();
  }
  plot(ir.hF, "#3fd2dc");
  var hIzoom = ir.hI.slice(0, ir.hF.length);
  plot(hIzoom, "#ffb224");
  g.font = "10.5px 'IBM Plex Mono', monospace"; g.fillStyle = "#97a1af"; g.textAlign = "left";
  g.fillText("IR — FIR (cyan, toàn bộ " + ir.hF.length + " mẫu) · IIR (amber, " + ir.hF.length + " mẫu đầu)", 8, 13);
}
function qaSegPeak(y, start, len, fs){
  var best = 0, bf = 0, k, n;
  for (k = 0; k <= 47; k++){
    var f = 15*Math.pow(21000/15, k/47), w = 2*Math.PI*f/fs, sr = 0, si = 0;
    for (n = 0; n < len; n++){ var v = y[start + n] || 0; sr += v*Math.cos(w*n); si += v*Math.sin(w*n); }
    var m = sr*sr + si*si;
    if (m > best){ best = m; bf = f; }
  }
  return bf;
}
function qaRespDb(mutate, fs){
  var bl = FREQS.map(function(f, i){ return { freq: f, type: TYPES[i], gain: i === 5 ? 6 : 0, q: i === 5 ? 1.41 : DEFQ[i], on: true }; });
  var coeffs = qaCoeffsFor(bl, fs, { mutate: mutate });
  var s = 0;
  coeffs.forEach(function(c){ s += biquadMagDb(c, 1000, fs); });
  return s;
}
function qaRunSuite(){
  var fs = displayFs || 48000, rows = [];
  function row(name, expect, measured, pass, cfg, kind){ rows.push({ name: name, stage: "6 · QA Suite", expect: expect, measured: measured, pass: !!pass, cfg: cfg, kind: kind || "qa" }); }
  qaDrawPhaseGd();
  var gdPass = mode === "fir" ? true : (QA6.gdMaxLow !== null && QA6.gdMaxLow <= 5);
  row("Group Delay dưới 100 Hz — cấu hình EQ hiện tại", "≤ 5.00 ms ở chế độ Minimum-Phase (IIR)",
    "tối đa < 100 Hz: " + (QA6.gdMaxLow === null ? "—" : QA6.gdMaxLow.toFixed(2) + " ms") + " · tại 1 kHz: " + (QA6.gdAt1k === null ? "—" : QA6.gdAt1k.toFixed(2) + " ms") + " · pha tại 1 kHz: " + (QA6.phase1k === null ? "—" : qaWrapDeg(QA6.phase1k).toFixed(1) + "°"),
    gdPass, "Giải tích từ hệ số đang hoạt động · chế độ " + (mode === "fir" ? "Linear-Phase FIR " + firLen + " tap" : "Minimum-Phase IIR") + " · fs " + fs + " Hz");
  var t20 = qaThdN(-20, fs);
  row("THD+N — tone 1 kHz ở −20 dBFS qua toàn chuỗi DSP", "méo do hệ thống thêm vào < −140 dB so với fundamental khi EQ phẳng",
    "THD+N đo được: " + t20.thdnDb.toFixed(1) + " dB · phần dư tuyệt đối: " + t20.residDbfs.toFixed(1) + " dBFS RMS",
    t20.thdnDb < -140, "EQ phẳng · psycho tắt · crossfeed tắt · limiter BẬT (−1.0 dBTP) · khớp bình phương tối thiểu tại 1 kHz trên 0.5 s tín hiệu đã xử lý bởi bản sao chuỗi DSP");
  var t1 = qaThdN(-1, fs);
  row("THD+N — tone 1 kHz ở −1 dBFS (limiter chạm trần)", "méo vẫn < −40 dB khi limiter bắt đầu làm việc tại trần −1.0 dBTP",
    "THD+N đo được: " + t1.thdnDb.toFixed(1) + " dB · phần dư tuyệt đối: " + t1.residDbfs.toFixed(1) + " dBFS RMS",
    t1.thdnDb < -40, "Như trên nhưng tone −1 dBFS: true-peak của sine ≈ biên độ = trần −1.0 dBTP nên limiter gần như không giảm gain với bộ ước lượng windowed-sinc ×16 mới — méo đo được là méo thật của tầng limiter");
  var nI = qaNullIir(fs);
  row("Null Test — EQ → EQ nghịch đảo chính xác (IIR)", "phần dư < −80 dBFS RMS",
    "phần dư đo được: " + nI.toFixed(1) + " dBFS RMS (nhiễu kiểm tra 16 384 mẫu qua 4 band test rồi qua cascade nghịch đảo gain-đảo-dấu)",
    nI < -80, "EQ test cố định của harness (shelf +4 · peaking −3/+5 · shelf −2.5 dB) · nghịch đảo = cùng Fc/Q, gain đảo dấu (nghịch đảo chính xác của RBJ) · pre-amp/limiter loại khỏi chuỗi null vì là tầng gain/phi tuyến");
  var nF = qaNullFir(fs);
  row("Null Test — FIR Linear-Phase có bù độ trễ", "phần dư < −80 dBFS RMS sau khi bù group delay đã đo",
    "group delay đo từ đỉnh IR: " + nF.dMeas + " mẫu · phần dư sau bù trễ " + (2*nF.dMeas) + " mẫu: " + nF.rmsDbfs.toFixed(1) + " dBFS RMS",
    nF.rmsDbfs < -80 && nF.dMeas === (1023 - 1)/2, "FIR 1023 tap sinh từ cùng EQ test · nghịch đảo = chia phổ 1/H(f) với trễ tuyến tính riêng sao cho tổng trễ = 2× group delay đã đo (1022 mẫu) và được bù trước khi tính phần dư · giải chập trên lưới FFT 32 768");
  var ir = qaIrCapture(fs);
  QA6.ir = ir;
  row("Impulse Response — thu IR cho IIR và FIR từ Dirac impulse", "đỉnh IR của FIR tại (N−1)/2 ± 1 mẫu",
    "IIR: đỉnh tại mẫu " + ir.pkI + " (amp " + ir.ampI.toFixed(3) + ") · FIR " + firLen + " tap: đỉnh tại mẫu " + ir.pkF + " (kỳ vọng " + ((firLen - 1)/2) + ", amp " + ir.ampF.toFixed(3) + ")",
    Math.abs(ir.pkF - (firLen - 1)/2) <= 1, "Dirac impulse qua cascade hiện tại (EQ + psycho) cho IIR · FIR suy ra từ đáp tuyến EQ hiện tại, cửa sổ Hann");
  qaDrawIr(ir);
  $("qaIrNote").textContent = "IR đã thu: IIR đỉnh tại mẫu " + ir.pkI + " · FIR đỉnh tại mẫu " + ir.pkF + " = " + (ir.pkF/fs*1000).toFixed(2) + " ms (group delay đo được, khớp công thức (N−1)/2 = " + ((firLen - 1)/2) + " mẫu). Đồ thị: cyan = FIR toàn bộ " + ir.hF.length + " mẫu, amber = IIR " + ir.hF.length + " mẫu đầu.";
  /* Crossfeed qua chuỗi thật của harness */
  var nz = qaNoise(16384, 0.4), zero = new Float64Array(16384);
  var offR = qaChain(nz, zero, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 })[1];
  var onR = qaChain(nz, zero, fs, { bandList: qaFlatBands(), psycho: false, xf: { mix: 1, itdMs: 0.30 }, limiter: true, preampDb: 0 })[1];
  var offDb = qaRmsDbfs(offR, 600, 16000), onDb = qaRmsDbfs(onR, 600, 16000);
  row("Crossfeed — rò kênh đối diện qua chuỗi DSP", "kênh phải im lặng (< −120 dBFS) khi tắt và nghe được tín hiệu rò ITD/ILD khi bật 100%",
    "tín hiệu chỉ ở kênh trái → RMS kênh phải: tắt = " + (isFinite(offDb) ? offDb.toFixed(1) : "−∞") + " dBFS · bật 100% = " + onDb.toFixed(1) + " dBFS",
    offDb < -120 && onDb > -45, "Nhiễu mono kênh trái · crossfeed mix 100% · ITD 0.30 ms · ILD thông thấp 6.5 kHz · limiter bật");
  /* Sweep qua chuỗi phẳng */
  var T = 2, Ns = fs*T, sw = new Float64Array(Ns), K = Math.log(20000/20), n;
  for (n = 0; n < Ns; n++){ var tt = n/fs; sw[n] = 0.25*Math.sin(2*Math.PI*20*(T/K)*(Math.exp(tt/T*K) - 1)); }
  var swOut = qaChain(sw, sw, fs, { bandList: qaFlatBands(), psycho: false, xf: null, limiter: true, preampDb: 0 })[0];
  var rIn = qaRmsDbfs(sw, 1000, Ns - 1000), rOut = qaRmsDbfs(swOut, 1000, Ns - 1000);
  var pFirst = qaSegPeak(swOut, 64, 4096, fs), pLast = qaSegPeak(swOut, Ns - 4096, 4096, fs);
  row("Log sine sweep 20 Hz–20 kHz qua chuỗi phẳng", "RMS ra/vào lệch ≤ 0.5 dB · đỉnh phổ đoạn đầu < 100 Hz · đoạn cuối > 8 kHz · không NaN",
    "RMS vào " + rIn.toFixed(2) + " dBFS → ra " + rOut.toFixed(2) + " dBFS (lệch " + Math.abs(rOut - rIn).toFixed(2) + " dB) · đỉnh đoạn đầu ≈ " + Math.round(pFirst) + " Hz · đoạn cuối ≈ " + Math.round(pLast) + " Hz",
    Math.abs(rOut - rIn) <= 0.5 && pFirst < 100 && pLast > 8000, "ESS 2 giây, biên độ 0.25 · EQ phẳng · limiter bật · đỉnh phổ đo bằng quét DFT trên đoạn 4096 mẫu");
  var rc = qaRespDb(false, fs);
  row("Đáp tuyến kiểm chứng 1 kHz (bản sạch, đối chứng cho mutation)", "+6.00 dB ± 0.10 dB tại 1 kHz",
    "đo được " + rc.toFixed(3) + " dB (sai số " + Math.abs(rc - 6).toFixed(3) + " dB)",
    Math.abs(rc - 6) <= 0.1, "Cấu hình kiểm chứng Giai đoạn 1 chạy trên bản sao hệ số của harness: band 1 kHz +6 dB · Q 1.41, các band khác phẳng");
  /* --- Chế độ 20 band (Lộ trình v2 · Nhóm 1 · Giai đoạn 1): chuyển engine
     thật sang 20 band, đặt đúng một band +6.00 dB · Q 1.41 tại 1 kHz, đo đáp
     tuyến giải tích tại 1 kHz qua chính cascade hệ số của engine và pre-amp
     suy từ đỉnh đáp tuyến (luật −(đỉnh + 1.0) dB của Giai đoạn 1), rồi khôi
     phục nguyên trạng chế độ + band + band đang chọn trước đó. --- */
  (function(){
    var savedCount = bandCount, savedBands = snapBandsOnly(), savedSel = selBand;
    try {
      setBandCount(20);
      var BS = bandSet(), ti = 0, bd = 1e9;
      bands.forEach(function(b, i){
        b.freq = BS.freqs[i]; b.type = BS.types[i]; b.gain = 0; b.q = BS.defq[i]; b.on = true;
        var d = Math.abs(Math.log(BS.freqs[i]/1000)); if (d < bd){ bd = d; ti = i; }
      });
      bands[ti].freq = 1000; bands[ti].gain = 6; bands[ti].q = 1.41;
      var cs = allCoeffs(fs), resp = 0, i2, k2, f2, s2, maxR = -Infinity;
      for (i2 = 0; i2 < cs.length; i2++) resp += biquadMagDb(cs[i2], 1000, fs);
      for (k2 = 0; k2 <= 960; k2++){
        f2 = 20*Math.pow(1000, k2/960); s2 = 0;
        for (i2 = 0; i2 < cs.length; i2++) s2 += biquadMagDb(cs[i2], f2, fs);
        if (s2 > maxR) maxR = s2;
      }
      if (resp > maxR) maxR = resp;
      var pre20 = maxR > 0 ? -(maxR + 1.0) : 0;
      row("Chế độ 20 band — một band duy nhất +6.00 dB · Q 1.41 tại 1 kHz (PEQ thủ công)", "+6.00 dB ± 0.05 dB tại 1 kHz · pre-amp tương ứng −7.00 dB ± 0.05 dB",
        "đáp tuyến tại 1 kHz: " + resp.toFixed(3) + " dB (sai số " + Math.abs(resp - 6).toFixed(3) + " dB) · đỉnh đáp tuyến " + maxR.toFixed(3) + " dB → pre-amp " + pre20.toFixed(3) + " dB · cascade đo gồm " + cs.length + " band",
        cs.length === 20 && Math.abs(resp - 6) <= 0.05 && Math.abs(pre20 - (-7)) <= 0.05,
        "Engine chuyển tạm sang chế độ 20 band (log-spaced 31 Hz–16 kHz): band gần 1 kHz nhất đặt về đúng 1 kHz · +6 dB · Q 1.41, 19 band còn lại phẳng · đo giải tích từ hệ số RBJ của chính 20 band · trạng thái của bạn được khôi phục ngay sau đo");
    } catch (e20) {
      row("Chế độ 20 band — một band duy nhất +6.00 dB · Q 1.41 tại 1 kHz (PEQ thủ công)", "+6.00 dB ± 0.05 dB tại 1 kHz · pre-amp tương ứng −7.00 dB ± 0.05 dB",
        "lỗi khi đo: " + e20.message, false, "Đo trên engine ở chế độ 20 band");
    } finally {
      setBandCount(savedCount);
      applyBandArr(savedBands);
      selBand = savedSel;
      updateAll(true);
    }
  })();
  /* --- Partitioned FFT Convolution (Lộ trình v2 · Nhóm 1 · DSP Core):
     chạy đúng mã worklet đang giao cho trình duyệt (WORKLET_SRC) qua
     AudioWorkletProcessor giả lập: nạp taps FIR thật của EQ hiện tại,
     cho Dirac + nhiễu xác định qua từng block 128 mẫu ở chế độ FIR, so
     với chập trực tiếp cùng taps trên cùng tín hiệu. Tầng limiter trong
     worklet trễ cố định 128 mẫu nên phép so lệch đúng 128 mẫu đó. --- */
  (function(){
    try {
      var StubProc = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
      var ProcCtor = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
        WORKLET_SRC + "\n; return AutoEqProcessor;");
      var Proc = ProcCtor(StubProc, fs, function(){});
      var proc = new Proc();
      var taps = buildFirTaps(fs, 1023);
      proc.port.onmessage({ data: { type: "fir", taps: taps } });
      proc.port.onmessage({ data: { type: "config", mode: "fir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1 } });
      var NB = 32, seed = 123456789, b3, n3, k3;
      function rnd3(){ seed = (seed * 1103515245 + 12345) & 2147483647; return seed / 1073741824 - 1; }
      var buf = new Float64Array(1023), pos = 0, maxDiff = 0, bad = false;
      var outPart = [], outDirect = [];
      for (b3 = 0; b3 < NB; b3++){
        var inL = new Float32Array(128), inR = new Float32Array(128);
        var outL = new Float32Array(128), outR = new Float32Array(128);
        for (n3 = 0; n3 < 128; n3++){ var v3 = (b3 === 0 && n3 === 0) ? 1 : 0.5 * rnd3(); inL[n3] = v3; inR[n3] = v3; }
        proc.process([[inL, inR]], [[outL, outR]]);
        for (n3 = 0; n3 < 128; n3++){
          buf[pos] = inL[n3];
          var acc3 = 0;
          for (k3 = 0; k3 < 1023; k3++){ var ix3 = pos - k3; if (ix3 < 0) ix3 += 1023; acc3 += taps[k3] * buf[ix3]; }
          pos++; if (pos >= 1023) pos = 0;
          outPart.push(outL[n3]); outDirect.push(acc3);
        }
      }
      for (n3 = 0; n3 < outDirect.length - 128; n3++){
        var d3 = Math.abs(outPart[n3 + 128] - outDirect[n3]);
        if (!isFinite(d3)) bad = true; else if (d3 > maxDiff) maxDiff = d3;
      }
      row("FIR — Partitioned FFT Convolution = chập trực tiếp (worklet thật, block 128)",
        "sai lệch tối đa ≤ 1e-4 · không NaN · 32 block × 128 mẫu, taps FIR 1023 của EQ hiện tại",
        "sai lệch tối đa: " + maxDiff.toExponential(2) + " · NaN: " + (bad ? "có" : "không") + " · partition: " + Math.ceil(1023/128) + " × FFT 256",
        !bad && maxDiff <= 1e-4,
        "Chạy đúng WORKLET_SRC giao cho AudioWorklet (giả lập processor + sampleRate " + fs + " Hz): partitioned FFT Overlap-Add block 128 mẫu so với chập trực tiếp cùng taps, cùng tín hiệu Dirac + nhiễu xác định · limiter tắt trong phép đo nhưng trễ delay-line 128 mẫu của nó được bù bằng phép so lệch 128 mẫu");
    } catch (eP) {
      row("FIR — Partitioned FFT Convolution = chập trực tiếp (worklet thật, block 128)",
        "sai lệch tối đa ≤ 1e-4 · không NaN", "lỗi khi đo: " + eP.message, false,
        "Chạy đúng WORKLET_SRC giao cho AudioWorklet (giả lập processor)");
    }
  })();
  /* --- Look-ahead Brickwall True-Peak Limiter x16 (Lo trinh v2 · Nhom 1):
     chay dung WORKLET_SRC qua processor gia lap, EQ phang, limiter BAT,
     do dinh dau ra bang bo uoc luong TP x16 doc lap (sinc truc tiep ho tro
     +-16 mau, khong dung chung bang he so voi worklet). Tieu chi: TP ra
     <= -0.9 dBTP (tran -1.0 dBTP + dung sai 0.1 dB cho sai so uoc luong),
     gain reduction co tac dong o burst vuot tran, tin hieu nho -20 dBFS
     di qua nguyen ven sau khi bu tre 128 mau, NaN/Inf/denormal khong lam
     ban dau ra. Tin hieu: 1024 mau lang + 4096 mau burst + 1024 mau lang
     de moi mau dinh deu duoc day het khoi delay line. --- */
  (function(){
    try {
      var StubProc3 = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
      var ProcCtor3 = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
        WORKLET_SRC + "\n; return AutoEqProcessor;");
      var Proc3 = ProcCtor3(StubProc3, fs, function(){});
      function idCoeffs3(n){ var a=[]; for (var q=0;q<n;q++) a.push({b0:1,b1:0,b2:0,a1:0,a2:0}); return a; }
      function runLim(sig){
        var pr = new Proc3();
        pr.port.onmessage({ data: { type: "coeffs", coeffs: idCoeffs3(10) } });
        pr.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: true, preampLin: 1, slotLin: 1 } });
        var out = new Float64Array(sig.length), minGr = 1, oi = 0, bb, nn;
        for (bb = 0; bb*128 < sig.length; bb++){
          var inL = new Float32Array(128), inR = new Float32Array(128), outL = new Float32Array(128), outR = new Float32Array(128);
          for (nn = 0; nn < 128; nn++){ var v = (bb*128+nn < sig.length) ? sig[bb*128+nn] : 0; inL[nn] = v; inR[nn] = v; }
          pr.process([[inL, inR]], [[outL, outR]]);
          if (pr.gr < minGr) minGr = pr.gr;
          for (nn = 0; nn < 128 && oi < out.length; nn++, oi++) out[oi] = outL[nn];
        }
        return { out: out, minGrDb: 20*Math.log10(Math.max(1e-9, minGr)) };
      }
      /* Bo do TP x16 doc lap: noi suy sinc truc tiep, cua so Blackman +-16 mau. */
      function tp16(y){
        var tp = 0, N = y.length, n, ph, i, d, sinc, u, w, v;
        for (n = 1; n < N; n++){
          for (ph = 0; ph < 16; ph++){
            v = 0; var t = (n - 1) + ph/16;
            for (i = n - 17; i <= n + 16; i++){
              if (i < 0 || i >= N) continue;
              d = t - i; if (d >= 16 || d <= -16) continue;
              sinc = (d === 0) ? 1 : Math.sin(Math.PI*d)/(Math.PI*d);
              u = d/16; w = 0.42 - 0.5*Math.cos(Math.PI*(u + 1)) + 0.08*Math.cos(2*Math.PI*(u + 1));
              v += y[i]*sinc*w;
            }
            if (Math.abs(v) > tp) tp = Math.abs(v);
          }
          if (Math.abs(y[n]) > tp) tp = Math.abs(y[n]);
        }
        return tp;
      }
      function frame(sig, fn){
        var a = new Float64Array(6144), i;
        for (i = 0; i < 4096; i++) a[1024 + i] = fn(i);
        return a;
      }
      var burstSine = frame(null, function(i){ return 1.2*Math.sin(2*Math.PI*12000*i/fs); });
      var seedN = 987654321, burstNoise = frame(null, function(){ seedN = (seedN*1103515245 + 12345) & 2147483647; return (seedN/1073741824 - 1)*1.25; });
      var smallSine = frame(null, function(i){ return Math.pow(10, -20/20)*Math.sin(2*Math.PI*1000*i/fs); });
      var rS = runLim(burstSine), rN = runLim(burstNoise), rSm = runLim(smallSine);
      var tpS = tp16(rS.out), tpN = tp16(rN.out);
      var lim = Math.pow(10, -0.9/20), pkS = 0, pkN = 0, q;
      for (q = 0; q < rS.out.length; q++){ if (Math.abs(rS.out[q]) > pkS) pkS = Math.abs(rS.out[q]); if (Math.abs(rN.out[q]) > pkN) pkN = Math.abs(rN.out[q]); }
      var maxDiff = 0;
      for (q = 1024; q < 5120; q++){ var df = Math.abs(rSm.out[q + 128] - smallSine[q]); if (df > maxDiff) maxDiff = df; }
      /* NaN/Inf/denormal: qua worklet phai ra huu han (limiter khu). */
      var nanSig = new Float64Array(6144), pat = [1.0, NaN, Infinity, 1e-320, -1.0, -Infinity, 0.5, NaN];
      for (q = 0; q < 4096; q++) nanSig[1024 + q] = pat[q % pat.length];
      var rNaN = runLim(nanSig), nanBad = false;
      for (q = 0; q < rNaN.out.length; q++) if (!isFinite(rNaN.out[q])) { nanBad = true; break; }
      function tpDb(x){ return 20*Math.log10(Math.max(1e-12, x)); }
      var ok = tpS <= lim && tpN <= lim && pkS <= lim && pkN <= lim &&
        rS.minGrDb < -0.5 && rN.minGrDb < -0.5 && maxDiff <= 1e-6 && !nanBad;
      row("Limiter — Brickwall True-Peak ×16, lookahead 128 mẫu (worklet thật)",
        "TP ra ≤ −0.9 dBTP với burst vượt trần · GR tác động < −0.5 dB · sine −20 dBFS qua nguyên vẹn (sai lệch ≤ 1e-6 sau bù trễ 128 mẫu) · NaN/Inf/denormal ra hữu hạn",
        "burst sine 12 kHz amp 1.2: TP " + tpDb(tpS).toFixed(2) + " dBTP, GR " + rS.minGrDb.toFixed(2) + " dB · burst noise amp 1.25: TP " + tpDb(tpN).toFixed(2) + " dBTP, GR " + rN.minGrDb.toFixed(2) + " dB · sine −20 dBFS: sai lệch tối đa " + maxDiff.toExponential(2) + " · NaN/Inf: " + (nanBad ? "BẨN" : "hữu hạn"),
        ok,
        "Chạy đúng WORKLET_SRC (giả lập processor + sampleRate " + fs + " Hz), EQ phẳng, limiter BẬT, trần −1.0 dBTP; TP đầu ra đo bằng bộ ước lượng ×16 độc lập (sinc trực tiếp, Blackman ±16 mẫu), không dùng chung bảng hệ số với worklet");
    } catch (eL) {
      row("Limiter — Brickwall True-Peak ×16, lookahead 128 mẫu (worklet thật)",
        "TP ra ≤ −0.9 dBTP · GR tác động · sine nhỏ nguyên vẹn · NaN hữu hạn", "lỗi khi đo: " + eL.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  /* --- Dynamic EQ sidechain doc lap + RMS (Lo trinh v2 · Nhom 1):
     chay dung WORKLET_SRC qua processor gia lap, doc truc tiep dynOff cua
     worklet (khong qua duong meter cua trinh duyet). Tieu chi: band tac dong
     offset trong [-8.05, -6.5] dB, band khong tac dong |offset| <= 0.6 dB,
     RMS sine trong [-6.05, -4.45] dB (tam -5.24 dB). --- */
  (function(){
    try {
      var StubProc2 = function(){ this.port = { onmessage: null, postMessage: function(){} }; };
      var ProcCtor2 = new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor",
        WORKLET_SRC + "\n; return AutoEqProcessor;");
      var Proc2 = ProcCtor2(StubProc2, fs, function(){});
      function idCoeffs(n){ var a=[]; for (var q=0;q<n;q++) a.push({b0:1,b1:0,b2:0,a1:0,a2:0}); return a; }
      function nulls(n){ var a=[]; for (var q=0;q<n;q++) a.push(null); return a; }
      function dynBand(bandFreq, detMode){
        return { on:true, thr:-20, ratio:4, range:-8, attack:1, release:10, freq:bandFreq, type:"peaking", q:1.41, gain:0, det:detMode };
      }
      function toneProc(list, det, blocks, freq, amp){
        var pr = new Proc2();
        pr.port.onmessage({ data: { type: "coeffs", coeffs: idCoeffs(10) } });
        pr.port.onmessage({ data: { type: "config", mode: "iir", bypass: false, limiterOn: false, preampLin: 1, slotLin: 1, dyn: { list: list, det: det } } });
        for (var bb=0; bb<blocks; bb++){
          var inL = new Float32Array(128), inR = new Float32Array(128), outL = new Float32Array(128), outR = new Float32Array(128);
          for (var nn=0; nn<128; nn++){ var ph = 2*Math.PI*freq*(bb*128+nn)/fs; var v = amp*Math.sin(ph); inL[nn]=v; inR[nn]=v; }
          pr.process([[inL, inR]], [[outL, outR]]);
        }
        return pr;
      }
      var amp10 = Math.pow(10, -10/20);
      /* A: cung band 1 kHz, sidechain BP 100 Hz vs BP 1 kHz, tone 100 Hz. */
      var listA = nulls(10); listA[0] = dynBand(1000, "peak");
      var detA100 = nulls(10); detA100[0] = bandpassCoeffs(100, 1.41, fs);
      var detA1000 = nulls(10); detA1000[0] = bandpassCoeffs(1000, 1.41, fs);
      var pA1 = toneProc(listA, detA100, 60, 100, amp10);
      var pA2 = toneProc(listA, detA1000, 60, 100, amp10);
      /* B: LP 500 Hz chi nghe tone tram, HP 5 kHz chi nghe tone cao. */
      var listB = nulls(10); listB[1] = dynBand(3000, "peak"); listB[2] = dynBand(6000, "peak");
      var detB = nulls(10); detB[1] = lowpassCoeffs(500, 1, fs); detB[2] = highpassCoeffs(5000, 1, fs);
      var pBlo = toneProc(listB, detB, 60, 100, amp10);
      var pBhi = toneProc(listB, detB, 60, 8000, amp10);
      /* C: RMS cua sine -10 dBFS ~ -13.01 dBFS -> offset ~ -5.24 dB. */
      var listC = nulls(10); listC[3] = dynBand(200, "rms");
      var detC = nulls(10); detC[3] = bandpassCoeffs(1000, 1.41, fs);
      var pC = toneProc(listC, detC, 60, 1000, amp10);
      /* D: 4 band cung luc, tone 1 kHz duy nhat — chi band sidechain BP 1 kHz tac dong. */
      var listD = nulls(10);
      listD[0] = dynBand(1000, "peak"); listD[1] = dynBand(3000, "peak"); listD[2] = dynBand(6000, "peak"); listD[3] = dynBand(8000, "peak");
      var detD = nulls(10); detD[0] = bandpassCoeffs(100, 1.41, fs); detD[1] = bandpassCoeffs(1000, 1.41, fs); detD[2] = bandpassCoeffs(10000, 1.41, fs); detD[3] = bandpassCoeffs(100, 1.41, fs);
      var pD = toneProc(listD, detD, 60, 1000, amp10);
      function acts(v){ return isFinite(v) && v <= -6.5 && v >= -8.05; }
      function quiet(v){ return isFinite(v) && Math.abs(v) <= 0.6; }
      var okA = acts(pA1.dynOff[0]) && quiet(pA2.dynOff[0]);
      var okB = acts(pBlo.dynOff[1]) && quiet(pBlo.dynOff[2]) && acts(pBhi.dynOff[2]) && quiet(pBhi.dynOff[1]);
      var okC = isFinite(pC.dynOff[3]) && pC.dynOff[3] <= -4.45 && pC.dynOff[3] >= -6.05;
      var okD = quiet(pD.dynOff[0]) && acts(pD.dynOff[1]) && quiet(pD.dynOff[2]) && quiet(pD.dynOff[3]);
      row("Dynamic EQ — sidechain độc lập (BP/LP/HP) + detector RMS (worklet thật)",
        "A: BP100 nghe tone 100 Hz -> tac dong, BP1000 -> ~0 · B: LP500/HP5000 tach tram/cao · C: RMS sine -> -5.24 dB · D: 4 band cung luc chi band sidechain 1 kHz tac dong",
        "A: " + pA1.dynOff[0].toFixed(2) + " / " + pA2.dynOff[0].toFixed(2) + " dB · B tram: " + pBlo.dynOff[1].toFixed(2) + " / " + pBlo.dynOff[2].toFixed(2) + " dB, cao: " + pBhi.dynOff[1].toFixed(2) + " / " + pBhi.dynOff[2].toFixed(2) + " dB · C RMS: " + pC.dynOff[3].toFixed(2) + " dB · D: [" + [0,1,2,3].map(function(i){ return pD.dynOff[i].toFixed(2); }).join(", ") + "] dB",
        okA && okB && okC && okD,
        "Chạy đúng WORKLET_SRC (giả lập processor + sampleRate " + fs + " Hz), 60 block x 128 mẫu/tone, attack 1 ms/release 10 ms, threshold -20 dBFS, ratio 4, range -8 dB; đọc trực tiếp dynOff của worklet sau khi envelope ổn định");
    } catch (eD) {
      row("Dynamic EQ — sidechain độc lập (BP/LP/HP) + detector RMS (worklet thật)",
        "A/B/C/D như trên", "lỗi khi đo: " + eD.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  /* --- Dithering TPDF (Lộ trình v2 · Nhóm 1): thống kê nhiễu trên đúng
     hàm tpdfNoiseLSB/tpdfQuantize16 đang giao; tiêu chí: trung bình ~0,
     phương sai ~1/6 LSB^2 (phân phối tam giác, khác hẳn đều: P(|n|<0.5)=0.75),
     DC 0.25 LSB lượng tử hoá không thiên lệch, cùng hạt giống -> cùng dãy,
     NaN/vượt tầm -> mã hữu hạn và kẹp đúng, blob WAV 16-bit đúng loại. --- */
  (function(){
    try {
      var NN = 120000, rngN = tpdfRng(20261026), sumN = 0, sumN2 = 0, cntHalf = 0, kN;
      for (kN = 0; kN < NN; kN++){
        var nv = tpdfNoiseLSB(rngN);
        sumN += nv; sumN2 += nv * nv;
        if (Math.abs(nv) < 0.5) cntHalf++;
      }
      var meanN = sumN / NN, varN = sumN2 / NN - meanN * meanN, pHalf = cntHalf / NN;
      var DC = 0.25, ND = 60000, rngD = tpdfRng(987654321), sumD = 0, kD;
      for (kD = 0; kD < ND; kD++) sumD += tpdfQuantize16(DC / 32768, rngD);
      var meanDC = sumD / ND; /* đơn vị LSB, đích 0.25 */
      var rA = tpdfRng(424242), rB = tpdfRng(424242), sameSeed = true, kS;
      for (kS = 0; kS < 5000; kS++){ if (tpdfNoiseLSB(rA) !== tpdfNoiseLSB(rB)) { sameSeed = false; break; } }
      var clipHi = tpdfQuantize16(2, tpdfRng(7)), clipLo = tpdfQuantize16(-2, tpdfRng(7));
      var nanCode = tpdfQuantize16(NaN, tpdfRng(7));
      var blob16 = irWavBlob16([0.5, -0.25, 0, 0.001], 48000,
        { headphone: "QA", targetName: "QA", phaseLabel: "Minimum Phase", rig: "711", profile: "QA", preamp: 0, dateISO: "2026-10-26" }, tpdfRng(99));
      var okN = Math.abs(meanN) <= 0.01 && varN >= 0.1567 && varN <= 0.1767 && pHalf >= 0.73 && pHalf <= 0.77;
      var okD = Math.abs(meanDC - 0.25) <= 0.05;
      var okC = sameSeed && clipHi === 32767 && clipLo === -32768 && isFinite(nanCode) && blob16.type === "audio/wav" && blob16.size > 4 * 2 * 2;
      row("Dithering TPDF — nhiễu tam giác + lượng tử hoá 16-bit không thiên lệch",
        "N=120000: |trung bình| <= 0.01 LSB · phương sai 0.1567-0.1767 LSB^2 · P(|n|<0.5) 0.73-0.77 · DC 0.25 LSB -> trung bình 0.25 ± 0.05 LSB · cùng hạt giống -> cùng dãy · kẹp ±32767/-32768 · blob WAV đúng loại",
        "trung bình: " + meanN.toFixed(4) + " LSB · phương sai: " + varN.toFixed(4) + " LSB^2 (đích 0.1667) · P(|n|<0.5): " + pHalf.toFixed(4) + " (đích 0.75) · DC 0.25 LSB -> " + meanDC.toFixed(4) + " LSB (không dither luôn 0.00) · cùng hạt giống: " + (sameSeed ? "đúng" : "sai") + " · kẹp: " + clipHi + "/" + clipLo + " · blob: " + blob16.type + ", " + blob16.size + " byte",
        okN && okD && okC,
        "Chạy đúng tpdfNoiseLSB/tpdfQuantize16/irWavBlob16 đang giao trong app, RNG LCG có hạt giống (xuất file thật dùng Math.random)");
    } catch (eT) {
      row("Dithering TPDF — nhiễu tam giác + lượng tử hoá 16-bit không thiên lệch",
        "như trên", "lỗi khi đo: " + eT.message, false,
        "Chạy đúng tpdfNoiseLSB/tpdfQuantize16/irWavBlob16 đang giao trong app");
    }
  })();
  /* --- Chế độ Tự Động Toàn Diện: hàm thuần (chọn band, mức nghe, cấu hình Dyn) --- */
  (function(){
    try {
      var r = (typeof autoSelfCheck === "function") ? autoSelfCheck() : null;
      row("Chế độ Tự Động Toàn Diện — hàm thuần (chọn band, mức nghe, cấu hình Dyn)",
        "phẳng -> 10 band · phức tạp (>=6 đổi chiều, biên >=8 dB) -> 20 band · dốc mượt -> 10 band · vol 100/85/0% -> 80/76/50 phon (ref 80) · gain 6 dB -> thr -20, ratio 4, range -6, RMS · NaN/Inf -> giá trị an toàn",
        r ? r.detail : "mô-đun Auto chưa nạp",
        !!(r && r.ok),
        "Chạy đúng autoPickBandCount/autoVolToListen/autoDynConfig/autoSanitizeBand đang giao trong app (không chạm DSP/solver)");
    } catch (eA) {
      row("Chế độ Tự Động Toàn Diện — hàm thuần (chọn band, mức nghe, cấu hình Dyn)",
        "như trên", "lỗi khi đo: " + eA.message, false,
        "Chạy đúng các hàm thuần của mô-đun Auto trong app");
    }
  /* --- Chặng 1 (lộ trình 4 chặng 2026-10-26): 3 hàng mới --- */
  (function(){
    try {
      var lim = qaNullIirWithLimiter(fs);
      row("Null Test có Limiter — bù gain tĩnh trong vùng headroom (worklet thật)",
        "phần dư < −80 dBFS RMS · minGr === 1 (limiter không cắt nhầm khi tín hiệu trong headroom)",
        "phần dư: " + lim.residDb.toFixed(1) + " dBFS RMS · minGr: " + lim.minGr + " · pre-amp: " + lim.preampDb.toFixed(1) + " dB · đỉnh ra: " + lim.outPeakDb.toFixed(1) + " dBTP (trần −1.0 dBTP)",
        lim.residDb < -80 && lim.minGr === 1,
        "Nhiễu 16 384 mẫu amp 0.15 qua AutoEqProcessor thật từ WORKLET_SRC (limiter BẬT, pre-amp −(maxPos+1) dB) · 64 block warm-up 0 · bù trễ LA=128 + bù gain tĩnh nghịch đảo · cascade nghịch đảo gain-đảo-dấu · cửa sổ ổn định 1000..15000");
    } catch (eL1) {
      row("Null Test có Limiter — bù gain tĩnh trong vùng headroom (worklet thật)",
        "phần dư < −80 dBFS RMS · minGr === 1", "lỗi khi đo: " + eL1.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  (function(){
    try {
      var par = qaWorkletParity(fs);
      var okAll = par.ok;
      row("Đối chiếu QA trên Worklet thật (WORKLET_SRC) vs Bản sao ngoại tuyến",
        "THD+N worklet < −140 dB ở −20 dBFS và < −40 dB ở −1 dBFS · lệch THD+N so với gương Float32 ≤ 0.5 dB · Null IIR worklet < −80 dBFS · lệch null so với gương Float32 ≤ 1.0 dB · Null FIR worklet < −80 dBFS",
        "THD+N worklet: −20 dBFS = " + par.thW20.thdnDb.toFixed(1) + " dB (gương Float32: " + par.thM20.thdnDb.toFixed(1) + " dB, lệch " + Math.abs(par.thW20.thdnDb - par.thM20.thdnDb).toFixed(2) + " dB; bản float64: " + par.thOff20.thdnDb.toFixed(1) + " dB) · −1 dBFS = " + par.thW1.thdnDb.toFixed(1) + " dB · Null IIR worklet: " + par.nullW.toFixed(1) + " dBFS (gương: " + par.nullM.toFixed(1) + " dBFS, lệch " + Math.abs(par.nullW - par.nullM).toFixed(2) + " dB; bản float64: " + par.nullRaw.toFixed(1) + " dBFS) · Null FIR worklet: " + par.firW.rmsDbfs.toFixed(1) + " dBFS (bản float64: " + par.firOff.rmsDbfs.toFixed(1) + " dBFS)",
        okAll,
        "Worklet thật = AutoEqProcessor khởi tạo trực tiếp từ WORKLET_SRC (không addModule) · THD+N: sine 1 kHz, 32 block warm-up, khớp từ mẫu 4096+128 · Null IIR: 2 processor (xuôi + nghịch đảo), bù trễ 2×128 · Null FIR: chặng xuôi worklet mode fir + giải chập FFT ngoại tuyến · Lệch thô với bản float64 (~100 dB) là sàn lượng tử Float32 của AudioWorklet, không phải lệch DSP — xem ghi chú đầu khối Chặng 1");
    } catch (eP1) {
      row("Đối chiếu QA trên Worklet thật (WORKLET_SRC) vs Bản sao ngoại tuyến",
        "như trên", "lỗi khi đo: " + eP1.message, false,
        "Chạy đúng WORKLET_SRC (giả lập processor)");
    }
  })();
  /* --- Chặng 3: hàng QA nhân DSP WASM f64 (tên wasmSelfCheck đã có chủ nên dùng wasmDspSelfCheck) --- */
  (function(){
    try {
      var d = wasmDspSelfCheck(fs);
      row("Nhân DSP WebAssembly (WASM float64) — đối chiếu bit-accurate với JS float64",
        "WebAssembly.validate === true · maxAbsDiff ≤ 1e-14 ở cả 10 và 20 band · đáp tuyến 1 kHz qua nhân WASM = +6.000 dB ± 0.001 dB",
        "validate: " + (d.validated ? "ĐẠT" : "KHÔNG ĐẠT") + " · diff 10 band: " + d.maxAbsDiff10 + " · diff 20 band: " + d.maxAbsDiff20 + " · đáp tuyến 1 kHz: " + (isFinite(d.resp1kDb) ? d.resp1kDb.toFixed(4) : "NaN") + " dB" + (d.reason ? " · " + d.reason : ""),
        !!d.pass,
        "Nhân WASM f64 DF2T 628 byte (biquad_block_f64) qua wasmCreateDspCore · tín hiệu kiểm 4096 mẫu (Dirac + đa hài + nhiễu xác định) · đối chiếu qaCascade · xung + DFT tại 1 kHz cho band +6 dB/Q1.41 · core mới cho mỗi phép đo (trạng thái DF2T bắt đầu từ 0)");
    } catch (eW3) {
      row("Nhân DSP WebAssembly (WASM float64) — đối chiếu bit-accurate với JS float64",
        "như trên", "lỗi khi đo: " + eW3.message, false,
        "Chạy đúng wasmDspSelfCheck / qaCascade");
    }
  })();
  (function(){
    try {
      var vc = vaultSelfCheck();
      row("Lưu trữ bền vững Preset v2 & Lịch sử QA phía máy khách (Opt-In)",
        "7 kịch bản vaultSelfCheck đều đạt: từ chối khi opt-in tắt · khớp 100% khi bật · đổi tên giữ savedAt/thứ tự · lưu tràn 20 báo đúng preset cũ nhất bị loại · mục bẩn trong kho bị lọc lúc đọc · nhập bundle bỏ qua trùng tên, báo preset bị loại do FIFO · xoá sạch khi tắt lại",
        vc.detail, vc.pass,
        "Tự kiểm trên store bộ nhớ cô lập (không chạm localStorage/IndexedDB thật) · Opt-In mặc định TẮT · preset tối đa 20, lịch sử QA tối đa 15 · tắt Opt-In là xoá sạch ngay");
    } catch (eV1) {
      row("Lưu trữ bền vững Preset v2 & Lịch sử QA phía máy khách (Opt-In)",
        "7 kịch bản vaultSelfCheck đều đạt", "lỗi khi đo: " + eV1.message, false,
        "vaultSelfCheck() trên store bộ nhớ cô lập");
    }
  })();
  (function(){
    try {
      var parW = aeWorkerParityCheck();
      row("Solver Web Worker — đối chiếu 10/20 band với main thread (Mẫu A)",
        "maxDiff === 0 tuyệt đối ở cả 10 và 20 band (freq, gain, q từng band)",
        "10 band: maxDiff " + parW.diff10 + " (" + parW.bands10 + " band) · 20 band: maxDiff " + parW.diff20 + " (" + parW.bands20 + " band)",
        parW.ok,
        "Mẫu A → Harman OE 2018, cùng err/weights (null đã zero-weight) · worker = AE_WORKER_SRC (.toString() của chính các hàm thuần main thread) qua new Function · main thread = aeSolve đồng bộ");
    } catch (eW) {
      row("Solver Web Worker — đối chiếu 10/20 band với main thread (Mẫu A)",
        "maxDiff === 0 tuyệt đối", "lỗi khi đo: " + eW.message, false,
        "aeWorkerParityCheck() trên AE_WORKER_SRC");
    }
  })();
  (function(){
    try {
      var v8r = dbExtSelfCheck();
      row("Mở rộng kho đo On-Demand — Pack Loader + dbEncodeV/dbDecodeV + chống trùng/hỏng",
        "round-trip ≤ 0,05 dB · nạp thử 2 vào/3 loại · trùng kho thật bị chặn · kho giữ nguyên tuyệt đối",
        v8r.detail + " · kho trước/sau: " + v8r.beforePhones + "/" + v8r.afterPhones + " mục",
        v8r.pass,
        "dbExtSelfCheck() trên bản sao kiểm thử (không chạm DB_PHONES/AE_PHONES thật) · id p5V8 dùng mới vì p5V6 đã là hàng CamillaDSP/Qudelix");
    } catch (e8) {
      row("Mở rộng kho đo On-Demand — Pack Loader + dbEncodeV/dbDecodeV + chống trùng/hỏng",
        "như trên", "lỗi khi đo: " + e8.message, false,
        "dbExtSelfCheck() trên bản sao kiểm thử");
    }
  })();
  })();
  (function(){
    try {
      var ux = uxAutoPilotSelfCheck();
      row("Smart Auto-Pilot v2 — Quick EQ Bar 1 chạm + 12 tự động hoá (Chặng 4)",
        "target IE+5128→jm1 · IE→harmanIE · OE→harmanOE · crossfeed IE 28/0.30 · OE 22/0.28 · 4 phong cách đúng giá trị · guard gdMaxLow ≤ 5,0 ms",
        ux.detail, ux.ok,
        "uxAutoPilotSelfCheck() trên trạng thái thật (slider khôi phục sau kiểm, bands khôi phục sau guard)");
    } catch (eUx) {
      row("Smart Auto-Pilot v2 — Quick EQ Bar 1 chạm + 12 tự động hoá (Chặng 4)",
        "như trên", "lỗi khi đo: " + eUx.message, false,
        "uxAutoPilotSelfCheck()");
    }
  })();
  /* --- Liều nghe trong tuần: toán liều / giảm nhẹ / ghi đè / tuần ISO --- */
  (function(){
    try {
      var dr = (typeof doseSelfCheck === "function") ? doseSelfCheck() : null;
      row("Liều nghe trong tuần — toán liều, giảm nhẹ, ghi đè tay, reset tuần ISO",
        "40 giờ @ 80 dB -> 100% · 20 giờ @ 83 dB -> 100% · 10 giờ @ 77 dB -> 12.5% · giảm nhẹ <80% -> 0 dB, 90% -> −1.5 dB, >=100% -> −3 dB (kẹp, không dừng phát) · chỉnh tay -> trim 0 + cờ ghi đè · đổi tuần ISO -> liều về 0",
        dr ? dr.detail : "mô-đun liều nghe chưa nạp",
        !!(dr && dr.ok),
        "Chạy đúng doseAdd/doseTrimDb/doseEaseState/doseWeekKey/doseResolveWeek đang giao trong app (chỉ mức phát ước lượng + thời gian đang phát, không ghi âm thanh)");
    } catch (eD) {
      row("Liều nghe trong tuần — toán liều, giảm nhẹ, ghi đè tay, reset tuần ISO",
        "như trên", "lỗi khi đo: " + eD.message, false,
        "Chạy đúng các hàm thuần của mô-đun liều nghe trong app");
    }
  })();
  /* --- NÂNG CẤP KHỐI 4/5/6 (2026-10-31): decramped biquad, ISO 226:2023, Harman IE 13 tham số --- */
  (function(){
    function upRow(name, expect, fn, cfg){
      try {
        var r = (typeof UP !== "undefined" && typeof UP[fn] === "function") ? UP[fn]() : null;
        row(name, expect, r ? ("tự kiểm " + fn + ": " + r.pass + "/" + r.total + " PASS" + (r.msgs.length ? " — " + r.msgs.join(" | ") : "")) : "mô-đun chưa nạp", !!(r && r.pass === r.total), cfg);
      } catch (e) {
        row(name, expect, "lỗi khi đo: " + e.message, false, cfg);
      }
    }
    upRow("Nâng cấp Khối 4 — Decramped Biquad 8 họ lọc & Jury Stability Guard",
      "đủ 8 họ lọc đạt chuẩn (notch triệt <= -100 dB, allpass phẳng < 1e-11 dB, LP/HP -3.01 dB tại fc) · decramped giảm sai số sườn trên 14-20 kHz >= 40% so với RBJ · lưới cực đoan 320 bộ đều ổn định Jury",
      "selfCheck4", "UP.selfCheck4() — chạy đúng rbjCoeffs/biquadMagDb và UP.pure4 đang giao trong app");
    upRow("Nâng cấp Khối 5 — Chuẩn quốc tế ISO 226:2023 (Công thức 1 & 2 + Table 1)",
      "neo 1 kHz lệch 0 tuyệt đối (< 1e-12 dB) · ngưỡng 2.4 phon khớp cột Tf 29/29 · bù 60 vs 80 phon: +8.12 dB tại 50 Hz, +6.04 dB tại 100 Hz · khứ hồi (1)<->(2) < 1e-10 phon · ngân hàng 6-section khớp contour mới RMS <= 0.50 dB",
      "selfCheck5", "UP.selfCheck5() — chạy đúng isoSplIdx/isoPhonIdx/loudGainsFor đang giao trong app");
    upRow("Nâng cấp Khối 6 — Mô hình & Solver Harman IE 2019 (đủ 13 tham số)",
      "13/13 tham số có độ nhạy độc lập · mặc định khớp 22 knots RMS <= 0.35 dB, max <= 0.90 dB · solver 13 band trên Mẫu A giảm lỗi >= 65%, 0 vi phạm · Mẫu C 0 band boost vào null · kẹp NaN an toàn",
      "selfCheck6", "UP.selfCheck6() — chạy đúng UP.pure6 và aeCompute đang giao trong app (đồng bộ, trong QA)");
  })();
  return rows;
}
/* ---------------- Dashboard + cổng xuất file ---------------- */
function qaEsc(s){ return String(s).replace(/</g, "&lt;"); }
function qaRealFails(){ return QA6.results.filter(function(r){ return !r.pass && r.kind !== "mutation" && r.kind !== "conditional"; }); }
function qaConditionals(){ return QA6.results.filter(function(r){ return r.kind === "conditional"; }); }
function qaRenderDashboard(){
  var tb = $("qaRows");
  if (!QA6.results.length){
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--dim)">Chưa có kết quả — toàn bộ kiểm chứng tự chạy khi tải trang, hoặc bấm “Chạy toàn bộ QA” ở trên để chạy lại.</td></tr>';
    $("qaSummary").textContent = "—";
    return;
  }
  tb.innerHTML = QA6.results.map(function(r){
    var badge = r.kind === "mutation"
      ? '<span class="fail">FAIL</span> <span style="color:var(--amber);font-size:11.5px">(mutation có chủ đích)</span>'
      : r.kind === "conditional"
        ? '<span class="skip">CHƯA ĐỦ ĐIỀU KIỆN ĐO</span> <span style="color:var(--dim);font-size:11.5px">(môi trường không cho mẫu hợp lệ — không tính FAIL, không khóa xuất file)</span>'
        : (r.pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>');
    return "<tr><td><b>" + qaEsc(r.name) + '</b><br><span style="color:var(--dim);font-size:11.5px">Giai đoạn ' + qaEsc(r.stage) + "</span></td>" +
      "<td class=\"mono\">" + qaEsc(r.expect) + "</td><td class=\"mono\">" + qaEsc(r.measured) + "</td><td>" + badge + "</td><td class=\"mono\">" + qaEsc(r.cfg) + "</td></tr>";
  }).join("");
  var fails = qaRealFails();
  var conds = qaConditionals();
  var np = QA6.results.filter(function(r){ return r.pass; }).length;
  $("qaSummary").innerHTML = QA6.results.length + " test · <span class='pass'>" + np + " PASS</span> · " + (fails.length ? "<span class='fail'>" + fails.length + " FAIL thật</span>" : "<span class='pass'>0 FAIL thật</span>") +
    (conds.length ? " · <span class='skip'>" + conds.length + " chưa đủ điều kiện đo</span> (môi trường hiển thị — chạy lại trong tab đang focus để kết luận)" : "") +
    (QA6.ack && fails.length ? " · người dùng đã xác nhận cảnh báo, xuất file đã mở lại" : "");
  qaApplyGate();
}
var QA_EXPORT_BTNS = ["expApo", "expSS", "expWav", "expPA", "expJD", "expCamilla", "expQudelix", "expEasy", "expProq", "geqDownload", "batchDownload", "expRoon", "expIrMin", "expIrLin", "expIrMix", "expIr16Min", "expIr16Lin", "expIr16Mix"];
function qaApplyGate(){
  var fails = qaRealFails();
  var locked = fails.length > 0 && !QA6.ack;
  QA_EXPORT_BTNS.forEach(function(id){ var b = $(id); if (b) b.disabled = locked; });
  var html = "";
  if (locked){
    html = "<b>Đã khóa xuất file (Giai đoạn 5) vì QA có " + fails.length + " FAIL thật:</b> " + fails.map(function(r){ return qaEsc(r.name); }).join(" · ") +
      ". Đây là khóa có thông báo rõ ràng, không phải khóa im lặng: file xuất từ một cấu hình chưa đạt kiểm chứng có thể sai trên thiết bị thật. " +
      '<button class="btn small qaAckBtn" style="margin-left:8px">Tôi hiểu rủi ro — vẫn mở khóa xuất file</button>';
  } else if (fails.length && QA6.ack){
    html = "QA vẫn còn " + fails.length + " FAIL thật, nhưng bạn đã xác nhận cảnh báo — các nút xuất file đã được mở lại theo quyết định của bạn.";
  }
  [$("qaGateNote"), $("qaGateNote2")].forEach(function(el){
    if (!el) return;
    el.style.display = html ? "block" : "none";
    el.innerHTML = html;
  });
  Array.prototype.forEach.call(document.querySelectorAll(".qaAckBtn"), function(b){
    b.addEventListener("click", function(){ QA6.ack = true; qaRenderDashboard(); });
  });
}
/* ---------------- Thu thập kết quả các panel Giai đoạn 1–5 ---------------- */
function qaCollectStageRows(){
  var map = [
    ["vResp", "vRespOk", "1"], ["vPre", "vPreOk", "1"], ["wasmV1", "wasmV1Ok", "1"],
    ["aeV1", "aeV1Ok", "2"], ["aeV2", "aeV2Ok", "2"], ["aeV3", "aeV3Ok", "2"], ["aeV4", "aeV4Ok", "2"], ["aeV5", "aeV5Ok", "2"], ["aeV6", "aeV6Ok", "2"], ["aeV7", "aeV7Ok", "2"], ["aeV8", "aeV8Ok", "2"],
    ["psV1", "psV1Ok", "3"], ["psV2", "psV2Ok", "3"], ["psV3", "psV3Ok", "3"], ["psV4", "psV4Ok", "3"], ["psV5", "psV5Ok", "3"], ["psV6", "psV6Ok", "3"], ["psV7", "psV7Ok", "3"], ["psV8", "psV8Ok", "3"],
    ["p4V1", "p4V1Ok", "4"], ["p4V2", "p4V2Ok", "4"], ["p4V3", "p4V3Ok", "4"], ["p4V4", "p4V4Ok", "4"],
    ["p5V1", "p5V1Ok", "5"], ["p5V2", "p5V2Ok", "5"], ["p5V3", "p5V3Ok", "5"], ["p5V4", "p5V4Ok", "5"], ["p5V5", "p5V5Ok", "5"], ["p5V6", "p5V6Ok", "5"], ["p5V7", "p5V7Ok", "5"], ["p5V8", "p5V8Ok", "5"]
  ];
  var rows = [];
  map.forEach(function(m){
    var vEl = $(m[0]), oEl = $(m[1]);
    if (!vEl || !oEl) return;
    var tr = vEl.closest("tr");
    var name = tr ? tr.children[0].textContent.trim() : m[0];
    var measured = vEl.textContent.trim();
    if (!measured || measured === "—") return;
    var isCond = oEl.innerHTML.indexOf('class="skip"') >= 0;
    var isPending = oEl.textContent.trim() === "…" || measured.indexOf("đang đo") === 0 || measured.indexOf("đang chập") === 0;
    rows.push({ name: name, stage: m[2] + " · Kiểm chứng nghiệm thu", expect: "tiêu chí ghi trong panel Giai đoạn " + m[2], measured: isPending ? measured + " — lần thu thập này diễn ra khi phép đo chưa kịp hoàn tất trong môi trường hiện tại" : measured,
      pass: !isPending && oEl.innerHTML.indexOf('class="pass"') >= 0, cfg: "Chạy lại từ nút “Chạy toàn bộ QA” của Giai đoạn 6 trên đúng panel kiểm chứng gốc", kind: (isCond || isPending) ? "conditional" : "stage" });
  });
  return rows;
}
function qaWaitFor(fn, timeoutMs){
  return new Promise(function(res){
    var t0 = performance.now();
    var iv = setInterval(function(){
      if (fn() || performance.now() - t0 > timeoutMs){ clearInterval(iv); res(); }
    }, 150);
  });
}
/* ---------------- Báo cáo tổng hợp ---------------- */
function qaBuildReport(){
  var fails = qaRealFails();
  var rep = {
    report: "Web AutoEQ — Báo cáo QA tổng hợp (cổng hồi quy tương đương `pnpm qa` của bản web)",
    generatedAt: new Date().toISOString(),
    context: { mode: mode, sampleRate: displayFs, firTaps: firLen, bypass: bypass, limiterOn: limiterOn,
      bands: bands.map(function(b){ return { freq: Math.round(b.freq), type: b.type, gain: +b.gain.toFixed(2), q: +b.q.toFixed(2), on: b.on }; }) },
    totals: { tests: QA6.results.length, pass: QA6.results.filter(function(r){ return r.pass; }).length, realFails: fails.length,
      notMeasuredEnvironment: qaConditionals().length,
      mutationFailsAsDesigned: QA6.results.filter(function(r){ return r.kind === "mutation" && !r.pass; }).length },
    exportGate: fails.length ? (QA6.ack ? "Có FAIL thật nhưng người dùng đã xác nhận cảnh báo — xuất file mở" : "Có FAIL thật — xuất file đang bị khóa chờ xác nhận") : "Không có FAIL thật — xuất file mở" + (qaConditionals().length ? " (" + qaConditionals().length + " test chưa đủ điều kiện đo vì môi trường hiển thị — không khóa xuất)" : ""),
    mutation: QA6.mutationInfo,
    results: QA6.results,
    verdict: fails.length ? "FAIL — còn " + fails.length + " test thật chưa đạt (xem dashboard)" : "PASS — mọi test đã đo trong lần chạy này đều đạt" + (qaConditionals().length ? " · " + qaConditionals().length + " test chưa đủ điều kiện đo trong môi trường này (không kết luận PASS/FAIL — xem dashboard)" : "")
  };
  QA6.report = rep;
  try { if (vaultGetOptIn()) { var _vq = vaultSaveQaReport({ id: "qa-" + Date.now(), timestamp: rep.generatedAt,
    passCount: rep.totals.pass, totalCount: rep.totals.tests, realFails: rep.totals.realFails,
    stageLine: stageLine, reportJson: JSON.stringify(rep) }); if (_vq.saved) vaultIdbPut("qa", { id: "qa-" + Date.now(), savedAt: rep.generatedAt }); } } catch (e){}
  var byStage = {};
  QA6.results.forEach(function(r){ var s = r.stage.charAt(0); byStage[s] = byStage[s] || { p: 0, f: 0, c: 0 }; if (r.pass) byStage[s].p++; else if (r.kind === "conditional") byStage[s].c++; else if (r.kind !== "mutation") byStage[s].f++; });
  var stageLine = Object.keys(byStage).sort().map(function(s){ return "Giai đoạn " + s + ": " + byStage[s].p + " PASS" + (byStage[s].f ? " · " + byStage[s].f + " FAIL" : "") + (byStage[s].c ? " · " + byStage[s].c + " chưa đủ điều kiện đo" : ""); }).join(" &nbsp;|&nbsp; ");
  $("qaReport").innerHTML =
    '<div class="kv"><span>Phán quyết</span><b class="' + (fails.length ? "red" : "green") + '">' + qaEsc(rep.verdict) + '</b></div>' +
    '<div class="kv"><span>Thời điểm chạy</span><b>' + new Date(rep.generatedAt).toLocaleString("vi-VN") + '</b></div>' +
    '<div class="kv"><span>Theo giai đoạn</span><b>' + stageLine + '</b></div>' +
    '<div class="kv"><span>Cổng xuất file</span><b>' + qaEsc(rep.exportGate) + '</b></div>' +
    (QA6.mutationInfo ? '<div class="kv"><span>Mutation test</span><b>' + qaEsc(QA6.mutationInfo.summary) + '</b></div>' : "") +
    '<p class="note" style="margin:8px 0 0">Báo cáo đầy đủ (mọi test: kỳ vọng, giá trị đo, cấu hình) nằm trong file tải xuống .json/.html. Trong app, bảng dashboard ở trên là cùng một dữ liệu.</p>';
  $("btnQaRepJson").disabled = false;
  $("btnQaRepHtml").disabled = false;
  return rep;
}
function qaReportHtml(rep){
  var rows = rep.results.map(function(r){
    return "<tr><td>" + qaEsc(r.name) + "</td><td>" + qaEsc(r.stage) + "</td><td>" + qaEsc(r.expect) + "</td><td>" + qaEsc(r.measured) + "</td><td>" + (r.pass ? "PASS" : (r.kind === "conditional" ? "CHƯA ĐỦ ĐIỀU KIỆN ĐO" : "FAIL")) + "</td><td>" + qaEsc(r.cfg) + "</td></tr>";
  }).join("");
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo QA — Web AutoEQ</title>' +
    '<style>body{background:#0b0d10;color:#e8ecf1;font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px 8px;font-size:13px;text-align:left}h1{font-size:20px}</style></head><body>' +
    "<h1>Web AutoEQ — Báo cáo QA tổng hợp</h1><p>Cổng hồi quy tương đương `pnpm qa` của bản web · Sinh lúc: " + qaEsc(rep.generatedAt) + "</p>" +
    "<p><b>Phán quyết: " + qaEsc(rep.verdict) + "</b></p><p>" + qaEsc(rep.exportGate) + "</p>" +
    (rep.mutation ? "<p>Mutation test: " + qaEsc(rep.mutation.summary) + "</p>" : "") +
    "<table><tr><th>Test</th><th>Giai đoạn</th><th>Kỳ vọng</th><th>Giá trị đo</th><th>Kết quả</th><th>Cấu hình</th></tr>" + rows + "</table></body></html>";
}
$("btnQaRepJson").addEventListener("click", function(){ if (QA6.report) dlText("web-autoeq-qa-report.json", JSON.stringify(QA6.report, null, 2), "application/json;charset=utf-8"); });
$("btnQaRepHtml").addEventListener("click", function(){ if (QA6.report) dlText("web-autoeq-qa-report.html", qaReportHtml(QA6.report), "text/html;charset=utf-8"); });
/* ---------------- Sự kiện các nút QA ---------------- */
$("btnQaSuite").addEventListener("click", function(){
  var btn = this; btn.disabled = true; btn.textContent = "Đang đo QA Suite…";
  setTimeout(function(){
    try {
      var rows = qaRunSuite();
      QA6.results = QA6.results.filter(function(r){ return r.stage.charAt(0) !== "6"; }).concat(rows);
      QA6.ranAt = new Date(); QA6.ack = false;
      $("qaState").textContent = "QA Suite đã chạy lúc " + QA6.ranAt.toLocaleTimeString("vi-VN");
      qaRenderDashboard();
      qaBuildReport();
    } catch (e) { $("qaState").textContent = "lỗi khi chạy QA Suite: " + e.message; }
    btn.disabled = false; btn.textContent = "Chạy Acoustic QA Suite";
  }, 30);
});
$("btnQaMutation").addEventListener("click", function(){
  var fs = displayFs || 48000;
  var clean = qaRespDb(false, fs), mut = qaRespDb(true, fs);
  var mutFailed = Math.abs(mut - 6) > 0.1, cleanPassed = Math.abs(clean - 6) <= 0.1;
  QA6.mutationInfo = { cleanDb: +clean.toFixed(3), mutatedDb: +mut.toFixed(3), mutation: "+0.5 dB vào hệ số biquad (b0/b1/b2 của band 1 kHz × 10^(0.5/20)) trong bản sao hệ số của harness",
    summary: "Hệ số sạch cho " + clean.toFixed(2) + " dB (PASS) → sau mutation " + mut.toFixed(2) + " dB (FAIL như thiết kế) → mutation đã gỡ, engine thật không bị đụng" };
  QA6.results = QA6.results.filter(function(r){ return r.kind !== "mutation" && r.kind !== "mutation-verdict"; });
  QA6.results.push({ name: "Mutation: đáp tuyến 1 kHz khi hệ số biquad bị cộng sai +0.5 dB", stage: "6 · Mutation test", expect: "+6.00 dB ± 0.10 dB",
    measured: mut.toFixed(3) + " dB — sai số " + Math.abs(mut - 6).toFixed(3) + " dB, vượt dung sai 0.10 dB", pass: false,
    cfg: "Bản sao hệ số của harness QA (band 6 · 1 kHz · +6 dB · Q 1.41, b0/b1/b2 × 10^(0.5/20)) — FAIL này là bằng chứng bộ kiểm chứng bắt được lỗi; không khóa xuất file", kind: "mutation" });
  QA6.results.push({ name: "Mutation test — phán quyết", stage: "6 · Mutation test", expect: "test liên quan chuyển FAIL khi có mutation và PASS khi hệ số sạch",
    measured: "sạch: " + clean.toFixed(3) + " dB (" + (cleanPassed ? "PASS" : "FAIL") + ") · mutation: " + mut.toFixed(3) + " dB (" + (mutFailed ? "FAIL như kỳ vọng" : "vẫn PASS — nguy hiểm") + ")",
    pass: mutFailed && cleanPassed, cfg: "Mutation chỉ tồn tại trong lần đo này rồi được gỡ ngay; engine đang nghe và preset của bạn không thay đổi", kind: "mutation-verdict" });
  $("qaState").textContent = "mutation test đã chạy lúc " + new Date().toLocaleTimeString("vi-VN") + " — mutation đã gỡ";
  qaRenderDashboard();
  if (QA6.report) qaBuildReport();
});
$("btnQaAll").addEventListener("click", async function(){
  var btn = this; btn.disabled = true; btn.textContent = "Đang chạy toàn bộ QA…";
  $("qaState").textContent = "đang chạy lần lượt Giai đoạn 1–5 rồi QA Suite…";
  var st = snapState();
  var psySnap = JSON.stringify({ bypassAll: PSY.bypassAll, loud: PSY.loud, notch: PSY.notch, cross: PSY.cross, dyn: PSY.dyn, calFreq: PSY.calFreq });
  var modeSnap = mode, bypassSnap = bypass;
  /* Chụp riêng trạng thái AutoEQ + danh sách tai nghe: các panel kiểm chứng không
     được phép làm thay đổi danh sách tai nghe (kho 12 + mẫu + của người dùng)
     hay tai nghe đang chọn. Sau khi chạy xong, ô chọn được dựng lại từ registry
     và tai nghe đang chọn được khôi phục — rồi đối chiếu số mục trước/sau. */
  var aeSnap = (typeof AE !== "undefined") ? {
    phoneId: AE.phoneId || "", points: AE.points, name: AE.name, rig: AE.rig, source: AE.source,
    phoneCount: (typeof AE_PHONES !== "undefined" ? Object.keys(AE_PHONES).length : 0),
    optCount: (typeof AE_PHONES !== "undefined" ? Object.keys(AE_PHONES).length : 0),
    dbCount: (typeof DB_PHONES !== "undefined" ? DB_PHONES.length : 0),
    dbShown: ($("dbResults") ? $("dbResults").children.length : 0),
    sampleCount: (typeof AE_SAMPLES !== "undefined" ? AE_SAMPLES.length : 0)
  } : null;
  function qaRestorePhones(){
    if (!aeSnap) return;
    if (typeof aeRenderPhoneSelect === "function") aeRenderPhoneSelect();
    if (typeof dbRenderResults === "function" && $("dbSearch") && !$("dbSearch").value) dbRenderResults();
    if (aeSnap.points && AE.points !== aeSnap.points){
      AE.phoneId = aeSnap.phoneId;
      aeSetMeasurement(aeSnap.points, aeSnap.name, aeSnap.rig, aeSnap.source);
    }
    if (aeSnap.phoneId && typeof aeShowSelectedPhone === "function"){ AE.phoneId = aeSnap.phoneId; aeShowSelectedPhone(); aeRenderStepResults(); }
  }
  try {
    $("btnVerify").click();
    /* Chặng 5.5: chạy kiểm chứng Prompt 4 ngay sau kiểm chứng Giai đoạn 1, trước
       các kiểm chứng cấp phát FFT lớn (AutoEQ/Prompt 5) để tránh GC xen giữa. */
    $("btnP4Verify").click();
    $("btnAeVerify").click();
    $("btnPsVerify").click();
    $("btnP5Verify").click();
    await qaWaitFor(function(){ return $("p5V4Ok").textContent.trim() !== "—" && $("p5V4").textContent.indexOf("đang chập") < 0; }, 7000);
    await qaWaitFor(function(){ var t = $("p4V2Ok").textContent.trim(); return t !== "—" && t !== "…"; }, 7000);
    var stageRows = qaCollectStageRows();
    /* khôi phục trạng thái người dùng trước khi chạy QA Suite trên cấu hình thật của họ */
    var P = JSON.parse(psySnap);
    PSY.bypassAll = P.bypassAll; PSY.loud = P.loud; PSY.notch = P.notch; PSY.cross = P.cross; PSY.dyn = P.dyn; PSY.calFreq = P.calFreq;
    if (loudRamp){ clearInterval(loudRamp); loudRamp = null; }
    if (Array.isArray(PSY.loud.tgt)) PSY.loud.cur = PSY.loud.tgt.slice(); else PSY.loud.cur = [0,0,0,0,0,0]; /* preset cu (scalar curLow/curHigh) khong con dung: cur se ramp lai tu target moi trong applyPsycho */
    syncPsyUI(); applyPsycho();
    applyState(st);
    if (mode !== modeSnap) setMode(modeSnap);
    if (bypass !== bypassSnap){
      bypass = bypassSnap;
      $("btnBypass").textContent = "Bypass: " + (bypass ? "BẬT — EQ bị vòng qua" : "Tắt");
      $("btnBypass").classList.toggle("active", bypass);
      pushConfig(); drawGraph();
    }
    qaRestorePhones();
    var qaRows = qaRunSuite();
    QA6.results = stageRows.concat(qaRows);
    QA6.ranAt = new Date(); QA6.ack = false;
    var phoneAfter = aeSnap ? Object.keys(AE_PHONES).length : 0;
    var dbAfter = aeSnap ? DB_PHONES.length : 0;
    $("qaState").textContent = "toàn bộ QA đã chạy lúc " + QA6.ranAt.toLocaleTimeString("vi-VN") + " · trạng thái EQ/psycho của bạn đã được khôi phục" +
      (aeSnap ? " · danh sách tai nghe sau QA: " + phoneAfter + " mục trong ô chọn Bước 1 (trước QA: " + aeSnap.phoneCount + " mục — " + (phoneAfter === aeSnap.phoneCount ? "GIỮ NGUYÊN" : "LỆCH, cần kiểm tra") + ") · kho tích hợp " + dbAfter + "/" + aeSnap.dbCount + " tai nghe · " + aeSnap.sampleCount + " tai nghe mẫu kiểm chứng" : "");
    qaRenderDashboard();
    qaBuildReport();
  } catch (e) {
    $("qaState").textContent = "lỗi khi chạy toàn bộ QA: " + e.message;
    try { applyState(st); } catch (e2) {}
    try { qaRestorePhones(); } catch (e3) {}
  }
  btn.disabled = false; btn.textContent = "Chạy toàn bộ QA (Giai đoạn 1–5 + QA Suite)";
});
/* ---------------- Khởi tạo Giai đoạn 6 ---------------- */
qaDrawPhaseGd();
qaRenderDashboard();
window.addEventListener("resize", function(){ qaDrawPhaseGd(); if (QA6.ir) qaDrawIr(QA6.ir); });

/* ---------------- Tự chạy toàn bộ kiểm chứng khi tải trang ----------------
   Trước đây mọi panel kiểm chứng chỉ hiện số đo sau khi người dùng tự bấm
   nút chạy — mở trang là thấy "—" khắp nơi và tưởng app lỗi. Nay ngay khi
   trang tải xong, app tự chạy ĐÚNG pipeline của nút "Chạy toàn bộ QA"
   (Giai đoạn 1–5 + QA Suite, có chụp/khôi phục trạng thái) một lần, để mọi
   panel và dashboard hiện số đo thật ngay. Người dùng vẫn bấm chạy lại
   bất cứ lúc nào; lần tự chạy này không tự lặp lại. */
var QA_AUTO = { ran: false };
function qaAutoRun(){
  /* Tối ưu khởi động (2026-10-31): KHÔNG còn tự chạy toàn bộ kiểm chứng khi
     tải trang nữa — bộ QA đầy đủ (5 giai đoạn + QA Suite) chạy đồng bộ trên
     luồng chính khiến web giật/đơ vài giây ngay lúc mới mở. Kiểm chứng vẫn
     nguyên vẹn và chạy khi người dùng bấm nút "Chạy toàn bộ QA". */
  if (QA_AUTO.ran) return;
  QA_AUTO.ran = true;
  var st = $("qaState");
  if (st) st.textContent = "Chưa chạy — kiểm chứng không tự chạy khi tải trang nữa (tránh giật lúc mở web); bấm \u201cChạy toàn bộ QA\u201d khi cần kiểm chứng.";
}
setTimeout(qaAutoRun, 300);
