/*
 * ======================================================================================
 * NEXUS SMART HOME REMOTE FIRMWARE — FULL CONTROL (LIGHTS, GATE, SERVO, WATER, SAFETY)
 * ESP32 Dev Module connected to WiFi & Render.com WebSocket Server
 * Hardware Map:
 *   - Lights (5 Relays): GPIO 13, 14, 27, 26, 33 (Active-LOW)
 *   - Pump Relay: GPIO 25 (Active-LOW)
 *   - Gate Servo: GPIO 18
 *   - Aux Servo: GPIO 17
 *   - Ultrasonic: GPIO 5 (Trig), GPIO 4 (Echo)
 *   - Safety IR Sensor: GPIO 34
 *   - I2C LCD: GPIO 21 (SDA), GPIO 22 (SCL)
 * ======================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// WiFi & Remote WebSocket Server
const char* WIFI_SSID = "Airtel_juma_8616";
const char* WIFI_PASS = "air38725";

const char* WS_HOST = "smarthome-remote.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/device";

// Hardware Pins
static const uint8_t RELAY_LIGHTS[5] = {13, 14, 27, 26, 33};
static const uint8_t RELAY_PUMP      = 25;
static const uint8_t SERVO_GATE_PIN  = 18;
static const uint8_t SERVO_AUX_PIN   = 17;
static const uint8_t TRIG_PIN        = 5;
static const uint8_t ECHO_PIN        = 4;
static const uint8_t IR_SENSOR_PIN   = 34;

// Tank Config
float tankDepthCm  = 100.0f;
float sensorOffset = 5.0f;
float autoPumpOn   = 20.0f;
float autoPumpOff  = 90.0f;

// States
bool lightStates[5]   = {false, false, false, false, false};
bool pumpState        = false;
bool pumpAutoMode     = true;
int  gateServoAngle   = 0;
int  auxServoAngle    = 0;

float smoothedDistance = 0.0f;
float waterPercentage  = 0.0f;
float waterDistanceCm  = 0.0f;
bool  irDetected       = false;
bool  hasLCD           = false;

unsigned long lastTelemetryTime = 0;
unsigned long lastSensorRead    = 0;
unsigned long lastWifiCheck     = 0;

SemaphoreHandle_t ultraMutex = NULL;

WebSocketsClient webSocket;
Preferences      prefs;
Servo            gateServo;
Servo            auxServo;
LiquidCrystal_I2C lcd(0x27, 16, 2);

float toPercent(float dist) {
  float waterLevel = tankDepthCm - (dist - sensorOffset);
  if (waterLevel < 0.0f) waterLevel = 0.0f;
  if (waterLevel > tankDepthCm) waterLevel = tankDepthCm;
  return (waterLevel / tankDepthCm) * 100.0f;
}

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
  pump["mode"] = pumpAutoMode ? "AUTO" : "MANUAL";

  JsonObject water = doc["water"].to<JsonObject>();
  water["distance"] = waterDistanceCm;
  water["level"]    = waterPercentage;
  water["height"]   = tankDepthCm - (waterDistanceCm - sensorOffset);

  JsonObject servo = doc["servo"].to<JsonObject>();
  servo["angle"] = auxServoAngle;

  JsonObject ir = doc["ir"].to<JsonObject>();
  ir["status"] = irDetected ? "warning" : "safe";
  ir["val"]    = irDetected ? 1 : 0;

  doc["online"] = true;
  doc["rssi"]   = WiFi.RSSI();

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

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

void readSensors() {
  xSemaphoreTake(ultraMutex, portMAX_DELAY);
  float d = smoothedDistance;
  xSemaphoreGive(ultraMutex);

  if (d > 1.0f) {
    waterDistanceCm = d;
    waterPercentage = toPercent(d);
  }

  irDetected = (digitalRead(IR_SENSOR_PIN) == LOW);
  updateLCD();
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected from Render.com");
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected to Render.com ✓");
      webSocket.sendTXT("{\"type\":\"device_hello\",\"device\":\"nexus-smart-home\"}");
      sendState();
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) break;

      String typeStr = doc.containsKey("type") ? doc["type"].as<String>() : "";

      if (typeStr == "ping") {
        webSocket.sendTXT("{\"type\":\"pong\"}");
        break;
      }

      if (typeStr == "light" || typeStr == "toggle") {
        if (doc.containsKey("index") && doc.containsKey("state")) {
          int idx = doc["index"].as<int>();
          if (idx >= 0 && idx < 5) {
            lightStates[idx] = doc["state"].as<bool>();
            digitalWrite(RELAY_LIGHTS[idx], lightStates[idx] ? LOW : HIGH);
            yield();
          }
        }
        sendState();
      }
      else if (typeStr == "gate") {
        if (doc.containsKey("pos")) {
          gateServoAngle = constrain(doc["pos"].as<int>(), 0, 180);
          gateServo.write(gateServoAngle);
        } else if (doc.containsKey("cmd")) {
          String cmd = doc["cmd"].as<String>();
          if (cmd == "open") { gateServoAngle = 90; gateServo.write(90); }
          else if (cmd == "close") { gateServoAngle = 0; gateServo.write(0); }
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
      else if (typeStr == "pump" || typeStr == "pump_mode" || typeStr == "control") {
        if (doc.containsKey("mode")) {
          String m = doc["mode"].as<String>();
          pumpAutoMode = (m.equalsIgnoreCase("AUTO") || m.equalsIgnoreCase("AUTOMATIC"));
          prefs.putBool("pumpAuto", pumpAutoMode);
        }
        if (doc.containsKey("on") && !pumpAutoMode) {
          pumpState = doc["on"].as<bool>();
          digitalWrite(RELAY_PUMP, pumpState ? LOW : HIGH);
        } else if (doc.containsKey("pumpOn") && !pumpAutoMode) {
          pumpState = doc["pumpOn"].as<bool>();
          digitalWrite(RELAY_PUMP, pumpState ? LOW : HIGH);
        }
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
  Serial.println("\n=== NEXUS SMART HOME CONTROLLER BOOT ===");

  prefs.begin("smarthome", false);
  pumpAutoMode = prefs.getBool("pumpAuto", true);

  for (int i = 0; i < 5; i++) {
    pinMode(RELAY_LIGHTS[i], OUTPUT);
    digitalWrite(RELAY_LIGHTS[i], HIGH);
  }

  pinMode(RELAY_PUMP, OUTPUT);
  digitalWrite(RELAY_PUMP, HIGH);

  pinMode(IR_SENSOR_PIN, INPUT);

  gateServo.attach(SERVO_GATE_PIN);
  gateServo.write(gateServoAngle);

  auxServo.attach(SERVO_AUX_PIN);
  auxServo.write(auxServoAngle);

  Wire.begin(21, 22);
  Wire.setTimeOut(100);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLCD = true;
    lcd.init(); lcd.backlight(); lcd.clear();
    lcd.print("Smart Home IoT");
    lcd.setCursor(0, 1); lcd.print("Connecting WiFi..");
  }

  ultraMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(ultrasonicTask, "Ultrasonic", 2048, NULL, 1, NULL, 0);

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
  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();
  }

  webSocket.loop();

  if (millis() - lastSensorRead >= 250) {
    lastSensorRead = millis();
    readSensors();

    if (pumpAutoMode) {
      if (waterPercentage <= autoPumpOn && !pumpState) {
        pumpState = true;
        digitalWrite(RELAY_PUMP, LOW);
        sendState();
      } else if (waterPercentage >= autoPumpOff && pumpState) {
        pumpState = false;
        digitalWrite(RELAY_PUMP, HIGH);
        sendState();
      }
    }

    if (millis() - lastTelemetryTime >= 250) {
      lastTelemetryTime = millis();
      sendState();
    }
  }
}
