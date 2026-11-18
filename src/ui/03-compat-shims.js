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
