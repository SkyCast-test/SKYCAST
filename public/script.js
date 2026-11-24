/* SkyCast - static version: the browser calls the free Open-Meteo APIs directly
   (no API key, CORS enabled), so it can be hosted on Netlify / GitHub Pages. */
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10000;

const form = document.getElementById("search-form");
const cityInput = document.getElementById("city");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const recentEl = document.getElementById("recent");
const locateBtn = document.getElementById("locate");
const $ = (id) => document.getElementById(id);

/* WMO weather code -> [description, day icon, night icon] */
const CODES = {
  0: ["Clear Sky", "☀️", "🌙"], 1: ["Mainly Clear", "🌤️", "🌙"], 2: ["Partly Cloudy", "⛅", "☁️"],
  3: ["Overcast", "☁️", "☁️"], 45: ["Fog", "🌫️", "🌫️"], 48: ["Rime Fog", "🌫️", "🌫️"],
  51: ["Light Drizzle", "🌦️", "🌧️"], 53: ["Drizzle", "🌦️", "🌧️"], 55: ["Heavy Drizzle", "🌧️", "🌧️"],
  56: ["Freezing Drizzle", "🌧️", "🌧️"], 57: ["Freezing Drizzle", "🌧️", "🌧️"],
  61: ["Light Rain", "🌦️", "🌧️"], 63: ["Rain", "🌧️", "🌧️"], 65: ["Heavy Rain", "🌧️", "🌧️"],
  66: ["Freezing Rain", "🌧️", "🌧️"], 67: ["Freezing Rain", "🌧️", "🌧️"],
  71: ["Light Snow", "🌨️", "🌨️"], 73: ["Snow", "❄️", "❄️"], 75: ["Heavy Snow", "❄️", "❄️"],
  77: ["Snow Grains", "❄️", "❄️"], 80: ["Rain Showers", "🌦️", "🌧️"], 81: ["Rain Showers", "🌧️", "🌧️"],
  82: ["Violent Showers", "⛈️", "⛈️"], 85: ["Snow Showers", "🌨️", "🌨️"], 86: ["Snow Showers", "🌨️", "🌨️"],
  95: ["Thunderstorm", "⛈️", "⛈️"], 96: ["Thunderstorm, Hail", "⛈️", "⛈️"], 99: ["Thunderstorm, Hail", "⛈️", "⛈️"],
};

function describe(code, isDay = true) {
  const [text, day, night] = CODES[code] || ["Unknown", "❔", "❔"];
  return [text, isDay ? day : night];
}

class UserError extends Error {}

function setStatus(text, isError = false, loading = false) {
  statusEl.textContent = "";
  if (loading) {
    const spin = document.createElement("span");
    spin.className = "spinner";
    statusEl.appendChild(spin);
  }
  statusEl.appendChild(document.createTextNode(text));
  statusEl.className = "status" + (isError ? " error" : "");
}

/* ---------- API calls ---------- */
async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new UserError("The weather service took too long. Try again.");
    throw new UserError("Could not reach the weather service. Check your internet.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new UserError("The weather service returned an error. Try again shortly.");
  try { return await res.json(); }
  catch { throw new UserError("The weather service sent an unexpected response."); }
}

/* "Paris, France": search the name, use the rest as a hint to pick the match. */
async function geocodeCity(query) {
  const [name, ...rest] = query.split(",");
  const hint = rest.join(",").trim().toLowerCase();
  const params = new URLSearchParams({
    name: name.trim() || query, count: hint ? 10 : 1, language: "en", format: "json",
  });
  const data = await getJSON(`${GEOCODE_URL}?${params}`);
  const results = data.results;
  if (!results || !results.length) throw new UserError(`City "${query}" not found. Check the spelling.`);
  let place = results[0];
  if (hint) {
    const match = results.find((r) =>
      [r.admin1, r.country, r.country_code].some((f) => {
        f = (f || "").toLowerCase();
        return f && (f === hint || (hint.length > 2 && f.includes(hint)));
      }));
    if (match) place = match;
  }
  return { name: place.name, region: place.admin1 || "", country: place.country || "",
           latitude: place.latitude, longitude: place.longitude };
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,surface_pressure",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset",
    timezone: "auto", forecast_days: 5,
  });
  return getJSON(`${FORECAST_URL}?${params}`);
}

/* ---------- Shape data ---------- */
function clock(iso) { // "2026-11-23T06:41" -> "6:41 AM"
  const [h, m] = iso.split("T")[1].split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function buildPayload(place, data) {
  const cur = data.current, daily = data.daily;
  const isDay = cur.is_day !== 0;
  const [description, icon] = describe(cur.weather_code, isDay);
  const forecast = daily.time.map((date, i) => {
    const [d_text, d_icon] = describe(daily.weather_code[i], true);
    const [y, mo, d] = date.split("-").map(Number);
    return {
      day: i === 0 ? "Today" : new Date(y, mo - 1, d).toLocaleDateString("en-US", { weekday: "short" }),
      icon: d_icon, description: d_text,
      max: Math.round(daily.temperature_2m_max[i]), min: Math.round(daily.temperature_2m_min[i]),
    };
  });
  const extra = [place.region, place.country].filter(Boolean).join(", ");
  // current.time is already in the place's own timezone
  const [datePart, timePart] = (cur.time || "").split("T");
  const updated = cur.time
    ? new Date(datePart + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      + ", " + clock(cur.time)
    : new Date().toLocaleString();
  return {
    city: place.name, location: extra ? `${place.name}, ${extra}` : place.name,
    temperature: Math.round(cur.temperature_2m), feels_like: Math.round(cur.apparent_temperature),
    humidity: cur.relative_humidity_2m, wind: Math.round(cur.wind_speed_10m),
    pressure: Math.round(cur.surface_pressure || 0), description, icon,
    sunrise: clock(daily.sunrise[0]), sunset: clock(daily.sunset[0]), forecast, updated,
  };
}

/* ---------- Recent searches (saved in the browser) ---------- */
function getRecent() {
  try { return JSON.parse(localStorage.getItem("skycast_recent")) || []; }
  catch { return []; }
}
function saveRecent(city) {
  const list = [city, ...getRecent().filter((c) => c.toLowerCase() !== city.toLowerCase())].slice(0, 5);
  try { localStorage.setItem("skycast_recent", JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  recentEl.innerHTML = "";
  getRecent().forEach((city) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = city;
    chip.addEventListener("click", () => { cityInput.value = city; loadWeather({ city }); });
    recentEl.appendChild(chip);
  });
}

/* ---------- Load + render ---------- */
let requestId = 0; // only the latest search may update the page

async function loadWeather({ city, lat, lon }) {
  const myId = ++requestId;
  resultEl.classList.add("hidden");
  setStatus("Fetching weather...", false, true);
  try {
    let place;
    if (lat != null) {
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new UserError("Invalid coordinates.");
      place = { name: "Your Location", region: "", country: "", latitude: lat, longitude: lon };
    } else {
      place = await geocodeCity(city);
    }
    const data = await fetchWeather(place.latitude, place.longitude);
    if (myId !== requestId) return; // a newer search started meanwhile
    let payload;
    try { payload = buildPayload(place, data); }
    catch { throw new UserError("The weather service sent an unexpected response."); }
    render(payload);
    setStatus("");
    if (city) saveRecent(payload.city);
  } catch (err) {
    if (myId === requestId) setStatus(err instanceof UserError ? err.message : "Something went wrong. Please try again.", true);
  }
}

function render(d) {
  $("location").textContent = d.location;
  $("icon").textContent = d.icon;
  $("temp").textContent = d.temperature;
  $("desc").textContent = d.description;
  $("feels").textContent = d.feels_like + "°C";
  $("humidity").textContent = d.humidity + "%";
  $("wind").textContent = d.wind + " km/h";
  $("pressure").textContent = d.pressure + " hPa";
  $("sunrise").textContent = d.sunrise;
  $("sunset").textContent = d.sunset;
  $("updated").textContent = d.updated;

  const fc = $("forecast");
  fc.textContent = "";
  d.forecast.forEach((f) => {
    const day = document.createElement("div");
    day.className = "day";
    const dEl = document.createElement("div"); dEl.className = "d"; dEl.textContent = f.day;
    const iEl = document.createElement("div"); iEl.className = "i"; iEl.textContent = f.icon; iEl.title = f.description;
    const tEl = document.createElement("div"); tEl.className = "t";
    const b = document.createElement("b"); b.textContent = f.max + "°";
    tEl.append(b, " / " + f.min + "°");
    day.append(dEl, iEl, tEl);
    fc.appendChild(day);
  });
  resultEl.classList.remove("hidden");
}

/* ---------- Events ---------- */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const city = cityInput.value.trim();
  if (city) loadWeather({ city });
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Geolocation is not supported by your browser.", true);
  setStatus("Finding your location...", false, true);
  navigator.geolocation.getCurrentPosition(
    (pos) => loadWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    (err) => {
      const msgs = {
        1: "Location permission denied. Please search by city name.",
        2: "Your location is unavailable right now. Please search by city name.",
        3: "Finding your location timed out. Please search by city name.",
      };
      setStatus(msgs[err.code] || msgs[2], true);
    },
    { timeout: 10000, maximumAge: 300000 }
  );
});

renderRecent();
loadWeather({ city: "Gwalior" }); // default city on first load
