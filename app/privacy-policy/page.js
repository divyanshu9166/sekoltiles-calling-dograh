// Public privacy policy (no login), linked from the Meta app settings for the
// WhatsApp Business Platform. Data-deletion instructions live at #data-deletion.

export const metadata = {
  title: 'Privacy Policy | Sekol Tiles LLP',
  description: 'How Sekol Tiles LLP handles information shared over WhatsApp and phone calls.',
}

const UPDATED = '23 October 2026'
const EMAIL = 'sekoltiles@gmail.com'

function Section({ id, title, children }) {
  return (
    <section id={id} className="space-y-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-muted">{children}</div>
    </section>
  )
}

export default function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
        <p className="text-sm text-muted">Sekol Tiles LLP · Last updated {UPDATED}</p>
        <p className="text-sm leading-6 text-muted">
          This policy explains how Sekol Tiles LLP (&quot;we&quot;, &quot;us&quot;) collects, uses and protects
          information when you contact us on WhatsApp, receive a call from us, or book a showroom visit.
        </p>
      </header>

      <Section title="Information we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your phone number and the name shown on your WhatsApp profile.</li>
          <li>Messages, images, documents and voice notes you send us on WhatsApp, and our replies.</li>
          <li>Details you share for an enquiry or appointment, such as preferred tile sizes, region, date and time.</li>
          <li>Call records and transcripts when you speak with our calling assistant.</li>
          <li>Message delivery status (sent, delivered, read) reported by WhatsApp.</li>
        </ul>
      </Section>

      <Section title="How we use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>To answer your questions about our products, prices and showroom.</li>
          <li>To book, confirm or reschedule showroom appointments.</li>
          <li>To share catalogues and updates you ask for, and to follow up on your enquiry.</li>
          <li>To send promotional messages only where you have agreed to receive them. You can opt out at any time by replying &quot;STOP&quot;.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </Section>

      <Section title="Who we share it with">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Meta (WhatsApp Business Platform)</strong>, which delivers our WhatsApp messages.</li>
          <li><strong>Google (Gemini API)</strong>, which may process your message text to draft automated replies.</li>
          <li>Our hosting and telephony providers, only to operate these services.</li>
          <li>Authorities, where required by law.</li>
        </ul>
      </Section>

      <Section title="Storage and security">
        <p>
          Your information is stored on our own servers. Access tokens and secrets are encrypted, and only
          authorised Sekol Tiles staff can view conversations. We keep information only as long as needed
          for the purposes above or as required by law.
        </p>
      </Section>

      <Section id="data-deletion" title="Your choices and data deletion">
        <p>
          You can ask us to access, correct or delete your information at any time. To request deletion,
          email <a className="text-accent underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> or send &quot;DELETE MY DATA&quot;
          on WhatsApp from the number you used to contact us. We will confirm and delete your contact details,
          messages and appointment records within 30 days, except where we must keep them by law.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          SEKOL TILES LLP, Sartanpar Road, behind Motto Slim Tiles, Morbi, Gujarat 363621, India<br />
          Email: <a className="text-accent underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> · Phone: +91 97264 18181
          · Website: sekoltiles.com
        </p>
      </Section>

      <p className="text-xs text-muted">We may update this policy; the date above shows the latest version.</p>
    </article>
  )
}
