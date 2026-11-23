/*
 * Import / export of the cars in the comparison. Pure functions, no DOM access.
 * Works as a classic <script> (window.TCOShare) and as a CommonJS module (for tests).
 *
 * File format (JSON):
 *   { "format": "tco-calculator", "version": 1, "exportedAt": "...",
 *     "currency": "SEK", "global": { months, kmPerYear, savingsRate }, "cars": [ { name, price, ... } ] }
 * Everything read from a file is untrusted: each value is coerced and clamped by TCO.normalize,
 * unknown fields are dropped, and cars always get fresh ids in the app.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.TCOShare = factory(root.TCO);
})(typeof self !== 'undefined' ? self : this, function (TCO) {
  'use strict';

  const FORMAT = 'tco-calculator';
  const VERSION = 1;
  const MAX_CARS = 50;
  const MAX_CHARS = 2 * 1024 * 1024;
  const NAME_MAX = 40;

  // Shared by every car; everything else belongs to one car.
  const GLOBAL_KEYS = ['months', 'kmPerYear', 'savingsRate'];
  const FLAGS = ['useCash', 'useLoan', 'useLease'];

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** A car as stored in a file: validated numbers, no ids or UI state. */
  function cleanCar(raw, fallbackName) {
    const src = isObject(raw) ? raw : {};
    const n = TCO.normalize(src);
    const car = {};
    Object.keys(n).forEach((k) => { if (!GLOBAL_KEYS.includes(k)) car[k] = n[k]; });
    FLAGS.forEach((f) => { car[f] = src[f] !== false; });
    const name = typeof src.name === 'string' ? src.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
    car.name = name || fallbackName;
    return car;
  }

  function cleanGlobal(raw) {
    const n = TCO.normalize(isObject(raw) ? raw : {});
    const g = {};
    GLOBAL_KEYS.forEach((k) => (g[k] = n[k]));
    return g;
  }

  /** Build the object to save: `state` is { currency, global, cars }. */
  function buildExport(state, now) {
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: (now || new Date()).toISOString(),
      currency: state.currency,
      global: cleanGlobal(state.global),
      cars: state.cars.map((c, i) => cleanCar(c, `Car ${i + 1}`)),
    };
  }

  /**
   * Read the text of an exported file.
   * @param {string} text
   * @param {{currencies?: string[]}} [opts]  Currencies the app supports.
   * @returns {{ok: true, cars: object[], skipped: number, global: object|null, currency: string|null}
   *          | {ok: false, error: string}}
   */
  function parseImport(text, opts) {
    const currencies = (opts && opts.currencies) || [];
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
    if (text.length > MAX_CHARS) return { ok: false, error: 'The file is too large to be a car export.' };
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'The file is not valid JSON.' };
    }
    // A bare list of cars is accepted as well as the full export.
    const doc = Array.isArray(data) ? { cars: data } : data;
    if (!isObject(doc)) return { ok: false, error: 'The file does not contain any cars.' };
    if (doc.format !== undefined && doc.format !== FORMAT) {
      return { ok: false, error: 'This file was not exported from the TCO calculator.' };
    }
    if (typeof doc.version === 'number' && doc.version > VERSION) {
      return { ok: false, error: 'This file was made by a newer version of the calculator.' };
    }
    if (!Array.isArray(doc.cars) || doc.cars.length === 0) {
      return { ok: false, error: 'The file does not contain any cars.' };
    }
    if (doc.cars.length > MAX_CARS) {
      return { ok: false, error: `The file has ${doc.cars.length} cars; at most ${MAX_CARS} can be imported.` };
    }
    const cars = [];
    let skipped = 0;
    doc.cars.forEach((raw) => {
      if (!isObject(raw)) { skipped++; return; }
      cars.push(cleanCar(raw, `Car ${cars.length + 1}`));
    });
    if (!cars.length) return { ok: false, error: 'The file does not contain any cars.' };
    return {
      ok: true,
      cars,
      skipped,
      global: isObject(doc.global) ? cleanGlobal(doc.global) : null,
      currency: typeof doc.currency === 'string' && currencies.includes(doc.currency) ? doc.currency : null,
    };
  }

  return { FORMAT, VERSION, MAX_CARS, NAME_MAX, GLOBAL_KEYS, FLAGS, cleanCar, cleanGlobal, buildExport, parseImport };
});
