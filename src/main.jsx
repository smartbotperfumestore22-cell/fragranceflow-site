// Order matters: config first (sets window.__FF_CONFIG__ and the catalog), then the landing page.
// The quiz (src/widget/App.jsx) is loaded only when needed, so the homepage loads faster.
import { catalogReady } from "./config.js";
import "./site.css";
import "./track.js"; // window.track for the site pages (the quiz brings its own identical one)
import { startSite } from "./site.js";
import { showSharedPersona } from "./share-landing.js";

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

// the catalogue arrives first (a small file: only the store's perfumes on a store link), then the page starts
catalogReady.then(() => {
  startSite({ loadQuiz });
  showSharedPersona(); // note above the quiz when the visitor opened a shared personality link
});
