(impl-trait .traits.sip009-nft-trait)

;; SIP009 NFT trait on mainnet
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-non-fungible-token options-nft uint)

(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))
(define-constant err-no-info-for-expiry (err u102))

(define-map options-info uint uint)
(define-data-var last-token-id uint u0)

(define-public (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-owner (token-id uint))
	(ok (nft-get-owner? options-nft token-id))
)

(define-read-only (get-token-uri (token-id uint))
	(ok none)
)

(define-read-only (get-options-info (expiry uint)) 
	(ok (unwrap! (map-get? options-info expiry) err-no-info-for-expiry))
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
	(begin
		(asserts! (is-eq tx-sender sender) err-not-token-owner)
		(nft-transfer? options-nft token-id sender recipient)
	)
)

(define-public (mint (recipient principal))
	(let
		(
			(token-id (+ (var-get last-token-id) u1))
		)
    ;; only contract owner can mint (for testing)
		(asserts! (is-eq tx-sender contract-owner) err-owner-only)
		(try! (nft-mint? options-nft token-id recipient))
		(var-set last-token-id token-id)
		(ok token-id)
	)
)

;; TO DO: map-set options-info with the expiry and strike price

;; TO DO: verify that provided token-id corresponds to provided expiry date
;; + add token-id-range into tuple in options-info (delinating the start and end token-id for the expiry)
;; + add err code for token-id not in range (err-token-id-not-in-expiry-range)