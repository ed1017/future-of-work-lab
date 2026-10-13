// SUPABASE_URL must be the project URL (https://<ref>.supabase.co). Supabase's API
// settings also show the REST endpoint (.../rest/v1/), which supabase-js would
// extend to .../rest/v1/rest/v1/ and the gateway rejects, so keep only the origin.
export const supabaseProjectUrl = (raw) => {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("SUPABASE_URL is not a URL. Use the project URL, https://<project-ref>.supabase.co.");
  }
  if (/(^|\.)supabase\.com$/.test(url.hostname)) {
    throw new Error("SUPABASE_URL is a dashboard link. Use the project URL, https://<project-ref>.supabase.co.");
  }
  return url.origin;
};
