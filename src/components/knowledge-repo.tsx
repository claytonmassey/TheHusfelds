import { UploadDocuments } from "@/components/upload-documents";
import type { KnowledgeItem } from "@/lib/library-view";

export function KnowledgeRepo({ items }: { items: KnowledgeItem[] }) {
  return (
    <section className="knowledge">
      <UploadDocuments />
      {items.length === 0 ? (
        <p className="empty-list">Documents you add show up here after they are transcribed.</p>
      ) : (
        <ul className="knowledge-list">
          {items.map((item) => (
            <li key={item.sourcePath} className="knowledge-card">
              {item.kind === "IMAGE" ? (
                <img src={`/api/media?size=thumb&path=${encodeURIComponent(item.sourcePath)}`} alt="" />
              ) : (
                <span className="doc-mark">{item.extension.toUpperCase() || "FILE"}</span>
              )}
              <div>
                <h2>{item.filename}</h2>
                <p className="files">{item.kind === "IMAGE" ? "Photo" : item.extension === "pdf" ? "PDF" : "Text"}</p>
                {item.note ? <p>Context: {item.note}</p> : null}
                {item.excerpt ? <p className="upload-preview">{item.excerpt}</p> : <p className="upload-preview">No transcription yet.</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
