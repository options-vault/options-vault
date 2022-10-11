export { Clarinet, Tx, Chain, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
export type { Account, Block } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
export { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

import { types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';

export type PricePackage = {
	prices: { symbol: string, value: any }[],
	timestamp: number
};

// One day Clarinet may be able to import actual project source files so we
// can stop repeating code.

export function shiftPriceValue(value: number) {
	return Math.round(value * (10 ** 8))
}

export function stringToUint8Array(input: string) {
	let codePoints = [];
	for (let i = 0; i < input.length; ++i)
		codePoints.push(input.charCodeAt(i));
	return new Uint8Array(codePoints);
}

export function pricePackageToCV(pricePackage: PricePackage) {
	return {
		timestamp: types.uint(pricePackage.timestamp),
		prices: types.list(
			pricePackage.prices.map((entry: { symbol: string, value: any }) => types.tuple({
				symbol: types.buff(stringToUint8Array(entry.symbol)),
				value: types.uint(shiftPriceValue(entry.value))
			}))
		)
	};
}