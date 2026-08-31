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
1. Create/select a project and enable Document AI.
2. Create an `OCR_PROCESSOR` in the chosen location (for example `eu`).
3. Fill `GOOGLE_CLOUD_PROJECT`, `GOOGLE_DOCUMENT_AI_LOCATION`, and `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`.
4. Local development: use Google Application Default Credentials.
5. Non-Google hosting: set `GOOGLE_SERVICE_ACCOUNT_JSON` securely on the server.

## 4. OpenAI
Set `OPENAI_API_KEY`. The default model is `gpt-5.6-sol`; override with `OPENAI_MODEL` if desired.

## 5. Health check
Open `/api/health` to verify which providers are configured.

## 6. Android later
After the web app has a stable HTTPS production URL:
```bash
export CAPACITOR_SERVER_URL=https://your-production-url.example
npx cap add android
npx cap open android
```
This stage is intentionally not executed yet; V1 remains web-first as approved.
