## :moneybag: Options Yield Vaults :moneybag:
### A Decentralized Options Yield Strategy To Generate Income On Your Crypto 

Options yield vaults give you the ability to allocate your crypto to an automated options strategy to generate income. 
All you need to do is deposit crypto into our vault and the Clarity smart contracts execute a simple [covered call](https://www.investopedia.com/terms/c/coveredcall.asp) 
options arbitrage strategy for you.

This strategy sells one week options contracts (represented as NFTs) against the crypto in the vault. Since the strike price of the 
option is 15% above the underlying spot price, most of the weekly option contracts expiry worthless (the option is ["out-of-the-money"](https://www.thestreet.com/dictionary/o/out-of-the-money)).

The net result is a strategy that in bearish and mildly bullish market conditions puts a stead stream of income payments in
the investor's pocket. Only in extremely bullish market conditions, with fast and steep price appreciations, does the strategy become unprofitable.

### Why Options Arbitrage?

Derivatives arbitrage strategies are a time-tested way to generate yield. Using options and futures contracts, these strategies can generate steady income
streams in specific market conditions **without liquidation risk**.

Most importantly though the strategies' success does not rely on the emission of inflationary protocol tokens as widely observed in [Automated Market Making](https://www.gemini.com/cryptopedia/amm-what-are-automated-market-makers) protocols.
This makes the strategies inherently **sustainable** and gives the user the ability to generate income in bearish market conditions.

### Why Automation Via Smart Contracts?

A certain level of financial acumen is required to execute these strategies successfully and therefore, in the traditional financial system, they have mainly been employed by financial institutions and sophisticated high net worth individuals.

We believe that by automating the execution using Clarity smart contracts we can make these strategies available to a much wider audience. In our opinion, this is a crucial step towards a truly open and democratized financial system. A financial system that makes sophisticated arbitrage strategies accessible to anybody with a Stacks account and without the need to give up custody over your assets.

Stacks is in a unique position to become the smart contracting layer for Bitcoin and by extension the home of Bitcoin DeFi. In making sustainable yield strategies available on Stacks we believe that we can help unlock the ecosystem's potential and contribute to accelerated user adoption.

### How does it work? - A first high level overview

![App Overview](https://github.com/options-vault/options-vault/blob/dev/options-vault-overview-wide.png)

There are two **user types**:

- **User 1 (Saver/Investor)**: Deposits STX into the vaul to generate income via the covered call strategy
- **User 2 (Speculator)**: Buys call option on STX to profit from price appreciation

Let's take a look at the simplified **user flow**

(1) User 1 deposits STX to the vault contract\
(2) The vault makes the deposited STX available to the auction\
(3) The auction sells one week call options on STXUSD for 15% above the spot price to user 2\
(4) The option buyer gets send an NFT which represents the call option\

**Scenario 1**: Option holds value at expiry ("in-the-money")\
(5) User 2 sends options NFT to settlement contract\
(6) The settlement contract, using a price provided by a [Redstone](https://www.redstone.finance) oracle, determines the value of the option\
(7) The settlement contract sends the option value to user 2

**Scenario 2**: Option expires worthless ("out-of-the-money")\
(7) The auction contract pays out the proceeds from selling the options contracts to the vault\
(8) User 1 has the option to withdraw 

_Side note: the current implementation uses STX as the underlying asset. However, with only slight changes to less than 5% of the codebase the contract could be used with any other asset on the Satcks blockchain. And with the help of dlc.link technology option yield vaults containing native Bitcoin and paying out native Bitcoin yields could be created - this is the long-term vision of the project._

### How does it work? - Let's dig deeper

The high-level overview covers the key parts of the system, but let's now go a layer deeper and look at the contract mechanics under the hood.

In order to offer options contract with expiry dates that are adhering to the industry standard, we need to introduce calendar time to our smart contracts. We have chosen to use timestamps (and corresponding STXUSD prices) provided by the Redstone oracle. A server will stream the Redstone data packages to our options-nft smart contract in pre-deteremined time intervals. (Note: the current implementation does not include the server).

The Dapp is comprised of **two smart contracts**:\

(1) The `vault` contract which
  - holds all of user 1's funds
  - keeps an internal ledger tracking each principal's balance 
  - allows for deposits and withdrawals 

(2) The `options-nft` contract which contains a
  - a function to receive Redstone timestamp and price data
  - the logic to algorithmically determine and set the options strike price
  - a mechanism that sells option NFTs via a simple auction 
  - the logic to calculate the value of an expired option NFT and create a settlement pool with all the funds owed to user 2
  - a function that allows user 2 to claim the value of an in-the-money option NFT from the settlement pool
 
The whole app revolves around a one week cycle, with the variable `current-cycle-expiry` acting as the contract's internal clock. 

A cycle plays out as follows

1. **Auction**: During a 3hr auction that decreases the price by 2% every 30min (dutch auction) user 2 gets the ability to buy option NFTs on STXUSD. The options have a one week expiry (every Friday at 4pm GMT) and a strike price of 15% above the spot price. 

2. **Settlement**: Once the option has expired the contract settles the options NFT by 

3.  After expiry end-cycle:
- determine value
  - For ITM scenario: send settlement transaction
- 








