import { describe, expect, it, vi } from "vitest";

import { GitHubApiError } from "../errors";
import { registerRepositoryWebhook } from "./register-repository-webhook";

const makeWebhookData = (id: number, callbackUrl: string) => ({
  id,
  active: true,
  events: ["pull_request"],
  ping_url: `https://api.github.com/hooks/${id}/pings`,
  test_url: `https://api.github.com/hooks/${id}/tests`,
  config: {
    url: callbackUrl,
  },
});

const makeClient = () => {
  const paginate = vi.fn();
  const updateWebhook = vi.fn();
  const createWebhook = vi.fn();

  return {
    paginate,
    rest: {
      repos: {
        listWebhooks: vi.fn(),
        updateWebhook,
        createWebhook,
      },
    },
  } as const;
};

describe("registerRepositoryWebhook", () => {
  it("creates a webhook when callback URL does not exist", async () => {
    const client = makeClient();

    client.paginate.mockResolvedValue([]);
    client.rest.repos.createWebhook.mockResolvedValue({
      data: makeWebhookData(10, "https://bot.example.com/webhook"),
    });

    const result = await registerRepositoryWebhook(client as never, {
      owner: "acme",
      repo: "demo",
      callbackUrl: "https://bot.example.com/webhook",
      events: ["pull_request"],
    });

    expect(client.rest.repos.createWebhook).toHaveBeenCalledTimes(1);
    expect(client.rest.repos.updateWebhook).not.toHaveBeenCalled();
    expect(result.operation).toBe("created");
    expect(result.webhookId).toBe(10);
  });

  it("updates existing webhook when callback URL already exists", async () => {
    const client = makeClient();

    client.paginate.mockResolvedValue([makeWebhookData(7, "https://bot.example.com/webhook")]);
    client.rest.repos.updateWebhook.mockResolvedValue({
      data: makeWebhookData(7, "https://bot.example.com/webhook"),
    });

    const result = await registerRepositoryWebhook(client as never, {
      owner: "acme",
      repo: "demo",
      callbackUrl: "https://bot.example.com/webhook/",
      events: ["pull_request", "pull_request_review"],
      secret: "secret-value",
    });

    expect(client.rest.repos.updateWebhook).toHaveBeenCalledTimes(1);
    expect(client.rest.repos.createWebhook).not.toHaveBeenCalled();
    expect(result.operation).toBe("updated");
    expect(result.webhookId).toBe(7);
  });

  it("normalizes client errors to GitHubApiError", async () => {
    const client = makeClient();

    client.paginate.mockRejectedValue({ status: 401, message: "Unauthorized" });

    await expect(
      registerRepositoryWebhook(client as never, {
        owner: "acme",
        repo: "demo",
        callbackUrl: "https://bot.example.com/webhook",
        events: ["pull_request"],
      })
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});
