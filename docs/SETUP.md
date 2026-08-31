# Setup

## 1. Node
Use Node.js 22 or newer.

## 2. Install
```bash
npm install
cp .env.example .env.local
npm run dev
```

## 3. Google Document AI
In Google Cloud:
1. Create/select a project, enable billing, and enable the Document AI API.
2. Create an OCR processor in the chosen location (for example `eu`).
3. Set `GOOGLE_CLOUD_PROJECT`, `GOOGLE_DOCUMENT_AI_LOCATION`, and `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`.
4. Give the server identity permission to process documents. `roles/documentai.viewer` is convenient during setup because it can both read the processor metadata used by the deep health check and process documents. If you later reduce permissions to `roles/documentai.apiUser`, processing can still work but the processor-metadata health check may be denied.
5. Authentication:
   - On Google Cloud hosting, prefer Application Default Credentials / workload identity.
   - On another server host, set `GOOGLE_SERVICE_ACCOUNT_JSON` securely as a server environment variable.
   - If the host handles multiline JSON poorly, base64-encode the entire service-account JSON and use `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` instead.

Do not commit a service-account key to GitHub.

## 4. OpenAI
1. Create an API key for the server environment.
2. Set `OPENAI_API_KEY` securely on the server.
3. The default model is `gpt-5.6-sol`; override with `OPENAI_MODEL` if desired.

The application keeps the OpenAI key server-side and sends worksheet analysis through the Responses API with `store: false`.

## 5. Health checks
Configuration-only check:
```text
GET /api/health
```

Live provider check (no worksheet is processed and no model generation is requested):
```text
GET /api/health?deep=1
```

A healthy live response returns HTTP 200 and reports both `googleDocumentAI.connected` and `openAI.connected` as `true`. Missing/invalid credentials or an inaccessible processor/model return HTTP 503 with a sanitized error message.

## 6. Test the analysis chain
With both connections healthy, submit an image/PDF from the UI. The server flow is:

```text
browser upload
  -> /api/analyze
  -> Google Document AI OCR/layout
  -> OpenAI vision + OCR/layout structural analysis
  -> structured exercise JSON
  -> teacher review screen
```

DOCX input is parsed locally on the server with Mammoth, then sent to OpenAI for structure analysis; it does not require Google OCR.

## 7. Android later
After the web app has a stable HTTPS production URL:
```bash
export CAPACITOR_SERVER_URL=https://your-production-url.example
npx cap add android
npx cap open android
```
This stage is intentionally not executed yet; V1 remains web-first as approved.
