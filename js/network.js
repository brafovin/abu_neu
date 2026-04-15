/**
 * Peer-to-peer networking using PeerJS.
 *
 * Model:
 *   - "host" creates a peer, exposes its ID as the room code. Whoever
 *     has the code can connect to it.
 *   - "client" creates a peer and dials the host.
 *   - Host relays every message it receives from a client to all other
 *     connected clients, so every peer effectively sees every other
 *     peer's messages.
 *   - Messages are plain JSON objects; see game.js for the schema.
 *
 * PeerJS is loaded from a CDN in index.html; it exposes window.Peer.
 */
export class NetworkManager {
  constructor() {
    this.mode = 'offline';        // 'host' | 'client' | 'offline'
    this.peer = null;
    this.myId = null;
    this.hostId = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.onMessage    = () => {};
    this.onPeerJoin   = () => {};
    this.onPeerLeave  = () => {};
    this.onError      = () => {};
  }

  get isHost()    { return this.mode === 'host'; }
  get isClient()  { return this.mode === 'client'; }
  get isOnline()  { return this.mode !== 'offline'; }

  _makePeer() {
    if (typeof window.Peer === 'undefined') {
      throw new Error('PeerJS wurde nicht geladen.');
    }
    const p = new window.Peer();
    p.on('error', (err) => {
      console.error('[net] peer error', err);
      this.onError(err);
    });
    return p;
  }

  /** Creates a peer and resolves with its public ID. */
  host() {
    this.mode = 'host';
    return new Promise((resolve, reject) => {
      const p = this._makePeer();
      this.peer = p;
      const fail = (e) => reject(e);
      p.on('error', fail);
      p.on('open', (id) => {
        p.off('error', fail);
        this.myId = id;
        this.hostId = id;
        p.on('connection', (conn) => this._acceptIncoming(conn));
        resolve(id);
      });
    });
  }

  /** Connects to an existing host and resolves once the channel is open. */
  join(hostId) {
    this.mode = 'client';
    return new Promise((resolve, reject) => {
      const p = this._makePeer();
      this.peer = p;
      const fail = (e) => reject(e);
      p.on('error', fail);
      p.on('open', (id) => {
        this.myId = id;
        this.hostId = hostId;
        const conn = p.connect(hostId, { reliable: false, serialization: 'json' });
        this._wireClientConn(conn, resolve, fail);
      });
    });
  }

  _acceptIncoming(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.onPeerJoin(conn.peer);
    });
    conn.on('data', (data) => {
      // Forward to our local handler
      this.onMessage(data, conn.peer);
      // Relay to other clients
      for (const [pid, c] of this.connections) {
        if (pid !== conn.peer && c.open) {
          try { c.send(data); } catch (e) { /* ignore */ }
        }
      }
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.onPeerLeave(conn.peer);
    });
    conn.on('error', (e) => console.warn('[net] incoming conn error', e));
  }

  _wireClientConn(conn, resolve, reject) {
    let opened = false;
    const timeout = setTimeout(() => {
      if (!opened) reject(new Error('Verbindung fehlgeschlagen (Timeout)'));
    }, 10000);

    conn.on('open', () => {
      opened = true;
      clearTimeout(timeout);
      this.connections.set(conn.peer, conn);
      this.onPeerJoin(conn.peer);
      resolve();
    });
    conn.on('data', (data) => {
      this.onMessage(data, conn.peer);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.onPeerLeave(conn.peer);
    });
    conn.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  }

  /** Send a message to everyone we're connected to. */
  broadcast(msg) {
    for (const c of this.connections.values()) {
      if (c.open) {
        try { c.send(msg); } catch (e) { /* ignore */ }
      }
    }
  }

  /** Send a message to one specific peer. */
  sendTo(peerId, msg) {
    const c = this.connections.get(peerId);
    if (c && c.open) {
      try { c.send(msg); } catch (e) { /* ignore */ }
    }
  }

  /** Count of currently-open connections. */
  get peerCount() {
    let n = 0;
    for (const c of this.connections.values()) if (c.open) n++;
    return n;
  }

  close() {
    for (const c of this.connections.values()) {
      try { c.close(); } catch (e) { /* ignore */ }
    }
    this.connections.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) { /* ignore */ }
      this.peer = null;
    }
    this.mode = 'offline';
    this.myId = null;
    this.hostId = null;
  }
}
