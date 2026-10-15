export async function recordServiceFailure(prisma, failure) {
  if (!failure) return null
  return prisma.$transaction(async tx => {
    const { eventKey, runId, observedAt, ...data } = failure
    const alert = await tx.serviceAlert.upsert({
      where: { fingerprint: data.fingerprint },
      create: { ...data, firstSeenAt: observedAt, lastSeenAt: observedAt }, update: {},
    })
    const inserted = await tx.serviceAlertEvent.createMany({
      data: [{ eventKey, alertId: alert.id, runId, observedAt, message: data.message }], skipDuplicates: true,
    })
    // Backfilled older events must not reopen an incident resolved more recently.
    const newer = observedAt >= alert.lastSeenAt
    const reopen = alert.status === 'RESOLVED' && (!alert.resolvedAt || observedAt > alert.resolvedAt)
    if (!inserted.count && !reopen && observedAt <= alert.lastSeenAt) return alert
    return tx.serviceAlert.update({ where: { id: alert.id }, data: {
      ...(inserted.count ? { occurrences: { increment: 1 } } : {}),
      ...(observedAt < alert.firstSeenAt ? { firstSeenAt: observedAt } : {}),
      ...(newer ? { lastSeenAt: observedAt, message: data.message } : {}),
      ...(reopen ? { status: 'OPEN', acknowledgedAt: null, resolvedAt: null } : {}),
    } })
  })
}
