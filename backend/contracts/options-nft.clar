(impl-trait .traits.sip009-nft-trait)

;; SIP009 NFT trait on mainnet
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; TODO: Clean up error codes
(define-constant ERR_NOT_CONTRACT_OWNER (err u100))
(define-constant ERR_UNTRUSTED_ORACLE (err u101))
(define-constant ERR_STALE_RATE (err u102))
(define-constant ERR_NO_KNOWN_PRICE (err u103))
(define-constant ERR_NOT_TOKEN_OWNER (err u104))
(define-constant ERR_OPTION_NOT_EXPIRED (err u105))
(define-constant ERR_NO_INFO_FOR_EXPIRY (err u106))
(define-constant ERR_CYCLE_INIT_FAILED (err u107))
(define-constant ERR_AUCTION_CLOSED (err u108))
(define-constant ERR_OPTIONS_SOLD_OUT (err u109))
(define-constant ERR_TOKEN_ID_NOT_IN_EXPIRY_RANGE (err u110)) ;; TODO: Still needed?

(define-data-var contract-owner principal tx-sender)

(define-non-fungible-token options-nft uint)
(define-data-var token-id-nonce uint u0)

(define-constant symbol-stxusd 0x535458555344) ;; "STXUSD" as a buff
(define-constant redstone-value-shift u100000000)
(define-constant stacks-base u1000000)
(define-constant redstone-stacks-base-diff (/ redstone-value-shift stacks-base))

;; A map of all trusted oracles, indexed by their 33 byte compressed public key.
(define-map trusted-oracles (buff 33) bool)
(map-set trusted-oracles 0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6 true)

;; Last seen timestamp. The if clause is so that the contract can deploy on a Clarinet console session.
(define-data-var last-seen-timestamp uint (if (> block-height u0) (get-last-block-timestamp) u0))
(define-data-var last-stxusd-rate (optional uint) none)

;; The unix timestamp of the expiry date of the current cycle
(define-data-var current-cycle-expiry uint u1665763200) ;; set to Fri Oct 14 2022 16:00:00 GMT+0000
;; A map that holds the relevant data points for each batch of options issued by the contract
;; TODO: Rename to options-batch-info or batch-info
;; TODO: Remove total-pnl (can be computed from remaining data points)
;; TODO: Add price-in-usd? Since auction can have multiple prices do we need to store start and end price, average price? (NOTE: all transactions can be viewed and analyzed on chain)
(define-map options-info { cycle-expiry: uint } { strike: uint, first-token-id: uint, last-token-id: uint, option-pnl: (optional uint), total-pnl: (optional uint) }) 
;; A list that holds a tuple with the cycle-expiry and the last-token-id minted for that expiry
(define-data-var options-info-list (list 1000 { cycle-expiry: uint, last-token-id: uint }) (list))

(define-data-var options-price-in-usd (optional uint) none)
(define-data-var options-for-sale uint u0)
(define-data-var auction-start-time uint u0) ;; TODO: Since this is set to the cycle beginning (previous cycle-expiry) this variable is no longer needed
(define-data-var auction-decrement-value uint u0)

(define-data-var block-height-settlement uint u0) 

(define-constant week-in-seconds u604800)
(define-constant min-in-seconds u60)

;; TODO: Check units for all STX transactions (mint, settlement), priced in USD but settled in STX

;; TODO: Add fail-safe public function that allows contract-owner to manually initalize AND end the next cycle. 
;; TODO: Add functions to set start-init-window and end-init-window
;; TODO: Instead of passing timestamp from receiver functions to later functions, get the timestamp from last-seen-timestamp

;; FUNCTION TO RECEIVE & VALIDATE PRICE DATA FROM REDSTONE SERVER + CONTROL CENTER FUNCTION 

;; TODO: implement helper function that abstracts away recover-signer contract call and is-trusted-oracle assert 
;; #[allow(unchecked_data)]
(define-public (submit-price-data (timestamp uint) (stxusd-rate uint) (signature (buff 65)))
	(let 
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(current-cycle-expired (> timestamp (var-get current-cycle-expiry)))
			(settlement-tx-mined (> block-height (var-get block-height-settlement)))
		)
		;; Check if the signer is a trusted oracle.
		(asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if the data is not stale, depending on how the app is designed. TODO: is last-block-timestamp check necessary?
		(asserts! (> timestamp (get-last-block-timestamp)) ERR_STALE_RATE) ;; timestamp should be larger than the last block timestamp.
		(asserts! (>= timestamp (var-get last-seen-timestamp)) ERR_STALE_RATE) ;; timestamp should be larger than or equal to the last seen timestamp.

		(var-set last-stxusd-rate (some stxusd-rate))
		(var-set last-seen-timestamp timestamp)		

		(if current-cycle-expired 
			(try! (end-current-cycle))
			true
		)

		(if settlement-tx-mined
			(begin
				(try! (contract-call? .vault distribute-pnl))
				(unwrap! (init-next-cycle) ERR_CYCLE_INIT_FAILED) 
				;; TODO: Why can't I use try! here instead of unwrap!?
			)
			true
		)
		(ok true)
	)
)

;; END CURRENT CYCLE

(define-private (end-current-cycle)
	(let
		(
			(last-token-id (var-get token-id-nonce))
			(cycle-tuple { cycle-expiry: (var-get current-cycle-expiry), last-token-id: last-token-id })
		) 
		(try! (determine-value-and-settle))
		(add-to-options-info-list cycle-tuple)
		(ok true)
	) 
)

;; INITIALIZE NEXT CYCLE

(define-private (init-next-cycle) 
	(let 
		(
			(stxusd-rate (unwrap-panic (var-get last-stxusd-rate)))
			(strike (calculate-strike stxusd-rate)) ;; simplified version
			(next-cycle-expiry (+ (var-get current-cycle-expiry) week-in-seconds))
			(first-token-id (+ (unwrap-panic (get-last-token-id)) u1))
		)

		(map-set options-info { cycle-expiry: next-cycle-expiry } 
			{ 
			strike: strike, 
			first-token-id: first-token-id, 
			last-token-id: first-token-id,
			option-pnl: none,
			total-pnl: none 
			}
		)

		(set-options-price stxusd-rate)
		(var-set auction-start-time (var-get current-cycle-expiry))
		(var-set auction-decrement-value (/ (unwrap-panic (var-get options-price-in-usd)) u50)) ;; each decrement represents 2% of the start price
		(var-set current-cycle-expiry next-cycle-expiry)
		;; TODO: make sure the decimals between balances in the vault and options-minted-amount match
		;; --> total-balances has to rounded down to a full number (full STX) (NEXT)
		(var-set options-for-sale (contract-call? .vault get-total-balances))
		(ok true) 
	)
)

;; TODO: Move to the back of the file
(define-private (add-to-options-info-list (cycle-tuple { cycle-expiry: uint, last-token-id: uint}))
  (var-set options-info-list (unwrap-panic (as-max-len? (append (var-get options-info-list) cycle-tuple) u1000)))
)

(define-private (determine-value-and-settle)
	(let
		(
			(stxusd-rate (unwrap-panic (var-get last-stxusd-rate)))
			(settlement-expiry (var-get current-cycle-expiry))
	  	(settlement-options-info (try! (get-options-info settlement-expiry)))
    	(strike (get strike settlement-options-info))
			(options-minted-amount (- (get first-token-id settlement-options-info) (get last-token-id settlement-options-info)))
		)
		(if (> strike stxusd-rate) 
			;; Option is in-the-money, pnl is positive
			(begin
				(map-set options-info 
					{ cycle-expiry: settlement-expiry } 
					(merge
						settlement-options-info
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
			(map-set options-info 
				{ cycle-expiry: settlement-expiry } 
				(merge
					settlement-options-info
					{ 
						option-pnl: (some u0), 
						total-pnl: (some u0) 
					}
				)
			)
		)
		(var-set block-height-settlement block-height)
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
	(/ (* stxusd-rate u115) u100)
)

;; NFT MINTING (Priced in USD, payed in STX)

;; #[allow(unchecked_data)]
(define-public (mint (timestamp uint) (stxusd-rate uint) (signature (buff 65)))
	(let
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(token-id (+ (var-get token-id-nonce) u1))
      (current-cycle-options-info (try! (get-options-info (var-get current-cycle-expiry))))
		)
		(asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if options-nft are available for sale. The contract can only sell as many options-nfts as there are funds in the vault
		(asserts! (> (var-get options-for-sale) u0) ERR_OPTIONS_SOLD_OUT)
		;; Check if auciton has run for more than 180 minutes, this ensures that the auction never runs longer than 3 hours thus reducing delta risk
		;; (i.e. the risk of a unfavorable change in the price of the underlying asset)
		;; TODO: Adjust mint window to new excalidraw timeline (NEXT)
		(asserts! (< timestamp (+ (var-get auction-start-time) (* min-in-seconds u180))) ERR_AUCTION_CLOSED)
		;; Update the mint price based on where in the 180 min minting window we are 
		(update-options-price-in-usd timestamp)
		;; Update the token ID nonce
		(var-set token-id-nonce token-id)
		;; Deposit the premium payment in to the vault contract
		(try! (contract-call? .vault deposit-premium (try! (get-update-latest-price-in-stx timestamp stxusd-rate)) tx-sender))
		;; Mint the NFT
		(try! (nft-mint? options-nft token-id tx-sender))
		;; Add the token-id of the minted NFT as the last-token-id in the options-info map
		(map-set options-info 
			{ cycle-expiry: (var-get current-cycle-expiry) } 
			(merge
				current-cycle-options-info
				{ last-token-id: token-id }
			)
		)
		(ok token-id)
	)
)

(define-private (update-options-price-in-usd (timestamp uint)) 
	(let
		(
			(decrement (* (/ (- timestamp (var-get auction-start-time)) (* min-in-seconds u30)) (var-get auction-decrement-value)))
		)
		(var-set options-price-in-usd (some (- (unwrap-panic (var-get options-price-in-usd)) decrement)))
	)
)

;; SETTLEMENT

;; #[allow(unchecked_data)] 
(define-public (claim (token-id uint) (timestamp uint) (stxusd-rate uint) (signature (buff 65))) ;; claim
  (let
    (
      (signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(token-expiry (get timestamp (find-expiry token-id)))
			(settlement-options-info (try! (get-options-info token-expiry)))
			(option-pnl (get option-pnl settlement-options-info))
			(first-token-id (get first-token-id settlement-options-info)) 
			(last-token-id (get last-token-id settlement-options-info))
    ) 
		;; Check if the signer is a trusted oracle
    (asserts! (is-trusted-oracle signer) ERR_UNTRUSTED_ORACLE)
		;; Check if provided token-id is in the range for the expiry
		(asserts! (and (>= token-id first-token-id) (<= token-id last-token-id)) ERR_TOKEN_ID_NOT_IN_EXPIRY_RANGE)
		;; TODO: ;; TODO: Still needed? Change to checking if option-pnl has been set or is none
		;; Check if options is expired
		(asserts! (> timestamp token-expiry) ERR_OPTION_NOT_EXPIRED) 
		(match option-pnl
			payout
			;; check that the option-pnl is great than zero
			(begin
				;; Transfer options NFT to settlement contract
				(try! (transfer token-id tx-sender (as-contract tx-sender)))
				;; Transfer STX to tx-sender
				(try! (stx-transfer? (unwrap-panic option-pnl) (as-contract tx-sender) tx-sender))
				(ok true)
			)
			ERR_OPTION_NOT_EXPIRED
		)
  )
)

(define-private (find-expiry (token-id uint)) 
	(fold find-expiry-helper (var-get options-info-list) {timestamp: u0, token-id: token-id, found: false})
)

(define-private (find-expiry-helper (current-list-element { cycle-expiry: uint, last-token-id: uint }) (prev-value { timestamp: uint, token-id: uint, found: bool }) ) 
	(begin
		(if 
			(and 
				(<= (get token-id prev-value) (get last-token-id current-list-element))
				(not (get found prev-value))
			) 
			{ timestamp: (get cycle-expiry current-list-element), token-id: (get token-id prev-value), found: true }
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

(define-private (get-options-info (cycle-expiry uint)) 
  (ok (unwrap! (map-get? options-info {cycle-expiry: cycle-expiry}) ERR_NO_INFO_FOR_EXPIRY))
)

(define-private (get-options-pnl (cycle-expiry uint)) 
	(ok true)
	;; TODO implement functions, that checks for none value and returns error
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
