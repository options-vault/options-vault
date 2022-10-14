
import { Clarinet, Tx, Chain, Account, types, assertEquals, shiftPriceValue, liteSignatureToStacksSignature,pricePackageToCV } from "./deps.ts";
import type { PricePackage, Block } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";

const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";

function setTrustedOracle(chain: Chain, senderAddress: string): Block {
	return chain.mineBlock([
		Tx.contractCall("options-nft", "set-trusted-oracle", [trustedOraclePubkey, types.bool(true)], senderAddress),
	]);
}

// Clarinet.test({
// 	name: "Contract owner can set trusted oracle",
// 	fn(chain: Chain, accounts: Map<string, Account>) {
// 		const deployer = accounts.get("deployer")!;
// 		const block = setTrustedOracle(chain, deployer.address);
// 		const [receipt] = block.receipts;
// 		receipt.result.expectOk().expectBool(true);
// 		const trusted = chain.callReadOnlyFn("options-nft", "is-trusted-oracle", [trustedOraclePubkey], deployer.address);
// 		const untrusted = chain.callReadOnlyFn("options-nft", "is-trusted-oracle", [untrustedOraclePubkey], deployer.address);
// 		trusted.result.expectBool(true);
// 		untrusted.result.expectBool(false);
// 	},
// });

Clarinet.test({
	name: "Anyone can submit price data signed by trusted oracles",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA] = ["deployer", "wallet_1"].map(who => accounts.get(who)!);

		setTrustedOracle(chain, deployer.address);

		const pricePackage: PricePackage = {
			timestamp: 1647332581, // Tue Mar 15 2022 08:23:01 GMT+0000
			prices: [{ symbol: "STXUSD", value: 2.5 }]
		}

		const packageCV = pricePackageToCV(pricePackage);
		const signature = "0x80517fa7ea136fa54522338145ebcad95f0be7c4d7c43c522fff0f97686d7ffa581d422619ef2c2718471c31f1af6084a03571f93e3e3bde346cedd2ced71f9100";
		// console.log(pricePackage);
		// console.log(packageCV);

		let block = chain.mineBlock([
			Tx.contractCall(
				"options-nft", 
				"submit-price-data", 
				[
					packageCV.timestamp,
					packageCV.prices,
					signature
				], 
				accountA.address
			),
		]);

		block.receipts[0].result.expectOk().expectBool(true);

		const lastSeenTimestamp = chain.callReadOnlyFn(
			"options-nft",
			"get-last-seen-timestamp",
			[],
			accountA.address
		)
		
		assertEquals(lastSeenTimestamp.result, packageCV.timestamp)


		const lastSTXUSDdRate = chain.callReadOnlyFn(
			"options-nft",
			"get-last-stxusd-rate",
			[],
			accountA.address
		)

		assertEquals(lastSTXUSDdRate.result, types.some(types.uint(pricePackage.prices[0].value * 100000000)))


		// block.receipts.result.expectOk().expectBool(true);
		// const print = (event.contract_event.value as string).expectList()[0].expectTuple();
		// assertEquals(types.list([types.tuple(print)]), packageCV.prices);
	},
});


// Clarinet.test({
//     name: "Ensure that can start auction with submit price data",
//     async fn(chain: Chain, accounts: Map<string, Account>) {

//         const wallet_1 = accounts.get('wallet_1')?.address ?? ""
//         //const deployer = accounts.get('deployer')?.address ?? ""


//         let redstone_response = { timestamp: 0, liteEvmSignature:"", value:0}

//         await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
//             redstone_response = response.data[0]
//         });

//         console.log(redstone_response)

// 		const pricePackage: PricePackage = {
// 			timestamp: redstone_response.timestamp,
// 			prices: [{ symbol: "STX", value: redstone_response.value }]
// 		}
// 		const packageCV = pricePackageToCV(pricePackage);


// 		let block = chain.mineBlock([
// 			Tx.contractCall("options-nft", "submit-price-data", [
// 				packageCV.timestamp,
// 				packageCV.prices,
// 				types.buff(liteSignatureToStacksSignature(redstone_response.liteEvmSignature))
// 			], wallet_1)
// 		]);

//         console.log(block.receipts)
//     },
// });

// Clarinet.test({
//     name: "Ensure that get the same signer every call",
//     async fn(chain: Chain, accounts: Map<string, Account>) {

//         const wallet_1 = accounts.get('wallet_1')?.address ?? ""
//         //const deployer = accounts.get('deployer')?.address ?? ""


//         let redstone_response = { timestamp: 0, liteEvmSignature:"", value:0}
//         await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
//             redstone_response = response.data[0]
//         });

//         console.log(redstone_response)

// 		const pricePackage: PricePackage = {
// 			timestamp: redstone_response.timestamp,
// 			prices: [{ symbol: "STX", value: redstone_response.value }]
// 		}
// 		const packageCV = pricePackageToCV(pricePackage);


// 		let block = chain.mineBlock([
// 			Tx.contractCall("options-nft", "recover-signer", [
// 				packageCV.timestamp,
// 				packageCV.prices,
// 				types.buff(liteSignatureToStacksSignature(redstone_response.liteEvmSignature))
// 			], wallet_1)
// 		]);

//         console.log(block.receipts)
//     },
// });