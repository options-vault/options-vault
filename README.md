# :moneybag: Options Vaults :moneybag:
### A Stacks DeFi app that automates covered call writing to generate sustainable, risk-adjusted yield.

Options vaults allow you to allocate your crypto to an automated options yield strategy. All STX deposited into the options vault become available to a set of Clarity smart contracts that execute a simple [covered call](https://www.investopedia.com/terms/c/coveredcall.asp) options writing strategy.

The strategy sells one week options contracts (represented as NFTs) against the STX in the vault. The options contracts, sold deeply ["out-of-the-money"](https://www.thestreet.com/dictionary/o/out-of-the-money), mostly expire worthless, putting a steady stream of premium payments into the vault investor's pocket. 

The call option contract sold by the vault gives the buyer the right (but not the obligation) to buy one STX 15% above the current market price in one week from now. In other words, the call option contract only loses money for the vault if STX goes up by **more than 15% in one week**.  

The net result is a strategy that, in bearish and mildly bullish market conditions, puts a steady stream of income payments into the vault's pocket - over the last year the APY for this strategy has been roughly 20%. Only in **extremely bullish** market conditions, a market with fast _and_ steep price appreciation, does the strategy become unprofitable.

This protocol's longer-term goal is to provide structured investment products including but not limited to the covered call strategy to the Stacks and Bitcoin community.

# Content  
1. [Why Options Arbitrage?](#optionsArbitrage)  
2. [Why Automation Via Smart Contracts?](#wavsc)  
3. [How does it work? - TL;DR](#hdiw)  
    - [Two User Types Contracts?](#tut)
    - [Simplified User Flow](#suf)
4. [How does it work?](#largehdiw) 
    - [Smart contract design](#scd)
    - [Calendar time vs. block time](#ctvbt)
    - [Cycles](#cycles)
5. [Description of the `options-nft` contract](#dotonc) 
    - [Data variables and maps](#dvamon)
    - [Functions](#funcon)
6. [Description of the `vault` contract](#dotvc) 
    - [Data variables and maps](#dvamvc)
    - [Functions](#funcvc)
7. [Testing](#testing) 
8. [Glossary](#glossary) 
9. [Special Thanks](#specialt)
9. [License](#license)
    
<a name="optionsArbitrage"/>

## Why Options Arbitrage?

Options arbitrage strategies are a time-tested way to generate yield. These strategies can generate steady income streams in specific market conditions **without liquidation risk**.

Most importantly they don't rely on the emission of inflationary protocol tokens as widely observed in [Automated Market Making](https://www.gemini.com/cryptopedia/amm-what-are-automated-market-makers) protocols, which gives the user the ability to generate sustainable, risk-adjusted income across market conditions.

<a name="wavsc"/>

## Why Automation Via Smart Contracts?

A certain level of financial acumen is required to execute these strategies successfully and therefore, in the traditional financial system, they have mainly been employed by financial institutions and sophisticated high net worth individuals.

We believe that by automating the execution using Clarity smart contracts, we can make these strategies available to a much wider audience. In our view, this is a crucial step towards a truly open and democratized financial system -- a financial system that makes sophisticated arbitrage strategies accessible to anybody with a Stacks account and without the need to give up custody over assets.

Stacks is in a unique position to become the smart contracting layer for Bitcoin, and by extension the home of Bitcoin DeFi. In making sustainable yield strategies available on Stacks we believe that we can help unlock the ecosystem's potential and contribute to accelerated user adoption.

<a name="hdiw"/>

## How does it work? - A high-level overview

![App Overview](https://github.com/options-vault/options-vault/blob/dev/assets/options-vault-overview-wide.png)

<a name="tut"/>

### Two User Types

- **User 1 (Yield Investor)**: Deposits STX into the vault to generate income via the covered call strategy
- **User 2 (Speculator)**: Buys call option on STX to profit from price appreciation

<a name="suf"/>

### Simplified User Flow
Let's take a look at the simplified **user flow** as depicted above

>(1) The yield investor (user 1) deposits STX to the vault contract\
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

_Side note: the current implementation uses STX as the underlying asset. However, with only slight changes to less than 5% of the codebase, the contract can be used with any other asset on the Stacks blockchain. And with the help of dlc.link technology, option vaults containing native Bitcoin and paying out native Bitcoin yields could be created as well - this is the long-term vision of the project._

<a name="largehdiw"/>

## How does it work? - Let's dig deeper

The preceding high-level overview covers the key features of the system, but let's now go a layer deeper and look at the contract mechanics under the hood.

<a name="scd"/>

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

<a name="ctvbt"/>

### Calendar time vs. block time
In order to offer options contract with calendar expiry dates (which conforms with market-wide standards), we use a Redstone oracle as a reliable, decentralized source for calendar timestamps (and the corresponding STXUSD prices). A server streams the Redstone data packages to our options-nft smart contract in pre-determined time intervals. (Note: the current implementation does _not_ include the server).

<a name="cycles"/>

### Cycles

![Cycle Overview](https://github.com/options-vault/options-vault/blob/dev/assets/cycle-overview-6.png)

The app has a sort of heartbeat. It all revolves around a weekly cycle that contains a number of different phases (auction, settlement, ledger updates, payouts - see image above). The variable `current-cycle-expiry` holds the UNIX timestamp of the current cycle's expiry and acts as the contract's internal clock. 

A cycle plays out as follows:

**I. Auction**

During a 3hr auction that decreases the price in 2% increments every 30min (dutch auction), user 2 gets the ability to buy NFTs representing **call** options on STXUSD. The options have a one week expiry (every Friday @ 4pm GMT) and a strike price 15% above the current STXUSD price. 

**II. Settlement**

Once the option has expired, the contract calculates the options NFT's value (`options-pnl`). This value will be either positive (in-the-money) or zero (out-of-the-money). This determines the distribution of the contract's funds between the options NFT holders and the vault.

A) Settlement with options NFT holders (user 2)
- _In-the-money scenario_: If the option is in-the-money the contract creates a `settlement-pool` that holds all STX owed to options NFT holders. Holders can subsequently call the `claim` function, send their option NFT to the contract and receive profit from the contract paid out in STX. The option NFT effectively acts as a bearer asset representing a claim on the STX in the settlement-pool.
- _Out-of-the-money scenario_: If the option expires worthless, no settlement pool is created, the funds remain in the vault.

B) Settlement with the vault (user 1)

Independently from the value of the options NFT, the balances of the vault's internal `ledger` gets updated after every cycle: The `distribute-pnl` function distributes the cycles' profit or loss (pnl) to the investors in the vault and updates every user's ledger `balance`.

**III. Ledger updates and payment processing**

Intra-week deposits and withdrawals are kept separate from the vault `balance` and are tracked in the `pending-deposit` and `pending-withdrawal` ledger entries. Once the settlement process is completed, the vault contract processes both deposits and withdrawals and sends the corresponding on-chain transactions. Note that deposits are processed on-chain immediately when requested by the user, while withdrawals are only broadcast to the network in bulk at the end of every cycle.

<a name="dotonc"/>

### Description of the `options-nft` contract

<a name="dvamon"/>

### 1) Data variables and maps

**:card_file_box: `options-ledger`**

The options-ledger map holds all the data-points necessary to describe a batch of weekly options. It maps the `cycle-expiry` timestamp (UNIX timestamp in milliseconds) against:
- the `strike` price for the call option (see [glossary](https://github.com/options-vault/options-vault/edit/dev/README.md#glossary))
- the `first-token-id` indicating the token-id of the first options NFT minted in this batch
- the `last-token-id` indicating the token-id of the last options NFT minted in this batch
- the `option-pnl` indicating the STX value of the option after expiry

**:card_file_box: `options-ledger-list`**

At the end of every cycle, the options-ledger-list is appended to. It holds a tuple with the `cycle-expiry` of an options NFT batch and the corresponding `last-token-id`. The list is used by the `find-options-ledger-list-entry` function in the `claim` method to iterate over all expired options NFT batches and map a provided token-id to a batch expiry date.

**:card_file_box: `options-price-in-usd`**

The options-price-in-usd variable represents the USD price of one options NFT contract.

**:card_file_box: `options-for-sale`**

The options-for-sale variable represents the amount of options NFTs the `mint` function is able to sell. The amount is determined by the `total-balances` variable in the `vault` contract, ensuring that the contract can never sell more options NFT contract as there are STX in the vault.

<a name="funcon"/>

### 2) Functions

![Cycle Overview With Functions Options NFT](https://github.com/options-vault/options-vault/blob/dev/assets/cycle-overview-with-functions-2.png)

#### Cycle Start

**:star2: `init-auction`**

The function sets the `next-cycle-expiry` date, calls `calculate-strike` to determine the next cycles strike price and creates a new entry in the `opions-ledger`. It sets the USD price by calling `set-options-price` and then determines and sets a series of variables for the upcoming auction":
- the `auction-start-time` is 2 hours after the last cycles expiry
- the `auction-decrement-value` is 2% of the `options-price-in-usd`
- the `auction-decrements-applied` are reset to zero
- the `options-for-sale` value is set to the vault's `total-balances`, ensuring that any options NFT sold in the auction is 1:1 covered by a STX in the vault (hence "covered call" strategy)

#### Auction

**:star2: `mint`**

The mint function allows users to purchase options NFTs during a 3 hour auction window. The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. The function interacts with update-options-price-in-usd which decrements the options-price-in-usd by 2% every 30 minutes. The options NFT is priced in USD, but the sale is settled in STX - get-update-latest-price-in-stx handles the conversion.

#### Settlement

**:star2: `submit-price-data`**

The function receives Redstone data packages from the server and verifies if the data has been signed by a trusted Redstone oracle's public key. The function additionally contains a time-based control flow that can trigger `transition-to-next-cycle` if the cycle has expired.

**:star2: `transition-to-next-cycle`**

The function is only executed once, after current-cycle is expired. It calls a series of functions that determines the value of the expired cycle, creates a settlement pool if the option NFT holds value, reflects all changes in the internal ledger system (`update-vault-ledger` and `update-options-ledger`) and initializes the auction for the next cycle.

It finally moves the watches of the internal clock, and sets `current-cycle-expiry` to one week in the future.

**:star2: `determine-value`**

The function calculates the value of the expired options NFT and updates the `options-ledger` entry with the corresponding `option-pnl` (profit and loss).

**:star2: `create-settlement-pool`**

If the `option-pnl` is positive, the function calls the `create-settlement-pool` method in the vault contract, which allocates all funds needed to pay back options NFT holder for the week to a separate account. 

**:star2: `claim`**

The claim function allows users to send an option NFT to the options-nft contract and claim the STX equivalent of the `option-pnl` at expiry. The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. It additionally receives the `token-id` of the option NFT that is to be claimed. The expiry-date of the NFT is determined via the `find-options-ledger-entry` method. If the `option-pnl` is above zero the contract sends a STX transfer to the NFT holder.

#### Ledger updates and payment processing

**:star2: `update-vault-ledger`**

The function updates the vault ledger by reflecting the cycle's option-pnl in investor balances and processes the intra-cycle deposits and withdrawals.

**:star2: `update-options-ledger`**

The function creates an options-ledger entry for the next cycle.

#### Helper functions

**:star2: `calculate-strike`**

Sets the strike price of the options NFT 15% above the current price of the underlying asset. In the next iteration we intend to replace this with a calculation that takes more variables (i.e. volatility) into account.

**:star2: `set-options-price`**

The price is determined using a simplified calculation that sets `options-price-in-usd` to 0.5% of the `stxusd-rate`. If all 52 weekly options for a year expiry worthless, an uncompounded 26% APY would be achieved by this pricing strategy. In the next iteration we intend to replace this simplified calculation with the *Black-Scholes formula* - the industry standard for pricing European style options.

**:star2: `update-options-price-in-usd`**

The function decrements the `options-price-in-usd` by 2% every 30 minutes during the 3 hour auction. If the `expected-decrements` are higher than the `applied-decrements`, the necessary decrements are applied to the options-price-in-usd.

<a name="dotvc"/> 

### Description of the `vault` contract

<a name="dvamvc"/>

### 1) Data variables and maps

**:card_file_box: `ledger`**

The ledger map accounts for the distribution of the vault funds to the investors in the vault. It maps the investor's `principal` address to
- the investor's `balance`, his total active STX in the vault
- the investor's `pending-deposit`, intra-week deposits that are added to the `balance` at the end of every cycle
- the investor's `pending-withdrawal`, intra-week withdrawals that are added to the `balance` at the end of every cycle
- the investor's `address`

**:card_file_box: `investor-addresses`**

The investor-addresses list holds the `principal` of every investor that holds a `balance` in the vault. It used to iterate over all investor addresses in the `distribute-pnl`, `process-deposits` and `process-withdrawals` functions.

**:card_file_box: `total-balances`**

The total-balances variable holds a uint number representing the sum of all investor balances in the vault `ledger`.

**:card_file_box: `total-pending-deposits`**

The total-pending-deposits variable holds a uint number representing the sum of all 'pending-deposit` entries in the vault `ledger`. 

**:card_file_box: `total-settlement-pool`**

The total-settlement-pool variable holds a uint number representing the number of STX in the settlement pool. The settlement pool is used to pay out all STX claims from in-the-money options NFT holders.

<a name="funcvc"/>

### 2) Functions

![Cycle Overview With Functions Vault](https://github.com/options-vault/options-vault/blob/dev/assets/cycle-overview-with-functions-vault-2.png)

#### Auction

**:star2: `deposit-premium`**

The function transfers the STX amount paid by user 2 for minting an options NFT (the premium) to the vault contract.

#### Intra-cycle

**:star2: `queue-deposit`**

The function transfers the deposited STX amount to the vault contract and adds the amount to the `pending-deposits` property of the investor's entry in the vault `ledger`. If it is the first deposit for the investor, the function adds the investor's address (principal) to the`investor-addresses` list.

**:star2: `queue-withdrawal`**

The function adds the requested withdrawal amount to the `pending-withdrawal` property of the investor's entry in the vault `ledger`. The function does not send an on-chain transaction but only queues the withdrawal to be processed at the end of the cycle with `process-withdrawal`.

#### Settlement

**:star2: `create-settlement-pool`**

The function transfers the STX amount owed to the cycle's NFT holders to the `options-nft` contract, effectively creating a settlement-pool. It is called by the `options-nft` contract as part of the logic for `determine-value-and-settle` and only executes in case of an in-the-money options NFT.

#### Ledger updates and payment processing

**:star2: `distribute-pnl`**

The function distributes the cycle's profit and loss (pnl) to the investors in the `ledger` on a pro-rata basis.

**:star2: `process-deposits`**

The function iterates over the `investor-addresses` list and applies the `pending-deposits` amount to the investor's ledger `balance`.

**:star2: `process-withdrawals`**

The function iterates over the `investor-addresses` list and applies the `pending-withdrawal` amount to the investor's ledger `balance`. If the investor has the necessary balance available, the function processes the withdrawal by sending an on-chain STX transfer for the requested amount.

<a name="testing"/>

## Testing

![Code Coverage Report](https://github.com/options-vault/options-vault/blob/dev/assets/code-coverage-report.png)

The repo contains a comprehensive testing suite for both the `options-nft` and `vault` contract. As the above coverage report shows, we have tests for 100% of the functions in our contracts as well as 95%+ of lines of code.

We have not only written unit tests but also integration tests that make sure that the different functions, especially in the options-nft contract, properly call each other for in-the-money (ITM) and out-of-the-money (OTM) scenarios.

Any suggestions and ideas on how we can improve the testing suite are highly encouraged. As a next step we intend to have the contracts audited.

To produce the `lcov` report, use the following commands (also outlined in the [Clarinet repo](https://github.com/hirosystems/clarinet#measure-and-increase-code-coverage))

```
$ clarinet test --coverage
```

Then use the `lcov` tooling suite to produce HTML reports:

```
$ brew install lcov
$ genhtml coverage.lcov
$ open index.html
```

<a name="glossary"/>

## Glossary

**:clipboard: `call option`**

A call option gives the holder the right, but not the obligation, to **buy** the `underlying asset` (i.e. STX) at a specific date (`expiry`) for a specific price (`strike`).

**:clipboard: `underlying asset`**

An options contract always refers to the spot price of an underlying asset. In the case of our options NFT contract, the underlying asset is STX. The value of the options NFT is derived (hence the name "derivative") from the spot price of the underlying asset.

**:clipboard: `strike`**

The strike price is the STXUSD rate at which the call option holder has the right to buy STX from the vault contract. 

**:clipboard: `out-of-the-money`**

If the price of the underlying asset is below the strike price, the option is "out-of-the-money". The option does **not** hold any value at expiry.

**:clipboard: `in-the-money`**

If the price of the underlying asset is above the strike price the option "is in-the-money". The option holds value at expiry.

**:clipboard: `premium`**

The premium is the amount the option buyer pays the option seller (aka option writer) for the option contract. In the `options-nft` contract the premium is also referred to as `options-price-in-usd`.

**:clipboard: `expiry`**

The expiry date is the UNIX timestamp (in milliseconds) at which the value of the options NFT contract is determined.

**:clipboard: `pnl`**

The pnl or "profit and loss" refers to the value of the options NFT contract at `expiry`.

<a name="specialt"/>

## Special Thanks

We would like to thank [Marvin Janssen](https://github.com/MarvinJanssen) for writing the [Redstone-Clarity-connector](https://github.com/MarvinJanssen/redstone-clarity-connector) contracts which we have integrated into our codebase.

We would like to thank [Ciara](https://github.com/proiacm) and [Aakanasha](https://github.com/amahajan87) for teaching us foundational Clarity skills during [Clarity Camp](https://clarity-lang.org/universe#camps) cohort 4.

<a name="license"/>

## License

GPL-3.0
