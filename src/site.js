// Landing page, fragrance browsing, search, fragrance detail view, and opening the existing quiz.
// The quiz itself (questions, scoring, recommendations) lives in src/widget/App.jsx and is not changed here.

export function startSite({ loadQuiz }) {
  var DB = (window.__ffDP__ || []).filter(function (p) { return p.active !== false; });
  var STORE = window.__FF_STORE__ || null; // set when the visit came through a store link (?store=…)
  // display order for browsing: alternate women / men / unisex so the grid never opens on one gender only
  var BROWSE = (function () {
    var buckets = { women: [], men: [], unisex: [] }, out = [];
    DB.forEach(function (p) { (buckets[p.gender[0]] || buckets.unisex).push(p); });
    for (var i = 0; out.length < DB.length; i++) ['women', 'men', 'unisex'].forEach(function (g) { if (buckets[g][i]) out.push(buckets[g][i]); });
    return out;
  })();

  var CHAR = { floral: 'زهري', woody: 'خشبي', fresh: 'منعش', citrus: 'حمضي', aquatic: 'بحري', oriental: 'شرقي', heavy: 'عميق', sweet: 'حلو', clean: 'نظيف', musky: 'مسكي', fruity: 'فاكهي' };
  var GEN = { men: 'رجالي', women: 'نسائي', unisex: 'للجوج' };
  var OCC = { daily: 'كل نهار', evening: 'سهرة', dates: 'موعد', travel: 'سفر', allday: 'كل وقت' };
  var SEA = { summer: 'صيف', spring: 'ربيع', autumn: 'خريف', winter: 'شتا', allseasons: 'كل الفصول' };
  var BASE_TITLE = document.title;
  var PAGE = 8;

  var landing = document.getElementById('landing'), detail = document.getElementById('detail'), quizpage = document.getElementById('quizpage');
  var catalog = document.getElementById('catalog'), about = document.getElementById('about');
  // Popular fragrances on the homepage: when the Sheet has enough visitor activity, the build gives each
  // fragrance a "pop" score (views, searches, favourites, buy clicks over the last 30 days) and the most
  // looked-for ones are shown. Until then: perfumes flagged topSeller first, then this short list of well-known names.
  var POPULAR = ['Coco Mademoiselle', 'Sauvage', 'Baccarat Rouge 540', 'La Vie est Belle', 'Bleu de Chanel', 'Oud Wood'];
  var stage = document.getElementById('stage');

  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null) continue;
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
  function charLabel(c) { return CHAR[c] || c; }
  function byId(id) { for (var i = 0; i < DB.length; i++) if (String(DB[i].id) === id) return DB[i]; return null; }
  function seasons(p) { return p.season.indexOf('allseasons') > -1 ? 'كل الفصول' : p.season.map(function (s) { return SEA[s] || s; }).join('، '); }

  /* ---------- store link: banner on every page, with a way back to the full, neutral site ---------- */
  if (STORE) {
    document.body.classList.add('in-store');
    var bar = h('div', { class: 'store-bar', role: 'note' },
      h('p', {}, h('span', { text: 'كتشوف العطور المتوفرة عند ' }), h('b', { text: STORE.name + (STORE.city ? ' – ' + STORE.city : '') })));
    var headEl = document.querySelector('header.head');
    headEl.parentNode.insertBefore(bar, headEl.nextSibling);
    // the way back to the full, neutral site stays available, but quietly, at the foot of every page
    var foot = document.querySelector('footer.foot .wrap');
    if (foot) foot.appendChild(h('p', { class: 'store-exit' }, h('a', { class: 'textlink', href: location.pathname, text: 'استكشف المزيد من العطور على FragranceFlow' })));
  }

  /* ---------- counts ---------- */
  var brands = {}; DB.forEach(function (p) { brands[p.brand] = 1; });
  var perkCount = document.getElementById('perk-count'); if (perkCount) perkCount.textContent = DB.length;
  // number of quiz questions, as the quiz builds them: 5 base questions, the fragrance-world question when the
  // catalogue has at least two worlds, and the budget question
  var WORLDS = {}; DB.forEach(function (p) { var w = String(p.world || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); if (/^(designer|niche|ultra_niche|arabian)$/.test(w)) WORLDS[w] = 1; });
  var QCOUNT = 5 + (Object.keys(WORLDS).length >= 2 ? 1 : 0) + 1;
  Array.prototype.forEach.call(document.querySelectorAll('.q-count'), function (el) { el.textContent = QCOUNT; });
  document.getElementById('st-n').textContent = DB.length;
  document.getElementById('st-b').textContent = Object.keys(brands).length;
  document.getElementById('fine').textContent = 'نسخة تجريبية بـ ' + DB.length + ' عطر. الأثمنة والتصنيفات تقريبية، والصور توضيحية حتى توصل صور المحلات الشريكة.';

  /* ---------- views (hash routes so the back button and shared links work) ---------- */
  // #quiz → quiz page, #fragrances → catalogue, #about → about, #f-<id> → fragrance page, anything else → homepage
  function show(view) {
    landing.hidden = view !== 'landing'; quizpage.hidden = view !== 'quiz'; detail.hidden = view !== 'detail';
    catalog.hidden = view !== 'catalog'; about.hidden = view !== 'about';
  }
  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }
  function goHome(target) {
    if (location.hash && location.hash !== '#') history.pushState('', document.title, location.pathname + location.search);
    route();
    var el = target && document.getElementById(target);
    if (!el) { window.scrollTo(0, 0); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // the «بصمتك العطرية» example above fills in when its code arrives and pushes the page down: land again once it has
    var sig = document.querySelector('.sig3');
    if (sig && !sig.classList.contains('is-ready') && sig.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      loadQuiz().then(function () { renderSignatureExample(); el.scrollIntoView({ block: 'start' }); }, function () {});
    }
  }
  function route() {
    var hsh = location.hash;
    if (hsh === '#quiz') { openQuiz(); return; }
    if (hsh === '#qr') { renderQR(); return; }
    if (hsh === '#fragrances') { show('catalog'); window.scrollTo(0, 0); document.title = 'اكتشف العطور | FragranceFlow'; return; }
    if (hsh === '#about') { show('about'); window.scrollTo(0, 0); document.title = 'About | FragranceFlow'; return; }
    if (hsh.indexOf('#f-') === 0) { var p = byId(decodeURIComponent(hsh.slice(3))); if (p) { renderPerfume(p); return; } }
    if (window.FF_CLOSE) window.FF_CLOSE();
    quizOpen = false;
    show('landing'); document.title = BASE_TITLE;
  }
  window.addEventListener('hashchange', route);
  window.FF_ON_CLOSE = function () { goHome(); };

  /* ---------- store QR code: <site>/?store=<id>#qr (for the shop counter, packaging, stories) ---------- */
  function renderQR() {
    show('detail'); window.scrollTo(0, 0); stage.textContent = '';
    document.title = 'QR | FragranceFlow';
    if (!STORE) {
      stage.appendChild(h('section', { class: 'stage qr-page' }, h('h1', { text: 'QR ديال المحل' }),
        h('p', { text: 'زيد ?store= ومعاه store_id ديال المحل ف الرابط، مثلا: ?store=parfumerie-x#qr' })));
      return;
    }
    var link = location.origin + location.pathname + '?store=' + encodeURIComponent(STORE.id) + '&utm_source=qr#quiz';
    var canvas = h('canvas', { class: 'qr-canvas', 'aria-label': 'QR code: ' + link });
    var dl = h('a', { class: 'btn', download: 'qr-' + STORE.id + '.png', href: '#', text: 'تحميل الصورة (PNG)' });
    var copyBtn = h('button', { type: 'button', class: 'btn ghost', text: 'نسخ الرابط' });
    copyBtn.addEventListener('click', function () {
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { copyBtn.textContent = 'تنسخ ✓'; }, function () { copyBtn.textContent = link; });
    });
    stage.appendChild(h('section', { class: 'stage qr-page' },
      h('h1', { text: 'اختبار العطور مع ' + STORE.name }),
      h('p', { class: 'qr-sub', text: 'دير سكان للكود، وجاوب على شي أسئلة، ولقى العطر لي كيناسبك من المجموعة ديالنا' }),
      canvas,
      h('p', { class: 'qr-link latin', text: link }),
      h('div', { class: 'qr-actions' }, dl, copyBtn),
      h('p', { class: 'qr-hint', text: 'حطو ف الكونطوار، على الباكاج، ولا ف الستوري. كل سكان كيتسجل ف الإحصائيات ديال المحل (المصدر: qr).' })));
    import('qrcode').then(function (m) {
      var QR = m.default || m;
      QR.toCanvas(canvas, link, { width: 320, margin: 2, color: { dark: '#3B185B', light: '#FFFFFF' } }, function () {
        dl.href = canvas.toDataURL('image/png');
      });
    });
  }

  /* ---------- the existing quiz, loaded on first use ---------- */
  var quizOpen = false;
  function openQuiz() {
    show('quiz'); window.scrollTo(0, 0);
    if (STORE && !document.getElementById('store-quiz-note')) {
      var root = document.getElementById('ff-widget-root');
      root.parentNode.insertBefore(h('aside', { class: 'store-quiz-note', id: 'store-quiz-note' },
        h('p', { class: 'store-quiz-title', text: 'اختبار العطور مع ' + STORE.name }),
        h('p', { text: 'جاوب على بعض الأسئلة، ونلقاو ليك العطور الأنسب من المجموعة المتوفرة عندهم.' })), root);
    }
    document.title = 'اكتشف بصمتك العطرية | FragranceFlow';
    if (quizOpen) return;
    quizOpen = true;
    if (window.FF_OPEN) { window.FF_OPEN(); return; }
    var root = document.getElementById('ff-widget-root');
    if (!root.firstChild) root.appendChild(h('p', { class: 'quiz-loading', text: 'كنوجدو الاختبار...' }));
    loadQuiz().then(function () { if (location.hash === '#quiz') window.FF_OPEN(); });
  }

  /* ---------- fragrance browsing ---------- */
  var FACETS = {
    family:   { label: 'العائلة', values: ['floral', 'woody', 'fresh', 'oriental', 'sweet', 'aquatic', 'fruity', 'musky', 'clean'], names: CHAR,
                test: function (p, v) { return p.character.indexOf(v) > -1; } },
    occasion: { label: 'المناسبة', values: ['daily', 'evening', 'dates', 'travel'], names: OCC,
                test: function (p, v) { return p.occasion.indexOf(v) > -1; } },
    season:   { label: 'الفصل', values: ['summer', 'spring', 'autumn', 'winter'], names: SEA,
                test: function (p, v) { return p.season.indexOf(v) > -1 || p.season.indexOf('allseasons') > -1; } }
  };
  var GENDERS = [['all', 'الكل'], ['women', 'ليها هي'], ['men', 'ليه هو'], ['unisex', 'للجوج']];
  var state = { gender: 'all', tab: 'family', value: 'all', shown: PAGE };
  var grid = document.getElementById('grid'), more = document.getElementById('more'), countEl = document.getElementById('f-count');

  // keep only facet values that exist in the data, so no filter leads to an invented category
  Object.keys(FACETS).forEach(function (k) {
    FACETS[k].values = FACETS[k].values.filter(function (v) { return DB.some(function (p) { return FACETS[k].test(p, v); }); });
  });

  function chip(label, pressed, onclick) { return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), onclick: onclick }, label); }
  function drawFilters() {
    var g = document.getElementById('f-gender'); g.textContent = '';
    GENDERS.forEach(function (x) { g.appendChild(chip(x[1], state.gender === x[0], function () { state.gender = x[0]; state.shown = PAGE; drawFilters(); drawGrid(); })); });
    var tabs = document.getElementById('f-tabs'); tabs.textContent = '';
    Object.keys(FACETS).forEach(function (k) {
      tabs.appendChild(h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(state.tab === k),
        onclick: function () { state.tab = k; state.value = 'all'; state.shown = PAGE; drawFilters(); drawGrid(); } }, FACETS[k].label));
    });
    var vals = document.getElementById('f-values'); vals.textContent = '';
    vals.setAttribute('aria-label', FACETS[state.tab].label);
    vals.appendChild(chip('الكل', state.value === 'all', function () { state.value = 'all'; state.shown = PAGE; drawFilters(); drawGrid(); }));
    FACETS[state.tab].values.forEach(function (v) {
      vals.appendChild(chip(FACETS[state.tab].names[v], state.value === v, function () { state.value = v; state.shown = PAGE; drawFilters(); drawGrid(); }));
    });
  }
  function matches(p) {
    // "for her" / "for him" also include unisex fragrances, as the quiz does
    if (state.gender !== 'all' && p.gender.indexOf(state.gender) < 0 && !(state.gender !== 'unisex' && p.gender.indexOf('unisex') > -1)) return false;
    if (state.value !== 'all' && !FACETS[state.tab].test(p, state.value)) return false;
    return true;
  }
  var HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
  function card(p) {
    var heart = h('button', { type: 'button', class: 'heart', 'aria-pressed': 'false', 'aria-label': 'زيد ' + p.name + ' للمفضلة' });
    heart.innerHTML = HEART;
    heart.addEventListener('click', function () { heart.setAttribute('aria-pressed', String(heart.getAttribute('aria-pressed') !== 'true')); });
    var tags = h('div', { class: 'tags' });
    p.occasion.slice(0, 2).forEach(function (o) { tags.appendChild(h('span', { class: 'tag', text: OCC[o] || o })); });
    tags.appendChild(h('span', { class: 'tag', text: seasons(p) }));
    var fam = p.character.slice(0, 2).map(charLabel).join(' · ');
    return h('article', { class: 'pc' },
      h('div', { class: 'ph' },
        h('img', { src: p.image, alt: 'صورة توضيحية لقرعة عطر ' + fam, loading: 'lazy', decoding: 'async', width: '172', height: '119' }),
        h('span', { class: 'badge', text: GEN[p.gender[0]] }), heart),
      h('div', { class: 'in' },
        h('p', { class: 'br latin', text: p.brand }),
        h('h3', { class: 'latin', text: p.name }),
        h('p', { class: 'fam', text: fam }),
        tags,
        h('a', { class: 'btn ghost sm', href: '#f-' + encodeURIComponent(p.id) }, 'شوف العطر')));
  }
  function drawGrid() {
    var list = BROWSE.filter(matches);
    grid.textContent = '';
    if (!list.length) grid.appendChild(h('p', { class: 'empty', text: 'ما كاين حتى عطر بهاد التصفية. جرب اختيار آخر.' }));
    list.slice(0, state.shown).forEach(function (p) { grid.appendChild(card(p)); });
    countEl.textContent = list.length + ' عطر';
    more.hidden = list.length <= state.shown;
  }
  more.addEventListener('click', function () { state.shown += PAGE; drawGrid(); });
  drawFilters(); drawGrid();

  /* ---------- homepage «اكتشف عالم العطور»: fragrances worth a look ---------- */
  // Same choice as before: when the Sheet has enough visitor activity, the most looked-for fragrances (pop score);
  // otherwise topSeller first, then the short list of well-known names. Only real catalogue data is shown.
  function featCard(p) {
    var fam = p.character.slice(0, 2).map(charLabel).join(' · ');
    return h('li', {}, h('a', { class: 'fcard', href: '#f-' + encodeURIComponent(p.id) },
      h('span', { class: 'fcard-ph' }, h('img', { src: p.image, alt: 'صورة توضيحية لقرعة عطر ' + fam, loading: 'lazy', decoding: 'async', width: '172', height: '119' })),
      h('span', { class: 'fcard-br latin', text: p.brand }),
      h('span', { class: 'fcard-name latin', text: p.name }),
      fam ? h('span', { class: 'fcard-fam', text: fam }) : null));
  }
  (function () {
    var ranked = DB.filter(function (p) { return p.pop > 0; }).sort(function (a, b) { return b.pop - a.pop; });
    var pick;
    if (ranked.length >= 4) {
      // real visitor activity: say so; full rows only (3 or 6), never padded with unvisited perfumes
      pick = ranked.slice(0, ranked.length >= 6 ? 6 : 3);
      document.getElementById('pop-note').textContent = 'الأكثر بحثاً عند الزوار ف آخر 30 يوم';
    } else {
      pick = DB.filter(function (p) { return p.topSeller; });
      POPULAR.forEach(function (n) { var p = DB.filter(function (x) { return x.name === n; })[0]; if (p && pick.indexOf(p) < 0) pick.push(p); });
      if (pick.length < 4) BROWSE.forEach(function (p) { if (pick.length < 6 && pick.indexOf(p) < 0) pick.push(p); });
    }
    var pg = document.getElementById('pop-grid');
    pick.slice(0, 6).forEach(function (p) { pg.appendChild(featCard(p)); });
  })();

  /* ---------- homepage «اكتشف عالم العطور»: fragrance families (open the catalogue with that family selected) ---------- */
  (function () {
    var I = function (d) { return '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
    // family value (as in the data) · Arabic name · Latin name · drawing
    var FAMS = [
      ['floral', 'زهري', 'Floral', I('<circle cx="16" cy="16" r="2.6"/><path d="M16 13.4c-3-4.3-1-8.4 0-9.4 1 1 3 5.1 0 9.4zM16 18.6c3 4.3 1 8.4 0 9.4-1-1-3-5.1 0-9.4zM13.4 16c-4.3 3-8.4 1-9.4 0 1-1 5.1-3 9.4 0zM18.6 16c4.3-3 8.4-1 9.4 0-1 1-5.1 3-9.4 0z"/>')],
      ['fresh', 'منعش', 'Fresh', I('<circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="7.4"/><path d="M16 8.6v14.8M8.6 16h14.8M10.8 10.8l10.4 10.4M21.2 10.8 10.8 21.2"/>')],
      ['fruity', 'فاكهي', 'Fruity', I('<path d="M16 9c-6-3-11 1-11 8s5 11 11 11 11-4 11-11-5-11-11-8z"/><path d="M16 9c0-3 1-5 3-6M16 9c-2-3-6-3-7-2"/>')],
      ['woody', 'خشبي', 'Woody', I('<path d="M6 25 26 7"/><path d="M11 20c-4-1-6-4-6-7 3 0 6 2 6 7zM17 14c-1-4 0-7 3-9 1 3 0 7-3 9zM14 17c4 1 7 0 9-3-3-1-7 0-9 3z"/>')],
      ['oriental', 'شرقي', 'Oriental', I('<path d="M16 4l2.6 7.4L26 14l-7.4 2.6L16 24l-2.6-7.4L6 14l7.4-2.6z"/><path d="M25 22l.9 2.1L28 25l-2.1.9L25 28l-.9-2.1L22 25l2.1-.9z"/>')],
      ['clean', 'نظيف', 'Clean', I('<circle cx="13" cy="17" r="7"/><circle cx="22.5" cy="10" r="3.5"/><circle cx="23" cy="22" r="2.2"/><path d="M10 14.5a3.5 3.5 0 0 1 3-1.6"/>')],
      ['sweet', 'دافئ', 'Warm', I('<path d="M21 6.5A10 10 0 1 0 25.5 21 8 8 0 0 1 21 6.5z"/>')],
      ['aquatic', 'مائي', 'Aquatic', I('<path d="M16 4c4.5 5.5 7 9.6 7 13.2a7 7 0 0 1-14 0C9 13.6 11.5 9.5 16 4z"/><path d="M12.5 18.5a3.6 3.6 0 0 0 3.5 3.3"/>')]
    ];
    var box = document.getElementById('explore-cards');
    FAMS.forEach(function (f) {
      var n = DB.filter(function (p) { return FACETS.family.test(p, f[0]); }).length;
      if (!n) return; // never offer a family without fragrances
      var icon = h('span', { class: 'dcat-ic' }); icon.innerHTML = f[3];
      box.appendChild(h('li', {}, h('button', { type: 'button', class: 'dcat dcat-' + f[0], 'data-cat': 'family:' + f[0], 'aria-label': f[1] + '، ' + n + ' عطر' },
        icon,
        h('span', { class: 'dcat-name', text: f[1] }),
        h('span', { class: 'dcat-latin latin', text: f[2] }),
        h('span', { class: 'dcat-count', text: n + ' عطر' }))));
    });
  })();

  function applyCategory(spec) {
    var c = spec.split(':');
    // gender:<value>  → gender filter;  <facet>:<value> → that facet with that value selected
    if (c[0] === 'gender') { state.gender = c[1]; state.value = 'all'; }
    else { state.gender = 'all'; state.tab = c[0]; state.value = c[1]; }
    state.shown = PAGE; drawFilters(); drawGrid();
    go('#fragrances');
  }

  /* ---------- clicks: quiz, sections, home, categories ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-quiz],[data-go],[data-home],[data-cat]');
    if (!t) return;
    closeMenu();
    if (t.hasAttribute('data-quiz')) go('#quiz');
    else if (t.hasAttribute('data-cat')) applyCategory(t.getAttribute('data-cat'));
    else if (t.hasAttribute('data-go')) goHome(t.getAttribute('data-go'));
    else goHome();
  });
  document.getElementById('logo').addEventListener('click', function () { closeMenu(); goHome(); });

  /* ---------- mobile menu ---------- */
  var burger = document.getElementById('burger'), menu = document.getElementById('menu');
  function closeMenu() { menu.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
  burger.addEventListener('click', function () {
    var open = !menu.classList.contains('open');
    menu.classList.toggle('open', open); burger.setAttribute('aria-expanded', String(open));
  });

  /* ---------- search ---------- */
  var q = document.getElementById('q'), drop = document.getElementById('drop');
  q.addEventListener('input', function () {
    var t = q.value.trim().toLowerCase(); drop.textContent = '';
    if (!t) { drop.hidden = true; return; }
    var m = DB.filter(function (p) { return (p.name + ' ' + p.brand).toLowerCase().indexOf(t) > -1; }).slice(0, 6);
    if (!m.length) drop.appendChild(h('p', { text: 'ما لقينا حتى عطر بهاد السمية.' }));
    m.forEach(function (p) {
      drop.appendChild(h('button', { type: 'button', onclick: function () {
          if (window.track) window.track('search_pick', { perfume: p.name, pid: p.id });
          drop.hidden = true; q.value = ''; closeMenu(); go('#f-' + encodeURIComponent(p.id)); } },
        h('span', { class: 'latin', text: p.name }), h('small', { text: charLabel(p.character[0]) })));
    });
    drop.hidden = false;
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) drop.hidden = true; });

  /* ---------- fragrance page ---------- */
  function layer(label, list) { return h('div', { class: 'layer' }, h('b', { text: label }), h('span', { class: 'latin', text: list.join(' · ') })); }
  function renderPerfume(p) {
    if (window.track) window.track('perfume_view', { perfume: p.name, pid: p.id });
    show('detail'); window.scrollTo(0, 0);
    document.title = p.name + ' – ' + p.brand + ' | FragranceFlow';
    stage.textContent = '';
    var tags = h('div', { class: 'tags' }, h('span', { class: 'tag', text: GEN[p.gender[0]] }));
    p.character.forEach(function (c) { tags.appendChild(h('span', { class: 'tag', text: charLabel(c) })); });
    var occ = p.occasion.map(function (o) { return OCC[o] || o; }).join('، ');
    stage.appendChild(h('section', { class: 'stage' },
      h('nav', { class: 'crumbs', 'aria-label': 'المسار' }, h('button', { type: 'button', class: 'textlink', onclick: function () { goHome(); } }, 'الرئيسية'), '/',
        h('a', { class: 'textlink', href: '#fragrances' }, 'العطور')),
      h('article', { class: 'rc' },
        h('div', { class: 'ph' }, h('img', { src: p.image, alt: 'صورة توضيحية لقرعة عطر', width: '172', height: '119' }), h('small', { text: 'صورة توضيحية' })),
        h('div', { class: 'in' },
          h('div', { class: 'rc-head' },
            h('div', { style: 'min-width:0' }, h('h1', { class: 'latin', text: p.name }), h('p', { class: 'br latin', text: p.brand + ' · ' + p.concentration + ' · ' + p.size })),
            h('div', { class: 'price' }, h('b', { text: String(p.price) }), h('span', { text: 'درهم تقريبا' }))),
          tags,
          h('div', { class: 'layers' }, layer('المقدمة', p.notes.top), layer('القلب', p.notes.middle), layer('القاعدة', p.notes.base)),
          h('p', { class: 'shop' }, h('b', { text: 'مناسب: ' }), occ + '. ', h('b', { text: 'الفصل: ' }), seasons(p) + '.'),
          p.url ? h('a', { class: 'btn', href: p.url, target: '_blank', rel: 'noopener', style: 'align-self:flex-start' }, 'شوف عند ' + (p.store || 'المحل'))
                : h('p', { class: 'shop' }, h('b', { text: 'فين تلقاه: ' }), 'قريبا، رابط مباشر عند المحلات الشريكة.'))),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: '#quiz' }, 'اكتشف بصمتك العطرية'),
        h('a', { class: 'textlink', href: '#fragrances' }, 'رجع للعطور'))));
  }

  /* ---------- homepage: «بصمتك العطرية» example, computed by the quiz's own engine and persona code ---------- */
  // window.FF_SIGNATURE_EXAMPLE comes with the quiz code (src/widget/App.jsx): fixed example answers → real persona,
  // real Top 3 and real match %. Nothing here is invented; if it cannot run, the section shows the steps only.
  function renderSignatureExample() {
    var ex = window.FF_SIGNATURE_EXAMPLE && window.FF_SIGNATURE_EXAMPLE();
    if (!ex || !ex.persona || !ex.top3.length) return;
    var ICONS = [ // occasion, season, character, impression (the order of ex.answers)
      '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
      '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
      '<path d="M12 3c3.5 4.3 5.5 7.6 5.5 10.5a5.5 5.5 0 0 1-11 0C6.5 10.6 8.5 7.3 12 3z"/>',
      '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 5 3-5M12 9v11"/>'
    ];
    var ans = document.getElementById('sig3-answers'); ans.textContent = '';
    ex.answers.forEach(function (l, i) {
      var ic = h('span', { class: 'sig3-ic', 'aria-hidden': 'true' });
      ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[i] || '') + '</svg>';
      ans.appendChild(h('li', {}, ic, h('span', { text: l })));
    });
    document.getElementById('sig3-name').textContent = ex.persona.ar + (ex.persona.icon ? ' ' + ex.persona.icon : '');
    var tags = document.getElementById('sig3-tags'); tags.textContent = '';
    (ex.persona.tags && ex.persona.tags.ar || []).forEach(function (t) { tags.appendChild(h('li', { text: t })); });
    document.getElementById('sig3-desc').textContent = ex.persona.desc || '';
    var list = document.getElementById('sig3-perfumes'); list.textContent = '';
    ex.top3.forEach(function (p, i) {
      var ring = h('span', { class: 'sig3-ring', 'aria-label': p.pct + '% مطابقة' });
      ring.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" class="t"/><circle cx="22" cy="22" r="19" class="v" pathLength="100" style="stroke-dasharray:' + p.pct + ' 100"/></svg>';
      ring.appendChild(h('b', { class: 'latin', text: p.pct + '%' }));
      ring.appendChild(h('small', { text: 'مطابقة' }));
      list.appendChild(h('li', {},
        h('a', { href: '#f-' + encodeURIComponent(p.id) },
          ring,
          h('img', { src: p.image, alt: '', loading: 'lazy', decoding: 'async', width: '172', height: '119' }),
          h('span', { class: 'sig3-rank latin', text: '#' + (i + 1) }),
          h('span', { class: 'sig3-pname latin', text: p.name }),
          h('span', { class: 'sig3-brand latin', text: p.brand }))));
    });
    document.getElementById('sig3-note').hidden = false;
    document.querySelector('.sig3').classList.add('is-ready');
  }
  (function () {
    var sec = document.querySelector('.sig3'); if (!sec) return;
    var run = function () { loadQuiz().then(renderSignatureExample, function () {}); };
    if (!('IntersectionObserver' in window)) { run(); return; }
    // the quiz code loads when the section comes near, not with the first paint
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); }
    }, { rootMargin: '600px 0px' });
    io.observe(sec);
  })();

  /* ---------- homepage: the final call to action draws its fingerprint bottle once, as it comes into view ---------- */
  (function () {
    var f = document.querySelector('.final');
    if (!f || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    f.classList.add('final-anim');
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { f.classList.add('is-in'); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(f);
  })();

  /* ---------- homepage: the three-moment journey appears once, as it scrolls into view ---------- */
  (function () {
    var j = document.querySelector('.journey');
    if (!j || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    j.classList.add('journey-anim');
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { j.classList.add('is-in'); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(j.querySelector('.journey-strip'));
  })();

  // warm up the quiz code when the browser is idle, so the first click opens instantly
  (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(function () { loadQuiz(); });

  route();
}
