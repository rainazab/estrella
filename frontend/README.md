# LineWise frontend

This directory holds the React/Vite web app. The Python backend lives in
`../app/` and is documented in [`../README.md`](../README.md).

## First-time setup (partner drop-in)

Two ways to bring an existing frontend codebase into this monorepo:

### Option A — flat copy (loses old git history)

Simplest. Drop the files in and commit.

```bash
# from the existing frontend repo, somewhere outside this monorepo:
rsync -av --exclude node_modules --exclude .git --exclude dist --exclude .next \
  /path/to/your/frontend/  /path/to/linewise-monorepo/frontend/

# then in this repo:
git add frontend
git commit -m "Import frontend"
git push
```

### Option B — git subtree (preserves old history)

A bit more involved but keeps the per-file history of the frontend repo
available via `git log frontend/...`.

```bash
# from the root of this monorepo:
git remote add frontend-src https://github.com/<your-partner>/<frontend-repo>.git
git fetch frontend-src
git subtree add --prefix=frontend frontend-src main --squash
git remote remove frontend-src   # optional cleanup
git push
```

Replace `main` with whatever branch the partner is shipping from.

## Running the dev loop

The frontend talks to the backend over HTTP. From two terminals at the
repo root:

```bash
# terminal 1 — start the backend API
./scripts/run_server.sh                 # 127.0.0.1:8000

# terminal 2 — start the frontend
cd frontend
npm install                             # or pnpm / yarn — partner's choice
npm run dev                             # or whatever the partner's script is
```

Point the frontend at the API via the dev env (depends on the bundler):

| Bundler | File | Variable |
|---|---|---|
| Vite      | `frontend/.env.local`        | `VITE_API_BASE=http://localhost:8000` |
| Next.js   | `frontend/.env.local`        | `NEXT_PUBLIC_API_BASE=http://localhost:8000` |
| CRA       | `frontend/.env.development`  | `REACT_APP_API_BASE=http://localhost:8000` |

The contract the backend serves is documented in
[`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

## What NOT to commit

The monorepo's `.gitignore` already excludes:

- `node_modules/`
- `dist/`, `build/`, `.next/`, `.vite/`, `out/`, `.turbo/`, `coverage/`
- `*.log`, `*.tsbuildinfo`
- `.env.*` (except `.env.example`)

`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` **should** be
committed — they pin the dependency graph for reproducible installs.

## Optional: serve `data.json` statically

If the frontend would rather load the canonical payload as a static file
than hit `GET /plan`, point your bundler's public assets at
`../data/output/data.json` or copy it during dev. The HTTP path is the
recommended one because it picks up re-exports without a restart.
