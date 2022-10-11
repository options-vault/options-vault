
;; vault
;; Balance holder that has withdraw/deposit functions, and ledger storage

;; constants
;;
(define-constant CONTRACT_ADDRESS (as-contract tx-sender))

(define-constant INVALID_AMOUNT (err u100))
(define-constant VAULT_NOT_ALLOWED (err u101))
(define-constant INSUFFICIENT_FUNDS (err u102))
(define-constant TX_SENDER_NOT_IN_LEDGER (err u103))

;; data maps and vars

;; Ledger map to store balances and withdraw/deposit requests for each principal (investor type / vault)
(define-map ledger { principal: principal } { balance: uint, pending-deposits: uint, pending-withdraw: uint })
(map-set ledger { principal: CONTRACT_ADDRESS } { balance: u0, pending-deposits: u0, pending-withdraw: u0 })

(define-data-var total-balances uint u0)
;; private functions

;; Functions that checks what is the user's balance/pending-withdraw/pending-deposit in the vault

;; Balance helper functions
(define-read-only (get-balance)
  (get balance (map-get? ledger { principal: tx-sender}))
)

(define-private (add-to-balance (amount uint)) 
  (+ (default-to u0 (get-balance)) amount)
)

(define-private (substract-to-balance (amount uint)) 
  (- (default-to u0 (get-balance)) amount)
)

;; Deposit helper functions
(define-read-only (get-pending-deposit) 
  (default-to u0 (get pending-deposits (map-get? ledger { principal: tx-sender})))
)

(define-private (add-pending-deposit (amount uint))
  (+ (get-pending-deposit) amount)
)

(define-private (substract-pending-deposit (amount uint)) 
  (- (get-pending-deposit) amount)
)

;; Withdraw helper functions
(define-read-only (get-pending-withdraw) 
  (default-to u0 (get pending-withdraw (map-get? ledger { principal: tx-sender})))
)

(define-private (substract-pending-withdraw (amount uint)) 
  (-  (get-pending-withdraw) amount)
)

(define-private (add-pending-withdraw (amount uint))
  (+ (get-pending-withdraw) amount)
)

;; public functions
;;
;; TO DO:
;; 1. When cases 2 o 3 are executed at the end of the cycle
;; 1.1 For case 3 transfer all the premium + earnings to the user 2
;; 1.2 For case 2 transfer part of the premium to the user 2 and the other part to the vault
;; 2. When the vault earns premium from case 1 or 2 
;; 2.1 distribute the premium between all the investor in the vault (depending of their participation rate)

;; 1. Deposit function as investor
;; Q: Can the deployer contract invest?
(define-public (deposit-investor) 
  (let (
          (sender-tuple { principal: tx-sender })
          (sender-balances (unwrap! (map-get? ledger sender-tuple) TX_SENDER_NOT_IN_LEDGER))
          (pending-deposit (get-pending-deposit))
        )
        (asserts! (> pending-deposit u0) INVALID_AMOUNT)
        (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
        (try! (stx-transfer? pending-deposit tx-sender CONTRACT_ADDRESS))
        (var-set total-balances (+ (var-get total-balances) pending-deposit))
        (map-set ledger
          sender-tuple 
          (merge
            sender-balances
            {
              balance: 
                (add-to-balance pending-deposit),
              pending-deposits:
                (substract-pending-deposit pending-deposit)
            }
          )
        )
        (ok true)
  )
)

;; (define-public (deposit-investor (amount uint))
;;   (begin
;;     (asserts! (> amount u0) INVALID_AMOUNT)
;;     (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
;;     (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
;;     (map-set ledger
;;     { principal: tx-sender } 
;;     { balance: 
;;         (add-to-balance amount), 
;;       pending-deposits: 
;;         (get-pending-deposit), 
;;       pending-withdraw:
;;         (get-pending-withdraw) }
;;     )
;;     (ok true)
;;   )
;; )

;; 2. deposit function as premium (vault)

(define-public (deposit-premium (amount uint)) 
  (let (
          (contract-tuple { principal: CONTRACT_ADDRESS })
          (contract-balances (unwrap-panic (map-get? ledger contract-tuple)))
        )
        (asserts! (> amount u0) INVALID_AMOUNT)
        (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
        (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
        (map-set ledger
          contract-tuple 
          (merge
            contract-balances
            {
              balance: 
                (as-contract (add-to-balance amount)),
            }
          )
        )
        (ok true)
  )
)

;; (define-public (deposit-premium) 
;;   (let (
;;           (contract-tuple { principal: CONTRACT_ADDRESS })
;;           (sender-tuple { principal: tx-sender })
;;           (sender-balances (unwrap! (map-get? ledger sender-tuple) TX_SENDER_NOT_IN_LEDGER))
;;           (contract-balances (unwrap-panic (map-get? ledger contract-tuple)))
;;           (pending-deposit (get-pending-deposit))
;;         )
;;         (asserts! (> pending-deposit u0) INVALID_AMOUNT)
;;         (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
;;         (try! (stx-transfer? pending-deposit tx-sender CONTRACT_ADDRESS))
;;         (map-set ledger
;;           contract-tuple 
;;           (merge
;;             contract-balances
;;             {
;;               balance: 
;;                 (as-contract (add-to-balance pending-deposit)),
;;             }
;;           )
;;         )
;;         (map-set ledger
;;           sender-tuple 
;;           (merge
;;             sender-balances
;;             {
;;               pending-deposits: 
;;                 (substract-pending-deposit pending-deposit)
;;             }
;;           )
;;         )
;;         (ok true)
;;   )
;; )

;; (define-public (deposit-premium (amount uint))
;;   (begin
;;     (asserts! (> amount u0) INVALID_AMOUNT)
;;     (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
;;     (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
;;     (map-set ledger  
;;     { principal: CONTRACT_ADDRESS } 
;;     { balance: 
;;         (as-contract (add-to-balance amount)), 
;;       pending-deposits: 
;;         (as-contract (get-pending-deposit)), 
;;       pending-withdraw:
;;         (as-contract (get-pending-withdraw)) }
;;     )
;;     (ok true)
;;   )
;; )

(define-public (queue-deposit (amount uint)) 
  (let  (
          (sender-tuple { principal: tx-sender })
        )
        (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
        (asserts! (> amount u0) INVALID_AMOUNT)
        (if (map-insert ledger 
              sender-tuple
              {
                balance: u0,
                pending-deposits: amount,
                pending-withdraw: u0
              }
            )
          true
          (map-set ledger  
            sender-tuple
            (merge 
              (unwrap-panic (map-get? ledger { principal: tx-sender }))
              {
                pending-deposits:
                  (add-pending-deposit amount) 
              }
            )
          )
        )
        (ok true)     
  )
)

;; 3. withdraw function
(define-public (withdraw)
  (let  (
          (balance (unwrap! (get-balance) TX_SENDER_NOT_IN_LEDGER))
          (pending-withdraw (get-pending-withdraw))
          (sender-tuple { principal: tx-sender })
          (sender-balances (unwrap-panic (map-get? ledger { principal: tx-sender })))
        )
        (asserts! (>= balance pending-withdraw) INSUFFICIENT_FUNDS)
        (asserts! (> pending-withdraw u0) INVALID_AMOUNT)
        (try! (as-contract (stx-transfer? pending-withdraw tx-sender (get principal sender-tuple))))
        (var-set total-balances (- (var-get total-balances) pending-withdraw))
        (map-set ledger
          sender-tuple 
          (merge
            sender-balances
            {
              balance: 
                (substract-to-balance pending-withdraw),
              pending-withdraw:
                (substract-pending-withdraw pending-withdraw)
            }  
          )
        )
        (ok true)
  )
)

(define-public (queue-withdraw (amount uint)) 
  (let  (
          (balance (unwrap! (get-balance) TX_SENDER_NOT_IN_LEDGER))
          (pending-withdraw (get-pending-withdraw))
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
                (add-pending-withdraw amount) 
            }
          )
        )
        (ok true)
  )
)

;; Distribute the premium between all the investor in the vault (depending of their participation rate)

;; (define-private (evaluator (investor principal)) 
;;   (let  (
;;           (vault-balance (var-get total-balances))
;;           (investor-balance (get-balance))
;;           (investor-balances-tuple (unwrap-panic (map-get? ledger { principal: investor })))
;;           (premium-slice (* (/ (get balance investor-balances-tuple) vault-balance) ))
;;         )
;;         (map-set ledger 
;;           investor-balances-tuple
;;           {
;;             balance: 
;;               (+  premium-slice investor-balance)
;;           }
;;         )     
;;   )
;; )

;; Consult the total investor balances
(define-read-only (get-total-balances) 
  (var-get total-balances)
)