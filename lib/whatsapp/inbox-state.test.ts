import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageBubble } from '../../components/whatsapp/inbox/message-bubble'
import { customerSession, mergeInboxMessages, mergeMessage, templatePickerProblem } from './inbox-state'
import type { Message, MessageTemplate } from '../../types'
const message = (id: string, overrides: Partial<Message> = {}): Message => ({ id, conversation_id: 'a', sender_type: 'agent', content_type: 'text', content_text: 'Nalanda', status: 'sent', created_at: '2026-10-08T06:00:00Z', ...overrides })
// @types/react-dom carries a second ReactNode definition in this installation.
// Bridge only the SSR test boundary; component props remain strongly typed.
const renderBubble = (props: Parameters<typeof MessageBubble>[0]) => renderToStaticMarkup(createElement(MessageBubble, props) as Parameters<typeof renderToStaticMarkup>[0])

test('inbound realtime event preserves every unrelated pending send', () => {
 const merged=mergeInboxMessages([message('temp-1'),message('temp-2')],[message('customer',{sender_type:'customer'})],'a')
 assert.equal(merged.length,3)
 assert.ok(merged.some(m=>m.id==='temp-1'))
 assert.ok(merged.some(m=>m.id==='temp-2'))
})
test('HTTP acknowledgement replaces only its own temp and deduplicates realtime echo', () => {
 const merged=mergeInboxMessages([message('temp-1'),message('temp-2'),message('real',{status:'read'})],[message('real')],'a','temp-1')
 assert.equal(merged.length,2)
 assert.equal(merged.find(m=>m.id==='real')?.status,'read')
 assert.ok(merged.some(m=>m.id==='temp-2'))
})
test('stale snapshots retain newer live messages and never cross conversations', () => {
 const merged=mergeInboxMessages([message('live'),message('foreign',{conversation_id:'b'})],[message('snapshot'),message('bad',{conversation_id:'b'})],'a')
 assert.deepEqual(merged.map(m=>m.id),['live','snapshot'])
})
test('delivered/read ticks cannot regress on late sent events', () => {
 assert.equal(mergeMessage(message('id',{status:'read'}),{status:'sent'}).status,'read')
 assert.equal(mergeMessage(message('id',{status:'delivered'}),{status:'sent'}).status,'delivered')
 assert.equal(mergeMessage(message('id'),{status:'failed'}).status,'failed')
})
test('messages are chronologically ordered and same-ID updates stay unique', () => {
 const rows=mergeInboxMessages([message('later',{created_at:'2026-10-09T06:00:00Z'})],[message('earlier'),message('earlier',{status:'read'})],'a')
 assert.deepEqual(rows.map(m=>m.id),['earlier','later'])
 assert.equal(rows[0].status,'read')
})
test('24-hour window uses latest valid customer timestamp, not array order or agent activity', () => {
 const now=Date.parse('2026-10-09T05:59:00Z')
 const rows=[message('new',{sender_type:'customer'}),message('old',{sender_type:'customer',created_at:'2026-10-01T06:00:00Z'}),message('agent',{created_at:'2026-10-09T05:58:00Z'})]
 assert.deepEqual(customerSession(rows,now),{expired:false,remaining:'1m remaining'})
 assert.equal(customerSession(rows,now+60000).expired,true)
 assert.equal(customerSession([message('bad',{sender_type:'customer',created_at:'bad'})],now).expired,true)
 assert.equal(customerSession([],now).expired,true)
})
test('future timestamp clock skew does not extend session beyond 24 hours', () => {
 assert.equal(customerSession([message('future',{sender_type:'customer'})],Date.parse('2026-10-07T00:00:00Z')).remaining,'24h 0m remaining')
})
test('template picker refuses unresolved header/media/named/noncontiguous variables', () => {
 const t: MessageTemplate={id:'t',user_id:'u',name:'t',body_text:'Hello {{ 1 }}, {{2}} and {{1}}',category:'Utility',created_at:''}
 assert.equal(templatePickerProblem(t),null)
 for(const overrides of [{header_type:'image' as const},{header_type:'text' as const,header_content:'{{1}}'},{body_text:'{{2}}'},{body_text:'{{name}}'},{buttons:[{type:'URL',url:'https://example.com/{{1}}'}]}])assert.ok(templatePickerProblem({...t,...overrides}))
})
test('actual outgoing bubble has semantic contrast classes, no nested percentage width', () => {
 const html=renderBubble({message:message('out')})
 assert.match(html,/wa-message-out/)
 assert.doesNotMatch(html,/sm:max-w-\[70%\]/)
 assert.match(html,/Nalanda/)
 const incoming=renderBubble({message:message('in',{sender_type:'customer'})})
 assert.match(incoming,/wa-message-in/)
})
test('failed and malformed-date messages render safely without HTML execution', () => {
 const html=renderBubble({message:message('fail',{created_at:'invalid',status:'failed',content_text:'<script>alert(1)</script>\nBihar'})})
 assert.match(html,/Not sent/)
 assert.match(html,/&lt;script&gt;/)
 assert.doesNotMatch(html,/<script>/)
})
