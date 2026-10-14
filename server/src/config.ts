// Request-size limits (MB), configurable via environment variables.
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);
export const MAX_RESTORE_MB = Number(process.env.MAX_RESTORE_MB || 1024);
