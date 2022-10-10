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
(define-constant err-initialization-start (err u107))
(define-constant err-no-active-auction (err u108))
(define-constant err-options-sold-out (err u109))

(define-constant symbol-stxusd 0x535458555344) ;; "STXUSD" as a buff
(define-constant redstone-value-shift u100000000)
(define-constant stacks-base u1000000)
(define-constant redstone-stacks-base-diff (/ redstone-value-shift stacks-base))

(define-data-var contract-owner principal tx-sender)
(define-data-var token-id-nonce uint u0)

(define-non-fungible-token options-nft uint)

;; A map of all trusted oracles, indexed by their 33 byte compressed public key.
(define-map trusted-oracles (buff 33) bool)
(map-set trusted-oracles 0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6 true)

;; A map that holds the strike price for each contract and assigns token-ids to expiry
(define-map options-info { expiry-timestamp: uint } { strike: uint, first-token-id: uint, last-token-id: uint })

;; Last seen timestamp. The if clause is so that the contract can deploy on a Clarinet console session.
(define-data-var last-seen-timestamp uint (if (> block-height u0) (get-last-block-timestamp) u0))
(define-data-var last-stxusd-rate (optional uint) none)
;; TO DO: needs to be replaced with calculated price for cycle
(define-data-var price-in-usd (optional uint) none) 

(define-data-var current-cycle-expiry uint u1665763200) ;; set to Fri Oct 14 2022 16:00:00 GMT+0000
(define-data-var auction-start-block-height uint u0)
(define-data-var auction-decrement-value uint u0)
(define-constant week-in-seconds u604800)
(define-constant min-in-seconds u60)

;; TODO: Add fail-safe public function that allows contract-owner to manually initalize the next cycle. 

;; FUNCTION TO RECEIVE PRICE DATA FROM SERVER

;; #[allow(unchecked_data)]
(define-public (submit-price-data (timestamp uint) (stxusd-rate uint) (signature (buff 65)))
	(let 
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(start-init-window (- (var-get current-cycle-expiry) (* u250 min-in-seconds)))
			(end-init-window (- (var-get current-cycle-expiry) (* u240 min-in-seconds)))
		)
		;; Check if the signer is a trusted oracle.
		(asserts! (is-trusted-oracle signer) err-untrusted-oracle)
		;; Check if the data is not stale, depending on how the app is designed.
		(asserts! (> timestamp (get-last-block-timestamp)) err-stale-rate) ;; timestamp should be larger than the last block timestamp.
		(asserts! (>= timestamp (var-get last-seen-timestamp)) err-stale-rate) ;; timestamp should be larger than or equal to the last seen timestamp.
		;; Save last seen stxusd price
		(var-set last-stxusd-rate (some stxusd-rate))
		;; Save last seen timestamp.
		(var-set last-seen-timestamp timestamp)		;; check if timestamp > start and timestamp < end of initialization time range
		(if (and (> timestamp start-init-window) (< timestamp end-init-window))
		 (unwrap! (initialize-next-cycle) err-initialization-start)
		 (unwrap! (no-init) err-initialization-start)
		)
		(ok true)
	)
)

;; INITIALIZE NEXT CYCLE

(define-private (initialize-next-cycle) 
	(let 
		(
			(stxusd-rate (unwrap-panic (var-get last-stxusd-rate)))
			(strike (/ (* stxusd-rate u115) u100))
			(expiry-next-cycle (+ (var-get current-cycle-expiry) week-in-seconds))
			(first-token-id (+ (unwrap-panic (get-last-token-id)) u1))
		)
		(map-set options-info { expiry-timestamp: expiry-next-cycle } { strike: strike, first-token-id: first-token-id, last-token-id: first-token-id })
		(set-options-price stxusd-rate)
		(var-set auction-start-block-height block-height)
		(var-set auction-decrement-value (/ (* (unwrap-panic (var-get price-in-usd)) u25) u1000))
		(ok true) 
	)
)

;; TODO: refactor the last part of submit-price-data so that no-init function is not needed

(define-private (no-init) 
	(ok true)
)

(define-private (set-options-price (stxusd-rate uint)) 
	;; The price is determined using a simplified calculation that sets options price as 0.5% of the stxusd price.
	;; If all 52 weekly options for a year would expiry worthless, a uncompounded 26% APY would be achieved by this pricing strategy.
	;; In the next iteration we intend to replace this simplified calculation with the Black Scholes formula - the industry standard for pricing European style options. 
	(var-set price-in-usd (some (/ stxusd-rate u5000)))
)

;; NFT MINTING (Priced in USD, payed in STX)

;; TO DO: limit options that can be sold according to deposits in vault

;; #[allow(unchecked_data)]
(define-public (mint (timestamp uint) (stxusd-rate uint) (signature (buff 65)))
	(let
		(
			;; Recover the pubkey of the signer.
			(signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
			(token-id (+ (var-get token-id-nonce) u1))
			(expiry-next-cycle (+ (var-get current-cycle-expiry) week-in-seconds))
			(current-options-info (unwrap-panic (map-get? options-info { expiry-timestamp: expiry-next-cycle })))
			(options-minted-amount (- (get last-token-id current-options-info) (get first-token-id current-options-info)))
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
		(asserts! (and
			(>= block-height (var-get auction-start-block-height))
			(< block-height (+ (var-get auction-start-block-height) u25))) 
			err-no-active-auction
		)
		;; Update the mint price based on where in the 25 block minting window we are 
		(update-price-in-usd)
		;; Update the token ID nonce.
		(var-set token-id-nonce token-id)
		;; Send the STX equivalent to the contract owner. TO DO: send STX to vault contract instead of contract-owner
		(try! (stx-transfer? (try! (get-update-latest-price-in-stx timestamp stxusd-rate)) tx-sender (var-get contract-owner)))
		;; Mint the NFT.
		(try! (nft-mint? options-nft token-id tx-sender))
		;; Add the token-id of the minted NFT as the last-token-id in the options-info map
		(map-set options-info 
			{ expiry-timestamp: expiry-next-cycle } 
			(merge
				current-options-info
				{ last-token-id: token-id }
			)
		)
		(ok token-id)
	)
)

(define-private (update-price-in-usd) 
	(let
		(
			(decrement (* (mod block-height (var-get auction-start-block-height)) (var-get auction-decrement-value)))
		)
		(var-set price-in-usd (some (- (unwrap-panic (var-get price-in-usd)) decrement)))
	)
)

;; SETTLEMENT

;; TO DO: verify that provided token-id corresponds to provided expiry date
;; + add err code for token-id not in range (err-token-id-not-in-expiry-range)

;; settles option-nfts
;; #[allow(unchecked_data)] 
(define-public (settle (token-id uint) (timestamp uint) (stxusd-rate uint) (signature (buff 65))) 
  (let
    (
      ;; Recover the pubkey of the signer
      (signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
      ;; retrieve and store strike price for expiry
      (strike (get strike (try! (get-options-info (var-get current-cycle-expiry))))) 
    ) 
		;; Check if the signer is a trusted oracle
    (asserts! (is-trusted-oracle signer) err-untrusted-oracle)

    ;; transfer options NFT to settlement contract
    (try! (transfer token-id tx-sender (as-contract tx-sender)))
    ;; TO DO: 
    ;; check if expiry is in the past -->  if not: ERR_OPTION_NOT_EXPIRED
    ;; verify that stxusd-rate is signed by redstine oracle
    ;; retrieve and store value of nft at expiry --> call determine-value passing expiry
    ;; if value positive: transfer stx to tx-sender
    (ok true)
  )
  ;; TO ADD: When first called for an expiry AND expiry in the past AND in-the-money, creaet pool of money for payouts (set aside)
)

(define-private (determine-value (expiry-timestamp uint)) 
  (ok true)
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
