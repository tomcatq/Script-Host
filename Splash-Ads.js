// Keep each matcher in sync with its [Script] entry in Splash-Ads.sgmodule.
const responseFilters = [
  {
    pattern: /^https?:\/\/api\.coolapk\.com\/v6\/main\/init\/?(?:\?|$)/,
    rewrite: rewriteCoolapkStartup,
  },
];

function parseJson(text) {
  if (typeof text !== "string") return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function removeCoolapkSplashSettings(config) {
  if (!config || typeof config !== "object") return false;

  const keys = Object.keys(config).filter((key) => key.startsWith("SplashAd."));
  for (const key of keys) delete config[key];
  return keys.length > 0;
}

function rewriteCoolapkStartup(body) {
  const payload = parseJson(body);
  if (!payload || !Array.isArray(payload.data)) return {};

  // ID 945 is the splash card. The same response also carries normal app tabs.
  const entries = payload.data.filter((entry) => {
    const id = entry && entry.entityId;
    return id !== 945 && id !== "945";
  });
  let changed = entries.length !== payload.data.length;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    if (removeCoolapkSplashSettings(entry.extraDataArr)) changed = true;

    // Some builds mirror the configuration as a JSON string.
    const config = parseJson(entry.extraData);
    if (removeCoolapkSplashSettings(config)) {
      entry.extraData = JSON.stringify(config);
      changed = true;
    }
  }

  if (!changed) return {};

  payload.data = entries;
  return { body: JSON.stringify(payload) };
}

const filter = responseFilters.find(({ pattern }) => pattern.test($request.url));
$done(filter ? filter.rewrite($response.body) : {});
