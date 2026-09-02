import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createRfiDocumentTemplate } from "@/lib/settings/actions";
import type { DbModule } from "@/lib/db/common";
import { Card } from "@/components/ds/card";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

const MODULES: { value: DbModule; label: string }[] = [
  { value: "employment_practices", label: "Employment Practices" },
  { value: "onboarding", label: "Onboarding" },
  { value: "accommodation", label: "Accommodation" },
];

export default async function RfiTemplatesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: templates }, ...requirementsByModule] = await Promise.all([
    supabase
      .from("rfi_document_templates")
      .select("id, module, name, description, rfi_document_template_requirements(requirement_id, requirements(title))")
      .is("deleted_at", null)
      .order("module"),
    ...MODULES.map(({ value }) =>
      supabase
        .from("checklist_templates")
        .select("requirements(id, sl_no, title)")
        .eq("module", value)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle(),
    ),
  ]);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">RFI document templates</h1>
        <p className="mt-1 text-sm text-ds-ink-2">
          Requested document types per module, and the requirement(s) each one evidences.
        </p>
      </div>

      <StatusBanner error={error} />

      {MODULES.map(({ value: module, label }, index) => {
        const moduleTemplates = (templates ?? []).filter((t) => t.module === module);
        const requirements = (
          (requirementsByModule[index]?.data?.requirements as { id: string; sl_no: number; title: string }[] | undefined) ?? []
        ).sort((a, b) => a.sl_no - b.sl_no);

        return (
          <div key={module}>
            <p className="text-sm font-medium text-ds-ink">{label}</p>

            <div className="mt-3 grid gap-6 lg:grid-cols-[2fr_1fr]">
              {moduleTemplates.length === 0 ? (
                <EmptyState title="No document templates yet" />
              ) : (
                <div className="grid gap-3">
                  {moduleTemplates.map((template) => {
                    const links = (template.rfi_document_template_requirements ?? []) as {
                      requirement_id: string;
                      requirements: { title: string } | { title: string }[] | null;
                    }[];
                    return (
                      <Card key={template.id}>
                        <p className="text-sm font-medium text-ds-ink">{template.name}</p>
                        {template.description && <p className="mt-1 text-sm text-ds-ink-2">{template.description}</p>}
                        <p className="mt-2 text-xs text-ds-ink-2">
                          Evidences:{" "}
                          {links
                            .map((link) => (Array.isArray(link.requirements) ? link.requirements[0]?.title : link.requirements?.title))
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </Card>
                    );
                  })}
                </div>
              )}

              <Card>
                <p className="text-sm font-medium text-ds-ink">Add a document template</p>
                {requirements.length === 0 ? (
                  <p className="mt-3 text-sm text-ds-ink-2">No active checklist template for this module yet.</p>
                ) : (
                  <form action={createRfiDocumentTemplate} className="mt-4 grid gap-3">
                    <input type="hidden" name="module" value={module} />
                    <Field label="Name" name="name" required placeholder="e.g. Payroll register" />
                    <Field label="Description" name="description" />
                    <fieldset>
                      <legend className="text-sm font-medium text-ds-ink">Evidences</legend>
                      <div className="mt-2 grid max-h-48 gap-1.5 overflow-y-auto">
                        {requirements.map((requirement) => (
                          <label key={requirement.id} className="flex items-start gap-2 text-sm text-ds-ink-2">
                            <input type="checkbox" name="requirement_ids" value={requirement.id} className="ds-focus-ring mt-0.5" />
                            {requirement.sl_no}. {requirement.title}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Button type="submit" variant="secondary" className="justify-self-start">
                      Add
                    </Button>
                  </form>
                )}
              </Card>
            </div>
          </div>
        );
      })}
    </div>
  );
}
