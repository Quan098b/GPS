# LoRa GPS Rescue

Ứng dụng desktop Windows điều phối cứu hộ, nhận GPS từ LoRa Gateway qua REST API, lưu MySQL và cập nhật bản đồ Leaflet bằng Socket.IO. Electron chạy Express ngay trong tiến trình ứng dụng; người vận hành không cần mở Chrome, CMD hay nhập `localhost`.

```text
Điện thoại GPS -> BLE -> ESP32-S3 -> LoRa E32 -> Gateway ESP32
-> HTTP POST qua LAN -> Electron/Express -> MySQL -> Socket.IO -> Dashboard
```

## Yêu cầu phát triển

- Windows 10/11 x64.
- Node.js 22.12 trở lên và npm.
- MySQL 8 với schema trong `database/schema.sql`.
- Internet chỉ cần cho tile OpenStreetMap. Bootstrap, Bootstrap Icons và Leaflet đã được đóng gói local.

## Chạy ứng dụng desktop khi phát triển

```powershell
cd F:\GPS\web
npm install
Copy-Item .env.example .env
npm run electron:dev
```

Trong development, Electron đọc `F:\GPS\web\.env`. Khi đã đóng gói, cấu hình được lưu tại:

```text
%APPDATA%\LoRa GPS Rescue\config.env
```

Lần chạy đầu tiên của bản cài đặt sẽ mở màn hình **Thiết lập database**. Mật khẩu MySQL và Gateway API Key không được nhúng vào source hoặc EXE.

Log ứng dụng nằm tại:

```text
%APPDATA%\LoRa GPS Rescue\logs\application.log
```

## Chuẩn bị MySQL

Mở PowerShell với quyền phù hợp nếu cần khởi động service:

```powershell
Start-Service MySQL80
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS gps_rescue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cmd /c "mysql -u root -p gps_rescue < database\schema.sql"
```

Dữ liệu minh họa là tùy chọn:

```powershell
cmd /c "mysql -u root -p gps_rescue < database\seed.sql"
```

Nếu MySQL offline, Electron hiển thị lựa chọn thử lại, mở dashboard offline hoặc thoát. Chế độ offline vẫn chạy Express và nhận kết nối mạng, nhưng API cần database sẽ trả lỗi 503 cho đến khi MySQL hoạt động.

## Build Windows EXE

Tạo installer NSIS x64:

```powershell
npm run build:win
```

Output:

```text
dist\LoRa GPS Rescue Setup 1.0.0.exe
dist\win-unpacked\LoRa GPS Rescue.exe
```

Tạo bản portable x64:

```powershell
npm run build:portable
```

Output:

```text
dist\LoRa GPS Rescue Portable.exe
```

Installer cho chọn thư mục, tạo shortcut Desktop/Start Menu và có uninstaller. Nếu chưa có `assets/icon.ico`, electron-builder dùng icon mặc định. Để thay icon sau này, đặt `assets/icon.ico` rồi thêm `"icon": "assets/icon.ico"` vào phần `build.win` trong `package.json`.

## Gateway LoRa qua LAN

Express luôn listen trên `0.0.0.0`. Dashboard hiển thị địa chỉ thực tế, ví dụ:

```text
http://192.168.1.100:3000/api/gps
```

Nếu cổng 3000 bị chiếm, ứng dụng tự thử 3001, 3002 và các cổng tiếp theo. Phải dùng địa chỉ/cổng đang hiển thị trong mục **Thông tin server** để cấu hình ESP32 Gateway.

Không tắt Windows Firewall. Khi Windows hỏi, cho phép **LoRa GPS Rescue** trên mạng Private. Có thể tạo rule thủ công trong PowerShell Administrator sau khi cài đặt:

```powershell
New-NetFirewallRule -DisplayName "LoRa GPS Rescue API" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
```

Nếu ứng dụng chọn cổng khác 3000, thay `-LocalPort` tương ứng. Đảm bảo máy tính và ESP32 cùng mạng LAN và router không bật client isolation.

Test GPS:

```powershell
curl.exe -X POST http://localhost:3000/api/gps `
  -H "Content-Type: application/json" `
  -H "X-API-Key: change_me" `
  -d "{\"device_id\":\"RESCUE-001\",\"latitude\":21.5945,\"longitude\":105.8482,\"accuracy\":5,\"battery\":80,\"rssi\":-70,\"sos\":true,\"message\":\"SOS\"}"
```

API gateway không đổi: `POST /api/gps`, header `X-API-Key` và payload JSON giữ nguyên. Electron không chuyển API thành IPC, vì vậy ESP32 vẫn gửi trực tiếp qua LAN.

## Bản đồ và Internet

Bootstrap, Bootstrap Icons, Leaflet CSS/JS và font giao diện đều là asset local. Tile OpenStreetMap vẫn cần Internet. Khi mất Internet:

- ứng dụng, Express, MySQL và Socket.IO vẫn chạy;
- GPS vẫn được nhận và lưu;
- marker và dữ liệu vẫn tồn tại;
- nền bản đồ có thể trống và dashboard hiển thị cảnh báo Internet.

## Chế độ tray và đóng ứng dụng

Khi bấm nút X, chọn ẩn xuống system tray để API tiếp tục nhận GPS hoặc thoát hoàn toàn. Menu tray có mở dashboard, trạng thái server, restart server và thoát. Thoát hoàn toàn đóng Socket.IO, HTTP server và MySQL pool trước khi Electron kết thúc.

Tùy chọn **Khởi động cùng Windows** nằm trong tab Cài đặt và mặc định tắt. Single-instance lock ngăn chạy hai backend cùng lúc.

## Backend độc lập

Backend Linux/VPS và chế độ web cũ vẫn hoạt động:

```powershell
npm start
```

Mở `http://localhost:3000`. Trong Linux có thể chạy bằng systemd/PM2 và Nginx reverse proxy hỗ trợ WebSocket.

Các endpoint chính:

```text
GET /api/health
GET /api/system/info
GET /api/devices/summary
GET /api/rescues
GET /api/rescues/:id
PUT /api/rescues/:id/confirm
PUT /api/rescues/:id/start
PUT /api/rescues/:id/rescue
PUT /api/rescues/:id/cancel
POST /api/gps
```

Socket.IO phát `gps:update`, `rescue:new` và `rescue:update`.

## Gateway ESP32 + E32

Mở `gateway-example/esp32_lora_gateway.ino` trong Arduino IDE, cài board ESP32 và ArduinoJson 6. Thay Wi-Fi, `SERVER_URL`, `GATEWAY_API_KEY` và chân UART trước khi nạp.

Parser hỗ trợ JSON, `RESCUE-001,21.5945,105.8482,SOS` và định dạng BLE cũ `21.5945,105.8482`. HTTP lỗi được thử lại ít nhất ba lần rồi giữ trong hàng đợi RAM.

## Kiểm tra

```powershell
npm run check
npm test
npm audit
```

Test tự động kiểm tra validation GPS, state transition, config desktop, tự đổi port và kết nối Socket.IO. Integration test đầy đủ cần MySQL đang chạy và schema đã được import.
