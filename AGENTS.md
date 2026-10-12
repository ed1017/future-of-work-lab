<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Future of Work Lab

You are building Future of Work Lab, an HR AI exposure, adoption, and governance app.
The full spec is docs/SPEC.md. Read it before every task.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Base UI,
Recharts 3, Lucide, Supabase Postgres, OpenAI SDK 7, Vercel. Match people-analytics-ai conventions.

Rules:
- Work one milestone at a time from the Build order section. Stop when its "Done when" check passes.
- Write only to the `fow` schema. Never alter or write to `public` tables.
- All database access is server-side with the service role key. Never expose it to the client.
- Return aggregates only to the browser. Suppress any group under 10 employees.
- Migrations go in supabase/migrations as plain SQL. Seeds use a fixed random seed.
- Model calls use structured JSON output validated with zod. Model name comes from OPENAI_MODEL.
- Before finishing a task run: npm run lint, npm run typecheck, npm test.
- Open a pull request per milestone with a short summary and the acceptance check result.
