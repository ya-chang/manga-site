/* ════════════════════════════════════════════════════════════════
 *  漫画阅读器模块（iOS 18 液态玻璃）
 *  - 复用已验证过的 shell.html 阅读核心
 *  - 改为：从 URL 拉取 PDF（/comics/:work/:file）
 *  - 作为覆盖层挂载到 body，关闭时自行销毁
 *  用法：
 *    MangaReader.open({ url, title, key, startPage, onPrev, onNext })
 *    MangaReader.close()
 * ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const lib = window.pdfjsLib;

  /* ── Worker 引导：http 直接用 vendor 文件，file:// 自动降级主线程 ── */
  (function bootWorker() {
    const base = (location.origin === 'file:')
      ? 'vendor/pdf.worker.min.js'
      : (location.protocol + '//' + location.host + '/vendor/pdf.worker.min.js');
    const tryBlob = () => {
      try {
        const src = window.__PDFJS_WORKER_SRC__ || null;
        if (!src) return false;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const p = new Worker(url); p.terminate();
        lib.GlobalWorkerOptions.workerSrc = url;
        return true;
      } catch (e) { return false; }
    };
    if (location.origin === 'file:') {
      // file:// 下浏览器通常不允许加载外部 worker，尝试内联源码
      if (!tryBlob()) {
        try { (0, eval)(window.__PDFJS_WORKER_SRC__ || ''); } catch (e) {}
        lib.GlobalWorkerOptions.workerSrc = 'inline';
      }
    } else {
      lib.GlobalWorkerOptions.workerSrc = base;
    }
  })();

  const DPR = Math.min(window.devicePixelRatio || 1, 3);
  const MAXW = 2600;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let S = null;        // 当前会话状态
  let host = null;     // #reader 容器

  const $ = s => host.querySelector(s);

  function toast(msg) {
    const t = $('#m-toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(S.toastT);
    S.toastT = setTimeout(() => t.classList.remove('on'), 1900);
  }
  function boot(on, txt) { $('#boot').classList.toggle('on', on); if (txt) $('#m-bootT').textContent = txt; }

  /* ───────────── 构建阅读器 DOM ───────────── */
  function buildDom() {
    const el = document.createElement('div');
    el.id = 'reader';
    el.className = 'glass';
    el.innerHTML = `
      <div id="stage"><div id="flow"></div></div>
      <div class="tapz l" id="m-tzL" hidden><div class="arw"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></div></div>
      <div class="tapz r" id="m-tzR" hidden><div class="arw"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></div></div>
      <aside id="rail" class="glass glass-thick">
        <div class="rail-h">目录</div>
        <div id="thumbs"></div>
      </aside>
      <header id="rbar" class="glass" hidden>
        <button class="ico" id="m-bThumb" title="目录 (T)"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
        <div class="rttl"><div class="n" id="m-tName">—</div><div class="p" id="m-tPage">—</div></div>
        <div class="sep"></div>
        <div class="seg" id="m-segMode">
          <div class="thumb" id="m-segThumb"></div>
          <button data-m="scroll" class="act">条漫</button>
          <button data-m="single">单页</button>
          <button data-m="spread">双页</button>
        </div>
        <div class="sep hide-s"></div>
        <button class="ico" id="m-bRtl" title="日式右起翻页"><svg viewBox="0 0 24 24"><path d="M9 5l-7 7 7 7"/><path d="M2 12h14a5 5 0 0 1 5 5v2"/></svg></button>
        <div class="sep hide-s"></div>
        <button class="ico" id="m-bOut" title="缩小 (−)"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
        <span class="zoomv" id="m-zVal" title="点击重置">100%</span>
        <button class="ico" id="m-bIn" title="放大 (+)"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        <div class="sep"></div>
        <button class="ico" id="m-bFit" title="适应宽度 / 适应高度 (W)"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
        <button class="ico" id="m-bFull" title="全屏 (F)"><svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
        <div class="sep"></div>
        <button class="ico" id="m-bClose" title="关闭 (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <footer id="rfoot" class="glass" hidden>
        <span class="pnum" id="m-fCur">1</span>
        <input type="range" id="m-scrub" min="1" max="1" value="1">
        <span class="pnum r" id="m-fTot">1</span>
        <div class="chnav">
          <button id="m-bPrevCh" title="上一章">‹</button>
          <button id="m-bNextCh" title="下一章">›</button>
        </div>
      </footer>
      <div id="boot"><div class="boot-c glass glass-thick"><div class="ring"></div><div class="boot-t" id="m-bootT">正在解析…</div></div></div>
      <div id="toast" class="glass glass-thick"></div>
    `;
    document.body.appendChild(el);
    return el;
  }

  /* ───────────── 载入 PDF（从 URL） ───────────── */
  async function open(opts) {
    if (S && S.doc) close(true);
    host = buildDom();
    const url = opts.url, title = opts.title || '漫画', key = opts.key || '';
    S = {
      doc: null, n: 0, mode: 'scroll', page: 1, rtl: false,
      zoom: 1, fit: 'width', name: title, key,
      meta: [], slots: [], tasks: new Map(), done: new Set(), thumbDone: new Set(),
      io: null, raf: 0, idle: 0, busy: false, toastT: 0,
      onPrev: opts.onPrev || null, onNext: opts.onNext || null,
      onClose: opts.onClose || null, destroyed: false,
    };
    wire();
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => host.classList.add('on'));

    boot(true, '正在读取文件…');
    try {
      boot(true, '正在解析 PDF…');
      // 直接把 url 交给 pdf.js，由它按 Range 分块读取：翻到哪页拉哪页，
      // 不再整本下载，扫描图大文件也能秒开。OSS 已支持 Range + 跨域 CORS。
      const task = lib.getDocument({
        url,
        cMapPacked: true,
        disableStream: false,   // 允许流式分块
        disableAutoFetch: true, // 只取需要的页，不贪心预拉整本
        rangeChunkSize: 1048576,
      });
      task.onProgress = p => { if (p.total) boot(true, '正在解析 PDF… ' + Math.round(p.loaded / p.total * 100) + '%'); };
      const doc = await task.promise;

      S.doc = doc; S.n = doc.numPages; S.name = title;
      boot(true, '正在测量页面…');
      S.meta = new Array(S.n);
      const probeN = Math.min(S.n, 10);
      for (let i = 1; i <= probeN; i++) {
        const p = await doc.getPage(i);
        const v = p.getViewport({ scale: 1 });
        S.meta[i - 1] = { w: v.width, h: v.height, r: v.height / v.width };
        p.cleanup();
      }
      const fb = S.meta[0];
      for (let i = probeN; i < S.n; i++) if (!S.meta[i]) S.meta[i] = { w: fb.w, h: fb.h, r: fb.r, guess: true };

      S.mode = 'scroll'; S.rtl = false; S.zoom = 1; S.fit = 'width';

      host.querySelector('#stage').classList.add('on');
      host.querySelector('#rbar').hidden = false;
      host.querySelector('#rfoot').hidden = false;
      host.querySelector('#m-tName').textContent = S.name;
      host.querySelector('#m-fTot').textContent = S.n;
      host.querySelector('#m-scrub').max = S.n;
      setMode(S.mode, true);
      buildThumbs(); moveThumb();

      const saved = +(localStorage.getItem(S.key) || 0);
      if (saved > 1 && saved <= S.n) { goto(saved, true); toast('已回到第 ' + saved + ' 页'); }
      else goto(1, true);
    } catch (err) {
      console.error(err);
      toast('打开失败：' + (err && err.message ? err.message : '文件可能已损坏或无法访问'));
    } finally { boot(false); }
  }

  function close(silent) {
    if (!host) return;
    const h = host; host = null;
    const wasOn = !!S;
    if (S) {
      S.tasks.forEach(t => { try { t.cancel(); } catch (e) {} }); S.tasks.clear();
      if (S.io) { try { S.io.disconnect(); } catch (e) {} }
      if (S.doc) { try { S.doc.destroy(); } catch (e) {} }
      if (S.key) localStorage.setItem(S.key, String(S.page));
    }
    const cb = S ? S.onClose : null;
    S = null;
    h.remove();
    document.body.style.overflow = '';
    if (cb && !silent) cb();
    if (wasOn) void 0;
  }

  function reset() {
    if (!S) return;
    S.tasks.forEach(t => { try { t.cancel(); } catch (e) {} }); S.tasks.clear();
    S.done.clear(); S.thumbDone.clear();
    if (S.io) { S.io.disconnect(); S.io = null; }
    if (S.doc) { try { S.doc.destroy(); } catch (e) {} }
    $('#flow').innerHTML = ''; $('#thumbs').innerHTML = '';
    const d = $('#deck'); if (d) d.remove();
    S.slots = [];
  }

  /* ───────────── 尺寸 ───────────── */
  function viewBox() { return { w: $('#stage').clientWidth, h: $('#stage').clientHeight }; }
  function pageWidth(idx) {
    const vb = viewBox(), m = S.meta[idx] || S.meta[0];
    if (S.mode === 'scroll') {
      const base = Math.min(vb.w - 18, 1000);
      return Math.max(240, base * S.zoom);
    }
    const cols = S.mode === 'spread' ? 2 : 1;
    const availW = (vb.w - 60 - (cols > 1 ? 10 : 0)) / cols;
    const availH = vb.h - 166;
    let w = S.fit === 'height' ? availH / m.r : availW;
    w = Math.min(w, availW);
    if (S.fit === 'width') { const hh = w * m.r; if (hh > availH) w = availH / m.r; }
    return Math.max(160, w * S.zoom);
  }

  /* ───────────── 渲染单页 ───────────── */
  async function draw(num, h, cssW) {
    if (!S || !S.doc) return;
    const kk = h.dataset.k = num + '@' + Math.round(cssW);
    if (S.tasks.has(h)) { try { S.tasks.get(h).cancel(); } catch (e) {} S.tasks.delete(h); }
    try {
      const page = await S.doc.getPage(num);
      if (h.dataset.k !== kk || S.destroyed) return;
      const v1 = page.getViewport({ scale: 1 });
      S.meta[num - 1] = { w: v1.width, h: v1.height, r: v1.height / v1.width };
      const w = Math.min(cssW, Math.min(3600, MAXW * Math.max(1, S.zoom)));
      const vp = page.getViewport({ scale: (w / v1.width) * DPR });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.style.width = '100%'; cv.style.height = '100%';
      const t = page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp });
      S.tasks.set(h, t);
      await t.promise;
      S.tasks.delete(h);
      if (h.dataset.k !== kk || S.destroyed) return;
      h.innerHTML = ''; h.appendChild(cv);
      S.done.add(num);
      page.cleanup();
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      console.warn('page', num, e);
    }
  }
  function skeleton(num) {
    const d = document.createElement('div'); d.className = 'ld';
    d.innerHTML = '<span class="no">' + num + '</span>'; return d;
  }

  /* ───────────── 条漫模式 ───────────── */
  function buildFlow() {
    const flow = $('#flow'); flow.innerHTML = ''; flow.classList.add('gap'); S.slots = []; S.done.clear();
    const w = pageWidth(0);
    flow.style.width = w + 'px';
    for (let i = 1; i <= S.n; i++) {
      const m = S.meta[i - 1];
      const el = document.createElement('div');
      el.className = 'pg'; el.dataset.i = i;
      el.style.width = w + 'px'; el.style.height = Math.round(w * m.r) + 'px';
      el.appendChild(skeleton(i));
      flow.appendChild(el); S.slots.push(el);
    }
    if (S.io) S.io.disconnect();
    S.io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const el = en.target, i = +el.dataset.i;
        if (en.isIntersecting) {
          if (!S.done.has(i) || !el.querySelector('canvas')) draw(i, el, pageWidth(i - 1));
        } else if (el.querySelector('canvas')) {
          const r = el.getBoundingClientRect();
          if (r.bottom < -2600 || r.top > window.innerHeight + 2600) {
            el.innerHTML = ''; el.appendChild(skeleton(i)); S.done.delete(i);
          }
        }
      });
    }, { root: $('#stage'), rootMargin: '1400px 0px' });
    S.slots.forEach(el => S.io.observe(el));
  }
  function flowCurrent() {
    const st = $('#stage'), mid = st.scrollTop + st.clientHeight * 0.38;
    let acc = 74;
    for (let i = 0; i < S.slots.length; i++) {
      const h = S.slots[i].offsetHeight;
      if (mid < acc + h) return i + 1;
      acc += h;
    }
    return S.n;
  }
  function flowScrollTo(n, instant) {
    const el = S.slots[n - 1]; if (!el) return;
    $('#stage').scrollTo({ top: el.offsetTop - 74, behavior: instant ? 'auto' : 'smooth' });
  }

  /* ───────────── 翻页模式 ───────────── */
  function buildDeck() {
    $('#flow').innerHTML = ''; $('#flow').classList.remove('gap'); $('#flow').style.width = '';
    let deck = $('#deck');
    if (!deck) { deck = document.createElement('div'); deck.id = 'deck'; $('#stage').appendChild(deck); }
    return deck;
  }
  function paintDeck(dir) {
    const deck = $('#deck'); if (!deck) return;
    deck.innerHTML = '';
    deck.classList.remove('anim'); void deck.offsetWidth; deck.classList.add('anim');
    deck.style.setProperty('--dir', (dir < 0 ? '-14px' : '14px'));
    let list = S.mode === 'spread'
      ? (S.page === 1 ? [1] : [S.page, S.page + 1 <= S.n ? S.page + 1 : null].filter(Boolean))
      : [S.page];
    if (S.mode === 'spread' && S.rtl) list = list.slice().reverse();
    list.forEach(n => {
      const m = S.meta[n - 1], w = pageWidth(n - 1);
      const el = document.createElement('div');
      el.className = 'pg'; el.dataset.i = n;
      el.style.width = w + 'px'; el.style.height = Math.round(w * m.r) + 'px';
      el.appendChild(skeleton(n));
      deck.appendChild(el);
      draw(n, el, w);
    });
    [S.page + 1, S.page + 2, S.page - 1].forEach(n => {
      if (n >= 1 && n <= S.n && S.doc) S.doc.getPage(n).catch(() => {});
    });
  }

  /* ───────────── 模式 / 导航 ───────────── */
  function setMode(m, init) {
    const keep = S.page;
    S.mode = m;
    document.querySelectorAll('#m-segMode button').forEach(b => b.classList.toggle('act', b.dataset.m === m));
    moveThumb();
    const isPage = m !== 'scroll';
    $('#m-tzL').hidden = !isPage; $('#m-tzR').hidden = !isPage;
    $('#m-bRtl').style.display = m === 'spread' || m === 'single' ? '' : 'none';
    S.tasks.forEach(t => { try { t.cancel(); } catch (e) {} }); S.tasks.clear();
    if (m === 'scroll') {
      const d = $('#deck'); if (d) d.remove();
      S.fit = 'width'; buildFlow();
      if (!init) flowScrollTo(keep, true); else flowScrollTo(1, true);
    } else {
      if (S.io) { S.io.disconnect(); S.io = null; }
      S.slots = []; S.fit = 'height';
      buildDeck(); paintDeck(1);
    }
    sync();
  }
  function goto(n, instant) {
    n = clamp(Math.round(n), 1, S.n);
    const dir = n >= S.page ? 1 : -1;
    S.page = n;
    if (S.mode === 'scroll') flowScrollTo(n, instant);
    else paintDeck(dir);
    sync();
    if (S.key) localStorage.setItem(S.key, String(n));
  }
  function step(d) {
    const jump = S.mode === 'spread' ? (S.page === 1 ? 1 : 2) : 1;
    goto(S.page + d * jump);
  }
  function sync() {
    $('#m-tPage').textContent = S.page + ' / ' + S.n + '  ·  ' + ({ scroll: '条漫', single: '单页', spread: '双页' }[S.mode]);
    $('#m-fCur').textContent = S.page;
    const sc = $('#m-scrub'); sc.value = S.page;
    sc.style.setProperty('--fill', ((S.page - 1) / Math.max(1, S.n - 1) * 100) + '%');
    $('#m-zVal').textContent = Math.round(S.zoom * 100) + '%';
    const cur = $('#thumbs .th.cur'); if (cur) cur.classList.remove('cur');
    const t = $('#thumbs .th[data-i="' + S.page + '"]');
    if (t) { t.classList.add('cur'); if ($('#rail').classList.contains('on')) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function moveThumb() {
    const seg = $('#m-segMode'), th = $('#m-segThumb');
    const act = seg.querySelector('button.act'); if (!act) return;
    th.style.left = act.offsetLeft + 'px'; th.style.width = act.offsetWidth + 'px';
  }

  /* ───────────── 缩放 ───────────── */
  function zoomBy(d) {
    S.zoom = clamp(+(S.zoom + d).toFixed(2), 0.35, 3.5);
    S.fit = 'custom'; applyZoom();
  }
  function applyZoom() {
    if (S.mode === 'scroll') {
      const cur = S.page, w = pageWidth(0);
      $('#flow').style.width = w + 'px';
      S.slots.forEach((el, i) => {
        el.style.width = w + 'px'; el.style.height = Math.round(w * S.meta[i].r) + 'px';
        const i1 = i + 1;
        if (el.querySelector('canvas')) draw(i1, el, w);
      });
      flowScrollTo(cur, true);
    } else paintDeck(1);
    sync();
  }
  function toggleFit() {
    if (S.mode === 'scroll') {
      S.zoom = S.zoom > 1.001 ? 1 : 1.4;
    } else {
      S.fit = S.fit === 'height' ? 'width' : 'height';
      S.zoom = 1;
      toast(S.fit === 'height' ? '适应高度' : '适应宽度');
    }
    applyZoom();
  }

  /* ───────────── 缩略图 ───────────── */
  function buildThumbs() {
    const box = $('#thumbs'); box.innerHTML = '';
    for (let i = 1; i <= S.n; i++) {
      const m = S.meta[i - 1];
      const el = document.createElement('div');
      el.className = 'th'; el.dataset.i = i;
      el.style.height = Math.round(146 * Math.min(m.r, 2.4)) + 'px';
      el.innerHTML = '<span class="lbl">' + i + '</span>';
      el.addEventListener('click', () => goto(i));
      box.appendChild(el);
    }
    const io = new IntersectionObserver(es => {
      es.forEach(async en => {
        if (!en.isIntersecting) return;
        const el = en.target, i = +el.dataset.i;
        if (S.thumbDone.has(i)) return;
        S.thumbDone.add(i);
        try {
          const p = await S.doc.getPage(i);
          const v1 = p.getViewport({ scale: 1 });
          const w = 146, vp = p.getViewport({ scale: w / v1.width });
          const cv = document.createElement('canvas');
          cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          cv.style.width = '100%'; cv.style.height = 'auto';
          await p.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
          el.style.height = 'auto';
          el.insertBefore(cv, el.firstChild);
          p.cleanup();
        } catch (e) { S.thumbDone.delete(i); }
      });
    }, { root: box, rootMargin: '400px 0px' });
    box.querySelectorAll('.th').forEach(t => io.observe(t));
  }

  /* ───────────── 自动隐藏工具栏 ───────────── */
  function wake() {
    $('#rbar').classList.remove('hide'); $('#rfoot').classList.remove('hide');
    clearTimeout(S.idle);
    S.idle = setTimeout(() => {
      if (!S || !S.doc) return;
      if ($('#rail').classList.contains('on')) return;
      if (host.querySelector('#rbar:hover,#rfoot:hover')) return;
      $('#rbar').classList.add('hide'); $('#rfoot').classList.add('hide');
    }, 2800);
  }

  /* ───────────── 事件绑定 ───────────── */
  function wire() {
    $('#m-segMode').addEventListener('click', e => {
      const b = e.target.closest('button[data-m]'); if (!b || !S || !S.doc) return;
      setMode(b.dataset.m);
    });
    $('#m-bRtl').addEventListener('click', () => {
      S.rtl = !S.rtl; $('#m-bRtl').classList.toggle('on', S.rtl);
      toast(S.rtl ? '右起翻页（日式）' : '左起翻页');
      if (S.mode !== 'scroll') paintDeck(1);
    });
    $('#m-bThumb').addEventListener('click', () => {
      const on = $('#rail').classList.toggle('on');
      $('#m-bThumb').classList.toggle('on', on); wake();
    });
    $('#m-bIn').addEventListener('click', () => zoomBy(.15));
    $('#m-bOut').addEventListener('click', () => zoomBy(-.15));
    $('#m-zVal').addEventListener('click', () => { S.zoom = 1; S.fit = S.mode === 'scroll' ? 'width' : 'height'; applyZoom(); });
    $('#m-bFit').addEventListener('click', toggleFit);
    $('#m-bFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
    $('#m-bClose').addEventListener('click', () => close());
    $('#m-scrub').addEventListener('input', e => {
      S.page = +e.target.value; sync();
      if (S.mode === 'scroll') flowScrollTo(S.page, true);
    });
    $('#m-scrub').addEventListener('change', e => goto(+e.target.value, true));
    $('#m-tzL').addEventListener('click', () => step(S.rtl ? 1 : -1));
    $('#m-tzR').addEventListener('click', () => step(S.rtl ? -1 : 1));
    $('#m-bPrevCh').addEventListener('click', () => { if (S.onPrev) S.onPrev(); });
    $('#m-bNextCh').addEventListener('click', () => { if (S.onNext) S.onNext(); });

    let sT;
    $('#stage').addEventListener('scroll', () => {
      wake();
      if (!S || S.mode !== 'scroll' || !S.doc) return;
      cancelAnimationFrame(S.raf);
      S.raf = requestAnimationFrame(() => {
        const p = flowCurrent();
        if (p !== S.page) {
          S.page = p; sync(); clearTimeout(sT);
          sT = setTimeout(() => { if (S.key) localStorage.setItem(S.key, String(p)); }, 500);
        }
      });
    }, { passive: true });

    document.addEventListener('mousemove', wake, { passive: true });
    document.addEventListener('touchstart', wake, { passive: true });

    document.addEventListener('keydown', e => {
      if (!S || !S.doc) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(.15); }
        if (e.key === '-') { e.preventDefault(); zoomBy(-.15); }
        return;
      }
      const k = e.key;
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); step(S.rtl ? -1 : 1); wake(); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); step(S.rtl ? 1 : -1); wake(); }
      else if (k === ' ') { e.preventDefault(); S.mode === 'scroll' ? $('#stage').scrollBy({ top: $('#stage').clientHeight * .86, behavior: 'smooth' }) : step(1); wake(); }
      else if (k === 'ArrowDown' && S.mode !== 'scroll') { e.preventDefault(); step(1); }
      else if (k === 'ArrowUp' && S.mode !== 'scroll') { e.preventDefault(); step(-1); }
      else if (k === 'Home') { e.preventDefault(); goto(1); }
      else if (k === 'End') { e.preventDefault(); goto(S.n); }
      else if (k === '+' || k === '=') { zoomBy(.15); }
      else if (k === '-' || k === '_') { zoomBy(-.15); }
      else if (k === '0') { S.zoom = 1; applyZoom(); }
      else if (k === 't' || k === 'T') { $('#m-bThumb').click(); }
      else if (k === 'w' || k === 'W') { toggleFit(); }
      else if (k === 'f' || k === 'F') { $('#m-bFull').click(); }
      else if (k === '1') { setMode('scroll'); }
      else if (k === '2') { setMode('single'); }
      else if (k === '3') { setMode('spread'); }
      else if (k === 'Escape') { if ($('#rail').classList.contains('on')) $('#m-bThumb').click(); else close(); }
    });

    /* ── 触摸手势：单页/双页模式下的点按翻页、滑动翻页、捏合缩放、双击缩放 ── */
    let tx = 0, ty = 0, tt = 0, moved = false, lastX = 0, lastY = 0;
    let pinchD = 0, pinchZ = 1, tapTimer = 0, lastTapT = 0, lastTapX = 0, lastTapY = 0;
    const tdist = ts => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    $('#stage').addEventListener('touchstart', e => {
      if (!S) return;
      if (S.mode === 'scroll') {
        if (e.touches.length === 2) { pinchD = tdist(e.touches); pinchZ = S.zoom; e.preventDefault(); }
        return;                                  // 1 指交给原生滚动
      }
      if (e.touches.length === 1) {
        tx = lastX = e.touches[0].clientX; ty = lastY = e.touches[0].clientY; tt = Date.now(); moved = false;
      } else if (e.touches.length === 2) {
        pinchD = tdist(e.touches); pinchZ = S.zoom; e.preventDefault();
      }
    }, { passive: false });
    $('#stage').addEventListener('touchmove', e => {
      if (!S) return;
      if (S.mode === 'scroll') {
        if (e.touches.length === 2 && pinchD) {
          e.preventDefault();
          const d = tdist(e.touches);
          if (d > 0) { S.zoom = clamp(pinchZ * d / pinchD, 0.4, 6); S.fit = 'custom'; applyZoom(); }
        }
        return;                                  // 1 指滚动走原生
      }
      if (e.touches.length === 2 && pinchD) {
        e.preventDefault();
        const d = tdist(e.touches);
        if (d > 0) { S.zoom = clamp(pinchZ * d / pinchD, 0.4, 6); S.fit = 'custom'; applyZoom(); }
      } else if (e.touches.length === 1 && S.zoom > 1.05) {
        // 放大后单指拖动交给原生滚动平移（不拦截）
      } else if (e.touches.length === 1) {
        if (Math.abs(e.touches[0].clientX - tx) > 8 || Math.abs(e.touches[0].clientY - ty) > 8) moved = true;
      }
    }, { passive: false });
    $('#stage').addEventListener('touchend', e => {
      if (!S) return;
      if (S.mode === 'scroll') {
        if (pinchD) { pinchD = 0; S._touchTap = Date.now(); }   // 捏合结束：抑制随后的合成 click
        return;                                  // scroll 模式不翻页
      }
      if (e.touches.length >= 1) return;            // 还有手指按着，忽略
      if (pinchD) { pinchD = 0; S._touchTap = Date.now(); return; }  // 结束捏合，不触发翻页
      const t = e.changedTouches[0];
      const dt = Date.now() - tt;
      if (!moved && dt < 320 && S.zoom <= 1.05) {
        // 双击切换缩放（1x <-> 2x）
        if (Date.now() - lastTapT < 300 && Math.abs(t.clientX - lastTapX) < 40 && Math.abs(t.clientY - lastTapY) < 40) {
          clearTimeout(tapTimer); lastTapT = 0;
          S.zoom = S.zoom > 1.05 ? 1 : 2;
          S.fit = 'custom';
          applyZoom();
          return;
        }
        lastTapT = Date.now(); lastTapX = t.clientX; lastTapY = t.clientY;
        const r = $('#stage').getBoundingClientRect();
        const prev = ((t.clientX - r.left) / r.width) < 0.35;
        const dir = prev ? (S.rtl ? 1 : -1) : (S.rtl ? -1 : 1);
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => step(dir), 240);  // 延迟 240ms 以区分双击
        S._touchTap = Date.now();
      } else if (moved && S.zoom <= 1.05) {
        const dx = t.clientX - tx;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(t.clientY - ty) * 1.6)
          step(dx < 0 ? (S.rtl ? -1 : 1) : (S.rtl ? 1 : -1));
      }
      tt = 0; moved = false;
    }, { passive: false });

    /* ── 桌面：单页/双页点击图片翻页（手机触摸由上面的手势处理）── */
    $('#stage').addEventListener('click', e => {
      if (!S || S.mode === 'scroll') return;
      if (e.target.closest('#rbar,#rfoot,#rail')) return;
      if (S.zoom > 1.05) return;                    // 放大时交给平移
      if (S._touchTap && Date.now() - S._touchTap < 600) return;  // 忽略触摸产生的合成 click
      const r = $('#stage').getBoundingClientRect();
      const prev = ((e.clientX - r.left) / r.width) < 0.35;
      step(prev ? (S.rtl ? 1 : -1) : (S.rtl ? -1 : 1));
    });

    let rz;
    window.addEventListener('resize', () => {
      if (!S || !S.doc) return;
      clearTimeout(rz); rz = setTimeout(() => { moveThumb(); applyZoom(); }, 220);
    });
    window.addEventListener('beforeunload', () => { if (S && S.key) localStorage.setItem(S.key, String(S.page)); });

    moveThumb();
  }

  window.MangaReader = { open, close };
})();
