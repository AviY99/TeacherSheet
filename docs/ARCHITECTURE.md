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
    +--> confidence is good -> teacher review screen
    |
    +--> confidence is weak/custom/ambiguous
            -> optional free ChatGPT handoff
            -> native Share with source file when supported
            -> teacher uses their own ChatGPT account
            -> ChatGPT returns TEACHERSHEET_RETURN_V1 JSON block
            -> copy + one-tap clipboard import back into TeacherSheet
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
- TeacherSheet does not call OpenAI programmatically.
- Local analysis runs in the user's browser/device.
- The optional ChatGPT fallback is initiated explicitly by the teacher and uses the teacher's own ChatGPT account.
- Static export allows simple web hosting and later packaging into one APK.

## Why the ChatGPT bridge is a handoff instead of a direct callback
Without an OpenAI API integration, TeacherSheet cannot read a private ChatGPT conversation or automatically collect its response. The bridge therefore uses a deterministic handoff protocol: TeacherSheet generates a unique handoff ID and strict return JSON format, shares the worksheet/prompt to ChatGPT where the platform allows it, persists the pending state locally, and validates the copied ChatGPT return block when the teacher comes back.

This keeps the app free while still giving difficult worksheets access to stronger multimodal reasoning. Clipboard reading may require a user gesture, so the return screen provides both a one-tap clipboard import and a manual paste fallback.

## Trade-off
The local engine is cheaper and more private, but it cannot match a large multimodal cloud model on difficult layouts. TeacherSheet therefore keeps an explicit review/edit screen and only suggests the ChatGPT bridge when local confidence is low or the detected structure is ambiguous.

## APK later
Capacitor packages the static `out/` directory. The OCR and local structure-analysis flow can run inside the Android package without a TeacherSheet backend; the optional ChatGPT handoff can use Android's share sheet when available.
