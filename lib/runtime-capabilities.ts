"use client";

export type VisionBackend = "webgpu" | "wasm";

export interface RuntimeCapabilities {
  secureContext: boolean;
  webAssembly: boolean;
  webGpu: boolean;
  webShare: boolean;
  fileShare: boolean;
}

type BrowserGpu = {
  requestAdapter: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<unknown | null>;
};

function hasWorkingWebAssembly() {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") return false;
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch {
    return false;
  }
}

async function hasWorkingWebGpuAdapter() {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as Navigator & { gpu?: BrowserGpu }).gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    return Boolean(await gpu.requestAdapter({ powerPreference: "high-performance" }));
  } catch {
    return false;
  }
}

export async function detectRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      secureContext: false,
      webAssembly: false,
      webGpu: false,
      webShare: false,
      fileShare: false
    };
  }

  const shareApi = navigator as Navigator & {
    share?: (data?: ShareData) => Promise<void>;
    canShare?: (data?: ShareData) => boolean;
  };

  return {
    secureContext: window.isSecureContext,
    webAssembly: hasWorkingWebAssembly(),
    webGpu: await hasWorkingWebGpuAdapter(),
    webShare: typeof shareApi.share === "function",
    fileShare: typeof shareApi.share === "function" && typeof shareApi.canShare === "function"
  };
}

/**
 * Browser names never participate in routing. The same capability profile always
 * produces the same execution plan, regardless of Chrome, Safari, Firefox,
 * Samsung Internet, an embedded WebView, or a future browser.
 */
export function visionBackendPlan(capabilities: RuntimeCapabilities): VisionBackend[] {
  if (!capabilities.webAssembly) return [];
  return capabilities.webGpu ? ["webgpu", "wasm"] : ["wasm"];
}
