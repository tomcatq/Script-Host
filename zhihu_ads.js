/*
 * Zhihu ad cleaner for Shadowrocket (http-response script)
 *
 * Question and answer navigation uses the original IDs and pagination data.
 * Strip embedded ad fields and remove standalone cards from the supported lists.
 */

const MAX_DEPTH = 15;

const REQ_URL = typeof $request !== "undefined" && $request && $request.url ? $request.url : "";
const IS_NEXT_ROUTE = /^https?:\/\/api\.zhihu\.com\/next-(?:render|data|bff)(?:[?#]|$)/i.test(REQ_URL);
const IS_ANSWER_DETAIL_URL = /^https?:\/\/api\.zhihu\.com\/answers\/v2\/\d+(?:[?#]|$)/i.test(REQ_URL);
const QUESTION_ROUTE = /^https?:\/\/(?:api|www)\.zhihu\.com\/(?:appview\/)?(?:api\/)?(?:v\d+\/)?questions\/\d+(?:\/(answers|feeds))?\/?(?:[?#]|$)/i.exec(REQ_URL);
const IS_QUESTION_ANSWERS = Boolean(QUESTION_ROUTE && QUESTION_ROUTE[1]);
const IS_NAVIGATION = IS_NEXT_ROUTE || IS_ANSWER_DETAIL_URL || Boolean(QUESTION_ROUTE);

// Endpoints that return lists of answers, questions, or comments.
// On these endpoints we must NOT drop answer/comment elements from arrays just because they
// carry an embedded adjson / ad_info for the ad under the answer; we only strip the ad fields.
const IS_ANSWER_LIST_URL = /\/(next-(render|data|bff)|(appview\/)?(api\/)?(v\d\/)?(questions|answers|comment_v5|comments)\b)/i.test(
  REQ_URL
);

// Values of type, card_type, style, etc. that explicitly mark a standalone ad card
const AD_TYPE_RE =
  /(^|[_\-])(ad|ads|advert|adverts|advertisement|promotion)([_\-]|$)|feed_advert|market_card|slot_(video_)?event_card|featured_comment_ad/i;

// Fast pre-check on the raw response string so clean responses skip regex tokenization and JSON.parse altogether
const FAST_MAY_HAVE_AD_RE =
  /"(ad_info|adjson|ad_list|promotion_extra|ad_extra|commercial_info|mobile_banner|ad_track_url|featured_comment_ad|comment_ad|third_business|is_ad|isAd|is_promotion|biz_type_list)"|"(type|card_type|style|object_type|biz_type|resource_type|source)"\s*:\s*"[^"]*(ad|advert|promotion|market_card|event_card)/i;

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

function hasStandaloneAdType(item) {
  return Boolean(item && typeof item.type === "string" && /^(ad|ads|advert|advertisement|feed_advert|market_card)$/i.test(item.type));
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
  if (hasStandaloneAdType(item)) return true;

  const types = item.biz_type_list;
  if (Array.isArray(types) && types.includes("answer")) return false;
  // Answer references and guides can carry promotion metadata alongside navigation data.
  if (item.answer_id || item.next_answer_id || item.answer || item.next_guide) return false;
  const content = [item, item.target, item.data, item.origin_data];
  if (content.some((entry) => entry && isNormalContentItem(entry))) return false;

  const origin = item.origin_data;
  if (origin && (typeLooksLikeAd(origin.type) || typeLooksLikeAd(origin.resource_type))) return true;
  if (isAd(item) || item.is_ad === true || item.isAd === true || item.is_promotion === true) return true;
  if (Array.isArray(types) && types.some(typeLooksLikeAd)) return true;
  return nonEmpty(item.adjson) || nonEmpty(item.ad_info && item.ad_info.data);
}

function clean(node, depth, edits) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    const out = [];
    for (const el of node) {
      if (!IS_NAVIGATION && isAd(el)) {
        edits.changed = true;
        continue;
      }
      out.push(clean(el, depth + 1, edits));
    }
    return out;
  }

  for (const k of AD_STRIP_KEYS) {
    if (k in node) {
      delete node[k];
      edits.changed = true;
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") node[k] = clean(v, depth + 1, edits);
  }
  return node;
}

function rewriteResponse(body) {
  const firstChar = body.trimStart()[0];
  if (firstChar !== "{" && firstChar !== "[") return;
  if (!FAST_MAY_HAVE_AD_RE.test(body)) return;

  // Keep long numeric IDs (16+ digits) exact when rewriting JSON in Shadowrocket's JavaScript engine.
  // Only scan if a 16+ digit JSON value is actually present, and anchor on JSON value delimiters
  // (:, [, ,) so decimals like 0.1234567890123456 are never corrupted.
  const longIntegers = [];
  const prefix = "zhihu-integer-" + Math.random().toString(36).slice(2) + "-";
  const json = /[:,\[]\s*-?\d{16,}\s*[,\]\}]/.test(body)
    ? body.replace(/"[^"\\]*(?:\\[\s\S][^"\\]*)*"|([:,\[]\s*)(-?\d{16,})(?=\s*[,\]\}])/g, (token, sep, intToken) => {
        if (!intToken) return token;
        const index = longIntegers.push(intToken) - 1;
        return sep + '"' + prefix + index + '"';
      })
    : body;
  const obj = JSON.parse(json);
  if (!obj || typeof obj !== "object") return;

  const edits = { changed: false };
  if (IS_ANSWER_DETAIL_URL && Object.prototype.hasOwnProperty.call(obj, "third_business")) {
    delete obj.third_business;
    edits.changed = true;
    console.log("[Zhihu AdBlock] answer detail: removed third_business");
  }
  if (IS_NEXT_ROUTE || IS_QUESTION_ANSWERS) {
    // Keep the list in its original envelope, including pagination on either level.
    const container = Array.isArray(obj.data) ? obj : obj.data;
    if (container && Array.isArray(container.data)) {
      // Question-list rows are used to navigate. Remove only explicitly typed ads there.
      const isAdRow = IS_NEXT_ROUTE ? isNextAnswerAd : hasStandaloneAdType;
      const filtered = container.data.filter((item) => !isAdRow(item));
      const removed = container.data.length - filtered.length;
      const hasMore = [container.paging, obj.paging].some((paging) => paging && (paging.next || paging.is_end === false));
      // An empty page can end scrolling even when the server supplied a continuation.
      if (removed && (filtered.length || !hasMore)) {
        container.data = filtered;
        edits.changed = true;
        console.log("[Zhihu AdBlock] answer list: removed " + removed + " ad rows");
      }
    }
  }
  clean(obj, 0, edits);
  if (!edits.changed) return;
  if (!longIntegers.length) return JSON.stringify(obj);
  const placeholder = new RegExp('"' + prefix + '(\\d+)"', "g");
  return JSON.stringify(obj).replace(placeholder, (_, index) => longIntegers[index]);
}

(function main() {
  const body = $response && $response.body;
  if (!body) return $done({});
  try {
    const out = rewriteResponse(body);
    $done(out === undefined ? {} : { body: out });
  } catch (e) {
    // Not JSON, or parsing failed: pass the response through unchanged
    console.log("[Zhihu AdBlock] response passed through after a parse or rewrite error");
    $done({});
  }
})();
