import { redirect } from "next/navigation";

// The broadcast list lives in the WhatsApp Marketing page's Broadcasts tab,
// which has the section header and tab bar to navigate back from.
export default function BroadcastsPage() {
  redirect("/whatsapp-marketing?tab=broadcasts");
}
