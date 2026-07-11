const util = require("util");

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

class LogManager {
  constructor(maxLines = 500) {
    this.maxLines = maxLines;
    this.buffer = [];
    this.clients = new Set();
    this._intercept();
  }

  _intercept() {
    for (const level of ["log", "info", "warn", "error"]) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        this._push(level, args);
      };
    }
  }

  _push(level, args) {
    const text = args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.stack || a.message;
        return util.inspect(a, { depth: 2, colors: false });
      })
      .join(" ")
      .replace(ANSI_RE, "");

    const entry = { ts: Date.now(), level, text };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxLines) this.buffer.shift();

    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  addClient(res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    for (const entry of this.buffer) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }
}

module.exports = new LogManager();
