export function toMicrodegrees(decimal: number): number {
	return Math.trunc(decimal * 1_000_000);
}

export function fromMicrodegrees(micro: number): number {
	return micro / 1_000_000;
}
