# garni-netatmo-sync

Feeds the room temperature measured by a **Garni 419T** weather station (via Tuya Cloud) into a **Netatmo Smart Thermostat** using the *true temperature* feature. That's the same calibration you can do by hand in the Netatmo Energy app.

Why: the thermostat's built-in sensor is often in a bad spot (near a door, on a cold wall, above a radiator). The Garni sits where the temperature actually matters, and the thermostat regulates by it.

- Written in TypeScript with no runtime dependencies. Node.js ≥ 22.18 runs the `.ts` files directly, with no build step (type stripping).
- Runs anywhere Node runs. A `docker-compose.yml` for Synology Container Manager is included.

> **Disclaimer:** This is an unofficial project, not affiliated with Netatmo, Legrand, Garni or Tuya. The Netatmo `truetemperature` endpoint is undocumented: the official app uses it, but it is not part of the public developer API. It may stop working at any time. Use at your own risk.

## How it works

Every `INTERVAL_SEC` (default 5 minutes) the program:

1. Reads the Garni temperature from Tuya Cloud.
2. Reads the thermostat's measured temperature, the setpoint and the boiler state from Netatmo.
3. Decides whether to calibrate (see below). If so, it sets the Netatmo *true temperature* to the Garni value.

### Calibration modes

**Default (`CALIBRATE_ONLY_WHEN_WRONG=0`):** calibrate whenever the two readings differ by at least `THRESHOLD`. The thermostat then roughly displays the Garni temperature.

**Only when regulation is wrong (`CALIBRATE_ONLY_WHEN_WRONG=1`, recommended):** with the advanced heating algorithm (PID), the thermostat heats in proportion to the error and has no fixed on/off point. Every calibration shifts the temperature it works with in one step and disturbs the regulation. So as long as regulation is fine, the displayed value is left alone:

| Garni | Netatmo | Action |
| --- | --- | --- |
| within setpoint ± `TOLERANCE` | anything | nothing, regulation is fine |
| above setpoint + `TOLERANCE` | at least `THRESHOLD` colder than Garni | calibrate (overheating) |
| below setpoint − `TOLERANCE` | at least `THRESHOLD` warmer than Garni | calibrate (underheating) |

This works with the Hysteresis algorithm too. In that case set `TOLERANCE` to the threshold configured in the app (default 0.2 °C).

In both modes, calibrations are at least `MIN_CALIBRATION_GAP_SEC` apart. Readings outside `VALID_MIN`–`VALID_MAX` or differing by more than `MAX_DIFF` are skipped as suspicious.

## 1. Tuya API keys (Garni 419T)

1. Pair the Garni in the **Tuya Smart** or **Smart Life** app. Linking via QR does not work with white-label vendor apps. If the Garni is paired in one of those, re-pair it in Smart Life.
2. At <https://platform.tuya.com> open *Cloud → Development → Create Cloud Project*:
   - Development Method: **Smart Home**
   - Data Center: must match the region of your app account, e.g. **Central Europe Data Center** for Czechia.
   - In the next step keep the preselected API services (*IoT Core*, *Authorization Token Management*) and click *Authorize*.
3. In the project, open *Devices → Link App Account → Add App Account*. A QR code appears. Scan it in Smart Life via *Me → scanner icon (top right)* and confirm. *Read Only* permission is enough.
4. Copy these values:
   - **Device ID** from *Devices → All Devices* → `TUYA_DEVICE_ID`. **Don't confuse it with the account UID** from *Link App Account* (looks like `eu1682…`). With the UID, Tuya returns `1106 permission deny`.
   - **Access ID** and **Access Secret** from *Overview → Authorization Key*.
5. You can check access without this program: *Cloud → API Explorer → Device Control → Get Device Status* with the Device ID.

> The free IoT Core trial has to be extended every 6 months (*Cloud → Cloud Services → IoT Core → Extend Trial*), otherwise Tuya stops responding.

## 2. Configuration

```bash
cp .env.example .env
```

Fill in the Tuya and Netatmo credentials and keep `DRY_RUN=1`. Leave `NETATMO_HOME_ID` and `NETATMO_ROOM_NAME` empty and the program picks the first home and the first room with a module. Set them only if it picks the wrong one. Then run:

```bash
node src/main.ts --list
```

The output looks roughly like this:

```text
│ code                │ raw │ unit │ TUYA_TEMP_SCALE │ value │
│ 'va_temperature'    │ 207 │ 'C'  │ 10              │ 20.7  │
│ 'va_humidity'       │ 68  │ '%'  │ 1               │ 68    │
│ 'temp_unit_convert' │ 'c' │ ''   │ ''              │ ''    │
Home "…"  id=…
   room "Living room"  id=…  modules=…
   status …: measured 18.5 °C, setpoint 21 °C
```

- **Tuya DP codes:** on the Garni 419T the main unit (indoor sensor) temperature is `va_temperature` with divisor 10. Those are the defaults (`TUYA_TEMP_CODE`, `TUYA_TEMP_SCALE`). The `TUYA_TEMP_SCALE` column shows the divisor for every code.
- **Netatmo homes and rooms:** check that `measured` matches what the thermostat shows.

Then let it run in dry-run mode for a while:

```bash
node src/main.ts
```

The log shows lines like:

```text
Garni 20.7 °C | Netatmo 18.5 °C (setpoint 21 °C, boiler on) | diff 2.2
[DRY_RUN] would set true temperature to 20.7 °C
```

When the numbers look right, switch to `DRY_RUN=0`.

### All settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `TUYA_BASE_URL` | `https://openapi.tuyaeu.com` | Tuya data center endpoint |
| `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET` | – | Tuya cloud project keys |
| `TUYA_DEVICE_ID` | – | Garni device ID |
| `TUYA_TEMP_CODE` | `va_temperature` | DP code carrying the temperature |
| `TUYA_TEMP_SCALE` | `10` | divisor for the raw value |
| `NETATMO_USERNAME`, `NETATMO_PASSWORD` | – | Netatmo account login |
| `NETATMO_HOME_ID`, `NETATMO_ROOM_NAME` | first home / room with a module | which thermostat to calibrate |
| `INTERVAL_SEC` | `300` | polling interval |
| `THRESHOLD` | `0.3` | minimum difference (°C) to calibrate |
| `MIN_CALIBRATION_GAP_SEC` | `900` | minimum time between calibrations |
| `MAX_DIFF` | `6` | larger difference is treated as a bad reading |
| `VALID_MIN`, `VALID_MAX` | `5`, `35` | plausible Garni range (°C) |
| `DRY_RUN` | `0` | `1` = log only, never write to Netatmo |
| `CALIBRATE_ONLY_WHEN_WRONG` | `0` | `1` = calibrate only when regulation is wrong |
| `TOLERANCE` | `0.2` | band around the setpoint (°C) for the mode above |

Values already set in the process environment take precedence over `.env`.

### External sensor (CH1)

In the standard instruction mode, Tuya returns only the main unit's temperature and humidity and leaves out the external channels. To use the CH1 sensor (only useful if it is in the same room as the thermostat):

1. In the Tuya project open *Devices*, click the Garni product and choose *Change Control Instruction Mode → DP Instruction*.
2. Wait a few minutes and run `node src/main.ts --list` again.
3. Put the CH1 code into `TUYA_TEMP_CODE`. If it's unclear which code belongs to CH1, warm the sensor in your hand and run `--list` again.

Note: after switching modes, the main unit's code may change too.

## 3. Deployment on Synology

1. Upload the folder, including `.env`, e.g. to `/volume1/docker/garni-netatmo-sync`. `node_modules` is not needed.
2. In **Container Manager → Project → Create** pick that path. `docker-compose.yml` is used.
3. After changing `.env`, just **restart** the container: `.env` is read on startup. After changing `docker-compose.yml`, **rebuild** the project.
4. Logs are in Container Manager under the container's *Log* tab. Don't add a `logging` section (e.g. `driver: json-file`) to `docker-compose.yml`: Synology uses its own log driver and the *Log* tab stays empty with any other. Over SSH, `sudo docker logs -f garni-netatmo-sync` always works.

## Development

| File | Contents |
| --- | --- |
| `src/main.ts` | entry point, `--list` / `--once` flags, main loop |
| `src/config.ts` | `.env` loading and configuration |
| `src/tuya.ts` | Tuya Cloud client |
| `src/netatmo.ts` | Netatmo client (logs in like the mobile app) |
| `src/sync.ts` | one pass: read both temperatures, calibrate |
| `src/decide.ts` | calibration decision (pure function) |
| `src/list.ts` | output of `--list` |
| `src/utils.ts` | `log`, `sleep`, `round1` |

```bash
npm test            # decision logic tests (node:test, no install needed)
npm install         # only for type checking and editor support (typescript, @types/node)
npm run typecheck
```

Node only strips types, so only erasable syntax works: no `enum`, `namespace` or `constructor(private x)`. `erasableSyntaxOnly` in `tsconfig.json` enforces this. Imports need the `.ts` extension.

## Troubleshooting

| Log message | Cause |
| --- | --- |
| `Tuya …: 1106 permission deny` | `TUYA_DEVICE_ID` holds the account UID instead of the Device ID. Or the device is not linked to the project (wrong data center, Garni not in Smart Life). |
| `Tuya: DP "…" not found. Available: …` | Wrong `TUYA_TEMP_CODE`, pick one of the listed codes. |
| `Tuya: Garni is offline, …` | The station dropped off Wi-Fi. Tuya would keep returning its last reading, so nothing is calibrated until it is back online. |
| `The operation was aborted due to timeout` | Tuya or Netatmo did not answer within 30 s. The next pass tries again. |
| `Netatmo: login failed` | Wrong Netatmo username or password. |
| `Netatmo …: HTTP 502` | Transient outage on Netatmo's side. The request is retried once after 10 s, then again on the next pass. |

## License

[MIT](LICENSE)
