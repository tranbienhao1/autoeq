---
description: Quy tắc tự hành vĩnh viễn chu kỳ 30 phút & nối đuôi 1 phút cho dự án Web AutoEQ (tranbienhao1/autoeq)
globs: "**/*"
alwaysApply: true
---

# QUY TẮC VẬN HÀNH TỰ ĐỘNG 24/7 (`tranbienhao1/autoeq`, nhánh `autoeq-autopilot`)

1. **Chế độ Thực Thi Không Gián Đoạn & Nối Đuôi 1 Phút (`Zero-Stop + 60s Tail-Chaining`):**
   - Luôn tự động chạy kiểm tra cú pháp, unit test (`node --test`), Verification Gate (`node scripts/verify_autoeq.js`) và `git commit` + `git push origin HEAD` trên nhánh `autoeq-autopilot` (KHÔNG checkout `main`).
   - Tuyệt đối KHÔNG dùng lệnh `sleep` trong bash/terminal để chờ. Mọi nhịp chờ hậu kiểm bắt buộc dùng công cụ `schedule` gốc của Antigravity:
     - Chu kỳ chính 30 phút: `CronExpression="*/30 * * * *"`, `IsDaemon=true`.
     - Nhịp nối đuôi 1 phút: `DurationSeconds=60`, `TimerCondition="never"` (hoặc `<task_id>` nếu đợi tiến trình benchmark chạy nền hoàn tất), tối đa **3 nhịp nối đuôi liên tiếp** (`chained_step_count <= 3`) trong mỗi chu kỳ 30 phút, rồi kết thúc lượt ngay để hệ thống đánh thức phản hồi.

2. **Phạm Vi Module & Ràng Buộc Môi Trường Bắt Buộc:**
   - **Phạm vi làm việc:** Chỉ chỉnh sửa các module AutoEQ thuộc `src/`, `src/upgrades/`, `src/ui/`, `data/`, `scripts/`, `tests/`, `styles/`, `index.html`, `.agent/`, `.antigravity/autoeq_loop_state.json`, `AUTOEQ_CHANGELOG.md`, và `docs/auto-audit-log.md`. Giữ nguyên tệp stub chuyển hướng 12 dòng `Web AutoEQ - DSP Core.html`.
   - **Kiến trúc Zero-Dependency:** TUYỆT ĐỐI KHÔNG tạo `package.json`, không sinh `node_modules/` và không cài bất kỳ gói npm ngoài nào. Chỉ dùng Node.js built-ins (`node --test`, `node --check`, `node:vm`, `node:fs`, `node:path`, `node:child_process`, `node:assert/strict`).
   - **Bắt buộc xuống dòng LF (`\n`):** Mọi tệp trong repo phải dùng ký tự xuống dòng LF (`\n`, `git config core.autocrlf false`). `scripts/sweep/extract_core.js` cắt mã từ `src/06-database-export.js` theo chuỗi mốc chứa `\n` nguyên bản (`/* ================================================================\n   Chặng 2 bước 2.2`).
   - **Công cụ Windows:** Luôn dùng `node` cho mọi script kiểm thử và máy chủ HTTP tĩnh cục bộ; KHÔNG gọi `python` / `python3` (chỉ là stub Microsoft Store trên Windows).

3. **Chuẩn Kỹ Thuật DSP & Chống Vỡ Tiếng (`Audio & AutoEQ Invariants`):**
   - **Toán học DSP & Ổn định bộ lọc:** Hệ số biquad (`rbjCoeffs`, `upDecrampedPeakingCoeffs`) phải hữu hạn (không `NaN`/`Inf`), đạt điều kiện ổn định Jury (`|pole| < 1`: `|a2| < 1` và `|a1| < 1 + a2`), và nhất quán giữa các sample rate `44.1 / 48 / 88.2 / 96 kHz` (bao gồm kiểm soát frequency cramping gần Nyquist).
   - **Chống vỡ tiếng kỹ thuật số (`Anti-Clipping`):** Tổng đỉnh cộng hưởng dương lớn nhất cộng preamp phải thỏa `max_composite_gain + preamp <= -0.2 dBFS` (mặc định `CEIL_DB = -1.0 dBFS` trong `src/01-dsp-core.js`).
   - **Dữ liệu đo & Target Curves:** `aeParseMeasurement` / `dbParseMeasurement` phải chuẩn hóa mốc `1 kHz`, sắp xếp tăng dần và gộp trùng tần số, xử lý tách kênh L/R & M/S an toàn, nhận diện đúng coupler `711` vs `B&K 5128` (`upNormalizeRig`/`upRigCheck`), và đảm bảo hội tụ sạch trên toàn bộ 12 `AE_TARGETS` + tùy chỉnh `Tilt` / `Bass Shelf` / `Ear-Gain`.

4. **Cổng Kiểm Chứng 3 Tầng & Tự Phục Hồi (`3-Tier Verification Gate & Rollback`):**
   - Trước mọi commit, bắt buộc chạy `node scripts/verify_autoeq.js` (Tầng 1: `node --check` + LF + `extract_core.js` + `build_single_file.js`; Tầng 2: `node --test tests/*.test.cjs`; Tầng 3: benchmark `AE_SAMPLES` 36 cặp + DB phân tầng 600 cặp với `totalViolations === 0`, `totalNullBoosts === 0`, RMSE hữu hạn không suy giảm).
   - Nếu thất bại và sau 2 lần tự sửa vẫn chưa đạt 100% PASS: hoàn tác sạch mã nguồn bằng `git checkout -- src/ styles/ data/ scripts/ index.html`, ghi nhận nguyên nhân vào `.antigravity/autoeq_loop_state.json` (`tested_hypotheses`) và chuyển sang mục tiêu tiếp theo.
