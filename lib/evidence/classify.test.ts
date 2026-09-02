import { describe, expect, it } from "vitest";
import { classifyDocument } from "./classify";

function pdf(filename: string) {
  return { filename, mimeType: "application/pdf" };
}

describe("classifyDocument", () => {
  it("classifies a WPS report by filename", () => {
    expect(classifyDocument(pdf("WPS_Report_June2026.pdf"))).toBe("wps_report");
    expect(classifyDocument(pdf("wage protection system export.pdf"))).toBe("wps_report");
  });

  it("classifies a payroll register", () => {
    expect(classifyDocument(pdf("Payroll_Register_Q2.pdf"))).toBe("payroll_register");
  });

  it("classifies an employment contract, requiring both keywords", () => {
    expect(classifyDocument(pdf("Employment_Contract_JohnSmith.pdf"))).toBe("employment_contract");
    expect(classifyDocument(pdf("Contract_JohnSmith.pdf"))).toBeNull();
  });

  it("classifies a recruitment agreement", () => {
    expect(classifyDocument(pdf("Recruitment_Agreement_2026.pdf"))).toBe("recruitment_agreement");
  });

  it("classifies a passport register", () => {
    expect(classifyDocument(pdf("Passport_Register.xlsx"))).toBe("passport_register");
  });

  it("classifies an insurance schedule", () => {
    expect(classifyDocument(pdf("Insurance_Schedule_2026.pdf"))).toBe("insurance_schedule");
  });

  it("classifies an accommodation contract, requiring a lease/tenancy/contract keyword too", () => {
    expect(classifyDocument(pdf("Accommodation_Lease_Agreement.pdf"))).toBe("accommodation_contract");
    expect(classifyDocument(pdf("Accommodation_Photos.pdf"))).toBeNull();
  });

  it("classifies a civil defence certificate", () => {
    expect(classifyDocument(pdf("Civil_Defence_Certificate.pdf"))).toBe("civil_defence_certificate");
    expect(classifyDocument(pdf("civil defense cert.pdf"))).toBe("civil_defence_certificate");
  });

  it("classifies an occupancy schedule", () => {
    expect(classifyDocument(pdf("Occupancy_Schedule.xlsx"))).toBe("occupancy_schedule");
  });

  it("classifies an approved drawing", () => {
    expect(classifyDocument(pdf("Approved_Drawing_Block_A.pdf"))).toBe("approved_drawing");
    expect(classifyDocument(pdf("Floor Plan Level 2.pdf"))).toBe("approved_drawing");
  });

  it("classifies an induction register, even when 'worker' also appears", () => {
    expect(classifyDocument(pdf("Worker_Induction_Register.pdf"))).toBe("induction_register");
  });

  it("classifies a worker register", () => {
    expect(classifyDocument(pdf("Worker_Register_2026.xlsx"))).toBe("worker_register");
    expect(classifyDocument(pdf("Employee_Register.xlsx"))).toBe("worker_register");
  });

  it("classifies a vehicle registration", () => {
    expect(classifyDocument(pdf("Vehicle_Registration_Mulkiya.pdf"))).toBe("vehicle_registration");
  });

  it("classifies any image as a photo when no stronger filename signal matches", () => {
    expect(classifyDocument({ filename: "IMG_0231.jpg", mimeType: "image/jpeg" })).toBe("photo");
  });

  it("prefers a specific filename match over the generic photo fallback for an image file", () => {
    expect(classifyDocument({ filename: "Passport_Photo_JohnSmith.jpg", mimeType: "image/jpeg" })).toBe(
      "passport_register",
    );
  });

  it("returns null when nothing matches, rather than guessing", () => {
    expect(classifyDocument(pdf("Untitled Document 3.pdf"))).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(classifyDocument(pdf("PAYROLL REGISTER.PDF"))).toBe("payroll_register");
  });
});
