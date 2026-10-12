import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./shell.css";

// Keep UI preferences saved before the Mindbox -> Inkism rename.
try {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !/^mindbox[.-]/.test(key)) continue;
    const renamed = `inkism${key.slice("mindbox".length)}`;
    const value = localStorage.getItem(key);
    if (value !== null && localStorage.getItem(renamed) === null) localStorage.setItem(renamed, value);
  }
} catch {
  // storage can be unavailable; preferences then fall back to defaults
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
