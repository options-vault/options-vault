
import { Clarinet, Tx, Chain, Account, types, assertEquals, shiftPriceValue, liteSignatureToStacksSignature, pricePackageToCV } from "./deps.ts";
import { PricePackage } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";
import { redstoneDataOneMinApart } from "./redstone-data.ts";
import { simulateTwoDepositsAndProcess, initFirstAuction, initMint, setTrustedOracle, submitPriceData, 
	submitPriceDataAndTest, convertRedstoneToContractData, setCurrentCycleExpiry } from "./init.ts";

// Define contract constants
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
const optionsNFTContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.options-nft";
const optionsNFTAssetIdentifier = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.options-nft::options-nft";

const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";

// Redstone data points for testing (ten, each 1 min apart)
const firstRedstoneTimestamp = redstoneDataOneMinApart[0].timestamp; // timestamp 1/10
const midRedstoneTimestamp = redstoneDataOneMinApart[4].timestamp; // timestamp 5/10
const minuteInMilliseconds = 60000;
const weekInMilliseconds = 604800000;

// Testing constants
const testAuctionStartTime = firstRedstoneTimestamp - 10; 
const testCycleExpiry = midRedstoneTimestamp + 10;
const testOptionsForSale = 3;
const testOptionsUsdPricingMultiplier = 0.02
const testOutOfTheMoneyStrikePriceMultiplier = 1.15 // 15% above spot
const testInTheMoneyStrikePriceMultiplier = 0.8 // 20% below spot

// ### TEST FIRST AUCTION INITIALZIATION

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
	},
});

// ### TEST SUBMIT PRICE DATA

// Testing submit-price-data (before expiry)
Clarinet.test({
	name: "Ensure that anyone can submit price data signed by trusted oracles BEFORE the current-cycle-expiry data",
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
	name: "Ensure that anyone can submit price data signed by trusted oracles AFTER the current-cycle-expiry data",
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
	}
})

// ### TEST TRANSITION-TO-NEXT-CYCLE

// Test transition-to-next-cycle function for an out-of-the-money option
Clarinet.test({
	name: "Ensure that the transition-to-next-cycle (out-of-the-money) correctly sets the next cycles expiry",
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
	name: "Ensure that transition-to-next-cycle (in-the-money) correctly sets the option-pnl",
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

		// We read the options-pnl from the vault ledger
		const optionsPnlSTXFromLedger = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		)
		// And compare the vault ledger entry to the number we would expect from our input values
		assertEquals(
			optionsPnlSTXFromLedger.result.expectOk().expectSome(), 
			types.uint(Math.floor(expectedOptionsPnlUSD / lastestStxusdRate * 1000000))
		)
	}
})

// ### TEST DETERMINE-VALUE

// Test determine-value function for an out-of-the-money option (OTM)
Clarinet.test({
	name: "Ensure that determine-value (out-of-the-money) correctly sets option-pnl to zero",
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
	name: "Ensure that determine-value (in-the-money option) correctly sets option-pnl",
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

		// We read the options-pnl from the vault ledger
		const optionsPnlSTXFromLedger = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		)
		// And compare the vault ledger entry to the number we would expect from our input values
		assertEquals(
			optionsPnlSTXFromLedger.result.expectOk().expectSome(), 
			types.uint(Math.floor(expectedOptionsPnlUSD / lastestStxusdRate * 1000000))
		)
	}
})

// Test that add-to-options-ledger-list (called by determin-value) correctly adds the expired cycle's information to the list
Clarinet.test({
	name: "Ensure that add-to-options-ledger-list (called by determine-value) correctly adds expired cycle's information to the options-ledger-list",
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

// ### TEST CREATE-SETTLEMENT-POOL

// Test create-settlement-pool for OTM
Clarinet.test({
	name: "Ensure that create-settlement-pool (out-of-the-money) does NOT create a settlement-pool",
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

		// Read the total-settlement-pool from the vault contract
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
	name: "Ensure that create-settlement-pool (in-the-money) correctly creates a settlement-pool",
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

		// Read the total-settlement-pool from the vault contract
		const totalSettlementPool = chain.callReadOnlyFn(
			"vault",
			"get-total-settlement-pool",
			[],
			deployer.address
		)
		// Check if a settlement-pool with the appropriate size (options-pnl for both minted NFTs) was created
		assertEquals(
			totalSettlementPool.result, 
			types.uint(Math.floor(expectedOptionsPnlUSD / lastestStxusdRate * 1000000) * 2)
		)
	}
})

// ### TEST UPDATE-VAULT-LEDGER

// Test update-vault-ledger OTM --> total-balances goes up, by mint amount
Clarinet.test({
	name: "Ensure that update-vault-ledger (out-of-the-money) correclty increases total-balances",
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

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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

		const totalBalancesNew = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		const totalBalanceNewNum = Number(totalBalancesNew.result.slice(1))
		const totalBalanceNum = Number(totalBalances.result.slice(1))
		// Check if the total-balances variable has increased 
		assertEquals(totalBalanceNewNum > totalBalanceNum, true)
	}
})

// Test update-vault-ledger ITM --> total-balances goes down, goes down by settlement-pool
Clarinet.test({
	name: "Ensure that update-vault-ledger (in-the-money) correctly decreases total-balances",
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

		const totalBalancesNew = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		const totalBalanceNewNum = Number(totalBalancesNew.result.slice(1))
		const totalBalanceNum = Number(totalBalances.result.slice(1))
		// Check if the total-balances variable has decreased 
		assertEquals(totalBalanceNewNum < totalBalanceNum, true)
	}
})

// ### TEST DISTRIBUTE-PNL

// Test distribute-pnl OTM --> investor-balance for accountA goes up
Clarinet.test({
	name: "Ensure that distribute-pnl (out-of-the-money) increases the investor's account balance",
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

		// Read investor A's balance in the vault ledger after the deposit has been processed
		const investorABalance = chain.callReadOnlyFn(
			"vault",
			"get-investor-balance",
			[types.principal(accountA.address)],
			deployer.address
		)

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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

		const premiumOne = Number(block.receipts[0].events[0].stx_transfer_event.amount)
		const premiumTwo = Number(block.receipts[1].events[0].stx_transfer_event.amount)

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		// Read investor A's new balance after the positive pnl has been distributed to the two investors
		const investorABalanceNew = chain.callReadOnlyFn(
			"vault",
			"get-investor-balance",
			[types.principal(accountA.address)],
			deployer.address
		)
		
		// Convert the balances from Clarity uint type to a Javascript number
		const investorABalanceNewNum = Number(investorABalanceNew.result.expectSome().slice(1))
		const investorABalanceNum = Number(investorABalance.result.expectSome().slice(1))

		// Check if the new balance after the PNL distribution is higher than the one before
		assertEquals(investorABalanceNewNum > investorABalanceNum, true)
		// Check if the right amount has been distributed to investor A
		// Since he deposited 1 STX and the total vault balance is 3 STX, he should receive 1/3rd of the profit
		assertEquals(
			investorABalanceNewNum, 
			investorABalanceNum + Math.floor(((premiumOne + premiumTwo) / 3))
		)
	}
})

// Test distribute-pnl ITM --> investor-balance for acccountA goes down
Clarinet.test({
	name: "Ensure that distribute-pnl (in-the-money) decreases the investor's account balance",
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

		// Read investor A's balance in the vault ledger after the deposit has been processed
		const investorABalance = chain.callReadOnlyFn(
			"vault",
			"get-investor-balance",
			[types.principal(accountA.address)],
			deployer.address
		)

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

		// Convert the premium payments from the mint transaction to JS numbers
		const premiumOne = Number(block.receipts[0].events[0].stx_transfer_event.amount);
		const premiumTwo = Number(block.receipts[1].events[0].stx_transfer_event.amount);
		const premiumTotal = premiumOne + premiumTwo;

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5]);
		block.receipts[0].result.expectOk().expectBool(true);

		// Read investor A's new balance after the positive pnl has been distributed to the two investors
		const investorABalanceNew = chain.callReadOnlyFn(
			"vault",
			"get-investor-balance",
			[types.principal(accountA.address)],
			deployer.address
		);

		// Read the options-pnl from the vault ledger
		const optionsPnlSTXFromLedger = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		);
		// Convert option-pnl to JS number
		const optionsPnlSTXFromLedgerNum = Number(optionsPnlSTXFromLedger.result.expectOk().expectSome().slice(1));
		
		// Convert the balances from Clarity uint type to a Javascript number
		const investorABalanceNewNum = Number(investorABalanceNew.result.expectSome().slice(1));
		const investorABalanceNum = Number(investorABalance.result.expectSome().slice(1));

		// Check if the new balance after the PNL distribution is LOWER than the one before
		assertEquals(investorABalanceNewNum < investorABalanceNum, true);
		
		// Check if the right amount has been distributed to investor A
		// Since he deposited 1 STX and the total vault balance is 3 STX, he should incur 1/3rd of the loss
		// We add a third of the premiumTotal because investor A is still entitled to 1/3rd of the proceeds from selling the NFTs
		assertEquals(
			investorABalanceNewNum, 
			Math.floor(investorABalanceNum + premiumTotal / 3 - (optionsPnlSTXFromLedgerNum * 2  / 3))
		);
	}
})

// ### TEST UPDATE-OPTIONS-LEDGER

// Test update-options-ledger OTM --> entry for next-cycle expiry exists, strike set correctly, first-token-id 3, option-pnl none
Clarinet.test({
	name: "Ensure that update-options-ledger (out-of-the-money) correctly sets a new entry in the options-ledger",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		let block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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

		const testNextCycleExpiry = testCycleExpiry + weekInMilliseconds

		// get options-ledger entry
		const optionsLedgerEntry = chain.callReadOnlyFn(
			"options-nft",
			"get-options-ledger-entry",
			[types.uint(testNextCycleExpiry)],
			deployer.address
		)
		
		// Check if value is a tuple
		optionsLedgerEntry.result.expectOk().expectTuple()
		// Check that strike is set correctly
		assertEquals(
			optionsLedgerEntry.result.expectOk().expectTuple().strike, 
			types.uint(shiftPriceValue(redstoneDataOneMinApart[5].value) * testOutOfTheMoneyStrikePriceMultiplier)
		)
		// Check that first-token-id is 3
		assertEquals(optionsLedgerEntry.result.expectOk().expectTuple()["first-token-id"], types.uint(3))
		// Check that first-token-id is 3
		assertEquals(optionsLedgerEntry.result.expectOk().expectTuple()["last-token-id"], types.uint(3))
		// Check that option-pnl is none
		optionsLedgerEntry.result.expectOk().expectTuple()["option-pnl"].expectNone()
	}
})

// Test update-options-ledger ITM --> entry for next-cycle expiry exists, strike not eq to zero, first-token-id 3, option-pnl none
Clarinet.test({
	name: "Ensure that update-options-ledger (in-the-money) correctly sets a new entry in the options-ledger",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		let block = initFirstAuction(
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

		const testNextCycleExpiry = testCycleExpiry + weekInMilliseconds

		// Get options-ledger entry
		const optionsLedgerEntry = chain.callReadOnlyFn(
			"options-nft",
			"get-options-ledger-entry",
			[types.uint(testNextCycleExpiry)],
			deployer.address
		)
		
		// Check if value is a tuple
		optionsLedgerEntry.result.expectOk().expectTuple()
		// Check that strike is set correctly
		assertEquals(
			optionsLedgerEntry.result.expectOk().expectTuple().strike, 
			types.uint(shiftPriceValue(redstoneDataOneMinApart[5].value) * testOutOfTheMoneyStrikePriceMultiplier)
		)
		// Check that first-token-id is 3
		assertEquals(optionsLedgerEntry.result.expectOk().expectTuple()["first-token-id"], types.uint(3))
		// Check that first-token-id is 3
		assertEquals(optionsLedgerEntry.result.expectOk().expectTuple()["last-token-id"], types.uint(3))
		// Check that option-pnl is none
		optionsLedgerEntry.result.expectOk().expectTuple()["option-pnl"].expectNone()
	}
})

// ### TEST INIT-AUCTION

// Test init-auction (OTM) --> sets auction-start-time to expiry + 120min, sets options-for-sale to 3, sets auction-decrement-value to 2% of options-price-in-usd
Clarinet.test({
	name: "Ensure that init-auction (out-of-the-money) correctly initializes a new auction",
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

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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

		const expectedAuctionStartTime = testCycleExpiry + 120 * minuteInMilliseconds

		// Check auction start time
		const newAuctionStartTime = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-start-time",
			[],
			deployer.address
		)
		assertEquals(newAuctionStartTime.result, types.uint(expectedAuctionStartTime))

		// Check auction-decrement-value
		const newAuctionDecrementVaule = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-decrement-value",
			[],
			deployer.address
		)

		const newOptionsPriceInUSD = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const newOptionsPriceInUSDNum = Number(newOptionsPriceInUSD.result.expectSome().slice(1))
		assertEquals(newAuctionDecrementVaule.result, types.uint(newOptionsPriceInUSDNum * 0.02))

		// Check options-for-sale
		const optionsForSale = chain.callReadOnlyFn(
			"options-nft",
			"get-options-for-sale",
			[],
			deployer.address
		)

		const totalBalancesNew = chain.callReadOnlyFn(
			"vault",
			"get-total-balances",
			[],
			deployer.address
		)
		const totalBalancesNewNum = Number(totalBalancesNew.result.slice(1))
		assertEquals(optionsForSale.result, types.uint(Math.floor(totalBalancesNewNum / 1000000)))
	}
})

// ### TEST SET-OPTIONS-PRICE

// Test set-options-price --> sets options-price-in-usd to 0.5% of the stxusd-rate
Clarinet.test({
	name: "Ensure that set-options-price (out-of-the-money) correctly sets options-price-in-usd to 2% of the stxusd-rate",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
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

		// Check that the options-price-in-usd was set to 0.5% of the stxusd-rate provided to the contract
		const newOptionsPriceInUSD = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const newOptionsPriceInUSDNum = Number(newOptionsPriceInUSD.result.expectSome().slice(1))
		assertEquals(newOptionsPriceInUSDNum, shiftPriceValue(redstoneDataOneMinApart[5].value) * 0.005)
	}
})

// ### TEST MINT

// Testing mint for correct inputs --> expects STX Transfer and Mint event
Clarinet.test({
	name: "Ensure that mint (out-of-the-money) properly works for the correct inputs",
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
		block.receipts[0].result.expectOk().expectUint(1)
		block.receipts[0].events.expectSTXTransferEvent(20000, accountA.address, vaultContract)
		assertEquals(block.receipts[0].events[1].type, "nft_mint_event")

		block.receipts[1].result.expectOk().expectUint(2)
		block.receipts[1].events.expectSTXTransferEvent(20132, accountB.address, vaultContract)
		assertEquals(block.receipts[1].events[1].type, "nft_mint_event")
	},
});

// Test mint for ERR_UNTRUSTED_ORACLE (u111)
Clarinet.test({
	name: "Ensure that mint (out-of-the-money) produces ERR_UNTRUSTED_ORACLE if called with untrusted data",
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

		// Corrupt the signed price data by subtracting 0.1 USD from the value property 
		const corruptedPriceData = redstoneDataOneMinApart[0].value - 0.1

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: corruptedPriceData }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])
		block.receipts[0].result.expectErr().expectUint(111);
	}
});

// Test mint for ERR_AUCTION_CLOSED (u118)
Clarinet.test({
	name: "Ensure that mint (out-of-the-money) produces ERR_AUCTION_CLOSED if called outside the auction window",
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

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		// Change the auction-start-time to 240 min in the PAST --> now it is closed
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp - 240 * minuteInMilliseconds)],
				deployer.address
			)
		])

		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])
		block.receipts[0].result.expectErr().expectUint(118);

		// Change the auction-start-time to 240 min in the FUTURE --> now it is closed
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp + 240 * minuteInMilliseconds)],
				deployer.address
			)
		])

		const auctionStartTimeFuture = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-start-time",
			[],
			deployer.address
		)
		assertEquals(auctionStartTimeFuture.result, types.uint(redstoneDataOneMinApart[0].timestamp + 240 * minuteInMilliseconds))

		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])
		block.receipts[0].result.expectErr().expectUint(118);
	}
});

// Test mint for ERR_OPTIONS_SOLD_OUT (u119)
Clarinet.test({
	name: "Ensure that mint (out-of-the-money) produces ERR_OPTIONS_SOLD_OUT if a user tries to buy more options than available",
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

		const optionsForSale = chain.callReadOnlyFn(
			"options-nft",
			"get-options-for-sale",
			[],
			deployer.address
		)

		const optionsForSaleNum = Number(optionsForSale.result.slice(1))

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      ),
			Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      ),
			Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      ),
			Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])
		// Expect the 4th contract call to the mint function to return (err u119)
		block.receipts[optionsForSaleNum].result.expectErr().expectUint(119)
	}
});

// ### TEST UPDATE-OPTIONS-PRICE-IN-USD

// Test upate-options-price-in-usd for timestamp 15min after auction-start-time --> options-price-in-usd should be unchanged
Clarinet.test({
	name: "Ensure that update-options-price-in-usd (out-of-the-money) does not change options-price-in-usd if mint called less than 30 min after auction-start-time",
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

		// Read options-price-in-usd
		const optionsPriceInUSDOne = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		// Change the auction-start-time to 15 min in the PAST 
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp - 15 * minuteInMilliseconds)],
				deployer.address
			)
		])

		// Mint NFT
		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])

		// Read options-price-in-usd
		const optionsPriceInUSDTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		assertEquals(optionsPriceInUSDOne.result, optionsPriceInUSDTwo.result)
	}
});

// Test update-options-price-in-usd for timestamp 45 min after auction-start-time --> options-price-in-usd should be 2% lower
Clarinet.test({
	name: "Ensure that update-options-price-in-usd (out-of-the-money) reduces options-price-in-usd by 2% if mint called more than 30 min after auction-start-time",
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

		// Read options-price-in-usd
		const optionsPriceInUSDOne = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDOneNum = Number(optionsPriceInUSDOne.result.expectSome().slice(1))

		// Set the auction-decrement-value to 2% of the options-price-in-usd
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-decrement-value",
				[],
				deployer.address
			)
		])

		// Read the auctionDecrementValue
		const auctionDecrementValue = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-decrement-value",
			[],
			deployer.address
		)
		const auctionDecrementValueNum = Number(auctionDecrementValue.result.slice(1))
		assertEquals(auctionDecrementValue.result, types.uint(optionsPriceInUSDOneNum * 0.02))

		// Read auction-applied-decrements
		const auctionAppliedDecrementsOne = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsOne.result, types.uint(0))

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		// Change the auction-start-time to 45 min in the PAST 
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp - 45 * minuteInMilliseconds)],
				deployer.address
			)
		])

		// Mint NFT
		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])

		// Read options-price-in-usd
		const optionsPriceInUSDTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDTwoNum = Number(optionsPriceInUSDTwo.result.expectSome().slice(1))
		assertEquals(optionsPriceInUSDTwoNum, optionsPriceInUSDOneNum - 1 * auctionDecrementValueNum)

		// Read auction-applied-decrements
		const auctionAppliedDecrementsTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsTwo.result, types.uint(1))
	}
});

// Test update-options-price-in-usd for timestamp 45 min after auction-start-time for a SECOND time --> options-price-in-usd should be 2% lower
Clarinet.test({
	name: "Ensure that update-options-price-in-usd (out-of-the-money) reduces options-price-in-usd by 2% if mint called more than 30 min after auction-start-time, even if called TWICE",
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

		// Read options-price-in-usd
		const optionsPriceInUSDOne = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDOneNum = Number(optionsPriceInUSDOne.result.expectSome().slice(1))

		// Set the auction-decrement-value to 2% of the options-price-in-usd
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-decrement-value",
				[],
				deployer.address
			)
		])

		// Read the auctionDecrementValue
		const auctionDecrementValue = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-decrement-value",
			[],
			deployer.address
		)
		const auctionDecrementValueNum = Number(auctionDecrementValue.result.slice(1))
		assertEquals(auctionDecrementValue.result, types.uint(optionsPriceInUSDOneNum * 0.02))

		// Read auction-applied-decrements
		const auctionAppliedDecrementsOne = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsOne.result, types.uint(0))

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		// Change the auction-start-time to 45 min in the PAST 
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp - 45 * minuteInMilliseconds)],
				deployer.address
			)
		])

		// First mint
		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])

		// Second mint
		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])

		// Read options-price-in-usd
		const optionsPriceInUSDTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDTwoNum = Number(optionsPriceInUSDTwo.result.expectSome().slice(1))
		assertEquals(optionsPriceInUSDTwoNum, optionsPriceInUSDOneNum - 1 * auctionDecrementValueNum)

		// Read auction-applied-decrements
		const auctionAppliedDecrementsTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsTwo.result, types.uint(1))

	}
});

// Test update-options-price-in-usd for timestamp 75 min after auction-start-time --> options-price-in-usd should be 4% lower
Clarinet.test({
	name: "Ensure that update-options-price-in-usd (out-of-the-money) reduces options-price-in-usd by 4% if mint called more than 60 min after auction-start-time",
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

		// Read options-price-in-usd
		const optionsPriceInUSDOne = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDOneNum = Number(optionsPriceInUSDOne.result.expectSome().slice(1))

		// Set the auction-decrement-value to 2% of the options-price-in-usd
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-decrement-value",
				[],
				deployer.address
			)
		])

		// Read the auctionDecrementValue
		const auctionDecrementValue = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-decrement-value",
			[],
			deployer.address
		)
		const auctionDecrementValueNum = Number(auctionDecrementValue.result.slice(1))
		assertEquals(auctionDecrementValue.result, types.uint(optionsPriceInUSDOneNum * 0.02))

		// Read auction-applied-decrements
		const auctionAppliedDecrementsOne = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsOne.result, types.uint(0))

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		// Change the auction-start-time to 75 min in the PAST 
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp - 75 * minuteInMilliseconds)],
				deployer.address
			)
		])

		// Mint NFT
		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])

		// Read options-price-in-usd
		const optionsPriceInUSDTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDTwoNum = Number(optionsPriceInUSDTwo.result.expectSome().slice(1))
		assertEquals(optionsPriceInUSDTwoNum, optionsPriceInUSDOneNum - 2 * auctionDecrementValueNum)

		// Read auction-applied-decrements
		const auctionAppliedDecrementsTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsTwo.result, types.uint(2))
	}
});

// Test update-options-price-in-usd for timestamp 165 min after auction-start-time --> options-price-in-usd should be 10% lower
Clarinet.test({
	name: "Ensure that update-options-price-in-usd (out-of-the-money) reduces options-price-in-usd by 10% if mint called more than 150 min after auction-start-time",
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

		// Read options-price-in-usd
		const optionsPriceInUSDOne = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDOneNum = Number(optionsPriceInUSDOne.result.expectSome().slice(1))

		// Set the auction-decrement-value to 2% of the options-price-in-usd
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-decrement-value",
				[],
				deployer.address
			)
		])

		// Read the auctionDecrementValue
		const auctionDecrementValue = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-decrement-value",
			[],
			deployer.address
		)
		const auctionDecrementValueNum = Number(auctionDecrementValue.result.slice(1))
		assertEquals(auctionDecrementValue.result, types.uint(optionsPriceInUSDOneNum * 0.02))

		// Read auction-applied-decrements
		const auctionAppliedDecrementsOne = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsOne.result, types.uint(0))

		const pricePackage: PricePackage = {
			timestamp: redstoneDataOneMinApart[0].timestamp,
			prices: [{ symbol: "STX", value: redstoneDataOneMinApart[0].value }]
		}
		const packageCV = pricePackageToCV(pricePackage)
		const signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[0].liteEvmSignature))

		// Change the auction-start-time to 75 min in the PAST 
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"set-auction-start-time",
				[types.uint(redstoneDataOneMinApart[0].timestamp - 165 * minuteInMilliseconds)],
				deployer.address
			)
		])

		// Mint NFT
		block = chain.mineBlock([
      Tx.contractCall(
        "options-nft",
        "mint",
        [
          packageCV.timestamp,
          packageCV.prices,
          signature	
        ],
        accountA.address
      )
		])

		// Read options-price-in-usd
		const optionsPriceInUSDTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-options-price-in-usd",
			[],
			deployer.address
		)
		const optionsPriceInUSDTwoNum = Number(optionsPriceInUSDTwo.result.expectSome().slice(1))
		assertEquals(optionsPriceInUSDTwoNum, optionsPriceInUSDOneNum - 5 * auctionDecrementValueNum)

		// Read auction-applied-decrements
		const auctionAppliedDecrementsTwo = chain.callReadOnlyFn(
			"options-nft",
			"get-auction-applied-decrements",
			[],
			deployer.address
		)
		assertEquals(auctionAppliedDecrementsTwo.result, types.uint(5))
	}
});

// ### TEST CLAIM

// Test claim (out-of-the-money) --> (ok true), no STX transfer
Clarinet.test({
	name: "Ensure that claim (out-of-the-money) works but does not send a STX transfer",
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

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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
		// console.log(block.receipts)
		assertEquals(block.receipts.length, 2);

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		const { timestamp, price, signature } = convertRedstoneToContractData(redstoneDataOneMinApart[6])

		// Call claim for accountA and token-id u1
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"claim",
				[
					types.uint(1), 
					timestamp,
					price,
					signature
				],
				accountA.address
			)
		])
		block.receipts[0].result.expectOk().expectBool(true)
		assertEquals(block.receipts[0].events, [])
	}
})

// Test claim (in-the-money) --> (ok true), NFT transfer AND STX transfer
Clarinet.test({
	name: "Ensure that claim (in-the-money) sends the NFT to the contract and STX to the tx-sender",
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

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
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
		// console.log(block.receipts)
		assertEquals(block.receipts.length, 2);

		// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger transition-to-next-cycle
		block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
		block.receipts[0].result.expectOk().expectBool(true);

		const { timestamp, price, signature } = convertRedstoneToContractData(redstoneDataOneMinApart[6])

		// Call claim for accountA and token-id u1
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"claim",
				[
					types.uint(1), 
					timestamp,
					price,
					signature
				],
				accountA.address
			)
		])
		// Check if the contract call was successful
		block.receipts[0].result.expectOk().expectBool(true)
		// Check that the NFT was transferred from tx-sender to the options-nft contract
		assertEquals(block.receipts[0].events[0].type, "nft_transfer_event") 
		assertEquals(block.receipts[0].events[0]["nft_transfer_event"].asset_identifier, optionsNFTAssetIdentifier) 
		assertEquals(block.receipts[0].events[0]["nft_transfer_event"].value, types.uint(1))
		assertEquals(block.receipts[0].events[0]["nft_transfer_event"].sender, accountA.address) 
		assertEquals(block.receipts[0].events[0]["nft_transfer_event"].recipient, optionsNFTContract)
		
		// Read the options-pnl
		const optionPnlinSTX = chain.callReadOnlyFn(
			"options-nft",
			"get-option-pnl-for-expiry",
			[types.uint(testCycleExpiry)],
			deployer.address
		)
		const optionPnlinSTXNum = Number(optionPnlinSTX.result.expectOk().expectSome().slice(1))

		// Check if the option-pnl in STX was send to the tx-sender
		block.receipts[0].events.expectSTXTransferEvent(
			optionPnlinSTXNum,
			vaultContract,
			accountA.address
		)
	}
})

// Test claim (out-of-the-money) for an options NFT that is not expired --> ERR_OPTION_NOT_EXPIRED (err u115)
Clarinet.test({
	name: "Ensure that claim (out-of-the-money) does not work if called with an options-nft that has not yet expired",
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

		// Initialize the first auction; the strike price is out-of-the-money (above spot)
		block = initFirstAuction(
			chain, 
			deployer.address,
			testAuctionStartTime, 
			testCycleExpiry,  
			'outOfTheMoney', 
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

		const { timestamp, price, signature } = convertRedstoneToContractData(redstoneDataOneMinApart[2])
		
		// Call claim for accountA and token-id u1
		block = chain.mineBlock([
			Tx.contractCall(
				"options-nft",
				"claim",
				[
					types.uint(1), 
					timestamp,
					price,
					signature
				],
				accountA.address
			)
		])
		// Since the options NFT is not yet expired we expect ERR_OPTION_NOT_EXPIRED (err u115)
		block.receipts[0].result.expectErr().expectUint(115)
	}
})

// ### TEST SET-TRUSTED-ORACLE

// Testing setting trusted oracle
Clarinet.test({
	name: "Ensure that the contract owner can set trusted oracle",
	fn(chain: Chain, accounts: Map<string, Account>) {
		const deployer = accounts.get("deployer")!;
		const block = setTrustedOracle(chain, deployer.address);
		const [receipt] = block.receipts;
		receipt.result.expectOk().expectBool(true);
		
		const trusted = chain.callReadOnlyFn(
			"options-nft", 
			"is-trusted-oracle", 
			[trustedOraclePubkey], 
			deployer.address
		);
		trusted.result.expectBool(true);
		
		const untrusted = chain.callReadOnlyFn(
			"options-nft", 
			"is-trusted-oracle", 
			[untrustedOraclePubkey], 
			deployer.address
		);
		untrusted.result.expectBool(false);
	},
});

// ### TEST RECOVER-SIGNER

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

// ### TEST SET-CONTRACT-OWNER
// Test set-contract-owner 
Clarinet.test({
	name: "Ensure that contract-owner can be set by the current contract owner",
	async fn(chain: Chain, accounts: Map<string, Account>) {

	const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

	const contractOwnerOne = chain.callReadOnlyFn(
		"options-nft",
		"get-contract-owner",
		[],
		deployer.address
	)
	assertEquals(contractOwnerOne.result.expectOk(), deployer.address)

	let block = chain.mineBlock([
		Tx.contractCall(
			"options-nft",
			"set-contract-owner",
			[types.principal(accountA.address)],
			deployer.address
		)
	])
	block.receipts[0].result.expectOk().expectBool(true)

	const contractOwnerTwo = chain.callReadOnlyFn(
		"options-nft",
		"get-contract-owner",
		[],
		deployer.address
	)
	assertEquals(contractOwnerTwo.result.expectOk(), accountA.address)	
	},
});

// ### TEST NFT HELPER FUNCTIONS

// Test get-token-uri
Clarinet.test({
	name: "Ensure that token-uri can be read",
	async fn(chain: Chain, accounts: Map<string, Account>) {

	const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);

	let block = chain.mineBlock([
		Tx.contractCall(
			"options-nft",
			"get-token-uri",
			[types.uint(1)],
			deployer.address
		)
	])
	block.receipts[0].result.expectOk().expectNone()
	}
});

// Test get-owner
Clarinet.test({
	name: "Ensure that get-owner returns the principal that owns the options NFT",
	async fn(chain: Chain, accounts: Map<string, Account>) {

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

	// Mint two option NFTs
	block = initMint(
		chain, 
		accountA.address, 
		accountB.address, 
		redstoneDataOneMinApart
	)
	assertEquals(block.receipts.length, 2);

	block = chain.mineBlock([
		Tx.contractCall(
			"options-nft",
			"get-owner",
			[types.uint(1)],
			deployer.address
		)
	])
	assertEquals(block.receipts[0].result.expectOk().expectSome(), accountA.address)
	}
});
