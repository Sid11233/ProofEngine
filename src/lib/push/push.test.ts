import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "@/lib/security/env-schema";
import { isAllowedPushEndpoint } from "./endpoint";
import { PUSH_MESSAGES, pushPayload, type PushEvent } from "./notify";
import { subscriptionSchema } from "./schemas";

const b64url = (b: Buffer) => b.toString("base64url");

describe("isAllowedPushEndpoint", () => {
  it("accepts only the real push services over https", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/QAbc", "https://eu.push.apple.com/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect(isAllowedPushEndpoint(ok), ok).toBe(true);
  });
  it("rejects internal, look-alike and malformed endpoints (the server will POST to these)", () => {
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://fcm.googleapis.com.evil.example/x",
      "https://evil.example/fcm.googleapis.com", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://notpush.apple.com.evil.example/", "ftp://fcm.googleapis.com/x", "", "x".repeat(600), null, 5,
    ]) expect(isAllowedPushEndpoint(bad as string), String(bad)).toBe(false);
  });
});

describe("subscriptionSchema", () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abcdefghijklmnop", p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) };
  it("accepts a real browser subscription shape", () => {
    expect(subscriptionSchema.safeParse(good).success).toBe(true);
  });
  it("rejects wrong keys, unknown hosts and extra fields", () => {
    for (const bad of [{ ...good, p256dh: "short" }, { ...good, auth: "x".repeat(40) }, { ...good, endpoint: "https://evil.example/x" }, { ...good, extra: 1 }, { endpoint: good.endpoint }]) expect(subscriptionSchema.safeParse(bad).success).toBe(false);
  });
  it("produces a request the web-push library accepts (keys and endpoint are usable)", () => {
    const vapid = webpush.generateVAPIDKeys();
    const details = webpush.generateRequestDetails({ endpoint: good.endpoint, keys: { p256dh: good.p256dh, auth: good.auth } }, pushPayload("client_completed", "App"), { vapidDetails: { subject: "mailto:ops@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600 });
    expect(details.endpoint).toBe(good.endpoint);
    expect(String(details.headers.Authorization)).toMatch(/^vapid /);
    expect(Buffer.isBuffer(details.body)).toBe(true);
  });
});

describe("VAPID configuration", () => {
  it("accepts generated keys and rejects malformed ones", () => {
    const keys = webpush.generateVAPIDKeys();
    const pub = serverEnvSchema.shape.VAPID_PUBLIC_KEY.safeParse(keys.publicKey);
    expect(pub.success).toBe(true);
    expect(serverEnvSchema.shape.VAPID_PRIVATE_KEY.safeParse(keys.privateKey).success).toBe(true);
    expect(serverEnvSchema.shape.VAPID_PRIVATE_KEY.safeParse("not a key!").success).toBe(false);
    expect(serverEnvSchema.shape.VAPID_SUBJECT.safeParse("mailto:ops@example.com").success).toBe(true);
    expect(serverEnvSchema.shape.VAPID_SUBJECT.safeParse("https://example.com/contact").success).toBe(true);
    expect(serverEnvSchema.shape.VAPID_SUBJECT.safeParse("javascript:alert(1)").success).toBe(false);
  });
});

describe("notification text", () => {
  it("is generic: only a title, a fixed sentence and an in-app path", () => {
    for (const event of Object.keys(PUSH_MESSAGES) as PushEvent[]) {
      const payload = JSON.parse(pushPayload(event, "Proof Engine"));
      expect(Object.keys(payload).sort()).toEqual(["body", "title", "url"]);
      expect(payload.url).toMatch(/^\/app\/[a-z-]+$/);
      expect(payload.body).toMatch(/^A client [a-z ]+$/);
      expect(payload.body.length).toBeLessThan(60);
    }
  });
});
