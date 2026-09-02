import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Sets data-theme on <html> before first paint, so there is no flash of the
 * wrong theme. Reads a stored choice if one exists; otherwise reads
 * prefers-color-scheme exactly once and writes it as the stored choice, so a
 * later change to the OS setting never silently re-themes a returning visitor.
 */
export function ThemeScript() {
  const script = `
    (function () {
      try {
        var key = ${JSON.stringify(THEME_STORAGE_KEY)};
        var stored = localStorage.getItem(key);
        var theme = stored;
        if (!theme) {
          theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "ink" : "paper";
          localStorage.setItem(key, theme);
        }
        document.documentElement.setAttribute("data-theme", theme);
      } catch (e) {
        document.documentElement.setAttribute("data-theme", "paper");
      }
    })();
  `;
   
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
