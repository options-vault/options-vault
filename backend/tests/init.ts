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

export function convertRedstoneToContractData(redstoneDataPoint : RedstoneData): PriceDataForContract{
  const pricePackage: PricePackage = {
    timestamp: redstoneDataPoint.timestamp,
    prices: [{ symbol: "STX", value: redstoneDataPoint.value }]
  }

  const packageCV = pricePackageToCV(pricePackage)
  const returnSig = types.buff(liteSignatureToStacksSignature(redstoneDataPoint.liteEvmSignature))

  return{
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

// Creates two depositors for wallet_1 (1 STX) and wallet_2 (2 STX)
export function createTwoDepositors(chain: Chain, accounts: Map<string, Account>) {
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
export function createTwoDepositorsAndProcess(chain: Chain, accounts: Map<string, Account>) {
  const wallet_1 = accounts.get('wallet_1')!.address;
  const wallet_2 = accounts.get('wallet_2')!.address;

  let block = chain.mineBlock([
      Tx.contractCall("vault", "queue-deposit", [types.uint(1000000)], wallet_1),
      Tx.contractCall("vault", "queue-deposit", [types.uint(2000000)], wallet_2),
      Tx.contractCall("vault", "process-deposits", [], wallet_1)
  ]);
  return block
}



// Submits price data and only runs test that function was executed properly, not that data was correctly set
export function submitPriceData(
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

// Note: auction-decrement-value is not being set
export function initFirstAuction(
  chain: Chain, 
  deployerAddress: string,
  auctionStart: number, 
  cycleExpiry: number,
  strikeMultiplier: number, 
  redstoneData: RedstoneData[]): Block {

    let block = chain.mineBlock([
      Tx.contractCall(
        "options-nft", 
        "set-current-cycle-expiry", 
        [types.uint(cycleExpiry)], 
        deployerAddress
      ),
      Tx.contractCall(
        "options-nft", 
        "set-options-ledger-entry", 
        [types.uint(shiftPriceValue(redstoneData[0].value * strikeMultiplier))], // strike = spot + 15% 
        deployerAddress
      ),
      Tx.contractCall(
        "options-nft", 
        "set-options-price-in-usd", 
        [types.uint(shiftPriceValue(redstoneData[0].value * 0.02))], // options-price = spot * 0.5% 
        deployerAddress
      ),
      Tx.contractCall(
        "options-nft", 
        "set-auction-start-time", 
        [types.uint(auctionStart)], // Fri Oct 14 2022 16:10:54 GMT+0000
        deployerAddress
      ),
      Tx.contractCall(
        "options-nft", 
        "set-options-for-sale", 
        [types.uint(3)],
        deployerAddress
      ),
    ]);
    return block;
}


// creates a deposits, inits auction, buys 2 nfts, closes auction and initializes claim period
// 
export function initAuctionReadyToClaim(chain: Chain, accounts: Map<string, Account>){
  const [deployer, accountA, accountB] = ["deployer", "wallet_1", "wallet_2"].map(who => accounts.get(who)!);
	
			let block = createTwoDepositorsAndProcess(chain, accounts)
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
				testInTheMoneyStrikePriceMultiplier, 
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
			
			// Submit price data with a timestamp slightly after the current-cycle-expiry to trigger the end-current-cycle method
			block = submitPriceDataAndTest(chain, accountA.address, redstoneDataOneMinApart[5])
			block.receipts[0].result.expectOk().expectBool(true);
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

// For test end-current-clycle

const lastTokenId = 5;
const cycleExpiry = redstoneDataOneMinApart[4].timestamp + 10;
const srtike = 3000000;
const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const pricePack = {
  timestamp: redstoneDataOneMinApart[5].timestamp,
  prices: [{ symbol: "STXUSD", value: 1 / redstoneDataOneMinApart[5].value }]
};
const Signature = types.buff(liteSignatureToStacksSignature(redstoneDataOneMinApart[5].liteEvmSignature));

type presetForEndCurrentCycle = {
  chain: Chain,
  accounts: Map<string,Account>,
  lastTokenId?: Number,
  currentCycleExpiry?: Number,
  strike?: Number,
  optionsMintedAmount?: Number,
  oraclePubKey?: String,
  isOracleTrusted?: Boolean,
  pricePackage?: PricePackage,
  signature?: String
}

export function setEnvironmentForEndCurrentCycle({
  chain,
  accounts,
  lastTokenId,
  currentCycleExpiry = cycleExpiry,
  strike,
  optionsMintedAmount,
  oraclePubKey = trustedOraclePubkey,
  isOracleTrusted = true,
  pricePackage = pricePack,
  signature = Signature
}: presetForEndCurrentCycle) {
    const deployer = accounts.get('deployer')!.address;
    const packageCV = pricePackageToCV(pricePackage);
    
    let block = chain.mineBlock([
      Tx.contractCall(
        'options-nft',
        'submit-price-data',
        [ packageCV.timestamp, packageCV.prices, signature.toString() ],
        deployer
      )
    ])

    return { block, deployer, packageCV, currentCycleExpiry, signature };
}





