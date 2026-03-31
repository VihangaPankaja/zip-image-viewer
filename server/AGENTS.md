# Server Agent Scope

For backend/API changes under `server/`, inherit root guidance from `../agent.md` and apply these specifics:

- Stack: Express + TypeScript
- Primary checks:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- When backend changes affect frontend contracts, also run:
  - `npm run test`
  - `npm run test:e2e`
- Preserve path safety and session boundary checks for file operations.
