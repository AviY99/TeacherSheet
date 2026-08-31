import { NextResponse } from "next/server";
import { documentAIConfigured, verifyDocumentAIConnection } from "@/lib/document-ai";
import { openAIConfigured, verifyOpenAIConnection } from "@/lib/openai-analyzer";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = ["1", "true", "yes"].includes((url.searchParams.get("deep") || "").toLowerCase());

  if (!deep) {
    return NextResponse.json({
      ok: true,
      mode: "configuration",
      googleDocumentAI: { configured: documentAIConfigured() },
      openAI: {
        configured: openAIConfigured(),
        model: process.env.OPENAI_MODEL || "gpt-5.6-sol"
      }
    });
  }

  const [googleDocumentAI, openAI] = await Promise.all([
    verifyDocumentAIConnection(),
    verifyOpenAIConnection()
  ]);

  return NextResponse.json({
    ok: googleDocumentAI.connected && openAI.connected,
    mode: "live",
    googleDocumentAI,
    openAI
  }, {
    status: googleDocumentAI.connected && openAI.connected ? 200 : 503
  });
}
