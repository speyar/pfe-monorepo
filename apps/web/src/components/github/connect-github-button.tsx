import { Button } from "../ui/button";

const APP_INSTALLATION_URL = process.env.APP_INSTALLATION_URL || "";

export default function ConnectGithubButton() {
  return (
    <Button>
      <a href={APP_INSTALLATION_URL} target="_blank">
        Connect Repositories
      </a>
    </Button>
  );
}
