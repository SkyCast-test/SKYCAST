"""
SkyCast - Weather Information Fetcher in Python
SDMS, MITS Gwalior

A Flask web app that shows live weather, an hourly forecast and a 7-day forecast
for any place in the world. No API keys needed.

Data sources
  Weather  : MET Norway Locationforecast (api.met.no)      - CC BY 4.0
  Places   : Photon / OpenStreetMap (photon.komoot.io)     - (c) OpenStreetMap contributors
  Backup   : OpenStreetMap Nominatim

Run:  python app.py   ->  open http://127.0.0.1:5000
"""

import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, jsonify, render_template, request

try:
    from zoneinfo import ZoneInfo
except ImportError:  # very old Python
    ZoneInfo = None

app = Flask(__name__)

MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
PHOTON_URL = "https://photon.komoot.io/api/"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

TIMEOUT = 6  # seconds
HEADERS = {"User-Agent": "SkyCast-College-Project/2.0 (+https://github.com/SkyCast-test/SKYCAST)"}

# One shared session = connections are reused, so requests are faster
SESSION = requests.Session()
SESSION.headers.update(HEADERS)
EXECUTOR = ThreadPoolExecutor(max_workers=4)

# ---------- Caches ----------
SERIES_CACHE = {}          # forecast data by coordinates
SERIES_TTL = 600           # fresh for 10 minutes
SERIES_STALE_MAX = 3 * 3600  # if the service is down, reuse data up to 3 hours old
GEO_CACHE = {}             # city name -> place
GEO_TTL = 86400
SUGGEST_CACHE = {}         # search text -> suggestions
SUGGEST_TTL = 3600
REVERSE_CACHE = {}
COOLDOWN = {}              # service -> time until which we skip it (after HTTP 429)
COOLDOWN_SECONDS = 120


def cache_put(cache, key, value, limit=500):
    """Store in a cache, dropping the oldest entries when it grows too big."""
    if len(cache) >= limit:
        for old in list(cache)[: limit // 5]:
            cache.pop(old, None)
    cache[key] = value


# ---------- HTTP helper ----------
def http_get(url, params=None, service=None, retries=1):
    """
    GET a URL.
    - HTTP 429 (rate limited): fail fast and skip that service for a short while.
    - HTTP 5xx: retry once.
    """
    if service and COOLDOWN.get(service, 0) > time.time():
        raise requests.exceptions.RequestException(f"{service} is cooling down")

    last = None
    for _ in range(retries + 1):
        resp = SESSION.get(url, params=params, timeout=TIMEOUT)
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


# ---------- Time zones ----------
# Countries with one time zone. (Bigger countries are handled by longitude below.)
COUNTRY_TZ = {
    "IN": "Asia/Kolkata", "PK": "Asia/Karachi", "BD": "Asia/Dhaka", "NP": "Asia/Kathmandu",
    "LK": "Asia/Colombo", "BT": "Asia/Thimphu", "MV": "Indian/Maldives", "AF": "Asia/Kabul",
    "CN": "Asia/Shanghai", "HK": "Asia/Hong_Kong", "TW": "Asia/Taipei", "JP": "Asia/Tokyo",
    "KR": "Asia/Seoul", "SG": "Asia/Singapore", "MY": "Asia/Kuala_Lumpur", "TH": "Asia/Bangkok",
    "VN": "Asia/Ho_Chi_Minh", "PH": "Asia/Manila", "KH": "Asia/Phnom_Penh", "MM": "Asia/Yangon",
    "AE": "Asia/Dubai", "SA": "Asia/Riyadh", "QA": "Asia/Qatar", "KW": "Asia/Kuwait",
    "OM": "Asia/Muscat", "IR": "Asia/Tehran", "IQ": "Asia/Baghdad", "IL": "Asia/Jerusalem",
    "TR": "Europe/Istanbul", "UZ": "Asia/Tashkent", "EG": "Africa/Cairo", "ZA": "Africa/Johannesburg",
    "NG": "Africa/Lagos", "KE": "Africa/Nairobi", "ET": "Africa/Addis_Ababa", "GH": "Africa/Accra",
    "MA": "Africa/Casablanca", "DZ": "Africa/Algiers", "GB": "Europe/London", "IE": "Europe/Dublin",
    "FR": "Europe/Paris", "DE": "Europe/Berlin", "IT": "Europe/Rome", "ES": "Europe/Madrid",
    "PT": "Europe/Lisbon", "NL": "Europe/Amsterdam", "BE": "Europe/Brussels", "CH": "Europe/Zurich",
    "AT": "Europe/Vienna", "SE": "Europe/Stockholm", "NO": "Europe/Oslo", "DK": "Europe/Copenhagen",
    "FI": "Europe/Helsinki", "PL": "Europe/Warsaw", "CZ": "Europe/Prague", "GR": "Europe/Athens",
    "UA": "Europe/Kyiv", "NZ": "Pacific/Auckland", "AR": "America/Argentina/Buenos_Aires",
    "CL": "America/Santiago", "CO": "America/Bogota", "PE": "America/Lima", "MX": "America/Mexico_City",
    "BR": "America/Sao_Paulo",
}
# Used only if the time zone database is missing (e.g. Windows without 'tzdata')
FIXED_OFFSETS = {"IN": 5.5, "LK": 5.5, "NP": 5.75, "AF": 4.5, "IR": 3.5, "MM": 6.5, "PK": 5, "BD": 6}


def zone_by_country(cc, lat, lon):
    """Pick a time zone name for large countries using coordinates."""
    if cc in ("US", "CA"):
        if lon < -140:
            return "America/Anchorage" if lat > 50 else "Pacific/Honolulu"
        if cc == "CA" and lon > -66:
            return "America/Halifax"
        for limit, zone in ((-87, "America/New_York"), (-102, "America/Chicago"),
                            (-115, "America/Denver")):
            if lon >= limit:
                return zone
        return "America/Los_Angeles"
    if cc == "AU":
        if lon < 129:
            return "Australia/Perth"
        if lon < 141:
            return "Australia/Adelaide"
        return "Australia/Brisbane" if lat > -29 else "Australia/Sydney"
    if cc == "ID":
        return "Asia/Jakarta" if lon < 114 else ("Asia/Makassar" if lon < 129 else "Asia/Jayapura")
    return COUNTRY_TZ.get(cc)


def valid_tz(name):
    if not name or not ZoneInfo:
        return None
    try:
        return ZoneInfo(name)
    except Exception:
        return None


def resolve_tz(name, cc, lat, lon):
    """Best available time zone for a place."""
    tz = valid_tz(name)
    if tz:
        return tz
    cc = (cc or "").upper()
    tz = valid_tz(zone_by_country(cc, lat, lon))
    if tz:
        return tz
    if cc in FIXED_OFFSETS:
        return timezone(timedelta(hours=FIXED_OFFSETS[cc]))
    return timezone(timedelta(hours=round(lon / 15)))


# ---------- Places (search, suggestions, reverse) ----------
def place_from_photon(feature):
    p = feature.get("properties", {})
    lon, lat = feature["geometry"]["coordinates"][:2]
    name = p.get("name") or p.get("city") or p.get("county") or p.get("state")
    if not name:
        return None
    return {
        "name": name,
        "region": p.get("state") or p.get("county") or "",
        "country": p.get("country", ""),
        "cc": (p.get("countrycode") or "").upper(),
        "lat": round(lat, 4),
        "lon": round(lon, 4),
    }


def suggest_places(query, limit=5):
    """Place suggestions for a search text (cities, towns, villages, districts)."""
    key = query.lower()
    hit = SUGGEST_CACHE.get(key)
    if hit and time.time() - hit[0] < SUGGEST_TTL:
        return hit[1][:limit]

    data = http_get(PHOTON_URL, params={"q": query, "limit": 10, "lang": "en"}, service="photon").json()
    places, seen = [], set()
    for feature in data.get("features", []):
        if feature.get("properties", {}).get("osm_key") not in ("place", "boundary"):
            continue
        place = place_from_photon(feature)
        if not place:
            continue
        ident = (place["name"].lower(), place["region"].lower(), place["country"].lower())
        if ident in seen:
            continue
        seen.add(ident)
        places.append(place)
    cache_put(SUGGEST_CACHE, key, (time.time(), places))
    return places[:limit]


def nominatim_place(city):
    results = http_get(
        NOMINATIM_URL,
        params={"q": city, "format": "json", "limit": 1, "addressdetails": 1},
        service="nominatim",
    ).json()
    if not results:
        return None
    r = results[0]
    addr = r.get("address", {})
    return {
        "name": r.get("name") or city.title(),
        "region": addr.get("state", ""),
        "country": addr.get("country", ""),
        "cc": (addr.get("country_code") or "").upper(),
        "lat": round(float(r["lat"]), 4),
        "lon": round(float(r["lon"]), 4),
    }


def geocode_city(city):
    """Find a place by name. Cached for 24 hours."""
    key = city.lower()
    hit = GEO_CACHE.get(key)
    if hit and time.time() - hit[0] < GEO_TTL:
        return hit[1]

    place = None
    try:
        found = suggest_places(city, limit=1)
        place = found[0] if found else None
    except (requests.exceptions.RequestException, KeyError, ValueError, IndexError):
        pass
    if place is None:
        try:
            place = nominatim_place(city)
        except (requests.exceptions.RequestException, KeyError, ValueError, IndexError):
            pass
    if place:
        cache_put(GEO_CACHE, key, (time.time(), place))
    return place


def reverse_place(lat, lon):
    """Name of the place at coordinates (used for the 'my location' button)."""
    key = (round(lat, 2), round(lon, 2))
    hit = REVERSE_CACHE.get(key)
    if hit:
        return hit
    try:
        data = http_get(PHOTON_REVERSE_URL, params={"lat": lat, "lon": lon, "lang": "en"},
                        service="photon").json()
        p = data["features"][0]["properties"]
        name = (p.get("city") or p.get("district") or p.get("locality") or p.get("name")
                or p.get("county") or "Your Location")
        result = {"name": name, "region": p.get("state", ""), "country": p.get("country", ""),
                  "cc": (p.get("countrycode") or "").upper()}
    except (requests.exceptions.RequestException, KeyError, ValueError, IndexError):
        return None
    cache_put(REVERSE_CACHE, key, result)
    return result


# ---------- Weather data (MET Norway) ----------
def get_series(lat, lon):
    """Raw forecast time series. Fresh cache -> MET Norway -> stale cache."""
    key = (round(lat, 2), round(lon, 2))
    hit = SERIES_CACHE.get(key)
    if hit and time.time() - hit[0] < SERIES_TTL:
        return hit[1]
    try:
        data = http_get(MET_URL, params={"lat": round(lat, 4), "lon": round(lon, 4)}, service="met").json()
        series = data["properties"]["timeseries"]
    except (requests.exceptions.RequestException, KeyError, ValueError):
        if hit and time.time() - hit[0] < SERIES_STALE_MAX:
            return hit[1]  # service is down: show the last known data
        raise
    cache_put(SERIES_CACHE, key, (time.time(), series), limit=300)
    return series


def parse_series(series, tz):
    rows = []
    for entry in series:
        t = datetime.fromisoformat(entry["time"].replace("Z", "+00:00")).astimezone(tz)
        d = entry["data"]
        det = d["instant"]["details"]
        n1, n6, n12 = d.get("next_1_hours"), d.get("next_6_hours"), d.get("next_12_hours")

        def sym(block):
            return block["summary"]["symbol_code"] if block else None

        def rain(block):
            return (block.get("details", {}).get("precipitation_amount") or 0.0) if block else 0.0

        rows.append({
            "t": t,
            "temp": det.get("air_temperature", 0.0),
            "rh": det.get("relative_humidity", 50.0),
            "wind": det.get("wind_speed", 0.0),  # m/s
            "dir": det.get("wind_from_direction"),
            "pressure": det.get("air_pressure_at_sea_level"),
            "cloud": det.get("cloud_area_fraction"),
            "sym1": sym(n1), "p1": rain(n1),
            "sym6": sym(n6), "p6": rain(n6),
            "sym12": sym(n12),
        })
    return rows


def sym_info(code):
    """MET symbol code -> (icon key, description, is_day)."""
    code = code or "cloudy"
    is_day = not code.endswith("_night")
    base = code.split("_")[0]
    if "thunder" in base:
        return "storm", "Thunderstorm", is_day
    if "snow" in base:
        text = "Heavy Snow" if "heavy" in base else "Light Snow" if "light" in base else "Snow"
        return "snow", text, is_day
    if "sleet" in base:
        return "snow", "Sleet", is_day
    if "rain" in base or "showers" in base:
        if "heavy" in base:
            text = "Heavy Rain"
        elif "light" in base:
            text = "Light Rain"
        elif "showers" in base:
            text = "Rain Showers"
        else:
            text = "Rain"
        return "rain", text, is_day
    if base == "fog":
        return "fog", "Fog", is_day
    if base == "clearsky":
        return ("clear-day" if is_day else "clear-night"), "Clear Sky", is_day
    if base == "fair":
        return ("partly-day" if is_day else "partly-night"), "Mainly Clear", is_day
    if base == "partlycloudy":
        return ("partly-day" if is_day else "partly-night"), "Partly Cloudy", is_day
    return "cloudy", "Cloudy", is_day


COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(deg):
    return COMPASS[int((deg % 360 + 11.25) // 22.5) % 16] if deg is not None else "-"


def apparent_temp(t, rh, wind_ms):
    """'Feels like' temperature (Australian Bureau of Meteorology formula)."""
    e = rh / 100 * 6.105 * math.exp(17.27 * t / (237.7 + t))
    return t + 0.33 * e - 0.70 * wind_ms - 4.00


def dew_point(t, rh):
    g = math.log(max(rh, 1) / 100) + 17.62 * t / (243.12 + t)
    return 243.12 * g / (17.62 - g)


def sun_minutes(lat, lon, day, utc_offset):
    """Sunrise and sunset as local minutes after midnight (NOAA solar equations)."""
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
    if not -1 <= cos_ha <= 1:  # polar day or polar night
        return None
    ha = math.degrees(math.acos(cos_ha))
    offset_min = utc_offset.total_seconds() / 60
    rise = (720 - 4 * (lon + ha) - eqtime + offset_min) % 1440
    sset = (720 - 4 * (lon - ha) - eqtime + offset_min) % 1440
    return rise, sset


def clock_text(minutes):
    m = int(round(minutes)) % 1440
    return datetime(2000, 1, 1, m // 60, m % 60).strftime("%I:%M %p").lstrip("0")


def hour_label(t):
    return t.strftime("%I %p").lstrip("0")


def make_tip(feels, wind_kmh, rain_soon, icon):
    tips = []
    if icon == "storm":
        tips.append("Thunderstorms around - stay indoors if you can.")
    elif rain_soon:
        tips.append("Carry an umbrella, rain is on the way.")
    if feels >= 40:
        tips.append("Extreme heat - avoid midday sun and drink plenty of water.")
    elif feels >= 33:
        tips.append("Hot weather - stay hydrated and wear light clothes.")
    elif feels <= 5:
        tips.append("Very cold - wear warm layers.")
    elif feels <= 15:
        tips.append("A bit chilly - a jacket is a good idea.")
    elif 20 <= feels <= 29 and not tips:
        tips.append("Pleasant weather - a great time to be outside.")
    if wind_kmh >= 40:
        tips.append("Strong winds - hold on to your hat!")
    return " ".join(tips[:2]) or "Have a great day!"


def make_payload(place, series):
    """Turn raw forecast data into the JSON the web page uses."""
    lat, lon = place["lat"], place["lon"]
    tz = resolve_tz(place.get("tz"), place.get("cc"), lat, lon)
    now = datetime.now(tz)

    rows = parse_series(series, tz)
    if not rows:
        raise ValueError("empty forecast")
    start = 0
    for i, r in enumerate(rows):
        if r["t"] <= now:
            start = i
        else:
            break
    rows = rows[start:]
    cur = rows[0]

    icon, text, _ = sym_info(cur["sym1"] or cur["sym6"] or cur["sym12"])
    temp = cur["temp"]
    feels = apparent_temp(temp, cur["rh"], cur["wind"])
    wind_kmh = cur["wind"] * 3.6

    # ---- Hourly (next 24 hours)
    hourly_rows = [r for r in rows if r["sym1"]][:24] or rows[:24]
    hourly = []
    for i, r in enumerate(hourly_rows):
        h_icon, h_text, _ = sym_info(r["sym1"] or r["sym6"])
        hourly.append({
            "label": "Now" if i == 0 else hour_label(r["t"]),
            "temp": round(r["temp"]),
            "icon": h_icon,
            "text": h_text,
            "rain": round(r["p1"], 1),
            "wind": round(r["wind"] * 3.6),
        })
    rain24 = round(sum(r["p1"] for r in hourly_rows), 1)
    rain_soon = next((i for i, r in enumerate(hourly_rows[:12]) if r["p1"] >= 0.2), None)
    if rain_soon == 0:
        outlook = "Rain right now"
    elif rain_soon is not None:
        outlook = f"Rain expected around {hourly[rain_soon]['label']}"
    elif rain24 >= 0.2:
        outlook = "Some rain later today"
    else:
        outlook = "No rain expected in the next 24 hours"

    # ---- Daily (up to 7 days)
    by_day = {}
    for r in rows:
        by_day.setdefault(r["t"].date(), []).append(r)
    daily = []
    for i, day in enumerate(sorted(by_day)[:7]):
        items = by_day[day]
        temps = [r["temp"] for r in items]
        code = None
        for r in sorted(items, key=lambda r: abs(r["t"].hour + r["t"].minute / 60 - 13)):
            code = r["sym6"] or r["sym1"] or r["sym12"]
            if code:
                break
        d_icon, d_text, _ = sym_info((code or "cloudy").replace("_night", "_day"))
        daily.append({
            "day": "Today" if i == 0 else day.strftime("%a"),
            "date": day.strftime("%d %b").lstrip("0"),
            "icon": d_icon,
            "text": d_text,
            "max": round(max(temps)),
            "min": round(min(temps)),
            "rain": round(sum(r["p1"] if r["sym1"] else r["p6"] for r in items), 1),
            "wind": round(max(r["wind"] for r in items) * 3.6),
        })

    # ---- Sun and day phase
    sun = {"sunrise": "--", "sunset": "--", "daylight": "--", "progress": None}
    sun_times = sun_minutes(lat, lon, now.date(), now.utcoffset())
    now_min = now.hour * 60 + now.minute
    if sun_times:
        rise, sset = sun_times
        sun["sunrise"], sun["sunset"] = clock_text(rise), clock_text(sset)
        if sset > rise:
            span = int(round(sset - rise))
            sun["daylight"] = f"{span // 60}h {span % 60:02d}m"
            if rise <= now_min <= sset:
                sun["progress"] = round((now_min - rise) / (sset - rise), 3)
            if now_min < rise - 40 or now_min >= sset + 40:
                phase = "night"
            elif now_min < rise + 50:
                phase = "dawn"
            elif now_min < sset - 60:
                phase = "day"
            else:
                phase = "dusk"
        else:  # sun times look inconsistent: trust the forecast's own day/night flag
            phase = "day" if sym_info(cur["sym1"] or cur["sym6"])[2] else "night"
    else:  # polar day / night
        phase = "day" if sym_info(cur["sym1"] or cur["sym6"])[2] else "night"

    theme = {"clear-day": "clear", "clear-night": "clear", "partly-day": "partly",
             "partly-night": "partly"}.get(icon, icon)

    return {
        "place": {"name": place["name"], "region": place.get("region", ""),
                  "country": place.get("country", ""), "cc": place.get("cc", ""),
                  "lat": lat, "lon": lon},
        "local": {"offset_min": int(now.utcoffset().total_seconds() // 60), "tz": str(tz)},
        "now": {
            "temp": round(temp), "feels": round(feels), "humidity": round(cur["rh"]),
            "wind": round(wind_kmh), "wind_dir": compass(cur["dir"]), "wind_deg": cur["dir"] or 0,
            "pressure": round(cur["pressure"] or 0), "cloud": round(cur["cloud"] or 0),
            "dew": round(dew_point(temp, cur["rh"])),
            "icon": icon, "text": text,
            "high": daily[0]["max"], "low": daily[0]["min"],
        },
        "rain24": rain24,
        "outlook": outlook,
        "tip": make_tip(feels, wind_kmh, rain_soon is not None, icon),
        "sun": sun,
        "phase": phase,
        "theme": theme,
        "hourly": hourly,
        "daily": daily,
        "source": "MET Norway",
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def build_weather(place):
    """Fetch (in parallel when needed) and build the response for a place."""
    reverse = None
    if not place.get("name"):
        reverse = EXECUTOR.submit(reverse_place, place["lat"], place["lon"])
    series = get_series(place["lat"], place["lon"])
    if reverse is not None:
        try:
            found = reverse.result(timeout=5)
        except Exception:
            found = None
        place.update(found or {"name": "Your Location"})
    return make_payload(place, series)


# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return "ok"


@app.route("/api/suggest")
def suggest():
    q = request.args.get("q", "").strip()[:80]
    if len(q) < 2:
        return jsonify({"results": []})
    try:
        return jsonify({"results": suggest_places(q)})
    except (requests.exceptions.RequestException, KeyError, ValueError):
        return jsonify({"results": []})


@app.route("/api/weather")
def weather():
    args = request.args
    city = args.get("city", "").strip()[:80]
    try:
        if args.get("lat") and args.get("lon"):
            lat, lon = float(args["lat"]), float(args["lon"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError("bad coordinates")
            place = {
                "name": args.get("name", "").strip()[:80],
                "region": args.get("region", "").strip()[:80],
                "country": args.get("country", "").strip()[:80],
                "cc": args.get("cc", "").strip()[:2].upper(),
                "lat": lat, "lon": lon,
                "tz": args.get("tz") if valid_tz(args.get("tz")) else None,
            }
        elif city:
            place = geocode_city(city)
            if place is None:
                return jsonify({"error": f'Could not find "{city}". Check the spelling.'}), 404
            place = dict(place)
        else:
            return jsonify({"error": "Please enter a city name."}), 400

        return jsonify(build_weather(place))

    except ValueError:
        return jsonify({"error": "Invalid location."}), 400
    except requests.exceptions.Timeout:
        return jsonify({"error": "The weather service is slow right now. Please try again."}), 504
    except (requests.exceptions.RequestException, KeyError, TypeError):
        return jsonify({"error": "Could not get the weather right now. Please try again in a moment."}), 502


if __name__ == "__main__":
    app.run(debug=True)
