import { Toaster } from 'sonner'
import AppTopBar from '@/components/AppTopBar'
import './whatsapp.css'

export const metadata = {
  title: 'WhatsApp Marketing | Autozentic AI Calling Agent',
}

// The WhatsApp pages were built for the Furniture CRM dashboard shell: a
// 56px (64px on desktop) top bar above a padded `.dashboard-content` area.
// The negative margins cancel the root layout's page padding so the inbox
// can fill the remaining viewport height exactly.
export default function WhatsAppLayout({ children }) {
  return (
    <div className="-mx-4 -my-6 md:-mx-8">
      <AppTopBar />
      <div className="dashboard-content p-3.5 md:p-6 overflow-x-hidden">
        {children}
      </div>
      <Toaster position="top-right" richColors closeButton />
    </div>
  )
}
