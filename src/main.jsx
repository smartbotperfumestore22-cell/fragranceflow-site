// Order matters: config first (sets window.__FF_CONFIG__ and the demo catalog), then the quiz, then the landing page.
import "./config.js";
import "./site.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./widget/App.jsx";
import { startSite } from "./site.js";

createRoot(document.getElementById("ff-widget-root")).render(<App />);
startSite();
