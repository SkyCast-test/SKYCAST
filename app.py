"""
SkyCast - Weather Information Fetcher in Python
SDMS, MITS Gwalior

A small Flask web app that fetches real-time weather for any city using the
free Open-Meteo APIs (no API key required).

Run:  python app.py   ->  open http://127.0.0.1:5000
"""

import time
from datetime import datetime

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FALLBACK_URL = "https://wttr.in/{lat},{lon}"  # backup weather source
TIMEOUT = 8  # seconds
HEADERS = {"User-Agent": "SkyCast-College-Project/1.0"}

# Simple in-memory cache: avoids repeated API calls (and rate-limit errors)
CACHE = {}
CACHE_TTL = 600  # 10 minutes

# WMO weather interpretation codes -> (description, icon, is_day_icon_override)
WEATHER_CODES = {
    0: ("Clear Sky", "☀️", "🌙"),
    1: ("Mainly Clear", "🌤️", "🌙"),
    2: ("Partly Cloudy", "⛅", "☁️"),
    3: ("Overcast", "☁️", "☁️"),
    45: ("Fog", "🌫️", "🌫️"),
    48: ("Rime Fog", "🌫️", "🌫️"),
    51: ("Light Drizzle", "🌦️", "🌧️"),
    53: ("Drizzle", "🌦️", "🌧️"),
    55: ("Heavy Drizzle", "🌧️", "🌧️"),
    56: ("Freezing Drizzle", "🌧️", "🌧️"),
    57: ("Freezing Drizzle", "🌧️", "🌧️"),
    61: ("Light Rain", "🌦️", "🌧️"),
    63: ("Rain", "🌧️", "🌧️"),
    65: ("Heavy Rain", "🌧️", "🌧️"),
    66: ("Freezing Rain", "🌧️", "🌧️"),
    67: ("Freezing Rain", "🌧️", "🌧️"),
    71: ("Light Snow", "🌨️", "🌨️"),
    73: ("Snow", "❄️", "❄️"),
    75: ("Heavy Snow", "❄️", "❄️"),
    77: ("Snow Grains", "❄️", "❄️"),
    80: ("Rain Showers", "🌦️", "🌧️"),
    81: ("Rain Showers", "🌧️", "🌧️"),
    82: ("Violent Showers", "⛈️", "⛈️"),
    85: ("Snow Showers", "🌨️", "🌨️"),
    86: ("Snow Showers", "🌨️", "🌨️"),
    95: ("Thunderstorm", "⛈️", "⛈️"),
    96: ("Thunderstorm, Hail", "⛈️", "⛈️"),
    99: ("Thunderstorm, Hail", "⛈️", "⛈️"),
}


def describe(code, is_day=True):
    """Return (description, icon) for a WMO weather code."""
    text, day_icon, night_icon = WEATHER_CODES.get(code, ("Unknown", "❔", "❔"))
    return text, (day_icon if is_day else night_icon)


def get_with_retry(url, params=None, tries=2):
    """GET a URL; retry once if the server says 'too many requests' or is down."""
    last = None
    for attempt in range(tries):
        resp = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code in (429, 500, 502, 503, 504):
            last = resp
            time.sleep(1 + attempt)
            continue
        resp.raise_for_status()
        return resp
    last.raise_for_status()


def geocode_city(city):
    """Convert a city name to coordinates using Open-Meteo geocoding."""
    resp = get_with_retry(
        GEOCODE_URL,
        params={"name": city, "count": 1, "language": "en", "format": "json"},
    )
    results = resp.json().get("results")
    if not results:
        return None
    place = results[0]
    return {
        "name": place.get("name"),
        "region": place.get("admin1", ""),
        "country": place.get("country", ""),
        "latitude": place["latitude"],
        "longitude": place["longitude"],
    }


def fetch_weather(lat, lon):
    """Fetch current weather and a 5-day forecast for coordinates."""
    resp = get_with_retry(
        FORECAST_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "current": (
                "temperature_2m,relative_humidity_2m,apparent_temperature,"
                "is_day,weather_code,wind_speed_10m,surface_pressure"
            ),
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset",
            "timezone": "auto",
            "forecast_days": 5,
        },
    )
    return resp.json()


# ---------- Backup source (wttr.in) ----------
def wwo_icon(code, is_day=True):
    """Map wttr.in weather codes to an emoji icon."""
    code = int(code)
    if code == 113:
        return "☀️" if is_day else "🌙"
    if code == 116:
        return "⛅" if is_day else "☁️"
    if code in (119, 122):
        return "☁️"
    if code in (143, 248, 260):
        return "🌫️"
    if code in (200, 386, 389, 392, 395):
        return "⛈️"
    if code in (179, 227, 230, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377):
        return "❄️"
    return "🌧️"


def fetch_fallback(place):
    """Get weather from wttr.in and return it in the same shape as build_payload()."""
    url = FALLBACK_URL.format(lat=place["latitude"], lon=place["longitude"])
    data = get_with_retry(url, params={"format": "j1"}).json()
    cur = data["current_condition"][0]
    days = data["weather"]

    def clock(t):
        return datetime.strptime(t.strip(), "%I:%M %p").strftime("%I:%M %p").lstrip("0")

    astro = days[0]["astronomy"][0]
    is_day = True
    try:
        now = datetime.strptime(cur["localObsDateTime"], "%Y-%m-%d %I:%M %p")
        rise = datetime.strptime(astro["sunrise"].strip(), "%I:%M %p").time()
        sset = datetime.strptime(astro["sunset"].strip(), "%I:%M %p").time()
        is_day = rise <= now.time() <= sset
    except (KeyError, ValueError):
        pass

    forecast = []
    for i, day in enumerate(days):
        mid = day["hourly"][min(4, len(day["hourly"]) - 1)]
        forecast.append({
            "day": "Today" if i == 0 else datetime.strptime(day["date"], "%Y-%m-%d").strftime("%a"),
            "date": day["date"],
            "icon": wwo_icon(mid["weatherCode"], True),
            "description": mid["weatherDesc"][0]["value"],
            "max": round(float(day["maxtempC"])),
            "min": round(float(day["mintempC"])),
        })

    return {
        "city": place["name"],
        "location": format_location(place),
        "temperature": round(float(cur["temp_C"])),
        "feels_like": round(float(cur["FeelsLikeC"])),
        "humidity": int(cur["humidity"]),
        "wind": round(float(cur["windspeedKmph"])),
        "pressure": round(float(cur["pressure"])),
        "description": cur["weatherDesc"][0]["value"],
        "icon": wwo_icon(cur["weatherCode"], is_day),
        "is_day": is_day,
        "sunrise": clock(astro["sunrise"]),
        "sunset": clock(astro["sunset"]),
        "forecast": forecast,
        "updated": datetime.now().strftime("%d %b %Y, %I:%M %p"),
    }


def format_location(place):
    extra = ", ".join(p for p in (place.get("region"), place.get("country")) if p)
    return f'{place["name"]}, {extra}' if extra else place["name"]


def get_weather(place):
    """Return weather for a place: cache -> Open-Meteo -> wttr.in -> stale cache."""
    key = (place["name"], round(place["latitude"], 2), round(place["longitude"], 2))
    cached = CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]

    payload = None
    try:
        payload = build_payload(place, fetch_weather(place["latitude"], place["longitude"]))
    except requests.exceptions.RequestException:
        try:
            payload = fetch_fallback(place)
        except (requests.exceptions.RequestException, KeyError, ValueError, IndexError):
            if cached:  # both sources failed: show the last known data
                return cached[1]
            raise

    CACHE[key] = (time.time(), payload)
    return payload


def build_payload(place, data):
    """Shape the raw API data into a clean JSON response for the frontend."""
    cur = data["current"]
    is_day = bool(cur.get("is_day", 1))
    text, icon = describe(cur["weather_code"], is_day)

    daily = data["daily"]
    forecast = []
    for i, day in enumerate(daily["time"]):
        d_text, d_icon = describe(daily["weather_code"][i], True)
        forecast.append(
            {
                "day": "Today" if i == 0 else datetime.strptime(day, "%Y-%m-%d").strftime("%a"),
                "date": day,
                "icon": d_icon,
                "description": d_text,
                "max": round(daily["temperature_2m_max"][i]),
                "min": round(daily["temperature_2m_min"][i]),
            }
        )

    def clock(iso):
        return datetime.fromisoformat(iso).strftime("%I:%M %p").lstrip("0")

    return {
        "city": place["name"],
        "location": format_location(place),
        "temperature": round(cur["temperature_2m"]),
        "feels_like": round(cur["apparent_temperature"]),
        "humidity": cur["relative_humidity_2m"],
        "wind": round(cur["wind_speed_10m"]),
        "pressure": round(cur.get("surface_pressure", 0)),
        "description": text,
        "icon": icon,
        "is_day": is_day,
        "sunrise": clock(daily["sunrise"][0]),
        "sunset": clock(daily["sunset"][0]),
        "forecast": forecast,
        "updated": datetime.now().strftime("%d %b %Y, %I:%M %p"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/weather")
def weather():
    city = request.args.get("city", "").strip()
    lat = request.args.get("lat")
    lon = request.args.get("lon")

    try:
        if lat and lon:
            # Weather by coordinates ("Use my location" button)
            place = {"name": "Your Location", "region": "", "country": "",
                     "latitude": float(lat), "longitude": float(lon)}
        elif city:
            place = geocode_city(city)
            if place is None:
                return jsonify({"error": f'City "{city}" not found. Check the spelling.'}), 404
        else:
            return jsonify({"error": "Please enter a city name."}), 400

        return jsonify(get_weather(place))

    except ValueError:
        return jsonify({"error": "Invalid coordinates."}), 400
    except requests.exceptions.Timeout:
        return jsonify({"error": "The weather service took too long. Try again."}), 504
    except requests.exceptions.RequestException:
        return jsonify({"error": "Could not reach the weather service. Check your internet."}), 502


if __name__ == "__main__":
    app.run(debug=True)
