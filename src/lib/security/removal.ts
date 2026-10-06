import { signId, verifySignedId } from "./signed-id";

// The "remove my story" link in the approval email and on the approval page. It stays valid for the life of
// the case study, so a client can withdraw at any time, including after publication.

const LABEL = "removal:v1";

export const removalToken = (secret: string, caseStudyId: string) => signId(secret, LABEL, caseStudyId);
export const verifyRemovalToken = (secret: string, token: string) => verifySignedId(secret, LABEL, token);
