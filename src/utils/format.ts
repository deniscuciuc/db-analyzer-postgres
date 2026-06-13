export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(2)} KB`;
	if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(2)} MB`;
	return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
	return `${(ms / 60_000).toFixed(2)}m`;
}

export function formatMs(ms: number): string {
	return formatDuration(ms);
}

export function formatNumber(value: number): string {
	return value.toLocaleString("en-US");
}

export function formatPercent(value: number, decimals = 2): string {
	return `${value.toFixed(decimals)}%`;
}
