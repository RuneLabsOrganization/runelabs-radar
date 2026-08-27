import { Resend } from 'resend';

export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? 'Radar <hello@runelabs.org>';
}

export async function sendRadarEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY missing — skip send:', opts.subject);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: emailFrom(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) throw new Error(error.message);
}
