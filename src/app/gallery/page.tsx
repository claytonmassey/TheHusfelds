import { Gallery } from "@/components/gallery";
import { loadGallery } from "@/lib/library-view";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const images = await loadGallery();
  return (
    <main className="page-screen">
      <header className="page-heading">
        <p className="eyebrow">Photos</p>
        <h1>Gallery</h1>
        <p className="lede">Add photos here. Open an image to set its type and categories, then click a spot to tag a person or thing.</p>
      </header>
      <Gallery images={images} />
    </main>
  );
}
