
import { Clarinet, Tx, Chain, Account, types, assertEquals, shiftPriceValue, liteSignatureToStacksSignature, pricePackageToCV } from "./deps.ts";
import type { PricePackage, Block } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";
import { redstoneDataOneMinApart } from "./redstone-data.ts";
import { createTwoDepositorsAndProcess, initAuction, initMint, setTrustedOracle } from "./init.ts";

const contractOwner = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
const optionsNFTContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.options-nft";

const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";

// Redstone data points for testing (ten, each 1 min apart)
const firstRedstoneTimestamp = redstoneDataOneMinApart[0].timestamp; // timestamp 1/10
const midRedstoneTimestamp = redstoneDataOneMinApart[4].timestamp; // timestamp 5/10
const lastRedstoneTimestamp = redstoneDataOneMinApart[9].timestamp; // timestamp 10/10

// Testing constants
const testAuctionStartTime = firstRedstoneTimestamp - 10; 
const testCycleExpiry = midRedstoneTimestamp + 10;
const testOptionsForSale = 3;
const testOptionsUsdPricingMultiplier = 0.02

const testOutOfTheMoneyStrikePriceMultiplier = 1.15
const testInTheMoneyStrikPriceMultiplier = 0.8

// Testing setting trusted oracle

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

// Testing recover-signer

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
// TODO: Why does the filter in submit-price-data work but not in mint?
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

// Testing auction initalization outside of init-next-cycle

Clarinet.test({
	name: "Ensure that the options-nft auction is properly initialized",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer] = ["deployer"].map(who => accounts.get(who)!);
		const block = initAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry, 
			testOutOfTheMoneyStrikePriceMultiplier, 
			redstoneDataOneMinApart
		);

	assertEquals(block.receipts.length, 5);
	assertEquals(block.height, 2);
	block.receipts.forEach(el => el.result.expectOk().expectBool(true))

	const currentCycleExpiry = chain.callReadOnlyFn(
		"options-nft",
		"get-current-cycle-expiry",
		[],
		deployer.address
	)
	assertEquals(currentCycleExpiry.result, types.utf8(testCycleExpiry))

	// Check if the strike was properly set in the options-ledger
	const strikeOptionsLedgerEntry = chain.callReadOnlyFn(
		"options-nft",
		"get-strike-for-expiry",
		[types.uint(testCycleExpiry)],
		deployer.address
	)
	assertEquals(strikeOptionsLedgerEntry.result.expectOk(), types.uint(shiftPriceValue(redstoneDataOneMinApart[0].value * testOutOfTheMoneyStrikePriceMultiplier)))

	const optionsPrice = chain.callReadOnlyFn(
		"options-nft",
		"get-options-price-in-usd",
		[],
		deployer.address
	)
	assertEquals(optionsPrice.result.expectSome(), types.utf8(shiftPriceValue(redstoneDataOneMinApart[0].value * testOptionsUsdPricingMultiplier)))

	const auctionStartTime = chain.callReadOnlyFn(
		"options-nft",
		"get-auction-start-time",
		[],
		deployer.address
	)
	assertEquals(auctionStartTime.result, types.utf8(testAuctionStartTime))

	const optionsForSale = chain.callReadOnlyFn(
		"options-nft",
		"get-options-for-sale",
		[],
		deployer.address
	)
	assertEquals(optionsForSale.result, types.uint(testOptionsForSale))

	// console.log('strike', strikeOptionsLedgerEntry.result.expectOk())
	// console.log('price', optionsPrice.result.expectSome())
	// console.log('auction-start-time', auctionStartTime.result)
	// console.log('options-for-sale', optionsForSale.result)
	// console.log('expiry', currentCycleExpiry.result)
	},
});

// Testing mint function

Clarinet.test({
	name: "Ensure that the mint function works for the right inputs",
	async fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
		let block = initAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			testOutOfTheMoneyStrikePriceMultiplier, 
			redstoneDataOneMinApart
		);		
		
		block = initMint(
			chain, 
			accountA.address, 
			accountB.address, 
			redstoneDataOneMinApart
		)

		const stxPriceA = chain.callReadOnlyFn(
			"options-nft",
			"usd-to-stx",
			[
				types.uint(shiftPriceValue(testOptionsUsdPricingMultiplier * redstoneDataOneMinApart[0].value)),
				types.uint(shiftPriceValue(redstoneDataOneMinApart[0].value))
			],
			deployer.address
		)
		assertEquals(stxPriceA.result, types.uint(2000000))

		const stxPriceB = chain.callReadOnlyFn(
			"options-nft",
			"usd-to-stx",
			[
				types.uint(shiftPriceValue(testOptionsUsdPricingMultiplier * redstoneDataOneMinApart[0].value)),
				types.uint(shiftPriceValue(redstoneDataOneMinApart[1].value))
			],
			deployer.address
		)
		assertEquals(stxPriceB.result, types.uint(2013262))

		assertEquals(block.receipts.length, 2);
		// TODO Refactor to use expectNonFungibleTokenMintEvent()
		block.receipts[0].result.expectOk().expectUint(1)
		block.receipts[0].events.expectSTXTransferEvent(2000000, accountA.address, vaultContract)
		// block.receipts[0].events.expectNonFungibleTokenMintEvent(types.uint(1), accountA.address, contractOwner, '.options-nft')
		assertEquals(block.receipts[0].events[1].type, "nft_mint_event")

		block.receipts[1].result.expectOk().expectUint(2)
		block.receipts[1].events.expectSTXTransferEvent(2013262, accountB.address, vaultContract)
		assertEquals(block.receipts[1].events[1].type, "nft_mint_event")
	},
});

