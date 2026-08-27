#include <Arduino.h>

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

// ======================================================
// WIFI
// ======================================================

const char *WIFI_SSID = "khanh quan";
const char *WIFI_PASSWORD = "31122001az";

// ======================================================
// FIREBASE BASE URL
// ======================================================

const char *FIREBASE_BASE_URL =
  "https://gpshelp-22dc8-default-rtdb.asia-southeast1.firebasedatabase.app";

// ======================================================
// BLE
// ======================================================

static const char *DEVICE_NAME = "GPS-ESP32";

static const char *SERVICE_UUID =
  "12345678-1234-5678-1234-56789abcdef0";

static const char *CHARACTERISTIC_UUID =
  "12345678-1234-5678-1234-56789abcdef1";

BLECharacteristic *gpsCharacteristic = nullptr;

// ======================================================
// DU LIEU NHAN TU DIEN THOAI
// ======================================================

String pendingPayload = "";

volatile bool hasPendingPayload = false;

// ======================================================
// JSON ESCAPE
// ======================================================

String jsonEscape(String input) {
  input.replace("\\", "\\\\");
  input.replace("\"", "\\\"");
  input.replace("\n", " ");
  input.replace("\r", " ");

  return input;
}

// ======================================================
// WIFI
// ======================================================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  unsigned long start = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - start < 10000
  ) {
    delay(200);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WIFI] IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WIFI] Loi ket noi");
  }
}

// ======================================================
// GUI FIREBASE
// ======================================================

bool sendToFirebase(String payload) {
  payload.trim();

  // ====================================================
  // FORMAT TU DIEN THOAI:
  //
  // SOS|RESCUE-001|lat|lng|accuracy|timestamp|message
  //
  // ====================================================

  String fields[7];

  int fieldIndex = 0;
  int startIndex = 0;

  for (int i = 0; i <= payload.length(); i++) {
    if (
      i == payload.length() ||
      payload.charAt(i) == '|'
    ) {

      if (fieldIndex < 7) {
        fields[fieldIndex] =
          payload.substring(
            startIndex,
            i
          );

        fieldIndex++;
      }

      startIndex = i + 1;
    }
  }

  // ====================================================
  // KIEM TRA PAYLOAD
  // ====================================================

  if (fieldIndex < 7) {
    Serial.println("[DATA] Payload loi");
    return false;
  }

  String type = fields[0];
  String deviceId = fields[1];

  double latitude =
    fields[2].toDouble();

  double longitude =
    fields[3].toDouble();

  float accuracy =
    fields[4].toFloat();

  String timestamp =
    fields[5];

  String message =
    fields[6];

  // ====================================================
  // KIEM TRA LOAI SOS
  // ====================================================

  if (type != "SOS") {
    Serial.println("[DATA] Khong phai SOS");
    return false;
  }

  // ====================================================
  // KIEM TRA GPS
  // ====================================================

  if (
    latitude < -90.0 ||
    latitude > 90.0 ||
    longitude < -180.0 ||
    longitude > 180.0
  ) {
    Serial.println("[GPS] Toa do khong hop le");
    return false;
  }

  // ====================================================
  // CHI IN VI TRI + TIN NHAN
  // ====================================================

  Serial.print("[GPS] ");
  Serial.print(latitude, 6);
  Serial.print(", ");
  Serial.println(longitude, 6);

  Serial.print("[MSG] ");
  Serial.println(message);

  // ====================================================
  // TAO JSON
  // ====================================================

  String json = "{";

  json +=
    "\"device_id\":\"" +
    jsonEscape(deviceId) +
    "\",";

  json +=
    "\"latitude\":" +
    String(latitude, 6) +
    ",";

  json +=
    "\"longitude\":" +
    String(longitude, 6) +
    ",";

  json +=
    "\"accuracy\":" +
    String(accuracy, 1) +
    ",";

  json +=
    "\"timestamp\":\"" +
    jsonEscape(timestamp) +
    "\",";

  json +=
    "\"message\":\"" +
    jsonEscape(message) +
    "\",";

  json +=
    "\"status\":\"waiting\"";

  json += "}";

  // ====================================================
  // WIFI
  // ====================================================

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[FIREBASE] Khong co WiFi");
    return false;
  }

  // ====================================================
  // URL CO DINH THEO DEVICE ID
  //
  // VD:
  // /sos/RESCUE-001.json
  // ====================================================

  String url =
    String(FIREBASE_BASE_URL) +
    "/sos/" +
    deviceId +
    ".json";

  // ====================================================
  // HTTPS
  // ====================================================

  WiFiClientSecure client;

  // Demo
  client.setInsecure();

  HTTPClient http;

  if (!http.begin(client, url)) {
    Serial.println("[FIREBASE] HTTP init loi");
    return false;
  }

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  // ====================================================
  // PUT = GHI DE
  //
  // KHONG DUNG POST
  // ====================================================

  int code =
    http.PUT(json);

  http.end();

  // ====================================================
  // RESULT
  // ====================================================

  if (
    code >= 200 &&
    code < 300
  ) {
    Serial.println("[FIREBASE] OK");
    return true;
  }

  Serial.print("[FIREBASE] Loi: ");
  Serial.println(code);

  return false;
}

// ======================================================
// BLE NHAN DU LIEU
// ======================================================

class GpsCallbacks :
  public BLECharacteristicCallbacks {

  void onWrite(
    BLECharacteristic *characteristic
  ) override {

    String value =
      characteristic->getValue();

    if (value.length() == 0) {
      return;
    }

    // ==================================================
    // KHONG GUI FIREBASE TRONG CALLBACK BLE
    //
    // CHI LUU LAI
    // ==================================================

    pendingPayload = value;

    hasPendingPayload = true;
  }
};

// ======================================================
// BLE SERVER CALLBACK
// ======================================================

class ServerCallbacks :
  public BLEServerCallbacks {

  void onConnect(
    BLEServer *server
  ) override {

    Serial.println(
      "[BLE] Dien thoai da ket noi"
    );
  }

  void onDisconnect(
    BLEServer *server
  ) override {

    BLEDevice::startAdvertising();

    Serial.println(
      "[BLE] Mat ket noi"
    );
  }
};

// ======================================================
// START BLE
// ======================================================

void startBLE() {
  BLEDevice::init(
    DEVICE_NAME
  );

  BLEDevice::setMTU(
    128
  );

  BLEServer *server =
    BLEDevice::createServer();

  server->setCallbacks(
    new ServerCallbacks()
  );

  BLEService *service =
    server->createService(
      SERVICE_UUID
    );

  gpsCharacteristic =
    service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_WRITE
    );

  gpsCharacteristic->setCallbacks(
    new GpsCallbacks()
  );

  service->start();

  // ====================================================
  // ADVERTISING
  // ====================================================

  BLEAdvertising *advertising =
    BLEDevice::getAdvertising();

  advertising->addServiceUUID(
    SERVICE_UUID
  );

  advertising->setScanResponse(
    true
  );

  BLEDevice::startAdvertising();

  Serial.println(
    "[BLE] GPS-ESP32 san sang"
  );
}

// ======================================================
// SETUP
// ======================================================

void setup() {
  Serial.begin(
    115200
  );

  delay(
    500
  );

  // BLE truoc
  startBLE();

  // WiFi sau
  connectWiFi();
}

// ======================================================
// LOOP
// ======================================================

void loop() {
  // ====================================================
  // GUI PAYLOAD LEN FIREBASE
  // ====================================================

  if (hasPendingPayload) {
    hasPendingPayload = false;

    String payload =
      pendingPayload;

    pendingPayload = "";

    sendToFirebase(
      payload
    );
  }

  // ====================================================
  // TU DONG NOI LAI WIFI
  // ====================================================

  if (WiFi.status() != WL_CONNECTED) {

    static unsigned long
      lastReconnect = 0;

    if (
      millis() - lastReconnect >
      10000
    ) {

      lastReconnect =
        millis();

      connectWiFi();
    }
  }

  delay(
    10
  );
}