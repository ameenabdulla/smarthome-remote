/*
 * ======================================================================================
 * SMART HOME IoT — RENDER.COM REMOTE VERSION
 * ESP32 connects to home WiFi → Render.com WebSocket server → controlled from anywhere
 * Hardware: 5x Relays, Pump Relay, 2x Servos, HC-SR04 Ultrasonic, IR Sensor, I2C LCD
 * ======================================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>   // CLIENT (connects to Render.com)
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ─────────────────────────────────────────────
// WiFi Credentials
// ─────────────────────────────────────────────
const char* WIFI_SSID = "Airtel_juma_8616";
const char* WIFI_PASS = "air38725";

// ─────────────────────────────────────────────
// Render.com Server  (name your service exactly: juma-smarthome)
// ─────────────────────────────────────────────
const char* WS_HOST = "juma-smarthome.onrender.com";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/device";

// ─────────────────────────────────────────────
// Hardware Pins
// ─────────────────────────────────────────────
static const uint8_t RELAY_LIGHTS[5] = { 26, 27, 14, 19, 13 };
static const uint8_t RELAY_PUMP      = 25;
static const uint8_t MOTOR_IN1       = 32;
static const uint8_t MOTOR_IN2       = 33;
static const uint8_t SERVO_PIN       = 18;
static const uint8_t SERVO2_PIN      = 17;
static const uint8_t TRIG_PIN        = 5;
static const uint8_t ECHO_PIN        = 4;
static const uint8_t IR_PIN          = 35;

// I2C LCD  (SDA=21, SCL=22)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─────────────────────────────────────────────
// System State
// ─────────────────────────────────────────────
bool  lightStates[5] = {false, false, false, false, false};
bool  pumpState      = false;
bool  pumpAutoMode   = true;
int   servoAngle     = 0;
int   servo2Angle    = 0;
int   waterDepth     = 100;
int   waterOffset    = 5;
int   lowThreshold   = 20;
int   highThreshold  = 90;

int   waterDistanceCm = 0;
int   waterHeightCm   = 0;
int   waterPercentage = 0;
bool  irDetected      = false;
unsigned long irDetectTimeSec = 0;
bool  hasLCD          = false;

// ─────────────────────────────────────────────
// Timers
// ─────────────────────────────────────────────
unsigned long lastBroadcast      = 0;
unsigned long lastSensorRead     = 0;
unsigned long lastWifiCheck      = 0;
unsigned long lastWsPing         = 0;
unsigned long gateAutoCloseTime  = 0;

// ─────────────────────────────────────────────
// Ultrasonic — FreeRTOS on Core 0
// ─────────────────────────────────────────────
float             smoothedDistance = 0.0f;
SemaphoreHandle_t ultraMutex       = NULL;

// ─────────────────────────────────────────────
// Objects
// ─────────────────────────────────────────────
WebSocketsClient  webSocket;
Preferences       prefs;
Servo             gateServo;
Servo             servo2;

// ─────────────────────────────────────────────
// Ultrasonic Task (Core 0) — never blocks main loop
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
// Send state to Render.com server → browser
// ─────────────────────────────────────────────
void sendState() {
  if (!webSocket.isConnected()) return;

  JsonDocument doc;
  doc["type"]            = "state";
  doc["pump_state"]      = pumpState;
  doc["pump_auto_mode"]  = pumpAutoMode;
  doc["servo_angle"]     = servoAngle;
  doc["water_distance"]  = waterDistanceCm;
  doc["water_height"]    = waterHeightCm;
  doc["water_percentage"]= waterPercentage;
  doc["ir_detected"]     = irDetected;

  JsonArray la = doc["lights"].to<JsonArray>();
  for (int i = 0; i < 5; i++) la.add(lightStates[i]);

  JsonObject gate = doc["gate"].to<JsonObject>();
  gate["pos"]    = servoAngle;
  gate["status"] = (servoAngle > 10) ? "OPEN" : "CLOSED";

  JsonObject pump = doc["pump"].to<JsonObject>();
  pump["on"]   = pumpState;
  pump["mode"] = pumpAutoMode ? "AUTO" : "MANUAL";

  JsonObject water = doc["water"].to<JsonObject>();
  water["distance"] = waterDistanceCm;
  water["level"]    = waterPercentage;
  water["height"]   = waterHeightCm;

  JsonObject ir = doc["ir"].to<JsonObject>();
  ir["val"]    = irDetected ? 1 : 0;
  ir["status"] = irDetected ? "warning" : "safe";

  JsonObject settings = doc["settings"].to<JsonObject>();
  settings["waterDepth"]    = waterDepth;
  settings["waterOffset"]   = waterOffset;
  settings["lowThreshold"]  = lowThreshold;
  settings["highThreshold"] = highThreshold;
  settings["systemName"]    = "Smart Home";

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

// ─────────────────────────────────────────────
// LCD Update
// ─────────────────────────────────────────────
void updateLCD() {
  if (!hasLCD) return;
  lcd.setCursor(0, 0);
  lcd.print("Water:");
  lcd.print(waterPercentage);
  lcd.print("%       ");
  lcd.setCursor(0, 1);
  lcd.print(pumpAutoMode ? "AUTO " : "MANU ");
  lcd.print(pumpState ? "PUMP:ON " : "PUMP:OFF");
}

// ─────────────────────────────────────────────
// Read sensors
// ─────────────────────────────────────────────
void readSensors() {
  // Ultrasonic from Core 0 task
  xSemaphoreTake(ultraMutex, portMAX_DELAY);
  float d = smoothedDistance;
  xSemaphoreGive(ultraMutex);
  if (d > 1.0f) {
    waterDistanceCm = (int)d;
    waterHeightCm   = max(0, waterDepth - waterDistanceCm + waterOffset);
    waterPercentage = (int)constrain(map(waterHeightCm, 0, waterDepth, 0, 100), 0, 100);
  }

  // IR sensor (debounced)
  static uint8_t irCount = 0;
  if (digitalRead(IR_PIN) == LOW) { if (irCount < 5) irCount++; }
  else                            { if (irCount > 0) irCount--; }
  bool curIr = (irCount >= 5);
  if (curIr && !irDetected) irDetectTimeSec = millis() / 1000;
  irDetected = curIr;

  updateLCD();
}

// ─────────────────────────────────────────────
// WebSocket event handler
// ─────────────────────────────────────────────
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {

    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected from Render.com");
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected to Render.com ✓");
      // Identify as ESP32 device
      webSocket.sendTXT("{\"type\":\"device_hello\",\"device\":\"smarthome-esp32\"}");
      sendState();
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) break;

      String action = doc.containsKey("type")   ? doc["type"].as<String>()
                    : doc.containsKey("action")  ? doc["action"].as<String>()
                    : "";

      if (action == "ping") {
        webSocket.sendTXT("{\"type\":\"pong\"}");
        break;
      }

      if (action == "light") {
        int  idx   = doc.containsKey("id")    ? (int)doc["id"]
                   : doc.containsKey("index") ? (int)doc["index"] : -1;
        bool state = doc.containsKey("state") ? doc["state"].as<bool>()
                   : doc.containsKey("on")    ? doc["on"].as<bool>() : false;
        if (idx >= 0 && idx < 5) {
          lightStates[idx] = state;
          digitalWrite(RELAY_LIGHTS[idx], state ? LOW : HIGH);
          yield();
          Serial.printf("Relay %d → %s\n", idx + 1, state ? "ON" : "OFF");
        }

      } else if (action == "servo" || action == "servo2") {
        servo2Angle = constrain((int)doc["angle"], 0, 180);
        servo2.write(servo2Angle);
        Serial.printf("Servo2 → %d°\n", servo2Angle);

      } else if (action == "gate") {
        String cmd = doc.containsKey("cmd")      ? doc["cmd"].as<String>()
                   : doc.containsKey("command")  ? doc["command"].as<String>() : "";
        int pos    = doc.containsKey("pos")       ? (int)doc["pos"]
                   : doc.containsKey("position")  ? (int)doc["position"] : -1;

        if (cmd == "open" || pos == 100) {
          servoAngle = 180; gateServo.write(180);
          gateAutoCloseTime = millis() + 8000;
          Serial.println("Gate → OPEN (auto-close 8s)");
        } else if (cmd == "close" || pos == 0) {
          servoAngle = 0; gateServo.write(0);
          gateAutoCloseTime = 0;
          Serial.println("Gate → CLOSED");
        } else if (pos >= 0 && pos <= 100) {
          servoAngle = map(pos, 0, 100, 0, 180);
          gateServo.write(servoAngle);
          gateAutoCloseTime = 0;
        }

      } else if (action == "pump" || action == "pump_mode" || action == "pump_toggle") {
        if (doc.containsKey("mode")) {
          bool newAuto = doc["mode"].as<String>().equalsIgnoreCase("AUTO");
          if (newAuto != pumpAutoMode) {
            pumpAutoMode = newAuto;
            prefs.putBool("pumpAuto", pumpAutoMode);
            Serial.printf("Pump mode → %s\n", pumpAutoMode ? "AUTO" : "MANUAL");
          }
        }
        if (!pumpAutoMode) {
          if (doc.containsKey("state")) {
            pumpState = doc["state"].as<bool>();
            digitalWrite(RELAY_PUMP, pumpState ? LOW : HIGH);
            Serial.printf("Pump relay → %s [MANUAL]\n", pumpState ? "ON" : "OFF");
          } else if (doc.containsKey("on")) {
            pumpState = doc["on"].as<bool>();
            digitalWrite(RELAY_PUMP, pumpState ? LOW : HIGH);
            Serial.printf("Pump relay → %s [MANUAL]\n", pumpState ? "ON" : "OFF");
          }
        }

      } else if (action == "settings") {
        if (doc.containsKey("waterDepth"))    waterDepth    = doc["waterDepth"];
        if (doc.containsKey("waterOffset"))   waterOffset   = doc["waterOffset"];
        if (doc.containsKey("lowThreshold"))  lowThreshold  = doc["lowThreshold"];
        if (doc.containsKey("highThreshold")) highThreshold = doc["highThreshold"];
      }

      sendState(); // Always reply with updated state
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
  Serial.println("\n=== Smart Home Remote Boot ===");

  // Load saved settings
  prefs.begin("smarthome", false);
  pumpAutoMode = prefs.getBool("pumpAuto", true);

  // LCD
  Wire.begin(21, 22);
  Wire.setTimeOut(100);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    hasLCD = true;
    lcd.init(); lcd.backlight(); lcd.clear();
    lcd.print("SmartHome Remote");
    lcd.setCursor(0, 1); lcd.print("Connecting WiFi..");
  }

  // Relays (active LOW — start OFF = HIGH)
  for (int i = 0; i < 5; i++) {
    pinMode(RELAY_LIGHTS[i], OUTPUT);
    digitalWrite(RELAY_LIGHTS[i], HIGH);
  }
  pinMode(RELAY_PUMP, OUTPUT);
  digitalWrite(RELAY_PUMP, HIGH);

  // Motor
  pinMode(MOTOR_IN1, OUTPUT); digitalWrite(MOTOR_IN1, LOW);
  pinMode(MOTOR_IN2, OUTPUT); digitalWrite(MOTOR_IN2, LOW);

  // Sensors
  pinMode(IR_PIN, INPUT);

  // Servos
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  gateServo.setPeriodHertz(50); gateServo.attach(SERVO_PIN,  500, 2400); gateServo.write(0);
  servo2.setPeriodHertz(50);    servo2.attach(SERVO2_PIN, 500, 2400);    servo2.write(0);

  // Ultrasonic task on Core 0
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
    if (hasLCD) { lcd.clear(); lcd.print("WiFi OK"); lcd.setCursor(0,1); lcd.print(WiFi.localIP()); }
  } else {
    Serial.println("\nWiFi: FAILED — will retry in loop");
  }

  // Connect to Render.com via SSL WebSocket
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);  // Ping every 15s to keep alive
  Serial.printf("WebSocket: Connecting to wss://%s%s\n", WS_HOST, WS_PATH);
}

// ─────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────
void loop() {
  // WiFi watchdog
  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi: Lost connection — reconnecting...");
      WiFi.reconnect();
    }
  }

  // WebSocket handler (MUST call every loop)
  webSocket.loop();

  // Auto pump logic — runs every tick, instant relay response
  if (pumpAutoMode) {
    if (waterPercentage > 0 && waterPercentage <= lowThreshold && !pumpState) {
      pumpState = true;
      digitalWrite(RELAY_PUMP, LOW);
      Serial.printf("Auto Pump ON  (Water %d%% <= Low %d%%)\n", waterPercentage, lowThreshold);
      sendState();
    } else if (waterPercentage >= highThreshold && pumpState) {
      pumpState = false;
      digitalWrite(RELAY_PUMP, HIGH);
      Serial.printf("Auto Pump OFF (Water %d%% >= High %d%%)\n", waterPercentage, highThreshold);
      sendState();
    }
  }

  // Gate auto-close
  if (gateAutoCloseTime > 0 && millis() > gateAutoCloseTime) {
    gateAutoCloseTime = 0;
    servoAngle = 0; gateServo.write(0);
    sendState();
    Serial.println("Gate → Auto-Closed (8s timer)");
  }

  // Read sensors every 500ms
  if (millis() - lastSensorRead > 500) {
    lastSensorRead = millis();
    readSensors();
  }

  // Live broadcast every 250ms for smooth water level updates
  if (millis() - lastBroadcast > 250) {
    lastBroadcast = millis();
    sendState();
  }
}
