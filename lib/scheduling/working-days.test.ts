import { describe, expect, it } from "vitest";
import {
  addUaeWorkingDays,
  computeReportDueDate,
  holidaySetFromDates,
  isUaeWeekend,
  isUaeWorkingDay,
} from "./working-days";

const NO_HOLIDAYS = holidaySetFromDates([]);

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

describe("isUaeWeekend", () => {
  it("treats Saturday and Sunday as the weekend", () => {
    expect(isUaeWeekend(date("2026-09-05"))).toBe(true); // Saturday
    expect(isUaeWeekend(date("2026-09-06"))).toBe(true); // Sunday
  });

  it("treats Monday through Friday as working days, Friday included", () => {
    for (const iso of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
      expect(isUaeWeekend(date(iso))).toBe(false);
    }
  });
});

describe("isUaeWorkingDay", () => {
  it("a weekday with no holiday is a working day", () => {
    expect(isUaeWorkingDay(date("2026-09-09"), NO_HOLIDAYS)).toBe(true);
  });

  it("a weekday that is a public holiday is not a working day", () => {
    expect(isUaeWorkingDay(date("2026-12-02"), holidaySetFromDates(["2026-12-02"]))).toBe(false);
  });

  it("a weekend day is never a working day, holiday or not", () => {
    expect(isUaeWorkingDay(date("2026-09-05"), NO_HOLIDAYS)).toBe(false);
  });
});

describe("addUaeWorkingDays", () => {
  it("skips a weekend that falls within the count", () => {
    // Thu 2026-09-03 + 1 working day -> Fri 2026-09-04 (no weekend in between).
    expect(addUaeWorkingDays(date("2026-09-03"), 1, NO_HOLIDAYS).toISOString().slice(0, 10)).toBe("2026-09-04");
    // Thu 2026-09-03 + 2 working days -> Fri (1), skip Sat/Sun, Mon 2026-09-07 (2).
    expect(addUaeWorkingDays(date("2026-09-03"), 2, NO_HOLIDAYS).toISOString().slice(0, 10)).toBe("2026-09-07");
  });

  it("rejects a negative count", () => {
    expect(() => addUaeWorkingDays(date("2026-09-03"), -1, NO_HOLIDAYS)).toThrow(RangeError);
  });
});

describe("computeReportDueDate", () => {
  it("counts 10 working days, weekends only, with no holidays in range", () => {
    expect(computeReportDueDate("2026-09-02", NO_HOLIDAYS)).toBe("2026-09-16");
  });

  it("a holiday landing on a weekday inside the window pushes the due date later by one day", () => {
    const holidays = holidaySetFromDates(["2026-09-10"]); // Thursday, would otherwise count.
    expect(computeReportDueDate("2026-09-02", holidays)).toBe("2026-09-17");
  });

  it("a holiday that lands on what is already a weekend changes nothing", () => {
    const holidays = holidaySetFromDates(["2026-09-05"]); // Saturday, already non-working.
    expect(computeReportDueDate("2026-09-02", holidays)).toBe("2026-09-16");
  });

  it("real UAE National Day holidays (seeded in 0013_public_holidays.sql) shift the due date across them", () => {
    const holidays = holidaySetFromDates(["2026-12-02", "2026-12-03"]);
    expect(computeReportDueDate("2026-11-27", holidays)).toBe("2026-12-15");
  });
});
