# :moneybag: Options Vaults :moneybag:
## A DeFi App to Earn Income With Automated Options Arbitrage Strategies

Options yield vaults give you the ability to allocate your crypto to an automated options strategy to generate income.  All you need to do is deposit crypto into our vault and the Clarity smart contracts execute a simple [covered call](https://www.investopedia.com/terms/c/coveredcall.asp) options arbitrage strategy for you.

This strategy sells one week options contracts (represented as NFTs) against the crypto in the vault. Since the strike price of the option is 15% above the underlying spot price, most of the weekly option contracts expiry worthless (the option is ["out-of-the-money"](https://www.thestreet.com/dictionary/o/out-of-the-money)).

The net result is a strategy that in bearish and mildly bullish market conditions puts a stead stream of income payments in the investor's pocket. Only in extremely bullish market conditions, with fast and steep price appreciations, does the strategy become unprofitable.

## Why Options Arbitrage?

Derivatives arbitrage strategies are a time-tested way to generate yield. Using options and futures contracts, these strategies can generate steady income
streams in specific market conditions **without liquidation risk**.

Most importantly though the strategies' success does not rely on the emission of inflationary protocol tokens as widely observed in [Automated Market Making](https://www.gemini.com/cryptopedia/amm-what-are-automated-market-makers) protocols.
This makes the strategies inherently **sustainable** and gives the user the ability to generate income in bearish market conditions.

## Why Automation Via Smart Contracts?

A certain level of financial acumen is required to execute these strategies successfully and therefore, in the traditional financial system, they have mainly been employed by financial institutions and sophisticated high net worth individuals.

We believe that by automating the execution using Clarity smart contracts we can make these strategies available to a much wider audience. In our opinion, this is a crucial step towards a truly open and democratized financial system. A financial system that makes sophisticated arbitrage strategies accessible to anybody with a Stacks account and without the need to give up custody over your assets.

Stacks is in a unique position to become the smart contracting layer for Bitcoin and by extension the home of Bitcoin DeFi. In making sustainable yield strategies available on Stacks we believe that we can help unlock the ecosystem's potential and contribute to accelerated user adoption.

## How does it work? - A first high level overview

![App Overview](https://github.com/options-vault/options-vault/blob/dev/assets/options-vault-overview-wide.png)

### Two User Types

- **User 1 (Saver/Investor)**: Deposits STX into the vaul to generate income via the covered call strategy
- **User 2 (Speculator)**: Buys call option on STX to profit from price appreciation

### Simplified User Flow
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

_Side note: the current implementation uses STX as the underlying asset. However, with only slight changes to less than 5% of the codebase, the contract could be used with any other asset on the Satcks blockchain. And with the help of dlc.link technology option yield vaults containing native Bitcoin and paying out native Bitcoin yields could be created - this is the long-term vision of the project._

## How does it work? - Let's dig deeper

The high-level overview covers the key parts of the system, but let's now go a layer deeper and look at the contract mechanics under the hood.

### Smart contract design
The Dapp is comprised of **two smart contracts**:

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

### Calendar time vs. block time
In order to offer options contract with calendar expiry dates (instead of block times), we use a Redstone oracle as a reliable, decentralized source for feeding calendar timestamps (and the corresponding STXUSD prices) to our smart contracts. A server streams the Redstone data packages to our options-nft smart contract in pre-deteremined time intervals. (Note: the current implementation does _not_ include the server).

### Cycles

![Cycle Overview](https://github.com/options-vault/options-vault/blob/dev/assets/cycle-overview-2.png)

The whole app revolves around a one week cycle. The variable `current-cycle-expiry`, which holds the UNIX timestamp of the current cycle's epxiry. This variable acts as the contract's internal clock. 

A cycle plays out as follows:

**I. Auction**\
During a 3hr auction that decreases the price by 2% increments every 30min (dutch auction), user 2 gets the ability to buy options NFTs representing **call** options on STXUSD. The options have a one week expiry (every Friday @ 4pm GMT) and a strike price 15% above the current STXUSD price. 

**II. Settlement**\
Once the option has expired the contract calculates the options NFT's value (`options-pnl`). This vaule being either positive (in-the-money) or zero (out-of-the-money) determines the distribution of the contract's funds between the options NFT holders and the vault.

A) Settlement with options NFT holders (user 2)
- _In-the-money scenario_: If the option is in-the-money the contract creates a `settlement-pool` that holds all STX owed to options NFT holders. Holders can subsequently call the `claim` function, send their option NFT to the contract and get the value of their option NFT transferred to their address. The option NFT effectively acts as a bearer asset representing a claim on the STX in the settlement-pool.
- _Out-of-the-money scenario_: If the option expires worthless no settlement pool is created, the funds remain in the vault.

B) Settlement with the vault (user 1)

Independently from the value of the options NFT, the balances of the vault's internal `ledger` need to be updated. The `distribute-pnl` function distributes the cycles' profit or loss (pnl) to the investor's in the vault by updating every user's ledger `balance`.

**III. Ledger updates and payement processing**\
Intra-week deposits and withdrawals are kept seperate from the vault `balance` and are tracked in the `pending-deposits` and `pending-withdrawal` ledger entries. Once the settlement process has been completed, the vault contract processes both deposits and withdrawals and sends the corresponding on-chain transactions. Note that deposits are processed on-chain immediately when requested by the user, while Withdrawals are only sent in bulk at the end of every cycle.

### Detailed descriptions of the functions in the `options-nft` contract

**:star2: _`submit-price-data`_**

The function receives Redstone data packages from the server and verifies if the data has been signed by a trusted Redstone oracle's public key. The function additionally contains a time-based control flow that can trigger `end-currrent-cycle`, `update-ledger` and `init-next-cycle` based on when in the cycle it is called. The first time price and time data gets submitted _after_ `current-cycle-expiry`, end-current-cycle gets executed with `determine-value-and-settle` containing the majority of the business logic. If the cycle's options NFT is in-the-money a `settlement-pool` gets created. In this case the control flow in `submit-price-data` waits until _after_ the settlement transaction has been mined before executing `update-vault-ledger` and `init-next-cycle`.


**:star2: _`end-current-cycle`_**

The function is only executed once the current-cycle is expired. It calls `determine-value-and-settle` and adds the expired cycles information to the `options-ledger-list`.


**:star2: _`determine-value-and-settle`_**

The function calculates the expired option's value and updates the `options-ledger` entry with the corresponding `option-pnl` (profit and loss). If the `option-pnl` is positive, the function calls the `create-settlement-pool` method in the vault contract.


**:star2: _`update-vault-ledger`_**

The function calls three methods in the vault contract: `distribute-pnl`, `process-deposits` and `process-withdrawals`.


**:star2: _`init-next-cycle`_**

The function sets the `next-cycle-expiry` date and then calls `calculate-strike` to determine the next cycles strike price. It then uses the information to create a new entry in the `opions-ledger`. It sets the USD price by calling `set-options-price` and then determines and sets a series of variables for the upcoming auction":
- The `auction-starttime` is 2 hours after the last cycyles expiry
- The `auction-decrement-value` is 2% of the `options-price-in-usd`
- The `options-for-sale` value is set to the vault's `total-balances`, ensuring that any options NFT sold in the auction is 1:1 covered by a STX in the vault

It finally sets `current-cycle-expiry` to one week after the last expiry date.


**:star2: _`calculate-strike`_**

A simple calculation to set the strike price 15% higher than the current price of the underlying asset. In the next iteration we intend to replace this simplified calculation with a calculation that takes more variables (i.e. volatility) into account. Since the beginning of the auction is somewhat variable (there is a small chance that it starts later than normal-start-time) it would help risk-management to make the calculate-strike and/or the set-optons-price functions dependent on the time-to-expiry, which would allow to more accurately price the option's time value.


**:star2: _`set-options-price`_**

The price is determined using a simplified calculation that sets `options-price-in-usd` to 0.5% of the `stxusd-rate`. If all 52 weekly options for a year expiry worthless, a uncompounded 26% APY would be achieved by this pricing strategy. In the next iteration we intend to replace this simplified calculation with the Black Scholes formula - the industry standard for pricing European style options.
	

**:star2: _`mint`_**

The mint function allows user 2 to purchase options NFTs during a 3 hour auction window. The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. The function calls `update-options-price-in-usd` which decrements tthe `options-price-in-usd` by 2% every 30 minutes. Subsequently, the function calls `deposit-premium` in the vault contract which transfers the STX equivalent of the `options-price-in-usd` (which is calculated by `get-update-latest-price-in-stx`) from the user to the vault contract and in return the user receives an `options-nft`. Finally, the function updates the `last-token-id` in the `options-ledger` to the newly minted options NFTs `token-id`.


**:star2: _`update-options-price-in-usd`_**

The function decrements the `options-price-in-usd` by 2% every 30 minutes.


**:star2: _`claim`_**

The claim function allows user 2 to send in an option NFT and claim the STX equivalent of the `option-pnl` at expiry.  The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. It additionally receives the `token-id` of the option NFT that is to be claimed. Via the `find-expiry` method the function determines the expiry-date of the NFT by traversing the `options-ledger-list` looking for the `cycle-tuple` entry that corresponds to the `token-id`. If `option-pnl` is above zero the contract sends a STX transfer to the NFT holder.

### Detailed descriptions of the functions in the `vault` contract

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

The function distributes the cycle's profit and loss (pnl) to the investor's in the ledger on a pro-rata basis.

### helper functions

- functions to convert USD pricing into STX amounts

- functions used to iterate over the options-ledger entries
