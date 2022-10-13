(impl-trait .traits.sip009-nft-trait)

;; SIP009 NFT trait on mainnet
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; TODO: capitalized error codes to comply with coding best practices
(define-constant err-not-contract-owner (err u100))
(define-constant err-untrusted-oracle (err u101))
(define-constant err-stale-rate (err u102))
(define-constant err-no-known-price (err u103))
(define-constant err-not-token-owner (err u104))
(define-constant err-option-not-expired (err u105))
(define-constant err-no-info-for-expiry (err u106))
(define-constant err-cycle-initialization (err u107))
(define-constant err-no-active-auction (err u108))
(define-constant err-options-sold-out (err u109))
(define-constant err-token-id-not-in-expiry-range (err u110))
(define-constant err-cycle-end (err u111))
(define-constant err-determine-value (err u112))

(define-constant symbol-stxusd 0x535458555344) ;; "STXUSD" as a buff
(define-constant redstone-value-shift u100000000)
(define-constant stacks-base u1000000)
(define-constant redstone-stacks-base-diff (/ redstone-value-shift stacks-base))

(define-data-var contract-owner principal tx-sender)
(define-data-var token-id-nonce uint u0)

(define-non-fungible-token options-nft uint)

;; A map of all trusted oracles, indexed by their 33 byte compressed public key.
(define-map trusted-oracles (buff 33) bool)
(map-set trusted-oracles 0x03f6f2c89ad8ec1bf29a47bf2b3decc36c3083b49b38be730f372ffdfbcce341eb true)
;; redstone oracle: 
;; 0x03009dd87eb41d96ce8ad94aa22ea8b0ba4ac20c45e42f71726d6b180f93c3f298
;; A map that holds the strike price for each contract and assigns token-ids to expiry
(define-map options-info { expiry-timestamp: uint } { strike: uint, first-token-id: uint, last-token-id: uint, option-pnl: (optional uint), total-pnl: (optional uint) })
;; A list that holds a tuple with the expiry-timestamp and the last-token-id minted for that expiry
(define-data-var options-info-list (list 1000 { expiry-timestamp: uint, last-token-id: uint }) (list))
;; Last seen timestamp. The if clause is so that the contract can deploy on a Clarinet console session.
(define-data-var last-seen-timestamp uint (if (> block-height u0) (get-last-block-timestamp) u0))
(define-data-var last-stxusd-rate (optional uint) none)
;; TO DO: needs to be replaced with calculated price for cycle
(define-data-var price-in-usd (optional uint) none) 

(define-data-var current-cycle-expiry uint u1665763200) ;; set to Fri Oct 14 2022 16:00:00 GMT+0000
(define-data-var mint-open bool false)
(define-data-var auction-start-timestamp uint u0)
(define-data-var auction-decrement-value uint u0)
(define-constant week-in-seconds u604800)
(define-constant min-in-seconds u60)

;; TODO: Add fail-safe public function that allows contract-owner to manually initalize AND end the next cycle. 
;; TODO: Add functions to set start-init-window and end-init-window
;; TODO: Instead of passing timestamp from receiver functions to later functions, get the timestamp from last-seen-timestamp

;; FUNCTION TO RECEIVE PRICE DATA FROM SERVER

;; TODO: implement helper functiont that abstracts away recover-signer contract call and is-trusted-oracle assert 

;; #[allow(unchecked_data)]
(define-public (submit-price-data (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65)))
	(let 
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp entries signature)))
			(start-init-window (- (var-get current-cycle-expiry) (* u190 min-in-seconds)))
			(end-init-window (- (var-get current-cycle-expiry) (* u180 min-in-seconds)))
			(init-window-active (and (> timestamp start-init-window) (< timestamp end-init-window)))
			(current-cycle-expired (> timestamp (var-get current-cycle-expiry)))
		)
		;; Check if the signer is a trusted oracle.
		(asserts! (is-trusted-oracle signer) err-untrusted-oracle)
		;; Check if the data is not stale, depending on how the app is designed.
		(asserts! (> timestamp (get-last-block-timestamp)) err-stale-rate) ;; timestamp should be larger than the last block timestamp.
		(asserts! (>= timestamp (var-get last-seen-timestamp)) err-stale-rate) ;; timestamp should be larger than or equal to the last seen timestamp.
		;; Save last seen stxusd price
		;; TODO extract and set last usd stx rate 
		;;(var-set last-stxusd-rate (some entries))
		;; Save last seen timestamp.
		(var-set last-seen-timestamp timestamp)		
		;; check if timestamp > start and timestamp < end of initialization time range
		(if init-window-active
		 (unwrap! (initialize-next-cycle timestamp) err-cycle-initialization)
		 (unwrap! (ok true) err-cycle-initialization)
		)
		(if current-cycle-expired 
			(unwrap! (end-cycle) err-cycle-end)
			(unwrap! (ok true) err-cycle-end)
		)
		(ok true)
	)
)

(define-public (recover-signer  (timestamp uint) (entries (list 10 {symbol: (buff 32), value: uint})) (signature (buff 65))) 
	(contract-call? .redstone-verify recover-signer timestamp entries signature)
)

;; INITIALIZE NEXT CYCLE

(define-private (initialize-next-cycle (timestamp uint)) 
	(let 
		(
			(stxusd-rate (unwrap-panic (var-get last-stxusd-rate)))
			(strike (/ (* stxusd-rate u115) u100))
			(next-cycle-expiry (+ (var-get current-cycle-expiry) week-in-seconds))
			(first-token-id (+ (unwrap-panic (get-last-token-id)) u1))
		)
		(map-set options-info { expiry-timestamp: next-cycle-expiry } 
			{ 
			strike: strike, 
			first-token-id: first-token-id, 
			last-token-id: first-token-id,
			option-pnl: none,
			total-pnl: none 
			}
		)
		(set-options-price stxusd-rate)
		(var-set mint-open true)
		(var-set auction-start-timestamp timestamp)
		(var-set auction-decrement-value (/ (unwrap-panic (var-get price-in-usd)) u50)) ;; each decrement represents 2% of the start price
		(ok true) 
	)
)

(define-private (end-cycle)
	(let
		(
			(expired-cycle-expiry (var-get current-cycle-expiry))
			(last-token-id (var-get token-id-nonce))
			(cycle-tuple { expiry-timestamp: expired-cycle-expiry, last-token-id: last-token-id })
		) 
		(var-set mint-open false)
		(asserts! (unwrap-panic (determine-and-set-value)) err-determine-value)
		(add-to-options-info-list cycle-tuple)
		(var-set current-cycle-expiry (+ expired-cycle-expiry week-in-seconds))
		(ok true)
	) 
)

(define-private (add-to-options-info-list (cycle-tuple { expiry-timestamp: uint, last-token-id: uint}))
  (var-set options-info-list (unwrap-panic (as-max-len? (append (var-get options-info-list) cycle-tuple) u1000)))
)

(define-private (determine-and-set-value)
	(let
		(
			(stxusd-rate (unwrap-panic (var-get last-stxusd-rate)))
			(settlement-expiry (var-get current-cycle-expiry))
	  	(settlement-options-info (try! (get-options-info settlement-expiry)))
    	(strike (get strike settlement-options-info))
			(options-minted-amount (- (get first-token-id settlement-options-info) (get last-token-id settlement-options-info)))
		)
		(if (> strike stxusd-rate) 
			;; option is in-the-money and the pnl is positive
			;; TODO: Add transfer of funds from vault to settlement --> creaet pool of money for payouts (set aside)
			(map-set options-info 
				{ expiry-timestamp: settlement-expiry } 
				(merge
					settlement-options-info
					{ option-pnl: (some (- strike stxusd-rate)), total-pnl: (some (* (- strike stxusd-rate) options-minted-amount)) }
				)
			)
			;; option is out-of-the-money and the pnl is zero
			(map-set options-info 
				{ expiry-timestamp: settlement-expiry } 
				(merge
					settlement-options-info
					{ option-pnl: (some u0), total-pnl: (some u0) }
				)
			)
		)
  	(ok true)
	)
)


(define-private (set-options-price (stxusd-rate uint)) 
	;; The price is determined using a simplified calculation that sets options price as 0.5% of the stxusd price.
	;; If all 52 weekly options for a year would expiry worthless, a uncompounded 26% APY would be achieved by this pricing strategy.
	;; In the next iteration we intend to replace this simplified calculation with the Black Scholes formula - the industry standard for pricing European style options. 
	(var-set price-in-usd (some (/ stxusd-rate u200)))
)

;; NFT MINTING (Priced in USD, payed in STX)

;; #[allow(unchecked_data)]
(define-public (mint (timestamp uint) (stxusd-rate uint) (signature (buff 65)))
	(let
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(token-id (+ (var-get token-id-nonce) u1))
			(next-cycle-expiry (+ (var-get current-cycle-expiry) week-in-seconds))
      (next-cycle-options-info (try! (get-options-info next-cycle-expiry)))
			(options-minted-amount (- (get last-token-id next-cycle-options-info) (get first-token-id next-cycle-options-info)))
		)
		;; Check if the signer is a trusted oracle. If it fails, then the possible price
		;; update via get-update-latest-price-in-stx is also reverted. This is important.
		(asserts! (is-trusted-oracle signer) err-untrusted-oracle)
		;; Check if options-nft are available for sale. The contract can only sell as many options-nfts as there are funds in the vault
		;; TODO: make sure the decimals between balances in the vault and options-minted-amount match
		;; --> total-balances has to rounded down to a full number (full STX)
		;; UNCOMMENT WHEN UPDATES FROM VAULT HAVE BEEN MERGED
		;; (asserts! (< options-minted-amount (contract-call? .vault get-total-balances)) (err err-options-sold-out))

		;; Check if mint function is being called in the auction window of start + 25 blocks
		(asserts! 
			(and
				(>= timestamp (var-get auction-start-timestamp))
				;; Check if auciton has run for more than 180 minutes or end-cycle has closed the auction
				;; Having both checks ensures that (a) the auction never runs longer than 3 hours thus reducing delta risk
				;; (i.e. the risk of a unfavorable change in the price of the underlying asset) and (b) allows the end-current-cycle
				;; function to close the auction "manually" to ensure a safe transition the next cycle
				(and 
					(< timestamp (+ (var-get auction-start-timestamp) (* min-in-seconds u180)))
					(var-get mint-open)
				)
			) 
			err-no-active-auction
		)
		;; Update the mint price based on where in the 25 block minting window we are 
		(update-price-in-usd timestamp)
		;; Update the token ID nonce
		(var-set token-id-nonce token-id)
		;; Send the STX equivalent to the contract owner
		;; TO DO: send STX to vault contract instead of contract-owner
		(try! (stx-transfer? (try! (get-update-latest-price-in-stx timestamp stxusd-rate)) tx-sender (var-get contract-owner)))
		;; Mint the NFT
		(try! (nft-mint? options-nft token-id tx-sender))
		;; Add the token-id of the minted NFT as the last-token-id in the options-info map
		(map-set options-info 
			{ expiry-timestamp: next-cycle-expiry } 
			(merge
				next-cycle-options-info
				{ last-token-id: token-id }
			)
		)
		(ok token-id)
	)
)

(define-private (update-price-in-usd (timestamp uint)) 
	(let
		(
			(decrement (* (mod (- timestamp (var-get auction-start-timestamp)) (* min-in-seconds u60)) (var-get auction-decrement-value)))
		)
		(var-set price-in-usd (some (- (unwrap-panic (var-get price-in-usd)) decrement)))
	)
)

;; SETTLEMENT

;; #[allow(unchecked_data)] 
(define-public (settle (token-id uint) (timestamp uint) (stxusd-rate uint) (signature (buff 65))) 
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
    (asserts! (is-trusted-oracle signer) err-untrusted-oracle)
		;; Check if provided token-id is in the range for the expiry
		(asserts! (and (>= token-id first-token-id) (<= token-id last-token-id)) err-token-id-not-in-expiry-range)
		;; TODO: Change to checking if option-pnl has been set or is none
		;; Check if options is expired
		(asserts! (> timestamp token-expiry) err-option-not-expired) 
		(match option-pnl
			payout
			(begin
				;; Transfer options NFT to settlement contract
				(try! (transfer token-id tx-sender (as-contract tx-sender)))
				;; Transfer STX to tx-sender
				(try! (stx-transfer? (unwrap-panic option-pnl) (as-contract tx-sender) tx-sender))
				(ok true)
			)
			err-option-not-expired
		)
  )
)

(define-private (find-expiry (token-id uint)) 
	(fold find-expiry-helper (var-get options-info-list) {timestamp: u0, token-id: token-id, found: false})
)

(define-private (find-expiry-helper (current-list-element { expiry-timestamp: uint, last-token-id: uint }) (prev-value { timestamp: uint, token-id: uint, found: bool }) ) 
	(begin
		(if 
			(and 
				(<= (get last-token-id current-list-element) (get token-id prev-value))
				(not (get found prev-value))
			) 
			{ timestamp: (get expiry-timestamp current-list-element), token-id: (get token-id prev-value), found: true }
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
		(asserts! (or (is-eq sender tx-sender) (is-eq sender contract-caller)) err-not-token-owner)
		(nft-transfer? options-nft token-id sender recipient)
	)
)

(define-private (get-options-info (expiry-timestamp uint)) 
  (ok (unwrap! (map-get? options-info {expiry-timestamp: expiry-timestamp}) err-no-info-for-expiry))
)

;; CONTRACT OWNERSHIP HELPER FUNCTIONS

(define-public (set-contract-owner (new-owner principal))
	(begin
		(asserts! (is-eq (var-get contract-owner) tx-sender) err-not-contract-owner)
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
		(asserts! (is-eq (var-get contract-owner) tx-sender) err-not-contract-owner)
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
		(asserts! (> (if newer-data timestamp last-timestamp) last-block-timestamp) err-stale-rate)

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
	(unwrap-panic (var-get price-in-usd))
)

(define-read-only (get-last-price-in-stx)
	(match (var-get last-stxusd-rate)
		stxusd-rate (ok (usd-to-stx (get-usd-price) stxusd-rate))
		err-no-known-price
	)
)
