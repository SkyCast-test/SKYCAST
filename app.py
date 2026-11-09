"""
SkyCast - Weather Information Fetcher in Python
SDMS, MITS Gwalior

A small Flask web app that fetches real-time weather for any city using the
free Open-Meteo APIs (no API key required).

Run:  python app.py   ->  open http://127.0.0.1:5000
"""

import math
from datetime import datetime

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 10  # seconds
MAX_CITY_LENGTH = 100

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


def geocode_city(city):
    """Convert a city name to coordinates using Open-Meteo geocoding."""
    resp = requests.get(
        GEOCODE_URL,
        params={"name": city, "count": 1, "language": "en", "format": "json"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("Invalid geocoding response.")
    results = data.get("results")
    if not results:
        return None
    place = results[0]
    if not isinstance(place, dict):
        raise ValueError("Invalid geocoding response.")
    latitude = float(place["latitude"])
    longitude = float(place["longitude"])
    if not math.isfinite(latitude) or not -90 <= latitude <= 90:
        raise ValueError("Invalid geocoding response.")
    if not math.isfinite(longitude) or not -180 <= longitude <= 180:
        raise ValueError("Invalid geocoding response.")
    name = place.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("Invalid geocoding response.")
    return {
        "name": name,
        "region": place.get("admin1", ""),
        "country": place.get("country", ""),
        "latitude": latitude,
        "longitude": longitude,
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
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("Invalid forecast response.")
    return data


def build_payload(place, data):
    """Shape the raw API data into a clean JSON response for the frontend."""
    cur = data["current"]
    daily = data["daily"]
    if not isinstance(cur, dict) or not isinstance(daily, dict):
        raise ValueError("Invalid forecast response.")

    required_current = (
        "time",
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "wind_speed_10m",
        "weather_code",
    )
    if any(key not in cur for key in required_current):
        raise ValueError("Invalid forecast response.")
    required_daily = (
        "time",
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "sunrise",
        "sunset",
    )
    if any(key not in daily for key in required_daily):
        raise ValueError("Invalid forecast response.")

    daily_fields = [daily[key] for key in required_daily]
    if (
        any(not isinstance(values, list) for values in daily_fields)
        or not daily["time"]
        or any(len(values) != len(daily["time"]) for values in daily_fields)
    ):
        raise ValueError("Invalid forecast response.")
    if not isinstance(place.get("name"), str) or not place["name"]:
        raise ValueError("Invalid location data.")

    is_day = bool(cur.get("is_day", 1))
    text, icon = describe(cur["weather_code"], is_day)

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

    location = place["name"]
    extra = ", ".join(p for p in (place.get("region"), place.get("country")) if p)
    return {
        "city": location,
        "location": f"{location}, {extra}" if extra else location,
        "temperature": round(cur["temperature_2m"]),
        "feels_like": round(cur["apparent_temperature"]),
        "weather_code": cur["weather_code"],
        "humidity": cur["relative_humidity_2m"],
        "wind": round(cur["wind_speed_10m"]),
        "pressure": round(cur.get("surface_pressure", 0)),
        "description": text,
        "icon": icon,
        "is_day": is_day,
        "sunrise": clock(daily["sunrise"][0]),
        "sunset": clock(daily["sunset"][0]),
        "forecast": forecast,
        "updated": datetime.fromisoformat(cur["time"]).strftime("%d %b %Y, %I:%M %p"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/weather")
def weather():
    city = request.args.get("city", "").strip()
    lat = request.args.get("lat")
    lon = request.args.get("lon")

    has_lat = lat is not None
    has_lon = lon is not None
    if has_lat != has_lon or (city and (has_lat or has_lon)):
        return jsonify({"error": "Provide either a city or both coordinates."}), 400

    if has_lat:
        try:
            latitude = float(lat)
            longitude = float(lon)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid coordinates."}), 400
        if (
            not math.isfinite(latitude)
            or not math.isfinite(longitude)
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            return jsonify({"error": "Invalid coordinates."}), 400
    elif not city:
        return jsonify({"error": "Please enter a city name."}), 400
    elif len(city) > MAX_CITY_LENGTH:
        return jsonify({"error": "City name is too long."}), 400

    try:
        if has_lat:
            # Weather by coordinates ("Use my location" button)
            place = {
                "name": "Your Location",
                "region": "",
                "country": "",
                "latitude": latitude,
                "longitude": longitude,
            }
        else:
            place = geocode_city(city)
            if place is None:
                return jsonify({"error": f'City "{city}" not found. Check the spelling.'}), 404

        data = fetch_weather(place["latitude"], place["longitude"])
        return jsonify(build_payload(place, data))

    except requests.exceptions.Timeout:
        app.logger.warning("Weather provider request timed out.")
        return jsonify({"error": "The weather service took too long. Try again."}), 504
    except requests.exceptions.RequestException:
        app.logger.exception("Weather provider request failed.")
        return jsonify({"error": "Could not reach the weather service. Check your internet."}), 502
    except (KeyError, IndexError, TypeError, ValueError):
        app.logger.exception("Weather provider returned invalid data.")
        return jsonify({"error": "The weather service returned an invalid response. Try again later."}), 502


if __name__ == "__main__":
    app.run(debug=False)
