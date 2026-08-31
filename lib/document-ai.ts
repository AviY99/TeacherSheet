import { v1 as documentai } from "@google-cloud/documentai";
import type { DocumentLayoutBlock } from "./types";

type GoogleConnectionStatus = {
  configured: boolean;
  connected: boolean;
  location: string;
  credentialSource: "service-account-json" | "service-account-base64" | "application-default";
  processorType?: string;
  processorState?: string;
  error?: string;
};

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown Google Document AI error");
  return message.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[redacted]").slice(0, 500);
}

function credentialsFromEnvironment() {
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  if (base64) {
    try {
      return {
        credentials: JSON.parse(Buffer.from(base64, "base64").toString("utf8")),
        source: "service-account-base64" as const
      };
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded service-account JSON.");
    }
  }

  if (raw) {
    try {
      return {
        credentials: JSON.parse(raw),
        source: "service-account-json" as const
      };
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid service-account JSON.");
    }
  }

  return { credentials: undefined, source: "application-default" as const };
}

function clientOptions() {
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION || "eu";
  const credentialConfig = credentialsFromEnvironment();

  return {
    apiEndpoint: `${location}-documentai.googleapis.com`,
    ...(credentialConfig.credentials ? { credentials: credentialConfig.credentials } : {})
  };
}

function processorName() {
  const project = process.env.GOOGLE_CLOUD_PROJECT!;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION!;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID!;
  return `projects/${project}/locations/${location}/processors/${processorId}`;
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

export async function verifyDocumentAIConnection(): Promise<GoogleConnectionStatus> {
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION || "eu";
  let credentialSource: GoogleConnectionStatus["credentialSource"] = "application-default";

  try {
    credentialSource = credentialsFromEnvironment().source;
  } catch (error) {
    return {
      configured: documentAIConfigured(),
      connected: false,
      location,
      credentialSource,
      error: safeError(error)
    };
  }

  if (!documentAIConfigured()) {
    return {
      configured: false,
      connected: false,
      location,
      credentialSource,
      error: "Missing GOOGLE_CLOUD_PROJECT, GOOGLE_DOCUMENT_AI_LOCATION or GOOGLE_DOCUMENT_AI_PROCESSOR_ID."
    };
  }

  try {
    const client = new documentai.DocumentProcessorServiceClient(clientOptions());
    const [processor] = await client.getProcessor({ name: processorName() }, { timeout: 10_000 });
    await client.close();

    return {
      configured: true,
      connected: true,
      location,
      credentialSource,
      processorType: String(processor.type || "unknown"),
      processorState: String(processor.state || "unknown")
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      location,
      credentialSource,
      error: safeError(error)
    };
  }
}

export async function processWithDocumentAI(buffer: Buffer, mimeType: string) {
  if (!documentAIConfigured()) {
    throw new Error("Google Document AI is not configured. See .env.example.");
  }

  const client = new documentai.DocumentProcessorServiceClient(clientOptions());

  try {
    const [result] = await client.processDocument({
      name: processorName(),
      rawDocument: { content: buffer, mimeType },
      labels: { app: "teachersheet", stage: "exercise_structure" }
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
  } finally {
    await client.close();
  }
}
