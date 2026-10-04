import { z } from "zod";
import { emailSchema } from "@/lib/auth/schemas";

export const inviteRoleSchema = z.enum(["admin", "editor", "viewer"]);
export const memberRoleSchema = z.enum(["owner", "admin", "editor", "viewer"]);

export const inviteSchema = z.object({ email: emailSchema, role: inviteRoleSchema }).strict();
export const changeRoleSchema = z.object({ userId: z.uuid(), role: memberRoleSchema }).strict();
export const removeMemberSchema = z.object({ userId: z.uuid() }).strict();
export const revokeInviteSchema = z.object({ inviteId: z.uuid() }).strict();

export type InviteRole = z.infer<typeof inviteRoleSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
