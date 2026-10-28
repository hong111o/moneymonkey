# Backups

Before each update, the current working version is recorded here. Every entry is a commit on the
`claude/beautiful-ritchie-azk96m` branch on GitHub. History is never rewritten, so any version
below can be restored exactly.

**To roll back:** ask Claude to "go back to backup N". It restores that version's files in a new
commit, so the version you're leaving is kept too. To do it yourself:
`git checkout <commit> -- . && git commit -m "Restore backup N"`.

Your financial data is not affected by rolling back the app: it lives in your browser and your
encrypted sync gist, not in this repository. Older versions simply ignore features they don't know.

| # | Date | Commit | Version before… |
|---|------|--------|-----------------|
| 1 | 2026-10-27 | `2ffbbb7` | Cash Flow analysis: income split bar, month-by-month history, fixed vs flexible costs, loan repayments in cash flow |
| 2 | 2026-10-27 | `e22f471` | Interest from fixed deposits & savers counted as monthly income in Cash Flow |
| 3 | 2026-10-27 | `280b74e` | Property rent counted once as Cash Flow income; stock dividends in passive income and Cash Flow |
| 4 | 2026-10-27 | `cbdc03c` | Regular saver accounts (monthly payments, fixed AER, interest calculated daily and paid monthly) |
| 5 | 2026-10-27 | `374b437` | Planned saving box shows the same total as its breakdown |
| 6 | 2026-10-27 | `cca9781` | Paying a bill from an account without that currency takes it from a balance the account holds |
| 7 | 2026-10-27 | `a6f0491` | Demo data covers every feature |
| 8 | 2026-10-27 | `2d95c21` | Tappable boxes on Stocks, Crypto, Fixed deposits, card, platform and region pages |
| 9 | 2026-10-27 | `a735aec` | Buy & sell for stocks and crypto, realised profit, top-ups, low-balance warnings |
| 10 | 2026-10-27 | `d7137c4` | Top-up in the Buy form chooses the balance and takes the real amounts sent/received; instant warnings |
| 11 | 2026-10-27 | `3a7c74f` | Buy/Sell offers a new broker cash account when the platform has none |
| 12 | 2026-10-27 | `8e121c2` | Confirm buttons on Cash Flow match notes; month-by-month ranges (last month, quarter, 6M, by year) |
| 13 | 2026-10-28 | `82a7cae` | Check-in day setting; due payments and extras inside the check-in; one-offs in Month by month |
| 14 | 2026-10-28 | `b58eba1` | Undo for payment answers and check-ins (5-second Undo + Undo in history); editable regular saver history |
| 15 | 2026-10-28 | `2a9d32a` | Change the paying account in the payment box; tappable Next 30 days with original currencies |
| 16 | 2026-10-28 | `e392042` | Month by month uses each month's own regular income and fixed costs |
| 17 | 2026-10-28 | `f985e0a` | Review fixes & features: chart currency, card debt, history limit, one-off button, regular transfers, Needs attention, search, dividends received, yearly report & CSV, stock splits, saved tests; then design (preview first) |
| 18 | 2026-10-28 | `6935e31` | Design: line icons, colour rules (debts stay red), Cash Flow tabs, quieter messages |
