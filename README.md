# Trip Inspector DRIVER · Trip Report (lightweight)

A phone app that produces a trip report PDF. There is no server and no login, and it works offline. All data stays on the phone.

## What's new in v1.1
- **GPS location** is captured at the pre-trip inspection, at every fuel stop, at trip end and for incidents. It is captured automatically, with a Capture/Update button as a backup, and each report ends with a GPS log with "Open map" links.
- **The pre-trip inspection is mandatory.** The trip cannot continue (and no report can be made) until all 7 items are done, in this order: 1 front, 2 driver side (right), 3 back, 4 passenger side (left), 5 licence disc, 6 odometer, 7 GPS.
- **Head office round trips.** Trips start at the head office (Windhoek) and return there by default. At trip end the GPS position is checked against the head office. If the vehicle is not back, the driver must say where it is, and the report flags it in red.
- **Incident tab** (red triangle, bottom middle): type, what happened, GPS, 6 photos, injuries, police case number, the other party, and the linked trip. It produces its own incident PDF, and incidents also appear in the trip report.
- **Settings → Install the app** puts it on the home screen. **Settings → Head office → Use my location as head office**: do this once while standing at the office.

## The flow
1. **Vehicle & driver**: pick from the lists you set up in Settings.
2. **Pre-trip inspection**:
   - Photos of the front, back, left and right of the vehicle.
   - A licence disc photo. The expiry date is read automatically (OCR); the driver confirms or corrects it.
   - An odometer photo. The reading is read automatically; the driver confirms it or types it in.
3. **Trip budget**:
   - Choose the From town, the destination and any stops, and tick if it is a return trip. The road distance is calculated from the built-in road network of 51 Namibian towns.
   - The fuel estimate updates live: km × l/100 km + buffer % × fuel price.
   - Enter the fuel money received.
4. **Refuelling**:
   - For each refuel, enter the cost (plus optional litres, odometer and station).
   - Photos for each refuel: receipt, pump display and odometer.
   - **Add another refuel** for each new fill-up.
   - The money still available updates live. If the driver pays from their own pocket, the app shows **Total due to driver**.
5. **Trip end**:
   - An odometer photo, read automatically and confirmed by the driver.
   - Actual distance = end − start.
   - Photos of the 4 sides again, plus notes.

**Generate report**:
- If anything was skipped, the app lists the missing items and offers **Cancel** or **Generate report anyway**. Missing items are marked "NOT CAPTURED" in the PDF.
- The PDF is saved to the phone's Downloads first.
- Then use **Share**: the phone's share menu offers WhatsApp, Gmail, Outlook, Bluetooth and more.

Steps can be done in any order, and an unfinished trip stays on the home screen.

## Publish on GitHub Pages (once, ~5 min)
1. Create a new **public** repository on github.com, e.g. `trip-report`.
2. **Add file → Upload files**. Drag in *everything inside* this folder: `index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, and the folders `js`, `lib`, `assets`, `icons`, `fonts`. Commit.
   - `.nojekyll` is hidden on some computers. If it doesn't upload, create an empty file with that name in GitHub.
3. **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. After about a minute the app is live at `https://<your-user>.github.io/trip-report/`.

## Install on each phone
1. Open the link in **Chrome** (Android) or **Safari** (iPhone).
2. Install it to the home screen: on Android, ⋮ → **Add to Home screen / Install app**; on iPhone, Share → **Add to Home Screen**.
3. Open it once while online so it is stored for offline use.
4. The first licence disc or odometer photo downloads the OCR engine (~15 MB, once). Do this on Wi-Fi before the first trip.
5. Go to **Settings** and add the vehicles (name, registration, fuel type, consumption l/100 km, odometer) and drivers (name, licence, cell). Then check the diesel and petrol prices and the buffer %.

## Good to know
- **Fuel prices** are set in Settings. A trip can also override the consumption and price in step 3.
- **Distances** come from published road distances (e.g. Windhoek–Swakopmund 361 km, –Keetmanshoop 482 km, –Rundu ≈700 km). For an unusual route, tick *Enter distance manually*.
- **OCR** works best on a sharp, close photo with no glare. Always check the number it fills in.
- **Backup**: Settings → Export backup saves vehicles, drivers and trip data (no photos) as a file. Import it on a new phone. Photos stay only in the phone's app storage and in the PDFs you shared.
- **Clearing the browser's site data deletes the trips.** Share or keep each PDF.
- **Updating the app**: upload the changed files to the repository and change `VERSION` in `sw.js`. Phones then show "Update available".
