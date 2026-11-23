const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, annuityPayment, residualFactor, DEFAULTS } = require('../src/calc.js');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

// Inputs with everything switched off, so only the car itself counts.
const bare = {
  price: 200000, registrationFee: 0, months: 36, kmPerYear: 0, savingsRate: 0,
  consumption: 0, insurance: 0, tax: 0, service: 0, tyres: 0, otherMonthly: 0,
  loanSetupFee: 0, loanMonthlyFee: 0, loanRate: 0, loanDownPct: 0, loanBalloonPct: 0, loanTerm: 36,
  leaseMonthly: 0, leaseUpfront: 0, leaseSetupFee: 0, leaseEndFee: 0,
};
const get = (res, id) => res.options.find((o) => o.id === id);

test('annuity payment matches a known value', () => {
  close(annuityPayment(100000, 6, 12, 0), 8606.64, 0.01);
  close(annuityPayment(120000, 0, 12, 0), 10000);
});

test('annuity with balloon leaves exactly the balloon owed', () => {
  const p = annuityPayment(100000, 6, 24, 30000);
  const r = 0.06 / 12;
  let bal = 100000;
  for (let m = 0; m < 24; m++) bal = bal * (1 + r) - p;
  close(bal, 30000, 0.01);
});

test('residual value: linear in year 1, compounding afterwards', () => {
  close(residualFactor(12, 20, 10), 0.8);
  close(residualFactor(6, 20, 10), 0.9);
  close(residualFactor(36, 20, 10), 0.8 * 0.9 * 0.9);
  close(residualFactor(24, 0, 0), 1);
});

test('cash purchase with no extras costs exactly the depreciation', () => {
  const res = calculate(bare);
  close(get(res, 'cash').total, 200000 - res.residual);
});

test('zero-rate, zero-fee loan costs the same as cash', () => {
  const res = calculate(bare);
  close(get(res, 'loan').total, get(res, 'cash').total);
  close(get(res, 'loan').categories.interest, 0);
});

test('loan: total = depreciation + interest + fees (principal is not a cost)', () => {
  const res = calculate({ ...bare, loanRate: 8, loanDownPct: 10, loanSetupFee: 500, loanMonthlyFee: 30, registrationFee: 2000 });
  const loan = get(res, 'loan');
  assert.ok(loan.categories.interest > 0);
  close(loan.total, 200000 - res.residual + loan.categories.interest + 500 + 30 * 36 + 2000);
});

test('loan longer than the period settles the remaining balance at the end', () => {
  const res = calculate({ ...bare, months: 24, loanTerm: 60, loanRate: 6 });
  const loan = get(res, 'loan');
  assert.ok(loan.settledAtEnd > 0 && loan.settledAtEnd < 200000);
  // Interest only counts for the 24 months actually owned.
  const full = calculate({ ...bare, months: 60, loanTerm: 60, loanRate: 6 });
  assert.ok(loan.categories.interest < get(full, 'loan').categories.interest);
});

test('balloon payment is paid when a shorter loan ends', () => {
  const res = calculate({ ...bare, loanTerm: 24, loanRate: 5, loanBalloonPct: 30 });
  const loan = get(res, 'loan');
  close(loan.balloon, 60000);
  close(loan.total, 200000 - res.residual + loan.categories.interest);
});

test('tied-up money: cash pays everything on day one, so it costs the most capital', () => {
  const res = calculate({ ...bare, savingsRate: 4, loanDownPct: 20 });
  const [cash, loan, lease] = res.options;
  assert.ok(cash.categories.capital > loan.categories.capital);
  assert.equal(lease.categories.capital, 0); // lease payments are 0 in `bare`
  // 200k kept for 3 years at 4 % compounded
  close(cash.categories.capital, 200000 * (Math.pow(1.04, 3) - 1), 1);
});

test('lease totals: payments, upfront and fees', () => {
  const res = calculate({ ...bare, leaseMonthly: 4000, leaseUpfront: 10000, leaseSetupFee: 2000, leaseEndFee: 1500 });
  const lease = get(res, 'lease');
  assert.equal(lease.cycles, 1);
  close(lease.categories.vehicle, 36 * 4000 + 10000);
  close(lease.categories.fees, 3500);
  close(lease.total, 36 * 4000 + 10000 + 3500);
});

test('lease: excess km fee only applies above the allowance', () => {
  const base = { ...bare, leaseMonthly: 1000, kmPerYear: 15000, leaseKmAllowance: 10000, leaseExcessKmFee: 2 };
  close(get(calculate(base), 'lease').categories.fees, 5000 * 3 * 2);
  close(get(calculate({ ...base, leaseKmAllowance: 20000 }), 'lease').categories.fees, 0);
});

test('lease repeats back-to-back when the period is longer than the term', () => {
  const res = calculate({ ...bare, months: 60, leaseTerm: 36, leaseMonthly: 1000, leaseUpfront: 5000, leaseSetupFee: 1000 });
  const lease = get(res, 'lease');
  assert.equal(lease.cycles, 2);
  close(lease.categories.vehicle, 60 * 1000 + 2 * 5000);
  close(lease.categories.fees, 2 * 1000);
  assert.ok(lease.notes.length > 0);
});

test('lease inclusions remove those running costs from the lease only', () => {
  const inputs = { ...bare, insurance: 9000, tax: 1200, service: 4000, tyres: 2000 };
  const all = calculate({ ...inputs, leaseInclInsurance: true, leaseInclTax: true, leaseInclService: true, leaseInclTyres: true });
  const none = calculate({ ...inputs, leaseInclInsurance: false, leaseInclTax: false, leaseInclService: false, leaseInclTyres: false });
  const lAll = get(all, 'lease').categories;
  const lNone = get(none, 'lease').categories;
  assert.equal(lAll.insuranceTax + lAll.serviceTyres, 0);
  close(lNone.insuranceTax, 3 * (9000 + 1200));
  close(lNone.serviceTyres, 3 * (4000 + 2000));
  close(get(all, 'cash').total, get(none, 'cash').total);
});

test('energy cost scales with distance, consumption and price', () => {
  const res = calculate({ ...bare, kmPerYear: 20000, consumption: 5, energyPrice: 20, months: 24 });
  close(get(res, 'cash').categories.energy, (40000 / 100) * 5 * 20);
});

test('per month and per km derive from the total', () => {
  const res = calculate({ ...DEFAULTS, months: 48, kmPerYear: 12000 });
  for (const o of res.options) {
    close(o.perMonth, o.total / 48);
    close(o.perKm, o.total / 48000);
  }
});

test('invalid or empty input falls back safely', () => {
  const res = calculate({ price: '', months: 'abc', loanRate: -5, kmPerYear: '12,5' });
  assert.equal(res.months, DEFAULTS.months);
  for (const o of res.options) assert.ok(Number.isFinite(o.total) && o.total >= 0);
});

test('zero distance does not divide by zero', () => {
  const res = calculate({ ...DEFAULTS, kmPerYear: 0 });
  for (const o of res.options) assert.equal(o.perKm, 0);
});

test('cheapest option is identified and ties are detected', () => {
  const res = calculate(DEFAULTS);
  const min = Math.min(...res.options.map((o) => o.total));
  assert.equal(get(res, res.cheapestId).total, min);
  assert.equal(calculate(bare).tie, true); // cash and loan identical, lease free
});

/* ---------- multiple cars ---------- */
const { calculateAll } = require('../src/calc.js');

test('calculateAll prices every car on the shared period, distance and savings rate', () => {
  const res = calculateAll({
    global: { months: 48, kmPerYear: 12000, savingsRate: 2 },
    cars: [{ id: 'a', name: 'A', price: 300000 }, { id: 'b', name: 'B', price: 500000 }],
  });
  assert.equal(res.months, 48);
  assert.equal(res.cars.length, 2);
  for (const o of res.scenarios) close(o.perMonth, o.total / 48);
  assert.ok(res.cars[1].residual > res.cars[0].residual);
});

test('options switched off per car are left out', () => {
  const res = calculateAll({
    global: {},
    cars: [
      { id: 'a', name: 'A', useLoan: false },
      { id: 'b', name: 'B', useCash: false, useLease: false },
      { id: 'c', name: 'C', useCash: false, useLoan: false, useLease: false },
    ],
  });
  assert.deepEqual(res.cars[0].options.map((o) => o.id), ['cash', 'lease']);
  assert.deepEqual(res.cars[1].options.map((o) => o.id), ['loan']);
  assert.deepEqual(res.cars[2].options, []);
  assert.equal(res.scenarios.length, 3);
  assert.ok(res.scenarios.every((o) => o.key === o.carId + ':' + o.id));
});

test('with several cars, each car is represented by its cheapest option and cars are ranked', () => {
  const res = calculateAll({
    global: {},
    cars: [{ id: 'cheap', name: 'Cheap', price: 150000 }, { id: 'dear', name: 'Dear', price: 600000 }],
  });
  assert.equal(res.comparison, 'cars');
  assert.equal(res.entries.length, 2);
  for (const c of res.cars) {
    assert.equal(c.best.total, Math.min(...c.options.map((o) => o.total)));
    assert.ok(res.entries.includes(c.best));
  }
  assert.deepEqual(res.entries.map((o) => o.carId), ['cheap', 'dear']);
  const [first, second] = res.ranked;
  assert.equal(res.cheapestKey, first.key);
  assert.equal(res.runnerUpKey, second.key);
  assert.notEqual(first.carId, second.carId); // the runner-up is another car, not the same car's 2nd option
  close(res.gapToRunnerUp, second.total - first.total);
  close(res.spread, res.ranked[1].total - first.total);
  assert.equal(first.carId, 'cheap');
});

test("a car's switched-off option is never its representative, even if it would be cheapest", () => {
  const base = { global: {}, cars: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', price: 500000 }] };
  const all = calculateAll(base);
  const bestOfA = all.cars[0].best;
  const without = calculateAll({ ...base, cars: [{ ...base.cars[0], [{ cash: 'useCash', loan: 'useLoan', lease: 'useLease' }[bestOfA.id]]: false }, base.cars[1]] });
  assert.notEqual(without.cars[0].best.id, bestOfA.id);
  assert.ok(without.cars[0].options.every((o) => o.id !== bestOfA.id));
});

test('a single car compares its own options', () => {
  const res = calculateAll({ global: {}, cars: [{ id: 'a', name: 'A' }] });
  assert.equal(res.comparison, 'options');
  assert.equal(res.entries.length, 3);
  assert.equal(res.ranked[0].key, res.cheapestKey);
});

test('a second car with no enabled options does not count as a car to compare', () => {
  const res = calculateAll({
    global: {},
    cars: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', useCash: false, useLoan: false, useLease: false }],
  });
  assert.equal(res.comparison, 'options');
  assert.equal(res.cars[1].best, null);
});

test('a car with the same name and settings as another still gets its own keys', () => {
  const res = calculateAll({ global: {}, cars: [{ id: 'x', name: 'Same' }, { id: 'y', name: 'Same' }] });
  assert.equal(new Set(res.scenarios.map((o) => o.key)).size, 6);
});

test('no cars or no enabled options gives an empty comparison without errors', () => {
  const none = calculateAll({ global: {}, cars: [] });
  assert.equal(none.scenarios.length, 0);
  assert.equal(none.cheapestKey, null);
  const off = calculateAll({ global: {}, cars: [{ id: 'a', useCash: false, useLoan: false, useLease: false }] });
  assert.equal(off.scenarios.length, 0);
  assert.equal(off.tie, false);
});

test('a single enabled option has no runner-up and is not a tie', () => {
  const res = calculateAll({ global: {}, cars: [{ id: 'a', useLoan: false, useLease: false }] });
  assert.equal(res.scenarios.length, 1);
  assert.equal(res.runnerUpKey, null);
  assert.equal(res.tie, false);
});

test('the alternative return on cash defaults to 8 % a year', () => {
  assert.equal(DEFAULTS.savingsRate, 8);
  const res = calculate({ ...bare, savingsRate: undefined });
  // 200k paid on day one, kept out of an 8 % investment for 3 years
  close(get(res, 'cash').categories.capital, 200000 * (Math.pow(1.08, 3) - 1), 1);
});

test('upfront fees and deposits are charged the lost return too', () => {
  const res = calculate({ ...bare, savingsRate: 8, registrationFee: 10000, loanSetupFee: 2000, leaseUpfront: 20000, leaseMonthly: 0 });
  const f = Math.pow(1.08, 3) - 1;
  close(get(res, 'cash').categories.capital, 210000 * f, 1);
  close(get(res, 'lease').categories.capital, 20000 * f, 1);
  // loan: 0 % down, so only the registration and setup fees are paid up front
  close(get(res, 'loan').categories.capital, 12000 * f, 1);
});

test('only the down payment (not the instalments) is charged for a loan', () => {
  const res = calculate({ ...bare, savingsRate: 8, loanDownPct: 25, loanRate: 6, loanMonthlyFee: 50 });
  const loan = get(res, 'loan');
  close(loan.categories.capital, 50000 * (Math.pow(1.08, 3) - 1), 1);
  assert.ok(loan.monthlyPayment > 0);
  // more months of instalments must not change the lost return
  const longer = calculate({ ...bare, savingsRate: 8, loanDownPct: 25, loanRate: 6, loanTerm: 60 });
  close(get(longer, 'loan').categories.capital, loan.categories.capital, 0.01);
});

test('lease monthly fees, excess km and end fees are not charged lost return', () => {
  const res = calculate({ ...bare, savingsRate: 8, leaseMonthly: 5000, leaseUpfront: 0, leaseSetupFee: 0, leaseEndFee: 4000, kmPerYear: 20000, leaseKmAllowance: 10000, leaseExcessKmFee: 2 });
  assert.equal(get(res, 'lease').categories.capital, 0);
});

test('a renewed lease charges its upfront payment from the month it is paid', () => {
  const res = calculate({ ...bare, savingsRate: 8, months: 60, leaseTerm: 36, leaseUpfront: 10000 });
  const rm = Math.pow(1.08, 1 / 12) - 1;
  const expected = 10000 * (Math.pow(1 + rm, 60) - 1) + 10000 * (Math.pow(1 + rm, 24) - 1);
  close(get(res, 'lease').categories.capital, expected, 0.5);
});

test('a loan that outlives the period or has a balloon adds no extra lost return', () => {
  const base = { ...bare, savingsRate: 8, loanDownPct: 10, loanRate: 5 };
  const plain = get(calculate({ ...base, loanTerm: 36 }), 'loan').categories.capital;
  close(get(calculate({ ...base, loanTerm: 84 }), 'loan').categories.capital, plain, 0.01);
  close(get(calculate({ ...base, loanTerm: 24, loanBalloonPct: 30 }), 'loan').categories.capital, plain, 0.01);
});
