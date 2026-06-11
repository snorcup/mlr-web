# Monome Classic USB Notes

MLR Web supports two connection paths for monome classic hardware:

1. **Primary: WebSocket-to-OSC bridge** (via local serialosc daemon)
2. **Fallback: Web Serial API** (direct binary protocol)

## Connection Architecture

### Path 1: serialosc WebSocket Bridge (recommended)

This is the primary connection path for older monome classic hardware where key events come over the HID interface (not serial).

```
Browser (ws://localhost:8089)
    ↓ JSON over WebSocket
serialosc-ws-bridge (Node.js)
    ↓ OSC UDP
serialosc daemon (serialoscd, UDP :12002)
    ↓ libusb (raw USB, bypasses kernel drivers)
monome grid (ttyUSB0 + hidraw0)
```

The bridge runs as a local systemd user service on the user's machine (where the monome USB is plugged in). The browser connects to it via WebSocket at `ws://localhost:8089`.

### Path 2: Web Serial Direct (fallback)

Used when the bridge is unavailable or for hardware that emits key bytes over the serial interface. Opens the monome as an FTDI serial device.

## Grid Layout

- Rows 1-6: track slice triggers (tracks 1-6)
- Columns 0-15: 16 slices per track row
- Row 0 (nav): view buttons (x=0-2), patterns (x=4-7), recalls (x=8-11), quantize (x=14), alt (x=15)
- Row 7 (function): track modes (x-0-3: CUT/SOLO/MUTE/ONCE), pattern toggle (x-4-7)

## Monome Serial Protocol (Web Serial Fallback)

The monome classic speaks a compact byte protocol over FTDI USB serial. Only a subset is used by this app.

### To Device (LED commands)

| Command | Bytes | Description |
|---------|-------|-------------|
| LED off | `0x10 x y` | Turn off LED at (x, y) |
| LED on | `0x11 x y` | Turn on LED at (x, y) |
| All off | `0x12` | Clear all LEDs |
| All on | `0x13` | Light all LEDs |
| LED level | `0x18 x y level` | Set brightness 0-15 at (x, y) |
| Intensity | `0x17 level` | Global brightness 0-15 |
| System query | `0x00` | Query system info |

### From Device (key events)

| Command | Bytes | Description |
|---------|-------|-------------|
| Key up | `0x20 x y` | Pad at (x, y) released |
| Key down | `0x21 x y` | Pad at (x, y) pressed |

## OSC Protocol (via serialosc Bridge)

Serialosc uses a two-level OSC hierarchy:

1. **Supervisor** (port 12002) manages devices
2. **Per-device servers** (random ports) handle individual grids

### Discovery Flow

```
Browser → Supervisor (UDP :12002):  /serialosc/list "127.0.0.1" <replyPort>
Supervisor → Browser (at replyPort): /serialosc/device "m128-386" "monome 128" <devicePort>
```

Then configure the device:

```
Browser → Device (devicePort): /sys/host "127.0.0.1"
Browser → Device (devicePort): /sys/port <bridgePort>
Browser → Device (devicePort): /sys/prefix "/monome"
```

### Key Events (device → browser)

```
/monome/grid/key x y s    (s=1 press, s=0 release)
```

### LED Commands (browser → device)

```
/monome/grid/led/set x y s          (s=0 off, s=1 on)
/monome/grid/led/level/set x y l    (brightness 0-15)
/monome/grid/led/all s              (all LEDs off/on)
/monome/grid/led/level/map x y r0 r1 r2 r3 r4 r5 r6 r7  (8 rows of 8-bit values)
```

## serialosc-ws-bridge JSON Protocol

The WebSocket bridge converts between browser JSON and serialosc OSC.

### Browser → Bridge

| Message | Description |
|---------|-------------|
| `{"type":"discover"}` | Request device list from serialosc supervisor |
| `{"type":"connect", "port": N}` | Connect to device on OSC port N |
| `{"type":"led_set", "x": N, "y": N, "s": N}` | Set LED on/off |
| `{"type":"led_level_set", "x": N, "y": N, "level": N}` | Set LED brightness 0-15 |
| `{"type":"led_all", "s": N}` | All LEDs on/off |

### Bridge → Browser

| Message | Description |
|---------|-------------|
| `{"type":"device", "id": "...", "name": "...", "port": N}` | Device discovered |
| `{"type":"status", "msg": "connected..."}` | Connection status |
| `{"type":"key", "x": N, "y": N, "z": N}` | Key event (z=1 press, z=0 release) |

## Setting Up the Bridge on a New Machine

### Build Dependencies (Debian/Ubuntu)

```bash
sudo apt install build-essential libusb-1.0-0-dev liblo-dev libuv1-dev libudev-dev cmake
```

### Build libmonome

```bash
git clone https://github.com/monome/libmonome.git
cd libmonome
mkdir build && cd build
cmake ..
make
sudo make install
sudo ldconfig
```

### Build serialosc

```bash
git clone https://github.com/monome/serialosc.git
cd serialosc
./waf configure
./waf build
sudo ./waf install
```

### Install the WS Bridge

From the mlr-web repo:

```bash
# Copy bridge script and systemd service
cp scripts/serialosc-ws-bridge.js ~/serialosc-ws-bridge.js
cp scripts/serialosc.service ~/.config/systemd/user/
cp scripts/serialosc-ws-bridge.service ~/.config/systemd/user/

# Edit service files if needed (WorkingDirectory, ExecStart paths)

systemctl --user daemon-reload
systemctl --user enable --now serialosc
systemctl --user enable --now serialosc-ws-bridge
```

### Verify

```bash
# serialosc daemon should be running
systemctl --user status serialosc

# WS bridge should be listening on :8089
ss -tlnp | grep 8089
systemctl --user status serialosc-ws-bridge

# Bridge should have discovered the device
journalctl --user -u serialosc-ws-bridge --no-pager -n 20
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Bridge connects but no key events | Kernel FTDI/HID drivers own the device | serialosc via libusb detaches kernel drivers; restart serialosc |
| `reader.read()` blocks forever | Device echoes LED state via serial, not key events | Use serialosc bridge — key events come via HID |
| `requestPort()` shows no devices | FTDI filters too restrictive | `navigator.serial.requestPort()` with no filters |
| `open()` fails on Linux | ModemManager claims the port | `sudo systemctl stop ModemManager` |
| Web HID picker empty | Device is class 0xFF not 0x03 | Chrome filters vendor-specific interfaces; use bridge |
| Bridge WebSocket timeout after reboot | serialosc daemon or WS bridge didn't start | Check both services; `systemctl --user start serialosc serialosc-ws-bridge` |
| Browser shows old JS after deploy | Cache not busted | Hard-refresh (`Ctrl+Shift+R`) or open in Incognito |
| No sound | AudioContext suspended | Click "Start audio" button (browser autoplay policy) |

## Why serialosc Instead of Direct Web Serial

Older monome classic hardware (m128-386 and similar) has two USB interfaces:
- **Serial (ttyUSB0)**: Receives LED commands, echoes LED state back. Does NOT emit key bytes.
- **HID (hidraw0)**: Emits binary HID reports on pad press/release. USB interface class is 0xFF (Vendor Specific).

Chrome's Web HID API filters out devices with interface class ≠ 0x03 (HID), so the monome is invisible to the browser. Even if accessed directly via Web Serial, the serial interface only carries LED state — not key events.

serialosc uses libusb to talk directly to the device, bypassing kernel drivers entirely, and bridges both HID and serial interfaces into clean OSC messages that are then forwarded to the browser via the WebSocket bridge.
