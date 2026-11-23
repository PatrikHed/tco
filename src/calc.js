/*
 * TCO calculation engine. Pure functions, no DOM access.
 * Works both as a classic <script> (exposes window.TCO) and as a CommonJS module (for tests).
 *
 * Conventions
 *  - Money is in a single currency, rates are annual percentages in the input and converted here.
 *  - Time is in whole months. Upfront payments happen at month 0, monthly payments at the end of
 *    each month, and the car is sold (or the loan settled) at month `months`.
 *  - "Lost investment return" is the alternative cost of the cash paid up front: what it would have
 *    earned if it had stayed invested at `savingsRate` (default 8 % a year, compounded monthly)
 *    until the end of the period. Only payments made at the start count (price and fees when
 *    buying for cash, down payment and fees for a loan, upfront payment and fees for a lease);
 *    monthly instalments and end-of-period payments do not.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TCO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    // Car & usage
    price: 400000,
    registrationFee: 5000,
    months: 36,
    kmPerYear: 15000,
    depreciationYear1: 18, // % of price lost in the first 12 months
    depreciationYearly: 10, // % of remaining value lost each following year
    savingsRate: 8, // % per year: assumed return if the cash were invested instead of spent

    // Running costs
    fuel: 'petrol',
    consumption: 6.5, // per 100 km, in the unit of the chosen fuel
    energyPrice: 19, // per litre / kWh
    insurance: 8000, // per year
    tax: 1500, // per year
    service: 4000, // per year
    tyres: 3000, // per year
    otherMonthly: 300, // parking, washing, tolls ... per month

    // Loan
    loanDownPct: 20,
    loanRate: 7.5,
    loanTerm: 60,
    loanSetupFee: 600,
    loanMonthlyFee: 40,
    loanBalloonPct: 0, // % of price still owed after the last instalment

    // Private lease
    leaseMonthly: 4495,
    leaseUpfront: 10000,
    leaseTerm: 36,
    leaseKmAllowance: 15000, // per year
    leaseExcessKmFee: 2.0, // per km above the allowance
    leaseSetupFee: 3000,
    leaseEndFee: 3000, // return inspection / wear and tear, per lease
    leaseInclService: true,
    leaseInclTyres: false,
    leaseInclInsurance: false,
    leaseInclTax: true,
  };

  const FUEL_IDS = ['petrol', 'diesel', 'hybrid', 'electric'];

  const CATEGORIES = [
    { id: 'vehicle', label: 'Car cost', hint: 'Depreciation (cash, loan) or lease payments' },
    { id: 'interest', label: 'Loan interest', hint: 'Interest paid to the lender' },
    { id: 'capital', label: 'Lost investment return', hint: 'Return you would have earned by investing the cash paid up front instead' },
    { id: 'energy', label: 'Fuel / energy', hint: 'Fuel or electricity for the distance driven' },
    { id: 'insuranceTax', label: 'Insurance & tax', hint: 'Insurance and road tax, when not in the lease' },
    { id: 'serviceTyres', label: 'Service & tyres', hint: 'Maintenance and tyres, when not in the lease' },
    { id: 'fees', label: 'Fees & other', hint: 'Registration, loan and lease fees, excess km, parking etc.' },
  ];

  const OPTIONS = [
    { id: 'cash', label: 'Cash purchase' },
    { id: 'loan', label: 'Loan financing' },
    { id: 'lease', label: 'Private leasing' },
  ];

  function num(v, fallback) {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const zeros = (n) => new Array(n).fill(0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);

  /** Coerce raw (possibly string, empty or out-of-range) input into a safe, fully populated object. */
  function normalize(raw) {
    const r = Object.assign({}, DEFAULTS, raw || {});
    const n = (k, lo, hi) => clamp(num(r[k], DEFAULTS[k]), lo, hi);
    return {
      price: n('price', 0, 1e9),
      registrationFee: n('registrationFee', 0, 1e9),
      months: Math.round(n('months', 1, 240)),
      kmPerYear: n('kmPerYear', 0, 1e6),
      depreciationYear1: n('depreciationYear1', 0, 100),
      depreciationYearly: n('depreciationYearly', 0, 100),
      savingsRate: n('savingsRate', 0, 100),
      fuel: FUEL_IDS.includes(r.fuel) ? r.fuel : DEFAULTS.fuel,
      consumption: n('consumption', 0, 1000),
      energyPrice: n('energyPrice', 0, 1e6),
      insurance: n('insurance', 0, 1e9),
      tax: n('tax', 0, 1e9),
      service: n('service', 0, 1e9),
      tyres: n('tyres', 0, 1e9),
      otherMonthly: n('otherMonthly', 0, 1e9),
      loanDownPct: n('loanDownPct', 0, 100),
      loanRate: n('loanRate', 0, 100),
      loanTerm: Math.round(n('loanTerm', 1, 240)),
      loanSetupFee: n('loanSetupFee', 0, 1e9),
      loanMonthlyFee: n('loanMonthlyFee', 0, 1e9),
      loanBalloonPct: n('loanBalloonPct', 0, 100),
      leaseMonthly: n('leaseMonthly', 0, 1e9),
      leaseUpfront: n('leaseUpfront', 0, 1e9),
      leaseTerm: Math.round(n('leaseTerm', 1, 240)),
      leaseKmAllowance: n('leaseKmAllowance', 0, 1e6),
      leaseExcessKmFee: n('leaseExcessKmFee', 0, 1e6),
      leaseSetupFee: n('leaseSetupFee', 0, 1e9),
      leaseEndFee: n('leaseEndFee', 0, 1e9),
      leaseInclService: !!r.leaseInclService,
      leaseInclTyres: !!r.leaseInclTyres,
      leaseInclInsurance: !!r.leaseInclInsurance,
      leaseInclTax: !!r.leaseInclTax,
    };
  }

  /** Share of the purchase price still worth something after `months` (fraction, 0..1). */
  function residualFactor(months, y1Pct, yearlyPct) {
    const t = months / 12;
    const y1 = y1Pct / 100;
    const yr = yearlyPct / 100;
    if (t <= 1) return 1 - y1 * t;
    return (1 - y1) * Math.pow(1 - yr, t - 1);
  }

  /** Level monthly instalment of an annuity loan with an optional balloon (residual) amount. */
  function annuityPayment(principal, annualRatePct, n, balloon) {
    const r = annualRatePct / 100 / 12;
    if (principal <= 0) return 0;
    if (r === 0) return (principal - balloon) / n;
    const g = Math.pow(1 + r, -n);
    return ((principal - balloon * g) * r) / (1 - g);
  }

  /**
   * Return given up on cash paid up front: each deposit would have grown at the alternative rate
   * from the month it was paid until the end of the period.
   * @param {number[]} deposits  Upfront payments by month index (0 = day one).
   */
  function tiedUpMoneyCost(deposits, months, annualRatePct) {
    const rm = Math.pow(1 + annualRatePct / 100, 1 / 12) - 1;
    let cost = 0;
    for (let t = 0; t < months; t++) {
      if (deposits[t]) cost += deposits[t] * (Math.pow(1 + rm, months - t) - 1);
    }
    return cost;
  }

  /** Running costs over the whole period, split into the chart categories. */
  function runningCosts(i, included) {
    const years = i.months / 12;
    const inc = included || {};
    return {
      energy: ((i.kmPerYear * years) / 100) * i.consumption * i.energyPrice,
      insuranceTax: (inc.insurance ? 0 : i.insurance * years) + (inc.tax ? 0 : i.tax * years),
      serviceTyres: (inc.service ? 0 : i.service * years) + (inc.tyres ? 0 : i.tyres * years),
      other: i.otherMonthly * i.months,
    };
  }

  function finish(i, id, parts) {
    const run = parts.running;
    const categories = {
      vehicle: parts.vehicle,
      interest: parts.interest || 0,
      capital: tiedUpMoneyCost(parts.deposits, i.months, i.savingsRate),
      energy: run.energy,
      insuranceTax: run.insuranceTax,
      serviceTyres: run.serviceTyres,
      fees: (parts.fees || 0) + run.other,
    };
    const total = sum(Object.values(categories));
    const years = i.months / 12;
    const km = i.kmPerYear * years;
    const meta = OPTIONS.find((o) => o.id === id);
    return Object.assign(
      {
        id,
        label: meta.label,
        categories,
        total,
        perMonth: total / i.months,
        perKm: km > 0 ? total / km : 0,
        // Cash paid on day one for the car itself (excludes running costs).
        upfront: parts.deposits[0],
        // Recurring payment for financing the car (excludes running costs).
        monthlyPayment: parts.monthlyPayment || 0,
        residual: parts.residual || 0,
        notes: parts.notes || [],
      },
      parts.extra || {}
    );
  }

  function cashPurchase(i, residual) {
    const deposits = zeros(i.months + 1);
    deposits[0] = i.price + i.registrationFee;
    return finish(i, 'cash', {
      vehicle: i.price - residual,
      fees: i.registrationFee,
      deposits,
      residual,
      running: runningCosts(i),
    });
  }

  function loanFinancing(i, residual) {
    const N = i.months;
    const n = i.loanTerm;
    const down = i.price * (i.loanDownPct / 100);
    const principal = i.price - down;
    const balloon = i.price * (i.loanBalloonPct / 100);
    const rate = i.loanRate / 100 / 12;
    const effBalloon = Math.min(balloon, principal);
    const pmt = annuityPayment(principal, i.loanRate, n, effBalloon);

    // Only what is paid on day one ties up cash; instalments are paid out of monthly income.
    const deposits = zeros(N + 1);
    deposits[0] = down + i.registrationFee + i.loanSetupFee;

    let balance = principal;
    let interest = 0;
    let monthlyFees = 0;
    for (let m = 1; m <= Math.min(n, N); m++) {
      const int = balance * rate;
      interest += int;
      balance -= pmt - int;
      monthlyFees += i.loanMonthlyFee;
    }
    const notes = [];
    let settled = 0;
    if (n <= N) {
      // A final lump sum (if any) falls due with the last instalment.
      balance = 0;
    } else {
      // Loan outlives the ownership period: the remaining balance is repaid when the car is sold.
      settled = Math.max(0, balance);
      if (settled > residual) {
        notes.push('The outstanding loan at the end of the period is larger than the car is worth.');
      }
    }

    return finish(i, 'loan', {
      vehicle: i.price - residual,
      interest,
      fees: i.registrationFee + i.loanSetupFee + monthlyFees,
      deposits,
      residual,
      monthlyPayment: pmt + i.loanMonthlyFee,
      running: runningCosts(i),
      notes,
      extra: { loanAmount: principal, downPayment: down, balloon: effBalloon, settledAtEnd: settled },
    });
  }

  function privateLease(i) {
    const N = i.months;
    const deposits = zeros(N + 1);
    const included = {
      service: i.leaseInclService,
      tyres: i.leaseInclTyres,
      insurance: i.leaseInclInsurance,
      tax: i.leaseInclTax,
    };
    let vehicle = 0;
    let fees = 0;
    let cycles = 0;
    let excessKm = 0;
    const excessPerYear = Math.max(0, i.kmPerYear - i.leaseKmAllowance);
    for (let start = 0; start < N; start += i.leaseTerm) {
      cycles++;
      const len = Math.min(i.leaseTerm, N - start);
      // Upfront payment and setup fee are paid when each lease starts.
      deposits[start] += i.leaseUpfront + i.leaseSetupFee;
      vehicle += i.leaseUpfront;
      fees += i.leaseSetupFee;
      vehicle += i.leaseMonthly * len;
      const excessKmCycle = excessPerYear * (len / 12);
      const excessCost = excessKmCycle * i.leaseExcessKmFee;
      excessKm += excessKmCycle;
      fees += excessCost + i.leaseEndFee;
    }
    const notes = [];
    if (N % i.leaseTerm !== 0) {
      notes.push(
        'The period is not a multiple of the lease term, so the last lease runs only part of its term but still carries its full upfront and end fees.'
      );
    }
    if (excessPerYear > 0) {
      notes.push('You drive more than the yearly allowance, so excess-km fees are included.');
    }
    return finish(i, 'lease', {
      vehicle,
      fees,
      deposits,
      residual: 0,
      monthlyPayment: i.leaseMonthly,
      running: runningCosts(i, included),
      notes,
      extra: { cycles, excessKm },
    });
  }

  /**
   * Calculate all three ownership options.
   * @param {object} raw  Inputs (see DEFAULTS). Missing or invalid fields fall back to defaults.
   */
  function calculate(raw) {
    const i = normalize(raw);
    const factor = residualFactor(i.months, i.depreciationYear1, i.depreciationYearly);
    const residual = i.price * factor;
    const options = [cashPurchase(i, residual), loanFinancing(i, residual), privateLease(i)];

    const ranked = options.slice().sort((a, b) => a.total - b.total);
    const cheapest = ranked[0];
    const runnerUp = ranked[1];
    const mostExpensive = ranked[2];
    const gap = runnerUp.total - cheapest.total;
    return {
      input: i,
      months: i.months,
      years: i.months / 12,
      totalKm: (i.kmPerYear * i.months) / 12,
      residual,
      residualPct: factor * 100,
      options,
      cheapestId: cheapest.id,
      runnerUpId: runnerUp.id,
      gapToRunnerUp: gap,
      spread: mostExpensive.total - cheapest.total,
      // Within 1 % of each other the ranking is not meaningful.
      tie: cheapest.total > 0 ? gap / cheapest.total < 0.01 : true,
    };
  }

  /**
   * Compare several cars. Period, yearly distance and investment return are shared so cars are
   * priced on the same basis; everything else comes from each car. Options a car has switched
   * off (useCash / useLoan / useLease === false) are left out of the result.
   * @param {{global: object, cars: object[]}} data
   */
  function calculateAll(data) {
    const global = (data && data.global) || {};
    const cars = ((data && data.cars) || []).map((car) => {
      const base = calculate(Object.assign({}, car, global));
      const enabled = { cash: car.useCash !== false, loan: car.useLoan !== false, lease: car.useLease !== false };
      const carName = String(car.name || '').trim() || 'Car';
      const options = base.options
        .filter((o) => enabled[o.id])
        .map((o) => Object.assign({}, o, { key: car.id + ':' + o.id, carId: car.id, carName }));
      return { id: car.id, name: carName, input: base.input, residual: base.residual, residualPct: base.residualPct, options };
    });
    const scenarios = [].concat(...cars.map((c) => c.options));

    // Each car's cheapest enabled option. With two or more cars the comparison is car against
    // car using those; with a single car there is nothing to compare against, so its options are
    // compared with each other instead.
    cars.forEach((c) => {
      c.best = c.options.slice().sort((a, b) => a.total - b.total)[0] || null;
    });
    const carsWithOptions = cars.filter((c) => c.best);
    const comparison = carsWithOptions.length >= 2 ? 'cars' : 'options';
    const entries = comparison === 'cars' ? carsWithOptions.map((c) => c.best) : scenarios;

    const ranked = entries.slice().sort((a, b) => a.total - b.total);
    const cheapest = ranked[0] || null;
    const runnerUp = ranked[1] || null;
    const input = normalize(global);
    return {
      months: input.months,
      years: input.months / 12,
      totalKm: (input.kmPerYear * input.months) / 12,
      cars,
      scenarios, // every enabled car/option combination
      comparison, // 'cars' (each car's cheapest option) or 'options' (one car, its options)
      entries, // what is being compared, in car order
      ranked, // entries, cheapest first
      cheapestKey: cheapest ? cheapest.key : null,
      runnerUpKey: runnerUp ? runnerUp.key : null,
      gapToRunnerUp: runnerUp ? runnerUp.total - cheapest.total : 0,
      spread: cheapest ? ranked[ranked.length - 1].total - cheapest.total : 0,
      // Within 1 % of each other the ranking is not meaningful.
      tie: !!runnerUp && (cheapest.total > 0 ? (runnerUp.total - cheapest.total) / cheapest.total < 0.01 : true),
    };
  }

  return { DEFAULTS, CATEGORIES, OPTIONS, normalize, calculate, calculateAll, residualFactor, annuityPayment, tiedUpMoneyCost };
});
