import { Button } from "../ui/button";

const APP_INSTALLATION_URL = process.env.APP_INSTALLATION_URL || "";

export default function ConnectGithubButton() {
  const handleConnect = () => {
    window.location.href = APP_INSTALLATION_URL;
  };

  return (
    <Button>
      <a href={APP_INSTALLATION_URL} target="_blank">
        Connect GitHub
      </a>
    </Button>
  );
}
