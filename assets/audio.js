/* ══════════════════════════════════════════════════════
   audio.js — 音频解码 / 重采样 / WAV & MP3 编码 / 标签解析
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  let ac = null;
  function ctx() {
    if (!ac) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) throw new Error('当前环境不支持 Web Audio');
      ac = new AC();
    }
    return ac;
  }

  /* ── 元数据解析 ─────────────────────────────── */
  function parseID3(u8) {
    const out = { title: '', artist: '', album: '', cover: null, tags: {} };
    if (!u8 || u8.length < 10) return out;
    if (!(u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33)) return out;
    const ver = u8[3];
    const flags = u8[5];
    const size = (u8[6] << 21) | (u8[7] << 14) | (u8[8] << 7) | u8[9];
    let p = 10;
    if (flags & 0x40) { // extended header
      const ext = (u8[10] << 24) | (u8[11] << 16) | (u8[12] << 8) | u8[13];
      p += 4 + (ver >= 4 ? ext : ext + 4);
    }
    const end = Math.min(10 + size, u8.length);
    const readSize = (o) => ver >= 4
      ? ((u8[o] << 21) | (u8[o + 1] << 14) | (u8[o + 2] << 7) | u8[o + 3])
      : ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]);
    const dec = (u8s, encoding) => {
      try {
        if (encoding === 0) return new TextDecoder('iso-8859-1').decode(u8s);
        if (encoding === 1) return new TextDecoder('utf-16').decode(u8s);
        if (encoding === 2) return new TextDecoder('utf-16be').decode(u8s);
        return new TextDecoder('utf-8').decode(u8s);
      } catch (e) { return ''; }
    };
    while (p + 10 <= end) {
      const id = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsz = readSize(p + 4);
      if (fsz <= 0 || p + 10 + fsz > end + 4) break;
      const body = u8.subarray(p + 10, p + 10 + fsz);
      if (id === 'TIT2' || id === 'TPE1' || id === 'TALB' || id === 'TPE2' || id === 'TCON') {
        const val = dec(body.subarray(1), body[0]).replace(/\u0000+$/, '').trim();
        out.tags[id] = val;
      } else if (id === 'APIC') {
        const enc0 = body[0];
        let q = 1, mime = '';
        while (q < body.length && body[q] !== 0) { mime += String.fromCharCode(body[q]); q++; }
        q++; // null
        q++; // picture type
        // description
        if (enc0 === 1 || enc0 === 2) {
          while (q + 1 < body.length && !(body[q] === 0 && body[q + 1] === 0)) q += 2;
          q += 2;
        } else {
          while (q < body.length && body[q] !== 0) q++;
          q++;
        }
        if (q < body.length) out.cover = { bytes: new Uint8Array(body.subarray(q)), mime: mime || 'image/jpeg' };
      }
      p += 10 + fsz;
    }
    out.title = out.tags.TIT2 || '';
    out.artist = out.tags.TPE1 || out.tags.TPE2 || '';
    out.album = out.tags.TALB || '';
    return out;
  }

  function parseFLAC(u8) {
    const out = { title: '', artist: '', album: '', cover: null, tags: {} };
    if (!(u8[0] === 0x66 && u8[1] === 0x4C && u8[2] === 0x61 && u8[3] === 0x43)) return out;
    let p = 4;
    const le32 = (o) => u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24);
    while (p + 4 <= u8.length) {
      const last = u8[p] & 0x80;
      const type = u8[p] & 0x7F;
      const len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
      const body = u8.subarray(p + 4, p + 4 + len);
      if (type === 4) { // Vorbis comment
        try {
          let q = 0;
          const vlen = body[q] | (body[q + 1] << 8) | (body[q + 2] << 16) | (body[q + 3] << 24);
          q += 4 + vlen;
          const cnt = body[q] | (body[q + 1] << 8) | (body[q + 2] << 16) | (body[q + 3] << 24);
          q += 4;
          const td = new TextDecoder('utf-8');
          for (let i = 0; i < cnt && q + 4 <= body.length; i++) {
            const l = body[q] | (body[q + 1] << 8) | (body[q + 2] << 16) | (body[q + 3] << 24);
            q += 4;
            const s = td.decode(body.subarray(q, q + l));
            q += l;
            const eq = s.indexOf('=');
            if (eq > 0) out.tags[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1);
          }
        } catch (e) { /* 忽略 */ }
      } else if (type === 6) { // PICTURE
        try {
          let q = 4;
          const mlen = (body[q] << 24) | (body[q + 1] << 16) | (body[q + 2] << 8) | body[q + 3];
          q += 4;
          const mime = new TextDecoder().decode(body.subarray(q, q + mlen));
          q += mlen;
          const dlen = (body[q] << 24) | (body[q + 1] << 16) | (body[q + 2] << 8) | body[q + 3];
          q += 4 + dlen;
          q += 16;
          const plen = (body[q] << 24) | (body[q + 1] << 16) | (body[q + 2] << 8) | body[q + 3];
          q += 4;
          out.cover = { bytes: new Uint8Array(body.subarray(q, q + plen)), mime: mime || 'image/jpeg' };
        } catch (e) { /* 忽略 */ }
      }
      p += 4 + len;
      if (last) break;
    }
    out.title = out.tags.TITLE || out.tags.TIT2 || '';
    out.artist = out.tags.ARTIST || out.tags.TPE1 || '';
    out.album = out.tags.ALBUM || '';
    return out;
  }

  function probe(u8, ext) {
    if (ext === 'flac' || (u8[0] === 0x66 && u8[1] === 0x4C)) return parseFLAC(u8);
    if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return parseID3(u8);
    return { title: '', artist: '', album: '', cover: null, tags: {} };
  }

  /* ── 解码 ───────────────────────────────────── */
  async function decode(arrayBuffer) {
    const c = ctx();
    const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer.slice(0) : new Uint8Array(arrayBuffer).buffer;
    return await new Promise((res, rej) => {
      const p = c.decodeAudioData(buf, res, (e) => rej(new Error('浏览器无法解码该音频（可能为无损/特殊编码）：' + (e && e.message ? e.message : 'decode error'))));
      if (p && p.then) p.then(res).catch(rej);
    });
  }

  /* ── 重采样 / 混音 ───────────────────────────── */
  async function resample(audioBuffer, sampleRate, channels) {
    const targetRate = sampleRate || audioBuffer.sampleRate;
    const ch = Math.max(1, Math.min(2, channels || audioBuffer.numberOfChannels));
    if (targetRate === audioBuffer.sampleRate && ch === audioBuffer.numberOfChannels) return audioBuffer;
    const len = Math.max(1, Math.ceil(audioBuffer.duration * targetRate));
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (OAC) {
      try {
        const off = new OAC(ch, len, targetRate);
        off.destination.channelCount = ch;
        off.destination.channelCountMode = 'explicit';
        off.destination.channelInterpretation = 'speakers';
        const src = off.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(off.destination);
        src.start(0);
        const rendered = await off.startRendering();
        if (rendered && rendered.length) return rendered;
      } catch (e) { /* 退回手写重采样 */ }
    }
    return manualResample(audioBuffer, targetRate, ch);
  }

  function manualResample(audioBuffer, targetRate, ch) {
    const srcRate = audioBuffer.sampleRate;
    const ratio = targetRate / srcRate;
    const frames = Math.max(1, Math.floor(audioBuffer.length * ratio));
    const out = [];
    for (let c = 0; c < ch; c++) {
      const srcCh = audioBuffer.getChannelData(Math.min(c, audioBuffer.numberOfChannels - 1));
      const dst = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const pos = i / ratio;
        const i0 = Math.floor(pos), i1 = Math.min(srcCh.length - 1, i0 + 1);
        const t = pos - i0;
        dst[i] = srcCh[i0] * (1 - t) + srcCh[i1] * t;
      }
      out.push(dst);
    }
    return {
      numberOfChannels: ch, sampleRate: targetRate, length: frames,
      duration: frames / targetRate,
      getChannelData: (c) => out[c]
    };
  }

  function channelsOf(audioBuffer, ch) {
    const n = ch || audioBuffer.numberOfChannels;
    const arr = [];
    for (let c = 0; c < n; c++) arr.push(audioBuffer.getChannelData(Math.min(c, audioBuffer.numberOfChannels - 1)));
    return arr;
  }

  async function toWav(arrayBuffer, opt) {
    const o = opt || {};
    let buffer = await decode(arrayBuffer);
    buffer = await resample(buffer, Number(o.sampleRate) || 44100, Number(o.channels) || 2);
    const bits = Number(o.bits) === 24 ? 24 : 16;
    return FS.encodeWav(channelsOf(buffer, buffer.numberOfChannels), buffer.sampleRate, bits);
  }

  /* ── MP3 编码（lamejs，按需加载） ─────────────── */
  let lamePromise = null;
  function loadLame() {
    if (global.lamejs) return Promise.resolve(global.lamejs);
    if (lamePromise) return lamePromise;
    const CDNS = [
      'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
      'https://unpkg.com/lamejs@1.2.1/lame.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js'
    ];
    lamePromise = new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= CDNS.length) { lamePromise = null; reject(new Error('MP3 编码器加载失败（离线环境可用 WAV）')); return; }
        const s = document.createElement('script');
        s.src = CDNS[i++];
        s.onload = () => { global.lamejs ? resolve(global.lamejs) : setTimeout(next, 60); };
        s.onerror = next;
        document.head.appendChild(s);
      };
      next();
    });
    return lamePromise;
  }

  async function toMp3(arrayBuffer, opt) {
    const o = opt || {};
    const lame = await loadLame();
    let buffer = await decode(arrayBuffer);
    const rate = Number(o.sampleRate) || 44100;
    buffer = await resample(buffer, rate, Number(o.channels) || 2);
    const kbps = Number(o.bitrate) || 320;
    const ch = buffer.numberOfChannels;
    const encoder = new lame.Mp3Encoder(ch, buffer.sampleRate, kbps);
    const left = buffer.getChannelData(0);
    const right = ch > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
    const BLOCK = 1152 * 8;
    const chunks = [];
    for (let i = 0; i < buffer.length; i += BLOCK) {
      const l = floatTo16(left.subarray(i, i + BLOCK));
      let buf;
      if (ch > 1) {
        const r = floatTo16(right.subarray(i, i + BLOCK));
        buf = encoder.encodeBuffer(l, r);
      } else {
        buf = encoder.encodeBuffer(l);
      }
      if (buf.length) chunks.push(new Uint8Array(buf));
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    return NCM.concat(chunks);
  }

  function floatTo16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  /** 生成波形预览（返回 0..1 数组） */
  async function waveform(arrayBuffer, points) {
    const buffer = await decode(arrayBuffer);
    const n = points || 120;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / n));
    const out = [];
    for (let i = 0; i < n; i++) {
      let max = 0;
      for (let j = i * step; j < Math.min((i + 1) * step, data.length); j += 16) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      out.push(max);
    }
    return out;
  }

  function duration(arrayBuffer) {
    return decode(arrayBuffer).then((b) => b.duration).catch(() => 0);
  }

  /* ═══ Ogg / Opus 编码（WebCodecs + 手写容器） ═══ */
  const OGG_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
      t[i] = r >>> 0;
    }
    return t;
  })();

  function oggCrc(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; i++) {
      crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ buf[i]) & 0xFF]) >>> 0;
    }
    return crc >>> 0;
  }

  function wU32(b, o, v) {
    b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; b[o + 2] = (v >>> 16) & 0xFF; b[o + 3] = (v >>> 24) & 0xFF;
  }

  /** 组装一个 Ogg page */
  function oggPage(headerType, granule, serial, seq, packets) {
    const segs = [];
    let bodyLen = 0;
    packets.forEach((p) => {
      let len = p.length;
      bodyLen += len;
      while (len >= 255) { segs.push(255); len -= 255; }
      segs.push(len);
    });
    const page = new Uint8Array(27 + segs.length + bodyLen);
    page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53; // 'OggS'
    page[4] = 0;                    // version
    page[5] = headerType;           // 0x02 BOS / 0x04 EOS
    const g = Math.max(0, Math.floor(granule));
    wU32(page, 6, g >>> 0);
    wU32(page, 10, 0);              // granule 高 32 位
    wU32(page, 14, serial);
    wU32(page, 18, seq);
    // 22..25 CRC 先置 0
    page[26] = segs.length;
    for (let i = 0; i < segs.length; i++) page[27 + i] = segs[i];
    let o = 27 + segs.length;
    packets.forEach((p) => { page.set(p, o); o += p.length; });
    wU32(page, 22, oggCrc(page));
    return page;
  }

  function opusHead(channels, inputRate) {
    const b = new Uint8Array(19);
    const s = 'OpusHead';
    for (let i = 0; i < 8; i++) b[i] = s.charCodeAt(i);
    b[8] = 1;                        // version
    b[9] = channels;
    b[10] = 0; b[11] = 0;            // preSkip = 0
    wU32(b, 12, inputRate);
    b[16] = 0; b[17] = 0;            // output gain
    b[18] = 0;                       // mapping family
    return b;
  }

  function opusTags(vendor) {
    const v = new TextEncoder().encode(vendor || '泛式');
    const b = new Uint8Array(8 + 4 + v.length + 4);
    const s = 'OpusTags';
    for (let i = 0; i < 8; i++) b[i] = s.charCodeAt(i);
    wU32(b, 8, v.length);
    b.set(v, 12);
    wU32(b, 12 + v.length, 0);       // 评论数 0
    return b;
  }

  function canEncodeOpus() {
    return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
  }

  /**
   * 任意音频 → Ogg Opus（离线编码，不实时录制）
   * @returns {Promise<Uint8Array>}
   */
  async function toOpus(arrayBuffer, opt) {
    const o = opt || {};
    if (!canEncodeOpus()) throw new Error('当前浏览器不支持 Opus 编码（需要 WebCodecs）');
    const RATE = 48000;                       // Opus 内部固定 48k，granule 好算
    let buf = await decode(arrayBuffer);
    buf = await resample(buf, RATE, Math.max(1, Math.min(2, Number(o.channels) || buf.numberOfChannels)));
    const ch = buf.numberOfChannels;
    const bitrate = Number(o.bitrate) || 128000;

    const chunks = [];
    let encErr = null;
    let headFromCodec = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !headFromCodec) {
          const d = meta.decoderConfig.description;
          headFromCodec = new Uint8Array(d.byteLength ? d.byteLength : d.length || 0);
          if (d.copyTo) d.copyTo(headFromCodec); else headFromCodec.set(new Uint8Array(d));
        }
        const u8 = new Uint8Array(chunk.byteLength);
        chunk.copyTo(u8);
        chunks.push(u8);
      },
      error: (e) => { encErr = e; }
    });
    enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: ch, bitrate });

    const BLOCK = 960;                        // 20ms @48k
    const planars = [];
    for (let c = 0; c < ch; c++) planars.push(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
    let encoded = 0;
    for (let i = 0; i < buf.length; i += BLOCK) {
      const n = Math.min(BLOCK, buf.length - i);
      const planar = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) planar.set(planars[c].subarray(i, i + n), c * n);
      enc.encode(new AudioData({
        format: 'f32-planar', sampleRate: RATE, numberOfFrames: n,
        numberOfChannels: ch, timestamp: Math.round((i / RATE) * 1e6), data: planar
      }));
      encoded += n;
      if (encErr) break;
      if (i % (BLOCK * 50) === 0) await new Promise((r) => setTimeout(r, 0));
    }
    try { await enc.flush(); } catch (e) { if (!encErr) encErr = e; }
    try { enc.close(); } catch (e) { /* ignore */ }
    if (encErr) throw new Error('Opus 编码失败：' + (encErr.message || encErr));
    if (!chunks.length) throw new Error('Opus 编码没有输出');

    const serial = (Math.random() * 0xFFFFFFFF) >>> 0;
    const pages = [];
    pages.push(oggPage(0x02, 0, serial, 0, [headFromCodec || opusHead(ch, RATE)]));
    pages.push(oggPage(0x00, 0, serial, 1, [opusTags('泛式')]));

    let seq = 2;
    let granule = 0;
    let i = 0;
    while (i < chunks.length) {
      // 每页最多 255 段，控制单页体积
      const group = [];
      let bytes = 0;
      while (i < chunks.length && group.length < 50 && bytes < 4000) {
        group.push(chunks[i]); bytes += chunks[i].length; i++;
      }
      granule += group.length * BLOCK;
      const isLast = i >= chunks.length;
      pages.push(oggPage(isLast ? 0x04 : 0x00, Math.min(granule, buf.length), serial, seq++, group));
    }
    return NCM.concat(pages);
  }

  /* ═══ AIFF 编码（大端 PCM，Mac 常用） ═══ */
  function encodeAiff(channels, sampleRate, bits) {
    const chs = channels.length;
    const frames = channels[0].length;
    const bytesPer = bits === 24 ? 3 : 2;
    const dataSize = frames * chs * bytesPer;
    const pad = dataSize % 2;                       // AIFF 要求偶数长度
    const total = 54 + dataSize + pad;   // FORM(8) + AIFF(4) + COMM(26) + SSND 头(16) + 数据
    const buf = new ArrayBuffer(total);
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

    ws(0, 'FORM');
    v.setUint32(4, total - 8, false);
    ws(8, 'AIFF');
    ws(12, 'COMM');
    v.setUint32(16, 18, false);
    v.setUint16(20, chs, false);
    v.setUint32(22, frames, false);
    v.setUint16(26, bits, false);
    // 80-bit IEEE 扩展精度采样率
    const e = Math.floor(Math.log2(sampleRate));
    const exp = e + 16383;
    const hi = Math.floor(sampleRate * Math.pow(2, 31 - e));
    v.setUint16(28, exp, false);
    v.setUint32(30, hi >>> 0, false);
    v.setUint32(34, 0, false);
    ws(38, 'SSND');
    v.setUint32(42, dataSize + 8 + pad, false);
    v.setUint32(46, 0, false);      // offset
    v.setUint32(50, 0, false);      // block size

    let o = 54;
    const clamp = (x) => Math.max(-1, Math.min(1, x));
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < chs; c++) {
        const s = clamp(channels[c][i]);
        if (bits === 24) {
          const val = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);
          v.setUint8(o, (val >> 16) & 0xFF);
          v.setUint8(o + 1, (val >> 8) & 0xFF);
          v.setUint8(o + 2, val & 0xFF);
          o += 3;
        } else {
          v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), false);
          o += 2;
        }
      }
    }
    return new Uint8Array(buf);
  }

  async function toAiff(arrayBuffer, opt) {
    const o = opt || {};
    let buf = await decode(arrayBuffer);
    buf = await resample(buf, Number(o.sampleRate) || 44100, Number(o.channels) || 2);
    const bits = Number(o.bits) === 24 ? 24 : 16;
    return encodeAiff(channelsOf(buf, buf.numberOfChannels), buf.sampleRate, bits);
  }

  /* ═══ 能力探测与统一入口 ═══════════════════ */
  function codecSupport() {
    return {
      wav: true,
      aiff: true,
      mp3: true,                       // lamejs 按需加载
      opus: canEncodeOpus(),
      flac: false,                     // 浏览器无 FLAC 编码器
      aac: false
    };
  }

  /**
   * 统一转换入口
   * @param {ArrayBuffer} arrayBuffer 源音频（已解码为容器字节）
   * @param {'wav'|'mp3'|'opus'|'aiff'} format
   * @param {{sampleRate?:number, channels?:number, bits?:number, bitrate?:number}} opt
   * @returns {Promise<{bytes:Uint8Array, ext:string, mime:string}>}
   */
  async function convert(arrayBuffer, format, opt) {
    const o = opt || {};
    if (format === 'wav') {
      return { bytes: await toWav(arrayBuffer, o), ext: 'wav', mime: 'audio/wav' };
    }
    if (format === 'mp3') {
      return { bytes: await toMp3(arrayBuffer, o), ext: 'mp3', mime: 'audio/mpeg' };
    }
    if (format === 'opus') {
      return { bytes: await toOpus(arrayBuffer, o), ext: 'opus', mime: 'audio/ogg' };
    }
    if (format === 'aiff') {
      return { bytes: await toAiff(arrayBuffer, o), ext: 'aiff', mime: 'audio/aiff' };
    }
    throw new Error('不支持的输出格式：' + format);
  }

  /* ═══ 输入类型判定（按内容，不按扩展名） ═══ */
  const ENC_EXT = /\.(ncm|uc|qmc0|qmc3|qmc6|qmcflac|qmcogg|qmc2|mflac|mgg|kgm|xm|tm[0-9]?)$/i;

  /**
   * 判断一个音频文件到底是什么。
   * 扩展名经常骗人：.ncm 里装的可能就是普通 MP3，也可能是 QQ 音乐的加密缓存。
   * @returns {{kind:'ncm'|'audio'|'encrypted'|'unknown', ext:string, note?:string, header:string}}
   */
  function classifyInput(name, u8) {
    const n = Math.min(64, u8.length);
    const head = String.fromCharCode.apply(null, Array.from(u8.subarray(0, n)));
    const hex = Array.from(u8.subarray(0, 16)).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    if (head.indexOf('neteasecloudmusic') >= 0) {
      return { kind: 'ncm', ext: 'ncm', note: 'NCM 容器', header: hex };
    }
    if (head.slice(0, 8) === 'CTENFDAM') {
      return { kind: 'ncm', ext: 'ncm', note: '新版 NCM（CTENFDAM）', header: hex };
    }
    const sn = (global.FS && FS.sniff) ? FS.sniff(u8) : { kind: 'unknown' };
    if (sn.kind === 'audio' && sn.ext) {
      return { kind: 'audio', ext: sn.ext, note: sn.note || '', header: hex };
    }
    if (sn.kind === 'doc') return { kind: 'unknown', ext: sn.ext, note: '这是 ' + sn.ext.toUpperCase() + ' 文档', header: hex };
    if (ENC_EXT.test(name || '')) {
      return { kind: 'encrypted', ext: (FS.extName(name) || 'bin'), note: '加密缓存', header: hex };
    }
    return { kind: 'unknown', ext: (FS.extName(name) || 'bin'), note: '', header: hex };
  }

  global.AUD = {
    decode, resample, toWav, toMp3, toOpus, toAiff, encodeAiff, convert,
    loadLame, probe, parseID3, parseFLAC, waveform, duration, channelsOf,
    codecSupport, canEncodeOpus, oggPage, oggCrc, classifyInput,
    get context() { return ctx(); }
  };
})(window);
