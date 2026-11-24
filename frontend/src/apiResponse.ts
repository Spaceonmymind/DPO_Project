export async function parseApiResponse(response: Response): Promise<any> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    let detail = "";
    if (contentType.includes("application/json")) {
      try {
        const body = await response.json();
        detail = typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? body.detail.map((item: any) => item?.msg || String(item)).join("; ") : "";
      } catch { /* A proxy may return an invalid JSON error page. */ }
    }
    if (!detail) detail = response.status >= 500
      ? "Сервер не смог выполнить операцию. Повторите попытку позже."
      : `Не удалось выполнить операцию (HTTP ${response.status}).`;
    throw new Error(detail);
  }
  return response.json();
}
