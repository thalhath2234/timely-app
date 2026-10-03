import { PendingImages } from "@timely/ui";
import { useState } from "react";

const inADay = () => new Date(Date.now() + 24 * 3_600_000).toISOString();

function Pending({ names }: { names: string[] }) {
  const [images, setImages] = useState(() =>
    names.map((name, i) => ({ id: `img_pending_${i}`, name, expiresAt: inADay() })),
  );
  return (
    <div className="p-4" style={{ width: 520 }}>
      <PendingImages images={images} remove={(id) => setImages((all) => all.filter((i) => i.id !== id))} />
      <p className="text-xs text-muted-foreground">
        One receipt per message · up to 5 photos · images removed after confirmation or 24 hours
      </p>
    </div>
  );
}

export const SinglePhoto = () => <Pending names={["planning-wall.jpg"]} />;

export const SeveralPhotos = () => (
  <Pending names={["sprint-wall-left.jpg", "sprint-wall-center.jpg", "sprint-wall-right.jpg"]} />
);
