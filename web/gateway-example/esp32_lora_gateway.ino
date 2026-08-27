#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Thay các giá trị này trước khi nạp firmware. API key phải trùng với server.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://SERVER_IP:3000/api/gps";
const char* GATEWAY_API_KEY = "change_me";
const char* FALLBACK_DEVICE_ID = "RESCUE-UNKNOWN";

constexpr int LORA_RX_PIN = 16;
constexpr int LORA_TX_PIN = 17;
constexpr uint32_t LORA_BAUD = 9600;
constexpr int HTTP_RETRIES = 3;
constexpr int QUEUE_SIZE = 12;

HardwareSerial LoRaSerial(2);
String pendingQueue[QUEUE_SIZE];
int queueHead = 0;
int queueCount = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastQueueAttempt = 0;

bool isValidCoordinate(double latitude, double longitude) {
  return latitude >= -90.0 && latitude <= 90.0 && longitude >= -180.0 && longitude <= 180.0;
}

bool buildJsonPayload(const String& input, String& output) {
  String line = input;
  line.trim();
  if (line.isEmpty()) return false;

  StaticJsonDocument<512> source;
  StaticJsonDocument<512> payload;

  if (line.startsWith("{")) {
    DeserializationError error = deserializeJson(source, line);
    if (error) {
      Serial.printf("[PARSE] JSON lỗi: %s\n", error.c_str());
      return false;
    }
    payload["device_id"] = source["device_id"] | FALLBACK_DEVICE_ID;
    payload["latitude"] = source["latitude"];
    payload["longitude"] = source["longitude"];
    if (source.containsKey("accuracy")) payload["accuracy"] = source["accuracy"];
    if (source.containsKey("battery")) payload["battery"] = source["battery"];
    if (source.containsKey("rssi")) payload["rssi"] = source["rssi"];
    payload["sos"] = source["sos"] | false;
    if (source.containsKey("message")) payload["message"] = source["message"];
  } else {
    String fields[4];
    int fieldCount = 0;
    int start = 0;
    for (int i = 0; i <= line.length() && fieldCount < 4; i++) {
      if (i == line.length() || line.charAt(i) == ',') {
        fields[fieldCount++] = line.substring(start, i);
        fields[fieldCount - 1].trim();
        start = i + 1;
      }
    }

    // Hỗ trợ device_id,lat,lng,SOS và định dạng BLE cũ lat,lng.
    if (fieldCount == 4) {
      payload["device_id"] = fields[0];
      payload["latitude"] = fields[1].toDouble();
      payload["longitude"] = fields[2].toDouble();
      payload["sos"] = fields[3].equalsIgnoreCase("SOS") || fields[3].equalsIgnoreCase("true") || fields[3] == "1";
      payload["message"] = fields[3];
    } else if (fieldCount == 2) {
      payload["device_id"] = FALLBACK_DEVICE_ID;
      payload["latitude"] = fields[0].toDouble();
      payload["longitude"] = fields[1].toDouble();
      payload["sos"] = true;
      payload["message"] = "SOS";
    } else {
      Serial.printf("[PARSE] Sai định dạng (%d trường): %s\n", fieldCount, line.c_str());
      return false;
    }
  }

  const char* deviceId = payload["device_id"] | "";
  double latitude = payload["latitude"] | 999.0;
  double longitude = payload["longitude"] | 999.0;
  if (strlen(deviceId) == 0 || !isValidCoordinate(latitude, longitude)) {
    Serial.println("[PARSE] Thiếu device_id hoặc tọa độ không hợp lệ");
    return false;
  }

  serializeJson(payload, output);
  return true;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[WIFI] Đang kết nối %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print('.');
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Đã kết nối, IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WIFI] Chưa kết nối được");
  }
}

bool postOnce(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(7000);
  if (!http.begin(SERVER_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", GATEWAY_API_KEY);
  int status = http.POST(payload);
  String response = status > 0 ? http.getString() : http.errorToString(status);
  http.end();
  Serial.printf("[HTTP] Status %d: %s\n", status, response.c_str());
  return status >= 200 && status < 300;
}

bool postWithRetry(const String& payload) {
  for (int attempt = 1; attempt <= HTTP_RETRIES; attempt++) {
    Serial.printf("[HTTP] Gửi lần %d/%d\n", attempt, HTTP_RETRIES);
    if (postOnce(payload)) return true;
    delay(500 * attempt);
    if (WiFi.status() != WL_CONNECTED) connectWifi();
  }
  return false;
}

void enqueue(const String& payload) {
  if (queueCount == QUEUE_SIZE) {
    Serial.println("[QUEUE] Hàng đợi đầy, giữ các gói cũ và bỏ gói mới");
    return;
  }
  int tail = (queueHead + queueCount) % QUEUE_SIZE;
  pendingQueue[tail] = payload;
  queueCount++;
  Serial.printf("[QUEUE] Đã lưu để gửi lại, đang chờ: %d\n", queueCount);
}

void flushQueue() {
  if (queueCount == 0 || WiFi.status() != WL_CONNECTED) return;
  Serial.printf("[QUEUE] Gửi lại gói đầu, còn %d gói\n", queueCount);
  if (postWithRetry(pendingQueue[queueHead])) {
    pendingQueue[queueHead] = "";
    queueHead = (queueHead + 1) % QUEUE_SIZE;
    queueCount--;
  }
}

void setup() {
  Serial.begin(115200);
  LoRaSerial.begin(LORA_BAUD, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
  Serial.println("\n[GATEWAY] ESP32 LoRa GPS Gateway khởi động");
  connectWifi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED && millis() - lastReconnectAttempt > 10000) {
    lastReconnectAttempt = millis();
    connectWifi();
  }

  if (LoRaSerial.available()) {
    String raw = LoRaSerial.readStringUntil('\n');
    raw.trim();
    if (!raw.isEmpty()) {
      Serial.printf("[LORA] Nhận: %s\n", raw.c_str());
      String payload;
      if (buildJsonPayload(raw, payload)) {
        Serial.printf("[PARSE] Payload: %s\n", payload.c_str());
        if (!postWithRetry(payload)) enqueue(payload);
      }
    }
  }

  if (millis() - lastQueueAttempt > 15000) {
    lastQueueAttempt = millis();
    flushQueue();
  }
  delay(10);
}
