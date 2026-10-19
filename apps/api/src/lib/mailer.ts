import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (env.MAIL_TRANSPORT !== 'smtp') return null;
  transporter ??= nodemailer.createTransport(env.SMTP_URL!);
  return transporter;
}

/**
 * Transactional mail only (invitations, password notices). Campaign sending in
 * Phase 4 goes through the channel adapters instead — different deliverability
 * concerns, different rate limits, different credentials.
 *
 * With `MAIL_TRANSPORT=console` nothing is sent: the message is logged, which is
 * what makes invite links usable in local development without an SMTP account.
 */
export async function sendMail(mail: OutboundMail): Promise<{ delivered: boolean }> {
  const tx = getTransporter();
  if (!tx) {
    logger.info(
      { to: mail.to, subject: mail.subject, body: mail.text },
      'mail (console transport — not delivered)',
    );
    return { delivered: false };
  }
  await tx.sendMail({ from: env.MAIL_FROM, ...mail });
  logger.info({ to: mail.to, subject: mail.subject }, 'mail sent');
  return { delivered: true };
}

/** True when mail is only logged, so the API may return the accept URL directly. */
export function mailIsLoggedNotSent(): boolean {
  return env.MAIL_TRANSPORT === 'console';
}
