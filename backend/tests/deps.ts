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

 export function liteSignatureToStacksSignature(liteSignature:string) {
	let bytes = hexToByte(liteSignature)
	bytes = bytes.slice(1, bytes.length)
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

function hexToByte(hex: string) {
	const key = hex
	let newBytes = []
	let currentChar = 0
	let currentByte = 0
	for (let i=0; i<hex.length; i++) {   // Go over two 4-bit hex chars to convert into one 8-bit byte
	  currentChar = key.indexOf(hex[i])
	  if (i%2===0) { // First hex char
		currentByte = (currentChar << 4) // Get 4-bits from first hex char
	  }
	  if (i%2===1) { // Second hex char
		currentByte += (currentChar)     // Concat 4-bits from second hex char
		newBytes.push(currentByte)       // Add byte
	  }
	}
	return new Uint8Array(newBytes)
  }