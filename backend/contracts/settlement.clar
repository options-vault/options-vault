
;; settlement
;; The settlment contract accepts options-nfts, calculates their value and settles the trade
;; import sip009 trait
(use-trait nft-trait .traits.sip009-nft-trait)

(define-constant ERR_OPTION_NOT_EXPIRED (err u100))
(define-constant ERR_UNSTRUSTED_ORACLE (err u101))

(define-constant symbol-stxusd 0x535458555344) ;; "STXUSD" as a buff

(define-data-var expiry-time uint u900) ;; time in UTC

;; A map of all trusted oracles, indexed by their 33 byte compressed public key.
(define-map trusted-oracles (buff 33) bool)
(map-set trusted-oracles 0x035ca791fed34bf9e9d54c0ce4b9626e1382cf13daa46aa58b657389c24a751cc6 true)

(define-private (determine-value (expiry uint)) 
  (ok true)
)

(define-private (transfer-nft (token-id uint) (sender principal) (recipient principal))
	(contract-call? .options-nft transfer token-id sender recipient)
)

;; settles option-nfts 
(define-public (settle (expiry uint) (token-id uint) (timestamp uint) (stxusd-rate uint) (signature (buff 65))) 
  (let
    (
      ;; Recover the pubkey of the signer
      (signer (try! (contract-call? .redstone-verify recover-signer timestamp (list {value: stxusd-rate, symbol: symbol-stxusd}) signature)))
      ;; retrieve and store strike price for expiry
      (strike (try! (contract-call? .options-nft get-options-info expiry)))  
    ) 
		;; Check if the signer is a trusted oracle
    (asserts! (is-trusted-oracle signer) ERR_UNSTRUSTED_ORACLE)

    ;; transfer options NFT to settlement contract
    (try! (transfer-nft token-id tx-sender (as-contract tx-sender)))
    ;; TO DO: 
    ;; check if expiry is in the past -->  if not: ERR_OPTION_NOT_EXPIRED
    ;; verify that stxusd-rate is signed by redstine oracle
    ;; retrieve and store value of nft at expiry --> call determine-value passing expiry
    ;; if value positive: transfer stx to tx-sender
    
    (ok true)
  )
  ;; TO ADD: When first called for an expiry AND expiry in the past AND in-the-money, creaet pool of money for payouts (set aside)
)

(define-read-only (is-trusted-oracle (pubkey (buff 33)))
	(default-to false (map-get? trusted-oracles pubkey))
)