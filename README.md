# Future of Work Lab

Where does AI change work here first, are people using AI safely, and what should HR do about it? Future of Work Lab scores task-level AI exposure for a job architecture, joins it to adoption and governance data, and turns it into an action plan. All employee data is synthetic.

The full build spec is in [docs/SPEC.md](docs/SPEC.md). This repo is being built one milestone at a time; this is milestone 1 (scaffold).

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in values; all are server only
npm run dev
```

## Scripts

- `npm run lint`: ESLint
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Node test runner over `tests/**/*.test.mjs`
- `npm run score -- --dataset <id>`: exposure scoring (stub until milestone 3)
