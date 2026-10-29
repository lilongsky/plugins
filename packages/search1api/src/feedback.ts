export const CATEGORIES = ["bug", "feature_request", "docs", "other"];

export const DESCRIPTION =
  "Report a problem with Search1API: a wrong, empty or incomplete result, an " +
  "error you could not resolve, documentation that did not match behavior, or " +
  "a capability you needed but Search1API lacks. The report (message, intent, " +
  "category, request_id and model) is sent to Search1API's feedback API, which " +
  "stores it in Search1API's feedback inbox on agentback.app, linked to the " +
  "signed-in Search1API account. Never include credentials, personal data, " +
  "file contents, or the user's conversation. Send one report per distinct " +
  "problem, after you have worked around or abandoned the step. Do not report " +
  "normal successful results. Reporting is free, optional and must not block " +
  "the user's task.";

// Search1API's POST /feedback body; the API attaches the caller's account.
export function feedbackBody(args: Record<string, unknown>) {
  const { model, ...report } = args;
  return {
    ...report,
    agent: { name: "Magpie", ...(model === undefined ? {} : { model }) },
  };
}
