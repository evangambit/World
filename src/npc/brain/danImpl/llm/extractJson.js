/**
 * Extract a JSON object from raw LLM text (plain or fenced).
 *
 * @param {string} text
 * @returns {object}
 */
export function extractJsonObject(text) {
    const trimmed = text.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : trimmed;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('No JSON object found in LLM response');
    }
    return JSON.parse(candidate.slice(start, end + 1));
}
