// A visitor who opens a shared personality link (?p=...#quiz) sees a short note above the quiz:
// what their friend got, then an invitation to take the quiz. Nothing else on the page changes.
// The link carries only a persona name, its Latin name and an emoji; each is checked strictly and
// written with textContent, so a crafted link cannot inject markup, links or long text.

function decode(p) {
  try {
    const b = p.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(b + "===".slice((b.length + 3) % 4)))));
  } catch (e) { return null; }
}

const NAME = /^[\p{L}\p{M}'’ -]{2,40}$/u;            // letters only: no digits, links or symbols
const ICON = /^[\p{Extended_Pictographic}️‍]{1,4}$/u;

function sharedPersona() {
  const raw = new URLSearchParams(window.location.search).get("p");
  if (!raw || raw.length > 400) return null;
  const d = decode(raw);
  if (!d || typeof d.n !== "string" || !NAME.test(d.n.trim())) return null;
  return {
    name: d.n.trim(),
    latin: typeof d.l === "string" && NAME.test(d.l.trim()) ? d.l.trim() : "",
    icon: typeof d.i === "string" && ICON.test(d.i) ? d.i : "",
  };
}

export function showSharedPersona() {
  const persona = sharedPersona();
  const root = document.getElementById("ff-widget-root");
  if (!persona || !root) return;
  const note = document.createElement("aside");
  note.className = "shared-persona";
  note.setAttribute("aria-label", "نتيجة تشاركات معاك");
  const kicker = document.createElement("p");
  kicker.className = "shared-persona-kicker";
  kicker.textContent = "تشاركات معاك هاد الشخصية العطرية";
  const name = document.createElement("p");
  name.className = "shared-persona-name";
  name.textContent = (persona.icon ? persona.icon + " " : "") + persona.name;
  note.append(kicker, name);
  if (persona.latin) {
    const latin = document.createElement("p");
    latin.className = "shared-persona-latin"; latin.lang = "fr"; latin.dir = "ltr";
    latin.textContent = persona.latin;
    note.append(latin);
  }
  const cta = document.createElement("p");
  cta.className = "shared-persona-cta";
  cta.textContent = "دابا دورك: جاوب على الأسئلة واكتشف شخصيتك العطرية ✨";
  note.append(cta);
  root.parentNode.insertBefore(note, root);
  // the note steps aside once the visitor starts answering
  root.addEventListener("click", () => note.remove(), { once: true });
}
