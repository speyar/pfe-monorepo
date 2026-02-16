import { normalizeGitHubError } from "../errors";
import type { GitHubClient, GitHubOwnerRepo } from "../types";

export type PullRequestWebhookEvent =
  | "pull_request"
  | "pull_request_review"
  | "pull_request_review_comment"
  | "issue_comment";

export type RegisterRepositoryWebhookInput = GitHubOwnerRepo & {
  callbackUrl: string;
  events: PullRequestWebhookEvent[];
  secret?: string;
  active?: boolean;
  contentType?: "json" | "form";
  insecureSsl?: "0" | "1";
};

export type RegisterRepositoryWebhookResult = {
  operation: "created" | "updated";
  webhookId: number;
  callbackUrl: string;
  active: boolean;
  events: string[];
  pingUrl: string;
  testUrl: string;
};

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, "");

const findHookByCallbackUrl = async (
  client: GitHubClient,
  input: GitHubOwnerRepo,
  callbackUrl: string
) => {
  const hooks = await client.paginate(client.rest.repos.listWebhooks, {
    owner: input.owner,
    repo: input.repo,
    per_page: 100,
  });

  return hooks.find((hook) => {
    const configUrl = hook.config.url;
    if (typeof configUrl !== "string") {
      return false;
    }

    return normalizeUrl(configUrl) === normalizeUrl(callbackUrl);
  });
};

export const registerRepositoryWebhook = async (
  client: GitHubClient,
  input: RegisterRepositoryWebhookInput
): Promise<RegisterRepositoryWebhookResult> => {
  try {
    const existingHook = await findHookByCallbackUrl(client, input, input.callbackUrl);

    if (existingHook) {
      const updateResponse = await client.rest.repos.updateWebhook({
        owner: input.owner,
        repo: input.repo,
        hook_id: existingHook.id,
        active: input.active ?? true,
        events: input.events,
        config: {
          url: input.callbackUrl,
          content_type: input.contentType ?? "json",
          secret: input.secret,
          insecure_ssl: input.insecureSsl ?? "0",
        },
      });

      return {
        operation: "updated",
        webhookId: updateResponse.data.id,
        callbackUrl: input.callbackUrl,
        active: updateResponse.data.active,
        events: updateResponse.data.events,
        pingUrl: updateResponse.data.ping_url,
        testUrl: updateResponse.data.test_url,
      };
    }

    const createResponse = await client.rest.repos.createWebhook({
      owner: input.owner,
      repo: input.repo,
      active: input.active ?? true,
      events: input.events,
      config: {
        url: input.callbackUrl,
        content_type: input.contentType ?? "json",
        secret: input.secret,
        insecure_ssl: input.insecureSsl ?? "0",
      },
    });

    return {
      operation: "created",
      webhookId: createResponse.data.id,
      callbackUrl: input.callbackUrl,
      active: createResponse.data.active,
      events: createResponse.data.events,
      pingUrl: createResponse.data.ping_url,
      testUrl: createResponse.data.test_url,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to register repository webhook");
  }
};
