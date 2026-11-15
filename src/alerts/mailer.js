import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// With SMTP_URL set (e.g. smtp://user:pass@smtp.mailtrap.io:2525) emails are
// really sent. Without it, they're rendered and written to the log instead,
// so the whole alert flow still works in development.
let transport = env.SMTP_URL
  ? nodemailer.createTransport(env.SMTP_URL)
  : nodemailer.createTransport({ jsonTransport: true });

/** Tests swap in a fake transport to capture emails or simulate SMTP failures. */
export function setMailTransport(next) {
  transport = next;
}

export async function sendMail({ to, subject, text, html }) {
  const info = await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  if (!env.SMTP_URL) logger.info({ to, subject, text }, 'SMTP_URL not set: email logged instead of sent');
  return info;
}
