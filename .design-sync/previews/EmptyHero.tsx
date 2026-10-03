import { EmptyHero } from "@timely/ui";

export const FullPage = () => (
  <div className="px-8" style={{ width: 760 }}>
    <EmptyHero onPick={() => {}} />
  </div>
);

export const Compact = () => (
  <div className="px-4" style={{ width: 420 }}>
    <EmptyHero compact onPick={() => {}} />
  </div>
);
