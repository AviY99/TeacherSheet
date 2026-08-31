# TeacherSheet

Web-first TeacherSheet with **no paid AI APIs and no API keys**.

**Current V1 scope:** exercise source capture/upload → local document reading/OCR → local exercise-structure analysis → teacher review → structural worksheet draft.

No vocabulary workflow, validation workflow, answer key or final worksheet export is implemented yet.

## Stack
- Next.js 16.3.3 / React 19.2.8 / TypeScript
- Tesseract.js 7 for in-browser image OCR
- PDF.js for local PDF text extraction/rendering
- Mammoth for local DOCX text extraction
- Local deterministic worksheet-structure analyzer
- Static PWA export + service worker
- Capacitor 8.5.0 prepared for Android packaging

## Cost model
TeacherSheet V1 does not call Google Document AI, OpenAI API, or any other metered AI API. No environment secrets are required.

Tesseract language/runtime assets and the PDF.js worker are downloaded from public CDNs when needed; there is no per-document API charge.

## Run
```bash
npm install
npm run dev
```

Production build:
```bash
npm run build
```

The static build is written to `out/`.

See `docs/SETUP.md`, `docs/SCOPE.md`, and `docs/ARCHITECTURE.md`.
