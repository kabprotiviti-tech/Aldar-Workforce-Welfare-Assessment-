"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getRule } from "@/lib/rules/compliance/registry";

/**
 * Editing a rule's thresholds (this prompt: "thresholds ... are editable
 * by an admin, versioned"). The edit is a *supersede*, never an update:
 * a new version row is inserted and the old one deactivated, because
 * every stored evaluation is stamped with the definition that produced it
 * and mutating that row in place would silently rewrite the basis of past
 * results. The database enforces this too — a definition an evaluation
 * points at is immutable except for `active`
 * (0022_rule_engine.sql's rule_definitions_immutable_once_used).
 *
 * Authorization is RLS: rule_definitions grants insert/update only under
 * is_admin() (0006_rules_measurement.sql).
 */

export type ThresholdUpdateResult = { ok: true; version: number } | { ok: false; message: string };

export async function reviseRuleThresholds(code: string, thresholds: unknown, legalReference?: string): Promise<ThresholdUpdateResult> {
  const rule = getRule(code);
  if (!rule) {
    return { ok: false, message: `No rule is implemented for code "${code}".` };
  }

  // Validate against the rule's own schema before storing. A threshold
  // that the rule can't parse would make every future evaluation of it a
  // configuration error rather than a result.
  const check = rule.run({ facts: {}, quantitative: {}, assessmentDate: "2000-01-01" }, thresholds);
  if (!check.ok) {
    return { ok: false, message: check.configError };
  }

  const supabase = await createSupabaseServerClient();

  const { data: current, error: readError } = await supabase
    .from("rule_definitions")
    .select("id, version, module, requirement_id, title, description, input_fact_keys, quantitative_keys, explanation_template, legal_reference")
    .eq("code", code)
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) return { ok: false, message: readError.message };
  if (!current) return { ok: false, message: `No active rule definition for "${code}".` };

  const nextVersion = (current.version as number) + 1;

  // Deactivate first: the partial unique index allows only one active
  // version per code, so inserting while the old row is still active
  // would be rejected.
  const { error: deactivateError } = await supabase.from("rule_definitions").update({ active: false }).eq("id", current.id);
  if (deactivateError) return { ok: false, message: deactivateError.message };

  const { data: inserted, error: insertError } = await supabase
    .from("rule_definitions")
    .insert({
      code,
      module: current.module,
      requirement_id: current.requirement_id,
      title: current.title,
      description: current.description,
      input_fact_keys: current.input_fact_keys,
      quantitative_keys: current.quantitative_keys,
      explanation_template: current.explanation_template,
      threshold: thresholds,
      legal_reference: legalReference ?? current.legal_reference,
      version: nextVersion,
      active: true,
    })
    .select("id")
    .single();
  if (insertError) {
    // Put the previous version back so the rule isn't left with no active
    // definition at all.
    await supabase.from("rule_definitions").update({ active: true }).eq("id", current.id);
    return { ok: false, message: insertError.message };
  }

  const { data: userData } = await supabase.auth.getUser();
  await writeAudit(
    userData.user?.id ?? null,
    "rule_definition.revise",
    "rule_definition",
    inserted.id as string,
    { code, version: current.version, id: current.id },
    { code, version: nextVersion, thresholds },
  );

  revalidatePath("/app/settings");
  return { ok: true, version: nextVersion };
}
