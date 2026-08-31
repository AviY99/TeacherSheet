import { NextResponse } from "next/server";
import { analyzeInput } from "@/lib/analyze";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const allowed = new Set([
  "image/jpeg", "image/png", "image/webp", "image/tiff",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    const text = String(form.get("text") || "").trim();
    const file = candidate instanceof File && candidate.size > 0 ? candidate : undefined;

    if (!file && !text) return NextResponse.json({ error: "Upload an exercise or provide text." }, { status: 400 });
    if (file && file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 10 MB." }, { status: 413 });
    if (file && !allowed.has(file.type) && !file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Supported types: JPG, PNG, WEBP, TIFF, PDF, DOCX." }, { status: 415 });
    }

    return NextResponse.json(await analyzeInput({ file, text }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    const configurationError = /not configured|credential|permission|processor/i.test(message);
    return NextResponse.json({ error: message }, { status: configurationError ? 503 : 500 });
  }
}
