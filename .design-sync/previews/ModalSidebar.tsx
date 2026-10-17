import { DatePicker, GroupHint, GroupLabel, ListGroup, ListRow, ListSwitch, ModalSidebar, Select } from "@timely/ui";

export const ProjectProperties = () => (
  <div className="flex overflow-hidden rounded-2xl border border-border bg-background" style={{ width: 360, height: 460 }}>
    <ModalSidebar>
      <div className="flex flex-col gap-4">
        <ListGroup>
          <ListRow label="Workspace">
            <Select variant="row" value="w1" onChange={() => undefined} options={[{ value: "w1", label: "Studio", color: "#6E56CF" }]} />
          </ListRow>
          <ListRow label="Status">
            <Select variant="row" value="s2" onChange={() => undefined} options={[{ value: "s2", label: "Active", color: "#0090FF" }]} />
          </ListRow>
          <ListRow label="Priority">
            <Select variant="row" value="High" tint="#F76808" onChange={() => undefined} options={[{ value: "High", label: "High" }]} />
          </ListRow>
        </ListGroup>
        <div>
          <GroupLabel>Dates</GroupLabel>
          <ListGroup>
            <ListRow label="Start date">
              <DatePicker variant="row" mode="date" value="2024-05-06" onChange={() => undefined} />
            </ListRow>
            <ListRow label="Deadline">
              <DatePicker variant="row" mode="date" value="2024-06-28" onChange={() => undefined} />
            </ListRow>
            <ListRow label="Stages" meta="Discovery, Design, Build, Launch">
              <ListSwitch label="Stages" checked onChange={() => undefined} />
            </ListRow>
          </ListGroup>
          <GroupHint>Rows match the phone's grouped Settings cards.</GroupHint>
        </div>
      </div>
    </ModalSidebar>
  </div>
);
