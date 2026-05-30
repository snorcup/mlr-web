export class EventBus {
  constructor(){ this.listeners = new Map(); }
  on(type, fn){
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
    return () => this.off(type, fn);
  }
  off(type, fn){
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(x => x !== fn));
  }
  emit(type, payload){
    for (const fn of this.listeners.get(type) ?? []) fn(payload);
  }
}
