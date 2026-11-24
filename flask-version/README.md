# SkyCast - Weather Information Fetcher in Python

A web app that shows real-time weather and a 5-day forecast for any city.
Built with **Python (Flask)**, HTML, CSS and JavaScript. Uses the free
[Open-Meteo](https://open-meteo.com/) API, so no API key is needed.

**SDMS, MITS Gwalior**

## Features
- Real-time weather data (temperature, feels like, humidity, wind, pressure)
- Location-based info: search any city, or tap the pin to use your location
- Sunrise / sunset times and 5-day forecast
- Recent searches saved in the browser
- Responsive web interface (laptop and mobile)
- Clear error messages for unknown cities or no internet

## Project Structure
```
skycast/
├── app.py              # Flask backend + API calls
├── requirements.txt    # Python dependencies
├── templates/
│   └── index.html      # Web page
└── static/
    ├── style.css       # Styling
    └── script.js       # Frontend logic
```

## How to Run
```bash
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000 in your browser.

## Run the tests
```bash
python -m unittest test_skycast -v
```

## Notes
- Open the app through Flask (http://127.0.0.1:5000), not by double-clicking `index.html`; the page needs the `/api/weather` route.
- Search accepts `City` or `City, Country/State` (e.g. `Paris, France`).
- "Use my location" needs `localhost`/`127.0.0.1` or HTTPS, and browser permission.
- Set `FLASK_DEBUG=0` and/or `PORT=8000` to change the dev-server settings.

## How It Works
1. The user types a city name in the browser.
2. `script.js` sends it to the Flask route `/api/weather`.
3. Flask converts the city to coordinates (Open-Meteo Geocoding API).
4. Flask fetches current weather and forecast (Open-Meteo Forecast API).
5. The result is returned as JSON and shown on the page.

## Tech Stack
Python 3, Flask, Requests, HTML5, CSS3, JavaScript
