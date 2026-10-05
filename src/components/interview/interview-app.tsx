"use client";

import { isReachable } from "@/lib/referrals/schemas";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { useEffect, useRef, useState } from "react";

type Role = "client" | "bot";
interface Message {
  role: Role;
  content: string;
}
interface Progress {
  current: number;
  total: number;
}

export interface InterviewAppProps {
  token: string;
  workspaceName: string;
  clientFirstName: string;
  consentText: string;
  consentVersion: string;
  questions: Array<{ id: string; text: string }>;
  turnstileSiteKey?: string;
  nonce?: string;
  initial: { messages: Message[]; progress: Progress; done: boolean } | null;
}

type Phase = "intro" | "chat" | "form" | "closing" | "thanks";

const ERRORS: Record<string, string> = {
  rate_limited: "You are sending messages a little fast. Please wait a moment and try again.",
  busy: "We are still working on your last answer. Please wait a few seconds.",
  limit_reached: "This interview has reached its length limit. Thank you for your time.",
  closed: "This interview is no longer open.",
  invalid: "That answer could not be sent. Please check it and try again.",
};
const GENERIC_ERROR = "Something went wrong on our side. Your answer was not lost: please try again.";

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // No cookies, no referrer: the link is the only credential.
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string } & T;
    if (!response.ok) return { ok: false, error: data.message ?? ERRORS[data.error ?? ""] ?? GENERIC_ERROR };
    return { ok: true, data };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

const buttonPrimary =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-neutral-900 px-5 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";
const inputClass =
  "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/20 dark:border-neutral-700 dark:focus-visible:border-neutral-100";

export function InterviewApp(props: InterviewAppProps) {
  const { initial } = props;
  const [phase, setPhase] = useState<Phase>(!initial ? "intro" : initial.done ? "closing" : "chat");
  const [messages, setMessages] = useState<Message[]>(initial?.messages ?? []);
  const [progress, setProgress] = useState<Progress>(initial?.progress ?? { current: 1, total: 6 });

  if (phase === "intro") {
    return (
      <IntroScreen
        {...props}
        onStarted={(started) => {
          setMessages(started.messages);
          setProgress(started.progress);
          setPhase("chat");
        }}
      />
    );
  }
  if (phase === "chat") {
    return (
      <ChatScreen
        token={props.token}
        messages={messages}
        progress={progress}
        onMessages={setMessages}
        onProgress={setProgress}
        onDone={() => setPhase("closing")}
        onSwitchToForm={() => setPhase("form")}
      />
    );
  }
  if (phase === "form") {
    return <FormScreen token={props.token} questions={props.questions} fromIndex={progress.current - 1} onBack={() => setPhase("chat")} onDone={() => setPhase("closing")} />;
  }
  if (phase === "closing") return <ClosingScreen token={props.token} workspaceName={props.workspaceName} onFinished={() => setPhase("thanks")} />;
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Thank you, {props.clientFirstName}!</h1>
      <p className="mt-3 text-neutral-700 dark:text-neutral-300">
        Your answers have gone to {props.workspaceName}. Nothing will be published without your approval of the exact wording. You can close this page now.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh w-full max-w-lg px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">{children}</main>;
}

function Alert({ message }: { message?: string }) {
  return (
    <div role="alert" aria-live="assertive">
      {message ? <p className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{message}</p> : null}
    </div>
  );
}

function IntroScreen({
  token, workspaceName, clientFirstName, consentText, consentVersion, turnstileSiteKey, nonce, onStarted,
}: InterviewAppProps & { onStarted: (s: { messages: Message[]; progress: Progress }) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [humanToken, setHumanToken] = useState<string>();

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!agreed || (turnstileSiteKey && !humanToken)) return;
    setError(undefined);
    setPending(true);
    const result = await post<{ messages: Message[]; progress: Progress }>("/api/interview/start", { token, consent: true, consentVersion, turnstileToken: humanToken });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onStarted(result.data);
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Hi {clientFirstName}</h1>
      <p className="mt-3 text-neutral-700 dark:text-neutral-300">
        <strong>{workspaceName}</strong> would love to hear about your experience working together.
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-neutral-700 dark:text-neutral-300">
        <li>It takes about 3 minutes: six short questions, one at a time.</li>
        <li>We use your answers to write a short case study about your experience.</li>
        <li>Nothing is published until you have approved the exact wording.</li>
      </ul>
      <form onSubmit={start} className="mt-6 space-y-4">
        <label className="flex min-h-11 items-start gap-3 rounded-md border border-neutral-300 p-3 dark:border-neutral-700">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-5 shrink-0" required />
          <span className="text-sm">{consentText}</span>
        </label>
        {turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} nonce={nonce} onToken={setHumanToken} /> : null}
        <Alert message={error} />
        <button type="submit" className={buttonPrimary} disabled={!agreed || pending || Boolean(turnstileSiteKey && !humanToken)}>
          {pending ? "Starting..." : "Start the interview"}
        </button>
      </form>
    </Shell>
  );
}

function ChatScreen({
  token, messages, progress, onMessages, onProgress, onDone, onSwitchToForm,
}: {
  onSwitchToForm: () => void;
  token: string;
  messages: Message[];
  progress: Progress;
  onMessages: (m: Message[]) => void;
  onProgress: (p: Progress) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [finished, setFinished] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setError(undefined);
    setPending(true);
    const withAnswer: Message[] = [...messages, { role: "client", content: text }];
    onMessages(withAnswer);
    setDraft("");

    const result = await post<{ reply: string; progress: Progress; done: boolean }>("/api/interview/message", { token, message: text });
    setPending(false);
    if (!result.ok) {
      // Take the answer back out and return it to the box, so nothing the client typed is lost.
      onMessages(messages);
      setDraft(text);
      return setError(result.error);
    }
    onMessages([...withAnswer, { role: "bot", content: result.data.reply }]);
    onProgress(result.data.progress);
    if (result.data.done) setFinished(true);
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-lg flex-col">
      <header className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium" aria-live="polite">
            Question {progress.current} of {progress.total}
          </p>
          {!finished && (
            <button type="button" className="min-h-11 text-sm underline underline-offset-2" onClick={onSwitchToForm} disabled={pending}>
              Switch to a simple form
            </button>
          )}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.current} aria-label="Interview progress">
          <div className="h-full rounded-full bg-neutral-900 transition-all dark:bg-neutral-100" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" role="log" aria-label="Conversation">
        {messages.map((message, index) => (
          <div key={index} className={message.role === "client" ? "flex justify-end" : "flex justify-start"}>
            {/* Plain text only: React text nodes, never HTML. */}
            <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-base ${message.role === "client" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 dark:bg-neutral-800"}`}>
              <span className="sr-only">{message.role === "client" ? "You: " : "Interviewer: "}</span>
              {message.content}
            </p>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start" role="status" aria-live="polite">
            <p className="rounded-2xl bg-neutral-100 px-4 py-2 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <span className="sr-only">The interviewer is typing</span>
              <span aria-hidden="true">Typing...</span>
            </p>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="border-t border-neutral-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-neutral-800">
        <Alert message={error} />
        {finished ? (
          <button type="button" className={buttonPrimary} onClick={onDone}>Continue</button>
        ) : (
          <form onSubmit={send} className="space-y-2">
            <label htmlFor="answer" className="sr-only">Your answer</label>
            <textarea
              id="answer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e as unknown as React.FormEvent);
              }}
              maxLength={1000}
              rows={3}
              disabled={pending}
              placeholder="Type your answer"
              className={`${inputClass} resize-none`}
              aria-describedby="answer-count"
            />
            <div className="flex items-center justify-between gap-3">
              <span id="answer-count" className="text-sm text-neutral-600 dark:text-neutral-400">{draft.length} / 1000</span>
              <button type="submit" disabled={pending || draft.trim() === ""} className={`${buttonPrimary} !w-auto`}>Send</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ClosingScreen({ token, workspaceName, onFinished }: { token: string; workspaceName: string; onFinished: () => void }) {
  const [permission, setPermission] = useState("");
  const [referrals, setReferrals] = useState([{ name: "", contact: "" }]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const updateReferral = (index: number, field: "name" | "contact", value: string) =>
    setReferrals((current) => current.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    if (!permission) return setError("Please choose how we may credit you.");
    // A referral needs both fields; half-filled rows are ignored rather than guessed at.
    const filled = referrals.filter((r) => r.name.trim() && r.contact.trim());
    if (filled.some((r) => !isReachable(r.contact.trim()))) return setError("Please enter a valid email address or phone number for the person you are suggesting, or clear that row.");
    setError(undefined);
    setPending(true);
    const result = await post("/api/interview/finish", { token, publishPermission: permission, referrals: filled });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onFinished();
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Almost done</h1>
      <form onSubmit={finish} className="mt-5 space-y-6" noValidate>
        <fieldset className="space-y-2">
          <legend className="font-medium">If {workspaceName} publishes your story, how may they credit you?</legend>
          {[
            ["full", "Full name and company"],
            ["first_name", "First name only"],
            ["anonymous", "Anonymous"],
          ].map(([value, label]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-neutral-300 px-3 dark:border-neutral-700">
              <input type="radio" name="permission" value={value} checked={permission === value} onChange={() => setPermission(value)} className="size-5" />
              {label}
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Add your logo or a photo (optional)</legend>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">PNG, JPG or WebP, up to 2 MB. Used only if you approve the published page.</p>
          <FileUpload token={token} kind="logo" label="Company logo" />
          <FileUpload token={token} kind="headshot" label="Your headshot" />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Know someone who might want similar help? (optional)</legend>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">We will not contact them. We only pass these details to {workspaceName}.</p>
          {referrals.map((referral, index) => (
            <div key={index} className="space-y-2">
              <div>
                <label htmlFor={`ref-name-${index}`} className="block text-sm font-medium">Name</label>
                <input id={`ref-name-${index}`} className={inputClass} value={referral.name} maxLength={200} onChange={(e) => updateReferral(index, "name", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`ref-contact-${index}`} className="block text-sm font-medium">Email or phone</label>
                <input id={`ref-contact-${index}`} className={inputClass} value={referral.contact} maxLength={320} onChange={(e) => updateReferral(index, "contact", e.target.value)} />
              </div>
            </div>
          ))}
          {referrals.length < 3 && (
            <button type="button" className="min-h-11 text-sm underline underline-offset-2" onClick={() => setReferrals([...referrals, { name: "", contact: "" }])}>
              Add another
            </button>
          )}
        </fieldset>

        <Alert message={error} />
        <button type="submit" className={buttonPrimary} disabled={pending}>{pending ? "Sending..." : "Finish"}</button>
      </form>
    </Shell>
  );
}

function FormScreen({
  token, questions, fromIndex, onBack, onDone,
}: {
  token: string;
  questions: Array<{ id: string; text: string }>;
  fromIndex: number;
  onBack: () => void;
  onDone: () => void;
}) {
  const remaining = questions.slice(fromIndex);
  const [answers, setAnswers] = useState<string[]>(remaining.map(() => ""));
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (answers.some((a) => a.trim() === "")) return setError("Please answer every question, or go back to the chat.");
    setError(undefined);
    setPending(true);
    const result = await post("/api/interview/form", { token, answers: remaining.map((q, i) => ({ questionId: q.id, answer: answers[i] })) });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Simple form</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">Answer in your own words. Short answers are fine.</p>
      <form onSubmit={submit} className="mt-5 space-y-5" noValidate>
        {remaining.map((question, index) => (
          <div key={question.id} className="space-y-1.5">
            <label htmlFor={`q-${question.id}`} className="block font-medium">{question.text}</label>
            <textarea
              id={`q-${question.id}`}
              className={`${inputClass} resize-y`}
              rows={4}
              maxLength={1000}
              value={answers[index]}
              onChange={(e) => setAnswers((current) => current.map((a, i) => (i === index ? e.target.value : a)))}
            />
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{answers[index].length} / 1000</p>
          </div>
        ))}
        <Alert message={error} />
        <div className="flex gap-3">
          <button type="button" className="min-h-11 rounded-md border border-neutral-300 px-5 text-base dark:border-neutral-700" onClick={onBack} disabled={pending}>Back to chat</button>
          <button type="submit" className={buttonPrimary} disabled={pending}>{pending ? "Sending..." : "Submit answers"}</button>
        </div>
      </form>
    </Shell>
  );
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function FileUpload({ token, kind, label }: { token: string; kind: "logo" | "headshot"; label: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const [error, setError] = useState<string>();
  const id = `file-${kind}`;

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(undefined);
    // Quick feedback only: the server re-checks size, type and content.
    if (file.size > MAX_FILE_BYTES) return setError("That file is larger than 2 MB.");

    setStatus("uploading");
    const body = new FormData();
    body.set("token", token);
    body.set("kind", kind);
    body.set("file", file);
    try {
      const response = await fetch("/api/interview/upload", { method: "POST", body, credentials: "omit", referrerPolicy: "no-referrer" });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setStatus("idle");
        return setError(data.message ?? GENERIC_ERROR);
      }
      setStatus("done");
    } catch {
      setStatus("idle");
      setError(GENERIC_ERROR);
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={onChange} disabled={status === "uploading"} className="block w-full text-base file:mr-3 file:min-h-11 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3" />
      <div role="status" aria-live="polite" className="text-sm">
        {status === "uploading" && "Uploading..."}
        {status === "done" && "Uploaded. Choose another file to replace it."}
      </div>
      <Alert message={error} />
    </div>
  );
}
