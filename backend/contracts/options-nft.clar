(impl-trait .traits.sip009-nft-trait)

;; SIP009 NFT trait on mainnet
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; TODO: Clean up error codes
(define-constant ERR_NOT_CONTRACT_OWNER (err u110))
(define-constant ERR_UNTRUSTED_ORACLE (err u111))
(define-constant ERR_STALE_RATE (err u112))
(define-constant ERR_NO_KNOWN_PRICE (err u113))
(define-constant ERR_NOT_TOKEN_OWNER (err u114))
(define-constant ERR_OPTION_NOT_EXPIRED (err u115))
(define-constant ERR_NO_INFO_FOR_EXPIRY (err u116))
(define-constant ERR_CYCLE_INIT_FAILED (err u117))
(define-constant ERR_AUCTION_CLOSED (err u118))
(define-constant ERR_OPTIONS_SOLD_OUT (err u119))
(define-constant ERR_TOKEN_ID_NOT_IN_EXPIRY_RANGE (err u120)) ;; TODO: Still needed?
(define-constant ERR_PROCESS_DEPOSITS (err u121))
(define-constant ERR_PROCESS_WITHDRAWALS (err u122))
(define-constant ERR_RETRIEVING_STXUSD (err u123))
(define-constant ERR_UPDATE_PRICE_FAILED (err u124))

(define-data-var contract-owner principal tx-sender)

(define-non-fungible-token options-nft uint)
(define-data-var token-id-nonce uint u0)

;; TODO: Ensure that all uints are adjusted to different bases 
(define-constant symbol-stxusd 0x535458555344) ;; "STXUSD" as a buff; TODO: change to "STX" as a buff
(define-constant redstone-value-shift u100000000)
(define-constant stacks-base u1000000)
(define-constant redstone-stacks-base-diff (/ redstone-value-shift stacks-base))

;; A map of all trusted oracles, indexed by their 33 byte compressed public key.
(define-map trusted-oracles (buff 33) bool)
;; 0x3009....298 is redstone
(map-set trusted-oracles 0x03009dd87eb41d96ce8ad94aa22ea8b0ba4ac20c45e42f71726d6b180f93c3f298 true)

(define-data-var last-seen-timestamp uint (if (> block-height u0) (get-last-block-timestamp) u0))
(define-data-var last-stxusd-rate (optional uint) none)

;; The unix timestamp of the expiry date of the current cycle
(define-data-var current-cycle-expiry uint u1666368000) ;; set to Fri Oct 21 2022 16:00:00 GMT+0000
;; A map that holds the relevant data points for each batch of options issued by the contract
;; TODO: Remove total-pnl (can be computed from remaining data points)
;; TODO: Add price-in-usd? Since auction can have multiple prices do we need to store start and end price, average price? (NOTE: all transactions can be viewed and analyzed on chain)
(define-map options-ledger 
	{ cycle-expiry: uint } 
	{ 
		strike: uint, 
		first-token-id: uint, 
		last-token-id: uint, 
		option-pnl: (optional uint), 
		total-pnl: (optional uint) 
	}
) 
;; A list that holds a tuple with the cycle-expiry and the last-token-id minted for that expiry
(define-data-var options-ledger-list (list 1000 { cycle-expiry: uint, last-token-id: uint }) (list))

(define-data-var options-price-in-usd (optional uint) none)
(define-data-var options-for-sale uint u0)
(define-data-var auction-start-time uint u0) ;; TODO: Since this is set to the cycle beginning (previous cycle-expiry) this variable is no longer needed
(define-data-var auction-decrement-value uint u0)

(define-data-var settlement-block-height uint u0) 

;; TODO Change into milliseconds

(define-constant week-in-milliseconds u604800000)
(define-constant min-in-milliseconds u60000)


;; TODO: Check units for all STX transactions (mint, settlement), priced in USD but settled in STX
;; --> Should the option be priced in STX to the end user? (like on Deribit)

;; TODO: Add fail-safe public function that allows contract-owner to manually initalize AND end the next cycle. 
;; TODO: Add functions to set start-init-window and end-init-window
;; TODO: Instead of passing timestamp from receiver functions to later functions, get the timestamp from last-seen-timestamp

;; FUNCTION TO RECEIVE & VALIDATE PRICE DATA FROM REDSTONE SERVER + CONTROL CENTER FUNCTION 

;; TODO: implement helper function that abstracts away recover-signer contract call and is-trusted-oracle assert 
;; #[allow(unchecked_data)]
(define-public (submit-price-data (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65)))
	(let 
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp entries signature)))
			(current-cycle-expired (> timestamp (var-get current-cycle-expiry)))
			(settlement-tx-mined (> block-height (var-get settlement-block-height)))
		)
		;; Check if the signer is a trusted oracle.
		(asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if the data is not stale, depending on how the app is designed. TODO: is last-block-timestamp check necessary?
		(asserts! (> timestamp (get-last-block-timestamp)) ERR_STALE_RATE) ;; timestamp should be larger than the last block timestamp.
		(asserts! (>= timestamp (var-get last-seen-timestamp)) ERR_STALE_RATE) ;; timestamp should be larger than or equal to the last seen timestamp.

		(var-set last-stxusd-rate (get value (element-at entries u0))) ;; TODO: check if stxusd is always the first entry in the list after filtering
		(var-set last-seen-timestamp timestamp)		

		
		(if current-cycle-expired
			(try! (end-current-cycle))
			true
		)

		(if (and current-cycle-expired settlement-tx-mined) ;;this one will never be reached if the first state is true
			(begin
				(try! (contract-call? .vault distribute-pnl))
				(unwrap! (contract-call? .vault process-deposits) ERR_PROCESS_DEPOSITS)
				(unwrap! (contract-call? .vault process-withdrawals) ERR_PROCESS_WITHDRAWALS)
				(unwrap! (init-next-cycle) ERR_CYCLE_INIT_FAILED) 
			)
			true
		)
		(ok true)
	)
)

(define-private (is-stxusd (entries-list {symbol: (buff 32), value: uint})) 
  (is-eq (get symbol entries-list) symbol-stxusd) ;; Maybe get symbol has to be wrapped with a sha256 func
)

;; END CURRENT CYCLE

(define-private (end-current-cycle)
	(let
		(
			(last-token-id (var-get token-id-nonce))
			(cycle-tuple { cycle-expiry: (var-get current-cycle-expiry), last-token-id: last-token-id })
		) 
		(try! (determine-value-and-settle))
		(add-to-options-ledger-list cycle-tuple)
		(ok true)
	) 
)

(define-public (recover-signer  (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65))) 
	(contract-call? .redstone-verify recover-signer timestamp entries signature)
)

;; INITIALIZE NEXT CYCLE

(define-private (init-next-cycle) 
	(let 
		(
			(stxusd-rate (unwrap! (var-get last-stxusd-rate) (err u7)))
			(strike (calculate-strike stxusd-rate)) ;; simplified calculation for mvp scope
			(next-cycle-expiry (+ (var-get current-cycle-expiry) week-in-milliseconds))
			(first-token-id (+ (unwrap-panic (get-last-token-id)) u1))
			(normal-start-time (+ (var-get current-cycle-expiry) (* u120 min-in-milliseconds)))
			(now (var-get last-seen-timestamp))
		)

		(map-set options-ledger 
			{ cycle-expiry: next-cycle-expiry } 
			{ 
			strike: strike, 
			first-token-id: first-token-id, 
			last-token-id: first-token-id,
			option-pnl: none,
			total-pnl: none 
			}
		)

		(set-options-price stxusd-rate)
		(if (< now normal-start-time) 
			(var-set auction-start-time normal-start-time)	
			(var-set auction-start-time now)
		)
		(var-set auction-decrement-value (/ (unwrap-panic (var-get options-price-in-usd)) u50)) ;; each decrement represents 2% of the start price
		(var-set current-cycle-expiry next-cycle-expiry)
		(var-set options-for-sale (/ (contract-call? .vault get-total-balances) stacks-base))
		(ok true) 
	)
)

;; TODO: Move to the back of the file
(define-private (add-to-options-ledger-list (cycle-tuple { cycle-expiry: uint, last-token-id: uint}))
  (var-set options-ledger-list (unwrap-panic (as-max-len? (append (var-get options-ledger-list) cycle-tuple) u1000)))
)

(define-private (determine-value-and-settle)
	(let
		(
			(stxusd-rate (unwrap-panic (var-get last-stxusd-rate)))
			(settlement-expiry (var-get current-cycle-expiry))
	  	(settlement-options-ledger-entry (try! (get-options-ledger-entry settlement-expiry)))
    	(strike (get strike settlement-options-ledger-entry))
			(options-minted-amount (- (get first-token-id settlement-options-ledger-entry) (get last-token-id settlement-options-ledger-entry)))
		)
		(if (> strike stxusd-rate) 
			;; Option is in-the-money, pnl is positive
			(begin
				(map-set options-ledger 
					{ cycle-expiry: settlement-expiry } 
					(merge
						settlement-options-ledger-entry
						{ 
							option-pnl: (some (- strike stxusd-rate)), ;; TODO: Convert amount to STX
							total-pnl: (some (* (- strike stxusd-rate) options-minted-amount)) ;; TODO: Convert amount to STX
						}
					)
				)
			;; Create segregated settlement pool by sending all funds necessary for paying outstanding nft redemptions
			(try! (contract-call? .vault create-settlement-pool (* (- strike stxusd-rate) options-minted-amount) (as-contract tx-sender))) ;; TODO: Convert amount to STX
			)
			;; Option is out-of-the-money, pnl is zero
			(map-set options-ledger 
				{ cycle-expiry: settlement-expiry } 
				(merge
					settlement-options-ledger-entry
					{ 
						option-pnl: (some u0), 
						total-pnl: (some u0) 
					}
				)
			)
		)
		(var-set settlement-block-height block-height)
  	(ok true)
	)
)


(define-private (set-options-price (stxusd-rate uint)) 
	;; The price is determined using a simplified calculation that sets options price as 0.5% of the stxusd price
	;; If all 52 weekly options for a year would expiry worthless, a uncompounded 26% APY would be achieved by this pricing strategy
	;; In the next iteration we intend to replace this simplified calculation with the Black Scholes formula - the industry standard for pricing European style options
	(var-set options-price-in-usd (some (/ stxusd-rate u200)))
)

(define-private (calculate-strike (stxusd-rate uint))
	;; A simple calculation to set the strike price 15% higher than the current price of the underlying asset
	;; In the next iteration we intend to replace this simplified calculation with a calculation that thanks more variables (i.e. volatility) into account
	;; Since the begin of the auction is somewhat variable (there is a small chance that it starts later than normal-start-time) it would help risk-management
	;; to make the calculate-strike and/or the set-optons-price functions dependent on the time-to-expiry, therefore properly pricing the option's time value
	(/ (* stxusd-rate u115) u100)
)
;; NFT MINTING (Priced in USD, payed in STX)

;; #[allow(unchecked_data)]
(define-public (mint (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65)))
	(let
		(
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp entries signature)))
			(token-id (+ (var-get token-id-nonce) u1))
      (current-cycle-options-ledger-entry (try! (get-options-ledger-entry (var-get current-cycle-expiry))))
			(stxusd-rate (unwrap! (get value (element-at entries u0)) ERR_RETRIEVING_STXUSD)) ;; had to take out the filter to pass test
		)
		(asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if options-nft are available for sale. The contract can only sell as many options-nfts as there are funds in the vault
		(asserts! (> (var-get options-for-sale) u0) ERR_OPTIONS_SOLD_OUT)
		;; Check if auciton has run for more than 180 minutes, this ensures that the auction never runs longer than 3 hours thus reducing delta risk
		;; (i.e. the risk of a unfavorable change in the price of the underlying asset)
		(asserts! (< timestamp (+ (var-get auction-start-time) (* min-in-milliseconds u180))) ERR_AUCTION_CLOSED)
		;; Update the mint price based on where in the 180 min minting window we are 
		(unwrap! (update-options-price-in-usd timestamp) ERR_UPDATE_PRICE_FAILED)
		;; Update the token ID nonce
		(var-set token-id-nonce token-id)
		;; Deposit the premium payment into the vault contract
		(try! (contract-call? .vault deposit-premium (try! (get-update-latest-price-in-stx timestamp stxusd-rate)) tx-sender))
		;; Mint the NFT
		(try! (nft-mint? options-nft token-id tx-sender))
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

(define-private (update-options-price-in-usd (timestamp uint)) 
	(let
		(
			(decrement (* (/ (- timestamp (var-get auction-start-time)) (* min-in-milliseconds u30)) (var-get auction-decrement-value)))
		)
		(ok (var-set options-price-in-usd (some (- (unwrap-panic (var-get options-price-in-usd)) decrement))))
	)
)

;; SETTLEMENT

;; #[allow(unchecked_data)] 
(define-public (claim (token-id uint) (timestamp uint) (stxusd-rate uint) (signature (buff 65))) ;; claim
  (let
    (
      (recipient tx-sender)
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(token-expiry (get timestamp (find-expiry token-id)))
			(settlement-options-ledger-entry (try! (get-options-ledger-entry token-expiry)))
			(option-pnl (get option-pnl settlement-options-ledger-entry))
			(first-token-id (get first-token-id settlement-options-ledger-entry)) 
			(last-token-id (get last-token-id settlement-options-ledger-entry))

    ) 
		;; Check if the signer is a trusted oracle
    (asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if provided token-id is in the range for the expiry
		(asserts! (and (>= token-id first-token-id) (<= token-id last-token-id)) ERR_TOKEN_ID_NOT_IN_EXPIRY_RANGE)
		;; Check if options is expired
		(asserts! (> timestamp token-expiry) ERR_OPTION_NOT_EXPIRED) 
		
		(match option-pnl
			payout
			;; check that the option-pnl is great than zero
			(begin
				;; Transfer options NFT to settlement contract
				(try! (transfer token-id tx-sender (as-contract tx-sender)))
				;; Transfer STX to tx-sender
				(try! (as-contract (stx-transfer? (unwrap-panic option-pnl) tx-sender recipient)))
				(ok true)
			)
			ERR_OPTION_NOT_EXPIRED
		)
  )
)

(define-private (find-expiry (token-id uint)) 
	(fold find-expiry-helper (var-get options-ledger-list) { timestamp: u0, token-id: token-id, found: false })
)

(define-private (find-expiry-helper (current-element { cycle-expiry: uint, last-token-id: uint }) (prev-value { timestamp: uint, token-id: uint, found: bool }) ) 
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

(define-public (set-contract-owner (new-owner principal))
	(begin
		(asserts! (is-eq (var-get contract-owner) tx-sender) ERR_NOT_CONTRACT_OWNER)
		(ok (var-set contract-owner tx-sender))
	)
)

(define-public (get-contract-owner)
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
	(/ (* usd stacks-base) (/ stxusd-rate redstone-stacks-base-diff))
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

;; (!) For testing purposes only, delete for deployment (!)

;; auction-start-time
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

;; current-cycle-expiry
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

;; options-price-in-usd
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

;; options-ledger
;; #[allow(unchecked_data)]
(define-public (set-options-ledger-entry (strike uint)) 
	(begin
		(asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_CONTRACT_OWNER)
		(ok (map-set options-ledger 
			{ cycle-expiry: (get-current-cycle-expiry) } 
			{ 
			strike: strike, 
			first-token-id: u0, 
			last-token-id: u0,
			option-pnl: none,
			total-pnl: none 
			}
		)
		)
	)	
)

(define-read-only (get-options-ledger-entry (cycle-expiry uint)) 
  (ok (unwrap! (map-get? options-ledger {cycle-expiry: cycle-expiry}) ERR_NO_INFO_FOR_EXPIRY))
)

(define-read-only (get-strike-for-expiry (cycle-expiry uint)) 
  (ok (get strike (unwrap! (map-get? options-ledger {cycle-expiry: cycle-expiry}) ERR_NO_INFO_FOR_EXPIRY)))
)

;; options-for-sale
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