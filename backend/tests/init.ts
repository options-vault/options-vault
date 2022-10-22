import { types, Tx, Chain, Account, assertEquals, shiftPriceValue, pricePackageToCV, liteSignatureToStacksSignature } from './deps.ts';
import type { PricePackage, Block } from "./deps.ts";
import { redstoneDataOneMinApart } from "./redstone-data.ts";
export { redstoneDataOneMinApart } from "./redstone-data.ts";

// Redstone data points for testing (ten, each 1 min apart)
const firstRedstoneTimestamp = redstoneDataOneMinApart[0].timestamp; // timestamp 1/10
const midRedstoneTimestamp = redstoneDataOneMinApart[4].timestamp; // timestamp 5/10
const lastRedstoneTimestamp = redstoneDataOneMinApart[9].timestamp; // timestamp 10/10

// Testing constants
const testAuctionStartTime = firstRedstoneTimestamp - 10; 
const testCycleExpiry = midRedstoneTimestamp + 10;
const testOptionsForSale = 3;
const testOptionsUsdPricingMultiplier = 0.02
const testOutOfTheMoneyStrikePriceMultiplier = 1.15 // 15% above spot
const testInTheMoneyStrikePriceMultiplier = 0.8 // 20% below spot

const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";

export const testConfig = {
  firstRedstoneTimestamp, midRedstoneTimestamp, lastRedstoneTimestamp, testAuctionStartTime, testCycleExpiry, testOptionsForSale, testOptionsUsdPricingMultiplier, testOutOfTheMoneyStrikePriceMultiplier, testInTheMoneyStrikePriceMultiplier
}

export type RedstoneData = {
	id: string,
  symbol: string, 
  provider: string,
  value: number,
  liteEvmSignature: string,
  permawebTx: string,
  version: string,
  source: {
    binance: number,
    coinbaseprime: number,
    coinbasepro: any,
    kucoin: any,
    okcoin: any,
    okex5: any
  },
  timestamp: number,
  minutes: number,
  providerPublicKey: string
};

export type PriceDataForContract = {
  timestamp: string,
  price: string,
  signature: string
}

// Converts Redstone data package into data format that can be consumed by Clarinet
export function convertRedstoneToContractData(redstoneDataPoint : RedstoneData): PriceDataForContract{
  const pricePackage: PricePackage = {
    timestamp: redstoneDataPoint.timestamp,
    prices: [{ symbol: "STX", value: redstoneDataPoint.value }]
  }

  const packageCV = pricePackageToCV(pricePackage)
  const returnSig = types.buff(liteSignatureToStacksSignature(redstoneDataPoint.liteEvmSignature))

  return {
    timestamp: packageCV.timestamp,
    price: packageCV.prices,
    signature: returnSig
  }
}

export function setTrustedOracle(chain: Chain, senderAddress: string): Block {
	return chain.mineBlock([
		Tx.contractCall("options-nft", "set-trusted-oracle", [trustedOraclePubkey, types.bool(true)], senderAddress),
	]);
}

// Sets current-cycle-expiry to the provided timestamp
export function setCurrentCycleExpiry(
  chain: Chain,
  deployerAddress: string,
  cycleExpiry: number,
  ): Block {
    let block = chain.mineBlock([
      // sets current-cycle-expiry to the provided timestamp
      Tx.contractCall(
        "options-nft", 
        "set-current-cycle-expiry", 
        [types.uint(cycleExpiry)], 
        deployerAddress
      )
    ]);
    block.receipts[0].result.expectOk()
    return block;
}

// Creates two depositors for wallet_1 (1 STX) and wallet_2 (2 STX)
export function simulateTwoDeposits(chain: Chain, accounts: Map<string, Account>) {
  const wallet_1 = accounts.get('wallet_1')!.address;
  const wallet_2 = accounts.get('wallet_2')!.address;

  let block = chain.mineBlock([
      Tx.contractCall("vault", "queue-deposit", [types.uint(1000000)], wallet_1),
      Tx.contractCall("vault", "queue-deposit", [types.uint(2000000)], wallet_2),
  ]);
  return block
}

// Creates two depositors for wallet_1 (1 STX) and wallet_2 (2 STX) 
// and processes the deposits so that the ledger moves it from pending-deposits to balance
export function simulateTwoDepositsAndProcess(chain: Chain, accounts: Map<string, Account>) {
  const wallet_1 = accounts.get('wallet_1')!.address;
  const wallet_2 = accounts.get('wallet_2')!.address;

  let block = chain.mineBlock([
      Tx.contractCall("vault", "queue-deposit", [types.uint(1000000)], wallet_1),
      Tx.contractCall("vault", "queue-deposit", [types.uint(2000000)], wallet_2),
      Tx.contractCall("options-nft", "process-deposits-from-options", [], wallet_1)
  ]);
  return block
}

// Submits price data and only runs test that function was executed properly, not that data was correctly set
export function submitPriceData(
  chain: Chain,
  submitterAddress: string,
  redstoneDataPoint: RedstoneData
  ): Block 
  {

    const { timestamp, price, signature } = convertRedstoneToContractData(redstoneDataPoint)

    let block = chain.mineBlock([
			Tx.contractCall(
				"options-nft", 
				"submit-price-data", 
				[
					timestamp,
          price,
          signature
				], 
				submitterAddress
			),
		]);
    block.receipts[0].result.expectOk().expectBool(true);
    return block;
}

// Submits a price data package from Redstone and runs test to verify that the data has been properly processed
export function submitPriceDataAndTest(
  chain: Chain,
  submitterAddress: string,
  redstoneDataPoint: RedstoneData): Block 
  {
    const pricePackage: PricePackage = {
      timestamp: redstoneDataPoint.timestamp,
      prices: [{ symbol: "STX", value: redstoneDataPoint.value }]
    }

    const packageCV = pricePackageToCV(pricePackage)
    const signature = types.buff(liteSignatureToStacksSignature(redstoneDataPoint.liteEvmSignature))

    let block = chain.mineBlock([
			Tx.contractCall(
				"options-nft", 
				"submit-price-data", 
				[
					packageCV.timestamp,
					packageCV.prices,
					signature
				], 
				submitterAddress
			),
		]);
    block.receipts[0].result.expectOk().expectBool(true);

    const lastSeenTimestamp = chain.callReadOnlyFn(
			"options-nft",
			"get-last-seen-timestamp",
			[],
			submitterAddress
		)
		assertEquals(lastSeenTimestamp.result, packageCV.timestamp)

		const lastSTXUSDdRate = chain.callReadOnlyFn(
			"options-nft",
			"get-last-stxusd-rate",
			[],
			submitterAddress
		)
		assertEquals(lastSTXUSDdRate.result, types.some(types.uint(shiftPriceValue(pricePackage.prices[0].value))))
    
    return block;
}

// TODO: set auction-decrement-value
// TODO: take out set-current-cycle-expiry call and refactor options-nft tests
export function initFirstAuction(
  chain: Chain, 
  deployerAddress: string,
  auctionStart: number, 
  cycleExpiry: number, // TODO: Pull cycleExpiry into another init function - setCycleExpiry
  inTheMoney: string, 
  redstoneData: RedstoneData[]
  ): Block {

    const strikeMultiplier = inTheMoney == 'inTheMoney' ? testInTheMoneyStrikePriceMultiplier : testOutOfTheMoneyStrikePriceMultiplier
   
    let block = chain.mineBlock([
      // sets current-cycle-expiry to the provided timestamp
      Tx.contractCall(
        "options-nft", 
        "set-current-cycle-expiry", 
        [types.uint(cycleExpiry)], 
        deployerAddress
      ),
      // Creates a ledger entry for the current-cycle-expiry with the provided strike price
      Tx.contractCall(
        "options-nft", 
        "set-options-ledger-entry", 
        [types.uint(shiftPriceValue(redstoneData[0].value * strikeMultiplier))], // strike = spot + 15% 
        deployerAddress
      ),
      // Sets the options-price-in-usd to the provided uint
      Tx.contractCall(
        "options-nft", 
        "set-options-price-in-usd", 
        [types.uint(shiftPriceValue(redstoneData[0].value * 0.02))], // options-price = spot * 0.5% 
        deployerAddress
      ),
      // Sets the auction start time to the provided timestamp 
      Tx.contractCall(
        "options-nft", 
        "set-auction-start-time", 
        [types.uint(auctionStart)], // Fri Oct 14 2022 16:10:54 GMT+0000
        deployerAddress
      ),
      // Sets the amount of options-for-sale
      Tx.contractCall(
        "options-nft", 
        "set-options-for-sale", 
        [types.uint(3)],
        deployerAddress
      ),
    ]);
    return block;
}

export function initMint(
  chain: Chain, 
  minterAddressA: string,
  minterAddressB: string,
  redstoneData: RedstoneData[]): Block {
    const pricePackageA: PricePackage = {
      timestamp: redstoneData[0].timestamp,
      prices: [{ symbol: "STX", value: redstoneData[0].value }]
    }
    const packageCVA = pricePackageToCV(pricePackageA);
    const signatureA = types.buff(liteSignatureToStacksSignature(redstoneData[0].liteEvmSignature))

    const pricePackageB: PricePackage = {
      timestamp: redstoneData[1].timestamp,
      prices: [{ symbol: "STX", value: redstoneData[1].value }]
    }
    const packageCVB = pricePackageToCV(pricePackageB);
    const signatureB = types.buff(liteSignatureToStacksSignature(redstoneData[1].liteEvmSignature))
    
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
    return block;
}

// TODO: Take out submitPriceData
// Creates an auction that deposits, inits auction, buys 2 nfts, closes auction and initializes claim period
export function simulateFirstCycleTillExpiry(
  chain: Chain, 
  accounts: Map<string, Account>, 
  inTheMoney: string
  ){
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
    inTheMoney, 
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
  
  return block;
}