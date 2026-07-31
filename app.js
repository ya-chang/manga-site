/* ════════════════════════════════════════════════════════════════
 *  漫画书架 · 前端主控
 *  - 有后端：走 /api/* 接口
 *  - 无后端：回落到静态 library.json + 相对 comics/ 目录
 *  - 阅读器由 reader.js 提供（MangaReader.open）
 * ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const app = document.getElementById('app');
  const state = {
    backend: false,
    site: { title: '漫画书架', tagline: '把喜欢的故事，一页一页收好' },
    works: [],
    token: localStorage.getItem('mb:token') || '',
    busy: false,
    comicBase: '',   // 无后端模式下 PDF 的绝对前缀（如 OSS 公开地址），留空则用同源相对 comics/
  };

  /* ───────── 工具 ───────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtSize(n) { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n; while (v >= 1024 && i < 3) { v /= 1024; i++; } return (i ? v.toFixed(1) : v) + ' ' + u[i]; }

  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2000);
  }
  function loading(on, txt) {
    const b = $('#boot'); b.classList.toggle('on', on); if (txt) $('#bootT').textContent = txt;
  }

  function comicsBase() { return state.backend ? '/comics/' : (state.comicBase || 'comics/'); }

  /* ───────── API（后端模式） ───────── */
  async function api(method, path, opts = {}) {
    const headers = {};
    if (state.token) headers['x-admin-token'] = state.token;
    const init = { method, headers, credentials: 'same-origin' };
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    if (opts.body instanceof FormData) init.body = opts.body;
    const res = await fetch(path, init);
    if (!res.ok) {
      let err = '请求失败 (' + res.status + ')';
      try { const j = await res.json(); if (j && j.error) err = j.error; } catch (e) {}
      throw new Error(err);
    }
    if (res.status === 204) return null;
    try { return await res.json(); } catch (e) { return null; }
  }

  /* ───────── 载入书库 ───────── */
  async function loadLibrary() {
    // 先探测后端
    try {
      const res = await fetch('/api/library', { credentials: 'same-origin' });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) { state.backend = true; const d = await res.json(); applyLibrary(d); return; }
      }
    } catch (e) { /* 无后端，走回落 */ }
    // 回落：静态 library.json（需通过任意静态服务器打开）
    state.backend = false;
    try {
      const d = await fetch('library.json', { cache: 'no-store' }).then(r => r.json());
      applyLibrary(d);
    } catch (e) {
      applyLibrary({ site: state.site, works: [] });
      toast('未检测到后端，也未找到 library.json（请用服务器打开本站点）');
    }
  }
  function applyLibrary(d) {
    state.site = d.site || state.site;
    state.comicBase = d.comicBase ? String(d.comicBase).replace(/\/?$/, '/') : '';   // 无后端时 PDF 绝对前缀（可选）
    state.works = (d.works || []).map(w => ({
      id: w.id, title: w.title, subtitle: w.subtitle || '', tint: w.tint || '#0a84ff',
      desc: w.desc || '', chapters: (w.chapters || []).map(c => ({ ...c })),
    }));
  }

  /* ───────── 进度记忆 ───────── */
  function progKey(work, ch) { return 'mr:' + work + ':' + ch; }
  function getProg(work, ch) {
    try { const p = +localStorage.getItem(progKey(work, ch)) || 0; const t = +localStorage.getItem(progKey(work, ch) + ':t') || 0; return { p, t }; }
    catch (e) { return { p: 0, t: 0 }; }
  }

  /* ───────── 渲染：导航 ───────── */
  function renderNav() {
    document.documentElement.style.setProperty('--tint', state.site.tint || '#0a84ff');
    $('#brandName').textContent = state.site.title || '漫画书架';
    const links = $('#navlinks'); links.innerHTML = '';
    state.works.forEach((w, i) => {
      const a = h(`<a class="nlink" href="#/work/${encodeURIComponent(w.id)}">${esc(w.title)}</a>`);
      a.style.setProperty('--tint', w.tint);
      links.appendChild(a);
    });
    highlightNav();
  }
  function highlightNav() {
    const hash = location.hash || '#/';
    $$('#navlinks .nlink').forEach(a => {
      const id = decodeURIComponent((a.getAttribute('href') || '').replace('#/work/', ''));
      const isWork = hash.startsWith('#/work/') && hash.includes(id);
      a.classList.toggle('act', isWork);
    });
    $('#brandName').parentElement.classList.toggle('act', false);
  }

  /* ───────── 渲染：首页 ───────── */
  function renderHome() {
    const wrap = h(`<div class="view fade"><div class="wrap">
      <section class="hero">
        <h1>${esc(state.site.title || '漫画书架')}</h1>
        <p>${esc(state.site.tagline || '')}</p>
      </section>
      <div class="grid" id="grid"></div>
    </div></div>`);
    const grid = wrap.querySelector('#grid');
    if (!state.works.length) {
      grid.appendChild(h(`<div class="empty glass"><div class="ic"><svg viewBox="0 0 24 24"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v6h6"/></svg></div><h4>书架空空如也</h4><p>开通后端后在「后台管理」上传漫画，<br>或把 PDF 直接放进 comics/ 文件夹后点击「扫描」。</p></div>`));
    }
    state.works.forEach((w, i) => {
      const cnt = w.chapters.length;
      const card = h(`<a class="wcard glass" href="#/work/${encodeURIComponent(w.id)}" style="--wt:${esc(w.tint)}">
        <div class="top"><b>${esc(w.title)}</b><em>${esc(w.subtitle || w.title.slice(0, 1))}</em></div>
        <div class="bot"><div class="sb">${esc(w.subtitle || '')}</div>
          <div class="ct"><b>${cnt}</b> 个章节${w.desc ? ' · ' + esc(w.desc.slice(0, 18)) : ''}</div></div>
      </a>`);
      card.style.animationDelay = (0.04 * i) + 's';
      grid.appendChild(card);
    });
    swapView(wrap);
    highlightNav();
  }

  /* ───────── 渲染：作品页 ───────── */
  function renderWork(id) {
    const w = state.works.find(x => x.id === id);
    if (!w) { location.hash = '#/'; return; }
    document.documentElement.style.setProperty('--tint', w.tint);

    const chs = w.chapters;
    const wrap = h(`<div class="view fade"><div class="wrap">
      <a class="back" href="#/"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>返回书架</a>
      <header class="whead">
        <div class="wposter" style="--tint:${esc(w.tint)}"><em>${esc(w.title.slice(0, 1))}</em></div>
        <div class="wmeta">
          <h2>${esc(w.title)}</h2>
          <div class="sb">${esc(w.subtitle || '')}</div>
          <div class="ds">${esc(w.desc || '点击章节开始阅读，进度会自动保存。')}</div>
        </div>
      </header>
      <div class="sechd"><h3>章节</h3><span class="c">${chs.length} 话</span></div>
      <div class="chlist glass" id="chlist"></div>
    </div></div>`);
    const list = wrap.querySelector('#chlist');
    if (!chs.length) {
      list.appendChild(h(`<div class="empty" style="box-shadow:none"><div class="ic"><svg viewBox="0 0 24 24"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v6h6"/></svg></div><h4>还没有章节</h4><p>在「后台管理」上传 PDF，或把文件放进 comics/${esc(w.id)}/ 然后扫描。</p></div>`));
    }
    chs.forEach((c, i) => {
      const pr = getProg(w.id, c.id);
      const pct = pr.t ? Math.min(100, Math.round(pr.p / pr.t * 100)) : 0;
      const row = h(`<div class="ch ${pct >= 100 ? 'read' : ''}" data-id="${esc(c.id)}" data-i="${i}">
        <span class="rd"></span>
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="nm">${esc(c.title || ('第 ' + (i + 1) + ' 话'))}</span>
        <span class="prog">${pr.p > 1 ? '在读 ' + pct + '%' : ''}</span>
        <span class="sz">${fmtSize(c.size)}</span>
        <span class="go"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span>
      </div>`);
      row.addEventListener('click', () => { location.hash = '#/read/' + encodeURIComponent(w.id) + '/' + encodeURIComponent(c.id); });
      list.appendChild(row);
    });
    swapView(wrap);
    highlightNav();
  }

  /* ───────── 阅读器 ───────── */
  let currentRead = null;   // 当前在阅读器中的 {work, chapter}

  function openReader(workId, chapterId) {
    const w = state.works.find(x => x.id === workId);
    if (!w) { location.hash = '#/'; return; }
    const idx = w.chapters.findIndex(c => c.id === chapterId);
    if (idx < 0) { toast('章节不存在'); location.hash = '#/work/' + encodeURIComponent(workId); return; }
    const c = w.chapters[idx];
    const url = comicsBase() + encodeURIComponent(workId) + '/' + encodeURIComponent(c.file);
    const key = progKey(workId, c.id);
    const saved = getProg(workId, c.id);
    currentRead = { work: workId, chapter: chapterId };

    const onPrev = idx > 0 ? () => { location.hash = '#/read/' + encodeURIComponent(workId) + '/' + encodeURIComponent(w.chapters[idx - 1].id); } : null;
    const onNext = idx < w.chapters.length - 1 ? () => { location.hash = '#/read/' + encodeURIComponent(workId) + '/' + encodeURIComponent(w.chapters[idx + 1].id); } : null;

    MangaReader.open({
      url, title: c.title || w.title, key, startPage: saved.p || 1,
      onPrev, onNext,
      onClose: () => { currentRead = null; if (location.hash.startsWith('#/read/')) location.hash = '#/work/' + encodeURIComponent(workId); },
    });
  }

  /* ───────── 后台 ───────── */
  function requireAuth() {
    if (!state.backend) { toast('当前为静态模式，无后端可管理'); return false; }
    if (!state.token) { showLogin(); return false; }
    return true;
  }
  function showLogin() {
    const ov = $('#login'); ov.hidden = false; $('#loginErr').textContent = ''; $('#loginPwd').value = '';
    setTimeout(() => $('#loginPwd').focus(), 60);
  }
  function hideLogin() { $('#login').hidden = true; }

  async function doLogin() {
    const pwd = $('#loginPwd').value;
    if (!pwd) { $('#loginErr').textContent = '请输入密码'; return; }
    loading(true, '验证中…');
    try {
      const r = await api('POST', '/api/login', { json: { password: pwd } });
      state.token = r.token; localStorage.setItem('mb:token', r.token);
      hideLogin(); loading(false);
      location.hash = '#admin';
    } catch (e) {
      loading(false); $('#loginErr').textContent = e.message || '登录失败';
    }
  }

  function renderAdmin() {
    if (!requireAuth()) return;
    document.documentElement.style.setProperty('--tint', state.site.tint || '#0a84ff');
    const wrap = h(`<div class="view fade"><div class="wrap" style="max-width:920px">
      <a class="back" href="#/"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>返回书架</a>
      <div class="adm">
        <section class="panel glass"><h3>站点信息</h3><div class="hint">修改后点击保存，会同步到书库。</div>
          <div class="fld"><input class="inp" id="siteTitle" placeholder="站点名称" value="${esc(state.site.title)}"></div>
          <div class="fld"><input class="inp" id="siteTag" placeholder="一句话标语" value="${esc(state.site.tagline)}"></div>
          <div class="fld"><button class="btn sm" id="saveSite">保存站点</button></div>
        </section>

        <section class="panel glass"><h3>添加分类</h3><div class="hint">分类即导航栏里的作品（如：艳势番）。</div>
          <div class="fld">
            <input class="inp" id="newTitle" placeholder="分类名称">
            <input class="inp w" id="newSub" placeholder="英文副标(可选)">
            <input type="color" class="inp" id="newTint" value="#0a84ff" title="主题色">
            <button class="btn sm" id="addWork">添加</button>
          </div>
        </section>

        <section class="panel glass"><h3>分类与章节</h3><div class="hint">上传 PDF（支持到 2GB）、重命名、排序、删除，或扫描 comics/ 文件夹。</div>
          <div class="fld"><button class="btn ghost sm" id="rescan">扫描 comics/ 文件夹</button></div>
          <div id="worksMgr" style="margin-top:14px;display:grid;gap:18px"></div>
        </section>
      </div>
    </div></div>`);
    swapView(wrap);
    $('#saveSite').addEventListener('click', async () => {
      try { await api('PATCH', '/api/site', { json: { title: $('#siteTitle').value, tagline: $('#siteTag').value } }); toast('已保存'); await reload(); }
      catch (e) { toast(e.message); }
    });
    $('#addWork').addEventListener('click', async () => {
      const title = $('#newTitle').value.trim(); if (!title) { toast('请填写分类名称'); return; }
      try { await api('POST', '/api/work', { json: { title, subtitle: $('#newSub').value.trim(), tint: $('#newTint').value } });
        $('#newTitle').value = ''; $('#newSub').value = ''; toast('已添加分类'); await reload(); }
      catch (e) { toast(e.message); }
    });
    $('#rescan').addEventListener('click', async () => {
      loading(true, '扫描中…');
      try { const r = await api('POST', '/api/rescan'); loading(false); toast(`扫描完成：新增 ${r.added} 话 / 新建 ${r.newWorks} 个分类`); await reload(); }
      catch (e) { loading(false); toast(e.message); }
    });
    renderWorksMgr(wrap.querySelector('#worksMgr'));
  }

  function renderWorksMgr(box) {
    box.innerHTML = '';
    if (!state.works.length) { box.appendChild(h(`<div class="empty glass"><h4>还没有分类</h4><p>用上面的表单添加第一个分类。</p></div>`)); return; }
    state.works.forEach((w, wi) => {
      const block = h(`<div class="mgr glass" data-wid="${esc(w.id)}">
        <div class="mrow" style="border-radius:12px">
          <span class="sw" style="background:${esc(w.tint)}"></span>
          <input value="${esc(w.title)}" data-f="title" style="font-weight:600">
          <input value="${esc(w.subtitle || '')}" data-f="subtitle" placeholder="副标" style="max-width:120px">
          <span class="tag">${w.chapters.length} 话</span>
          <button class="x" data-act="del" title="删除分类"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div class="fld" style="margin-top:10px">
          <input class="inp" data-f="desc" value="${esc(w.desc || '')}" placeholder="简介（选填）">
          <input type="color" class="inp" data-f="tint" value="${esc(w.tint)}" title="主题色" style="width:42px">
          <button class="btn ghost sm" data-act="edit">保存修改</button>
        </div>
        <div class="upz" data-wid="${esc(w.id)}">
          <div class="t">＋ 拖拽或点击上传 PDF 到「${esc(w.title)}」</div>
          <div class="s">支持大文件（500MB+）；可一次选择多个</div>
        </div>
        <div class="bars" data-bars></div>
        <div class="mgr" data-chs style="margin-top:12px;box-shadow:none;background:rgba(255,255,255,.4)"></div>
      </div>`);
      box.appendChild(block);

      const chsBox = block.querySelector('[data-chs]');
      renderChapterRows(w, chsBox);

      // 删除分类
      block.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm('删除分类「' + w.title + '」？勾选彻底删除会一并移除本地 PDF。')) return;
        const purge = confirm('是否同时删除该分类下的 PDF 文件？（取消=仅从书库移除，文件保留）');
        try { await api('DELETE', '/api/work', { json: { id: w.id, purge } }); toast('已删除'); await reload(); }
        catch (e) { toast(e.message); }
      });
      // 保存分类修改
      block.querySelector('[data-act="edit"]').addEventListener('click', async () => {
        const f = b => block.querySelector('[data-f="' + b + '"]').value;
        try { await api('PATCH', '/api/work', { json: { id: w.id, title: f('title'), subtitle: f('subtitle'), desc: f('desc'), tint: f('tint') } }); toast('已保存'); await reload(); }
        catch (e) { toast(e.message); }
      });

      // 上传区
      const upz = block.querySelector('.upz');
      const fileInput = h(`<input type="file" accept="application/pdf,.pdf" multiple hidden>`);
      block.appendChild(fileInput);
      upz.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', e => { doUpload(w.id, Array.from(e.target.files), upz.closest('.mgr').querySelector('[data-bars]')); e.target.value = ''; });
      ['dragenter', 'dragover'].forEach(t => upz.addEventListener(t, e => { e.preventDefault(); upz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(t => upz.addEventListener(t, e => { e.preventDefault(); upz.classList.remove('over'); }));
      upz.addEventListener('drop', e => { const fs = e.dataTransfer && e.dataTransfer.files; if (fs && fs.length) doUpload(w.id, Array.from(fs), upz.closest('.mgr').querySelector('[data-bars]')); });
    });
  }

  function renderChapterRows(w, box) {
    box.innerHTML = '';
    if (!w.chapters.length) { box.appendChild(h(`<div class="empty" style="box-shadow:none;padding:24px"><p>还没有章节，上传或扫描即可。</p></div>`)); return; }
    w.chapters.forEach((c, i) => {
      const row = h(`<div class="mrow" data-cid="${esc(c.id)}">
        <span class="tag" style="width:30px">${i + 1}</span>
        <input value="${esc(c.title || ('第 ' + (i + 1) + ' 话'))}" data-f="title" style="flex:1">
        <span class="tag">${fmtSize(c.size)}</span>
        <button class="x" data-act="up" title="上移" style="width:24px;height:24px"><svg viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M18 15l-6-6-6 6"/></svg></button>
        <button class="x" data-act="down" title="下移" style="width:24px;height:24px"><svg viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M6 9l6 6 6-6"/></svg></button>
        <button class="x" data-act="del" title="删除"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>`);
      row.querySelector('[data-act="up"]').addEventListener('click', () => reorderCh(w, i, -1));
      row.querySelector('[data-act="down"]').addEventListener('click', () => reorderCh(w, i, 1));
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm('删除章节「' + (c.title || c.file) + '」？')) return;
        try { await api('DELETE', '/api/chapter', { json: { work: w.id, id: c.id } }); toast('已删除'); await reload(); }
        catch (e) { toast(e.message); }
      });
      const ti = row.querySelector('[data-f="title"]');
      ti.addEventListener('change', async () => {
        try { await api('PATCH', '/api/chapter', { json: { work: w.id, id: c.id, title: ti.value } }); toast('已重命名'); }
        catch (e) { toast(e.message); }
      });
      box.appendChild(row);
    });
  }

  async function reorderCh(w, i, dir) {
    const j = i + dir; if (j < 0 || j >= w.chapters.length) return;
    const order = w.chapters.map(c => c.id);
    [order[i], order[j]] = [order[j], order[i]];
    try { await api('POST', '/api/chapters/order', { json: { work: w.id, order } }); await reload(); }
    catch (e) { toast(e.message); }
  }

  async function doUpload(workId, files, bars) {
    if (!files.length) return;
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name)) { toast('已跳过非 PDF：' + file.name); continue; }
      const barId = 'bar-' + Math.random().toString(36).slice(2, 8);
      const row = h(`<div class="pbar" id="${barId}"><span class="n">${esc(file.name)}</span><span class="t"><i></i></span><span class="st">0%</span></div>`);
      bars.appendChild(row);
      const fill = row.querySelector('i'), st = row.querySelector('.st');
      try {
        await uploadStream(workId, file, p => {
          const pct = Math.round(p * 100); fill.style.width = pct + '%'; st.textContent = pct + '%';
        });
        row.classList.add('ok'); st.textContent = '完成';
      } catch (e) {
        row.classList.add('err'); st.textContent = '失败';
        toast(file.name + '：' + (e.message || '上传失败'));
      }
    }
    await reload();
  }

  // 流式上传（XHR 以便拿到进度），body 直接为文件二进制
  function uploadStream(workId, file, onProg) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = '/api/upload?work=' + encodeURIComponent(workId) + '&name=' + encodeURIComponent(file.name) + '&title=' + encodeURIComponent(file.name.replace(/\.pdf$/i, ''));
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('x-admin-token', state.token);
      xhr.setRequestHeader('Content-Type', 'application/pdf');
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProg) onProg(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({}); } }
        else {
          let m = '上传失败'; try { const j = JSON.parse(xhr.responseText); if (j && j.error) m = j.error; } catch (e) {}
          reject(new Error(m));
        }
      };
      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.send(file);
    });
  }

  /* ───────── 重新载入 ───────── */
  async function reload() {
    if (state.backend) { try { const d = await api('GET', '/api/library'); if (d) applyLibrary(d); } catch (e) {} }
    renderNav();
    const hash = location.hash || '#/';
    if (hash.startsWith('#/work/')) renderWork(decodeURIComponent(hash.split('/')[2]));
    else if (hash === '#admin') renderAdmin();
  }

  /* ───────── 路由 ───────── */
  function route() {
    const hash = location.hash || '#/';
    if (hash.startsWith('#/read/')) {
      const parts = hash.split('/'); const workId = decodeURIComponent(parts[2]); const chapterId = decodeURIComponent(parts[3]);
      if (currentRead && currentRead.work === workId && currentRead.chapter === chapterId && MangaReaderBusy()) return;
      if (MangaReaderBusy()) MangaReader.close(true);   // 同在阅读器但换了章节
      openReader(workId, chapterId);
      return;
    }
    // 其它视图：关闭阅读器
    if (MangaReaderBusy()) MangaReader.close();
    currentRead = null;
    if (hash === '#admin') { renderAdmin(); return; }
    if (hash.startsWith('#/work/')) { renderWork(decodeURIComponent(hash.split('/')[2])); return; }
    renderHome();
  }
  function MangaReaderBusy() { return !!document.getElementById('reader'); }

  function swapView(node) {
    const old = $('.view', app);
    if (old) old.remove();
    app.appendChild(node);
    app.scrollTop = 0;
  }

  /* ───────── 事件 ───────── */
  $('#brand').addEventListener('click', () => { location.hash = '#/'; });
  $('#navAdmin').addEventListener('click', () => {
    if (state.backend) { if (state.token) location.hash = '#admin'; else showLogin(); }
    else { location.hash = '#admin'; }
  });
  $('#loginBtn').addEventListener('click', doLogin);
  $('#loginPwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#login').addEventListener('click', e => { if (e.target === $('#login')) hideLogin(); });
  window.addEventListener('hashchange', route);

  /* ───────── 启动 ───────── */
  (async function init() {
    loading(true, '载入书库…');
    await loadLibrary();
    loading(false);
    renderNav();
    route();
  })();

  /* ───────── 免责弹窗 ───────── */
  (function () {
    const d = $('#disclaimer'); if (!d) return;
    const KEY = 'mb:disclaimer';
    function show() { try { if (localStorage.getItem(KEY)) { d.hidden = true; return; } } catch (e) {} d.hidden = false; }
    function hide() { d.hidden = true; try { localStorage.setItem(KEY, '1'); } catch (e) {} }
    const ok = $('#discOk'); if (ok) ok.addEventListener('click', hide);
    d.addEventListener('click', e => { if (e.target === d) hide(); });
    show();
  })();

  /* ───────── 背景样式切换（默认旧版纯色，按钮开启液态毛玻璃）───────── */
  (function () {
    const KEY = 'mb:liquid';
    const btn = $('#bgToggle');
    function apply() {
      try { if (localStorage.getItem(KEY) === '1') document.body.classList.add('shelfig-on'); else document.body.classList.remove('shelfig-on'); } catch (e) {}
    }
    apply();
    if (btn) btn.addEventListener('click', () => {
      const on = document.body.classList.toggle('shelfig-on');
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    });
  })();
})();
