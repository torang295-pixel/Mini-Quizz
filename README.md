# Mini Quiz Classroom 🎓⚡

> Nền tảng thi trắc nghiệm trực tuyến thời gian thực dành cho lớp học, giảng đường và sự kiện. Không cần cài đặt thư viện phụ thuộc ngoài (Zero Dependencies), nhẹ, bảo mật và sẵn sàng triển khai ngay lập tức.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Dependencies](https://img.shields.io/badge/Dependencies-0%20npm%20packages-brightgreen)]()
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![Deploy](https://img.shields.io/badge/Deploy-Google%20AI%20Studio%20%2F%20Cloud%20Run-4285F4?logo=google-cloud&logoColor=white)]()

---

## 🌟 Tính năng nổi bật

- **Zero Dependencies**: Xây dựng 100% bằng thư viện tiêu chuẩn của Node.js (`http`, `crypto`, `fs`, `path`, `os`) và Vanilla JavaScript/CSS3. Khởi động tức thì mà không cần tải hàng trăm MB `node_modules`.
- **Tham gia nhanh bằng mã PIN & QR Code**: Học sinh tham gia thi bằng mã PIN 6 số hoặc quét mã QR hiển thị trên màn chiếu máy chiếu (hỗ trợ tự động điền mã PIN và vào phòng ngay).
- **Màn hình điều khiển Host thời gian thực**: Giáo viên kiểm soát nhịp độ phòng thi (chuyển câu, đếm ngược, hiển thị bảng xếp hạng, phân tích số lượng học sinh chọn đáp án A/B/C/D).
- **Báo cáo thống kê toàn diện**: Sau khi kết thúc đề thi, hệ thống xuất báo cáo gồm 3 thẻ số liệu tổng quan, bảng tỷ lệ câu đúng/sai và ma trận kết quả chi tiết từng thí sinh (🟢 Đúng / 🔴 Sai).
- **Ngân hàng đề thi & Kho cá nhân**: Soạn đề trắc nghiệm linh hoạt, lưu trữ Private Storage cá nhân, chia sẻ lên Public Storage dùng chung. Hỗ trợ bấm "Tạo phòng thi ngay" từ đề vừa soạn.
- **Lưu trữ bền vững chống mất phòng khi Restart**: Phòng thi đang hoạt động được lưu trữ atomic xuống đĩa (`data/active_rooms.json`), bảo toàn chính xác thời gian đếm ngược hạn phòng (24 giờ 15 phút) ngay cả khi khởi động lại server.
- **Bảo mật & Chống Spam**: Băm mật khẩu bằng `scrypt` an toàn, quản lý phiên qua Cookie `HttpOnly` + `SameSite=Lax` (tự động bật `Secure` khi qua HTTPS), tự động khóa đăng nhập/đăng ký khi bị tấn công brute-force.
- **Sẵn sàng triển khai đa nền tảng**: Tự động nhận diện mạng cục bộ (LAN), IP máy chủ, tên miền công khai qua Reverse Proxy/Cloudflare, container Docker và Google Cloud / Google AI Studio.

---

## 📁 Cấu trúc thư mục

```text
mini-quiz-classroom/
├── .github/
│   └── workflows/
│       └── ci.yml               # CI Pipeline kiểm tra cú pháp & khởi động trên GitHub
├── data/
│   ├── auth/                    # Dữ liệu tài khoản, phiên đăng nhập, chống spam
│   │   ├── users.json           # Danh sách người dùng (mặc định sẵn admin)
│   │   ├── sessions.json
│   │   ├── login_attempts.json
│   │   └── register_attempts.json
│   ├── history/                 # Lịch sử thi đấu & phòng đã tổ chức của giáo viên
│   ├── private/                 # Kho đề thi cá nhân (Private Storage)
│   └── public/                  # Ngân hàng đề thi dùng chung (Public Storage)
│       └── exams.json
├── public/                      # Giao diện người dùng (Frontend tĩnh)
│   ├── characters/              # Bộ 36 avatar nhân vật hoạt hình
│   ├── css/                     # Toàn bộ CSS phong cách hoạt họa hiện đại, dark mode
│   ├── js/                      # Thư viện QR Code thuần (qrcode.min.js)
│   ├── index.html               # Trang chủ: nhập PIN, chọn avatar, đăng nhập/đăng ký
│   ├── dashboard.html           # Bảng điều khiển: lịch sử làm bài, phòng tổ chức, đổi mật khẩu
│   ├── create-exam.html         # Soạn thảo & quản lý ngân hàng đề thi
│   ├── create-room.html         # Tạo phòng thi, cấp mã PIN, hiển thị QR code
│   ├── waiting-for-host.html    # Phòng chờ của giáo viên (chiếu mã PIN & QR khổng lồ)
│   ├── waiting-room-for-guests.html # Phòng chờ của học sinh
│   ├── host-monitor.html        # Màn hình điều phối thi đấu của giáo viên
│   └── room.html                # Màn hình làm bài trắc nghiệm của học sinh
├── src/                         # Mã nguồn Backend
│   ├── auth.js                  # Module xác thực, mã hóa scrypt, cookie session, chống spam
│   └── server.js                # HTTP Server xử lý REST API, polling thời gian thực & static files
├── .dockerignore
├── .gitattributes
├── .gitignore
├── Dockerfile                   # Docker build tối ưu với node:20-alpine
├── LICENSE                      # Giấy phép mã nguồn mở MIT
├── README.md
├── app.yaml                     # Cấu hình Google App Engine
├── package.json                 # Cấu hình dự án & script khởi chạy
├── server.js                    # File entrypoint chuyển hướng đến src/server.js
└── start.bat                    # Script khởi chạy 1-click trên hệ điều hành Windows
```

---

## 🚀 Hướng dẫn cài đặt và khởi chạy

### Yêu cầu hệ thống
- **Node.js** phiên bản 18.0.0 trở lên.
- Không yêu cầu cài đặt thêm bất kỳ gói npm nào (`npm install` là không bắt buộc).

### 1. Khởi chạy trên máy tính cá nhân (Local / LAN)

#### Trên Windows (Cách nhanh nhất):
Nhấp đúp chuột vào file `start.bat`. File này sẽ tự động:
1. Giải phóng cổng `7788` nếu đang bị chiếm dụng.
2. Mở trình duyệt web trỏ tới `http://localhost:7788`.
3. Khởi chạy máy chủ Node.js.

#### Bằng dòng lệnh (Windows / macOS / Linux):
```bash
# Khởi chạy bằng npm
npm start

# Hoặc khởi chạy trực tiếp bằng Node.js
node server.js
```
Truy cập ứng dụng tại:
- **Local**: `http://localhost:7788` (hoặc `http://localhost:8080`)
- **Mạng nội bộ (LAN)**: `http://<IP_LAN_CỦA_MÁY>:7788` (hiển thị trên cửa sổ console)

---

### 2. Triển khai bằng Docker

```bash
# Xây dựng Docker Image
docker build -t mini-quiz-classroom .

# Khởi chạy Container ở cổng 8080
docker run -d -p 8080:8080 --name mini-quiz mini-quiz-classroom
```
Truy cập tại `http://localhost:8080`.

---

### 3. Triển khai lên Google Cloud / Google AI Studio / Cloud Run

Dự án đã được tích hợp sẵn các file cấu hình `Dockerfile` và `app.yaml`:

- **Google App Engine**:
  ```bash
  gcloud app deploy app.yaml
  ```
- **Google Cloud Run**:
  ```bash
  gcloud run deploy mini-quiz-classroom \
    --source . \
    --platform managed \
    --region asia-southeast1 \
    --allow-unauthenticated
  ```
- **Cấu hình biến môi trường tùy chọn**:
  - `PORT`: Cổng lắng nghe của máy chủ (mặc định: `8080` trên Cloud hoặc `7788` khi chạy local).
  - `APP_URL`: URL tên miền công khai (ví dụ: `https://mini-quiz-classroom-n12.ai.studio`).

---

## 🔑 Tài khoản dùng thử mặc định

Hệ thống đã chuẩn bị sẵn tài khoản quản trị để trải nghiệm ngay:

| Tài khoản (Username) | Mật khẩu (Password) | Vai trò |
| :--- | :--- | :--- |
| `admin` | `123456` | Quản trị viên / Giáo viên |

*(Bạn có thể tự do đăng ký tài khoản mới hoặc đổi mật khẩu trong mục Cài đặt tài khoản của Bảng điều khiển).*

---

## 📄 Bản quyền (License)

Dự án được phân phối dưới giấy phép **Apache License 2.0**. Bạn được toàn quyền sử dụng, sửa đổi, phân phối cho mục đích học tập cũng như thương mại, kèm theo cơ chế bảo hộ bằng sáng chế rõ ràng. Chi tiết xem tại file [LICENSE](LICENSE).
