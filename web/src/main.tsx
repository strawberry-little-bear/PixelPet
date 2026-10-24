import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./readability.css";
import "./game-companion-motion.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
