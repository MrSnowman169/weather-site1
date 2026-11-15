/* Погода — швидкий дашборд. Дані: Open-Meteo (без ключа). */
(() => {
  'use strict';

  const DEFAULT_CITY = { name: 'Кременчук', lat: 49.0659, lon: 33.4204 };
  const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const WX_URL = 'https://api.open-meteo.com/v1/forecast';
  const STORE_KEY = 'weather.saved.v1';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (s) => document.querySelector(s);
  const el = {
    app: $('#app'), form: $('#searchForm'), input: $('#cityInput'), searchBtn: $('#searchBtn'),
    geoBtn: $('#geoBtn'), chips: $('#chips'), toast: $('#toast'), toastText: $('#toastText'),
    when: $('#when'), city: $('#cityName'), temp: $('#temp'), desc: $('#desc'), hi: $('#hi'), lo: $('#lo'),
    icon: $('#icon'), save: $('#saveBtn'), saveText: $('#saveText'),
    wind: $('#wind'), windNote: $('#windNote'), arrow: $('#arrow'),
    hum: $('#hum'), humBar: $('#humBar'), humNote: $('#humNote'),
    pres: $('#pres'), presDot: $('#presDot'), presNote: $('#presNote'),
    feels: $('#feels'), feelsBar: $('#feelsBar'), feelsNote: $('#feelsNote'),
    chart: $('#chart'), readout: $('#readout'), stars: $('#stars'), precip: $('#precip'),
  };

  const state = { city: null, saved: [], shown: {}, reqId: 0, iconKey: '' };

  /* ───────── Допоміжні ───────── */
  const fmt = (n) => { const r = Math.round(n); return (r < 0 ? '−' : '') + Math.abs(r); };
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function tween(node, key, to, format = fmt) {
    const from = state.shown[key] ?? to;
    state.shown[key] = to;
    if (reduceMotion || from === to) { node.textContent = format(to); return; }
    const t0 = performance.now(), dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      node.textContent = format(from + (to - from) * ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let toastTimer;
  function showToast(text) {
    clearTimeout(toastTimer);
    el.toastText.textContent = text;
    el.toast.hidden = false;
    el.toast.classList.remove('hide'); void el.toast.offsetWidth; el.toast.classList.add('show');
    toastTimer = setTimeout(() => {
      el.toast.classList.replace('show', 'hide');
      setTimeout(() => { el.toast.hidden = true; }, 360);
    }, 4200);
  }

  async function getJSON(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  /* ───────── Коди погоди (WMO) ───────── */
  function describe(code, isDay) {
    let r;
    if (code === 0) r = ['Ясно', 'clear'];
    else if (code === 1) r = ['Переважно ясно', 'clear'];
    else if (code === 2) r = ['Мінлива хмарність', 'partly'];
    else if (code === 3) r = ['Хмарно', 'cloud'];
    else if (code === 45 || code === 48) r = ['Туман', 'fog'];
    else if (code >= 51 && code <= 57) r = ['Мряка', 'rain'];
    else if (code === 61) r = ['Невеликий дощ', 'rain'];
    else if (code === 63) r = ['Дощ', 'rain'];
    else if (code === 65) r = ['Сильний дощ', 'rain'];
    else if (code === 66 || code === 67) r = ['Крижаний дощ', 'rain'];
    else if (code === 71) r = ['Невеликий сніг', 'snow'];
    else if (code === 73) r = ['Сніг', 'snow'];
    else if (code === 75) r = ['Сильний сніг', 'snow'];
    else if (code === 77) r = ['Снігові зерна', 'snow'];
    else if (code >= 80 && code <= 82) r = ['Злива', 'rain'];
    else if (code === 85 || code === 86) r = ['Снігопад', 'snow'];
    else if (code >= 95) r = ['Гроза', 'storm'];
    else r = ['Невідомо', 'cloud'];
    const [label, icon] = r;
    let sky;
    if (icon === 'clear') sky = isDay ? 'clear-day' : 'clear-night';
    else if (icon === 'partly' || icon === 'cloud') sky = isDay ? 'cloud-day' : 'cloud-night';
    else sky = icon;
    return { label, icon, sky };
  }

  /* ───────── Анімовані іконки ───────── */
  const CLOUD = (fill = 'url(#cg)') => `<path d="M34 92h54a20 20 0 0 0 3-39.8A28 28 0 0 0 37 50a21 21 0 0 0-3 42z" fill="${fill}"/>`;
  const DEFS = `<defs>
    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfd9e6"/></linearGradient>
    <linearGradient id="cd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8c2d0"/><stop offset="1" stop-color="#7d8aa0"/></linearGradient>
    <radialGradient id="sg" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#ffb62e"/></radialGradient>
  </defs>`;
  const SUN = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
    <g class="rays" style="transform-origin:60px 60px;animation:spin 24s linear infinite">${
      Array.from({ length: 8 }, (_, i) => `<rect x="57.5" y="8" width="5" height="16" rx="2.5" fill="#ffd25e" transform="rotate(${i * 45} 60 60)"/>`).join('')
    }</g><circle cx="60" cy="60" r="26" fill="url(#sg)"/></g>`;
  const MOON = `<g style="animation:bob 6s ease-in-out infinite"><path d="M80 82A34 34 0 1 1 52 26a28 28 0 0 0 28 56z" fill="#f3f0dc"/>
    <circle cx="48" cy="56" r="4" fill="#d9d4b4"/><circle cx="60" cy="74" r="3" fill="#d9d4b4"/><circle cx="42" cy="72" r="2.2" fill="#d9d4b4"/></g>`;

  function iconSVG(kind, isDay) {
    const sty = `<style>
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes bob{50%{transform:translateY(-4px)}}
      @keyframes float{50%{transform:translateX(5px)}}
      @keyframes drop{0%{transform:translateY(-6px);opacity:0}30%{opacity:1}100%{transform:translateY(22px);opacity:0}}
      @keyframes flake{0%{transform:translate(0,-6px);opacity:0}30%{opacity:1}100%{transform:translate(4px,22px);opacity:0}}
      @keyframes bolt{0%,60%,100%{opacity:1}65%{opacity:.15}72%{opacity:1}80%{opacity:.2}}
      @keyframes mist{50%{transform:translateX(8px)}}
    </style>`;
    let body = '';
    const rain = [34, 54, 74].map((x, i) => `<line x1="${x + 8}" y1="92" x2="${x + 4}" y2="104" stroke="#9fd0ff" stroke-width="4" stroke-linecap="round" style="animation:drop 1.1s ${i * .28}s linear infinite"/>`).join('');
    const snow = [36, 56, 76].map((x, i) => `<circle cx="${x + 8}" cy="98" r="3.5" fill="#fff" style="animation:flake 2s ${i * .6}s linear infinite"/>`).join('');
    switch (kind) {
      case 'clear': body = isDay ? SUN(0, 0, 1) : MOON; break;
      case 'partly':
        body = (isDay ? SUN(-12, -18, .8) : `<g transform="translate(-8 -14) scale(.8)">${MOON}</g>`) +
          `<g style="animation:float 7s ease-in-out infinite">${CLOUD()}</g>`; break;
      case 'cloud':
        body = `<g style="animation:float 8s ease-in-out infinite;transform:translate(-6px,-6px)">${CLOUD('url(#cd)')}</g><g style="animation:float 6s ease-in-out infinite reverse;transform:translate(10px,6px)">${CLOUD()}</g>`; break;
      case 'rain': body = `<g style="transform:translateY(-10px)">${CLOUD('url(#cd)')}${rain}</g>`; break;
      case 'snow': body = `<g style="transform:translateY(-10px)">${CLOUD()}${snow}</g>`; break;
      case 'storm':
        body = `<g style="transform:translateY(-12px)">${CLOUD('url(#cd)')}<polygon points="62,78 48,100 60,100 54,118 76,92 64,92 72,78" fill="#ffd25e" style="animation:bolt 2.4s linear infinite"/></g>`; break;
      case 'fog':
        body = `<g style="transform:translateY(-8px)">${CLOUD('url(#cd)')}</g>` +
          [86, 98, 110].map((y, i) => `<line x1="26" y1="${y}" x2="94" y2="${y}" stroke="#fff" stroke-opacity=".8" stroke-width="5" stroke-linecap="round" style="animation:mist ${5 + i}s ease-in-out infinite ${i % 2 ? 'reverse' : ''}"/>`).join(''); break;
    }
    return `<svg viewBox="0 0 120 120">${sty}${DEFS}${body}</svg>`;
  }

  /* ───────── Небо: зірки та опади ───────── */
  (function makeStars() {
    el.stars.innerHTML = Array.from({ length: 70 }, () => {
      const s = (Math.random() * 2 + 1).toFixed(1);
      return `<i style="left:${Math.random() * 100}%;top:${Math.random() * 65}%;width:${s}px;height:${s}px;animation-delay:${(Math.random() * 4).toFixed(1)}s;animation-duration:${(3 + Math.random() * 3).toFixed(1)}s"></i>`;
    }).join('');
  })();

  function setPrecip(kind) {
    const type = kind === 'snow' ? 'snow' : (kind === 'rain' || kind === 'storm') ? 'rain' : '';
    el.precip.className = 'precip ' + type;
    if (!type) { el.precip.innerHTML = ''; return; }
    const n = type === 'rain' ? 70 : 45;
    el.precip.innerHTML = Array.from({ length: n }, () => {
      const dur = type === 'rain' ? 0.7 + Math.random() * 0.6 : 6 + Math.random() * 6;
      return `<i style="left:${(Math.random() * 110 - 5).toFixed(1)}%;animation-duration:${dur.toFixed(2)}s;animation-delay:-${(Math.random() * dur).toFixed(2)}s;--dx:${type === 'rain' ? -40 : (Math.random() * 60 - 30).toFixed(0)}px"></i>`;
    }).join('');
  }

  /* ───────── Графік ───────── */
  function smoothPath(p) {
    let d = `M${p[0].x} ${p[0].y}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)}, ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  function renderChart(hours) {
    const W = 800, H = 260, L = 28, R = 28, T = 46, B = 38;
    const vals = hours.map((h) => h.v);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pad = Math.max(1.5, (mx - mn) * 0.18);
    const lo = mn - pad, hi = mx + pad;
    const step = (W - L - R) / (hours.length - 1);
    const pts = hours.map((h, i) => ({ x: +(L + i * step).toFixed(1), y: +(T + (hi - h.v) / (hi - lo) * (H - T - B)).toFixed(1) }));
    const line = smoothPath(pts);
    const area = `${line} L${pts.at(-1).x} ${H - B} L${pts[0].x} ${H - B} Z`;
    const labelIdx = hours.map((_, i) => i).filter((i) => i % 3 === 0);

    const labels = labelIdx.map((i, k) => `
      <circle class="dot" style="--k:${k}" cx="${pts[i].x}" cy="${pts[i].y}" r="4.5"/>
      <text class="t-val" x="${pts[i].x}" y="${pts[i].y - 14}">${fmt(hours[i].v)}°</text>
      <text class="t-hour" x="${pts[i].x}" y="${H - 12}">${i === 0 ? 'Зараз' : hours[i].t}</text>`).join('');

    el.chart.innerHTML = `
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <line class="grid" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      <path class="area" d="${area}" fill="url(#ag)"/>
      <path class="line" d="${line}" pathLength="1"/>
      ${labels}
      <g class="hover"><line id="hLine" x1="0" x2="0" y1="${T - 12}" y2="${H - B}"/><circle id="hDot" r="5" cx="0" cy="0"/></g>`;

    const base = `Від ${fmt(mn)}° до ${fmt(mx)}°`;
    el.readout.textContent = base;

    const move = (e) => {
      const r = el.chart.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(hours.length - 1, Math.round((x - L) / step)));
      $('#hLine').setAttribute('x1', pts[i].x); $('#hLine').setAttribute('x2', pts[i].x);
      $('#hDot').setAttribute('cx', pts[i].x); $('#hDot').setAttribute('cy', pts[i].y);
      el.readout.textContent = `${i === 0 ? 'Зараз' : hours[i].t}: ${fmt(hours[i].v)}°`;
    };
    el.chart.onpointermove = (e) => { if (e.pointerType !== 'mouse') el.chart.classList.add('touch'); move(e); };
    el.chart.onpointerleave = () => { el.chart.classList.remove('touch'); el.readout.textContent = base; };
  }

  /* ───────── Відображення даних ───────── */
  const DIRS = ['Пн', 'ПнС', 'С', 'ПдС', 'Пд', 'ПдЗ', 'З', 'ПнЗ'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function render(city, wx) {
    const c = wx.current;
    const isDay = !!c.is_day;
    const info = describe(c.weather_code, isDay);

    // 24 години від поточної
    const nowKey = c.time.slice(0, 13) + ':00';
    let start = wx.hourly.time.findIndex((t) => t >= nowKey);
    if (start < 0) start = 0;
    const hours = wx.hourly.time.slice(start, start + 24).map((t, i) => ({ t: t.slice(11, 16), v: wx.hourly.temperature_2m[start + i] }));
    const vs = hours.map((h) => h.v);

    document.body.dataset.sky = info.sky;
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue('--c1').trim() || '#3a8bdc';
    setPrecip(info.icon);

    const d = new Date(c.time);
    el.when.textContent = `${d.toLocaleDateString('uk-UA', { weekday: 'long' })}, ${c.time.slice(11, 16)}`;
    el.city.textContent = city.name;
    el.desc.textContent = info.label;
    tween(el.temp, 'temp', c.temperature_2m);
    tween(el.hi, 'hi', Math.max(...vs));
    tween(el.lo, 'lo', Math.min(...vs));

    const key = info.icon + (isDay ? 'd' : 'n');
    if (key !== state.iconKey) {
      el.icon.innerHTML = iconSVG(info.icon, isDay);
      el.icon.classList.remove('swap'); void el.icon.offsetWidth; el.icon.classList.add('swap');
      state.iconKey = key;
    }

    // Вітер
    const ws = c.wind_speed_10m;
    tween(el.wind, 'wind', ws);
    el.arrow.style.transform = `rotate(${(c.wind_direction_10m + 180) % 360}deg)`;
    const dir = DIRS[Math.round(c.wind_direction_10m / 45) % 8];
    const strength = ws < 0.5 ? 'Штиль' : ws < 3.4 ? 'Слабкий' : ws < 8 ? 'Помірний' : ws < 14 ? 'Сильний' : 'Шторм';
    el.windNote.textContent = `${strength}, ${dir}`;

    // Вологість
    const h = c.relative_humidity_2m;
    tween(el.hum, 'hum', h);
    requestAnimationFrame(() => { el.humBar.style.width = clamp(h, 0, 100) + '%'; });
    el.humNote.textContent = h < 30 ? 'Сухо' : h < 60 ? 'Комфортно' : h < 80 ? 'Волого' : 'Дуже волого';

    // Тиск (гПа → мм рт. ст.)
    const mm = c.pressure_msl * 0.750062;
    tween(el.pres, 'pres', mm);
    requestAnimationFrame(() => { el.presDot.style.left = clamp((mm - 720) / 60 * 100, 4, 96) + '%'; });
    el.presNote.textContent = mm < 745 ? 'Знижений' : mm > 765 ? 'Підвищений' : 'Нормальний';

    // Відчувається як
    const f = c.apparent_temperature, diff = f - c.temperature_2m;
    tween(el.feels, 'feels', f);
    requestAnimationFrame(() => { el.feelsBar.style.width = clamp((f + 30) / 70 * 100, 4, 100) + '%'; });
    el.feelsNote.textContent = Math.abs(diff) < 1.5 ? 'Майже як є' : diff < 0 ? 'Холодніше за факт' : 'Тепліше за факт';

    renderChart(hours);
    el.app.classList.remove('is-loading');
    refreshSaveUI();
  }

  /* ───────── Збережені міста ───────── */
  const sameCity = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
  function loadSaved() { try { state.saved = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { state.saved = []; } }
  function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state.saved)); } catch { /* приватний режим */ } }

  function refreshSaveUI() {
    const on = state.saved.some((s) => sameCity(s, state.city));
    el.save.setAttribute('aria-pressed', String(on));
    el.saveText.textContent = on ? 'Збережено' : 'Зберегти';
    el.save.setAttribute('aria-label', on ? 'Видалити місто зі збережених' : 'Зберегти місто');
    renderChips();
  }

  function renderChips() {
    if (!state.saved.length) {
      el.chips.innerHTML = '<span class="empty">Збережені міста з’являться тут</span>';
      return;
    }
    el.chips.innerHTML = '';
    state.saved.forEach((s, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'chip';
      wrap.dataset.active = String(sameCity(s, state.city));
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'chip-go'; go.textContent = s.name;
      go.addEventListener('click', () => loadCity(s));
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'chip-x'; x.textContent = '×';
      x.setAttribute('aria-label', `Видалити ${s.name}`);
      x.addEventListener('click', () => { state.saved.splice(i, 1); persist(); refreshSaveUI(); });
      wrap.append(go, x);
      el.chips.append(wrap);
    });
  }

  el.save.addEventListener('click', () => {
    if (!state.city) return;
    const i = state.saved.findIndex((s) => sameCity(s, state.city));
    if (i >= 0) state.saved.splice(i, 1);
    else state.saved.push({ ...state.city });
    persist(); refreshSaveUI();
  });

  /* ───────── Завантаження даних ───────── */
  async function loadCity(city) {
    const id = ++state.reqId;
    el.app.classList.toggle('is-loading', !state.city);
    el.searchBtn.disabled = true;
    try {
      const q = new URLSearchParams({
        latitude: city.lat, longitude: city.lon, timezone: 'auto', forecast_days: 3, wind_speed_unit: 'ms',
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code,is_day',
        hourly: 'temperature_2m',
      });
      const wx = await getJSON(`${WX_URL}?${q}`);
      if (id !== state.reqId) return;           // застарілий запит
      state.city = city;
      render(city, wx);
    } catch (err) {
      if (id !== state.reqId) return;
      // Попередні дані залишаються на екрані
      showToast(state.city ? 'Немає мережі. Показано попередні дані' : 'Не вдалося завантажити погоду. Спробуйте ще раз');
      el.app.classList.remove('is-loading');
    } finally {
      if (id === state.reqId) el.searchBtn.disabled = false;
    }
  }

  async function searchCity(name) {
    const q = name.trim();
    if (!q) { showToast('Введіть назву міста'); el.input.focus(); return; }
    el.searchBtn.disabled = true;
    try {
      const data = await getJSON(`${GEO_URL}?${new URLSearchParams({ name: q, count: 1, language: 'uk', format: 'json' })}`);
      const r = data.results && data.results[0];
      if (!r) { showToast('Місто не знайдено'); el.searchBtn.disabled = false; return; }
      el.input.value = '';
      el.input.blur();
      await loadCity({ name: r.name, lat: r.latitude, lon: r.longitude });
    } catch {
      showToast('Немає мережі. Показано попередні дані');
      el.searchBtn.disabled = false;
    }
  }

  el.form.addEventListener('submit', (e) => { e.preventDefault(); searchCity(el.input.value); });

  el.geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('Браузер не підтримує геолокацію'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => loadCity({ name: 'Ваше місце', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }),
      () => showToast('Немає доступу до геолокації. Дозвольте його в налаштуваннях браузера'),
      { timeout: 8000 }
    );
  });

  /* ───────── Старт ───────── */
  el.icon.innerHTML = iconSVG('clear', true);
  loadSaved();
  renderChips();
  loadCity(DEFAULT_CITY);
})();
