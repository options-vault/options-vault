
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

;; private functions
;;
;; Function that checks what is the user's balance in the vault
;; Balance helper functions
(define-private (get-balance (investor principal))
  (get balance (map-get? ledger { principal: investor}))
)

(define-private (add-to-balance (investor principal) (amount uint)) 
  (+ (default-to u0 (get-balance investor)) amount)
)

(define-private (substract-to-balance (investor principal) (amount uint)) 
  (- (default-to u0 (get-balance investor)) amount)
)

;; Deposit helper functions
(define-private (get-pending-deposit (investor principal)) 
  (default-to u0 (get pending-deposits (map-get? ledger { principal: investor})))
)

;; Withdraw helper functions
(define-private (get-pending-withdraw (investor principal)) 
  (default-to u0 (get pending-withdraw (map-get? ledger { principal: investor})))
)

(define-private (substract-pending-withdraw (investor principal) (amount uint)) 
  (-  (get-pending-withdraw investor) amount)
)

(define-private (add-pending-withdraw (investor principal) (amount uint))
  (+ (get-pending-withdraw investor) amount)
)



;; public functions
;;
;; TO DO:
;; 0. Create a function to queue pending deposits
;; 1. When cases 2 o 3 are executed at the end of the cycle
;; 1.1 For case 3 transfer all the premium + earnings to the user 2
;; 1.2 For case 2 transfer part of the premium to the user 2 and the other part to the vault
;; 2. When the vault earns premium from case 1 or 2 
;; 2.1 distribute the premium between all the investor in the vault (depending of their participation rate)

;; Deposit function as investor
;; Q: Can the deployer contract invest?
(define-public (deposit-investor (amount uint))
  (begin
    (asserts! (> amount u0) INVALID_AMOUNT)
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
    (map-set ledger
    { principal: tx-sender } 
    { balance: 
        (add-to-balance tx-sender amount), 
      pending-deposits: 
        (get-pending-deposit tx-sender), 
      pending-withdraw:
        (get-pending-withdraw tx-sender) }
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
        (add-to-balance CONTRACT_ADDRESS amount), 
      pending-deposits: 
        (get-pending-deposit CONTRACT_ADDRESS), 
      pending-withdraw:
        (get-pending-withdraw CONTRACT_ADDRESS) }
    )
    (ok true)
  )
)

;; 3. withdraw function
(define-public (withdraw)
  (let  (
          (balance (unwrap! (get-balance tx-sender) TX_SENDER_NOT_IN_LEDGER))
          (pending-withdraw (get-pending-withdraw tx-sender))
          (sender-tuple { principal: tx-sender })
          (sender-balances (unwrap-panic (map-get? ledger { principal: tx-sender })))
        )
        (asserts! (>= balance pending-withdraw) INSUFFICIENT_FUNDS)
        (asserts! (> pending-withdraw u0) INVALID_AMOUNT)
        (try! (as-contract (stx-transfer? pending-withdraw tx-sender (get principal sender-tuple))))
        (map-set ledger
          sender-tuple 
          (merge
            sender-balances
            {
              balance: 
                (substract-to-balance tx-sender pending-withdraw),
              pending-withdraw:
                (substract-pending-withdraw tx-sender pending-withdraw)
            }  
          )
        )
        (ok true)
  )
)

(define-public (queue-withdraw (amount uint)) 
  (let  (
          (balance (unwrap! (get-balance tx-sender) TX_SENDER_NOT_IN_LEDGER))
          (pending-withdraw (get-pending-withdraw tx-sender))
          (sender-tuple { principal: tx-sender })
          (sender-balances (unwrap-panic (map-get? ledger { principal: tx-sender })))
        )
        (asserts! (>= balance (+ pending-withdraw amount)) INSUFFICIENT_FUNDS)
        (map-set ledger  
          sender-tuple
          (merge 
            sender-balances
            {
              pending-withdraw:
                (add-pending-withdraw tx-sender amount) 
            }
          )
        )
        (ok true)
  )
)

;; 4. Check your own balance
(define-public (check-your-balance)
  (ok (unwrap-panic (get-balance tx-sender)))
)

(define-public (check-pending-withdraw) 
  (ok (get-pending-withdraw tx-sender))
)

(define-public (check-pending-deposit) 
  (ok (get-pending-deposit tx-sender))
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