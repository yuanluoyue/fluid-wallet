import { PROTOCOL_VERSION } from "@fluid-wallet/protocol";
import type { CSSProperties } from "react";

const styles: Record<string, CSSProperties> = {
  root: {
    width: 320,
    padding: 16,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    color: "#0f172a",
    background: "#f8fafc",
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  badge: {
    display: "inline-block",
    marginTop: 8,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    color: "#92400e",
    background: "#fef3c7",
  },
  list: { margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 12, lineHeight: 1.8 },
  muted: { color: "#64748b" },
};

export function App() {
  return (
    <main style={styles.root}>
      <h1 style={styles.title}>Fluid Wallet</h1>
      <span style={styles.badge}>locked · scaffold</span>

      <ul style={styles.list}>
        <li>
          Protocol <span style={styles.muted}>v{PROTOCOL_VERSION}</span>
        </li>
        <li style={styles.muted}>Vault and DeepSeek routing land in MVP-02.</li>
      </ul>
    </main>
  );
}
