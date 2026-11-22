/* ══════════════════════════════════════════════════════
   doc.js — 文档引擎：图片/文本 → PDF，PDF → 图片/文本，文库抓取
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ═══ 1. 图片 → PDF ═══════════════════════════ */
  async function imagesToPdf(files, opt) {
    const o = opt || {};
    const frames = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const frame = await PDFOut.imageFileToFrame(f, 2600);
      frames.push(frame);
      if (o.onProgress) o.onProgress(i + 1, files.length, f.name);
      await new Promise((r) => setTimeout(r, 0));
    }
    return PDFOut.build({
      pages: frames,
      pageSize: o.pageSize || 'fit',
      marginMM: Number(o.marginMM) || 0,
      title: o.title || 'album'
    });
  }

  /* ═══ 2. 文本 → PDF（逐页渲染，中文安全） ═══════ */
  const FONT_STACK = '"PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",system-ui,sans-serif';

  async function textToPdf(text, opt) {
    const o = opt || {};
    const size = o.pageSize === 'letter' ? 'letter' : 'a4';
    const [pw, ph] = PDFOut.PAGES[size];
    const fontSize = Math.max(6, Math.min(48, Number(o.fontSize) || 12));
    const S = 2;                        // 2x 超采样，打印更清晰
    const margin = 56;                  // pt
    const lineH = fontSize * 1.72;
    const padTop = margin;

    // 断行测量
    const meas = document.createElement('canvas');
    const mctx = meas.getContext('2d');
    mctx.font = fontSize + 'px ' + FONT_STACK;
    const maxW = pw - margin * 2;
    const perPage = Math.max(1, Math.floor((ph - margin * 2) / lineH));

    /* o.sections = true 时按换页符 \f 分段，每段单独起页。
       用于 PPT：一页幻灯片对应一页 PDF，不会被自动排版切碎。 */
    const raw = String(text == null ? '' : text);
    const sections = o.sections ? raw.split('\f') : [raw];
    const pagesOfLines = [];
    sections.forEach((sec) => {
      const lines = FS.wrapText(mctx, sec, maxW);
      if (!lines.length) { pagesOfLines.push(['']); return; }
      for (let i = 0; i < lines.length; i += perPage) {
        pagesOfLines.push(lines.slice(i, i + perPage));
      }
    });
    const pageCount = Math.max(1, pagesOfLines.length);

    const frames = [];
    for (let p = 0; p < pageCount; p++) {
      const c = document.createElement('canvas');
      c.width = Math.round(pw * S);
      c.height = Math.round(ph * S);
      const x = c.getContext('2d');
      x.scale(S, S);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, pw, ph);
      x.fillStyle = '#131722';
      x.font = fontSize + 'px ' + FONT_STACK;
      x.textBaseline = 'top';
      const slice = pagesOfLines[p] || [];
      slice.forEach((line, i) => {
        x.fillText(line, margin, padTop + i * lineH + (lineH - fontSize) / 2);
      });
      // 页码
      x.fillStyle = '#9aa3b8';
      x.font = (fontSize - 2) + 'px ' + FONT_STACK;
      x.textAlign = 'center';
      x.fillText((p + 1) + ' / ' + pageCount, pw / 2, ph - margin / 1.6);
      x.textAlign = 'left';

      const jpeg = await PDFOut.canvasToJpeg(c, 0.92);
      frames.push({ jpeg, w: c.width, h: c.height });
      if (o.onProgress) o.onProgress(p + 1, pageCount);
      await new Promise((r) => setTimeout(r, 0));
    }
    return PDFOut.build({ pages: frames, pageSize: size, marginMM: 0, title: o.title || 'document' });
  }

  /* ═══ 3. PDF.js 动态加载 ══════════════════════ */
  const PDFJS_SRC = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js'
  ];
  const PDFJS_WORKER = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
  ];
  let pdfjsPromise = null;

  function loadPdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= PDFJS_SRC.length) { pdfjsPromise = null; reject(new Error('PDF 引擎加载失败（需要联网获取 pdf.js）')); return; }
        const idx = i++;
        const s = document.createElement('script');
        s.src = PDFJS_SRC[idx];
        s.onload = () => {
          const lib = global.pdfjsLib;
          if (!lib) { next(); return; }
          try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER[idx] || PDFJS_WORKER[0]; } catch (e) {}
          resolve(lib);
        };
        s.onerror = next;
        document.head.appendChild(s);
      };
      next();
    });
    return pdfjsPromise;
  }

  function parseRange(str, max) {
    if (!str || !str.trim()) return Array.from({ length: max }, (_, i) => i + 1);
    const set = new Set();
    str.split(/[,，\s]+/).forEach((part) => {
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (m) {
        let a = +m[1], b = +m[2];
        if (a > b) { const t = a; a = b; b = t; }
        for (let i = Math.max(1, a); i <= Math.min(max, b); i++) set.add(i);
      } else if (/^\d+$/.test(part)) {
        const v = +part;
        if (v >= 1 && v <= max) set.add(v);
      }
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  async function openPdf(file) {
    const lib = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    return doc;
  }

  /** PDF → PNG 图片数组 */
  async function pdfToImages(file, opt) {
    const o = opt || {};
    const doc = await openPdf(file);
    const scale = Number(o.scale) || 2;
    const pages = parseRange(o.range, doc.numPages);
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const pno = pages[i];
      const page = await doc.getPage(pno);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      out.push({
        name: FS.safeName(FS.baseName(file.name)) + '_p' + String(pno).padStart(3, '0') + '.png',
        bytes: new Uint8Array(await blob.arrayBuffer())
      });
      if (o.onProgress) o.onProgress(i + 1, pages.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }

  /** PDF → 文本（按坐标聚行、按垂直间隔分段） */
  async function pdfToText(file, opt) {
    const o = opt || {};
    const doc = await openPdf(file);
    const pages = parseRange(o.range, doc.numPages);
    const keepPara = o.paragraphs !== false;
    const parts = [];
    for (let i = 0; i < pages.length; i++) {
      const page = await doc.getPage(pages[i]);
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach((it) => {
        if (!it.str) return;
        const y = Math.round(it.transform[5]);
        let row = rows.find((r) => Math.abs(r.y - y) <= 3);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x: it.transform[4], s: it.str });
      });
      rows.sort((a, b) => b.y - a.y);
      let prevY = null;
      const lines = [];
      rows.forEach((r) => {
        r.items.sort((a, b) => a.x - b.x);
        const text = r.items.map((x) => x.s).join('').replace(/\s+/g, ' ').trim();
        if (!text) return;
        if (keepPara && prevY !== null && prevY - r.y > 26 && lines.length) lines.push('');
        lines.push(text);
        prevY = r.y;
      });
      parts.push(lines.join('\n'));
      if (o.onProgress) o.onProgress(i + 1, pages.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return parts.join('\n\n');
  }

  /* ═══ 4. 文库抓取 ═════════════════════════════ */
  // 转发层地址：同源时用相对地址（https 页面不能请求 http 明文，否则触发混合内容拦截）；
  // 用 file:// 直接打开时回退到本机 http 端口。
  const PROXY = (function () {
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin + '/';
    } catch (e) { /* ignore */ }
    return 'http://127.0.0.1:8787/';
  })();

  async function probeProxy() {
    try {
      const r = await fetch(PROXY + '__ping', { cache: 'no-store' });
      if (!r.ok) return { ok: false, status: r.status };
      const j = await r.json();
      return { ok: true, info: j };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function fetchDoc(url, useProxy, opts) {
    const o = opts || {};
    let target;
    if (useProxy) {
      target = PROXY + '?url=' + encodeURIComponent(url);
      if (o.cookie) target += '&cookie=' + encodeURIComponent(o.cookie);
      if (o.ua) target += '&ua=' + encodeURIComponent(o.ua);
      if (o.referer) target += '&referer=' + encodeURIComponent(o.referer);
    } else {
      target = url;
    }
    let r;
    try {
      r = await fetch(target, { credentials: useProxy ? 'omit' : 'include', cache: 'no-store' });
    } catch (e) {
      const err = new Error('请求被浏览器拦截或网络不可达（跨域时请用本地代理）');
      err.status = 0;
      throw err;
    }
    if (!r.ok) {
      const err = new Error(
        r.status === 403 ? '目标站返回 403（需要登录态或触发风控）'
          : r.status === 401 ? '目标站要求登录（401）'
            : '请求失败 HTTP ' + r.status);
      err.status = r.status;
      throw err;
    }
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    return { text, contentType: ct, finalUrl: r.url || url, status: r.status };
  }

  /* ── 自动降级抓取 ───────────────────────────────
     403 不代表没救：很多站点只看 UA / Referer。
     依次用「桌面 → 移动 → 微信内置」UA，再换两个 Referer，
     全部失败才把「需要你自己登录态」这个结论交出去。 */
  const UA_TRIES = [
    { label: '桌面 Chrome', ua: '' },
    { label: '移动 Safari', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
    { label: '微信内置', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002823) NetType/WIFI Language/zh_CN' }
  ];
  const REFERER_TRIES = ['https://www.baidu.com/', 'https://www.google.com/'];

  async function fetchDocAuto(url, opts) {
    const o = opts || {};
    const log = [];
    for (let i = 0; i < UA_TRIES.length; i++) {
      const t = UA_TRIES[i];
      try {
        const r = await fetchDoc(url, true, { cookie: o.cookie, ua: t.ua });
        log.push(t.label + ' ✓');
        return Object.assign(r, { via: t.label, tries: log });
      } catch (e) {
        log.push(t.label + ' → ' + (e.status || 'x'));
        if (e.status !== 403 && e.status !== 401 && e.status !== 0) throw e;
      }
    }
    for (let i = 0; i < REFERER_TRIES.length; i++) {
      try {
        const r = await fetchDoc(url, true, { cookie: o.cookie, referer: REFERER_TRIES[i], ua: UA_TRIES[1].ua });
        log.push('Referer ' + REFERER_TRIES[i] + ' ✓');
        return Object.assign(r, { via: '移动 UA + Referer ' + REFERER_TRIES[i], tries: log });
      } catch (e) {
        log.push('Referer ' + REFERER_TRIES[i] + ' → ' + (e.status || 'x'));
      }
    }
    const err = new Error('目标站拒绝了所有自动尝试（' + log.join('，') + '）');
    err.status = 403;
    err.tries = log;
    throw err;
  }

  const MAIN_SELECTORS = [
    '#doc-content', '.reader-content', '.doc-content', '.article-content', '.content-body',
    '.w-content', '.main-content', 'article', '#content', '.content', 'main'
  ];

  /* ── 文档格式自动检测 ───────────────────────────
     文库站点对 PPT 的预览通常是「每页一个 slide 容器 + 文字层」，
     或者把整页渲染成图片。前者能直接取字，后者只能拿到图。
     所以先判类型，再决定走文字还是图。 */
  const NOISE_LINE = /^(上一页|下一页|尾页|末页|首页|播放|暂停|继续|全屏|退出全屏|退出|目录|分享|收藏|下载|举报|返回|返回顶部|放大|缩小|还原|拖动|换页|查看更多|全文阅读|查看源文件|免费下载|开通VIP|立即登录|登录|注册|搜索|评论|\d+\s*[\/|]\s*\d+)$/;

  function detectType(html, url) {
    const h = String(html || '');
    const u = String(url || '').toLowerCase();
    const score = { ppt: 0, word: 0, pdf: 0, text: 0 };
    const why = [];
    const bump = (k, n, r) => {
      score[k] += n;
      if (r && why.indexOf(r) < 0) why.push(r);
    };

    if (/\.pptx?(\?|#|$)/.test(u) || /\/(ppt|slides?|p-?\d+)\//.test(u)) bump('ppt', 3, 'URL 含 ppt');
    if (/\.docx?(\?|#|$)/.test(u)) bump('word', 3, 'URL 含 doc');
    if (/\.pdf(\?|#|$)/.test(u)) bump('pdf', 3, 'URL 含 pdf');
    if (/\.txt(\?|#|$)/.test(u)) bump('text', 3, 'URL 含 txt');

    const decl = /(?:docType|fileType|fileExt|docExt|dtype|type)["']?\s*[:=]\s*["']?(pptx?|docx?|pdf|txt)/gi;
    let m;
    while ((m = decl.exec(h))) {
      const v = m[1].toLowerCase();
      const k = v.indexOf('ppt') === 0 ? 'ppt' : (v.indexOf('doc') === 0 ? 'word' : (v === 'pdf' ? 'pdf' : 'text'));
      bump(k, 5, '页面声明 type=' + v);
    }

    const slideCls = (h.match(/class\s*=\s*["'][^"']*(?:slide|ppt)[-_ ]?(?:page|item|container|box|player)?[^"']*["']/gi) || []).length;
    if (slideCls >= 2) bump('ppt', Math.min(6, slideCls), '存在 slide/ppt 结构 ×' + Math.min(99, slideCls));
    if (/"(?:slides|slideList|slideData)"\s*:\s*\[/i.test(h) || /slideCount|totalSlide|pageCount\s*:\s*\d+/i.test(h)) bump('ppt', 3, '内嵌 slides 数据');
    if (/(幻灯片|演示文稿|PowerPoint|PPT模板)/.test(h.slice(0, 30000))) bump('ppt', 1, '页面含「幻灯片/演示文稿」');
    if (/(Word文档|word文档|\.docx)/.test(h.slice(0, 30000))) bump('word', 1, '页面含 Word 字样');

    const kinds = Object.keys(score).sort((a, b) => score[b] - score[a]);
    const kind = score[kinds[0]] >= 2 ? kinds[0] : 'text';
    const LABEL = { ppt: 'PPT 幻灯片', word: 'Word 文档', pdf: 'PDF 文档', text: '网页正文' };
    return { kind, label: LABEL[kind], score: score[kind], reasons: why, isPpt: kind === 'ppt' };
  }

  /** 从内嵌 JSON 里拽出 slides 文本（很多预览器把整份内容塞进 window.__DATA__） */
  function slidesFromJson(doc) {
    const out = [];
    const scripts = doc.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i].textContent || '';
      if (!/"(?:slides|slideList|slideData)"\s*:/.test(s)) continue;
      const mm = /"(?:slides|slideList|slideData)"\s*:\s*(\[[\s\S]*?\])/.exec(s);
      if (!mm) continue;
      try {
        const arr = JSON.parse(mm[1]);
        arr.forEach((item, idx) => {
          const txt = collectStrings(item).join('\n');
          if (txt.trim()) out.push({ index: idx + 1, text: txt.trim() });
        });
      } catch (e) { /* 结构不是标准 JSON，跳过 */ }
      if (out.length) break;
    }
    return out;
  }

  function collectStrings(node, depth) {
    const d = depth || 0;
    if (d > 6 || node == null) return [];
    if (typeof node === 'string') {
      const t = node.replace(/<[^>]+>/g, ' ').replace(/[\u00a0\s]+/g, ' ').trim();
      return (t.length > 1 && !NOISE_LINE.test(t)) ? [t] : [];
    }
    if (Array.isArray(node)) return node.reduce((a, x) => a.concat(collectStrings(x, d + 1)), []);
    if (typeof node === 'object') {
      const keys = ['text', 'content', 'value', 'title', 'html', 'richText', 'txt'];
      let acc = [];
      keys.forEach((k) => { if (node[k]) acc = acc.concat(collectStrings(node[k], d + 1)); });
      return acc;
    }
    return [];
  }

  /** 挑出 slide 级别的节点：剔除「内部还有多个同类」的容器 */
  function pickSlideNodes(doc) {
    const sel = '[class*="slide"],[class*="ppt-page"],[class*="pptPage"],[class*="page-item"],[class*="pageItem"],[class*="slide-item"],[data-slide-index]';
    let list = Array.prototype.slice.call(doc.querySelectorAll(sel));
    if (!list.length) return [];
    list = list.filter((n) => {
      const inner = list.filter((m) => m !== n && n.contains(m)).length;
      return inner < 2;
    });
    list = list.filter((n) => (n.textContent || '').trim().length >= 2);
    const uniq = [];
    list.forEach((n) => { if (uniq.indexOf(n) < 0) uniq.push(n); });
    return uniq;
  }

  function slideTextOf(node) {
    const parts = [];
    const seen = new Set();
    const push = (t) => {
      const s = String(t || '').replace(/[\u00a0\s]+/g, ' ').trim();
      if (!s || s.length < 1 || NOISE_LINE.test(s) || seen.has(s)) return;
      seen.add(s);
      parts.push(s);
    };
    const leaves = node.querySelectorAll('p,li,h1,h2,h3,h4,td,span,div,a');
    let took = 0;
    leaves.forEach((b) => {
      if (b.querySelector('p,li,h1,h2,h3,h4,td,div,span')) return;  // 只取叶子
      push(b.textContent);
      took++;
    });
    if (!took) push(node.textContent);
    return parts.join('\n');
  }

  /** PPT 专用：只要文字，不碰图片 */
  function extractSlides(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pageTitle = ((doc.querySelector('title') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    let title = pageTitle.replace(/\s*[-_|–—]\s*[^-_|–—]{0,14}(文库|文档|doc|Doc|网)\s*$/, '').trim();
    if (!title) title = ((doc.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    title = title.slice(0, 120);

    let slides = slidesFromJson(doc);
    let via = 'json';

    if (!slides.length) {
      via = 'dom';
      const nodes = pickSlideNodes(doc);
      const seen = new Set();
      nodes.forEach((n) => {
        const t = slideTextOf(n);
        if (!t || seen.has(t)) return;
        seen.add(t);
        slides.push({ index: slides.length + 1, text: t });
      });
      // 编号重排，避免因去重跳号
      slides = slides.map((s, i) => ({ index: i + 1, text: s.text }));
    }

    return { title: title || '演示文稿', slides, via, count: slides.length };
  }

  function extractFromHtml(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const abs = (u) => { try { return new URL(u, baseUrl || 'http://x/').href; } catch (e) { return u; } };
    const type = detectType(html, baseUrl);
    const hostOf = () => { try { return new URL(baseUrl).host; } catch (e) { return ''; } };
    if (looksLikeErrorPage(html)) {
      return {
        type: { kind: 'error', label: '拒访 / 错误页', reasons: ['命中错误页特征'], isError: true },
        title: '', paragraphs: [], slides: [], images: [], host: hostOf()
      };
    }

    // ── PPT：只取文字层，图片一律不收集 ──
    if (type.isPpt) {
      const r = extractSlides(html, baseUrl);
      return {
        type,
        title: r.title,
        slides: r.slides,
        paragraphs: r.slides.map((s) => s.text),
        images: [],
        imageSkipped: true,
        host: (() => { try { return new URL(baseUrl).host; } catch (e) { return ''; } })()
      };
    }

    // 标题：优先 <title>（去掉「- 某某文库」站点后缀），退回 h1
    const pageTitle = ((doc.querySelector('title') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const h1Text = ((doc.querySelector('h1') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    let title = pageTitle.replace(/\s*[-_|–—]\s*[^-_|–—]{0,14}(文库|文档|doc|Doc|网)\s*$/, '').trim();
    if (!title) title = h1Text;
    title = title.slice(0, 120);

    // 清掉脚本噪声
    doc.querySelectorAll('script,style,noscript,iframe,svg,header,footer,nav,.toolbar,.header,.footer,.ad,.ads,.hot-news,.recommend').forEach((n) => n.remove());

    let best = null, bestScore = 0;
    MAIN_SELECTORS.forEach((sel) => {
      doc.querySelectorAll(sel).forEach((node) => {
        const t = (node.innerText || node.textContent || '').trim();
        const score = t.length + node.querySelectorAll('p').length * 60;
        if (t.length > 40 && score > bestScore) { bestScore = score; best = node; }
      });
    });
    if (!best) best = doc.body;

    const paragraphs = [];
    const blocks = best.querySelectorAll('p,h1,h2,h3,h4,li,div.section,td');
    const seen = new Set();
    const push = (t) => {
      const s = String(t || '').replace(/[\u00a0\s]+/g, ' ').trim();
      if (s.length < 2 || seen.has(s) || isCodeDump(s)) return;
      seen.add(s);
      paragraphs.push(s);
    };
    if (blocks.length && best.querySelectorAll('p').length >= 2) {
      blocks.forEach((b) => {
        if (b.querySelector('p,div') && b.tagName !== 'LI' && b.tagName !== 'TD') return;
        push(b.innerText || b.textContent);
      });
    } else {
      String(best.innerText || best.textContent || '').split(/\n{1,}/).forEach(push);
    }
    if (paragraphs.length < 3) {
      String(best.innerText || best.textContent || '').split(/\n+/).forEach(push);
    }

    const images = [];
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
      if (!src || /\.svg|icon|logo|avatar|blank|spacer/i.test(src)) return;
      const w = parseInt(img.getAttribute('width') || '0', 10);
      if (w && w < 80) return;
      images.push(abs(src));
    });

    return { type, title, paragraphs, slides: [], images, host: (() => { try { return new URL(baseUrl).host; } catch (e) { return ''; } })() };
  }

  /** 分页接口遍历（模板 {base} {id} {n}） */
  /* ── 内容清洗与质量判定 ─────────────────────── */
  const BAD_PAGE = /(访问出错了|页面没有找到|页面不存在|请先登录|请登录|安全验证|滑动验证|人机验证|访问受限|访问频繁|403 Forbidden|404 Not Found|百度文库首页|该文档已删除|内容已下线)/;

  /** 去标签：先干掉 script/style 整块，再剥标签、反转义实体 */
  function stripHtml(html) {
    return String(html)
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#(\d{1,5});/g, (m, d) => String.fromCharCode(+d))
      .replace(/[\u00a0\s]+/g, ' ')
      .trim();
  }

  /** CSS/JS 残渣：花括号与分号密度过高，或含大量属性声明 */
  function isCodeDump(s) {
    const str = String(s || '');
    if (str.length < 60) return false;
    const braces = (str.match(/[{};]/g) || []).length;
    const decls = (str.match(/\b(?:color|margin|padding|font-size|line-height|width|height|text-align|border|background)\s*:/g) || []).length;
    return decls >= 3 || braces > str.length * 0.05;
  }

  /** 错误页判定：命中拒访关键词，或正文极短且是错误模板 */
  function looksLikeErrorPage(html) {
    const head = String(html || '').slice(0, 6000);
    return BAD_PAGE.test(head);
  }

  /** 正文是否可用：中文占比 + 不是代码渣 + 不是错误页 */
  function isUsableText(s) {
    const str = String(s || '').trim();
    if (str.length < 20) return false;
    if (isCodeDump(str)) return false;
    if (BAD_PAGE.test(str) && str.length < 200) return false;
    const cn = (str.match(/[\u4e00-\u9fa5]/g) || []).length;
    const letters = (str.match(/[A-Za-z]/g) || []).length;
    // 纯中文/中文为主，或者英文长文
    if (cn >= 8) return true;
    return letters > 40 && cn === 0;
  }

  /** 分页接口遍历（模板 {base} {id} {n}） */
  async function fetchPaged(url, tpl, maxPages, conc, onProgress) {
    let u;
    try { u = new URL(url); } catch (e) { throw new Error('文档地址无效'); }
    const m = /\/(?:view|doc|html|p)\/?([0-9a-zA-Z_-]{4,})/.exec(u.pathname + u.search) || [];
    const id = m[1] || (u.searchParams.get('id') || u.searchParams.get('docId') || '');
    const base = u.origin;
    const out = [];
    let page = 1;
    let emptyStreak = 0;
    const cookie = (typeof global.__WB_COOKIE === 'string' ? global.__WB_COOKIE : '');

    while (page <= maxPages && emptyStreak < 3) {
      const target = tpl.replace(/\{base\}/g, base).replace(/\{id\}/g, id).replace(/\{n\}/g, page);
      let raw = '';
      try {
        const r = await fetchDoc(target, true, { cookie });
        raw = r.text;
      } catch (e) { /* 单页失败继续 */ }

      // 关键：先判断是不是拒访页，命中就整体中止，绝不把错误页当正文
      if (raw && looksLikeErrorPage(raw)) {
        throw new Error('目标站返回了拒访页（多为需要登录 Cookie）。请在「Cookie」里填入浏览器中的登录态后重试');
      }
      const clean = stripHtml(raw);
      if (!isUsableText(clean)) {
        emptyStreak++;
      } else {
        emptyStreak = 0;
        out.push({ page, text: clean });
      }
      if (onProgress) onProgress(page, maxPages);
      page++;
      await FS.sleep(120);
    }
    return out;
  }

  /* ═══ 5. 原件下载（是什么文件就给什么文件，不做格式转换） ═══ */
  const FILE_EXT_RE = /\.(pdf|docx?|pptx?|xlsx?|txt|epub|zip|rar|7z|odt|odp|ods)(\?|#|$)/i;

  /** 从页面里挖出可能的原件地址：直链 > 属性 > JSON 字段 > 下载接口 */
  function findFileCandidates(html, baseUrl) {
    const abs = (u) => {
      try {
        if (!u) return null;
        u = String(u).replace(/\\\//g, '/').trim();
        if (u.startsWith('//')) return location.protocol + u;
        return new URL(u, baseUrl || location.href).href;
      } catch (e) { return null; }
    };
    const out = [], seen = new Set();
    const add = (u, w) => {
      const full = abs(u);
      if (!full || seen.has(full)) return;
      seen.add(full);
      out.push({ url: full, w });
    };
    const h = String(html || '');

    (h.match(/https?:\/\/[^\s"'<>()]+?\.(?:pdf|docx?|pptx?|xlsx?|txt|epub|zip|rar|7z)(?:\?[^\s"'<>()]*)?/gi) || [])
      .forEach((u) => add(u, 100));

    const attrRe = /(?:href|src|data-href|data-src|data-url|data-download)\s*=\s*["']([^"']+?\.(?:pdf|docx?|pptx?|xlsx?|txt|epub|zip|rar|7z)(?:\?[^"']*)?)["']/gi;
    let m;
    while ((m = attrRe.exec(h))) add(m[1], 80);

    const jsonRe = /"(?:fileUrl|downloadUrl|sourceUrl|pdfUrl|docUrl|originUrl|url)"\s*:\s*"([^"]{6,500})"/gi;
    while ((m = jsonRe.exec(h))) {
      if (FILE_EXT_RE.test(m[1])) add(m[1], 60);
    }

    const dlRe = /href\s*=\s*["']([^"']*(?:download|down)[^"']*)["']/gi;
    while ((m = dlRe.exec(h))) add(m[1], 20);

    out.sort((a, b) => b.w - a.w);
    return out.map((x) => x.url);
  }

  /** 按魔数判断真实类型，不信扩展名 */
  function sniffBytes(u8) {
    if (!u8 || u8.length < 8) return null;
    const s = (o, n) => { let t = ''; for (let i = 0; i < n && o + i < u8.length; i++) t += String.fromCharCode(u8[o + i]); return t; };
    if (s(0, 4) === '%PDF') return 'pdf';
    if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) {
      // zip 容器：中央目录在末尾，取尾部 64KB 找目录名
      const tailStart = Math.max(0, u8.length - 65536);
      let tail = '';
      try { tail = new TextDecoder('latin1').decode(u8.subarray(tailStart)); } catch (e) { tail = ''; }
      if (/word\//.test(tail)) return 'docx';
      if (/ppt\//.test(tail)) return 'pptx';
      if (/xl\//.test(tail)) return 'xlsx';
      return 'zip';
    }
    if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) {
      let head = '';
      try { head = new TextDecoder('latin1').decode(u8.subarray(0, 8192)); } catch (e) { head = ''; }
      if (head.indexOf('WordDocument') >= 0) return 'doc';
      if (head.indexOf('PowerPoint') >= 0) return 'ppt';
      if (head.indexOf('Workbook') >= 0 || head.indexOf('Book') >= 0) return 'xls';
      return 'doc';
    }
    if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'jpg';
    if (u8[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
    if (s(0, 5).toLowerCase() === '<?xml' || s(0, 5).toLowerCase() === '<html') return 'html';
    if (new TextDecoder('latin1').decode(u8.subarray(0, 2048)).toLowerCase().indexOf('<html') >= 0) return 'html';
    return null;
  }

  /** 二进制下载（经代理的 binary=1 端点，不做字符解码） */
  async function fetchBinary(url, opts) {
    const o = opts || {};
    let q = PROXY + '?binary=1&url=' + encodeURIComponent(url);
    if (o.cookie) q += '&cookie=' + encodeURIComponent(o.cookie);
    const r = await fetch(q, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') || '' };
  }

  /** 尝试拿到原件，返回 {ok, url, bytes, ext} */
  async function fetchOriginal(html, pageUrl, opts) {
    const cands = findFileCandidates(html, pageUrl).slice(0, 8);
    if (!cands.length) return { ok: false, reason: '页面里没有指向原件（pdf/docx/pptx…）的链接', tried: 0 };
    let last = '';
    for (const u of cands) {
      try {
        const { bytes } = await fetchBinary(u, opts);
        if (bytes.length < 2048) { last = '数据过短'; continue; }
        const ext = sniffBytes(bytes);
        if (!ext || ext === 'html') { last = '拿到的不是文件'; continue; }
        return { ok: true, url: u, bytes, ext };
      } catch (e) {
        last = e.message || String(e);
      }
    }
    return { ok: false, reason: last || '所有候选都不可用', tried: cands.length };
  }

  /** 抓不到正文时的事实诊断（纯函数，便于测试与复用） */
  function diagnoseGrab(opts) {
    const o = opts || {};
    const html = String(o.html || '');
    const L = [];
    if (!html) {
      L.push('· 页面没抓到 —— 检查链接能否访问、是否被跨域拦截、本地代理是否在跑');
      return L;
    }
    L.push('· 页面长度：' + html.length + ' 字符');
    if (o.finalUrl) L.push('· 最终地址：' + o.finalUrl);

    if (/pageData|__INITIAL_STATE__|window\.__DATA__|id="app"|id="root"/.test(html.slice(0, 60000))) {
      L.push('· 判断：SPA 壳 —— 正文由 JavaScript 渲染，HTML 源码里根本没有那段文字');
    }
    if ((html.match(/<img[^>]+(?:page|slide|doc|\d{1,3})[^>]*>/gi) || []).length >= 3) {
      L.push('· 判断：页面主体是图片（扫描件 / 预览图），没有文字层');
    }
    if (html.length < 4000) {
      L.push('· 判断：页面异常短 —— 可能是拦截页、跳转页，或需要登录');
    }
    const r = o.result || {};
    if (r.type) {
      L.push('· 类型判定：' + r.type.label +
        (r.type.reasons && r.type.reasons.length ? '（' + r.type.reasons.join('、') + '）' : ''));
    }
    L.push('· 提取到段落：' + ((r.paragraphs && r.paragraphs.length) || 0) + ' 段');
    const cands = findFileCandidates(html, o.finalUrl || '');
    L.push('· 原件候选：' + cands.length + ' 个' +
      (o.fileTry && o.fileTry.reason ? '，都不可用（' + o.fileTry.reason + '）' : ''));
    return L;
  }

  global.DOC = {
    imagesToPdf, textToPdf, loadPdfJs, pdfToImages, pdfToText,
    probeProxy, fetchDoc, fetchDocAuto, extractFromHtml, detectType, extractSlides, fetchPaged, parseRange, PROXY,
    stripHtml, isCodeDump, looksLikeErrorPage, isUsableText, BAD_PAGE,
    findFileCandidates, sniffBytes, fetchBinary, fetchOriginal, diagnoseGrab
  };
})(window);
