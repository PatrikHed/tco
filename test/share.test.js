const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExport, parseImport, MAX_CARS } = require('../src/share.js');
const { calculateAll, DEFAULTS } = require('../src/calc.js');

const CURRENCIES = ['SEK', 'EUR'];
const state = () => ({
  currency: 'EUR',
  global: { months: 48, kmPerYear: 12000, savingsRate: 6 },
  cars: [
    { id: 'a', name: 'Volvo', open: false, price: 450000, useLoan: false, fuel: 'diesel' },
    { id: 'b', name: ' Polestar  2 ', open: true, price: '520000', leaseMonthly: '5 999', useCash: false },
  ],
});

test('export contains the settings and cleaned cars, without ids or UI state', () => {
  const out = buildExport(state(), new Date('2026-01-02T03:04:05Z'));
  assert.equal(out.format, 'tco-calculator');
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(out.currency, 'EUR');
  assert.deepEqual(out.global, { months: 48, kmPerYear: 12000, savingsRate: 6 });
  assert.equal(out.cars.length, 2);
  for (const car of out.cars) {
    assert.ok(!('id' in car) && !('open' in car));
    assert.ok(!('months' in car) && !('savingsRate' in car));
    assert.equal(typeof car.price, 'number');
  }
  assert.equal(out.cars[1].name, 'Polestar 2');
  assert.equal(out.cars[1].price, 520000);
  assert.equal(out.cars[0].useLoan, false);
  assert.equal(out.cars[0].fuel, 'diesel');
});

test('what is exported imports back to the same comparison', () => {
  const s = state();
  const text = JSON.stringify(buildExport(s));
  const res = parseImport(text, { currencies: CURRENCIES });
  assert.equal(res.ok, true);
  assert.equal(res.currency, 'EUR');
  assert.deepEqual(res.global, { months: 48, kmPerYear: 12000, savingsRate: 6 });
  const before = calculateAll({ global: s.global, cars: s.cars });
  const after = calculateAll({ global: res.global, cars: res.cars.map((c, i) => ({ ...c, id: 'x' + i })) });
  assert.equal(after.scenarios.length, before.scenarios.length);
  before.scenarios.forEach((o, i) => {
    assert.equal(after.scenarios[i].id, o.id);
    assert.ok(Math.abs(after.scenarios[i].total - o.total) < 0.01);
  });
});

test('imported values are coerced and clamped, unknown fields dropped', () => {
  const text = JSON.stringify({
    cars: [{
      name: 'X', price: -5, months: 9999, loanRate: 'abc', fuel: 'steam', registrationFee: '1 500',
      evil: '<script>', __proto__: { polluted: true }, id: 'keepme', open: true,
    }],
  });
  const res = parseImport(text, { currencies: CURRENCIES });
  assert.equal(res.ok, true);
  const car = res.cars[0];
  assert.equal(car.price, 0);
  assert.equal(car.loanRate, DEFAULTS.loanRate);
  assert.equal(car.fuel, DEFAULTS.fuel);
  assert.ok(!('evil' in car) && !('id' in car) && !('open' in car) && !('months' in car));
  assert.equal({}.polluted, undefined);
});

test('names are trimmed, limited in length and fall back to Car N', () => {
  const res = parseImport(JSON.stringify({ cars: [{ name: 'a'.repeat(100) }, {}, { name: '   ' }, { name: 5 }] }));
  assert.equal(res.cars[0].name.length, 40);
  assert.deepEqual(res.cars.slice(1).map((c) => c.name), ['Car 2', 'Car 3', 'Car 4']);
});

test('a bare array of cars is accepted, non-object entries are skipped and counted', () => {
  const res = parseImport(JSON.stringify([{ name: 'A' }, 5, null, 'x', { name: 'B' }]));
  assert.equal(res.ok, true);
  assert.deepEqual(res.cars.map((c) => c.name), ['A', 'B']);
  assert.equal(res.skipped, 3);
  assert.equal(res.global, null);
  assert.equal(res.currency, null);
});

test('unsupported currencies are ignored; missing options default to enabled', () => {
  const res = parseImport(JSON.stringify({ currency: 'XXX', cars: [{ name: 'A', useCash: false }] }), { currencies: CURRENCIES });
  assert.equal(res.currency, null);
  assert.deepEqual([res.cars[0].useCash, res.cars[0].useLoan, res.cars[0].useLease], [false, true, true]);
});

test('bad files give a clear error instead of throwing', () => {
  const err = (text) => { const r = parseImport(text, { currencies: CURRENCIES }); assert.equal(r.ok, false); return r.error; };
  assert.match(err(''), /empty/);
  assert.match(err('   '), /empty/);
  assert.match(err('{not json'), /valid JSON/);
  assert.match(err('42'), /any cars/);
  assert.match(err('null'), /any cars/);
  assert.match(err('{"cars": []}'), /any cars/);
  assert.match(err('{"cars": [1, 2]}'), /any cars/);
  assert.match(err('{"cars": "nope"}'), /any cars/);
  assert.match(err('{"format":"something-else","cars":[{}]}'), /not exported/);
  assert.match(err('{"version": 99, "cars":[{}]}'), /newer version/);
  assert.match(err(JSON.stringify({ cars: new Array(MAX_CARS + 1).fill({}) })), /at most/);
  assert.match(err('x'.repeat(3 * 1024 * 1024)), /too large/);
  assert.equal(parseImport(undefined).ok, false);
});
