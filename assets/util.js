/* ══════════════════════════════════════════════════════
   util.js — 通用工具层：DOM / 下载 / ZIP / WAV / 并发 / 嗅探
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ── 格式化 ─────────────────────────────────── */
  function bytes(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1, v = n;
    do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
    return v.toFixed(v < 10 ? 2 : 1) + ' ' + u[i];
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function delta(from, to) {
    if (!from || !to) return '';
    const d = ((to - from) / from) * 100;
    const s = d >= 0 ? '+' : '';
    return s + d.toFixed(1) + '%';
  }
  function safeName(name, fallback) {
    const n = (name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/^\.+/, '').trim();
    return n || fallback || 'untitled';
  }
  function baseName(name) { return (name || '').replace(/\.[^.]+$/, ''); }
  function extName(name) { const m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function stamp() {
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ── Toast ──────────────────────────────────── */
  function toast(msg, kind, ms) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    box.appendChild(el);
    const life = ms || (kind === 'err' ? 5200 : 3000);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, life);
    return el;
  }

  /* ── 下载 ───────────────────────────────────── */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return url;
  }
  const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', gif: 'image/gif',
    mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', aac: 'audio/aac', pdf: 'application/pdf',
    txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8',
    json: 'application/json', zip: 'application/zip'
  };
  function mimeOf(ext) { return MIME[String(ext).toLowerCase()] || 'application/octet-stream'; }
  function blobOf(data, ext, type) {
    const part = (data instanceof Uint8Array) ? [data] : [data];
    return new Blob(part, { type: type || mimeOf(ext) });
  }

  /* ── CRC32 + ZIP (STORE) ────────────────────── */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /**
   * 极简 ZIP 打包（仅 STORE 存储，无压缩）——浏览器端零依赖
   * @param {{name:string,data:Uint8Array}[]} files
   */
  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    files.forEach((f) => {
      const nameBuf = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // UTF-8 flag
      lh.setUint16(8, 0, true);           // store
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBuf.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), nameBuf, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBuf.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBuf);

      offset += 30 + nameBuf.length + data.length;
    });

    let cdSize = 0;
    central.forEach((c) => { cdSize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  /* ── WAV 编码器（16/24bit PCM） ───────────────── */
  function encodeWav(channelData, sampleRate, bits) {
    const chs = channelData.length;
    const frames = channelData[0].length;
    const bytesPer = bits === 24 ? 3 : 2;
    const blockAlign = chs * bytesPer;
    const dataSize = frames * blockAlign;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, chs, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * blockAlign, true);
    v.setUint16(32, blockAlign, true); v.setUint16(34, bits, true);
    ws(36, 'data'); v.setUint32(40, dataSize, true);

    let o = 44;
    const clamp = (x) => Math.max(-1, Math.min(1, x));
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < chs; c++) {
        const s = clamp(channelData[c][i]);
        if (bits === 24) {
          const val = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);
          v.setUint8(o, val & 0xFF);
          v.setUint8(o + 1, (val >> 8) & 0xFF);
          v.setUint8(o + 2, (val >> 16) & 0xFF);
          o += 3;
        } else {
          const val = Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF);
          v.setInt16(o, val, true); o += 2;
        }
      }
    }
    return new Uint8Array(buf);
  }

  /* ── 文件嗅探 ───────────────────────────────── */
  function sniff(u8) {
    if (!u8 || u8.length < 12) return { kind: 'unknown' };
    const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]); return s; };
    if (str(0, 3) === 'ID3') return { kind: 'audio', ext: 'mp3', note: 'ID3v2' };
    if (u8[0] === 0xFF && (u8[1] & 0xE0) === 0xE0) return { kind: 'audio', ext: 'mp3', note: 'MPEG frame' };
    if (str(0, 4) === 'fLaC') return { kind: 'audio', ext: 'flac', note: 'FLAC' };
    if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') return { kind: 'audio', ext: 'wav' };
    if (str(0, 4) === 'OggS') return { kind: 'audio', ext: 'ogg' };
    if (str(4, 4) === 'ftyp') return { kind: 'audio', ext: 'm4a', note: 'MP4 container' };
    if (str(0, 4) === '%PDF') return { kind: 'doc', ext: 'pdf' };
    if (u8[0] === 0x89 && str(1, 3) === 'PNG') return { kind: 'image', ext: 'png' };
    if (u8[0] === 0xFF && u8[1] === 0xD8) return { kind: 'image', ext: 'jpg' };
    if (str(0, 4) === 'GIF8') return { kind: 'image', ext: 'gif' };
    if (str(0, 2) === 'BM') return { kind: 'image', ext: 'bmp' };
    if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return { kind: 'image', ext: 'webp' };
    if (u8[4] === 0x66 && str(8, 4) === 'avif') return { kind: 'image', ext: 'avif' };
    if (str(0, 17) === 'neteasecloudmusic') return { kind: 'ncm', ext: 'ncm', note: 'NCM' };
    if (str(0, 8) === 'CTENFDAM') return { kind: 'ncm', ext: 'ncm', note: 'NCM v2' };
    return { kind: 'unknown' };
  }

  /* ── 并发池 ─────────────────────────────────── */
  async function pool(items, limit, worker, onTick) {
    const results = new Array(items.length);
    let idx = 0, done = 0;
    const n = Math.max(1, Math.min(limit || 1, items.length || 1));
    async function run() {
      while (idx < items.length) {
        const i = idx++;
        try { results[i] = await worker(items[i], i); }
        catch (e) { results[i] = { __error: e && e.message ? e.message : String(e) }; }
        done++;
        if (onTick) onTick(done, items.length, results[i]);
      }
    }
    await Promise.all(Array.from({ length: n }, run));
    return results;
  }

  /* ── 文件读取 ───────────────────────────────── */
  function readAsArrayBuffer(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(new Uint8Array(fr.result));
      fr.onerror = () => rej(new Error('读取失败：' + file.name));
      fr.readAsArrayBuffer(file);
    });
  }
  function readAsText(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error('读取失败：' + file.name));
      fr.readAsText(file, 'utf-8');
    });
  }
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res({ img, url }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('无法解码图片：' + file.name)); };
      img.src = url;
    });
  }

  /* ── 文本 → PDF 用的行切分（中英混排） ───────── */
  function wrapText(ctx, text, maxWidth) {
    const out = [];
    const paras = String(text).split(/\r?\n/);
    for (const p of paras) {
      if (!p.trim()) { out.push(''); continue; }
      let line = '';
      for (const ch of p) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = ch; }
        else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  }

  function debounce(fn, ms) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms || 120); };
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  global.FS = {
    $, $$, bytes, pct, delta, safeName, baseName, extName, stamp,
    toast, downloadBlob, blobOf, mimeOf, MIME,
    crc32, zip, encodeWav, sniff,
    pool, readAsArrayBuffer, readAsText, loadImage, wrapText,
    debounce, sleep, el
  };
})(window);
