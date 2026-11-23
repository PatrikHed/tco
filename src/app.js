(function () {
  'use strict';
  const { DEFAULTS, CATEGORIES, calculateAll } = window.TCO;
  const Share = window.TCOShare;

  const STORAGE_KEY = 'tco-calculator:v3';
  const V2_KEY = 'tco-calculator:v2';
  const LEGACY_KEY = 'tco-calculator:v1';
  const LOCALES = { SEK: 'sv-SE', NOK: 'nb-NO', DKK: 'da-DK', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' };
  const OPTION_IDS = [['cash', 'useCash', 'Cash'], ['loan', 'useLoan', 'Loan'], ['lease', 'useLease', 'Lease']];

  const SHORT = { cash: 'Cash', loan: 'Loan', lease: 'Lease' };

  // Typical example values per fuel type (editable by the user).
  const FUELS = {
    petrol: { label: 'Petrol', unit: 'l', consumption: 6.5, price: 19 },
    diesel: { label: 'Diesel', unit: 'l', consumption: 5.5, price: 19.5 },
    hybrid: { label: 'Hybrid', unit: 'l', consumption: 4.5, price: 19 },
    electric: { label: 'Electric', unit: 'kWh', consumption: 18, price: 2.5 },
  };

  // Category colours are fixed slots (--c1 … --c7), in the order of CATEGORIES.
  const CAT_VAR = {};
  CATEGORIES.forEach((c, i) => (CAT_VAR[c.id] = `var(--c${i + 1})`));

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------ input schema */
  const N = (key, label, unit, extra) => Object.assign({ type: 'number', key, label, unit }, extra);

  // Shared by every car so they are compared on the same basis.
  const GLOBAL_KEYS = Share.GLOBAL_KEYS;
  const GLOBAL_FIELDS = [
    N('months', 'Ownership period', 'months', { step: 1, min: 1, max: 240 }),
    N('kmPerYear', 'Distance per year', 'km', { step: 500, min: 0 }),
    N('savingsRate', 'Return if the cash were invested', '% / yr', { step: 0.5, min: 0, max: 100, wide: true, tip: 'Alternative cost of cash paid up front (the price when paying cash, the down payment, the lease upfront payment and the fees paid at the start). Monthly instalments are not charged.' }),
  ];

  // Per car. `opt` marks the sections that belong to one financing option.
  const CAR_SECTIONS = [
    {
      id: 'car', title: 'Car & depreciation', open: true,
      fields: [
        N('price', 'Car price', '{cur}', { step: 5000, min: 0, wide: true }),
        N('registrationFee', 'Registration & delivery', '{cur}', { step: 500, min: 0, wide: true }),
        N('depreciationYear1', 'Value lost in year 1', '%', { step: 1, min: 0, max: 100 }),
        N('depreciationYearly', 'Value lost per later year', '%', { step: 1, min: 0, max: 100 }),
        { type: 'note', id: 'carNote' },
      ],
    },
    {
      id: 'running', title: 'Running costs', hint: 'same for every option', open: false,
      fields: [
        { type: 'select', key: 'fuel', label: 'Energy type', wide: true, options: Object.entries(FUELS).map(([v, f]) => [v, f.label]) },
        N('consumption', 'Consumption', '{unit}/100 km', { step: 0.1, min: 0 }),
        N('energyPrice', 'Energy price', '{cur}/{unit}', { step: 0.5, min: 0 }),
        N('insurance', 'Insurance', '{cur} / yr', { step: 500, min: 0 }),
        N('tax', 'Road tax', '{cur} / yr', { step: 100, min: 0 }),
        N('service', 'Service & repairs', '{cur} / yr', { step: 500, min: 0 }),
        N('tyres', 'Tyres', '{cur} / yr', { step: 500, min: 0 }),
        N('otherMonthly', 'Parking, washing, other', '{cur} / mo', { step: 50, min: 0, wide: true }),
      ],
    },
    {
      id: 'loan', title: 'Loan financing', opt: 'loan', open: false,
      fields: [
        N('loanDownPct', 'Down payment', '% of price', { step: 5, min: 0, max: 100 }),
        N('loanRate', 'Interest rate', '% / yr', { step: 0.1, min: 0, max: 100 }),
        N('loanTerm', 'Loan term', 'months', { step: 6, min: 1, max: 240 }),
        N('loanBalloonPct', 'Balloon at end', '% of price', { step: 5, min: 0, max: 100, tip: 'Part of the price left unpaid until the final instalment (lowers monthly payments).' }),
        N('loanSetupFee', 'Setup fee', '{cur}', { step: 100, min: 0 }),
        N('loanMonthlyFee', 'Monthly fee', '{cur} / mo', { step: 10, min: 0 }),
        { type: 'note', id: 'loanNote' },
      ],
    },
    {
      id: 'lease', title: 'Private leasing', opt: 'lease', open: false,
      fields: [
        N('leaseMonthly', 'Monthly fee', '{cur} / mo', { step: 100, min: 0 }),
        N('leaseUpfront', 'Upfront payment', '{cur}', { step: 1000, min: 0, tip: 'Higher first rent / down payment.' }),
        N('leaseTerm', 'Lease term', 'months', { step: 6, min: 1, max: 240 }),
        N('leaseKmAllowance', 'Included distance', 'km / yr', { step: 500, min: 0 }),
        N('leaseExcessKmFee', 'Excess distance fee', '{cur}/km', { step: 0.1, min: 0 }),
        N('leaseSetupFee', 'Setup / admin fee', '{cur}', { step: 100, min: 0 }),
        N('leaseEndFee', 'End-of-lease fee', '{cur}', { step: 500, min: 0, tip: 'Wear and tear, return inspection, cleaning — per lease.' }),
        { type: 'group', label: 'Included in the monthly fee' },
        { type: 'check', key: 'leaseInclService', label: 'Service & repairs' },
        { type: 'check', key: 'leaseInclTyres', label: 'Tyres' },
        { type: 'check', key: 'leaseInclInsurance', label: 'Insurance' },
        { type: 'check', key: 'leaseInclTax', label: 'Road tax' },
        { type: 'note', id: 'leaseNote' },
      ],
    },
  ];

  /* ------------------------------------------------------------------ state */
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function newCar(name, overrides) {
    const car = { id: uid(), name, open: true, useCash: true, useLoan: true, useLease: true };
    Object.keys(DEFAULTS).forEach((k) => { if (!GLOBAL_KEYS.includes(k)) car[k] = DEFAULTS[k]; });
    return Object.assign(car, overrides);
  }
  function newGlobal() {
    const g = {};
    GLOBAL_KEYS.forEach((k) => (g[k] = DEFAULTS[k]));
    return g;
  }
  function freshState() {
    return { currency: 'SEK', global: newGlobal(), cars: [newCar('Car 1')] };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved.cars) && saved.cars.length) {
        return {
          currency: LOCALES[saved.currency] ? saved.currency : 'SEK',
          global: Object.assign(newGlobal(), saved.global),
          cars: saved.cars.map((c, i) => newCar(`Car ${i + 1}`, c)),
        };
      }
      // Version 2 used a 3 % default "savings return"; the assumption is now 8 %, so don't carry the old value over.
      const v2 = JSON.parse(localStorage.getItem(V2_KEY) || 'null');
      if (v2 && Array.isArray(v2.cars) && v2.cars.length) {
        return {
          currency: LOCALES[v2.currency] ? v2.currency : 'SEK',
          global: Object.assign(newGlobal(), v2.global, { savingsRate: DEFAULTS.savingsRate }),
          cars: v2.cars.map((c, i) => newCar(`Car ${i + 1}`, c)),
        };
      }
      // Migrate the single-car format from the first version.
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
      if (legacy && typeof legacy === 'object') {
        const s = freshState();
        GLOBAL_KEYS.forEach((k) => { if (legacy[k] != null && k !== 'savingsRate') s.global[k] = legacy[k]; });
        Object.assign(s.cars[0], legacy);
        s.cars[0].id = uid();
        if (LOCALES[legacy.__currency]) s.currency = legacy.__currency;
        return s;
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return freshState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  let state = load();
  const carById = (id) => state.cars.find((c) => c.id === id);

  /* ------------------------------------------------------------------ formatting */
  let fmtMoney, fmtDec;
  function setupFormat() {
    const locale = LOCALES[state.currency] || 'en-GB';
    fmtMoney = new Intl.NumberFormat(locale, { style: 'currency', currency: state.currency, maximumFractionDigits: 0 });
    fmtDec = new Intl.NumberFormat(locale, { style: 'currency', currency: state.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const money = (v) => fmtMoney.format(Math.round(v));
  const money2 = (v) => fmtDec.format(v);
  const compact = (v) => (Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));
  const pct = (v) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '') + '%';
  const unitOf = (car) => (FUELS[car && car.fuel] || FUELS.petrol).unit;
  const unitText = (tpl, car) => tpl.replace('{cur}', state.currency).replace(/\{unit\}/g, unitOf(car));

  /* ------------------------------------------------------------------ build inputs */
  const form = document.getElementById('inputs');
  let unitEls = [];

  const ICONS = {
    chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  function buildInputs() {
    unitEls = [];
    form.innerHTML = '';

    const basis = document.createElement('details');
    basis.className = 'panel';
    basis.open = true;
    basis.innerHTML = '<summary>Comparison basis <small>shared by all cars</small></summary>';
    const g = document.createElement('div');
    g.className = 'fields';
    GLOBAL_FIELDS.forEach((f) => g.appendChild(buildField(f, state.global, null)));
    basis.appendChild(g);
    form.appendChild(basis);

    state.cars.forEach((car) => form.appendChild(buildCar(car)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn add';
    add.innerHTML = `${ICONS.plus}<span>Add car</span>`;
    add.addEventListener('click', () => {
      state.cars.push(newCar(`Car ${state.cars.length + 1}`));
      structureChanged();
    });
    form.appendChild(add);
  }

  function iconButton(icon, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.addEventListener('click', onClick);
    return b;
  }

  function buildCar(car) {
    const root = document.createElement('section');
    root.className = 'car';
    root.dataset.car = car.id;

    const head = document.createElement('div');
    head.className = 'car-head';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'car-name';
    name.value = car.name;
    name.maxLength = 40;
    name.placeholder = 'Car name';
    name.setAttribute('aria-label', 'Car name');
    name.addEventListener('input', () => { car.name = name.value; update(); });

    const body = document.createElement('div');
    body.className = 'car-body';
    body.hidden = !car.open;

    const toggle = iconButton(ICONS.chevron, car.open ? 'Collapse car' : 'Expand car', () => {
      car.open = !car.open;
      body.hidden = !car.open;
      toggle.setAttribute('aria-expanded', String(car.open));
      toggle.title = toggle.ariaLabel = car.open ? 'Collapse car' : 'Expand car';
      root.classList.toggle('collapsed', !car.open);
      save();
    });
    toggle.classList.add('chev');
    toggle.setAttribute('aria-expanded', String(car.open));
    root.classList.toggle('collapsed', !car.open);

    const dup = iconButton(ICONS.copy, 'Duplicate car', () => {
      const copy = Object.assign({}, car, { id: uid(), name: `${car.name || 'Car'} (copy)`.slice(0, 40), open: true });
      state.cars.splice(state.cars.indexOf(car) + 1, 0, copy);
      structureChanged();
    });
    const del = iconButton(ICONS.trash, 'Remove car', () => {
      if (state.cars.length === 1) return;
      state.cars.splice(state.cars.indexOf(car), 1);
      structureChanged();
    });
    del.disabled = state.cars.length === 1;
    head.append(name, dup, del, toggle);

    const sub = document.createElement('div');
    sub.className = 'car-sub';
    sub.dataset.sub = car.id;

    // Which financing options to include for this car.
    const compare = document.createElement('div');
    compare.className = 'compare';
    compare.innerHTML = '<span>Compare</span>';
    OPTION_IDS.forEach(([, key, label]) => {
      const chip = document.createElement('label');
      chip.className = 'chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = car[key] !== false;
      cb.dataset.key = key;
      cb.addEventListener('change', () => { car[key] = cb.checked; applyEnabled(root, car); update(); });
      chip.append(cb, Object.assign(document.createElement('span'), { textContent: label }));
      compare.appendChild(chip);
    });
    body.appendChild(compare);

    CAR_SECTIONS.forEach((sec) => {
      const d = document.createElement('details');
      d.className = 'panel';
      d.dataset.opt = sec.opt || '';
      d.open = sec.open;
      const sum = document.createElement('summary');
      sum.innerHTML = `${sec.title}${sec.hint ? ` <small>${sec.hint}</small>` : ''}${sec.opt ? '<span class="pill">Off</span>' : ''}`;
      d.appendChild(sum);
      const grid = document.createElement('div');
      grid.className = 'fields';
      sec.fields.forEach((f) => grid.appendChild(buildField(f, car, car.id)));
      d.appendChild(grid);
      body.appendChild(d);
    });

    root.append(head, sub, body);
    applyEnabled(root, car);
    return root;
  }

  /* Dim and lock the sections of options a car doesn't use. */
  function applyEnabled(root, car) {
    const flag = { loan: car.useLoan !== false, lease: car.useLease !== false };
    root.querySelectorAll('.panel[data-opt]').forEach((p) => {
      const opt = p.dataset.opt;
      if (!opt) return;
      const on = flag[opt];
      p.classList.toggle('off', !on);
      p.querySelectorAll('input, select').forEach((el) => (el.disabled = !on));
    });
  }

  function buildField(f, obj, carId) {
    if (f.type === 'group') { const g = document.createElement('div'); g.className = 'group-title'; g.textContent = f.label; return g; }
    if (f.type === 'note') { const n = document.createElement('div'); n.className = 'note'; n.dataset.note = `${f.id}:${carId}`; return n; }
    if (f.type === 'check') {
      const l = document.createElement('label');
      l.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.key = f.key;
      input.checked = !!obj[f.key];
      input.addEventListener('change', () => { obj[f.key] = input.checked; update(); });
      l.append(input, Object.assign(document.createElement('span'), { textContent: f.label }));
      return l;
    }
    const wrap = document.createElement('label');
    wrap.className = 'field' + (f.wide ? ' wide' : '');
    if (f.tip) wrap.title = f.tip;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = f.label;
    const box = document.createElement('span');
    box.className = 'in';
    wrap.append(lbl, box);

    if (f.type === 'select') {
      const sel = document.createElement('select');
      sel.dataset.key = f.key;
      f.options.forEach(([v, t]) => sel.add(new Option(t, v)));
      sel.value = obj[f.key];
      sel.addEventListener('change', () => {
        obj[f.key] = sel.value;
        if (f.key === 'fuel') {
          const fuel = FUELS[sel.value];
          obj.consumption = fuel.consumption;
          obj.energyPrice = fuel.price;
          syncCar(obj);
          refreshUnits();
        }
        update();
      });
      box.appendChild(sel);
      return wrap;
    }

    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.dataset.key = f.key;
    input.step = f.step;
    if (f.min != null) input.min = f.min;
    if (f.max != null) input.max = f.max;
    input.value = obj[f.key];
    input.addEventListener('input', () => {
      // Keep the raw text while typing; the engine ignores empty/invalid values.
      obj[f.key] = input.value;
      update();
    });
    const unit = document.createElement('span');
    unit.className = 'unit';
    unitEls.push({ el: unit, tpl: f.unit, obj });
    box.append(input, unit);
    return wrap;
  }

  function syncCar(car) {
    const root = form.querySelector(`[data-car="${car.id}"]`);
    if (!root) return;
    root.querySelectorAll('[data-key]').forEach((el) => {
      if (el.type === 'checkbox') return;
      el.value = car[el.dataset.key];
    });
  }
  function refreshUnits() { unitEls.forEach((u) => (u.el.textContent = unitText(u.tpl, u.obj))); }

  function structureChanged() {
    buildInputs();
    refreshUnits();
    update();
  }

  /* ------------------------------------------------------------------ results */
  const resultsEl = document.getElementById('results');
  const tip = document.getElementById('tip');
  let lastResult = null;

  const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const INFO_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 4.8v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  function update() {
    save();
    render(calculateAll({ global: state.global, cars: state.cars }));
  }

  /** Display name of one entry: "Volvo V60 – Private leasing" when cars are compared, else just the option. */
  let carMode = false;
  const nameOf = (o) => (carMode ? `${o.carName} – ${o.label}` : o.label);

  function render(res) {
    lastResult = res;
    carMode = res.comparison === 'cars';
    updateSubs(res);
    updateNotes(res);

    if (!res.scenarios.length) {
      resultsEl.innerHTML = `<div class="card"><h2>Nothing to compare</h2>
        <p class="sub">Turn on at least one of Cash, Loan or Lease for a car to see its cost.</p></div>`;
      return;
    }

    const byKey = Object.fromEntries(res.entries.map((o) => [o.key, o]));
    const best = byKey[res.cheapestKey];
    const next = byKey[res.runnerUpKey];
    const months = res.months;
    const period = months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`;
    const showBest = !!next && !res.tie;

    // Headline: the best deal, with the option that makes it the best deal for that car.
    let verdict;
    let detail;
    if (!next) {
      verdict = esc(nameOf(best));
      detail = 'Only one option is selected. Turn on more options or add another car to compare.';
    } else if (carMode) {
      const other = (o) => `${esc(o.carName)} (${esc(o.label.toLowerCase())})`;
      if (res.tie) {
        verdict = 'The two cheapest cars cost about the same';
        detail = `${esc(best.carName)} and ${esc(next.carName)} are within 1% of each other over ${period}, each with its cheapest option.`;
      } else {
        verdict = `${esc(best.carName)} is the best deal`;
        detail = `With ${esc(best.label.toLowerCase())}. Saves ${money(res.gapToRunnerUp)} over ${period} compared with ${other(next)}`
          + (res.entries.length > 2 ? `, and up to ${money(res.spread)} compared with the most expensive of ${res.entries.length} cars.` : '.');
      }
    } else if (res.tie) {
      verdict = 'The two cheapest options cost about the same';
      detail = `${esc(best.label)} and ${esc(next.label)} are within 1% of each other over ${period}.`;
    } else {
      verdict = `${esc(best.label)} is the cheapest`;
      detail = `Saves ${money(res.gapToRunnerUp)} over ${period} compared with ${esc(next.label.toLowerCase())}`
        + (res.entries.length > 2 ? `, and up to ${money(res.spread)} compared with the most expensive option.` : '.');
    }

    const html = [];
    html.push(`
      <div class="card hero">
        <div class="eyebrow">${carMode ? 'Best deal' : next ? 'Lowest' : 'Total'} · all-in cost per month · ${period}</div>
        <div class="figure">${money(best.perMonth)}<small> / month</small></div>
        <div class="verdict">${verdict}</div>
        <div class="detail">${detail}</div>
      </div>`);

    if (carMode) html.push(`<h2 class="section-title">Cars compared by their cheapest option</h2>`);
    html.push(`<div class="tiles">${res.ranked.map((o) => tile(o, showBest && o.key === res.cheapestKey, best)).join('')}</div>`);
    html.push(chartCard(res));
    html.push(tableCard(res, showBest));
    if (carMode) html.push(allOptionsCard(res));
    resultsEl.innerHTML = html.join('');

    layoutBarLabels();
    attachTooltips();
  }

  function tile(o, isBest, best) {
    const rows = [
      ['Per month', money(o.perMonth)],
      ['Per km', o.perKm ? money2(o.perKm) : '–'],
      ['Cash on day one', money(o.upfront)],
      ['Lost investment return', money(o.categories.capital)],
      ['Monthly payment', o.monthlyPayment ? money(o.monthlyPayment) : '–'],
      ['Car value at end', o.id === 'lease' ? 'Returned' : money(o.residual)],
    ];
    const warns = o.notes.map((n) => `<div class="warn">${INFO_SVG}<span>${esc(n)}</span></div>`).join('');
    const title = carMode ? esc(o.carName) : esc(o.label);
    const via = carMode ? `<div class="via">${esc(o.label)}</div>` : '';
    const gap = o.total - best.total;
    const delta = best && o.key !== best.key && gap > 0.5 ? `<div class="delta">+${money(gap)} vs cheapest</div>` : '';
    return `
      <div class="tile${isBest ? ' best' : ''}">
        <h3><span class="t">${title}</span>${isBest ? `<span class="badge">${CHECK_SVG}Cheapest</span>` : ''}</h3>
        ${via}
        <div class="total">${money(o.total)}</div>
        <div class="total-sub">total cost of ownership</div>${delta}
        <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        ${warns}
      </div>`;
  }

  const usedCategories = (res, list) => CATEGORIES.filter((c) => list.some((o) => o.categories[c.id] > 0.5));

  function chartCard(res) {
    const list = res.ranked;
    const max = Math.max(...list.map((o) => o.total), 1);
    const used = usedCategories(res, list);
    const legend = used.map((c) => `<span><i style="background:${CAT_VAR[c.id]}"></i>${c.label}</span>`).join('');
    const bars = list.map((o) => {
      const segs = used.map((c) => {
        const v = o.categories[c.id];
        if (v <= 0.5) return '';
        const aria = `${nameOf(o)}, ${c.label}: ${money(v)}, ${pct((v / o.total) * 100)} of total`;
        return `<div class="seg" tabindex="0" role="img" aria-label="${esc(aria)}"
          data-key="${esc(o.key)}" data-cat="${c.id}" data-value="${v}" style="width:${(v / max) * 100}%;background:${CAT_VAR[c.id]}"></div>`;
      }).join('');
      const label = carMode ? `<b>${esc(o.carName)}</b> <span class="via-inline">${esc(o.label)}</span>` : `<b>${esc(o.label)}</b>`;
      return `<div><div class="bar-head"><span>${label}</span><span class="tot">${money(o.total)}</span></div><div class="bar">${segs}</div></div>`;
    }).join('');
    return `
      <div class="card">
        <h2>Where the money goes</h2>
        <p class="sub">Total cost over ${res.months} months, split by cost type. Hover or focus a block for details.</p>
        <div class="legend">${legend}</div>
        <div class="bars">${bars}</div>
      </div>`;
  }

  /** Table rows for a list of entries; `badge(o)` returns the badge text for a row, if any. */
  function tableHtml(res, list, firstHead, badge) {
    const used = usedCategories(res, list);
    const head = used.map((c) => `<th title="${esc(c.hint)}"><span class="sw" style="background:${CAT_VAR[c.id]}"></span>${c.label}</th>`).join('');
    const rows = list.map((o) => {
      const b = badge(o);
      return `<tr class="${b && b.best ? 'best-row' : ''}">
        <th scope="row">${esc(nameOf(o))}${b ? `<span class="badge">${CHECK_SVG}${b.text}</span>` : ''}</th>
        ${used.map((c) => `<td>${o.categories[c.id] > 0.5 ? money(o.categories[c.id]) : '–'}</td>`).join('')}
        <td class="strong">${money(o.total)}</td>
        <td>${money(o.perMonth)}</td>
        <td>${o.perKm ? money2(o.perKm) : '–'}</td>
        <td>${money(o.upfront)}</td>
        <td>${o.monthlyPayment ? money(o.monthlyPayment) : '–'}</td>
        <td>${o.id === 'lease' ? 'Returned' : money(o.residual)}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>${firstHead}</th>${head}<th>Total</th><th>Per month</th><th>Per km</th><th>Cash on day one</th><th>Monthly payment</th><th>Car value at end</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function tableCard(res, showBest) {
    const table = tableHtml(res, res.ranked, carMode ? 'Car – cheapest option' : 'Option',
      (o) => (showBest && o.key === res.cheapestKey ? { best: true, text: 'Cheapest' } : null));
    return `
      <div class="card">
        <h2>Breakdown</h2>
        <p class="sub">Every number in the chart, as a table.</p>
        ${table}
      </div>`;
  }

  /* Every enabled option of every car, for anyone who wants to see what the cheapest was picked from. */
  function allOptionsCard(res) {
    const table = tableHtml(res, res.scenarios, 'Car – option',
      (o) => (res.cars.find((c) => c.id === o.carId).best === o ? { text: 'Car’s cheapest' } : null));
    return `
      <details class="card all-options">
        <summary><h2>All options per car</h2><span class="sub">${res.scenarios.length} combinations</span></summary>
        ${table}
      </details>`;
  }

  /* Print a value inside a segment only when it fits with padding (never clip text). */
  function layoutBarLabels() {
    const probe = document.createElement('canvas').getContext('2d');
    resultsEl.querySelectorAll('.seg').forEach((seg) => {
      const label = compact(parseFloat(seg.dataset.value));
      const style = getComputedStyle(seg);
      probe.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const needed = probe.measureText(label).width + 20;
      if (seg.getBoundingClientRect().width >= needed) seg.textContent = label;
      if (seg.dataset.cat === 'energy') seg.classList.add('dark-text'); // slot 4 (yellow) takes dark text in light mode
    });
  }

  function attachTooltips() {
    const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
    const show = (seg, x, y) => {
      const res = lastResult;
      const o = res.scenarios.find((p) => p.key === seg.dataset.key);
      if (!o) return;
      const c = catById[seg.dataset.cat];
      const v = parseFloat(seg.dataset.value);
      tip.innerHTML = `<div class="tip-row"><i style="background:${CAT_VAR[c.id]}"></i><b>${c.label}</b></div>
        <div>${money(v)} · ${pct((v / o.total) * 100)} of ${esc(nameOf(o))}</div>
        <div class="muted">${money(v / res.months)} per month</div>`;
      tip.hidden = false;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
      tip.style.top = (y - h - 10 < 8 ? y + 20 : y - h - 10) + 'px';
    };
    resultsEl.querySelectorAll('.seg').forEach((seg) => {
      seg.addEventListener('mousemove', (e) => show(seg, e.clientX, e.clientY));
      seg.addEventListener('mouseleave', () => (tip.hidden = true));
      seg.addEventListener('focus', () => { const r = seg.getBoundingClientRect(); show(seg, r.left + r.width / 2, r.top); });
      seg.addEventListener('blur', () => (tip.hidden = true));
    });
  }

  /* One-line summary under each car's name (visible when collapsed). */
  function updateSubs(res) {
    res.cars.forEach((c) => {
      const el = form.querySelector(`[data-sub="${c.id}"]`);
      const car = carById(c.id);
      if (!el || !car) return;
      const opts = c.options.map((o) => SHORT[o.id]).join(' · ') || 'No option selected';
      el.textContent = `${money(c.input.price)} · ${opts}`;
    });
  }

  function updateNotes(res) {
    const set = (key, html) => { const el = form.querySelector(`[data-note="${key}"]`); if (el) el.innerHTML = html; };
    res.cars.forEach((c) => {
      // The engine prices all three options; the notes are shown even while one is switched off.
      const full = window.TCO.calculate(Object.assign({}, carById(c.id), state.global));
      const loan = full.options.find((o) => o.id === 'loan');
      set(`carNote:${c.id}`, `Estimated value after ${res.months} months: <strong>${money(full.residual)}</strong> (${pct(full.residualPct)} of the price).`);
      set(`loanNote:${c.id}`, `Borrowed <strong>${money(loan.loanAmount)}</strong> · instalment <strong>${money(loan.monthlyPayment)}</strong> / month`
        + (loan.settledAtEnd > 0 ? ` · ${money(loan.settledAtEnd)} still owed when the period ends.` : '.'));
      const excess = Math.max(0, full.input.kmPerYear - full.input.leaseKmAllowance);
      set(`leaseNote:${c.id}`, excess > 0
        ? `You drive <strong>${Math.round(excess).toLocaleString()} km / yr</strong> over the allowance.`
        : 'Your distance is within the included allowance.');
    });
  }

  /* ------------------------------------------------------------------ boot */
  const currencySel = document.getElementById('currency');
  currencySel.addEventListener('change', () => {
    state.currency = currencySel.value;
    setupFormat(); refreshUnits(); update();
  });
  document.getElementById('reset').addEventListener('click', () => {
    if (!window.confirm('Reset everything to the example values? Your cars will be removed.')) return;
    state = freshState();
    currencySel.value = state.currency;
    setupFormat();
    structureChanged();
  });
  /* ---- import / export ---- */
  const importFile = document.getElementById('import-file');
  const dialog = document.getElementById('import-dialog');
  const dialogBody = document.getElementById('import-body');
  const dialogActions = document.getElementById('import-actions');
  const MAX_FILE_BYTES = 1024 * 1024;

  document.getElementById('export').addEventListener('click', () => {
    const data = Share.buildExport(state);
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tco-cars-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById('import').addEventListener('click', () => { importFile.value = ''; importFile.click(); });

  importFile.addEventListener('change', () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { showImportError('The file is too large to be a car export.'); return; }
    const reader = new FileReader();
    reader.onerror = () => showImportError('The file could not be read.');
    reader.onload = () => {
      const result = Share.parseImport(String(reader.result), { currencies: Object.keys(LOCALES) });
      if (result.ok) showImportChoice(result); else showImportError(result.error);
    };
    reader.readAsText(file);
  });

  function openDialog(body, buttons) {
    dialogBody.innerHTML = body;
    dialogActions.innerHTML = '';
    buttons.forEach(([label, cls, handler]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', () => { dialog.close(); if (handler) handler(); });
      dialogActions.appendChild(b);
    });
    if (!dialog.open) dialog.showModal();
    dialogActions.lastElementChild.focus();
  }
  function showImportError(msg) {
    openDialog(`<p>${esc(msg)}</p>`, [['Close', 'primary']]);
  }
  function showImportChoice(result) {
    const names = result.cars.map((c) => `<li>${esc(c.name)}</li>`).join('');
    const count = `${result.cars.length} car${result.cars.length === 1 ? '' : 's'}`;
    const skipped = result.skipped ? `<p class="dialog-note">${result.skipped} invalid entr${result.skipped === 1 ? 'y was' : 'ies were'} skipped.</p>` : '';
    const settings = result.global || result.currency
      ? '<p class="dialog-note">“Replace” also uses the shared settings (period, distance, investment return) and currency from the file. “Add” keeps your current ones.</p>'
      : '';
    openDialog(`<p>Found <strong>${count}</strong> in the file:</p><ul class="dialog-list">${names}</ul>${skipped}${settings}`, [
      ['Cancel', ''],
      ['Replace my cars', '', () => applyImport(result, 'replace')],
      ['Add to my cars', 'primary', () => applyImport(result, 'add')],
    ]);
  }
  function applyImport(result, mode) {
    const total = (mode === 'add' ? state.cars.length : 0) + result.cars.length;
    const cars = result.cars.map((c) => newCar(c.name, Object.assign({}, c, { open: total <= 3 })));
    if (mode === 'replace') {
      state.cars = cars;
      if (result.global) state.global = Object.assign(newGlobal(), result.global);
      if (result.currency) { state.currency = result.currency; currencySel.value = result.currency; setupFormat(); }
    } else {
      state.cars = state.cars.concat(cars);
    }
    structureChanged();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (lastResult) render(lastResult); }, 120);
  });

  currencySel.value = state.currency;
  setupFormat();
  structureChanged();
})();
