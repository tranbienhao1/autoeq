# Báo cáo Tổng kết Full Sweep Web AutoEQ (`60.000` cặp = `5.000` tai nghe × `12` target)

- **Thời điểm hoàn tất**: `2026-11-18T04:28:40.818Z`
- **Phiên bản mã nguồn**: HTML MD5 `2b7a4ea66a9dda4ea63255916b43182c` · Solver Core MD5 `e5a6503409d3acb8e83f2c390a0876f9` · Chế độ: `10`
- **Hạ tầng song song**: `20` shards · Shard lâu nhất: `860.13s` (~14.3 phút) · Tổng thời gian shard gộp: `13633.22s`
- **Tổng số cặp đã giải**: **`60,000`** (`5000/5000` tai nghe đủ 12/12 target)
- **Kiểm định an toàn**: Vi phạm giới hạn = **`0`** · Null-boost = **`0`** · Trùng lặp = **`0`**
- **Dữ liệu nén**: `results_all.jsonl.gz` (`7.32 MB`)

## 1. Thống kê sai số khớp mục tiêu (RMS dB)

| Tập dữ liệu | Số cặp | RMS Trung bình | Trung vị (p50) | p90 | p95 | p99 | Tốt nhất (Min) | Tệ nhất (Max) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Trước EQ (`rmsBefore`)** | 60000 | 5.1346 dB | 4.6674 dB | 8.1394 dB | 9.4938 dB | 13.3384 dB | 0.9099 dB | 28.5695 dB |
| **Sau EQ — Toàn bộ (`0..4999`)** | **60000** | **0.3397 dB** | **0.3415 dB** | **0.4787 dB** | **0.4947 dB** | **0.697 dB** | **0.0605 dB** | **2.1031 dB** |
| Phân đoạn đầu (`0..1562`) | 18756 | 0.34 dB | 0.3443 dB | 0.4778 dB | 0.4939 dB | 0.6284 dB | 0.0605 dB | 1.425 dB |
| **Phần còn lại (`1563..4999`)** | **41244** | **0.3395 dB** | **0.3404 dB** | **0.4792 dB** | **0.4952 dB** | **0.7294 dB** | **0.0619 dB** | **2.1031 dB** |

- **Cặp khớp tốt nhất**: `#1329 Astell & Kern AURA × soundguys` (`1.986088 → 0.060495 dB`)
- **Cặp khó nhất toàn cục**: `#2210 Creative Outlier Free Pro Plus × oratoryOptimum` (`21.991269 → 2.103055 dB`)

## 2. Phân tích theo Loại tai nghe (`type`)

| Loại tai nghe | Số cặp | RMS Trung bình | Trung vị | p95 | Max |
|---|---:|---:|---:|---:|---:|
| **In-ear** | 34416 | 0.2971 dB | 0.2897 dB | 0.4741 dB | 2.1031 dB |
| **Over-ear** | 24168 | 0.3943 dB | 0.4012 dB | 0.5266 dB | 1.427 dB |
| **Earbud** | 1416 | 0.4419 dB | 0.4203 dB | 0.8515 dB | 1.5879 dB |

## 3. Phân tích theo Đường mục tiêu (`target`)

| Target | Số cặp | RMS Trung bình | Trung vị | p95 | Max |
|---|---:|---:|---:|---:|---:|
| `harmanOE` | 5000 | 0.3407 dB | 0.3423 dB | 0.4962 dB | 1.8527 dB |
| `harmanIE` | 5000 | 0.3418 dB | 0.3445 dB | 0.497 dB | 1.6785 dB |
| `ief` | 5000 | 0.3405 dB | 0.3424 dB | 0.4941 dB | 1.973 dB |
| `jm1` | 5000 | 0.353 dB | 0.357 dB | 0.4955 dB | 1.8036 dB |
| `diffuseField` | 5000 | 0.3447 dB | 0.3448 dB | 0.4943 dB | 1.7404 dB |
| `diffuseFieldKemar` | 5000 | 0.3446 dB | 0.3475 dB | 0.4941 dB | 1.3304 dB |
| `freeField` | 5000 | 0.3528 dB | 0.358 dB | 0.4956 dB | 1.6743 dB |
| `harmanOE2013` | 5000 | 0.3274 dB | 0.3237 dB | 0.4927 dB | 1.8692 dB |
| `harmanOE2015` | 5000 | 0.3305 dB | 0.3297 dB | 0.4929 dB | 1.9138 dB |
| `oratoryOptimum` | 5000 | 0.3259 dB | 0.3256 dB | 0.4919 dB | 2.1031 dB |
| `rtings` | 5000 | 0.333 dB | 0.3347 dB | 0.4958 dB | 1.7895 dB |
| `soundguys` | 5000 | 0.341 dB | 0.3437 dB | 0.4957 dB | 1.8599 dB |

## 4. Top 15 Tai nghe có RMS trung bình cao nhất (Đầu vào phục vụ nâng cấp `[L2]`)

| # | PhoneIdx | Tai nghe | Loại | RMS TB (12 target) | RMS Tệ nhất | Target tệ nhất |
|---:|---:|---|---|---:|---:|---|
| 1 | 2210 | Creative Outlier Free Pro Plus | In-ear | 1.799 dB | 2.1031 dB | `oratoryOptimum` |
| 2 | 2670 | Haylou PurFree Buds | In-ear | 1.2555 dB | 1.3967 dB | `freeField` |
| 3 | 4057 | Shokz OpenRun Pro | Earbud | 1.2382 dB | 1.5879 dB | `harmanIE` |
| 4 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | 1.2297 dB | 1.425 dB | `jm1` |
| 5 | 1898 | Auribus Acoustics Sierra Open | Over-ear | 1.2042 dB | 1.427 dB | `harmanOE` |
| 6 | 2106 | Cambridge Audio Melomania P100 (ANC off) | Over-ear | 1.1325 dB | 1.3911 dB | `jm1` |
| 7 | 4056 | Shokz OpenRun | Earbud | 1.1249 dB | 1.4129 dB | `ief` |
| 8 | 1678 | AfterShokz Trekz Air | Earbud | 1.0826 dB | 1.2168 dB | `harmanOE` |
| 9 | 4171 | Skullcandy SkullCrushers Max Bass | Over-ear | 1.0666 dB | 1.3398 dB | `harmanOE` |
| 10 | 4896 | ZMF Auteur Classic (ZMF Caldera hybrid earpads) | Over-ear | 1.0557 dB | 1.2549 dB | `harmanOE2013` |
| 11 | 1984 | Beyerdynamic T50p (serial number 16912) | Over-ear | 1.045 dB | 1.2856 dB | `harmanIE` |
| 12 | 2388 | Edifier WH950NB (ANC on, classic mode) | Over-ear | 1.026 dB | 1.3318 dB | `oratoryOptimum` |
| 13 | 4030 | Sennheiser PXC 350 | Over-ear | 1.0029 dB | 1.2133 dB | `rtings` |
| 14 | 4835 | Yamaha YH-5000SE (suede earpads) | Over-ear | 0.9998 dB | 1.1467 dB | `harmanOE2013` |
| 15 | 2390 | Edifier WH950NB (ANC on, dynamic mode) | Over-ear | 0.9933 dB | 1.1101 dB | `harmanOE2015` |

## 5. Top 20 Cặp `(Tai nghe × Target)` dư sai cao nhất toàn cục

| # | PhoneIdx | Tai nghe | Loại | Target | Trước EQ | Sau EQ | Thời gian |
|---:|---:|---|---|---|---:|---:|---:|
| 1 | 2210 | Creative Outlier Free Pro Plus | In-ear | `oratoryOptimum` | 21.991269 dB | **2.103055 dB** | 3270 ms |
| 2 | 2210 | Creative Outlier Free Pro Plus | In-ear | `ief` | 23.85056 dB | **1.972998 dB** | 3283 ms |
| 3 | 2210 | Creative Outlier Free Pro Plus | In-ear | `harmanOE2015` | 24.111061 dB | **1.913763 dB** | 2376 ms |
| 4 | 2210 | Creative Outlier Free Pro Plus | In-ear | `harmanOE2013` | 23.228933 dB | **1.869231 dB** | 3417 ms |
| 5 | 2210 | Creative Outlier Free Pro Plus | In-ear | `soundguys` | 24.986434 dB | **1.859885 dB** | 5321 ms |
| 6 | 2210 | Creative Outlier Free Pro Plus | In-ear | `harmanOE` | 25.814722 dB | **1.852747 dB** | 3482 ms |
| 7 | 2210 | Creative Outlier Free Pro Plus | In-ear | `jm1` | 22.796177 dB | **1.803559 dB** | 2883 ms |
| 8 | 2210 | Creative Outlier Free Pro Plus | In-ear | `rtings` | 23.782955 dB | **1.789502 dB** | 3310 ms |
| 9 | 2210 | Creative Outlier Free Pro Plus | In-ear | `diffuseField` | 20.512006 dB | **1.740417 dB** | 3507 ms |
| 10 | 2210 | Creative Outlier Free Pro Plus | In-ear | `harmanIE` | 26.722385 dB | **1.678503 dB** | 2455 ms |
| 11 | 2210 | Creative Outlier Free Pro Plus | In-ear | `freeField` | 20.888305 dB | **1.674299 dB** | 4412 ms |
| 12 | 4057 | Shokz OpenRun Pro | Earbud | `harmanIE` | 22.357011 dB | **1.587884 dB** | 3146 ms |
| 13 | 4057 | Shokz OpenRun Pro | Earbud | `soundguys` | 20.682543 dB | **1.51524 dB** | 7006 ms |
| 14 | 1898 | Auribus Acoustics Sierra Open | Over-ear | `harmanOE` | 4.54261 dB | **1.427025 dB** | 3457 ms |
| 15 | 1438 | Cambridge Audio Melomania P100 (ANC on) | Over-ear | `jm1` | 5.820005 dB | **1.425048 dB** | 6996 ms |
| 16 | 4056 | Shokz OpenRun | Earbud | `ief` | 23.74903 dB | **1.412924 dB** | 1882 ms |
| 17 | 4057 | Shokz OpenRun Pro | Earbud | `rtings` | 19.342494 dB | **1.403934 dB** | 4286 ms |
| 18 | 4057 | Shokz OpenRun Pro | Earbud | `jm1` | 18.596414 dB | **1.396823 dB** | 2474 ms |
| 19 | 2670 | Haylou PurFree Buds | In-ear | `freeField` | 14.283776 dB | **1.396689 dB** | 6228 ms |
| 20 | 2106 | Cambridge Audio Melomania P100 (ANC off) | Over-ear | `jm1` | 7.462137 dB | **1.391065 dB** | 6021 ms |
