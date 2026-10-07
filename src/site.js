import { IMG } from "./data/images.js";

export function startSite() {

  var DB = (window.__ffDP__ || []).filter(function (p) { return p.active !== false; });
  var CHAR = { floral: 'زهري', woody: 'خشبي', fresh: 'منعش', citrus: 'حمضي', aquatic: 'بحري', oriental: 'شرقي', heavy: 'عميق', sweet: 'حلو', clean: 'نظيف', musky: 'مسكي', fruity: 'فاكهي' };
  var GEN = { men: 'رجالي', women: 'نسائي', unisex: 'للجوج' };
  var OCC = { daily: 'كل نهار', evening: 'سهرة', dates: 'موعد', travel: 'سفر', allday: 'كل وقت' };

  var POP = [
    ['Miss Dior Blooming Bouquet', 'c1', 'زهري خفيف وناعم، كيصلح للنهار.'],
    ['Bleu de Chanel', 'c2', 'خشبي ومنعش، أنيق فكل وقت.'],
    ['Oud Wood', 'c3', 'عود دافئ وراقي، كيتلبس من الجوج.'],
    ['Libre', 'c4', 'لافندر وزهر البرتقال، توقيع أنيق.'],
    ['Spicebomb', 'c5', 'توابل وتبغ وجلد، قوي وما كيتنساش.']
  ];

  var landing = document.getElementById('landing'), detail = document.getElementById('detail'), quizpage = document.getElementById('quizpage');
  var stage = document.getElementById('stage');

  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  function find(n) { for (var i = 0; i < DB.length; i++) if (DB[i].name === n) return DB[i]; return null; }
  function charLabel(c) { return CHAR[c] || c; }

  /* ---------- open the FragranceFlow widget ---------- */
  // the quiz is its own page: hide the landing, show the quiz page, start a fresh run
  function openWidget() {
    landing.hidden = true; detail.hidden = true; quizpage.hidden = false;
    window.scrollTo(0, 0);
    if (window.FF_OPEN) window.FF_OPEN();
  }
  window.FF_ON_CLOSE = function () { showLanding(); };

  /* ---------- counts ---------- */
  var brands = {}; DB.forEach(function (p) { brands[p.brand] = 1; });
  document.getElementById('perk-count').textContent = DB.length + ' عطر مشهور';
  document.getElementById('st-n').textContent = DB.length;
  document.getElementById('st-b').textContent = Object.keys(brands).length;
  document.getElementById('fine').textContent = 'نسخة تجريبية بـ ' + DB.length + ' عطر. الأثمنة والتصنيفات تقريبية، والصور توضيحية حتى توصل صور المحلات الشريكة.';

  /* ---------- popular row ---------- */
  var row = document.getElementById('row'), dots = document.getElementById('dots');
  POP.forEach(function (it, i) {
    var p = find(it[0]); if (!p) return;
    var heart = h('button', { type: 'button', class: 'heart', 'aria-pressed': 'false', 'aria-label': 'زيد ' + p.name + ' للمفضلة' });
    heart.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
    heart.addEventListener('click', function (e) { e.stopPropagation(); heart.setAttribute('aria-pressed', String(heart.getAttribute('aria-pressed') !== 'true')); });
    var tags = h('div', { class: 'tags' });
    p.character.slice(0, 3).forEach(function (c) { tags.appendChild(h('span', { class: 'tag', text: charLabel(c) })); });
    var card = h('article', { class: 'pc', tabindex: '0', role: 'button', 'aria-label': p.name + '، شوف التفاصيل' },
      h('div', { class: 'ph' }, h('img', { src: IMG[it[1]], alt: 'صورة توضيحية لقرعة عطر', loading: 'lazy' }), h('span', { class: 'badge', text: GEN[p.gender[0]] }), heart),
      h('div', { class: 'in' }, h('p', { class: 'br latin', text: p.brand }), h('h3', { class: 'latin', text: p.name }), h('p', { class: 'd', text: it[2] }), tags));
    card.addEventListener('click', function () { showPerfume(p); });
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter') showPerfume(p); });
    row.appendChild(card);
    dots.appendChild(h('i', { class: i === 0 ? 'on' : '' }));
  });
  function cardW() { var c = row.firstElementChild; return c ? c.getBoundingClientRect().width + 14 : 200; }
  // in RTL, moving forward means scrolling toward negative scrollLeft
  document.getElementById('next').addEventListener('click', function () { row.scrollBy({ left: -cardW(), behavior: 'smooth' }); });
  document.getElementById('prev').addEventListener('click', function () { row.scrollBy({ left: cardW(), behavior: 'smooth' }); });
  row.addEventListener('scroll', function () {
    var ix = Math.round(Math.abs(row.scrollLeft) / cardW());
    Array.prototype.forEach.call(dots.children, function (d, i) { d.className = i === ix ? 'on' : ''; });
  }, { passive: true });

  /* ---------- views ---------- */
  function showLanding(target) {
    if (!quizpage.hidden && window.FF_CLOSE) window.FF_CLOSE();
    detail.hidden = true; quizpage.hidden = true; landing.hidden = false;
    var el = target && document.getElementById(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-quiz],[data-go],[data-home],[data-cat]');
    if (!t) return;
    if (t.hasAttribute('data-quiz') || t.hasAttribute('data-cat')) openWidget();
    else if (t.hasAttribute('data-go')) showLanding(t.getAttribute('data-go'));
    else showLanding();
  });
  document.getElementById('logo').addEventListener('click', function () { showLanding(); });

  /* ---------- search ---------- */
  var q = document.getElementById('q'), drop = document.getElementById('drop');
  q.addEventListener('input', function () {
    var t = q.value.trim().toLowerCase(); drop.textContent = '';
    if (!t) { drop.hidden = true; return; }
    var m = DB.filter(function (p) { return (p.name + ' ' + p.brand).toLowerCase().indexOf(t) > -1; }).slice(0, 6);
    if (!m.length) drop.appendChild(h('p', { text: 'ما لقينا حتى عطر بهاد السمية.' }));
    m.forEach(function (p) {
      drop.appendChild(h('button', { type: 'button', onclick: function () { drop.hidden = true; q.value = ''; showPerfume(p); } },
        h('span', { class: 'latin', text: p.name }), h('small', { text: charLabel(p.character[0]) })));
    });
    drop.hidden = false;
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) drop.hidden = true; });

  /* ---------- perfume page ---------- */
  function layer(label, list) { return h('div', { class: 'layer' }, h('b', { text: label }), h('span', { class: 'latin', text: list.join(' · ') })); }
  function showPerfume(p) {
    if (!quizpage.hidden && window.FF_CLOSE) window.FF_CLOSE();
    landing.hidden = true; quizpage.hidden = true; detail.hidden = false; window.scrollTo(0, 0);
    stage.textContent = '';
    var tags = h('div', { class: 'tags' }, h('span', { class: 'tag', text: GEN[p.gender[0]] }));
    p.character.forEach(function (c) { tags.appendChild(h('span', { class: 'tag', text: charLabel(c) })); });
    var occ = p.occasion.map(function (o) { return OCC[o] || o; }).join('، ');
    stage.appendChild(h('section', { class: 'stage' },
      h('p', { class: 'eyebrow' }, h('button', { type: 'button', class: 'textlink', onclick: function () { showLanding(); } }, 'الرئيسية'), ' / العطور'),
      h('article', { class: 'rc first' },
        h('div', { class: 'ph' }, h('img', { src: p.image, alt: 'صورة توضيحية لقرعة عطر' }), h('small', { text: 'صورة توضيحية' })),
        h('div', { class: 'in' },
          h('div', { class: 'rc-head' },
            h('div', { style: 'min-width:0' }, h('h2', { class: 'latin', text: p.name }), h('p', { class: 'br latin', text: p.brand + ' · ' + p.concentration + ' · ' + p.size })),
            h('div', { class: 'pct' }, h('b', { text: String(p.price) }), h('span', { text: 'درهم تقريبا' }))),
          tags,
          h('div', { class: 'layers' }, layer('المقدمة', p.notes.top), layer('القلب', p.notes.middle), layer('القاعدة', p.notes.base)),
          h('p', { class: 'shop' }, h('b', { text: 'مناسب: ' }), occ + '.'),
          p.url ? h('a', { class: 'btn', href: p.url, target: '_blank', rel: 'noopener', style: 'align-self:flex-start' }, 'شوف عند ' + (p.store || 'المحل'))
                : h('p', { class: 'shop' }, h('b', { text: 'قريبا: ' }), 'رابط مباشر للعطر عند المحلات الشريكة.'))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: openWidget }, 'لقى العطر لي يناسبك'),
        h('button', { type: 'button', class: 'textlink', onclick: function () { showLanding(); } }, 'رجع للصفحة الرئيسية'))));
  }
}
