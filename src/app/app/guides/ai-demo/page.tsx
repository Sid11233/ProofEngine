import Link from "next/link";
import { CopyButton } from "@/components/motion/copy-button";
import { ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, SectionLabel } from "@/components/ui/card";
import { ExternalLink } from "@/components/ui/external-link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { idSchema } from "@/lib/clients/schemas";
import { buildAiPrompt } from "@/lib/demos/ai-prompt";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: pageTitle("Build a demo with your AI") };

const code = "block overflow-x-auto whitespace-pre rounded-control bg-[#f5f5f4] p-3 text-sm";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-2">
      <h3 className="font-semibold"><span className="mr-2 inline-flex size-7 items-center justify-center rounded-full bg-tint text-sm text-[#b43a0c]">{n}</span>{title}</h3>
      <div className="space-y-2 pl-9 text-sm">{children}</div>
    </li>
  );
}

/** A step-by-step guide: connect your own AI assistant to your project, ask it for demo steps, import them. Nothing here talks to GitHub or to an AI for you. */
export default async function AiDemoGuide({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireUser();
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, name, summary, website_url, repo_url").order("created_at", { ascending: false }).limit(200);
  const wanted = idSchema.safeParse((await searchParams).project);
  const project = (wanted.success ? projects?.find((p) => p.id === wanted.data) : undefined) ?? projects?.[0];
  const prompt = project ? buildAiPrompt({ name: String(project.name), summary: project.summary ? String(project.summary) : null, websiteUrl: project.website_url ? String(project.website_url) : null, repoUrl: project.repo_url ? String(project.repo_url) : null }) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Build a demo with your own AI" subtitle="Let an assistant such as Claude read your project and write the demo steps. You stay in control of what is published." action={<ButtonLink variant="secondary" href="/app/demos">Your demos</ButtonLink>} />

      <Callout tone="tint">
        <p className="font-medium">How this works</p>
        <p>Attract Studio never connects to your code, your GitHub or your AI. You connect your own assistant to your own project, ask it for demo steps, and paste its answer into the demo editor. We check the pasted text like anything you type: plain text only.</p>
      </Callout>

      <Card>
        <SectionLabel id="steps">Step by step</SectionLabel>
        <ol className="mt-4 space-y-6" aria-labelledby="steps">
          <Step n={1} title="Install Claude Code">
            <p>Follow the install guide at <ExternalLink href="https://code.claude.com/docs/en/overview">code.claude.com/docs</ExternalLink>, then open a terminal in your project&apos;s folder and run <code>claude</code>. Claude Code can read the files in the folder it is started in without anything extra.</p>
          </Step>
          <Step n={2} title="Optional: connect a folder or GitHub with MCP">
            <p>MCP (Model Context Protocol) lets an assistant use tools you connect. You only need this if your code is not in the folder you started Claude in.</p>
            <p className="font-medium">A folder on your computer</p>
            <code className={code}>claude mcp add --transport stdio filesystem -- npx -y @modelcontextprotocol/server-filesystem /full/path/to/your/project</code>
            <p className="font-medium">A GitHub repository</p>
            <code className={code}>{`claude mcp add --transport http github https://api.githubcopilot.com/mcp/ \\\n  --header "Authorization: Bearer YOUR_GITHUB_TOKEN"`}</code>
            <Callout tone="warn">
              <p className="font-medium">Keep the token safe</p>
              <p>Create a fine-grained GitHub token that can only <strong>read</strong> the one repository you need. Never paste a token, a password or an API key into Attract Studio or into the demo.</p>
            </Callout>
          </Step>
          <Step n={3} title="Check the connection">
            <p>In the terminal run:</p>
            <code className={code}>claude mcp list</code>
            <p>Or type <code>/mcp</code> inside Claude Code. Each server should show as connected. If one says it needs authentication or failed to connect, fix that first.</p>
          </Step>
          <Step n={4} title="Give Claude this request">
            {prompt && project ? (
              <>
                <form method="get" className="flex flex-wrap items-center gap-2">
                  <label htmlFor="project" className="text-sm font-medium">Project</label>
                  <select id="project" name="project" defaultValue={String(project.id)} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm">
                    {(projects ?? []).map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
                  </select>
                  <button type="submit" className="min-h-11 rounded-control border border-line px-3 text-sm">Use this project</button>
                </form>
                <textarea readOnly rows={14} value={prompt} aria-label="The request to paste into your assistant" className="block w-full rounded-control border border-line bg-surface p-3 font-mono text-xs" />
                <CopyButton text={prompt} label="Copy the request" />
              </>
            ) : (
              <p>Add a project first (Clients, then a project), so the request can include its name, website and repository link. <Link href="/app/clients" className="underline underline-offset-2">Go to clients</Link>.</p>
            )}
          </Step>
          <Step n={5} title="Import the answer">
            <p>Copy Claude&apos;s whole answer, open a demo, and use <strong>Import steps from your AI</strong> near the top of the editor. Paste it and press Import. Steps that do not fit the rules are refused with a reason, and nothing is saved until the import works.</p>
          </Step>
          <Step n={6} title="Review before you publish">
            <p>Read every step. Remove anything private or untrue, add real screenshots with <em>Upload an image</em>, then tick the two confirmations and publish. A demo is only ever a simulated example: chat steps are labelled that way for viewers.</p>
          </Step>
        </ol>
      </Card>
    </div>
  );
}
