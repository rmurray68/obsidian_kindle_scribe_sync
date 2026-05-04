/**
 * File utility functions
 */

/** Sanitize file/folder names to prevent path traversal and invalid characters */
export const sanitizeFileName = (name: string): string => {
    return name
        .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid filesystem characters
        .replace(/\.\./g, '_')            // Prevent path traversal
        .replace(/^\.+/, '_')             // Don't start with dots
        .trim()
        .slice(0, 200);                   // Limit length
};
