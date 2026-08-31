"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import type { AnalyzeResponse, ExerciseAnalysis, ExerciseType } from "@/lib/types";

type Step = "source" | "preview" | "analyzing" | "decoded" | "draft";

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

function FileIcon({ kind }: { kind: "camera" | "image" | "pdf" | "word" }) {
  const map = { camera: "◉", image: "▧", pdf: "PDF", word: "W" } as const;
  return <span className={`source-icon source-icon-${kind}`}>{map[kind]}</span>;
}

function QuestionSkeleton({ analysis }: { analysis: ExerciseAnalysis }) {
  const count = Math.min(analysis.questionCount, 10);
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
        {Array.from({ length: count }).map((_, i) => {
          const q = analysis.questions[i];
          if (analysis.exerciseType === "multiple_choice") {
            return <div className="paper-question" key={i}><b>{i + 1}.</b> {q?.textPattern || "Question structure"}<div className="choices"><span>A. option</span><span>B. option</span><span>C. option</span></div></div>;
          }
          if (analysis.exerciseType === "matching") {
            return <div className="match-row" key={i}><span>{i + 1}. Item</span><span>Answer</span></div>;
          }
          if (analysis.exerciseType === "true_false") {
            return <div className="paper-question" key={i}><b>{i + 1}.</b> {q?.textPattern || "Statement"} <strong>True / False</strong></div>;
          }
          return <div className="paper-question" key={i}><b>{i + 1}.</b> {q?.textPattern || "Exercise item"} <span className="answer-line" /></div>;
        })}
      </div>
    </div>
  );
}

export function TeacherSheetFlow() {
  const [step, setStep] = useState<Step>("source");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [analysis, setAnalysis] = useState<ExerciseAnalysis>(initialAnalysis);
  const [engine, setEngine] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => file?.type.startsWith("image/") ? URL.createObjectURL(file) : "", [file]);

  function choose(ref: React.RefObject<HTMLInputElement | null>) { ref.current?.click(); }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setError("");
    setStep("preview");
  }

  async function runAnalysis() {
    if (!file && !text.trim()) return;
    setStep("analyzing");
    setError("");
    setWarning("");
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      if (text.trim()) form.append("text", text.trim());
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analysis failed");
      const result = body as AnalyzeResponse;
      setOcrText(result.ocrText);
      setAnalysis(result.analysis);
      setEngine(result.engine);
      setWarning(result.warning || "");
      setStep("decoded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setStep(file ? "preview" : "source");
    }
  }

  function reset() {
    setStep("source"); setFile(null); setText(""); setOcrText(""); setAnalysis(initialAnalysis); setWarning(""); setError("");
  }

  const update = <K extends keyof ExerciseAnalysis>(key: K, value: ExerciseAnalysis[K]) => setAnalysis((a) => ({ ...a, [key]: value }));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">T</div>
        <div><strong>TeacherSheet</strong><small>Exercise Structure V1</small></div>
        <div className="scope-chip">שלב 1</div>
      </header>

      <section className="progress-row" aria-label="progress">
        <span className={step === "source" || step === "preview" ? "active" : "done"}>1. קליטה</span>
        <i />
        <span className={step === "analyzing" || step === "decoded" ? "active" : step === "draft" ? "done" : ""}>2. פענוח</span>
        <i />
        <span className={step === "draft" ? "active" : ""}>3. טיוטת מבנה</span>
      </section>

      {step === "source" && (
        <section className="screen-card hero-screen">
          <div className="eyebrow">CREATE FROM AN EXAMPLE</div>
          <h1>הצג למערכת את סוג התרגיל</h1>
          <p>צלם דף תרגול או העלה קובץ. בשלב הזה המערכת מפענחת רק את מבנה התרגיל — ללא אוצר מילים, בדיקות או דף סופי.</p>
          <div className="source-grid">
            <button onClick={() => choose(cameraRef)}><FileIcon kind="camera" /><b>צלם דף</b><small>מצלמת הטלפון</small></button>
            <button onClick={() => choose(imageRef)}><FileIcon kind="image" /><b>תמונה</b><small>JPG / PNG / WEBP</small></button>
            <button onClick={() => choose(pdfRef)}><FileIcon kind="pdf" /><b>PDF</b><small>דף או מסמך</small></button>
            <button onClick={() => choose(wordRef)}><FileIcon kind="word" /><b>Word</b><small>DOCX</small></button>
          </div>
          <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={handleFile} />
          <input ref={imageRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/tiff" onChange={handleFile} />
          <input ref={pdfRef} hidden type="file" accept="application/pdf" onChange={handleFile} />
          <input ref={wordRef} hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFile} />
          <div className="or"><span>או לצורכי בדיקה</span></div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="הדבק כאן טקסט של תרגיל לבדיקת מנגנון הפענוח..." />
          {error && <div className="error-box">{error}</div>}
          <button className="primary" disabled={!text.trim()} onClick={runAnalysis}>פענח טקסט</button>
        </section>
      )}

      {step === "preview" && file && (
        <section className="screen-card">
          <button className="back" onClick={() => setStep("source")}>→ חזרה</button>
          <div className="screen-heading"><div><div className="eyebrow">SOURCE PREVIEW</div><h1>הדוגמה נקלטה</h1></div><span className="status-dot">מוכן לפענוח</span></div>
          <div className="preview-layout">
            <div className="file-preview">
              {previewUrl ? <img src={previewUrl} alt="תצוגת דף התרגול" /> : <div className="document-placeholder"><strong>{file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"}</strong><span>{file.name}</span></div>}
            </div>
            <div className="file-details">
              <label>קובץ</label><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
              <div className="pipeline-box"><b>מה יקרה עכשיו?</b><span>1. Google Document AI יקרא את הדף</span><span>2. ChatGPT יזהה את מבנה התרגיל</span><span>3. תוכל לתקן את הפענוח לפני יצירת הטיוטה</span></div>
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
          <button className="primary" onClick={runAnalysis}>פענח את סוג התרגיל</button>
        </section>
      )}

      {step === "analyzing" && (
        <section className="screen-card analyzing">
          <div className="scan-sheet"><div className="scan-line" /></div>
          <h1>מפענח את דף התרגול</h1>
          <p>קורא טקסט, מיקום ופריסה — ואז מזהה את סוג התרגיל והמבנה שלו.</p>
          <div className="analysis-steps"><span className="done">✓ קריאת מקור</span><span className="working">● ניתוח מבנה</span><span>○ יצירת מודל תרגיל</span></div>
        </section>
      )}

      {step === "decoded" && (
        <section className="screen-card">
          <div className="screen-heading"><div><div className="eyebrow">STRUCTURE FOUND</div><h1>זה המבנה שמצאנו</h1></div><span className="confidence">{Math.round(analysis.confidence * 100)}% ביטחון</span></div>
          {warning && <div className="warning-box">{warning}</div>}
          <div className="engine-note">Engine: <b>{engine}</b></div>
          <div className="decoded-grid">
            <div className="form-panel">
              <label>סוג התרגיל<select value={analysis.exerciseType} onChange={(e) => update("exerciseType", e.target.value as ExerciseType)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>כותרת<input value={analysis.title} onChange={(e) => update("title", e.target.value)} /></label>
              <label>הוראות<textarea value={analysis.instructions} onChange={(e) => update("instructions", e.target.value)} /></label>
              <div className="two-cols"><label>מספר שאלות<input type="number" min="1" max="30" value={analysis.questionCount} onChange={(e) => update("questionCount", Math.max(1, Math.min(30, Number(e.target.value))))} /></label><label>פורמט תשובה<select value={analysis.answerFormat} onChange={(e) => update("answerFormat", e.target.value as ExerciseAnalysis["answerFormat"])}><option value="blank">Blank</option><option value="choice">Choice</option><option value="matching">Matching</option><option value="true_false">True / False</option><option value="open">Open</option></select></label></div>
              <label className="toggle-row"><input type="checkbox" checked={analysis.hasWordBank} onChange={(e) => update("hasWordBank", e.target.checked)} /><span>קיים Word Bank במבנה המקורי</span></label>
              <details><summary>הטקסט שנקרא מהדף</summary><pre>{ocrText}</pre></details>
            </div>
            <div className="blueprint-panel"><div className="blueprint-title">Structure preview</div><QuestionSkeleton analysis={{ ...analysis, questionCount: Math.min(analysis.questionCount, 5) }} /></div>
          </div>
          <div className="action-row"><button className="secondary" onClick={reset}>התחל מחדש</button><button className="primary" onClick={() => setStep("draft")}>צור טיוטת דף מבנית</button></div>
        </section>
      )}

      {step === "draft" && (
        <section className="screen-card draft-screen">
          <div className="screen-heading"><div><div className="eyebrow">STRUCTURAL DRAFT</div><h1>טיוטת דף התרגול</h1></div><span className="status-dot">מבנה בלבד</span></div>
          <div className="scope-warning"><b>גבול גרסה זו:</b> זהו דף מבני בלבד. עדיין אין כאן הכנסת אוצר מילים, בדיקות איכות, Answer Key או הפקת הדף הסופי.</div>
          <QuestionSkeleton analysis={analysis} />
          <div className="action-row"><button className="secondary" onClick={() => setStep("decoded")}>ערוך פענוח</button><button className="primary" onClick={reset}>נתח דוגמה נוספת</button></div>
        </section>
      )}
    </main>
  );
}
