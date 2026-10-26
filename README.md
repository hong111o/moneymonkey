# 🐒 MoneyMonkey

A personal net-worth tracker that updates live. Put everything you own and owe in one place and see your total wealth move in real time.

No sign-up, no server, no dependencies. Your data stays in your browser.

## What it tracks

| Section | What you enter | What updates automatically |
|---|---|---|
| **Cash & Bank** | Accounts, e-wallets, cash, in any currency | Converted to your base currency with live FX rates |
| **Stocks & ETFs** | Ticker, shares, average cost | Live price, today's change, profit/loss (Finnhub) |
| **Crypto** | CoinGecko coin id, quantity, average cost | Live price, 24h change, profit/loss (CoinGecko) |
| **Fixed Deposits** | Principal, start date, term, and either the **rate** or the **total interest** quoted by the bank | Interest accrued to date, value today, maturity value, days left, interest earned per day |
| **Property** | Purchase price and date, then a new valuation weekly/monthly | Gain since purchase, valuation history sparkline, reminder when an update is due |
| **Other Assets** | Car, gold, pension, insurance cash value, money owed to you… plus an optional yearly % change | Value drifts automatically (e.g. −15%/yr car depreciation) |
| **Loans & Debts** | Mortgage, car loan, credit card. Enter the balance yourself, or the loan terms | Balance falls each month on its repayment schedule, with a debt-free date |
| **Cash Flow** | Income, expenses, subscriptions, regular saving, with weekly/monthly/yearly frequency | Monthly and yearly totals, savings rate, spending by category, upcoming payments |
| **Goals** | Target amount and optional date | Progress, and whether you're on track at your current monthly surplus |

### Dashboard

- **Net worth**, total assets and total liabilities in your base currency
- **Interest earned today**, ticking every second from your fixed deposits
- Investment P&L, today's market move, monthly net cash flow, savings rate
- Passive income (deposit interest + rent), emergency runway (months of spending covered by cash), yearly subscription cost
- Asset allocation donut and a **net-worth history** chart (a snapshot is saved every day you open the app)
- The next 30 days: bills, pay days, subscription renewals, deposit maturities, property updates due
- Alerts for matured deposits, stale property values, missing exchange rates or API keys

### Extras

- Multi-currency with a configurable base currency
- **Hide amounts** privacy mode for when you're in public
- Light and dark themes, and layouts that work on a phone
- JSON backup/restore (to move between devices) and CSV export
- Demo data to explore before entering your own

## Getting started

1. **Open it.** Either:
   - double-click `index.html`, or
   - run `npm start` (or `python3 -m http.server 8080`) and visit http://localhost:8080, or
   - host it free on **GitHub Pages**: repo → Settings → Pages → deploy from branch → root. Then open it on your phone too.
2. **Settings:** set your base currency (e.g. `HKD`, `SGD`, `USD`).
3. **Live stock prices:** get a free API key at [finnhub.io/register](https://finnhub.io/register) and paste it in Settings. Crypto prices and exchange rates need no key.
4. Add your accounts, holdings, deposits and so on. Prices refresh every 60 seconds by default (adjustable), and whenever you come back to the tab.

### Ticker tips

- US stocks: `AAPL`, `VOO`. Other exchanges use a suffix, depending on what your Finnhub plan covers (e.g. `0700.HK`, `D05.SI`, `VOD.L`). The free plan mainly covers US listings.
- If a ticker isn't covered, set its **Price source** to *Manual price* and update the price yourself.
- Crypto uses CoinGecko ids, which you can find in the coin's URL: `bitcoin`, `ethereum`, `solana`.

## Privacy & data

- Everything is stored in your browser's `localStorage` on this device only. **Export a backup regularly** from Settings; clearing browser data erases it.
- The only outgoing requests are ticker symbols to Finnhub, coin ids to CoinGecko, and your base currency to the exchange-rate API (open.er-api.com, with frankfurter.app as fallback).

## How the numbers are calculated

- **Fixed deposits:** simple interest `P × r × days/365`, or compound `P × (1 + r/n)^(n × years)` for monthly/quarterly/semi-annual/annual compounding, accrued daily and capped at maturity. If you enter the total interest instead of a rate, the matching annual rate is solved for.
- **Amortizing loans:** standard annuity balance after *k* monthly payments, `B = P(1+i)^k − PMT((1+i)^k − 1)/i`, assuming the first payment is one month after the start date.
- **Cash flow:** weekly × 52/12, every-2-weeks × 26/12, quarterly ÷ 3, yearly ÷ 12. One-off items appear in "upcoming" but not in monthly totals.
- **Savings rate:** (income − expenses − subscriptions) ÷ income.

## Development

```
npm test        # unit tests for all the money math (Node 18+)
npm start       # serve locally
```

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `css/styles.css` | Styles, light/dark tokens |
| `js/calc.js` | Pure calculation functions (unit-tested) |
| `js/prices.js` | FX, stock and crypto price fetching |
| `js/charts.js` | Dependency-free SVG charts |
| `js/app.js` | UI, state, forms, live-update loop |
| `tests/calc.test.js` | Tests |
