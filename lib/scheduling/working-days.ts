/**
 * UAE working-day arithmetic for report_due_date (this prompt: "report due
 * = actual_visit_date + 10 working days"). Stored once when the actual
 * visit date is recorded (lib/assessments/actions.ts), never recomputed on
 * read — CONTEXT.md's own "no arithmetic performed twice, silently"
 * instinct applied to dates the same way lib/rules/aggregate.ts applies it
 * to percentages.
 *
 * Weekend = Saturday/Sunday, the UAE government workweek in effect since
 * January 2022 (Monday-Friday working, Friday a working day for deadline
 * purposes) — not the older Sunday-Thursday week. Not specified by the
 * brief; see docs/decisions.md.
 *
 * Every date here is a plain calendar date (YYYY-MM-DD, no time-of-day) —
 * handled entirely in UTC so no local timezone can shift which calendar
 * day a date falls on.
 */

export type HolidaySet = ReadonlySet<string>;

const WEEKEND_DAYS = new Set([0, 6]); // Date.getUTCDay(): 0 = Sunday, 6 = Saturday.

export function holidaySetFromDates(dates: readonly string[]): HolidaySet {
  return new Set(dates);
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isUaeWeekend(date: Date): boolean {
  return WEEKEND_DAYS.has(date.getUTCDay());
}

export function isUaeWorkingDay(date: Date, holidays: HolidaySet): boolean {
  return !isUaeWeekend(date) && !holidays.has(toIsoDate(date));
}

/**
 * The date `count` UAE working days after `start` (`start` itself is never
 * counted, matching "actual_visit_date + 10 working days" reading as ten
 * days following the visit, not including it).
 */
export function addUaeWorkingDays(start: Date, count: number, holidays: HolidaySet): Date {
  if (count < 0) {
    throw new RangeError("count must be non-negative");
  }
  const cursor = new Date(start.getTime());
  let remaining = count;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isUaeWorkingDay(cursor, holidays)) {
      remaining -= 1;
    }
  }
  return cursor;
}

export const REPORT_DUE_WORKING_DAYS = 10;

/** report_due_date, as an ISO date string, from an actual_visit_date ISO date string. */
export function computeReportDueDate(actualVisitDateIso: string, holidays: HolidaySet): string {
  return toIsoDate(addUaeWorkingDays(parseIsoDate(actualVisitDateIso), REPORT_DUE_WORKING_DAYS, holidays));
}
