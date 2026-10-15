import 'server-only'
import { EventEmitter } from 'node:events'

const globalEvents = globalThis as unknown as { serviceAlertEvents?: EventEmitter }
const events = globalEvents.serviceAlertEvents ??= new EventEmitter()
events.setMaxListeners(100)

export function publishServiceAlert() { events.emit('changed') }
export function subscribeServiceAlerts(listener: () => void) {
  events.on('changed', listener)
  return () => { events.off('changed', listener) }
}
