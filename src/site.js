// Landing page, fragrance browsing, search, fragrance detail view, and opening the existing quiz.
// The quiz itself (questions, scoring, recommendations) lives in src/widget/App.jsx and is not changed here.

export function startSite({ loadQuiz }) {
  var DB = (window.__ffDP__ || []).filter(function (p) { return p.active !== false; });
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
  // Popular fragrances on the homepage: perfumes flagged topSeller in the database come first;
  // until the database has that flag, this short list of well-known names is used (all exist in the data).
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

  /* ---------- counts ---------- */
  var brands = {}; DB.forEach(function (p) { brands[p.brand] = 1; });
  document.getElementById('perk-count').textContent = DB.length;
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
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo(0, 0);
  }
  function route() {
    var hsh = location.hash;
    if (hsh === '#quiz') { openQuiz(); return; }
    if (hsh === '#fragrances') { if (window.FF_CLOSE) window.FF_CLOSE(); show('catalog'); window.scrollTo(0, 0); document.title = 'اكتشف العطور | FragranceFlow'; return; }
    if (hsh === '#about') { if (window.FF_CLOSE) window.FF_CLOSE(); show('about'); window.scrollTo(0, 0); document.title = 'About | FragranceFlow'; return; }
    if (hsh.indexOf('#f-') === 0) { var p = byId(decodeURIComponent(hsh.slice(3))); if (p) { renderPerfume(p); return; } }
    if (window.FF_CLOSE) window.FF_CLOSE();
    show('landing'); document.title = BASE_TITLE;
  }
  window.addEventListener('hashchange', route);
  window.FF_ON_CLOSE = function () { goHome(); };

  /* ---------- the existing quiz, loaded on first use ---------- */
  function openQuiz() {
    show('quiz'); window.scrollTo(0, 0);
    document.title = 'الاختبار | FragranceFlow';
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

  /* ---------- homepage: popular fragrances ---------- */
  (function () {
    var pick = DB.filter(function (p) { return p.topSeller; });
    POPULAR.forEach(function (n) { var p = DB.filter(function (x) { return x.name === n; })[0]; if (p && pick.indexOf(p) < 0) pick.push(p); });
    if (pick.length < 4) BROWSE.forEach(function (p) { if (pick.length < 6 && pick.indexOf(p) < 0) pick.push(p); });
    var pg = document.getElementById('pop-grid');
    pick.slice(0, 6).forEach(function (p) { pg.appendChild(card(p)); });
  })();

  /* ---------- homepage: explore shortcuts (only categories that have fragrances) ---------- */
  (function () {
    var GROUPS = [
      ['لمن', [['gender', 'women', 'للنساء'], ['gender', 'men', 'للرجال'], ['gender', 'unisex', 'Unisex']]],
      ['الفصل والمناسبة', [['season', 'summer', 'الصيف'], ['season', 'winter', 'الشتاء'], ['occasion', 'evening', 'السهرات'], ['occasion', 'daily', 'يومي'], ['occasion', 'dates', 'المواعيد']]],
      ['نوع الريحة', [['family', 'floral', 'زهري'], ['family', 'fresh', 'منعش'], ['family', 'woody', 'خشبي'], ['family', 'oriental', 'شرقي'], ['family', 'sweet', 'حلو'], ['family', 'aquatic', 'بحري'], ['family', 'fruity', 'فاكهي']]]
    ];
    function countFor(kind, v) {
      return DB.filter(function (p) {
        if (kind === 'gender') return p.gender.indexOf(v) > -1 || (v !== 'unisex' && p.gender.indexOf('unisex') > -1);
        return FACETS[kind].test(p, v);
      }).length;
    }
    var box = document.getElementById('explore-groups');
    GROUPS.forEach(function (g) {
      var list = h('div', { class: 'xlist' });
      g[1].forEach(function (it) {
        var n = countFor(it[0], it[1]); if (!n) return;
        list.appendChild(h('button', { type: 'button', class: 'xitem', 'data-cat': it[0] + ':' + it[1] },
          h('span', { text: it[2] }), h('small', { text: n + ' عطر' })));
      });
      box.appendChild(h('div', { class: 'xgroup' }, h('h3', { text: g[0] }), list));
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
      drop.appendChild(h('button', { type: 'button', onclick: function () { drop.hidden = true; q.value = ''; closeMenu(); go('#f-' + encodeURIComponent(p.id)); } },
        h('span', { class: 'latin', text: p.name }), h('small', { text: charLabel(p.character[0]) })));
    });
    drop.hidden = false;
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) drop.hidden = true; });

  /* ---------- fragrance page ---------- */
  function layer(label, list) { return h('div', { class: 'layer' }, h('b', { text: label }), h('span', { class: 'latin', text: list.join(' · ') })); }
  function renderPerfume(p) {
    if (window.FF_CLOSE) window.FF_CLOSE();
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
        h('a', { class: 'btn', href: '#quiz' }, 'لقى العطر لي يناسبك'),
        h('a', { class: 'textlink', href: '#fragrances' }, 'رجع للعطور'))));
  }

  // warm up the quiz code when the browser is idle, so the first click opens instantly
  (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(function () { loadQuiz(); });

  route();
}
