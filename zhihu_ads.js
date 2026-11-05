/*
 * Zhihu ad cleaner for Shadowrocket (http-response script)
 *
 * The script takes a generic approach and does not depend on one fixed JSON layout:
 *   1. It walks the whole JSON tree recursively.
 *   2. It removes array elements that are standalone ad cards in feeds.
 *   3. For normal content items (such as answers in next-render / questions/.../answers),
 *      it keeps the answer item so swiping to the next answer still works, and deletes
 *      only the embedded ad fields (ad_info, adjson, promotion_extra, ...) inside it.
 */

const MAX_DEPTH = 15;

const REQ_URL = typeof $request !== "undefined" && $request && $request.url ? $request.url : "";
const IS_NEXT_ANSWER_URL = /^https?:\/\/api\.zhihu\.com\/next-render\?(?:[^#]*&)?type=answer(?:[&#]|$)/i.test(REQ_URL);
const IS_ANSWER_DETAIL_URL = /^https?:\/\/api\.zhihu\.com\/answers\/v2\/\d+(?:[?#]|$)/i.test(REQ_URL);

// Endpoints that return lists of answers, questions, or comments.
// On these endpoints we must NOT drop answer/comment elements from arrays just because they
// carry an embedded adjson / ad_info for the ad under the answer; we only strip the ad fields.
const IS_ANSWER_LIST_URL = /\/(next-(render|data|bff)|(appview\/)?(api\/)?(v\d\/)?(questions|answers|comment_v5|comments)\b)/i.test(
  REQ_URL
);

// Values of type, card_type, style, etc. that explicitly mark a standalone ad card
const AD_TYPE_RE =
  /(^|[_\-])(ad|ads|advert|adverts|advertisement|promotion)([_\-]|$)|feed_advert|market_card|slot_(video_)?event_card|featured_comment_ad/i;

// Fields that appear on promoted feed cards (and sometimes as embedded ad data on answer objects)
const AD_MARKER_KEYS = ["adjson", "promotion_extra", "ad_extra"];

// Ad-only fields to delete from any object we keep (such as answer-bottom ads or comment-page ad slots)
const AD_STRIP_KEYS = [
  "ad_info",
  "adjson",
  "ad_list",
  "promotion_extra",
  "ad_extra",
  "commercial_info",
  "mobile_banner",
  "ad_track_url",
  "featured_comment_ad",
  "comment_ad",
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

function isNormalContentItem(item) {
  const t = item.type || item.card_type || item.object_type || item.biz_type;
  if (
    typeof t === "string" &&
    /^(answer|question|article|zvideo|pin|comment|next_answer|content|people)$/i.test(t)
  ) {
    return true;
  }
  const targetType = item.target && typeof item.target === "object" ? item.target.type : null;
  if (
    typeof targetType === "string" &&
    /^(answer|question|article|zvideo|pin|comment)$/i.test(targetType)
  ) {
    return true;
  }
  return false;
}

function isAd(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;

  // 1) Type-like fields that explicitly identify a standalone ad card
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

  // 2) The "brief" field is a JSON string, for example {"source":"ad","type":"..."}
  if (typeof item.brief === "string" && /"(type|source)"\s*:\s*"(ad|advert|feed_advert)"/i.test(item.brief)) {
    return true;
  }

  // 3) On answer-list / next-render endpoints, or when the element is an answer/article/comment,
  // never drop the whole element because of adjson/ad_info; let clean() strip those fields instead.
  if (IS_ANSWER_LIST_URL || isNormalContentItem(item)) {
    return false;
  }

  // 4) On feed endpoints (like topstory/recommend), drop feed cards that carry ad markers
  for (const k of AD_MARKER_KEYS) {
    if (nonEmpty(item[k])) return true;
  }
  if (nonEmpty(item.ad_info) && typeof item.ad_info === "object") return true;
  if (item.is_ad === true || item.isAd === true || item.is_promotion === true) return true;

  return false;
}

function isNextAnswerAd(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (isAd(item) || item.is_ad === true || item.isAd === true || item.is_promotion === true) return true;

  const types = item.biz_type_list;
  if (Array.isArray(types) && types.some(typeLooksLikeAd)) return true;

  // Recognized answer rows can carry embedded ad fields. Keep the row so swiping works.
  if (Array.isArray(types) && types.includes("answer")) return false;
  if (isNormalContentItem(item.target || {}) || isNormalContentItem(item.data || {})) return false;
  if (isNormalContentItem(item) && (nonEmpty(item.content) || nonEmpty(item.excerpt))) return false;

  // These markers identify ad rows in the top-level next-render answer stream.
  return nonEmpty(item.adjson) || nonEmpty(item.ad_info && item.ad_info.data);
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
    // The native answer detail carries the card between the answer and comments here.
    if (IS_ANSWER_DETAIL_URL && obj && Object.prototype.hasOwnProperty.call(obj, "third_business")) {
      delete obj.third_business;
      console.log("[Zhihu AdBlock] answer detail: removed third_business");
    }
    if (IS_NEXT_ANSWER_URL && obj && Array.isArray(obj.data)) {
      const before = obj.data.length;
      obj.data = obj.data.filter((item) => !isNextAnswerAd(item));
      console.log("[Zhihu AdBlock] next-render answers: removed " + (before - obj.data.length) + " ad rows");
    }
    const cleaned = clean(obj, 0);
    // Also neutralize any "adjson" hidden inside stringified JSON sub-fields
    const out = JSON.stringify(cleaned).replace(/"adjson"/g, '"adnull"');
    $done({ body: out });
  } catch (e) {
    // Not JSON, or parsing failed: pass the response through unchanged
    console.log("[Zhihu AdBlock] " + (IS_NEXT_ANSWER_URL ? "next-render answers: " : "") + "response passed through after a parse or rewrite error");
    $done({});
  }
})();
