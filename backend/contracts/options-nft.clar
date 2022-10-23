(impl-trait .traits.sip009-nft-trait)

;; SIP009 NFT trait on mainnet
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; constants

(define-constant ERR_NOT_CONTRACT_OWNER (err u110))
(define-constant ERR_UNTRUSTED_ORACLE (err u111))
(define-constant ERR_STALE_RATE (err u112))
(define-constant ERR_NO_KNOWN_PRICE (err u113))
(define-constant ERR_NOT_TOKEN_OWNER (err u114))
(define-constant ERR_OPTION_NOT_EXPIRED (err u115))
(define-constant ERR_NO_ENTRY_FOR_EXPIRY (err u116))
(define-constant ERR_AUCTION_CLOSED (err u117))
(define-constant ERR_OPTIONS_SOLD_OUT (err u118))
(define-constant ERR_UPDATE_PRICE_FAILED (err u119))
(define-constant ERR_READING_STXUSD_RATE (err u120))
(define-constant ERR_INIT_AUCTION (err u121))

(define-constant symbol-stx 0x535458) ;; "STX" as a buff
(define-constant stacks-base u1000000)

(define-constant week-in-milliseconds u604800000)
(define-constant min-in-milliseconds u60000)

;; data maps and vars

(define-data-var contract-owner principal tx-sender)

(define-non-fungible-token options-nft uint)
(define-data-var token-id-nonce uint u0)

;; A map of all trusted oracles, indexed by their 33 byte compressed public key.
(define-map trusted-oracles (buff 33) bool)
;; 0x3009....298 is redstone
(map-set trusted-oracles 0x03009dd87eb41d96ce8ad94aa22ea8b0ba4ac20c45e42f71726d6b180f93c3f298 true)

;; Last seen timestamp. The if clause is so that the contract can deploy on a Clarinet console session.
(define-data-var last-seen-timestamp uint (if (> block-height u0) (get-last-block-timestamp) u0))
(define-data-var last-stxusd-rate (optional uint) none)

;; The unix millisecond timestamp of the expiry date of the current cycle
(define-data-var current-cycle-expiry uint u1666972800000) ;; set to Fri Oct 28 2022 16:00:00 GMT+0000


;; A map that holds the relevant data points for each batch of options issued by the contract
(define-map options-ledger 
	{ cycle-expiry: uint } 
	{ 
		strike: uint, 
		first-token-id: uint, 
		last-token-id: uint, 
		option-pnl: (optional uint)
	}
) 
;; A list that holds a tuple with the cycle-expiry and the last-token-id minted for that expiry
(define-data-var options-ledger-list (list 1000 { cycle-expiry: uint, last-token-id: uint }) (list))

(define-data-var auction-start-time uint u0)
(define-data-var auction-decrement-value uint u0)
(define-data-var auction-applied-decrements uint u0)
(define-data-var options-price-in-usd (optional uint) none)
(define-data-var options-for-sale uint u0)

;; private functions

;; <transition-to-next-cycle>: The function is only executed once, after current-cycle is expired. It calls series of functions
;;                             that determine-value of the expired cycle, create-settlementpool if the option NFT holds value, 
;;                             reflect all changes in the internal ledger system and initializes the auction for the next cycle.
(define-private (transition-to-next-cycle)
	(let
		(
			(next-cycle-expiry (+ (var-get current-cycle-expiry) week-in-milliseconds))
		) 
		;; Determine the value of the expired options NFT (pnl)
		(try! (determine-value)) ;; TODO: Rename to determine-options-value
		;; Create a settlement-pool for payouts to holders of in-the-money options NFTs
		(try! (create-settlement-pool)) ;; TODO: Check if option-pnl > 0 before executing create-settlement-pool (improve execution cost)
		;; Update the vault ledger distributing pnl to vault depositors and processing intra-week deposits and withdrawals
		(try! (update-vault-ledger))
		;; Create an options-ledger entry for the next cycle
		(try! (update-options-ledger next-cycle-expiry))
		;; Initialize the auction for the next cycle
		(unwrap! (init-auction) ERR_INIT_AUCTION)
		;; Change the contract's internal clock (represented by the var current-cycle-expiry) to the next cycle's expiry date: a new cycle has begun
		(var-set current-cycle-expiry next-cycle-expiry)
		(ok true) 
	)
)

;; <determine-value>: The function calculates the value of the expired options NFT and updates the options-ledger entry with
;;                    the corresponding option-pnl (profit and loss).
(define-private (determine-value) 
	(let
		(
			(settlement-cycle-expiry (var-get current-cycle-expiry))
	  	(settlement-options-ledger-entry (try! (get-options-ledger-entry settlement-cycle-expiry)))
    	(stxusd-rate (unwrap! (var-get last-stxusd-rate) ERR_READING_STXUSD_RATE))
			(strike (get strike settlement-options-ledger-entry))
			(last-token-id (var-get token-id-nonce))
			(cycle-tuple { cycle-expiry: settlement-cycle-expiry, last-token-id: last-token-id })
		)
		(if (> stxusd-rate strike) 
			;; Option is in-the-money, pnl is positive
			(map-set options-ledger 
				{ cycle-expiry: settlement-cycle-expiry } 
				(merge
					settlement-options-ledger-entry
					{ 
						option-pnl: (some (usd-to-stx (- stxusd-rate strike) stxusd-rate))
					}
				)
			)
			;; Option is out-of-the-money, pnl is zero
			(map-set options-ledger 
				{ cycle-expiry: settlement-cycle-expiry } 
				(merge
					settlement-options-ledger-entry
					{ 
						option-pnl: (some u0)
					}
				)
			)
		)
		;; Add to options-ledger-list so that the claim function can iterate over all past cycles 
		(add-to-options-ledger-list cycle-tuple)
		(ok true)
	)
)

;; <crete-settlement-pool>: If the option-pnl is positive, the function calls the create-settlement-pool method in the vault contract,
;;                          which allocates all funds needed to pay back options NFT holder for the week to a seperate account. 
(define-private (create-settlement-pool) 
	(let
		(
			(settlement-cycle-expiry (var-get current-cycle-expiry))
	  	(settlement-options-ledger-entry (try! (get-options-ledger-entry settlement-cycle-expiry)))
			(option-pnl (unwrap-panic (get option-pnl settlement-options-ledger-entry)))
			(options-minted-amount (+ (- (get last-token-id settlement-options-ledger-entry) (get first-token-id settlement-options-ledger-entry)) u1))
			(stxusd-rate (unwrap! (var-get last-stxusd-rate) ERR_READING_STXUSD_RATE))
		)
		(if (> option-pnl u0) 
			;; Create segregated settlement pool for all STX owed to options NFT holders
			(try! (as-contract (contract-call? .vault create-settlement-pool (* option-pnl options-minted-amount)))) 
			true
		)
		(ok true)
	)
)

;; <update-vault-ledger>: The function updates the vault ledger by reflecting the cycle's option-pnl in investor balances 
;;                        and processes the intra-cycle deposits and withdrawals.
(define-private (update-vault-ledger) 
	(begin 
		(try! (as-contract (contract-call? .vault distribute-pnl)))
		(try! (as-contract (contract-call? .vault process-deposits)))
		(try! (as-contract (contract-call? .vault process-withdrawals)))
		(ok true)
	)
)

;; <set-options-ledger>: The function creates an options-ledger entry for the next cycle.
(define-private (update-options-ledger (next-cycle-expiry uint)) 
	(let
		(
			(stxusd-rate (unwrap! (var-get last-stxusd-rate) ERR_READING_STXUSD_RATE))
			(strike (calculate-strike stxusd-rate))
			(first-token-id (+ (unwrap-panic (get-last-token-id)) u1))
		)
		;; Create an options-ledger entry for the next cycle
		(map-set options-ledger 
			{ cycle-expiry: next-cycle-expiry } 
			{
				strike: strike, 
				first-token-id: first-token-id, 
				last-token-id: first-token-id,
				option-pnl: none
			}
		)
		(ok true)
	)
)

;; <init-auction>: The function sets the next-cycle-expiry date, calls calculate-strike to determine the next cycles strike price
;;                 and creates a new entry in the opions-ledger. It sets the USD price by calling set-options-price and then 
;;                 determines and sets a series of variables for the upcoming auction.
(define-private (init-auction) 
	(let
		(
			(stxusd-rate (unwrap! (var-get last-stxusd-rate) ERR_READING_STXUSD_RATE))
			(normal-start-time (+ (var-get current-cycle-expiry) (* u120 min-in-milliseconds)))
			(now (var-get last-seen-timestamp))
		)
		(set-options-price stxusd-rate)
		(if (< now normal-start-time) 
			(var-set auction-start-time normal-start-time)	
			(var-set auction-start-time now)
		)
		(var-set auction-applied-decrements u0)
		(var-set auction-decrement-value (/ (unwrap-panic (var-get options-price-in-usd)) u50)) ;; each decrement represents 2% of the start price
		(var-set options-for-sale (/ (contract-call? .vault get-total-balances) stacks-base))
		(ok true)
	)
)

;; <is-stx>: This helper function allows to filter out "STX" entries in a list.
(define-private (is-stx (entries-list {symbol: (buff 32), value: uint})) 
  (is-eq (get symbol entries-list) symbol-stx) 
)

;; <add-to-options-ledger-list>: Adds a cycle-tuple to the options-ledger-list. Called by determine-value.
(define-private (add-to-options-ledger-list (cycle-tuple { cycle-expiry: uint, last-token-id: uint}))
  (var-set options-ledger-list (unwrap-panic (as-max-len? (append (var-get options-ledger-list) cycle-tuple) u1000)))
)

;; <set-options-price>: The price is determined using a simplified calculation that sets the options-price-in-usd to 0.5% of the stxusd-rate. If all 52 weekly options
;;                      for a year expiry worthless, an uncompounded 26% APY would be achieved by this pricing strategy. In the next iteration we intend
;;                      to replace this simplified calculation with the Black Scholes formula - the industry standard for pricing European style options.
(define-private (set-options-price (stxusd-rate uint)) 
	(var-set options-price-in-usd (some (/ stxusd-rate u200)))
)

;; <calculate-strike>: Sets the strike price of the options NFT 15% above the current price of the underlying asset. 
;;                     In the next iteration we intend to replace this with a calculation that takes more variables (i.e. volatility) into account.
(define-private (calculate-strike (stxusd-rate uint))
	(/ (* stxusd-rate u115) u100)
)

;; <update-options-price-in-usd>: The function decrements the options-price-in-usd by 2% every 30 minutes during the 3 hour auction. 
;;                                If the epexted-decrements are higher than the applied-decrements, the necessary decrements are applied to the options-price-in-usd.
(define-private (update-options-price-in-usd (timestamp uint)) 
	(let
		(
			(expected-decrements (/ (- timestamp (var-get auction-start-time)) (* min-in-milliseconds u30)))
			(applied-decrements (var-get auction-applied-decrements))
		)
		(if (> expected-decrements applied-decrements)
			(begin 
				(var-set options-price-in-usd 
				(some 
				 	(- 
						(unwrap-panic (var-get options-price-in-usd)) 
						(* 
							(- expected-decrements applied-decrements) 
							(var-get auction-decrement-value)
						)
					)
				))
				(var-set auction-applied-decrements expected-decrements)
			)
			true
		)
		(ok true)
	)
)

;; <find-options-ledger-entry>: The function returns the options-ledger-entry tuple that corresponds to the token-id provided.
(define-private (find-options-ledger-entry (token-id uint)) 
	(ok (fold find-options-ledger-entry-helper (var-get options-ledger-list) { timestamp: u0, token-id: token-id, found: false }))
)

(define-private (find-options-ledger-entry-helper (current-element { cycle-expiry: uint, last-token-id: uint }) (prev-value { timestamp: uint, token-id: uint, found: bool }) ) 
	(begin
		(if 
			(and 
				(<= (get token-id prev-value) (get last-token-id current-element))
				(not (get found prev-value))
			) 
			{ 
				timestamp: (get cycle-expiry current-element), 
				token-id: (get token-id prev-value), 
				found: true 
			}
			prev-value
		)
	)
)

;; public functions

;; <submit-price-data>: The function receives Redstone data packages from the server and verifies if the data has been signed by a trusted Redstone oracle's public key.
;;                      The function additionally contains a time-based control flow that can trigger `transition-to-next-cycle` if the cycle has expred.
(define-public (submit-price-data (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65)))
	(let 
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp entries signature)))
			;; Check if the cycle is epxired.
			(cycle-expired (>= timestamp (var-get current-cycle-expiry)))
		)
		;; Check if the signer is a trusted oracle.
		(asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if the data is not stale
		(asserts! (> timestamp (get-last-block-timestamp)) ERR_STALE_RATE) ;; timestamp should be larger than the last block timestamp.
		(asserts! (>= timestamp (var-get last-seen-timestamp)) ERR_STALE_RATE) ;; timestamp should be larger than or equal to the last seen timestamp.

		;; Set the contract variables last-stxusd-rate and last-seen-timestamp to the newly provided values
		(var-set last-stxusd-rate (get value (element-at (filter is-stx entries) u0))) 
		(var-set last-seen-timestamp timestamp)		

		(if cycle-expired
			(try! (transition-to-next-cycle))
			true
		)

		(ok true)
	)
)

;; <mint>: The mint function allows users to purchase options NFTs during a 3 hour auction window. The function receives pricing data from a Redstone oracle and verifies
;;         that it was signed by a trusted public key. The function interacts with update-options-price-in-usd which decrements the options-price-in-usd by 2% every 30 minutes.
;;         The options NFT is priced in USD, but the sale is settled in STX - get-update-latest-price-in-stx handles the conversion.
(define-public (mint (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65)))
	(let
		(
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp entries signature)))
			(token-id (+ (var-get token-id-nonce) u1))
      (current-cycle-options-ledger-entry (try! (get-options-ledger-entry (var-get current-cycle-expiry))))
			(stxusd-rate (unwrap-panic (get value (element-at (filter is-stx entries) u0))))
		)
		(asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if an options-nft is available for sale. The contract can only sell as many options-nfts as there are funds in the vault
		(asserts! (> (var-get options-for-sale) u0) ERR_OPTIONS_SOLD_OUT)
		;; Check if auciton has started and has not run for more than 180 minutes, 
		;; Having the auction never run longer than 3 hours reduces the delta risk (i.e. the risk of a unfavorable change in the price of the underlying asset)
		(asserts! (> timestamp (var-get auction-start-time)) ERR_AUCTION_CLOSED)
		(asserts! (< timestamp (+ (var-get auction-start-time) (* min-in-milliseconds u180))) ERR_AUCTION_CLOSED)
		;; Update the mint price based on where in the 180 min minting window we are
		(unwrap! (update-options-price-in-usd timestamp) ERR_UPDATE_PRICE_FAILED)
		;; Update the token ID nonce
		(var-set token-id-nonce token-id)
		;; Deposit the premium payment into the vault contract
		(try! (contract-call? .vault deposit-premium (try! (get-update-latest-price-in-stx timestamp stxusd-rate)) tx-sender))
		;; Mint the options NFT
		(try! (nft-mint? options-nft token-id tx-sender))
		;; Reduce the options-for-sale variable by 1
		(var-set options-for-sale (- (var-get options-for-sale) u1))
		;; Update last-token-id in the options-ledger with the token-id of the minted NFT
		(map-set options-ledger
			{ cycle-expiry: (var-get current-cycle-expiry) } 
			(merge
				current-cycle-options-ledger-entry
				{ last-token-id: token-id }
			)
		)
		(ok token-id)
	)
)

;; <claim>: The claim function allows users to send an option NFT to the options-nft contract and claim the STX equivalent of the option-pnl at expiry. 
;;          The function receives pricing data from a Redstone oracle and verifies that it was signed by a trusted public key. It additionally receives 
;;          the token-id of the option NFT that is to be claimed. Via the find-options-ledger-entry method the expiry-date of the NFT is determined. 
;;          If the option-pnl is posiive the contract sends a STX transfer to the NFT holder.
;; #[allow(unchecked_data)] 
(define-public (claim (token-id uint) (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65)))
  (let
    (
      (recipient tx-sender)
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp entries signature)))
			(token-expiry (get timestamp (unwrap-panic (find-options-ledger-entry token-id)))) 
			(settlement-options-ledger-entry (unwrap! (get-options-ledger-entry token-expiry) ERR_OPTION_NOT_EXPIRED))
			(option-pnl (unwrap-panic (get option-pnl settlement-options-ledger-entry)))
    )
		;; Check if the signer is a trusted oracle
    (asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		(if (> option-pnl u0) 
			(begin
				;; Transfer options NFT to settlement contract
				(try! (transfer token-id tx-sender (as-contract tx-sender)))
				;; Transfer STX out of th settlement pool in the vault contract to recipient
				(try! (as-contract (contract-call? .vault claim-settlement option-pnl recipient))) 
			)
			true
		)
		(ok true)
  )
)

;; NFT HELPER FUNCTOINS

(define-read-only (get-last-token-id)
	(ok (var-get token-id-nonce))
)

(define-read-only (get-token-uri (token-id uint))
	(ok none)
)

(define-read-only (get-owner (token-id uint))
	(ok (nft-get-owner? options-nft token-id))
)

;; #[allow(unchecked_data)]
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
	(begin
		(asserts! (or (is-eq sender tx-sender) (is-eq sender contract-caller)) ERR_NOT_TOKEN_OWNER)
		(nft-transfer? options-nft token-id sender recipient)
	)
)

;; CONTRACT OWNERSHIP HELPER FUNCTIONS

;; #[allow(unchecked_data)]
(define-public (set-contract-owner (new-owner principal))
	(begin
		(asserts! (is-eq (var-get contract-owner) tx-sender) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set contract-owner new-owner))
	)
)

(define-read-only (get-contract-owner)
	(ok (var-get contract-owner))
)

;; ORACLE DATA VERIFICATION HELPER FUNCTIONS

(define-private (get-last-block-timestamp)
	(default-to u0 (get-block-info? time (- block-height u1)))
)

(define-read-only (is-trusted-oracle (pubkey (buff 33)))
	(default-to false (map-get? trusted-oracles pubkey))
)

;; #[allow(unchecked_data)]
(define-public (set-trusted-oracle (pubkey (buff 33)) (trusted bool))
	(begin
		(asserts! (is-eq (var-get contract-owner) tx-sender) ERR_NOT_CONTRACT_OWNER)
		(ok (map-set trusted-oracles pubkey trusted))
	)
)

;; PRICING HELPER FUNCTIONS

(define-private (get-update-latest-price-in-stx (timestamp uint) (current-stxusd-rate uint))
	(let
		(
			(last-timestamp (var-get last-seen-timestamp))
			(last-block-timestamp (get-last-block-timestamp))
			(newer-data (> timestamp last-timestamp))
		)
		;; If the newest timestamp is older than the timestamp of the last block, then
		;; the data is stale and will not be used.
		(asserts! (> (if newer-data timestamp last-timestamp) last-block-timestamp) ERR_STALE_RATE)

		;; If the submitted timestamp is older, use the last known rate. Otherwise,
		;; store the new rate and use it.
		(asserts! newer-data (get-last-price-in-stx))

		(var-set last-seen-timestamp timestamp)
		(var-set last-stxusd-rate (some current-stxusd-rate))
		(ok (usd-to-stx (get-usd-price) current-stxusd-rate))
	)
)

(define-read-only (usd-to-stx (usd uint) (stxusd-rate uint))
	(/ (* usd stacks-base) stxusd-rate) 
)

(define-read-only (get-usd-price)
	(unwrap-panic (var-get options-price-in-usd))
)

(define-read-only (get-last-price-in-stx)
	(match (var-get last-stxusd-rate)
		stxusd-rate (ok (usd-to-stx (get-usd-price) stxusd-rate))
		ERR_NO_KNOWN_PRICE
	)
)

(define-read-only (get-last-seen-timestamp) 
	(var-get last-seen-timestamp)
)

(define-read-only (get-last-stxusd-rate) 
	(var-get last-stxusd-rate)
)

;; TESTING HELPER FUNCTIONS
;; (!) For testing purposes only, not to be deployed to production (!)
;; (!) Delete setter functions for deployment to improve contract security and cost efficiency (!)

;; #[allow(unchecked_data)]
(define-public (set-auction-start-time (timestamp uint)) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set auction-start-time timestamp))
	)	
)

(define-read-only (get-auction-start-time) 
	(var-get auction-start-time)
)

(define-read-only (get-auction-decrement-value) 
	(var-get auction-decrement-value)
)

;; #[allow(unchecked_data)]
(define-public (set-current-cycle-expiry (timestamp uint)) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set current-cycle-expiry timestamp))
	)	
)

(define-read-only (get-current-cycle-expiry) 
	(var-get current-cycle-expiry)
)

;; #[allow(unchecked_data)]
(define-public (set-options-price-in-usd (price uint)) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set options-price-in-usd (some price)))
	)	
)

(define-read-only (get-options-price-in-usd) 
	(var-get options-price-in-usd)
)

;; #[allow(unchecked_data)]
(define-public (set-options-ledger-entry (strike uint)) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (map-set options-ledger 
			{ cycle-expiry: (get-current-cycle-expiry) } 
			{ 
			strike: strike, 
			first-token-id: u1, 
			last-token-id: u1,
			option-pnl: none
			}
		)
		)
	)	
)

(define-read-only (get-options-ledger-entry (cycle-expiry uint)) 
  (ok (unwrap! (map-get? options-ledger {cycle-expiry: cycle-expiry}) ERR_NO_ENTRY_FOR_EXPIRY))
)

(define-read-only (get-strike-for-expiry (cycle-expiry uint)) 
  (ok (get strike (unwrap! (map-get? options-ledger {cycle-expiry: cycle-expiry}) ERR_NO_ENTRY_FOR_EXPIRY)))
)

(define-read-only (get-option-pnl-for-expiry (cycle-expiry uint)) 
  (ok (get option-pnl (unwrap! (map-get? options-ledger {cycle-expiry: cycle-expiry}) ERR_NO_ENTRY_FOR_EXPIRY)))
)

;; #[allow(unchecked_data)]
(define-public (set-options-for-sale (amount uint)) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set options-for-sale amount))
	)	
)

(define-read-only (get-options-for-sale) 
	(var-get options-for-sale)
)

(define-read-only (get-options-ledger-list) 
	(var-get options-ledger-list)
)

(define-public (recover-signer  (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65))) 
	(contract-call? .redstone-verify recover-signer timestamp entries signature)
)

(define-public (process-deposits-from-options) 

	(as-contract (contract-call? .vault process-deposits))
)

(define-public (process-withdrawals-from-options) 
	(as-contract (contract-call? .vault process-withdrawals))
)

(define-public (create-settlement-pool-from-options (amount uint)) 
	(as-contract (contract-call? .vault create-settlement-pool amount))
)

(define-public (distribute-pnl-from-options) 
	(as-contract (contract-call? .vault distribute-pnl))
)

(define-public (claim-settlement-from-options (amount uint) (recipient principal)) 
	(as-contract (contract-call? .vault claim-settlement amount recipient))
)

(define-read-only (get-auction-applied-decrements) 
	(var-get auction-applied-decrements)
)

;; #[allow(unchecked_data)]
(define-public (set-auction-decrement-value) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set auction-decrement-value (/ (unwrap-panic (var-get options-price-in-usd)) u50)))
	 )
)
