/* ══════════════════════════════════════════════════════
   ncm.js — 网易云音乐缓存（.ncm）解密引擎
   结构： magic(17) · gap(2) · keyLen(4) · key(^0x64)
          metaLen(4) · metaJson(^0x63) · crc(4) · gap(1)
          coverLen(4) · cover · audio(密钥流异或)
   ══════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const MAGIC = 'neteasecloudmusic';
  const SIG_LEN = 17;
  const MAGIC_V2 = 'CTENFDAM';           // 新版容器头（8 字节）
  const V2_ROOT_KEY = 'hzHRAmso5kInbaxW';       // 密钥块的 AES-128 密钥
  const V2_META_KEY = "#14ljk_!\\]&0U<'(";      // 元数据的 AES-128 密钥

  /* ═══ AES-128 ECB 解密（Web Crypto 不支持 ECB，手写） ═══ */
  const AES = (function () {
    const S = new Uint8Array(256);
    const Si = new Uint8Array(256);
    (function buildBox() {
      const rotl = (x, n) => ((x << n) | (x >>> (8 - n))) & 0xFF;
      let p = 1, q = 1;
      do {
        p = (p ^ (p << 1) ^ ((p & 0x80) ? 0x1B : 0)) & 0xFF;
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xFF;
        if (q & 0x80) q ^= 0x09;
        const x = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4);
        S[p] = (x ^ 0x63) & 0xFF;
      } while (p !== 1);
      S[0] = 0x63;
      for (let i = 0; i < 256; i++) Si[S[i]] = i;
    })();

    function mul(a, b) {
      let r = 0;
      while (b) {
        if (b & 1) r ^= a;
        a = ((a << 1) ^ ((a & 0x80) ? 0x1B : 0)) & 0xFF;
        b >>= 1;
      }
      return r & 0xFF;
    }

    function expandKey(key) {
      const w = new Uint8Array(176);
      w.set(key);
      let rcon = 1;
      for (let i = 16; i < 176; i += 4) {
        let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
        if (i % 16 === 0) {
          const tmp = t0;
          t0 = S[t1] ^ rcon; t1 = S[t2]; t2 = S[t3]; t3 = S[tmp];
          rcon = mul(rcon, 2);
        }
        w[i] = w[i - 16] ^ t0;
        w[i + 1] = w[i - 15] ^ t1;
        w[i + 2] = w[i - 14] ^ t2;
        w[i + 3] = w[i - 13] ^ t3;
      }
      return w;
    }

    function decryptBlock(input, w) {
      const s = new Uint8Array(input);
      for (let i = 0; i < 16; i++) s[i] ^= w[160 + i];
      for (let round = 9; round >= 0; round--) {
        const t = new Uint8Array(16);
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) t[r + 4 * c] = s[r + 4 * ((c - r + 4) % 4)];
        }
        for (let i = 0; i < 16; i++) s[i] = Si[t[i]];
        for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
        if (round > 0) {
          for (let c = 0; c < 4; c++) {
            const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
            s[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
            s[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
            s[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
            s[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
          }
        }
      }
      return s;
    }

    /** ECB 解密并去 PKCS#7 填充 */
    function ecbDecrypt(key, data) {
      if (data.length === 0 || data.length % 16 !== 0) throw new Error('AES 密文长度不是 16 的倍数');
      const w = expandKey(key);
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i += 16) {
        out.set(decryptBlock(data.subarray(i, i + 16), w), i);
      }
      let pad = out[out.length - 1];
      if (pad < 1 || pad > 16) pad = 0;
      return out.subarray(0, out.length - pad);
    }

    return { ecbDecrypt };
  })();

  function strToBytes(s) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  }

  function b64ToBytes(s) {
    const clean = String(s).replace(/[^A-Za-z0-9+/=]/g, '');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function u32(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  }
  function str(u8, o, n) {
    let s = '';
    for (let i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]);
    return s;
  }

  /** RC4-KSA 生成 256 字节密钥盒，再由字节流异或还原音频 */
  function buildKeyBox(key) {
    const box = new Uint8Array(256);
    for (let i = 0; i < 256; i++) box[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + box[i] + key[i % key.length]) & 0xFF;
      const t = box[i]; box[i] = box[j]; box[j] = t;
    }
    return box;
  }

  function decryptAudio(data, box) {
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) & 0xFF;
      data[i] ^= box[(box[j] + box[(box[j] + j) & 0xFF]) & 0xFF];
    }
    return data;
  }

  /** 异步分块解密，避免长任务卡死界面 */
  async function decryptAudioAsync(data, box, onProgress) {
    const CHUNK = 4 * 1024 * 1024;
    const n = data.length;
    for (let base = 0; base < n; base += CHUNK) {
      const end = Math.min(base + CHUNK, n);
      for (let i = base; i < end; i++) {
        const j = (i + 1) & 0xFF;
        data[i] ^= box[(box[j] + box[(box[j] + j) & 0xFF]) & 0xFF];
      }
      if (onProgress) onProgress(end, n);
      await new Promise((r) => setTimeout(r, 0));
    }
    return data;
  }

  function xorCopy(u8, mask) {
    const out = new Uint8Array(u8.length);
    for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ mask;
    return out;
  }

  /** 音频段魔数定位（兜底：结构偏移异常时用） */
  function findAudioStart(u8, from) {
    for (let i = from; i < Math.min(u8.length - 4, from + 32 * 1024 * 1024); i++) {
      // ID3v2
      if (u8[i] === 0x49 && u8[i + 1] === 0x44 && u8[i + 2] === 0x33) return i;
      // fLaC
      if (u8[i] === 0x66 && u8[i + 1] === 0x4C && u8[i + 2] === 0x61 && u8[i + 3] === 0x43) return i;
      // MPEG frame sync（帧头 + 合法 bitrate/samplerate 组合）
      if (u8[i] === 0xFF && (u8[i + 1] & 0xE0) === 0xE0 && (u8[i + 1] & 0x18) !== 0x08) return i;
    }
    return -1;
  }

  function findCoverStart(u8) {
    for (let i = SIG_LEN; i < Math.min(u8.length - 8, 1024 * 1024); i++) {
      if (u8[i] === 0x89 && u8[i + 1] === 0x50 && u8[i + 2] === 0x4E && u8[i + 3] === 0x47) return { off: i, mime: 'image/png' };
      if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) return { off: i, mime: 'image/jpeg' };
    }
    return null;
  }

  function decodeText(u8) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(u8); }
    catch (e) { return str(u8, 0, u8.length); }
  }

  /**
   * 解析 .ncm
   * @param {Uint8Array} buf
   * @param {(p:number,total:number)=>void} [onProgress]
   * @returns {Promise<{meta:object,cover:?{bytes:Uint8Array,mime:string},audio:Uint8Array,ext:string,log:string[]}>}
   */
  /* ═══ 新版容器（CTENFDAM） ═══════════════════ */
  async function decryptV2(buf, onProgress) {
    const log = ['容器头：CTENFDAM（新版）'];
    let o = 8 + 2;

    const keyLen = u32(buf, o); o += 4;
    if (keyLen <= 0 || keyLen > 4096 || o + keyLen > buf.length) throw new Error('密钥块长度异常：' + keyLen);
    const keyChunk = xorCopy(buf.subarray(o, o + keyLen), 0x64); o += keyLen;
    const keyPlain = AES.ecbDecrypt(strToBytes(V2_ROOT_KEY), keyChunk);
    const key = keyPlain.subarray(17);          // 跳过 17 字节头，与老版一致
    if (!key.length) throw new Error('密钥解析后为空');
    log.push('密钥块 ' + keyLen + 'B XOR 0x64 → AES 解密 → 密钥 ' + key.length + 'B');
    const box = buildKeyBox(key);

    const metaLen = u32(buf, o); o += 4;
    if (metaLen < 0 || metaLen > 4 * 1024 * 1024 || o + metaLen > buf.length) throw new Error('元数据长度异常：' + metaLen);
    const metaChunk = xorCopy(buf.subarray(o, o + metaLen), 0x63); o += metaLen;
    log.push('元数据 ' + metaLen + 'B XOR 0x63');

    let meta = {};
    try {
      let skip = 0x16;
      for (let i = 0; i < metaChunk.length; i++) {
        if (metaChunk[i] === 0x3A) { skip = i + 1; break; }
      }
      const b64 = decodeText(metaChunk.subarray(skip)).trim();
      const plain = AES.ecbDecrypt(strToBytes(V2_META_KEY), b64ToBytes(b64));
      const json = decodeText(plain.subarray(6));   // 前 6 字节是 "music:"
      meta = JSON.parse(json);
      log.push('元数据：' + (meta.musicName || meta.name || '（无标题）'));
    } catch (e) {
      log.push('元数据解析失败：' + (e.message || e));
    }

    o += 9;                                        // crc32(4) + 间隔(5)
    const coverLen = (o + 4 <= buf.length) ? u32(buf, o) : 0;
    o += 4;
    let cover = null;
    if (coverLen > 0 && o + coverLen <= buf.length) {
      const c = buf.subarray(o, o + coverLen);
      const mime = c[0] === 0x89 ? 'image/png' : (c[0] === 0xFF ? 'image/jpeg' : '');
      if (mime) cover = { bytes: new Uint8Array(c), mime };
      o += coverLen;
      log.push('封面 ' + coverLen + 'B');
    }

    if (o >= buf.length - 16) throw new Error('音频段偏移异常（解析结束位置越界）');
    const audioBuf = new Uint8Array(buf.length - o);
    audioBuf.set(buf.subarray(o));
    await decryptAudioAsync(audioBuf, box, onProgress);
    log.push('音频流解密 ' + audioBuf.length + 'B');

    const ext = pickExt(meta, audioBuf);
    log.push('输出格式：' + ext.toUpperCase());

    const artists = Array.isArray(meta.artist)
      ? meta.artist.map((a) => (Array.isArray(a) ? a[0] : a)).filter(Boolean).join(' / ')
      : (meta.artist || '');

    return {
      meta: {
        title: meta.musicName || meta.name || meta.title || '',
        artist: artists,
        album: meta.album || '',
        bitrate: meta.bitrate || 0,
        duration: meta.duration || 0,
        format: meta.format || '',
        alias: meta.alias || [],
        raw: meta
      },
      cover, audio: audioBuf, ext, log, version: 2
    };
  }

  async function decrypt(buf, onProgress) {
    if (str(buf, 0, 8) === MAGIC_V2) return decryptV2(buf, onProgress);
    const log = [];
    const sig = str(buf, 0, SIG_LEN);
    if (sig !== MAGIC) {
      // 有些版本前面有 2 字节长度前缀，做一次偏移尝试
      let found = -1;
      for (let i = 0; i < Math.min(buf.length - SIG_LEN, 65536); i++) {
        if (str(buf, i, SIG_LEN) === MAGIC) { found = i; break; }
      }
      if (found < 0) throw new Error('不是有效的 NCM 文件（未找到 neteasecloudmusic 标识）');
      log.push('魔数偏移修正 +' + found);
      buf = buf.subarray(found);
    }
    log.push('魔数校验通过 @0');

    let o = SIG_LEN;
    log.push('gap 跳过 2 字节');
    o += 2;

    const keyLen = u32(buf, o); o += 4;
    if (keyLen <= 0 || keyLen > 4096 || o + keyLen > buf.length) throw new Error('密钥块长度异常：' + keyLen);
    const keyData = xorCopy(buf.subarray(o, o + keyLen), 0x64); o += keyLen;
    log.push('密钥块 ' + keyLen + 'B XOR 0x64');

    const metaLen = u32(buf, o); o += 4;
    if (metaLen < 0 || metaLen > 1024 * 1024 || o + metaLen > buf.length) throw new Error('元数据长度异常：' + metaLen);
    const metaRaw = xorCopy(buf.subarray(o, o + metaLen), 0x63); o += metaLen;
    log.push('元数据 ' + metaLen + 'B XOR 0x63');

    let meta = {};
    const metaText = decodeText(metaRaw).replace(/\u0000+$/, '').trim();
    if (metaText) {
      const s = metaText.indexOf('{');
      if (s >= 0) {
        try { meta = JSON.parse(metaText.slice(s)); }
        catch (e) { log.push('元数据 JSON 解析失败，保留原始文本'); meta = { raw: metaText }; }
      }
    }

    // 密钥盒（音频起点校验也要用它，因此提前构建）
    const key = keyData.subarray(SIG_LEN); // 去掉 "neteasecloudmusic" 前缀
    if (key.length === 0) throw new Error('密钥内容为空');
    const box = buildKeyBox(key);
    log.push('密钥盒生成 · 密钥 ' + key.length + 'B');

    /* 音频起点定位：crc32(4) + 间隔字节(0~5) + 封面长度(4) + 封面数据 + 音频。
       间隔字节各客户端不一致，故对候选间隔逐个做「解密后嗅探」验证。 */
    const GAPS = [5, 4, 6, 7, 9, 3, 2, 1, 0];
    let audioStart = -1;
    let cover = null;
    for (let gi = 0; gi < GAPS.length; gi++) {
      const g = GAPS[gi];
      const p = o + g;                 // 封面长度字段位置
      if (p + 4 > buf.length) continue;
      const cl = u32(buf, p);
      const start = p + 4 + cl;
      if (start >= buf.length - 16 || start <= p) continue;
      if (!sniffEncrypted(buf, start, box)) continue;
      audioStart = start;
      if (cl > 0) {
        const c = buf.subarray(p + 4, start);
        const mime = c[0] === 0x89 ? 'image/png' : (c[0] === 0xFF ? 'image/jpeg' : '');
        if (mime) cover = { bytes: new Uint8Array(c), mime };
      }
      log.push('音频起点 @' + start + '（间隔 ' + g + 'B · 封面 ' + cl + 'B）');
      break;
    }

    if (audioStart < 0) {
      // 兜底：封面是明文，用图片魔数定位，再在其后扫描可解密的音频起点
      log.push('长度字段失配，启用魔数兜底定位');
      const cv = findCoverStart(buf);
      const from = cv ? cv.off : o;
      const limit = Math.min(buf.length - 16, from + 96 * 1024);
      for (let s = from; s < limit; s++) {
        if (!sniffEncrypted(buf, s, box)) continue;
        audioStart = s;
        if (cv && cv.off < s) cover = { bytes: new Uint8Array(buf.subarray(cv.off, s)), mime: cv.mime };
        log.push('兜底命中：音频 @' + s);
        break;
      }
    }
    if (audioStart < 0) throw new Error('未能定位音频数据段（结构解析失败）');

    const audioBuf = new Uint8Array(buf.length - audioStart);
    audioBuf.set(buf.subarray(audioStart));
    await decryptAudioAsync(audioBuf, box, onProgress);
    log.push('音频流解密 ' + audioBuf.length + 'B');

    const ext = pickExt(meta, audioBuf);
    log.push('输出格式判定：' + ext.toUpperCase());
    const metaOut = {
      title: meta.musicName || meta.name || meta.title || '',
      artist: (meta.artist || []).map ? meta.artist.map((a) => (Array.isArray(a) ? a[0] : a)).join(' / ') : (meta.artist || ''),
      album: meta.album || '',
      bitrate: meta.bitrate || 0,
      duration: meta.duration || 0,
      format: meta.format || '',
      alias: meta.alias || [],
      raw: meta
    };
    if (!metaOut.artist && Array.isArray(meta.artist)) metaOut.artist = meta.artist.join(' / ');

    return { meta: metaOut, cover, audio: audioBuf, ext, log };
  }

  /** 音频段首字节特征（解密后判定） */
  function looksAudio(h) {
    if (!h || h.length < 3) return false;
    if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return true;                     // ID3v2
    if (h[0] === 0x66 && h[1] === 0x4C && h[2] === 0x61 && h[3] === 0x43) return true;    // fLaC
    if (h[0] === 0x4F && h[1] === 0x67 && h[2] === 0x67) return true;                     // OggS
    if (h[0] === 0xFF && (h[1] & 0xE0) === 0xE0) return true;                             // MPEG / ADTS
    return false;
  }

  /** 在加密数据上「试解密前几字节」判断该偏移是否为音频起点 */
  function sniffEncrypted(buf, start, box) {
    if (start < 0 || start + 4 > buf.length) return false;
    const t = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 0xFF;
      t[i] = buf[start + i] ^ box[(box[j] + box[(box[j] + j) & 0xFF]) & 0xFF];
    }
    return looksAudio(t);
  }

  function pickExt(meta, audio) {
    if (audio[0] === 0x66 && audio[1] === 0x4C && audio[2] === 0x61 && audio[3] === 0x43) return 'flac';
    if (audio[0] === 0x4F && audio[1] === 0x67 && audio[2] === 0x67) return 'ogg';
    if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) return 'mp3';
    if (audio[0] === 0xFF && (audio[1] & 0xE0) === 0xE0) return 'mp3';
    const f = String(meta.format || '').toLowerCase();
    if (f.indexOf('flac') >= 0) return 'flac';
    return 'mp3';
  }

  /** UTF-16LE + BOM */
  function utf16le(s) {
    const out = new Uint8Array(2 + s.length * 2);
    out[0] = 0xFF; out[1] = 0xFE;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[2 + i * 2] = c & 0xFF;
      out[3 + i * 2] = (c >> 8) & 0xFF;
    }
    return out;
  }

  /** 简易 ID3v2.3 写标签（NCM 还原出的 MP3 常缺标签） */
  function buildID3v2(tags, cover) {
    const enc = new TextEncoder();
    const frames = [];
    const textFrame = (id, value) => {
      if (!value) return;
      const txt = utf16le(String(value));
      const body = new Uint8Array(1 + txt.length);
      body[0] = 0x01;               // encoding: UTF-16 with BOM
      body.set(txt, 1);
      const d = new Uint8Array(10 + body.length);
      const dv = new DataView(d.buffer);
      for (let i = 0; i < 4; i++) d[i] = id.charCodeAt(i);
      dv.setUint32(4, body.length, false);
      d.set(body, 10);
      frames.push(d);
    };
    textFrame('TIT2', tags.title);
    textFrame('TPE1', tags.artist);
    textFrame('TALB', tags.album);
    if (tags.album_artist) textFrame('TPE2', tags.album_artist);
    if (tags.genre) textFrame('TCON', tags.genre);

    if (cover && cover.bytes && cover.bytes.length) {
      const img = cover.bytes;
      const mime = enc.encode(cover.mime || 'image/jpeg');
      // APIC: encoding(1) + mime\0 + picType(1) + description\0 + data
      const head = new Uint8Array(1 + mime.length + 1 + 1 + 1);
      head[0] = 0x00;
      head.set(mime, 1);
      head[1 + mime.length] = 0x00;
      head[2 + mime.length] = 0x03;   // front cover
      head[3 + mime.length] = 0x00;   // empty description
      const body = new Uint8Array(head.length + img.length);
      body.set(head); body.set(img, head.length);
      const d = new Uint8Array(10 + body.length);
      const dv = new DataView(d.buffer);
      'APIC'.split('').forEach((c, i) => { d[i] = c.charCodeAt(0); });
      dv.setUint32(4, body.length, false);
      d.set(body, 10);
      frames.push(d);
    }

    let size = 0; frames.forEach((f) => { size += f.length; });
    const out = new Uint8Array(10 + size);
    out[0] = 0x49; out[1] = 0x44; out[2] = 0x33; out[3] = 3; out[4] = 0; out[5] = 0;
    // synchsafe size
    out[6] = (size >> 21) & 0x7F; out[7] = (size >> 14) & 0x7F;
    out[8] = (size >> 7) & 0x7F; out[9] = size & 0x7F;
    let p = 10;
    frames.forEach((f) => { out.set(f, p); p += f.length; });
    return out;
  }

  function concat(parts) {
    let n = 0; parts.forEach((p) => { n += p.length; });
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }

  global.NCM = { decrypt, decryptV2, buildKeyBox, buildID3v2, concat, AES, MAGIC, MAGIC_V2 };
})(window);
