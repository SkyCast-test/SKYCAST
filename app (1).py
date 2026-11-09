"""
SkyCast - Weather Information Fetcher in Python
SDMS, MITS Gwalior

A small Flask web app that fetches real-time weather for any city.
Data sources (all free, no API key):
  1. Open-Meteo        - main source
  2. MET Norway        - backup #1 (5-day forecast)
  3. wttr.in           - backup #2 (3-day forecast)
City search uses Open-Meteo Geocoding, with OpenStreetMap Nominatim as backup.

Run:  python app.py   ->  open http://127.0.0.1:5000
"""

import math
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, jsonify, render_template, request

try:
    from zoneinfo import ZoneInfo
except ImportError:  # very old Python
    ZoneInfo = None

app = Flask(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
FALLBACK_URL = "https://wttr.in/{lat},{lon}"

TIMEOUT = 6  # seconds
HEADERS = {"User-Agent": "SkyCast-College-Project/1.0 (+https://github.com/SkyCast-test/SKYCAST)"}

# ---------- Caches (speed + avoids rate limits) ----------
CACHE = {}        # weather by place   -> 10 minutes
CACHE_TTL = 600
GEO_CACHE = {}    # city name -> place -> 24 hours
GEO_TTL = 86400
COOLDOWN = {}     # service name -> time until we skip it after a 429
COOLDOWN_SECONDS = 300

# WMO weather interpretation codes -> (description, day icon, night icon)
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


# ---------- HTTP helper ----------
def http_get(url, params=None, service=None, retries=1):
    """
    GET a URL.
    - On HTTP 429 (rate limited) fail fast and skip that service for 5 minutes,
      so the user isn't kept waiting.
    - On server errors (5xx) retry once.
    """
    if service and COOLDOWN.get(service, 0) > time.time():
        raise requests.exceptions.RequestException(f"{service} is cooling down")

    last = None
    for _ in range(retries + 1):
        resp = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code == 429:
            if service:
                COOLDOWN[service] = time.time() + COOLDOWN_SECONDS
            resp.raise_for_status()
        if resp.status_code >= 500:
            last = resp
            continue
        resp.raise_for_status()
        return resp
    last.raise_for_status()


# ---------- Geocoding (city name -> coordinates) ----------
def geocode_openmeteo(city):
    resp = http_get(
        GEOCODE_URL,
        params={"name": city, "count": 1, "language": "en", "format": "json"},
        service="open-meteo-geo",
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
        "timezone": place.get("timezone"),
    }


def geocode_nominatim(city):
    resp = http_get(
        NOMINATIM_URL,
        params={"q": city, "format": "json", "limit": 1, "addressdetails": 1},
        service="nominatim",
    )
    results = resp.json()
    if not results:
        return None
    r = results[0]
    addr = r.get("address", {})
    return {
        "name": r.get("name") or city.title(),
        "region": addr.get("state", ""),
        "country": addr.get("country", ""),
        "latitude": float(r["lat"]),
        "longitude": float(r["lon"]),
        "timezone": None,
    }


def geocode_city(city):
    """Find a city. Results are cached for 24 hours."""
    key = city.lower()
    hit = GEO_CACHE.get(key)
    if hit and time.time() - hit[0] < GEO_TTL:
        return hit[1]
    try:
        place = geocode_openmeteo(city)
    except (requests.exceptions.RequestException, KeyError, ValueError):
        place = geocode_nominatim(city)
    if place:
        GEO_CACHE[key] = (time.time(), place)
    return place


def format_location(place):
    extra = ", ".join(p for p in (place.get("region"), place.get("country")) if p)
    return f'{place["name"]}, {extra}' if extra else place["name"]


# ---------- Source 1: Open-Meteo ----------
def fetch_weather(lat, lon):
    """Current weather + 5-day forecast from Open-Meteo."""
    resp = http_get(
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
        service="open-meteo",
    )
    return resp.json()


def build_payload(place, data):
    """Shape Open-Meteo data into the JSON the frontend expects."""
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
        "source": "Open-Meteo",
    }


def from_open_meteo(place):
    return build_payload(place, fetch_weather(place["latitude"], place["longitude"]))


# ---------- Source 2: MET Norway (5-day forecast) ----------
def met_symbol(code):
    """Convert a MET Norway symbol code (e.g. 'partlycloudy_day') to (text, icon, is_day)."""
    is_day = not code.endswith("_night")
    base = code.split("_")[0]
    if "thunder" in base:
        return "Thunderstorm", "⛈️", is_day
    if "snow" in base:
        return "Snow", "❄️", is_day
    if "sleet" in base:
        return "Sleet", "🌨️", is_day
    if "rain" in base or "showers" in base:
        if "heavy" in base:
            text = "Heavy Rain"
        elif "light" in base:
            text = "Light Rain"
        elif "showers" in base:
            text = "Rain Showers"
        else:
            text = "Rain"
        return text, "🌧️", is_day
    if base == "fog":
        return "Fog", "🌫️", is_day
    if base == "clearsky":
        return "Clear Sky", ("☀️" if is_day else "🌙"), is_day
    if base == "fair":
        return "Mainly Clear", ("🌤️" if is_day else "🌙"), is_day
    if base == "partlycloudy":
        return "Partly Cloudy", ("⛅" if is_day else "☁️"), is_day
    return "Cloudy", "☁️", is_day


def tz_for(place):
    """Timezone of a place (exact if known, otherwise estimated from longitude)."""
    name = place.get("timezone")
    if name and ZoneInfo:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    return timezone(timedelta(hours=round(place["longitude"] / 15)))


def apparent_temp(t, rh, wind_ms):
    """'Feels like' temperature (Australian Bureau of Meteorology formula)."""
    e = rh / 100 * 6.105 * math.exp(17.27 * t / (237.7 + t))
    return t + 0.33 * e - 0.70 * wind_ms - 4.00


def sun_times(lat, lon, day, utc_offset):
    """Sunrise and sunset (local time) using the NOAA solar equations."""
    n = day.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                       - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
            - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
            - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    lat_r = math.radians(lat)
    cos_ha = (math.cos(math.radians(90.833)) / (math.cos(lat_r) * math.cos(decl))
              - math.tan(lat_r) * math.tan(decl))
    if not -1 <= cos_ha <= 1:  # polar day / night
        return "--", "--"
    ha = math.degrees(math.acos(cos_ha))
    offset_min = utc_offset.total_seconds() / 60

    def fmt(utc_minutes):
        m = (utc_minutes + offset_min) % 1440
        return datetime(2000, 1, 1, int(m // 60), int(m % 60)).strftime("%I:%M %p").lstrip("0")

    return fmt(720 - 4 * (lon + ha) - eqtime), fmt(720 - 4 * (lon - ha) - eqtime)


def fetch_met(place):
    """Weather + 5-day forecast from MET Norway, in the same shape as build_payload()."""
    lat, lon = round(place["latitude"], 4), round(place["longitude"], 4)
    data = http_get(MET_URL, params={"lat": lat, "lon": lon}, service="met").json()
    series = data["properties"]["timeseries"]
    tz = tz_for(place)
    now_local = datetime.now(tz)

    first = series[0]["data"]
    det = first["instant"]["details"]
    block = first.get("next_1_hours") or first.get("next_6_hours") or first.get("next_12_hours") or {}
    text, icon, is_day = met_symbol(block.get("summary", {}).get("symbol_code", "cloudy"))

    temp = det["air_temperature"]
    humidity = det.get("relative_humidity", 50)
    wind_ms = det.get("wind_speed", 0)

    # Group the time series by local date
    days = {}
    for entry in series:
        t = datetime.fromisoformat(entry["time"].replace("Z", "+00:00")).astimezone(tz)
        days.setdefault(t.date().isoformat(), []).append((t, entry))

    forecast = []
    for i, date in enumerate(sorted(days)[:5]):
        items = days[date]
        temps = [e["data"]["instant"]["details"]["air_temperature"] for _, e in items]
        code = None
        for t, e in sorted(items, key=lambda it: abs(it[0].hour + it[0].minute / 60 - 12)):
            blk = e["data"].get("next_6_hours") or e["data"].get("next_1_hours") or e["data"].get("next_12_hours")
            if blk:
                code = blk["summary"]["symbol_code"]
                break
        d_text, d_icon, _ = met_symbol((code or "cloudy").replace("_night", "_day"))
        forecast.append({
            "day": "Today" if i == 0 else datetime.strptime(date, "%Y-%m-%d").strftime("%a"),
            "date": date,
            "icon": d_icon,
            "description": d_text,
            "max": round(max(temps)),
            "min": round(min(temps)),
        })

    sunrise, sunset = sun_times(lat, lon, now_local.date(), now_local.utcoffset())
    return {
        "city": place["name"],
        "location": format_location(place),
        "temperature": round(temp),
        "feels_like": round(apparent_temp(temp, humidity, wind_ms)),
        "humidity": round(humidity),
        "wind": round(wind_ms * 3.6),  # m/s -> km/h
        "pressure": round(det.get("air_pressure_at_sea_level", 0)),
        "description": text,
        "icon": icon,
        "is_day": is_day,
        "sunrise": sunrise,
        "sunset": sunset,
        "forecast": forecast,
        "updated": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        "source": "MET Norway",
    }


# ---------- Source 3: wttr.in (3-day forecast) ----------
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
    """Weather from wttr.in, in the same shape as build_payload()."""
    url = FALLBACK_URL.format(lat=place["latitude"], lon=place["longitude"])
    data = http_get(url, params={"format": "j1"}, service="wttr").json()
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
        "source": "wttr.in",
    }


# ---------- Put it all together ----------
def get_weather(place):
    """cache -> Open-Meteo -> MET Norway -> wttr.in -> last known (stale) data."""
    key = (place["name"], round(place["latitude"], 2), round(place["longitude"], 2))
    cached = CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]

    payload = None
    for source in (from_open_meteo, fetch_met, fetch_fallback):
        try:
            payload = source(place)
            break
        except (requests.exceptions.RequestException, KeyError, ValueError, IndexError, TypeError):
            continue

    if payload is None:
        if cached:  # every source failed: show the last known data
            return cached[1]
        raise requests.exceptions.ConnectionError("all weather sources failed")

    CACHE[key] = (time.time(), payload)
    return payload


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
                     "latitude": float(lat), "longitude": float(lon), "timezone": None}
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
