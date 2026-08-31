# Setup

## 1. Node
Use Node.js 22 or newer.

## 2. Install
```bash
npm install
npm run dev
```

No `.env` file, API key, cloud project, billing account or service account is required.

## 3. Local processing
TeacherSheet performs the current V1 processing on the user's device:

```text
Camera / image -> Tesseract.js OCR -> local structure analyzer
PDF -> PDF.js text extraction -> local structure analyzer
Scanned PDF -> PDF.js render (up to first 3 pages in V1) -> Tesseract.js OCR -> local structure analyzer
DOCX -> Mammoth text extraction -> local structure analyzer
Pasted text -> local structure analyzer
```

The OCR/runtime files are downloaded by the browser when needed. The app does not send the worksheet to a metered AI provider.

## 4. Production build
```bash
npm run typecheck
npm run build
```

Next.js produces a static export in `out/`.

## 5. Web hosting
Because the app is static, it can be hosted on a static host. No server environment variables are needed.

## 6. Android later
After a production build:
```bash
npx cap add android
npx cap sync android
npx cap open android
```

Capacitor uses `out/` as the packaged web directory, so the APK does not need a remote TeacherSheet server for the current local-only flow.
