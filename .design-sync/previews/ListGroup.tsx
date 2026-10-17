import { GroupHint, GroupLabel, ListGroup, ListRow, ListSwitch, Select } from "@timely/ui";
import { useState } from "react";

export const TaskDetails = () => {
  const [pinned, setPinned] = useState(false);
  return (
    <div style={{ width: 340 }} className="p-4">
      <GroupLabel aside="2 reserved">Schedule</GroupLabel>
      <ListGroup>
        <ListRow label="Status">
          <Select variant="row" value="s1" onChange={() => undefined} options={[{ value: "s1", label: "In progress", color: "#0090FF" }]} />
        </ListRow>
        <ListRow label="Pin task" meta="Auto-schedule will not move it">
          <ListSwitch label="Pin task" checked={pinned} onChange={setPinned} />
        </ListRow>
        <ListRow tone="add" label="Add time" onClick={() => undefined} />
        <ListRow tone="danger" label="Clear all time" onClick={() => undefined} />
      </ListGroup>
      <GroupHint>ETA Mon, Oct 19, 9:30 AM.</GroupHint>
    </div>
  );
};
