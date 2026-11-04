/*
 * Zhihu ad cleaner for Shadowrocket (http-response script)
 *
 * The script takes a generic approach and does not depend on one fixed JSON layout:
 *   1. It walks the whole JSON tree recursively.
 *   2. It removes any array element that looks like an ad card.
 *   3. It deletes ad-only fields (ad_info, adjson, promotion_extra, ...) from the remaining objects.
 * This keeps the script working when Zhihu moves ad cards between endpoints.
 */

const MAX_DEPTH = 15;

// Values of type, card_type, style, etc. that mark an ad card
const AD_TYPE_RE =
  /(^|[_\-])(ad|ads|advert|adverts|advertisement|promotion)([_\-]|$)|feed_advert|market_card|slot_(video_)?event_card/i;

// Fields that only appear on ad or promoted cards. If an array element has one of these, the element is dropped.
const AD_MARKER_KEYS = ["adjson", "promotion_extra", "ad_extra"];

// Fields to delete from any object we keep (for example, comment-page ad slots or answer-bottom ads)
const AD_STRIP_KEYS = [
  "ad_info",
  "adjson",
  "ad",
  "ads",
  "ad_list",
  "promotion_extra",
  "ad_extra",
  "commercial_info",
  "mobile_banner",
];

function nonEmpty(v) {
  if (v === null || v === undefined || v === false || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function typeLooksLikeAd(v) {
  return typeof v === "string" && AD_TYPE_RE.test(v);
}

function isAd(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;

  // 1) Type-like fields
  if (
    typeLooksLikeAd(item.type) ||
    typeLooksLikeAd(item.card_type) ||
    typeLooksLikeAd(item.style) ||
    typeLooksLikeAd(item.object_type) ||
    typeLooksLikeAd(item.biz_type)
  ) {
    return true;
  }
  if (item.extra && typeof item.extra === "object" && typeLooksLikeAd(item.extra.type)) {
    return true;
  }
  if (item.target && typeof item.target === "object" && typeLooksLikeAd(item.target.type)) {
    return true;
  }

  // 2) Marker fields that only ad or promoted cards have
  for (const k of AD_MARKER_KEYS) {
    if (nonEmpty(item[k])) return true;
  }
  if (nonEmpty(item.ad_info) && typeof item.ad_info === "object") return true;
  if (item.is_ad === true || item.isAd === true || item.is_promotion === true) return true;

  // 3) The "brief" field is a JSON string, for example {"source":"ad","type":"..."}
  if (typeof item.brief === "string" && /"(type|source)"\s*:\s*"(ad|advert|feed_advert)"/i.test(item.brief)) {
    return true;
  }

  return false;
}

function clean(node, depth) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    const out = [];
    for (const el of node) {
      if (isAd(el)) continue;
      out.push(clean(el, depth + 1));
    }
    return out;
  }

  for (const k of AD_STRIP_KEYS) {
    if (k in node) delete node[k];
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") node[k] = clean(v, depth + 1);
  }
  return node;
}

(function main() {
  const body = $response && $response.body;
  if (!body) return $done({});
  try {
    const obj = JSON.parse(body);
    const cleaned = clean(obj, 0);
    $done({ body: JSON.stringify(cleaned) });
  } catch (e) {
    // Not JSON, or parsing failed: pass the response through unchanged
    console.log("[Zhihu AdBlock] skip: " + ($request ? $request.url : "") + " -> " + e);
    $done({});
  }
})();
