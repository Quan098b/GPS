# GPS điện thoại qua ESP32-S3 BLE

App Android giữ vị trí mới nhất của điện thoại. Khi nhấn nút nối vào GPIO 3, ESP32-S3 yêu cầu vị trí qua BLE; app trả về đúng một bản tin và ESP chuyển bản tin đó qua UART tới E32.

## Đấu nối

Nút nhấn:

- Một chân nút -> GPIO 3
- Chân còn lại -> GND
- Sketch dùng `INPUT_PULLUP`, không cần điện trở kéo ngoài

E32:

- E32 TX -> ESP32-S3 GPIO 18 (`LORA_RX`)
- E32 RX -> ESP32-S3 GPIO 17 (`LORA_TX`)
- Nối chung GND và cấp nguồn đúng yêu cầu của E32
- UART: 9600 baud, 8N1

GPIO 3 là chân strapping trên ESP32-S3. Có thể dùng làm nút sau khi khởi động, nhưng không nên giữ nút trong lúc reset hoặc cấp nguồn.

## Nạp và sử dụng

1. Nạp `esp32/esp32_s3_ble_lora/esp32_s3_ble_lora.ino` vào ESP32-S3.
2. Cài APK hoặc chạy app từ Android Studio.
3. Bật Bluetooth và Vị trí trên điện thoại.
4. Mở app và nhấn **Quét và kết nối**.
5. Chờ app hiển thị đã sẵn sàng rồi nhấn nút GPIO 3.

App phải đang mở và kết nối BLE. Mỗi lần nhấn hợp lệ sẽ gửi một dòng:

```text
GPS,<latitude>,<longitude>,<accuracy_m>,<unix_time_ms>\n
```

UUID dùng chung:

- Service: `12345678-1234-5678-1234-56789abcdef0`
- Write/notify characteristic: `12345678-1234-5678-1234-56789abcdef1`
