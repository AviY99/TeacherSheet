"use client";

import { useEffect, useRef, useState } from "react";

type PickerHandle = { getFile: () => Promise<File> };
type PickerOptions = {
  multiple?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (options?: PickerOptions) => Promise<PickerHandle[]>;
};

type RouteKind = "pdf" | "word" | "image" | null;

function routeKind(input: HTMLInputElement): RouteKind {
  const accept = (input.accept || "").toLowerCase();
  if (accept.includes("application/pdf")) return "pdf";
  if (accept.includes("wordprocessingml") || accept.includes(".docx")) return "word";
  if (accept.includes("image/")) return "image";
  return null;
}

function matchesRoute(file: File, kind: RouteKind) {
  const name = file.name.toLowerCase();
  if (kind === "pdf") return file.type === "application/pdf" || name.endsWith(".pdf");
  if (kind === "word") {
    return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx");
  }
  if (kind === "image") {
    return file.type.startsWith("image/") || /\.(jpe?g|png|webp|tiff?)$/i.test(name);
  }
  return true;
}

function pickerOptions(kind: Exclude<RouteKind, "image" | null>): PickerOptions {
  if (kind === "pdf") {
    return {
      multiple: false,
      types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }]
    };
  }
  return {
    multiple: false,
    types: [{
      description: "Word document",
      accept: {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"]
      }
    }]
  };
}

export function FilePickerGuard() {
  const [message, setMessage] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const showMessage = (text: string) => {
      setMessage(text);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setMessage(""), 4200);
    };

    const onClick = async (event: Event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || input.type !== "file" || input.hasAttribute("capture")) return;

      const kind = routeKind(input);
      if (kind !== "pdf" && kind !== "word") return;

      const picker = (window as PickerWindow).showOpenFilePicker;
      if (typeof picker !== "function") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      try {
        const handles = await picker(pickerOptions(kind));
        const file = await handles[0]?.getFile();
        if (!file) return;

        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        showMessage("לא ניתן לפתוח את בורר הקבצים הייעודי. אפשר לנסות שוב דרך Files.");
      }
    };

    const onChange = (event: Event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file) return;

      const kind = routeKind(input);
      if (!kind || matchesRoute(file, kind)) return;

      event.stopImmediatePropagation();
      input.value = "";
      if (kind === "pdf") showMessage("במסלול PDF אפשר לבחור רק קובץ PDF. בחר Files ואז קובץ ‎.pdf.");
      else if (kind === "word") showMessage("במסלול Word אפשר לבחור רק קובץ DOCX. בחר Files ואז קובץ ‎.docx.");
      else showMessage("במסלול תמונה אפשר לבחור רק JPG, PNG, WEBP או TIFF.");
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!message) return null;
  return <div className="file-picker-toast" role="status">{message}</div>;
}
