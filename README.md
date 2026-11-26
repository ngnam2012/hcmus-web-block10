# ShopLite — Kiến Trúc Micro Frontend Đa Công Nghệ (Polyglot MFE)

Dự án giải quyết trọn vẹn bài tập xây dựng **một màn hình thống nhất ghép từ 4 công nghệ Frontend khác nhau**, có đầy đủ xử lý nghiệp vụ tương tác đa chiều, cô lập lỗi (Fault Isolation) và triển khai độc lập (Independent Deployment) bám sát 8 quyết định kiến trúc Micro Frontend.

---

## 1. Kiến trúc tổng thể (5 Cổng độc lập — 1 Màn hình duy nhất)

| Thành phần | Công nghệ | Cổng | Vai trò & Xử lý nghiệp vụ thực tế |
| :--- | :--- | :---: | :--- |
| **App Shell** (`shell/`) | **Vanilla TypeScript + Vite** | `:3000` | Quản lý Layout, Auth tập trung (`getAccessToken`), đổi Theme Sáng/Tối qua CSS Custom Properties, nạp `<script type="importmap">`, điều phối `manifest.json`, bộ nạp an toàn (**Timeout + Fallback + Generation Token**) và **Phòng thí nghiệm MFE (F1–F8)**. |
| **Remote 1 — Catalog** (`remotes/catalog/`) | **React 18** | `:3001` | Tìm kiếm tức thời, lọc theo danh mục & trần giá, sắp xếp đa tiêu chí, tính giá động theo phiên bản (variant), giữ chỗ & đồng bộ tồn kho hai chiều với Vue Cart, áp dụng mẫu **Expand–Contract** (`unitPrice` + `price`), cập nhật điểm ★ trực tiếp từ Reviews. |
| **Remote 2 — Cart & Checkout** (`remotes/cart/`) | **Vue 3 (SFC Scoped)** | `:3002` | Quản lý giỏ hàng kèm trần tồn kho, tự động áp dụng/thu hồi mã giảm giá khi giỏ thay đổi, tính phí vận chuyển/Freeship, thuế VAT 8%, điểm thưởng, biểu mẫu thanh toán có kiểm tra SĐT/địa chỉ VN, gọi Auth Token của Shell và có sẵn **2 bản build bất biến (`v1.0` & `v2.0`)** để demo Deploy/Rollback. |
| **Remote 3 — Promo Engine** (`remotes/promo/`) | **Svelte 4** | `:3003` | Tính thanh tiến độ Freeship (`1.5tr`) & hạng VIP (`3tr`) theo thời gian thực, kiểm tra mã nhập tay (mã ẩn: `SHOPLITE20`), ví Voucher kiểm tra điều kiện đa tầng và thuật toán **"⚡ Tự chọn mã lời nhất"** tự tính số tiền tiết kiệm thực tế tối ưu nhất. |
| **Remote 4 — Reviews Hub** (`remotes/reviews/`) | **Web Components (Custom Elements + Shadow DOM)** | `:3004` | Thẻ `<sl-review-hub>` đóng kín trong **Shadow DOM**, tự động chuyển ngữ cảnh theo sản phẩm chọn bên React, tính biểu đồ phân bổ 5★–1★, đối chiếu lịch sử đơn hàng để cấp nhãn **"✓ Đã mua hàng"**, lọc/bình chọn Hữu ích và tích hợp nút kiểm chứng cô lập CSS trực tiếp. |
| **Shared Runtime** (`shared/`) | **Native ES Modules (Import Map)** | `/shared/*` | `@shoplite/event-bus` (Singleton Event Bus có replay lịch sử) và `@shoplite/format` (tiền tệ VND, thời gian, mã đơn) được trình duyệt phân giải về đúng 1 bản duy nhất qua `<script type="importmap">`. |

---

## 2. Hướng dẫn cài đặt và khởi chạy

```bash
# 1. Cài đặt dependencies cho toàn bộ workspace
npm install

# 2. Đóng gói cả 4 Remote (tạo artifact bất biến gắn mã băm SHA-256 + manifest.json) và App Shell
npm run build

# 3. Chạy cổng kiểm định tương thích CI/CD (Compatibility Gate)
npm run gate

# 4. Khởi động đồng thời cả 5 server (:3000 -> :3004)
npm start
```

Sau đó mở trình duyệt tại: **http://localhost:3000**

*(Nếu muốn chạy kịch bản kiểm thử tích hợp tự động đầu-cuối qua dòng lệnh: `npm run verify`)*

---

## 2.5. Triển khai lên 1 Project Vercel duy nhất

Dự án đã tích hợp sẵn [vercel.json](vercel.json) và lệnh `npm run build:vercel` (tự động kích hoạt khi `VERCEL=1`):
- Tự đóng gói cả 4 Remote vào `/remotes/<tên>/<tên>.<hash>.js` (kèm cả `cart.v1` và `cart.v2`), giữ nguyên `<script type="importmap">`, header `immutable` cho bundle có hash và `no-cache` cho `/manifest.json`.
- Đẩy repo lên GitHub → Vào Vercel chọn **Add New Project** → Import repo → Bấm **Deploy** (không cần chỉnh tay cấu hình).

---

## 3. Hướng dẫn kiểm chứng 8 ca thực nghiệm (F1–F8) ngay trên giao diện

Trên thanh công cụ trên cùng của **http://localhost:3000**, mở **🔬 Phòng Thí Nghiệm MFE (F1–F8)**:

1. **F1 — Tương tác xử lý đa công nghệ:** Chọn phiên bản sản phẩm ở **React** → bấm *Thêm vào giỏ* → **Vue** cộng tiền/thuế/ship, **React** trừ tồn kho khả dụng, **Svelte** chạy thanh Freeship → bấm *⚡ Tự chọn mã lời nhất* ở **Svelte** → **Vue** giảm giá ngay → Đặt hàng ở **Vue** → Xuống **Web Components** viết đánh giá nhận nhãn *✓ Đã mua hàng* → Điểm ★ trên thẻ **React** nhảy số tức thì.
2. **F2 — Cô lập CSS (Shadow DOM):** Tại khung **Web Components (Reviews)** ở cuối trang, bấm nút `🧪 Test F2: Inject button { background: red !important }` → Toàn bộ nút bên trong Shadow DOM đổi sang màu đỏ rực, nhưng nút của **React**, **Vue**, **Svelte** và **App Shell** hoàn toàn không bị ảnh hưởng.
3. **F3 — Sập server cục bộ (Fault Isolation):** Trong tab *Fault Isolation*, bấm `🔌 F3: Tắt cổng :3003` (Svelte) → Cổng `:3003` đóng thật sự, khung Promo hiện **Fallback UI** gọn gàng trong khi bạn vẫn lọc hàng (React), thanh toán (Vue) và đánh giá (Web Components) bình thường. Bấm `⚡ Bật lại cổng :3003` để khôi phục và tự đồng bộ lại giỏ hàng.
4. **F4 — Mô phỏng Timeout (3 giây):** Bấm `⏱️ F4: Timeout 4.5s` ở bất kỳ slot nào → Server giữ kết nối 4.5s, `Promise.race` của Shell tự ngắt ở đúng mốc 3000ms và hiện Fallback thay vì treo trang.
5. **F5 — Lỗi Runtime trong `mount()`:** Bấm `💥 F5: Lỗi mount()` → Component chủ động `throw new Error()`, Shell bắt gọn vào khung Fallback mà không gây trắng trang (White Screen of Death).
6. **F6 — Chống Race Condition (Generation Token):** Bấm `🏁 F6: Race (5 lượt)` → Hệ thống phát 5 request liên tiếp với độ trễ ngược `[2100ms, 1500ms, 2400ms, 950ms, 180ms]`. Chuyển sang tab *Live Event Bus* để thấy lượt `#5` (180ms) thắng cuộc và cả 4 lượt cũ trả về muộn đều bị **Loader Guard** chặn lại.
7. **F7 — Independent Deployment:** Thêm vài món vào giỏ hàng, mở tab *Manifest Deploy*, bấm `🚀 F7: Deploy Cart v2.0` → Tệp `manifest.json` chuyển sang `cart.v2.<hash>.js` không cần build lại Shell; giao diện Cart xuất hiện ngay tính năng **Gói quà VIP & VietQR v2** mà không mất dữ liệu giỏ hàng (kể cả khi bấm `F5`).
8. **F8 — Instant Rollback:** Bấm `⏪ F8: Instant Rollback về Cart v1.0` → `manifest.json` trỏ ngược về artifact bất biến `cart.v1.<hash>.js`, khôi phục bản ổn định trong tích tắc.
