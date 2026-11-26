const form = document.getElementById("search-form");
const cityInput = document.getElementById("city");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const recentEl = document.getElementById("recent");
const locateBtn = document.getElementById("locate");

const $ = (id) => document.getElementById(id);

// Messages are inserted as text (never HTML) so user input echoed back by the
// server in an error message can't inject markup.
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

/* ---------- Fetch + render ---------- */
let requestId = 0; // only the latest search may update the page

async function loadWeather({ city, lat, lon }) {
  const myId = ++requestId;
  const params = new URLSearchParams(lat != null ? { lat, lon } : { city });
  resultEl.classList.add("hidden");
  setStatus("Fetching weather...", false, true);

  try {
    let res;
    try {
      res = await fetch("/api/weather?" + params.toString());
    } catch {
      throw new Error("Cannot reach the SkyCast server. Is app.py still running?");
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON reply */ }
    if (myId !== requestId) return; // a newer search started meanwhile
    if (!res.ok || !data) throw new Error((data && data.error) || "Something went wrong. Please try again.");
    render(data);
    setStatus("");
    if (city) saveRecent(data.city);
  } catch (err) {
    if (myId === requestId) setStatus(err.message, true);
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
    [["d", f.day], ["i", f.icon], ["t", null]].forEach(([cls, txt]) => {
      const el = document.createElement("div");
      el.className = cls;
      if (cls === "i") el.title = f.description;
      if (cls === "t") {
        const b = document.createElement("b");
        b.textContent = f.max + "°";
        el.append(b, " / " + f.min + "°");
      } else el.textContent = txt;
      day.appendChild(el);
    });
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
