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

## Milestone 5: Adoption and Governance screens

- **Admin sign-in = emailed one-time code** (the recommended default, proposed to Ed on 2026-10-13; change here if he picks the passphrase option instead). The visitor enters `ADMIN_EMAIL`; the server asks Supabase Auth (anon key) to email a 6-digit code, but only when the address matches `ADMIN_EMAIL`, and the reply is identical for any address. A verified code starts an HttpOnly, signed, 8-hour cookie (`ADMIN_SESSION_SECRET`). Supabase's own session is discarded. If any of `ADMIN_EMAIL`, `ADMIN_SESSION_SECRET` (32+ characters), `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing, nobody can sign in.
- **Anonymous visitors can view, never edit.** Every register write is a server action whose first step is the admin check; `tests/admin.test.mjs` asserts that order and that the write helpers are imported only by those actions. All writes use the service role on the server and touch `fow` only.
- **Register CRUD** covers add and edit of a use case, recording a risk assessment (same use case, framework and date replaces; a newer date becomes current), and delete with a confirmation. Retiring (status `retired`) is the way to keep history. Failed writes show a fixed message, never the database error.
- **Overdue** comes from `v_register.is_overdue` (earliest `next_review_date` before today). The screen counts them, tints the row, shows days overdue, and sorts them first. Bias-audit-due items are flagged the same way.
- **Three new views** (`v_adoption_manager`, `v_tool_mix`, `v_pulse_sentiment`, migration `20261013020000`) keep employee-level reads on the server side of the database. Teams under 10 are omitted, managers are never named (teams are numbered within their function), and tools or pulse groups under 10 are suppressed.
- **Pulse favorable** = score 4 or 5 after flipping the reverse-scored worry question, so a higher bar is always better. Change is the latest wave minus the previous one, in percentage points.
- **Enable-first list** reuses the Overview quadrant rule (more exposed and less adopted than the company) at job-family level, respecting the weighting toggle.
- **Adoption and Governance are built-in company only**; the dataset switcher waits for uploads (milestone 8).
