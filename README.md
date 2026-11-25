# Web AutoEQ - DSP Core (bản đa file)

Tách từ bản 1 file HTML ngày 2026-11-24. Mở `index.html` trong thư mục này
(giữ nguyên cấu trúc thư mục) — chạy offline bằng file:// như bản cũ.

## Cấu trúc
- `index.html` — khung trang + thẻ script/link trỏ tới file phụ
- `css/app.css` — toàn bộ style (gộp 3 khối style gốc theo đúng thứ tự)
- `js/01-engine.js` — Engine AudioWorklet, RBJ, float64 (khối Giai đoạn 1)
- `js/02-ui-core.js` — UI band strips, đồ thị, meters
- `js/03-solver.js` — AutoEQ solver & Target Curve (Giai đoạn 2)
- `js/04-psychoacoustics.js` — ISO 226 loudness (Giai đoạn 3)
- `js/05-studio-ui.js` — Studio UI 60fps & Blind A/B/X (Giai đoạn 4)
- `js/06-data-db.js` — dữ liệu đo tai nghe (giải mã từ data-URI, 1,8 MB)
- `js/07-database.js` — Database & Universal Export (Giai đoạn 5)
- `js/08-qa.js` — QA Suite phase/GD + dashboard (Giai đoạn 6)
- `js/09-auto.js` — Chế độ Tự Động Toàn Diện
- `js/10-autopilot.js` — Smart Auto-Pilot v2
- `js/11-upgrades.js` — Nâng cấp Khối 1–6 (mic cal, target cá nhân, 5128/711, decramped biquad, ISO 226:2023, Harman IE 13)
- `js/12-dock-layout.js` — Bố cục cạnh đồ thị
- `js/13-eq-max.js` — EQ chuẩn xác tối đa + shim + AEOPT

Thứ tự nạp script trong index.html giữ nguyên thứ tự thực thi của bản 1 file.
Mỗi file JS bắt đầu bằng dòng comment ghi nguồn (khối script gốc).
