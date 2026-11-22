/* ══════════════════════════════════════════════════════
   image.js — 图片转换引擎（Canvas + 自研 BMP / ICO 编码）
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const OPAQUE = ['image/jpeg', 'image/bmp'];

  let support = null;
  /** 探测当前浏览器可编码的格式 */
  function detect() {
    if (support) return support;
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7aa2ff'; ctx.fillRect(0, 0, 2, 2);
    const can = (type) => {
      try {
        const url = c.toDataURL(type);
        return url.indexOf('data:' + type) === 0 && url.length > 64;
      } catch (e) { return false; }
    };
    support = {
      'image/png': true,
      'image/jpeg': true,
      'image/webp': can('image/webp'),
      'image/avif': can('image/avif'),
      'image/bmp': true,
      'image/x-icon': true,
      'image/gif': false
    };
    return support;
  }

  function extOf(mime) {
    return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
      'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/gif': 'gif' })[mime] || 'bin';
  }

  /** 24 位 BMP 编码 */
  function encodeBMP(imageData) {
    const { width: w, height: h, data } = imageData;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const pixelSize = rowSize * h;
    const fileSize = 54 + pixelSize;
    const buf = new ArrayBuffer(fileSize);
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    u8[0] = 0x42; u8[1] = 0x4D;
    v.setUint32(2, fileSize, true);
    v.setUint32(10, 54, true);
    v.setUint32(14, 40, true);
    v.setInt32(18, w, true);
    v.setInt32(22, h, true);
    v.setUint16(26, 1, true);
    v.setUint16(28, 24, true);
    v.setUint32(34, pixelSize, true);
    v.setUint32(38, 2835, true);
    v.setUint32(42, 2835, true);
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = 54 + y * rowSize;
      for (let x = 0; x < w; x++) {
        const s = srcRow + x * 4;
        const d = dstRow + x * 3;
        u8[d] = data[s + 2];     // B
        u8[d + 1] = data[s + 1]; // G
        u8[d + 2] = data[s];     // R
      }
    }
    return new Uint8Array(buf);
  }

  /** ICO 容器（内嵌 PNG 帧，Vista+ 通用） */
  function wrapICO(pngBytes, w, h) {
    const out = new Uint8Array(6 + 16 + pngBytes.length);
    const v = new DataView(out.buffer);
    v.setUint16(0, 0, true);
    v.setUint16(2, 1, true);
    v.setUint16(4, 1, true);
    out[6] = w >= 256 ? 0 : w;
    out[7] = h >= 256 ? 0 : h;
    out[8] = 0; out[9] = 0;
    v.setUint16(10, 1, true);
    v.setUint16(12, 32, true);
    v.setUint32(14, pngBytes.length, true);
    v.setUint32(18, 22, true);
    out.set(pngBytes, 22);
    return out;
  }

  /** canvas → Blob，toBlob 静默失败时回退到 toDataURL（部分无 GPU 环境 toBlob 不回调） */
  function toBlobAsync(canvas, type, quality) {
    return new Promise((res, rej) => {
      let done = false;
      let timer = null;
      const finish = (b) => { if (done) return; done = true; clearTimeout(timer); res(b); };
      const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); rej(new Error(msg)); };
      const fromDataURL = () => {
        if (done) return;
        try {
          const d = canvas.toDataURL(type, quality);
          if (d.indexOf('data:' + type) !== 0) { fail('当前环境无法编码 ' + type); return; }
          const bin = atob(d.slice(d.indexOf(',') + 1));
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          finish(new Blob([u8], { type }));
        } catch (e) { fail('编码失败：' + type + ' · ' + (e.message || e)); }
      };
      timer = setTimeout(fromDataURL, 15000);
      try {
        if (canvas.toBlob) {
          canvas.toBlob((b) => { if (b) finish(b); else fromDataURL(); }, type, quality);
        } else {
          fromDataURL();
        }
      } catch (e) { fromDataURL(); }
    });
  }

  async function blobToU8(blob) { return new Uint8Array(await blob.arrayBuffer()); }

  /**
   * 单图转换
   * @param {File} file
   * @param {{mime:string,quality:number,maxEdge:number,bg:string,keepName:boolean}} opt
   */
  async function convert(file, opt) {
    const mime = opt.mime || 'image/png';
    const quality = Math.min(1, Math.max(0.05, (opt.quality || 92) / 100));
    const { img, url } = await FS.loadImage(file);
    try {
      const ow = img.naturalWidth || img.width;
      const oh = img.naturalHeight || img.height;
      const maxEdge = Number(opt.maxEdge) || 0;
      let w = ow, h = oh;
      if (maxEdge > 0 && Math.max(ow, oh) > maxEdge) {
        const k = maxEdge / Math.max(ow, oh);
        w = Math.max(1, Math.round(ow * k));
        h = Math.max(1, Math.round(oh * k));
      }
      // 超大图限制以防内存爆掉
      const LIMIT = 12000;
      if (Math.max(w, h) > LIMIT) {
        const k = LIMIT / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: !OPAQUE.includes(mime) });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (OPAQUE.includes(mime)) {
        ctx.fillStyle = opt.bg || '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      // ICO 边长上限 256
      if (mime === 'image/x-icon') {
        const k = Math.min(1, 256 / Math.max(w, h));
        if (k < 1) { canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k)); }
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let bytes, ext = extOf(mime), outType = mime;
      if (mime === 'image/bmp') {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        bytes = encodeBMP(data);
        outType = 'image/bmp';
      } else if (mime === 'image/x-icon') {
        const png = await toBlobAsync(canvas, 'image/png', 1);
        bytes = wrapICO(await blobToU8(png), canvas.width, canvas.height);
        outType = 'image/x-icon';
      } else {
        const blob = await toBlobAsync(canvas, mime, quality);
        bytes = await blobToU8(blob);
        if (mime === 'image/jpeg' && bytes[0] !== 0xFF) throw new Error('JPEG 编码异常');
      }

      const name = opt.keepName !== false
        ? FS.safeName(FS.baseName(file.name), 'image') + '.' + ext
        : FS.safeName(file.name, 'image').replace(/\.[^.]+$/, '') + '_' + Date.now() + '.' + ext;

      return {
        bytes, ext, mime: outType, name,
        width: canvas.width, height: canvas.height,
        srcWidth: ow, srcHeight: oh,
        srcSize: file.size, size: bytes.length
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** 生成队列缩略图，返回 Blob URL（比 dataURL 省内存，浏览器只解码一次） */
  function thumbnailUrl(file, max) {
    const M = max || 72;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, M / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k));
        c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'low';       // 缩略图不需要高质量插值
        x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => {
          c.width = c.height = 0;
          if (b) resolve(URL.createObjectURL(b));
          else reject(new Error('缩略图生成失败'));
        }, 'image/jpeg', 0.68);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('缩略图解码失败')); };
      img.src = url;
    });
  }

  /** 生成用于队列的缩略图（最大 96px 的 dataURL，保留兼容） */
  async function thumbnail(file, max) {
    try { return await thumbnailUrl(file, max || 96); } catch (e) { return ''; }
  }

  global.IMG = { convert, detect, thumbnail, thumbnailUrl, encodeBMP, wrapICO, extOf };
})(window);
