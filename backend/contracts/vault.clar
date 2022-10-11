
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
(define-map ledger principal { address: principal, balance: uint, pending-deposits: uint, pending-withdraw: uint })

(define-data-var investors-address (list 1000 principal) (list))

(define-data-var total-balances uint u0)

;; private functions

;; Functions that checks what is the user's balance/pending-withdraw/pending-deposit in the vault

;; Balance helper functions
(define-read-only (get-balance)
  (get balance (map-get? ledger tx-sender))
)

(define-private (add-to-balance (amount uint)) 
  (+ (default-to u0 (get-balance)) amount)
)

(define-private (substract-to-balance (amount uint)) 
  (- (default-to u0 (get-balance)) amount)
)

;; Deposit helper functions
(define-read-only (get-pending-deposit) 
  (default-to u0 (get pending-deposits (map-get? ledger tx-sender)))
)

(define-private (add-pending-deposit (amount uint))
  (+ (get-pending-deposit) amount)
)

(define-private (substract-pending-deposit (amount uint)) 
  (- (get-pending-deposit) amount)
)

;; Withdraw helper functions
(define-read-only (get-pending-withdraw) 
  (default-to u0 (get pending-withdraw (map-get? ledger tx-sender)))
)

(define-private (substract-pending-withdraw (amount uint)) 
  (-  (get-pending-withdraw) amount)
)

(define-private (add-pending-withdraw (amount uint))
  (+ (get-pending-withdraw) amount)
)

;; Update investors-address list - helper function
(define-private (add-to-list (investor principal))
  (var-set investors-address (unwrap-panic (as-max-len? (append (var-get investors-address) investor) u1000)))
)

;; public functions
;;
;; TO DO:
;; 1. When cases 2 o 3 are executed at the end of the cycle
;; 1.1 For case 3 transfer all the premium + earnings to the user 2
;; 1.2 For case 2 transfer part of the premium to the user 2 and the other part to the vault
;; 2. When the vault earns premium from case 1 or 2

;; 1. Deposit function as investor
;; Q: Can the deployer contract invest?
(define-public (deposit-investor) 
  (let (
          (sender-info (unwrap! (map-get? ledger tx-sender) TX_SENDER_NOT_IN_LEDGER))
          (pending-deposit (get-pending-deposit))
        )
        (asserts! (> pending-deposit u0) INVALID_AMOUNT)
        (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
        (try! (stx-transfer? pending-deposit tx-sender CONTRACT_ADDRESS))
        (var-set total-balances (+ (var-get total-balances) pending-deposit))
        (map-set ledger
          tx-sender 
          (merge
            sender-info
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

;; 2. deposit function as premium (vault)

(define-public (deposit-premium (amount uint)) 
  (begin
    (asserts! (> amount u0) INVALID_AMOUNT)
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
    (ok true)
  )
)

(define-public (queue-deposit (amount uint)) 
  (begin
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (asserts! (> amount u0) INVALID_AMOUNT)
    (if (map-insert ledger 
          tx-sender
          {
            address: tx-sender,
            balance: u0,
            pending-deposits: amount,
            pending-withdraw: u0
          }
        )
      (add-to-list tx-sender)
      (map-set ledger  
        tx-sender
        (merge 
          (unwrap-panic (map-get? ledger tx-sender))
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
          (sender-info (unwrap-panic (map-get? ledger tx-sender)))
        )
        (asserts! (>= balance pending-withdraw) INSUFFICIENT_FUNDS)
        (asserts! (> pending-withdraw u0) INVALID_AMOUNT)
        (try! (as-contract (stx-transfer? pending-withdraw tx-sender (get address sender-info))))
        (var-set total-balances (- (var-get total-balances) pending-withdraw))
        (map-set ledger
          tx-sender
          (merge
            sender-info
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
          (sender-info (unwrap-panic (map-get? ledger tx-sender)))
        )
        (asserts! (>= balance (+ pending-withdraw amount)) INSUFFICIENT_FUNDS)
        (map-set ledger  
          tx-sender
          (merge 
            sender-info
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

(define-private (evaluator (investor principal)) 
  (let  (
          (vault-balance (var-get total-balances))
          (premium-balance (- (stx-get-balance CONTRACT_ADDRESS) vault-balance))
          (investor-info (unwrap-panic (map-get? ledger investor)))
          (investor-balance (get balance investor-info))
          (premium-slice (* (/ investor-balance vault-balance) premium-balance))
        )
        (try! (as-contract (stx-transfer? premium-slice tx-sender investor)))
        (map-set ledger
          investor
          (merge 
            investor-info
            {
              balance: 
                (+  premium-slice investor-balance)
            }
          )
        )
        (ok "PREMIUM SLICE ADDED TO BALANCE")
  )
)

(define-public (distributor)
  (begin 
    (map evaluator (var-get investors-address))
    (ok true)
  )
)

;; Consult the total investor balances
(define-read-only (get-total-balances) 
  (var-get total-balances)
)

(define-read-only (get-investors-list) 
  (var-get investors-address)
)
