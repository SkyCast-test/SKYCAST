/* SkyCast - static version: the browser calls the free Open-Meteo APIs directly
   (no API key, CORS enabled), so it can be hosted on Netlify / GitHub Pages. */
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
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

/* ---------- Icons: custom SVG weather icons (shared gradients live in index.html) ---------- */
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
  return `M${(15 * c).toFixed(1)} ${(15 * s).toFixed(1)}L${(21 * c).toFixed(1)} ${(21 * s).toFixed(1)}`;
}).join("");
const sunG = (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="${RAYS}" stroke="#ffc83d" stroke-width="3.2" stroke-linecap="round" fill="none"/><circle r="10" fill="url(#gSun)"/></g>`;
const cloudG = (dy = 0, dark = false) => `<g transform="translate(0 ${dy})" fill="url(#${dark ? "gCloudD" : "gCloud"})"><circle cx="24" cy="38" r="9"/><circle cx="36" cy="32" r="12"/><circle cx="46" cy="39" r="8"/><rect x="24" y="38" width="22" height="9"/></g>`;
const WX = {
  sun: sunG(32, 32, 1.1),
  moon: `<g transform="translate(7 7) scale(2)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="url(#gMoon)"/></g>`,
  partly: sunG(24, 24, .8) + `<g transform="translate(5 7) scale(.9)">${cloudG()}</g>`,
  cloud: cloudG(3),
  fog: cloudG(-5) + `<path d="M15 50h34M22 56h28" stroke="#d3dcea" stroke-width="3" stroke-linecap="round"/>`,
  rain: cloudG(-5) + `<path d="M24 47l-3 8M33 47l-3 8M42 47l-3 8" stroke="#5ec8ff" stroke-width="3.2" stroke-linecap="round"/>`,
  snow: cloudG(-5) + `<g fill="#fff"><circle cx="24" cy="50" r="2.4"/><circle cx="34" cy="54" r="2.4"/><circle cx="44" cy="50" r="2.4"/><circle cx="29" cy="59" r="2"/><circle cx="39" cy="60" r="2"/></g>`,
  storm: cloudG(-7, true) + `<polygon points="35,40 27,52 33,52 29,62 41,47 35,47 39,40" fill="#ffd23f"/>`,
};
const WX_KEY = { "☀️": "sun", "🌙": "moon", "🌤️": "partly", "⛅": "partly", "☁️": "cloud", "🌫️": "fog",
  "🌦️": "rain", "🌧️": "rain", "🌨️": "snow", "❄️": "snow", "⛈️": "storm" };
const wx = (emoji) => `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${WX[WX_KEY[emoji] || "cloud"]}</svg>`;
const UI = {
  feels: "M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z",
  hum: "M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z",
  wind: "M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2",
  pres: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 12l4-4",
  uv: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  rain: "M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25",
  aqi: "M22 12h-4l-3 9L9 3l-3 9H2",
  vis: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  cloud: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
};
const uiIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${UI[k]}"/></svg>`;

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
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
async function geocodeCity(query) {
  const key = query.trim().toLowerCase();
  const geo = store.get("skycast_geo") || {};
  if (geo[key]) return geo[key]; // coordinates of a city never change: skip the network call
  const place = await geocodeRemote(query);
  geo[key] = place;
  store.set("skycast_geo", geo);
  return place;
}
async function geocodeRemote(query) {
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
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover",
    hourly: "temperature_2m,weather_code,precipitation_probability,visibility,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max",
    timezone: "auto", forecast_days: 7,
  });
  return getJSON(`${FORECAST_URL}?${params}`);
}

async function fetchAir(lat, lon) { // optional: never blocks the page
  try {
    const d = await getJSON(`${AIR_URL}?${new URLSearchParams({ latitude: lat, longitude: lon, current: "us_aqi" })}`);
    return d.current && d.current.us_aqi != null ? Math.round(d.current.us_aqi) : null;
  } catch { return null; }
}

/* ---------- Units + helpers ---------- */
let unit = (() => { try { return localStorage.getItem("skycast_unit") || "C"; } catch { return "C"; } })();
let last = null; // last payload, so unit switch can re-render without refetching
const T = (c) => Math.round(unit === "F" ? c * 9 / 5 + 32 : c);
const W = (k) => Math.round(unit === "F" ? k * 0.621371 : k) + (unit === "F" ? " mph" : " km/h");
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => DIRS[Math.round(deg / 45) % 8];
function hour12(iso) { const h = +iso.split("T")[1].slice(0, 2); return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`; }

function aqiInfo(a) {
  if (a == null) return ["N/A", ""];
  const l = a <= 50 ? "Good" : a <= 100 ? "Moderate" : a <= 150 ? "Sensitive" : a <= 200 ? "Unhealthy" : a <= 300 ? "Very bad" : "Hazardous";
  return [a, l];
}
function uvLabel(u) { return u < 3 ? "Low" : u < 6 ? "Moderate" : u < 8 ? "High" : u < 11 ? "Very high" : "Extreme"; }

function themeFor(code, isDay) {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code === 3 || code === 2) return "cloudy";
  return isDay ? "clear-day" : "clear-night";
}

function tipFor(p) {
  const t = p.theme;
  if (t === "storm") return "Thunderstorm risk. Stay indoors and keep away from open areas.";
  if (t === "rain") return "Carry an umbrella. Rain is around.";
  if (t === "snow") return "Snowy out there. Dress in warm layers.";
  if (t === "fog") return "Low visibility. Drive carefully.";
  if (p.aqi != null && p.aqi > 150) return "Air quality is poor. Limit time outdoors.";
  if (p.temperature >= 40) return "Extreme heat. Drink plenty of water and avoid the midday sun.";
  if (p.uv >= 8) return "Very high UV. Wear sunscreen and sunglasses.";
  if (p.temperature >= 32) return "A hot day. Stay hydrated.";
  if (p.temperature <= 8) return "Chilly. A jacket is a good idea.";
  if (t === "clear-night") return "A clear night. Good for a walk or some stargazing.";
  return "Pleasant weather. A good day to be outside.";
}

/* ---------- Shape data ---------- */
function clock(iso) { // "2026-11-23T06:41" -> "6:41 AM"
  const [h, m] = iso.split("T")[1].split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const mins = (iso) => { const [h, m] = iso.split("T")[1].split(":").map(Number); return h * 60 + m; };

function buildPayload(place, data, aqi) {
  const cur = data.current, daily = data.daily, hr = data.hourly;
  const isDay = cur.is_day !== 0;
  const [description, icon] = describe(cur.weather_code, isDay);
  const forecast = daily.time.map((date, i) => {
    const [d_text, d_icon] = describe(daily.weather_code[i], true);
    const [y, mo, d] = date.split("-").map(Number);
    return {
      day: i === 0 ? "Today" : new Date(y, mo - 1, d).toLocaleDateString("en-US", { weekday: "short" }),
      icon: d_icon, description: d_text, rain: daily.precipitation_probability_max[i] || 0,
      max: daily.temperature_2m_max[i], min: daily.temperature_2m_min[i],
    };
  });
  const start = Math.max(0, hr.time.findIndex((t) => t >= cur.time.slice(0, 13) + ":00"));
  const hourly = hr.time.slice(start, start + 24).map((t, k) => ({
    label: k === 0 ? "Now" : hour12(t), icon: describe(hr.weather_code[start + k], hr.is_day[start + k] !== 0)[1],
    temp: hr.temperature_2m[start + k], rain: hr.precipitation_probability[start + k] || 0,
  }));
  const extra = [place.region, place.country].filter(Boolean).join(", ");
  const [datePart] = (cur.time || "").split("T");
  const updated = cur.time
    ? new Date(datePart + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ", " + clock(cur.time)
    : new Date().toLocaleString();
  return {
    city: place.name, location: extra ? `${place.name}, ${extra}` : place.name, lat: place.latitude, lon: place.longitude,
    temperature: cur.temperature_2m, feels_like: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
    wind: cur.wind_speed_10m, windDir: compass(cur.wind_direction_10m), pressure: Math.round(cur.surface_pressure || 0),
    clouds: cur.cloud_cover, vis: hr.visibility[start] != null ? Math.round(hr.visibility[start] / 100) / 10 : null,
    uv: Math.round(daily.uv_index_max[0] || 0), rainChance: forecast[0].rain, aqi, description, icon,
    theme: themeFor(cur.weather_code, isDay), sunrise: clock(daily.sunrise[0]), sunset: clock(daily.sunset[0]),
    sunriseM: mins(daily.sunrise[0]), sunsetM: mins(daily.sunset[0]), nowM: cur.time ? mins(cur.time) : null,
    dateLabel: cur.time ? new Date(datePart + "T00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "",
    forecast, hourly, updated,
  };
}

/* ---------- Recent searches (saved in the browser) ---------- */
function getRecent() {
  try { return JSON.parse(localStorage.getItem("skycast_recent")) || []; }
  catch { return []; }
}
function saveRecent(city) {
  const list = [city, ...getRecent().filter((c) => c.toLowerCase() !== city.toLowerCase())].slice(0, 6);
  try { localStorage.setItem("skycast_recent", JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  recentEl.innerHTML = "";
  getRecent().forEach((city) => {
    const chip = el("button", "chip", city);
    chip.type = "button";
    chip.addEventListener("click", () => { cityInput.value = city; loadWeather({ city }); });
    recentEl.appendChild(chip);
  });
}

/* ---------- Load + render ---------- */
let requestId = 0; // only the latest search may update the page
let lastQuery = { city: "Gwalior" };

async function loadWeather(q, { quiet = false } = {}) {
  const myId = ++requestId;
  lastQuery = q;
  closeSuggest();
  if (!quiet) {
    if (last) resultEl.classList.add("loading");
    setStatus("Fetching weather…", false, true);
  }
  try {
    let place;
    if (q.place) {
      place = q.place; // picked from suggestions: exact coordinates, no guessing
    } else if (q.lat != null) {
      if (!(Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180)) throw new UserError("Invalid coordinates.");
      place = { name: "Your Location", region: "", country: "", latitude: q.lat, longitude: q.lon };
    } else {
      place = await geocodeCity(q.city);
    }
    const aqiPromise = fetchAir(place.latitude, place.longitude); // starts now, never blocks the page
    const data = await fetchWeather(place.latitude, place.longitude);
    if (myId !== requestId) return; // a newer search started meanwhile
    let payload;
    try { payload = buildPayload(place, data, null); }
    catch { throw new UserError("The weather service sent an unexpected response."); }
    last = payload;
    render(payload);
    setStatus("");
    if (q.city) { saveRecent(q.place ? q.city : payload.city); try { localStorage.setItem("skycast_last", q.city); } catch {} }
    // air quality arrives a moment later and just updates the page
    aqiPromise.then((aqi) => {
      if (myId !== requestId || aqi == null) return;
      payload.aqi = aqi;
      if (last === payload) render(payload);
    });
    // keep a copy so the next visit shows weather instantly
    aqiPromise.finally(() => { if (q.city) store.set("skycast_cache", { city: q.city, payload, ts: Date.now() }); });
  } catch (err) {
    if (myId === requestId) {
      resultEl.classList.remove("loading");
      if (!quiet || !last) setStatus(err instanceof UserError ? err.message : "Something went wrong. Please try again.", true);
      else setStatus("");
    }
  }
}

let shownTemp = null, tempRaf = 0;
function countTo(node, to) { // the temperature counts up once: the one animated moment on the page
  cancelAnimationFrame(tempRaf);
  const from = shownTemp == null ? 0 : shownTemp;
  shownTemp = to;
  if (reduce || from === to) { node.textContent = to; return; }
  node.textContent = from;
  const t0 = performance.now(), dur = 750;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    node.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) tempRaf = requestAnimationFrame(step);
  };
  tempRaf = requestAnimationFrame(step);
}

const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
function renderSun(d) {
  $("sunrise").textContent = d.sunrise; $("sunset").textContent = d.sunset;
  const dot = $("sun-dot"), done = $("arc-done");
  if (d.sunriseM == null || d.nowM == null) { dot.style.display = "none"; $("sunnote").textContent = ""; $("daylen").textContent = ""; return; }
  const span = Math.max(1, d.sunsetM - d.sunriseM);
  const t = (d.nowM - d.sunriseM) / span;
  $("daylen").textContent = hm(span) + " of daylight";
  if (t >= 0 && t <= 1) {
    const x = 150 - 110 * Math.cos(Math.PI * t), y = 120 - 110 * Math.sin(Math.PI * t);
    dot.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`); dot.style.display = "";
    done.setAttribute("stroke-dasharray", `${t.toFixed(3)} 1`);
    $("sunnote").textContent = `The sun sets in ${hm(d.sunsetM - d.nowM)}.`;
  } else {
    dot.style.display = "none";
    done.setAttribute("stroke-dasharray", t > 1 ? "1 1" : "0 1");
    $("sunnote").textContent = t < 0 ? `The sun rises in ${hm(d.sunriseM - d.nowM)}.` : "The sun has set for today.";
  }
}

function render(d) {
  resultEl.classList.remove("loading");
  document.body.className = "t-" + d.theme;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue("--sky-b").trim() || "#0f2457";
  startFx(d.theme);
  $("logo").innerHTML = wx("⛅");
  $("date").textContent = d.dateLabel || "";
  const rest = d.location.startsWith(d.city + ", ") ? d.location.slice(d.city.length + 2) : "";
  $("location").textContent = d.city; $("region").textContent = rest;
  $("icon").innerHTML = wx(d.icon);
  countTo($("temp"), T(d.temperature));
  $("tu").textContent = "°" + unit;
  $("unit").textContent = "°" + (unit === "C" ? "F" : "C");
  $("desc").textContent = d.description;
  $("hl").textContent = `High ${T(d.forecast[0].max)}°, low ${T(d.forecast[0].min)}°`;
  $("tip").textContent = tipFor(d);
  $("updated").textContent = d.updated;
  renderSun(d);

  const [aq, aql] = aqiInfo(d.aqi);
  const tiles = [
    ["feels", "Feels like", T(d.feels_like) + "°"], ["hum", "Humidity", d.humidity + "%"],
    ["wind", "Wind", W(d.wind), d.windDir], ["pres", "Pressure", d.pressure + " hPa"],
    ["uv", "UV index", d.uv, uvLabel(d.uv)], ["rain", "Rain chance", d.rainChance + "%"],
    ["aqi", "Air quality", aq, aql], ["vis", "Visibility", d.vis != null ? d.vis + " km" : "N/A"],
    ["cloud", "Cloud cover", d.clouds + "%"],
  ];
  const box = $("tiles"); box.textContent = "";
  tiles.forEach(([ic, k, v, s]) => {
    const t = el("div", "tile"), lbl = el("span");
    lbl.innerHTML = uiIcon(ic); lbl.append(k); t.append(lbl);
    const b = el("b", "", v); if (s) b.append(" ", el("small", "", s));
    t.append(b); box.appendChild(t);
  });

  const hr = $("hourly"); hr.textContent = ""; hr.scrollLeft = 0;
  d.hourly.forEach((h) => {
    const ic = el("div", "i wx"); ic.innerHTML = wx(h.icon);
    const c = el("div", "hr"); c.append(el("div", "d", h.label), ic, el("div", "t", T(h.temp) + "°"));
    if (h.rain >= 20) c.append(el("div", "p", h.rain + "%"));
    hr.appendChild(c);
  });

  const lo = Math.min(...d.forecast.map((f) => f.min)), hi = Math.max(...d.forecast.map((f) => f.max));
  const fc = $("forecast"); fc.textContent = "";
  d.forecast.forEach((f) => {
    const day = el("div", "day");
    const i = el("div", "i wx"); i.innerHTML = wx(f.icon); i.title = f.description;
    const dl = el("div", "d", f.day); if (f.rain >= 20) dl.append(el("small", "", f.rain + "% rain"));
    const bar = el("div", "bar"), fill = document.createElement("i");
    fill.style.left = ((f.min - lo) / (hi - lo || 1)) * 100 + "%";
    fill.style.right = (100 - ((f.max - lo) / (hi - lo || 1)) * 100) + "%";
    bar.appendChild(fill);
    const t = el("div", "t"), b = el("b", "", T(f.max) + "°"); t.append(b, " / " + T(f.min) + "°");
    day.append(dl, i, bar, t);
    fc.appendChild(day);
  });
  resultEl.classList.remove("hidden");
}

/* ---------- Weather animation (rain / snow / stars) ---------- */
const fx = $("fx"), ctx = fx.getContext("2d");
let parts = [], raf = 0;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
function sizeFx() { fx.width = innerWidth; fx.height = innerHeight; }
addEventListener("resize", sizeFx); sizeFx();
let fxTheme = null;
function startFx(theme) {
  if (theme === fxTheme) return; // same weather: keep the animation running, no flicker
  fxTheme = theme;
  cancelAnimationFrame(raf); ctx.clearRect(0, 0, fx.width, fx.height);
  const kind = { rain: "rain", storm: "rain", snow: "snow", "clear-night": "star" }[theme];
  if (!kind || reduce) return;
  const n = innerWidth < 600 ? 40 : 90;
  parts = Array.from({ length: n }, () => ({ x: Math.random() * fx.width, y: Math.random() * fx.height, s: Math.random() + .5, r: Math.random() * 2 + 1 }));
  const tick = (t) => {
    ctx.clearRect(0, 0, fx.width, fx.height);
    ctx.fillStyle = ctx.strokeStyle = document.documentElement.dataset.mode === "light" ? (kind === "rain" ? "rgba(20,80,160,.55)" : "rgba(70,110,170,.65)") : kind === "rain" ? "rgba(180,220,255,.5)" : "rgba(255,255,255,.8)";
    if (kind === "rain") ctx.beginPath(); // one path for all drops = one draw call
    parts.forEach((p) => {
      if (kind === "rain") { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + 12 * p.s); p.y += 12 * p.s; p.x -= 1; }
      else if (kind === "snow") { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); p.y += p.s; p.x += Math.sin(t / 900 + p.r); }
      else { ctx.globalAlpha = .4 + .6 * Math.abs(Math.sin(t / 1200 + p.x)); ctx.fillRect(p.x, p.y, p.r, p.r); ctx.globalAlpha = 1; }
      if (p.y > fx.height) { p.y = -10; p.x = Math.random() * fx.width; }
      if (p.x < 0) p.x = fx.width;
    });
    if (kind === "rain") ctx.stroke();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
document.addEventListener("visibilitychange", () => { // save battery: pause when tab is hidden
  if (document.hidden) cancelAnimationFrame(raf);
  else if (fxTheme) { const t = fxTheme; fxTheme = null; startFx(t); }
});

/* ---------- Events ---------- */
function toast(msg) { const t = el("div", "toast", msg); document.body.appendChild(t); setTimeout(() => t.remove(), 2000); }

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const city = cityInput.value.trim();
  if (city) { cityInput.blur(); loadWeather({ city }); }
});

$("unit").addEventListener("click", () => {
  unit = unit === "C" ? "F" : "C";
  try { localStorage.setItem("skycast_unit", unit); } catch {}
  if (last) render(last);
});
$("refresh").addEventListener("click", (e) => { e.currentTarget.classList.add("spin"); setTimeout(() => e.currentTarget.classList.remove("spin"), 800); loadWeather(lastQuery); });
$("share").addEventListener("click", async () => {
  if (!last) return;
  const text = `Weather in ${last.location}: ${T(last.temperature)}°${unit}, ${last.description} - via SkyCast`;
  try {
    if (navigator.share) await navigator.share({ title: "SkyCast", text, url: location.href });
    else { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  } catch {}
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Geolocation is not supported by your browser.", true);
  setStatus("Finding your location…", false, true);
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

/* ---------- City suggestions (autocomplete) ---------- */
const sugEl = $("suggest");
let sugItems = [], sugIndex = -1, sugCtl = null, sugTimer = 0, sugSeq = 0;
const sugCache = new Map();
const flag = (cc) => (cc && cc.length === 2
  ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌍");

async function fetchSuggestions(text, signal) {
  const [name, ...rest] = text.split(",");
  const hint = rest.join(",").trim().toLowerCase();
  const q = name.trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase() + "|" + hint;
  if (sugCache.has(key)) return sugCache.get(key);
  const params = new URLSearchParams({ name: q, count: hint ? 20 : 8, language: "en", format: "json" });
  const res = await fetch(`${GEOCODE_URL}?${params}`, { signal });
  if (!res.ok) throw new Error("suggest failed");
  const data = await res.json();
  let list = (data.results || []).map((r) => ({
    name: r.name, region: r.admin1 || "", country: r.country || "", cc: r.country_code || "",
    latitude: r.latitude, longitude: r.longitude,
  }));
  if (hint) { // "Paris, Texas" -> keep only places whose region/country matches the part after the comma
    const f = list.filter((r) => [r.region, r.country, r.cc].some((x) => {
      x = x.toLowerCase();
      return x && (x === hint || (hint.length > 1 && x.startsWith(hint)) || (hint.length > 2 && x.includes(hint)));
    }));
    if (f.length) list = f;
  }
  const seen = new Set();
  list = list.filter((r) => { const k = [r.name, r.region, r.country].join("|").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  sugCache.set(key, list);
  return list;
}

function closeSuggest() {
  sugEl.classList.add("hidden"); sugEl.textContent = "";
  sugItems = []; sugIndex = -1;
  cityInput.setAttribute("aria-expanded", "false"); cityInput.removeAttribute("aria-activedescendant");
}

function setActive(i) {
  sugIndex = i;
  [...sugEl.children].forEach((li, k) => { li.classList.toggle("active", k === i); li.setAttribute("aria-selected", k === i); });
  if (i >= 0) { cityInput.setAttribute("aria-activedescendant", "sug-" + i); sugEl.children[i].scrollIntoView({ block: "nearest" }); }
  else cityInput.removeAttribute("aria-activedescendant");
}

function renderSuggest(list, text) {
  sugEl.textContent = ""; sugItems = list; sugIndex = -1;
  const q = text.split(",")[0].trim();
  if (!list.length) {
    sugEl.appendChild(el("li", "sug-empty", `No city found for “${q}”`));
  }
  list.forEach((p, i) => {
    const li = el("li", "sug"); li.id = "sug-" + i; li.setAttribute("role", "option");
    const main = el("span", "sug-name");
    const m = p.name.toLowerCase().startsWith(q.toLowerCase()) ? q.length : 0; // bold the part you typed
    if (m) main.append(el("b", "", p.name.slice(0, m)), p.name.slice(m)); else main.textContent = p.name;
    const txt = el("span", "sug-txt"); txt.append(main, el("small", "sug-sub", [p.region, p.country].filter(Boolean).join(", ")));
    li.append(el("span", "sug-flag", flag(p.cc)), txt);
    li.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
    li.addEventListener("click", () => chooseSuggest(i));
    li.addEventListener("mousemove", () => { if (sugIndex !== i) setActive(i); });
    sugEl.appendChild(li);
  });
  sugEl.classList.remove("hidden");
  cityInput.setAttribute("aria-expanded", "true");
}

function chooseSuggest(i) {
  const p = sugItems[i]; if (!p) return;
  const label = p.name + ", " + (p.region || p.country);
  const place = { name: p.name, region: p.region, country: p.country, latitude: p.latitude, longitude: p.longitude };
  const geo = store.get("skycast_geo") || {};
  geo[label.toLowerCase()] = place; // so recent chips / next visit resolve to exactly this city
  store.set("skycast_geo", geo);
  clearTimeout(sugTimer); sugSeq++;
  cityInput.value = label;
  cityInput.blur();
  loadWeather({ city: label, place });
}

cityInput.addEventListener("input", () => {
  clearTimeout(sugTimer);
  const text = cityInput.value.trim();
  if (text.split(",")[0].trim().length < 2) { sugSeq++; if (sugCtl) sugCtl.abort(); closeSuggest(); return; }
  sugTimer = setTimeout(async () => {
    const seq = ++sugSeq;
    if (sugCtl) sugCtl.abort();
    sugCtl = new AbortController();
    try {
      const list = await fetchSuggestions(text, sugCtl.signal);
      if (seq === sugSeq && document.activeElement === cityInput) renderSuggest(list, text);
    } catch (e) { if (e.name !== "AbortError" && seq === sugSeq) closeSuggest(); }
  }, 180);
});
cityInput.addEventListener("focus", () => { if (cityInput.value.trim().length >= 2) cityInput.dispatchEvent(new Event("input")); });
cityInput.addEventListener("keydown", (e) => {
  const open = !sugEl.classList.contains("hidden") && sugItems.length > 0;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) {
    e.preventDefault();
    const n = sugItems.length;
    setActive(sugIndex < 0 ? (e.key === "ArrowDown" ? 0 : n - 1) : (sugIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
  } else if (e.key === "Enter" && open && sugIndex >= 0) {
    e.preventDefault(); chooseSuggest(sugIndex);
  } else if (e.key === "Escape") closeSuggest();
});
form.addEventListener("submit", () => { clearTimeout(sugTimer); sugSeq++; closeSuggest(); });
document.addEventListener("pointerdown", (e) => { if (!form.contains(e.target)) closeSuggest(); });

/* default city needs no geocoding call: one request instead of two on first visit */
{ const g = store.get("skycast_geo") || {}; if (!g.gwalior) { g.gwalior = { name: "Gwalior", region: "Madhya Pradesh", country: "India", latitude: 26.2215, longitude: 78.1778 }; store.set("skycast_geo", g); } }
renderRecent();
let startCity = "Gwalior"; // default city on first load
try { startCity = localStorage.getItem("skycast_last") || startCity; } catch {}
const cached = store.get("skycast_cache");
if (cached && cached.payload && cached.payload.sunriseM != null && cached.city === startCity && Date.now() - cached.ts < 6 * 3600 * 1000) {
  try { last = cached.payload; lastQuery = { city: startCity }; render(cached.payload); } catch { last = null; }
}
loadWeather({ city: startCity }, { quiet: !!last });
