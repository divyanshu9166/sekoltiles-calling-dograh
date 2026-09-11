import './globals.css'

const themeBootstrap = `(() => {
  try {
    const savedTheme = localStorage.getItem('calling-agent-theme');
    document.documentElement.dataset.theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
  } catch (_) {}
})();`

export const metadata = {
  title: 'Autozentic AI Calling Agent',
  description: 'AI calling, transcripts and appointment management',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-brand="homzentic" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <main className="min-h-screen bg-background px-4 py-6 md:px-8">
          <div className="mx-auto max-w-[1500px]">{children}</div>
        </main>
      </body>
    </html>
  )
}
