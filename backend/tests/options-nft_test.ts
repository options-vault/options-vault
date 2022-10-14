
import { Clarinet, Tx, Chain, Account, types, assertEquals, shiftPriceValue, liteSignatureToStacksSignature, pricePackageToCV } from "./deps.ts";
import type { PricePackage, Block } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";
import { redstoneDataOneMinApart } from "./redstone-data.ts";

const firstRedstoneTimestamp = redstoneDataOneMinApart[0].timestamp; // timestamp 1/10
const midRedstoneTimestamp = redstoneDataOneMinApart[4].timestamp; // timestamp 5/10
const lastRedstoneTimestamp = redstoneDataOneMinApart[9].timestamp; // timestamp 10/10

const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";

function setTrustedOracle(chain: Chain, senderAddress: string): Block {
	return chain.mineBlock([
		Tx.contractCall("options-nft", "set-trusted-oracle", [trustedOraclePubkey, types.bool(true)], senderAddress),
	]);
}

Clarinet.test({
	name: "Ensure that the contract owner can set trusted oracle",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const deployer = accounts.get("deployer")!;
		const block = setTrustedOracle(chain, deployer.address);
		const [receipt] = block.receipts;
		receipt.result.expectOk().expectBool(true);
		const trusted = chain.callReadOnlyFn("options-nft", "is-trusted-oracle", [trustedOraclePubkey], deployer.address);
		const untrusted = chain.callReadOnlyFn("options-nft", "is-trusted-oracle", [untrustedOraclePubkey], deployer.address);
		trusted.result.expectBool(true);
		untrusted.result.expectBool(false);
	},
});


Clarinet.test({
    name: "Ensure that the price package is signed by the same pubkey on every call",
    async fn(chain: Chain, accounts: Map<string, Account>) {

		const wallet_1 = accounts.get('wallet_1')!.address;

		let redstone_response = { timestamp: 0, liteEvmSignature: "", value: 0 }
		await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
				redstone_response = response.data[0]
		});

		const pricePackage: PricePackage = {
			timestamp: redstone_response.timestamp,
			prices: [{ symbol: "STX", value: redstone_response.value }]
		}
		const packageCV = pricePackageToCV(pricePackage);

		let block = chain.mineBlock([
			Tx.contractCall("options-nft", "recover-signer", [
				packageCV.timestamp,
				packageCV.prices,
				types.buff(liteSignatureToStacksSignature(redstone_response.liteEvmSignature))
			], wallet_1)
		]);

		const signer = block.receipts[0].result.expectOk()
		
		const isTrusted = chain.callReadOnlyFn(
			"options-nft",
			"is-trusted-oracle",
			[signer],
			wallet_1
		)

    assertEquals(isTrusted.result, "true")
    },
});

// Testing submit-price-data

Clarinet.test({
	name: "Ensure that anyone can submit price data signed by trusted oracles",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA] = ["deployer", "wallet_1"].map(who => accounts.get(who)!);
		setTrustedOracle(chain, deployer.address);

		const pricePackage: PricePackage = {
			timestamp: 1647332581, // Tue Mar 15 2022 08:23:01 GMT+0000
			prices: [{ symbol: "STXUSD", value: 2.5 }]
		}
		
		const packageCV = pricePackageToCV(pricePackage);
		const signature = "0x80517fa7ea136fa54522338145ebcad95f0be7c4d7c43c522fff0f97686d7ffa581d422619ef2c2718471c31f1af6084a03571f93e3e3bde346cedd2ced71f9100";

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

// Note: auction-decrement-value is not being set
function initOutofMoneyAuction(chain: Chain, deployerAddress: string): Block {
	
	// Set current-cycle-expiry to midRestoneTimestamp + 10 milliseconds
	let block = chain.mineBlock([
		Tx.contractCall(
			"options-nft", 
			"set-current-cycle-expiry", 
			[types.uint(midRedstoneTimestamp + 10)], 
			deployerAddress
		),
	]);
	assertEquals(block.receipts.length, 1);
	assertEquals(block.height, 2);
	block.receipts[0].result.expectOk().expectBool(true)
	
	// Read current-cycle-expiry from the contract and assertEquals
	const currentCycleExpiry = chain.callReadOnlyFn(
		"options-nft",
		"get-current-cycle-expiry",
		[],
		deployerAddress
	)
	assertEquals(currentCycleExpiry.result, types.utf8(midRedstoneTimestamp + 10))

	// Initialize the auction by making an entry into the options-ledger, setting the price and start-time
	block = chain.mineBlock([
		Tx.contractCall(
			"options-nft", 
			"set-options-ledger-entry", 
			[types.uint(shiftPriceValue(redstoneDataOneMinApart[0].value * 1.15))], // strike = spot + 15% 
			deployerAddress
		),
		Tx.contractCall(
			"options-nft", 
			"set-options-price-in-usd", 
			[types.uint(shiftPriceValue(redstoneDataOneMinApart[0].value * 0.02))], // options-price = spot * 0.5% 
			deployerAddress
		),
		Tx.contractCall(
			"options-nft", 
			"set-auction-start-time", 
			[types.uint(firstRedstoneTimestamp - 10)], // Fri Oct 14 2022 16:10:54 GMT+0000
			deployerAddress
		),
		Tx.contractCall(
			"options-nft", 
			"set-options-for-sale", 
			[types.uint(3)],
			deployerAddress
		),
	]);
	assertEquals(block.receipts.length, 4);
	assertEquals(block.height, 3);
	block.receipts[0].result.expectOk().expectBool(true)
	block.receipts[1].result.expectOk().expectBool(true)
	block.receipts[2].result.expectOk().expectBool(true)
	block.receipts[3].result.expectOk().expectBool(true)

	// Check if the strike was properly set in the options-ledger
	const strikeOptionsLedgerEntry = chain.callReadOnlyFn(
		"options-nft",
		"get-strike-for-expiry",
		[types.uint(midRedstoneTimestamp + 10)],
		deployerAddress
	)
	assertEquals(strikeOptionsLedgerEntry.result.expectOk(), types.uint(shiftPriceValue(redstoneDataOneMinApart[0].value * 1.15)))

	const optionsPrice = chain.callReadOnlyFn(
		"options-nft",
		"get-options-price-in-usd",
		[],
		deployerAddress
	)
	assertEquals(optionsPrice.result.expectSome(), types.utf8(shiftPriceValue(redstoneDataOneMinApart[0].value * 0.02)))

	const auctionStartTime = chain.callReadOnlyFn(
		"options-nft",
		"get-auction-start-time",
		[],
		deployerAddress
	)
	assertEquals(auctionStartTime.result, types.utf8(firstRedstoneTimestamp - 10))

	const optionsForSale = chain.callReadOnlyFn(
		"options-nft",
		"get-options-for-sale",
		[],
		deployerAddress
	)
	assertEquals(optionsForSale.result, types.uint(10))

	console.log('strike', strikeOptionsLedgerEntry.result.expectOk())
	console.log('price', optionsPrice.result.expectSome())
	console.log('auction-start-time', auctionStartTime.result)
	console.log('options-for-sale', optionsForSale.result)
	console.log('expiry', currentCycleExpiry.result)
}

function initMint(chain: Chain, minterAddressA: string, minterAddressB: string): Block {
	const pricePackageA: PricePackage = {
		timestamp: redstoneDataOneMinApart[0].timestamp,
		prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
	}
	const packageCVA = pricePackageToCV(pricePackageA);
	const signatureA = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

	const pricePackageB: PricePackage = {
		timestamp: redstoneDataOneMinApart[1].timestamp,
		prices: [{ symbol: "STX", value: redstoneDataOneMinApart[1].value }]
	}
	const packageCVB = pricePackageToCV(pricePackageB);
	const signatureB = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[1].liteEvmSignature))
	
	let block = chain.mineBlock([
		Tx.contractCall(
			"options-nft",
			"mint",
			[
				packageCVA.timestamp,
				packageCVA.prices,
				signatureA	
			],
			minterAddressA
		),
		Tx.contractCall(
			"options-nft",
			"mint",
			[
				packageCVB.timestamp,
				packageCVB.prices,
				signatureB	
			],
			minterAddressB
		)
	]);
	assertEquals(block.receipts.length, 2);
	// TODO Refactor to use expectSTXTransferEvent() and expectNonFungibleTokenMintEvent()
	block.receipts[0].result.expectOk().expectUint(1)
	assertEquals(block.receipts[0].events[0].type, "stx_transfer_event")
	assertEquals(block.receipts[0].events[1].type, "nft_mint_event")

	block.receipts[1].result.expectOk().expectUint(2)
	assertEquals(block.receipts[1].events[0].type, "stx_transfer_event")
	assertEquals(block.receipts[1].events[1].type, "nft_mint_event")
}


Clarinet.test({
	name: "Ensure that the options-nft auction is properly initialized",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer] = ["deployer"].map(who => accounts.get(who)!);
		initOutofMoneyAuction(chain, deployer.address);
	},
});

Clarinet.test({
	name: "Ensure that the mint function works for the right inputs",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
		initOutofMoneyAuction(chain, deployer.address);
		initMint(chain, accountA.address, accountB.address)
	},
});
