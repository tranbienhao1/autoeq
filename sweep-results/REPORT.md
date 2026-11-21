# Báo cáo Tổng kết Full Sweep Web AutoEQ (`60.000` cặp = `5.000` tai nghe × `12` target)

- **Thời điểm hoàn tất**: `2026-11-21T21:31:07.565Z`
- **Phiên bản mã nguồn**: HTML MD5 `2b7a4ea66a9dda4ea63255916b43182c` · Solver Core MD5 `e5a6503409d3acb8e83f2c390a0876f9` · Chế độ: `bestof`
- **Hạ tầng song song**: `40` shards · Shard lâu nhất: `5992.93s` (~99.9 phút) · Tổng thời gian shard gộp: `186805.13s`
- **Tổng số cặp đã giải**: **`60,000`** (`5000/5000` tai nghe đủ 12/12 target)
- **Phân bố số band được chọn**: 10 band: 931 (1.6%) · 12 band: 4,857 (8.1%) · 20 band: 54,212 (90.4%)
- **Kiểm định an toàn**: Vi phạm giới hạn = **`0`** · Null-boost = **`0`** · Trùng lặp = **`0`**
- **Dữ liệu nén**: `results_all.jsonl.gz` (`12.65 MB`) · Bảng tổng hợp 5.000 tai nghe: `all_phones_summary.csv`

## 1. Thống kê sai số khớp mục tiêu (RMS dB)

| Tập dữ liệu | Số cặp | RMS Trung bình | Trung vị (p50) | p90 | p95 | p99 | Tốt nhất (Min) | Tệ nhất (Max) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Trước EQ (`rmsBefore`)** | 60000 | 5.1346 dB | 4.6674 dB | 8.1394 dB | 9.4938 dB | 13.3384 dB | 0.9099 dB | 28.5695 dB |
| **Sau EQ — Toàn bộ (`0..4999`)** | **60000** | **0.1818 dB** | **0.1579 dB** | **0.3024 dB** | **0.359 dB** | **0.491 dB** | **0.0359 dB** | **1.5191 dB** |
| Phân đoạn đầu (`0..1562`) | 18756 | 0.1829 dB | 0.1621 dB | 0.2995 dB | 0.3519 dB | 0.4666 dB | 0.0385 dB | 1.3387 dB |
| **Phần còn lại (`1563..4999`)** | **41244** | **0.1813 dB** | **0.1559 dB** | **0.3038 dB** | **0.3624 dB** | **0.5083 dB** | **0.0359 dB** | **1.5191 dB** |

- **Cặp khớp tốt nhất**: `#2837 InAwaken Dawn × ief` (`3.64751 → 0.035878 dB`)
- **Cặp khó nhất toàn cục**: `#2210 Creative Outlier Free Pro Plus × soundguys` (`24.986434 → 1.51905 dB`)

## 2. Phân tích theo Loại tai nghe (`type`)

| Loại tai nghe | Số cặp | RMS Trung bình | Trung vị | p95 | Max |
|---|---:|---:|---:|---:|---:|
| **In-ear** | 34416 | 0.1438 dB | 0.1274 dB | 0.2705 dB | 1.5191 dB |
| **Over-ear** | 24168 | 0.2325 dB | 0.2097 dB | 0.4097 dB | 1.3551 dB |
| **Earbud** | 1416 | 0.2419 dB | 0.2041 dB | 0.5444 dB | 1.104 dB |

## 3. Phân tích theo Đường mục tiêu (`target`)

| Target | Số cặp | RMS Trung bình | Trung vị | p95 | Max |
|---|---:|---:|---:|---:|---:|
| `harmanOE` | 5000 | 0.179 dB | 0.1554 dB | 0.3556 dB | 1.2469 dB |
| `harmanIE` | 5000 | 0.1828 dB | 0.1583 dB | 0.3643 dB | 1.3551 dB |
| `ief` | 5000 | 0.1808 dB | 0.1578 dB | 0.3588 dB | 1.2229 dB |
| `jm1` | 5000 | 0.1906 dB | 0.1659 dB | 0.3742 dB | 1.3174 dB |
| `diffuseField` | 5000 | 0.1859 dB | 0.1618 dB | 0.3623 dB | 1.2452 dB |
| `diffuseFieldKemar` | 5000 | 0.1868 dB | 0.1627 dB | 0.3593 dB | 1.2611 dB |
| `freeField` | 5000 | 0.1916 dB | 0.1695 dB | 0.3625 dB | 1.2067 dB |
| `harmanOE2013` | 5000 | 0.1758 dB | 0.1508 dB | 0.3472 dB | 1.2549 dB |
| `harmanOE2015` | 5000 | 0.1766 dB | 0.1524 dB | 0.352 dB | 1.1924 dB |
| `oratoryOptimum` | 5000 | 0.1724 dB | 0.1497 dB | 0.3444 dB | 1.2039 dB |
| `rtings` | 5000 | 0.177 dB | 0.1509 dB | 0.3564 dB | 1.2088 dB |
| `soundguys` | 5000 | 0.1827 dB | 0.1599 dB | 0.3621 dB | 1.5191 dB |

## 4. Top 15 Tai nghe có RMS trung bình cao nhất (Đầu vào phục vụ nâng cấp `[L2]`)

| # | PhoneIdx | Tai nghe | Loại | RMS TB (12 target) | RMS Tệ nhất | Target tệ nhất |
|---:|---:|---|---|---:|---:|---|
| 1 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | 1.1876 dB | 1.3387 dB | `soundguys` |
| 2 | 1898 | Auribus Acoustics Sierra Open | Over-ear | 1.1761 dB | 1.3551 dB | `harmanIE` |
| 3 | 2106 | Cambridge Audio Melomania P100 (ANC off) | Over-ear | 1.0827 dB | 1.3174 dB | `jm1` |
| 4 | 4896 | ZMF Auteur Classic (ZMF Caldera hybrid earpads) | Over-ear | 1.0537 dB | 1.2549 dB | `harmanOE2013` |
| 5 | 1984 | Beyerdynamic T50p (serial number 16912) | Over-ear | 1.0421 dB | 1.2806 dB | `harmanIE` |
| 6 | 2210 | Creative Outlier Free Pro Plus | In-ear | 1.0349 dB | 1.5191 dB | `soundguys` |
| 7 | 4835 | Yamaha YH-5000SE (suede earpads) | Over-ear | 0.977 dB | 1.0748 dB | `harmanOE2015` |
| 8 | 2388 | Edifier WH950NB (ANC on, classic mode) | Over-ear | 0.9718 dB | 1.0514 dB | `harmanOE2015` |
| 9 | 2390 | Edifier WH950NB (ANC on, dynamic mode) | Over-ear | 0.9639 dB | 1.1028 dB | `harmanOE2015` |
| 10 | 3411 | Moondrop Para (fenestrated PU earpads) | Over-ear | 0.9233 dB | 1.0268 dB | `diffuseFieldKemar` |
| 11 | 4030 | Sennheiser PXC 350 | Over-ear | 0.9212 dB | 1.1509 dB | `rtings` |
| 12 | 4171 | Skullcandy SkullCrushers Max Bass | Over-ear | 0.8267 dB | 1.2014 dB | `ief` |
| 13 | 3971 | Sennheiser HD 490 Pro (mixing earpads) | Over-ear | 0.825 dB | 0.8863 dB | `soundguys` |
| 14 | 2595 | Fostex T50RP Mk4 | Over-ear | 0.8082 dB | 0.8285 dB | `ief` |
| 15 | 1277 | Sivga Anser | Over-ear | 0.8033 dB | 0.8972 dB | `harmanOE` |

## 5. Top 20 Cặp `(Tai nghe × Target)` dư sai cao nhất toàn cục

| # | PhoneIdx | Tai nghe | Loại | Target | Trước EQ | Sau EQ | Thời gian |
|---:|---:|---|---|---|---:|---:|---:|
| 1 | 2210 | Creative Outlier Free Pro Plus | In-ear | `soundguys` | 24.986434 dB | **1.51905 dB** | 13559 ms |
| 2 | 1898 | Auribus Acoustics Sierra Open | Over-ear | `harmanIE` | 5.542469 dB | **1.355109 dB** | 18078 ms |
| 3 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `soundguys` | 4.836788 dB | **1.338744 dB** | 32299 ms |
| 4 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `harmanIE` | 4.506853 dB | **1.32302 dB** | 35108 ms |
| 5 | 2106 | Cambridge Audio Melomania P100 (ANC off) | Over-ear | `jm1` | 7.462137 dB | **1.317443 dB** | 33882 ms |
| 6 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `jm1` | 5.820005 dB | **1.31617 dB** | 38127 ms |
| 7 | 1984 | Beyerdynamic T50p (serial number 16912) | Over-ear | `harmanIE` | 8.996926 dB | **1.280575 dB** | 36981 ms |
| 8 | 2210 | Creative Outlier Free Pro Plus | In-ear | `diffuseFieldKemar` | 20.626104 dB | **1.261145 dB** | 15451 ms |
| 9 | 4896 | ZMF Auteur Classic (ZMF Caldera hybrid earpads) | Over-ear | `harmanOE2013` | 7.491271 dB | **1.2549 dB** | 14806 ms |
| 10 | 1984 | Beyerdynamic T50p (serial number 16912) | Over-ear | `harmanOE` | 7.923519 dB | **1.246941 dB** | 55388 ms |
| 11 | 1898 | Auribus Acoustics Sierra Open | Over-ear | `diffuseField` | 3.909796 dB | **1.245194 dB** | 20708 ms |
| 12 | 1984 | Beyerdynamic T50p (serial number 16912) | Over-ear | `soundguys` | 7.999969 dB | **1.239624 dB** | 43265 ms |
| 13 | 1984 | Beyerdynamic T50p (serial number 16912) | Over-ear | `ief` | 6.529803 dB | **1.222865 dB** | 37311 ms |
| 14 | 1898 | Auribus Acoustics Sierra Open | Over-ear | `harmanOE` | 4.54261 dB | **1.216739 dB** | 17865 ms |
| 15 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `diffuseFieldKemar` | 7.273403 dB | **1.214465 dB** | 38610 ms |
| 16 | 1898 | Auribus Acoustics Sierra Open | Over-ear | `rtings` | 2.287698 dB | **1.208786 dB** | 22777 ms |
| 17 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `freeField` | 7.453905 dB | **1.206734 dB** | 29816 ms |
| 18 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `oratoryOptimum` | 5.692462 dB | **1.203949 dB** | 30519 ms |
| 19 | 2106 | Cambridge Audio Melomania P100 (ANC off) | Over-ear | `freeField` | 9.274784 dB | **1.202348 dB** | 41993 ms |
| 20 | 4171 | Skullcandy SkullCrushers Max Bass | Over-ear | `ief` | 7.142392 dB | **1.201375 dB** | 40613 ms |
