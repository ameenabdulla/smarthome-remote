/*
 * ======================================================================================
 * JDT WATER TANK CONTROLLER — 100% PURE AUTOMATIC FIRMWARE (NO CONDITIONS)
 * Hardware Map:
 *   - Pump Relay: GPIO 25 (Active-LOW: LOW = ON, HIGH = OFF)
 *   - Ultrasonic: GPIO 5 (Trig), GPIO 4 (Echo)
 *   - I2C LCD: GPIO 21 (SDA), GPIO 22 (SCL)
 * ======================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// WiFi & Render.com WebSocket Server
const char* WIFI_SSID = "Airtel_juma_8616";
const char* WIFI_PASS = "air38725";

const char* WS_HOST = "smarthome-remote.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/device";

// Hardware Pins
static const uint8_t RELAY_PUMP = 25;  // Active-LOW Relay (LOW = ON, HIGH = OFF)
static const uint8_t TRIG_PIN   = 5;   // Ultrasonic Trig
static const uint8_t ECHO_PIN   = 4;   // Ultrasonic Echo

// Tank Configuration
float tankDepthCm  = 100.0f;
float sensorOffset = 5.0f;
float autoPumpOn   = 20.0f; // Turn ON when <= 20%
float autoPumpOff  = 90.0f; // Turn OFF when >= 90%

// Live State Variables
bool  pumpState       = false;
float waterDistanceCm = 0.0f;
float waterPercentage = 0.0f;
bool  hasLCD          = false;

unsigned long lastTelemetryTime = 0;

WebSocketsClient  webSocket;
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─────────────────────────────────────────────
// Ultrasonic Distance & Water Level Calculation
// ─────────────────────────────────────────────
float getRawDistance() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration > 0) {
    float dist = (duration * 0.0343f) / 2.0f;
    if (dist >= 2.0f && dist <= 450.0f) return dist;
  }
  return waterDistanceCm; // Fallback to last known reading
}

float calculateLevelPercent(float dist) {
  float waterLevel = tankDepthCm - (dist - sensorOffset);
  if (waterLevel < 0.0f) waterLevel = 0.0f;
  if (waterLevel > tankDepthCm) waterLevel = tankDepthCm;
  return (waterLevel / tankDepthCm) * 100.0f;
}

// ─────────────────────────────────────────────
// 100% Pure Unconditional Automatic Pump Logic
// ─────────────────────────────────────────────
void checkWaterLevel() {
  waterDistanceCm = getRawDistance();
  waterPercentage = calculateLevelPercent(waterDistanceCm);

  // Pure automatic threshold control (No manual, autoMode, or web checks!)
  if (waterPercentage <= autoPumpOn) {
    if (!pumpState) {
      pumpState = true;
      digitalWrite(RELAY_PUMP, LOW);  // Active-LOW: LOW = Pump ON
      Serial.printf("[PURE AUTO] LOW WATER %.1f%% <= %.1f%% -> PUMP ON\n", waterPercentage, autoPumpOn);
    }
  } else if (waterPercentage >= autoPumpOff) {
    if (pumpState) {
      pumpState = false;
      digitalWrite(RELAY_PUMP, HIGH); // Active-LOW: HIGH = Pump OFF
      Serial.printf("[PURE AUTO] HIGH WATER %.1f%% >= %.1f%% -> PUMP OFF\n", waterPercentage, autoPumpOff);
    }
  }

  // Update LCD if present
  if (hasLCD) {
    lcd.setCursor(0, 0);
    lcd.print("Water: ");
    lcd.print(waterPercentage, 1);
    lcd.print("%   ");
    lcd.setCursor(0, 1);
    lcd.print(pumpState ? "PUMP: RUNNING " : "PUMP: STOPPED ");
  }
}

// ─────────────────────────────────────────────
// WebSocket Telemetry (Web Display Only)
// ─────────────────────────────────────────────
void sendState() {
  if (!webSocket.isConnected()) return;

  JsonDocument doc;
  doc["type"]         = "state";
  doc["levelPercent"] = waterPercentage;
  doc["distanceCm"]   = waterDistanceCm;
  doc["pumpOn"]       = pumpState;
  doc["mode"]         = "AUTOMATIC";
  doc["online"]       = true;
  doc["rssi"]         = WiFi.RSSI();

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[WS] Connected to Render.com ✓");
      sendState();
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) break;
      String typeStr = doc.containsKey("type") ? doc["type"].as<String>() : "";
      if (typeStr == "ping") {
        webSocket.sendTXT("{\"type\":\"pong\"}");
      } else if (typeStr == "settings" || typeStr == "config") {
        if (doc.containsKey("lowThreshold"))  autoPumpOn   = doc["lowThreshold"].as<float>();
        if (doc.containsKey("highThreshold")) autoPumpOff  = doc["highThreshold"].as<float>();
        if (doc.containsKey("tankDepth"))     tankDepthCm  = doc["tankDepth"].as<float>();
        if (doc.containsKey("sensorOffset"))  sensorOffset = doc["sensorOffset"].as<float>();
        sendState();
      }
      break;
    }

    default: break;
  }
}

// ─────────────────────────────────────────────
// Boot Setup
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== JDT WATER TANK CONTROLLER — PURE AUTO BOOT ===");

  // Relay Setup (Default OFF)
  pinMode(RELAY_PUMP, OUTPUT);
  digitalWrite(RELAY_PUMP, HIGH); // Active-LOW: HIGH = OFF

  // Ultrasonic Pins
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);

  // LCD Initialization
  Wire.begin(21, 22);
  Wire.setTimeOut(100);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLCD = true;
    lcd.init(); lcd.backlight(); lcd.clear();
    lcd.print("JDT Water Tank");
    lcd.setCursor(0, 1); lcd.print("Auto Initializing");
  }

  // 1. Immediately check water level after boot
  checkWaterLevel();

  // WiFi Connection
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi: Connecting to %s", WIFI_SSID);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(500); Serial.print(".");
  }

  // WebSocket Server Setup
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// ─────────────────────────────────────────────
// Execution Loop
// ─────────────────────────────────────────────
void loop() {
  webSocket.loop();

  // 2. Unconditional automatic water level check every loop tick
  checkWaterLevel();

  // 3. Send telemetry to web display every 250ms
  if (millis() - lastTelemetryTime >= 250) {
    lastTelemetryTime = millis();
    sendState();
  }

  delay(250);
}
