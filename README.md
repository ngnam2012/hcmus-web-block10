# ShopLite - Kiến Trúc Micro Frontend Đa Công Nghệ

Dự án xây dựng một màn hình thống nhất ghép từ **4 công nghệ Frontend độc lập** (React 18, Vue 3, Svelte 4, Web Components), tích hợp xử lý nghiệp vụ đa chiều, cô lập lỗi (Fault Isolation) và triển khai độc lập (Independent Deployment).

---

## 1. Kiến trúc hệ thống

| Thành phần | Công nghệ | Cổng | Vai trò & Xử lý nghiệp vụ |
| :--- | :--- | :---: | :--- |
| **App Shell** (`shell/`) | **Vanilla TypeScript + Vite** | `:3000` | Điều phối Layout, Auth tập trung (`getAccessToken`), đổi chế độ Sáng/Tối qua CSS Custom Properties, nạp `<script type="importmap">`, điều phối `manifest.json`, bộ nạp an toàn (**Timeout + Fallback + Generation Token**) và Bảng kiểm thử MFE (F1-F8). |
| **Remote 1 - Catalog** (`remotes/catalog/`) | **React 18** | `:3001` | Tìm kiếm, lọc theo danh mục & mức giá, sắp xếp sản phẩm, tính giá động theo phiên bản, đồng bộ tồn kho hai chiều với Vue Cart, áp dụng mẫu **Expand-Contract** (`unitPrice` + `price`), cập nhật điểm đánh giá từ Reviews. |
| **Remote 2 - Cart & Checkout** (`remotes/cart/`) | **Vue 3 (SFC Scoped)** | `:3002` | Quản lý giỏ hàng theo giới hạn tồn kho, tự động áp dụng/thu hồi mã giảm giá khi giỏ thay đổi, tính phí vận chuyển, thuế VAT 8%, kiểm tra hợp lệ biểu mẫu đặt hàng, tích hợp sẵn 2 bản build bất biến (`v1.0` & `v2.0`). |
| **Remote 3 - Promo Engine** (`remotes/promo/`) | **Svelte 4** | `:3003` | Tính tiến độ miễn phí vận chuyển (`1.500.000 ₫`) & mốc VIP (`3.000.000 ₫`), giải mã coupon nhập tay (`SHOPLITE20`), ví Voucher kiểm tra điều kiện và tự động chọn mã có mức giảm tối ưu nhất. |
| **Remote 4 - Reviews Hub** (`remotes/reviews/`) | **Web Components (Shadow DOM)** | `:3004` | Custom Element `<sl-review-hub>` đóng gói trong **Shadow DOM**, đồng bộ theo sản phẩm chọn bên React, thống kê tỷ lệ 5-1 sao, đối chiếu đơn hàng đã mua để gắn nhãn *Đã mua hàng*, lọc nhận xét và thử nghiệm cô lập CSS. |
| **Shared Runtime** (`shared/`) | **Native ES Modules (Import Map)** | `/shared/*` | `@shoplite/event-bus` và `@shoplite/format` được trình duyệt phân giải về 1 singleton duy nhất qua `<script type="importmap">`. |

---

## 2. Cài đặt và chạy tại máy (5 cổng độc lập)

```bash
npm install
npm run build
npm run gate
npm start
```

Mở trình duyệt tại: `http://localhost:3000`

Kiểm thử tích hợp tự động qua dòng lệnh: `npm run verify`

---

## 3. Triển khai lên Vercel (1 Project)

Dự án đã cấu hình sẵn `vercel.json` và `shell/vercel.json`:
- Khi Import repo lên Vercel, chọn `shell` (hoặc thư mục gốc `./`) và bấm **Deploy**.
- Quá trình build tự động đóng gói cả 4 Remote vào `/remotes/<tên>/<tên>.<hash>.js` và xuất ra `shell/dist`.

---

## 4. Kịch bản kiểm chứng (F1-F8)

Bấm nút **Bảng kiểm thử MFE** trên thanh tiêu đề để kiểm tra trực tiếp:
1. **F1 - Tương tác đa công nghệ:** Chọn phiên bản & thêm hàng ở React -> Svelte cập nhật thanh tiến độ & tự chọn mã giảm giá -> Đặt hàng ở Vue -> Viết nhận xét ở Web Components -> Điểm trung bình trên React tự cập nhật.
2. **F2 - Cô lập CSS (Shadow DOM):** Bấm nút `Test F2: Tiêm CSS button { background: red }` ở khung Đánh giá -> Chỉ nút bên trong Shadow DOM đổi màu đỏ, giao diện React, Vue, Svelte và Shell giữ nguyên.
3. **F3 - Ngắt kết nối cục bộ (Fault Isolation):** Ngắt cổng `:3003` -> Khung Khuyến mãi hiện thông báo dự phòng (Fallback UI), các phần còn lại vẫn mua hàng bình thường.
4. **F4 - Timeout (3 giây):** Mô phỏng phản hồi chậm 4.5s -> Shell tự ngắt ở 3000ms và hiện Fallback UI.
5. **F5 - Lỗi Runtime trong `mount()`:** Ném ngoại lệ khi khởi tạo -> Chỉ khung đó hiển thị Fallback UI, không làm trắng toàn trang.
6. **F6 - Chống Race Condition (Generation Token):** Phát 5 lượt tải liên tiếp với độ trễ khác nhau -> Chỉ lượt mới nhất được phép render, các lượt cũ về muộn bị loại bỏ.
7. **F7 - Independent Deployment:** Bấm `Deploy Cart v2.0` -> Cập nhật `manifest.json` sang `cart.v2.<hash>.js` mà không build lại Shell và giữ nguyên sản phẩm trong giỏ.
8. **F8 - Instant Rollback:** Bấm `Rollback về Cart v1.0` -> Khôi phục ngay bản `cart.v1.<hash>.js`.
