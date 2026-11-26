"""
SkyCast - Weather Information Fetcher in Python
SDMS, MITS Gwalior

A small Flask web app that fetches real-time weather for any city using the
free Open-Meteo APIs (no API key required).

Run:  python app.py   ->  open http://127.0.0.1:5000
"""

import math
import os
from datetime import datetime

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 10  # seconds

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


def geocode_city(query):
    """Convert a city name to coordinates using Open-Meteo geocoding.

    The API only matches the place *name*, so "Paris, France" would find
    nothing. We search on the part before the first comma and use the rest
    ("France", "Texas", ...) to pick the best match among the results.
    """
    name, _, hint = (part.strip() for part in query.partition(","))
    hint = hint.lower()
    resp = requests.get(
        GEOCODE_URL,
        params={"name": name or query, "count": 10 if hint else 1,
                "language": "en", "format": "json"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    results = resp.json().get("results")
    if not results:
        return None
    place = results[0]
    if hint:
        for r in results:
            fields = (r.get("admin1", ""), r.get("country", ""), r.get("country_code", ""))
            if any(hint == f.lower() or (len(hint) > 2 and hint in f.lower()) for f in fields):
                place = r
                break
    return {
        "name": place.get("name"),
        "region": place.get("admin1", ""),
        "country": place.get("country", ""),
        "latitude": place["latitude"],
        "longitude": place["longitude"],
    }


def fetch_weather(lat, lon):
    """Fetch current weather and a 5-day forecast for coordinates."""
    resp = requests.get(
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
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


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

    # Open-Meteo reports "current.time" in the place's own timezone.
    try:
        now = datetime.fromisoformat(cur["time"])
    except (KeyError, ValueError):
        now = datetime.now()
    updated = now.strftime("%d %b %Y, %I:%M %p").lstrip("0")

    location = place["name"]
    extra = ", ".join(p for p in (place.get("region"), place.get("country")) if p)
    return {
        "city": location,
        "location": f"{location}, {extra}" if extra else location,
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
        "timezone": data.get("timezone", ""),
        "updated": updated,
    }


@app.route("/")
def index():
    return render_template("index.html")


def parse_coords(lat, lon):
    """Return (lat, lon) floats or raise ValueError if missing/invalid/out of range."""
    la, lo = float(lat), float(lon)
    if not (math.isfinite(la) and math.isfinite(lo)) or not (-90 <= la <= 90 and -180 <= lo <= 180):
        raise ValueError("coordinates out of range")
    return la, lo


@app.route("/api/weather")
def weather():
    city = request.args.get("city", "").strip()
    lat = request.args.get("lat")
    lon = request.args.get("lon")

    # Validate input first, so API/JSON errors below can't be mistaken for it.
    coords = None
    if lat and lon:
        try:
            coords = parse_coords(lat, lon)
        except ValueError:
            return jsonify({"error": "Invalid coordinates."}), 400
    elif not city:
        return jsonify({"error": "Please enter a city name."}), 400
    elif len(city) > 100:
        return jsonify({"error": "City name is too long."}), 400

    try:
        if coords:
            # Weather by coordinates ("Use my location" button)
            place = {"name": "Your Location", "region": "", "country": "",
                     "latitude": coords[0], "longitude": coords[1]}
        else:
            place = geocode_city(city)
            if place is None:
                return jsonify({"error": f'City "{city}" not found. Check the spelling.'}), 404

        data = fetch_weather(place["latitude"], place["longitude"])
        return jsonify(build_payload(place, data))

    except requests.exceptions.Timeout:
        return jsonify({"error": "The weather service took too long. Try again."}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "Could not reach the weather service. Check your internet."}), 502
    except requests.exceptions.HTTPError:
        return jsonify({"error": "The weather service returned an error. Try again shortly."}), 502
    except (requests.exceptions.RequestException, KeyError, TypeError, ValueError, IndexError):
        # Bad/unexpected JSON from the upstream service.
        return jsonify({"error": "The weather service sent an unexpected response."}), 502


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found."}), 404
    return "Not found", 404


@app.errorhandler(500)
def server_error(_):
    return jsonify({"error": "Internal server error."}), 500


if __name__ == "__main__":
    # Debug mode is for development only: set FLASK_DEBUG=0 to turn it off.
    app.run(debug=os.environ.get("FLASK_DEBUG", "1") == "1",
            port=int(os.environ.get("PORT", 5000)))
