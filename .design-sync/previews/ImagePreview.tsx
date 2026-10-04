import { ImagePreview } from "@timely/ui";

const inADay = () => new Date(Date.now() + 24 * 3_600_000).toISOString();

// GET /chats/images/:id serves the sample image (a photo of a planning wall).

export const Thumbnail = () => (
  <div className="flex gap-2 p-4" style={{ width: 360 }}>
    <ImagePreview image={{ id: "img_receipt", name: "planning-wall.jpg", expiresAt: inADay() }} />
  </div>
);

export const Large = () => (
  <div className="p-4" style={{ width: 360 }}>
    <ImagePreview large image={{ id: "img_receipt", name: "planning-wall.jpg", expiresAt: inADay() }} />
  </div>
);

export const Removed = () => (
  <div className="p-4" style={{ width: 360 }}>
    <ImagePreview
      image={{ id: "img_1", name: "receipt.jpg", expiresAt: inADay(), deletedAt: new Date().toISOString() }}
    />
  </div>
);
