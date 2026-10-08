// Share the visitor's fragrance personality (results page, PAGE_MODE only).
// Self-contained: it only reads the persona it is given (name, icon, description) and never touches
// the quiz, the engine or the results. Tracking is optional: sharing works when window.track does nothing.
//
// Shared link: <site>/?p=<persona>&utm_source=<channel>&utm_medium=share#quiz
//   p = the persona's name + icon (base64url JSON, no description, no answers, no personal data).
//   The friend lands on the quiz with a small "your friend found theirs" note (src/share-landing.js).
import { useState, useRef, useEffect } from "react";

const TXT = {
  ar: {
    open: "✨ شارك شخصيتك العطرية",
    close: "إغلاق",
    copy: "نسخ الرابط",
    copied: "تنسخ الرابط ✓",
    copyFail: "ما قدرناش ننسخو. هادا هو الرابط:",
    line1: "اكتشفت شخصيتي العطرية مع FragranceFlow ✨",
    line2: (icon, name) => `شخصيتي: ${icon ? icon + " " : ""}${name}`,
    line3: "شنو هي شخصيتك العطرية؟ اكتشفها هنا 👇",
    igTitle: "صورة لـ Instagram Story",
    igShare: "شارك الصورة",
    igSave: "حفظ الصورة",
    igNote: "حفظ الصورة وحطها ف Story ديالك. الرابط تنسخ، تقدر تلصقو ف sticker ديال Link.",
    igCopied: "تنسخ الرابط ✓ لصقو ف sticker ديال Link ف Story.",
    cardKicker: "شخصيتي العطرية",
    cardCta: "اكتشف شخصيتك العطرية ✨",
    cardAlt: (name) => `بطاقة الشخصية العطرية: ${name}`,
    making: "كنوجدو الصورة...",
  },
  fr: {
    open: "✨ Partager ma personnalité olfactive",
    close: "Fermer",
    copy: "Copier le lien",
    copied: "Lien copié ✓",
    copyFail: "Copie impossible. Voici le lien :",
    line1: "J'ai découvert ma personnalité olfactive avec FragranceFlow ✨",
    line2: (icon, name) => `Ma personnalité : ${icon ? icon + " " : ""}${name}`,
    line3: "Et vous, quelle est la vôtre ? Découvrez-la ici 👇",
    igTitle: "Image pour Instagram Story",
    igShare: "Partager l'image",
    igSave: "Enregistrer l'image",
    igNote: "Enregistrez l'image et publiez-la en Story. Le lien est copié : collez-le dans un sticker Lien.",
    igCopied: "Lien copié ✓ Collez-le dans un sticker Lien de votre Story.",
    cardKicker: "Ma personnalité olfactive",
    cardCta: "Découvrez la vôtre ✨",
    cardAlt: (name) => `Carte de personnalité olfactive : ${name}`,
    making: "Création de l'image...",
  },
};

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function shareUrl(channel, persona) {
  const base = window.location.origin + window.location.pathname;
  const q = new URLSearchParams();
  if (persona && persona.name) q.set("p", b64url(JSON.stringify({ n: persona.name, l: persona.latin || "", i: persona.icon || "" })));
  q.set("utm_source", channel); q.set("utm_medium", "share"); q.set("utm_campaign", "persona");
  return `${base}?${q.toString()}#quiz`;
}

function shareText(T, persona, channel) {
  return [T.line1, persona.name ? T.line2(persona.icon, persona.name) : null, T.line3, shareUrl(channel, persona)]
    .filter(Boolean).join("\n");
}

async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

// wrap text into lines that fit maxW with the context's current font
function wrap(g, text, maxW, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + " …"; }
  return lines;
}

// 1080×1920 (9:16) story card, drawn independently of the results layout.
async function storyCard(T, persona, lang) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  const W = 1080, H = 1920, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  try { g.direction = lang === "fr" ? "ltr" : "rtl"; } catch (e) {}
  const DISPLAY = '"Amiri", "Noto Naskh Arabic", Georgia, serif';
  const BODY = '"IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif';
  const LATIN = '"Bodoni Moda", Didot, Georgia, serif';

  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#F4EFF8"; g.fillRect(0, 0, W, 520);           // lavender band behind the header
  g.strokeStyle = "#5B2A86"; g.lineWidth = 4; g.strokeRect(56, 56, W - 112, H - 112);
  g.textAlign = "center"; g.textBaseline = "middle";

  g.fillStyle = "#3B185B"; g.font = `500 76px ${LATIN}`;
  g.fillText("FragranceFlow ✨", W / 2, 230);
  g.fillStyle = "#746F78"; g.font = `500 46px ${BODY}`;
  g.fillText(T.cardKicker, W / 2, 380);

  // middle block (icon, name, Latin name, rule, description), measured first and centred between header and CTA
  const NAME_MAX = W - 240;
  let nameSize = 112;
  g.font = `700 ${nameSize}px ${DISPLAY}`;
  while (nameSize > 84 && g.measureText(persona.name || "").width > NAME_MAX) { nameSize -= 4; g.font = `700 ${nameSize}px ${DISPLAY}`; }
  const nameLines = wrap(g, persona.name, NAME_MAX, 2);
  g.font = `400 46px ${BODY}`;
  const descLines = persona.desc ? wrap(g, persona.desc, W - 280, 4) : [];
  const showLatin = persona.latin && persona.latin !== persona.name;
  const iconH = persona.icon ? 190 : 0, nameH = nameLines.length * (nameSize + 28), latinH = showLatin ? 96 : 0;
  const ruleH = 80, descH = descLines.length * 74;
  const top = 540, bottom = 1500;
  let y = top + Math.max(40, (bottom - top - (iconH + nameH + latinH + ruleH + descH)) / 2);
  if (persona.icon) { g.fillStyle = "#3B185B"; g.font = `150px ${BODY}`; g.fillText(persona.icon, W / 2, y + 75); y += iconH; }
  g.fillStyle = "#3B185B"; g.font = `700 ${nameSize}px ${DISPLAY}`;
  nameLines.forEach((l) => { g.fillText(l, W / 2, y + nameSize / 2); y += nameSize + 28; });
  if (showLatin) { g.fillStyle = "#5B2A86"; g.font = `italic 500 52px ${LATIN}`; g.fillText(persona.latin, W / 2, y + 40); y += latinH; }
  g.fillStyle = "#5B2A86"; g.fillRect(W / 2 - 60, y + 20, 120, 4); y += ruleH;
  g.fillStyle = "#211F23"; g.font = `400 46px ${BODY}`;
  descLines.forEach((l) => { g.fillText(l, W / 2, y + 30); y += 74; });

  // call to action, fixed near the foot
  g.fillStyle = "#5B2A86"; g.fillRect(170, 1560, W - 340, 128);
  g.fillStyle = "#FFFFFF"; g.font = `600 50px ${BODY}`;
  g.fillText(T.cardCta, W / 2, 1624);
  g.fillStyle = "#746F78"; g.font = `500 38px ${BODY}`;
  g.fillText(window.location.host, W / 2, 1765);
  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}

const ICONS = {
  whatsapp: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z"/></svg>,
  facebook: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.5 1.6-1.5h1.7V4.4a22 22 0 0 0-2.5-.1c-2.4 0-4.1 1.5-4.1 4.2v2.3H7.5V14h2.7v8h3.3Z"/></svg>,
  instagram: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor"/></svg>,
  link: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>,
};

export default function ShareResult({ name, latin, icon, desc, lang }) {
  const T = TXT[lang === "fr" ? "fr" : "ar"];
  const persona = { name, latin, icon, desc };
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("list");       // "list" | "instagram"
  const [card, setCard] = useState(null);         // { blob, url } once drawn
  const [msg, setMsg] = useState("");
  const timer = useRef(0);
  const making = useRef(null);

  useEffect(() => () => { clearTimeout(timer.current); if (card) URL.revokeObjectURL(card.url); }, [card]);

  const track = (event, data) => { try { window.track && window.track(event, data || {}); } catch (e) {} };
  const flash = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(""), 6000); };
  // the card is drawn once, as soon as the panel opens, so a later tap can open the share sheet straight away
  const prepareCard = () => {
    if (!making.current) {
      making.current = storyCard(T, persona, lang)
        .then((blob) => { if (blob) { const c = { blob, url: URL.createObjectURL(blob) }; setCard(c); return c; } return null; })
        .catch(() => null);
    }
    return making.current;
  };

  const toggle = () => {
    if (!open) { track("personality_share_click"); prepareCard(); }
    setOpen(!open); setView("list"); setMsg("");
  };
  const onWhatsApp = () => {
    track("personality_share_whatsapp");
    window.open("https://wa.me/?text=" + encodeURIComponent(shareText(T, persona, "whatsapp")), "_blank", "noopener");
  };
  const onFacebook = () => {
    track("personality_share_facebook");
    window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(shareUrl("facebook", persona)), "_blank", "noopener,width=640,height=560");
  };
  const onInstagram = () => {
    track("personality_share_instagram");
    prepareCard(); setView("instagram"); setMsg("");
  };
  const onCopy = async () => {
    track("personality_share_copy");
    const url = shareUrl("copy", persona);
    flash((await copyText(url)) ? T.copied : T.copyFail + " " + url);
  };
  const cardFile = (c) => new File([c.blob], "fragranceflow-persona.png", { type: "image/png" });
  const canShareFile = !!(card && navigator.canShare && (() => { try { return navigator.canShare({ files: [cardFile(card)] }); } catch (e) { return false; } })());
  const onShareCard = async () => {
    if (!card) return;
    const text = shareText(T, persona, "instagram");
    // copy first, without waiting, so the tap still counts as a user gesture for the share sheet
    try { navigator.clipboard && navigator.clipboard.writeText(shareUrl("instagram", persona)).catch(() => {}); } catch (e) {}
    try { await navigator.share({ files: [cardFile(card)], text }); flash(T.igCopied); }
    catch (e) { if (!e || e.name !== "AbortError") onSaveCard(); }
  };
  const onSaveCard = async () => {
    if (!card) return;
    const a = document.createElement("a");
    a.href = card.url; a.download = "fragranceflow-persona.png";
    document.body.appendChild(a); a.click(); a.remove();
    flash((await copyText(shareUrl("instagram", persona))) ? T.igCopied : T.igNote);
  };

  return (
    <div className="ffr-share">
      <button type="button" className="ffr-share-toggle" aria-expanded={open} onClick={toggle}>
        {open ? T.close : T.open}
      </button>
      {open && view === "list" && (
        <div className="ffr-share-opts">
          <button type="button" onClick={onWhatsApp}>{ICONS.whatsapp}<span>WhatsApp</span></button>
          <button type="button" onClick={onFacebook}>{ICONS.facebook}<span>Facebook</span></button>
          <button type="button" onClick={onInstagram}>{ICONS.instagram}<span>Instagram</span></button>
          <button type="button" onClick={onCopy}>{ICONS.link}<span>{T.copy}</span></button>
        </div>
      )}
      {open && view === "instagram" && (
        <div className="ffr-share-ig">
          <p className="ffr-share-ig-title">{T.igTitle}</p>
          {card ? <img src={card.url} alt={T.cardAlt(name)} width="1080" height="1920"/> : <p className="ffr-share-making">{T.making}</p>}
          <div className="ffr-share-ig-actions">
            {canShareFile && <button type="button" className="is-primary" onClick={onShareCard}>{T.igShare}</button>}
            <button type="button" onClick={onSaveCard} disabled={!card}>{T.igSave}</button>
          </div>
          <p className="ffr-share-note">{T.igNote}</p>
        </div>
      )}
      <p className="ffr-share-msg" role="status" aria-live="polite">{msg}</p>
    </div>
  );
}
