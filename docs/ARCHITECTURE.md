# Architecture

```text
Browser / PWA / later APK
    |
    +--> Camera / JPG / PNG / WEBP / TIFF
    |       -> Tesseract.js (browser OCR)
    |
    +--> PDF
    |       -> PDF.js text extraction
    |       -> if scanned: render pages -> Tesseract.js OCR
    |
    +--> DOCX
    |       -> Mammoth text extraction
    |
    +--> pasted text
    |
    v
Local deterministic structure analyzer
    |
    v
Teacher review screen
    |
    v
Structural worksheet draft
```

## Design constraints
- No paid AI API.
- No Google/OpenAI credentials.
- No document is intentionally uploaded to an AI provider.
- Current analysis runs in the user's browser/device.
- Static export allows simple web hosting and later packaging into one APK.

## Trade-off
The local engine is cheaper and more private, but it cannot match a large multimodal cloud model on difficult layouts. Therefore TeacherSheet keeps an explicit review/edit screen after recognition. The local analyzer can be improved over time with more worksheet-specific rules and optional open-source on-device models without changing the no-paid-API requirement.

## APK later
Capacitor packages the static `out/` directory. The current OCR and structure-analysis flow can therefore run inside the Android package without requiring a TeacherSheet backend.
