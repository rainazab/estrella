# LineWise Frontend

React + Vite frontend for the LineWise planner demo.

## Prerequisites

- Node.js 20 or newer
- npm
- Optional: Python backend from the repo root if you want live API data

## Run the Frontend

From the repo root:

```bash
cd linewise
npm install
npm run dev
```

Vite will print the local URL, usually:

```text
http://localhost:5173
```

By default the app uses the Vite dev middleware in `vite.config.js`, which serves:

- `GET /api/health`
- `GET /api/plan` from `linewise/data/plan.json`

This is enough for the offline frontend demo.

## Run With the Backend API

In one terminal, from the repo root:

```bash
./scripts/run_export.sh
./scripts/run_server.sh
```

The backend starts on:

```text
http://localhost:8000
```

In another terminal, point the frontend at that backend:

```bash
cd linewise
printf 'VITE_API_BASE=http://localhost:8000\n' > .env.local
npm install
npm run dev
```

Remove `linewise/.env.local` to go back to the built-in Vite `/api` middleware.

## Useful Commands

```bash
npm run dev       # start local dev server
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # run ESLint
```

## Data Refresh

To regenerate the canonical planning payload and refresh the frontend seed:

```bash
./scripts/run_export.sh
```

The frontend seed file is:

```text
linewise/data/plan.json
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails | Check that Node.js 20+ is active with `node --version`. |
| Page loads but data is missing | Run `./scripts/run_export.sh` from the repo root, then restart `npm run dev`. |
| Backend mode fails to fetch data | Make sure `./scripts/run_server.sh` is running and `.env.local` contains `VITE_API_BASE=http://localhost:8000`. |
| Port `5173` is busy | Vite will automatically choose another port and print it in the terminal. |
