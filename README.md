# BTC Market Lab Pro v7 — five-level observed trend checks

## New: stronger trend snapshot (descriptive, not a prediction)

The read-only screen now displays **STRONG UP / LIGHT UP / HOLD OFF / LIGHT DOWN / STRONG DOWN** based on the **already observed** completed 1-minute BTC candles. The chart still uses real observed 1-second bars when Coinbase trades are streaming. The trend analysis does not extrapolate that 1-second data into a prediction.

It runs 11 transparent checks grouped by momentum, trend averages, oscillators, candle structure, and volume-weighted price. Seven quality gates include data freshness, continuous candles, source consistency, validated prices, and an unusual-spike check. A more stringent alignment threshold is required for STRONG; mixed readings are HOLD OFF. A check's alignment is **not a confidence probability**. Indicators are correlated; 11 checks do not imply 11 independent votes. Expand **See all trend and data checks** to inspect every item.

Historical consistency in this app measures whether an observed label agrees with movement within the **same already completed 15-minute window**, not accuracy of a forecast made before that window. No model can guarantee near-perfect short-term BTC direction. The learning archive updates from completed history while the app runs and is restored from the saved browser database on reopening; it does not automatically improve future predictions.

## Updating an existing v6 installation

Replace all web files at the same HTTPS address, including `core.mjs`, `app.js`, `style.css` and `sw.js`; the new service worker cache name helps refresh the shell. Your on-device history is kept in the same IndexedDB database if the site address, browser/profile, and storage permissions stay the same. Back up your data from **My progress** before updating. On iPhone, reopen the Home Screen app while online; if necessary close it and open again.

## Open on Windows

1. Unzip **BTC_Market_Lab_Pro.zip** and keep its files together.
2. Install Python 3 if necessary (any recent Python 3.x version).
3. Double-click **START_WINDOWS.bat**. This starts the built-in local server and opens your browser automatically.
4. The app opens at **http://127.0.0.1:8765/**. It requires no Python packages or exchange keys.
5. To get a desktop app icon, open the browser's **Install app** menu in Chrome or Edge when offered. The installed app still needs the Python launcher running to open its local URL.
6. Close the terminal window or press Ctrl+C to stop the server. Your saved browser data remains in that browser profile.

Alternative: `python desktop.py --port 9000`. On macOS double-click **START_MAC.command** (may need to allow it in System Settings) or run `python3 desktop.py`. On Linux run `sh START_LINUX.sh`.

## Open on iPhone or Android

### From a computer on the same Wi-Fi (no hosting account)

1. On Windows, double-click **START_WINDOWS_MOBILE_WIFI.bat** (or run `python desktop.py --lan`).
2. Copy the `Phone on same Wi-Fi` address from the terminal into your phone's browser. Keep your computer turned on and allow the server only on your trusted **private** network.
3. This works as a mobile **webpage**. Your phone's browser saves its own data. It is **not** normally an installable offline PWA from a plain `http://192.168.x.x` address.

### Install to the home screen

1. Upload the **web app files** (`index.html`, `app.js`, `core.mjs`, `style.css`, `manifest.webmanifest`, `sw.js`, and the `icons` folder) to a static HTTPS host such as GitHub Pages or Cloudflare Pages. Keep backups private.
2. Open that HTTPS URL on your phone.
3. **iPhone:** Safari → Share → **Add to Home Screen**. **Android:** Chrome menu → **Install app** / **Add to Home Screen**.
4. Open from the home-screen icon. The shell and previously saved candles are usable without internet, but live price updates and the embedded TradingView chart require internet.

**Important:** Some static web hosts or browsers may block direct exchange historical requests with CORS or rate limits. The app tries Coinbase and then Kraken; if both are unavailable, it clearly shows a limited feed and retains saved history. Desktop mode uses the same-origin Python proxy and is more reliable for initial history.

## How saving and learning work

The app saves completed candles as they arrive to each browser's IndexedDB store. The historical chart library is rebuilt from that saved data every session, including prior charts from before you opened the app. It needs 24 complete 15-minute charts to compare shapes, and can grow to roughly 30 days of stored minute bars. Historical regime thresholds and journals are recalculated from saved candles and therefore reappear after you close and reopen the app. Chart range/type and EMA visibility are saved too. The archive is capped to about **30 days** of 1-minute candles; older observations roll off. It restores cached history and attempts to fill a recent gap when online again.

**Keeping the app open longer yields more completed observations, not guaranteed prediction accuracy.** The app does not secretly collect data while fully closed. The volatility adaptation recomputes on reopening from the saved archive (rolling 30 days). It is not an automated machine-learning prediction bot. Its learning is descriptive calibration of historical volatility and patterns.

Choose **My progress → Export saved progress** for a backup. On another device use **My progress → Import backup** to transfer your history. There is no automatic cloud sync, and a browser can erase IndexedDB when storage is cleared, private mode is used or storage space is low. The **Request persistent storage** button helps only when the browser supports and grants it.

## Optional TradingView chart

The **Open chart** button embeds an external BTC/USD chart from TradingView. It is for visual comparison only. The app does not scrape, interpret or import indicator readings from the embedded chart.

## Testing

Run `node tests.mjs` for indicator and archive calculations. Run `python -m py_compile desktop.py` for Python syntax. For desktop startup, run `python desktop.py --no-browser` and open the printed URL.

The downloadable ZIP is a **Python-launched installable web app**, not a native `.exe`, `.apk` or `.ipa` binary. Installing a PWA on phone requires your own HTTPS deployment, except local development contexts.

**Interpretation:** pattern resemblance and historical same-window label consistency are descriptive metrics, not backtested trading accuracy. More history improves the size of the comparison set but does not prove forecasting edge. No recommended buy/sell prices, automated betting, or trade execution are included.
