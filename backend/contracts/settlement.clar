
;; settlement
;; The settlment contract accepts options-nfts, calculates their value and settles the trade

;; constants
(define-constant OPTION_NOT_EXPIRED (err 100))

;; data maps and vars
(define-data-var expiry-time uint u900) ;; time in UTC

;; private functions
(define-private (determine-value (expiry uint)) 
  (ok true)
)

;; public functions

;; settles option-nfts 
(define-public (settle (expiry uint) (amount uint)) 
  ;; transfer amount of options to settlement contract
  ;; retrieve and store strike price for expiry --> call options-info function in .options-nft
  ;; check if expiry is in the past -->  if not: OPTION_NOT_EXPIRED
  ;; retrieve and store value of nft at expiry --> call determine-value passing expiry
  ;; if value positive: transfer stx to tx-sender
  (ok true)
  ;; TO ADD: When first called for an expiry AND expiry in the past AND in-the-money, creaet pool of money for payouts (set aside)
)
