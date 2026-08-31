# Architecture

```text
Browser / PWA
    |
    | multipart source image / PDF / DOCX
    v
Next.js server route /api/analyze
    |
    +--> JPG/PNG/PDF --> Google Document AI OCR Processor
    |                    | full text + normalized layout blocks
    |                    v
    +------------------> OpenAI Responses API
                         | exercise structure JSON
                         v
Browser review screen --> structural worksheet draft
```

## Why this arrangement
- API credentials remain server-side.
- Google is responsible for document reading and layout coordinates.
- OpenAI is responsible for semantic classification and worksheet-structure reconstruction.
- The browser receives only OCR text and the structured result.

## APK later
The web version is intentionally web-first. After deployment, Capacitor can create a single Android APK that loads the production TeacherSheet web application. The remote Google/OpenAI services do not require any extra installation on the teacher's device.
