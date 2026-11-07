/**
 * X (Twitter) AdBlock Script for Shadowrocket / Surge
 * Removes promoted tweets, ads, and sponsored content from X GraphQL timelines.
 */

if ($response.body) {
    try {
        let obj = JSON.parse($response.body);
        traverseAndClean(obj);
        $done({ body: JSON.stringify(obj) });
    } catch (e) {
        // If JSON parsing fails (or body is not JSON), pass through untouched
        $done({});
    }
} else {
    $done({});
}

/**
 * Checks whether an entry is an ad / promoted content
 */
function isPromoted(item) {
    if (!item) return false;

    // 1. Check entryId prefixes and identifiers
    const entryId = item.entryId || "";
    if (
        entryId.startsWith("promoted-") ||
        entryId.startsWith("promotedTweet-") ||
        entryId.startsWith("promoted_tweet-") ||
        entryId.includes("-promoted-") ||
        entryId.startsWith("google-ad-") ||
        entryId.includes("semantic_core_doc_search_landing_page")
    ) {
        return true;
    }

    // Optional: Uncomment below if you also want to remove "Who to follow" recommendation boxes
    // if (entryId.startsWith("who-to-follow-") || entryId.startsWith("connect-people-")) return true;

    // 2. Check itemContent metadata
    const itemContent = item.item?.itemContent || item.content?.itemContent;
    if (itemContent) {
        if (itemContent.promotedMetadata) return true;

        const result = itemContent.tweet_results?.result;
        if (result) {
            if (result.promotedMetadata) return true;
            if (result.tweet && result.tweet.promotedMetadata) return true;
        }
    }

    return false;
}

/**
 * Filters the instructions array in the timeline payload
 */
function cleanInstructions(instructions) {
    if (!Array.isArray(instructions)) return instructions;

    return instructions.filter(instruction => {
        // TimelineAddEntries (Home, Search, Profile feeds)
        if (instruction.type === "TimelineAddEntries" && Array.isArray(instruction.entries)) {
            instruction.entries = instruction.entries.filter(entry => {
                if (isPromoted(entry)) return false;

                // Handle nested items (grouped tweets / conversation threads)
                if (entry.content && Array.isArray(entry.content.items)) {
                    entry.content.items = entry.content.items.filter(subItem => !isPromoted(subItem));
                    if (entry.content.items.length === 0) return false;
                }
                return true;
            });
        }
        // TimelineAddToModule (Carousels and dynamic card inserts)
        else if (instruction.type === "TimelineAddToModule" && Array.isArray(instruction.moduleItems)) {
            instruction.moduleItems = instruction.moduleItems.filter(item => !isPromoted(item));
        }
        // TimelinePinEntry
        else if (instruction.type === "TimelinePinEntry" && instruction.entry) {
            if (isPromoted(instruction.entry)) {
                return false;
            }
        }
        return true;
    });
}

/**
 * Recursively inspects the JSON payload to find and clean all `instructions` arrays
 */
function traverseAndClean(obj) {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            traverseAndClean(obj[i]);
        }
    } else {
        if (Array.isArray(obj.instructions)) {
            obj.instructions = cleanInstructions(obj.instructions);
        }
        for (const key of Object.keys(obj)) {
            if (key !== "instructions") {
                traverseAndClean(obj[key]);
            }
        }
    }
}
