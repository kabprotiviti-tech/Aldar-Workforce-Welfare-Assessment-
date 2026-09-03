import { getPhotoClass, UNDETERMINABLE_FROM_A_PHOTOGRAPH, type PhotoClass, type PhotoFieldDefinition } from "@/lib/vision/classes";

export const promptVersion = "photo.v1";

/**
 * The photograph analysis prompt, generated from the class vocabulary
 * (lib/vision/classes.ts) so the field list the model is given and the
 * field list the response is validated against are the same list.
 *
 * The constraint is the point of the feature, not a limitation of it
 * (this prompt), and it is stated to the model in those terms: a
 * photograph is a record of what was in front of the lens, and the
 * things an assessment most wants — area, ratios, temperature, occupancy
 * — are exactly the things it does not record. Saying so plainly gets a
 * better answer than a model quietly estimating and an assessor quietly
 * believing it.
 *
 * The prompt is not the enforcement. lib/vision/schema.ts has no field
 * for an undeterminable claim, and lib/vision/analyse.ts strips one out
 * of free text. This text exists so the model does not waste the attempt.
 */

function describeField(field: PhotoFieldDefinition): string {
  const shape =
    field.kind === "presence"
      ? 'set "observed" to present, absent or unclear'
      : field.kind === "count_in_frame"
        ? 'set "count_in_frame" to how many are visible IN THIS FRAME, and "observed" to present, absent or unclear'
        : field.kind === "text"
          ? 'set "verbatim_text" to the text exactly as it appears, and "observed" to present when you can read it, unclear when text is there but not legible, absent when there is none'
          : field.kind === "list"
            ? `set "values" to the applicable entries from: ${field.allowedValues!.join(", ")}`
            : 'set "condition" to one short descriptive phrase, and "observed" to present';

  return `- ${field.key}: ${field.description} — ${shape}.`;
}

export function buildPhotoSystemPrompt(photoClass: PhotoClass): string {
  const definition = getPhotoClass(photoClass)!;
  const fieldList = definition.fields.map(describeField).join("\n");
  const undeterminable = UNDETERMINABLE_FROM_A_PHOTOGRAPH.map((entry) => `- ${entry}`).join("\n");

  return `You are reading one photograph taken during a workforce welfare inspection in the United Arab Emirates. The photograph shows ${definition.subject}.

An assessor took this photograph and will read what you write next to the image itself. They decide what it means. You do not.

Report only these fields, and no others:
${fieldList}

What a photograph cannot establish — ever:
${undeterminable}

These are not difficult judgements you should attempt carefully. They are measurements and totals that a photograph does not contain. A frame shows what was in front of the lens: it does not carry a tape measure, a thermometer, a water sample, or a register of who sleeps in the room. Whenever any of them is relevant to what you are looking at, name it in "cannot_determine" and report nothing further about it. An estimate offered here would be read by an assessor as a reading, and would be wrong.

Rules — follow exactly, with no exceptions:
1. Report only what is visible in this photograph. Never infer what is outside the frame, what happened before or after it was taken, or what a fuller inspection would show.
2. Never calculate, measure, estimate, count beyond what is in frame, convert units, or compare anything against a threshold.
3. Never state or imply a compliance conclusion. Do not write that anything is compliant, non-compliant, adequate, inadequate, satisfactory, acceptable, a breach or a violation. Do not answer an inspection question. Do not rate, score or grade anything.
4. Never include a field named "status", "rating", "compliant" or "score" anywhere in your response, under any object, for any reason.
5. A count is always a count of what is visible in this frame, never a total. Six beds visible does not mean the room has six beds, and does not mean six people sleep here.
6. For a verbatim reading, copy the characters as printed, including any date exactly in the format shown. Do not reformat a date, do not convert it, and do not resolve an ambiguous one — an assessor will read the photograph and enter the date themselves.
7. Use "unclear" whenever the photograph does not settle the question. A guess presented as an observation is worse than an honest "unclear".
8. Set "confidence" to high, medium or low based on how clearly this photograph supports what you are reporting.
9. Include one reading object per field listed above. If a field is not applicable to what is in the frame, still include it, with "observed": "absent" or "unclear" and the other properties null.
10. "cannot_determine" must be present on every response and must name everything relevant that this photograph cannot establish, in plain sentences an assessor can read.
11. Respond with JSON only. No prose, no markdown code fences, no explanation before or after the JSON.

Respond with exactly this JSON shape:
{"readings": [{"field": "...", "observed": "present", "count_in_frame": null, "values": null, "verbatim_text": null, "condition": null, "confidence": "high"}], "cannot_determine": ["..."]}`;
}

/** The user-turn text accompanying the image. Kept short: the system prompt carries the contract. */
export function buildPhotoUserText(photoClass: PhotoClass, roomRef: string | null): string {
  const definition = getPhotoClass(photoClass)!;
  const where = roomRef ? ` The assessor recorded it against ${roomRef}.` : "";
  return `This photograph was classified by the assessor as: ${definition.label}.${where} Report the declared fields and name what the photograph cannot establish. Return JSON only.`;
}
