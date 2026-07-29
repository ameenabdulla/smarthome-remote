/*
 * ======================================================================================
 * SMART HOME REMOTE — MASTER FIRMWARE (ULTRA-SMOOTH GATE SERVO & AUX SERVO INTERPOLATION)
 * Hardware Pinout:
 *   - Smart Light Relays (5 Channels): GPIO 13, 14, 27, 26, 33 (Active-LOW)
 *   - Auto Pump Relay: GPIO 25 (Active-LOW: ON <= 20%, OFF >= 90%)
 *   - Gate Servo: GPIO 18 (PWM Servo drive — Ultra-Smooth Glide)
 *   - Aux Servo: GPIO 17 (PWM Servo drive — Ultra-Smooth Glide)
 *   - Ultrasonic Sensor: GPIO 5 (Trig), GPIO 4 (Echo)
 *   - Digital Gas Sensor (MQ DO): GPIO 32 (Input: Active-LOW)
 *   - Digital Flame Sensor (DO): GPIO 35 (Input: Active-LOW)
 *   - Digital IR Motion Sensor: GPIO 34 (Input: Active-LOW)
 *   - Active Alarm Buzzer: GPIO 19 (Output: Active-HIGH)
 *   - I2C LCD Display (16x2): GPIO 21 (SDA), GPIO 22 (SCL), Address 0x27
 * ======================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// WiFi & Remote WebSocket Server
const char* WIFI_SSID = "Airtel_juma_8616";
const char* WIFI_PASS = "air38725";

const char* WS_HOST = "smarthome-remote.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/device";

// Pin Map
static const uint8_t RELAY_LIGHTS[5] = {13, 14, 27, 26, 33};
static const uint8_t RELAY_PUMP      = 25;
static const uint8_t SERVO_GATE_PIN  = 18;
static const uint8_t SERVO_AUX_PIN   = 17;
static const uint8_t TRIG_PIN        = 5;
static const uint8_t ECHO_PIN        = 4;

static const uint8_t GAS_SENSOR_PIN   = 32; // Digital DO (LOW = Gas Leak)
static const uint8_t FLAME_SENSOR_PIN = 35; // Digital DO (LOW = Fire Detected)
static const uint8_t IR_SENSOR_PIN    = 34; // Digital DO (LOW = Motion Detected)
static const uint8_t BUZZER_PIN       = 19; // Active Buzzer (HIGH = BEEP)

// Tank Config
float tankDepthCm  = 100.0f;
float sensorOffset = 5.0f;
float autoPumpOn   = 20.0f; // ON when <= 20%
float autoPumpOff  = 90.0f; // OFF when >= 90%

// States
bool lightStates[5]   = {false, false, false, false, false};
bool pumpState        = false;

// ── Ultra-Smooth Servo Movement Variables ──
int targetGateAngle   = 0;
int currentGateAngle  = 0;

int targetAuxAngle    = 0;
int currentAuxAngle   = 0;

float waterDistanceCm = 0.0f;
float waterPercentage = 0.0f;
bool  gasDetected     = false;
bool  flameDetected   = false;
bool  irDetected      = false;
bool  hasLCD          = false;

unsigned long lastTelemetryTime = 0;
unsigned long lastBlinkTime     = 0;
unsigned long lastSensorRead    = 0;
bool buzzerState                = false;

WebSocketsClient webSocket;
Servo            gateServo;
Servo            auxServo;
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─────────────────────────────────────────────
// Smooth Servo Interpolation Engine (0 Snap / 0 Jitter)
// ─────────────────────────────────────────────
void updateSmoothServos() {
  static unsigned long lastGateStep = 0;
  static unsigned long lastAuxStep  = 0;
  unsigned long now = millis();

  // Smooth Gate Servo Glide (15ms per degree = 1.35s full movement)
  if (now - lastGateStep >= 15) {
    lastGateStep = now;
    if (currentGateAngle < targetGateAngle) {
      currentGateAngle++;
      gateServo.write(currentGateAngle);
    } else if (currentGateAngle > targetGateAngle) {
      currentGateAngle--;
      gateServo.write(currentGateAngle);
    }
  }

  // Smooth Aux Servo Glide
  if (now - lastAuxStep >= 15) {
    lastAuxStep = now;
    if (currentAuxAngle < targetAuxAngle) {
      currentAuxAngle++;
      auxServo.write(currentAuxAngle);
    } else if (currentAuxAngle > targetAuxAngle) {
      currentAuxAngle--;
      auxServo.write(currentAuxAngle);
    }
  }
}

float getRawDistance() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration > 0) {
    float dist = (duration * 0.0343f) / 2.0f;
    if (dist >= 2.0f && dist <= 450.0f) return dist;
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

  // Digital Sensor Readings (Active LOW: LOW = Hazard Detected)
  gasDetected   = (digitalRead(GAS_SENSOR_PIN) == LOW);
  flameDetected = (digitalRead(FLAME_SENSOR_PIN) == LOW);
  irDetected    = (digitalRead(IR_SENSOR_PIN) == LOW);

  // 1. Unconditional Pure Automatic Pump Control
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

  // 2. Emergency Hazard Action (Gas or Flame Detected)
  if (gasDetected || flameDetected) {
    // Sound Alarm Buzzer (BEEP BEEP Pattern)
    if (millis() - lastBlinkTime >= 150) {
      lastBlinkTime = millis();
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }

    // Emergency Evacuation: Smoothly OPEN Gate to 90 degrees!
    if (targetGateAngle != 90) {
      targetGateAngle = 90;
      Serial.println("[HAZARD ALERT] Emergency Evacuation -> GATE SMOOTH OPENING!");
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW); // Silence Buzzer when safe
  }

  // 3. Update 16x2 I2C LCD Display
  if (hasLCD) {
    lcd.setCursor(0, 0);
    if (flameDetected) {
      lcd.print("! FIRE DETECTED !");
    } else if (gasDetected) {
      lcd.print("! GAS LEAK ALERT!");
    } else if (irDetected) {
      lcd.print("! IR MOTION ALERT");
    } else {
      lcd.print("Water: ");
      lcd.print(waterPercentage, 1);
      lcd.print("%   ");
    }

    lcd.setCursor(0, 1);
    if (gasDetected || flameDetected) {
      lcd.print("GATE OPENED ALARM");
    } else {
      lcd.print(pumpState ? "PUMP: RUNNING   " : "PUMP: STOPPED   ");
    }
  }
}

void sendState() {
  if (!webSocket.isConnected()) return;

  JsonDocument doc;
  doc["type"] = "state";

  JsonArray lights = doc["lights"].to<JsonArray>();
  for (int i = 0; i < 5; i++) lights.add(lightStates[i]);

  JsonObject gate = doc["gate"].to<JsonObject>();
  gate["pos"]    = currentGateAngle;
  gate["status"] = (currentGateAngle > 10) ? "OPEN" : "CLOSED";

  JsonObject pump = doc["pump"].to<JsonObject>();
  pump["on"]   = pumpState;
  pump["mode"] = "AUTOMATIC";

  JsonObject water = doc["water"].to<JsonObject>();
  water["distance"] = waterDistanceCm;
  water["level"]    = waterPercentage;
  water["height"]   = tankDepthCm - (waterDistanceCm - sensorOffset);

  JsonObject servo = doc["servo"].to<JsonObject>();
  servo["angle"] = currentAuxAngle;

  JsonObject safety = doc["safety"].to<JsonObject>();
  safety["gas"]   = gasDetected ? 1 : 0;
  safety["flame"] = flameDetected ? 1 : 0;
  safety["ir"]    = irDetected ? 1 : 0;

  doc["online"] = true;
  doc["rssi"]   = WiFi.RSSI();

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
          }
        }
        sendState();
      }
      else if (typeStr == "gate") {
        if (doc.containsKey("pos")) {
          targetGateAngle = constrain(doc["pos"].as<int>(), 0, 180);
        } else if (doc.containsKey("cmd")) {
          String cmd = doc["cmd"].as<String>();
          if (cmd == "open") { targetGateAngle = 90; }
          else if (cmd == "close") { targetGateAngle = 0; }
        }
        sendState();
      }
      else if (typeStr == "servo") {
        if (doc.containsKey("angle")) {
          targetAuxAngle = constrain(doc["angle"].as<int>(), 0, 180);
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

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== SMART HOME REMOTE — ULTRA-SMOOTH GATE SERVO FIRMWARE ===");

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

  // Digital Sensors (Active-LOW DO pins)
  pinMode(GAS_SENSOR_PIN, INPUT_PULLUP);
  pinMode(FLAME_SENSOR_PIN, INPUT_PULLUP);
  pinMode(IR_SENSOR_PIN, INPUT_PULLUP);

  // Servos Setup
  gateServo.attach(SERVO_GATE_PIN);
  gateServo.write(currentGateAngle);
  auxServo.attach(SERVO_AUX_PIN);
  auxServo.write(currentAuxAngle);

  // Ultrasonic
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);

  // LCD Display
  Wire.begin(21, 22);
  Wire.setTimeOut(100);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLCD = true;
    lcd.init(); lcd.backlight(); lcd.clear();
    lcd.print("Smart Home IoT");
    lcd.setCursor(0, 1); lcd.print("Smooth Gate Active");
  }

  // Immediate sensor check on boot
  checkSafetyAndSensors();

  // WiFi & WebSocket
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(500); Serial.print(".");
  }

  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  webSocket.loop();

  // 1. Ultra-smooth servo gliding engine (runs on every tick)
  updateSmoothServos();

  // 2. Sensor & Safety check every 150ms (non-blocking)
  if (millis() - lastSensorRead >= 150) {
    lastSensorRead = millis();
    checkSafetyAndSensors();
  }

  // 3. Telemetry broadcast to web dashboard every 250ms
  if (millis() - lastTelemetryTime >= 250) {
    lastTelemetryTime = millis();
    sendState();
  }
}
