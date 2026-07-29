/*
 * ======================================================================================
 * SMART HOME REMOTE — MASTER FIRMWARE (LIGHTS, WATER PUMP, GAS, FLAME, BUZZER, LCD)
 * Hardware Pinout:
 *   - Smart Light Relays (5 Channels): GPIO 13, 14, 27, 26, 33 (Active-LOW)
 *   - Auto Water Pump Relay: GPIO 25 (Active-LOW: ON <= 20%, OFF >= 90%)
 *   - Ultrasonic Sensor: GPIO 5 (Trig), GPIO 4 (Echo)
 *   - Digital Gas Sensor (MQ DO): GPIO 32 (Input: Active-LOW)
 *   - Digital Flame Sensor (DO): GPIO 35 (Input: Active-LOW)
 *   - Active Alarm Buzzer: GPIO 19 (Output: Active-HIGH)
 *   - I2C LCD Display (16x2): GPIO 21 (SDA), GPIO 22 (SCL), Address 0x27
 * ======================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// WiFi & Remote WebSocket Server
const char* WIFI_SSID = "Admin";
const char* WIFI_PASS = "admin1234";

const char* WS_HOST = "smarthome-remote.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/device";

// Pin Map
static const uint8_t RELAY_LIGHTS[5] = {13, 14, 27, 26, 33};
static const uint8_t RELAY_PUMP      = 25;
static const uint8_t TRIG_PIN        = 5;
static const uint8_t ECHO_PIN        = 4;

static const uint8_t GAS_SENSOR_PIN   = 32; // Digital DO (LOW = Gas Leak)
static const uint8_t FLAME_SENSOR_PIN = 35; // Digital DO (LOW = Fire Detected)
static const uint8_t BUZZER_PIN       = 19; // Active Buzzer (HIGH = BEEP)

// Tank Config
float tankDepthCm  = 100.0f;
float sensorOffset = 5.0f;
float autoPumpOn   = 20.0f; // ON when <= 20%
float autoPumpOff  = 90.0f; // OFF when >= 90%

// Relays & Water States
bool lightStates[5]   = {false, false, false, false, false};
bool pumpState        = false;
float waterDistanceCm = 0.0f;
float waterPercentage = 0.0f;
bool  gasDetected     = false;
bool  flameDetected   = false;
bool  hasLCD          = false;

// Timers
unsigned long lastTelemetryTime = 0;
unsigned long lastBlinkTime     = 0;
unsigned long lastSensorRead    = 0;
bool buzzerState                = false;

WebSocketsClient webSocket;
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─────────────────────────────────────────────
// SENSORS & SAFETY EVALUATION
// ─────────────────────────────────────────────
float getRawDistance() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  // 30ms timeout allows up to ~5 meters range. 8ms was too short for empty tanks!
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); 
  if (duration > 0) {
    float dist = (duration * 0.0343f) / 2.0f;
    if (dist >= 2.0f && dist <= 450.0f) return dist;
  }
  
  // If timeout (0), assume max distance (empty tank) so pump turns ON
  if (duration == 0) {
    return tankDepthCm; 
  }
  
  return waterDistanceCm;
}

float calculateLevelPercent(float dist) {
  float waterLevel = tankDepthCm - (dist - sensorOffset);
  if (waterLevel < 0.0f) waterLevel = 0.0f;
  if (waterLevel > tankDepthCm) waterLevel = tankDepthCm;
  return (waterLevel / tankDepthCm) * 100.0f;
}

void checkSafetyAndSensors() {
  waterDistanceCm = getRawDistance();
  waterPercentage = calculateLevelPercent(waterDistanceCm);

  // ── Debounced Digital Sensor Readings ──
  // Read pins 10 times to prevent random electrical noise
  int gasCount = 0;
  int flameCount = 0;
  for (int i = 0; i < 10; i++) {
    if (digitalRead(GAS_SENSOR_PIN) == LOW) gasCount++;     // Active LOW module
    if (digitalRead(FLAME_SENSOR_PIN) == HIGH) flameCount++; // Active HIGH module (or inverted logic)
    delay(2);
  }

  // Trigger only if signal is steady (at least 8/10 readings match)
  bool rawGas   = (gasCount >= 8);
  bool rawFlame = (flameCount >= 8);

  if (rawGas != gasDetected) {
    gasDetected = rawGas;
    Serial.printf("[SENSOR ALERT] Gas Leak Status: %s\n", gasDetected ? "LEAK DETECTED!" : "NORMAL");
  }

  if (rawFlame != flameDetected) {
    flameDetected = rawFlame;
    Serial.printf("[SENSOR ALERT] Flame Sensor (Pin 35): %s (Raw Value: %d)\n", flameDetected ? "FIRE DETECTED!" : "NORMAL", digitalRead(FLAME_SENSOR_PIN));
  }

  // 1. Automatic Water Pump Control
  if (waterPercentage <= autoPumpOn) {
    if (!pumpState) {
      pumpState = true;
      digitalWrite(RELAY_PUMP, LOW);  // Active-LOW: Pump ON
      Serial.printf("[PUMP] LOW WATER %.1f%% -> ON\n", waterPercentage);
    }
  } else if (waterPercentage >= autoPumpOff) {
    if (pumpState) {
      pumpState = false;
      digitalWrite(RELAY_PUMP, HIGH); // Active-LOW: Pump OFF
      Serial.printf("[PUMP] HIGH WATER %.1f%% -> OFF\n", waterPercentage);
    }
  }

  // 2. Emergency Hazard Alarm (Gas or Flame)
  if (gasDetected || flameDetected) {
    if (millis() - lastBlinkTime >= 150) {
      lastBlinkTime = millis();
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }

  // 3. Update 16x2 LCD Display
  if (hasLCD) {
    lcd.setCursor(0, 0);
    if (flameDetected) {
      lcd.print("! FIRE DETECTED !");
    } else if (gasDetected) {
      lcd.print("! GAS LEAK ALERT!");
    } else {
      lcd.print("Water: ");
      lcd.print(waterPercentage, 1);
      lcd.print("%   ");
    }

    lcd.setCursor(0, 1);
    if (gasDetected || flameDetected) {
      lcd.print("EMERGENCY ALARM ");
    } else {
      lcd.print(pumpState ? "PUMP: RUNNING   " : "PUMP: STOPPED   ");
    }
  }
}

// ─────────────────────────────────────────────
// WEBSOCKET TELEMETRY & EVENT HANDLERS
// ─────────────────────────────────────────────
void sendState() {
  if (!webSocket.isConnected()) return;

  JsonDocument doc;
  doc["type"] = "state";

  JsonArray lights = doc["lights"].to<JsonArray>();
  for (int i = 0; i < 5; i++) lights.add(lightStates[i]);

  // Flat JSON structure expected by app.js
  doc["levelPercent"] = waterPercentage;
  doc["distanceCm"]   = waterDistanceCm;
  doc["pumpOn"]       = pumpState;
  doc["mode"]         = "AUTO";
  doc["rssi"]         = WiFi.RSSI();
  doc["online"]       = true;

  // Nested safety structure is handled correctly by updateSafetyUI()
  JsonObject safety = doc["safety"].to<JsonObject>();
  safety["gas"]   = gasDetected ? 1 : 0;
  safety["flame"] = flameDetected ? 1 : 0;

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
      }
      else if (typeStr == "light" || typeStr == "toggle") {
        if (doc.containsKey("index") && doc.containsKey("state")) {
          int idx = doc["index"].as<int>();
          if (idx >= 0 && idx < 5) {
            lightStates[idx] = doc["state"].as<bool>();
            digitalWrite(RELAY_LIGHTS[idx], lightStates[idx] ? LOW : HIGH);
            Serial.printf("[LIGHT WEB] Light #%d set to %s\n", idx + 1, lightStates[idx] ? "ON" : "OFF");
          }
        }
        sendState();
      }
      else if (typeStr == "settings" || typeStr == "config") {
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
// SYSTEM SETUP & MAIN LOOP
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== SMART HOME REMOTE MASTER FIRMWARE ===");

  // Relays Setup (Active-LOW: HIGH = OFF)
  for (int i = 0; i < 5; i++) {
    pinMode(RELAY_LIGHTS[i], OUTPUT);
    digitalWrite(RELAY_LIGHTS[i], HIGH);
  }
  pinMode(RELAY_PUMP, OUTPUT);
  digitalWrite(RELAY_PUMP, HIGH);

  // Alarm Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Digital Sensors
  pinMode(GAS_SENSOR_PIN, INPUT_PULLUP);
  pinMode(FLAME_SENSOR_PIN, INPUT);

  // Ultrasonic
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);

  // LCD Display
  Wire.begin(21, 22);
  Wire.setTimeOut(50);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLCD = true;
    lcd.init(); lcd.backlight(); lcd.clear();
    lcd.print("Smart Home IoT");
    lcd.setCursor(0, 1); lcd.print("System Active");
  }

  // Immediate sensor check on boot
  checkSafetyAndSensors();

  // WiFi Connection
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
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

void loop() {
  webSocket.loop();

  // 1. Non-blocking Sensor & Safety Check every 50ms
  if (millis() - lastSensorRead >= 50) {
    lastSensorRead = millis();
    checkSafetyAndSensors();
  }

  // 2. Telemetry Broadcast every 200ms
  if (millis() - lastTelemetryTime >= 200) {
    lastTelemetryTime = millis();
    sendState();
  }
}
