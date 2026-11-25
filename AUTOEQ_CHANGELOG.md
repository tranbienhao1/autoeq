# AutoEQ Autonomous Optimization Changelog

Nhật ký chính thức cho vòng lặp tự hành chu kỳ 30 phút (`*/30 * * * *`) kết hợp nhịp nối đuôi 1 phút (`DurationSeconds=60`, tối đa 3 bước) trên nhánh `autoeq-autopilot` của `https://github.com/tranbienhao1/autoeq`.

> **Lưu ý kế thừa lịch sử:** Các vòng kiểm toán và sửa lỗi trước đó (Chặng 1–5 và Vòng #1–#2 tại các commit `38fb27c`, `d2d12cc`) được lưu chi tiết tại [`docs/auto-audit-log.md`](docs/auto-audit-log.md).

---

## Baseline — Cycle #0 (`HEAD d2d12cc`) — 2026-11-25T18:14:28.905Z

- **Git Head:** `d2d12cc738434d3b739b8fea771a7505202c0508` (`autoeq-autopilot`)
- **Source & Solver Core MD5:** HTML `a742abde45ec34b25fe88828130d1d01` · Solver Core `09b8181545c569550fd06e7d18254ee7`
- **Verification Gate Baseline Metrics:**
  - **Tier 1 (Syntax, LF, Bundles):** 29/29 JS/CJS files clean (`node --check`: `src/` 20, `data/` 1, `scripts/` 6, `tests/` 2), LF enforced, `extract_core.js` (`5000` headphones, `0` rejected, `12` targets), `build_single_file.js` (`ok: true`).
  - **Tier 2 (`node --test tests/*.test.cjs`):** System contract suite + DSP/RBJ/Jury/Anti-Clipping/Parser/12-Target suite.
  - **Tier 3 (`AE_SAMPLES` 36 pairs, `--mode 10`):** `rmsBeforeMean: 4.1293 dB` → `rmsAfterMean: 0.1107 dB` (`max: 0.191 dB`), `violations: 0`, `nullBoosts: 0`.
  - **Tier 3 (Stratified DB 600 pairs, `--shards 100 --shard 0 --mode 10`):** `rmsBeforeMean: 4.947 dB` → `rmsAfterMean: 0.3347 dB` (`median: 0.346 dB`, `p95: 0.4886 dB`, `max: 0.5897 dB`), `totalViolations: 0`, `totalNullBoosts: 0`, `duplicates: 0`.
  - **Historical Reference (`.cache/sweep-results/summary.json`, Shards 0–2, 9,000 pairs on earlier `e5a65034...`):** `rmsBeforeMean: 5.0547 dB` → `rmsAfterMean: 0.3424 dB`, `totalViolations: 0`, `totalNullBoosts: 0`.

---

## Template Ghi Nhận Chu Kỳ Mới (`Cycle #N`)

```markdown
## Cycle #N — <YYYY-MM-DDTHH:MM:SSZ> (<PHASE>)

- **Git Head (Before -> After):** `<sha_before>` -> `<sha_after>`
- **Chained Steps Used:** `<1..3>` / 3 (reset `chained_step_count = 0`)
- **Hypothesis / Target:** <Mô tả giả thuyết hoặc lỗi gốc rễ>
- **Root Cause & Changes:**
  - `<file>`: <tóm tắt chỉnh sửa>
- **Before vs After Metrics (Verification Gate):**
  - `AE_SAMPLES` (36 pairs): `rmsAfterMean` `<before>` -> `<after>` dB (`violations: 0`, `nullBoosts: 0`)
  - `Stratified DB` (600 pairs): `rmsAfterMean` `<before>` -> `<after>` dB, `p95` `<before>` -> `<after>` dB (`violations: 0`, `nullBoosts: 0`)
  - `node --test tests/*.test.cjs`: `<pass>/<total>` PASS
- **Status:** `PASSED & COMMITTED` | `ROLLED BACK`
```
