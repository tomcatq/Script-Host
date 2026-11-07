// Shadowrocket HTTP response script for X timeline JSON.

function hasPromotedMetadata(node) {
  if (!node || typeof node !== "object") return false;
  if (node.promotedMetadata || node.promoted_metadata || node.promoted_content) return true;

  return ["content", "item", "itemContent", "item_content", "tweet"]
    .some(key => hasPromotedMetadata(node[key]));
}

function isStandaloneAd(entry) {
  const id = entry?.entryId ?? entry?.entry_id;
  if (typeof id !== "string" || !/^(?:tweet|promoted-tweet)-/i.test(id)) return false;

  const content = entry.content;
  if (content?.items || content?.timelineModule || content?.timeline_module) return false;

  return /^promoted-tweet-/i.test(id) || hasPromotedMetadata(entry);
}

function filterTimeline(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;

  let changed = false;
  if (Array.isArray(node.instructions)) {
    // Module items, pinning and replacement can refer to entries on other pages.
    for (const instruction of node.instructions) {
      const type = instruction?.type ?? instruction?.__typename;
      const addition = type === "TimelineAddEntries" ? instruction : instruction?.addEntries;
      if (!Array.isArray(addition?.entries)) continue;

      const entries = addition.entries.filter(entry => !isStandaloneAd(entry));
      if (entries.length === 0 || entries.length === addition.entries.length) continue;
      addition.entries = entries;
      changed = true;
    }
    return changed;
  }

  for (const value of Object.values(node)) {
    if (filterTimeline(value)) changed = true;
  }
  return changed;
}

function filterResponse(body) {
  if (typeof body !== "string" || body.includes("\\u0000")) return {};

  // Skip quoted strings and mask number literals that JavaScript would change.
  // A NUL marker is unambiguous after the check above.
  const numbers = [];
  const jsonStringOrNumber = /"(?:[^"\\]|\\.)*"|(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/g;
  const maskedBody = body.replace(jsonStringOrNumber, (token, number) => {
    if (number === undefined || String(Number(number)) === number) return token;
    return '"\\u0000x-adblock:' + (numbers.push(number) - 1) + '"';
  });
  const payload = JSON.parse(maskedBody);
  const changedGraphQL = filterTimeline(payload?.data);
  const changedLegacy = filterTimeline(payload?.timeline);
  if (!changedGraphQL && !changedLegacy) return {};

  const rewrittenBody = JSON.stringify(payload);
  return { body: rewrittenBody.replace(/"\\u0000x-adblock:([0-9]+)"/g, (_, index) => numbers[index]) };
}

let result = {};
try {
  result = filterResponse($response.body);
} catch (_) {
  // Let Shadowrocket deliver the original response if it could not be filtered.
}
$done(result);
