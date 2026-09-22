'use server'

import { prisma } from '@/lib/db'
import { getCurrentAdmin } from '@/lib/auth'

export async function getCatalogueRequests() {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.', data: [] }

  const requests = await prisma.catalogueRequest.findMany({
    where: { deletedAt: null, callLog: { deletedAt: null } },
    orderBy: { requestedAt: 'desc' },
  })

  return {
    success: true,
    data: requests.map((request) => ({
      id: request.id,
      customer: request.customer,
      phone: request.phone,
      region: request.region,
      requestedAt: new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
      }).format(request.requestedAt),
    })),
  }
}
