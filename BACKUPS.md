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
