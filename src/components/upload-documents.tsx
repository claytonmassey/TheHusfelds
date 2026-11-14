"use client";

import { useState, type FormEvent } from "react";

type UploadResult = {
  filename: string;
  alreadyStored: boolean;
  transcript: string;
  error?: string;
};

export function UploadDocuments({ onAdded }: { onAdded?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<UploadResult[]>([]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0 || pending) return;
    setPending(true);
    setResults([]);

    const next: UploadResult[] = [];
    for (const file of files) {
      setStatus(`Reading ${file.name}…`);
      const body = new FormData();
      body.set("file", file);
      try {
        const response = await fetch("/api/upload", { method: "POST", body });
        const payload = (await response.json()) as UploadResult & { error?: string };
        if (!response.ok) throw new Error(payload.error || "The upload failed.");
        next.push(payload);
      } catch (caught) {
        next.push({
          filename: file.name,
          alreadyStored: false,
          transcript: "",
          error: caught instanceof Error ? caught.message : "The upload failed.",
        });
      }
      setResults([...next]);
    }

    setPending(false);
    setStatus("");
    setFiles([]);
    if (next.some((result) => !result.error)) onAdded?.();
  }

  return (
    <section className="panel upload-panel">
      <form className="upload-form" onSubmit={onSubmit}>
        <label className="file-picker">
          <input
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.pdf,.txt,image/*,application/pdf,text/plain"
            onChange={(event) => setFiles([...(event.target.files ?? [])])}
          />
          <span>{files.length > 0 ? `${files.length} selected` : "Choose photos, PDFs, or text files"}</span>
        </label>
        <button type="submit" disabled={pending || files.length === 0}>
          {pending ? "Adding" : "Add to the library"}
        </button>
      </form>
      {status ? <p className="count">{status}</p> : null}
      {results.length > 0 ? (
        <ul className="upload-results">
          {results.map((result) => (
            <li key={result.filename}>
              <strong>{result.filename}</strong>
              <p>{result.error ? result.error : result.alreadyStored ? "Already in the library." : "Added to the library."}</p>
              {result.transcript ? <p className="upload-preview">{result.transcript}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
