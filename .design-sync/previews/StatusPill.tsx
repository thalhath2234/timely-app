import type React from "react";
import { StatusPill } from "@timely/ui";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-6">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </div>
);

export const AllStatuses = () => (
  <div className="flex flex-col gap-3 p-4" style={{ width: 320 }}>
    <Row label="idle"><StatusPill status="idle" /></Row>
    <Row label="queued"><StatusPill status="queued" /></Row>
    <Row label="running"><StatusPill status="running" phase="plan" /></Row>
    <Row label="running · apply"><StatusPill status="running" phase="apply" /></Row>
    <Row label="approval"><StatusPill status="approval" /></Row>
    <Row label="failed"><StatusPill status="failed" /></Row>
    <Row label="stopped"><StatusPill status="stopped" /></Row>
  </div>
);

export const InHeader = () => (
  <div className="p-4" style={{ width: 480 }}>
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Plan the website relaunch week</p>
        <p className="text-xs text-muted-foreground">Waiting for your decision</p>
      </div>
      <StatusPill status="approval" />
    </div>
  </div>
);
