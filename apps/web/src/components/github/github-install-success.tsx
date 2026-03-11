import Link from "next/link";

export default function GithubInstallSuccess() {
  return (
    <div className="max-w-xl mx-auto mt-16 border rounded-xl p-8 shadow">
      <h1 className="text-2xl font-bold mb-4">
        GitHub App Installed Successfully
      </h1>

      <p className="mb-6">
        Your repositories are now connected and ready for AI code review.
      </p>

      <div className="mt-6">
        <Link
          href="/dashboard"
          className="px-4 py-2 bg-black text-white rounded"
        >
          continue
        </Link>
      </div>
    </div>
  );
}
