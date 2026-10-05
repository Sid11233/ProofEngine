// "What should I do next?" in one sentence, from a handful of counts. Pure, so it is easy to test and to
// reason about: the first rule that applies wins.

export interface NextActionFacts {
  requestsSent: number;
  /** Requests still waiting (status sent) that are more than 3 days old. */
  requestsStale: number;
  /** Completed interviews with no case study yet. */
  readyToGenerate: number;
  /** Drafts the owner can send to the client for approval. */
  drafts: number;
  awaitingApproval: number;
  /** Approved by the client but not published. */
  readyToPublish: number;
  published: number;
}

export interface NextAction {
  id: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function nextBestAction(f: NextActionFacts): NextAction {
  if (f.readyToPublish > 0) {
    return { id: "publish", title: `Publish ${plural(f.readyToPublish, "approved case study", "approved case studies")}`, detail: "Your client approved it. Choose a page address and publish.", href: "/app/case-studies", cta: "Open case studies" };
  }
  if (f.readyToGenerate > 0) {
    return { id: "generate", title: `Turn ${plural(f.readyToGenerate, "finished interview", "finished interviews")} into a case study`, detail: "The client already answered. Generate a draft and review it.", href: "/app/requests", cta: "Open requests" };
  }
  if (f.drafts > 0) {
    return { id: "approval", title: `Ask your client to approve ${plural(f.drafts, "draft", "drafts")}`, detail: "Nothing goes live until the client approves the exact version.", href: "/app/case-studies", cta: "Open case studies" };
  }
  if (f.requestsStale > 0) {
    return { id: "remind", title: `${plural(f.requestsStale, "client has", "clients have")} not responded yet`, detail: "It has been more than 3 days. A short reminder usually helps.", href: "/app/requests", cta: "Send a reminder" };
  }
  if (f.awaitingApproval > 0) {
    return { id: "wait", title: `Waiting for ${plural(f.awaitingApproval, "client approval", "client approvals")}`, detail: "Nothing to do right now. You can send a fresh approval link from the case study.", href: "/app/case-studies", cta: "See case studies" };
  }
  if (f.requestsSent === 0) {
    return { id: "first", title: "Send your first proof request", detail: "Create a request and send the client a short AI interview link.", href: "/app/requests/new", cta: "New request" };
  }
  if (f.published === 0) {
    return { id: "waiting", title: "Your requests are out", detail: "When a client finishes, you will be able to generate a case study here.", href: "/app/requests", cta: "See requests" };
  }
  return { id: "more", title: "Ask another client", detail: "Every published story makes the next one easier to sell.", href: "/app/requests/new", cta: "New request" };
}
