<img src="assets/icon.svg" width="64" height="64" alt="">

# TCO

A total cost of ownership calculator for cars. It compares the same car bought three ways:

- **Cash purchase** – pay the full price up front.
- **Loan financing** – down payment plus an annuity loan (optional balloon, setup and monthly fees).
- **Private leasing** – monthly fee, upfront payment, included distance, excess-km fees, and which running costs the lease covers.

Each option is priced over the same ownership period and distance, and the result shows the total, cost per month, cost per km, cash needed on day one, and a breakdown by cost type: car cost (depreciation or lease payments), loan interest, lost investment return, fuel/energy, insurance & tax, service & tyres, and fees.

**Lost investment return** is the alternative cost of the cash you pay up front: what it would have earned if it had been invested instead, assumed to be **8% a year** (editable, 0 turns it off). It applies only to money paid at the start — the full price when buying for cash, the down payment for a loan, the upfront payment for a lease, plus start fees. Monthly payments are not charged. This is what makes cash, loan and lease comparable.

## Multiple cars

Add as many cars as you like with **Add car**; each car has its own price, depreciation, running costs, loan terms and lease terms, and can be renamed, duplicated, collapsed or removed. The ownership period, yearly distance and investment return are shared so every car is compared on the same basis.

Use the **Compare** chips on each car to switch Cash, Loan and Lease on or off. Options that are off drop out of the totals, chart and table, and their input sections are greyed out.

With two or more cars, the main comparison ranks **cars** against each other, each represented by its cheapest enabled option, to find the best deal. The full list of options per car is under **All options per car**. With a single car, its own options are compared instead.

## Import and export

**Export** saves your cars to a `tco-cars-<date>.json` file, together with the shared settings (period, distance, investment return) and the currency. **Import…** reads such a file and lets you either **add** its cars to your current ones or **replace** your cars (replacing also applies the file's shared settings and currency).

Imported values are validated: numbers are clamped to sensible ranges, unknown fields are ignored, and a file that isn't a valid export is rejected with an explanation. The logic is in `src/share.js`.

## Run it

No build step and no dependencies. Open `index.html` in a browser. Inputs are saved in the browser's local storage.

## Tests

```sh
npm test
```

The calculation engine lives in `src/calc.js` (pure functions, no DOM) and is covered by `test/calc.test.js`.

## Model assumptions

- Upfront payments happen in month 0, monthly payments at the end of each month, and the car is sold (or the loan settled) at the end of the period.
- Depreciation: linear over year 1, then a fixed percentage of the remaining value per year.
- If the loan outlives the ownership period, the remaining balance is repaid from the sale. If it is shorter, a balloon is paid with the last instalment.
- If the period is longer than the lease term, the lease is renewed on the same terms, including its upfront and end fees.
- Defaults are example values in SEK; replace them with real quotes.

Created in [T3 Code](https://t3.codes).
