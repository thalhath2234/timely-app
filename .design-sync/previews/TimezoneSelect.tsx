import { TimezoneSelect } from "@timely/ui";
import { useState } from "react";

export const WorkingHours = () => {
  const [tz, setTz] = useState("Europe/Berlin");
  return (
    <div className="w-[480px] p-4">
      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-xs text-muted-foreground">Timezone</span>
        <TimezoneSelect value={tz} onChange={setTz} />
      </label>
    </div>
  );
};

export const AmericaZone = () => {
  const [tz, setTz] = useState("America/New_York");
  return (
    <div className="w-[480px] p-4">
      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-xs text-muted-foreground">Send digests in</span>
        <TimezoneSelect value={tz} onChange={setTz} className="w-full" />
      </label>
    </div>
  );
};
