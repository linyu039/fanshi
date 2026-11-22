/* ══════════════════════════════════════════════════════
   app.js — 交互编排层
   ══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const { $, $$, bytes, toast, downloadBlob, zip, blobOf, safeName, baseName, stamp, pool, sniff } = FS;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const S = { img: [], mus: [], p2i: [], wb: null, imgFmt: 'image/png', docFile: null, docxFile: null, busy: false, proxyOk: null };
  let seq = 0;
  const uid = () => 'i' + (++seq);

  /* ═══ 视图切换 ═════════════════════════════════ */
  const VIEWS = {
    image: ['图片转换', 'PNG · JPG · WebP · AVIF · BMP · ICO 批量互转，本地处理'],
    music: ['音频转换', 'MP3 · WAV · OGG · AIFF 互转，本地编码'],
    doc: ['文档转换', '图片合成 PDF · 文本渲染 PDF · PDF 反向导出'],
    wenku: ['文库提取', '正文 DOM / 分页接口 / 预览图，三条路径自动降级'],
    settings: ['设置', '默认参数与运行环境']
  };

  function switchView(name) {
    if (!VIEWS[name]) name = 'image';
    $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
    const meta = VIEWS[name] || ['', ''];
    $('#viewTitle').textContent = meta[0];
    $('#viewSub').textContent = meta[1];
    if (name === 'settings') renderEnv();
    if (location.hash.slice(1) !== name) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { location.hash = name; }
    }
  }
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (VIEWS[name]) switchView(name);
  });

  /* ═══ 主题 ═════════════════════════════════════ */
  const THEME_KEY = 'fs.theme';
  const THEMES = ['sakura', 'light', 'dark'];   // 樱花 → 工业浅色 → 工业深色
  const THEME_NAME = { sakura: '樱花', light: '浅色', dark: '深色' };

  function makePetals() {
    const box = document.getElementById('petals');
    if (!box || box.childElementCount) return;
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('i');
      const size = 8 + Math.round(Math.random() * 8);
      p.style.left = (Math.random() * 100).toFixed(1) + '%';
      p.style.width = size + 'px';
      p.style.height = (size * 0.85).toFixed(0) + 'px';
      p.style.animationDuration = (11 + Math.random() * 10).toFixed(1) + 's';
      p.style.animationDelay = (-Math.random() * 18).toFixed(1) + 's';
      p.style.opacity = (0.45 + Math.random() * 0.4).toFixed(2);
      box.appendChild(p);
    }
  }

  function applyTheme(t) {
    if (THEMES.indexOf(t) < 0) t = 'sakura';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    const btn = $('#themeBtn');
    if (btn) {
      btn.title = '切换主题（当前：' + THEME_NAME[t] + '）';
      btn.setAttribute('aria-label', btn.title);
    }
    if (t === 'sakura') makePetals();
  }
  applyTheme((() => {
    try { return localStorage.getItem(THEME_KEY) || 'sakura'; } catch (e) { return 'sakura'; }
  })());
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'sakura';
    const i = THEMES.indexOf(cur);
    applyTheme(THEMES[(i + 1) % THEMES.length]);
    toast('主题：' + THEME_NAME[document.documentElement.getAttribute('data-theme')], '', 1400);
  });

  /* ═══ 设置持久化 ═══════════════════════════════ */
  const SETTING_IDS = ['imgQuality', 'imgMax', 'imgBg', 'imgZip', 'imgKeepName', 'imgAutoDl',
    'musRate', 'musCh', 'musBits', 'musTpl', 'musBitrate', 'musCover', 'musMeta',
    'pdfPageSize', 'pdfMargin', 'pdfName', 't2pSize', 't2pFont', 't2pName', 'pdfScale', 'pdfParas', 'wbCookie', 'wbType', 'wbResult', 'docxSize', 'docxMargin', 'docxFont',
    'setConc', 'setBg', 'setAnim', 'setPersist'];
  function saveSettings() {
    if (!$('#setPersist').checked) return;
    const o = {};
    SETTING_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const k = el.type === 'checkbox' ? 'checked' : el.value;
      o[id] = k;
    });
    try { localStorage.setItem('fs.settings', JSON.stringify(o)); } catch (e) {}
  }
  function loadSettings() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem('fs.settings') || 'null'); } catch (e) {}
    if (!o) return;
    Object.keys(o).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!o[id];
      else el.value = o[id];
    });
  }
  SETTING_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
  });
  $('#setPersist').addEventListener('change', () => {
    try { localStorage.removeItem('fs.settings'); } catch (e) {}
    saveSettings();
  });
  $('#setAnim').addEventListener('change', (e) => {
    document.body.classList.toggle('no-anim', !e.target.checked);
  });
  $('#setReset').addEventListener('click', () => {
    try { localStorage.removeItem('fs.settings'); } catch (e) {}
    location.reload();
  });

  /* ═══ 通用：分段按钮 ═══════════════════════════ */
  function bindSegment(root, cb) {
    const wrap = document.getElementById(root);
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-fmt],button[data-mode],button[data-tab]');
      if (!b || b.disabled) return;
      const key = b.dataset.fmt ? 'fmt' : (b.dataset.mode ? 'mode' : 'tab');
      $$('button', wrap).forEach((x) => x.classList.toggle('is-on', x === b));
      if (cb) cb(b.dataset[key], b, wrap);
      saveSettings();
    });
  }

  /* ═══ 拖放收集（含目录递归） ═══════════════════ */
  async function collectFiles(dt) {
    const out = [];
    const items = Array.from(dt.items || []);
    const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return Array.from(dt.files || []);
    const walk = async (entry) => {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise((res) => entry.file((f) => { out.push(f); res(); }, () => res()));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (let guard = 0; guard < 200; guard++) {
          const batch = await new Promise((res) => reader.readEntries((e) => res(e), () => res([])));
          if (!batch.length) break;
          for (const e of batch) await walk(e);
        }
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  function bindDrop(zoneId, inputId, handler) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files.length) handler(Array.from(input.files)); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); zone.classList.add('dragover');
    }));
    ['dragleave', 'dragend'].forEach((ev) => zone.addEventListener(ev, (e) => {
      if (zone.contains(e.relatedTarget)) return;
      zone.classList.remove('dragover');
    }));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.remove('dragover');
      const files = await collectFiles(e.dataTransfer);
      if (files.length) handler(files);
    });
  }

  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const files = await collectFiles(e.dataTransfer);
    const active = $('.view.is-active');
    if (!files.length || !active) return;
    if (active.id === 'view-image') addImages(files);
    else if (active.id === 'view-music') addMusic(files);
    else if (active.id === 'view-doc') addDocImages(files);
  });

  /* ══════════════════════════════════════════════
     一 · 图片
     ══════════════════════════════════════════════ */
  const IMG_EXT = /\.(png|jpe?g|jfif|webp|avif|bmp|gif|ico|tiff?|heic)$/i;

  /* 队列渲染：DOM 只创建一次，状态变化只改文本与宽度。
     早期版本用 outerHTML 整行重建，进度每跳一次就重新解析缩略图与内联 SVG，
     队列一长就明显卡顿——这是本轮性能重构的重点。 */
  const imgRows = new Map();

  function renderImgQueue() {
    const box = $('#imgQueue');
    $('#imgCount').textContent = S.img.length;
    if (!S.img.length) {
      box.innerHTML = '<div class="empty">还没有文件，先拖入几张图片吧</div>';
      imgRows.clear();
      return;
    }
    if (box.firstElementChild && box.firstElementChild.classList.contains('empty')) box.innerHTML = '';
    for (const [id, r] of imgRows) {
      if (!S.img.some((x) => x.id === id)) { r.root.remove(); imgRows.delete(id); }
    }
    S.img.forEach((it, i) => {
      let r = imgRows.get(it.id);
      if (!r) r = buildImgRow(it);
      if (box.children[i] !== r.root) box.insertBefore(r.root, box.children[i] || null);
      updateImgRow(it, r);
    });
  }

  function buildImgRow(it) {
    const root = document.createElement('div');
    root.className = 'qitem';
    root.dataset.id = it.id;
    root.innerHTML =
      '<div class="thumb"></div>' +
      '<div class="qinfo"><div class="qname"></div><div class="qsub"></div>' +
      '<div class="bar"><i></i></div></div>' +
      '<div class="qacts">' +
      '<button class="mini-btn" data-act="dl" title="下载"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg></button>' +
      '<button class="mini-btn danger" data-act="rm" title="移除"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>';
    const r = {
      root,
      thumb: root.querySelector('.thumb'),
      name: root.querySelector('.qname'),
      sub: root.querySelector('.qsub'),
      bar: root.querySelector('.bar i'),
      dl: root.querySelector('[data-act="dl"]')
    };
    imgRows.set(it.id, r);
    updateImgRow(it, r);
    return r;
  }

  function updateImgRow(it, ref) {
    const r = ref || imgRows.get(it.id);
    if (!r) return;
    r.name.textContent = it.name;
    r.root.classList.toggle('done', it.status === 'done');
    r.root.classList.toggle('err', it.status === 'err');

    if (it.thumbUrl) {
      if (r.thumb.dataset.src !== it.thumbUrl) {
        r.thumb.style.backgroundImage = 'url("' + it.thumbUrl + '")';
        r.thumb.textContent = '';
        r.thumb.dataset.src = it.thumbUrl;
      }
    } else if (!r.thumb.dataset.src) {
      r.thumb.textContent = FS.extName(it.name).toUpperCase() || 'IMG';
    }

    let tail = '';
    let barW = 0;
    if (it.status === 'run') { tail = ' · 转换中'; barW = it.progress || 20; }
    else if (it.status === 'done' && it.result) {
      tail = ' <span class="arrow">→</span><span class="badge">' + it.result.ext.toUpperCase() + '</span>' +
        bytes(it.result.size) + ' <span class="ok">' + FS.delta(it.size, it.result.size) + '</span>';
      barW = 100;
    } else if (it.status === 'err') {
      tail = ' <span class="bad">' + esc(it.error || '转换失败') + '</span>';
    }
    const sub = bytes(it.size) + (it.dims ? ' · ' + it.dims : '') + tail;
    if (r.sub.dataset.v !== sub) { r.sub.innerHTML = sub; r.sub.dataset.v = sub; }
    r.bar.style.width = barW + '%';
    r.dl.disabled = it.status !== 'done';
  }

  function patchImg(it) { updateImgRow(it); }

  async function addImages(files) {
    const imgs = files.filter((f) => f.type.startsWith('image/') || IMG_EXT.test(f.name));
    if (!imgs.length) { toast('这些文件里没有可识别的图片', 'warn'); return; }
    for (const f of imgs) {
      S.img.push({ id: uid(), file: f, name: f.name, size: f.size, status: 'idle', dims: '', progress: 0, thumbUrl: '' });
    }
    renderImgQueue();
    // 缩略图与尺寸异步补齐，逐项更新，不重建 DOM
    for (const f of imgs) {
      const it = S.img.find((x) => x.file === f);
      if (!it) continue;
      IMG.thumbnailUrl(f, 72).then((u) => { it.thumbUrl = u; updateImgRow(it); }).catch(() => {});
      const img = new Image();
      img.onload = () => { it.dims = img.naturalWidth + '×' + img.naturalHeight; updateImgRow(it); };
      img.onerror = () => {};
      img.src = URL.createObjectURL(f);
    }
    toast('已加入 ' + imgs.length + ' 张图片', 'ok');
  }

  bindDrop('imgDrop', 'imgInput', addImages);

  $('#imgQueue').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const host = btn.closest('.qitem');
    const it = S.img.find((x) => x.id === host.dataset.id);
    if (!it) return;
    if (btn.dataset.act === 'rm') {
      if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      S.img = S.img.filter((x) => x !== it);
      renderImgQueue();
      $('#imgZipDl').disabled = !S.img.some((x) => x.result);
    } else if (btn.dataset.act === 'dl' && it.result) {
      downloadBlob(blobOf(it.result.bytes, it.result.ext), it.result.name);
    }
  });

  $('#imgClear').addEventListener('click', () => {
    S.img.forEach((x) => x.thumbUrl && URL.revokeObjectURL(x.thumbUrl));
    S.img = []; renderImgQueue(); $('#imgZipDl').disabled = true;
  });

  bindSegment('imgFormat', (fmt) => { S.imgFmt = fmt; });

  const qEl = $('#imgQuality');
  function syncRange() {
    const p = ((qEl.value - qEl.min) / (qEl.max - qEl.min)) * 100;
    qEl.style.setProperty('--p', p + '%');
    $('#qVal').textContent = qEl.value;
  }
  qEl.addEventListener('input', syncRange);
  syncRange();

  $('#imgBg').addEventListener('input', (e) => { $('#imgBgHex').textContent = e.target.value; });
  $('#setBg').addEventListener('input', () => saveSettings());

  $('#imgRun').addEventListener('click', async () => {
    if (!S.img.length) { toast('队列是空的', 'warn'); return; }
    if (S.busy) return;
    S.busy = true;
    const btn = $('#imgRun');
    btn.disabled = true;
    const opt = {
      mime: S.imgFmt,
      quality: Number(qEl.value),
      maxEdge: Number($('#imgMax').value) || 0,
      bg: $('#imgBg').value,
      keepName: $('#imgKeepName').checked
    };
    const conc = Math.max(1, Number($('#setConc').value) || 3);
    let ok = 0, fail = 0;
    S.img.forEach((it) => { if (it.status === 'done') { it.status = 'idle'; } });
    await pool(S.img, conc, async (it) => {
      it.status = 'run'; it.progress = 10; patchImg(it);
      try {
        const r = await IMG.convert(it.file, opt);
        it.result = r; it.status = 'done'; it.progress = 100; ok++;
        if ($('#imgAutoDl').checked) downloadBlob(blobOf(r.bytes, r.ext), r.name);
      } catch (e) {
        it.status = 'err'; it.error = e.message || String(e); fail++;
      }
      patchImg(it);
    });
    btn.disabled = false;
    S.busy = false;
    $('#imgZipDl').disabled = ok === 0;
    toast('转换完成：成功 ' + ok + (fail ? ' · 失败 ' + fail : ''), fail ? 'warn' : 'ok');
  });

  $('#imgZipDl').addEventListener('click', () => {
    const items = S.img.filter((x) => x.result);
    if (!items.length) return;
    if (items.length === 1 && !$('#imgZip').checked) {
      downloadBlob(blobOf(items[0].result.bytes, items[0].result.ext), items[0].result.name);
      return;
    }
    const files = items.map((x) => ({ name: x.result.name, data: x.result.bytes }));
    const zipped = zip(files);
    downloadBlob(zipped, 'fanshi-' + stamp() + '.zip');
    toast('已打包 ' + files.length + ' 个文件', 'ok');
  });

  /* ══════════════════════════════════════════════
     二 · 音乐
     ══════════════════════════════════════════════ */
  const AUD_EXT = /\.(ncm|uc|qmc0|qmc3|qmcflac|qmcogg|mp3|flac|wav|ogg|m4a|aac|ape|wma)$/i;

  const musRows = new Map();

  function renderMusQueue() {
    const box = $('#musQueue');
    $('#musCount').textContent = S.mus.length;
    if (!S.mus.length) {
      box.innerHTML = '<div class="empty">还没有音频文件</div>';
      musRows.clear();
      return;
    }
    if (box.firstElementChild && box.firstElementChild.classList.contains('empty')) box.innerHTML = '';
    for (const [id, r] of musRows) {
      if (!S.mus.some((x) => x.id === id)) { r.root.remove(); musRows.delete(id); }
    }
    S.mus.forEach((it, i) => {
      let r = musRows.get(it.id);
      if (!r) r = buildMusRow(it);
      if (box.children[i] !== r.root) box.insertBefore(r.root, box.children[i] || null);
      updateMusRow(it, r);
    });
  }

  function buildMusRow(it) {
    const root = document.createElement('div');
    root.className = 'qitem';
    root.dataset.id = it.id;
    root.innerHTML =
      '<div class="avatar-mus"><svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg></div>' +
      '<div class="qinfo"><div class="qname"></div><div class="qsub"></div>' +
      '<div class="bar"><i></i></div></div>' +
      '<div class="qacts">' +
      '<button class="mini-btn" data-act="log" title="解析日志"><svg viewBox="0 0 24 24"><path d="M5 12h14M5 7h14M5 17h9"/></svg></button>' +
      '<button class="mini-btn" data-act="dl" title="下载"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg></button>' +
      '<button class="mini-btn danger" data-act="rm" title="移除"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>';
    const r = {
      root,
      cover: root.querySelector('.avatar-mus'),
      name: root.querySelector('.qname'),
      sub: root.querySelector('.qsub'),
      bar: root.querySelector('.bar i'),
      dl: root.querySelector('[data-act="dl"]')
    };
    musRows.set(it.id, r);
    updateMusRow(it, r);
    return r;
  }

  function updateMusRow(it, ref) {
    const r = ref || musRows.get(it.id);
    if (!r) return;
    const title = it.title || it.name;
    r.name.textContent = title;
    r.root.classList.toggle('done', it.status === 'done');
    r.root.classList.toggle('err', it.status === 'err');
    if (it.coverUrl && r.cover.dataset.src !== it.coverUrl) {
      r.cover.style.backgroundImage = 'url("' + it.coverUrl + '")';
      r.cover.innerHTML = '';
      r.cover.dataset.src = it.coverUrl;
    }

    const meta = [];
    if (it.meta && it.meta.artist) meta.push(esc(it.meta.artist));
    if (it.meta && it.meta.album) meta.push(esc(it.meta.album));
    if (it.meta && it.meta.bitrate) meta.push(Math.round(it.meta.bitrate / 1000) + ' kbps');
    let sub = '<span class="badge">' + (FS.extName(it.name).toUpperCase() || 'AUD') + '</span>' + bytes(it.size);
    if (meta.length) sub += ' · ' + meta.join(' · ');
    let barW = 0;
    if (it.status === 'run') { sub += ' · ' + esc(it.stage || '处理中'); barW = it.progress || 20; }
    else if (it.status === 'done') {
      const o = it.out && it.out[0];
      if (o) sub += ' <span class="arrow">→</span><span class="badge">' + esc(o.ext.toUpperCase()) + '</span>' + bytes(o.bytes.length);
      barW = 100;
    } else if (it.status === 'err') {
      sub += ' <span class="bad">' + esc(it.error || '失败') + '</span>';
    }
    if (r.sub.dataset.v !== sub) { r.sub.innerHTML = sub; r.sub.dataset.v = sub; }
    r.bar.style.width = barW + '%';
    r.dl.disabled = it.status !== 'done';
  }

  function patchMus(it) { updateMusRow(it); }

  async function addMusic(files) {
    const auds = files.filter((f) => AUD_EXT.test(f.name) || (f.type || '').startsWith('audio/'));
    if (!auds.length) { toast('这些文件里没有音频', 'warn'); return; }
    for (const f of auds) {
      const it = { id: uid(), file: f, name: f.name, size: f.size, status: 'idle', stage: '', progress: 0 };
      S.mus.push(it);
    }
    renderMusQueue();
    // 预读元数据
    for (const f of auds) {
      const it = S.mus.find((x) => x.file === f);
      try {
        const head = new Uint8Array(await f.slice(0, 512 * 1024).arrayBuffer());
        const isNcm = /\.ncm$/i.test(f.name) || String.fromCharCode.apply(null, Array.from(head.subarray(0, 32))).indexOf('neteasecloudmusic') >= 0;
        if (!isNcm) {
          const pd = AUD.probe(head, FS.extName(f.name));
          if (pd.title) it.title = pd.title + (pd.artist ? ' - ' + pd.artist : '');
          if (pd.cover && pd.cover.bytes.length) {
            it.coverUrl = URL.createObjectURL(new Blob([pd.cover.bytes], { type: pd.cover.mime }));
          }
          it.meta = pd;
        }
      } catch (e) { /* 预读失败不影响主流程 */ }
      patchMus(it);
    }
    toast('已加入 ' + auds.length + ' 个音频', 'ok');
  }

  bindDrop('musDrop', 'musInput', addMusic);

  $('#musQueue').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const host = btn.closest('.qitem');
    const it = S.mus.find((x) => x.id === host.dataset.id);
    if (!it) return;
    if (btn.dataset.act === 'rm') {
      if (it.coverUrl) URL.revokeObjectURL(it.coverUrl);
      S.mus = S.mus.filter((x) => x !== it);
      renderMusQueue();
      $('#musZipDl').disabled = !S.mus.some((x) => x.out);
    } else if (btn.dataset.act === 'dl' && it.out) {
      it.out.forEach((o, i) => setTimeout(() => downloadBlob(blobOf(o.bytes, o.ext), o.name), i * 220));
    } else if (btn.dataset.act === 'log') {
      const log = it.log || ['（无日志）'];
      toast(log.join(' · '), '', 7000);
    }
  });

  $('#musClear').addEventListener('click', () => {
    S.mus = []; renderMusQueue(); $('#musZipDl').disabled = true;
  });

  /* 输出格式：keep | wav | mp3 | opus | aiff */
  function musFormat() {
    const on = $('#musFormat button.is-on');
    return on ? on.dataset.fmt : 'keep';
  }

  function refreshCodecUI() {
    const sup = AUD.codecSupport();
    $$('#musFormat button').forEach((b) => {
      const f = b.dataset.fmt;
      if (f === 'flac' || f === 'aac') {
        b.disabled = true;
        b.title = '浏览器没有该格式的编码器';
      }
    });
    const avail = ['WAV', 'AIFF', 'MP3', sup.opus ? 'OGG' : null].filter(Boolean);
    const hint = $('#musCodecHint');
    if (hint) hint.textContent = '本地可用：' + avail.join(' / ');
    const st = $('#lameState');
    if (st) {
      st.textContent = sup.opus ? 'OPUS 可用 · MP3 按需加载' : 'OPUS 不可用 · MP3 按需加载';
      st.classList.toggle('good', !!sup.opus);
    }
  }

  bindSegment('musFormat', (fmt) => {
    $('#musWavOpts').hidden = fmt === 'keep';
    if (fmt === 'mp3') {
      AUD.loadLame().then(() => {
        $('#lameState').textContent = 'MP3 编码器已就绪';
        $('#lameState').classList.add('good');
      }).catch(() => {
        $('#lameState').textContent = 'MP3 编码器不可用（可改用 WAV / OGG）';
        $('#lameState').classList.add('bad');
      });
    }
  });

  function tplName(it, ext) {
    const tpl = $('#musTpl').value || '{artist} - {title}';
    const meta = it.meta || {};
    let name = tpl
      .replace(/\{artist\}/g, meta.artist || '未知歌手')
      .replace(/\{title\}/g, meta.title || baseName(it.name))
      .replace(/\{album\}/g, meta.album || '')
      .replace(/\{format\}/g, ext);
    name = safeName(name.replace(/\s*-\s*$/, ''), baseName(it.name));
    return name + '.' + ext;
  }

  $('#musRun').addEventListener('click', async () => {
    if (!S.mus.length) { toast('队列是空的', 'warn'); return; }
    if (S.busy) return;
    S.busy = true;
    const btn = $('#musRun');
    btn.disabled = true;
    const fmt = musFormat();
    const wantCover = $('#musCover').checked;
    const wantMeta = $('#musMeta').checked;
    const encOpt = {
      sampleRate: Number($('#musRate').value) || 44100,
      channels: Number($('#musCh').value) || 2,
      bits: Number($('#musBits').value) || 16,
      bitrate: Number($('#musBitrate').value) || 192000
    };
    if (fmt === 'mp3') {
      try { await AUD.loadLame(); $('#lameState').textContent = 'MP3 编码器已就绪'; $('#lameState').classList.add('good'); }
      catch (e) { toast('MP3 编码器加载失败，本次改用 WAV 输出', 'warn'); }
    }

    let ok = 0, fail = 0;
    for (const it of S.mus) {
      it.status = 'run'; it.stage = '读取文件'; it.progress = 8; patchMus(it);
      try {
        const raw = new Uint8Array(await it.file.arrayBuffer());
        /* 判定以「内容」为准，扩展名只作参考：
           .ncm 里装的可能就是普通 MP3，也可能是 QQ 音乐加密缓存 */
        const cls = AUD.classifyInput(it.name, raw);
        let audioBytes = raw;
        let cover = null;
        let baseExt = FS.extName(it.name);

        if (cls.kind === 'audio') {
          baseExt = cls.ext;
          it.log = ['内容嗅探：' + cls.ext.toUpperCase() + (cls.note ? '（' + cls.note + '）' : '') +
            '，扩展名 .' + FS.extName(it.name) + ' 与内容不一致，按内容处理'];
          it.title = (it.meta && it.meta.title) || baseName(it.name);
        } else if (cls.kind === 'encrypted' || cls.kind === 'unknown') {
          it.log = ['文件头：' + cls.header, '大小：' + bytes(raw.length)];
          throw new Error('不是 NCM，也不是已知音频格式（文件头 ' + cls.header.slice(0, 11) + '…）。' +
            (cls.kind === 'encrypted'
              ? '看起来是 QQ 音乐 / 酷狗的加密缓存（' + cls.ext + '），需要专用映射表，本工具不处理。'
              : '可能是文件被其它工具改写过、下载未完成，或根本是别的格式。'));
        }

        if (cls.kind === 'ncm') {
          it.stage = '解密 NCM'; it.progress = 20; patchMus(it);
          const dec = await NCM.decrypt(raw, (p, t) => { it.progress = 20 + Math.round((p / t) * 50); patchMus(it); });
          audioBytes = dec.audio;
          baseExt = dec.ext;
          cover = dec.cover;
          it.meta = { title: dec.meta.title, artist: dec.meta.artist, album: dec.meta.album, bitrate: dec.meta.bitrate };
          it.log = dec.log;
          it.title = (dec.meta.title || baseName(it.name)) + (dec.meta.artist ? ' - ' + dec.meta.artist : '');
          if (cover && cover.bytes.length) {
            if (it.coverUrl) URL.revokeObjectURL(it.coverUrl);
            it.coverUrl = URL.createObjectURL(new Blob([cover.bytes], { type: cover.mime }));
          }
          patchMus(it);
        }


        const out = [];
        it.stage = fmt === 'keep' ? '生成输出' : '编码 ' + fmt.toUpperCase();
        it.progress = 76; patchMus(it);

        if (fmt === 'keep') {
          let data = audioBytes;
          const ext = baseExt || 'mp3';
          if (wantMeta && ext === 'mp3' && it.meta) {
            const id3 = NCM.buildID3v2(it.meta, cover);
            data = NCM.concat([id3, audioBytes]);
          }
          out.push({ name: tplName(it, ext), ext, bytes: data });
        } else {
          let res = null;
          try {
            res = await AUD.convert(audioBytes.slice().buffer, fmt, encOpt);
          } catch (e) {
            if (fmt === 'mp3') {
              // MP3 编码器不可用时降级为 WAV，不丢任务
              res = await AUD.convert(audioBytes.slice().buffer, 'wav', encOpt);
              it.stage = 'MP3 失败，已转 WAV';
            } else {
              throw e;
            }
          }
          out.push({ name: tplName(it, res.ext), ext: res.ext, bytes: res.bytes });
        }

        if (wantCover && cover && cover.bytes.length) {
          const cext = cover.mime.indexOf('png') >= 0 ? 'png' : 'jpg';
          out.push({ name: safeName((it.meta && it.meta.title) || baseName(it.name)) + '.' + cext, ext: cext, bytes: cover.bytes });
        }

        it.out = out;
        it.status = 'done';
        it.progress = 100;
        it.stage = '完成';
        ok++;
      } catch (e) {
        it.status = 'err';
        it.error = e && e.message ? e.message : String(e);
        fail++;
      }
      patchMus(it);
      await FS.sleep(60);
    }
    btn.disabled = false;
    S.busy = false;
    $('#musZipDl').disabled = ok === 0;
    toast('处理完成：成功 ' + ok + (fail ? ' · 失败 ' + fail : ''), fail ? 'warn' : 'ok');
  });

  $('#musZipDl').addEventListener('click', () => {
    const items = S.mus.filter((x) => x.out && x.out.length);
    if (!items.length) return;
    const files = [];
    items.forEach((x) => x.out.forEach((o) => files.push({ name: o.name, data: o.bytes })));
    if (files.length === 1) {
      downloadBlob(blobOf(files[0].data, FS.extName(files[0].name)), files[0].name);
      return;
    }
    downloadBlob(zip(files), 'fanshi-audio-' + stamp() + '.zip');
    toast('已打包 ' + files.length + ' 个文件', 'ok');
  });

  /* ══════════════════════════════════════════════
     三 · 文档
     ══════════════════════════════════════════════ */
  bindSegment('docTab', (tab) => {
    $$('.doc-pane').forEach((p) => p.classList.toggle('is-active', p.id === 'pane-' + tab));
  });

  function renderP2I() {
    const box = $('#p2iQueue');
    if (!S.p2i.length) { box.innerHTML = '<div class="empty">尚未添加图片</div>'; return; }
    box.innerHTML = S.p2i.map((it) =>
      '<div class="qitem" data-id="' + it.id + '">' +
      '<div class="thumb" style="' + (it.thumb ? 'background-image:url(' + it.thumb + ')' : '') + '">' + (it.thumb ? '' : 'IMG') + '</div>' +
      '<div class="qinfo"><div class="qname">' + esc(it.file.name) + '</div>' +
      '<div class="qsub">' + bytes(it.file.size) + ' · 第 ' + (S.p2i.indexOf(it) + 1) + ' 页</div></div>' +
      '<div class="qacts"><button class="mini-btn danger" data-act="rm"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>'
    ).join('');
  }

  async function addDocImages(files) {
    const imgs = files.filter((f) => f.type.startsWith('image/') || IMG_EXT.test(f.name));
    if (!imgs.length) { toast('没有图片可加入', 'warn'); return; }
    for (const f of imgs) {
      const it = { id: uid(), file: f, thumb: '' };
      S.p2i.push(it);
      IMG.thumbnail(f, 80).then((t) => { it.thumb = t; renderP2I(); });
    }
    renderP2I();
    toast('已加入 ' + imgs.length + ' 张图片', 'ok');
  }

  bindDrop('p2iDrop', 'p2iInput', addDocImages);

  $('#p2iQueue').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const host = btn.closest('.qitem');
    S.p2i = S.p2i.filter((x) => x.id !== host.dataset.id);
    renderP2I();
  });

  $('#p2iRun').addEventListener('click', async () => {
    if (!S.p2i.length) { toast('先加入图片', 'warn'); return; }
    const btn = $('#p2iRun');
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const pdf = await DOC.imagesToPdf(S.p2i.map((x) => x.file), {
        pageSize: $('#pdfPageSize').value,
        marginMM: Number($('#pdfMargin').value) || 0,
        title: $('#pdfName').value || 'album'
      });
      const name = safeName($('#pdfName').value || 'album') + '.pdf';
      downloadBlob(new Blob([pdf], { type: 'application/pdf' }), name);
      toast('PDF 已生成（' + S.p2i.length + ' 页 · ' + bytes(pdf.length) + '）', 'ok');
    } catch (e) {
      toast('生成失败：' + (e.message || e), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '生成 PDF';
    }
  });

  $('#t2pRun').addEventListener('click', async () => {
    const text = $('#txtSrc').value;
    if (!text.trim()) { toast('请先输入文本', 'warn'); return; }
    const btn = $('#t2pRun');
    btn.disabled = true; btn.textContent = '排版中…';
    try {
      const pdf = await DOC.textToPdf(text, {
        pageSize: $('#t2pSize').value,
        fontSize: Number($('#t2pFont').value) || 12
      });
      const name = safeName($('#t2pName').value || 'document') + '.pdf';
      downloadBlob(new Blob([pdf], { type: 'application/pdf' }), name);
      toast('PDF 已生成 · ' + bytes(pdf.length), 'ok');
    } catch (e) {
      toast('生成失败：' + (e.message || e), 'err');
    } finally {
      btn.disabled = false; btn.textContent = '生成 PDF';
    }
  });

  bindDrop('pdfDrop', 'pdfInput', async (files) => {
    const f = files.find((x) => /\.pdf$/i.test(x.name) || x.type === 'application/pdf');
    if (!f) { toast('请选择 PDF 文件', 'warn'); return; }
    S.docFile = f;
    $('#pdfjsState').textContent = 'PDF 引擎：加载 ' + f.name;
    $('#pdfjsState').classList.remove('bad');
    try {
      await DOC.loadPdfJs();
      $('#pdfjsState').textContent = '已载入：' + f.name + ' · ' + bytes(f.size);
      $('#pdfjsState').classList.add('good');
    } catch (e) {
      $('#pdfjsState').textContent = 'PDF 引擎加载失败：' + (e.message || e);
      $('#pdfjsState').classList.add('bad');
    }
  });

  async function requirePdf() {
    if (!S.docFile) { toast('先拖入一个 PDF', 'warn'); return false; }
    return true;
  }

  $('#pdf2img').addEventListener('click', async () => {
    if (!await requirePdf()) return;
    const btn = $('#pdf2img');
    btn.disabled = true; btn.textContent = '导出中…';
    try {
      const imgs = await DOC.pdfToImages(S.docFile, {
        scale: Number($('#pdfScale').value),
        range: $('#pdfRange').value,
        onProgress: (i, n) => { $('#pdfjsState').textContent = '渲染 ' + i + '/' + n; }
      });
      downloadBlob(zip(imgs), safeName(baseName(S.docFile.name)) + '_png-' + stamp() + '.zip');
      toast('已导出 ' + imgs.length + ' 张页面图片', 'ok');
      $('#pdfjsState').textContent = '已导出 ' + imgs.length + ' 页';
    } catch (e) {
      toast('失败：' + (e.message || e), 'err');
      $('#pdfjsState').textContent = '失败：' + (e.message || e);
      $('#pdfjsState').classList.add('bad');
    } finally {
      btn.disabled = false; btn.textContent = '导出页面图片';
    }
  });

  async function exportPdfText(md) {
    if (!await requirePdf()) return;
    try {
      const text = await DOC.pdfToText(S.docFile, {
        range: $('#pdfRange').value,
        paragraphs: $('#pdfParas').value === '1',
        onProgress: (i, n) => { $('#pdfjsState').textContent = '提取 ' + i + '/' + n; }
      });
      let body = text;
      if (md) {
        const title = baseName(S.docFile.name);
        body = '# ' + title + '\n\n' +
          text.split(/\n{2,}/).map((p) => (p.trim() ? p.trim() : '')).filter(Boolean).join('\n\n');
      }
      const ext = md ? 'md' : 'txt';
      downloadBlob(new Blob([body], { type: FS.mimeOf(ext) }), safeName(baseName(S.docFile.name)) + '.' + ext);
      toast('已导出文本 ' + (body.length) + ' 字符', 'ok');
    } catch (e) {
      toast('失败：' + (e.message || e), 'err');
    }
  }
  $('#pdf2txt').addEventListener('click', () => exportPdfText(false));
  $('#pdf2md').addEventListener('click', () => exportPdfText(true));

  /* ── Word(.docx) → PDF ─────────────────────── */
  bindDrop('docxDrop', 'docxInput', (files) => {
    const f = files.find((x) => /\.docx$/i.test(x.name)
      || x.type.indexOf('wordprocessingml') >= 0);
    if (!f) { toast('请选择 .docx 文件（.doc 旧格式请先另存为 .docx）', 'warn'); return; }
    S.docxFile = f;
    const st = $('#docxState');
    st.textContent = '已选：' + f.name + ' · ' + bytes(f.size);
    st.classList.remove('bad');
    st.classList.add('good');
    $('#docxRun').disabled = false;
  });

  $('#docxRun').addEventListener('click', async () => {
    if (!S.docxFile) { toast('先拖入一个 .docx', 'warn'); return; }
    const btn = $('#docxRun');
    const st = $('#docxState');
    btn.disabled = true;
    btn.textContent = '排版中…';
    st.textContent = '解析 OOXML…';
    st.classList.remove('bad', 'good');
    try {
      const pdf = await DOCX.toPdf(S.docxFile, {
        pageSize: $('#docxSize').value,
        margin: Number($('#docxMargin').value) || 56,
        fontSize: Number($('#docxFont').value) || 11,
        onProgress: (i, n2) => { st.textContent = '渲染第 ' + i + '/' + n2 + ' 页'; }
      });
      const name = safeName(baseName(S.docxFile.name)) + '.pdf';
      downloadBlob(new Blob([pdf], { type: 'application/pdf' }), name);
      st.textContent = '完成：' + name + ' · ' + bytes(pdf.length);
      st.classList.add('good');
      toast('Word 已转 PDF：' + name + '（' + bytes(pdf.length) + '）', 'ok');
    } catch (e) {
      st.textContent = '失败：' + (e.message || e);
      st.classList.add('bad');
      toast('转换失败：' + (e.message || e), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '生成 PDF';
    }
  });

  /* ══════════════════════════════════════════════
     四 · 文库
     ══════════════════════════════════════════════ */
  async function probeProxy() {
    const st = $('#wbState');
    st.textContent = '本地代理：探测中…';
    st.classList.remove('good', 'bad');
    const r = await DOC.probeProxy();
    S.proxyOk = !!(r && r.ok);
    if (S.proxyOk) {
      st.textContent = '本地代理：已连接';
      st.classList.add('good');
      return true;
    }
    st.textContent = '在线版 · 无本地代理';
    st.classList.add('bad');
    // 静态托管（GitHub Pages 等）没有转发层，直接给出可用的两条路
    const box = $('#wbPreview');
    if (box && /尚未抓取/.test(box.textContent || '')) {
      box.innerHTML =
        '<div class="wb-doc"><div class="pg">在线版说明</div>' +
        '<h3>浏览器不允许网页直接读别的站点</h3>' +
        '<p>这是同源策略，不是权限问题 —— 任何纯静态站点都做不到跨站抓取。</p>' +
        '<p><b>两条可用路径：</b></p>' +
        '<p>① <a href="tools/wenku_bookmarklet.html" target="_blank" rel="noreferrer" ' +
        'style="color:var(--accent);text-decoration:underline">安装书签</a>，在文档页面点一下即可导出内容（推荐，支持文字与图片型文档）。</p>' +
        '<p>② 把文档正文直接粘到下方「手动粘贴的正文」，再用「导出 PDF / TXT」排版输出。</p>' +
        '<p style="color:var(--ink-3)">想在本机直接抓取，用桌面版：双击 <code>start.cmd</code> 启动本地服务，那里带转发层。</p>' +
        '</div>';
    }
    return false;
  }
  $('#wbProbe').addEventListener('click', probeProxy);

  /** 抓不到正文时的诊断：给出能判断的事实，而不是一句「检查链接」 */
  function buildGrabDiag(page, result, fileTry, url) {
    const lines = ['没取到可用的正文。诊断如下：', ''];
    lines.push.apply(lines, DOC.diagnoseGrab({
      html: page ? page.text : '',
      finalUrl: page ? (page.finalUrl || url) : url,
      result: result,
      fileTry: fileTry
    }));
    lines.push('');
    lines.push('下一步，按顺序试：');
    lines.push('1. 「结果类型」切到「原件」—— 站点若提供下载，直接拿原文件');
    lines.push('2. 「Cookie」填登录态（F12 → Network → 任意请求 → Request Headers 整行复制）');
    lines.push('3. 用 tools\\wenku_bookmarklet.html 的书签，在文档页取渲染后的文字');
    lines.push('4. 用 tools\\wenku_crawler.py 换到别的站点找同一份文档');
    return lines.join('\n');
  }

  $('#wbRun').addEventListener('click', async () => {
    const url = $('#wbUrl').value.trim();
    const mode = $('#wbMode').value;
    const force = $('#wbType').value;        // auto | ppt | word | pdf | text
    const cookie = ($('#wbCookie') ? $('#wbCookie').value : '').trim();
    window.__WB_COOKIE = cookie;             // 供 fetchPaged 分页路径复用
    const paste = $('#wbPaste').value.trim();
    const btn = $('#wbRun');
    btn.disabled = true;
    $('#wbPreview').innerHTML = '<div class="empty">解析中…</div>';
    try {
      let result = { title: '粘贴内容', paragraphs: [], slides: [], images: [], host: '', type: { kind: 'text', label: '粘贴内容' } };

      if (!S.proxyOk && mode !== 'paste' && !paste) {
        throw new Error('在线版没有本地转发层，无法跨站抓取。\n' +
          '两条可用路径：\n' +
          '① 打开 tools/wenku_bookmarklet.html 装书签，在文档页面点一下导出内容；\n' +
          '② 把正文粘到下方「手动粘贴的正文」再导出 PDF / TXT。');
      }

      if (mode === 'paste' || (!url && paste)) {
        if (!paste) throw new Error('没有可解析的内容：填入链接或粘贴正文');
        result.paragraphs = paste.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      } else if (!url) {
        throw new Error('请填写文档地址');
      } else {
        // 路径 A：抓页面（同时做格式判定）
        let page = null;
        const rmode = ($('#wbResult') && $('#wbResult').value) || 'auto';
        const wantFile = rmode === 'file';
        const tryFileFirst = rmode === 'file' || rmode === 'auto';
        if (mode === 'auto' || mode === 'dom' || force === 'ppt' || tryFileFirst) {
          try {
            try { page = await DOC.fetchDoc(url, false); }
            catch (e) { page = await DOC.fetchDocAuto(url, { cookie: cookie }); }
          } catch (e) {
            if (mode === 'dom' || force === 'ppt' || tryFileFirst) {
              const why = e && e.message ? e.message : String(e);
              const extra = /403|401|拒绝/.test(why)
                ? '。站点要求登录态：把浏览器 Cookie 填到下方「Cookie」后重试'
                : '。检查链接是否可访问、本地代理是否在运行';
              const err = new Error('抓取失败：' + why + extra);
              err.status = e && e.status;
              throw err;
            }
          }
        }

        /* ── 结果类型 = 原件：页面里有什么文件就下载什么，不做任何格式转换 ── */
        let probeFileFail = '';
        if (tryFileFirst) {
          if (!page) throw new Error('文档页没抓到，无法定位原件（见上一条错误）');
          const guessTitle = (function () {
            const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.text);
            let s = m ? DOC.stripHtml(m[1]) : '';
            s = s.replace(/\s*[-_|–—]\s*[^-_|–—]{0,14}(文库|文档|doc|网)\s*$/i, '').trim();
            return s || 'document';
          })();
          const got = await DOC.fetchOriginal(page.text, page.finalUrl || url, { cookie: cookie });
          if (!got.ok && wantFile) {
            throw new Error('页面里没有可下载的原件（' + (got.reason || '未找到') + '，试了 ' + (got.tried || 0) + ' 个候选）。' +
              '把「结果类型」改成「自动」或「只要文本」可退回提取正文。');
          }
          if (!got.ok) {
            // auto：原件没找到，继续往下走文本提取
            probeFileFail = got.reason || '未找到原件';
          } else {
          const fname = safeName(guessTitle) + '.' + got.ext;
          downloadBlob(new Blob([got.bytes], { type: got.type || FS.mimeOf(got.ext) }), fname);
          const kindTxt = got.ext.toUpperCase();
          S.wb = { title: guessTitle, type: { kind: 'file', label: '原件 ' + kindTxt }, paragraphs: [], slides: [], images: [], mode: 'file' };
          $('#wbMeta').textContent = '原件 · ' + kindTxt + ' · ' + bytes(got.bytes.length);
          $('#wbPreview').innerHTML = '<div class="wb-doc"><div class="pg">ORIGINAL</div>' +
            '<h3>' + esc(guessTitle) + '</h3>' +
            '<p>已下载原件：<b>' + esc(fname) + '</b>（' + kindTxt + ' · ' + bytes(got.bytes.length) + '）</p>' +
            '<p>来源：' + esc(got.url) + '</p>' +
            '<p>按文件魔数判定类型，未做任何转换。</p></div>';
          $('#wbPdf').disabled = true;
          $('#wbTxt').disabled = true;
          toast('原件已下载：' + fname + '（' + bytes(got.bytes.length) + '）', 'ok');
          btn.disabled = false;
          return;
          }
        }

        if (page) {
          if (force === 'ppt') {
            // 用户强制按 PPT 处理：只取文字层
            const r = DOC.extractSlides(page.text, page.finalUrl || url);
            result = {
              title: r.title,
              slides: r.slides,
              paragraphs: r.slides.map((s) => s.text),
              images: [],
              imageSkipped: true,
              host: (() => { try { return new URL(url).host; } catch (e) { return ''; } })(),
              type: { kind: 'ppt', label: 'PPT 幻灯片（手动指定）', reasons: ['用户指定'], isPpt: true },
              mode: 'dom'
            };
          } else {
            result = DOC.extractFromHtml(page.text, page.finalUrl || url);
            result.mode = 'dom';
            if (result.type && result.type.isError) {
              throw new Error('目标站返回的是拒访/错误页（多为需要登录态或触发风控）。' +
                '在下方「Cookie」填入浏览器登录态后重试；' +
                '或直接用 tools\\wenku_bookmarklet.html 的书签在文档页取字。');
            }
          }
        }

        // PPT：到此为止，不走分页接口、也不收集图片
        if (result.type && result.type.isPpt) {
          if (!result.slides || !result.slides.length) {
            throw new Error('识别为 PPT，但页面里没有可提取的文字层（纯图片幻灯片）。' +
              '本工具不会把幻灯片图片当正文导出；如需图片，请用「文档转换 → 图片 → PDF」。');
          }
        } else {
          // 路径 B：分页接口
          if ((!result.paragraphs || result.paragraphs.length < 3) && (mode === 'auto' || mode === 'api')) {
            try {
              const pages = await DOC.fetchPaged(url, $('#wbApi').value, Number($('#wbMax').value) || 30, Number($('#wbConc').value) || 4,
                (n, t) => { $('#wbMeta').textContent = '分页 ' + n + '/' + t; });
              if (pages.length) {
                result.title = result.title || '分页抓取';
                result.paragraphs = pages.map((p) => p.text);
                result.mode = 'api';
              }
            } catch (e) { /* 继续降级 */ }
          }
          // 路径 C：预览图（PPT 已在上游拦截，不会到这里）
          if ((!result.paragraphs || result.paragraphs.length < 3) && (mode === 'auto' || mode === 'img')) {
            if (result.images && result.images.length) {
              result.mode = 'img';
              result.paragraphs = ['（该文档为扫描版，已收集 ' + result.images.length + ' 张页面图片，可用「图片 → PDF」合成）'];
            }
          }
        }

        if (!result.paragraphs || !result.paragraphs.length) {
          if (paste) {
            result.paragraphs = paste.split(/\n+/).map((s) => s.trim()).filter(Boolean);
            result.mode = 'paste';
          } else {
            /* 文本没取到 → 先自动改走原件，再给出可判断的诊断 */
            let fileTry = null;
            if (page) {
              fileTry = await DOC.fetchOriginal(page.text, page.finalUrl || url, { cookie: cookie });
              if (fileTry.ok) {
                const t0 = (function () {
                  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.text);
                  let s = m ? DOC.stripHtml(m[1]) : '';
                  return s.replace(/\s*[-_|–—]\s*[^-_|–—]{0,14}(文库|文档|doc|网)\s*$/i, '').trim() || baseName(url);
                })();
                const fname = safeName(t0) + '.' + fileTry.ext;
                downloadBlob(new Blob([fileTry.bytes], { type: fileTry.type || FS.mimeOf(fileTry.ext) }), fname);
                S.wb = { title: t0, type: { kind: 'file', label: '原件 ' + fileTry.ext.toUpperCase() }, paragraphs: [], slides: [], images: [], mode: 'file' };
                $('#wbMeta').textContent = '已自动改为下载原件 · ' + fileTry.ext.toUpperCase() + ' · ' + bytes(fileTry.bytes.length);
                $('#wbPreview').innerHTML = '<div class="wb-doc"><div class="pg">AUTO → ORIGINAL</div>' +
                  '<h3>' + esc(t0) + '</h3><p>正文取不到（页面是渲染出来的），但找到了原件，已自动下载：<b>' +
                  esc(fname) + '</b>（' + fileTry.ext.toUpperCase() + ' · ' + bytes(fileTry.bytes.length) + '）</p>' +
                  '<p>来源：' + esc(fileTry.url) + '</p></div>';
                $('#wbPdf').disabled = true;
                $('#wbTxt').disabled = true;
                toast('正文取不到，已自动下载原件：' + fname, 'ok');
                btn.disabled = false;
                return;
              }
            }
            throw new Error(buildGrabDiag(page, result, fileTry || (probeFileFail ? { reason: probeFileFail } : null), url));
          }
        }
      }

      S.wb = result;
      renderWb();
      const has = !!(result.paragraphs && result.paragraphs.length);
      $('#wbPdf').disabled = !has;
      $('#wbTxt').disabled = !has;
      const kind = result.type ? result.type.label : '正文';
      const unit = result.slides && result.slides.length ? result.slides.length + ' 页' : result.paragraphs.length + ' 段';
      toast('解析完成：' + kind + ' · ' + unit, 'ok');
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.indexOf('诊断') >= 0) {
        // 多行诊断：渲染成块，而不是塞进一行 toast
        $('#wbPreview').innerHTML = '<div class="wb-doc"><div class="pg">诊断</div>' +
          msg.split('\n').map((l) => '<p>' + esc(l) + '</p>').join('') + '</div>';
        $('#wbMeta').textContent = '未取到内容';
        toast('没取到正文，左侧有诊断结果', 'warn');
      } else if (/403|401|拒绝了所有自动尝试/.test(msg)) {
        $('#wbPreview').innerHTML =
          '<div class="wb-doc"><div class="pg">需要登录态</div>' +
          '<h3>目标站拒绝了匿名访问</h3>' +
          '<p>' + esc(msg) + '</p>' +
          '<p>已自动试过：桌面 / 移动 / 微信 UA，以及百度与 Google 的 Referer —— 全被拒。' +
          '说明这个站点把正文绑定在登录态上，只能带你自己的 Cookie。</p>' +
          '<p>三条路：① 在上方「Cookie」里粘贴浏览器登录态后重试；' +
          '② <a href="tools/wenku_bookmarklet.html" target="_blank" rel="noreferrer" style="color:#d9480f">打开书签页</a>，' +
          '在文档页直接取渲染后的文字；③ 用 <code>tools\wenku_crawler.py</code> 换站。</p></div>';
        $('#wbMeta').textContent = '需要登录态';
        toast('被拒绝：需要登录态，预览区有下一步', 'warn');
      } else {
        $('#wbPreview').innerHTML = '<div class="empty">' + esc(msg) + '</div>';
        $('#wbMeta').textContent = '';
        toast('解析失败：' + msg, 'err');
      }
    } finally {
      btn.disabled = false;
    }
  });

  function wbIsPpt() {
    return !!(S.wb && S.wb.type && S.wb.type.isPpt && S.wb.slides && S.wb.slides.length);
  }

  function renderWb() {
    const r = S.wb;
    if (!r) return;
    const typeTxt = r.type ? r.type.label : '正文';
    const isPpt = wbIsPpt();
    const meta = [];
    if (r.host) meta.push(r.host);
    meta.push(typeTxt);
    if (isPpt) meta.push(r.slides.length + ' 页');
    else meta.push(r.paragraphs.length + ' 段');
    if (isPpt) meta.push('已跳过图片');
    else if (r.images && r.images.length) meta.push(r.images.length + ' 张图');
    if (r.mode) meta.push(r.mode.toUpperCase());
    $('#wbMeta').textContent = meta.join(' · ');

    const box = $('#wbPreview');
    if (isPpt) {
      box.innerHTML = r.slides.map((s) =>
        '<div class="wb-doc"><div class="pg">SLIDE ' + s.index + ' / ' + r.slides.length + '</div>' +
        (s.index === 1 ? '<h3>' + esc(r.title || '未命名文档') + '</h3>' : '') +
        String(s.text || '').split('\n').map((line) => '<p>' + esc(line) + '</p>').join('') + '</div>'
      ).join('');
      return;
    }

    const pgSize = 12;
    const chunks = [];
    for (let i = 0; i < r.paragraphs.length; i += pgSize) chunks.push(r.paragraphs.slice(i, i + pgSize));
    box.innerHTML = chunks.map((c, i) =>
      '<div class="wb-doc"><div class="pg">BLOCK ' + (i + 1) + ' / ' + chunks.length + '</div>' +
      (i === 0 ? '<h3>' + esc(r.title || '未命名文档') + '</h3>' : '') +
      c.map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>'
    ).join('') + (r.images && r.images.length
      ? '<div class="wb-doc"><h3>页面图片</h3>' + r.images.slice(0, 40).map((u, i) =>
        '<p><a href="' + esc(u) + '" target="_blank" rel="noreferrer" style="color:#9fb4ff">page_' + (i + 1) + ' · ' + esc(u.slice(-64)) + '</a></p>').join('') + '</div>'
      : '');
  }

  /** PPT 导出用：一页幻灯片一段，用 \f 强制分页 */
  function wbPlainText() {
    const r = S.wb;
    if (!r) return '';
    if (wbIsPpt()) {
      return r.slides.map((s) => '〔第 ' + s.index + ' 页〕\n' + s.text).join('\n\f\n');
    }
    return (r.title ? r.title + '\n\n' : '') + r.paragraphs.join('\n\n');
  }

  $('#wbPdf').addEventListener('click', async () => {
    if (!S.wb) return;
    const btn = $('#wbPdf');
    btn.disabled = true; btn.textContent = '生成中…';
    try {
      const pdf = await DOC.textToPdf(wbPlainText(), {
        pageSize: 'a4',
        fontSize: 11,
        sections: wbIsPpt(),
        title: S.wb.title || 'wenku'
      });
      downloadBlob(new Blob([pdf], { type: 'application/pdf' }), safeName(S.wb.title || 'wenku') + '.pdf');
      toast('PDF 已生成 · ' + bytes(pdf.length), 'ok');
    } catch (e) {
      toast('失败：' + (e.message || e), 'err');
    } finally {
      btn.disabled = false; btn.textContent = '导出 PDF';
    }
  });

  $('#wbTxt').addEventListener('click', () => {
    if (!S.wb) return;
    const text = wbPlainText().replace(/\f/g, '\n\n────────\n\n');
    downloadBlob(new Blob([text], { type: FS.mimeOf('txt') }), safeName(S.wb.title || 'wenku') + '.txt');
    toast('已导出 TXT', 'ok');
  });

  /* ══════════════════════════════════════════════
     五 · 环境 / 能力
     ══════════════════════════════════════════════ */
  function renderEnv() {
    const cap = IMG.detect();
    const grid = $('#envGrid');
    const ua = navigator.userAgent;
    const bm = ua.match(/(Edg|Chrome|Firefox|OPR)\/([\d.]+)/);
    const browser = bm ? bm[1].replace('OPR', 'Opera') + ' ' + bm[2].split('.')[0] : ua.slice(0, 42);
    const items = [
      ['浏览器', browser],
      ['平台', (navigator.platform || '') + ' · ' + (navigator.hardwareConcurrency || '?') + ' 核'],
      ['WebP / AVIF', (cap['image/webp'] ? 'WebP' : '—') + ' / ' + (cap['image/avif'] ? 'AVIF' : '—'), cap['image/webp']],
      ['WebAudio', (window.AudioContext || window.webkitAudioContext) ? '可用' : '不可用', !!(window.AudioContext || window.webkitAudioContext)],
      ['MP3 编码', window.lamejs ? '已加载' : '按需', !!window.lamejs],
      ['pdf.js', window.pdfjsLib ? '已加载' : '按需', !!window.pdfjsLib]
    ];
    grid.innerHTML = items.map(([k, v, ok]) =>
      '<div class="env-item"><span>' + esc(k) + '</span><b class="' + (ok === undefined ? '' : ok ? 'yes' : 'no') + '">' + esc(v) + '</b></div>'
    ).join('');
    const chip = $('#capChip');
    const list = ['PNG', 'JPG'];
    if (cap['image/webp']) list.push('WebP');
    if (cap['image/avif']) list.push('AVIF');
    list.push('BMP', 'ICO');
    chip.textContent = list.join(' · ');
    chip.classList.add('good');
    const hint = $('#imgSupportHint');
    if (hint) hint.textContent = '可编码：' + list.join(' / ');
    // 不支持格式的按钮禁用
    $$('#imgFormat button').forEach((b) => {
      if (b.dataset.need === 'avif' && !cap['image/avif']) {
        b.disabled = true;
        b.title = '当前浏览器不支持 AVIF 编码';
      }
    });
  }

  /* ═══ 设置 ↔ 工具页联动 ═══════════════════════ */
  function syncSetFmt() {
    const v = $('#setFmt').value;
    const btn = document.querySelector('#imgFormat button[data-fmt="' + v + '"]');
    if (btn && !btn.disabled) {
      $$('#imgFormat button').forEach((b) => b.classList.toggle('is-on', b === btn));
      S.imgFmt = v;
    }
  }
  $('#setFmt').addEventListener('change', () => { syncSetFmt(); saveSettings(); });
  function syncBg(v) {
    $('#imgBg').value = v;
    $('#setBg').value = v;
    $('#imgBgHex').textContent = v;
    $('#setBgHex').textContent = v;
  }
  $('#setBg').addEventListener('input', (e) => syncBg(e.target.value));
  $('#imgBg').addEventListener('input', (e) => syncBg(e.target.value));

  /* ═══ 启动 ═════════════════════════════════════ */
  loadSettings();
  if (!$('#setAnim').checked) document.body.classList.add('no-anim');
  syncBg($('#imgBg').value);
  syncSetFmt();
  $('#musWavOpts').hidden = musFormat() === 'keep';
  refreshCodecUI();
  renderImgQueue();
  renderMusQueue();
  renderP2I();
  renderEnv();
  const initialView = location.hash.slice(1);
  switchView(VIEWS[initialView] ? initialView : 'image');
  probeProxy();

  console.log('%c泛式 ready', 'color:#7aa2ff;font-weight:600');
})();
