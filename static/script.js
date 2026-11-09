const form = document.getElementById("search-form");
const cityInput = document.getElementById("city");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const recentEl = document.getElementById("recent");
const locateBtn = document.getElementById("locate");
const unitToggle = document.getElementById("unit-toggle");
const searchButton = form.querySelector('button[type="submit"]');

const $ = (id) => document.getElementById(id);
let activeRequest = 0;
let activeController;
let weatherData;
let unit = getSavedUnit();

function getSavedUnit() {
  try {
    return localStorage.getItem("skycast_unit") === "f" ? "f" : "c";
  } catch {
    return "c";
  }
}

function setStatus(message = "", { error = false, loading = false, retry = null } = {}) {
  statusEl.replaceChildren();
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    statusEl.appendChild(spinner);
  }
  statusEl.appendChild(document.createTextNode(message));
  if (retry) {
    const button = document.createElement("button");
    button.className = "retry-btn";
    button.type = "button";
    button.textContent = "Try again";
    button.addEventListener("click", () => loadWeather(retry));
    statusEl.appendChild(button);
  }
  statusEl.className = "status" + (error ? " error" : "");
}

function setWeatherLoading(loading) {
  resultEl.classList.toggle("is-loading", loading && !resultEl.classList.contains("hidden"));
  resultEl.setAttribute("aria-busy", String(loading));
  searchButton.disabled = loading;
}

function getRecent() {
  try {
    const recent = JSON.parse(localStorage.getItem("skycast_recent"));
    return Array.isArray(recent)
      ? recent.filter((city) => typeof city === "string" && city.trim()).slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function saveRecent(city) {
  const list = [city, ...getRecent().filter((item) => item.toLowerCase() !== city.toLowerCase())].slice(0, 5);
  try {
    localStorage.setItem("skycast_recent", JSON.stringify(list));
  } catch {
    // Recent searches are optional when browser storage is unavailable.
  }
  renderRecent();
}

function renderRecent() {
  recentEl.replaceChildren();
  getRecent().forEach((city) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = city;
    chip.addEventListener("click", () => {
      cityInput.value = city;
      loadWeather({ city });
    });
    recentEl.appendChild(chip);
  });
}

async function loadWeather(query) {
  const requestId = ++activeRequest;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const params = new URLSearchParams(query);
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 25000);

  setWeatherLoading(true);
  setStatus(weatherData ? "Updating the forecast..." : "Finding the latest forecast...", { loading: true });

  try {
    const response = await fetch("/api/weather?" + params.toString(), { signal: controller.signal });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The weather service returned an unreadable response. Please try again.");
    }
    if (!response.ok) throw new Error(data.error || "Could not load the weather.");
    if (requestId !== activeRequest) return;

    weatherData = data;
    render(data);
    resultEl.classList.remove("hidden");
    setStatus("");
    if (query.city) saveRecent(data.city);
  } catch (error) {
    if (requestId !== activeRequest) return;
    if (timedOut) {
      setStatus("The request took too long. Check your connection and try again.", {
        error: true,
        retry: query,
      });
    } else if (error.name === "AbortError") {
      return;
    } else if (error instanceof TypeError) {
      setStatus("Can't reach the SkyCast server. Start it with “python app.py”, then try again.", {
        error: true,
        retry: query,
      });
    } else {
      setStatus(error instanceof Error ? error.message : "Something went wrong. Please try again.", {
        error: true,
        retry: query,
      });
    }
  } finally {
    window.clearTimeout(timeout);
    if (activeController === controller) {
      activeController = undefined;
      setWeatherLoading(false);
    }
  }
}

function formatTemperature(value) {
  const temperature = unit === "f" ? (value * 9) / 5 + 32 : value;
  return Math.round(temperature);
}

function render(data) {
  $("location").textContent = data.location;
  $("icon").textContent = data.icon;
  $("icon").setAttribute("aria-label", data.description);
  $("temp").textContent = formatTemperature(data.temperature);
  $("unit-label").textContent = unit === "f" ? "°F" : "°C";
  $("desc").textContent = data.description;
  $("feels").textContent = formatTemperature(data.feels_like) + (unit === "f" ? "°F" : "°C");
  $("humidity").textContent = data.humidity + "%";
  $("wind").textContent = data.wind + " km/h";
  $("pressure").textContent = data.pressure + " hPa";
  $("sunrise").textContent = data.sunrise;
  $("sunset").textContent = data.sunset;
  $("updated").textContent = data.updated;
  $("weather-note").textContent = weatherNote(data.weather_code, data.is_day);
  setWeatherTheme(data.weather_code, data.is_day);
  updateUnitToggle();

  const forecast = $("forecast");
  forecast.replaceChildren();
  data.forecast.forEach((item) => {
    const day = document.createElement("article");
    day.className = "day";

    const label = document.createElement("div");
    label.className = "d";
    label.textContent = item.day;

    const date = document.createElement("div");
    date.className = "date";
    date.textContent = formatDate(item.date);

    const icon = document.createElement("div");
    icon.className = "i";
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", item.description);
    icon.textContent = item.icon;

    const temperatures = document.createElement("div");
    temperatures.className = "t";
    const maximum = document.createElement("b");
    maximum.textContent = formatTemperature(item.max) + "°";
    const minimum = document.createElement("span");
    minimum.textContent = formatTemperature(item.min) + "°";
    temperatures.append(maximum, minimum);

    day.append(label, date, icon, temperatures);
    forecast.appendChild(day);
  });
}

function formatDate(date) {
  const parsedDate = new Date(date + "T12:00:00");
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsedDate);
}

function setWeatherTheme(code, isDay) {
  let theme = "cloudy";
  if ([0, 1].includes(code)) theme = "clear";
  else if ([45, 48].includes(code)) theme = "fog";
  else if ([71, 73, 75, 77, 85, 86].includes(code)) theme = "snow";
  else if ([95, 96, 99].includes(code)) theme = "storm";
  else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) theme = "rain";

  document.body.dataset.weather = theme;
  document.body.dataset.night = String(!isDay);
}

function weatherNote(code, isDay) {
  if ([95, 96, 99].includes(code)) return "Stormy skies ahead. Take care out there.";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "A good day to keep an umbrella close.";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Bundle up and enjoy the wintry weather.";
  if ([45, 48].includes(code)) return "Take it slow — visibility may be lower.";
  if ([0, 1].includes(code) && isDay) return "A lovely day to get outside.";
  if ([2, 3].includes(code)) return "A few clouds, with plenty of day ahead.";
  return "A calm moment under the open sky.";
}

function updateUnitToggle() {
  unitToggle.setAttribute("aria-pressed", String(unit === "f"));
  unitToggle.querySelectorAll(".unit-option").forEach((option) => {
    option.classList.toggle("active", option.dataset.unit === unit);
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const city = cityInput.value.trim();
  if (city) loadWeather({ city });
});

document.querySelectorAll(".city-pick").forEach((button) => {
  button.addEventListener("click", () => {
    cityInput.value = button.dataset.city;
    loadWeather({ city: button.dataset.city });
  });
});

unitToggle.addEventListener("click", () => {
  unit = unit === "c" ? "f" : "c";
  try {
    localStorage.setItem("skycast_unit", unit);
  } catch {
    // Unit preference is kept for this page even if browser storage is unavailable.
  }
  updateUnitToggle();
  if (weatherData) render(weatherData);
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Location sharing is not supported by this browser. Search for a city instead.", { error: true });
    return;
  }

  const requestId = ++activeRequest;
  activeController?.abort();
  activeController = undefined;
  setWeatherLoading(true);
  setStatus("Finding your location...", { loading: true });
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (requestId === activeRequest) {
        loadWeather({ lat: position.coords.latitude, lon: position.coords.longitude });
      }
    },
    (error) => {
      if (requestId !== activeRequest) return;
      const message = error.code === error.PERMISSION_DENIED
        ? "Location permission denied. Search for a city instead."
        : error.code === error.POSITION_UNAVAILABLE
          ? "Your location is unavailable. Search for a city instead."
          : "Finding your location took too long. Please try again.";
      setStatus(message, { error: true });
      setWeatherLoading(false);
    },
    { timeout: 10000, maximumAge: 300000 }
  );
});

renderRecent();
updateUnitToggle();
loadWeather({ city: "Gwalior" });
