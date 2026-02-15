# Backend instructions

**Path:** `Mill/Backend/` (this folder). These rules apply to all code under `Backend/src/` and related config.

## Code quality

- **Always analyze code** before making changes.
- **Do things without error** — ensure changes work and do not introduce bugs.
- **Do not make errors** — verify logic, imports, and edge cases.

## Architecture

- **Do not** add a `services/` folder or create separate service files.
- **Keep business logic inside controllers.** Controllers handle both HTTP (req/res) and the logic for that feature (calling models, validation, etc.).
- There is no services layer in this project; controllers and models are the intended layers.
