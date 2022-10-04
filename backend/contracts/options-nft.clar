(impl-trait .traits.sip009-nft-trait)

;; SIP009 NFT trait on mainnet
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; define nft and identifier type
(define-non-fungible-token options-nft uint)

;; tx-sender is a built in keyword that always refers to whoever sent the transaction
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))
(define-data-var last-token-id uint u0)

;; return a response with the id of the last minted token
(define-public (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-owner (token-id uint))
	(ok (nft-get-owner? options-nft token-id))
)

(define-read-only (get-token-uri (token-id uint))
	(ok none)
)

;; begin used to add more than one expression
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
	(begin
		(asserts! (is-eq tx-sender sender) err-not-token-owner)
		(nft-transfer? options-nft token-id sender recipient)
	)
)

;; mint a token
(define-public (mint (recipient principal))
	(let
		(
      ;; increment token id by 1
			(token-id (+ (var-get last-token-id) u1))
		)
    ;; only contract owner can mint (for testing)
		(asserts! (is-eq tx-sender contract-owner) err-owner-only)
		(try! (nft-mint? options-nft token-id recipient))
		(var-set last-token-id token-id)
		(ok token-id)
	)
)
