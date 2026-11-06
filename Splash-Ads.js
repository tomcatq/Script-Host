// Keep each matcher in sync with its [Script] entry in Splash-Ads.sgmodule.
const requestFilters = [
  {
    pattern: /^https?:\/\/(?:(?:m[0-9]|m5-zb)\.amap\.com\/ws\/(?:valueadded\/alimama\/splash_screen|shield\/dsp\/app\/startup\/init)|amap-aos-info-nogw\.amap\.com\/ws\/aos\/alimama\/splash_screen(?:_rt)?)(?:[/?]|$)/,
    mock: emptyJsonResponse,
  },
  {
    pattern: /^http:\/\/[^/]+\/amdc\/mobileDispatch(?:[/?]|$)/,
    mock: blockMobileDispatch,
  },
  {
    pattern: /^https?:\/\/api\.douban\.com\/(?:v[0-9]+\/app_ads(?:[/?]|$)|(?:[^/?]+\/)*ad\/)/,
    mock: emptyJsonResponse,
  },
  {
    pattern: /^https?:\/\/cn-acs\.m\.cainiao\.com\/gw\/mtop\.cainiao\.guoguo\.(?:nbnetflow\.)?ads\.m?show(?:\.cn)?(?:[/?]|$)/,
    mock: () => ({ response: { status: 200, headers: {}, body: "" } }),
  },
];

const responseFilters = [
  {
    pattern: /^https?:\/\/netflow-mtop\.cainiao\.com\/gw\/mtop\.cainiao\.guoguo\.nbnetflow\.ads(?:[./?]|$)/,
    rewrite: rewriteCainiaoNetflow,
  },
  {
    pattern: /^https?:\/\/api\.coolapk\.com\/v6\/main\/init\/?(?:\?|$)/,
    rewrite: rewriteCoolapkStartup,
  },
];

function emptyJsonResponse() {
  return {
    response: {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: "{}",
    },
  };
}

function blockMobileDispatch(request) {
  const headers = request.headers || {};
  const userAgent = Object.keys(headers).find((key) => key.toLowerCase() === "user-agent");
  if (!/^(?:AMapiPhone|Cainiao4iPhone)/i.test(headers[userAgent] || "")) return {};

  return { response: { status: 404, headers: {}, body: "" } };
}

function parseJson(text) {
  if (typeof text !== "string") return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function rewriteCainiaoNetflow(body) {
  const payload = parseJson(body);
  const data = payload?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) {
    return {};
  }

  // Cainiao also uses this response for a settings item with material ID 39017.
  const results = Array.isArray(data.result) ? data.result : [data.result];
  if (results.some((item) => item?.materialId === "39017" || item?.materialId === 39017)) {
    return {};
  }

  payload.data = {};
  return { body: JSON.stringify(payload) };
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

if (typeof $response === "undefined") {
  const filter = requestFilters.find(({ pattern }) => pattern.test($request.url));
  $done(filter ? filter.mock($request) : {});
} else {
  const filter = responseFilters.find(({ pattern }) => pattern.test($request.url));
  $done(filter ? filter.rewrite($response.body) : {});
}
