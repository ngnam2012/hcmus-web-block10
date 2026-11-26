# ShopLite — Micro Frontends / Block 10

ShopLite ghép Shell TypeScript với Catalog React 18, Cart Vue 3, Promo Svelte 4 và Reviews Web Components. Yêu cầu và mã H0/F1–F8 dùng theo [slide Block 10](https://pub.nndkhoa9.win/webadv/w9/block-10-micro-frontends-interactive.html#pl-codes). Đây là bản triển khai riêng, không phải starter của giảng viên.

## Chạy local

Yêu cầu Node.js 22+, npm và Chrome/Chromium để kiểm thử trình duyệt.

```sh
npm install
npm run build
npm start
```

Mở `http://localhost:3000`, chọn tài khoản demo u1 (Nguyễn Minh Anh) hoặc u2 (Trần Quốc Tuấn). `/products?category=tea&page=2` hiển thị Trà, trang 2, sản phẩm T-01. `/cart`, back và forward do Shell điều phối. Đây là đăng nhập và checkout mô phỏng; không tích hợp nhà cung cấp danh tính hay cổng thanh toán.

| Thành phần | Cổng | Trách nhiệm |
|---|---:|---|
| Shell + API Node | 3000 | Route, phiên đăng nhập, badge, loader, manifest và deploy gate |
| Catalog / React | 3001 | Sản phẩm, query category/page, thêm giỏ qua API và phản hồi sau xác nhận |
| Cart / Vue | 3002 | Giỏ hàng, voucher, phí gói quà, biểu mẫu checkout |
| Promo / Svelte | 3003 | Tiến độ và voucher |
| Reviews / Shadow DOM | 3004 | Nhận xét, trạng thái đã mua theo tài khoản, thử cô lập CSS |

Các máy chủ chỉ bind loopback `127.0.0.1`. Dữ liệu giỏ, lịch sử mua và tồn kho lưu ở `.data/carts.json`; phiên có thời hạn được giữ trên server. Cart API lấy người dùng từ phiên/token hợp lệ, không lấy từ `userId` trong query hoặc payload.

## Contract và vòng đời

Manifest chứa `{ url, version, contractMajor }` cho mỗi remote. Shell đọc manifest bằng `cache: 'no-store'` khi khởi động và retry, kiểm tra major trước import, giới hạn chờ import 3 giây, và dùng generation token theo slot/route để bỏ kết quả muộn. Retry có URL attempt mới để thử lại cả những import đã thất bại trong module cache của trình duyệt.

Remote export `mount(container, ctx)` và trả về `{ unmount() }`; `unmount` có thể trả Promise. Context cung cấp bản sao user, locale/theme, `navigate`, `getAccessToken`, Cart API facade, event bus và `onCleanup`. Shell chờ cleanup của route cũ trước khi mount route mới. Loader quản lý subscription theo mount; remote vẫn có trách nhiệm hủy framework instance, timer và tài nguyên do chính nó tạo.

CSS được build thành dữ liệu export `remoteStyles`, với selector nằm dưới `[data-remote="<tên>"]`. Import hoàn tất muộn không tự chèn style. Loader chỉ gắn style khi mount và xóa khi unmount hoặc mount lỗi. Reviews dùng thêm Shadow DOM. `@shoplite/event-bus`, `@shoplite/format`, `@shop/ds` là external và được phân giải một lần qua import map.

Mã lỗi: `LOAD_FAILED`, `TIMEOUT`, `MOUNT_ERROR`, `INVALID_MODULE`, `INCOMPATIBLE`. Lượt cũ có log `LATE_IGNORED`. Fallback có mã và nút thử lại trong đúng slot; lỗi được POST tới `/__log/client`.

## Build/deploy riêng và rollback

Build luôn chạy typecheck, gồm `vue-tsc`, và kiểm tra G1–G6 trước khi chọn manifest. Artifact đã build giữ tên chứa SHA-256, không dọn dist cũ. Metadata nằm cạnh mỗi entry: `<tên>.<version>.<hash>.remote-meta.json`.

```sh
# Chỉ stage Catalog mới; shell và manifest đang chạy giữ nguyên.
node scripts/build-all.mjs --remote=catalog --version=1.8.0

# Gate rồi atomically đổi manifest dùng chung.
node scripts/deploy.mjs catalog 1.8.0

# Rollback qua cùng gate.
node scripts/deploy.mjs catalog 1.4.0

# Chỉ build shell, kiểm tra chiều ngược với tất cả remote đang chạy.
node scripts/build-all.mjs --shell-only
```

G1 kiểm tra file/meta/hash/export; G2 contract major; G3 semver shared; G4 danh sách package từ Rollup và import external; G5 route ownership; G6 phân tích selector/CSS lấy trực tiếp từ artifact. Gate đọc artifact được manifest chọn, không đọc bản `entry.js` mutable. API deploy và CLI cùng gọi gate, từ chối sẽ giữ nguyên manifest. Manifest được ghi file tạm rồi rename; mọi lần deploy hoặc rollback đều ghi kết quả vào `.data/deploy-log.jsonl`.

Tab đang mở giữ module hiện có. Tab mới hoặc reload đọc manifest hiện hành. Việc thay contract major, import map/shared runtime hoặc khả năng Shell cung cấp đòi hỏi cập nhật Shell tương thích; không thể giải quyết bằng đổi URL remote.

## Kiểm chứng

```sh
npm run typecheck
npm run gate
npm run verify
```

`verify` chạy gate với artifact lỗi, HTTP/API, rồi Chrome với assertion DOM, console, network và log. Có thể chạy riêng `npm run verify:http` hoặc `npm run verify:browser`. Nếu Chrome không nằm ở đường dẫn mặc định, đặt `CHROME_BIN` tới executable.

| Mã slide | Kiểm tra tự động |
|---|---|
| H0 | Đăng nhập u1, tea/page=2/T-01, badge, Cart, back giữ query; console sạch, mỗi entry một request |
| F1 | Catalog 404, `LOAD_FAILED`, phần còn lại hoạt động; retry đọc manifest và request entry mới |
| F2 | Catalog trễ 10 giây, timeout giây 3, sang Cart giây 4, không mount muộn và có `LATE_IGNORED` |
| F3 | Catalog 1.5.0 vẽ dở rồi throw; xóa DOM dở và style, `MOUNT_ERROR` |
| F4 | Cart 2.0.0 bị G2 từ chối; ghi manifest thủ công vẫn bị chặn trước request entry |
| F5 | Cart 1.4.0 có DS riêng bị G4 từ chối; bypass gây lỗi được cô lập; 1.4.1 chỉ tải DS một lần |
| F6 | Catalog 1.6.0 bị G6 từ chối; so computed style ở ba thời điểm với bản lỗi và bản sửa 1.6.1 |
| F7 | Cart 1.5.0/1.5.1: 5 vòng route rồi thêm thật qua Cart API, handlerCalls >1/1; history/logout/u1/u2 |
| F8 | Ba tab trước deploy/sau deploy/sau rollback Catalog 1.7.0→1.4.0; cùng hash Shell, Cart giữ 1.3.0 và có deploy log |

Fixture được tạo lại từ `scripts/build-fixtures.mjs`; bản không tương thích chỉ được stage. Kiểm tra bypass sửa manifest trong môi trường test và luôn khôi phục file ban đầu. Test dùng kho dữ liệu riêng trong `.audit/test-runtime-*`, không dùng `.data/carts.json` của người chạy.

Sau khi chạy kiểm thử, kết quả được tạo ở `.audit/revision-gate-results.json`, `.audit/revision-http-results.json` và `.audit/revision-browser-results.json`. Thư mục `.audit` chứa dữ liệu local và không được commit vào repository.

Máy chủ thực hành có `POST /__faults`, `GET /__log`, `POST /__log/client`, `POST /__reset` và API quản trị trên loopback. `__reset` trở về H0, xóa session, giỏ, tồn kho và fault của môi trường đang chạy.

## Giới hạn triển khai

`npm run build:vercel` đóng gói artifact vào `shell/dist/remotes` để phục vụ cùng origin. **Static Vercel đơn thuần không cung cấp Session/Cart API, log hoặc cập nhật manifest dùng chung.** Cần triển khai backend tương ứng và proxy cùng origin để có đầy đủ hành vi; ứng dụng báo rõ khi thiếu API. Nút deploy không còn giả vờ phát hành bằng sessionStorage.

Giữ artifact trong dist bảo đảm rollback qua các lần build **trên cùng kho local**. Với CI mới hoặc hosting ngoài máy, cần khôi phục các artifact đã phát hành từ kho lưu trữ bền vững trước khi build/publish. Chưa triển khai hoặc kiểm chứng một Vercel deployment thực trong đợt này.

Kiến trúc nhiều framework phù hợp mục tiêu học về ranh giới triển khai và vòng đời. Đổi lại có nhiều runtime, bundle và quy trình vận hành. Với nhóm nhỏ cùng nhịp phát hành, modular monolith sẽ đơn giản hơn; chia micro frontends hữu ích khi các nhóm thật sự cần phát hành độc lập.
