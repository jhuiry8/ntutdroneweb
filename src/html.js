import sanitizeHtml from 'sanitize-html';

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

export function safeUrl(value) {
    const url = String(value ?? '').trim();
    try {
        const parsed = new URL(url, 'https://local.invalid');
        return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? url : '#';
    } catch { return '#'; }
}

// Apply at render time so legacy KV content receives the same protection.
export function sanitizeContent(html) {
    return sanitizeHtml(String(html ?? ''), {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
        allowedAttributes: {
            a: ['href', 'title'],
            img: ['src', 'alt', 'title', 'width', 'height'],
            code: ['class']
        },
        allowedSchemes: ['https', 'http', 'mailto'],
        allowedSchemesByTag: { img: ['https', 'http'] },
        allowProtocolRelative: false,
        parseStyleAttributes: false
    });
}

export function sanitizeInline(html) {
    return sanitizeHtml(String(html ?? ''), {
        allowedTags: ['br', 'strong', 'b', 'em', 'i', 'u', 'span'],
        allowedAttributes: { span: ['class'] },
        parseStyleAttributes: false
    });
}
