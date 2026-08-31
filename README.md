# TeacherSheet

Production foundation for the approved web-first TeacherSheet architecture.

**Current V1 scope:** exercise source capture/upload → document reading → exercise-structure analysis → teacher review → structural worksheet draft.

No vocabulary workflow, validation workflow, answer key or final worksheet export is implemented yet.

## Stack
- Next.js 16.3.3 / React 19.2.8 / TypeScript
- Google Document AI 10.0.0
- OpenAI Node SDK 7.5.0
- PWA manifest + service worker
- Capacitor 8.5.0 prepared for a later Android wrapper

## Run
```bash
npm install
cp .env.example .env.local
npm run dev
```

See `docs/SETUP.md`, `docs/SCOPE.md`, and `docs/ARCHITECTURE.md`.
