/* SkyCast extras: light/dark mode, favourites, today's insights, hourly chart, world snapshot.
   Loaded after script.js and reuses its globals (render, loadWeather, T, wx, el, store ...). */
(() => {
  const root = document.documentElement;

  /* ---- Light / dark mode (remembers your choice, defaults to your device setting) ---- */
  $("theme").addEventListener("click", () => {
    const m = root.dataset.mode === "light" ? "dark" : "light";
    root.dataset.mode = m;
    try { localStorage.setItem("skycast_mode", m); } catch {}
    $("theme").setAttribute("aria-checked", m === "dark");
  });
  $("theme").setAttribute("aria-checked", root.dataset.mode !== "light");

  /* ---- Favourite cities ---- */
  const favs = () => store.get("skycast_fav") || [];
  const favBox = el("div", "recent favs");
  $("recent").before(favBox);
  const favBtn = el("button", "pill");
  favBtn.type = "button"; favBtn.setAttribute("aria-label", "Save this city");
  favBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/></svg>';
  $("refresh").before(favBtn);
  const same = (f, d) => Math.abs(f.latitude - d.lat) < 1e-6 && Math.abs(f.longitude - d.lon) < 1e-6;
  function drawFavs() {
    favBox.textContent = "";
    favs().forEach((f) => {
      const c = el("button", "chip", "★ " + f.name); c.type = "button";
      c.addEventListener("click", () => { cityInput.value = f.name; loadWeather({ city: f.name, place: f }); });
      favBox.appendChild(c);
    });
  }
  favBtn.addEventListener("click", () => {
    if (!last) return;
    let list = favs();
    if (list.some((f) => same(f, last))) list = list.filter((f) => !same(f, last));
    else list = [...list, { name: last.city, region: last.location.slice(last.city.length + 2), country: "", latitude: last.lat, longitude: last.lon }].slice(-8);
    store.set("skycast_fav", list); drawFavs(); favBtn.classList.toggle("on", list.some((f) => same(f, last)));
    toast(favBtn.classList.contains("on") ? "Saved to favourites" : "Removed from favourites");
  });

  /* ---- Insights: moon, activity scores, what to wear ---- */
  const MOONS = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  const MOON_IC = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  function moon() {
    const syn = 29.530588853, age = (((Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % syn + syn) % syn, p = age / syn;
    const i = Math.round(p * 8) % 8;
    return { i, ill: (1 - Math.cos(2 * Math.PI * p)) / 2 };
  }
  const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
  const verdict = (s) => (s >= 75 ? "Great" : s >= 50 ? "Fair" : s >= 30 ? "Poor" : "Avoid");
  function scores(d) {
    const t = d.temperature, r = d.rainChance, a = d.aqi == null ? 50 : d.aqi, storm = d.theme === "storm";
    return [
      ["Running", "🏃", 100 - Math.abs(t - 17) * 3.2 - r * 0.5 - Math.max(0, a - 50) * 0.5 - Math.max(0, d.wind - 25) - (storm ? 60 : 0)],
      ["Driving", "🚗", 100 - r * 0.45 - (d.vis != null && d.vis < 5 ? (5 - d.vis) * 14 : 0) - (storm ? 35 : 0) - (d.theme === "fog" ? 25 : 0) - (d.theme === "snow" ? 30 : 0)],
      ["Laundry", "🧺", 100 - r * 1.1 - Math.max(0, d.humidity - 55) * 1.3 - d.clouds * 0.2 + Math.min(15, d.wind / 2)],
      ["Stargazing", "🔭", 100 - d.clouds * 0.9 - Math.max(0, a - 60) * 0.4 - moon().ill * 30 - (d.theme === "clear-night" ? 0 : 25)],
    ].map(([n, ic, s]) => [n, ic, clamp(s)]);
  }
  function outfit(d) {
    const t = d.feels_like;
    return (t >= 34 ? "Light cotton, a hat and plenty of water" : t >= 27 ? "T-shirt and shorts, with sunscreen" : t >= 20 ? "A light shirt, plus a thin layer for the evening"
      : t >= 12 ? "A light jacket or sweater" : t >= 5 ? "A warm coat and layers" : "A heavy coat, gloves and a scarf") + (d.rainChance >= 40 ? ". Pack an umbrella" : "") + ".";
  }
  const ins = el("section", "panel wide"); ins.setAttribute("aria-label", "Today's insights");
  resultEl.insertBefore(ins, resultEl.querySelector('[aria-label="Next 24 hours"]'));
  function insights(d) {
    const m = moon();
    ins.innerHTML = `<div class="panel-head"><h2>Today’s insights</h2><span class="meta">${MOON_IC[m.i]} ${MOONS[m.i]} · ${Math.round(m.ill * 100)}% lit</span></div>
      <div class="acts">${scores(d).map(([n, ic, s]) => `<div class="act"><div class="n"><span>${n}</span><span>${ic}</span></div><b>${s}<small> /100 · ${verdict(s)}</small></b><div class="meter"><i style="width:${s}%"></i></div></div>`).join("")}</div>
      <p class="outfit"><b>What to wear:</b> ${outfit(d)}</p>`;
  }

  /* ---- 24-hour temperature trend ---- */
  const hc = el("div", "hchart"); $("hourly").after(hc);
  function chart(d) {
    const v = d.hourly.map((h) => T(h.temp)), mn = Math.min(...v), mx = Math.max(...v), n = v.length;
    if (n < 2) { hc.textContent = ""; return; }
    const line = v.map((x, i) => `${i ? "L" : "M"}${(10 + (i / (n - 1)) * 700).toFixed(1)} ${(60 - ((x - mn) / (mx - mn || 1)) * 46).toFixed(1)}`).join("");
    hc.innerHTML = `<svg viewBox="0 0 720 84" preserveAspectRatio="none" role="img" aria-label="Temperature trend for the next 24 hours"><defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs><path d="${line}L710 82L10 82Z" fill="url(#gArea)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><div class="hc-lab"><span>Low ${mn}°</span><span>Next 24 hours</span><span>High ${mx}°</span></div>`;
  }

  /* ---- Rain alert + detailed air quality (fetched after the main weather, cached 10 min) ---- */
  const rainBox = el("div", "rainbar hidden"); rainBox.setAttribute("role", "status");
  $("tip").after(rainBox);
  const aqp = el("section", "panel wide hidden"); aqp.setAttribute("aria-label", "Air quality");
  resultEl.insertBefore(aqp, resultEl.querySelector('[aria-label="Next 24 hours"]'));
  const exCache = new Map();
  let exKey = "", exTok = 0;
  async function getExtra(d) {
    const hit = exCache.get(exKey);
    if (hit && Date.now() - hit.ts < 6e5) return hit;
    const q = { latitude: d.lat, longitude: d.lon };
    const [rain, air] = await Promise.all([
      getJSON(`${FORECAST_URL}?${new URLSearchParams({ ...q, minutely_15: "precipitation", forecast_minutely_15: 16, timezone: "auto" })}`).catch(() => null),
      getJSON(`${AIR_URL}?${new URLSearchParams({ ...q, current: "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide" })}`).catch(() => null),
    ]);
    const v = { ts: Date.now(), rain, air };
    if (rain || air) exCache.set(exKey, v);
    return v;
  }
  function drawRain(r) {
    const p = r && r.minutely_15 && r.minutely_15.precipitation;
    if (!p || !p.length) { rainBox.classList.add("hidden"); return; }
    const wet = p.map((x) => (x || 0) >= 0.1), when = (i) => (i * 15 < 60 ? `${Math.max(15, i * 15)} min` : `${Math.round((i * 15) / 6) / 10} hr`);
    let msg, cls;
    if (wet[0]) { const j = wet.indexOf(false); cls = "wet"; msg = j < 0 ? "Raining now, and it looks set to continue for the next 4 hours." : `Raining now, easing in about ${when(j)}.`; }
    else { const j = wet.indexOf(true); cls = j < 0 ? "dry" : "wet"; msg = j < 0 ? "No rain expected in the next 4 hours." : `Rain expected in about ${when(j)}.`; }
    rainBox.className = "rainbar " + cls; rainBox.textContent = msg;
  }
  const POL = [["pm2_5", "PM2.5", [12, 35, 55, 150]], ["pm10", "PM10", [54, 154, 254, 354]], ["ozone", "Ozone", [100, 160, 215, 265]],
    ["nitrogen_dioxide", "NO₂", [100, 200, 400, 700]], ["sulphur_dioxide", "SO₂", [90, 200, 350, 500]], ["carbon_monoxide", "CO", [5000, 10000, 17000, 34000]]];
  const COL = ["#4ade80", "#facc15", "#fb923c", "#f87171", "#c084fc"];
  function drawAir(a) {
    const c = a && a.current;
    if (!c || c.us_aqi == null) { aqp.classList.add("hidden"); return; }
    const v = Math.round(c.us_aqi), [, label] = aqiInfo(v);
    const tip = v <= 50 ? "The air is clean. A great day to be outside." : v <= 100 ? "Acceptable. Unusually sensitive people should take it easier outdoors."
      : v <= 150 ? "Children, older adults and people with asthma should limit long outdoor effort." : v <= 200 ? "Everyone may feel effects. Cut down on outdoor exercise and consider a mask."
      : "Unhealthy. Stay indoors where you can and avoid exercising outside.";
    const items = POL.filter(([k]) => c[k] != null).map(([k, n, th]) => `<div class="pol"><span>${n}</span><b>${Math.round(c[k])}<small> µg/m³</small></b><em style="background:${COL[th.filter((t) => c[k] > t).length]}"></em></div>`).join("");
    aqp.innerHTML = `<div class="panel-head"><h2>Air quality</h2><span class="meta">US AQI · ${label}</span></div><div class="aqhead"><b>${v}</b><span>${tip}</span></div><div class="aqbar"><i style="left:${Math.min(v, 300) / 3}%"></i></div><div class="pols">${items}</div>`;
    aqp.classList.remove("hidden");
  }
  async function loadExtra(d) {
    const key = d.lat + "," + d.lon, tok = ++exTok;
    if (key !== exKey) { exKey = key; rainBox.classList.add("hidden"); aqp.classList.add("hidden"); }
    const v = await getExtra(d).catch(() => null);
    if (!v || tok !== exTok) return;
    drawRain(v.rain); drawAir(v.air);
  }

  /* ---- Hook into the existing render() ---- */
  const baseRender = render;
  function extras(d) {
    const sk = $("skeleton"); if (sk) sk.remove(); favBtn.classList.toggle("on", favs().some((f) => same(f, d))); insights(d); chart(d); loadExtra(d); }
  render = function (d) { baseRender(d); extras(d); transition(d); };

  /* ---- Smooth motion: city-change transition + scroll-reveal for panels ---- */
  const heroCard = $("today"), reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }) : null;
  function reveal() {
    document.querySelectorAll("#result > .panel:not(.hero-card), #result .grid > .panel, .world").forEach((p) => {
      if (!io || reduceMotion) { p.classList.add("in"); return; }
      p.classList.add("rv"); p.classList.remove("in"); io.unobserve(p); io.observe(p);
    });
  }
  let seenKey = "";
  function transition(d) { // only when the city changes, not for unit switches or air-quality refreshes
    const key = d.lat + "," + d.lon;
    if (key === seenKey) return;
    seenKey = key;
    heroCard.classList.remove("swap"); void heroCard.offsetWidth; heroCard.classList.add("swap");
    reveal();
  }

  /* ---- World snapshot (one request for 8 cities) ---- */
  const CITIES = [["Delhi", 28.6139, 77.209], ["Mumbai", 19.076, 72.8777], ["London", 51.5072, -0.1276], ["New York", 40.7128, -74.006],
    ["Dubai", 25.2048, 55.2708], ["Tokyo", 35.6895, 139.6917], ["Sydney", -33.8688, 151.2093], ["Paris", 48.8566, 2.3522]];
  let world = null;
  const ws = el("section", "panel wide world hidden");
  ws.innerHTML = '<div class="panel-head"><h2>Around the world</h2><span class="meta">Live now · tap a city</span></div><div id="wgrid" class="wgrid"></div>';
  document.querySelector(".site-footer").before(ws);
  function drawWorld() {
    const g = $("wgrid"); g.textContent = "";
    if (!world) return;
    world.forEach((w, i) => {
      const [n, la, lo] = CITIES[i], [txt, ic] = describe(w.current.weather_code, w.current.is_day !== 0);
      const b = el("button", "wc"), icon = el("div", "i wx"); b.type = "button"; icon.innerHTML = wx(ic);
      b.append(icon, el("b", "", n), el("span", "", txt), el("em", "", T(w.current.temperature_2m) + "°"));
      b.addEventListener("click", () => { scrollTo({ top: 0, behavior: "smooth" }); cityInput.value = n; loadWeather({ city: n, place: { name: n, region: "", country: "", latitude: la, longitude: lo } }); });
      g.appendChild(b);
    });
    ws.classList.remove("hidden");
  }
  const loadWorld = async () => {
    try {
      const p = new URLSearchParams({ latitude: CITIES.map((c) => c[1]).join(), longitude: CITIES.map((c) => c[2]).join(), current: "temperature_2m,weather_code,is_day", timezone: "auto" });
      world = await getJSON(`${FORECAST_URL}?${p}`); drawWorld();
    } catch {}
  };
  setTimeout(loadWorld, 1200); // after the main weather, so it never slows the first paint
  ws.id = "world";
  setTimeout(() => { const sk = $("skeleton"); if (sk) sk.remove(); }, 9000);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  $("unit").addEventListener("click", drawWorld);

  /* ---- Shortcut: press "/" or Ctrl/Cmd+K to search ---- */
  addEventListener("keydown", (e) => {
    const typing = /input|textarea/i.test(document.activeElement.tagName);
    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault(); scrollTo({ top: 0, behavior: "smooth" }); cityInput.focus({ preventScroll: true }); cityInput.select();
    }
  });

  /* ---- Hourly strip: drag with the mouse, arrow buttons, edge fades ---- */
  const hs = $("hourly"), hp = $("hprev"), hn = $("hnext");
  let down = false, sx = 0, sl = 0;
  function edges() {
    const max = hs.scrollWidth - hs.clientWidth, x = hs.scrollLeft;
    hs.style.setProperty("--ml", x > 4 ? "36px" : "0px");
    hs.style.setProperty("--mr", x < max - 4 ? "36px" : "0px");
    hp.disabled = x <= 4; hn.disabled = x >= max - 4;
  }
  hs.addEventListener("scroll", edges, { passive: true });
  addEventListener("resize", edges);
  new MutationObserver(edges).observe(hs, { childList: true });
  hs.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") { down = true; sx = e.clientX; sl = hs.scrollLeft; hs.classList.add("drag"); } });
  addEventListener("pointermove", (e) => { if (down) hs.scrollLeft = sl - (e.clientX - sx); });
  addEventListener("pointerup", () => { down = false; hs.classList.remove("drag"); });
  hp.addEventListener("click", () => hs.scrollBy({ left: -hs.clientWidth * 0.8, behavior: "smooth" }));
  hn.addEventListener("click", () => hs.scrollBy({ left: hs.clientWidth * 0.8, behavior: "smooth" }));

  /* ---- Header reacts to scroll; nav highlights the section you are reading ---- */
  const hdr = document.querySelector(".site-header"), links = [...document.querySelectorAll(".hnav a")];
  let tick = false;
  addEventListener("scroll", () => {
    if (tick) return; tick = true;
    requestAnimationFrame(() => { hdr.classList.toggle("scrolled", scrollY > 30); tick = false; });
  }, { passive: true });
  if (io) {
    const secs = links.map((a) => document.querySelector(a.getAttribute("href")));
    const spy = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a, i) => a.classList.toggle("on", secs[i] === e.target));
    }), { rootMargin: "-35% 0px -55% 0px" });
    secs.forEach((n) => n && spy.observe(n));
  }

  drawFavs();
  if (last) { extras(last); transition(last); } // the cached first paint happened before this file loaded
})();
