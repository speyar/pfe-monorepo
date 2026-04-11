"use client";

import ErrorCard from "@/components/error/error-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import fetcher from "@/lib/fetcher";
import type { AppError } from "@/lib/error";
import { ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";

type MonitoringConfigResponse = {
  data: {
    repository: {
      repoId: number;
      fullName: string;
    };
    sentry: {
      sentryOrgSlug: string;
      sentryProjectSlug: string;
      environment: string | null;
      enabled: boolean;
      updatedAt: string;
    } | null;
  };
};

type SentryOrganization = {
  id: string;
  slug: string;
  name: string;
};

type SentryProject = {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
};

type OrganizationsResponse = { data: SentryOrganization[] };
type ProjectsResponse = { data: SentryProject[] };

type SentryIssue = {
  id: string;
  title: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  permalink: string;
  culprit: string;
  firstSeen: string;
  lastSeen: string;
};

type IssuesResponse = {
  data: SentryIssue[];
  nextCursor: string | null;
};

function fmtDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

export default function RepoMonitoringPage() {
  const params = useParams<{ id: string }>();
  const [selectedOrg, setSelectedOrg] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [environment, setEnvironment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const repoId = params.id ?? null;

  const configUrl = repoId ? `/api/repos/${repoId}/monitoring/config` : null;
  const {
    data: config,
    error: configError,
    isLoading: loadingConfig,
    mutate: refreshConfig,
  } = useSWR<MonitoringConfigResponse, AppError>(configUrl, fetcher);

  const {
    data: organizations,
    error: organizationsError,
    isLoading: loadingOrganizations,
  } = useSWR<OrganizationsResponse, AppError>(
    config?.data.sentry ? null : "/api/integrations/sentry/organizations",
    fetcher,
  );

  const projectsUrl = selectedOrg
    ? `/api/integrations/sentry/projects?org=${encodeURIComponent(selectedOrg)}`
    : null;

  const { data: projects, isLoading: loadingProjects } = useSWR<
    ProjectsResponse,
    AppError
  >(projectsUrl, fetcher);

  const issuesUrl = config?.data.sentry
    ? `/api/repos/${config.data.repository.repoId}/monitoring/issues`
    : null;

  const {
    data: issues,
    error: issuesError,
    isLoading: loadingIssues,
    mutate: refreshIssues,
  } = useSWR<IssuesResponse, AppError>(issuesUrl, fetcher);

  async function handleConnectSentry() {
    setFormError(null);

    try {
      const response = await fetch("/api/integrations/sentry/connect");
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        setFormError(payload.error ?? "Failed to start Sentry OAuth flow");
        return;
      }

      window.location.href = payload.url;
    } catch {
      setFormError("Failed to start Sentry OAuth flow");
    }
  }

  async function handleLinkProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!repoId || !selectedOrg || !selectedProject) {
      setFormError("Please select organization and project");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(
        `/api/repos/${repoId}/monitoring/link-sentry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orgSlug: selectedOrg,
            projectSlug: selectedProject,
            environment,
          }),
        },
      );

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFormError(payload.error ?? "Failed to link Sentry project");
        return;
      }

      await refreshConfig();
      await refreshIssues();
    } catch {
      setFormError("Failed to link Sentry project");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUnlinkProject() {
    if (!repoId) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(
        `/api/repos/${repoId}/monitoring/link-sentry`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        setFormError("Failed to unlink Sentry project");
        return;
      }

      await refreshConfig();
    } catch {
      setFormError("Failed to unlink Sentry project");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (configError) {
    return (
      <ErrorCard title="Unable to load monitoring config" error={configError} />
    );
  }

  if (loadingConfig || !config) {
    return (
      <div className="container mx-auto mt-8 px-4">
        <p>Loading monitoring configuration...</p>
      </div>
    );
  }

  const sentryMapping = config.data.sentry;
  const hasSentryConnection = !organizationsError;

  return (
    <div className="container mx-auto mt-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Repository Monitoring</h1>
          <p className="text-muted-foreground mt-2">
            {config.data.repository.fullName}
          </p>
        </div>
        <Link href="/repos">
          <Button variant="ghost">Back to repositories</Button>
        </Link>
      </div>

      {formError ? (
        <ErrorCard title="Monitoring action failed" description={formError} />
      ) : null}

      {!hasSentryConnection && !sentryMapping ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect Sentry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your Sentry account first, then link this repository to a
              Sentry project.
            </p>
            <Button onClick={handleConnectSentry}>
              Connect Sentry account
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!sentryMapping && hasSentryConnection ? (
        <Card>
          <CardHeader>
            <CardTitle>Link Sentry Project</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLinkProject} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="org" className="text-sm font-medium">
                  Organization
                </label>
                <select
                  id="org"
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm w-full"
                  value={selectedOrg}
                  onChange={(event) => {
                    setSelectedOrg(event.target.value);
                    setSelectedProject("");
                  }}
                >
                  <option value="">Select organization</option>
                  {(organizations?.data ?? []).map((organization) => (
                    <option key={organization.id} value={organization.slug}>
                      {organization.name} ({organization.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="project" className="text-sm font-medium">
                  Project
                </label>
                <select
                  id="project"
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm w-full"
                  value={selectedProject}
                  onChange={(event) => setSelectedProject(event.target.value)}
                  disabled={!selectedOrg || loadingProjects}
                >
                  <option value="">Select project</option>
                  {(projects?.data ?? []).map((project) => (
                    <option key={project.id} value={project.slug}>
                      {project.name} ({project.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="environment" className="text-sm font-medium">
                  Environment (optional)
                </label>
                <input
                  id="environment"
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm w-full"
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                  placeholder="production"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || !selectedOrg || !selectedProject}
              >
                {isSubmitting ? "Linking..." : "Link project"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {sentryMapping ? (
        <Card>
          <CardHeader>
            <CardTitle>Current Sentry Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">
                Org: {sentryMapping.sentryOrgSlug}
              </Badge>
              <Badge variant="outline">
                Project: {sentryMapping.sentryProjectSlug}
              </Badge>
              <Badge variant="outline">
                Env: {sentryMapping.environment || "all"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Updated at {fmtDate(sentryMapping.updatedAt)}
            </p>
            <Button
              variant="destructive"
              onClick={handleUnlinkProject}
              disabled={isSubmitting}
            >
              Unlink project
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {sentryMapping ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Sentry Issues</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshIssues()}
                disabled={loadingIssues}
              >
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {issuesError ? (
              <ErrorCard
                title="Unable to load Sentry issues"
                error={issuesError}
              />
            ) : null}

            {loadingIssues ? <p>Loading issues...</p> : null}

            {!loadingIssues &&
            !issuesError &&
            (issues?.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                No issues found for this project.
              </p>
            ) : null}

            {!loadingIssues && !issuesError
              ? issues?.data.map((issue) => (
                  <div
                    key={issue.id}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{issue.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {issue.culprit || "-"}
                        </p>
                      </div>
                      <a
                        href={issue.permalink}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <Button variant="ghost" size="sm">
                          Open
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </a>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <Badge variant="outline">Status: {issue.status}</Badge>
                      <Badge variant="outline">Level: {issue.level}</Badge>
                      <Badge variant="outline">Events: {issue.count}</Badge>
                      <Badge variant="outline">Users: {issue.userCount}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      First seen: {fmtDate(issue.firstSeen)} | Last seen:{" "}
                      {fmtDate(issue.lastSeen)}
                    </div>
                  </div>
                ))
              : null}
          </CardContent>
        </Card>
      ) : null}

      {loadingOrganizations ? <p>Loading Sentry organizations...</p> : null}
    </div>
  );
}
