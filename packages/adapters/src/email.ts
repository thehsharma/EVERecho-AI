import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppConfig } from '@everecho/config';

/**
 * Transactional email. Templates are identified by name and rendered from a
 * fixed set of substitution variables, because a template that accepts free
 * text is a template that will eventually put a memory in a subject line.
 */
export type EmailTemplate =
  | 'storyteller_invitation'
  | 'family_invitation'
  | 'contributor_invitation'
  | 'steward_invitation'
  | 'invitation_accepted'
  | 'invitation_declined'
  | 'access_revoked'
  | 'export_ready'
  | 'deletion_started'
  | 'deletion_completed'
  | 'password_changed'
  | 'reservation_receipt';

export interface EmailMessage {
  to: string;
  template: EmailTemplate;
  templateVersion: string;
  variables: Record<string, string>;
}

export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

interface RenderedEmail {
  subject: string;
  body: string;
}

const TEMPLATE_VERSION = 'email-2026-01';

/**
 * Subjects are deliberately dull. "A message about your archive" tells a
 * shoulder-surfer nothing; "Your father's story about the hospital" tells them
 * far too much.
 */
const TEMPLATES: Record<EmailTemplate, (v: Record<string, string>) => RenderedEmail> = {
  storyteller_invitation: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: ${v.inviterName ?? 'Someone'} would like to record your stories`,
    body: [
      `Hello ${v.recipientName ?? 'there'},`,
      ``,
      `${v.inviterName ?? 'Someone in your family'} has set up a private archive so your stories can be kept in your own words.`,
      ``,
      `Nothing has been recorded yet, and nothing happens unless you decide it should.`,
      `You choose what to record, who can see it, and you can stop or delete everything at any time.`,
      `You can also decline privately — we will not tell them why.`,
      ``,
      `Read what this involves and decide for yourself:`,
      v.link ?? '',
      ``,
      `This link expires on ${v.expiresOn ?? 'the date shown'}.`,
    ].join('\n'),
  }),
  family_invitation: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: ${v.storytellerName ?? 'A family member'} has shared an archive with you`,
    body: [
      `Hello ${v.recipientName ?? 'there'},`,
      ``,
      `${v.storytellerName ?? 'A family member'} has chosen to give you access to their archive.`,
      `They decide what you can see, and they can change or withdraw that at any time.`,
      ``,
      v.link ?? '',
    ].join('\n'),
  }),
  contributor_invitation: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: you have been asked to help with an archive`,
    body: [
      `Hello ${v.recipientName ?? 'there'},`,
      ``,
      `${v.storytellerName ?? 'A family member'} has asked whether you would add photographs, documents or corrections to their archive.`,
      `Anything you add is a suggestion: they review it before it becomes part of the archive.`,
      ``,
      v.link ?? '',
    ].join('\n'),
  }),
  steward_invitation: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: you have been named to help look after an archive`,
    body: [
      `Hello ${v.recipientName ?? 'there'},`,
      ``,
      `${v.storytellerName ?? 'A family member'} has named you to help with practical matters for their archive.`,
      `This is not a legal appointment and does not make you the owner of the archive.`,
      ``,
      v.link ?? '',
    ].join('\n'),
  }),
  invitation_accepted: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: your invitation was accepted`,
    body: `${v.recipientName ?? 'Your invitee'} has accepted and set up their own account.`,
  }),
  // The inviter is told only that a decision was made. The reason stays private.
  invitation_declined: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: an invitation was not taken up`,
    body: [
      `The invitation you sent was declined.`,
      ``,
      `We have not been given a reason to pass on, and the archive has not been started.`,
      `Please respect their decision and avoid sending another invitation.`,
    ].join('\n'),
  }),
  access_revoked: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: your access has changed`,
    body: `Your access to an archive on ${v.productName ?? 'EverEcho'} has been withdrawn. This was the storyteller's decision.`,
  }),
  export_ready: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: your export is ready`,
    body: `Your export is ready to download. The link expires on ${v.expiresOn ?? 'the date shown'}.\n\n${v.link ?? ''}`,
  }),
  deletion_started: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: deletion has started`,
    body: `Deletion of your archive has started. You can follow its progress here:\n\n${v.link ?? ''}`,
  }),
  deletion_completed: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: deletion is complete`,
    body: `Your archive and its contents have been deleted. A record that the deletion happened is kept; its contents are gone.`,
  }),
  password_changed: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: your password was changed`,
    body: `Your password was changed. If this was not you, contact ${v.supportEmail ?? 'support'} immediately.`,
  }),
  reservation_receipt: (v) => ({
    subject: `${v.productName ?? 'EverEcho'}: your reservation`,
    body: `Your refundable reservation of ${v.amount ?? ''} is confirmed. You can request a refund at any time.`,
  }),
};

export function renderEmail(message: EmailMessage): RenderedEmail {
  return TEMPLATES[message.template](message.variables);
}

/** Writes to a local outbox directory so development mail is inspectable. */
export class LocalEmailAdapter implements EmailAdapter {
  readonly name = 'local';
  private readonly dir: string;
  readonly sent: EmailMessage[] = [];

  constructor(cfg: AppConfig) {
    this.dir = resolve(cfg.env.EMAIL_OUTBOX_DIR);
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    const rendered = renderEmail(message);
    const id = `local-${Date.now()}-${this.sent.length}`;
    this.sent.push(message);
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, `${id}.txt`),
      `To: ${message.to}\nTemplate: ${message.template}@${message.templateVersion}\nSubject: ${rendered.subject}\n\n${rendered.body}\n`,
      'utf8',
    );
    return { id };
  }
}

/**
 * SMTP delivery. UNVERIFIED in this build: no SMTP server was reachable.
 * Configure SMTP_URL and set EMAIL_DRIVER=smtp to use it.
 */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = 'smtp';
  constructor(private readonly cfg: AppConfig) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const url = this.cfg.env.SMTP_URL;
    if (!url) throw new Error('SMTP_URL is not configured');
    const { createTransport } = await import('nodemailer');
    const rendered = renderEmail(message);
    const transport = createTransport(url);
    const result = await transport.sendMail({
      from: this.cfg.env.EMAIL_FROM,
      to: message.to,
      subject: rendered.subject,
      text: rendered.body,
    });
    return { id: result.messageId };
  }
}

export function createEmail(cfg: AppConfig): EmailAdapter {
  return cfg.env.EMAIL_DRIVER === 'smtp' ? new SmtpEmailAdapter(cfg) : new LocalEmailAdapter(cfg);
}

export { TEMPLATE_VERSION as EMAIL_TEMPLATE_VERSION };
