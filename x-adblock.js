// Shadowrocket HTTP response script for X timeline JSON.

function isPromoted(node) {
  if (!node || typeof node !== "object") return false;

  const id = node.entryId ?? node.entry_id;
  if (typeof id === "string" && /(?:^|-)promoted(?:-|$)/i.test(id)) return true;
  if (node.promotedMetadata || node.promoted_metadata || node.promoted_content) return true;

  // Inspect only item wrappers. Quoted posts and module items are separate.
  return ["content", "item", "itemContent", "item_content", "tweet"]
    .some(key => isPromoted(node[key]));
}

function filterResponse(body) {
  if (typeof body !== "string") return {};

  const payload = JSON.parse(body);
  let changed = false;

  // Return true only when filtering emptied an existing list.
  function filterList(owner, key, keep) {
    const list = owner?.[key];
    if (!Array.isArray(list)) return false;

    const kept = list.filter(keep);
    if (kept.length === list.length) return false;

    owner[key] = kept;
    changed = true;
    return kept.length === 0;
  }

  function keepEntry(entry) {
    if (isPromoted(entry)) return false;

    // GraphQL and legacy URT use different wrappers for grouped replies.
    const content = entry?.content;
    if (filterList(content, "items", item => !isPromoted(item))) return false;
    return !filterList(content?.timelineModule, "items", item => !isPromoted(item));
  }

  function keepInstruction(instruction) {
    if (!instruction || typeof instruction !== "object") return true;

    const update = instruction.addEntries ?? instruction.replaceEntry
      ?? instruction.pinEntry ?? instruction.addToModule ?? instruction;
    if (update.entry && !keepEntry(update.entry)) return false;

    filterList(update, "entries", keepEntry);
    return !filterList(update, "moduleItems", item => !isPromoted(item));
  }

  function filterTimeline(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;

    if (Array.isArray(node.instructions)) {
      filterList(node, "instructions", keepInstruction);
      return;
    }

    for (const value of Object.values(node)) filterTimeline(value);
  }

  filterTimeline(payload?.data);
  filterTimeline(payload?.timeline);

  return changed ? { body: JSON.stringify(payload) } : {};
}

let result = {};
try {
  result = filterResponse($response.body);
} catch (_) {
  // Let Shadowrocket deliver the original response if it could not be filtered.
}
$done(result);
