# Web AutoEQ — DSP Core & Headphone Optimization Studio

Ứng dụng tối ưu đáp tuyến tai nghe (AutoEQ PEQ 10/12/20 band, FIR Linear/Mixed Phase, Psychoacoustics ISO 226:2023, Studio Blind A/B/X, Kho 5.000 tai nghe thực & 11+ định dạng xuất), đã được tách mô-đun gọn nhẹ để dễ bảo trì và chạy kiểm định song song.

## Cấu trúc thư mục

- [`index.html`](./index.html) — Giao diện chính (mô-đun hoá, ~180 KB thay vì file đơn 5,8 MB).
- `styles/` — CSS giao diện chính (`main.css`), chế độ tinh gọn (`ux-compact.css`) và đồ thị ghim/dock (`graph-dock.css`).
- `data/headphone-db.js` — Kho dữ liệu 5.000 tai nghe thực đã kiểm định từ AutoEq / Squiglink.
- `src/` — Các mô-đun lõi theo từng giai đoạn:
  - `01-dsp-core.js` · `02-dsp-ui.js` — DSP Core RBJ `float64`, WASM SIMD/DF2T, AudioWorklet, Transport, RTA, L/R & Mid/Side.
  - `03-autoeq-solver.js` — Bộ giải tối ưu AutoEQ (`aeSolve`, `aeSolveSeeded`, Web Worker, Target Curves, Safety).
  - `04-psychoacoustics.js` — ISO 226:2023 Loudness, Ear-Canal Notch, Crossfeed, Dynamic EQ, HRTF/SOFA.
  - `05-studio-abx.js` — Studio UI 60fps, Solo, Undo/Redo, Phase/Group Delay, Blind A/B/X (BS.1770 LUFS).
  - `06-database-export.js` — Tìm kiếm kho tai nghe, IndexedDB/PWA, `hwSolve`, `geqFit`, 11+ định dạng xuất & WAV IR.
  - `07-qa-share.js` · `08-qa-suite.js` — Chia sẻ URL/QR & 57 bài kiểm chứng QA tự động.
  - `09-full-auto-dose.js` · `10-smart-autopilot.js` — Chế độ Tự Động Toàn Diện, Liều nghe tuần & Smart Auto-Pilot v2.
  - `src/upgrades/` — 6 khối nâng cấp chuyên sâu (Mic/ERB, Personal Target, Rig 5128/711, Decramped Biquad, ISO 226:2023, Harman 13-param).
  - `src/ui/` — Đồ thị ghim/dock, EQ chuẩn tối đa 1 chạm, shim tương thích & hàng đợi `AEOPT v1`.
- `docs/auto-audit-log.md` — Lưu trữ nguyên vẹn lịch sử nhật ký các vòng tối ưu tự động.
- `scripts/`
  - `scripts/build_single_file.js` — Đóng gói lại thành 1 file `.html` độc lập khi cần mang đi ngoại tuyến (`node scripts/build_single_file.js`).
  - `scripts/sweep/` — Pipeline quét kiểm định đa luồng `60.000` cặp (`5.000 tai nghe × 12 target`) dùng trên máy cục bộ hoặc GitHub Actions 20-shard Matrix (`.github/workflows/full-sweep-60k.yml`).

## Chạy Full Sweep `60.000` cặp

### Trên GitHub Actions (20-shard Matrix ~ 80 vCPU song song, ~18–28 phút)
Workflow `.github/workflows/full-sweep-60k.yml` tự động chia đều 5.000 tai nghe thành 20 shard đan xen (`interleaved modulo`), giải đa luồng trên từng runner, sau đó tổng hợp thành `sweep-results/REPORT.md`, `sweep-results/summary.json` và `sweep-results/results_all.jsonl.gz`.

### Chạy thử cục bộ bằng Node.js
```bash
node scripts/sweep/extract_core.js
node scripts/sweep/run_shard.js --shard 0 --shards 1 --start-phone 0 --end-phone 10 --mode 10
node scripts/sweep/aggregate_results.js --expected-pairs 120
```