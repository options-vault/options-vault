import { types, Tx, Chain, Account, shiftPriceValue, pricePackageToCV, liteSignatureToStacksSignature } from './deps.ts';
import type { PricePackage, Block } from "./deps.ts";

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
  strikePlacement: string, 
  redstoneData: RedstoneData[]): Block {
    let strikeMultiplier;
    if (strikePlacement === 'outOfTheMoney') strikeMultiplier = 1.15
    if (strikePlacement === 'inTheMoney') strikeMultiplier = 0.8

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
const cycleExpiry = 65340234; // has to be changed
const stxUsdRate = 231;
const settlementExpiry = cycleExpiry;
const srtike = 3000000;
const optionsMintedAmount = 0;
const trustedOraclePubkey = "0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6";
const untrustedOraclePubkey = "0x03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9";
const pricePack = {
  timestamp: 1647332581, // Tue Mar 15 2022 08:23:01 GMT+0000
  prices: [{ symbol: "STXUSD", value: 2.5 }]
};
const Signature = "0x80517fa7ea136fa54522338145ebcad95f0be7c4d7c43c522fff0f97686d7ffa581d422619ef2c2718471c31f1af6084a03571f93e3e3bde346cedd2ced71f9100";

type presetForEndCurrentCycle = {
  chain: Chain,
  accounts: Map<string,Account>,
  lastTokenId?: Number,
  currentCycleExpiry?: Number,
  stxUsdRate?: Number,
  strike?: Number,
  optionsMintedAmount?: Number,
  oraclePubKey?: String,
  isOracleTrusted?: Boolean,
  pricePackage?: PricePackage,
  signature?: String
}

function setEnvironmentForEndCurrentCycle({
  chain,
  accounts,
  lastTokenId,
  currentCycleExpiry = cycleExpiry,
  stxUsdRate,
  strike,
  optionsMintedAmount,
  oraclePubKey = trustedOraclePubkey,
  isOracleTrusted = true,
  pricePackage = pricePack,
  signature = Signature
}: presetForEndCurrentCycle) {
    const deployer = accounts.get('deployer')!.address;
    const user_1 = accounts.get('wallet_1')!.address;
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
}





