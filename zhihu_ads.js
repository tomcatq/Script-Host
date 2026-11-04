Conversation Log
f you add the module by U… how can i load an module from an link?

Here is how to host Zhihu_AdBlock.sgmodule and add it by URL in Shadowrocket:

1. Get a Raw URL for the module
Upload Zhihu_AdBlock.sgmodule to the same place you hosted zhihu_ads.js (such as a GitHub repo, GitHub Gist, or Gitee).
Open the file on the website and click the Raw button.
Copy the URL from your browser's address bar. It should look like a direct plain-text link:
GitHub repo: https://raw.githubusercontent.com/<user>/<repo>/main/Zhihu_AdBlock.sgmodule
GitHub Gist: https://gist.githubusercontent.com/<user>/<gist-id>/raw/Zhihu_AdBlock.sgmodule
(Make sure you copy the Raw link, not the normal github.com/.../blob/... webpage link.)
2. Load the link in Shadowrocket
Open Shadowrocket and go to the Config (配置) tab at the bottom.
Tap Modules (模块) near the top.
Tap the + icon in the top-right corner.
Paste your Raw URL into the input box and tap OK. Shadowrocket will download and enable it automatically.
Swipe left on your old local copy of the module and Delete it so you don't have two copies running.
3. Updating it in the future

Whenever you edit the .sgmodule or .js file online, go to Config → Modules in Shadowrocket and either:

Swipe left on the module → tap Update (更新), or
Tap the refresh icon (↻) at the top right to update all linked modules at once.
now it seems that Splash ads were gone, but ads under each answer still existed and  now I couldn't swipe down to next answer of the same question.

That symptom points directly to a bug in my script, plus a missing endpoint pattern in the module. I have updated both zhihu_ads.js and Zhihu_AdBlock.sgmodule.

Why this happened
Why you couldn't swipe down to the next answer: When you swipe down on an answer, Zhihu fetches an array of the next answers (next-render / questions/.../answers). Inside each answer object in that array, Zhihu attaches an ad_info or adjson field for the ad at the bottom of that answer. In the previous version of isAd(), any array item containing ad_info or adjson was treated as a standalone ad card and deleted in its entirety—so the script was deleting the next answers themselves instead of keeping the answers and only stripping ad_info / adjson from inside them.
Why the ad under the first answer still showed up:
The [Script] regex in Zhihu_AdBlock.sgmodule matched v4/questions/.../answers, but did not match single-answer endpoints ((v4/)?answers/... or www.zhihu.com/api/v4/...).
Your last log also showed Zhihu connecting to an IPv6 HTTPDNS server ([240c:409f:1000::4:0:a5]:443) and a secondary IPv4 HTTPDNS server (106.13.244.173:443) that weren't blocked yet.
What I changed
zhihu_ads.js: Added isNormalContentItem() and IS_ANSWER_LIST_URL so the script never drops answer/article/comment items from an array—it keeps the answer so swiping down works, and only deletes the embedded ad_info / adjson / ad_extra fields inside it.
Zhihu_AdBlock.sgmodule:
Blocked the remaining HTTPDNS ranges (182.61.194.0/24, 106.13.244.173/32, 240c:409f::/32).
Expanded the [Script] pattern to also match (v4/)?answers/ and www.zhihu.com.
What to do next
Upload the new zhihu_ads.js and Zhihu_AdBlock.sgmodule (remember to keep your own script-path= URL in the module).
Update the module in Shadowrocket (Config → Modules → Update), then force-quit and reopen Zhihu.
Check if swiping down to the next answer works again and whether the ad under each answer is gone. If the ad under an answer still appears, record a short .db capture while opening an answer and scrolling to that ad, and send it to me.
it worked. but this time, there was still an ads between the first answer of each question and its coment section. can you solve it?

The fact that the 2nd, 3rd, and 4th answers are now clean while only the first answer has an ad right above its comment section narrows down the cause to three specific places. I've updated both Zhihu_AdBlock.sgmodule and zhihu_ads.js to cover them.

Why only the first answer had that ad
Background preloading (entry=preload-topstory): While you scroll the feed, Zhihu preloads the first answer of visible cards in the background via www.zhihu.com/appview/v2/answer/...?entry=preload-topstory before you tap it.
Featured comment ad endpoint (featured-comment-ad & /v4/comment_v5): The ad slot between the first answer and its comment section is often fetched via .../comments/featured-comment-ad or /v4/comment_v5/.... Previously, comment_v5 in the [Script] regex did not have (v\d\/)? in front of it, so /v4/comment_v5/... wasn't matched.
Stringified "adjson" on /questions/{id}: On the initial question/answer load, Zhihu sometimes embeds "adjson" inside a stringified JSON sub-field rather than a top-level object key.
What I changed
Zhihu_AdBlock.sgmodule:
Added [URL Rewrite] rules to reject .../comments/featured-comment-ad and background preloaded answer views (entry=(preload-topstory|preload-search|preload-subscription)).
Broadened the [Script] pattern to match (appview/)?(api/)?(v\d/)?(questions|answers|comment_v5|comments)\b and prague/.
zhihu_ads.js:
Added featured_comment_ad and comment_ad to the stripped keys.
Added .replace(/"adjson"/g, '"adnull"') on the output JSON string so "adjson" is neutralized even when nested inside a stringified JSON property.
Next step
Upload the updated Zhihu_AdBlock.sgmodule (with your script-path=) and zhihu_ads.js.
Swipe → Update on the module in Shadowrocket, then force-quit and reopen Zhihu.

If that ad above the comment section on the first answer still shows up, start Data recording, tap into a question to make that ad appear, and send me the .db file—now that api.zhihu.com is decrypted in your logs, the exact URL serving that slot will be visible in plain text.

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
