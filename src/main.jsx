// Order matters: config first (sets window.__FF_CONFIG__ and the catalog), then the landing page.
// The quiz (src/widget/App.jsx) is loaded only when needed, so the homepage loads faster.
import "./config.js";
import "./site.css";
import { startSite } from "./site.js";

let quizReady = null;
function loadQuiz() {
  if (!quizReady) {
    quizReady = Promise.all([import("react"), import("react-dom/client"), import("./widget/App.jsx")])
      .then(([React, { createRoot }, { default: App }]) => {
        const root = document.getElementById("ff-widget-root");
        root.textContent = "";
        createRoot(root).render(React.createElement(App));
        // resolves once the quiz has registered window.FF_OPEN
        return new Promise((resolve) => {
          (function wait() { window.FF_OPEN ? resolve() : requestAnimationFrame(wait); })();
        });
      });
  }
  return quizReady;
}

startSite({ loadQuiz });
