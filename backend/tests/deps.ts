export { Clarinet, Tx, Chain, types } from 'https://deno.land/x/clarinet@v1.0.3/index.ts';
export type { Account, Block } from 'https://deno.land/x/clarinet@v1.0.3/index.ts';
export { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

import { types } from 'https://deno.land/x/clarinet@v1.0.3/index.ts';

export type PricePackage = {
	prices: { symbol: string, value: any }[],
	timestamp: number
};

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

 export function liteSignatureToStacksSignature(liteSignature:string) {

	let bytes = hexToBytes(liteSignature.slice(2, liteSignature.length))
	if (bytes.length !== 65)
		throw new Error(`Invalid liteSignature, expected 65 bytes got ${bytes.length}`);
	let converted = new Uint8Array(bytes);
	if (converted[64] > 3)
		converted[64] -= 27; // subtract from V
	return converted;
}

function hexToBytes(hex: string) {
    for (var bytes = [], c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return bytes;
}

