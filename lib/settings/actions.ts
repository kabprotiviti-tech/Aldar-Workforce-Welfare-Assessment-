"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Admin-only at the RLS layer (public_holidays_write_admin, 0013_public_holidays.sql). */
export async function createPublicHoliday(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("public_holidays").insert({
    holiday_date: String(formData.get("holiday_date") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
  });
  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/settings");
  redirect("/app/settings");
}

export async function removePublicHoliday(holidayId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("public_holidays")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", holidayId);
  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/settings");
  redirect("/app/settings");
}
