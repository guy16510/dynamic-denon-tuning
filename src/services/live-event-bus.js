export class LiveEventBus {
  constructor() { this.listeners = new Set(); }

  publish(event) {
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('event listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
