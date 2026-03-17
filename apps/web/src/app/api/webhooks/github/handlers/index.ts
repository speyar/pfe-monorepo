import { handleInstallationRepositoriesEvent } from "./installation-repositories";
import { handleInstallationEvent } from "./installation";
import { handlePullRequestEvent } from "./pull-request";

type HandleGitHubWebhookEventArgs = {
  eventName: string;
  payload: unknown;
  deliveryId: string;
};

export const handleGitHubWebhookEvent = async ({
  eventName,
  payload,
  deliveryId,
}: HandleGitHubWebhookEventArgs): Promise<Response | null> => {
  switch (eventName) {
    case "installation_repositories": {
      return handleInstallationRepositoriesEvent({ payload, deliveryId });
    }

    case "installation": {
      return handleInstallationEvent({ payload, deliveryId });
    }

    case "pull_request": {
      return handlePullRequestEvent({ payload, deliveryId, eventName });
    }

    default: {
      console.info("[github-webhook] event", {
        deliveryId,
        eventName,
      });
      return null;
    }
  }
};
