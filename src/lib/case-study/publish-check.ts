export type BlockerCode = "template_locked" | "not_approved" | "not_signed" | "claims_unconfirmed" | "invalid_state";

export interface Blocker {
  code: BlockerCode;
  message: string;
}

export interface PublishFacts {
  status: string;
  templateAllowed: boolean;
  /** An approval exists for the study's CURRENT version. */
  approvedCurrentVersion: boolean;
  /** A verified, web-consenting, unrevoked signature exists for the CURRENT version. */
  signedCurrentVersion: boolean;
  /** Every claim has been confirmed by the client. */
  allClaimsConfirmed: boolean;
}

/**
 * Why a case study cannot be published yet, in plain words. This is only an explanation for
 * the editor: the database publish trigger (Phase 6.2) enforces the same rules, so nothing
 * here can be bypassed by editing a request.
 */
export function explainPublishBlockers(facts: PublishFacts): Blocker[] {
  const blockers: Blocker[] = [];
  if (!facts.templateAllowed) blockers.push({ code: "template_locked", message: "This template is not included in your plan. Choose a free template or upgrade." });
  if (!facts.approvedCurrentVersion) blockers.push({ code: "not_approved", message: "Your client has not approved this exact version yet." });
  if (facts.approvedCurrentVersion && !facts.signedCurrentVersion) blockers.push({ code: "not_signed", message: "There is no valid signature for this exact version (it was never signed, or the client withdrew consent)." });
  if (!facts.allClaimsConfirmed) blockers.push({ code: "claims_unconfirmed", message: "Some numbers or quotes still need your client's confirmation." });
  if (facts.status === "published") blockers.push({ code: "invalid_state", message: "This case study is already published." });
  return blockers;
}
