import { toAppError, toHttpAppError } from "@/lib/error";

async function fetcher<T = unknown>(url: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    throw toAppError(error, {
      message: "Network error while fetching data",
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
      details: { url },
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  const payload = isJson
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    throw toHttpAppError({
      statusCode: response.status,
      statusText: response.statusText,
      payload,
      details: { url, payload },
    });
  }

  return payload as T;
}

export default fetcher;
