export class ResponseGate {
  constructor() {
    this.epoch = 0;
    this.currentResponseId = null;
    this.invalidResponseIds = new Set();
  }

  begin(responseId) {
    this.epoch += 1;
    this.currentResponseId = responseId ?? `local-${this.epoch}`;
    return { id: this.currentResponseId, epoch: this.epoch };
  }

  adopt(responseId) {
    if (!responseId || !this.currentResponseId?.startsWith("local-")) return false;
    this.currentResponseId = responseId;
    return true;
  }

  invalidateCurrent() {
    if (this.currentResponseId) this.invalidResponseIds.add(this.currentResponseId);
    this.epoch += 1;
    this.currentResponseId = null;
    return this.epoch;
  }

  completeCurrent() {
    if (this.currentResponseId) this.invalidResponseIds.add(this.currentResponseId);
    this.currentResponseId = null;
  }

  accepts(responseId) {
    if (responseId && this.invalidResponseIds.has(responseId)) return false;
    if (responseId && this.currentResponseId && responseId !== this.currentResponseId) return false;
    return Boolean(this.currentResponseId);
  }

  resolveId(event) {
    return event.response_id ?? event.response?.id ?? event.item?.response_id ?? null;
  }
}
