# Monome Classic USB Notes

This app talks directly to an 8×16 monome classic over USB serial using the native packet protocol. It does not require serialosc.

## Browser pairing

Click **Connect monome USB**. Chromium shows a serial device picker. Pick the FTDI/monome device. The app expects an 8-row by 16-column classic layout and preserves key coordinates through column `15`.

## Grid layout

- Rows 0–6: track slice triggers.
- Columns 0–15: slices 1–16 for each track row.
- Bottom row columns 0–2: CUT/REC/TIME view selectors.
- Bottom row columns 8–11: play/stop patterns P1–P4.
- Bottom row columns 12–15: start/stop recording patterns P1–P4.

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
