export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text only. Names and links are never interpolated into HTML. */
  text: string;
}

export interface EmailSender {
  /** Resolves true when the provider accepted the message. Never throws. */
  send(message: EmailMessage): Promise<boolean>;
}
