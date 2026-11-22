/* ══════════════════════════════════════════════════════
   docx.js — Word(.docx) 转 PDF
   docx 本质是 ZIP + OOXML：解压 → 解析 document.xml → Canvas 排版 → PDF
   零依赖：ZIP 用 DecompressionStream，排版用 Canvas，输出用 PDFOut
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const FONT = '"PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",system-ui,sans-serif';
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

  /* ── ZIP 读取 ────────────────────────────────── */
  function findEOCD(dv, len) {
    const stop = Math.max(0, len - 65558);
    for (let i = len - 22; i >= stop; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function readZipIndex(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const eocd = findEOCD(dv, u8.length);
    if (eocd < 0) throw new Error('不是有效的 ZIP 容器（找不到目录结尾）');
    const total = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const files = new Map();
    const dec = new TextDecoder();
    for (let i = 0; i < total; i++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
      if (localOff + 30 <= u8.length) {
        const lnLen = dv.getUint16(localOff + 26, true);
        const leLen = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lnLen + leLen;
        files.set(name, { method, raw: u8.subarray(start, start + compSize) });
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  async function readEntry(files, name) {
    const e = files.get(name);
    if (!e) return null;
    if (e.method === 0 || e.method === undefined) return e.raw;
    if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持 DecompressionStream，无法解压 docx');
    const stream = new Blob([e.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readXml(files, name) {
    const bytes = await readEntry(files, name);
    if (!bytes) return null;
    return new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml');
  }

  /* ── 样式 ────────────────────────────────────── */
  const HEADING = {
    title: { size: 24, bold: true, align: 'center', before: 0, after: 14 },
    heading1: { size: 19, bold: true, before: 16, after: 8 },
    heading2: { size: 16, bold: true, before: 13, after: 6 },
    heading3: { size: 14, bold: true, before: 10, after: 5 },
    heading4: { size: 12.5, bold: true, before: 8, after: 4 }
  };

  function headingOf(styleId) {
    if (!styleId) return null;
    const s = String(styleId).toLowerCase();
    if (s === 'title' || s === '标题') return HEADING.title;
    const m = /^(?:heading|标题)\s*([1-6])$/.exec(s);
    if (m) return HEADING['heading' + Math.min(4, parseInt(m[1], 10))] || null;
    return null;
  }

  function attr(el, name) {
    if (!el) return null;
    return el.getAttribute('w:' + name) || el.getAttribute(name) || el.getAttributeNS(null, name);
  }

  function wChild(el, name) {
    if (!el) return null;
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].localName === name) return el.children[i];
    }
    return null;
  }

  function wChildren(el, name) {
    const out = [];
    if (!el) return out;
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].localName === name) out.push(el.children[i]);
    }
    return out;
  }

  const TWIP = 20;          // 1pt = 20 twips
  const HALF_PT = 2;

  function num(v, dflt) {
    const n = parseFloat(v);
    return isNaN(n) ? (dflt || 0) : n;
  }

  function parseRuns(p, rels) {
    const runs = [];
    for (const r of wChildren(p, 'r')) {
      const rPr = wChild(r, 'rPr');
      const st = { bold: false, italic: false, underline: false, size: 0, color: '', strike: false };
      if (rPr) {
        const b = wChild(rPr, 'b');
        if (b && attr(b, 'val') !== '0' && attr(b, 'val') !== 'false') st.bold = true;
        const i = wChild(rPr, 'i');
        if (i && attr(i, 'val') !== '0' && attr(i, 'val') !== 'false') st.italic = true;
        const u = wChild(rPr, 'u');
        if (u && attr(u, 'val') !== 'none') st.underline = true;
        const strike = wChild(rPr, 'strike');
        if (strike && attr(strike, 'val') !== '0') st.strike = true;
        const sz = wChild(rPr, 'sz');
        if (sz) st.size = num(attr(sz, 'val'), 0) / HALF_PT;
        const color = wChild(rPr, 'color');
        if (color) {
          const v = attr(color, 'val');
          if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) st.color = '#' + v;
        }
      }
      let text = '';
      for (let ci = 0; ci < r.children.length; ci++) {
        const c = r.children[ci];
        if (c.localName === 't') text += c.textContent;
        else if (c.localName === 'br') text += '\n';
        else if (c.localName === 'tab') text += '\t';
        else if (c.localName === 'drawing' || c.localName === 'pict') {
          const blips = c.getElementsByTagNameNS(NS_A, 'blip');
          let embed = blips.length ? blips[0].getAttribute('r:embed') : null;
          if (!embed) {
            const imgs = c.getElementsByTagName('v:imagedata');
            if (imgs.length) embed = imgs[0].getAttribute('r:id');
          }
          if (embed && rels[embed]) runs.push({ image: rels[embed] });
        }
      }
      if (text) runs.push(Object.assign({ text }, st));
    }
    return runs;
  }

  function parseParagraph(p, rels, baseSize) {
    const pPr = wChild(p, 'pPr');
    const block = { type: 'p', align: '', indent: 0, before: 0, after: 0, style: '', size: 0, runs: [] };

    if (pPr) {
      const jc = wChild(pPr, 'jc');
      if (jc) block.align = attr(jc, 'val') || '';
      const ps = wChild(pPr, 'pStyle');
      if (ps) block.style = attr(ps, 'val') || '';
      const ind = wChild(pPr, 'ind');
      if (ind) block.indent = num(attr(ind, 'left') || attr(ind, 'start') || attr(ind, 'firstLine'), 0) / TWIP;
      const sp = wChild(pPr, 'spacing');
      if (sp) {
        block.before = num(attr(sp, 'before'), 0) / TWIP;
        block.after = num(attr(sp, 'after'), 0) / TWIP;
      }
      if (wChild(pPr, 'numPr')) block.bullet = true;
    }

    const h = headingOf(block.style);
    if (h) {
      block.size = h.size;
      block.bold = true;
      if (!block.align && h.align) block.align = h.align;
      if (!block.before) block.before = h.before;
      if (!block.after) block.after = h.after;
    }

    block.runs = parseRuns(p, rels);
    if (block.bullet && block.runs.length) {
      // 列表项：加项目符号 + 悬挂缩进
      block.runs[0].text = '\u2022  ' + block.runs[0].text;
      block.indent = (block.indent || 0) + 14;
    }
    return block;
  }

  function parseTable(tbl, rels) {
    const rows = [];
    for (const tr of wChildren(tbl, 'tr')) {
      const cells = [];
      for (const tc of wChildren(tr, 'tc')) {
        const parts = [];
        for (const p of wChildren(tc, 'p')) {
          const runs = parseRuns(p, rels);
          parts.push(runs.map((r) => r.text || '').join(''));
        }
        cells.push(parts.join(' ').trim());
      }
      if (cells.length) rows.push(cells);
    }
    return { type: 'tbl', rows };
  }

  function parseRels(xml) {
    const rels = {};
    if (!xml) return rels;
    const list = xml.getElementsByTagName('Relationship');
    for (let i = 0; i < list.length; i++) {
      const id = list[i].getAttribute('Id');
      const target = list[i].getAttribute('Target');
      if (id && target) rels[id] = target.replace(/^\.\.\//, '');
    }
    return rels;
  }

  async function parseDocx(u8) {
    const files = readZipIndex(u8);
    const docXml = await readXml(files, 'word/document.xml');
    if (!docXml) throw new Error('docx 里找不到 word/document.xml');

    const relsXml = await readXml(files, 'word/_rels/document.xml.rels');
    const rels = parseRels(relsXml);

    const body = docXml.getElementsByTagName('w:body')[0] || docXml.documentElement;
    const blocks = [];
    for (let i = 0; i < body.children.length; i++) {
      const el = body.children[i];
      if (el.localName === 'p') {
        const b = parseParagraph(el, rels, 12);
        if (b.runs.length) blocks.push(b);
      } else if (el.localName === 'tbl') {
        const t = parseTable(el, rels);
        if (t.rows.length) blocks.push(t);
      }
    }

    // 收集图片
    const media = new Map();
    const wanted = new Set();
    blocks.forEach((b) => {
      if (b.type !== 'p') return;
      b.runs.forEach((r) => { if (r.image) wanted.add(r.image); });
    });
    for (const target of wanted) {
      const path = target.indexOf('/') === 0 ? target.slice(1) : 'word/' + target;
      const bytes = await readEntry(files, path);
      if (bytes) media.set(target, bytes);
    }
    return { blocks, media };
  }

  /* ── 排版引擎 ────────────────────────────────── */
  const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };

  function tokensOf(text) {
    return text.match(/[A-Za-z0-9]+|[^\s]|\s+/g) || [];
  }

  function styleKey(r) {
    return [r.size || 0, r.bold ? 1 : 0, r.italic ? 1 : 0, r.underline ? 1 : 0, r.strike ? 1 : 0, r.color || ''].join('|');
  }

  function fontOf(r, base) {
    const size = r.size || base;
    return (r.italic ? 'italic ' : '') + (r.bold ? '700' : '400') + ' ' + size.toFixed(2) + 'px ' + FONT;
  }

  /**
   * 把 blocks 排成页：每页是绘制指令数组
   */
  function layout(blocks, opt) {
    const pw = PAGE[opt.pageSize] ? PAGE[opt.pageSize][0] : PAGE.a4[0];
    const ph = PAGE[opt.pageSize] ? PAGE[opt.pageSize][1] : PAGE.a4[1];
    const margin = opt.margin;
    const maxW = pw - margin * 2;
    const base = opt.fontSize;
    const lineFactor = 1.55;

    const meas = document.createElement('canvas').getContext('2d');
    const pages = [[]];
    let y = margin;

    const newPage = () => { pages.push([]); y = margin; };
    const ensure = (h) => { if (y + h > ph - margin) newPage(); };

    for (const b of blocks) {
      if (b.type === 'tbl') {
        for (const row of b.rows) {
          const text = row.join('   │   ');
          const r = { size: base * 0.95 };
          meas.font = fontOf(r, base);
          const lines = wrapText(meas, text, maxW);
          ensure(lines.length * base * lineFactor + 4);
          lines.forEach((ln) => {
            if (y + base * lineFactor > ph - margin) newPage();
            pages[pages.length - 1].push({ kind: 'text', x: margin, y, text: ln, style: r, base, pw, maxW, align: 'left', lineH: base * lineFactor });
            y += base * lineFactor;
          });
          y += 3;
        }
        y += 6;
        continue;
      }

      const spaceBefore = b.before || 0;
      const spaceAfter = b.after == null ? 6 : b.after;
      if (y > margin) y += spaceBefore;

      // 逐 run 断行
      let lineItems = [];
      let lineW = 0;
      let lineH = 0;

      const flush = () => {
        if (!lineItems.length) return;
        if (y + lineH > ph - margin) newPage();
        pages[pages.length - 1].push({
          kind: 'line', x: margin + (b.indent || 0), y,
          items: lineItems, width: lineW, height: lineH,
          align: b.align || 'left', maxW: maxW - (b.indent || 0), base
        });
        y += lineH;
        lineItems = [];
        lineW = 0;
        lineH = 0;
      };

      for (const r of b.runs) {
        if (r.image) {
          flush();
          const bytes = opt.media.get(r.image);
          const dim = opt.imageDims.get(r.image) || { w: 400, h: 300 };
          if (bytes) {
            let iw = dim.w, ih = dim.h;
            if (iw > maxW) { ih = ih * (maxW / iw); iw = maxW; }
            if (ih > ph - margin * 2) { iw = iw * ((ph - margin * 2) / ih); ih = ph - margin * 2; }
            if (y + ih > ph - margin) newPage();
            pages[pages.length - 1].push({ kind: 'image', x: margin + (maxW - iw) / 2, y, w: iw, h: ih, bytes });
            y += ih + 6;
          }
          continue;
        }

        const st = {
          size: r.size || b.size || base,
          bold: r.bold || b.bold || false,
          italic: r.italic,
          underline: r.underline,
          strike: r.strike,
          color: r.color || ''
        };
        meas.font = fontOf(st, base);
        const key = styleKey(st);

        for (const tk of tokensOf(r.text)) {
          if (tk === '\n') { flush(); continue; }
          if (tk === '\t') { const w = meas.measureText('    ').width; lineW += w; lineItems.push({ text: '', width: w, style: key, st }); continue; }
          const w = meas.measureText(tk).width;
          if (lineW + w > maxW - (b.indent || 0) && lineItems.length && tk.trim()) flush();
          const last = lineItems[lineItems.length - 1];
          if (last && last.style === key && last.text) { last.text += tk; last.width += w; }
          else lineItems.push({ text: tk, width: w, style: key, st });
          lineW += w;
          lineH = Math.max(lineH, st.size * lineFactor);
        }
      }
      flush();
      y += spaceAfter;
    }
    return { pages, pw, ph, margin };
  }

  function wrapText(ctx, text, maxW) {
    const out = [];
    let cur = '';
    for (const tk of tokensOf(text)) {
      const t = cur + tk;
      if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = tk.trim() ? tk : ''; }
      else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  }

  /* ── 绘制并生成 PDF ──────────────────────────── */
  async function toPdf(file, options) {
    const opt = Object.assign({ pageSize: 'a4', margin: 56, fontSize: 11, scale: 2 }, options || {});
    const u8 = new Uint8Array(await file.arrayBuffer());
    const doc = await parseDocx(u8);
    if (!doc.blocks.length) throw new Error('docx 里没有可渲染的内容');

    // 图片尺寸 + 位图
    const imageDims = new Map();
    const imageBitmaps = new Map();
    for (const [name, bytes] of doc.media) {
      const blob = new Blob([bytes]);
      try {
        const bmp = await createImageBitmap(blob);
        imageDims.set(name, { w: bmp.width, h: bmp.height });
        imageBitmaps.set(name, bmp);
      } catch (e) { /* 不支持的图片格式，跳过 */ }
    }

    const laid = layout(doc.blocks, {
      pageSize: opt.pageSize, margin: opt.margin, fontSize: opt.fontSize,
      media: doc.media, imageDims
    });

    const S = opt.scale;
    const frames = [];
    for (let pi = 0; pi < laid.pages.length; pi++) {
      const ops = laid.pages[pi];
      const c = document.createElement('canvas');
      c.width = Math.round(laid.pw * S);
      c.height = Math.round(laid.ph * S);
      const ctx = c.getContext('2d');
      ctx.scale(S, S);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, laid.pw, laid.ph);
      ctx.textBaseline = 'top';

      for (const op of ops) {
        if (op.kind === 'image') {
          const bmp = imageBitmaps.get(Array.from(doc.media.keys()).find((k) => doc.media.get(k) === op.bytes));
          if (bmp) {
            ctx.drawImage(bmp, op.x, op.y, op.w, op.h);
          }
          continue;
        }
        if (op.kind === 'text') {
          ctx.font = fontOf(op.style, op.base);
          ctx.fillStyle = op.style.color || '#15171a';
          ctx.fillText(op.text, op.x, op.y + (op.lineH - op.style.size) / 2);
          continue;
        }
        // line
        let x = op.x;
        if (op.align === 'center') x = op.x + (op.maxW - op.width) / 2;
        else if (op.align === 'right') x = op.x + (op.maxW - op.width);
        for (const it of op.items) {
          if (!it.text) { x += it.width; continue; }
          ctx.font = fontOf(it.st, op.base);
          ctx.fillStyle = it.st.color || '#15171a';
          const baseY = op.y + (op.height - it.st.size) / 2;
          ctx.fillText(it.text, x, baseY);
          if (it.st.underline) {
            const uw = ctx.measureText(it.text).width;
            ctx.fillRect(x, baseY + it.st.size * 1.08, uw, Math.max(0.6, it.st.size * 0.06));
          }
          if (it.st.strike) {
            const uw = ctx.measureText(it.text).width;
            ctx.fillRect(x, baseY + it.st.size * 0.55, uw, Math.max(0.6, it.st.size * 0.06));
          }
          x += it.width;
        }
      }

      if (opt.onPage) { try { opt.onPage(c, pi); } catch (e) { /* 预览回调失败不影响导出 */ } }
      const jpeg = await PDFOut.canvasToJpeg(c, 0.92);
      frames.push({ jpeg, w: c.width, h: c.height });
      c.width = c.height = 0;
      if (opt.onProgress) opt.onProgress(pi + 1, laid.pages.length);
      await new Promise((r) => setTimeout(r, 0));
    }

    return PDFOut.build({
      pages: frames,
      pageSize: opt.pageSize,
      marginMM: 0,
      title: (file.name || 'document').replace(/\.docx?$/i, '')
    });
  }

  global.DOCX = { toPdf, parseDocx, readZipIndex, PAGE };
})(window);
