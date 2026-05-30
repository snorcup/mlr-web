# Monome Classic USB Notes

This app talks directly to monome classic over USB serial using the native packet protocol. It does not require serialosc.

## Browser pairing

Click **Connect monome USB**. Chromium shows a serial device picker. Pick the FTDI/monome device.

## Packet subset used

To device:

- `0x10 x y` — LED off
- `0x11 x y` — LED on
- `0x12` — all LEDs off
- `0x13` — all LEDs on
- `0x18 x y level` — set variable brightness level

From device:

- `0x20 x y` — key up
- `0x21 x y` — key down

## Troubleshooting

- Use Chrome/Edge. Firefox and Safari do not expose Web Serial.
- Use `localhost` or HTTPS. Web Serial is blocked on plain remote HTTP.
- If the picker does not show the monome, check OS permissions for USB serial devices.
- If LEDs do not update, reconnect and check that another application is not holding the serial port.
