import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../../src/ui/app";
import "../../src/ui/style.css";

// Same tree as the popup, laid out for a full tab. This page is what the
// first-run flow opens and what the approval window loads with `?approve=`.
document.body.dataset.surface = "page";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root container.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
