import { types, Tx, Chain, Account, shiftPriceValue, pricePackageToCV, liteSignatureToStacksSignature } from './deps.ts';
import type { PricePackage, Block } from "./deps.ts";
import { redstoneDataOneMinApart } from "./redstone-data.ts";

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

export function setTrustedOracle(chain: Chain, senderAddress: string): Block {
	return chain.mineBlock([
		Tx.contractCall("options-nft", "set-trusted-oracle", [trustedOraclePubkey, types.bool(true)], senderAddress),
	]);
}


export function createTwoDepositorsAndProcess(chain: Chain, accounts: Map<string, Account>) {
  const wallet_1 = accounts.get('wallet_1')?.address ?? ""
  const wallet_2 = accounts.get('wallet_2')?.address ?? ""

  let block = chain.mineBlock([
      Tx.contractCall("vault", "queue-deposit", [types.uint(1000000)], wallet_1),
      Tx.contractCall("vault", "queue-deposit", [types.uint(2000000)], wallet_2),
      Tx.contractCall("vault", "process-deposits", [], wallet_1)
  ]);
  return block
}

// Note: auction-decrement-value is not being set
export function initAuction(
  chain: Chain, 
  deployerAddress: string,
  auctionStart: number, 
  cycleExpiry: number,
  strikeMultiplier: number, 
  redstoneData: RedstoneData[]): Block {
    // let strikeMultiplier;
    // if (strikePlacement === 'outOfTheMoney') strikeMultiplier = 1.15
    // if (strikePlacement === 'inTheMoney') strikeMultiplier = 0.8

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
        'set-trusted-oracle',
        [ oraclePubKey, types.bool(isOracleTrusted) ],
        deployer
      ),
      Tx.contractCall(
        'options-nft',
        'set-current-cycle-expiry',
        [ types.uint(currentCycleExpiry) ],
        deployer
      ),
      Tx.contractCall(
        'options-nft',
        'submit-price-data',
        [ packageCV.timestamp, packageCV.prices, signature ],
        deployer
      )
    ])

    return { block, deployer, packageCV, currentCycleExpiry, signature };
}





