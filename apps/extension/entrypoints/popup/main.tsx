import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../../src/ui/app";
import "../../src/ui/style.css";

// The popup is the wallet, not a launcher: everything the options page can do is
// reachable here, without opening a tab. The flag only switches layout rules in
// style.css (fixed width, one scroll area).
document.body.dataset.surface = "popup";

const container = document.getElementById("root");
if (!container) throw new Error("Popup root element is missing.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
