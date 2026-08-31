import { NextResponse } from "next/server";
import { documentAIConfigured } from "@/lib/document-ai";
import { openAIConfigured } from "@/lib/openai-analyzer";

export function GET() {
  return NextResponse.json({
    ok: true,
    googleDocumentAI: documentAIConfigured(),
    openAI: openAIConfigured()
  });
}
