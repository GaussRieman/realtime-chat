export class RealtimeClient extends EventTarget {
  constructor({ voice = "longanqian" } = {}) {
    super();
    this.voice = voice;
    this.ready = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/realtime?voice=${encodeURIComponent(this.voice)}`;
      this.socket = new WebSocket(url);
      let settled = false;

      const onInitialError = () => {
        if (!settled) {
          settled = true;
          reject(new Error("PROXY_UNREACHABLE"));
        }
      };

      this.socket.addEventListener("error", onInitialError, { once: true });
      this.socket.addEventListener("message", ({ data }) => {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }

        if (event.type === "proxy.ready" && !settled) {
          settled = true;
          this.ready = true;
          resolve(event);
        }
        if (event.type === "proxy.error" && !settled) {
          settled = true;
          const error = new Error(event.error?.code ?? "PROXY_ERROR");
          error.detail = event.error?.message;
          reject(error);
          return;
        }
        this.dispatchEvent(new CustomEvent("event", { detail: event }));
      });
      this.socket.addEventListener("close", (event) => {
        this.ready = false;
        if (!settled) {
          settled = true;
          reject(new Error("PROXY_CLOSED"));
        }
        this.dispatchEvent(new CustomEvent("disconnect", { detail: event }));
      });
    });
  }

  send(event) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  close() {
    this.ready = false;
    if (this.socket?.readyState <= WebSocket.OPEN) this.socket.close(1000, "client ended session");
  }
}
