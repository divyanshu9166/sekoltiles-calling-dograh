import { classifyServiceFailure } from './classify.mjs'

export function inspectVobizBalance(body, now = new Date()) {
  if (body?.available_balance == null || !Number.isFinite(Number(body.available_balance)) || typeof body.is_postpaid !== 'boolean') {
    throw new Error('Vobiz balance response is missing available balance or billing type; balance cannot be verified.')
  }
  const available = Number(body.available_balance)
  const threshold = Number.isFinite(Number(body.low_balance_threshold)) ? Math.max(0, Number(body.low_balance_threshold)) : 25
  const snapshot = { available, currency: String(body.currency || 'INR').slice(0, 3), postpaid: body.is_postpaid, checkedAt: now.toISOString() }
  // Negative postpaid balances alone do not prove that a credit line is exhausted.
  if (body.is_postpaid) return { snapshot, failure: null, canResolveCredit: false, canResolveLowBalance: false }
  if (available <= 0) return { snapshot, failure: classifyServiceFailure({ source: 'vobiz', message: `Vobiz prepaid credits exhausted. Available balance: ${available} ${snapshot.currency}.`, timestamp: now }), canResolveCredit: false, canResolveLowBalance: false }
  if (available <= threshold) {
    const failure = classifyServiceFailure({ source: 'vobiz', message: `Vobiz available balance is ${available} ${snapshot.currency}; low-balance threshold is ${threshold}.`, timestamp: now })
    return { snapshot, failure: { ...failure, fingerprint: 'vobiz:TELEPHONY:LOW_BALANCE', code: 'LOW_BALANCE', severity: 'WARNING', title: 'Vobiz: Low balance', action: 'Recharge Vobiz before the remaining balance runs out.', eventKey: `vobiz-low:${Math.floor(now.getTime() / 3600000)}` }, canResolveCredit: true, canResolveLowBalance: false }
  }
  return { snapshot, failure: null, canResolveCredit: true, canResolveLowBalance: true }
}
