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

// Endpoints that return lists of answers, questions, or comments.
// On these endpoints we must NOT drop answer/comment elements from arrays just because they
// carry an embedded adjson / ad_info for the ad under the answer; we only strip the ad fields.
const IS_ANSWER_LIST_URL = /\/(next-(render|data|bff)|(appview\/)?(api\/)?(v\d\/)?(questions|answers|comment_v5|comments)\b)/i.test(
  REQ_URL
);

// Values of type, card_type, style, biz_type, content_type, etc. that identify an ad card
const AD_TYPE_RE =
  /(^|[_\-])(ad|ads|advert|adverts|advertisement|promotion|commercial|brand|sponsor|sponsored|ecommerce)([_\-]|$)|feed_advert|market_card|slot_(video_)?event_card|featured_comment_ad|ad_card|common_ad|commercial_card|brand_card/i;

const TYPE_KEYS = [
  "type",
  "card_type",
  "style",
  "style_type",
  "object_type",
  "biz_type",
  "biz_type_str",
  "content_type",
  "sub_type",
  "feed_type",
  "template_type",
  "item_type",
];

// Keys whose non-empty presence inside a card (outside promotion_extra / ad_extra) marks an ad card
const AD_CARD_KEYS = [
  "adjson",
  "za_ad_info",
  "ad_drop_info",
  "commercial_info",
  "commercial_data",
  "commercial_report",
  "brand_info",
  "ad_track_url",
  "impression_tracks",
  "view_tracks",
  "click_tracks",
  "conversion_tracks",
  "autoplay_tracks",
  "video_tracks",
  "ad_zone_id",
  "creative_id",
  "advertiser_id",
  "app_promotion_url",
  "sk_ad_network",
];

// UI badge/label keys that display the "广告" mark on native/feed ad cards
const BADGE_TEXT_KEYS = [
  "label",
  "badge",
  "mark",
  "sign",
  "type_description",
  "ad_source",
  "sub_title",
  "sub_text",
  "tail_text",
  "right_text",
  "left_text",
  "header_text",
  "footer_text",
  "tag",
  "text",
  "content",
  "title",
  "desc",
  "description",
];

const AD_BADGE_VALUE_RE = /^[·•\s]*(广告|品牌广告|商业推广)[·•\s]*$/;

// String patterns inside serialized sub-fields (e.g. brief, attached_info, render_data, tracking URLs)
const AD_STRING_RE =
  /"(adjson|za_ad_info|ad_drop_info|commercial_info|impression_tracks|click_tracks|conversion_tracks|ad_zone_id|creative_id|advertiser_id|sk_ad_network|app_promotion_url)"\s*:|"(type|source|biz_type|card_type|content_type|sub_type)"\s*:\s*"(ad|ads|advert|feed_advert|commercial|promotion|brand_ad|ad_card|market_card)"|"(label|badge|mark|sign|type_description|ad_source|tag|text|sub_title)"\s*:\s*"[·•\s]*(广告|品牌广告|商业推广)[·•\s]*"|(miaozhen\.com|xelements\.cn|gdt\.qq\.com|ugdtimg\.com|gdtimg\.com|tanx\.com|pangolin-sdk-toutiao|kuaishouzt\.com|kwaizt\.com)/i;

// Ad-only fields to delete from any object we keep
const AD_STRIP_KEYS = [
  "ad_info",
  "adjson",
  "ad",
  "ads",
  "ad_list",
  "ad_drop_info",
  "za_ad_info",
  "promotion_extra",
  "ad_extra",
  "commercial_info",
  "commercial_data",
  "commercial_report",
  "brand_info",
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

function isRealAdInfo(v) {
  if (!nonEmpty(v) || typeof v !== "object" || Array.isArray(v)) return false;
  if (v.is_ad === false || v.ad_type === 0) return false;
  return true;
}

function hasAdBadge(node) {
  if (node.type === "topic" || node.type === "people" || "url_token" in node || "avatar_url" in node || "question" in node) {
    return false;
  }
  for (const k of BADGE_TEXT_KEYS) {
    const v = node[k];
    if (typeof v === "string" && v.length <= 12 && AD_BADGE_VALUE_RE.test(v)) {
      return true;
    }
  }
  return false;
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

// Recursively inspects a candidate feed/render card (up to depth 7) for ad signatures,
// while skipping promotion_extra / ad_extra so normal answers in next-render are never dropped.
function containsAdMarker(node, depth) {
  if (depth > 7 || !node || typeof node !== "object") return false;

  if (Array.isArray(node)) {
    for (const el of node) {
      if (typeof el === "string" && AD_STRING_RE.test(el)) return true;
      if (el && typeof el === "object" && containsAdMarker(el, depth + 1)) return true;
    }
    return false;
  }

  for (const k of TYPE_KEYS) {
    if (typeLooksLikeAd(node[k])) return true;
  }

  if (node.is_ad === true || node.isAd === true || node.is_commercial === true) return true;
  if (isRealAdInfo(node.ad_info)) return true;
  if (nonEmpty(node.ad) && typeof node.ad === "object") return true;
  if (Array.isArray(node.ads) && node.ads.length > 0) return true;

  for (const k of AD_CARD_KEYS) {
    if (nonEmpty(node[k])) return true;
  }

  if (hasAdBadge(node)) return true;

  for (const k of Object.keys(node)) {
    // Normal answers in next-render carry promotion_extra / ad_extra; do not use them to drop answers
    if (k === "promotion_extra" || k === "ad_extra") continue;
    const v = node[k];
    if (typeof v === "string") {
      if (v.length > 6 && AD_STRING_RE.test(v)) return true;
    } else if (v && typeof v === "object") {
      if (containsAdMarker(v, depth + 1)) return true;
    }
  }

  return false;
}

function isAd(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;

  // 1) Check the card and its nested structure (e.g. next-render native cards, question feeds, home feed)
  if (containsAdMarker(item, 0)) {
    return true;
  }

  // 2) On pure feed endpoints (like topstory/recommend), also drop non-content cards with promotion_extra / ad_extra
  if (!IS_ANSWER_LIST_URL && !isNormalContentItem(item)) {
    if (nonEmpty(item.promotion_extra) || nonEmpty(item.ad_extra) || item.is_promotion === true) {
      return true;
    }
  }

  return false;
}

function clean(node, depth) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    const out = [];
    for (const el of node) {
      // Only drop whole card elements at the feed/list level (depth <= 3)
      if (depth <= 3 && isAd(el)) continue;
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
    // Also neutralize any "adjson" hidden inside stringified JSON sub-fields
    const out = JSON.stringify(cleaned).replace(/"adjson"/g, '"adnull"');
    $done({ body: out });
  } catch (e) {
    // Not JSON, or parsing failed: pass the response through unchanged
    console.log("[Zhihu AdBlock] skip: " + REQ_URL + " -> " + e);
    $done({});
  }
})();
