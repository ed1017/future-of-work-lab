# Decisions log

One entry per decision that the spec leaves open. Newest last.

## Milestone 4: Overview and Exposure screens

- **Theme: light**, matching the Overview mockup (dark header, off-white page, white cards, serif headings), not the dark ed-ai.app tokens the spec suggested. Decided by Ed on 2026-10-13. Tokens live in `app/globals.css`.
- **"Exposure" means the exposure score** (sum of time share x exposure, automate = 1, augment = 0.5) for the KPI tile and the quadrant's vertical axis. The function bars show the automate and augment shares of task time; the label at the end of each bar is their sum. The score spreads families from 28% to 85%; the exposed share is 56% to 100% and would crowd the chart.
- **Weighting toggle** is cost-weighted by default (as in the mockup) and headcount-weighted on request. It changes exposure only; adoption is always per person. State is in the URL (`?function=` and `?weighting=`), so views can be linked.
- **Weekly active AI users KPI** uses the licensed denominator ("of licensed employees", as in the mockup). The quadrant's x axis uses weekly active users as a share of headcount, so unlicensed people count as non-adopters.
- **Quadrant dividing lines** are the company values (exposure score and weekly active rate), not fixed midpoints. "Enable first" = more exposed and less adopted than the company.
- **Roles flagged for redesign** = jobs with an exposure score of 65% or higher; employees in scope sums their headcount (jobs under 10 people add none). The action planner (milestone 6) may refine this.
- **Recommended actions** show an empty state until milestone 6 fills `fow.action_recommendations`; no placeholder text is invented.
- **Label overlap and bar order** fixes from the mockup review: only the eight largest bubbles are labeled (the rest show on hover), labels flip left near the right edge, and function bars are sorted by exposed share.
- **Header controls**: function and weighting only. The dataset switcher waits for uploads (milestone 8). Navigation tabs for screens not built yet are inert.
- **Acceptance check**: `tests/fixtures/overview/queries.sql` computes every KPI and chart value from base tables; `expected.json` is its output on 2026-10-13 and `snapshot.json` the view rows the app reads. `tests/overview.test.mjs` checks the screen code reproduces the expected values for both weightings.
