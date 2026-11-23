import { BRAND } from '@podium/shared';
import nodemailer from 'nodemailer';
import type { Ctx } from '../ctx';
import { AppError } from '../errors';

let transport: nodemailer.Transporter | null = null;

/** Sends the one-time sign-in code. Without SMTP outside production the code is logged and kept for tests. */
export async function sendCode(ctx: Ctx, email: string, code: string): Promise<void> {
  if (!ctx.cfg.smtpUrl) {
    if (ctx.cfg.env === 'production') throw new AppError(503, 'unavailable', 'Email sign-in is not configured.');
    ctx.devCodes.set(email, code);
    ctx.log.info({ email, code }, 'sign-in code (EMAIL_SMTP_URL is not set, so it was not emailed)');
    return;
  }
  transport ??= nodemailer.createTransport(ctx.cfg.smtpUrl);
  await transport.sendMail({
    from: ctx.cfg.emailFrom,
    to: email,
    subject: `${code} is your ${BRAND.name} sign-in code`,
    text: `Your ${BRAND.name} sign-in code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, ignore this email.`,
  });
}
