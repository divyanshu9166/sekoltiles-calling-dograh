import { redirect } from "next/navigation";

// The automation list lives in the WhatsApp Marketing page's Automations tab,
// which has the section header and tab bar to navigate back from.
export default function AutomationsPage() {
  redirect("/whatsapp-marketing?tab=automations");
}
