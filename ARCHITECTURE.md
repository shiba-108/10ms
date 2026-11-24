Nền tảng 10ms — 1 trang

1. Ba lớp, một chiều

| Lớp | Vai trò | Vào | Ra | Cấm |
|---|---|---|---|---|
| Lõi (core) | Parser + checker, thuần | chữ .10ms | cây (AST) hoặc lỗi JSON (D13) | I/O, @, import host |
| Host (worker) | Chạy cây trên Cloudflare Worker | cây + request | response + sổ @ (D15) | tự parse, sửa cây |
| Gương (mirror) | Dịch cây ra tiếng người | cây | chữ đọc được | chạy, sửa, ghi |

Phụ thuộc một chiều: host → core, mirror → core. Không bao giờ ngược lại. Lõi không biết host là Worker; host không biết gương tồn tại.

2. Cấu trúc folder


src/
  core/                # LÕI — thuần, zero import
    lex.js             # chữ → token
    parse.js           # token → cây   (D16 Intent)
    canon.js           # D12: sai → lỗi + bản chuẩn duy nhất
    type.js            # D13: need thiếu/sai → lỗi JSON + bản vá + seed
    cost.js            # D14: mọi vòng lặp có chặn, tính cận trên CPU
    seal.js            # D18: băm nguồn → seal
  host/
    host.js            # giao diện host chung (để P7 Everywhere)
    worker/
      index.js         # fetch() → route theo các "on"
      run.js           # thi hành cây
      effects.js       # @store @net @time @rand  (D15)
      log.js           # ghi sổ hiệu ứng, replay
  mirror/
    text.js            # D21: cây → tiếng người, chỉ đọc
examples/
  web.10ms             # ví dụ Web trong SPEC
  worker.10ms          # ví dụ Worker trong SPEC
tests/
  core/                # unit từng file lõi
  host/                # chạy 2 examples trên Worker giả lập
  first-try/           # D19: AI mới chỉ đọc SPEC, đo % chạy đúng lần đầu
  fixtures/            # input → output cố định, khoá bằng hash (P4)


Không thêm thư mục nào khác. Muốn thêm file, phải xoá được một file khác .

3. Ba cửa merge

Mọi PR — core, host, mirror, example, test — phải qua đủ ba cửa mới được merge.

| # | Cửa | Đo bằng | Fail = |
|---|---|---|---|
| 1 | Chạy được | tests/ xanh, examples/*.10ms chạy được | đóng PR |
| 2 | CPU < 10ms | cost.js chứng minh cận trên ≤ 10ms; đo p50/p90 | không merge (P1) |
| 3 | Có seal | seal.js trả hash nguồn; bản chạy gắn đúng hash | không ship (D18) |

Ba cửa tương ứng ba bất biến: P4 (deterministic, test khoá bằng hash), P1 (10ms), D18 (seal). PR không nêu cửa nào thì không mở.

4. Bất biến của nền tảng

Lõi thuần. core/ không fetch, không Date.now, không Math.random, không chạm @. Mọi thứ chạm ngoài nằm ở host/ (D15).
Host không parse. Host chỉ nhận cây từ lõi; parse lại = hai nguồn sự thật.
Gương không ghi. mirror/ chỉ đọc cây, không sửa, không chạy. Người đọc được là quà, không phải mục tiêu (D21, D3).
Một dạng duy nhất. canon.js là chốt chặn: viết khác → lỗi kèm bản chuẩn, không cần formatter (D12).
Lõi đóng băng. File trong core/ chỉ được thêm, không sửa chữ ký. Tính năng mới mọc ở host/ hoặc mirror/ (D7, D20).

5. Đường đi một chương trình


nguồn .10ms
   │  core/lex → parse → canon → type → cost → seal
   ▼
cây + seal (10ms đã chứng minh)
   │
   ├─► host/worker/run + effects  →  response + sổ @  →  replay
   │
   └─► mirror/text                →  bản đọc cho người


Cùng nguồn + cùng sổ @ = cùng output (P4). Đổi host = đổi src/host/<tên>/, không đổi chương trình (P7, D4).