import { IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";

/**
 * IBM Plex Sans carries everything — headings, body, labels. Designed for
 * technical/engineering interfaces rather than repurposed from a marketing
 * face, which fits a field-record register: workmanlike, not decorative.
 *
 * IBM Plex Serif is reserved exclusively for large display numerals (see
 * .numeral-display in globals.css) so a figure reads as a measurement
 * rather than as typographic decoration. Same family, same metrics as the
 * sans — "unmistakably different" without the pairing feeling arbitrary.
 * See docs/decisions.md.
 */
export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});

export const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-plex-serif",
});
