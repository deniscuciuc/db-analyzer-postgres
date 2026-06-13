export function printSection(title: string): void {
	console.log(`\n━━━ ${title} ━━━`);
}

export function printRow(label: string, value: string | number): void {
	console.log(`  ${label}: ${value}`);
}

export function printBullet(line: string): void {
	console.log(`  • ${line}`);
}

export function printSubBullet(line: string): void {
	console.log(`    ${line}`);
}

export function printSeparator(): void {
	console.log("");
}

export function healthEmoji(score: number): string {
	if (score >= 90) return "🟢";
	if (score >= 70) return "🟡";
	if (score >= 50) return "🟠";
	return "🔴";
}

export function healthLabel(score: number): string {
	if (score >= 90) return "Excellent";
	if (score >= 70) return "Good";
	if (score >= 50) return "Warning";
	return "Critical";
}
