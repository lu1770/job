/**
 * 极简 WebSocket 客户端（仅用于 CDP）。
 *
 * 为什么不用全局 WebSocket：本项目日常在 Node 18 下交互运行，而 Node 18 没有
 * 内置 WebSocket（21 才加入）。cron 用的是 Node 22 所以没暴露。这里只实现
 * RFC 6455 的必要子集：握手、文本帧收发、分片、ping/pong、close。
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const OP = { CONT: 0, TEXT: 1, BIN: 2, CLOSE: 8, PING: 9, PONG: 10 };

export class WebSocketImpl {
  constructor(url) {
    const u = new URL(url);
    this.url = url;
    this.readyState = 0; // 0 连接中 / 1 已打开 / 2 关闭中 / 3 已关闭
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;

    this._buf = Buffer.alloc(0);
    this._open = false;
    this._frag = [];
    this._fragOp = OP.TEXT;

    const secure = u.protocol === 'wss:';
    const host = u.hostname;
    const port = Number(u.port || (secure ? 443 : 80));
    const path = (u.pathname || '/') + (u.search || '');
    const key = crypto.randomBytes(16).toString('base64');
    this._key = key;

    this._socket = (secure ? tls : net).connect({ host, port }, () => {
      this._socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });
    this._socket.setNoDelay(true);
    this._socket.on('data', (d) => this._onData(d));
    this._socket.on('error', (e) => this._fail(e));
    this._socket.on('close', () => this._closed());
  }

  _onData(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    if (!this._open) {
      const idx = this._buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = this._buf.subarray(0, idx).toString('utf8');
      if (!/^HTTP\/\d(\.\d)? 101/i.test(head)) {
        this._fail(new Error(`ws 握手失败：${head.split('\r\n')[0]}`));
        return;
      }
      this._open = true;
      this.readyState = 1;
      this._buf = this._buf.subarray(idx + 4);
      if (this.onopen) this.onopen({ type: 'open' });
    }
    this._parse();
  }

  _parse() {
    for (;;) {
      const b = this._buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) { this._fail(new Error('ws 帧过大')); return; }
        len = Number(big);
        off = 10;
      }
      let maskKey = null;
      if (masked) {
        if (b.length < off + 4) return;
        maskKey = b.subarray(off, off + 4);
        off += 4;
      }
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      this._buf = b.subarray(off + len);
      if (masked) {
        const plain = Buffer.alloc(len);
        for (let i = 0; i < len; i++) plain[i] = payload[i] ^ maskKey[i % 4];
        payload = plain;
      }
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, payload) {
    if (op === OP.PING) { this._sendFrame(OP.PONG, payload); return; }
    if (op === OP.PONG) return;
    if (op === OP.CLOSE) {
      try { this._sendFrame(OP.CLOSE, Buffer.alloc(0)); } catch { /* 已关闭 */ }
      this._socket.end();
      return;
    }
    if (op === OP.TEXT || op === OP.BIN) {
      this._fragOp = op;
      this._frag = [payload];
    } else if (op === OP.CONT) {
      this._frag.push(payload);
    } else {
      return;
    }
    if (!fin) return;
    const data = Buffer.concat(this._frag);
    const text = this._fragOp === OP.TEXT ? data.toString('utf8') : data;
    this._frag = [];
    if (this.onmessage) this.onmessage({ data: text });
  }

  send(data) {
    this._sendFrame(OP.TEXT, Buffer.from(String(data), 'utf8'));
  }

  _sendFrame(op, payload) {
    if (this.readyState !== 1) throw new Error('ws 未连接');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const mask = crypto.randomBytes(4);
    const body = Buffer.alloc(len);
    for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i % 4];
    this._socket.write(Buffer.concat([header, mask, body]));
  }

  close() {
    if (this.readyState === 1) {
      try { this._sendFrame(OP.CLOSE, Buffer.alloc(0)); } catch { /* ignore */ }
    }
    this.readyState = 2;
    try { this._socket.end(); } catch { /* ignore */ }
  }

  _fail(err) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try { this._socket.destroy(); } catch { /* ignore */ }
    if (this.onerror) this.onerror(err);
    if (this.onclose) this.onclose({ type: 'error' });
  }

  _closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.onclose) this.onclose({ type: 'close' });
  }
}
