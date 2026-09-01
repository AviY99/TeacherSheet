"use client";

import { ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { analyzeLocally } from "@/lib/local-analyzer";
import {
  clearActiveAnalysisJob,
  loadActiveAnalysisJob,
  saveActiveAnalysisJob,
  type SavedAnalysisJob
} from "@/lib/analysis-job-store";
import {
  confidenceLabel,
  createChatGPTHandoff,
  needsChatGPTReview,
  parseChatGPTReturn
} from "@/lib/chatgpt-handoff";
import type {
  AnalysisMetrics,
  ExerciseAnalysis,
  ExerciseType,
  LocalAnalysisCheckpoint
} from "@/lib/types";

type Step = "source" | "preview" | "analyzing" | "decoded" | "draft";
type SourceKind = "camera" | "image" | "pdf" | "word" | "text";

const sourceKinds = new Set<SourceKind>(["camera", "image", "pdf", "word", "text"]);
const HANDOFF_STORAGE_KEY = "teachersheet-chatgpt-handoff-v1";

const typeLabels: Record<ExerciseType, string> = {
  fill_in_the_blanks: "Fill in the blanks",
  multiple_choice: "Multiple choice",
  matching: "Matching",
  true_false: "True / False",
  unscramble: "Unscramble",
  translation: "Translation",
  reading_comprehension: "Reading comprehension",
  sentence_writing: "Sentence writing",
  custom: "Custom"
};

const sourceMeta: Record<Exclude<SourceKind, "text">, {
  title: string;
  subtitle: string;
  badge: string;
  icon: "camera" | "image" | "pdf" | "word";
  firstStep: string;
  hint: string;
}> = {
  camera: {
    title: "צלם דף",
    subtitle: "צילום ישיר מהמצלמה",
    badge: "CAMERA",
    icon: "camera",
    firstStep: "PP-OCRv6 ירוץ ב-Worker נפרד ויחלץ את כל השורות והמיקומים",
    hint: "מומלץ לצלם את כל הדף, ישר ובתאורה טובה"
  },
  image: {
    title: "תמונה",
    subtitle: "JPG · PNG · WEBP · TIFF",
    badge: "IMAGE",
    icon: "image",
    firstStep: "PP-OCRv6 ירוץ ב-Worker נפרד ויחלץ את כל השורות והמיקומים",
    hint: "מתאים לצילום שכבר קיים בגלריה או במחשב"
  },
  pdf: {
    title: "PDF",
    subtitle: "דף יחיד או מסמך PDF",
    badge: "PDF",
    icon: "pdf",
    firstStep: "PDF.js יחלץ טקסט; PDF סרוק יעבור PP-OCRv6 ב-Worker",
    hint: "ב-PDF סרוק מעובדים עד שלושת העמודים הראשונים בגרסה זו"
  },
  word: {
    title: "Word",
    subtitle: "DOCX",
    badge: "WORD",
    icon: "word",
    firstStep: "Mammoth יחלץ את הטקסט מקובץ ה-DOCX במכשיר",
    hint: "Word עובר חילוץ טקסט ישיר ואינו דורש OCR"
  }
};

const initialAnalysis: ExerciseAnalysis = {
  exerciseType: "custom",
  title: "English practice",
  instructions: "Complete the exercise.",
  questionCount: 8,
  answerFormat: "open",
  hasWordBank: false,
  confidence: 0.5,
  layoutNotes: [],
  questions: []
};

function makeJobId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatSeconds(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
}

function FileIcon({ kind }: { kind: "camera" | "image" | "pdf" | "word" }) {
  const map = { camera: "◉", image: "▧", pdf: "PDF", word: "W" } as const;
  return <span className={`source-icon source-icon-${kind}`}>{map[kind]}</span>;
}

function SourceCard({ kind, onClick }: { kind: Exclude<SourceKind, "text">; onClick: () => void }) {
  const meta = sourceMeta[kind];
  const engine = kind === "word"
    ? "DOCX → ניתוח מקומי"
    : kind === "pdf"
      ? "PDF.js / PP-OCRv6 → מבנה"
      : "PP-OCRv6 Worker → מבנה";

  return (
    <button className={`source-card source-card-${kind}`} onClick={onClick} type="button">
      <span className="source-badge">{meta.badge}</span>
      <FileIcon kind={meta.icon} />
      <b>{meta.title}</b>
      <small>{meta.subtitle}</small>
      <span className="source-engine">{engine}</span>
    </button>
  );
}

function StructuralQuestion({ analysis, index }: { analysis: ExerciseAnalysis; index: number }) {
  const q = analysis.questions[index];
  const number = q?.number || index + 1;
  const text = q?.textPattern?.trim() || "Exercise item";

  if (analysis.exerciseType === "multiple_choice") {
    const optionCount = Math.max(2, Math.min(6, q?.optionCount || 3));
    return (
      <div className="paper-question-row paper-question-choice">
        <div className="paper-number">{number}.</div>
        <div className="paper-question-body">
          <div className="paper-question-text">{text}</div>
          <div className="choices">
            {Array.from({ length: optionCount }).map((_, optionIndex) => (
              <span key={optionIndex}>{String.fromCharCode(65 + optionIndex)}. option</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (analysis.exerciseType === "matching") {
    return (
      <div className="paper-question-row paper-question-matching">
        <div className="paper-number">{number}.</div>
        <div className="paper-question-body"><div className="paper-question-text">{text}</div></div>
        <div className="matching-answer">Answer</div>
      </div>
    );
  }

  if (analysis.exerciseType === "true_false") {
    return (
      <div className="paper-question-row">
        <div className="paper-number">{number}.</div>
        <div className="paper-question-body">
          <div className="paper-question-text">{text}</div>
          <div className="tf-answer">True / False</div>
        </div>
      </div>
    );
  }

  if (analysis.exerciseType === "fill_in_the_blanks") {
    return (
      <div className="paper-question-row paper-question-fill">
        <div className="paper-number">{number}.</div>
        <div className="paper-question-body">
          <div className="paper-question-text">{text}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="paper-question-row paper-question-open">
      <div className="paper-number">{number}.</div>
      <div className="paper-question-body">
        <div className="paper-question-text">{text}</div>
        <div className="answer-lines" aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}

function QuestionSkeleton({ analysis }: { analysis: ExerciseAnalysis }) {
  const count = Math.min(Math.max(analysis.questionCount, analysis.questions.length), 30);

  return (
    <div className="worksheet-paper">
      <div className="paper-meta"><span>Name: ____________</span><span>Date: ____________</span></div>
      <h2>{analysis.title || typeLabels[analysis.exerciseType]}</h2>
      <p className="paper-instruction">{analysis.instructions}</p>
      {analysis.hasWordBank && (
        <div className="word-bank-structural">
          <strong>WORD BANK</strong>
          <div>{Array.from({ length: 6 }).map((_, i) => <span key={i}>word</span>)}</div>
        </div>
      )}
      <div className="paper-questions">
        {Array.from({ length: count }).map((_, index) => (
          <StructuralQuestion key={index} analysis={analysis} index={index} />
        ))}
      </div>
    </div>
  );
}

function FittedWorksheetPreview({ analysis }: { analysis: ExerciseAnalysis }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const paper = content?.querySelector<HTMLElement>(".worksheet-paper");
    if (!viewport || !content || !paper) return;

    let frame = 0;
    const recalculate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const availableWidth = Math.max(1, viewport.clientWidth - 16);
        const availableHeight = Math.max(1, viewport.clientHeight - 16);
        const paperWidth = Math.max(1, paper.scrollWidth || paper.offsetWidth);
        const paperHeight = Math.max(1, paper.scrollHeight || paper.offsetHeight);
        const scale = Math.min(1, availableWidth / paperWidth, availableHeight / paperHeight);
        setFit({ scale, height: Math.ceil(paperHeight * scale) });
      });
    };

    recalculate();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(recalculate);
      observer.observe(viewport);
      observer.observe(paper);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", recalculate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", recalculate);
    };
  }, [analysis]);

  return (
    <div className="worksheet-fit-viewport" ref={viewportRef}>
      <div className="worksheet-fit-stage" style={{ height: fit.height ? `${fit.height}px` : undefined }}>
        <div className="worksheet-fit-content" ref={contentRef} style={{ transform: `scale(${fit.scale})` }}>
          <QuestionSkeleton analysis={analysis} />
        </div>
      </div>
    </div>
  );
}

function SourceComparison({ file, previewUrl, ocrText }: { file: File | null; previewUrl: string; ocrText: string }) {
  if (previewUrl) return <img className="comparison-source-image" src={previewUrl} alt="דף המקור להשוואה" />;
  if (file) {
    return (
      <div className="comparison-document-source">
        <strong>{file.name}</strong>
        <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
        <pre>{ocrText.slice(0, 5000)}</pre>
      </div>
    );
  }
  return <pre className="comparison-text-source">{ocrText}</pre>;
}

export function TeacherSheetFlow() {
  const [step, setStep] = useState<Step>("source");
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [analysis, setAnalysis] = useState<ExerciseAnalysis>(initialAnalysis);
  const [engine, setEngine] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("מכין את מנוע הפענוח המקומי...");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [analysisTick, setAnalysisTick] = useState(Date.now());
  const [analysisWallMs, setAnalysisWallMs] = useState(0);
  const [analysisMetrics, setAnalysisMetrics] = useState<AnalysisMetrics | null>(null);
  const [resumeJob, setResumeJob] = useState<SavedAnalysisJob | null>(null);
  const [handoffId, setHandoffId] = useState("");
  const [handoffPrompt, setHandoffPrompt] = useState("");
  const [handoffActive, setHandoffActive] = useState(false);
  const [handoffStatus, setHandoffStatus] = useState("");
  const [returnText, setReturnText] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => file?.type.startsWith("image/") ? URL.createObjectURL(file) : "", [file]);
  const weakRecognition = useMemo(() => needsChatGPTReview(analysis, ocrText), [analysis, ocrText]);
  const elapsedMs = analysisStartedAt ? Math.max(0, analysisTick - analysisStartedAt) : 0;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (step !== "analyzing" || !analysisStartedAt) return;
    const update = () => setAnalysisTick(Date.now());
    update();
    const interval = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pageshow", update);
    };
  }, [step, analysisStartedAt]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = localStorage.getItem(HANDOFF_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            id?: string;
            prompt?: string;
            analysis?: ExerciseAnalysis;
            ocrText?: string;
            sourceKind?: string;
            engine?: string;
          };
          if (saved.id && saved.analysis) {
            if (cancelled) return;
            setHandoffId(saved.id);
            setHandoffPrompt(saved.prompt || "");
            setHandoffActive(true);
            setHandoffStatus("חזרת מ-ChatGPT? העתק שם את בלוק התשובה ולחץ כאן על 'הדבק תוצאה מ-ChatGPT'.");
            setAnalysis(saved.analysis);
            setOcrText(saved.ocrText || "");
            setEngine(saved.engine || "local");
            if (saved.sourceKind && sourceKinds.has(saved.sourceKind as SourceKind)) setSourceKind(saved.sourceKind as SourceKind);
            setStep("decoded");
            return;
          }
        }
      } catch {
        localStorage.removeItem(HANDOFF_STORAGE_KEY);
      }

      const job = await loadActiveAnalysisJob();
      if (!job || cancelled) return;
      setSourceKind(job.sourceKind);
      setFile(job.file || null);
      setText(job.text || "");
      setAnalysisStartedAt(job.startedAt);
      setAnalysisTick(Date.now());
      setAnalysisStatus(job.checkpoint ? "הדפדפן עצר את העבודה — ממשיך מהטקסט שכבר נקרא" : "הדפדפן עצר את העבודה — ממשיך אוטומטית");
      setAnalysisProgress(job.checkpoint ? 0.78 : Math.max(0.02, job.progress || 0));
      setStep("analyzing");
      setResumeJob(job);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!resumeJob) return;
    const job = resumeJob;
    setResumeJob(null);
    void runAnalysis({
      inputFile: job.file || null,
      inputText: job.text || "",
      sourceKind: job.sourceKind,
      checkpoint: job.checkpoint || null,
      jobId: job.id,
      startedAt: job.startedAt
    });
  }, [resumeJob]);

  function choose(ref: RefObject<HTMLInputElement | null>) { ref.current?.click(); }

  function handleFile(kind: Exclude<SourceKind, "text">) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0];
      if (!picked) return;
      setSourceKind(kind);
      setFile(picked);
      setText("");
      setError("");
      setAnalysisMetrics(null);
      setAnalysisWallMs(0);
      void clearActiveAnalysisJob();
      setStep("preview");
    };
  }

  async function runAnalysis(options?: {
    textOnly?: boolean;
    inputFile?: File | null;
    inputText?: string;
    sourceKind?: SourceKind;
    checkpoint?: LocalAnalysisCheckpoint | null;
    jobId?: string;
    startedAt?: number;
  }) {
    const hasOverride = Object.prototype.hasOwnProperty.call(options || {}, "inputFile");
    const inputFile = hasOverride ? options?.inputFile || null : options?.textOnly ? null : file;
    const inputText = options?.inputText ?? (inputFile ? "" : text.trim());
    if (!inputFile && !inputText.trim() && !options?.checkpoint) return;

    const runSource = options?.sourceKind || (options?.textOnly ? "text" : sourceKind || "text");
    const jobId = options?.jobId || makeJobId();
    const startedAt = options?.startedAt || Date.now();
    let latestCheckpoint = options?.checkpoint || null;

    setStep("analyzing");
    setError("");
    setWarning("");
    setAnalysisMetrics(null);
    setAnalysisWallMs(0);
    setAnalysisStartedAt(startedAt);
    setAnalysisTick(Date.now());
    setAnalysisProgress(options?.checkpoint ? 0.76 : 0);
    setAnalysisStatus(options?.checkpoint ? "ממשיך מה-checkpoint האחרון שנשמר..." : "מכין את מנוע הפענוח המקומי...");

    try {
      try {
        await saveActiveAnalysisJob({
          id: jobId,
          sourceKind: runSource,
          file: inputFile,
          text: inputText,
          startedAt,
          status: latestCheckpoint ? "checkpoint" : "running",
          stage: latestCheckpoint ? "ocr-complete" : "starting",
          progress: latestCheckpoint ? 0.76 : 0,
          checkpoint: latestCheckpoint || undefined
        });
      } catch {
        // Resume persistence must never block analysis.
      }

      const result = await analyzeLocally({
        file: inputFile,
        text: inputText,
        resume: latestCheckpoint,
        onProgress: (message, progress) => {
          setAnalysisStatus(message);
          if (typeof progress === "number") setAnalysisProgress(Math.max(0, Math.min(1, progress)));
        },
        onCheckpoint: async (checkpoint) => {
          latestCheckpoint = checkpoint;
          try {
            await saveActiveAnalysisJob({
              id: jobId,
              sourceKind: runSource,
              file: inputFile,
              text: inputText,
              startedAt,
              status: "checkpoint",
              stage: "ocr-complete",
              progress: 0.78,
              checkpoint
            });
          } catch {
            // Keep processing even if local storage is unavailable.
          }
        }
      });

      const completedAt = Date.now();
      setOcrText(result.ocrText);
      setAnalysis(result.analysis);
      setEngine(result.engine);
      setWarning(result.warning || "");
      setAnalysisMetrics(result.metrics || null);
      setAnalysisWallMs(Math.max(0, completedAt - startedAt));
      await clearActiveAnalysisJob();
      setStep("decoded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      await clearActiveAnalysisJob();
      setStep(inputFile ? "preview" : "source");
    }
  }

  function analyzeText() {
    if (!text.trim()) return;
    setSourceKind("text");
    setFile(null);
    void runAnalysis({ textOnly: true, sourceKind: "text", inputText: text.trim() });
  }

  function persistHandoff(id: string, prompt: string) {
    localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify({
      id,
      prompt,
      analysis,
      ocrText: ocrText.slice(0, 16000),
      sourceKind,
      engine
    }));
  }

  async function openChatGPTReview() {
    setError("");
    const handoff = createChatGPTHandoff({ analysis, ocrText, sourceKind });
    setHandoffId(handoff.id);
    setHandoffPrompt(handoff.prompt);
    setHandoffActive(true);
    setReturnText("");
    persistHandoff(handoff.id, handoff.prompt);

    const shareApi = navigator as unknown as {
      share?: (data?: ShareData) => Promise<void>;
      canShare?: (data?: ShareData) => boolean;
    };
    const canShareFile = Boolean(
      file &&
      typeof shareApi.share === "function" &&
      (typeof shareApi.canShare !== "function" || shareApi.canShare({ files: [file] }))
    );

    if (canShareFile && file && shareApi.share) {
      try {
        setHandoffStatus("בחר ChatGPT בחלון השיתוף. התמונה והוראות הפענוח מוכנות לשליחה.");
        await shareApi.share({ title: "TeacherSheet – שיפור זיהוי", text: handoff.prompt, files: [file] });
        setHandoffStatus("אחרי ש-ChatGPT עונה, העתק את כל בלוק TEACHERSHEET_RETURN_V1 וחזור לכאן.");
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") {
          setHandoffStatus("השיתוף בוטל. אפשר ללחוץ שוב כשתרצה.");
          return;
        }
      }
    }

    const chatWindow = window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(handoff.prompt);
      setHandoffStatus(file
        ? "ChatGPT נפתח וההנחיה הועתקה. צרף שם את אותו דף/קובץ, הדבק את ההנחיה ושלח."
        : "ChatGPT נפתח וההנחיה הועתקה. הדבק אותה ושלח.");
    } catch {
      setHandoffStatus("ChatGPT נפתח. העתק את ההנחיה מהאזור 'הצג בקשה' למטה והדבק אותה בשיחה.");
    }
    if (!chatWindow) setHandoffStatus("הדפדפן חסם פתיחת חלון. ההנחיה מוכנה להעתקה; פתח ChatGPT ידנית.");
  }

  function importChatGPTText(raw: string) {
    try {
      const parsed = parseChatGPTReturn(raw, handoffId || undefined);
      setAnalysis(parsed.analysis);
      setEngine("chatgpt-user-handoff");
      setWarning("הפענוח שופר באמצעות חשבון ChatGPT של המורה, ללא OpenAI API וללא חיוב ל-TeacherSheet.");
      setHandoffActive(false);
      setHandoffStatus("");
      setHandoffPrompt("");
      setReturnText("");
      setHandoffId("");
      localStorage.removeItem(HANDOFF_STORAGE_KEY);
      void clearActiveAnalysisJob();
    } catch (e) {
      setError(e instanceof Error ? e.message : "לא ניתן לייבא את תשובת ChatGPT.");
    }
  }

  async function importFromClipboard() {
    setError("");
    try {
      const raw = await navigator.clipboard.readText();
      if (!raw.trim()) throw new Error("הלוח ריק. ב-ChatGPT העתק קודם את בלוק התשובה.");
      importChatGPTText(raw);
    } catch (e) {
      setError(e instanceof Error ? `${e.message} אפשר גם להדביק ידנית בשדה שמתחת.` : "לא ניתן לקרוא מהלוח. הדבק ידנית בשדה שמתחת.");
    }
  }

  function reset() {
    setStep("source");
    setSourceKind(null);
    setFile(null);
    setText("");
    setOcrText("");
    setAnalysis(initialAnalysis);
    setWarning("");
    setError("");
    setAnalysisProgress(0);
    setAnalysisStartedAt(null);
    setAnalysisWallMs(0);
    setAnalysisMetrics(null);
    setHandoffId("");
    setHandoffPrompt("");
    setHandoffActive(false);
    setHandoffStatus("");
    setReturnText("");
    localStorage.removeItem(HANDOFF_STORAGE_KEY);
    void clearActiveAnalysisJob();
  }

  const update = <K extends keyof ExerciseAnalysis>(key: K, value: ExerciseAnalysis[K]) => setAnalysis((a) => ({ ...a, [key]: value }));
  const selectedMeta = sourceKind && sourceKind !== "text" ? sourceMeta[sourceKind] : null;
  const visibleQuestionCount = Math.min(Math.max(analysis.questionCount, analysis.questions.length), 30);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">T</div>
        <div><strong>TeacherSheet</strong><small>Exercise Structure V1 · Worker OCR + smart fallback</small></div>
        <div className="scope-chip">ללא API בתשלום</div>
      </header>

      <section className="progress-row" aria-label="progress">
        <span className={step === "source" || step === "preview" ? "active" : "done"}>1. קליטה</span><i />
        <span className={step === "analyzing" || step === "decoded" ? "active" : step === "draft" ? "done" : ""}>2. פענוח</span><i />
        <span className={step === "draft" ? "active" : ""}>3. טיוטת מבנה</span>
      </section>

      {step === "source" && (
        <section className="screen-card hero-screen">
          <div className="eyebrow">FREE · RESUMABLE ON-DEVICE PROCESSING</div>
          <h1>איך תרצה להציג את דף התרגול?</h1>
          <p>תמונה ומצלמה נקראות במסלול מהיר ב-Worker. אם הביטחון נמוך, TeacherSheet עובר ל-ChatGPT של המורה במקום להריץ מודל כבד במשך דקות.</p>
          <div className="input-route-note"><strong>4 מסלולי קלט מקומיים</strong><span>מצלמה · תמונה · PDF · Word</span></div>
          <div className="source-grid source-grid-explicit">
            <SourceCard kind="camera" onClick={() => choose(cameraRef)} />
            <SourceCard kind="image" onClick={() => choose(imageRef)} />
            <SourceCard kind="pdf" onClick={() => choose(pdfRef)} />
            <SourceCard kind="word" onClick={() => choose(wordRef)} />
          </div>
          <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={handleFile("camera")} />
          <input ref={imageRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/tiff" onChange={handleFile("image")} />
          <input ref={pdfRef} hidden type="file" accept="application/pdf" onChange={handleFile("pdf")} />
          <input ref={wordRef} hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFile("word")} />
          <div className="format-support-row"><span>Camera</span><span>JPG</span><span>PNG</span><span>WEBP</span><span>TIFF</span><span>PDF</span><span>DOCX</span></div>
          <div className="or"><span>או הדבק טקסט לצורכי בדיקת הפענוח</span></div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="הדבק כאן טקסט של תרגיל..." />
          {error && <div className="error-box">{error}</div>}
          <button className="primary" disabled={!text.trim()} onClick={analyzeText}>פענח טקסט מקומית</button>
        </section>
      )}

      {step === "preview" && file && selectedMeta && (
        <section className="screen-card">
          <button className="back" onClick={() => setStep("source")}>→ חזרה</button>
          <div className="screen-heading">
            <div><div className="eyebrow">SOURCE PREVIEW · {selectedMeta.badge}</div><h1>{selectedMeta.title} נקלט</h1></div>
            <span className="status-dot">מוכן לפענוח מקומי</span>
          </div>
          <div className="preview-layout">
            <div className="file-preview">{previewUrl ? <img src={previewUrl} alt="תצוגת דף התרגול" /> : <div className="document-placeholder"><strong>{selectedMeta.badge}</strong><span>{file.name}</span></div>}</div>
            <div className="file-details">
              <span className="preview-source-kind"><FileIcon kind={selectedMeta.icon} /><span><small>סוג קלט</small><b>{selectedMeta.title}</b></span></span>
              <label>קובץ</label><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
              <div className="source-hint">{selectedMeta.hint}</div>
              <div className="pipeline-box"><b>מסלול הפענוח — ללא שירות בתשלום</b><span>1. {selectedMeta.firstStep}</span><span>2. TeacherSheet שומר checkpoint אחרי קריאת הדף ובונה את המבנה</span><span>3. אם רמת הביטחון נמוכה, יוצע חיזוק דרך חשבון ChatGPT של המורה</span></div>
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
          <button className="primary" onClick={() => void runAnalysis()}>פענח את סוג התרגיל</button>
        </section>
      )}

      {step === "analyzing" && (
        <section className="screen-card analyzing">
          <div className="scan-sheet"><div className="scan-line" /></div>
          <h1>מפענח את דף התרגול</h1>
          <p>{analysisStatus}</p>
          <div className="local-progress" aria-label="analysis progress"><span style={{ width: `${Math.round(analysisProgress * 100)}%` }} /></div>
          <div className="analysis-steps"><span className="done">✓ קליטת מקור</span><span className="working">● PP-OCRv6 Worker</span><span>○ בניית מבנה התרגיל</span></div>
          <div className="engine-note">זמן שעבר: <b>{Math.floor(elapsedMs / 1000)} שנ׳</b> · הדף נשמר מקומית. אם הדפדפן יקפיא את התהליך, בחזרה לאפליקציה נמשיך מה-checkpoint האחרון.</div>
        </section>
      )}

      {step === "decoded" && (
        <section className="screen-card decoded-screen">
          <div className="screen-heading">
            <div><div className="eyebrow">STRUCTURE FOUND</div><h1>זה המבנה שמצאנו</h1></div>
            <span className={`confidence confidence-${confidenceLabel(analysis.confidence)}`}>{Math.round(analysis.confidence * 100)}% ביטחון · {confidenceLabel(analysis.confidence)}</span>
          </div>
          {warning && <div className="warning-box">{warning}</div>}
          {error && <div className="error-box">{error}</div>}

          {(weakRecognition || handoffActive) && (
            <div className="chatgpt-bridge">
              <div className="chatgpt-bridge-head"><span className="bridge-badge">FREE FALLBACK</span><div><b>{handoffActive ? "ממתין לתוצאה מ-ChatGPT" : "רמת הביטחון לא מספיקה — אפשר לחזק עם ChatGPT"}</b><small>TeacherSheet לא משתמש ב-API. המורה משתמש בחשבון ChatGPT שלו.</small></div></div>
              {!handoffActive ? (
                <><p>בלחיצה אחת ננסה להעביר את הקובץ והוראות הפענוח דרך Share. אם שיתוף קבצים אינו נתמך, נפתח ChatGPT ונעתיק את ההנחיה.</p><button className="bridge-primary" type="button" onClick={() => void openChatGPTReview()}>שפר זיהוי עם ChatGPT</button></>
              ) : (
                <>
                  <div className="bridge-steps"><span className="done">1. בקשה הוכנה</span><span className="done">2. ChatGPT</span><span className="active">3. החזרה ל-TeacherSheet</span></div>
                  {handoffStatus && <div className="handoff-status">{handoffStatus}</div>}
                  <div className="bridge-actions"><button className="bridge-primary" type="button" onClick={() => void importFromClipboard()}>הדבק תוצאה מ-ChatGPT</button><button className="secondary" type="button" onClick={() => void openChatGPTReview()}>פתח שוב את ChatGPT</button></div>
                  <details className="bridge-manual"><summary>אם ההדבקה האוטומטית לא עובדת</summary><p>העתק ב-ChatGPT את כל בלוק התשובה, הדבק כאן ולחץ ייבוא.</p><textarea className="return-textarea" value={returnText} onChange={(e) => setReturnText(e.target.value)} placeholder="הדבק כאן את תשובת ChatGPT..." /><button className="secondary" type="button" disabled={!returnText.trim()} onClick={() => importChatGPTText(returnText)}>ייבא תשובה שהודבקה</button></details>
                  <details className="bridge-manual"><summary>הצג את הבקשה שנשלחת ל-ChatGPT</summary><pre className="handoff-prompt">{handoffPrompt}</pre></details>
                </>
              )}
            </div>
          )}

          <div className="engine-note">Engine: <b>{engine}</b>{sourceKind && <span> · Input: <b>{sourceKind}</b></span>}<span> · זמן כולל: <b>{formatSeconds(analysisWallMs || analysisMetrics?.totalMs)}</b></span>{analysisMetrics?.ocrTotalMs ? <span> · OCR: <b>{formatSeconds(analysisMetrics.ocrTotalMs)}</b></span> : null}{analysisMetrics?.resumed ? <span> · <b>המשך מ-checkpoint</b></span> : null}</div>

          <div className="decoded-grid decoded-grid-v2">
            <div className="form-panel edit-panel">
              <div className="panel-heading"><strong>עריכת הפענוח</strong><small>כל שינוי מתעדכן מיד בתצוגת המבנה.</small></div>
              <label>סוג התרגיל<select value={analysis.exerciseType} onChange={(e) => update("exerciseType", e.target.value as ExerciseType)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>כותרת<input value={analysis.title} onChange={(e) => update("title", e.target.value)} /></label>
              <label>הוראות<textarea value={analysis.instructions} onChange={(e) => update("instructions", e.target.value)} /></label>
              <div className="two-cols"><label>מספר שאלות<input type="number" min="1" max="30" value={analysis.questionCount} onChange={(e) => update("questionCount", Math.max(1, Math.min(30, Number(e.target.value))))} /></label><label>פורמט תשובה<select value={analysis.answerFormat} onChange={(e) => update("answerFormat", e.target.value as ExerciseAnalysis["answerFormat"])}><option value="blank">Blank</option><option value="choice">Choice</option><option value="matching">Matching</option><option value="true_false">True / False</option><option value="open">Open</option></select></label></div>
              <label className="toggle-row"><input type="checkbox" checked={analysis.hasWordBank} onChange={(e) => update("hasWordBank", e.target.checked)} /><span>קיים Word Bank במבנה המקורי</span></label>
              <details><summary>הטקסט שנקרא מהדף</summary><pre>{ocrText}</pre></details>
            </div>

            <section className="comparison-panel" aria-label="השוואה למקור">
              <div className="comparison-header"><div><strong>השוואה למקור</strong><small>בדוק שהמבנה שומר על מספר הפריטים, סוג התרגיל והפריסה.</small></div><span>מקור ↔ מבנה</span></div>
              <div className="comparison-mobile-hint">בטלפון: החלק ימינה/שמאלה כדי לעבור בין המקור למבנה. כל צד מוצג ב-Fit-to-page.</div>
              <div className="comparison-track">
                <article className="comparison-pane comparison-source-pane"><div className="comparison-pane-title"><b>1. מקור</b><small>{sourceKind || "text"}</small></div><SourceComparison file={file} previewUrl={previewUrl} ocrText={ocrText} /></article>
                <article className="comparison-pane comparison-structure-pane"><div className="comparison-pane-title"><b>2. מבנה שזוהה</b><small>כל {visibleQuestionCount} הפריטים · Fit-to-page</small></div><FittedWorksheetPreview analysis={analysis} /></article>
              </div>
            </section>
          </div>

          <div className="action-row"><button className="secondary" onClick={reset}>התחל מחדש</button><button className="primary" onClick={() => setStep("draft")}>צור טיוטת דף מבנית</button></div>
        </section>
      )}

      {step === "draft" && (
        <section className="screen-card draft-screen">
          <div className="screen-heading"><div><div className="eyebrow">STRUCTURAL DRAFT</div><h1>טיוטת דף התרגול</h1></div><span className="status-dot">כל השורות שזוהו</span></div>
          <div className="scope-warning"><b>גבול גרסה זו:</b> זהו דף מבני בלבד. עדיין אין כאן הכנסת אוצר מילים, בדיקות איכות, Answer Key או הפקת הדף הסופי.</div>
          <QuestionSkeleton analysis={analysis} />
          <div className="action-row"><button className="secondary" onClick={() => setStep("decoded")}>ערוך והשווה למקור</button><button className="primary" onClick={reset}>נתח דוגמה נוספת</button></div>
        </section>
      )}
    </main>
  );
}
