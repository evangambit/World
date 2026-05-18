/**
 * Pull a JSON object string from model output (raw JSON or fenced blocks).
 * @param {string} text
 * @returns {string}
 */
export function extractJsonFromText(text) {
    const trimmed = text.trim();
    if (!trimmed) return trimmed;

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return trimmed;
    }

    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) return fence[1].trim();

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return trimmed.slice(start, end + 1);
    }

    return trimmed;
}
