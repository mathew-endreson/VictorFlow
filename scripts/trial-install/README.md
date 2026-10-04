# VictorFlow trial install (phase 1)

Two PCs on the same network: **PC 1 = the shop server**, **PC 2 = a company PC with the desktop app**, plus a phone
or any third device with a browser. Each step that ends in **Bring back** produces a file or a note for the review.

| Kit folder | Contents |
|---|---|
| `1-server/` | `VictorFlow-Server-Setup-<version>.exe`, `check-server.cmd` / `.ps1`, `check-server-after-uninstall.cmd` |
| `2-client/` | `VictorFlow_<version>_x64-setup.exe`, `check-client.cmd` / `.ps1` |
| `KIT-INFO.txt` | which GitHub Actions runs and commits the installers come from, with their SHA-256 |

The scripts only read; they change nothing. Reports are written next to the scripts (on the USB stick). The server report
never contains `secrets.json` or `first-login.txt`, and masks any secret that appears in a log.

## 0. Copy the kit

Copy the whole `trial-kit` folder to a USB stick (about 100 MB). Keep it writable: the reports are saved on it.

## 1. PC 1 — install the server

1. Sign in to PC 1 with an administrator account. Plug it into the network with a cable if you can, and set the
   network to **Private** (Settings → Network & internet → your network → Private network).
2. Open `1-server` on the USB stick and run `VictorFlow-Server-Setup-<version>.exe`.
   - **"Windows protected your PC"** (SmartScreen, the installers are not code-signed yet): click **More info** →
     **Run anyway**. Then **Yes** at the administrator prompt.
   - If Windows says an **Application Control policy blocked** the file, that is Smart App Control: it cannot be bypassed
     for one program. Note it and stop here (Bring back: a photo of the message).
3. Pick a language, keep the program folder, and keep the data folder `C:\ProgramData\VictorFlow` (Next → Install).
   Setup installs the Microsoft C++ runtime, creates the database and starts the services: about a minute.
4. The last page shows the **server address** for the PCs (for example `192.168.1.10:3000`). Note it.
   Bring back: a photo of the last page, or of any error message (the error names `logs\setup.log`).
5. Double-click `check-server.cmd` (answer **Yes** to the administrator prompt). It writes `1-server\report-server.txt`.
   **Bring back: `report-server.txt`.**

## 2. PC 1 — read the address and the first sign-in yourself

These two files are in the data folder, which only administrators can open. **Do not open it in File Explorer and click
"Continue"**: that would give your Windows account permanent access to the server's secrets.

1. Start menu → type **Notepad** → right-click → **Run as administrator**.
2. File → Open → type `C:\ProgramData\VictorFlow\addresses.ini` → Open. The line `api=` is the address the desktop app
   needs (`apiByName=` is the same through the computer name); `tracker=` and `display=` are the two web pages.
   (The file is called `addresses.ini`, not `.txt`.)
3. File → Open → `C:\ProgramData\VictorFlow\first-login.txt`: the e-mail `admin@victorflow.local` and this install's
   password. Write the password down on paper; do not copy it into a report.

## 3. PC 2 — install the desktop app and check the connection

1. Open `2-client` on the USB stick and run `VictorFlow_<version>_x64-setup.exe` (SmartScreen: **More info** →
   **Run anyway**). It installs for the current Windows user.
2. Double-click `check-client.cmd`, type the `api=` address (for example `192.168.1.10:3000`) and press Enter.
   It writes `2-client\report-client.txt`. **Bring back: `report-client.txt`.**
3. Start **VictorFlow**. The first screen checks the server:
   - **Cannot reach the VictorFlow server** with the reason → click **Change**, type the `api=` address, **Save**.
   - The sign-in screen appears → sign in with `admin@victorflow.local` and the password from `first-login.txt`.
4. Try a little real work: create a customer, an order, confirm it, open the order's tracking link.
   Bring back: what worked, what didn't (a photo of any error screen).
5. Optional: on PC 1, stop the API (as administrator: `"C:\Program Files\VictorFlow Server\vf-server.cmd" stop`) while the
   app is open on PC 2: a banner should say the connection is lost; `... vf-server.cmd start` and it should clear.

## 4. A phone or third device — tracker and displays

On the same Wi-Fi/network, open in a browser (addresses from `addresses.ini`):

- `tracker=` (for example `http://192.168.1.10:3001`): the **Track your order** page. The tracking link of the order you
  created on PC 2 should open the order's timeline (no prices, no customer name).
- `display=` (for example `http://192.168.1.10:3002`): **This screen is not paired yet**, in French, Arabic and English.

Bring back: whether each page opened (a photo is enough).

## 5. PC 1 — uninstall the server, keep the data

1. Settings → Apps → Installed apps → **VictorFlow Server** → Uninstall. At the end it says the data was kept, and where.
2. Double-click `check-server-after-uninstall.cmd` (administrator prompt: **Yes**). It writes
   `1-server\report-server-after-uninstall.txt`: the services and firewall rules should be gone, and the data folder
   (database, config, secrets) still there. **Bring back: `report-server-after-uninstall.txt`.**

## What to bring back

`report-server.txt`, `report-client.txt`, `report-server-after-uninstall.txt`, and your notes or photos from steps 1.4,
3.4 and 4. Paste the reports into the conversation: they are compared against README.md → *Install at a shop*.

## Running the checks by hand

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File check-server.ps1 [-DataDir D:\VictorFlow] [-ReportPath X:\r.txt]
powershell -NoProfile -ExecutionPolicy Bypass -File check-client.ps1 -Server 192.168.1.10:3000 [-TrackerPort 3001] [-DisplayPort 3002]
```
