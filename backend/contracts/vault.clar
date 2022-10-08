
;; vault
;; Balance holder that has withdraw and deposit functions, and ledger storage

;; constants
;;
(define-constant CONTRACT_ADDRESS (as-contract tx-sender))

(define-constant INVALID_AMOUNT (err u100))
(define-constant VAULT_NOT_ALLOWED (err u101))
(define-constant INSUFFICIENT_FUNDS (err u102))
(define-constant TX_SENDER_NOT_IN_LEDGER (err u103))

;; data maps and vars
;;
;; Ledger map to store balances and withdraw/deposit requests for each principal (investor type / vault)
(define-map ledger { principal: principal } { balance: uint, pending-deposits: uint, pending-withdraw: uint })
;; var that stores the total balance in the vault
(define-data-var total-balance uint u0)

;; private functions
;;

;; public functions
;;
;; TO DO:
;; 1. deposit function as investor
(define-public (deposit-investor (amount uint))
  (begin
    (asserts! (> amount u0) INVALID_AMOUNT)
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
    (map-set ledger  
    { principal: tx-sender } 
    { balance: 
        (+ (default-to u0 (get balance (map-get? ledger { principal: tx-sender}))) amount), 
      pending-deposits: 
        (default-to u0 (get pending-deposits (map-get? ledger { principal: tx-sender}))), 
      pending-withdraw:
        (default-to u0 (get pending-withdraw (map-get? ledger { principal: tx-sender}))) }
    )
    (ok true)
  )
)

;; 2. deposit function as premium (vault)
(define-public (deposit-premium (amount uint))
  (begin
    (asserts! (> amount u0) INVALID_AMOUNT)
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
    (map-set ledger  
    { principal: CONTRACT_ADDRESS } 
    { balance: 
        (+ (default-to u0 (get balance (map-get? ledger { principal: CONTRACT_ADDRESS}))) amount), 
      pending-deposits: 
        (default-to u0 (get pending-deposits (map-get? ledger { principal: tx-sender}))), 
      pending-withdraw:
        (default-to u0 (get pending-withdraw (map-get? ledger { principal: tx-sender}))) }
    )
    (ok true)
  )
)

;; 3. withdraw function as investor
(define-public (withdraw-investor (amount uint))
  (begin
    (ok true)
  )
)

;; Jusr for testing purposes -- TODO: Get rid of this function for production
(define-public (check-balance (address principal)) 
  (ok (unwrap-panic (map-get? ledger {principal: address})))
)

;; (define-public (deposit-investor (amount uint))
;;   (begin
;;     (asserts! (> amount u0) INVALID_AMOUNT)
;;     (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
;;     (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
;;     ;; instead of using if, use default to for each property
;;     (if (map-insert ledger { principal: tx-sender } { balance: amount, pending-deposits: u0, pending-withdraw: u0 })
;;       true
;;       (map-set ledger  
;;       { principal: tx-sender } 
;;       { balance: 
;;           (+ (unwrap-panic (get balance (map-get? ledger { principal: tx-sender}))) amount), 
;;         pending-deposits: 
;;           (unwrap-panic (get pending-deposits (map-get? ledger { principal: tx-sender}))), 
;;         pending-withdraw:
;;           (unwrap-panic (get pending-withdraw (map-get? ledger { principal: tx-sender}))) }
;;       )
;;     )
;;     (ok true)
;;   )
;; )

