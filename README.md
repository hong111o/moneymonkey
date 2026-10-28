# 🐒 MoneyMonkey

A personal net-worth tracker that updates live, built for your phone and synced across your devices. Put everything you own and owe in one place, across every bank, broker and country you use, and see your total wealth move in real time.

No server and no dependencies. Your data is stored on your devices and, if you turn on sync, encrypted in your own GitHub account.

## What it tracks

| Section | What you enter | What updates automatically |
|---|---|---|
| **Cash & Bank** | Accounts, e-wallets, cash. **Each account can hold several currencies** (e.g. HKD + USD + GBP in one HSBC One account) | Each balance converted with live FX rates; **Cash by currency** chart shows each currency's total and which accounts hold it |
| **Stocks & ETFs** | Ticker, shares, average cost, optional dividends | Live price, today's change, profit/loss (Finnhub) |
| **Crypto** | CoinGecko coin id, quantity, average cost | Live price, 24h change, profit/loss (CoinGecko) |
| **Fixed Deposits** | Bank, amount, start date, term in **months or an end date**, and either the **rate** or the **total interest** quoted | Interest accrued daily, "from → to · N months · X days left", maturity value. **On maturity, capital + interest move into a cash account automatically** (or the deposit renews, your choice) |
| **Property** | Purchase price and date, then a new valuation weekly or monthly, optional monthly rent | Gain since purchase, valuation history, reminder when an update is due |
| **Other Assets** | Car, gold, MPF / pension, insurance cash value… plus an optional yearly % change | Value drifts automatically (e.g. −15%/yr for a car) |
| **Loans & Debts** | Mortgage, car loan, credit card. Enter the balance yourself, or the loan terms | Balance falls each month on its repayment schedule, with a debt-free date |
| **Cash Flow** | Income, bills, subscriptions and regular saving, weekly to yearly | Monthly/yearly totals, savings rate, upcoming payments |
| **Actual spending** | What you really spent each month, e.g. each **credit card statement** | Cash flow, savings rate and runway use your real 3-month average instead of estimates |
| **Goals** | Target amount and optional date | Progress, and whether you're on track |

### Bank accounts hold cash and fixed deposits

Tap an account in **Cash & Bank** to open its overview: its total, its cash in every currency (tap to update the balances), and the **fixed deposits held in it**. Add a deposit there with **+ Add fixed deposit**. Every fixed deposit belongs to a bank account. When it matures, capital and interest go back into that account (or another account you pick), in the deposit's currency. Fixed deposits still count as their own category on the dashboard, and **Cash & Bank → Fixed deposits → see all** lists every deposit across your accounts.

### Regular savers

For an account where you pay in every month at a fixed rate (e.g. £300 a month at 6.5% AER for a year), open the bank account and tap **+ Regular saver**. Enter:

- the monthly payment and the account it's paid from;
- the start date and term;
- the AER;
- optionally, the payment day and the day interest is paid. Both default to the day you opened it.

How it works:

- **Interest** is calculated daily on the balance and added to the saver once a month, so it earns interest too. The AER already includes that, so the app uses the matching gross rate (6.31% for 6.5% AER). £300 a month for 12 months comes to about £125 interest.
- **Each payment date** a box asks you to confirm: **Pay in** moves the money from the paying account, **Already moved** records it without changing that account, and **Not paid** skips the month. Only confirmed payments count. If the saver started before you added it, earlier payments are assumed made on schedule.
- **In Cash Flow** the monthly payment is planned saving. A "Saving" item for the same payment is counted (and confirmed) once. The interest is averaged over the term as income.
- **At maturity** what's in the saver moves to the account you chose. Edit the saver to see its payments and interest so far.

### Saver accounts

Set an account's type to **Saver (earns interest)** and give each currency line its interest rate. Interest is estimated day by day on top of the balance you last entered. It's added to the live "interest earned today" counter and to passive income, but the balance you typed is never overwritten. When you next update the balance from your bank app, the estimate restarts from there.

### Keeping balances right without surprises

MoneyMonkey never changes a bank balance on its own; you always confirm:

- **Bills, rent and income paid through a bank account:** link the cash-flow item to that account. When its payment date arrives, a box asks you to **Deduct/Add** (you can change the amount first) or mark it **Already included**. Bills ticked "Paid by credit card" never ask, because they're already in your card statement.
- **Card bills:** when you record a month's card spending, optionally pick the account that pays it and the due date. You'll be asked to confirm the payment on that day.
- **Monthly check-in:** on your check-in day (Settings → **Monthly check-in day**, 1–31; in shorter months it falls on the last day), one box does the whole month:
  - **Balances:** every account and currency, pre-filled, so you only correct what changed. The balance you enter is the truth on that day.
  - **Due since your last check-in:** bills, income, card bills and saver payments you haven't confirmed, **ticked as "already in these balances"**. Saving marks them done without taking anything off again, so nothing is counted twice. Untick anything that hasn't gone through yet and you'll be asked about it later.
  - **Card spending** for last month.
  - **Extras (optional):** a bonus or one-off cost last month. It only counts in Cash Flow's month by month and never changes a balance.

  You can choose "Remind me tomorrow" or "Skip this month". The check-in is also on the Cash & Bank page any time.
- **Paying in another currency:** if the paying account has no balance in the bill's currency (e.g. a £ card bill paid from an HKD-only account), the box asks which of the account's balances it came from and fills in the converted amount at today's rate. Change it to what the bank actually took. No negative balance is created in a currency the account doesn't hold.
- **Transfer / exchange** (on Cash & Bank or an account page) moves money between your own accounts and keeps your net worth unchanged. To record a currency exchange at your bank or broker, pick the same account, a different currency, and the amount you actually received (e.g. HK$10,000 → £975 at Trading 212).

The boxes pop up at most once a day per device, and alerts on the dashboard stay until you deal with them.

**Chose the wrong option?**
- **Straight away:** for 5 seconds after any answer or check-in save, an **Undo** button appears. It puts everything back exactly as it was: balances, paid marks and saver payments. Then it asks again. The payment returns to the box, or the check-in reopens with everything you typed still filled in.
- **Later:** every answer ("Deduct", "Already included", "Not paid", and items ticked in a check-in) is listed in the account's **Activity** with an **Undo** button. It reverses any balance change and puts the payment back in the "to confirm" list.
- **Regular saver:** edit the saver to see each month's payment. You can undo an answer, or switch a month between paid and not paid.
- **Card bills** can also be marked paid or unpaid in the statement's form.

### Multi-currency accounts

Add one line per currency inside an account (**+ Add currency** in the form). The account card shows each balance plus the converted total. On the Cash & Bank page, **Cash by currency** shows every currency's total across all accounts as a bar split by account. Tap a currency, or use the currency filter, to list only the accounts holding it. When a fixed deposit matures, the money is added to the matching currency in the payout account. If that account doesn't hold the currency yet, a new balance line is created, with no conversion. Older single-currency accounts are converted automatically.

### Platforms & regions

Every asset and loan has a **Platform** (HSBC HK, ZA Bank, Futu, Monzo, Trading 212, Nationwide…). The **Platforms** page shows cash, investments, deposits and debts per platform. Tap a platform to open its own page, with totals and every account, deposit, holding and loan on it, each tappable to edit. Add new items to that platform from there, or rename it and set its region. You can give each platform a **region** (e.g. Hong Kong, United Kingdom) to see totals by country. Tap a region to see its totals and every platform in it. Regions are guessed from currency until you set them. You can also filter any list by platform, or rename a platform everywhere at once.

### Analysing your cash flow

The Cash Flow page starts with:

- **Where your income goes:** one bar splitting a typical month's income into bank bills, card spending, loan repayments and planned saving, and what's **free** (or how much you're over). Tap any part for the items behind it.
- **Month by month:** income against spending for the months you've recorded card statements, with what was left over. Choose **Last month**, **Quarter** (the default), **6M**, or **By year** (one row per year, covering every recorded month). Income here is your regular monthly income plus any extras that month (from the check-in, or one-off items in Cash Flow). One-off items count only in their own month, never in the regular plan.
- **Fixed costs:** regular commitments (bills, subscriptions, loan repayments, however they're paid) as a share of income. Tap it to compare with your flexible card spending.
- **Interest counts as income,** averaged per month the same way yearly and quarterly bills are (a HK$1,200 yearly bill counts as HK$100/mo). Fixed deposit and saver interest is shown on its own line, separate from regular income. A deposit set to renew keeps its interest, so that part also counts as saving. If you've entered a saver's interest yourself as an income item (linked to that account, with "interest" in its name), it isn't added twice.
- **Rent counts once.** A property's monthly rent is income automatically, both in Cash Flow and in passive income, so you don't need to add it in Cash Flow too. If you already have it there (same currency and amount, monthly), it's counted only once. Tap "Not the same" if that's wrong, or choose in the income item's form whether it's a property's rent.
- **Dividends:** give a stock or ETF its dividend per share or its yield. The yearly amount is averaged per month into income and passive income, and shows on the Stocks page. If it's reinvested (DRIP or an accumulating fund), it also counts as saving.
- **Loan repayments** from Loans & Debts are counted in spending automatically. If a bill is the same payment (same currency and amount), it's counted once. Tap "Not the same" if that's wrong, or link a bill to a loan in its form.
- **Matches the app guessed** (rent, a regular saver payment, a loan repayment entered again as an income, saving or bill item) show as blue notes. Tap **Yes, same** to link them, or **Not the same** to keep them separate. Either way the note goes away, and you can change it later in the item's form.

### Credit cards

On the Cash Flow page, **Credit cards & monthly spending** keeps your cards and their statements together:

- Add each card once: name, bank, billing currency, **payment due day** and the account that usually pays it.
- Record each month's statement (**+ Statement**, or in the monthly check-in). Its due date fills in from the card's due day.
- Unpaid bills appear in **Next 30 days** on the home page (overdue ones at the top) and count as **debt** until you confirm they're paid.
- On the due date you're asked to confirm the payment: it's deducted from the paying account, or just marked paid if no account is linked. Each card's page also has a **Pay** button.
- The Cash Flow page shows its summary boxes, cards & spending and categories first; the full list of income, bills and subscriptions is at the bottom (with a jump link).

### Credit-card spending without double counting

If most of your spending goes on a credit card, record each month's statement total under **Cash Flow → Actual monthly spending** (or the **+** button). Tick **"Paid by credit card"** on fixed bills and subscriptions that are charged to the card. Your monthly spending is then:

> average of your last 3 recorded months + fixed bills **not** paid by card

so things like Netflix on the card aren't counted twice.

On the Cash Flow page, tap any box (income, spending, left over, fixed bills, subscriptions, planned saving) or a category bar to see the items behind it. Tap an item to edit it. When last month's spending hasn't been recorded yet, the dashboard reminds you.

### Buying and selling

Tap **Buy** or **Sell** on a holding, or **Buy / sell** at the top of the Stocks or Crypto page (which can also buy something new). Enter the quantity, price, fee and date, and pick the cash account. The broker's own cash account is picked for you. If the broker doesn't have one yet, the default is **+ New "<broker> cash" account**, created when you save, so the money from a sale has somewhere to go. Choose "None" to only record the shares.

- **Buying:** the cost comes out of the cash account and is added to the average cost, fee included. 10 shares at $100 plus 10 more at $150 gives 20 at an average of $125.
- **Selling:** the money goes into the cash account. The average cost of what's left stays the same. The profit is recorded: 5 sold at $700 with an average cost of $100 makes $3,000. Selling everything can remove the holding.
- **Different currency:** if the cash account holds another currency (e.g. GBP cash buying a USD stock), the amount is filled in at today's rate. Change it to what the broker actually charged.
- **Not enough cash:** pick an account to **top up from** and which of its balances (e.g. HSBC One's HKD). Enter the **amount sent** and the **amount received** at the broker's rate. Leave either blank to use today's rate, or both to top up exactly what's missing. It's recorded as a transfer into the broker's cash first, then the buy.
- **Mistakes show early:** the summary shows the cost in your cash account's currency too, and warns in red as soon as any account would go below zero.
- **Realised profit** this year shows as a box on the Stocks and Crypto pages. Tap it to see each sale. Trades also appear in the cash account's activity.

Net worth only changes by the fee, because the money just moves between the holding and the cash.

**Low-balance warning:** a transfer, buy or confirmed payment that would leave an account below zero in the app asks first. You can update the balance, or go ahead if the real balance is higher than the app shows.

### Cash in your investment accounts

If part of a broker or exchange account is uninvested cash, add it with **+ Cash** in the **By account** section of the Stocks (or Crypto) page. This creates a multi-currency account of type **Brokerage cash** on that platform. Each broker then shows *invested + cash = total*. The cash counts as cash in your net worth and appears under the broker on the Platforms page.

### Dashboard

- Net worth, total assets and liabilities in your base currency. **Tap any summary box with a ›** (assets, liabilities, P&L, cash flow, savings rate, passive income, runway, subscriptions, interest today) to see what's inside it, with links to edit each item
- **Interest earned today**, ticking every second
- Investment P&L, today's market move, net cash flow, savings rate, passive income, emergency runway, subscriptions
- Allocation donut, **by region & platform** breakdown, net-worth history chart (one snapshot per day)
- The next 30 days: bills, pay days, deposit maturities, property updates due
- Alerts: matured deposits that were moved to cash, stale property values, spending to record

### Tappable boxes on other pages

Boxes with a › open what's behind them:

- **Stocks / Crypto:** profit/loss (biggest gains first), today's moves (biggest first), uninvested cash per broker, and dividends per year (paid out vs reinvested).
- **Fixed deposits:** interest so far per deposit, and every maturity date in order.
- **Card page:** "Owed now" lists the unpaid bills, each with a Pay button.
- **Platform and region pages:** cash, fixed deposits, investments, property and debts, item by item.

Boxes that would only repeat the list underneath (like "Total") stay as they are.

## Use it on your phone (and every other device)

### 1. Host it (free) with GitHub Pages

Repo → **Settings → Pages** → *Deploy from a branch* → pick the branch and `/ (root)` → Save. After a minute it's live at `https://<your-username>.github.io/moneymonkey/`.

> GitHub Pages needs a **public** repo on a free plan. That's fine: the repo only contains the app's code, never your financial data.

### 2. Install it like an app

- **iPhone:** open the link in Safari → Share → **Add to Home Screen**
- **Android:** open it in Chrome → menu → **Install app**

It opens full-screen with a bottom tab bar and works offline.

### 3. Turn on sync

In **Settings & Sync → Set up sync**:

1. [Create a GitHub token](https://github.com/settings/tokens/new?scopes=gist&description=MoneyMonkey%20sync) with only the **gist** box ticked (it's pre-selected).
2. Paste it and choose a passphrase.
3. Do the same on your other devices with the **same passphrase**. Your data appears automatically.

How it works:
- Your data is **encrypted on the device** (AES-256-GCM, key derived from your passphrase with PBKDF2-SHA256, 310,000 rounds) and stored in a **secret gist** in your GitHub account. GitHub only ever sees scrambled text, and the passphrase never leaves your devices.
- Sync runs when you change something, when you open the app, and every 2 minutes. Each device keeps a full copy, so it works offline and catches up later.
- Edits are merged item by item. If you change your HSBC balance on your phone and add a stock on your laptop, both changes are kept. If the same item is edited on two devices, the later edit wins.
- **If you forget the passphrase, nobody (including GitHub) can decrypt the synced copy.** Your devices still have their own copies, so export a backup now and then.
- The token and passphrase are stored only on the device (you can choose not to remember the passphrase). They are never included in backups or in the gist.

## Live prices

- **Stocks:** paste a free [Finnhub API key](https://finnhub.io/register) in Settings (it syncs to your other devices). The free plan mainly covers US listings. For tickers it doesn't cover (e.g. many `.HK` or `.L` listings), set **Price source → Manual price** and update the price yourself.
- **Crypto:** CoinGecko ids, such as `bitcoin` or `ethereum`. No key needed.
- **Exchange rates:** open.er-api.com, with frankfurter.app as a fallback. No key needed.

Prices refresh every 60 seconds by default and whenever you return to the app.

## How the numbers are calculated

- **Fixed deposits:** simple interest `P × r × days/365`, or compound `P × (1 + r/n)^(n × years)`, accrued daily and capped at maturity. If you enter the total interest instead of a rate, the matching annual rate is solved for. At maturity, "move to cash" adds the maturity value to the chosen account (converting currency if needed), or to an automatic "‹bank› cash" account. "Renew" starts a new deposit with the matured amount on the same term and rate.
- **Amortizing loans:** standard annuity balance after *k* monthly payments, `B = P(1+i)^k − PMT((1+i)^k − 1)/i`.
- **Cash flow:** weekly × 52/12, every-2-weeks × 26/12, quarterly ÷ 3, yearly ÷ 12.
- **Spending:** recorded monthly spending (3 most recent months averaged) + fixed bills not paid by card. Without any records, the estimate from your bills is used.
- **Savings rate:** (income − spending) ÷ income.

## Development

```
npm test        # unit tests: money math, deposits, platforms, spending, sync merge & encryption
npm start       # serve on http://localhost:8080
```

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `css/styles.css` | Styles: light/dark tokens, phone layout |
| `js/calc.js` | Pure calculations (unit-tested) |
| `js/sync.js` | Encryption, item-level merge, GitHub Gist API |
| `js/prices.js` | FX, stock and crypto price fetching |
| `js/charts.js` | Dependency-free SVG charts |
| `js/app.js` | UI, state, forms, live updates, sync loop |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app + offline support |
| `tests/` | Tests |
