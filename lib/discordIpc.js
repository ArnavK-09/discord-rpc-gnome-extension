import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import * as Log from "./logger.js";
import { OP, CMD, candidatePaths, HANDSHAKE_TIMEOUT_S, READ_CHUNK } from "./config.js";
import { processId, nonce } from "./util.js";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.OutputStream.prototype, "write_all_async", "write_all_finish");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const DiscordIpc = GObject.registerClass(
  {
    GTypeName: "DiscordRpc_Ipc",
    Signals: {
      connected: {},
      disconnected: { param_types: [GObject.TYPE_STRING] },
      status: { param_types: [GObject.TYPE_STRING] },
    },
  },
  class DiscordIpc extends GObject.Object {
    _init() {
      super._init();
      this._connId = 0;
      this._connClosed = false;
      this._ready = false;
      this._connecting = false;
      this._clientId = null;
      this._cancellable = new Gio.Cancellable();
      this._buffer = new Uint8Array(0);
      this._socket = null;
      this._connection = null;
      this._input = null;
      this._output = null;
      this._readyPromise = null;
      this._handshakeTimer = 0;
    }

    get ready() {
      return this._ready;
    }

    get connecting() {
      return this._connecting;
    }

    async open(clientId) {
      if (this._ready || this._connecting) return;
      this._clientId = clientId;
      this._connId += 1;
      this._connClosed = false;
      this._cancellable = new Gio.Cancellable();
      this._buffer = new Uint8Array(0);
      this._connecting = true;
      let lastError = "No Discord IPC socket found";
      for (const path of candidatePaths()) {
        try {
          await this._connectPath(path);
          this._connecting = false;
          return;
        } catch (e) {
          lastError = e?.message ?? String(e);
        }
      }
      this._connecting = false;
      throw new Error(lastError);
    }

    _connectPath(path) {
      return new Promise((resolve, reject) => {
        const myId = this._connId;
        let connection;
        try {
          const client = new Gio.SocketClient();
          const address = Gio.UnixSocketAddress.new(path);
          connection = client.connect(address, this._cancellable);
        } catch (e) {
          reject(e);
          return;
        }
        this._connection = connection;
        this._socket = connection.get_socket();
        this._input = connection.get_input_stream();
        this._output = connection.get_output_stream();
        this._buffer = new Uint8Array(0);
        this._readyPromise = { resolve, reject };
        this._handshakeTimer = GLib.timeout_add_seconds(
          GLib.PRIORITY_DEFAULT,
          HANDSHAKE_TIMEOUT_S,
          () => {
            this._handshakeTimer = 0;
            if (!this._ready) this._onClose(myId, "handshake timeout");
            return GLib.SOURCE_REMOVE;
          },
        );
        this._receive(myId);
        this._send(OP.HANDSHAKE, JSON.stringify({ v: 1, client_id: this._clientId })).catch((e) => {
          this._onClose(myId, e?.message ?? "handshake send failed");
        });
      });
    }

    async setActivity(activity) {
      if (!this._ready) return;
      const payload = {
        cmd: CMD.SET_ACTIVITY,
        args: { pid: processId(), activity },
        nonce: nonce(),
      };
      try {
        await this._send(OP.FRAME, JSON.stringify(payload));
      } catch (e) {
        Log.error(e, "setActivity");
        this._onClose(this._connId, "send error");
      }
    }

    async clearActivity() {
      if (!this._ready) return;
      const payload = {
        cmd: CMD.SET_ACTIVITY,
        args: { pid: processId(), activity: null },
        nonce: nonce(),
      };
      try {
        await this._send(OP.FRAME, JSON.stringify(payload));
      } catch (e) {
        Log.error(e, "clearActivity");
      }
    }

    async _send(opcode, json) {
      if (!this._output) throw new Error("not connected");
      const body = encoder.encode(json);
      const frame = new Uint8Array(8 + body.length);
      const view = new DataView(frame.buffer);
      view.setUint32(0, opcode, true);
      view.setUint32(4, body.length, true);
      frame.set(body, 8);
      await this._output.write_all_async(frame, GLib.PRIORITY_DEFAULT, this._cancellable, null);
    }

    async _receive(myId) {
      if (myId !== this._connId || this._connClosed) return;
      try {
        const bytes = await this._input.read_bytes_async(
          READ_CHUNK,
          GLib.PRIORITY_DEFAULT,
          this._cancellable,
        );
        if (myId !== this._connId || this._connClosed) return;
        if (!bytes || bytes.get_size() === 0) {
          this._onClose(myId, "peer closed");
          return;
        }
        this._consume(bytes.toArray());
        this._receive(myId);
      } catch (e) {
        if (!this._cancellable.is_cancelled()) Log.error(e, "ipc read");
        this._onClose(myId, "read error");
      }
    }

    _consume(chunk) {
      const merged = this._buffer.length ? concat(this._buffer, chunk) : chunk;
      let offset = 0;
      while (merged.length - offset >= 8) {
        const view = new DataView(merged.buffer, merged.byteOffset + offset, 8);
        const opcode = view.getUint32(0, true);
        const length = view.getUint32(4, true);
        if (merged.length - offset - 8 < length) break;
        const body = merged.subarray(offset + 8, offset + 8 + length);
        offset += 8 + length;
        this._dispatch(opcode, decoder.decode(body));
      }
      this._buffer = offset < merged.length ? merged.slice(offset) : new Uint8Array(0);
    }

    _dispatch(opcode, text) {
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          Log.error(e, "ipc parse");
          return;
        }
      }
      switch (opcode) {
        case OP.FRAME:
          if (data?.evt === "READY") this._onReady();
          else if (data?.evt === "ERROR") Log.warn(`rpc error: ${data.data?.message ?? "unknown"}`);
          break;
        case OP.CLOSE:
          this._onClose(this._connId, "server closed");
          break;
        case OP.PING:
          this._send(OP.PONG, text).catch(() => {});
          break;
        default:
          break;
      }
    }

    _onReady() {
      if (this._handshakeTimer) {
        GLib.source_remove(this._handshakeTimer);
        this._handshakeTimer = 0;
      }
      this._ready = true;
      Log.info("discord ipc ready");
      this.emit("status", "connected");
      this.emit("connected");
      this._readyPromise?.resolve();
      this._readyPromise = null;
    }

    _onClose(myId, reason) {
      if (myId !== this._connId || this._connClosed) return;
      this._connClosed = true;
      const wasReady = this._ready;
      const promise = this._readyPromise;
      this._teardown();
      if (promise) promise.reject(new Error(reason));
      if (wasReady) {
        Log.info(`discord ipc disconnected: ${reason}`);
        this.emit("disconnected", reason);
        this.emit("status", "disconnected");
      } else {
        this.emit("status", "disconnected");
      }
    }

    _teardown() {
      this._ready = false;
      if (this._handshakeTimer) {
        GLib.source_remove(this._handshakeTimer);
        this._handshakeTimer = 0;
      }
      this._cancellable.cancel();
      try {
        this._socket?.shutdown(true, true);
      } catch (e) {
        Log.error(e, "socket shutdown");
      }
      try {
        this._connection?.close(null);
      } catch (e) {
        Log.error(e, "connection close");
      }
      try {
        this._socket?.close();
      } catch (e) {
        Log.error(e, "socket close");
      }
      this._connection = null;
      this._input = null;
      this._output = null;
      this._socket = null;
      this._buffer = new Uint8Array(0);
    }

    destroy() {
      this._teardown();
      this._cancellable = new Gio.Cancellable();
      this._readyPromise = null;
    }
  },
);

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
