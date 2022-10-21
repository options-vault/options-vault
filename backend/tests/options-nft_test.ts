
import { Clarinet, Tx, Chain, Account, types, assertEquals, stringToUint8Array, shiftPriceValue, liteSignatureToStacksSignature, pricePackageToCV } from "./deps.ts";
import type { PricePackage, Block } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";
import { redstoneDataOneMinApart } from "./redstone-data.ts";
import { PriceDataForContract, simulateTwoDepositsAndProcess, simulateTwoDeposits, initFirstAuction, initMint, setTrustedOracle, submitPriceData, 
	submitPriceDataAndTest, simulateFirstCycleTillExpiry, convertRedstoneToContractData, setCurrentCycleExpiry 
	} from "./init.ts";

const contractOwner = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
const optionsNFTContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.options-nft";

const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";

// Redstone data points for testing (ten, each 1 min apart)
const firstRedstoneTimestamp = redstoneDataOneMinApart[0].timestamp; // timestamp 1/10
const midRedstoneTimestamp = redstoneDataOneMinApart[4].timestamp; // timestamp 5/10
const lastRedstoneTimestamp = redstoneDataOneMinApart[9].timestamp; // timestamp 10/10
const weekInMilliseconds = 604800000;

// Testing constants
const testAuctionStartTime = firstRedstoneTimestamp - 10; 
const testCycleExpiry = midRedstoneTimestamp + 10;
const testOptionsForSale = 3;
const testOptionsUsdPricingMultiplier = 0.02
const testOutOfTheMoneyStrikePriceMultiplier = 1.15 // 15% above spot
const testInTheMoneyStrikePriceMultiplier = 0.8 // 20% below spot

// TEST FIRST AUCTION INITIALZIATION

// Testing first auction initalization outside of init-next-cycle
Clarinet.test({
	name: "Ensure that the options-nft auction is properly initialized",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer] = ["deployer"].map(who => accounts.get(who)!);
		const block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry, 
			'outOfTheMoney', 
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

// TEST MINT

// Testing mint function
Clarinet.test({
	name: "Ensure that the mint function works for the right inputs",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
		let block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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
		assertEquals(stxPriceA.result, types.uint(20000))

		const stxPriceB = chain.callReadOnlyFn(
			"options-nft",
			"usd-to-stx",
			[
				types.uint(shiftPriceValue(testOptionsUsdPricingMultiplier * redstoneDataOneMinApart[0].value)),
				types.uint(shiftPriceValue(redstoneDataOneMinApart[1].value))
			],
			deployer.address
		)
		assertEquals(stxPriceB.result, types.uint(20132))

		assertEquals(block.receipts.length, 2);
		// TODO Refactor to use expectNonFungibleTokenMintEvent()
		block.receipts[0].result.expectOk().expectUint(1)
		block.receipts[0].events.expectSTXTransferEvent(20000, accountA.address, vaultContract)
		// block.receipts[0].events.expectNonFungibleTokenMintEvent(types.uint(1), accountA.address, contractOwner, '.options-nft')
		assertEquals(block.receipts[0].events[1].type, "nft_mint_event")

		block.receipts[1].result.expectOk().expectUint(2)
		block.receipts[1].events.expectSTXTransferEvent(20132, accountB.address, vaultContract)
		assertEquals(block.receipts[1].events[1].type, "nft_mint_event")
	},
});

// TEST SUBMIT PRICE DATA

// Testing submit-price-data (before expiry)
Clarinet.test({
	name: "Ensure that anyone can submit price data signed by trusted oracles before the current-cycle-expiry data",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		// Ensures that the submit-price-data call is always before the expiry date
		// By setting current-cycle-expiry to a date before the date of the redstoneDataPacakge submitted
		setCurrentCycleExpiry(chain, deployer.address, firstRedstoneTimestamp + 10);
		// Check if current-cycle-expiry remains unchaned
		const currentCycleExpiry = chain.callReadOnlyFn(
			"options-nft",
			"get-current-cycle-expiry",
			[],
			deployer.address
		)
		assertEquals(currentCycleExpiry.result, types.uint(firstRedstoneTimestamp + 10))

		// Submit price data with a timestamp before the current-cycle-expiry, no further action should get triggered
		const block = submitPriceData(chain, accountA.address, redstoneDataOneMinApart[0])
    block.receipts[0].result.expectOk().expectBool(true);

		const lastSeenTimestamp = chain.callReadOnlyFn(
			"options-nft",
			"get-last-seen-timestamp",
			[],
			accountA.address
		)
		assertEquals(lastSeenTimestamp.result, types.utf8(redstoneDataOneMinApart[0].timestamp))

		const lastSTXUSDRate = chain.callReadOnlyFn(
			"options-nft",
			"get-last-stxusd-rate",
			[],
			accountA.address
		)
		assertEquals(
			lastSTXUSDRate.result, 
			types.some(types.uint(shiftPriceValue(redstoneDataOneMinApart[0].value)))
		)
	},
});

// Testing submit-price-data (after expiry)
Clarinet.test({
	name: "Ensure that anyone can submit price data signed by trusted oracles after the current-cycle-expiry data",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		const inTheMoneyStrikePrice = shiftPriceValue(redstoneDataOneMinApart[0].value * testInTheMoneyStrikePriceMultiplier)
		const lastestStxusdRate = shiftPriceValue(redstoneDataOneMinApart[5].value)
		const expectedOptionsPnlUSD = lastestStxusdRate - inTheMoneyStrikePrice

		let block = simulateTwoDepositsAndProcess(chain, accounts)
		const totalBalances = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		assertEquals(totalBalances.result, types.uint(3000000))

		// Initialize the first auction; the strike price is in-the-money (below spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'inTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Mint two option NFTs
		block = initMint(
			chain, 
			accountA.address, 
			accountB.address, 
			redstoneDataOneMinApart
		)
		assertEquals(block.receipts.length, 2);
		
		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);
	}
})

// TEST TRANSITION-TO-NEXT-CYCLE

// Test transition-to-next-cycle function for an out-of-the-money option
Clarinet.test({
	name: "Ensure that the transition-to-next-cycle function works for an out-of-the-money option",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
		
		let block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		const currentCycleExpiry = chain.callReadOnlyFn(
			"options-nft",
			"get-current-cycle-expiry",
			[],
			deployer.address
		)
		assertEquals(currentCycleExpiry.result, types.uint(testCycleExpiry + weekInMilliseconds))
	}
})

// Test transition-to-next-cycle function for an in-the-money option
Clarinet.test({
	name: "Ensure that the end-current-cycle function works for an in-the-money option",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		const inTheMoneyStrikePrice = shiftPriceValue(redstoneDataOneMinApart[0].value * testInTheMoneyStrikePriceMultiplier)
		const lastestStxusdRate = shiftPriceValue(redstoneDataOneMinApart[5].value)
		const expectedOptionsPnlUSD = lastestStxusdRate - inTheMoneyStrikePrice

		let block = simulateTwoDepositsAndProcess(chain, accounts)
		const totalBalances = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		assertEquals(totalBalances.result, types.uint(3000000))

		// Initialize the first auction; the strike price is in-the-money (below spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'inTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Mint two option NFTs
		block = initMint(
			chain, 
			accountA.address, 
			accountB.address, 
			redstoneDataOneMinApart
		)
		assertEquals(block.receipts.length, 2);
		
		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// We read the options-pnl from the on-chain ledger
		const optionsPnlSTXFromLedger = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		)
		// And compare the on-chain ledger entry to the number we would expect from our input values
		assertEquals(
			optionsPnlSTXFromLedger.result.expectOk().expectSome(), 
			types.uint(Math.floor(expectedOptionsPnlUSD / lastestStxusdRate * 1000000))
		)
	}
})

// TEST DETERMINE-VALUE

// Test determine-value function for an out-of-the-money option (OTM)
Clarinet.test({
	name: "Ensure that the determine-value function works for an out-of-the-money option",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
		
		let block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// We read the options-pnl from the on-chain ledger
		const optionsPnlSTXFromLedger = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		)
		// And compare the on-chain ledger entry to the number we would expect from our input values
		assertEquals(
			optionsPnlSTXFromLedger.result.expectOk().expectSome(), 
			types.uint(0)
		)
	}
})

// Test determine-value function for an in-the-money option (ITM)
Clarinet.test({
	name: "Ensure that the determine-value function works for an in-the-money option",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		const inTheMoneyStrikePrice = shiftPriceValue(redstoneDataOneMinApart[0].value * testInTheMoneyStrikePriceMultiplier)
		const lastestStxusdRate = shiftPriceValue(redstoneDataOneMinApart[5].value)
		const expectedOptionsPnlUSD = lastestStxusdRate - inTheMoneyStrikePrice

		let block = simulateTwoDepositsAndProcess(chain, accounts)
		const totalBalances = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		assertEquals(totalBalances.result, types.uint(3000000))

		// Initialize the first auction; the strike price is in-the-money (below spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'inTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Mint two option NFTs
		block = initMint(
			chain, 
			accountA.address, 
			accountB.address, 
			redstoneDataOneMinApart
		)
		assertEquals(block.receipts.length, 2);
		
		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// We read the options-pnl from the on-chain ledger
		const optionsPnlSTXFromLedger = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		)
		// And compare the on-chain ledger entry to the number we would expect from our input values
		assertEquals(
			optionsPnlSTXFromLedger.result.expectOk().expectSome(), 
			types.uint(Math.floor(expectedOptionsPnlUSD / lastestStxusdRate * 1000000))
		)
	}
})

// Test that add-to-options-ledger-list (called by determin-value) correctly adds the expired cycle's information to the list
Clarinet.test({
	name: "Ensure that add-to-options-ledger-list (called by determin-value) correctly adds the expired cycle's information to the list",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		let block = simulateTwoDepositsAndProcess(chain, accounts)
		const totalBalances = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		assertEquals(totalBalances.result, types.uint(3000000))

		// Initialize the first auction; the strike price is in-the-money (below spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'inTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Mint two option NFTs
		block = initMint(
			chain, 
			accountA.address, 
			accountB.address, 
			redstoneDataOneMinApart
		)
		assertEquals(block.receipts.length, 2);
		
		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// We read the options-ledger-list from the on-chain contract
		const optionsLedgerList = chain.callReadOnlyFn(
			"options-nft",
			"get-options-ledger-list",
			[],
			deployer.address
		)
		// And expect the result to be a list
		optionsLedgerList.result.expectList()
		// And expect the first entry to contain the testCycleExpiry timestamp
		assertEquals(optionsLedgerList.result.expectList()[0].includes(testCycleExpiry), true)
	}
})

// TEST CREATE-SETTLEMENT-POOL

// Test create-settlement-pool for OTM
Clarinet.test({
	name: "Ensure that the create-settlement-pool function works for an out-of-the-money option",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
		
		let block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// We read the total-settlement-pool from the vault contract
		const totalSettlementPool = chain.callReadOnlyFn(
			"vault",
			"get-total-settlement-pool",
			[],
			deployer.address
		)
		assertEquals(totalSettlementPool.result, types.uint(0))
	}
})

// Test create-settlment-pool for ITM
Clarinet.test({
	name: "Ensure that the create-settlement-pool function works for an in-the-money option",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		const inTheMoneyStrikePrice = shiftPriceValue(redstoneDataOneMinApart[0].value * testInTheMoneyStrikePriceMultiplier)
		const lastestStxusdRate = shiftPriceValue(redstoneDataOneMinApart[5].value)
		const expectedOptionsPnlUSD = lastestStxusdRate - inTheMoneyStrikePrice

		let block = simulateTwoDepositsAndProcess(chain, accounts)
		const totalBalances = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		assertEquals(totalBalances.result, types.uint(3000000))

		// Initialize the first auction; the strike price is in-the-money (below spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'inTheMoney', 
			redstoneDataOneMinApart
		);
		assertEquals(block.receipts.length, 5);

		// Mint two option NFTs
		block = initMint(
			chain, 
			accountA.address, 
			accountB.address, 
			redstoneDataOneMinApart
		)
		assertEquals(block.receipts.length, 2);
		
		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// We read the total-settlement-pool from the vault contract
		const totalSettlementPool = chain.callReadOnlyFn(
			"vault",
			"get-total-settlement-pool",
			[],
			deployer.address
		)
		assertEquals(totalSettlementPool.result, types.uint(Math.floor(expectedOptionsPnlUSD / lastestStxusdRate * 1000000) * 2))
	}
})

// TEST SET-TRUSTED-ORACLE

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

// TEST RECOVER-SIGNER

// Testing recover-signer - price package is signed by the same pubkey on every call
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