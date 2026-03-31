# Client Agent Scope

For frontend changes under `client/`, inherit root guidance from `../agent.md` and apply these specifics:

- Stack: React + Vite + TypeScript
- Primary checks:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
- E2E flow for client UX verification:
  - `npm run test:e2e`
- Keep UI changes aligned with existing design system classes in `client/src/styles.css`.
