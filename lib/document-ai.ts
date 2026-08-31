import { v1 as documentai } from "@google-cloud/documentai";
import type { DocumentLayoutBlock } from "./types";

function clientOptions() {
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION || "eu";
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return {
    apiEndpoint: `${location}-documentai.googleapis.com`,
    ...(rawCredentials ? { credentials: JSON.parse(rawCredentials) } : {})
  };
}

function textFromAnchor(fullText: string, anchor: any): string {
  const segments = anchor?.textSegments || [];
  return segments.map((segment: any) => {
    const start = Number(segment.startIndex || 0);
    const end = Number(segment.endIndex || 0);
    return fullText.slice(start, end);
  }).join("").trim();
}

function polygonBox(vertices: any[] = []) {
  if (!vertices.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = vertices.map((v) => Number(v.x || 0));
  const ys = vertices.map((v) => Number(v.y || 0));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function documentAIConfigured() {
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT &&
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID &&
    process.env.GOOGLE_DOCUMENT_AI_LOCATION
  );
}

export async function processWithDocumentAI(buffer: Buffer, mimeType: string) {
  if (!documentAIConfigured()) {
    throw new Error("Google Document AI is not configured. See .env.example.");
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT!;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION!;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID!;
  const client = new documentai.DocumentProcessorServiceClient(clientOptions());
  const name = `projects/${project}/locations/${location}/processors/${processorId}`;

  const [result] = await client.processDocument({
    name,
    rawDocument: { content: buffer, mimeType }
  });

  const doc: any = result.document;
  const fullText = String(doc?.text || "");
  const blocks: DocumentLayoutBlock[] = [];

  (doc?.pages || []).forEach((page: any, pageIndex: number) => {
    (page.blocks || []).forEach((block: any) => {
      const box = polygonBox(block.layout?.boundingPoly?.normalizedVertices || []);
      blocks.push({
        page: pageIndex + 1,
        text: textFromAnchor(fullText, block.layout?.textAnchor),
        ...box
      });
    });
  });

  return { text: fullText.trim(), blocks: blocks.slice(0, 120) };
}
