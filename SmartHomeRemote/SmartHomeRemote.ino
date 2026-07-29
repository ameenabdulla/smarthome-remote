/*
 * ======================================================================================
 * SMART HOME REMOTE — IR AUTO-OPEN 90° & 5-SECOND AUTO-RETURN TO 0°
 * Hardware Pinout:
 *   - Smart Light Relays (5 Channels): GPIO 13, 14, 27, 26, 33 (Active-LOW, 0ms Instant Response)
 *   - Auto Pump Relay: GPIO 25 (Active-LOW: ON <= 20%, OFF >= 90%)
 *   - Gate Servo: GPIO 18 (PWM Servo drive — IR 90° -> 5s Auto-Return 0°)
 *   - Aux Servo: GPIO 17 (PWM Servo drive — Direct Web Slider 0°-180°)
 *   - Ultrasonic Sensor: GPIO 5 (Trig), GPIO 4 (Echo)
 *   - Digital Gas Sensor (MQ DO): GPIO 32 (Input: Active-LOW)
 *   - Digital Flame Sensor (DO): GPIO 35 (Input: Active-LOW)
 *   - Digital IR Motion Sensor: GPIO 34 (Input: Active-LOW -> Gate 90°, 5s Return to 0°)
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
const char* WIFI_SSID = "Admin";
const char* WIFI_PASS = "admin1234";

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

// Direct Servo Angle States
int gateServoAngle    = 0;
int auxServoAngle     = 0;

float waterDistanceCm = 0.0f;
float waterPercentage = 0.0f;
bool  gasDetected     = false;
bool  flameDetected   = false;
bool  irDetected      = false;
bool  hasLCD          = false;

// Timers
unsigned long lastTelemetryTime = 0;
unsigned long lastBlinkTime     = 0;
unsigned long lastSensorRead    = 0;
unsigned long irTriggerTime     = 0; // Timer for 5-second auto-return to 0°
bool  irActiveTimer             = false;
bool  buzzerState               = false;

WebSocketsClient webSocket;
Servo            gateServo;
Servo            auxServo;
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Non-blocking 8ms short ultrasonic distance read
float getRawDistance() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 8000);
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

  // Digital Sensor Readings (Active LOW)
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

  // 2. IR Sensor Trigger: Move 90° -> After 5s Return to 0°
  if (irDetected || gasDetected || flameDetected) {
    if (gateServoAngle != 90) {
      gateServoAngle = 90;
      gateServo.write(90);
      Serial.println("[IR DETECTED] Gate Moved to 90°!");
    }
    irTriggerTime = millis(); // Continuously refresh 5-second countdown while object is present
    irActiveTimer = true;
  } else if (irActiveTimer) {
    // 5 seconds after object leaves, automatically return to 0°!
    if (millis() - irTriggerTime >= 5000) {
      gateServoAngle = 0;
      gateServo.write(0);
      irActiveTimer = false;
      Serial.println("[5s TIMER EXPIRED] Gate Returned to 0°!");
    }
  }

  // 3. Emergency Alarm (Gas or Flame Detected)
  if (gasDetected || flameDetected) {
    if (millis() - lastBlinkTime >= 150) {
      lastBlinkTime = millis();
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }

  // 4. Update 16x2 LCD Display
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
      lcd.print("GATE EMERGENCY 90");
    } else if (irActiveTimer) {
      lcd.print("GATE 90 (5s RET0)");
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
  gate["pos"]    = gateServoAngle;
  gate["status"] = (gateServoAngle > 10) ? "OPEN" : "CLOSED";

  JsonObject pump = doc["pump"].to<JsonObject>();
  pump["on"]   = pumpState;
  pump["mode"] = "AUTOMATIC";

  JsonObject water = doc["water"].to<JsonObject>();
  water["distance"] = waterDistanceCm;
  water["level"]    = waterPercentage;
  water["height"]   = tankDepthCm - (waterDistanceCm - sensorOffset);

  JsonObject servo = doc["servo"].to<JsonObject>();
  servo["angle"] = auxServoAngle;

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
          gateServoAngle = constrain(doc["pos"].as<int>(), 0, 90);
          gateServo.write(gateServoAngle);
          irActiveTimer = false; // Manual web override cancels auto timer
        } else if (doc.containsKey("cmd")) {
          String cmd = doc["cmd"].as<String>();
          if (cmd == "open") { gateServoAngle = 90; gateServo.write(90); }
          else if (cmd == "close") { gateServoAngle = 0; gateServo.write(0); }
          irActiveTimer = false;
        }
        sendState();
      }
      else if (typeStr == "servo") {
        if (doc.containsKey("angle")) {
          auxServoAngle = constrain(doc["angle"].as<int>(), 0, 180);
          auxServo.write(auxServoAngle);
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
  Serial.println("\n=== SMART HOME REMOTE — IR 90° & 5s AUTO-RETURN TO 0° FIRMWARE ===");

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
  pinMode(FLAME_SENSOR_PIN, INPUT_PULLUP);
  pinMode(IR_SENSOR_PIN, INPUT_PULLUP);

  // Servos Setup (500us - 2400us pulse bounds for 100% hardware compatibility)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  gateServo.setPeriodHertz(50);
  auxServo.setPeriodHertz(50);
  gateServo.attach(SERVO_GATE_PIN, 500, 2400);
  auxServo.attach(SERVO_AUX_PIN, 500, 2400);
  gateServo.write(gateServoAngle);
  auxServo.write(auxServoAngle);

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
    lcd.setCursor(0, 1); lcd.print("IR 90->0 (5s)");
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

  // Sensor & Safety Check every 50ms (non-blocking)
  if (millis() - lastSensorRead >= 50) {
    lastSensorRead = millis();
    checkSafetyAndSensors();
  }

  // Telemetry Broadcast every 200ms
  if (millis() - lastTelemetryTime >= 200) {
    lastTelemetryTime = millis();
    sendState();
  }
}
