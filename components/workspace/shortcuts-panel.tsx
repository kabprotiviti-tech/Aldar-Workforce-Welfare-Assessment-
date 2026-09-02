const SHORTCUTS: Array<[string, string]> = [
  ["j / k", "Move between requirements"],
  ["1–4", "Set compliance status"],
  ["/", "Search"],
  ["Enter", "Open requirement"],
  ["Esc", "Close"],
  ["Ctrl / ⌘ K", "Open command palette"],
];

export function ShortcutsPanel() {
  return (
    <div className="border border-hairline">
      <table className="w-full text-left text-sm">
        <tbody>
          {SHORTCUTS.map(([key, action]) => (
            <tr key={key} className="border-b border-hairline last:border-b-0">
              <td className="w-32 px-3 py-2 font-medium text-ink">{key}</td>
              <td className="px-3 py-2 text-ink-secondary">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
