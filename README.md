# :moneybag: Options Vaults :moneybag:
## A Stacks DeFi app that automates covered call writing to generate sustainable, risk-adjusted yield.

Options vaults allow you to allocate your crypto to an automated options yield strategy. All STX deposited into the options vault become available to a set of Clarity smart contracts that execute a simple [covered call](https://www.investopedia.com/terms/c/coveredcall.asp) options writing strategy.

The strategy sells one week options contracts (represented as NFTs) against the STX in the vault. The options contracts, sold deeply ["out-of-the-money"](https://www.thestreet.com/dictionary/o/out-of-the-money), statistically mostly expire worthless putting a steady stream of premium payments into the vault investor's pocket. 

The call option contract sold by the vault gives the buyer the right (but not the obligation) to buy one STX 15% above the current market price in one week from now from the vault. In other words, the call option contract only lose money for the vault if STX goes up by **more than 15% in one week**.  

The net result is a strategy that in bearish and mildly bullish market conditions puts a steady stream of income payments into the vault's pocket - over the last year the APY for this strategy has been around 20%. Only in **extremely bullish** market conditions, a market with fast _and_ steep price appreciation, does the strategy become unprofitable.

This protocol's longer-term goal is to provide structured investment products including but not limited to the covered call strategy to the Stacks and Bitcoin community.

## Why Options Arbitrage?

Options arbitrage strategies are a time-tested way to generate yield. These strategies can generate steady income streams in specific market conditions **without liquidation risk**.

Most importantly they don't rely on the emission of inflationary protocol tokens as widely observed in [Automated Market Making](https://www.gemini.com/cryptopedia/amm-what-are-automated-market-makers) protocols, which gives the user the ability to generate sustainable, risk-adjusted income across market conditions.

## Why Automation Via Smart Contracts?

A certain level of financial acumen is required to execute these strategies successfully and therefore, in the traditional financial system, they have mainly been employed by financial institutions and sophisticated high net worth individuals.

We believe that by automating the execution using Clarity smart contracts, we can make these strategies available to a much wider audience. In our view, this is a crucial step towards a truly open and democratized financial system. A financial system that makes sophisticated arbitrage strategies accessible to anybody with a Stacks account and without the need to give up custody over your assets.

Stacks is in a unique position to become the smart contracting layer for Bitcoin and by extension the home of Bitcoin DeFi. In making sustainable yield strategies available on Stacks we believe that we can help unlock the ecosystem's potential and contribute to accelerated user adoption.

## How does it work? - A first high level overview

![App Overview](https://github.com/options-vault/options-vault/blob/dev/assets/options-vault-overview-wide.png)

### Two User Types

- **User 1 (Yield Investor)**: Deposits STX into the vaul to generate income via the covered call strategy
- **User 2 (Speculator)**: Buys call option on STX to profit from price appreciation

### Simplified User Flow
Let's take a look at the simplified **user flow** as depicted above

>(1) The yield invstor (user 1) deposits STX to the vault contract\
>(2) The vault makes the deposited STX available to the auction\
>(3) The auction sells one week call options on STXUSD for 15% above the spot price to the speculator (user 2)\
>(4) The option buyer (user 2) receives an NFT which represents a call option\

**Scenario 1**: Option holds value at expiry ("in-the-money")
>(5) User 2 sends the options NFT to the settlement contract to claim his profit\
>(6) The settlement contract, using a price provided by a [Redstone](https://www.redstone.finance) oracle, determines the value of the options NFT\
>(7) The settlement contract pays out the profit to user 2

**Scenario 2**: Option expires worthless ("out-of-the-money")
>(7) The auction contract pays out the proceeds from selling the options contracts to the vault\
>(8) User 1 has the option to withdraw his funds from the vault every week

_Side note: the current implementation uses STX as the underlying asset. However, with only slight changes to less than 5% of the codebase, the contract will be able to be used with any other asset on the Satcks blockchain. And with the help of dlc.link technology option vaults containing native Bitcoin and paying out native Bitcoin yields could be created as well - this is the long-term vision of the project._

## How does it work? - Let's dig deeper

The high-level overview covers the key parts of the system, but let's now go a layer deeper and look at the contract mechanics under the hood.

### Smart contract design
The Dapp is comprised of **two smart contracts**:

(1) The `vault` contract which
  - holds all of user 1's funds
  - keeps an internal ledger tracking each principal's balance 
  - allows for deposits and withdrawals 

(2) The `options-nft` contract which contains
  - a function to receive Redstone timestamp and price data
  - the logic to algorithmically determine and set the options strike price
  - a mechanism that sells option NFTs via a simple auction 
  - the logic to calculate the value of an expired option NFT and create a settlement pool with all the funds owed to user 2
  - a function that allows user 2 to claim the value of an in-the-money option NFT from the settlement pool

### Calendar time vs. block time
In order to offer options contract with calendar expiry dates (which conforms with market wide standards), we use a Redstone oracle as a reliable, decentralized source for calendar timestamps (and the corresponding STXUSD prices). A server streams the Redstone data packages to our options-nft smart contract in pre-deteremined time intervals. (Note: the current implementation does _not_ include the server).

### Cycles

![Cycle Overview](https://github.com/options-vault/options-vault/blob/dev/assets/cycle-overview-6.png)

The whole app revolves around a one week cycle. The variable `current-cycle-expiry`, which holds the UNIX timestamp of the current cycle's epxiry. This variable acts as the contract's internal clock. 

A cycle plays out as follows:

**I. Auction**\
During a 3hr auction that decreases the price in 2% increments every 30min (dutch auction), user 2 gets the ability to buy NFTs representing **call** options on STXUSD. The options have a one week expiry (every Friday @ 4pm GMT) and a strike price 15% above the current STXUSD price. 

**II. Settlement**\
Once the option has expired the contract calculates the options NFT's value (`options-pnl`). This vaule being either positive (in-the-money) or zero (out-of-the-money) determines the distribution of the contract's funds between the options NFT holders and the vault.

A) Settlement with options NFT holders (user 2)
- _In-the-money scenario_: If the option is in-the-money the contract creates a `settlement-pool` that holds all STX owed to options NFT holders. Holders can subsequently call the `claim` function, send their option NFT to the contract and receive profit from the contract paid out in STX. The option NFT effectively acts as a bearer asset representing a claim on the STX in the settlement-pool.
- _Out-of-the-money scenario_: If the option expires worthless no settlement pool is created, the funds remain in the vault.

B) Settlement with the vault (user 1)

Independently from the value of the options NFT, the balances of the vault's internal `ledger` gets updated after every cycle: The `distribute-pnl` function distributes the cycles' profit or loss (pnl) to the investors in the vault and updates every user's ledger `balance`.

**III. Ledger updates and payement processing**\
Intra-week deposits and withdrawals are kept seperate from the vault `balance` and are tracked in the `pending-deposit` and `pending-withdrawal` ledger entries. Once the settlement process is completed, the vault contract processes both deposits and withdrawals and sends the corresponding on-chain transactions. Note that deposits are processed on-chain immediately when requested by the user, while Withdrawals are only broadcast to the network in bulk at the end of every cycle.

### Detailed description of the functions in the `options-nft` contract

![Cycle Overview With Functions](https://github.com/options-vault/options-vault/blob/dev/assets/cycle-overview-with-functions-2.png)

#### Cycle Start

#### Auction

**:star2: _`init-auction`_**

The function sets the `next-cycle-expiry` date, calls `calculate-strike` to determine the next cycles strike price and creates a new entry in the `opions-ledger`. It sets the USD price by calling `set-options-price` and then determines and sets a series of variables for the upcoming auction":
- the `auction-starttime` is 2 hours after the last cycyles expiry
- the `auction-decrement-value` is 2% of the `options-price-in-usd`
- the `auction-decrements-applied` are reset to zero.
- the `options-for-sale` value is set to the vault's `total-balances`, ensuring that any options NFT sold in the auction is 1:1 covered by a STX in the vault (hence "covered call" strategy)

**:star2: _`mint`_**

The mint function allows users to purchase options NFTs during a 3 hour auction window. The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. The function interacts with update-options-price-in-usd which decrements the options-price-in-usd by 2% every 30 minutes. The options NFT is priced in USD, but the sale is settled in STX - get-update-latest-price-in-stx handles the conversion.

#### Settlement

**:star2: _`submit-price-data`_**

The function receives Redstone data packages from the server and verifies if the data has been signed by a trusted Redstone oracle's public key. The function additionally contains a time-based control flow that can trigger `transition-to-next-cycle` if the cycle has expred.

**:star2: _`transition-to-next-cycle`_**

The function is only executed once, after current-cycle is expired. It calls series of functions that `determine-value` of the expired cycle, `create-settlementpool` if the option NFT holds value, reflect all changes in the internal ledger system (`update-vault-ledger` and `update-options-ledger`) and initializes the auction for the next cycle.

It finally moves the watches of the inernal clock, and sets `current-cycle-expiry` to one week in the future.

**:star2: _`determine-value`_**

The function calculates the value of the expired options NFT and updates the `options-ledger` entry with the corresponding `option-pnl` (profit and loss).

**:star2: _`create-settlement-pool`_**

If the `option-pnl` is positive, the function calls the `create-settlement-pool` method in the vault contract, which allocates all funds needed to pay back options NFT holder for the week to a seperate account. 

**:star2: _`claim`_**

The claim function allows users to send an option NFT to the options-nft contract and claim the STX equivalent of the `option-pnl` at expiry.  The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. It additionally receives the `token-id` of the option NFT that is to be claimed. Via the `find-options-ledger-entry` method the expiry-date of the NFT is determined.  If the `option-pnl` is above zero the contract sends a STX transfer to the NFT holder.

#### Update ledger and process payments

**:star2: _`update-vault-ledger`_**

The function updates the vault ledger by reflecting the cycle's option-pnl in investor balances and processes the intra-cycle deposits and withdrawals.

**:star2: _`update-options-ledger`_**

The function creates an options-ledger entry for the next cycle.

#### Helper functions

**:star2: _`calculate-strike`_**

Sets the strike price of the options NFT 15% above the current price of the underlying asset. In the next iteration we intend to replace this with a calculation that takes more variables (i.e. volatility) into account.

**:star2: _`set-options-price`_**

The price is determined using a simplified calculation that sets `options-price-in-usd` to 0.5% of the `stxusd-rate`. If all 52 weekly options for a year expiry worthless, an uncompounded 26% APY would be achieved by this pricing strategy. In the next iteration we intend to replace this simplified calculation with the *Black Scholes formula* - the industry standard for pricing European style options.

**:star2: _`update-options-price-in-usd`_**

The function decrements the `options-price-in-usd` by 2% every 30 minutes during the 3 hour auction. If the `epexted-decrements` are higher than the `applied-decrements`, the necessary decrements are applied to the options-price-in-usd.

### Detailed description of the functions in the `vault` contract

[TODO: Add cycle overview mapped against functions in the vault contract]

TODO: Organize below functions according to phases in the picture

**:star2: _`queue-deposit`_**

The function transfers the deposited STX amount to the vault contract and adds the amount to the `pending-deposits` property of the investor's entry in the vault `ledger`. If it is the first deposit for the investor, the function adds the investor's address (principal) to the`investor-addresses` list.

**:star2: _`process-deposits`_**

The function iterates over the `investor-addresses` list and applies the `pending-deposits` amount to the investor's ledger `balance`.

**:star2: _`queue-withdrawal`_**

The function adds the requested withdrawal amount to the `pending-withdrawal` property of the investor's entry in the vault `ledger`. The function does not send an on-chain transaction but only queues the withdrawal to be processed at the end of the cycle with `process-withdrawal`.

**:star2: _`process-withdrawals`_**

The function iterates over the `investor-addresses` list and applies the `pending-withdrawal` amount to the investor's ledger `balance`. If the investor has the necessary balance available the function processes the withdrawal by sending an on-chain STX transfer for the requested amount.

**:star2: _`create-settlement-pool`_**

The function transfers the STX amount owed to the cycle's NFT holders to the `options-nft` contract, effectively creating a settlement-pool. It is called by the `options-nft` contract as part of the logic for `determine-value-and-settle` and only executes in case of an in-the-money options NFT.

**:star2: _`deposit-premium`_**

The function transfers the STX amount paid by user 2 for minting an options NFT (the premium) to the vault contract.

**:star2: _`distribute-pnl`_**

The function distributes the cycle's profit and loss (pnl) to the investors in the `ledger` on a pro-rata basis.

## Testing

## Credit

## License

GPL-3.0
