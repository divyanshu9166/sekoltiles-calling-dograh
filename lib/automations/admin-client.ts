/**
 * Legacy Supabase admin shim.
 *
 * The WhatsApp module is Prisma-backed now. Keeping this file as a small
 * explicit stub prevents stale Supabase compatibility imports from breaking
 * TypeScript while making accidental new usage fail loudly.
 */
export function supabaseAdmin(): never {
  throw new Error('supabaseAdmin is no longer available; use Prisma helpers instead')
}
