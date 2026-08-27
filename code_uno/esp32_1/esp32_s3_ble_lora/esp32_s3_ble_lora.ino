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

const char *WIFI_SSID = "khanhquan";
const char *WIFI_PASSWORD = "31122001az";


// ======================================================
// FIREBASE REALTIME DATABASE
// ======================================================
//
// Database:
// https://gpshelp-22dc8-default-rtdb.asia-southeast1.firebasedatabase.app
//
// POST vao:
// /sos.json
//

const char *FIREBASE_URL =
  "https://gpshelp-22dc8-default-rtdb.asia-southeast1.firebasedatabase.app/sos.json";


// ======================================================
// BLE
// ======================================================

static const char *DEVICE_NAME = "GPS-ESP32";

static const char *SERVICE_UUID =
  "12345678-1234-5678-1234-56789abcdef0";

static const char *CHARACTERISTIC_UUID =
  "12345678-1234-5678-1234-56789abcdef1";


BLECharacteristic *gpsCharacteristic = nullptr;

volatile bool phoneConnected = false;


// ======================================================
// DU LIEU SOS
//
// FORMAT TU DIEN THOAI:
//
// SOS|RESCUE-001|latitude|longitude|accuracy|timestamp|message
//
// VD:
//
// SOS|RESCUE-001|21.594500|105.848200|4.8|1787851234567|Toi bi thuong
//
// ======================================================

struct RescueData {

  String type;

  String deviceId;

  double latitude;
  double longitude;

  float accuracy;

  String timestamp;

  String message;
};


// ======================================================
// ESCAPE JSON
// ======================================================

String jsonEscape(String input) {

  input.replace("\\", "\\\\");
  input.replace("\"", "\\\"");
  input.replace("\n", " ");
  input.replace("\r", " ");

  return input;
}


// ======================================================
// PARSE PAYLOAD
// ======================================================

bool parseRescuePayload(
  String payload,
  RescueData &data
) {

  payload.trim();

  if (!payload.startsWith("SOS|")) {

    Serial.println(
      "[PARSE] Khong phai goi SOS"
    );

    return false;
  }


  String fields[7];

  int fieldIndex = 0;
  int startIndex = 0;


  for (
    int i = 0;
    i <= payload.length();
    i++
  ) {

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


  if (fieldIndex < 7) {

    Serial.print(
      "[PARSE] Thieu truong: "
    );

    Serial.println(
      fieldIndex
    );

    return false;
  }


  data.type =
    fields[0];

  data.deviceId =
    fields[1];

  data.latitude =
    fields[2].toDouble();

  data.longitude =
    fields[3].toDouble();

  data.accuracy =
    fields[4].toFloat();

  data.timestamp =
    fields[5];

  data.message =
    fields[6];


  // ================================================
  // VALIDATE GPS
  // ================================================

  if (
    data.latitude < -90.0 ||
    data.latitude > 90.0
  ) {

    Serial.println(
      "[PARSE] Latitude khong hop le"
    );

    return false;
  }


  if (
    data.longitude < -180.0 ||
    data.longitude > 180.0
  ) {

    Serial.println(
      "[PARSE] Longitude khong hop le"
    );

    return false;
  }


  return true;
}


// ======================================================
// WIFI CONNECT
// ======================================================

void connectWiFi() {

  if (
    WiFi.status() == WL_CONNECTED
  ) {

    return;
  }


  Serial.println();

  Serial.print(
    "[WIFI] Dang ket noi: "
  );

  Serial.println(
    WIFI_SSID
  );


  WiFi.mode(
    WIFI_STA
  );


  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );


  unsigned long started =
    millis();


  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - started < 15000
  ) {

    delay(500);

    Serial.print(".");
  }


  Serial.println();


  if (
    WiFi.status() == WL_CONNECTED
  ) {

    Serial.println(
      "[WIFI] Da ket noi"
    );

    Serial.print(
      "[WIFI] IP: "
    );

    Serial.println(
      WiFi.localIP()
    );

  } else {

    Serial.println(
      "[WIFI] Ket noi that bai"
    );
  }
}


// ======================================================
// GUI FIREBASE
// ======================================================

bool sendToFirebase(
  RescueData &data
) {

  if (
    WiFi.status() != WL_CONNECTED
  ) {

    connectWiFi();
  }


  if (
    WiFi.status() != WL_CONNECTED
  ) {

    Serial.println(
      "[FIREBASE] Khong co WiFi"
    );

    return false;
  }


  // ================================================
  // TAO JSON
  // ================================================

  String json = "{";


  json +=
    "\"device_id\":\"" +
    jsonEscape(data.deviceId) +
    "\",";


  json +=
    "\"latitude\":" +
    String(data.latitude, 6) +
    ",";


  json +=
    "\"longitude\":" +
    String(data.longitude, 6) +
    ",";


  json +=
    "\"accuracy\":" +
    String(data.accuracy, 1) +
    ",";


  json +=
    "\"timestamp\":\"" +
    jsonEscape(data.timestamp) +
    "\",";


  json +=
    "\"message\":\"" +
    jsonEscape(data.message) +
    "\",";


  json +=
    "\"status\":\"waiting\",";


  json +=
    "\"source\":\"demo_ble\"";


  json += "}";


  Serial.println();

  Serial.println(
    "[FIREBASE] JSON:"
  );

  Serial.println(
    json
  );


  // ================================================
  // HTTPS
  // ================================================

  WiFiClientSecure client;

  // DEMO:
  // bo qua certificate verification
  client.setInsecure();


  HTTPClient http;


  if (
    !http.begin(
      client,
      FIREBASE_URL
    )
  ) {

    Serial.println(
      "[FIREBASE] http.begin that bai"
    );

    return false;
  }


  http.addHeader(
    "Content-Type",
    "application/json"
  );


  int httpCode =
    http.POST(json);


  String response =
    http.getString();


  http.end();


  // ================================================
  // RESULT
  // ================================================

  Serial.print(
    "[FIREBASE] HTTP: "
  );

  Serial.println(
    httpCode
  );


  Serial.print(
    "[FIREBASE] Response: "
  );

  Serial.println(
    response
  );


  if (
    httpCode >= 200 &&
    httpCode < 300
  ) {

    Serial.println(
      "[FIREBASE] GUI THANH CONG"
    );

    return true;
  }


  Serial.println(
    "[FIREBASE] GUI THAT BAI"
  );

  return false;
}


// ======================================================
// BLE WRITE CALLBACK
// ======================================================

class GpsCallbacks :
  public BLECharacteristicCallbacks {

  void onWrite(
    BLECharacteristic *characteristic
  ) override {

    String value =
      characteristic->getValue();


    if (
      value.length() == 0
    ) {

      return;
    }


    Serial.println();

    Serial.println(
      "========================================"
    );

    Serial.println(
      "[BLE] NHAN YEU CAU CUU HO"
    );

    Serial.println(
      "========================================"
    );


    Serial.print(
      "[BLE] Payload: "
    );

    Serial.println(
      value
    );


    // ================================================
    // PARSE
    // ================================================

    RescueData rescue;


    if (
      !parseRescuePayload(
        value,
        rescue
      )
    ) {

      Serial.println(
        "[BLE] Payload khong hop le"
      );

      return;
    }


    // ================================================
    // IN THONG TIN
    // ================================================

    Serial.println();

    Serial.print(
      "Device ID : "
    );

    Serial.println(
      rescue.deviceId
    );


    Serial.print(
      "Latitude  : "
    );

    Serial.println(
      rescue.latitude,
      6
    );


    Serial.print(
      "Longitude : "
    );

    Serial.println(
      rescue.longitude,
      6
    );


    Serial.print(
      "Accuracy  : "
    );

    Serial.print(
      rescue.accuracy,
      1
    );

    Serial.println(
      " m"
    );


    Serial.print(
      "Timestamp : "
    );

    Serial.println(
      rescue.timestamp
    );


    Serial.print(
      "Message   : "
    );

    Serial.println(
      rescue.message
    );


    Serial.println();


    // ================================================
    // FIREBASE
    // ================================================

    if (
      sendToFirebase(
        rescue
      )
    ) {

      Serial.println(
        "[SOS] DA DAY LEN FIREBASE"
      );

    } else {

      Serial.println(
        "[SOS] KHONG GUI DUOC FIREBASE"
      );
    }


    Serial.println(
      "========================================"
    );
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

    phoneConnected = true;


    Serial.println();

    Serial.println(
      "[BLE] Dien thoai da ket noi"
    );
  }


  void onDisconnect(
    BLEServer *server
  ) override {

    phoneConnected = false;


    BLEDevice::startAdvertising();


    Serial.println();

    Serial.println(
      "[BLE] Dien thoai da ngat"
    );

    Serial.println(
      "[BLE] Dang advertising lai"
    );
  }
};


// ======================================================
// SETUP
// ======================================================

void setup() {

  Serial.begin(
    115200
  );


  delay(
    1000
  );


  Serial.println();

  Serial.println(
    "========================================"
  );

  Serial.println(
    " GPS RESCUE - ESP32-S3"
  );

  Serial.println(
    " PHONE -> BLE -> ESP32 -> FIREBASE"
  );

  Serial.println(
    "========================================"
  );


  // ====================================================
  // BLE (phai khoi dong truoc WiFi de advertising ngay,
  // khong bi cho 15s neu WiFi sai/cham)
  // ====================================================

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


  BLEAdvertising *advertising =
    BLEDevice::getAdvertising();


  advertising->addServiceUUID(
    SERVICE_UUID
  );


  advertising->setScanResponse(
    true
  );


  BLEDevice::startAdvertising();


  // ====================================================
  // READY
  // ====================================================

  Serial.println();

  Serial.println(
    "[BLE] GPS-ESP32 dang advertising"
  );

  Serial.println();

  Serial.println(
    "Dang cho dien thoai ket noi..."
  );

  Serial.println();


  // ====================================================
  // WIFI (goi SAU khi BLE da advertising, khong reset
  // hay dung BLE neu WiFi loi/cham)
  // ====================================================

  connectWiFi();
}


// ======================================================
// LOOP
// ======================================================

void loop() {

  // Tu dong noi lai WiFi neu mat mang

  if (
    WiFi.status() != WL_CONNECTED
  ) {

    static unsigned long
      lastReconnect = 0;


    if (
      millis() -
      lastReconnect >
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