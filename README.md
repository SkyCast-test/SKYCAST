# SkyCast - Weather Information Fetcher

Real-time weather and a 5-day forecast for any city. Free [Open-Meteo](https://open-meteo.com/) API, no API key.

**SDMS, MITS Gwalior**

## Two versions in this repo

| Folder | What it is | Where it runs |
|---|---|---|
| `public/` | Static site (HTML/CSS/JS). The browser calls Open-Meteo directly. | Netlify, GitHub Pages |
| `flask-version/` | Original Python (Flask) app with a `/api/weather` backend. | Your computer, Render, PythonAnywhere |

## Deploy the static site on Netlify
1. Push this repo to GitHub.
2. On netlify.com: **Add new site -> Import an existing project -> GitHub** and pick this repo.
3. Build command: *(leave empty)*. Publish directory: `public` (already set in `netlify.toml`).
4. **Deploy**. Every `git push` redeploys automatically.

## Run the Flask version locally
```bash
cd flask-version
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5000
python -m unittest test_skycast -v
```

## Features
- Search any city (or `City, Country`), use your location, recent searches (remembers your last city)
- Colour theme and animation (rain, snow, night stars) change with the live weather
- Current conditions: feels like, humidity, wind + direction, pressure, UV index, rain chance, air quality (AQI), visibility, cloud cover, sunrise/sunset
- Next-24-hours strip, 7-day forecast with temperature range bars, smart weather tip
- Switch between °C and °F, refresh, share
- Mobile-first: big tap targets, no iOS input zoom, safe-area support, swipeable hourly strip, installable (Add to Home Screen)

Created by Chirag Bansal and Harshit Shekhar
