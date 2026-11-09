# SkyCast

SkyCast is a responsive weather dashboard built with Python, Flask, HTML, CSS, and JavaScript. It uses the free Open-Meteo geocoding and forecast APIs; no API key is required.

## Features

- Current conditions and a five-day forecast for cities around the world
- Search suggestions, recent searches, and optional device location
- Celsius/Fahrenheit display toggle
- Weather-responsive colors, mobile-friendly layout, and accessible status messages
- Clear error messages when the app or the weather provider is unavailable

## Run on Windows

1. Install Python 3.10 or newer.
2. Open PowerShell in this project folder.
3. Install the project packages:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Start the Flask server:

   ```powershell
   python app.py
   ```

5. Keep that PowerShell window open and visit <http://127.0.0.1:5000> in a browser.

The app contacts Open-Meteo, so an internet connection is needed for weather results. The local server must remain running while you use the page. If the page says it cannot reach the SkyCast server, return to PowerShell, start `python app.py`, and refresh the browser.

## Tests

Run the API regression tests from the project folder:

```powershell
python -m unittest discover -s tests -v
```

## How it works

1. The browser requests `/api/weather` with a city name or device coordinates.
2. Flask looks up city coordinates with Open-Meteo Geocoding when needed.
3. Flask retrieves current conditions and five days of forecast data from Open-Meteo.
4. The page renders the weather and converts temperatures locally when the display unit changes.

## Show it to your teacher

1. Start the server using `python app.py`; leave the terminal visible so you can explain that it runs the Flask backend.
2. Open <http://127.0.0.1:5000> in Chrome or Edge and briefly introduce SkyCast and its Open-Meteo data source.
3. Let the default Gwalior weather load, then point out the current temperature, condition, humidity, wind, pressure, and sunrise/sunset.
4. Press the **°C / °F** control and show that the temperatures update without making another weather request.
5. Select a suggested city such as Mumbai, London, or Tokyo; then show the five-day forecast and recent-search buttons.
6. If the teacher agrees, select the location pin and allow location access to demonstrate a coordinate-based lookup. City search works without granting location permission.
7. Briefly show the responsive layout by narrowing the browser window, and explain the Flask route, Open-Meteo requests, and browser rendering.
8. To demonstrate reliability, run `python -m unittest discover -s tests -v` in another terminal. Mention that live weather needs internet access and that the server terminal must stay open during the demo.

## Project structure

```text
app.py              Flask routes and Open-Meteo API integration
requirements.txt    Python dependencies
templates/
  index.html        Dashboard structure
static/
  script.js         Search, rendering, and temperature-unit behavior
  style.css         Responsive visual design
tests/
  test_app.py       Weather API regression tests
```

Weather data is provided by [Open-Meteo](https://open-meteo.com/).
