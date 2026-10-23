import AppTopBar from '@/components/AppTopBar'

// Same top bar as the WhatsApp pages. The negative margins cancel the root
// layout's page padding so the bar spans the content width; the inner wrapper
// restores that padding for the Call Center itself.
export default function CallsLayout({ children }) {
  return (
    <div className="-mx-4 -my-6 md:-mx-8">
      <AppTopBar />
      <div className="px-4 py-6 md:px-8">{children}</div>
    </div>
  )
}
