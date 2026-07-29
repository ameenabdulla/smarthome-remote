/*
 * ======================================================================================
 * JDT WATER TANK CONTROLLER — RENDER.COM REMOTE VERSION
 * ESP32 connects to home WiFi → Render.com WebSocket server → controlled from anywhere
 * Hardware: HC-SR04 Ultrasonic (GPIO 5 Trig, GPIO 4 Echo), Relay (GPIO 25), I2C LCD (21,22)
 * ======================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>   // CLIENT (connects to Render.com)
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ─────────────────────────────────────────────
// WiFi Credentials
// ─────────────────────────────────────────────
const char* WIFI_SSID = "Airtel_juma_8616";
const char* WIFI_PASS = "air38725";

// ─────────────────────────────────────────────
// Render.com Server
// ─────────────────────────────────────────────
const char* WS_HOST = "smarthome-remote.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/device";

// ─────────────────────────────────────────────
// Tank Configuration
// ─────────────────────────────────────────────
const float TANK_DEPTH_CM = 100.0f;
const float SENSOR_OFFSET = 25.0f;
const float AUTO_PUMP_ON  = 20.0f;  // Turn ON when <= 20%
const float AUTO_PUMP_OFF = 90.0f;  // Turn OFF when >= 90%

// ─────────────────────────────────────────────
// Hardware Pins
// ─────────────────────────────────────────────
static const uint8_t RELAY_PUMP = 25;  // Active-LOW Relay
static const uint8_t TRIG_PIN   = 5;   // Ultrasonic Trig
static const uint8_t ECHO_PIN   = 4;   // Ultrasonic Echo

// I2C LCD (SDA=21, SCL=22)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─────────────────────────────────────────────
// State Variables
// ─────────────────────────────────────────────
bool  pumpState    = false;
bool  pumpAutoMode = true;

float smoothedDistance = 0.0f;
float waterPercentage  = 0.0f;
float waterDistanceCm  = 0.0f;
bool  hasLCD           = false;

unsigned long lastTelemetryTime = 0;
unsigned long lastSensorRead    = 0;
unsigned long lastWifiCheck     = 0;

// FreeRTOS Mutex for Ultrasonic Reading
SemaphoreHandle_t ultraMutex = NULL;

WebSocketsClient  webSocket;
Preferences       prefs;

// ─────────────────────────────────────────────
// Distance to percentage calculation
// ─────────────────────────────────────────────
float toPercent(float dist) {
  float waterLevel = TANK_DEPTH_CM - (dist - SENSOR_OFFSET);
  if (waterLevel < 0.0f) waterLevel = 0.0f;
  if (waterLevel > TANK_DEPTH_CM) waterLevel = TANK_DEPTH_CM;
  return (waterLevel / TANK_DEPTH_CM) * 100.0f;
}

// ─────────────────────────────────────────────
// Ultrasonic Task (Core 0) — Non-blocking
// ─────────────────────────────────────────────
void ultrasonicTask(void* param) {
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  for (;;) {
    digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long dur = pulseIn(ECHO_PIN, HIGH, 30000);
    if (dur > 0) {
      float d = (dur * 0.0343f) / 2.0f;
      if (d >= 2.0f && d <= 450.0f) {
        xSemaphoreTake(ultraMutex, portMAX_DELAY);
        smoothedDistance = (smoothedDistance < 1.0f) ? d : (smoothedDistance * 0.6f + d * 0.4f);
        xSemaphoreGive(ultraMutex);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// ─────────────────────────────────────────────
// Send state telemetry to Render.com server
// ─────────────────────────────────────────────
void sendState() {
  if (!webSocket.isConnected()) return;

  JsonDocument doc;
  doc["type"]         = "state";
  doc["levelPercent"] = waterPercentage;
  doc["distanceCm"]   = waterDistanceCm;
  doc["pumpOn"]       = pumpState;
  doc["mode"]         = pumpAutoMode ? "AUTO" : "MANUAL";
  doc["online"]       = true;
  doc["rssi"]         = WiFi.RSSI();

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

// ─────────────────────────────────────────────
// LCD Display Update
// ─────────────────────────────────────────────
void updateLCD() {
  if (!hasLCD) return;
  lcd.setCursor(0, 0);
  lcd.print("Water:");
  lcd.print(waterPercentage, 1);
  lcd.print("%     ");
  lcd.setCursor(0, 1);
  lcd.print(pumpAutoMode ? "AUTO " : "MANU ");
  lcd.print(pumpState ? "PUMP:ON " : "PUMP:OFF");
}

// ─────────────────────────────────────────────
// Sensor Reading
// ─────────────────────────────────────────────
void readSensors() {
  xSemaphoreTake(ultraMutex, portMAX_DELAY);
  float d = smoothedDistance;
  xSemaphoreGive(ultraMutex);

  if (d > 1.0f) {
    waterDistanceCm = d;
    waterPercentage = toPercent(d);
  }

  updateLCD();
}

// ─────────────────────────────────────────────
// WebSocket Event Handler
// ─────────────────────────────────────────────
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {

    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected from Render.com");
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected to Render.com ✓");
      webSocket.sendTXT("{\"type\":\"device_hello\",\"device\":\"jdt-water-tank\"}");
      sendState();
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) break;

      String typeStr = doc.containsKey("type")   ? doc["type"].as<String>()
                     : doc.containsKey("action") ? doc["action"].as<String>()
                     : "";

      if (typeStr == "ping") {
        webSocket.sendTXT("{\"type\":\"pong\"}");
        break;
      }

      if (typeStr == "control" || typeStr == "pump" || typeStr == "pump_mode") {
        // 1. Mode Change (AUTO vs MANUAL)
        if (doc.containsKey("mode")) {
          String m = doc["mode"].as<String>();
          bool newAuto = (m.equalsIgnoreCase("AUTO"));
          if (newAuto != pumpAutoMode) {
            pumpAutoMode = newAuto;
            prefs.putBool("pumpAuto", pumpAutoMode);
            Serial.printf("Pump mode -> %s (saved to NVS)\n", pumpAutoMode ? "AUTO" : "MANUAL");
          }
        }

        // 2. Manual Relay Control
        if (doc.containsKey("pumpOn")) {
          if (!pumpAutoMode) {
            pumpState = doc["pumpOn"].as<bool>();
            digitalWrite(RELAY_PUMP, pumpState ? LOW : HIGH);
            Serial.printf("Pump relay -> %s [MANUAL]\n", pumpState ? "ON" : "OFF");
          }
        } else if (doc.containsKey("on") && !pumpAutoMode) {
          pumpState = doc["on"].as<bool>();
          digitalWrite(RELAY_PUMP, pumpState ? LOW : HIGH);
          Serial.printf("Pump relay -> %s [MANUAL]\n", pumpState ? "ON" : "OFF");
        }

        sendState();
      }
      break;
    }

    default: break;
  }
}

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== JDT Water Tank Controller Boot ===");

  // Load preferences
  prefs.begin("smarthome", false);
  pumpAutoMode = prefs.getBool("pumpAuto", true);

  // LCD
  Wire.begin(21, 22);
  Wire.setTimeOut(100);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLCD = true;
    lcd.init(); lcd.backlight(); lcd.clear();
    lcd.print("JDT Water Tank");
    lcd.setCursor(0, 1); lcd.print("Connecting WiFi..");
  }

  // Relay (Active LOW — HIGH = OFF)
  pinMode(RELAY_PUMP, OUTPUT);
  digitalWrite(RELAY_PUMP, HIGH);

  // FreeRTOS Ultrasonic Task on Core 0
  ultraMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(ultrasonicTask, "Ultrasonic", 2048, NULL, 1, NULL, 0);
  Serial.println("Ultrasonic: Core 0 task started");

  // Connect WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi: Connecting to %s", WIFI_SSID);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi: Connected! IP = %s\n", WiFi.localIP().toString().c_str());
    if (hasLCD) { lcd.clear(); lcd.print("WiFi Connected"); lcd.setCursor(0,1); lcd.print(WiFi.localIP()); }
  } else {
    Serial.println("\nWiFi: FAILED — retrying in loop");
  }

  // Connect SSL WebSocket to Render.com
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);
  Serial.printf("WebSocket: Connecting to wss://%s%s\n", WS_HOST, WS_PATH);
}

// ─────────────────────────────────────────────
// Main Execution Loop
// ─────────────────────────────────────────────
void loop() {
  // WiFi watchdog
  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi: Reconnecting...");
      WiFi.reconnect();
    }
  }

  // WebSocket loop
  webSocket.loop();

  // Read sensors every 250ms
  if (millis() - lastSensorRead >= 250) {
    lastSensorRead = millis();
    readSensors();

    // ── Local Auto Pump Logic ──
    if (pumpAutoMode) {
      if (waterPercentage <= AUTO_PUMP_ON && !pumpState) {
        pumpState = true;
        digitalWrite(RELAY_PUMP, LOW);  // Active LOW = Relay ON
        Serial.printf("Auto Pump ON (Water %.1f%% <= %.1f%%)\n", waterPercentage, AUTO_PUMP_ON);
        sendState();
      } else if (waterPercentage >= AUTO_PUMP_OFF && pumpState) {
        pumpState = false;
        digitalWrite(RELAY_PUMP, HIGH); // Active LOW = Relay OFF
        Serial.printf("Auto Pump OFF (Water %.1f%% >= %.1f%%)\n", waterPercentage, AUTO_PUMP_OFF);
        sendState();
      }
    }

    // Telemetry broadcast every 250ms
    if (millis() - lastTelemetryTime >= 250) {
      lastTelemetryTime = millis();
      sendState();
    }
  }
}
