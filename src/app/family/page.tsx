import { FamilyTree } from "@/components/family-tree";
import { currentAccount } from "@/lib/accounts";
import { listKnownNames } from "@/lib/known-names";
import { loadGallery } from "@/lib/library-view";
import { readPeople, readTaggedPhotos } from "@/lib/photo-record";

export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const [people, images, tagged, account, names] = await Promise.all([readPeople(), loadGallery(), readTaggedPhotos(), currentAccount(), listKnownNames()]);
  const byPath = new Map(images.map((image) => [image.sourcePath, image]));
  const photos = tagged.flatMap((item) => {
    const image = byPath.get(item.sourcePath);
    if (!image) return [];
    return [
      {
        sourcePath: image.sourcePath,
        filename: image.filename,
        capturedAt: image.capturedAt,
        personIds: item.personIds,
        rotation: item.rotation,
      },
    ];
  });

  return (
    <main className="family-screen">
      <FamilyTree people={people} photos={photos} names={names} viewerId={account?.personId ?? null} />
    </main>
  );
}
