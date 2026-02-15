# Mill Backend

Node.js + Express + MongoDB backend with advanced structure, Winston logging, and best practices.

## Structure

```
Backend/
├── src/
│   ├── config/          # Environment & database config
│   ├── controllers/     # Route handlers (empty - add per feature)
│   ├── middlewares/     # Error handling, auth, etc.
│   ├── models/          # Mongoose schemas (empty - add per feature)
│   ├── routes/          # API route definitions
│   ├── validators/      # Request validation (empty - add per feature)
│   ├── utils/           # Logger and helpers
│   ├── app.js           # Express app setup
│   └── server.js        # Entry point
├── logs/                # Winston log files (auto-created)
├── .env.example
└── package.json
```

## Setup

1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Ensure MongoDB is running locally or set `MONGO_URI` in `.env`.
4. Run:
   ```bash
   npm run dev
   ```

## Scripts

- `npm start` – Production start
- `npm run dev` – Development with `--watch` (Node 18+)

## Endpoints

- `GET /health` – Health check
- `GET /api` – API info

## Logging

Winston is configured with:

- **Console** (dev): colored, timestamped
- **File**: `logs/combined.log`, `logs/error.log`
- Level controlled by `LOG_LEVEL` (e.g. `debug`, `info`, `error`)

## Adding a feature

1. **Model** – `src/models/User.js` (Mongoose schema)
2. **Controller** – `src/controllers/userController.js` (req/res + business logic; no separate services)
3. **Validator** – `src/validators/userValidator.js` (optional)
4. **Routes** – `src/routes/userRoutes.js` then mount in `src/routes/index.js`

