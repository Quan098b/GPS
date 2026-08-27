#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

HardwareSerial ZigbeeSerial(1);

#define ZIGBEE_RX 18
#define ZIGBEE_TX 17

static const char *DEVICE_NAME = "GPS-ESP32";
static const char *SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
static const char *CHARACTERISTIC_UUID = "12345678-1234-5678-1234-56789abcdef1";

BLECharacteristic *gpsCharacteristic = nullptr;

volatile bool phoneConnected = false;


// ======================================================
// NHAN PAYLOAD TU DIEN THOAI QUA BLE VA CHUYEN SANG ZIGBEE
// ======================================================

class GpsCallbacks : public BLECharacteristicCallbacks {

  void onWrite(BLECharacteristic *characteristic) override {

    String value = characteristic->getValue();

    if (value.length() == 0) {
      return;
    }

    // Chuyen nguyen payload sang Zigbee qua UART
    ZigbeeSerial.write(
      (const uint8_t *)value.c_str(),
      value.length()
    );

    // Chi them '\n' neu payload chua co san
    if (value[value.length() - 1] != '\n') {
      ZigbeeSerial.write('\n');
    }

    Serial.print("[BLE] Nhan: ");
    Serial.println(value);

    Serial.println("[UART] Da chuyen sang Zigbee");
  }
};


// ======================================================
// BLE SERVER CALLBACK
// ======================================================

class ServerCallbacks : public BLEServerCallbacks {

  void onConnect(BLEServer *server) override {

    phoneConnected = true;

    Serial.println("Dien thoai da ket noi");
  }


  void onDisconnect(BLEServer *server) override {

    phoneConnected = false;

    BLEDevice::startAdvertising();

    Serial.println(
      "Dien thoai da ngat ket noi, dang quang ba lai"
    );
  }
};


// ======================================================
// SETUP
// ======================================================

void setup() {

  Serial.begin(115200);

  // UART noi voi module Zigbee
  //
  // ESP32 RX GPIO18 <- TX Zigbee
  // ESP32 TX GPIO17 -> RX Zigbee
  //
  ZigbeeSerial.begin(
    9600,
    SERIAL_8N1,
    ZIGBEE_RX,
    ZIGBEE_TX
  );


  // ================================
  // BLE
  // ================================

  BLEDevice::init(DEVICE_NAME);

  BLEDevice::setMTU(128);

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


  // ================================
  // BLE ADVERTISING
  // ================================

  BLEAdvertising *advertising =
    BLEDevice::getAdvertising();

  advertising->addServiceUUID(
    SERVICE_UUID
  );

  advertising->setScanResponse(true);

  BLEDevice::startAdvertising();


  // ================================
  // THONG BAO
  // ================================

  Serial.println();
  Serial.println("===============================");
  Serial.println(" ESP32-S3 BLE + ZIGBEE READY");
  Serial.println("===============================");

  Serial.println(
    "Zigbee RX ESP32 : GPIO18"
  );

  Serial.println(
    "Zigbee TX ESP32 : GPIO17"
  );

  Serial.println(
    "Dien thoai BLE Write -> ESP32 -> UART -> Zigbee"
  );

  Serial.println();
}


// ======================================================
// LOOP
// ======================================================

void loop() {

  // NHAN DU LIEU TU ZIGBEE DE DEBUG
  while (ZigbeeSerial.available()) {

    Serial.write(
      ZigbeeSerial.read()
    );
  }

  delay(5);
}