'use client';

import dynamic from 'next/dynamic';
import { AuthProvider } from '@/hooks/use-auth';

const WhatsAppMarketingClient = dynamic(
  () => import('./whatsapp-marketing-client').then((mod) => mod.WhatsAppMarketingClient),
  {
    loading: () => null,
    ssr: false,
  },
);

export function WhatsAppMarketingShell() {
  return (
    <AuthProvider>
      <WhatsAppMarketingClient />
    </AuthProvider>
  );
}
