import { CatalogBrowser } from "@/components/catalog-browser";
import { formatBytes } from "@/lib/catalog";
import { loadCatalog } from "@/lib/load-catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const loaded = await loadCatalog();
  const catalog = loaded.catalog;

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Family library</p>
          <h1>The Husfelds</h1>
        </div>
        <p className="lede">
          Source stays on this machine. GitHub receives the app. The catalog is saved in the standard database. After
          the Vercel project exists, the files import into Blob, and that Blob is ingested into the vector database.
        </p>
      </header>

      <section className="pipeline" aria-label="Storage">
        <article>
          <span>Standard database</span>
          <strong>{loaded.databaseConfigured ? "Configured" : "Not set"}</strong>
          <p>
            {loaded.source === "database"
              ? "Reading the catalog from Prisma."
              : catalog
                ? "Local catalog is ready to sync."
                : "Set DATABASE_URL, then run npm run ingest."}
          </p>
        </article>
        <article>
          <span>Blob</span>
          <strong>{loaded.blobConfigured ? "Configured" : "After Vercel"}</strong>
          <p>npm run import:blob copies the files in once the Vercel Blob store exists.</p>
        </article>
        <article>
          <span>Vector database</span>
          <strong>{loaded.vectorConfigured ? "Configured" : "Not set"}</strong>
          <p>npm run ingest:vectors registers those Blob objects for embedding.</p>
        </article>
      </section>

      {loaded.notice ? <p className="notice">{loaded.notice}</p> : null}

      {catalog ? (
        <>
          <section className="stats" aria-label="Library totals">
            <article className="stat">
              <span>Captures</span>
              <strong>{catalog.stats.captures}</strong>
            </article>
            <article className="stat">
              <span>Live photos</span>
              <strong>{catalog.stats.livePhotos}</strong>
            </article>
            <article className="stat">
              <span>Stills</span>
              <strong>{catalog.stats.stills}</strong>
            </article>
            <article className="stat">
              <span>Videos</span>
              <strong>{catalog.stats.videos}</strong>
            </article>
            <article className="stat">
              <span>Size</span>
              <strong>{formatBytes(catalog.stats.bytes)}</strong>
            </article>
          </section>
          <CatalogBrowser catalog={catalog} />
        </>
      ) : (
        <section className="panel">
          <h2>Nothing ingested yet</h2>
          <p>From this machine, with the Source folder in place:</p>
          <code className="command">npm run ingest</code>
          <p>That writes the catalog into the standard database. The files stay out of GitHub.</p>
          <p>After the Vercel project and Blob store exist, run <code>npm run import:blob</code>, then <code>npm run ingest:vectors</code>.</p>
        </section>
      )}
    </main>
  );
}
