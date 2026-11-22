/* ══════════════════════════════════════════════════════
   pdfout.js — 零依赖 PDF 生成器
   直接把 JPEG 帧作为 DCTDecode XObject 嵌入，体积最小
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const PAGES = {
    a4: [595.28, 841.89],
    letter: [612, 792]
  };

  function u8cat(list) {
    let n = 0; list.forEach((x) => { n += x.length; });
    const out = new Uint8Array(n);
    let o = 0;
    list.forEach((x) => { out.set(x, o); o += x.length; });
    return out;
  }

  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof x === 'string') return new TextEncoder().encode(x);
    return new TextEncoder().encode(String(x));
  }

  /** PDF 字符串字面量：纯 ASCII 用 (escaped)，含中文转 <FEFF...> UTF-16BE 十六进制串 */
  function pdfStr(s) {
    const str = String(s == null ? '' : s);
    if (/^[\x20-\x7e]*$/.test(str)) return '(' + str.replace(/[()\\]/g, '\\$&') + ')';
    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) {
      hex += str.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    }
    return '<' + hex + '>';
  }
  const pad = (n, w) => String(n).padStart(w, '0');

  /**
   * @param {{pages:{jpeg:Uint8Array,w:number,h:number}[], pageSize?:string, marginMM?:number, title?:string}} opt
   * @returns {Uint8Array}
   */
  function build(opt) {
    const pages = opt.pages || [];
    if (!pages.length) throw new Error('没有可写入的页面');
    const pageSize = opt.pageSize || 'fit';
    const margin = (Number(opt.marginMM) || 0) * 72 / 25.4;
    const enc = new TextEncoder();

    const objects = [];   // objects[n] = Uint8Array（不含 "n 0 obj" 包装）
    const obj = (n, body) => { objects[n] = toBytes(body); };

    // 分配对象号：1 catalog, 2 pages, 每页 3 个
    const pageObjNums = [];
    pages.forEach((_, i) => {
      const base = 3 + i * 3;
      pageObjNums.push({ page: base, image: base + 1, content: base + 2 });
    });
    let total = 2 + pages.length * 3;

    const kids = pageObjNums.map((p) => p.page + ' 0 R').join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');

    pages.forEach((pg, i) => {
      const nums = pageObjNums[i];
      let pw, ph, iw, ih, dx, dy;

      if (pageSize === 'fit') {
        // 以 96dpi 为参考换算成 pt，页边距仍然生效
        pw = pg.w * 72 / 96 + margin * 2;
        ph = pg.h * 72 / 96 + margin * 2;
        iw = pg.w * 72 / 96;
        ih = pg.h * 72 / 96;
        dx = margin;
        dy = margin;
      } else {
        const [w0, h0] = PAGES[pageSize] || PAGES.a4;
        pw = w0; ph = h0;
        const availW = Math.max(1, pw - margin * 2);
        const availH = Math.max(1, ph - margin * 2);
        const k = Math.min(availW / pg.w, availH / pg.h);
        iw = pg.w * k; ih = pg.h * k;
        dx = (pw - iw) / 2;
        dy = (ph - ih) / 2;
      }

      obj(nums.page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
        pw.toFixed(2) + ' ' + ph.toFixed(2) + '] /Resources << /XObject << /Im0 ' +
        (nums.image) + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + nums.content + ' 0 R >>');

      const imgHeader = enc.encode('<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpeg.length + ' >>\nstream\n');
      objects[nums.image] = u8cat([imgHeader, pg.jpeg, enc.encode('\nendstream')]);

      const content = 'q\n' + iw.toFixed(3) + ' 0 0 ' + ih.toFixed(3) + ' ' +
        dx.toFixed(3) + ' ' + dy.toFixed(3) + ' cm\n/Im0 Do\nQ\n';
      const cBytes = enc.encode(content);
      objects[nums.content] = u8cat([
        enc.encode('<< /Length ' + cBytes.length + ' >>\nstream\n'),
        cBytes,
        enc.encode('endstream')
      ]);
    });

    // 序列化
    const chunks = [];
    let offset = 0;
    const offsets = new Array(objects.length).fill(0);
    const push = (x) => { const b = toBytes(x); chunks.push(b); offset += b.length; };

    push('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');
    const infoNum = total + 1;
    for (let n = 1; n <= total; n++) {
      offsets[n] = offset;
      push(n + ' 0 obj\n');
      push(objects[n] || '<< >>');
      push('\nendobj\n');
    }
    // Info
    offsets[infoNum] = offset;
    const title = String(opt.title || '泛式');
    push(infoNum + ' 0 obj\n<< /Producer ' + pdfStr('泛式') + ' /Title ' + pdfStr(title) +
      ' /Creator ' + pdfStr('泛式') + ' >>\nendobj\n');

    const size = infoNum + 1;
    const xrefStart = offset;
    let xref = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (let n = 1; n < size; n++) {
      xref += pad(offsets[n] || 0, 10) + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + size + ' /Root 1 0 R /Info ' + infoNum + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');

    return u8cat(chunks);
  }

  /** canvas → JPEG 字节（供文本 PDF / 图片 PDF 复用） */
  async function canvasToJpeg(canvas, quality) {
    const blob = await new Promise((res, rej) => {
      canvas.toBlob((b) => b ? res(b) : rej(new Error('canvas 编码失败')), 'image/jpeg', quality || 0.92);
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** 把任意图片文件统一转成 JPEG 帧 */
  async function imageFileToFrame(file, maxEdge) {
    const { img, url } = await FS.loadImage(file);
    try {
      let w = img.naturalWidth, h = img.naturalHeight;
      const M = maxEdge || 2400;
      if (Math.max(w, h) > M) {
        const k = M / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, w, h);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, w, h);
      const jpeg = await canvasToJpeg(c, 0.9);
      return { jpeg, w, h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  global.PDFOut = { build, canvasToJpeg, imageFileToFrame, PAGES };
})(window);
