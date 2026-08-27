#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

HardwareSerial ZigbeeSerial(1);

#define ZIGBEE_RX 18
#define ZIGBEE_TX 17
#define BUTTON_PIN 3

static const char *DEVICE_NAME = "GPS-ESP32";
static const char *SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
static const char *CHARACTERISTIC_UUID = "12345678-1234-5678-1234-56789abcdef1";

static const unsigned long DEBOUNCE_MS = 50;
static const unsigned long GPS_RESPONSE_TIMEOUT_MS = 5000;

BLECharacteristic *gpsCharacteristic = nullptr;

volatile bool phoneConnected = false;
volatile bool sendRequested = false;

int lastButtonReading = HIGH;
int stableButtonState = HIGH;

unsigned long lastDebounceTime = 0;
unsigned long requestStartedAt = 0;


// ======================================================
// NHAN GPS TU DIEN THOAI QUA BLE
// ======================================================

class GpsCallbacks : public BLECharacteristicCallbacks {

  void onWrite(BLECharacteristic *characteristic) override {

    auto value = characteristic->getValue();

    if (value.length() == 0 || !sendRequested) {
      return;
    }

    sendRequested = false;

    // Gui du lieu GPS sang Zigbee qua UART
    ZigbeeSerial.write(
      (const uint8_t *)value.c_str(),
      value.length()
    );

    // Them ky tu xuong dong neu module/dau nhan can tach goi
    ZigbeeSerial.write('\n');

    Serial.print("Da nhan GPS tu dien thoai: ");
    Serial.println(value.c_str());

    Serial.println("Da gui GPS sang Zigbee qua UART");
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
    sendRequested = false;

    BLEDevice::startAdvertising();

    Serial.println(
      "Dien thoai da ngat ket noi, dang quang ba lai"
    );
  }
};


// ======================================================
// YEU CAU GPS TU DIEN THOAI
// ======================================================

void requestGpsFromPhone() {

  if (!phoneConnected || gpsCharacteristic == nullptr) {

    Serial.println(
      "Da nhan nut nhung dien thoai chua ket noi"
    );

    return;
  }


  if (sendRequested) {

    Serial.println(
      "Dang cho GPS tu lan nhan nut truoc"
    );

    return;
  }


  sendRequested = true;

  requestStartedAt = millis();

  // Gui len dien thoai
  gpsCharacteristic->setValue("SEND");

  gpsCharacteristic->notify();

  Serial.println(
    "Da nhan nut GPIO 3, dang yeu cau GPS tu dien thoai"
  );
}


// ======================================================
// DOC NUT NHAN
// ======================================================

void updateButton() {

  int reading = digitalRead(BUTTON_PIN);


  if (reading != lastButtonReading) {

    lastDebounceTime = millis();

    lastButtonReading = reading;
  }


  if (
    millis() - lastDebounceTime >= DEBOUNCE_MS &&
    reading != stableButtonState
  ) {

    stableButtonState = reading;


    if (stableButtonState == LOW) {

      requestGpsFromPhone();
    }
  }
}


// ======================================================
// SETUP
// ======================================================

void setup() {

  Serial.begin(115200);


  // UART noi voi module Zigbee
  //
  // ESP32 RX = GPIO18 <- TX Zigbee
  // ESP32 TX = GPIO17 -> RX Zigbee
  //
  ZigbeeSerial.begin(
    9600,
    SERIAL_8N1,
    ZIGBEE_RX,
    ZIGBEE_TX
  );


  pinMode(
    BUTTON_PIN,
    INPUT_PULLUP
  );


  // ================================
  // BLE
  // ================================

  BLEDevice::init(
    DEVICE_NAME
  );

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

      BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_NOTIFY
    );


  gpsCharacteristic->addDescriptor(
    new BLE2902()
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
    "Nut GPIO3 noi xuong GND"
  );

  Serial.println(
    "Nhan nut -> yeu cau GPS -> gui Zigbee"
  );

  Serial.println();
}


// ======================================================
// LOOP
// ======================================================

void loop() {

  // Doc nut
  updateButton();


  // ==========================================
  // KIEM TRA TIMEOUT GPS
  // ==========================================

  if (
    sendRequested &&
    millis() - requestStartedAt >=
      GPS_RESPONSE_TIMEOUT_MS
  ) {

    sendRequested = false;

    Serial.println(
      "Het thoi gian cho GPS, co the nhan nut de thu lai"
    );
  }


  // ==========================================
  // NHAN DU LIEU TU ZIGBEE
  // ==========================================

  while (
    ZigbeeSerial.available()
  ) {

    char c =
      ZigbeeSerial.read();

    Serial.write(c);
  }


  delay(5);
}