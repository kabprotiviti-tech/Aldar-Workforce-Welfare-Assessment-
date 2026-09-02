"use client";

import { useState } from "react";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";
import { Card } from "@/components/ds/card";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { Tabs } from "@/components/ds/tabs";
import { FilterChip } from "@/components/ds/filter-chip";
import { Drawer } from "@/components/ds/drawer";
import { Field } from "@/components/ds/field";
import { Textarea } from "@/components/ds/textarea";
import { RadioGroup } from "@/components/ds/radio-group";
import { ProgressBar } from "@/components/ds/progress-bar";
import { Stat } from "@/components/ds/stat";
import { EmptyState } from "@/components/ds/empty-state";
import { ToastProvider, ToastVisual, useToast, type ToastTone } from "@/components/ds/toast";

const PILL_TONES: PillTone[] = ["neutral", "ok", "warn", "bad", "info"];
const TOAST_TONES: ToastTone[] = ["ok", "warn", "bad", "info"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ds-line py-8 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold text-ds-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ToastTriggerRow() {
  const { show } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      {TOAST_TONES.map((tone) => (
        <Button
          key={tone}
          variant="secondary"
          onClick={() =>
            show({ tone, title: `${tone.toUpperCase()} toast`, description: "Triggered from the gallery." })
          }
        >
          Trigger {tone}
        </Button>
      ))}
    </div>
  );
}

function GalleryContent() {
  const [chipSelected, setChipSelected] = useState<Record<string, boolean>>({
    key: true,
    open: false,
    overdue: false,
  });
  const [radioValue, setRadioValue] = useState("compliant");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fieldValue, setFieldValue] = useState("");

  return (
    <div className="min-h-screen bg-ds-bg">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold text-ds-ink">Component gallery</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Every component in every state, for visual and interaction review.</p>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="primary" disabled>
            Primary disabled
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="secondary" disabled>
            Secondary disabled
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="ghost" disabled>
            Ghost disabled
          </Button>
        </div>
      </Section>

      <Section title="Pill / status badge">
        <div className="flex flex-wrap gap-2">
          {PILL_TONES.map((tone) => (
            <Pill key={tone} tone={tone}>
              {tone}
            </Pill>
          ))}
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <p className="text-sm font-medium text-ds-ink">Card title</p>
          <p className="mt-1 text-sm text-ds-ink-2">
            Resting elevation (shadow level 1), 10px radius, hairline border.
          </p>
        </Card>
      </Section>

      <Section title="Table">
        <div className="grid gap-6">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Requirement</TableHeaderCell>
                <TableHeaderCell numeric>Entities assessed</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Legal working hours</TableCell>
                <TableCell numeric>73</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Health and safety at work</TableCell>
                <TableCell numeric>68</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Clear inductions</TableCell>
                <TableCell numeric>1,024</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="rounded-ds-card border border-ds-line p-4">
            <p className="mb-3 text-xs font-medium text-ds-ink-2">Empty state</p>
            <EmptyState title="No rows" description="Nothing matches the current filter." />
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          items={[
            { id: "overview", label: "Overview", content: <p className="text-sm text-ds-ink-2">Overview panel content.</p> },
            { id: "history", label: "History", content: <p className="text-sm text-ds-ink-2">History panel content.</p> },
            { id: "settings", label: "Settings", content: <p className="text-sm text-ds-ink-2">Settings panel content.</p> },
          ]}
        />
      </Section>

      <Section title="Filter chip">
        <div className="flex flex-wrap gap-2">
          <FilterChip selected={chipSelected.key} onClick={() => setChipSelected((s) => ({ ...s, key: !s.key }))}>
            Key requirements only
          </FilterChip>
          <FilterChip selected={chipSelected.open} onClick={() => setChipSelected((s) => ({ ...s, open: !s.open }))}>
            Open
          </FilterChip>
          <FilterChip
            selected={chipSelected.overdue}
            onClick={() => setChipSelected((s) => ({ ...s, overdue: !s.overdue }))}
          >
            Overdue
          </FilterChip>
        </div>
      </Section>

      <Section title="Drawer">
        <div className="flex items-start gap-6">
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <div className="max-w-xs rounded-ds-card border border-ds-line bg-ds-surface p-3 text-xs text-ds-ink-2">
            Static preview of the drawer panel&apos;s look — see it live via the button (shadow level 2, focus
            moves into it, Escape closes and returns focus).
          </div>
        </div>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Requirement detail">
          <p className="text-sm text-ds-ink-2">Drawer content goes here — evidence, remark, closure action.</p>
        </Drawer>
      </Section>

      <Section title="Field">
        <div className="grid max-w-md gap-4">
          <Field
            label="Entity name"
            placeholder="e.g. Seed General Contractor LLC"
            value={fieldValue}
            onChange={(event) => setFieldValue(event.target.value)}
            helperText="As it appears in the report header."
          />
          <Field label="Entity code" defaultValue="SEED-GC-1" error="This code is already in use." />
        </div>
      </Section>

      <Section title="Textarea">
        <div className="grid max-w-md gap-4">
          <Textarea label="Remark" placeholder="What did the evidence show?" helperText="Required for No, Unclear, or Not Applicable." />
          <Textarea label="Remark" defaultValue="Cannot edit — item is locked." disabled />
        </div>
      </Section>

      <Section title="Radio group (pill options)">
        <RadioGroup
          name="compliance-status"
          label="Compliance status"
          value={radioValue}
          onChange={setRadioValue}
          options={[
            { value: "compliant", label: "Compliant" },
            { value: "partial", label: "Partial" },
            { value: "not-compliant", label: "Not compliant" },
            { value: "not-applicable", label: "Not applicable" },
          ]}
        />
      </Section>

      <Section title="Progress bar">
        <div className="grid max-w-sm gap-4">
          <ProgressBar label="Not started" value={0} />
          <ProgressBar label="In progress" value={45} />
          <ProgressBar label="Complete" value={100} />
        </div>
      </Section>

      <Section title="Stat">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Overall compliance" value="87%" delta="+4pts vs. last cycle" deltaTone="ok" />
          <Stat label="Open findings" value={12} delta="+3 vs. last cycle" deltaTone="warn" />
          <Stat label="Overdue actions" value={2} delta="+2 vs. last cycle" deltaTone="bad" />
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState
          title="No cycles yet"
          description="Create a cycle to start planning assessments."
          action={<Button variant="primary">Create a cycle</Button>}
        />
      </Section>

      <Section title="Toast">
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-3">
            {TOAST_TONES.map((tone) => (
              <ToastVisual key={tone} tone={tone} title={`${tone.toUpperCase()} toast`} description="Static preview of this tone." />
            ))}
          </div>
          <ToastTriggerRow />
        </div>
      </Section>
      </div>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <ToastProvider>
      <GalleryContent />
    </ToastProvider>
  );
}
