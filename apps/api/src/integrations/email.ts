// Email provider boundary.
// - LogEmailProvider: local development default; writes the message to the API log.
// - SmtpEmailProvider: minimal SMTP client over TLS/STARTTLS using Node's net/tls modules.
//   Activated when SMTP_HOST is configured. Supports AUTH PLAIN/LOGIN.
import net from 'node:net';
import tls from 'node:tls';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: EmailMessage): Promise<void>;
}

export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';
  readonly configured = true;
  async send(message: EmailMessage) {
    logger.info({ to: message.to, subject: message.subject }, '[email:log] message captured (SMTP not configured)');
    if (env.NODE_ENV === 'development') logger.debug({ text: message.text }, '[email:log] body');
  }
}

class SmtpSession {
  private socket!: net.Socket | tls.TLSSocket;
  private buffer = '';
  private waiters: ((line: string) => void)[] = [];

  constructor(
    private host: string,
    private port: number,
  ) {}

  async connect() {
    const secure = this.port === 465;
    this.socket = secure
      ? tls.connect({ host: this.host, port: this.port, servername: this.host })
      : net.connect({ host: this.host, port: this.port });
    this.attach(this.socket);
    await this.expect(220);
    await this.command(`EHLO spaceflow`, 250);
    if (!secure) {
      await this.command('STARTTLS', 220);
      const upgraded = tls.connect({ socket: this.socket, servername: this.host });
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', () => resolve());
        upgraded.once('error', reject);
      });
      this.socket = upgraded;
      this.attach(upgraded);
      await this.command('EHLO spaceflow', 250);
    }
  }

  private attach(socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        // Multi-line replies use "250-"; the final line uses "250 ".
        if (/^\d{3} /.test(line)) this.waiters.shift()?.(line);
      }
    });
  }

  private expect(code: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP timeout')), 15_000);
      this.waiters.push((line) => {
        clearTimeout(timer);
        if (Number(line.slice(0, 3)) === code) resolve(line);
        else reject(new Error(`SMTP unexpected reply: ${line}`));
      });
    });
  }

  command(cmd: string, expectCode: number): Promise<string> {
    this.socket.write(`${cmd}\r\n`);
    return this.expect(expectCode);
  }

  async auth(user: string, password: string) {
    const token = Buffer.from(`\0${user}\0${password}`).toString('base64');
    await this.command(`AUTH PLAIN ${token}`, 235);
  }

  async send(from: string, to: string, data: string) {
    const fromAddr = /<([^>]+)>/.exec(from)?.[1] ?? from;
    await this.command(`MAIL FROM:<${fromAddr}>`, 250);
    await this.command(`RCPT TO:<${to}>`, 250);
    await this.command('DATA', 354);
    const body = data.replace(/\r?\n\./g, '\r\n..');
    this.socket.write(`${body}\r\n.\r\n`);
    await this.expect(250);
    await this.command('QUIT', 221);
    this.socket.end();
  }
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly configured = true;
  async send(message: EmailMessage) {
    const session = new SmtpSession(env.SMTP_HOST, env.SMTP_PORT);
    await session.connect();
    if (env.SMTP_USER) await session.auth(env.SMTP_USER, env.SMTP_PASSWORD);
    const boundary = `sf-${Date.now()}`;
    const headers = [
      `From: ${env.SMTP_FROM}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html ?? `<pre>${message.text}</pre>`,
      `--${boundary}--`,
    ].join('\r\n');
    await session.send(env.SMTP_FROM, message.to, headers);
    logger.info({ to: message.to, subject: message.subject }, '[email:smtp] sent');
  }
}

export const emailProvider: EmailProvider = env.SMTP_HOST ? new SmtpEmailProvider() : new LogEmailProvider();

export const EMAIL_REQUIRED_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
export const emailConfigured = !!env.SMTP_HOST;
